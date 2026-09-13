#!/usr/bin/env python3
"""Reviewed wrapper around the Supabase Management API's raw SQL endpoint.

There is no migration runner and no applied/pending ledger for this project
(see supabase/migrations/README.md). Every migration file is applied by hand,
out of band, via one curl call to the Management API. This tool does not
change that model -- it does not track state and it does not decide *when*
to apply a file. What it adds is safety around the single manual act:

  * a --dry-run that parses a migration file the same way the API endpoint
    will (comments stripped, split on top-level ';') and shows exactly what
    would run, with zero network calls;
  * an idempotency guard that refuses a file that is not safely re-runnable
    (no ledger means "did this already land" can only be answered by asking
    the database itself, every time);
  * a --apply mode that reads the file's own `-- readback:` query before and
    after applying, and writes a receipt JSON with both readings so the PR
    carries proof instead of a claim.

Two hard-won rules this file encodes (root HANDOFF.md Sec.5):
  1. Strip `--` comments before sending SQL to the endpoint -- it splits on
     ';' and a ';' inside a comment corrupts the split.
  2. Talk to the endpoint with curl, not urllib -- urllib trips a Cloudflare
     1010 block on this host.

Applying DDL against the shared project remains an out-of-band Meta-CEO act
per DEC-SUPABASE-MIGRATION-NAMESPACE-TERMINAL-LEDGER-2026-09-06: this tool
produces the pre/post catalog receipt that decision requires before the
README application table is updated. It does not grant authority to run
--apply on its own.
"""
from __future__ import annotations

import argparse
import dataclasses
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterable, Optional, Protocol

TOOL_VERSION = "supabase_apply/1"
API_URL = "https://api.supabase.com/v1/projects/{ref}/database/query"
LEGACY_VERSIONS = frozenset(f"{n:04d}" for n in range(1, 11))  # 0001..0010


class MigrationError(RuntimeError):
    """A guard or parse failure. No network call was made."""


class ApiError(RuntimeError):
    """A non-2xx response from the Supabase Management API."""

    def __init__(self, status: int, body: str) -> None:
        super().__init__(f"HTTP {status}: {body[:400]}")
        self.status = status
        self.body = body


def _is_missing_relation_error(exc: "ApiError") -> bool:
    """True only for a Postgres "relation/object does not exist" error.

    A pre-readback query against an object that has not been created yet is
    expected to fail this way -- that is not a real failure. Anything else
    (auth, network, rate limit, syntax, a transient 5xx) must fail the run
    instead of being silently swallowed as "expected before a create", which
    used to let a real outage end with status "applied" and a `pre` half
    that is nothing but an error string.
    """
    body = (exc.body or "").lower()
    if '"code":"42p01"' in body or '"code": "42p01"' in body or "undefined_table" in body:
        return True
    # A message-only match must still name the SPECIFIC failure this guard
    # exists for -- an undefined relation/table/index/policy/... -- never a
    # bare "does not exist". A stale/wrong --project-ref 404s with a message
    # like "Project ref123 does not exist", and that must fail the run, not
    # be swallowed as "expected before a create" (review-#516 round-3 MINOR
    # 1). The object-kind list is deliberately narrow and enumerated rather
    # than a bare "does not exist" match, but it must still cover every kind
    # of object a `-- readback:` query can legitimately pre-check for before
    # a create -- round-3 covered relation/table/index/policy only, which
    # left sequence/view/trigger/function/type/schema/column/constraint
    # readback failures (all real Postgres "does not exist" wordings) out of
    # the guard, forcing a false failure on the very first apply of a file
    # whose readback checks one of those kinds (review-#516 round-4 MINOR:
    # "_is_missing_relation_error over-narrowed"). None of these words can
    # appear in the stale-project-ref 404 message the round-3 fix guards
    # against ("Project <ref> does not exist"), so widening this list does
    # not reopen that hole.
    if "does not exist" in body and re.search(
        r"\b(relation|table|index|policy|sequence|view|trigger|function|"
        r"type|schema|column|constraint)\b",
        body,
    ):
        return True
    return False


@dataclass(frozen=True)
class ExpectedObject:
    kind: str
    name: str

    def as_dict(self) -> dict:
        return {"kind": self.kind, "name": self.name}


# --------------------------------------------------------------------------
# Scanner-based comment/quote-aware helpers
# --------------------------------------------------------------------------

def _scan(sql: str):
    """Yield (index, char, state) walking sql, tracking quote/comment state.

    States: None (top level), "'" (single-quoted string), '"' (quoted ident),
    ("$", tag) (dollar-quoted body with the given tag, "" for bare $$),
    "-" (line comment), "/" (block comment).
    """
    i = 0
    n = len(sql)
    state = None
    while i < n:
        ch = sql[i]
        if state is None:
            if ch == "'":
                state = "'"
                yield i, ch, state
                i += 1
                continue
            if ch == '"':
                state = '"'
                yield i, ch, state
                i += 1
                continue
            if sql.startswith("--", i):
                state = "-"
                yield i, ch, state
                i += 1
                continue
            if sql.startswith("/*", i):
                state = "/"
                # Yield BOTH delimiter characters -- a single-character yield
                # here silently dropped the "*" from the callers that rebuild
                # text out of yielded (index, char) pairs (split_statements,
                # strip_sql_comments), which left a bare "/" in the sent SQL
                # and defeated the second stripping pass entirely.
                yield i, sql[i], state
                yield i + 1, sql[i + 1], state
                i += 2
                continue
            if ch == "$":
                m = re.match(r"\$([A-Za-z_][A-Za-z0-9_]*)?\$", sql[i:])
                if m:
                    tag = m.group(1) or ""
                    token = m.group(0)
                    state = ("$", tag)
                    # Yield every character of the opening delimiter ("$$" or
                    # "$tag$"), not just the first "$" -- see note above.
                    for j, c in enumerate(token):
                        yield i + j, c, state
                    i += len(token)
                    continue
            yield i, ch, state
            i += 1
        elif state == "'":
            if sql.startswith("''", i):
                # Escaped quote inside a string literal -- both characters
                # are content and must both be yielded (a one-character
                # yield here dropped one quote, corrupting the literal).
                yield i, sql[i], state
                yield i + 1, sql[i + 1], state
                i += 2
                continue
            if ch == "'":
                yield i, ch, state
                i += 1
                state = None
                continue
            yield i, ch, state
            i += 1
        elif state == '"':
            if sql.startswith('""', i):
                # Escaped quote inside a quoted identifier -- see note above.
                yield i, sql[i], state
                yield i + 1, sql[i + 1], state
                i += 2
                continue
            if ch == '"':
                yield i, ch, state
                i += 1
                state = None
                continue
            yield i, ch, state
            i += 1
        elif isinstance(state, tuple) and state[0] == "$":
            tag = state[1]
            closer = f"${tag}$"
            if sql.startswith(closer, i):
                # Yield every character of the closing delimiter -- see the
                # opening-delimiter note above for why a single-char yield
                # here corrupted the statement (e.g. "end $$;" -> "end $;").
                for j, c in enumerate(closer):
                    yield i + j, c, state
                i += len(closer)
                state = None
                continue
            yield i, ch, state
            i += 1
        elif state == "-":
            yield i, ch, state
            if ch == "\n":
                state = None
            i += 1
        elif state == "/":
            if sql.startswith("*/", i):
                yield i, "*", state
                yield i + 1, "/", state
                i += 2
                state = None
                continue
            yield i, ch, state
            i += 1


def strip_sql_comments(sql: str) -> str:
    out = []
    for _, ch, state in _scan(sql):
        if state in ("-", "/"):
            out.append("\n" if ch == "\n" else " ")
        else:
            out.append(ch)
    return "".join(out)


def split_statements(sql: str) -> list[str]:
    parts: list[str] = []
    buf: list[str] = []
    for _, ch, state in _scan(sql):
        if ch == ";" and state is None:
            parts.append("".join(buf))
            buf = []
        else:
            buf.append(ch)
    tail = "".join(buf)
    parts.append(tail)
    out = []
    for p in parts:
        stripped = strip_sql_comments(p).strip()
        if stripped:
            out.append(p.strip())
    return out


def extract_block(text: str, anchor: str) -> Optional[str]:
    lines = text.splitlines()
    # Capture group 1 so a real migration's own convention of putting the
    # anchor and its content on ONE line (e.g. "-- down: drop index if
    # exists public.foo;", supabase/migrations/0011_analytics_eid.sql) is
    # not silently discarded -- capture used to start at `start + 1`,
    # dropping the anchor line's own trailing text outright (review-#516
    # latest round MINOR 1, measured against 0011's real down block: the
    # `drop index ...` statement never reached `_block_statements` at all).
    anchor_re = re.compile(rf"^\s*--\s*{re.escape(anchor)}\s*:(.*)$", re.IGNORECASE)
    start = None
    anchor_suffix = ""
    for idx, line in enumerate(lines):
        m = anchor_re.match(line)
        if m:
            start = idx
            anchor_suffix = m.group(1)
            break
    if start is None:
        return None
    captured = []
    if anchor_suffix.strip():
        captured.append(anchor_suffix.strip())
    # The anchor line is always its own boundary -- it never glues onto the
    # first captured line below it, the same way a blank line separates any
    # other two runs. Without this, an anchor-line annotation with no
    # terminating ';' of its own (e.g. 0013_alert_runs_outbox.sql's
    # "-- down: (manual, out-of-band ...)") would join the FIRST real
    # statement line below it into one corrupt run, because nothing else in
    # this file separates them.
    captured.append("")
    for line in lines[start + 1:]:
        stripped = line.strip()
        if stripped == "":
            break
        if not stripped.startswith("--"):
            break
        rest = stripped[2:]
        if rest.startswith(" "):
            rest = rest[1:]
        # A block line that, once its own single layer of "-- " marking is
        # removed, STILL begins with "--" is a nested comment inside the
        # block -- e.g. the "--   -- expect ..." annotations under each
        # query in 0012_thesis_objects.sql's `-- readback:` block. Drop it
        # outright instead of keeping it as block content: leaving it in
        # only worked downstream because strip_sql_comments() happened to
        # neutralize the still-literal "--" later, which is incidental, not
        # a parsing guarantee (Meta-CEO B ruling r2, review-#516).
        if rest.strip().startswith("--"):
            continue
        captured.append(rest)
    return "\n".join(captured)


# Meta-CEO B ruling r4 (2026-09-07, review-#516 round-2-on-r3: 2 majors --
# the r3 keyword-list classifier both under- and over-matched prose: rule
# (c) accepted a down-block sentence that only happened to open with a SQL
# word, and separately (round-6/round-7) a widened keyword list let a
# colon-terminated heading glue onto the statement below it). Keyword-list
# classification of prose is abandoned entirely -- see `_block_statements`
# for the structural replacement. The ONLY keyword use left anywhere in
# this module is the SAFETY VETO below: once a run of lines has already
# been recognized as a terminated statement (it ends with ';'), its first
# token must be a real PostgreSQL command verb, or the parser refuses to
# guess and raises instead of silently keeping or dropping it. This is the
# documented list of SQL command first words (ruling r4, verbatim).
_SQL_COMMAND_VERBS = frozenset({
    "select", "with", "insert", "update", "delete", "drop", "create", "alter",
    "grant", "revoke", "comment", "do", "explain", "show", "set", "reset",
    "analyze", "vacuum", "truncate", "refresh", "call", "begin", "commit",
    "rollback", "lock", "notify", "listen", "table", "values",
})


def _block_statements(block: str) -> tuple[list[str], list[str]]:
    """Split a `-- readback:`/`-- down:` block into statements, structurally.

    Meta-CEO B ruling r4: prose vs SQL is no longer decided by scanning for
    a recognized first word at all (that classifier both under- and
    over-matched -- review-#516's round-2-on-r3 majors). A STATEMENT is a
    run of lines inside the block, joined, that terminates with ';' --
    lines accumulate until one ends with ';' (comments are already stripped
    of their leading '-- ' marker by extract_block() before this function
    ever sees the block, so "a line ends with ';'" here always means the
    SQL text itself ends there, not a comment marker; a trailing INLINE
    comment on the same line, e.g. "select 1; -- expect one row", is
    stripped before this check so it cannot hide a real terminator). A run
    that instead reaches a blank line, or the end of the block, without
    ever terminating is PROSE and is dropped whole. A line that ends in
    '.' or ':' -- a declarative sentence, or a heading introducing what
    follows -- can never be how a SQL statement legitimately terminates,
    so it ALSO flushes the run as prose immediately, the same as a blank
    line, instead of waiting for one: "Drop table by hand before
    re-running." and "Set of checks to run after apply:" are prose
    because they end in '.' / ':', and this now holds even with no blank
    line before the real statement that follows (review-#516 latest round
    MAJOR 2 -- the prior version only excluded these via the blank-line
    rule, so a colon-terminated heading with no blank line beneath it
    glued onto the statement below it). A multi-line statement like
    `drop\n  function public.foo();` is one run: the ';' check only fires
    on the LAST line of the run, so an earlier line with no ';' (and not
    ending in '.'/':' either) just keeps the run open.

    The only remaining keyword use is a SAFETY VETO, applied only to a run
    that DID terminate with ';': its first token must be a recognized
    PostgreSQL command verb (`_SQL_COMMAND_VERBS`). A terminated run whose
    first token is not one of these is neither silently kept nor silently
    dropped -- it raises `MigrationError` naming the line, because a
    ';'-terminated chunk that does not open with a real SQL verb is not a
    case this parser is willing to guess about ("Note: apply order matters
    here;" is this accepted edge -- "note" is not a command verb).

    KNOWN RESIDUAL GAP (review-#516 latest round MAJOR 1, not closed by
    this function): a prose sentence that (a) opens with a word that is
    ALSO a recognized SQL command verb -- e.g. "Drop the table by hand;",
    "Set the migration aside;" -- AND (b) terminates the line with ';'
    instead of '.' or ':' has no structural signal left to distinguish it
    from real SQL, so the safety veto passes it and it is silently KEPT
    and would be sent to the database by --apply. Closing this without a
    second keyword table (e.g. a verb-to-expected-object-noun map) would
    reintroduce exactly the kind of keyword set ruling r4 named and
    ordered deleted ("Delete _DROP_OBJECT_KEYWORDS and every keyword
    set"); it is left open pending a further ruling rather than silently
    re-adding one here.

    Returns (kept, dropped): `kept` is every parsed statement (its own
    terminating ';' trimmed off); `dropped` is the raw text of every run
    that was prose.
    """
    lines = block.split("\n")
    kept: list[str] = []
    dropped: list[str] = []
    run: list[str] = []

    def _flush_prose() -> None:
        if run:
            dropped.append("\n".join(run).strip())
            run.clear()

    for line in lines:
        if line.strip() == "":
            _flush_prose()
            continue
        run.append(line)
        line_sql = strip_sql_comments(line).rstrip()
        if not line_sql.endswith(";") and (line_sql.endswith(".") or line_sql.endswith(":")):
            _flush_prose()
            continue
        if line_sql.endswith(";"):
            # Trim the run's LAST line at the terminating ';' using its
            # position in the comment-stripped text, not the raw line's own
            # last character -- a trailing inline comment after the ';'
            # (e.g. "select 1; -- expect one row") used to defeat a plain
            # `stmt[:-1]` trim (it chopped the comment's last character
            # instead of the ';'), which is moot only because the line
            # failed the OLD `endswith(';')` check entirely and was
            # excluded as prose (review-#516 latest round MINOR 2).
            # strip_sql_comments() is length- and position-preserving (it
            # replaces comment characters with spaces, never removes any),
            # so the ';' sits at the same index in the raw line too.
            term_idx = len(line_sql) - 1
            run[-1] = line[:term_idx]
            stmt = "\n".join(run).strip()
            run.clear()
            first_token_m = re.match(r"[A-Za-z]+", stmt)
            first_token = first_token_m.group(0).lower() if first_token_m else ""
            if first_token not in _SQL_COMMAND_VERBS:
                first_line = stmt.splitlines()[0].strip()
                raise MigrationError(
                    "-- readback:/-- down: block line terminates with ';' "
                    f"but does not open a recognized SQL statement: {first_line!r}"
                )
            kept.append(stmt)
    _flush_prose()
    return kept, dropped


def readback_statements(text: str) -> list[str]:
    stmts, _dropped = readback_statements_detailed(text)
    return stmts


def readback_statements_detailed(text: str) -> tuple[list[str], list[str]]:
    block = extract_block(text, "readback")
    if block is None:
        raise MigrationError(
            "no -- readback: block -- there is no query that proves this landed"
        )
    stmts, dropped = _block_statements(block)
    if not stmts:
        raise MigrationError(
            "no -- readback: block -- there is no query that proves this landed"
        )
    return stmts, dropped


def has_transaction_wrapper(statements: list[str]) -> bool:
    if not statements:
        return False
    first = strip_sql_comments(statements[0]).strip().lower()
    last = strip_sql_comments(statements[-1]).strip().lower()
    return first == "begin" and last == "commit"


def migration_version(path) -> Optional[str]:
    name = Path(path).name
    m = re.match(r"^(\d{4})_", name)
    return m.group(1) if m else None


def load_dotenv_values(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export "):]
        if "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip()
        if len(val) >= 2 and val[0] == val[-1] and val[0] in ("'", '"'):
            val = val[1:-1]
        values[key] = val
    return values


# --------------------------------------------------------------------------
# Object-name extraction / idempotency guard
# --------------------------------------------------------------------------

_IDENT = r'(?:[A-Za-z_][A-Za-z0-9_]*|"[^"]+")'
_QNAME = rf"(?:{_IDENT}\.)*({_IDENT})"

_RE_TABLE = re.compile(rf"create\s+table\s+(?:if\s+not\s+exists\s+)?{_QNAME}", re.IGNORECASE)
_RE_INDEX = re.compile(rf"create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?({_IDENT})", re.IGNORECASE)
_RE_POLICY = re.compile(rf"create\s+policy\s+({_IDENT})\s+on\s+{_QNAME}", re.IGNORECASE)
_RE_DROP_POLICY = re.compile(rf"drop\s+policy\s+(?:if\s+exists\s+)?({_IDENT})\s+on\s+{_QNAME}", re.IGNORECASE)
_RE_TRIGGER = re.compile(rf"create\s+trigger\s+({_IDENT})\s+.*?\bon\s+{_QNAME}", re.IGNORECASE | re.DOTALL)
_RE_DROP_TRIGGER = re.compile(rf"drop\s+trigger\s+(?:if\s+exists\s+)?({_IDENT})\s+on\s+{_QNAME}", re.IGNORECASE)
_RE_FUNCTION = re.compile(rf"create\s+(or\s+replace\s+)?function\s+{_QNAME}\s*\(", re.IGNORECASE)


def _bare(name: str) -> str:
    return name.strip().strip('"').lower()


def expected_objects(statements: list[str]) -> list[ExpectedObject]:
    out: list[ExpectedObject] = []
    for stmt in statements:
        s = strip_sql_comments(stmt)
        for m in _RE_TABLE.finditer(s):
            out.append(ExpectedObject("table", _bare(m.group(1))))
        for m in _RE_INDEX.finditer(s):
            out.append(ExpectedObject("index", _bare(m.group(1))))
        for m in _RE_POLICY.finditer(s):
            out.append(ExpectedObject("policy", _bare(m.group(1))))
        for m in _RE_TRIGGER.finditer(s):
            out.append(ExpectedObject("trigger", _bare(m.group(1))))
        for m in _RE_FUNCTION.finditer(s):
            out.append(ExpectedObject("function", _bare(m.group(2))))
    return out


def idempotency_findings(text: str, statements: list[str]) -> list[str]:
    findings: list[str] = []
    dropped_policies: set[tuple] = set()
    dropped_triggers: set[tuple] = set()
    stripped_stmts = [strip_sql_comments(s) for s in statements]

    for s in stripped_stmts:
        for m in _RE_DROP_POLICY.finditer(s):
            dropped_policies.add((_bare(m.group(1)), _bare(m.group(2))))
        for m in _RE_DROP_TRIGGER.finditer(s):
            dropped_triggers.add((_bare(m.group(1)), _bare(m.group(2))))

    seen_drop_policy: set[tuple] = set()
    seen_drop_trigger: set[tuple] = set()
    for raw, s in zip(statements, stripped_stmts):
        low = s.lower()
        head = raw.strip().replace("\n", " ")[:60]

        for m in _RE_DROP_POLICY.finditer(s):
            seen_drop_policy.add((_bare(m.group(1)), _bare(m.group(2))))
        for m in _RE_DROP_TRIGGER.finditer(s):
            seen_drop_trigger.add((_bare(m.group(1)), _bare(m.group(2))))

        if _RE_TABLE.search(s) and "if not exists" not in low:
            findings.append(f"create table without if not exists: {head}")
        if re.search(r"create\s+(?:unique\s+)?index", low) and "if not exists" not in low:
            findings.append(f"create index without if not exists: {head}")
        pm = _RE_POLICY.search(s)
        if pm:
            key = (_bare(pm.group(1)), _bare(pm.group(2)))
            has_dup_handler = "duplicate_object" in low and low.strip().startswith("do")
            preceded = key in seen_drop_policy
            if not (has_dup_handler or preceded):
                findings.append(f"create policy without a duplicate_object handler or preceding drop policy if exists: {head}")
        tm = _RE_TRIGGER.search(s)
        if tm:
            key = (_bare(tm.group(1)), _bare(tm.group(2)))
            if key not in seen_drop_trigger:
                findings.append(f"create trigger without a preceding drop trigger if exists: {head}")
        fm = _RE_FUNCTION.search(s)
        if fm and not fm.group(1):
            findings.append(f"create function without or replace: {head}")

    down_block = extract_block(text, "down")
    if down_block is None:
        findings.append("no -- down: block -- the file does not say how to undo itself")
    else:
        # Ruling item (1) named both the readback AND the down block for
        # structural statement-vs-prose parsing -- the down block has no
        # separate statement-splitting call site today (it is only
        # presence-checked), so apply the same `_block_statements` here and
        # flag a down block that reads as prose only, not an undo query.
        try:
            down_kept, _down_dropped = _block_statements(down_block)
        except MigrationError as exc:
            findings.append(f"-- down: {exc}")
        else:
            if not down_kept:
                findings.append(
                    "-- down: block has no line that terminates with ';' -- "
                    "it reads as prose, not an undo query"
                )
    try:
        readback_statements(text)
    except MigrationError as exc:
        findings.append(str(exc))

    return findings


# --------------------------------------------------------------------------
# Transport
# --------------------------------------------------------------------------

class QueryRunner(Protocol):
    def __call__(self, sql: str) -> Any: ...


class CurlRunner:
    def __init__(
        self,
        project_ref: str,
        token: str,
        timeout: int = 120,
        runner: Optional[Callable[..., "subprocess.CompletedProcess"]] = None,
    ) -> None:
        self.project_ref = project_ref
        self.token = token
        self.timeout = timeout
        # `runner` is resolved at CALL time (see __call__), never bound here
        # as a default-argument value -- a default of `subprocess.run` is
        # evaluated ONCE, at import time, so a test that does
        # `monkeypatch.setattr(subprocess, "run", fake)` after that point can
        # never reach a CurlRunner constructed with no explicit `runner=`
        # (review-#516 round-3 MAJOR 1, measured: a mutant call inserted into
        # run_dry made a live network call and the patched spy never fired).
        self.runner = runner

    def __call__(self, sql: str) -> Any:
        body = json.dumps({"query": sql})
        fd, body_path = tempfile.mkstemp(prefix="supabase_apply_", suffix=".json")
        try:
            os.chmod(body_path, 0o600)
            with os.fdopen(fd, "w") as fh:
                fh.write(body)
            argv = [
                "curl", "--silent", "--show-error", "--fail-with-body",
                "--max-time", str(self.timeout),
                "--write-out", "\n%{http_code}",
                "-X", "POST", API_URL.format(ref=self.project_ref),
                "-H", "Content-Type: application/json",
                "--data-binary", f"@{body_path}",
                "--config", "-",
            ]
            stdin_config = f'header = "Authorization: Bearer {self.token}"\n'
            # Looked up fresh on every call -- `self.runner or subprocess.run`
            # reads the `subprocess` module's CURRENT `run` attribute, so a
            # test-time monkeypatch of `subprocess.run` is honoured even when
            # no explicit `runner=` was passed to the constructor.
            run_fn = self.runner or subprocess.run
            proc = run_fn(argv, input=stdin_config, capture_output=True, text=True)
            # Redact the token out of anything the child process handed back
            # BEFORE it can reach an ApiError message -- ApiError.body flows
            # straight into the receipt's "error" field (the PR's own proof
            # artifact) and into printed operator output. curl is given the
            # token only on stdin via --config (never argv), so this is a
            # defense-in-depth backstop against a curl version or error path
            # that echoes its config back on stdout/stderr, not a case that
            # is expected to fire in practice (frozen rule (a): the token
            # must never appear in argv, logs, receipts, or error text).
            out = (proc.stdout or "").replace(self.token, "<redacted>")
            err = (proc.stderr or "").replace(self.token, "<redacted>")
            if "\n" in out:
                payload, _, code = out.rpartition("\n")
            else:
                payload, code = out, str(getattr(proc, "returncode", ""))
            try:
                status = int(code.strip())
            except ValueError:
                status = -1
            if status < 200 or status >= 300:
                raise ApiError(status, payload or err)
            try:
                return json.loads(payload) if payload.strip() else None
            except json.JSONDecodeError:
                return payload
        finally:
            try:
                os.remove(body_path)
            except OSError:
                pass


def _flatten_strings(value: Any) -> Iterable[str]:
    """Yield every string leaf inside a JSON-shaped value, lowercased."""
    if isinstance(value, dict):
        for v in value.values():
            yield from _flatten_strings(v)
    elif isinstance(value, list):
        for v in value:
            yield from _flatten_strings(v)
    elif isinstance(value, str):
        yield value.lower()


def missing_after(expected: list[ExpectedObject], post: list[dict]) -> list[str]:
    # Only the query RESULT ROWS are evidence an object exists. post entries
    # also carry the echoed readback statement text (post[i]["statement"]),
    # and the packet's own `-- readback:` convention names the very objects
    # it is checking for -- so a substring search over json.dumps(post) (the
    # old behaviour) matched on the echoed query even with zero rows back.
    # Compare exact identifier values pulled out of the rows instead of a
    # substring search, which also stops "idx_alerts" matching the returned
    # row value "idx_alerts_user".
    values: set[str] = set()
    for entry in post:
        rows = entry.get("rows") if isinstance(entry, dict) else None
        values.update(_flatten_strings(rows))
    missing = []
    for obj in expected:
        if obj.name not in values:
            missing.append(f"{obj.kind} {obj.name}")
    return missing


def build_receipt(**kw) -> dict:
    keys = [
        "file", "sha256", "pre", "post", "applied_at", "statements_n", "status",
        "project_ref", "apply_mode", "expected_objects", "missing_after",
        "failed_statement_index", "error", "tool_version", "readback_excluded",
    ]
    receipt = {k: kw.get(k) for k in keys}
    receipt["tool_version"] = TOOL_VERSION
    return receipt


def apply_mode(statements: list[str]) -> str:
    # run_apply sends one POST per statement unconditionally -- a begin;/
    # commit;-wrapped file is not sent as a single transactional POST (the
    # Management API splits on ';' server-side regardless, so it never was
    # one transaction either way). This must never report "single-
    # transaction": that label went straight into the receipt that is the
    # PR's own proof artifact and claimed an atomicity the tool does not
    # provide (review-#516 MAJOR 2). has_transaction_wrapper() still exists
    # to describe the FILE's own shape; this describes what the tool DOES.
    del statements  # unused; kept for a stable call signature
    return "statement-at-a-time"


# --------------------------------------------------------------------------
# Credentials
# --------------------------------------------------------------------------

def _repo_root() -> Path:
    here = Path(__file__).resolve().parent.parent
    return here


def resolve_credentials(project_ref_override: Optional[str] = None):
    env_path = _repo_root() / ".env"
    dotenv = load_dotenv_values(env_path)
    token = os.environ.get("SUPABASE_ACCESS_TOKEN") or dotenv.get("SUPABASE_ACCESS_TOKEN")
    ref = os.environ.get("SUPABASE_PROJECT_REF") or dotenv.get("SUPABASE_PROJECT_REF")
    if not token or not ref:
        raise SystemExit4(
            "no Supabase Management token found -- set SUPABASE_ACCESS_TOKEN or put it "
            "in ./.env (see HANDOFF.md §5). Nothing was sent."
        )
    if project_ref_override and project_ref_override != ref:
        raise SystemExit4(
            f"--project-ref {project_ref_override!r} does not match the resolved ref "
            f"{ref!r} -- refusing (stale .env guard). Nothing was sent."
        )
    return token, ref


class SystemExit4(SystemExit):
    def __init__(self, message: str) -> None:
        super().__init__(4)
        self.message = message


# --------------------------------------------------------------------------
# Orchestration
# --------------------------------------------------------------------------

def _guard(text: str, statements: list[str], *, allow_legacy: bool, path) -> list[str]:
    findings = idempotency_findings(text, statements)
    if not findings:
        return []
    if allow_legacy:
        version = migration_version(path)
        if version not in LEGACY_VERSIONS:
            raise MigrationError(
                "--allow-legacy covers 0001-0010 only; "
                f"{version or Path(path).name} must be idempotent on its own terms"
            )
        return [f"waived (legacy 0001-0010): {f}" for f in findings]
    raise MigrationError("; ".join(findings))


def run_dry(path: Path, *, allow_legacy: bool = False, project_ref: Optional[str] = None, out=None) -> int:
    if out is None:
        out = sys.stdout
    text = path.read_text()
    statements = split_statements(text)
    digest = hashlib.sha256(path.read_bytes()).hexdigest()

    print(f"supabase_apply -- {path}", file=out)
    try:
        token, ref = resolve_credentials(project_ref)
    except SystemExit4 as exc:
        # An explicit --project-ref that CONFLICTS with the resolved .env/env
        # ref is the same stale-ref guard --apply enforces -- refuse loudly
        # instead of printing the override with no complaint (review-#516
        # round-3 MINOR 3: dry-run used to drop --project-ref entirely).
        if project_ref and "does not match the resolved ref" in exc.message:
            print(f"guards:  REFUSED -- {exc.message}", file=out)
            print("no network call was made.", file=out)
            return 3
        if project_ref:
            # resolve_credentials() could not check --project-ref against a
            # fully resolved SUPABASE_ACCESS_TOKEN/SUPABASE_PROJECT_REF pair
            # (one or both are missing), so the stale-.env guard above never
            # ran for this override -- dry-run still proceeds (it needs no
            # credentials), but say so explicitly instead of silently
            # printing the unchecked override as if it had been validated
            # (review-#516 round-4 MINOR: "dry-run guard bypass when creds
            # incomplete").
            print(
                f"note:    --project-ref {project_ref!r} could not be checked "
                "against stored credentials (SUPABASE_ACCESS_TOKEN/"
                "SUPABASE_PROJECT_REF are not both set) -- the stale-.env "
                "guard did not run for this override.",
                file=out,
            )
        ref = project_ref or "<unresolved: no credentials -- dry-run does not need them>"
    print(f"project: {ref}    mode: dry-run", file=out)
    print(f"sha256:  {digest}", file=out)

    try:
        waived = _guard(text, statements, allow_legacy=allow_legacy, path=path)
    except MigrationError as exc:
        print(f"guards:  REFUSED -- {exc}", file=out)
        print("no network call was made.", file=out)
        return 3

    mode = apply_mode(statements)
    print("guards:  re-runnable OK · down block OK · readback block OK", file=out)
    for w in waived:
        print(f"  {w}", file=out)
    print(f"apply mode if run: {mode}", file=out)

    print(f"\nstatements that WOULD run ({len(statements)}):", file=out)
    for i, s in enumerate(statements, 1):
        one_line = " ".join(strip_sql_comments(s).split())
        shown = one_line[:100]
        marker = " …[truncated, full statement in receipt/-- readback --]" if len(one_line) > 100 else ""
        print(f"  [{i:02d}] {shown}{marker}", file=out)

    try:
        rb, rb_dropped = readback_statements_detailed(text)
    except MigrationError:
        rb, rb_dropped = None, []
    if rb is None:
        print(
            "\nreadback: none (legacy file, missing -- readback: block waived "
            "by --allow-legacy) -- pre/post cannot be checked automatically.",
            file=out,
        )
    else:
        print(f"\nreadback query that WOULD run ({len(rb)} statements):", file=out)
        for i, s in enumerate(rb, 1):
            rb_one_line = " ".join(strip_sql_comments(s).split())
            rb_shown = rb_one_line[:100]
            rb_marker = " …[truncated]" if len(rb_one_line) > 100 else ""
            print(f"  [{i:02d}] {rb_shown}{rb_marker}", file=out)
        # Ruling item (3): the dry-run listing must let an operator see that
        # prose was excluded, not just a statement count that is smaller
        # than they might expect (round-2 review MINOR 1). The note's own
        # wording (ruling r4 minor-1) must describe the ACTUAL reason a run
        # is excluded under the structural parser -- it never terminated
        # with ';' before a blank line / the end of the block -- not the
        # abandoned keyword classifier's language. It also needs its own
        # truncation marker (ruling r4 minor-3): a multi-line excluded run
        # collapsed to one line and cut at 100 chars with no indicator left
        # an operator unable to tell a short excluded line from a long one
        # silently cut off.
        for s in rb_dropped:
            note_one_line = " ".join(strip_sql_comments(s).split())
            note_shown = note_one_line[:100]
            note_marker = " …[truncated]" if len(note_one_line) > 100 else ""
            print(
                f"  note: excluded (no terminating ';' -- reads as prose): "
                f"{note_shown}{note_marker}",
                file=out,
            )

    objs = expected_objects(statements)
    if objs:
        summary = " · ".join(f"{o.kind} {o.name}" for o in objs)
        print(f"\nobjects this file should create ({len(objs)}): {summary}", file=out)
    else:
        print(
            "\nnull: no object names could be read out of this file, so the "
            "post-readback cannot be checked automatically -- read the rows "
            "yourself and re-run with --accept-unverifiable if they are right.",
            file=out,
        )

    print("\nno network call was made.", file=out)
    return 0


def run_apply(
    path: Path,
    *,
    runner: QueryRunner,
    receipt_path: Path,
    project_ref: str,
    allow_legacy: bool = False,
    accept_unverifiable: bool = False,
    out=None,
) -> int:
    if out is None:
        out = sys.stdout
    text = path.read_text()
    statements = split_statements(text)
    digest = hashlib.sha256(path.read_bytes()).hexdigest()

    try:
        _guard(text, statements, allow_legacy=allow_legacy, path=path)
    except MigrationError as exc:
        print(f"guard refusal: {exc}", file=out)
        print("no network call was made.", file=out)
        return 3

    mode = apply_mode(statements)
    try:
        rb_statements, rb_dropped = readback_statements_detailed(text)
    except MigrationError:
        # Only reachable when --allow-legacy waived a missing `-- readback:`
        # block for a 0001-0010 file -- _guard already refused otherwise.
        rb_statements, rb_dropped = None, []
    expected = expected_objects(statements) if rb_statements is not None else []

    def _receipt(**kw) -> dict:
        base = dict(
            file=str(path), sha256=digest,
            applied_at=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            statements_n=len(statements), project_ref=project_ref, apply_mode=mode,
            # Meta-CEO B ruling r3 minor: --apply used to discard the
            # excluded-prose list that readback_statements_detailed()
            # already computes, so an operator reading the receipt (the
            # PR's own proof artifact) could not see that a readback line
            # was excluded -- only --dry-run printed it. Same list, same
            # wording, now on the receipt too.
            readback_excluded=list(rb_dropped),
        )
        base.update(kw)
        return build_receipt(**base)

    def _write(receipt: dict) -> None:
        try:
            receipt_path.write_text(json.dumps(receipt, indent=2, sort_keys=False) + "\n")
        except OSError as exc:
            print(
                f"could not write the receipt to {receipt_path}: {exc.strerror or exc}. "
                "Check that the --receipt path's parent directory exists and is "
                "writable. Some statements above may already have been sent.",
                file=out,
            )
            raise SystemExit(2)
        print(f"receipt written to {receipt_path}", file=out)

    pre: list[dict] = []
    if rb_statements is None:
        print(
            "pre-readback: none (legacy file, missing -- readback: block "
            "waived by --allow-legacy).",
            file=out,
        )
    else:
        print(f"\npre-readback ({len(rb_statements)} statements):", file=out)
        for i, s in enumerate(rb_statements, 1):
            try:
                rows = runner(strip_sql_comments(s))
                pre.append({"statement": s, "rows": rows})
                print(f"  [{i:02d}] pre: {rows}", file=out)
            except ApiError as exc:
                if _is_missing_relation_error(exc):
                    pre.append({"statement": s, "error": str(exc)})
                    print(
                        f"pre-readback statement could not run yet ({exc}). "
                        "That looks like the object does not exist yet, which "
                        "is expected before a create; recorded in the receipt, "
                        "not treated as a failure.",
                        file=out,
                    )
                else:
                    pre.append({"statement": s, "error": str(exc)})
                    _write(_receipt(
                        pre=pre, post=[], status="failed",
                        expected_objects=[o.as_dict() for o in expected],
                        missing_after=[], failed_statement_index=None, error=str(exc),
                    ))
                    print(
                        f"pre-readback failed (not a missing-object error): {exc}",
                        file=out,
                    )
                    return 5

    # Statement-at-a-time, always -- one POST per statement via curl. A file
    # wrapped in its own begin/commit still reports apply_mode
    # "statement-at-a-time" in the receipt, same as any other file (apply_mode()
    # never returns "single-transaction" -- review-#516 MAJOR 2/round-2 MINOR 1).
    # has_transaction_wrapper() only describes the FILE's own shape (used by
    # tests, not by this loop or the idempotency guard); this tool never sends
    # the whole file as one POST regardless of what has_transaction_wrapper()
    # reports: the Management API splits on ';' server-side
    # (supabase/migrations/README.md), so one POST was never one transaction,
    # and sending the whole file as one request would also make a mid-file
    # failure unreportable (failed_statement_index forced to None).
    failed_index = None
    for i, s in enumerate(statements, 1):
        try:
            runner(strip_sql_comments(s))
        except ApiError as exc:
            failed_index = i
            _write(_receipt(
                pre=pre, post=[], status="failed",
                expected_objects=[o.as_dict() for o in expected], missing_after=[],
                failed_statement_index=failed_index, error=str(exc),
            ))
            print(f"apply failed: {exc}", file=out)
            return 5
        print(f"[{i:02d}/{len(statements)}] ok", file=out)

    post: list[dict] = []
    if rb_statements is not None:
        print(f"\npost-readback ({len(rb_statements)} statements):", file=out)
        try:
            for i, s in enumerate(rb_statements, 1):
                rows = runner(strip_sql_comments(s))
                post.append({"statement": s, "rows": rows})
                print(f"  [{i:02d}] post: {rows}", file=out)
        except ApiError as exc:
            _write(_receipt(
                pre=pre, post=post, status="failed",
                expected_objects=[o.as_dict() for o in expected], missing_after=[],
                failed_statement_index=None, error=str(exc),
            ))
            print(f"post-readback failed: {exc}", file=out)
            return 5

    if rb_statements is None or not expected:
        reason = (
            "no readback available for this legacy file"
            if rb_statements is None
            else "no object names could be read out of this file"
        )
        if not accept_unverifiable:
            _write(_receipt(
                pre=pre, post=post, status="unverified", expected_objects=[],
                missing_after=[], failed_statement_index=None, error=None,
            ))
            print(
                f"null: {reason}, so the post-readback cannot be checked "
                "automatically -- read the rows yourself and re-run with "
                "--accept-unverifiable if they are right.",
                file=out,
            )
            return 6
        # --accept-unverifiable proceeds (exit 0) but must never claim the
        # plain "applied" status a checked run gets: falling through to that
        # status silently hid the null (no message printed, and the receipt
        # -- the PR's own proof artifact -- looked identical to a verified
        # pass) (review-#516 MAJOR 3). "applied_unverified" is a distinct,
        # honest status and the null is still printed.
        _write(_receipt(
            pre=pre, post=post, status="applied_unverified", expected_objects=[],
            missing_after=[], failed_statement_index=None, error=None,
        ))
        print(
            f"null: {reason}, so the post-readback could not be checked "
            "automatically. Proceeding because --accept-unverifiable was "
            "set -- read the rows yourself to confirm this actually landed.",
            file=out,
        )
        return 0
    else:
        missing = missing_after(expected, post)
        if missing:
            _write(_receipt(
                pre=pre, post=post, status="failed_readback",
                expected_objects=[o.as_dict() for o in expected], missing_after=missing,
                failed_statement_index=None, error=None,
            ))
            print(f"post-readback did not show: {', '.join(missing)}", file=out)
            return 6

    _write(_receipt(
        pre=pre, post=post, status="applied",
        expected_objects=[o.as_dict() for o in expected], missing_after=[],
        failed_statement_index=None, error=None,
    ))
    print(f"applied. receipt written to {receipt_path}", file=out)
    return 0

def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(prog="supabase_apply.py")
    parser.add_argument("path", type=Path)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true")
    mode.add_argument("--apply", action="store_true")
    parser.add_argument("--receipt", type=Path)
    parser.add_argument("--project-ref")
    parser.add_argument("--allow-legacy", action="store_true")
    parser.add_argument("--accept-unverifiable", action="store_true")
    parser.add_argument("--timeout", type=int, default=120)
    args = parser.parse_args(argv)

    if args.apply and not args.receipt:
        parser.error("--receipt is required with --apply")
    if args.dry_run and args.receipt:
        parser.error("--dry-run refuses --receipt")
    if not args.path.exists():
        print(
            f"no such file: {args.path} -- check the path and try again. Nothing was sent.",
            file=sys.stderr,
        )
        return 2

    if args.dry_run:
        return run_dry(args.path, allow_legacy=args.allow_legacy, project_ref=args.project_ref)

    try:
        token, ref = resolve_credentials(args.project_ref)
    except SystemExit4 as exc:
        print(exc.message, file=sys.stderr)
        return 4

    runner = CurlRunner(ref, token, timeout=args.timeout)
    return run_apply(
        args.path,
        runner=runner,
        receipt_path=args.receipt,
        project_ref=ref,
        allow_legacy=args.allow_legacy,
        accept_unverifiable=args.accept_unverifiable,
    )


if __name__ == "__main__":
    raise SystemExit(main())
