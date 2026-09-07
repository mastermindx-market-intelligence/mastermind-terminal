#!/usr/bin/env python3
"""Guard against colliding or unreserved `supabase/migrations` version prefixes.

There is no remote migration ledger for this Supabase project (see
`supabase/migrations/README.md`): DDL lands by hand, out of band, and nothing in the
deploy chain applies these files. Two pull requests authored off the same base cannot
see each other's filenames, which is exactly how `0008_` was claimed twice (PR #427 and
PR #426, README.md:67-75). `RESERVATIONS.json` is the forward ledger that makes that
collision visible before merge: claim a prefix there before you write the `.sql` file.

This checker joins the files actually present in this checkout against that ledger. A
`taken`/`reserved` prefix whose file is absent is NOT an error -- it means the owning
pull request has not merged yet -- so the guard stays green on a checkout missing
in-flight files (e.g. 0013/0014 living in open PRs #513/#514), and it still fails on a
genuine duplicate-prefix or unreserved-prefix fixture. That is what proves the guard is
real and not vacuously green.
"""
from __future__ import annotations

import json
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
VALID_STATES = ("historical", "taken", "reserved", "free")
HEADER_SCAN_LINES = 40  # header lines only; a buried '-- Rollback:' mid-file does not count

REQUIRED_KEYS = {"state", "file", "packet", "pr", "pr_state", "note"}

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
        elif state == "free":
            if file_v is not None or packet_v is not None or pr_v is not None or pr_state_v is not None:
                findings.append(Finding("RESERVATION_SCHEMA", key, "state=free requires file/packet/pr/pr_state to all be null"))

    return findings


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


def check_all(filenames: Sequence[str], texts: Mapping[str, str], doc: dict) -> list[Finding]:
    findings: list[Finding] = []

    # Ledger-schema validation must run even on an empty/wrong migrations dir --
    # otherwise a corrupt RESERVATIONS.json on a checkout with no .sql files (or
    # the wrong path) produces only MIGRATIONS_DIR_EMPTY and every schema
    # violation stays invisible (minor finding, review round 2).
    findings.extend(validate_reservations(doc))

    if not filenames:
        findings.append(Finding("MIGRATIONS_DIR_EMPTY", None, "no .sql migrations found -- a wrong path would make every other check vacuously pass"))
        return findings

    findings.extend(check_prefix_collisions(filenames))
    findings.extend(check_files_are_reserved(filenames, doc))
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

    findings = check_all(sql_files, texts, doc)
    notes = disclosures(sql_files, doc)
    return findings, notes


def main(argv: "Sequence[str] | None" = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    as_json = "--json" in argv

    if not RESERVATIONS_PATH.exists():
        print(f"::error title=migration-namespace::RESERVATION_SCHEMA missing file — {RESERVATIONS_PATH} does not exist", flush=True)
        return 2

    try:
        findings, notes = collect()
    except Exception as exc:  # defensive: usage error, not a finding
        print(f"::error title=migration-namespace::usage error — {exc}", flush=True)
        return 2

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
