#!/usr/bin/env python3
"""Guard against colliding or unreserved `supabase/migrations` version prefixes.

There is no remote migration ledger for this Supabase project (see
`supabase/migrations/README.md`): DDL lands by hand, out of band, and nothing in the
deploy chain applies these files. Two pull requests authored off the same base cannot
see each other's filenames, which is exactly how `0008_` was claimed twice (PR #427 and
PR #426, README.md:67-75). `RESERVATIONS.json` is the forward ledger that makes that
collision visible before merge: claim a prefix there before you write the `.sql` file.

This checker joins the files actually present in this checkout against that ledger.
The join runs on-disk-file -> ledger-entry, never the reverse, so an entry whose file
is not in this checkout is a Disclosure rather than a Finding. The current rule set,
in full:

  * `state` is one of `historical`, `taken`, `reserved`, `released`, `free`. A file on
    disk at a `free` prefix, at a `reserved` prefix (the owner claimed the number but
    has not written the .sql), or at a `released` prefix (the claim was stood down and
    the number is retired, never reissued) is a Finding. `released` keeps its number and
    counts toward `max()` exactly like an active claim -- see README.md's "Release path".
  * present file x `pr_state: "open"` is scope-dependent, so this guard runs it in one
    of THREE modes (see `resolve_run_mode`). On `master` (STRICT) the file being here
    proves its pull request merged, so `open` is a stale ledger (that is how
    0014/0015/0016 lied) and it is a Finding. On a proven `pull_request` run
    (PULL_REQUEST) the branch legitimately carries its OWN migration with an open row --
    but only its own: a present file whose row names any OTHER pull request is stale
    (`OPEN_PR_STATE_STALE`), because the file being on this branch means that PR merged
    without its row being flipped, or this branch is carrying a file it does not own.
    With no CI environment at all (LENIENT) nothing about scope is proven, so the rule
    relaxes to the attributable minimum: the entry must be `state: "taken"` with a
    pull-request number.
  * every prefix whose `.sql` is in this checkout must carry both `applied_in_production`
    and `applied_date` KEYS -- the second half of the ledger's purpose is recording
    whether a migration is applied in production. Presence is required, truth is not
    invented: where no application fact is recorded anywhere, the honest entry is an
    explicit `null` with a note saying so, never a guessed date.
  * absent file x `pr_state: "merged"` is a Finding in BOTH modes -- the converse is
    valid on every ref, because a merged file is on `master` and therefore in any
    checkout descended from it.
  * absent file x `pr_state: "open"` is never a Finding; it is the unmerged in-flight
    case, disclosed in plain words rather than failed.
  * `reserved` prefixes must form a gap-free block above the highest merged/historical
    number (with `released` numbers counting as occupied), so a later claimant cannot
    step over a live Meta-CEO B pre-reservation without seeing it.
  * the literal Supabase project ref appears exactly once in this directory: the
    ledger's own top-level `project_ref`. Entries under `prefixes` and every `*.md`
    beside the ledger must write `{ref}` instead (Terminal #538's redaction law).

`main()` selects strict mode only when the environment proves a `master` push
(`GITHUB_EVENT_NAME=push` and `GITHUB_REF_NAME=master`), and pull-request mode only when
the environment proves a pull-request run (`GITHUB_EVENT_NAME=pull_request` plus the
running number in `PR_NUMBER`, wired into the pytest step in `.github/workflows/ci.yml`).
Anything else -- a local run, a `workflow_dispatch` -- is lenient. Every run prints which
of the three modes produced its report. This matters because no workflow in this
repository has an `on: push` trigger: before the pull-request mode existed, the strict
rule was reachable from no configuration CI could actually run, and the staleness this
packet corrected would have replayed unseen (review round 3, FIX-1).
"""
from __future__ import annotations

import json
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping, Sequence

REPO_ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS_DIR = REPO_ROOT / "supabase" / "migrations"
RESERVATIONS_PATH = MIGRATIONS_DIR / "RESERVATIONS.json"

# Prefix is exactly 4 digits here (the ledger's `prefix_width`), narrower than
# tests/test_migration_ledger.py:24 which accepts any width. The narrower rule is
# intentional: this guard also owns the reservation join, which is keyed on a
# fixed-width string.
MIGRATION_RE = re.compile(r"^(?P<prefix>\d{4})_(?P<name>[a-z0-9_]+)\.sql$")
LEDGER_ROW_RE = re.compile(r"^--\s*Ledger row:\s*(?P<row>\S.*)$", re.IGNORECASE | re.MULTILINE)
ROLLBACK_RE = re.compile(r"^--\s*Rollback:\s*(?P<sql>\S.*)$", re.IGNORECASE | re.MULTILINE)
# `released` is the README's own release path (README.md, "Release path" operating
# note): a claim that was stood down keeps its row and its number in place, counts
# toward max() like any other row, and is never reissued. It was missing from this
# tuple, so the moment anyone actually followed the README the ledger would have gone
# RESERVATION_SCHEMA-red on the state word and RESERVATION_GAP-red on the number --
# permanently, with no honest way out (review round 2, FIX-5).
VALID_STATES = ("historical", "taken", "reserved", "released", "free")

# The states that occupy a number: they hold it against reissue, so a contiguity walk
# must treat them as filled rather than as a gap.
OCCUPYING_STATES = ("taken", "reserved", "released")
HEADER_SCAN_LINES = 40  # header lines only; a buried '-- Rollback:' mid-file does not count

# A Supabase project ref is a 20-char lowercase-alphanumeric token. Bounded on
# both sides so it does not fire on a longer hex string (e.g. a 40-char git
# sha) that merely contains 20 consecutive lowercase-alphanumeric characters --
# entries in this ledger are expected to carry short/abbreviated shas (<20
# chars), never full ones, precisely so this stays unambiguous.
PROJECT_REF_RE = re.compile(r"(?<![a-z0-9])[a-z0-9]{20}(?![a-z0-9])")

REQUIRED_KEYS = {"state", "file", "packet", "pr", "pr_state", "note"}

# Keys that answer "is this migration applied in production?". Required to be
# PRESENT on every entry whose .sql is in the checkout; an explicit null is a
# legitimate value (see check_applied_fields_for_present_files).
APPLIED_KEYS = ("applied_in_production", "applied_date")

# The top-level `project_ref` must match the ref SHAPE exactly. Validating the
# shape rather than the value keeps the check sayable out loud: no test, log line
# or finding has to carry the token to prove the key is intact.
PROJECT_REF_EXACT_RE = re.compile(r"^[a-z0-9]{20}$")

# Pinned expected value (MAJOR 2 fix): header_required_from used to be read
# unvalidated -- removing or mangling the key silently switched the header-law
# enforcement AND its nulls-printed disclosure off at the same instant. Both are
# now validated top-level keys (see validate_reservations) so a missing or
# unexpected floor is a loud Finding rather than a silent no-op.
EXPECTED_HEADER_REQUIRED_FROM = "0015"


@dataclass(frozen=True)
class Finding:
    code: str
    prefix: "str | None"
    detail: str


@dataclass(frozen=True)
class Disclosure:
    prefix: str
    state: str
    text: str


def load_reservations(path: Path = RESERVATIONS_PATH) -> dict:
    text = path.read_text(encoding="utf-8")
    return json.loads(text)


def parse_prefix(filename: str) -> "str | None":
    match = MIGRATION_RE.match(filename)
    return match.group("prefix") if match else None


def _non_empty_str(value: Any) -> bool:
    return isinstance(value, str) and value.strip() != ""


def validate_reservations(doc: dict) -> list[Finding]:
    findings: list[Finding] = []

    if not isinstance(doc, dict):
        return [Finding("RESERVATION_SCHEMA", None, "RESERVATIONS.json top level must be an object")]

    floor = doc.get("header_required_from")
    if not isinstance(floor, str) or not re.fullmatch(r"\d{4}", floor):
        findings.append(
            Finding(
                "MISSING_HEADER_FLOOR",
                None,
                "top-level 'header_required_from' must be a 4-digit string pinning where the "
                "header-law floor starts -- a missing or malformed value used to silently turn "
                "the header rule (and its disclosure) off",
            )
        )
    elif floor != EXPECTED_HEADER_REQUIRED_FROM:
        findings.append(
            Finding(
                "HEADER_FLOOR_UNEXPECTED",
                None,
                f"top-level 'header_required_from' is {floor!r}, expected "
                f"{EXPECTED_HEADER_REQUIRED_FROM!r}",
            )
        )

    # `check_no_literal_project_ref` compares every sibling *.md against THIS value
    # and does nothing at all when it is missing or blank -- so deleting the key
    # would switch the redaction scan off while the guard still printed "0
    # findings". That is the identical silent-disable that made
    # `header_required_from` a MAJOR in round 2 (see the comment above
    # EXPECTED_HEADER_REQUIRED_FROM); the key is load-bearing, so it is validated
    # (review round 3, FIX-2). A mangled value disables the scan just as
    # completely -- it simply compares against something nothing matches -- so the
    # shape is checked too. Neither branch ever puts the value in the detail.
    project_ref = doc.get("project_ref")
    if not _non_empty_str(project_ref):
        findings.append(
            Finding(
                "PROJECT_REF_MISSING",
                None,
                "top-level 'project_ref' must be a non-empty string -- it is the only "
                "sanctioned copy of the reference and the value every sibling '*.md' is "
                "scanned against; without it that redaction scan silently disables itself",
            )
        )
    elif not PROJECT_REF_EXACT_RE.fullmatch(project_ref.strip()):
        findings.append(
            Finding(
                "PROJECT_REF_MALFORMED",
                None,
                "top-level 'project_ref' must be exactly 20 lowercase alphanumeric "
                "characters -- a mangled value matches nothing in the sibling '*.md' scan "
                "and disables it as completely as deleting the key (value not printed)",
            )
        )

    if not _non_empty_str(doc.get("header_required_note")):
        findings.append(
            Finding(
                "MISSING_HEADER_FLOOR_NOTE",
                None,
                "top-level 'header_required_note' must be a non-empty string disclosing the "
                "pre-floor gap",
            )
        )

    prefixes = doc.get("prefixes")
    if not isinstance(prefixes, dict):
        findings.append(Finding("RESERVATION_SCHEMA", None, "top-level 'prefixes' key must be an object"))
        return findings

    for key, entry in prefixes.items():
        if not re.fullmatch(r"\d{4}", key):
            findings.append(Finding("RESERVATION_SCHEMA", key, "prefix key must be exactly 4 digits"))
            continue
        if not isinstance(entry, dict):
            findings.append(Finding("RESERVATION_SCHEMA", key, "entry must be an object"))
            continue

        missing = REQUIRED_KEYS - set(entry.keys())
        if missing:
            findings.append(Finding("RESERVATION_SCHEMA", key, f"entry missing required keys: {sorted(missing)}"))
            continue

        state = entry.get("state")
        if state not in VALID_STATES:
            findings.append(Finding("RESERVATION_SCHEMA", key, f"state '{state}' is not one of {VALID_STATES}"))
            continue

        if not _non_empty_str(entry.get("note")):
            findings.append(Finding("RESERVATION_SCHEMA", key, "note is required and must be a non-empty string on every entry"))

        file_v = entry.get("file")
        packet_v = entry.get("packet")
        pr_v = entry.get("pr")
        pr_state_v = entry.get("pr_state")

        if state == "historical":
            pass  # file/packet/pr/pr_state may each be null or set; no further constraint
        elif state == "taken":
            if not _non_empty_str(file_v):
                findings.append(Finding("RESERVATION_SCHEMA", key, "state=taken requires a non-empty 'file'"))
            if not _non_empty_str(packet_v):
                findings.append(Finding("RESERVATION_WITHOUT_OWNER", key, "state=taken requires a non-empty 'packet' owner id"))
            if not isinstance(pr_v, int):
                findings.append(Finding("RESERVATION_SCHEMA", key, "state=taken requires an integer 'pr'"))
            if pr_state_v not in ("merged", "open"):
                findings.append(Finding("RESERVATION_SCHEMA", key, "state=taken requires pr_state 'merged' or 'open'"))
        elif state == "reserved":
            if file_v is not None:
                findings.append(Finding("RESERVATION_SCHEMA", key, "state=reserved requires 'file' to be null"))
            if not _non_empty_str(packet_v):
                findings.append(Finding("RESERVATION_WITHOUT_OWNER", key, "state=reserved requires a non-empty 'packet' owner id"))
            if pr_v is None:
                if pr_state_v is not None:
                    findings.append(Finding("RESERVATION_SCHEMA", key, "state=reserved with pr=null requires pr_state to be null"))
            elif not isinstance(pr_v, int):
                findings.append(Finding("RESERVATION_SCHEMA", key, "state=reserved 'pr' must be null or an int"))
        elif state == "released":
            # A stood-down claim: the row stays, the number stays retired, and no
            # .sql was ever written for it. `packet` is still required -- the row
            # records WHOSE claim was stood down, which is the whole point of not
            # deleting it.
            if file_v is not None:
                findings.append(Finding("RESERVATION_SCHEMA", key, "state=released requires 'file' to be null -- a released claim never wrote its .sql"))
            if not _non_empty_str(packet_v):
                findings.append(Finding("RESERVATION_WITHOUT_OWNER", key, "state=released requires a non-empty 'packet' naming the claim that was stood down"))
        elif state == "free":
            if file_v is not None or packet_v is not None or pr_v is not None or pr_state_v is not None:
                findings.append(Finding("RESERVATION_SCHEMA", key, "state=free requires file/packet/pr/pr_state to all be null"))

    return findings


def is_master_push(env: "Mapping[str, str] | None" = None) -> bool:
    """True only when the environment PROVES this run is a push to `master`.

    The open-while-present rule (see `check_open_pr_state_for_present_files`) is a
    master-scope property, so it must not be asserted on a pull-request checkout.
    GitHub Actions sets both of these; anything else -- a local run, a
    `pull_request` event, a `workflow_dispatch` on a branch -- reads as False and
    gets the lenient rule set.
    """
    env = os.environ if env is None else env
    return env.get("GITHUB_EVENT_NAME") == "push" and env.get("GITHUB_REF_NAME") == "master"


def pull_request_number(env: "Mapping[str, str] | None" = None) -> "int | None":
    """The number of the pull request this run belongs to, or None.

    Both halves must be present: `GITHUB_EVENT_NAME=pull_request` proves the event,
    and `PR_NUMBER` (wired to `github.event.pull_request.number` in the pytest step
    of `.github/workflows/ci.yml`) carries the number. An event name with no usable
    number proves the scope but not WHICH pull request owns the branch, which is the
    whole content of the rule -- so it reads as None and the run falls back to the
    lenient default rather than inventing an owner.
    """
    env = os.environ if env is None else env
    if env.get("GITHUB_EVENT_NAME") != "pull_request":
        return None
    raw = env.get("PR_NUMBER")
    if not isinstance(raw, str):
        return None
    raw = raw.strip()
    if not raw.isdigit():
        return None
    return int(raw)


def resolve_run_mode(
    env: "Mapping[str, str] | None" = None,
    force_strict: bool = False,
) -> "tuple[bool, int | None, str]":
    """Pick the open-while-present rule set from what the environment PROVES.

    Returns `(strict_master, pr_number, printable_mode)`. Exactly one of the three
    modes applies, and the printable name goes into the report so no reader of a CI
    log has to guess which rule set produced it.
    """
    env = os.environ if env is None else env

    if force_strict or is_master_push(env):
        return True, None, "STRICT (master push)"

    number = pull_request_number(env)
    if number is not None:
        return False, number, f"PULL_REQUEST (#{number})"

    if env.get("GITHUB_EVENT_NAME") == "pull_request":
        return (
            False,
            None,
            "LENIENT (pull_request event with no usable PR_NUMBER -- the ci.yml step env "
            "is missing or empty, so which pull request owns this branch is unproven)",
        )

    return False, None, "LENIENT (no proven master push or pull request)"


def check_prefix_collisions(filenames: Sequence[str]) -> list[Finding]:
    by_prefix: dict[str, list[str]] = {}
    for name in filenames:
        prefix = parse_prefix(name)
        if prefix is None:
            continue
        by_prefix.setdefault(prefix, []).append(name)

    findings: list[Finding] = []
    for prefix, names in sorted(by_prefix.items()):
        if len(names) > 1:
            findings.append(
                Finding(
                    "DUPLICATE_PREFIX",
                    prefix,
                    f"two or more files share prefix {prefix}: {sorted(names)}",
                )
            )
    return findings


def check_files_are_reserved(filenames: Sequence[str], doc: dict) -> list[Finding]:
    findings: list[Finding] = []
    prefixes = doc.get("prefixes", {}) if isinstance(doc, dict) else {}

    for name in filenames:
        prefix = parse_prefix(name)
        if prefix is None:
            findings.append(Finding("UNPARSEABLE_FILENAME", None, f"'{name}' does not match {MIGRATION_RE.pattern}"))
            continue

        entry = prefixes.get(prefix)
        if entry is None:
            findings.append(Finding("UNRESERVED_PREFIX", prefix, f"'{name}' has no entry in RESERVATIONS.json prefixes"))
            continue

        state = entry.get("state")
        if state == "free":
            findings.append(Finding("FREE_PREFIX_HAS_FILE", prefix, f"'{name}' sits at prefix {prefix}, which RESERVATIONS.json marks free"))
            continue

        if state == "reserved":
            # `reserved` legitimately carries file=null (schema-enforced in
            # validate_reservations) -- the owning packet has claimed the prefix
            # but has not written the .sql yet. So *any* on-disk file at this
            # prefix is a collision: either the true owner has landed and the
            # ledger is stale (should have flipped to state=taken with this
            # file), or a different lane has occupied a prefix it does not own.
            # Either way this must fail loudly rather than silently pass a null
            # 'file' through the equality check below.
            findings.append(
                Finding(
                    "RESERVED_PREFIX_OCCUPIED",
                    prefix,
                    f"'{name}' occupies prefix {prefix}, which RESERVATIONS.json marks reserved "
                    f"(not yet taken) for packet '{entry.get('packet')}'; flip the ledger entry to "
                    "state=taken naming this file and its owning PR before this can pass",
                )
            )
            continue

        if state == "released":
            # A released number is retired, not recycled: README.md's release path
            # says the row keeps counting toward max() precisely so the number is
            # never reissued. A file sitting on a released prefix means someone
            # reissued it anyway.
            findings.append(
                Finding(
                    "RELEASED_PREFIX_OCCUPIED",
                    prefix,
                    f"'{name}' occupies prefix {prefix}, which RESERVATIONS.json marks released "
                    f"(claim by packet '{entry.get('packet')}' stood down); a released number is "
                    "retired and never reissued -- claim the next free number instead",
                )
            )
            continue

        expected_file = entry.get("file")
        if expected_file is None:
            findings.append(
                Finding(
                    "RESERVED_NAME_MISMATCH",
                    prefix,
                    f"'{name}' occupies prefix {prefix} (state={state!r}) but RESERVATIONS.json "
                    "records no owning file for it -- the ledger entry cannot vouch for this file",
                )
            )
        elif expected_file != name:
            findings.append(
                Finding(
                    "RESERVED_NAME_MISMATCH",
                    prefix,
                    f"prefix {prefix} is reserved for '{expected_file}' but the on-disk file is '{name}'",
                )
            )

    return findings


def check_migration_header(filename: str, text: str, doc: dict) -> list[Finding]:
    prefix = parse_prefix(filename)
    if prefix is None:
        return []

    floor = doc.get("header_required_from") if isinstance(doc, dict) else None
    if not isinstance(floor, str) or not re.fullmatch(r"\d{4}", floor):
        return []
    if prefix < floor:
        return []

    header_lines = "\n".join(text.splitlines()[:HEADER_SCAN_LINES])
    findings: list[Finding] = []
    if not LEDGER_ROW_RE.search(header_lines):
        findings.append(Finding("MISSING_LEDGER_ROW_HEADER", prefix, f"'{filename}' is missing a '-- Ledger row: ...' header line in its first {HEADER_SCAN_LINES} lines"))
    if not ROLLBACK_RE.search(header_lines):
        findings.append(Finding("MISSING_ROLLBACK_HEADER", prefix, f"'{filename}' is missing a '-- Rollback: ...' header line in its first {HEADER_SCAN_LINES} lines"))
    return findings


def check_open_pr_state_for_present_files(
    filenames: Sequence[str],
    doc: dict,
    strict_master: bool = False,
    pr_number: "int | None" = None,
) -> list[Finding]:
    """Cross-check `pr_state` against what is actually on disk.

    Two rules with different scopes, which is why this takes `strict_master` and,
    for the pull-request scope, `pr_number`:

    **present x open -- MASTER-scope only.** On `master`, a `.sql` file being
    here proves its pull request merged, so `pr_state: "open"` beside it is a
    stale ledger: that is exactly how 0014/0015/0016 lied (merged in #514/#527,
    never flipped off 'open'), silently, because `check_files_are_reserved` only
    compares filenames. But this suite also runs under `on: pull_request`, on the
    PR branch, where the migration the PR INTRODUCES is present and its entry
    honestly says 'open'. Asserting the master rule there would leave the next
    migration PR no truthful ledger that passes -- `reserved` trips
    RESERVED_PREFIX_OCCUPIED, `taken`+`open` would trip this, and only a false
    `taken`+`merged` gets through (review round 2, FIX-2). So outside master a
    present file with `pr_state: "open"` can be legitimate -- but how far it is
    trusted depends on what the environment proves:

      * `pr_number` given (a proven `pull_request` run): the branch may carry the
        migration of THIS pull request and no other. A present file whose row names
        a different pull request is `OPEN_PR_STATE_STALE` -- the file is here, so
        either that pull request merged and its row was never flipped (0014's exact
        shape) or this branch is carrying a file it does not own. This is the mode
        that makes the master rule's acceptance reachable from a CI with no
        `on: push` trigger (review round 3, FIX-1).
      * no `pr_number` (a local run, a `workflow_dispatch`): nothing about ownership
        is proven, so the rule relaxes to the attributable minimum -- the entry must
        be `state: "taken"` with a real pull-request number.

    **absent x merged -- valid on every ref.** A merged file is on `master`, so
    it is in any checkout descended from `master`. Absent while claiming merged
    is the ledger lying in the opposite direction, and nothing caught it before.
    """
    findings: list[Finding] = []
    prefixes = doc.get("prefixes", {}) if isinstance(doc, dict) else {}
    present = {parse_prefix(name) for name in filenames} - {None}

    for prefix, entry in prefixes.items():
        if not isinstance(entry, dict):
            continue
        pr_state = entry.get("pr_state")
        is_present = prefix in present

        if is_present and pr_state == "open":
            entry_pr = entry.get("pr")
            owned_by_this_pr = (
                pr_number is not None
                and isinstance(entry_pr, int)
                and not isinstance(entry_pr, bool)
                and entry_pr == pr_number
            )
            if strict_master:
                findings.append(
                    Finding(
                        "OPEN_PR_STATE_WITH_FILE_PRESENT",
                        prefix,
                        f"prefix {prefix}'s file is present on master but RESERVATIONS.json "
                        f"still records pr_state 'open' (pr {entry.get('pr')!r}) -- a file "
                        "present on master means the owning pull request merged; flip pr_state "
                        "to 'merged' (and record the merge sha) or the ledger is stale",
                    )
                )
            elif pr_number is not None:
                if not owned_by_this_pr:
                    findings.append(
                        Finding(
                            "OPEN_PR_STATE_STALE",
                            prefix,
                            f"prefix {prefix}'s file is present on the branch of pull request "
                            f"#{pr_number}, but RESERVATIONS.json records it as pr_state 'open' "
                            f"on pull request {entry_pr!r} -- a pull request branch legitimately "
                            "carries its OWN migration with an open row and no other, so either "
                            "that pull request merged and this row was never flipped to 'merged', "
                            "or this branch is carrying a file it does not own",
                        )
                    )
            elif entry.get("state") != "taken" or not isinstance(entry.get("pr"), int):
                findings.append(
                    Finding(
                        "OPEN_PR_STATE_WITHOUT_OWNING_PR",
                        prefix,
                        f"prefix {prefix}'s file is present in this checkout with pr_state "
                        "'open' -- legitimate on a pull-request branch, but only when the entry "
                        f"is state='taken' with a pull-request number; this one is "
                        f"state={entry.get('state')!r} pr={entry.get('pr')!r}",
                    )
                )
        elif not is_present and pr_state == "merged":
            findings.append(
                Finding(
                    "MERGED_PR_STATE_WITH_FILE_ABSENT",
                    prefix,
                    f"RESERVATIONS.json records prefix {prefix} as pr_state 'merged' (pr "
                    f"{entry.get('pr')!r}) but no file for it is in this checkout -- a merged "
                    "file is on master and therefore in every checkout descended from it; the "
                    "ledger, the filename, or the merge claim is wrong",
                )
            )
    return findings


def check_applied_fields_for_present_files(
    filenames: Sequence[str],
    doc: dict,
) -> list[Finding]:
    """Every prefix whose `.sql` is in this checkout must SAY whether it is applied.

    The ruling this ledger implements has two halves -- it records who owns a
    prefix, and it records whether that migration is applied in production. The
    second half was carried by 0012-0016 and by nothing else: 0001-0011 had no
    `applied_*` keys at all, the only assertions were hardcoded pins over five
    prefixes, and nothing stopped 0017+ merging while recording nothing (review
    round 3, FIX-3).

    What is required is PRESENCE of both keys, not a true value. Where no
    application fact is recorded anywhere in this repository, the honest entry is
    an explicit `null` plus a note saying it was not recorded -- the same
    honest-nulls law the rest of this ledger runs on. Inventing a date to satisfy
    a required key would be strictly worse than the gap it closes, so the check
    deliberately does not judge the values.

    Join direction is the module's usual one, on-disk file -> ledger entry: a
    `reserved` prefix, or a `taken` one whose pull request has not merged, has
    nothing applied and is never asked to say so.
    """
    findings: list[Finding] = []
    prefixes = doc.get("prefixes", {}) if isinstance(doc, dict) else {}

    for name in sorted(filenames):
        prefix = parse_prefix(name)
        if prefix is None:
            continue
        entry = prefixes.get(prefix)
        if not isinstance(entry, dict):
            continue  # UNRESERVED_PREFIX / RESERVATION_SCHEMA already own this case

        missing = [key for key in APPLIED_KEYS if key not in entry]
        if missing:
            findings.append(
                Finding(
                    "APPLIED_FIELDS_MISSING",
                    prefix,
                    f"'{name}' is in this checkout but its RESERVATIONS.json entry is missing "
                    f"{missing} -- every present migration must record whether it is applied in "
                    "production. Copy the fact from README.md's application table, or write an "
                    "explicit null with a note saying it was not recorded; never guess a date",
                )
            )

    return findings


def check_reservation_contiguity(doc: dict) -> list[Finding]:
    """`reserved` prefixes (claimed by ruling ahead of any pull request) must
    form a strictly increasing, gap-free block starting immediately after the
    highest prefix that is already `merged` (state=taken, pr_state=merged) or
    `historical`. A gap in that block -- a number between the merged trunk and
    the highest claim that is not in OCCUPYING_STATES -- would let a later
    claimant skip past a live Meta-CEO B ruling without seeing it.

    `released` counts as occupying its number, not as a hole: README.md's
    release path stands a claim down WITHOUT freeing the number, and the number
    keeps counting toward `max()` so it can never be reissued. Before this fix
    the walk demanded `taken` or `reserved` only, so following the README's own
    documented release path produced a permanent RESERVATION_GAP red with no
    honest way out (review round 2, FIX-5).
    """
    findings: list[Finding] = []
    prefixes = doc.get("prefixes", {}) if isinstance(doc, dict) else {}

    numeric: dict[int, Mapping[str, Any]] = {}
    for key, entry in prefixes.items():
        if not isinstance(key, str) or not re.fullmatch(r"\d{4}", key) or not isinstance(entry, dict):
            continue
        numeric[int(key)] = entry

    merged_trunk = [
        n
        for n, e in numeric.items()
        if e.get("state") == "historical" or (e.get("state") == "taken" and e.get("pr_state") == "merged")
    ]
    # `reserved` opens a block; `released` numbers inside or above it are held,
    # not free. Walking to the top of BOTH is what stops a released tail from
    # silently dropping out of the contiguity window.
    claimed = sorted(n for n, e in numeric.items() if e.get("state") in ("reserved", "released"))
    if not claimed:
        return findings

    highest_merged = max(merged_trunk) if merged_trunk else 0

    for n in range(highest_merged + 1, max(claimed) + 1):
        key = f"{n:04d}"
        entry = numeric.get(n)
        if entry is None or entry.get("state") not in OCCUPYING_STATES:
            findings.append(
                Finding(
                    "RESERVATION_GAP",
                    key,
                    f"prefix {key} is missing or is none of {OCCUPYING_STATES}, leaving a gap "
                    f"between the highest merged prefix {highest_merged:04d} and the claimed "
                    f"block up to {max(claimed):04d} -- claimed prefixes must be strictly "
                    "increasing with no gaps above the highest merged prefix",
                )
            )
    return findings


def check_no_literal_project_ref(
    doc: dict,
    sibling_texts: "Mapping[str, str] | None" = None,
) -> list[Finding]:
    """The literal Supabase project ref belongs in exactly one place.

    That place is RESERVATIONS.json's top-level `project_ref` field -- README.md's
    own rule, redacted to `{ref}` everywhere else since Terminal #538. Two scans:

      * every field of every entry under `prefixes`, against the ref SHAPE
        (`PROJECT_REF_RE`), so a note repeating any ref-looking token is caught
        even if it is not this project's ref;
      * every sibling document handed in via `sibling_texts` -- README.md and any
        other `*.md` beside the ledger -- against the ledger's OWN `project_ref`
        value. Prose cannot be matched on shape without false positives, and the
        exact-value comparison has none. Before this, README.md could spell the
        ref out in full and this guard stayed green (review round 2, FIX-1).

    Neither branch ever puts the value into a Finding: the detail names the file
    and the field, never the token, because these findings are printed into CI logs.
    """
    findings: list[Finding] = []
    prefixes = doc.get("prefixes", {}) if isinstance(doc, dict) else {}

    for key, entry in prefixes.items():
        if not isinstance(entry, dict):
            continue
        for field, value in entry.items():
            if isinstance(value, str) and PROJECT_REF_RE.search(value):
                findings.append(
                    Finding(
                        "LITERAL_PROJECT_REF_IN_ENTRY",
                        key,
                        f"entry field '{field}' contains a literal 20-char lowercase-alphanumeric "
                        "token that looks like the Supabase project ref -- use '{ref}' instead",
                    )
                )

    real_ref = doc.get("project_ref") if isinstance(doc, dict) else None
    if _non_empty_str(real_ref):
        for name, text in sorted((sibling_texts or {}).items()):
            if isinstance(text, str) and real_ref in text:
                findings.append(
                    Finding(
                        "LITERAL_PROJECT_REF_IN_DOC",
                        None,
                        f"'{name}' (beside RESERVATIONS.json) spells out the literal Supabase "
                        "project ref -- write '{ref}' instead; the ledger's top-level "
                        "'project_ref' field is the only sanctioned copy",
                    )
                )
    return findings


def check_all(
    filenames: Sequence[str],
    texts: Mapping[str, str],
    doc: dict,
    sibling_texts: "Mapping[str, str] | None" = None,
    strict_master: bool = False,
    pr_number: "int | None" = None,
) -> list[Finding]:
    findings: list[Finding] = []

    # Ledger-schema validation must run even on an empty/wrong migrations dir --
    # otherwise a corrupt RESERVATIONS.json on a checkout with no .sql files (or
    # the wrong path) produces only MIGRATIONS_DIR_EMPTY and every schema
    # violation stays invisible (minor finding, review round 2).
    findings.extend(validate_reservations(doc))
    findings.extend(check_reservation_contiguity(doc))
    findings.extend(check_no_literal_project_ref(doc, sibling_texts))

    if not filenames:
        findings.append(Finding("MIGRATIONS_DIR_EMPTY", None, "no .sql migrations found -- a wrong path would make every other check vacuously pass"))
        return findings

    findings.extend(check_prefix_collisions(filenames))
    findings.extend(check_files_are_reserved(filenames, doc))
    findings.extend(
        check_open_pr_state_for_present_files(
            filenames, doc, strict_master=strict_master, pr_number=pr_number
        )
    )
    findings.extend(check_applied_fields_for_present_files(filenames, doc))
    for name in filenames:
        text = texts.get(name, "")
        findings.extend(check_migration_header(name, text, doc))

    return findings


def _plain_note(prefix: str, entry: Mapping[str, Any], doc: Mapping[str, Any]) -> str:
    state = entry.get("state")
    packet = entry.get("packet")
    pr = entry.get("pr")
    pr_state = entry.get("pr_state")

    if state == "taken":
        pr_txt = f"pull request #{pr} ({pr_state})" if pr is not None else "no pull request opened yet"
        return f"{prefix} — taken by packet {packet} in {pr_txt}; the file is not in this checkout because that pull request has not merged." if entry.get("file") is None else f"{prefix} — taken by packet {packet}, {pr_txt}."
    if state == "reserved":
        pr_txt = f"pull request #{pr} ({pr_state})" if pr is not None else "no pull request opened yet"
        return f"{prefix} — reserved by packet {packet}; {pr_txt}."
    if state == "released":
        owner_txt = f"packet {packet}" if packet else "an owner not recorded in this repository"
        pr_txt = f" (pull request #{pr})" if pr is not None else ""
        return (
            f"{prefix} — released: the claim by {owner_txt}{pr_txt} was stood down. The number "
            "stays retired — it keeps counting toward the next free number and is never reissued "
            "— and no file exists for it anywhere."
        )
    if state == "free":
        return f"{prefix} — free — claim it in RESERVATIONS.json before you write the file."
    if state == "historical":
        if packet is None and pr is None:
            return f"{prefix} — owner not recorded in this repository (predates the reservation law)."
        pr_txt = f"pull request #{pr} ({pr_state})" if pr is not None else "owner not recorded in this repository (predates the reservation law)"
        packet_txt = f"packet {packet}" if packet else "no packet recorded"
        return f"{prefix} — historical: {packet_txt}, {pr_txt}."
    return f"{prefix} — state {state}."


def disclosures(filenames: Sequence[str], doc: dict) -> list[Disclosure]:
    notes: list[Disclosure] = []
    prefixes = doc.get("prefixes", {}) if isinstance(doc, dict) else {}
    on_disk = {parse_prefix(name) for name in filenames}

    for prefix, entry in sorted(prefixes.items()):
        if not isinstance(entry, dict):
            continue
        state = entry.get("state")
        text = _plain_note(prefix, entry, doc)
        # Only `taken` legitimately means "a real file exists somewhere but not
        # here" -- a `reserved` prefix has no file anywhere yet (the owner has
        # claimed the number but not written the .sql), so tagging it "absent
        # from this checkout" conflated an unmerged-PR file with a not-yet-written
        # one (minor finding, review round 2; plain-language law).
        if state == "taken" and prefix not in on_disk:
            text += " (absent from this checkout by design.)"
        notes.append(Disclosure(prefix=prefix, state=state or "unknown", text=text))

    header_note = doc.get("header_required_note") if isinstance(doc, dict) else None
    if _non_empty_str(header_note):
        # Derive the printed floor from the actual document value rather than a
        # literal "0015" -- otherwise a legitimate future floor raise (with
        # EXPECTED_HEADER_REQUIRED_FROM updated to match) leaves the CI-printed
        # disclosure lying about where the rule actually starts (minor finding,
        # review round 2). Fall back to the pinned expected value only when the
        # floor itself is missing/malformed, which validate_reservations already
        # flags as a Finding -- the disclosure stays informative either way.
        floor = doc.get("header_required_from") if isinstance(doc, dict) else None
        floor_txt = floor if isinstance(floor, str) and re.fullmatch(r"\d{4}", floor) else EXPECTED_HEADER_REQUIRED_FROM
        notes.append(
            Disclosure(
                prefix="*",
                state="note",
                text=f"header rule starts at {floor_txt}; prefixes below that floor are exempt by number and that gap is recorded in header_required_note.",
            )
        )

    return notes


def format_report(findings: Sequence[Finding], notes: Sequence[Disclosure]) -> str:
    lines: list[str] = []
    if findings:
        lines.append(f"{len(findings)} finding(s):")
        for f in findings:
            prefix_txt = f.prefix if f.prefix else "-"
            lines.append(f"  [{f.code}] {prefix_txt}: {f.detail}")
    else:
        lines.append("0 findings — migration namespace is clean.")

    lines.append("")
    lines.append("disclosures (nulls printed in plain words, never hidden):")
    for note in notes:
        lines.append(f"  {note.text}")

    return "\n".join(lines)


def collect(
    migrations_dir: Path = MIGRATIONS_DIR,
    reservations: Path = RESERVATIONS_PATH,
    strict_master: bool = False,
    pr_number: "int | None" = None,
) -> "tuple[list[Finding], list[Disclosure]]":
    try:
        doc = load_reservations(reservations)
    except (OSError, json.JSONDecodeError) as exc:
        return [Finding("RESERVATION_SCHEMA", None, f"could not load {reservations}: {exc}")], []

    sql_files = sorted(p.name for p in migrations_dir.glob("*.sql")) if migrations_dir.is_dir() else []
    texts = {}
    for name in sql_files:
        try:
            texts[name] = (migrations_dir / name).read_text(encoding="utf-8", errors="replace")
        except OSError:
            texts[name] = ""

    # Every `*.md` beside the ledger, scanned for the literal project ref.
    sibling_texts: dict[str, str] = {}
    if migrations_dir.is_dir():
        for path in sorted(migrations_dir.glob("*.md")):
            try:
                sibling_texts[path.name] = path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                sibling_texts[path.name] = ""

    findings = check_all(
        sql_files, texts, doc, sibling_texts, strict_master=strict_master, pr_number=pr_number
    )
    notes = disclosures(sql_files, doc)
    return findings, notes


def main(argv: "Sequence[str] | None" = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    as_json = "--json" in argv

    if not RESERVATIONS_PATH.exists():
        print(f"::error title=migration-namespace::RESERVATION_SCHEMA missing file — {RESERVATIONS_PATH} does not exist", flush=True)
        return 2

    # The open-while-present rule is scope-dependent: master push -> strict,
    # proven pull request -> that pull request may carry its own migration and no
    # other, anything else -> lenient. `--strict` forces master scope for a local
    # dry run.
    strict, pr_number, mode = resolve_run_mode(force_strict="--strict" in argv)

    try:
        findings, notes = collect(strict_master=strict, pr_number=pr_number)
    except Exception as exc:  # defensive: usage error, not a finding
        print(f"::error title=migration-namespace::usage error — {exc}", flush=True)
        return 2

    # Never let the reader guess which rule set produced this report.
    notes = list(notes) + [
        Disclosure(
            prefix="*",
            state="note",
            text=(
                f"open-while-present rule ran in {mode} mode — STRICT: a present .sql whose "
                "ledger row says pr_state 'open' is stale, because the file being on master "
                "proves its pull request merged. PULL_REQUEST: it is legitimate only for the "
                "pull request named in this mode line; a present file whose row names any other "
                "open pull request is stale. LENIENT: nothing about scope is proven, so it is "
                "required only to be state 'taken' with a pull-request number. The "
                "absent-while-merged converse runs in all three modes."
            ),
        )
    ]

    if as_json:
        payload = {
            "findings": [f.__dict__ for f in findings],
            "disclosures": [n.__dict__ for n in notes],
        }
        print(json.dumps(payload, indent=2))
    else:
        for f in findings:
            prefix_txt = f.prefix if f.prefix else "-"
            print(f"::error title=migration-namespace::{f.code} {prefix_txt} — {f.detail}", flush=True)
        print(format_report(findings, notes))

    return 1 if findings else 0


if __name__ == "__main__":
    raise SystemExit(main())
