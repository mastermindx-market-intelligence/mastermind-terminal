"""Tests for the supabase/migrations namespace guard.

See scripts/check_supabase_migration_namespace.py for the rules. The load-bearing
property under test is the join direction in `check_files_are_reserved`: it walks
on-disk files looking them up in the ledger, never the reverse, so a `taken`/`reserved`
prefix whose file has not merged yet is a Disclosure, not a Finding.
"""
from __future__ import annotations

import os
import warnings
from pathlib import Path

import pytest

from scripts.check_supabase_migration_namespace import (
    EXPECTED_HEADER_REQUIRED_FROM,
    HEADER_SCAN_LINES,
    MIGRATIONS_DIR,
    RESERVATIONS_PATH,
    check_all,
    check_applied_fields_for_present_files,
    check_files_are_reserved,
    check_migration_header,
    check_no_literal_project_ref,
    check_open_pr_state_for_present_files,
    check_prefix_collisions,
    check_reservation_contiguity,
    collect,
    disclosures,
    format_report,
    load_reservations,
    parse_prefix,
    pull_request_number,
    resolve_run_mode,
    validate_reservations,
)

# A ref-SHAPED but deliberately fake token: 20 lowercase-alphanumeric characters,
# so PROJECT_REF_RE matches it, and hardcoded here so no fixture in this module
# ever carries the estate's real Supabase project reference. Three fixtures below
# used to spell the real value out verbatim (review round 2, FIX-1) -- a test file
# is a published artefact and a ref-shaped secret in one is a leak whether or not
# the guard would have caught it. `test_synthetic_project_ref_is_not_the_real_one`
# proves at runtime that this constant is not the real value, and
# `test_the_real_project_ref_appears_only_in_the_ledger_field` proves the real
# value survives in exactly one place: the ledger's own field. (Both names were
# stale here -- they named a test that has never existed under that name; review
# round 3, FIX-5, which asked that every test named in a receipt be a test that
# exists.)
SYNTHETIC_PROJECT_REF = "zzzzsyntheticref0000"


def reservations_doc(**overrides) -> dict:
    doc = {
        "$schema_note": "test fixture",
        "version": 1,
        "project_ref": SYNTHETIC_PROJECT_REF,
        "prefix_width": 4,
        "header_required_from": "0015",
        "header_required_note": "test fixture",
        "claim_before_you_write": "test fixture",
        "prefixes": {
            "0001": {
                "state": "historical",
                "file": "0001_init.sql",
                "packet": None,
                "pr": None,
                "pr_state": None,
                "note": "fixture",
            },
        },
    }
    doc.update(overrides)
    return doc


def write_tree(tmp_path: Path, files: dict, doc: dict) -> "tuple[Path, Path]":
    migrations_dir = tmp_path / "migrations"
    migrations_dir.mkdir(parents=True, exist_ok=True)
    for name, text in files.items():
        (migrations_dir / name).write_text(text, encoding="utf-8")

    reservations_path = tmp_path / "RESERVATIONS.json"
    import json

    reservations_path.write_text(json.dumps(doc), encoding="utf-8")
    return migrations_dir, reservations_path


# --- 1 -----------------------------------------------------------------------

def test_reservations_file_parses_and_matches_schema():
    doc = load_reservations(RESERVATIONS_PATH)
    assert validate_reservations(doc) == []


# --- 2 -----------------------------------------------------------------------

def test_every_on_disk_migration_prefix_is_reserved():
    doc = load_reservations(RESERVATIONS_PATH)
    on_disk = sorted(p.name for p in MIGRATIONS_DIR.glob("*.sql"))
    assert on_disk, "expected at least one migration file on disk"
    findings = check_files_are_reserved(on_disk, doc)
    unreserved = [f for f in findings if f.code == "UNRESERVED_PREFIX"]
    assert unreserved == []


# --- 3 -----------------------------------------------------------------------

def test_repo_is_clean_under_the_guard():
    findings, _notes = collect()
    assert findings == [], format_report(findings, [])


# --- 4 -----------------------------------------------------------------------

def test_duplicate_prefix_is_detected():
    filenames = ["0099_a.sql", "0099_b.sql"]
    findings = check_prefix_collisions(filenames)
    codes = [f.code for f in findings]
    assert "DUPLICATE_PREFIX" in codes

    report = format_report(findings, [])
    # LIVE PROOF (packet §6): surface the rendered report through the warnings
    # channel so `pytest -q`'s default warnings summary prints it verbatim in the
    # CI check log, next to the green pass count, with no extra flags needed.
    warnings.warn(
        "migration-namespace guard proof — synthetic duplicate 0099 fixture raised:\n" + report,
        UserWarning,
        stacklevel=2,
    )


# --- 5 -----------------------------------------------------------------------

def test_unreserved_prefix_is_detected(tmp_path):
    doc = reservations_doc()
    findings = check_files_are_reserved(["0098_x.sql"], doc)
    assert any(f.code == "UNRESERVED_PREFIX" and f.prefix == "0098" for f in findings)


# --- 6 -----------------------------------------------------------------------

def test_reserved_prefix_without_owner_packet_is_detected():
    doc = reservations_doc(
        prefixes={
            "0015": {
                "state": "reserved",
                "file": None,
                "packet": None,
                "pr": None,
                "pr_state": None,
                "note": "fixture",
            }
        }
    )
    findings = validate_reservations(doc)
    assert any(f.code == "RESERVATION_WITHOUT_OWNER" and f.prefix == "0015" for f in findings)


# --- 7 -----------------------------------------------------------------------

def test_missing_ledger_row_header_is_detected():
    doc = reservations_doc(header_required_from="0015")
    text = "-- Rollback: drop table if exists foo;\ncreate table foo();\n"
    findings = check_migration_header("0099_x.sql", text, doc)
    assert any(f.code == "MISSING_LEDGER_ROW_HEADER" for f in findings)


# --- 8 -----------------------------------------------------------------------

def test_missing_rollback_header_is_detected():
    doc = reservations_doc(header_required_from="0015")
    text = "-- Ledger row: NONE: fixture\ncreate table foo();\n"
    findings = check_migration_header("0099_x.sql", text, doc)
    assert any(f.code == "MISSING_ROLLBACK_HEADER" for f in findings)


# --- 9 -----------------------------------------------------------------------

def test_header_rule_does_not_retro_fail_pre_floor_files():
    doc = reservations_doc(header_required_from="0015")
    body = "create table alert_runs_outbox();\n"
    findings_13 = check_migration_header("0013_alert_runs_outbox.sql", body, doc)
    findings_14 = check_migration_header("0014_tenancy_foundation.sql", body, doc)
    assert findings_13 == []
    assert findings_14 == []

    notes = disclosures(["0013_alert_runs_outbox.sql"], doc)
    assert any("header rule starts at 0015" in n.text for n in notes)


# --- 10 (acceptance 4) ---------------------------------------------------------

def test_taken_prefix_present_and_absent_is_not_an_error_on_the_real_tree():
    """Acceptance 4, proved against the REAL checkout, not a synthetic fixture.

    The commission premise ("green on a checkout missing 0013/0014") went stale
    the moment PR #513 merged 0013_alert_runs_outbox.sql to master. This test
    must not go stale the same way a second time: it does NOT hard-assert which
    specific prefix is present vs. absent (review round 2, MAJOR 1 -- a fixture
    naming "0014 is absent" reddens `master` itself the instant sibling PR #514
    merges, even though the guard has zero real namespace violation in that
    state). Instead it derives the present/absent split from the ledger x disk
    join for every `taken` entry, and only asserts the SHAPE: file-on-disk means
    no "absent" disclosure tag, file-absent means the tag is present and names
    the owning PR -- and that both shapes are exercised by the real tree, so the
    test still proves something rather than vacuously passing on an empty split.
    """
    doc = load_reservations(RESERVATIONS_PATH)
    on_disk = sorted(p.name for p in MIGRATIONS_DIR.glob("*.sql"))
    on_disk_set = set(on_disk)

    findings = check_files_are_reserved(on_disk, doc)
    assert findings == []

    notes = disclosures(on_disk, doc)
    notes_by_prefix = {n.prefix: n.text for n in notes}

    taken_prefixes = {
        prefix: entry
        for prefix, entry in doc["prefixes"].items()
        if isinstance(entry, dict) and entry.get("state") == "taken"
    }
    assert taken_prefixes, "the real ledger must have at least one 'taken' entry for this test to mean anything"

    present_class = []
    absent_class = []
    for prefix, entry in taken_prefixes.items():
        expected_file = entry.get("file")
        text = notes_by_prefix[prefix]
        if expected_file in on_disk_set:
            present_class.append(prefix)
            assert "absent from this checkout by design" not in text, (
                f"{prefix}: file is present on disk, disclosure must not claim it is absent"
            )
        else:
            absent_class.append(prefix)
            pr = entry.get("pr")
            assert "absent from this checkout by design" in text, (
                f"{prefix}: file is absent from disk, disclosure must say so"
            )
            assert pr is not None and f"#{pr}" in text, (
                f"{prefix}: absent-file disclosure must name its owning pull request"
            )

    # Both shapes are what makes this test mean something -- but the real
    # tree's shape changes over time as PRs merge (that is exactly what made
    # the previous 0014-naming version a time bomb), so an empty class is a
    # skip-with-reason, never a hard failure: this test's job is to prove the
    # guard's behaviour on whichever shapes the real tree currently has, not to
    # freeze the tree's shape in place.
    if not present_class:
        pytest.skip("no 'taken' prefix currently has its file present on disk -- present-file shape not exercised")
    if not absent_class:
        pytest.skip("no 'taken' prefix currently has its file absent from disk -- absent-file shape not exercised")


# --- 11 -----------------------------------------------------------------------

def test_free_prefix_with_a_file_present_is_detected():
    doc = reservations_doc(
        prefixes={
            "0017": {
                "state": "free",
                "file": None,
                "packet": None,
                "pr": None,
                "pr_state": None,
                "note": "fixture",
            }
        }
    )
    findings = check_files_are_reserved(["0017_oops.sql"], doc)
    assert any(f.code == "FREE_PREFIX_HAS_FILE" and f.prefix == "0017" for f in findings)


# --- 11b (major fix: reserved prefix with file=null must not vouch for an occupant) -----

def test_reserved_prefix_occupied_by_a_file_is_detected():
    """RESERVATIONS.json diff:482-497 shape: 0015/0016 are `reserved` for
    B-F12-3/B-F12-4 with file=null (the owner has claimed the number but not
    written the .sql yet). A non-owner lane dropping a file at that prefix
    used to pass silently because `expected_file != name` short-circuited on
    the null `file`. It must fail loudly instead, naming the owning packet so
    the log points at who actually holds the prefix.
    """
    doc = reservations_doc(
        prefixes={
            "0015": {
                "state": "reserved",
                "file": None,
                "packet": "B-F12-3",
                "pr": None,
                "pr_state": None,
                "note": "fixture",
            }
        }
    )
    findings = check_files_are_reserved(["0015_anything.sql"], doc)
    assert any(f.code == "RESERVED_PREFIX_OCCUPIED" and f.prefix == "0015" for f in findings)
    assert not any(f.code == "UNRESERVED_PREFIX" for f in findings)
    detail = next(f.detail for f in findings if f.code == "RESERVED_PREFIX_OCCUPIED")
    assert "B-F12-3" in detail


def test_taken_prefix_with_null_file_cannot_vouch_for_any_name():
    """Defense in depth for the same join-skip shape on state=taken: even if
    RESERVATIONS.json schema validation is bypassed and a `taken` entry somehow
    carries file=null, the join must not let an arbitrary on-disk name pass.
    """
    doc = reservations_doc(
        prefixes={
            "0015": {
                "state": "taken",
                "file": None,
                "packet": "B-F12-3",
                "pr": 600,
                "pr_state": "open",
                "note": "fixture (schema-invalid on purpose)",
            }
        }
    )
    findings = check_files_are_reserved(["0015_anything.sql"], doc)
    assert any(f.code == "RESERVED_NAME_MISMATCH" and f.prefix == "0015" for f in findings)


# --- 12 (acceptance 2) ----------------------------------------------------------

def test_reservations_records_the_known_collision_surface():
    doc = load_reservations(RESERVATIONS_PATH)
    prefixes = doc["prefixes"]

    assert prefixes["0012"]["state"] == "taken"
    assert prefixes["0012"]["packet"] == "F11-1"
    assert prefixes["0012"]["pr"] == 502

    assert prefixes["0013"]["state"] == "taken"
    assert prefixes["0013"]["packet"] == "B-F08-2"
    assert prefixes["0013"]["pr"] == 513
    assert prefixes["0013"]["pr_state"] == "merged"

    # 0014-0016 merged and applied to production (Meta-CEO B receipts) --
    # updated from the stale pr_state="open" this test used to assert, which
    # was the ledger lying: all three files have been on master (via #514 and
    # #527) since before this packet ran. See README.md's application table
    # and Reservations table for the receipts this mirrors.
    assert prefixes["0014"]["state"] == "taken"
    assert prefixes["0014"]["packet"] == "B-F12-1"
    assert prefixes["0014"]["pr"] == 514
    assert prefixes["0014"]["pr_state"] == "merged"
    assert prefixes["0014"]["applied_in_production"] is True

    assert prefixes["0015"]["state"] == "taken"
    assert prefixes["0015"]["file"] == "0015_team_roles_invitations.sql"
    assert prefixes["0015"]["packet"] == "B-F12-3"
    assert prefixes["0015"]["pr"] == 514
    assert prefixes["0015"]["pr_state"] == "merged"
    assert prefixes["0015"]["applied_in_production"] is True

    assert prefixes["0016"]["state"] == "taken"
    assert prefixes["0016"]["file"] == "0016_account_lifecycle_requests.sql"
    assert prefixes["0016"]["packet"] == "B-F12-4"
    assert prefixes["0016"]["pr"] == 527
    assert prefixes["0016"]["pr_state"] == "merged"
    assert prefixes["0016"]["applied_in_production"] is True

    assert prefixes["0017"]["state"] == "taken"
    assert prefixes["0017"]["file"] == "0017_personal_accuracy_ledger.sql"
    assert prefixes["0017"]["packet"] == "B-F13-5"
    assert prefixes["0017"]["pr"] == 547
    assert prefixes["0017"]["pr_state"] == "merged"
    assert prefixes["0017"]["merged_sha"] == "b7aa0981"
    assert prefixes["0017"]["applied_in_production"] is True
    assert prefixes["0017"]["applied_date"] == "2026-09-10"

    # 0018 is merged on master (#549). 0017 is taken by open PR #547 (B-F13-5).
    assert prefixes["0018"]["state"] == "taken"
    assert prefixes["0018"]["file"] == "0018_webhook_delivery.sql"
    assert prefixes["0018"]["packet"] == "B-F12-7"
    assert prefixes["0018"]["pr"] == 549
    assert prefixes["0018"]["pr_state"] == "merged"
    assert prefixes["0018"]["merged_sha"] == "cd1269fe"
    assert prefixes["0018"]["applied_in_production"] is True
    assert prefixes["0018"]["applied_date"] == "2026-09-10"
    assert "shipped unapplied; the seat applies with a receipt" in prefixes["0018"]["note"]

    # 0021 (packet B-F12-B5-1, explicit grants) merged to master as bad423f5 on
    # 2026-09-11 in PR #548 and is still UNAPPLIED on purpose: 0019 and 0020 are
    # open in PR #550 and the seat applies DDL in ledger order, never ahead of a
    # lower, still-unapplied number. applied_date is null because there is no
    # application yet, never because a real date was lost.
    assert prefixes["0021"]["state"] == "taken"
    assert prefixes["0021"]["file"] == "0021_resource_grants.sql"
    assert prefixes["0021"]["packet"] == "B-F12-B5-1"
    assert prefixes["0021"]["pr"] == 548
    assert prefixes["0021"]["pr_state"] == "merged"
    assert prefixes["0021"]["merged_sha"] == "bad423f5"
    assert prefixes["0021"]["applied_in_production"] is False
    assert prefixes["0021"]["applied_date"] is None

    # 0017-0020 claimed by Meta-CEO B ruling 2026-09-09 -- updated from the
    # stale state="free" this test used to assert.
    #
    # Round 3, FIX-6: the OWNER is pinned hard (that is the ruling, and a
    # later tidy-up must not reassign a claimed number); the STATE is pinned
    # only to the claim being live. Pinning it to exactly "reserved" coupled
    # this assertion to the next migration PR: PR 0017 (B-F13-5) would have had
    # to edit this line in the same commit that flips its ledger row to
    # "taken". Both words mean "this number is claimed and occupied"
    # (OCCUPYING_STATES in the guard), so accepting either removes the coupling
    # without weakening what the ruling actually asserts. `file` is checked
    # only in the state that requires it to be null.
    ruling_owners = {
        "0017": "B-F13-5",
        "0018": "B-F12-7",
        "0019": "B-F12-8",
        "0020": "B-F12-9",
    }
    for prefix, packet in ruling_owners.items():
        assert prefixes[prefix]["state"] in ("reserved", "taken"), prefix
        assert prefixes[prefix]["packet"] == packet, prefix
        if prefixes[prefix]["state"] == "reserved":
            assert prefixes[prefix]["file"] is None, prefix

    assert prefixes["0019"]["state"] == "taken"
    assert prefixes["0019"]["file"] == "0019_team_role_changes.sql"
    assert prefixes["0019"]["packet"] == "B-F12-8"
    assert prefixes["0019"]["pr"] == 550
    assert prefixes["0019"]["pr_state"] == "open"
    assert prefixes["0019"]["applied_in_production"] is False
    assert prefixes["0019"]["applied_date"] is None

    # 0020 originated in #557 and now rides to master on this pull request, so
    # the open row names 550. A present file whose open row names any other PR
    # is OPEN_PR_STATE_STALE in pull_request mode (PR #550 round-2 BLOCKER 2).
    assert prefixes["0020"]["state"] == "taken"
    assert prefixes["0020"]["file"] == "0020_team_ownership_transfer.sql"
    assert prefixes["0020"]["packet"] == "B-F12-9"
    assert prefixes["0020"]["pr"] == 550
    assert prefixes["0020"]["pr_state"] == "open"
    assert prefixes["0020"]["applied_in_production"] is False
    assert prefixes["0020"]["applied_date"] is None

    # Master's 0022 and 0023 rows stay merged. An open 0023 on this branch is
    # OPEN_PR_STATE_STALE (PR #550 round-2 BLOCKER 1).
    assert prefixes["0022"]["pr_state"] == "merged"
    assert prefixes["0022"]["merged_sha"] == "6cdbaa0a8"
    assert prefixes["0023"]["pr_state"] == "merged"
    assert prefixes["0023"]["merged_sha"] == "9022e0138"

    assert doc["claim_before_you_write"].strip() != ""


# --- 13 -----------------------------------------------------------------------

def test_report_prints_nulls_in_plain_words_and_is_not_vacuous():
    doc = reservations_doc(
        prefixes={
            "0015": {
                "state": "reserved",
                "file": None,
                "packet": "B-F12-3",
                "pr": None,
                "pr_state": None,
                "note": "fixture",
            },
            "0017": {
                "state": "free",
                "file": None,
                "packet": None,
                "pr": None,
                "pr_state": None,
                "note": "fixture",
            },
        }
    )
    notes = disclosures([], doc)
    report = format_report([], notes)

    assert "None" not in report
    assert "no pull request opened yet" in report
    assert "claim" in report

    empty_dir = MIGRATIONS_DIR.parent / "__does_not_exist__"
    findings, _ = collect(migrations_dir=empty_dir, reservations=RESERVATIONS_PATH)
    assert any(f.code == "MIGRATIONS_DIR_EMPTY" for f in findings)


# --- 14 (MAJOR 1 fix: drive a finding through check_all/collect, the path CI runs) ---


def test_check_all_wires_every_sub_check():
    """Directly exercises check_all() (not the individual helpers) with one
    violation from each finding category live at once. Deleting any single
    `findings.extend(...)` wiring line in check_all would drop exactly one of
    these codes from the result and fail this test -- unlike calling the
    helpers directly, this cannot go green while the wiring is broken.
    """
    filenames = ["0099_a.sql", "0099_b.sql", "0098_x.sql", "0100_y.sql"]
    texts = {"0100_y.sql": "create table foo();\n"}
    doc = reservations_doc(
        prefixes={
            "0100": {
                "state": "taken",
                "file": "0100_y.sql",
                "packet": "TEST",
                "pr": 1,
                "pr_state": "open",
                "note": "fixture",
            },
        }
    )
    findings = check_all(filenames, texts, doc)
    codes = {f.code for f in findings}
    assert "DUPLICATE_PREFIX" in codes  # 0099_a.sql / 0099_b.sql
    assert "UNRESERVED_PREFIX" in codes  # 0098_x.sql has no ledger entry
    assert "MISSING_LEDGER_ROW_HEADER" in codes  # 0100_y.sql >= floor, no header
    assert "MISSING_ROLLBACK_HEADER" in codes


def test_collect_end_to_end_over_a_synthetic_tree(tmp_path):
    """Drives collect() -- the exact function main()/CI calls -- over a
    from-scratch on-disk migrations dir + RESERVATIONS.json, proving the
    full read-files-then-check_all wiring, not just an in-memory helper call.
    Uses the previously-dead write_tree fixture.
    """
    clean_root = tmp_path / "clean"
    clean_root.mkdir()
    dup_root = tmp_path / "dup"
    dup_root.mkdir()

    # pr_state="open" is the LEGITIMATE shape here, not a stale-ledger bug: this
    # models a pull request that carries its own .sql file, which is exactly the
    # tree CI checks out for `on: pull_request`. Round 1 flipped it to "merged"
    # to dodge the then-unconditional open-while-present rule; that made the
    # fixture model a state the next migration PR can never be in (review round
    # 2, FIX-2). collect() defaults to lenient (non-master) mode, where a present
    # file with pr_state="open" is legal provided the entry is state=taken with a
    # pull-request number -- which this fixture is.
    doc = reservations_doc(
        prefixes={
            "0099": {
                "state": "taken",
                "file": "0099_a.sql",
                "packet": "TEST",
                "pr": 1,
                "pr_state": "open",
                # Explicit nulls, not absent keys (review round 3, FIX-3): a
                # migration still riding an open pull request has not been
                # applied to anything, and the ledger has to say so rather than
                # stay silent.
                "applied_in_production": None,
                "applied_date": None,
                "note": "fixture; not recorded because the pull request has not merged",
            },
        }
    )

    clean_text = "-- Ledger row: NONE: fixture\n-- Rollback: NONE: fixture\ncreate table t();\n"
    migrations_dir, reservations_path = write_tree(clean_root, {"0099_a.sql": clean_text}, doc)
    findings, _notes = collect(migrations_dir=migrations_dir, reservations=reservations_path)
    assert findings == []

    dup_migrations_dir, dup_reservations_path = write_tree(
        dup_root,
        {"0099_a.sql": clean_text, "0099_b.sql": clean_text},
        doc,
    )
    dup_findings, _ = collect(migrations_dir=dup_migrations_dir, reservations=dup_reservations_path)
    assert any(f.code == "DUPLICATE_PREFIX" for f in dup_findings)


# --- 15 (MAJOR 2 fix: header_required_from is validated and pinned) ---------


def test_missing_header_floor_is_detected():
    doc = reservations_doc(header_required_from=None)
    findings = validate_reservations(doc)
    assert any(f.code == "MISSING_HEADER_FLOOR" for f in findings)


def test_malformed_header_floor_is_detected():
    doc = reservations_doc(header_required_from="abcd")
    findings = validate_reservations(doc)
    assert any(f.code == "MISSING_HEADER_FLOOR" for f in findings)


def test_header_floor_is_pinned_to_the_expected_value():
    doc = reservations_doc(header_required_from="0020")
    findings = validate_reservations(doc)
    assert any(f.code == "HEADER_FLOOR_UNEXPECTED" for f in findings)
    assert EXPECTED_HEADER_REQUIRED_FROM == "0015"


def test_missing_header_floor_note_is_detected():
    doc = reservations_doc(header_required_note="")
    findings = validate_reservations(doc)
    assert any(f.code == "MISSING_HEADER_FLOOR_NOTE" for f in findings)


def test_disclosure_survives_a_missing_header_floor():
    """The disclosure used to vanish in the same instant header_required_from
    was removed (scripts:294-302's `if isinstance(floor, str)` guard). It now
    keys off header_required_note instead, so the nulls-printed gap note
    survives even while validate_reservations is separately failing the
    missing floor.
    """
    doc = reservations_doc(header_required_from=None)
    notes = disclosures([], doc)
    assert any("header rule starts at 0015" in n.text for n in notes)


# --- 16 (minor fix, review round 2: disclosure text tracks the real floor) ---


def test_disclosure_reflects_the_actual_header_floor_value():
    """Before this fix the printed floor was the literal string "0015",
    independent of `header_required_from` -- a later legitimate floor raise
    (with EXPECTED_HEADER_REQUIRED_FROM updated to match) would leave the
    CI-printed disclosure silently lying about where the rule actually starts.
    Pin a doc whose floor is a valid-shaped but non-default value and assert
    the disclosure names THAT value, not the old hardcoded one.
    """
    doc = reservations_doc(header_required_from="0020")
    notes = disclosures([], doc)
    text = next(n.text for n in notes if n.prefix == "*")
    assert "header rule starts at 0020" in text
    assert "0015" not in text


def test_disclosure_falls_back_to_expected_floor_when_floor_is_malformed():
    doc = reservations_doc(header_required_from="abcd")
    notes = disclosures([], doc)
    text = next(n.text for n in notes if n.prefix == "*")
    assert f"header rule starts at {EXPECTED_HEADER_REQUIRED_FROM}" in text


# --- 17 (minor fix, review round 2: validate_reservations runs even on an
# empty/wrong migrations dir) ---------------------------------------------


def test_check_all_validates_reservations_even_with_no_sql_files():
    """Before this fix, `check_all`'s empty-`filenames` branch returned before
    `validate_reservations(doc)` ran, so a checkout with no .sql files (a wrong
    path, or a genuinely empty migrations dir) reported only
    MIGRATIONS_DIR_EMPTY and hid every ledger-schema violation. A corrupt
    ledger must be visible regardless of what is on disk.
    """
    doc = reservations_doc(header_required_from=None)  # invalid: triggers MISSING_HEADER_FLOOR
    findings = check_all([], {}, doc)
    codes = {f.code for f in findings}
    assert "MIGRATIONS_DIR_EMPTY" in codes
    assert "MISSING_HEADER_FLOOR" in codes


# --- 18 (packet B-PLAT-B5-2, rule a: a present file cannot be pr_state=open) ---
#
# This is the RED-first case: on the unfixed ledger, 0014/0015/0016's .sql
# files are all present in supabase/migrations/ while RESERVATIONS.json still
# recorded pr_state="open" for all three (they merged in #514 and #527). That
# is a stale ledger telling a provable lie, and nothing above this line would
# have caught it -- check_files_are_reserved only compares filenames, never
# pr_state.


def test_open_pr_state_with_a_present_file_is_detected():
    doc = reservations_doc(
        prefixes={
            "0014": {
                "state": "taken",
                "file": "0014_tenancy_foundation.sql",
                "packet": "B-F12-1",
                "pr": 514,
                "pr_state": "open",
                "note": "fixture: stale -- file is present, PR is not still open",
            }
        }
    )
    findings = check_open_pr_state_for_present_files(
        ["0014_tenancy_foundation.sql"], doc, strict_master=True
    )
    assert any(
        f.code == "OPEN_PR_STATE_WITH_FILE_PRESENT" and f.prefix == "0014" for f in findings
    )


def test_open_pr_state_is_fine_when_the_file_is_genuinely_absent():
    doc = reservations_doc(
        prefixes={
            "0014": {
                "state": "taken",
                "file": "0014_tenancy_foundation.sql",
                "packet": "B-F12-1",
                "pr": 514,
                "pr_state": "open",
                "note": "fixture: file has not merged yet, open is correct",
            }
        }
    )
    findings = check_open_pr_state_for_present_files([], doc)
    assert findings == []


def test_pr_state_matches_file_presence_on_the_real_tree():
    """Rule (a) against the real checkout, in whichever of the THREE modes this
    run earns from its own environment.

    "A present .sql file cannot belong to a pull request the ledger still calls
    open" is only true of `master`. CI runs this suite `on: pull_request`, on a
    tree where the PR's own migration IS present and its ledger entry honestly
    says pr_state="open" -- so asserting the strict rule unconditionally would
    make the next migration pull request (0017, packet B-F13-5) unmergeable with
    a truthful ledger (review round 2, FIX-2).

    Round 3, FIX-1: lenient is no longer the whole answer for a pull request.
    When the environment proves a `pull_request` run AND carries the PR number
    (`PR_NUMBER`, wired in ci.yml), the rule that DOES hold on a PR branch is
    asserted: a present file whose row says "open" must be carried by THIS pull
    request. The mode is taken from the environment, the assertion runs in every
    one of the three modes (never a skip), and the failure message names the mode.
    """
    strict, pr_number, mode = resolve_run_mode()

    doc = load_reservations(RESERVATIONS_PATH)
    on_disk = sorted(p.name for p in MIGRATIONS_DIR.glob("*.sql"))
    findings = check_open_pr_state_for_present_files(
        on_disk, doc, strict_master=strict, pr_number=pr_number
    )
    assert findings == [], f"ran in {mode} mode\n" + format_report(findings, [])


# --- 19 (packet B-PLAT-B5-2, rule b: reserved prefixes, no gaps) -------------


def test_reservation_gap_below_highest_merged_is_detected():
    doc = reservations_doc(
        prefixes={
            "0016": {
                "state": "taken",
                "file": "0016_x.sql",
                "packet": "P",
                "pr": 1,
                "pr_state": "merged",
                "note": "fixture",
            },
            "0017": {
                "state": "reserved",
                "file": None,
                "packet": "P2",
                "pr": None,
                "pr_state": None,
                "note": "fixture",
            },
            "0019": {
                "state": "reserved",
                "file": None,
                "packet": "P3",
                "pr": None,
                "pr_state": None,
                "note": "fixture",
            },
        }
    )
    findings = check_reservation_contiguity(doc)
    assert any(f.code == "RESERVATION_GAP" and f.prefix == "0018" for f in findings)


def test_no_reservations_means_no_contiguity_findings():
    doc = reservations_doc()  # default fixture has no `reserved` entries at all
    assert check_reservation_contiguity(doc) == []


def test_reservations_are_contiguous_with_no_gap_on_the_real_tree():
    doc = load_reservations(RESERVATIONS_PATH)
    findings = check_reservation_contiguity(doc)
    assert findings == [], format_report(findings, [])


# --- 20 (packet B-PLAT-B5-2, rule c: no literal project ref in an entry) -----


def test_literal_project_ref_in_an_entry_is_detected():
    doc = reservations_doc(
        prefixes={
            "0017": {
                "state": "reserved",
                "file": None,
                "packet": "P",
                "pr": None,
                "pr_state": None,
                "note": f"receipt against {SYNTHETIC_PROJECT_REF} pending",
            }
        }
    )
    findings = check_no_literal_project_ref(doc)
    assert any(
        f.code == "LITERAL_PROJECT_REF_IN_ENTRY" and f.prefix == "0017" for f in findings
    )


def test_short_shas_do_not_false_positive_as_a_project_ref():
    doc = reservations_doc(
        prefixes={
            "0014": {
                "state": "taken",
                "file": "0014_tenancy_foundation.sql",
                "packet": "B-F12-1",
                "pr": 514,
                "pr_state": "merged",
                "note": "merged as cff58ee8d; a short sha must never trip the ref pattern",
            }
        }
    )
    assert check_no_literal_project_ref(doc) == []


def test_no_entry_contains_a_literal_project_ref_on_the_real_tree():
    doc = load_reservations(RESERVATIONS_PATH)
    findings = check_no_literal_project_ref(doc)
    assert findings == [], format_report(findings, [])


# --- 21 (wires all three packet B-PLAT-B5-2 checks through check_all) -------


def test_check_all_wires_the_ledger_truth_checks():
    """Exercises check_all() -- the path CI runs -- with one violation from
    each of the three new checks live at once, so deleting any single wiring
    line in check_all silently drops one of these from CI's output.
    """
    filenames = ["0014_x.sql"]
    texts = {
        "0014_x.sql": "-- Ledger row: NONE: fixture\n-- Rollback: NONE: fixture\ncreate table t();\n",
    }
    doc = reservations_doc(
        header_required_from="0015",
        prefixes={
            "0014": {
                "state": "taken",
                "file": "0014_x.sql",
                "packet": "P",
                "pr": 514,
                "pr_state": "open",
                "note": "fixture",
            },
            "0016": {
                "state": "taken",
                "file": "0016_x.sql",
                "packet": "P2",
                "pr": 2,
                "pr_state": "merged",
                "note": "fixture",
            },
            "0017": {
                "state": "reserved",
                "file": None,
                "packet": "P3",
                "pr": None,
                "pr_state": None,
                "note": "fixture",
            },
            "0019": {
                "state": "reserved",
                "file": None,
                "packet": "P4",
                "pr": None,
                "pr_state": None,
                "note": f"receipt against {SYNTHETIC_PROJECT_REF} pending",
            },
        },
    )
    findings = check_all(filenames, texts, doc, strict_master=True)
    codes = {f.code for f in findings}
    assert "OPEN_PR_STATE_WITH_FILE_PRESENT" in codes
    assert "RESERVATION_GAP" in codes
    assert "LITERAL_PROJECT_REF_IN_ENTRY" in codes


# --- 22 (review round 2, FIX-1: the real project ref lives in exactly one place) ---


def test_synthetic_project_ref_is_not_the_real_one():
    """Cheap, loud guard on the constant itself. If someone ever "fixes" a
    fixture by pasting the real value back into SYNTHETIC_PROJECT_REF, this
    fails immediately -- without ever printing either value.
    """
    real = load_reservations(RESERVATIONS_PATH)["project_ref"]
    assert isinstance(real, str) and len(real) == 20
    assert SYNTHETIC_PROJECT_REF != real, (
        "SYNTHETIC_PROJECT_REF must be a fake token, not the estate's real project reference"
    )
    assert len(SYNTHETIC_PROJECT_REF) == 20 and SYNTHETIC_PROJECT_REF.isalnum()
    assert SYNTHETIC_PROJECT_REF.islower()


def test_the_real_project_ref_appears_only_in_the_ledger_field():
    """The real Supabase project reference must survive in exactly ONE place in
    this tree: RESERVATIONS.json's own top-level `project_ref` field. Everywhere
    else -- the migration .sql comments, README.md, and this very test module --
    it is written `{ref}` (Terminal #538's redaction law).

    The value is read at runtime and NEVER printed: every assertion message
    below names files and counts only. A test that had to hardcode the ref in
    order to search for it would be the leak it is trying to prevent.
    """
    real = load_reservations(RESERVATIONS_PATH)["project_ref"]
    assert isinstance(real, str) and real

    offenders = []
    for path in sorted(MIGRATIONS_DIR.rglob("*")):
        if not path.is_file() or path.name == RESERVATIONS_PATH.name:
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:  # pragma: no cover - unreadable file is not a leak
            continue
        if real in text:
            offenders.append(path.name)

    assert offenders == [], (
        "these files under supabase/migrations/ spell out the literal project "
        f"reference; replace it with '{{ref}}': {offenders}"
    )

    own_source = Path(__file__).read_text(encoding="utf-8")
    assert real not in own_source, (
        "this test module's own source carries the literal project reference -- "
        "use SYNTHETIC_PROJECT_REF in fixtures instead"
    )

    ledger_text = RESERVATIONS_PATH.read_text(encoding="utf-8")
    assert ledger_text.count(real) == 1, (
        "RESERVATIONS.json must carry the project reference exactly once, in its "
        f"top-level 'project_ref' field (found {ledger_text.count(real)} occurrences)"
    )


def test_md_files_beside_the_ledger_are_scanned_for_the_literal_ref():
    """FIX-1: the guard used to inspect only the entries under `prefixes`, so a
    README.md sitting in the same directory could spell the ref out in full and
    stay green. The sibling scan compares against the ledger's OWN project_ref
    value (not the generic 20-char shape), so it cannot false-positive on prose.
    """
    doc = reservations_doc()  # project_ref is SYNTHETIC_PROJECT_REF
    leaky = {"README.md": f"the shared Supabase project ({SYNTHETIC_PROJECT_REF}).\n"}
    findings = check_no_literal_project_ref(doc, leaky)
    assert any(f.code == "LITERAL_PROJECT_REF_IN_DOC" for f in findings)
    detail = next(f.detail for f in findings if f.code == "LITERAL_PROJECT_REF_IN_DOC")
    assert "README.md" in detail
    # The finding must NAME the file, never quote the value.
    assert SYNTHETIC_PROJECT_REF not in detail

    clean = {"README.md": "the shared Supabase project (`{ref}`).\n", "OTHER.md": "nothing here\n"}
    assert check_no_literal_project_ref(doc, clean) == []


def test_real_migrations_markdown_carries_no_literal_ref():
    """Same rule, run against the real supabase/migrations/*.md on this tree."""
    doc = load_reservations(RESERVATIONS_PATH)
    md_texts = {
        p.name: p.read_text(encoding="utf-8", errors="replace")
        for p in sorted(MIGRATIONS_DIR.glob("*.md"))
    }
    assert md_texts, "expected at least one .md beside the ledger (README.md)"
    findings = check_no_literal_project_ref(doc, md_texts)
    assert findings == [], format_report(findings, [])


# --- 23 (review round 2, FIX-2: open-while-present is a MASTER-scope rule) ---


def _present_open_doc(pr=514, state="taken"):
    return reservations_doc(
        prefixes={
            "0014": {
                "state": state,
                "file": "0014_tenancy_foundation.sql",
                "packet": "B-F12-1",
                "pr": pr,
                "pr_state": "open",
                "note": "fixture: the pull request itself carries this file",
            }
        }
    )


def test_strict_fires_and_lenient_does_not_on_the_same_fixture():
    """The load-bearing FIX-2 proof: ONE fixture, two modes, opposite verdicts.

    On master, a present file whose ledger row still says pr_state="open" is a
    stale ledger (that is how 0014/0015/0016 lied). On a pull-request branch the
    same shape is the normal, honest state of the PR that introduces the file --
    the branch carries its own .sql while its PR is genuinely still open. Firing
    in both places would make every future migration PR unmergeable with a
    truthful ledger.
    """
    doc = _present_open_doc()
    files = ["0014_tenancy_foundation.sql"]

    strict = check_open_pr_state_for_present_files(files, doc, strict_master=True)
    assert any(f.code == "OPEN_PR_STATE_WITH_FILE_PRESENT" and f.prefix == "0014" for f in strict)

    lenient = check_open_pr_state_for_present_files(files, doc, strict_master=False)
    assert lenient == [], format_report(lenient, [])


def test_lenient_mode_still_requires_a_taken_entry_with_a_pr_number():
    """Lenient is not "no rule": a present file claiming pr_state="open" must be
    carried by a real, numbered pull request and be recorded state=taken. A
    reserved-but-occupied prefix, or an open state with no PR number, is still a
    finding in lenient mode -- so the mode relaxes exactly one clause and no more.
    """
    no_pr = _present_open_doc(pr=None)
    findings = check_open_pr_state_for_present_files(
        ["0014_tenancy_foundation.sql"], no_pr, strict_master=False
    )
    assert any(
        f.code == "OPEN_PR_STATE_WITHOUT_OWNING_PR" and f.prefix == "0014" for f in findings
    )

    not_taken = _present_open_doc(state="reserved")
    findings = check_open_pr_state_for_present_files(
        ["0014_tenancy_foundation.sql"], not_taken, strict_master=False
    )
    assert any(
        f.code == "OPEN_PR_STATE_WITHOUT_OWNING_PR" and f.prefix == "0014" for f in findings
    )


def test_merged_pr_state_with_an_absent_file_is_detected_in_both_modes():
    """The cheap converse, valid on every ref: pr_state="merged" means the file
    reached master, so it must be present in ANY checkout descended from master.
    Absent means the ledger is lying in the other direction -- which no check
    covered before (review round 2, FIX-2).
    """
    doc = reservations_doc(
        prefixes={
            "0013": {
                "state": "taken",
                "file": "0013_alert_runs_outbox.sql",
                "packet": "B-F08-2",
                "pr": 513,
                "pr_state": "merged",
                "note": "fixture: claims merged, but the file is not on disk",
            }
        }
    )
    for strict in (True, False):
        findings = check_open_pr_state_for_present_files([], doc, strict_master=strict)
        assert any(
            f.code == "MERGED_PR_STATE_WITH_FILE_ABSENT" and f.prefix == "0013" for f in findings
        ), f"converse check must fire in strict_master={strict} mode too"


def test_merged_pr_state_with_the_file_present_is_clean():
    doc = reservations_doc(
        prefixes={
            "0013": {
                "state": "taken",
                "file": "0013_alert_runs_outbox.sql",
                "packet": "B-F08-2",
                "pr": 513,
                "pr_state": "merged",
                "note": "fixture",
            }
        }
    )
    for strict in (True, False):
        assert check_open_pr_state_for_present_files(
            ["0013_alert_runs_outbox.sql"], doc, strict_master=strict
        ) == []


# --- 24 (review round 2, FIX-5: `released` is a real state, not a permanent red) ---


def test_released_is_a_valid_state_with_no_file():
    doc = reservations_doc(
        prefixes={
            "0017": {
                "state": "released",
                "file": None,
                "packet": "B-F13-5",
                "pr": None,
                "pr_state": None,
                "note": "fixture: pre-reservation stood down by Meta-CEO B",
            }
        }
    )
    assert validate_reservations(doc) == []


def test_released_with_a_file_is_a_schema_finding():
    """README.md's release path: the row keeps its number but the claim is stood
    down and no .sql was ever written for it. A `released` row naming a file is
    self-contradictory.
    """
    doc = reservations_doc(
        prefixes={
            "0017": {
                "state": "released",
                "file": "0017_something.sql",
                "packet": "B-F13-5",
                "pr": None,
                "pr_state": None,
                "note": "fixture",
            }
        }
    )
    findings = validate_reservations(doc)
    assert any(f.code == "RESERVATION_SCHEMA" and f.prefix == "0017" for f in findings)


def test_released_prefix_occupied_by_a_file_on_disk_is_detected():
    doc = reservations_doc(
        prefixes={
            "0017": {
                "state": "released",
                "file": None,
                "packet": "B-F13-5",
                "pr": None,
                "pr_state": None,
                "note": "fixture",
            }
        }
    )
    findings = check_files_are_reserved(["0017_someone_elses.sql"], doc)
    assert any(f.code == "RELEASED_PREFIX_OCCUPIED" and f.prefix == "0017" for f in findings)


def test_released_entry_between_reserved_ones_leaves_no_gap():
    """The FIX-5 defect in one test: README.md documents `released` as the way a
    stood-down claim is recorded in place, but VALID_STATES did not know the word
    and check_reservation_contiguity did not count it as occupying its number --
    so the README's own release path would have produced a permanent
    RESERVATION_GAP red the moment anyone used it.
    """
    def doc_with(state_0018):
        return reservations_doc(
            prefixes={
                "0016": {
                    "state": "taken",
                    "file": "0016_x.sql",
                    "packet": "P",
                    "pr": 1,
                    "pr_state": "merged",
                    "note": "fixture",
                },
                "0017": {
                    "state": "reserved",
                    "file": None,
                    "packet": "P2",
                    "pr": None,
                    "pr_state": None,
                    "note": "fixture",
                },
                "0018": {
                    "state": state_0018,
                    "file": None,
                    "packet": "P3" if state_0018 != "free" else None,
                    "pr": None,
                    "pr_state": None,
                    "note": "fixture",
                },
                "0019": {
                    "state": "reserved",
                    "file": None,
                    "packet": "P4",
                    "pr": None,
                    "pr_state": None,
                    "note": "fixture",
                },
            }
        )

    released = check_reservation_contiguity(doc_with("released"))
    assert released == [], format_report(released, [])

    # Control: the same shape with 0018 genuinely free IS a gap, so the test
    # above is proving `released` occupies the number, not that the check is dead.
    freed = check_reservation_contiguity(doc_with("free"))
    assert any(f.code == "RESERVATION_GAP" and f.prefix == "0018" for f in freed)


def test_released_disclosure_prints_no_nulls():
    doc = reservations_doc(
        prefixes={
            "0017": {
                "state": "released",
                "file": None,
                "packet": "B-F13-5",
                "pr": None,
                "pr_state": None,
                "note": "fixture",
            }
        }
    )
    report = format_report([], disclosures([], doc))
    assert "None" not in report
    assert "released" in report


# --- 25 (review round 2, FIX-7: applied-in-production fields and historical nulls) ---


def test_applied_prefixes_carry_their_application_date():
    """README.md's application table records 0012 applied 2026-09-06 and 0013
    applied 2026-09-07, but their ledger rows carried no applied_* fields at all
    while 0014-0016 did -- two documents disagreeing about the same fact.
    """
    prefixes = load_reservations(RESERVATIONS_PATH)["prefixes"]
    expected = {
        "0012": "2026-09-06",
        "0013": "2026-09-07",
        "0014": "2026-09-08",
        "0015": "2026-09-08",
    }
    for prefix, date in expected.items():
        assert prefixes[prefix]["applied_in_production"] is True, prefix
        assert prefixes[prefix]["applied_date"].startswith(date), prefix
    assert prefixes["0016"]["applied_in_production"] is True
    assert prefixes["0016"]["applied_date"].startswith("2026-09-09")


def test_historical_prefixes_carry_no_pr_state_by_design():
    """0001-0007 and 0010 predate the ledger: their creating pull requests are
    not recorded in-repo, so pr/pr_state are null on purpose (null, not
    unknown-and-guessed). Pinning that here stops a later "tidy-up" from
    inventing PR numbers for them.
    """
    prefixes = load_reservations(RESERVATIONS_PATH)["prefixes"]
    for prefix in ("0001", "0002", "0003", "0004", "0005", "0006", "0007", "0010"):
        assert prefixes[prefix]["state"] == "historical", prefix
        assert prefixes[prefix]["pr"] is None, prefix
        assert prefixes[prefix]["pr_state"] is None, prefix


# --- 26 (review round 3, FIX-1: the acceptance must fire in a configuration CI
#          actually reaches) ------------------------------------------------------
#
# Round 2 left the one enforcement rule this packet exists for -- "a prefix whose
# .sql is present cannot still be recorded pr_state='open'" -- reachable only from
# `strict_master`, which is earned only from a push to master. No workflow in this
# repository has an `on: push` trigger (.github/workflows/ci.yml is pull_request +
# workflow_dispatch), so the rule fired in NO configuration CI can reach, and
# replaying the exact 0014-shaped staleness this packet corrected produced zero
# findings under the mode that actually runs.
#
# The fix is a third mode. On a proven `pull_request` run the branch legitimately
# carries its OWN migration with an open row -- but only its own. Any other
# present file whose row says "open" is stale: the file is here, so either that PR
# merged (and the row was never flipped, which is exactly how 0014/0015/0016 lied)
# or this branch is carrying a file it does not own.


def _pr_branch_doc(entry_pr=514):
    """A present 0017 whose row claims an open pull request numbered `entry_pr`."""
    return reservations_doc(
        prefixes={
            "0017": {
                "state": "taken",
                "file": "0017_personal_accuracy_ledger.sql",
                "packet": "B-F13-5",
                "pr": entry_pr,
                "pr_state": "open",
                "note": "fixture: the .sql is on this branch and the row claims an open PR",
                "applied_in_production": None,
                "applied_date": None,
            }
        }
    )


PR_BRANCH_FILES = ["0017_personal_accuracy_ledger.sql"]


def test_pull_request_mode_flags_a_present_open_entry_owned_by_another_pr():
    """The staleness this packet exists to prevent, caught in the mode CI runs.

    0017's .sql is present on this branch and its row says "open, pr 514" while
    the run is pull request 9999. The file being here means #514 merged (row
    never flipped) or this branch carries a file it does not own -- both are the
    ledger lying, and both were invisible to round 2's lenient rule, which asked
    only for state='taken' and an integer pr.
    """
    findings = check_open_pr_state_for_present_files(
        PR_BRANCH_FILES, _pr_branch_doc(entry_pr=514), strict_master=False, pr_number=9999
    )
    assert any(
        f.code == "OPEN_PR_STATE_STALE" and f.prefix == "0017" for f in findings
    ), format_report(findings, [])
    # The PR numbers are the evidence; the detail must carry both so the CI log
    # says which claim is stale without the reader opening the ledger.
    detail = next(f.detail for f in findings if f.code == "OPEN_PR_STATE_STALE")
    assert "514" in detail and "9999" in detail


def test_pull_request_mode_clears_the_entry_that_names_this_pull_request():
    """The converse, and the reason the mode cannot simply be strict: the PR that
    INTRODUCES a migration carries its own .sql with an honest "open" row, and
    must stay mergeable. Same fixture, same file, same rule -- only the number of
    the running pull request differs.
    """
    findings = check_open_pr_state_for_present_files(
        PR_BRANCH_FILES, _pr_branch_doc(entry_pr=514), strict_master=False, pr_number=514
    )
    assert findings == [], format_report(findings, [])


def test_strict_still_fires_on_the_same_pull_request_fixture():
    """Master scope is unchanged by round 3: on master a present file with an
    "open" row is stale no matter which PR number is passed, because on master
    there is no running pull request that could legitimately own it.
    """
    for pr_number in (None, 514, 9999):
        findings = check_open_pr_state_for_present_files(
            PR_BRANCH_FILES, _pr_branch_doc(entry_pr=514), strict_master=True, pr_number=pr_number
        )
        assert any(
            f.code == "OPEN_PR_STATE_WITH_FILE_PRESENT" and f.prefix == "0017" for f in findings
        ), f"strict must fire regardless of pr_number={pr_number!r}"


def test_no_env_default_keeps_the_round_two_lenient_behaviour():
    """A local run with no CI environment proves nothing about scope, so it keeps
    round 2's rule set exactly: a present "open" row is accepted when it is
    state='taken' with a real PR number, and rejected otherwise. Round 3 adds a
    mode; it does not change this one.
    """
    clean = check_open_pr_state_for_present_files(
        PR_BRANCH_FILES, _pr_branch_doc(entry_pr=514), strict_master=False, pr_number=None
    )
    assert clean == [], format_report(clean, [])

    no_pr = check_open_pr_state_for_present_files(
        PR_BRANCH_FILES, _pr_branch_doc(entry_pr=None), strict_master=False, pr_number=None
    )
    assert any(f.code == "OPEN_PR_STATE_WITHOUT_OWNING_PR" and f.prefix == "0017" for f in no_pr)


def test_pull_request_number_is_read_only_from_a_proven_pull_request_event():
    """Both halves of the proof are required. An event name alone, a bare
    PR_NUMBER alone, or an unparseable number all read as "not proven" and fall
    back to the lenient default rather than inventing a scope.
    """
    assert pull_request_number({"GITHUB_EVENT_NAME": "pull_request", "PR_NUMBER": "543"}) == 543
    assert pull_request_number({"GITHUB_EVENT_NAME": "pull_request", "PR_NUMBER": " 543 "}) == 543
    assert pull_request_number({"GITHUB_EVENT_NAME": "pull_request"}) is None
    assert pull_request_number({"GITHUB_EVENT_NAME": "pull_request", "PR_NUMBER": ""}) is None
    assert pull_request_number({"GITHUB_EVENT_NAME": "pull_request", "PR_NUMBER": "abc"}) is None
    assert pull_request_number({"PR_NUMBER": "543"}) is None
    assert pull_request_number({"GITHUB_EVENT_NAME": "push", "PR_NUMBER": "543"}) is None
    assert pull_request_number({}) is None


def test_resolve_run_mode_names_each_of_the_three_modes():
    """Whichever mode a run earns, it must be printable -- the reader of a CI log
    must never have to guess which rule set produced the report.
    """
    strict, pr, mode = resolve_run_mode({"GITHUB_EVENT_NAME": "push", "GITHUB_REF_NAME": "master"})
    assert (strict, pr) == (True, None)
    assert "STRICT" in mode

    strict, pr, mode = resolve_run_mode({"GITHUB_EVENT_NAME": "pull_request", "PR_NUMBER": "543"})
    assert (strict, pr) == (False, 543)
    assert "PULL_REQUEST" in mode and "543" in mode

    strict, pr, mode = resolve_run_mode({})
    assert (strict, pr) == (False, None)
    assert "LENIENT" in mode

    # A pull_request event whose PR_NUMBER never arrived is lenient, but says so
    # rather than passing itself off as an ordinary local run.
    strict, pr, mode = resolve_run_mode({"GITHUB_EVENT_NAME": "pull_request"})
    assert (strict, pr) == (False, None)
    assert "LENIENT" in mode and "PR_NUMBER" in mode

    # --strict forces master scope for a local dry run.
    strict, pr, mode = resolve_run_mode({}, force_strict=True)
    assert (strict, pr) == (True, None)
    assert "STRICT" in mode


def test_check_all_carries_the_pull_request_number_through():
    """The mode has to survive the call path CI actually drives (check_all), not
    just the leaf function -- the round-2 finding was precisely that a rule can
    be correct in isolation and unreachable in practice.
    """
    doc = _pr_branch_doc(entry_pr=514)
    texts = {"0017_personal_accuracy_ledger.sql": "-- Ledger row: 0017\n-- Rollback: NONE: fixture\n"}

    stale = check_all(PR_BRANCH_FILES, texts, doc, pr_number=9999)
    assert any(f.code == "OPEN_PR_STATE_STALE" for f in stale), format_report(stale, [])

    owned = check_all(PR_BRANCH_FILES, texts, doc, pr_number=514)
    assert [f.code for f in owned if f.code.startswith("OPEN_PR_STATE")] == [], format_report(owned, [])


def test_ci_wires_the_pull_request_number_into_the_pytest_step():
    """The mode is only reachable if the workflow hands the number to pytest.

    Parsed as YAML rather than grepped so a commented-out or heredoc `env:` block
    cannot be misread as the real thing (the same reasoning as
    tests/test_merge_on_green.py's permission guard).
    """
    # Imported here rather than at module scope so this module keeps its lean
    # stdlib-only import set, and imported HARD rather than via importorskip:
    # ci.yml installs pyyaml explicitly (tests/test_merge_on_green.py hard-imports
    # it too), and a silent skip here would be a wiring test that quietly stopped
    # testing the wiring -- the exact failure mode this round is fixing.
    import yaml

    workflow_path = Path(__file__).resolve().parents[1] / ".github" / "workflows" / "ci.yml"
    workflow = yaml.safe_load(workflow_path.read_text(encoding="utf-8"))

    steps = workflow["jobs"]["python"]["steps"]
    pytest_steps = [s for s in steps if isinstance(s.get("run"), str) and "pytest tests/" in s["run"]]
    assert pytest_steps, "the python job must still run the whole tests/ suite"

    for step in pytest_steps:
        assert step.get("env", {}).get("PR_NUMBER") == (
            "${{ github.event.pull_request.number || inputs.pr_number }}"
        ), (
            "the pytest step must pass the running pull request's number through as PR_NUMBER -- "
            "from the pull_request event, or from the workflow_dispatch input merge-on-green "
            "fills in -- or the pull-request mode of the namespace guard can never engage"
        )
        # Nothing else, and no new authority: the guard needs one number, not a token.
        assert set(step["env"]) == {"PR_NUMBER"}, step["env"]

    # `on:` parses to the YAML boolean True under safe_load (the "Norway problem"
    # for `on`), so read it that way rather than by the string key.
    triggers = workflow.get(True, workflow.get("on"))
    dispatch = triggers["workflow_dispatch"]
    assert isinstance(dispatch, dict), (
        "workflow_dispatch must declare the pr_number input, or the run merge-on-green orders "
        "for a refreshed head has no way to learn which pull request it is proving "
        "(round 4, MAJOR 2)"
    )
    pr_input = dispatch["inputs"]["pr_number"]
    assert pr_input.get("type") == "string", pr_input
    assert pr_input.get("required") is not True, (
        "the input must stay optional -- a hand-run dispatch that omits it is LENIENT, not broken"
    )
    assert pr_input.get("default", "") == "", pr_input

    assert workflow.get("permissions") == {"contents": "read"}, (
        "rounds 3 and 4 must not widen candidate-CI authority"
    )


# --- 27 (review round 3, FIX-2: project_ref is a validated top-level key) -----
#
# `check_no_literal_project_ref` gates the whole sibling-*.md redaction scan on
# `if _non_empty_str(real_ref):` with no else. Delete or blank the key and that
# scan silently disables itself while the guard still prints "0 findings" -- the
# identical silent-disable that was a MAJOR for `header_required_from` in round 2
# and is recorded in this module's own comments. So the key is validated.


def test_missing_project_ref_is_detected():
    doc = reservations_doc()
    del doc["project_ref"]
    findings = validate_reservations(doc)
    assert any(f.code == "PROJECT_REF_MISSING" for f in findings), format_report(findings, [])


def test_blank_project_ref_is_detected():
    for blank in ("", "   ", None):
        findings = validate_reservations(reservations_doc(project_ref=blank))
        assert any(f.code == "PROJECT_REF_MISSING" for f in findings), repr(blank)


def test_malformed_project_ref_is_detected():
    """A mangled ref disables the sibling scan as thoroughly as a deleted one --
    it just compares against a value nothing will ever match. The shape is fixed
    (20 lowercase alphanumerics), so it can be checked without knowing the value.
    """
    for bad in ("TOOSHORT", "ZZZZSYNTHETICREF0000", "zzzzsyntheticref0000x", "{ref}"):
        findings = validate_reservations(reservations_doc(project_ref=bad))
        assert any(f.code == "PROJECT_REF_MALFORMED" for f in findings), bad


def test_no_finding_ever_prints_the_project_ref_value():
    """The details go straight into CI logs, so they name the field, never the
    token -- including the malformed case, where the bad value is right there.
    """
    bad = "zzzzsyntheticref0000x"
    for finding in validate_reservations(reservations_doc(project_ref=bad)):
        assert bad not in finding.detail
        assert SYNTHETIC_PROJECT_REF not in finding.detail


def test_the_real_ledger_declares_a_well_formed_project_ref():
    """Proved on the real ledger without ever printing the value: the validator
    is silent about project_ref, which it can only be if the key is present,
    non-empty and correctly shaped.
    """
    doc = load_reservations(RESERVATIONS_PATH)
    codes = {f.code for f in validate_reservations(doc)}
    assert "PROJECT_REF_MISSING" not in codes
    assert "PROJECT_REF_MALFORMED" not in codes


# --- 28 (review round 3, FIX-3: "records whether it is applied in production") ---
#
# The frozen acceptance has two halves. The second one -- the ledger records
# whether each migration is applied in production -- was true of 0012-0016 and of
# nothing else: 0001-0011 carried no applied_* keys at all, and the only
# assertions were hardcoded pins over 0012-0016, so 0017+ could merge recording
# nothing. Presence is now required for every prefix whose .sql is on the tree.
# Presence, not truth: an honest `null` with a note is a legitimate value, and is
# the only legitimate value where the README records no fact to copy.


def _applied_doc(**entry_overrides):
    entry = {
        "state": "taken",
        "file": "0013_alert_runs_outbox.sql",
        "packet": "B-F08-2",
        "pr": 513,
        "pr_state": "merged",
        "note": "fixture",
    }
    entry.update(entry_overrides)
    return reservations_doc(prefixes={"0013": entry})


def test_present_entry_without_applied_fields_is_detected():
    findings = check_applied_fields_for_present_files(["0013_alert_runs_outbox.sql"], _applied_doc())
    assert any(
        f.code == "APPLIED_FIELDS_MISSING" and f.prefix == "0013" for f in findings
    ), format_report(findings, [])
    detail = next(f.detail for f in findings if f.code == "APPLIED_FIELDS_MISSING")
    assert "applied_in_production" in detail and "applied_date" in detail


def test_a_half_filled_entry_is_still_detected():
    """Recording the flag without the date (or the reverse) is a partial record,
    which is what "records whether it is applied" is not.
    """
    for partial in ({"applied_in_production": True}, {"applied_date": "2026-09-07"}):
        findings = check_applied_fields_for_present_files(
            ["0013_alert_runs_outbox.sql"], _applied_doc(**partial)
        )
        assert any(f.code == "APPLIED_FIELDS_MISSING" for f in findings), partial


def test_explicit_null_applied_fields_are_clean():
    """The honest-nulls law: where the README records no application fact, an
    explicit null plus a note is the correct entry, and must pass. Guessing a
    date to satisfy a required key would be the worse failure.
    """
    doc = _applied_doc(
        applied_in_production=None,
        applied_date=None,
        note="not recorded before the ledger; null, never guessed",
    )
    assert check_applied_fields_for_present_files(["0013_alert_runs_outbox.sql"], doc) == []


def test_recorded_applied_fields_are_clean():
    doc = _applied_doc(applied_in_production=True, applied_date="2026-09-07")
    assert check_applied_fields_for_present_files(["0013_alert_runs_outbox.sql"], doc) == []


def test_an_absent_file_needs_no_applied_fields():
    """The join direction is unchanged: on-disk file -> ledger entry. A reserved
    or unmerged prefix has nothing applied and must not be asked to say so.
    """
    assert check_applied_fields_for_present_files([], _applied_doc()) == []


def test_check_all_wires_the_applied_fields_check():
    doc = _applied_doc()
    texts = {"0013_alert_runs_outbox.sql": "-- fixture\n"}
    findings = check_all(["0013_alert_runs_outbox.sql"], texts, doc)
    assert any(f.code == "APPLIED_FIELDS_MISSING" for f in findings), format_report(findings, [])


def test_every_present_prefix_records_its_application_status_on_the_real_tree():
    """The acceptance, on the real ledger: every .sql in this checkout has a row
    that answers "applied in production?" one way or the other.
    """
    doc = load_reservations(RESERVATIONS_PATH)
    on_disk = sorted(p.name for p in MIGRATIONS_DIR.glob("*.sql"))
    findings = check_applied_fields_for_present_files(on_disk, doc)
    assert findings == [], format_report(findings, [])

    prefixes = doc["prefixes"]
    for name in on_disk:
        prefix = parse_prefix(name)
        entry = prefixes[prefix]
        assert entry["applied_in_production"] in (True, False, None), prefix
        assert entry["applied_date"] is None or isinstance(entry["applied_date"], str), prefix
        # A null is only honest when the row says why it is null.
        if entry["applied_in_production"] is None or entry["applied_date"] is None:
            assert "not recorded" in entry["note"], prefix


# --- 30 (review round 4, MAJOR 1: the applied fields must agree with each other)
#
# Round 3 required the two `applied_*` keys to be PRESENT. The body then claimed
# more than the code carried -- "a half-filled entry (flag without date, or the
# reverse) is also a finding" -- which was true only when a key was absent
# entirely. `applied_in_production: true` beside `applied_date: null` passed
# unexamined, which is the exact shape 0001-0007 ship in. The rule the body
# claimed now exists, and it is the rule that keeps 0001-0007 legitimate: the
# combination is fine when the row SAYS why the date is missing.


def test_applied_true_with_a_null_date_and_no_note_is_half_filled():
    doc = _applied_doc(applied_in_production=True, applied_date=None, note="")
    findings = check_applied_fields_for_present_files(["0013_alert_runs_outbox.sql"], doc)
    assert any(
        f.code == "APPLIED_FIELDS_HALF_FILLED" and f.prefix == "0013" for f in findings
    ), format_report(findings, [])

    # A missing note field, not merely a blank one, is the same defect.
    doc = _applied_doc(applied_in_production=True, applied_date=None)
    del doc["prefixes"]["0013"]["note"]
    findings = check_applied_fields_for_present_files(["0013_alert_runs_outbox.sql"], doc)
    assert any(f.code == "APPLIED_FIELDS_HALF_FILLED" for f in findings), format_report(findings, [])


def test_an_applied_date_without_a_true_flag_is_half_filled():
    """The other direction: a date is the record of an application that happened.
    Carrying one while the flag says false, or says nothing, is a row that
    contradicts itself, and no note reconciles it.
    """
    for flag in (False, None):
        doc = _applied_doc(
            applied_in_production=flag,
            applied_date="2026-09-07",
            note="a note cannot make a date and a not-applied flag agree",
        )
        findings = check_applied_fields_for_present_files(["0013_alert_runs_outbox.sql"], doc)
        assert any(
            f.code == "APPLIED_FIELDS_HALF_FILLED" for f in findings
        ), f"{flag!r}: {format_report(findings, [])}"


def test_the_0001_0007_shape_true_date_null_with_a_note_stays_clean():
    """The legitimate half-filled row, which the new rule must NOT break:
    README.md's application table records 0001-0007 as in production and records
    no date, so the honest entry is true + null + a note saying why. Guessing a
    date to satisfy the rule would be strictly worse than the gap it fills.
    """
    doc = _applied_doc(
        applied_in_production=True,
        applied_date=None,
        note=(
            "predates the reservation law; applied in production per README.md's application "
            "table, which records no date (null, not recorded, never guessed)"
        ),
    )
    assert check_applied_fields_for_present_files(["0013_alert_runs_outbox.sql"], doc) == []


def test_check_all_wires_the_half_filled_rule():
    doc = _applied_doc(applied_in_production=True, applied_date=None, note="")
    texts = {"0013_alert_runs_outbox.sql": "-- fixture\n"}
    findings = check_all(["0013_alert_runs_outbox.sql"], texts, doc)
    assert any(f.code == "APPLIED_FIELDS_HALF_FILLED" for f in findings), format_report(findings, [])


def test_the_real_0001_0007_rows_are_clean_under_the_half_filled_rule():
    """The acceptance on the real ledger: the seven rows the body points at as the
    legitimate shape produce no finding, and every other present prefix is clean
    too.
    """
    doc = load_reservations(RESERVATIONS_PATH)
    on_disk = sorted(p.name for p in MIGRATIONS_DIR.glob("*.sql"))

    historical = [n for n in on_disk if (parse_prefix(n) or "") in
                  {"0001", "0002", "0003", "0004", "0005", "0006", "0007"}]
    assert historical, "0001-0007 must be present in this checkout for this test to mean anything"
    for name in historical:
        entry = doc["prefixes"][parse_prefix(name)]
        assert entry["applied_in_production"] is True and entry["applied_date"] is None, name
        assert isinstance(entry["note"], str) and entry["note"].strip(), name

    findings = check_applied_fields_for_present_files(on_disk, doc)
    assert [f for f in findings if f.code == "APPLIED_FIELDS_HALF_FILLED"] == [], format_report(
        findings, []
    )


# --- 31 (review round 4, MAJOR 2: the dispatched run that actually gates a
#         refreshed head must be able to earn PULL_REQUEST mode) ---------------
#
# scripts/merge_on_green.py refreshes a stale branch with GITHUB_TOKEN and then
# dispatches ci.yml, because a token-authored branch update fires no recursive
# pull_request workflow. That dispatched run is therefore the ONLY CI run for the
# sha that then merges -- and on a workflow_dispatch
# `github.event.pull_request.number` is empty, so the guard fell to LENIENT on
# exactly the gating run. ci.yml now carries a `pr_number` input, merge-on-green
# passes it, and the resolver accepts it.


def test_workflow_dispatch_with_a_pr_number_earns_pull_request_mode():
    strict, pr, mode = resolve_run_mode(
        {"GITHUB_EVENT_NAME": "workflow_dispatch", "PR_NUMBER": "543"}
    )
    assert (strict, pr) == (False, 543)
    assert "PULL_REQUEST" in mode and "543" in mode
    assert pull_request_number({"GITHUB_EVENT_NAME": "workflow_dispatch", "PR_NUMBER": "543"}) == 543


def test_workflow_dispatch_without_a_pr_number_stays_lenient_and_says_so():
    """A hand-run dispatch is not broken, it is unproven -- and the mode line has
    to name that case specifically, so a reader of a CI log is never left thinking
    the pull-request rule ran when it did not.
    """
    for env in (
        {"GITHUB_EVENT_NAME": "workflow_dispatch"},
        {"GITHUB_EVENT_NAME": "workflow_dispatch", "PR_NUMBER": ""},
        {"GITHUB_EVENT_NAME": "workflow_dispatch", "PR_NUMBER": "   "},
        {"GITHUB_EVENT_NAME": "workflow_dispatch", "PR_NUMBER": "not-a-number"},
    ):
        strict, pr, mode = resolve_run_mode(env)
        assert (strict, pr) == (False, None), env
        assert "LENIENT" in mode and "workflow_dispatch" in mode and "PR_NUMBER" in mode, mode
        assert pull_request_number(env) is None, env


def test_pr_number_zero_is_not_a_pull_request():
    """`${{ github.event.pull_request.number || inputs.pr_number }}` renders an
    unset number as an empty string, but a hand-typed 0 must not be mistaken for a
    pull request either: no pull request is #0.
    """
    for event in ("pull_request", "workflow_dispatch"):
        env = {"GITHUB_EVENT_NAME": event, "PR_NUMBER": "0"}
        assert pull_request_number(env) is None, event
        strict, pr, mode = resolve_run_mode(env)
        assert (strict, pr) == (False, None) and "LENIENT" in mode, event


def test_a_dispatch_number_still_cannot_forge_master_scope():
    """PULL_REQUEST is not STRICT. The dispatch path widens which runs can assert
    the rule; it must not widen WHICH rule they assert.
    """
    strict, pr, mode = resolve_run_mode(
        {"GITHUB_EVENT_NAME": "workflow_dispatch", "PR_NUMBER": "543", "GITHUB_REF_NAME": "master"}
    )
    assert strict is False and pr == 543 and "STRICT" not in mode


# --- 32 (review round 4, MAJOR 3: the redaction scan must see .sql bodies) ----
#
# The exact-value scan was handed only the sibling *.md texts, so the one file
# class this very pull request had to hand-redact -- the migration .sql bodies --
# was the surface the new control could not see. `texts` was already in hand at
# the call site.


def test_sql_bodies_are_scanned_for_the_literal_ref():
    doc = reservations_doc()  # project_ref is SYNTHETIC_PROJECT_REF
    leaky = {"0099_leaky.sql": f"-- project {SYNTHETIC_PROJECT_REF}\nSELECT 1;\n"}
    findings = check_no_literal_project_ref(doc, None, leaky)
    assert any(f.code == "LITERAL_PROJECT_REF_IN_DOC" for f in findings), format_report(findings, [])
    detail = next(f.detail for f in findings if f.code == "LITERAL_PROJECT_REF_IN_DOC")
    assert "0099_leaky.sql" in detail
    assert SYNTHETIC_PROJECT_REF not in detail  # names the file, never the token

    clean = {"0099_leaky.sql": "-- project {ref}\nSELECT 1;\n"}
    assert check_no_literal_project_ref(doc, None, clean) == []


def test_collect_catches_the_real_ref_planted_in_a_sql_body(tmp_path):
    """The wiring, end to end, against the value that actually matters.

    The ref is read from the real ledger at runtime, written into a throwaway .sql
    under pytest's tmp_path, and compared programmatically. It is never printed:
    no assertion message, no finding detail and no report line carries it, which
    this test also checks.
    """
    real = load_reservations(RESERVATIONS_PATH)["project_ref"]
    (tmp_path / "0099_leaky_fixture.sql").write_text(
        f"-- Ledger row: 0099\n-- project {real}\nSELECT 1;\n", encoding="utf-8"
    )

    findings, notes = collect(migrations_dir=tmp_path, reservations=RESERVATIONS_PATH)
    leaks = [f for f in findings if f.code == "LITERAL_PROJECT_REF_IN_DOC"]
    assert leaks, "a .sql spelling the project ref out in full must be a finding"
    assert any("0099_leaky_fixture.sql" in f.detail for f in leaks)
    assert all(real not in f.detail for f in findings)
    assert real not in format_report(findings, notes)


def test_real_migration_sql_bodies_carry_no_literal_ref():
    """Same rule, run against the real supabase/migrations/*.sql on this tree --
    the two files this pull request hand-redacted included.
    """
    doc = load_reservations(RESERVATIONS_PATH)
    sql_texts = {
        p.name: p.read_text(encoding="utf-8", errors="replace")
        for p in sorted(MIGRATIONS_DIR.glob("*.sql"))
    }
    assert sql_texts, "no .sql files found -- a wrong path would make this vacuously pass"
    findings = check_no_literal_project_ref(doc, None, sql_texts)
    assert findings == [], sorted({f.prefix for f in findings})
