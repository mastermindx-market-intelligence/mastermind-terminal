"""Source-candidate composition in a disposable local PostgreSQL cluster only.

This is not exact0030 cutover qualification, a fleet/production operation or an
application of the held migrations to any existing database. The original kernel
fixture owns creation/cleanup, credentials are synthetic, listen_addresses is empty.
"""
import copy
import hashlib
import json
import os
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest

from test_investigation_kernel_postgres import kernel, draft
from test_investigation_postgres import ROOT, A, B, pg, quote, apply

SOURCE = ROOT / "supabase/migrations/0043_investigation_plan_composition.sql"
PLAN = json.loads((ROOT / "terminal/lib/__tests__/fixtures/options_plan_draft_v1.json").read_text())


@pytest.fixture(scope="module", autouse=True)
def bounded_fixture_notices():
    # A repeated DO block can attach its entire 41KiB source to each NOTICE.
    # Keep actual WARNING/ERROR output while avoiding pipe backpressure during
    # this disposable fixture's deliberate repeat installation. No SQL guard changes.
    prior = os.environ.get("PGOPTIONS")
    os.environ["PGOPTIONS"] = (prior or "") + " -c client_min_messages=warning"
    try:
        yield
    finally:
        if prior is None:
            os.environ.pop("PGOPTIONS", None)
        else:
            os.environ["PGOPTIONS"] = prior


def literal(value):
    return quote(json.dumps(value, ensure_ascii=False)) + "::jsonb"


def plan_manifest():
    return {**draft(), "schema": "investigation_manifest.v3", "option_plan": copy.deepcopy(PLAN)}


@pytest.fixture(scope="module")
def composed(kernel):
    # Demonstrate the real existing replacement gap before installing the candidate.
    value = plan_manifest()
    assert kernel("select valid_investigation_manifest_v2(" + literal(value) + ")") == "f"
    kernel((ROOT / "supabase/migrations/0040_investigation_review.sql").read_text())
    assert kernel("select valid_investigation_manifest_v2(" + literal(draft()) + ")") == "f"
    # A partial/pre0042 state must fail before creating even one new helper.
    with pytest.raises(AssertionError, match="0043_requires_existing_kernel_and_0042"):
        kernel(SOURCE.read_text())
    assert kernel("select to_regprocedure('public.valid_investigation_option_plan_v1(jsonb)') is null") == "t"
    # Actual existing grant owner and exact original0042 source dependency, in this
    # disposable fixture only. This does not qualify or authorize a live0042 effect.
    kernel("create role service_role; create table watchlists(id uuid primary key,user_id uuid references auth.users(id),name text);"
           "create table watchlist_symbols(id uuid primary key,watchlist_id uuid references watchlists(id),symbol text);")
    for name in ("0021_resource_grants.sql", "0041_pinned_research_handoffs.sql"):
        kernel((ROOT / "supabase/migrations" / name).read_text())
    dependency = ROOT / "tests/fixtures/migrations/0042_investigation_scenario_reference.sql"
    assert hashlib.sha256(dependency.read_bytes()).hexdigest() == "2eb41ee7bbfa3b0601e05b211b09a15c3418d1ee0fe7d9b57e7f096e98cb1682"
    kernel(dependency.read_text())
    installed = kernel("select pg_get_functiondef('public.valid_investigation_manifest_v2(jsonb)'::regprocedure)")
    kernel("create or replace function public.valid_investigation_manifest_v2(m jsonb) returns boolean language sql immutable as $$select false$$")
    with pytest.raises(AssertionError, match="0043_requires_0042_predicate_order"):
        kernel(SOURCE.read_text())
    kernel(installed)
    with pytest.raises(AssertionError, match="test_late_atomic_failure"):
        kernel(SOURCE.read_text().replace("end $composition$;", "raise exception 'test_late_atomic_failure'; end $composition$;"))
    assert kernel("select to_regprocedure('public.valid_investigation_option_plan_v1(jsonb)') is null") == "t"
    kernel(SOURCE.read_text())
    kernel(SOURCE.read_text())  # real reapplication leaves existing records/receipts untouched
    yield kernel


def test_composes_root_v2_review_exposure_and_v3_without_replacing_canonical_owner(composed):
    for value in [draft(), plan_manifest(), {**draft(), "review": {"assessment": "inconclusive", "note": "Unknown remains unknown"}},
                  {**draft(), "evidence_refs": [{"owner": "terminal.options_exposure", "object_type": "exposure_chart_request", "object_id": "request", "mode": "pinned", "version_ref": "version"}]}]:
        assert composed("select valid_investigation_manifest_v2(" + literal(value) + ")") == "t"
    # Historical canonical digest behavior stays unchanged. Not JS canonical parity.
    wire = {"😀": 1e-7, "\ue000": 1e21, "zero": -0.0, "authored": "  exact  "}
    result = composed("select investigation_json_v2(" + literal(wire) + ")")
    assert result.index("\ue000") < result.index("😀")
    assert "0.0000001" in result and "1000000000000000000000" in result


@pytest.mark.parametrize("token, expected", [
    ("0", "0"), ("-0.0", "0"), ("1e-7", "1e-7"), ("1e-6", "0.000001"),
    ("1e20", "100000000000000000000"), ("1e21", "1e+21"), ("1.25e22", "1.25e+22"),
    ("-0.125", "-0.125"), ("1.2345678901234567", "1.2345678901234567"),
    ("9007199254740993", None), ("1e400", None), ("1e-400", None),
])
def test_existing_js_identity_number_spelling_is_explicit(composed, token, expected):
    actual = composed("select coalesce(investigation_plan_number_v1(" + quote(token) + "::jsonb),'NULL')")
    assert actual == (expected if expected is not None else "NULL")


def test_native_binary64_wire_corpus(composed):
    corpus = json.loads((ROOT / "terminal/lib/__tests__/fixtures/options_plan_number_wire.json").read_text())
    for vector in corpus["cases"]:
        assert composed("select coalesce(investigation_plan_number_v1(" + quote(vector["token"]) + "::jsonb),'NULL')") == vector["expected"], vector


def test_scenario_reference_remains_v2_only_and_value_free(composed):
    reference = {
        "schema": "investigation_scenario_reference.v1", "model_version": "exposure-scenario/v1",
        "inputs": {"targetSpot": 600, "deltaSigmaPts": 1, "days": 1},
        "source": {"owner": "options_hub", "root": "SPX", "session": "2026-10-16",
                   "source_as_of": "2026-10-16t15:30:00z", "evaluated_at": "2026-10-16T15:45:00Z",
                   "lens": {"kind": "one", "exp": "2026-10-30"},
                   "selection_key": "2026-10-30|2026-10-30T09:30:00-04:00,2026-10-30|2026-10-30T16:00:00-04:00",
                   "basis_sha256": "a" * 64, "gex": {"sha256": "b" * 64, "byte_length": 2048}, "moves": None},
    }
    value = {**draft(), "scenario_capture": reference}
    assert composed("select valid_investigation_manifest_v2(" + literal(value) + ")") == "t"
    for changed in [{**plan_manifest(), "scenario_capture": reference},
                    {**draft(), "scenario_capture": {**reference, "basis": {"protected": 1}}},
                    {**draft(), "scenario_capture": {**reference, "result": {"pnl": 1}}}]:
        assert composed("select valid_investigation_manifest_v2(" + literal(changed) + ")") == "f"


def test_helpers_do_not_add_a_public_or_authenticated_rpc(composed):
    for role in ["anon", "authenticated"]:
        for signature in ["valid_investigation_option_plan_v1(jsonb)", "investigation_plan_number_v1(jsonb)", "investigation_plan_json_v1(jsonb)"]:
            assert composed("select has_function_privilege(" + quote(role) + "," + quote("public." + signature) + ",'EXECUTE')") == "f"
    assert composed("select prosecdef from pg_proc where oid='public.valid_investigation_option_plan_v1(jsonb)'::regprocedure") == "f"


def test_plan_never_expands_an_existing_question_only_share(composed):
    target = str(uuid4())
    value = plan_manifest()
    assert apply(composed, str(uuid4()), content=value, target=target)["status"] == "committed"
    shared = json.loads(composed("select create_investigation_handoff_v1(" + ",".join([quote(target), "1", quote(B)]) + ")", A))
    assert shared["status"] == "created"
    grant = shared["handoff"]["grant_id"]
    found = json.loads(composed("select read_investigation_handoff_v1(" + quote(grant) + ")", B))
    assert found["status"] == "found"
    assert set(found["handoff"]) == {"schema", "grant_id", "investigation_id", "revision", "shared_by", "committed_at", "intent", "continuation"}
    assert found["handoff"]["intent"] == {"title": value["intent"]["title"], "question": value["intent"]["question"]}
    assert "option_plan" not in json.dumps(found) and "NVDA1" not in json.dumps(found)
    assert json.loads(composed("select create_investigation_scenario_handoff_v1(" + ",".join([quote(target), "1", quote(B)]) + ")", A))["status"] != "already_shared"
    mutation = composed("update resource_grants set include_scenario=true where id=" + quote(grant), A, check=False)
    assert mutation.returncode != 0
    assert composed("select include_scenario from resource_grants where id=" + quote(grant), A) == "f"
    assert json.loads(composed("select read_investigation_v2(" + quote(target) + ",1)", B))["status"] == "not_found"


def test_legacy_rows_and_receipts_are_not_rewritten_by_forward_composition(composed):
    original = composed.legacy_result
    read = json.loads(composed("select read_investigation_v2(" + quote(composed.legacy_target) + ",1)", A))
    assert read["manifest"] == original["manifest"] and "argument_relations" not in read["manifest"]
    assert read["operation_id"] == composed.legacy_operation
    removed = apply(composed, str(uuid4()), "remove", 1, read["manifest"], composed.legacy_target)
    assert removed["status"] == "committed" and removed["manifest_digest"] == read["manifest_digest"]


@pytest.mark.parametrize("path,replacement", [
    (("schema",), None), (("schema",), "future"), (("legs",), []),
    (("legs", 0, "snapshot", "identity", "strike"), 181),
    (("legs", 0, "snapshot", "row", "strike"), 181),
    (("legs", 0, "snapshot", "identity", "terms", "multiplier"), 100),
    (("legs", 0, "snapshot", "session"), "2026-10-24"),
    (("legs", 0, "snapshot", "session"), None),
    (("legs", 0, "snapshot", "schema"), 1),
    (("legs", 0, "snapshot", "family"), None),
    (("legs", 0, "snapshot", "hotView"), "by_volume"),
    (("legs", 0, "snapshot", "row", "exp"), "2026-02-30"),
    (("legs", 0, "snapshot", "row", "constructor"), "forged"),
    (("legs", 0, "snapshot", "row", "root"), "NVDA 1"),
    (("legs", 0, "snapshot", "identity", "key"), "forged"),
    (("legs", 0, "assumptions", "quantity"), 1.5),
    (("legs", 0, "assumptions", "quantity"), 1000001),
    (("legs", 0, "assumptions", "side"), "BUY"),
    (("legs", 1, "assumptions", "entry", "kind"), None),
    (("legs", 1, "assumptions", "entry", "premium_per_unit"), -1),
    (("research", "horizon"), "a\nb"),
    (("research", "thesis"), "x" * 4001),
])
def test_forged_plan_never_mints_revision_or_receipt(composed, path, replacement):
    value = plan_manifest()
    cursor = value["option_plan"]
    for key in path[:-1]:
        cursor = cursor[key]
    cursor[path[-1]] = replacement
    target, operation = str(uuid4()), str(uuid4())
    assert apply(composed, operation, content=value, target=target)["status"] == "invalid_payload"
    assert composed("select count(*) from investigation_revisions where investigation_id=" + quote(target)) == "0"
    assert composed("select count(*) from investigation_mutation_receipts where operation_id=" + quote(operation)) == "0"


def test_plan_v2_future_missing_relations_and_unknown_root_keys_stay_closed(composed):
    for edit in [lambda v: v.update(schema="investigation_manifest.v2"), lambda v: v.update(schema="investigation_manifest.v4"),
                 lambda v: v.pop("argument_relations"), lambda v: v.update(invented_control=True),
                 lambda v: v["option_plan"]["legs"].append(copy.deepcopy(v["option_plan"]["legs"][0]))]:
        value = plan_manifest()
        edit(value)
        assert composed("select valid_investigation_manifest_v2(" + literal(value) + ")") == "f"


def test_whole_plan_cas_exact_revision_replay_digest_and_fence(composed):
    target, operation = str(uuid4()), str(uuid4())
    original = plan_manifest()
    original["option_plan"]["legs"][0]["snapshot"]["row"]["😀"] = 1e-7
    original["option_plan"]["legs"][0]["snapshot"]["row"]["\ue000"] = 1e21
    saved = apply(composed, operation, content=original, target=target)
    assert saved["status"] == "committed" and saved["manifest"] == original
    canonical = composed("select investigation_json_v2(" + literal(original) + ")")
    assert saved["manifest_digest"] == hashlib.sha256(canonical.encode()).hexdigest()
    # Client-side key/number spelling differs; it must not replace the owner digest.
    assert canonical != json.dumps(original, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    changed = copy.deepcopy(original)
    changed["option_plan"]["research"]["thesis"] += " changed"
    assert apply(composed, operation, content=changed, target=target)["status"] == "idempotency_conflict"
    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(lambda _: apply(composed, str(uuid4()), "revise", 1, changed, target), range(2)))
    assert sorted(r["status"] for r in results) == ["committed", "version_conflict"]
    old = json.loads(composed("select read_investigation_v2(" + quote(target) + ",1)", A))
    assert old["manifest"] == original and old["manifest_digest"] == saved["manifest_digest"]
    assert apply(composed, operation, content=original, target=target) == saved
    assert json.loads(composed("select read_investigation_v2(" + quote(target) + ",1)", B))["status"] == "not_found"
    fence_target, fence_operation = str(uuid4()), str(uuid4())
    fenced = json.loads(composed("select reconcile_investigation_operation_v2(" + ",".join([quote(fence_target), "0", "'create'", quote(fence_operation), literal(original)]) + ")", A))
    assert fenced["status"] == "not_applied"
    assert apply(composed, fence_operation, content=original, target=fence_target) == fenced
    assert apply(composed, str(uuid4()), content=original, target=fence_target)["status"] == "committed"
