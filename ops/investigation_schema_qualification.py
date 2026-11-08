"""Read-only native-participant catalog qualification on the incumbent SQL owner.

Import performs no IO. No credential resolver, CLI, SQL application, admission or
OPEN issuer. The existing owner may supply its bound CurlRunner only after the
specific query is lawful; the historical T03k effect is NOT retried by this code.
A positive result qualifies the declared native function/ACL facet only. It does
not attest migration application, whole schema, all-ingress drain or old effects.
"""
from hashlib import sha256
from pathlib import Path
import re
import subprocess
import sys

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))
from scripts.supabase_apply import ApiError, CurlRunner  # noqa: E402

MIGRATION = "supabase/migrations/0051_investigation_native_capture_participant.sql"
MIGRATION_SHA256 = "8600c7119ddf1c38d110032da717712eee02d4c56e6ccde0bb5a194b5da56e5e"
FUNCTIONS = {
    "claim_investigation_native_capture_v1": "jsonb,jsonb",
    "complete_investigation_native_capture_v1": "jsonb,uuid,text",
    "read_investigation_native_capture_v1": "uuid,jsonb",
    "investigation_native_receipt_guard_v1": "",
    "apply_investigation_revision_v2": "uuid,integer,text,uuid,jsonb,jsonb,jsonb",
    "reconcile_investigation_operation_v2": "uuid,integer,text,uuid,jsonb,jsonb,jsonb",
}
# CLOSED means the declared mutation entry points are not executable by browsers.
ACL = {
    name: {"anon": False, "authenticated": name == "read_investigation_native_capture_v1",
           "service_role": (name in {"claim_investigation_native_capture_v1", "complete_investigation_native_capture_v1"}) if name not in {"apply_investigation_revision_v2", "reconcile_investigation_operation_v2"} else None}
    for name in FUNCTIONS
}
_NAMES = ",".join("'" + name + "'" for name in FUNCTIONS)
# One fixed SELECT, one catalog snapshot, no source body or caller SQL interpolated.
CATALOG_QUERY = """SELECT jsonb_build_object(
 'database',current_database(),'schema','public','current_role',current_user,
 'session_role',session_user,'server_version_num',current_setting('server_version_num'),
 'observed_at',clock_timestamp(),
 'functions',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'name',p.proname,'arguments',oidvectortypes(p.proargtypes),
   'returns',pg_get_function_result(p.oid),'owner',pg_get_userbyid(p.proowner),
   'security_definer',p.prosecdef,'language',l.lanname,'config',p.proconfig,
   'body',p.prosrc,
   'public_execute',EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      WHERE a.grantee=0 AND a.privilege_type='EXECUTE'),
   'effective_execute',jsonb_build_object(
      'anon',has_function_privilege('anon',p.oid,'EXECUTE'),
      'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),
      'service_role',has_function_privilege('service_role',p.oid,'EXECUTE')))
   ORDER BY p.proname,p.oid)
   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   JOIN pg_language l ON l.oid=p.prolang
   WHERE n.nspname='public' AND p.proname IN (""" + _NAMES + """)), '[]'::jsonb),
 'receipt_relation',(SELECT jsonb_build_object('rls',c.relrowsecurity,
    'anon_write',(has_table_privilege('anon',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE') OR has_any_column_privilege('anon',c.oid,'INSERT,UPDATE')),
    'authenticated_write',(has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE') OR has_any_column_privilege('authenticated',c.oid,'INSERT,UPDATE')),
    'constraints',coalesce((SELECT jsonb_agg(jsonb_build_object('name',conname,
      'validated',convalidated,'definition',pg_get_constraintdef(oid)) ORDER BY conname)
      FROM pg_constraint WHERE conrelid=c.oid),'[]'::jsonb),
    'triggers',coalesce((SELECT jsonb_agg(jsonb_build_object('name',t.tgname,
      'enabled',t.tgenabled,'type',t.tgtype,'function',p.proname,'schema',n.nspname,
      'unconditional',(t.tgqual IS NULL),'columns',t.tgattr::text,
      'args_hex',encode(t.tgargs,'hex'),'internal',t.tgisinternal,
      'constraint_oid',t.tgconstraint::text,'parent_oid',t.tgparentid::text,
      'old_table',t.tgoldtable,'new_table',t.tgnewtable)
      ORDER BY t.tgname) FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
      JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE t.tgrelid=c.oid AND NOT t.tgisinternal),'[]'::jsonb))
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='investigation_mutation_receipts' AND c.relkind='r')) AS catalog;"""


def _git(root, *args):
    # No implicit lazy fetch and no shared-index lock mutation during observation.
    import os
    env = dict(os.environ, GIT_NO_LAZY_FETCH="1", GIT_OPTIONAL_LOCKS="0")
    return subprocess.check_output(["git", "-C", str(root), *args], env=env,
                                   stderr=subprocess.DEVNULL, timeout=15)


def _source(root, expected_head):
    if type(expected_head) is not str or not re.fullmatch(r"[0-9a-f]{40}", expected_head):
        raise ValueError("invalid_source_identity")
    if _git(root, "rev-parse", "HEAD").decode().strip() != expected_head:
        raise ValueError("source_changed")
    source = _git(root, "show", f"{expected_head}:{MIGRATION}")
    if sha256(source).hexdigest() != MIGRATION_SHA256:
        raise ValueError("unqualified_migration_source")
    # Reject a changed materialized migration; a sparse-omitted path uses Git bytes.
    physical = Path(root) / MIGRATION
    if physical.exists() or physical.is_symlink():
        if physical.is_symlink() or not physical.is_file() or physical.read_bytes() != source:
            raise ValueError("source_worktree_changed")
    return source


def _definitions(source):
    text = source.decode("utf-8", errors="strict")
    # Only literal CREATE bodies from the exact pinned source are supported.
    pattern = re.compile(
        r"create or replace function public\.(\w+)\((.*?)\)\s*returns\s+(\w+)"
        r"\s+language\s+(\w+)(.*?)\bas\s+(\$\w*\$)(.*?)\6;",
        re.I | re.S)
    result = {}
    for match in pattern.finditer(text):
        name, arguments, returns, language, options, _, body = match.groups()
        if name not in FUNCTIONS:
            continue
        types = []
        for argument in arguments.split(","):
            if argument.strip():
                types.append(re.split(r"\s+default\s+", argument.strip(), flags=re.I)[0].split()[-1].lower())
        path = re.search(r"set\s+search_path\s*=\s*([\w, ]+)", options, re.I)
        if name in result or ",".join(types) != FUNCTIONS[name] or not path:
            raise ValueError("source_contract_unsupported")
        result[name] = dict(arguments=FUNCTIONS[name], returns=returns.lower(),
                            language=language.lower(), security_definer=bool(re.search(r"security\s+definer", options, re.I)),
                            config=["search_path=" + path.group(1).replace(" ", "")],
                            owner="postgres", body=body)
    if set(result) != set(FUNCTIONS):
        raise ValueError("source_contract_incomplete")
    return result


def _catalog_mismatches(raw, expected, database):
    errors = []
    if type(raw) is not list or len(raw) != 1 or type(raw[0]) is not dict or set(raw[0]) != {"catalog"}:
        return ["catalog_envelope_invalid"]
    catalog = raw[0]["catalog"]
    keys = {"database", "schema", "current_role", "session_role", "server_version_num", "observed_at", "functions", "receipt_relation"}
    if type(catalog) is not dict or set(catalog) != keys:
        return ["catalog_shape_invalid"]
    if catalog["database"] != database or catalog["schema"] != "public":
        errors.append("catalog_target_mismatch")
    for key in ("current_role", "session_role", "observed_at", "server_version_num"):
        if type(catalog[key]) is not str or not catalog[key] or len(catalog[key]) > 128:
            errors.append("catalog_identity_invalid")
    rows = catalog["functions"]
    if type(rows) is not list or len(rows) != len(FUNCTIONS):
        return errors + ["function_set_missing_or_extra_overload"]
    seen = set()
    for row in rows:
        if type(row) is not dict or set(row) != {"name", "arguments", "returns", "owner", "security_definer", "language", "config", "body", "public_execute", "effective_execute"}:
            errors.append("function_row_invalid")
            continue
        name = row["name"]
        if type(name) is not str or name not in expected or name in seen:
            errors.append("function_identity_invalid")
            continue
        seen.add(name)
        for key, value in expected[name].items():
            actual = row[key]
            if key == "arguments" and type(actual) is str:
                actual = actual.replace(" ", "")
            if key == "config" and type(actual) is list and all(type(x) is str for x in actual):
                actual = [x.replace(" ", "") for x in actual]
            if type(actual) is not type(value) or actual != value:
                errors.append(f"function_{key}_mismatch:{name}")
        effective = row["effective_execute"]
        if (row["public_execute"] is not False or type(effective) is not dict
                or set(effective) != {"anon", "authenticated", "service_role"}
                or any(type(v) is not bool for v in effective.values())
                or any(value is not None and effective.get(role) is not value for role, value in ACL[name].items())):
            errors.append(f"effective_execute_mismatch:{name}")
    relation = catalog["receipt_relation"]
    if type(relation) is not dict or set(relation) != {"rls", "anon_write", "authenticated_write", "constraints", "triggers"}:
        errors.append("receipt_relation_unavailable")
    else:
        if relation["rls"] is not True or relation["anon_write"] is not False or relation["authenticated_write"] is not False:
            errors.append("receipt_relation_access_mismatch")
        trigger = {"name": "investigation_native_receipt_guard", "enabled": "O", "type": 27,
                   "function": "investigation_native_receipt_guard_v1", "schema": "public",
                   "unconditional": True, "columns": "", "args_hex": "", "internal": False,
                   "constraint_oid": "0", "parent_oid": "0", "old_table": None, "new_table": None}
        if relation["triggers"] != [trigger]:
            errors.append("receipt_trigger_mismatch")
        # Return definitions as observation, never silently certify CHECK semantics.
        if type(relation["constraints"]) is not list:
            errors.append("constraint_observation_invalid")
    return sorted(set(errors))


def qualify_native_schema(*, runner, source_root, expected_source_sha, expected_project_ref, expected_database):
    """Issue fixed SELECT via existing bound owner, then validate actual returned facts.

    No arbitrary QueryRunner/attestation input entrance. Controlled tests use the
    incumbent CurlRunner's subprocess seam, so the real request shape is tested.
    Calling this is a live read unless that owner supplies an explicit fixture.
    This function itself grants no authority to retry a denied or unknown read.
    """
    result = {"schema": "investigation.native_catalog_qualification.v1", "state": "unavailable",
              "cutover_qualified": False, "application_provenance": "not_attested",
              "source_sha": expected_source_sha, "migration_sha256": MIGRATION_SHA256,
              "query_sha256": sha256(CATALOG_QUERY.encode()).hexdigest(),
              "coverage": "0051 native functions/exact bodies/effective RPC ACLs/receipt RLS-DML-trigger",
              "not_qualified": ["whole_schema_constraints_policies", "0030_application_or_T03k", "all_ingress_and_drain", "old_operations", "OPEN"],
              "observations": [], "errors": []}
    if (type(runner) is not CurlRunner or runner.project_ref != expected_project_ref
            or type(expected_project_ref) is not str or not re.fullmatch(r"[a-z0-9]{20}", expected_project_ref)
            or type(expected_database) is not str or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,62}", expected_database)):
        result["errors"] = ["incumbent_target_binding_invalid"]
        return result
    result["target"] = {"project_ref": runner.project_ref, "database": expected_database, "schema": "public"}
    try:
        before = _source(source_root, expected_source_sha)
        expected = _definitions(before)
        raw = runner(CATALOG_QUERY)
        result["observations"].append(raw)
        errors = _catalog_mismatches(raw, expected, expected_database)
        if _source(source_root, expected_source_sha) != before:
            errors.append("source_changed_during_query")
        result["errors"] = sorted(set(errors))
        result["state"] = "mismatch" if errors else "declared_native_facet_qualified"
    except ApiError as error:
        # No API body/token/error text or generic repr escapes. Exact runtime
        # denial provenance remains with the original owner's retained receipt.
        result["errors"] = ["owner_query_denied" if error.status in (401, 403) else "owner_query_unavailable"]
        result["http_status"] = error.status
    except (ValueError, UnicodeError, OSError, subprocess.SubprocessError):
        result["errors"] = ["source_or_catalog_unavailable"]
    return result
