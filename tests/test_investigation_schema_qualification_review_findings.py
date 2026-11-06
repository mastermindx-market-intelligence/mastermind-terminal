"""Controlled catalog negatives for the two independent review findings.

The fake transport projects the fixed SELECT over deliberately hostile catalog
facts. It never calls Postgres or a production endpoint. Set S17_QUALIFIER_BASELINE
only to measure the original immutable candidate's two causal failures.
"""
import importlib.util
import json
import os
from pathlib import Path
import subprocess

import pytest
from ops import investigation_schema_qualification as current

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def module(tmp_path):
    if not os.environ.get("S17_QUALIFIER_BASELINE"):
        return current
    source = subprocess.check_output(["git", "-C", str(ROOT), "show",
        "1d1546248818a02320edf82ea723909b258ea63d:ops/investigation_schema_qualification.py"],
        env=dict(os.environ, GIT_NO_LAZY_FETCH="1"))
    path = tmp_path / "original.py"
    path.write_bytes(source)
    spec = importlib.util.spec_from_file_location("original_schema_qualifier", path)
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


def run_fixture(module, *, conditional=False, column_grant=None, attribute=None):
    head = module._git(ROOT, "rev-parse", "HEAD").decode().strip()
    definitions = module._definitions(module._git(ROOT, "show", head + ":" + module.MIGRATION))
    calls = []

    def transport(argv, **kwargs):
        query = json.loads(Path(argv[argv.index("--data-binary") + 1][1:]).read_text())["query"]
        assert query == module.CATALOG_QUERY
        assert kwargs["input"].startswith('header = "Authorization: Bearer controlled-only')
        assert "controlled-only" not in " ".join(argv)
        calls.append(query)
        functions = [dict(name=name, **row, public_execute=False,
                          effective_execute={role: bool(value) for role, value in module.ACL[name].items()})
                     for name, row in definitions.items()]
        trigger = dict(name="investigation_native_receipt_guard", enabled="O", type=27,
                       function="investigation_native_receipt_guard_v1", schema="public")
        # Real pg_trigger has these facts even when the original SELECT omitted them.
        if "'unconditional'" in query:
            trigger.update(unconditional=not conditional, columns="", args_hex="", internal=False,
                           constraint_oid="0", parent_oid="0", old_table=None, new_table=None)
            if attribute:
                trigger.update(attribute)
        writes = {"anon": False, "authenticated": False}
        for role in writes:
            # A column-only grant is invisible to has_table_privilege; the new
            # any-column predicate is necessary to observe the real permission.
            if column_grant == role and f"has_any_column_privilege('{role}'" in query:
                writes[role] = True
        raw = [{"catalog": dict(database="postgres", schema="public", current_role="postgres",
                session_role="postgres", server_version_num="170011", observed_at="2026-11-06T03:00:00Z",
                functions=functions, receipt_relation=dict(rls=True, anon_write=writes["anon"],
                authenticated_write=writes["authenticated"], constraints=[], triggers=[trigger]))}]
        return subprocess.CompletedProcess(argv, 0, json.dumps(raw) + "\n200", "")

    result = module.qualify_native_schema(runner=module.CurlRunner("a" * 20, "controlled-only", runner=transport),
                source_root=ROOT, expected_source_sha=head, expected_project_ref="a" * 20,
                expected_database="postgres")
    assert len(calls) == 1
    assert result["cutover_qualified"] is False
    return result


def test_unconditional_guard_and_closed_column_privileges_positive(module):
    assert run_fixture(module)["state"] == "declared_native_facet_qualified"


def test_conditional_when_false_guard_is_not_qualified(module):
    result = run_fixture(module, conditional=True)
    assert result["state"] == "mismatch"
    assert "receipt_trigger_mismatch" in result["errors"]


@pytest.mark.parametrize("role", ["anon", "authenticated"])
def test_column_only_writer_is_not_qualified(module, role):
    result = run_fixture(module, column_grant=role)
    assert result["state"] == "mismatch"
    assert "receipt_relation_access_mismatch" in result["errors"]


@pytest.mark.parametrize("attribute", [dict(columns="1"), dict(args_hex="00"), dict(internal=True),
    dict(constraint_oid="42"), dict(parent_oid="42"), dict(old_table="old_rows"), dict(new_table="new_rows")])
def test_guard_semantic_attributes_are_exact(module, attribute):
    assert run_fixture(module, attribute=attribute)["state"] == "mismatch"
