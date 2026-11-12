"""Typed saved-scenario INPUT/REFERENCE-ONLY canonical persistence + explicit sharing,
against isolated PostgreSQL.

Runs the REAL 0021 + 0028 + 0040 + 0041 migrations plus the repaired
``*_investigation_scenario_capture.sql`` migration (located by glob under the canonical
migrations directory -- an absent or ambiguous file is a FAILURE, never a skip; the
MMX_SCENARIO_MIGRATION_FILE environment variable names an explicit candidate artifact for
isolated verification on a host whose working tree does not yet carry the installed file),
then drives the scenario handoff boundary the way the pinned-handoff harness does. The new
migration is applied twice, proving re-runnability with no ledger assumptions.

The harness, fixture helpers and boundary helpers are REUSED from
``tests/test_pinned_research_handoff_postgres.py`` by import -- no second PostgreSQL manager or
framework is created. A host without the PostgreSQL binaries is reported as skipped, never as
a pass. No production users, credentials or services are touched; every seeded claim lives only
in the disposable fixture cluster.

Contract under test (INPUT/REFERENCE-ONLY repair): the manifest's scenario_capture field
carries exactly {schema:'investigation_scenario_reference.v1',
model_version:'exposure-scenario/v1', inputs, source} -- value-free input and source-pointer
metadata ONLY. No basis, no result, no derived value of any kind is ever stored, validated or
disclosed. Every fixture digest/byte length below is untrusted, unfixed metadata: the tests
never pretend a referenced object is retained, that a private destination exists, or that any
entitlement follows from a share. Source references are unresolved metadata; actual
source-resolution refusing `unavailable` until a qualified backend exists is native-owned and
is NOT asserted here.

Discriminated here: actual owner/grantee/unrelated/anon roles; direct INSERT forgery with and
without a capture; old false pins never disclosing anything scenario-shaped; explicit true pins
returning the exact typed reference and nothing else; future own revisions never moving a pin;
the old false <-> true share conflict both directions; revoked/removed/restore semantics;
terminal revocation; the immutable flag; the revoked_at-only column UPDATE grant; same-UUID
watchlist isolation and the preserved legacy policies; cursors and pagination bounds
untouched; malformed/forged/unknown/superseded-full-value manifest and reference refusals --
both at the direct pure validator and through the real apply RPC and the read RPC; nested
basis/result/statistics keys added anywhere in a closed capture refused; an unknown source
clock staying an explicit null (never fabricated); null vs present moves retained truthfully;
and the old native lifecycle still saving and reopening the exact reference through the real
0028 apply RPC -- not just manual INSERTs.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
from uuid import uuid4

import pytest

# Repo-root resolution: the installed location (a file inside the repository's tests/ directory)
# derives everything from its own path. An isolated host run can point MMX_SCENARIO_REPO_ROOT
# at a working tree of the exact base revision; MMX_SCENARIO_REPO_TESTS overrides the tests
# directory used to import the existing harness. No second harness is ever created.
ROOT = Path(os.environ.get("MMX_SCENARIO_REPO_ROOT")
            or Path(__file__).resolve().parents[1])
_here = Path(os.environ.get("MMX_SCENARIO_REPO_TESTS")
             or Path(__file__).resolve().parent)
if str(_here) not in sys.path:
    sys.path.insert(0, str(_here))

import test_pinned_research_handoff_postgres as base  # noqa: E402  (existing harness, by import)

M0040 = ROOT / "supabase/migrations/0040_investigation_review.sql"
MIGRATIONS = base.PREVIOUS + (M0040, base.SQL)
PORT = 55490

A, B, C = base.A, base.B, base.C
I1, I2, I3, J1, W1 = base.I1, base.I2, base.I3, base.J1, base.W1
SUMMARY_KEYS = base.SUMMARY_KEYS
READ_BASE_KEYS = {"schema", "grant_id", "investigation_id", "revision", "shared_by",
                  "committed_at", "intent", "continuation"}
PACKET_ROW = "b-f12-scenario-canonical-reference-repair-01a128b7-20261023-v1"
REF_SCHEMA = "investigation_scenario_reference.v1"

# Untrusted metadata constants. They are syntactically valid digests and NOTHING more: no test
# treats them as a retention proof, a storage key or an entitlement.
BASIS_SHA = "11" * 32
GEX_SHA = "22" * 32
MOVES_SHA = "33" * 32

# Full-value tokens from the superseded draft. They may never appear in any admitted capture,
# any validator admission or any DTO at any surface.
FULL_VALUE_TOKENS = ('"basis"', '"result"', "totalMn", "movePct", "moveFraction",
                     "referenceSpot", "gexMn", "vexMn", "cexMn", "emPct",
                     '"terms"', '"missing"', '"qualification"')


# ---------------------------------------------------------------- reference fixtures
def scenario_reference(*, source_as_of=None, root="SPX", session="2026-10-16",
                       evaluated_at="2026-10-16T14:30:00+02:00", lens=None,
                       selection_key=None, target_spot=600, delta_sigma_pts=-1, days=0.25,
                       moves=None, gex_bytes=1234567, owner="options_hub",
                       model_version="exposure-scenario/v1"):
    """A value-free typed reference: inputs plus owner-qualified source pointers, digests,
    byte lengths and captured clocks. It is unresolved metadata -- never a rights,
    retention or availability claim."""
    return {
        "schema": REF_SCHEMA,
        "model_version": model_version,
        "inputs": {"targetSpot": target_spot, "deltaSigmaPts": delta_sigma_pts, "days": days},
        "source": {
            "owner": owner,
            "root": root,
            "session": session,
            "source_as_of": source_as_of,
            "evaluated_at": evaluated_at,
            "lens": lens if lens is not None else {"kind": "all"},
            "selection_key": selection_key if selection_key is not None
            else "2026-10-16|2026-10-16T20:00:00Z",
            "basis_sha256": BASIS_SHA,
            "gex": {"sha256": GEX_SHA, "byte_length": gex_bytes},
            "moves": moves,
        },
    }


def _selection(n):
    import datetime
    d0 = datetime.date(2027, 1, 1)
    return ",".join((d0 + datetime.timedelta(days=i)).isoformat()
                    + "|" + (d0 + datetime.timedelta(days=i)).isoformat() + "T20:00:00Z"
                    for i in range(n))


# The canonical 128-pair bound, exactly at the limit.
REF_128 = scenario_reference(selection_key=_selection(128))

# The superseded FULL-VALUE capture. This shape is refused everywhere; it exists in this file
# ONLY as a negative probe. No assertion anywhere prints its numbers as a proof of anything.
OLD_FULL_VALUE = {
    "schema": "investigation_scenario_capture.v1",
    "model_version": "exposure-scenario/v1",
    "source_as_of": None,
    "basis": {"root": "SPX", "session": "2026-10-16", "referenceSpot": 600.24,
              "gexMn": -1383, "vexMn": 220, "cexMn": -80, "emPct": None,
              "qualification": "qualified", "sourceRef": None},
    "inputs": {"targetSpot": 600, "deltaSigmaPts": -1, "days": 0.25},
    "result": {"ok": True, "version": "exposure-scenario/v1", "moveFraction": -0.000399,
               "movePct": -0.0399, "inputs": {"targetSpot": 600, "deltaSigmaPts": -1,
                                              "days": 0.25},
               "terms": {"spotMn": -55.29, "volMn": 220.0, "timeMn": 20.0},
               "totalMn": 184.70, "joint": False, "missing": []},
}

REF1 = scenario_reference()                      # unknown clock (null) + null moves
REF2 = scenario_reference(source_as_of="2026-10-15", session="2026-10-15",
                          evaluated_at="2026-10-15T21:30:00+02:00",
                          lens={"kind": "one", "exp": "2026-10-16"})
REF3 = scenario_reference(session="2026-10-14", evaluated_at="2026-10-14T18:00:00Z",
                          selection_key="2026-12-18|2026-12-18T21:00:00Z",
                          target_spot=603, delta_sigma_pts=1.0, days=2.5,
                          moves={"sha256": MOVES_SHA, "byte_length": 4096})


def scenario_manifest(title, capture, question="Why did the scenario hold?"):
    body = {"schema": "investigation_manifest.v2",
            "intent": {"title": title, "question": question, "subjects": [base.SUBJECT]},
            "layout_refs": [], "thesis_refs": [], "evidence_refs": [], "continuation": {}}
    if capture is not None:
        body["scenario_capture"] = capture
    return body


PLAIN_MANIFEST = {"schema": "investigation_manifest.v2",
                  "intent": {"title": "Plain revision", "question": "No capture here?",
                             "subjects": [base.SUBJECT]},
                  "layout_refs": [], "thesis_refs": [], "evidence_refs": [],
                  "continuation": {}}


def _locate_migration():
    override = os.environ.get("MMX_SCENARIO_MIGRATION_FILE")
    if override:
        return [Path(override)]
    migrations = ROOT / "supabase/migrations"
    found = sorted({c for pattern in ("*_investigation_scenario_capture.sql",
                                      "*_investigation_scenario_reference.sql")
                    for c in migrations.glob(pattern)})
    return found


def _seed_world(run):
    """Seed through the real 0028 lifecycle RPCs only -- the canonical save path, never manual
    manifest INSERTs -- so the widened validator is proven through the native save/reopen.
    (The second RPC argument is the expected CURRENT revision; the applied revision is +1.)"""
    seed = [
        (I1, 0, "create", scenario_manifest("Scenario pinned", REF1), A),
        (I1, 1, "revise", PLAIN_MANIFEST, A),
        (I1, 2, "revise", scenario_manifest("Scenario re-pinned", REF3), A),
        (I2, 0, "create", scenario_manifest("Moves scenario", REF3), A),
        (I3, 0, "create", scenario_manifest("Probe scenario", REF2), A),
        (J1, 0, "create", scenario_manifest("Grantee own", None), B),
    ]
    for investigation_id, current, action, body, who in seed:
        run("select public.apply_investigation_revision_v2(" + base.quote(investigation_id)
            + "::uuid," + str(current) + ",'" + action + "'," + base.quote(str(uuid4()))
            + "::uuid," + base.manifest_like(body) + ");", who=who)


@pytest.fixture(scope="module")
def pg(tmp_path_factory):
    candidates = _locate_migration()
    assert candidates, ("no scenario capture migration found under supabase/migrations "
                        "(or via MMX_SCENARIO_MIGRATION_FILE)")
    assert len(candidates) == 1, f"exactly one scenario capture migration may exist: {candidates}"
    migration = candidates[0]
    run, data, socket_root = base._spawn_postgres(tmp_path_factory, "scenario-pg", PORT)
    try:
        base._bootstrap_base_schema(run)
        files = MIGRATIONS + (migration,)
        for sql_file in files:
            run(sql_file.read_text())
        for sql_file in files:  # real rerun, no ledger assumptions
            run(sql_file.read_text())
        _seed_world(run)
        run.socket_path = str(socket_root.name)
        yield run
    finally:
        subprocess.run(["pg_ctl", "-D", str(data), "-m", "fast", "-w", "stop"],
                       check=True, capture_output=True)
        socket_root.cleanup()


# ---------------------------------------------------------------- boundary helpers
def share_scenario(pg, inv=I1, revision=1, grantee=B, who=A, check=True):
    return base.rpc(pg, "public.create_investigation_scenario_handoff_v1(" + base.quote(inv)
                    + "::uuid," + str(revision) + "," + base.quote(grantee) + "::uuid)",
                    who, check=check)


def read(pg, grant_id, who=B, check=True):
    return base.read_handoff(pg, grant_id, who, check=check)


def revoke(pg, grant_id, who=A, check=True):
    return base.revoke_handoff(pg, grant_id, who, check=check)


def scenario_grant_ids(pg, owner=A):
    return json.loads(pg("select coalesce(json_agg(id),'[]'::json) from public.resource_grants"
                         " where granted_by='" + owner + "' and resource_kind='investigation'"
                         " and include_scenario and revoked_at is null;"))


def apply_revision(pg, inv, expected_current, action, body, who=A):
    """Through the real 0028 RPC. A refusal may surface as a status payload or as a bare SQL
    error at the jsonb boundary; both are reported as not-committed here."""
    result = pg("select public.apply_investigation_revision_v2(" + base.quote(inv) + "::uuid,"
                + str(expected_current) + ",'" + action + "'," + base.quote(str(uuid4()))
                + "::uuid," + base.manifest_like(body) + ");", who, check=False)
    if result.returncode != 0:
        return {"status": "error"}
    return json.loads(result.stdout)


def validator(pg, body):
    # A bare boolean renders as t/f over psql, so this is a string compare, not json.loads.
    # The predicate is exercised in the superuser/definer context in which production always
    # evaluates it: like the 0028 manifest validator, it calls the 0028 private helpers, whose
    # EXECUTE is definer-only by design, and the validator's own caller-facing EXECUTE is
    # revoked (the ACL readback below pins that). Structural admission here is NOT authority:
    # no retained object, entitlement or availability follows from a 't'.
    return pg("select public.valid_investigation_scenario_reference_v1("
              + base.manifest_like(body) + "::jsonb);") == "t"


def head_revision(pg, inv):
    return int(pg("select current_revision from public.investigations where id='" + inv + "';"))


def tampered(mutate):
    body = json.loads(json.dumps(REF1))
    mutate(body)
    return body


# ---------------------------------------------------------------- file-surface contract
def test_migration_file_is_present_unique_and_honestly_headed():
    candidates = _locate_migration()
    assert candidates, ("the canonical scenario capture migration is missing: install the "
                        "artifact under supabase/migrations or set MMX_SCENARIO_MIGRATION_FILE")
    assert len(candidates) == 1, f"exactly one scenario capture migration may exist: {candidates}"
    text = candidates[0].read_text()
    header = text[:4000]
    assert "UNAPPLIED" in header, "the ledger row must record the file as UNAPPLIED"
    assert PACKET_ROW in header, "packet row must be recorded"
    assert "MO-PAID-052" in header
    assert "readback:" in text and "\n-- down:" in text
    assert "PR #" not in header, "no PR number may be claimed by a worker artifact"
    # The admitted discriminator is the reference schema, and the pure validator is the
    # reference one -- the superseded full-value validator name survives nowhere.
    assert REF_SCHEMA in text
    assert "valid_investigation_scenario_reference_v1" in text
    assert "valid_investigation_scenario_capture_v1" not in text
    # The superseded full-value discriminator may appear ONLY once, as a refusal probe in the
    # readback block -- never as an admitted schema.
    occurrences = [line for line in text.splitlines()
                   if "investigation_scenario_capture.v1" in line]
    assert len(occurrences) == 1 and "refuses_superseded" in occurrences[0]
    # No value or math surface anywhere in the SQL: no stored basis/result field names, no
    # arithmetic re-derivation, no qualification success. The one exception is precision, not
    # slack: the readback's refusal probe may name the value key exactly once, on the probe
    # line that proves it is refused -- the same discipline as the superseded discriminator.
    for token in FULL_VALUE_TOKENS:
        if token == '"result"':
            lines = [line for line in text.splitlines() if token in line]
            assert len(lines) == 1 and "refuses_added_result_value" in lines[0], token
        else:
            assert token not in text, token
    assert "begin;" in text and "commit;" in text


# ---------------------------------------------------------------- share boundary
def test_scenario_rpc_rejects_plain_revision_without_prior_grant_or_residual_conflict(pg):
    base.reset_live_grants(pg)
    assert not base.live_grants(pg)
    assert share_scenario(pg, revision=2) == {"status": "not_found"}
    assert not base.live_grants(pg) and not scenario_grant_ids(pg)
    ordinary = base.share(pg, revision=2)
    assert ordinary["status"] == "created" and "scenario_included" not in ordinary["handoff"]
    base.reset_live_grants(pg)


def test_scenario_share_echo_is_exact_and_plain_pin_convergence_conflicts(pg):
    base.reset_live_grants(pg)
    created = share_scenario(pg)
    assert created["status"] == "created"
    echo = created["handoff"]
    assert set(echo) == SUMMARY_KEYS | {"scenario_included"}
    assert echo["scenario_included"] is True
    assert (echo["investigation_id"], echo["revision"], echo["title"],
            echo["shared_by"], echo["grantee_user_id"]) == (I1, 1, "Scenario pinned", A, B)
    again = share_scenario(pg)
    assert again["status"] == "already_shared" and again["handoff"] == echo
    # A live scenario pin is a DIFFERENT projection: the plain create must conflict on the same
    # revision, never silently return (or silently downgrade) it.
    assert base.share(pg, revision=1)["status"] == "share_conflict"
    assert share_scenario(pg, revision=2)["status"] == "not_found"  # plain revision refuses before convergence
    base.reset_live_grants(pg)
    plain = base.share(pg, revision=1)
    assert plain["status"] == "created"
    assert set(plain["handoff"]) == SUMMARY_KEYS and "scenario_included" not in plain["handoff"]
    # ...and the mirror: a scenario create over a live plain pin conflicts as well.
    assert share_scenario(pg, revision=1)["status"] == "share_conflict"
    base.reset_live_grants(pg)
    assert not base.live_grants(pg) and not scenario_grant_ids(pg)


def test_scenario_share_roles_grants_and_forgery_are_closed(pg):
    base.reset_live_grants(pg)
    # Claimless authenticated session, anon and service_role never reach the new RPC.
    assert share_scenario(pg, who=None)["status"] == "unauthenticated"
    for who, role in ((None, "anon"), (None, "service_role")):
        denied = pg("select public.create_investigation_scenario_handoff_v1('" + I1
                    + "'::uuid,1,'" + B + "'::uuid);", who, role=role, check=False)
        assert denied.returncode != 0 and "permission denied" in denied.stderr, role
    # Same closed status set as the plain create for every fallible input.
    for payload in ({"revision": 0}, {"revision": -1}, {"grantee": A}, {"grantee": None}):
        assert share_scenario(pg, **payload)["status"] == "invalid_payload", payload
    assert share_scenario(pg, grantee="99999999-0000-4000-8000-000000000009")["status"] == "not_found"
    assert share_scenario(pg, inv=J1)["status"] == "not_found"  # B's aggregate, not A's
    assert share_scenario(pg, inv=str(uuid4()))["status"] == "not_found"
    assert share_scenario(pg, revision=99)["status"] == "not_found"
    assert share_scenario(pg, inv=I1, who=B, grantee=C)["status"] == "not_found"
    # Direct INSERT forgery at the table boundary: the amended policy demands a valid
    # reference-bearing owned pinned revision exactly when include_scenario is true. Passing
    # that check is structural only -- it never certifies the source.
    def attempt(body, who=A):
        return pg("insert into public.resource_grants(resource_kind,resource_id,"
                  "resource_revision,include_scenario,grantee_user_id,granted_by) values "
                  + body + ";", who, check=False)
    allowed = attempt("('investigation','" + I1 + "',1,true,'" + B + "','" + A + "')")
    assert allowed.returncode == 0, allowed.stderr  # the one legitimate shape
    for body in ("('investigation','" + I1 + "',2,true,'" + B + "','" + A + "')",   # plain revision
                 "('investigation','" + I1 + "',99,true,'" + B + "','" + A + "')",  # forged pin
                 "('investigation','" + J1 + "',1,true,'" + B + "','" + A + "')",  # foreign aggregate
                 "('investigation','" + I1 + "',1,true,'" + C + "','" + B + "')",  # B shares A's work
                 "('investigation','" + I1 + "',1,true,'" + A + "','" + A + "')",  # self share
                 "('watchlist','" + W1 + "',null,true,'" + B + "','" + A + "')",   # true on watchlist
                 "('investigation','" + I1 + "',1,'maybe','" + B + "','" + A + "')"):
        denied = attempt(body)
        assert denied.returncode != 0, body
    # ...and the plain false path keeps every 0041 denial exactly.
    for body in ("('investigation','" + I1 + "',1,false,'" + C + "','" + B + "')",
                 "('watchlist','" + I1 + "',null,false,'" + B + "','" + A + "')"):
        denied = attempt(body)
        assert denied.returncode != 0, body
    base.reset_live_grants(pg)


def test_plain_pins_never_disclose_capture(pg):
    base.reset_live_grants(pg)
    grant_id = base.share(pg, revision=1)["handoff"]["grant_id"]  # pinned revision HAS a reference
    found = read(pg, grant_id)
    assert found["status"] == "found"
    handoff = found["handoff"]
    assert set(handoff) == READ_BASE_KEYS, "a plain grant never returns the scenario field"
    blob = json.dumps(found)
    assert "scenario_capture" not in blob and "scenario_included" not in blob
    assert "basis_sha256" not in blob, "a plain pin discloses not even the reference metadata"
    listing = base.listing(pg, A)
    assert all(set(item) == SUMMARY_KEYS for item in listing["sent"])
    assert all("scenario_included" not in item for item in listing["sent"])
    received = base.listing(pg, B)
    assert all(set(item) == SUMMARY_KEYS for item in received["received"])
    base.reset_live_grants(pg)


# ---------------------------------------------------------------- opted-in read
def test_opted_in_pin_returns_the_exact_typed_reference(pg):
    base.reset_live_grants(pg)
    grant_id = share_scenario(pg, revision=1)["handoff"]["grant_id"]
    found = read(pg, grant_id)
    assert found["status"] == "found"
    handoff = found["handoff"]
    assert set(handoff) == READ_BASE_KEYS | {"scenario_capture"}
    assert (handoff["grant_id"], handoff["investigation_id"], handoff["revision"],
            handoff["shared_by"]) == (grant_id, I1, 1, A)
    # Exact typed round trip: the reference is byte-identical metadata, the unknown source
    # clock stays an explicit null and the null moves stay null (never substituted).
    assert handoff["scenario_capture"] == REF1
    assert handoff["scenario_capture"]["source"]["source_as_of"] is None
    assert handoff["scenario_capture"]["source"]["moves"] is None
    blob = json.dumps(found)
    # A found read establishes reference METADATA only. No value-bearing field of the
    # superseded draft appears anywhere, and nothing outside the fixed DTO appears at all.
    for forbidden in ("layout_refs", "evidence_refs", "thesis_refs", "subjects",
                      "review_baseline_ref", "current_revision", '"lifecycle"', "AAPL"):
        assert forbidden not in blob, forbidden
    for token in FULL_VALUE_TOKENS:
        assert token not in blob, token
    assert "basis_sha256" in blob, "the read returns the reference metadata, and only it"
    # The list projects ONLY the flag on the summary -- never the reference, never a digest.
    sent = base.listing(pg, A)["sent"]
    mine = [item for item in sent if item["grant_id"] == grant_id]
    assert mine and set(mine[0]) == SUMMARY_KEYS | {"scenario_included"}
    assert mine[0]["scenario_included"] is True
    assert "basis_sha256" not in json.dumps(base.listing(pg, A))
    assert "basis_sha256" not in json.dumps(base.listing(pg, B))
    base.reset_live_grants(pg)


def test_pin_reads_the_pinned_revision_and_future_revisions_never_move_it(pg):
    base.reset_live_grants(pg)
    grant_id = share_scenario(pg, revision=1)["handoff"]["grant_id"]
    before = read(pg, grant_id)
    revised = apply_revision(pg, I1, head_revision(pg, I1), "revise",
                             scenario_manifest("Head moved on", REF2))
    assert revised["status"] == "committed" and revised["revision"] == head_revision(pg, I1)
    after = read(pg, grant_id)
    assert after == before, "a later owner revision never moves the pin"
    assert after["handoff"]["scenario_capture"] == REF1
    assert after["handoff"]["revision"] == 1
    # The current head's own reference is a different grant's business: C pins the head (B
    # still holds the rev-1 pin; 0021's live uniqueness allows one grantee per aggregate).
    head = head_revision(pg, I1)
    other = share_scenario(pg, revision=head, grantee=C)["handoff"]["grant_id"]
    head_read = read(pg, other, who=C)
    assert head_read["handoff"]["revision"] == head
    assert head_read["handoff"]["scenario_capture"] == REF2
    base.reset_live_grants(pg)


def test_source_clock_is_retained_never_normalized_never_fabricated(pg):
    base.reset_live_grants(pg)
    zoned = share_scenario(pg, inv=I3, revision=1)["handoff"]["grant_id"]
    found = read(pg, zoned)
    capture = found["handoff"]["scenario_capture"]
    assert capture["source"]["source_as_of"] == "2026-10-15", "date source clock retained unnormalized"
    assert capture["source"]["evaluated_at"] == "2026-10-15T21:30:00+02:00", "zoned, retained"
    assert capture["source"]["session"] == "2026-10-15"
    assert capture["source"]["lens"] == {"kind": "one", "exp": "2026-10-16"}
    moves_row = share_scenario(pg, inv=I2, revision=1)["handoff"]["grant_id"]
    moves_capture = read(pg, moves_row)["handoff"]["scenario_capture"]
    assert moves_capture["source"]["moves"] == {"sha256": MOVES_SHA, "byte_length": 4096}, \
        "present moves retained exactly"
    null_capture = read(pg, share_scenario(pg, revision=1)["handoff"]["grant_id"])[
        "handoff"]["scenario_capture"]
    assert "source_as_of" in null_capture["source"] and null_capture["source"]["source_as_of"] is None
    assert null_capture["source"]["moves"] is None, "an explicit null is a retained truth"
    assert "committed_at" in json.dumps(found) + json.dumps(read(pg, moves_row))
    base.reset_live_grants(pg)


# ---------------------------------------------------------------- revoke / remove / restore
def test_revoke_removed_source_restore_and_terminal_revocation(pg):
    base.reset_live_grants(pg)
    grant_id = share_scenario(pg, inv=I3, revision=1)["handoff"]["grant_id"]
    assert read(pg, grant_id)["status"] == "found"
    removed = apply_revision(pg, I3, head_revision(pg, I3), "remove",
                             scenario_manifest("Probe scenario", REF2))
    assert removed["status"] == "committed" and removed["lifecycle"] == "removed"
    assert read(pg, grant_id)["status"] == "not_found"  # removed source is the common not_found
    mine = [item for item in base.listing(pg, A)["sent"] if item["grant_id"] == grant_id]
    assert mine and mine[0]["scenario_included"] is True  # owner keeps an explicit revoke control
    assert base.listing(pg, B)["received"] == []
    restored = apply_revision(pg, I3, head_revision(pg, I3), "restore",
                              scenario_manifest("Probe scenario", REF2))
    assert restored["status"] == "committed"
    revived = read(pg, grant_id)
    assert revived["status"] == "found" and revived["handoff"]["revision"] == 1
    assert revived["handoff"]["scenario_capture"] == REF2
    assert revoke(pg, grant_id)["status"] == "revoked"
    assert read(pg, grant_id)["status"] == "not_found"
    # Revocation is terminal: restoring the source never revives a revoked grant, and a fresh
    # scenario share of the restored revision is a NEW grant, exactly as 0021 treats withdrawals.
    assert revoke(pg, grant_id)["status"] == "revoked"
    fresh = share_scenario(pg, inv=I3, revision=head_revision(pg, I3))
    assert fresh["status"] == "created" and fresh["handoff"]["grant_id"] != grant_id
    assert revoke(pg, fresh["handoff"]["grant_id"])["status"] == "revoked"
    denied = pg("update public.resource_grants set revoked_at=null where id='" + grant_id + "';",
                check=False)
    assert denied.returncode != 0 and "a withdrawn share cannot be changed" in denied.stderr
    base.reset_live_grants(pg)
    assert not base.live_grants(pg) and not scenario_grant_ids(pg)


def test_read_requires_an_explicit_live_opted_in_grant_to_the_caller(pg):
    base.reset_live_grants(pg)
    mine = share_scenario(pg)["handoff"]["grant_id"]
    other = share_scenario(pg, grantee=C)["handoff"]["grant_id"]
    assert read(pg, mine, C)["status"] == "not_found"
    assert read(pg, other, B)["status"] == "not_found"
    assert read(pg, mine, A)["status"] == "not_found"  # grantee-only; the owner uses 0028
    assert read(pg, str(uuid4()))["status"] == "not_found"
    assert read(pg, None)["status"] == "not_found"
    assert read(pg, mine, who=None)["status"] == "unauthenticated"
    base.reset_live_grants(pg)


# ---------------------------------------------------------------- immutability + ACL
def test_include_scenario_is_immutable_and_update_grant_stays_revoked_only(pg):
    base.reset_live_grants(pg)
    grant_id = share_scenario(pg)["handoff"]["grant_id"]
    plain_id = base.share(pg, revision=1, grantee=C)["handoff"]["grant_id"]
    assert pg("select has_column_privilege('authenticated','public.resource_grants',"
              "'include_scenario','UPDATE');") == "f"
    assert pg("select has_column_privilege('authenticated','public.resource_grants',"
              "'revoked_at','UPDATE');") == "t"
    denied = pg("update public.resource_grants set include_scenario=false where id='" + grant_id
                + "';", A, check=False)
    assert denied.returncode != 0 and "permission denied" in denied.stderr
    flip = pg("update public.resource_grants set include_scenario=false where id='" + grant_id
              + "';", check=False)
    assert flip.returncode != 0 and "a share record cannot be re-pointed" in flip.stderr
    upgrade = pg("update public.resource_grants set include_scenario=true where id='" + plain_id
                 + "';", check=False)
    assert upgrade.returncode != 0 and "a share record cannot be re-pointed" in upgrade.stderr
    base.reset_live_grants(pg)


def test_watchlist_isolation_and_legacy_surface_are_preserved(pg):
    base.reset_live_grants(pg)
    policies = json.loads(pg("select coalesce(json_agg(q order by q),'[]'::json) from (select"
                             " jsonb_build_object('name',policyname,'cmd',cmd) q from pg_policies"
                             " where schemaname='public' and tablename='resource_grants') q2;"))
    assert {p["name"] for p in policies} == {
        "resource_grants_select_party", "resource_grants_revoke_owner",
        "resource_grants_insert_owner", "resource_grants_insert_investigation_owner"}
    checks = pg("select coalesce(string_agg(conname,' ' order by conname),'') from"
                " pg_constraint where conrelid='public.resource_grants'::regclass and"
                " contype='c';")
    for constraint in ("resource_grants_not_self", "resource_grants_resource_kind_check",
                       "resource_grants_revision_matches_kind",
                       "resource_grants_scenario_matches_kind"):
        assert constraint in checks, constraint
    # The watchlist-only policy text carries no investigation and no scenario clause.
    legacy = pg("select with_check from pg_policies where policyname='resource_grants_insert_owner';")
    assert "resource_kind = 'watchlist'" in legacy and "scenario" not in legacy
    # A watchlist row keeps include_scenario=false and the whole 0021 surface keeps working.
    pg("insert into public.resource_grants(resource_kind,resource_id,grantee_user_id,granted_by)"
       " values ('watchlist','" + W1 + "','" + B + "','" + A + "');", A)
    assert pg("select include_scenario from public.resource_grants where resource_kind='watchlist'"
              " and resource_id='" + W1 + "' and revoked_at is null limit 1;") == "f"
    assert pg("select count(*) from public.watchlists where id='" + W1 + "';", B) == "1"
    assert pg("select count(*) from public.watchlist_symbols where symbol='AAPL';", B) == "1"
    assert pg("select count(*) from public.watchlists;", C) == "0"
    # The same aggregate UUID never bridges the two kinds: a scenario pin on I1 discloses
    # nothing about any watchlist row.
    grant_id = share_scenario(pg)["handoff"]["grant_id"]
    assert "AAPL" not in json.dumps(read(pg, grant_id))
    base.reset_live_grants(pg)


# ---------------------------------------------------------------- refusals
def test_pure_validator_refuses_malformed_forged_and_unknown_values(pg):
    assert validator(pg, REF1) is True
    assert validator(pg, REF2) is True
    assert validator(pg, REF3) is True
    assert validator(pg, REF_128) is True
    for lens in ({"kind": "all"}, {"kind": "zero"}, {"kind": "next-live"}, {"kind": "week"}):
        assert validator(pg, tampered(lambda b, g=lens: b["source"].__setitem__("lens", g))) is True, lens
    # Same expiry, strictly later economic instant: still strictly ascending.
    assert validator(pg, tampered(lambda b: b["source"].__setitem__(
        "selection_key",
        "2026-10-16|2026-10-16T16:00:00Z,2026-10-16|2026-10-16T20:00:00Z"))) is True
    # The superseded FULL-VALUE capture is refused by the reference validator outright.
    assert validator(pg, OLD_FULL_VALUE) is False
    # Value-bearing or bookkeeping keys added ANYWHERE in the closed shape are refused -- the
    # probes carry empty objects on purpose: the shape, not their content, is what is tested.
    assert validator(pg, tampered(lambda b: b.__setitem__("result", {}))) is False
    assert validator(pg, tampered(lambda b: b.__setitem__("basis", {}))) is False
    assert validator(pg, tampered(lambda b: b.__setitem__("statistics", {}))) is False
    assert validator(pg, tampered(lambda b: b["source"].__setitem__("basis", {}))) is False
    assert validator(pg, tampered(lambda b: b["source"].__setitem__("result", {}))) is False
    assert validator(pg, tampered(lambda b: b["inputs"].__setitem__("basis", {}))) is False
    assert validator(pg, tampered(lambda b: b.__setitem__("extra", 1))) is False
    assert validator(pg, tampered(lambda b: b["source"].__setitem__("unknown", 1))) is False
    # Discriminators and owner.
    assert validator(pg, tampered(lambda b: b.__setitem__("schema", "investigation_scenario_capture.v1"))) is False
    assert validator(pg, tampered(lambda b: b.__setitem__("schema", REF_SCHEMA + ".v2"))) is False
    assert validator(pg, tampered(lambda b: b.__setitem__("model_version", "exposure-scenario/v2"))) is False
    assert validator(pg, tampered(lambda b: b["source"].__setitem__("owner", "elsewhere"))) is False
    # Root text shape.
    for bad_root in ("", "   SPX", "X" * 129, "SP\nX", "SP\tX"):
        assert validator(pg, tampered(lambda b, r=bad_root: b["source"].__setitem__("root", r))) is False, bad_root
    # Calendars and clocks.
    for bad in ("2026-02-30", "2026-13-01", "not-a-date", "", 12345):
        assert validator(pg, tampered(lambda b, v=bad: b["source"].__setitem__("session", v))) is False, bad
    for bad in ("2026-10-16T14:30:00", "2026-10-16T24:00:00Z", "2026-10-16 14:30:00",
                "2026-10-16T14:30:00+02", "2026-10-16T14:30:00+99:00", "not-a-time"):
        assert validator(pg, tampered(lambda b, v=bad: b["source"].__setitem__("evaluated_at", v))) is False, bad
    assert validator(pg, tampered(lambda b: b["source"].__setitem__(
        "evaluated_at", "2026-10-15T21:30:00+02:00"))) is False, "evaluation before session"
    assert validator(pg, tampered(lambda b: b.__setitem__(
        "inputs", {**b["inputs"], "days": 6}))) is False, "absurd bound probe guard"
    # Clock order: a known source_as_of can never be future to the evaluation.
    assert validator(pg, tampered(lambda b: b["source"].__setitem__("source_as_of", "2026-10-17"))) is False
    assert validator(pg, tampered(lambda b: b["source"].__setitem__(
        "source_as_of", "2026-10-16T18:00:00+02:00"))) is False, "reversed zoned clocks"
    for good in ("2026-10-15", "2026-10-15T00:30:00-04:00"):
        assert validator(pg, tampered(lambda b, g=good: b["source"].__setitem__("source_as_of", g))) is True, good
    # Lens/selection consistency.
    assert validator(pg, tampered(lambda b: b["source"].__setitem__(
        "lens", {"kind": "one", "exp": "2026-12-18"}))) is False, "one must select its expiry"
    assert validator(pg, tampered(lambda b: b["source"].__setitem__(
        "lens", {"kind": "all", "exp": "2026-10-16"}))) is False, "no extra exp on other kinds"
    assert validator(pg, tampered(lambda b: b["source"].__setitem__(
        "lens", {"kind": "one"}))) is False, "one without exp"
    assert validator(pg, tampered(lambda b: b["source"].__setitem__(
        "lens", {"kind": "fortnight"}))) is False, "unknown kind"
    # Selection canonical form: bounds, grammar, ascent, no URIs or key material.
    assert validator(pg, tampered(lambda b: b["source"].__setitem__("selection_key", ""))) is False
    assert validator(pg, tampered(lambda b: b["source"].__setitem__("selection_key", _selection(129)))) is False
    assert validator(pg, tampered(lambda b: b["source"].__setitem__(
        "selection_key", "2026-10-18|2026-10-18T20:00:00Z,2026-10-16|2026-10-16T20:00:00Z"))) is False
    assert validator(pg, tampered(lambda b: b["source"].__setitem__(
        "selection_key", "2026-10-16|2026-10-16T20:00:00Z,2026-10-16|2026-10-16T20:00:00Z"))) is False
    assert validator(pg, tampered(lambda b: b["source"].__setitem__(
        "selection_key", "s3://bucket/exposure/2026-10-16"))) is False
    assert validator(pg, tampered(lambda b: b["source"].__setitem__(
        "selection_key", "2026-10-16|2026-10-16T20:00:00Z,"))) is False
    assert validator(pg, tampered(lambda b: b["source"].__setitem__(
        "selection_key", "2026-10-16|2026-10-16T20:00:00"))) is False, "naive economic instant"
    assert validator(pg, tampered(lambda b: b["source"].__setitem__(
        "selection_key", "2026-10-15|2026-10-15T20:00:00Z"))) is False, "expiry before session"
    # Digests and descriptor bounds.
    for bad_digest in ("A" * 64, "11", "11" * 31 + "g", ""):
        assert validator(pg, tampered(lambda b, d=bad_digest: b["source"].__setitem__("basis_sha256", d))) is False, bad_digest
    assert validator(pg, tampered(lambda b: b["source"]["gex"].__setitem__("byte_length", 0))) is False
    assert validator(pg, tampered(lambda b: b["source"]["gex"].__setitem__("byte_length", -1))) is False
    assert validator(pg, tampered(lambda b: b["source"]["gex"].__setitem__("byte_length", 8 * 1024 * 1024 + 1))) is False
    assert validator(pg, tampered(lambda b: b["source"]["gex"].__setitem__("byte_length", 1.5))) is False
    assert validator(pg, tampered(lambda b: b["source"]["gex"].__setitem__("byte_length", True))) is False
    assert validator(pg, tampered(lambda b: b["source"]["gex"].__setitem__("byte_length", "1234567"))) is False
    assert validator(pg, tampered(lambda b: b["source"].__setitem__(
        "moves", {"sha256": MOVES_SHA, "byte_length": 1024 * 1024 + 1}))) is False
    assert validator(pg, tampered(lambda b: b["source"].__setitem__(
        "moves", {"sha256": MOVES_SHA}))) is False, "moves descriptor closed keys"
    # moves present-but-null is the retained truth; the ABSENT key is refused.
    absent_moves = json.loads(json.dumps(REF1))
    absent_moves["source"].pop("moves")
    assert validator(pg, absent_moves) is False
    absent_clock = json.loads(json.dumps(REF1))
    absent_clock["source"].pop("source_as_of")
    assert validator(pg, absent_clock) is False
    # Wrong types at every level, booleans never numbers, strings never coerced.
    for path in (["schema"], ["model_version"], ["inputs"], ["source"]):
        def break_type(b, p=path):
            walker = b
            for key in p[:-1]:
                walker = walker[key]
            walker[p[-1]] = 7
        assert validator(pg, tampered(break_type)) is False, path
    assert validator(pg, tampered(lambda b: b["inputs"].__setitem__("targetSpot", True))) is False
    assert validator(pg, tampered(lambda b: b["inputs"].__setitem__("targetSpot", "600"))) is False
    assert validator(pg, tampered(lambda b: b["inputs"].__setitem__("targetSpot", 0))) is False
    assert validator(pg, tampered(lambda b: b["inputs"].__setitem__("targetSpot", -5))) is False
    assert validator(pg, tampered(lambda b: b["inputs"].__setitem__("deltaSigmaPts", 5.5))) is False
    assert validator(pg, tampered(lambda b: b["inputs"].__setitem__("deltaSigmaPts", -5.5))) is False
    assert validator(pg, tampered(lambda b: b["inputs"].__setitem__("days", -0.5))) is False
    assert validator(pg, tampered(lambda b: b["inputs"].__setitem__("days", 5.5))) is False
    # Direct EXECUTE is revoked: an authenticated session cannot even probe the predicate.
    denied = pg("select public.valid_investigation_scenario_reference_v1("
                + base.manifest_like(REF1) + "::jsonb);", who=B, check=False)
    assert denied.returncode != 0 and "permission denied" in denied.stderr


def test_manifest_boundary_refuses_captures_and_nan_never_commits(pg):
    base.reset_live_grants(pg)
    before = int(pg("select count(*) from public.investigation_revisions;"))
    # A v1 manifest may never carry the reference.
    v1 = dict(PLAIN_MANIFEST, schema="investigation_manifest.v1")
    refused = apply_revision(pg, I1, head_revision(pg, I1), "revise", {**v1, "scenario_capture": REF1})
    assert refused["status"] != "committed"
    # The superseded full-value capture is refused at the manifest boundary.
    refused = apply_revision(pg, I1, head_revision(pg, I1), "revise",
                             scenario_manifest("Superseded shape", OLD_FULL_VALUE))
    assert refused["status"] != "committed"
    # A structurally invalid reference (a zero byte length) is not committed either.
    bad_length = json.loads(json.dumps(REF1))
    bad_length["source"]["gex"]["byte_length"] = 0
    refused = apply_revision(pg, I1, head_revision(pg, I1), "revise",
                             scenario_manifest("Bad descriptor", bad_length))
    assert refused["status"] != "committed"
    # An out-of-order capture is refused.
    reversed_clock = json.loads(json.dumps(REF1))
    reversed_clock["source"]["source_as_of"] = "2026-10-17"
    refused = apply_revision(pg, I1, head_revision(pg, I1), "revise",
                             scenario_manifest("Reversed clock", reversed_clock))
    assert refused["status"] != "committed"
    # A plain manifest without a capture still saves: the widening is purely additive.
    committed = apply_revision(pg, I1, head_revision(pg, I1), "revise", PLAIN_MANIFEST)
    assert committed["status"] == "committed"
    assert int(pg("select count(*) from public.investigation_revisions;")) == before + 1
    # NaN is not JSON: it fails at the psql/jsonb boundary itself, before any validator runs.
    dumped = json.dumps(scenario_manifest("NaN", REF1))
    exact = '"targetSpot": ' + repr(REF1["inputs"]["targetSpot"])
    assert exact in dumped
    raw = pg("select public.apply_investigation_revision_v2(" + base.quote(I1) + "::uuid,"
             + str(head_revision(pg, I1)) + ",'revise'," + base.quote(str(uuid4())) + "::uuid,'"
             + dumped.replace(exact, '"targetSpot":NaN').replace("'", "''") + "'::jsonb);",
             A, check=False)
    assert raw.returncode != 0
    assert int(pg("select count(*) from public.investigation_revisions;")) == before + 1
    base.reset_live_grants(pg)


def test_invalid_or_missing_stored_capture_reads_unavailable_not_empty(pg):
    definition = pg("select pg_get_functiondef('public.valid_investigation_manifest_v2(jsonb)'"
                    "::regprocedure);")
    # The privileged stand-in keeps the real function's language and volatility: PostgreSQL
    # refuses a CREATE OR REPLACE that would change them, so the swap must not attempt it.
    pg("create or replace function public.valid_investigation_manifest_v2(m jsonb) returns"
       " boolean language plpgsql immutable as $$ begin return true; end $$;")
    try:
        # Privileged fixtures only: stored manifests the real constraint would never have
        # admitted, plus opted-in grants over them. The validator is restored below.
        pg("insert into public.investigation_revisions(investigation_id,user_id,revision,action,"
           "lifecycle,manifest,committed_at) values ('" + I1 + "','" + A + "',97,'revise',"
           "'active'," + base.manifest_like(PLAIN_MANIFEST) + ",now());")
        invalid = json.loads(json.dumps(REF1))
        invalid["source"]["gex"]["byte_length"] = 0
        pg("insert into public.investigation_revisions(investigation_id,user_id,revision,action,"
           "lifecycle,manifest,committed_at) values ('" + I1 + "','" + A + "',98,'revise',"
           "'active'," + base.manifest_like(scenario_manifest("Tampered storage", invalid))
           + ",now());")
        pg("insert into public.resource_grants(resource_kind,resource_id,resource_revision,"
           "include_scenario,grantee_user_id,granted_by) values ('investigation','" + I1
           + "',97,true,'" + B + "','" + A + "');")
        pg("insert into public.resource_grants(resource_kind,resource_id,resource_revision,"
           "include_scenario,grantee_user_id,granted_by) values ('investigation','" + I1
           + "',98,true,'" + C + "','" + A + "');")
        missing_id = pg("select id from public.resource_grants where resource_revision=97;")
        tampered_id = pg("select id from public.resource_grants where resource_revision=98;")
        answer = read(pg, missing_id, check=False)
        assert answer.returncode == 0
        assert json.loads(answer.stdout)["status"] == "unavailable", \
            "missing reference: unavailable, never an empty success"
        answer = read(pg, tampered_id, who=C, check=False)
        assert answer.returncode == 0
        assert json.loads(answer.stdout)["status"] == "unavailable", \
            "invalid stored reference: unavailable, never a coerced value"
    finally:
        pg(definition)
    assert pg("select pg_get_functiondef('public.valid_investigation_manifest_v2(jsonb)'"
              "::regprocedure);") == definition, "the manifest validator must be restored exactly"
    # The invalid row now sits behind the restored validator: the read stays closed, and the
    # apply RPC refuses the same shape again for new revisions.
    answer = read(pg, tampered_id, who=C, check=False)
    assert json.loads(answer.stdout)["status"] == "unavailable"
    pg("delete from public.resource_grants where resource_revision in (97,98);")
    pg("delete from public.investigation_revisions where revision in (97,98);")
    current = head_revision(pg, I1)
    assert apply_revision(pg, I1, current, "revise",
                          scenario_manifest("Bad descriptor", invalid))["status"] != "committed"


def test_native_lifecycle_still_saves_and_reopens_the_exact_reference(pg):
    base.reset_live_grants(pg)
    base.reset_live_grants(pg, B)
    committed = apply_revision(pg, J1, head_revision(pg, J1), "revise",
                               scenario_manifest("B scenario", REF2), who=B)
    assert committed["status"] == "committed"
    revision = committed["revision"]
    # The apply receipt carries the committed content: input/source metadata preserved exactly,
    # no basis or result value introduced, committed_at is the platform save time.
    assert committed["manifest"]["scenario_capture"] == REF2
    grant_id = share_scenario(pg, inv=J1, revision=revision, who=B, grantee=A)["handoff"]["grant_id"]
    found = read(pg, grant_id, who=A)
    assert found["status"] == "found"
    assert found["handoff"]["revision"] == revision
    assert found["handoff"]["scenario_capture"] == REF2
    blob = json.dumps(found)
    for token in FULL_VALUE_TOKENS:
        assert token not in blob, token
    # committed_at is the platform save time: exactly the saved revision row's committed_at.
    saved_at = pg("select to_jsonb(r.committed_at)#>>'{}' from public.investigation_revisions r"
                  " where r.investigation_id='" + J1 + "' and r.revision=" + str(revision) + ";")
    assert found["handoff"]["committed_at"] == saved_at
    # A plain reopen of the same pin through the same RPC is byte-identical.
    assert read(pg, grant_id, who=A) == found
    base.reset_live_grants(pg, B)


# ---------------------------------------------------------------- metadata readback
def test_readback_metadata_exact_privileges_policies_and_no_user_rows(pg):
    base.reset_live_grants(pg)
    grant_id = share_scenario(pg)["handoff"]["grant_id"]
    # name -> (identity_arguments, result_type, language, volatility, security_definer)
    expected_functions = {
        "valid_investigation_scenario_reference_v1": ("c jsonb", "boolean", "plpgsql", "i", False),
        "valid_investigation_manifest_v2": ("m jsonb", "boolean", "plpgsql", "i", False),
        "owns_active_investigation_revision":
            ("p_investigation uuid, p_revision integer", "boolean", "sql", "s", True),
        "owns_scenario_bearing_revision":
            ("p_investigation uuid, p_revision integer", "boolean", "sql", "s", True),
        "investigation_handoff_summary_v1":
            ("p_grant_id uuid, p_investigation uuid, p_revision integer, p_shared_by uuid, "
             "p_grantee uuid, p_created_at timestamp with time zone, p_manifest jsonb",
             "jsonb", "sql", "s", False),
        "create_investigation_handoff_v1":
            ("p_id uuid, p_revision integer, p_grantee uuid", "jsonb", "plpgsql", "v", True),
        "create_investigation_scenario_handoff_v1":
            ("p_id uuid, p_revision integer, p_grantee uuid", "jsonb", "plpgsql", "v", True),
        "list_investigation_handoffs_v1":
            ("p_sent_after uuid, p_received_after uuid", "jsonb", "plpgsql", "s", True),
        "read_investigation_handoff_v1": ("p_grant_id uuid", "jsonb", "plpgsql", "s", True),
        "revoke_investigation_handoff_v1": ("p_grant_id uuid", "jsonb", "plpgsql", "v", True),
        "resource_grants_guard": ("", "trigger", "plpgsql", "v", True),
    }
    # regprocedure selectors take the types-only signature (the 0041 readback convention).
    reg_signatures = {
        "valid_investigation_scenario_reference_v1": "jsonb",
        "valid_investigation_manifest_v2": "jsonb",
        "owns_active_investigation_revision": "uuid,integer",
        "owns_scenario_bearing_revision": "uuid,integer",
        "investigation_handoff_summary_v1": "uuid,uuid,integer,uuid,uuid,timestamptz,jsonb",
        "create_investigation_handoff_v1": "uuid,integer,uuid",
        "create_investigation_scenario_handoff_v1": "uuid,integer,uuid",
        "list_investigation_handoffs_v1": "uuid,uuid",
        "read_investigation_handoff_v1": "uuid",
        "revoke_investigation_handoff_v1": "uuid",
        "resource_grants_guard": "",
    }
    selectors = ",".join("to_regprocedure('public." + name + "(" + sig + ")')"
                         for name, sig in reg_signatures.items())
    rows = json.loads(pg(
        "select coalesce(jsonb_agg(to_jsonb(t) order by t.name), '[]'::jsonb) from (select"
        " p.proname as name, 'function' as kind, n.nspname as schema,"
        " pg_get_function_identity_arguments(p.oid) as identity_arguments,"
        " pg_get_function_result(p.oid) as result_type, l.lanname as language,"
        " pg_get_userbyid(p.proowner) as owner, p.provolatile as volatility,"
        " p.prosecdef as security_definer, p.proconfig::text as configuration,"
        " array_to_string(p.proacl, ',') as acl, md5(p.prosrc) as body_md5"
        " from pg_proc p join pg_namespace n on n.oid = p.pronamespace"
        " join pg_language l on l.oid = p.prolang"
        " where p.oid in (" + selectors + ")) t;"))
    assert {row["name"] for row in rows} == set(expected_functions)
    assert len(rows) == len(expected_functions)
    for row in rows:
        identity, result_type, language, volatility, definer = expected_functions[row["name"]]
        assert row["schema"] == "public" and row["owner"] == "postgres"
        assert row["kind"] == "function"
        assert row["identity_arguments"] == identity, row["name"]
        assert row["result_type"] == result_type and row["language"] == language
        assert row["volatility"] == volatility and row["security_definer"] is definer
        if definer or row["name"].startswith("valid_") or row["name"] == "investigation_handoff_summary_v1":
            assert row["configuration"] and "search_path=" in row["configuration"], row["name"]
        if row["name"].startswith("valid_"):
            assert "pg_catalog" in row["configuration"], row["name"]
        if row["name"] == "resource_grants_guard":
            assert "auth" in row["configuration"], row["name"]
        if row["name"] in ("create_investigation_handoff_v1",
                           "create_investigation_scenario_handoff_v1",
                           "list_investigation_handoffs_v1", "read_investigation_handoff_v1",
                           "revoke_investigation_handoff_v1",
                           "owns_active_investigation_revision",
                           "owns_scenario_bearing_revision"):
            # The handoff RPCs and ownership helpers run with a fixed EMPTY search_path.
            expected_config = (chr(123) + chr(34) + 'search_path=' + chr(92) + chr(34)
                               + chr(92) + chr(34) + chr(34) + chr(125))
            assert row["configuration"] == expected_config, row["configuration"]
    # No overload of either create or the pure validator survives anywhere.
    for name in ("create_investigation_handoff_v1", "create_investigation_scenario_handoff_v1",
                 "list_investigation_handoffs_v1", "read_investigation_handoff_v1",
                 "revoke_investigation_handoff_v1", "owns_scenario_bearing_revision",
                 "valid_investigation_scenario_reference_v1"):
        assert pg("select count(*) from pg_proc where pronamespace='public'::regnamespace"
                  " and proname='" + name + "';") == "1", name
    # Column, privileges, policy text, trigger.
    assert json.loads(pg("select coalesce(json_agg(q),'[]'::json) from (select jsonb_build_object("
                         "'name',attname,'notnull',attnotnull,'type',format_type(atttypid,0::integer),"
                         "'default',pg_get_expr(ad.adbin,ad.adrelid)) q from pg_attribute a"
                         " left join pg_attrdef ad on ad.adrelid=a.attrelid and ad.adnum=a.attnum"
                         " where attrelid='public.resource_grants'::regclass and attname="
                         "'include_scenario') q2;")) == [
        {"name": "include_scenario", "notnull": True, "type": "boolean", "default": "false"}]
    assert pg("select has_column_privilege('authenticated','public.resource_grants',"
              "'include_scenario','UPDATE');") == "f"
    assert pg("select has_function_privilege('authenticated',"
              "'public.create_investigation_scenario_handoff_v1(uuid,integer,uuid)','EXECUTE');") == "t"
    assert pg("select has_function_privilege('authenticated',"
              "'public.owns_scenario_bearing_revision(uuid,integer)','EXECUTE');") == "t"
    # The pure validator keeps NO caller-facing EXECUTE by design; the owner chain is the only
    # evaluator, and the end-to-end lifecycle tests above prove that chain still works.
    assert pg("select has_function_privilege('authenticated',"
              "'public.valid_investigation_scenario_reference_v1(jsonb)','EXECUTE');") == "f"
    assert pg("select has_function_privilege('anon',"
              "'public.valid_investigation_scenario_reference_v1(jsonb)','EXECUTE');") == "f"
    assert pg("select has_function_privilege('postgres',"
              "'public.valid_investigation_scenario_reference_v1(jsonb)','EXECUTE');") == "t"
    assert pg("select has_function_privilege('anon',"
              "'public.create_investigation_scenario_handoff_v1(uuid,integer,uuid)','EXECUTE');") == "f"
    assert pg("select has_function_privilege('service_role',"
              "'public.create_investigation_scenario_handoff_v1(uuid,integer,uuid)','EXECUTE');") == "f"
    policy = pg("select with_check from pg_policies where policyname="
                "'resource_grants_insert_investigation_owner';")
    # pg_policies deparses normalized text: literal casts and upper-case keywords. Normalize
    # the same way the pinned-handoff harness does before the fragment checks.
    normalized = " ".join(policy.replace("::text", "").replace(" IS NOT NULL", " is not null")
                          .replace(" AND ", " and ").replace(" OR ", " or ")
                          .replace("(NOT ", "(not ").split())
    for fragment in ("granted_by = auth.uid()", "grantee_user_id <> auth.uid()",
                     "resource_kind = 'investigation'", "resource_revision is not null",
                     "owns_active_investigation_revision(resource_id, resource_revision)",
                     "not include_scenario",
                     "owns_scenario_bearing_revision(resource_id, resource_revision)"):
        assert fragment in normalized, fragment
    assert pg("select tgname from pg_trigger where tgrelid='public.resource_grants'::regclass"
              " and not tgisinternal;") == "resource_grants_revoke_is_terminal"
    # Catalog readback only: no user-row content may appear anywhere in it.
    catalog_blob = json.dumps(rows) + policy
    for fixture_value in (A, B, C, I1, grant_id):
        assert fixture_value not in catalog_blob
    base.reset_live_grants(pg)


def test_replay_preserves_rows_and_shape(pg):
    base.reset_live_grants(pg)
    scenario_id = share_scenario(pg)["handoff"]["grant_id"]
    plain_id = base.share(pg, revision=2, grantee=C)["handoff"]["grant_id"]
    before = base.grants_multiset(pg)
    found_before = read(pg, scenario_id)
    for sql_file in MIGRATIONS + (_locate_migration()[0],):
        pg(sql_file.read_text())
    assert base.grants_multiset(pg) == before
    assert pg("select count(*) from pg_proc where pronamespace='public'::regnamespace and"
              " proname in ('create_investigation_handoff_v1',"
              "'create_investigation_scenario_handoff_v1');") == "2"
    assert pg("select count(*) from pg_policies where schemaname='public' and tablename="
              "'resource_grants';") == "4"
    assert read(pg, scenario_id) == found_before
    assert read(pg, plain_id, who=C)["status"] == "found"
    assert "scenario_capture" not in json.dumps(read(pg, plain_id, who=C))
    base.reset_live_grants(pg)


def test_fixed_dto_never_carries_raw_attachments(pg):
    base.reset_live_grants(pg)
    scenario_id = share_scenario(pg, revision=1)["handoff"]["grant_id"]
    plain_id = base.share(pg, revision=1, grantee=C)["handoff"]["grant_id"]
    blob = json.dumps(base.listing(pg, A)) + json.dumps(base.listing(pg, B))
    blob += json.dumps(read(pg, scenario_id)) + json.dumps(read(pg, plain_id, who=C))
    for forbidden in ("AAPL", "layout_refs", "evidence_refs", "thesis_refs", '"subjects"',
                      "review_baseline_ref", "current_revision", '"lifecycle"', '"manifest"',
                      "next_question", "next_observation"):
        assert forbidden not in blob, forbidden
    for token in FULL_VALUE_TOKENS:
        assert token not in blob, token
    # Cursor seeks are untouched: seeking past the lower of the two grant UUIDs returns exactly
    # the higher one, with the exact keyset of its own projection -- the flag rides only the
    # opted-in row, whichever ordering the random UUIDs took.
    first_id, second_id = sorted([scenario_id, plain_id])
    later = base.listing(pg, A, sent_after=first_id)
    assert {item["grant_id"] for item in later["sent"]} == {second_id}
    expected_keys = (SUMMARY_KEYS | {"scenario_included"}) if second_id == scenario_id \
        else SUMMARY_KEYS
    assert all(set(item) == expected_keys for item in later["sent"])
    assert later["sent_next_cursor"] is None and later["received_next_cursor"] is None
    base.reset_live_grants(pg)


def test_joined_reference_expiry_set_and_native_root_contract(pg):
    import copy
    for kind in ({"kind": "zero"}, {"kind": "one", "exp": "2026-10-16"}):
        raw = scenario_reference(lens=kind, selection_key="2026-10-16|2026-10-16T20:00:00Z,2026-12-18|2026-12-18T21:00:00Z")
        assert validator(pg, raw) is False, kind
    for root in ("../../admin", "spy", "SP Y"):
        assert validator(pg, scenario_reference(root=root)) is False, root
    # Native read.selectionKey sorts FULL strings, regardless of UTC instant ordering.
    pair1 = "2026-10-16|2026-10-16T09:30:00-10:00"
    pair2 = "2026-10-16|2026-10-16T10:30:00+10:00"
    raw = scenario_reference(lens={"kind": "one", "exp": "2026-10-16"}, selection_key=pair1 + "," + pair2)
    assert validator(pg, raw) is True


def test_joined_reference_clock_precision_and_offset_contract(pg):
    raw = scenario_reference(source_as_of="2026-10-16T14:30:00.000000002Z", evaluated_at="2026-10-16T14:30:00.000000001Z")
    assert validator(pg, raw) is False
    raw = scenario_reference(source_as_of="2026-10-16t14:30:00.000000001+23:59", evaluated_at="2026-10-16t14:30:00.000000002+23:59")
    assert validator(pg, raw) is True


def test_scenario_revision_real_http_client_with_same_isolated_pg(pg):
    vitest = ROOT / "terminal/node_modules/.bin/vitest"
    assert vitest.exists(), "local actual Terminal Vitest is required for consumer qualification"
    env = {**os.environ, "MMX_HANDOFF_TEST_SOCKET": pg.socket_path,
           "MMX_HANDOFF_TEST_PORT": str(PORT), "MMX_SCENARIO_REFERENCE": json.dumps(REF1)}
    result = subprocess.run([str(vitest), "run", "lib/__tests__/researchHandoffsPostgresConsumer.test.ts",
                             "-t", "reads only a deliberately shared scenario revision"],
                            cwd=ROOT / "terminal", env=env, text=True, capture_output=True)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "1 passed" in result.stdout, result.stdout + result.stderr
