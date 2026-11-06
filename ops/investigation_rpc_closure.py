"""Fixed-owner read of declared Investigation RPC closure and original phases.

No CLI, receipt-JSON entrance, issuer, mutation, credential resolver or IO at
import. A lawful incumbent CurlRunner is required for an invocation. This is a
DB-role/catalog facet, never HTTP inventory, admission cutoff, complete drain,
0030 application, historical-effect reconciliation or OPEN authority.
"""
from __future__ import annotations

from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re
import subprocess
import time
from uuid import UUID

from ops import investigation_schema_qualification as NATIVE
from scripts import supabase_apply as SQL_OWNER
from scripts.supabase_apply import ApiError, CurlRunner

NEW_WORK = frozenset({"apply_investigation_revision_v2", "reconcile_investigation_operation_v2",
                      "claim_investigation_native_capture_v1"})
LATE_COMPLETION = "complete_investigation_native_capture_v1"
GUARD = "investigation_native_receipt_guard_v1"
ROLES = ("anon", "authenticated", "service_role")
TABLES = ("chart_layout_revisions", "investigation_mutation_receipts", "investigation_revisions", "investigations")
PINNED_SOURCE = {
    "supabase/migrations/0028_investigations.sql": "149e1a8ab0568430429e895031f8bd6314670879a647e75a30b8c103cb5187ea",
    "tests/fixtures/investigation_cutover/0030-pinned-source.txt": "e98d5a59cfb1932ebf4e562ecf89b6d08b7a5c9365b3e2fbe0b612eaaeff4694",
}
SOURCE_INTERFACES = ("ops/investigation_rpc_closure.py", "ops/investigation_schema_qualification.py", "scripts/supabase_apply.py")
MAX_ROWS = 128
MAX_SCOPE = 512
MAX_SPAN_SECONDS = 30
HEX = re.compile(r"[0-9a-f]{64}\Z")
IDENTIFIER = re.compile(r"[A-Za-z_][A-Za-z0-9_$-]{0,62}\Z")
REFUSALS = frozenset("""invalid_source_identity source_changed unqualified_migration_source source_worktree_changed
rpc_source_unqualified rpc_source_changed executing_owner_source_mismatch legacy_overload_fence_absent source_role_scope_incomplete
timestamp_invalid catalog_envelope_invalid catalog_shape_invalid catalog_target_mismatch catalog_identity_unqualified
catalog_epoch_invalid catalog_observation_stale catalog_set_partial_or_oversize role_scope_invalid role_scope_duplicate
role_identity_contradiction source_roles_missing membership_invalid membership_duplicate membership_scope_mismatch
effective_privileges_partial effective_privilege_invalid effective_privilege_scope_mismatch function_shape_invalid
function_missing_extra_or_overload function_identity_invalid function_source_mismatch public_rpc_execute_open
new_work_or_untrusted_completion_role_open function_set_incomplete relation_scope_unqualified attribute_scope_invalid
direct_table_write_role_open relation_set_incomplete native_guard_set_changed native_guard_changed
original_operation_invalid original_operation_duplicate native_original_partial native_original_binding_invalid
native_phase_contradiction native_completion_precedes_claim owner_target_changed source_changed_during_observation
observation_order_or_freshness_invalid database_epoch_or_role_changed rpc_or_role_current_set_changed
original_phase_inventory_changed observation_window_exhausted""".split())
_NAMES = ",".join("'" + name + "'" for name in sorted(NEW_WORK | {LATE_COMPLETION, GUARD}))
_ROLE_NAMES = ",".join("'" + name + "'" for name in ROLES)
_TABLE_NAMES = ",".join("'" + name + "'" for name in TABLES)
# Same incumbent Management API QueryRunner, one fixed SELECT/snapshot per read.
# MEMBER intentionally overapproximates potential SET ROLE, including NOINHERIT:
# an additional reachable grant can refuse closure, never falsely establish it.
CATALOG_QUERY = """WITH declared_roles AS (
 SELECT oid,rolname FROM pg_roles WHERE rolname IN (""" + _ROLE_NAMES + """)
), role_scope AS (
 SELECT d.rolname AS origin,r.oid,r.rolname AS name,
        encode(extensions.digest(convert_to(jsonb_build_object('oid',r.oid,'name',r.rolname,
          'superuser',r.rolsuper,'bypassrls',r.rolbypassrls,'login',r.rolcanlogin,'inherit',r.rolinherit)::text,'UTF8'),'sha256'),'hex') AS revision,
        r.rolsuper AS superuser,r.rolbypassrls AS bypassrls,r.rolcanlogin AS login,r.rolinherit AS inherit
 FROM declared_roles d CROSS JOIN pg_roles r
 WHERE r.oid=d.oid OR pg_has_role(d.oid,r.oid,'MEMBER')
), functions AS (
 SELECT p.oid,p.proname AS name,replace(oidvectortypes(p.proargtypes),' ','') AS arguments,
        p.xmin::text AS revision,pg_get_userbyid(p.proowner) AS owner,p.prosecdef AS security_definer,
        l.lanname AS language,pg_get_function_result(p.oid) AS returns,p.proconfig AS config,
        encode(extensions.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex') AS body_sha256,
        EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
          WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute,
        (SELECT jsonb_agg(jsonb_build_object('origin',r.origin,'role_oid',r.oid,
             'allowed',has_function_privilege(r.oid,p.oid,'EXECUTE')) ORDER BY r.origin,r.oid)
         FROM role_scope r) AS effective_execute
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
 WHERE n.nspname='public' AND p.proname IN (""" + _NAMES + """)
), relations AS (
 SELECT c.oid,c.relname AS name,c.xmin::text AS revision,pg_get_userbyid(c.relowner) AS owner,
        c.relrowsecurity AS rls,c.relforcerowsecurity AS force_rls,
        (SELECT coalesce(jsonb_agg(jsonb_build_object('number',a.attnum,'revision',a.xmin::text,
           'type_oid',a.atttypid,'acl',a.attacl::text) ORDER BY a.attnum),'[]'::jsonb)
         FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) AS attributes,
        (SELECT jsonb_agg(jsonb_build_object('origin',r.origin,'role_oid',r.oid,
           'allowed',(has_table_privilege(r.oid,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE') OR
                      has_any_column_privilege(r.oid,c.oid,'INSERT,UPDATE'))) ORDER BY r.origin,r.oid)
         FROM role_scope r) AS effective_write
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname IN (""" + _TABLE_NAMES + """) AND c.relkind='r'
), memberships AS (
 SELECT m.roleid,m.member,m.grantor,m.admin_option,m.xmin::text AS revision
 FROM pg_auth_members m WHERE m.member IN (SELECT oid FROM role_scope)
), native_rows AS (
 SELECT user_id::text AS principal,operation_id::text AS operation,native_generation::text AS generation,
        native_phase,native_claimed_at,native_completed_at,result->>'status' AS canonical_status,
        encode(extensions.digest(convert_to(request::text,'UTF8'),'sha256'),'hex') AS request_sha256,
        CASE WHEN native_binding IS NULL THEN NULL ELSE
          encode(extensions.digest(convert_to(native_binding::text,'UTF8'),'sha256'),'hex') END AS binding_sha256
 FROM public.investigation_mutation_receipts
), native_limited AS (
 SELECT * FROM native_rows ORDER BY principal,operation LIMIT 129
), guards AS (
 SELECT t.tgname AS name,t.xmin::text AS revision,t.tgenabled AS enabled,t.tgtype AS type,
        p.proname AS function,n.nspname AS schema,(t.tgqual IS NULL) AS unconditional,
        t.tgattr::text AS columns,encode(t.tgargs,'hex') AS args_hex,t.tgisinternal AS internal,
        t.tgconstraint::text AS constraint_oid,t.tgparentid::text AS parent_oid,
        t.tgoldtable AS old_table,t.tgnewtable AS new_table
 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE t.tgrelid='public.investigation_mutation_receipts'::regclass AND NOT t.tgisinternal
)
SELECT jsonb_build_object(
 'database',current_database(),'database_oid',(SELECT oid FROM pg_database WHERE datname=current_database()),
 'schema','public','current_role',current_user,'session_role',session_user,
 'observer_bypassrls',(SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname=current_user),
 'server_version_num',current_setting('server_version_num'),'server_started_at',pg_postmaster_start_time(),
 'snapshot',txid_current_snapshot()::text,'observed_at',clock_timestamp(),
 'role_scope_count',(SELECT count(*) FROM role_scope),
 'role_scope',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY origin,oid) FROM role_scope r),'[]'::jsonb),
 'membership_count',(SELECT count(*) FROM memberships),
 'memberships',coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY member,roleid,grantor) FROM memberships m),'[]'::jsonb),
 'function_count',(SELECT count(*) FROM functions),
 'functions',coalesce((SELECT jsonb_agg(to_jsonb(f) ORDER BY name,arguments) FROM functions f),'[]'::jsonb),
 'relation_count',(SELECT count(*) FROM relations),
 'relations',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY name) FROM relations r),'[]'::jsonb),
 'guards',coalesce((SELECT jsonb_agg(to_jsonb(g) ORDER BY name) FROM guards g),'[]'::jsonb),
 'native_count',(SELECT count(*) FROM native_rows),
 'native_rows',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY principal,operation) FROM native_limited r),'[]'::jsonb)
) AS closure;"""


def _digest(value):
    return sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()).hexdigest()


def _source_contract(root, head):
    # Reuse the accepted S3 source owner, not its OPEN/native ACL policy.
    source = NATIVE._source(root, head)
    expected = NATIVE._definitions(source)
    interfaces = {}
    for name, executing in zip(SOURCE_INTERFACES, (Path(__file__), Path(NATIVE.__file__), Path(SQL_OWNER.__file__))):
        raw = NATIVE._git(root, "show", f"{head}:{name}")
        physical = Path(root) / name
        if (executing.is_symlink() or not executing.is_file() or executing.read_bytes() != raw or
                ((physical.exists() or physical.is_symlink()) and
                 (physical.is_symlink() or not physical.is_file() or physical.read_bytes() != raw))):
            raise ValueError("executing_owner_source_mismatch")
        interfaces[name] = sha256(raw).hexdigest()
    extra = {}
    for name, digest in PINNED_SOURCE.items():
        raw = NATIVE._git(root, "show", f"{head}:{name}")
        if sha256(raw).hexdigest() != digest:
            raise ValueError("rpc_source_unqualified")
        physical = Path(root) / name
        if (physical.exists() or physical.is_symlink()) and (physical.is_symlink() or physical.read_bytes() != raw):
            raise ValueError("rpc_source_changed")
        extra[name] = raw
    cutover = extra["tests/fixtures/investigation_cutover/0030-pinned-source.txt"].decode()
    for name in ("apply_investigation_revision_v2", "reconcile_investigation_operation_v2"):
        if f"drop function if exists public.{name}(uuid,integer,text,uuid,jsonb,jsonb);" not in cutover:
            raise ValueError("legacy_overload_fence_absent")
    revokes = re.findall(r"revoke all on function (.*?) from ([a-z_,]+);", source.decode(), re.S)
    declared = [set(roles.split(",")) - {"public"} for targets, roles in revokes
                if "public.claim_investigation_native_capture_v1(" in targets]
    if declared != [set(ROLES)]:
        raise ValueError("source_role_scope_incomplete")
    if set(re.findall(r"create table if not exists public\.(\w+)\s*\(", extra["supabase/migrations/0028_investigations.sql"].decode())) != set(TABLES):
        raise ValueError("source_role_scope_incomplete")
    selected = {name: expected[name] for name in NEW_WORK | {LATE_COMPLETION, GUARD}}
    for row in selected.values():
        row["body_sha256"] = sha256(row.pop("body").encode()).hexdigest()
    return selected, _digest({"native": sha256(source).hexdigest(), **PINNED_SOURCE, "interfaces": interfaces,
                              "roles": ROLES, "new_work": sorted(NEW_WORK), "late_completion": LATE_COMPLETION})


def _integer(value, *, maximum=2**32-1):
    return type(value) is int and 0 < value <= maximum


def _revision(value):
    return type(value) is str and re.fullmatch(r"[0-9]{1,20}", value) is not None


def _timestamp(value):
    if type(value) is not str or len(value) > 64:
        raise ValueError("timestamp_invalid")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("timestamp_invalid")
    return parsed


def _uuid(value):
    return type(value) is str and str(UUID(value)) == value and UUID(value).int != 0


def _snapshot(raw, expected, database, wall_start):
    if type(raw) is not list or len(raw) != 1 or type(raw[0]) is not dict or set(raw[0]) != {"closure"}:
        raise ValueError("catalog_envelope_invalid")
    row = raw[0]["closure"]
    keys = {"database", "database_oid", "schema", "current_role", "session_role", "observer_bypassrls",
            "server_version_num", "server_started_at", "snapshot", "observed_at", "role_scope_count", "role_scope",
            "membership_count", "memberships", "function_count", "functions", "relation_count", "relations",
            "guards", "native_count", "native_rows"}
    if type(row) is not dict or set(row) != keys:
        raise ValueError("catalog_shape_invalid")
    if row["database"] != database or row["schema"] != "public" or not _integer(row["database_oid"]):
        raise ValueError("catalog_target_mismatch")
    if (any(type(row[k]) is not str or not IDENTIFIER.fullmatch(row[k]) for k in ("current_role", "session_role")) or
            row["observer_bypassrls"] is not True or not _revision(row["server_version_num"]) or
            type(row["snapshot"]) is not str or len(row["snapshot"]) > 8192 or
            not re.fullmatch(r"[0-9]+:[0-9]+:(?:[0-9]+(?:,[0-9]+)*)?", row["snapshot"])):
        raise ValueError("catalog_identity_unqualified")
    observed = _timestamp(row["observed_at"])
    if _timestamp(row["server_started_at"]) > observed:
        raise ValueError("catalog_epoch_invalid")
    if abs((observed-wall_start).total_seconds()) > MAX_SPAN_SECONDS:
        raise ValueError("catalog_observation_stale")
    for field, count, maximum in (("role_scope", "role_scope_count", MAX_SCOPE), ("memberships", "membership_count", MAX_SCOPE),
                                  ("functions", "function_count", 32), ("relations", "relation_count", 4),
                                  ("native_rows", "native_count", MAX_ROWS)):
        if (type(row[field]) is not list or type(row[count]) is not int or
                not 0 <= row[count] <= maximum or len(row[field]) != row[count]):
            raise ValueError("catalog_set_partial_or_oversize")
    scope = set(); own = set(); identities = {}; role_names = {}
    for role in row["role_scope"]:
        if (type(role) is not dict or set(role) != {"origin", "oid", "name", "revision", "superuser", "bypassrls", "login", "inherit"} or
                role["origin"] not in ROLES or not _integer(role["oid"]) or
                type(role["name"]) is not str or not IDENTIFIER.fullmatch(role["name"]) or type(role["revision"]) is not str or not HEX.fullmatch(role["revision"]) or
                any(type(role[k]) is not bool for k in ("superuser", "bypassrls", "login", "inherit"))):
            raise ValueError("role_scope_invalid")
        key = (role["origin"], role["oid"])
        if key in scope:
            raise ValueError("role_scope_duplicate")
        scope.add(key)
        identity = tuple(role[k] for k in ("name", "revision", "superuser", "bypassrls", "login", "inherit"))
        if (role["oid"] in identities and identities[role["oid"]] != identity or
                role["name"] in role_names and role_names[role["name"]] != role["oid"]):
            raise ValueError("role_identity_contradiction")
        identities[role["oid"]] = identity; role_names[role["name"]] = role["oid"]
        if role["origin"] == role["name"]:
            own.add(role["origin"])
    if own != set(ROLES):
        raise ValueError("source_roles_missing")
    membership_keys = set()
    for member in row["memberships"]:
        if (type(member) is not dict or set(member) != {"roleid", "member", "grantor", "admin_option", "revision"} or
                any(not _integer(member[k]) for k in ("roleid", "member", "grantor")) or
                type(member["admin_option"]) is not bool or not _revision(member["revision"])):
            raise ValueError("membership_invalid")
        key = (member["roleid"], member["member"], member["grantor"])
        if key in membership_keys:
            raise ValueError("membership_duplicate")
        if member["member"] not in identities or member["roleid"] not in identities:
            raise ValueError("membership_scope_mismatch")
        membership_keys.add(key)
    def privileges(values):
        if type(values) is not list or len(values) != len(scope):
            raise ValueError("effective_privileges_partial")
        seen = set()
        for value in values:
            if (type(value) is not dict or set(value) != {"origin", "role_oid", "allowed"} or
                    type(value["origin"]) is not str or not _integer(value["role_oid"]) or type(value["allowed"]) is not bool):
                raise ValueError("effective_privilege_invalid")
            key = (value["origin"], value["role_oid"])
            if key not in scope or key in seen:
                raise ValueError("effective_privilege_scope_mismatch")
            seen.add(key)
        return values
    names = set(); function_oids = set(); late = []
    for function in row["functions"]:
        fields = {"oid", "name", "arguments", "revision", "owner", "security_definer", "language", "returns", "config",
                  "body_sha256", "public_execute", "effective_execute"}
        if type(function) is not dict or set(function) != fields:
            raise ValueError("function_shape_invalid")
        name = function["name"]
        if type(name) is not str or name not in expected or name in names:
            raise ValueError("function_missing_extra_or_overload")
        names.add(name)
        if not _integer(function["oid"]) or function["oid"] in function_oids or not _revision(function["revision"]):
            raise ValueError("function_identity_invalid")
        function_oids.add(function["oid"])
        for key, value in expected[name].items():
            actual = function[key]
            if key == "config" and type(actual) is list and all(type(item) is str for item in actual):
                actual = [item.replace(" ", "") for item in actual]
            if type(actual) is not type(value) or actual != value:
                raise ValueError("function_source_mismatch")
        if function["public_execute"] is not False:
            raise ValueError("public_rpc_execute_open")
        actual = privileges(function["effective_execute"])
        for value in actual:
            if value["allowed"] and (name != LATE_COMPLETION or value["origin"] != "service_role"):
                raise ValueError("new_work_or_untrusted_completion_role_open")
        if name == LATE_COMPLETION:
            late = [dict(value) for value in actual if value["allowed"]]
    if names != set(expected):
        raise ValueError("function_set_incomplete")
    relation_names = set(); relation_oids = set()
    for relation in row["relations"]:
        if (type(relation) is not dict or set(relation) != {"oid", "name", "revision", "owner", "rls", "force_rls", "attributes", "effective_write"} or
                relation["name"] not in TABLES or relation["name"] in relation_names or not _integer(relation["oid"]) or relation["oid"] in relation_oids or
                not _revision(relation["revision"]) or relation["owner"] != "postgres" or relation["rls"] is not True or
                type(relation["force_rls"]) is not bool or type(relation["attributes"]) is not list or not 1 <= len(relation["attributes"]) <= 128):
            raise ValueError("relation_scope_unqualified")
        relation_names.add(relation["name"])
        relation_oids.add(relation["oid"])
        attributes = set()
        for attribute in relation["attributes"]:
            if (type(attribute) is not dict or set(attribute) != {"number", "revision", "type_oid", "acl"} or
                    not _integer(attribute["number"], maximum=32767) or attribute["number"] in attributes or
                    not _revision(attribute["revision"]) or not _integer(attribute["type_oid"]) or
                    not (attribute["acl"] is None or type(attribute["acl"]) is str and len(attribute["acl"]) <= 4096)):
                raise ValueError("attribute_scope_invalid")
            attributes.add(attribute["number"])
        if any(value["allowed"] for value in privileges(relation["effective_write"])):
            raise ValueError("direct_table_write_role_open")
    if relation_names != set(TABLES):
        raise ValueError("relation_set_incomplete")
    if type(row["guards"]) is not list or len(row["guards"]) != 1:
        raise ValueError("native_guard_set_changed")
    guard = dict(row["guards"][0]) if type(row["guards"][0]) is dict else {}
    expected_guard = {
        "name":"investigation_native_receipt_guard", "enabled":"O", "type":27, "function":GUARD,
        "schema":"public", "unconditional":True, "columns":"", "args_hex":"", "internal":False,
        "constraint_oid":"0", "parent_oid":"0", "old_table":None, "new_table":None}
    if (not _revision(guard.pop("revision", None)) or set(guard) != set(expected_guard) or
            any(type(guard[k]) is not type(value) or guard[k] != value for k, value in expected_guard.items())):
        raise ValueError("native_guard_changed")
    originals = []; ids = set()
    for original in row["native_rows"]:
        fields = {"principal", "operation", "generation", "native_phase", "native_claimed_at", "native_completed_at",
                  "canonical_status", "request_sha256", "binding_sha256"}
        if (type(original) is not dict or set(original) != fields or not _uuid(original["principal"]) or not _uuid(original["operation"]) or
                original["canonical_status"] not in ("pending", "committed", "not_applied") or
                type(original["request_sha256"]) is not str or not HEX.fullmatch(original["request_sha256"])):
            raise ValueError("original_operation_invalid")
        key = (original["principal"], original["operation"])
        if key in ids:
            raise ValueError("original_operation_duplicate")
        ids.add(key)
        if original["binding_sha256"] is None:
            if any(original[k] is not None for k in ("generation", "native_phase", "native_claimed_at", "native_completed_at")):
                raise ValueError("native_original_partial")
        else:
            if (type(original["binding_sha256"]) is not str or not HEX.fullmatch(original["binding_sha256"]) or
                    not _uuid(original["generation"]) or original["native_phase"] not in ("started", "retained")):
                raise ValueError("native_original_binding_invalid")
            claimed = _timestamp(original["native_claimed_at"])
            if original["native_phase"] == "started":
                if original["native_completed_at"] is not None:
                    raise ValueError("native_phase_contradiction")
            elif _timestamp(original["native_completed_at"]) < claimed:
                raise ValueError("native_completion_precedes_claim")
        originals.append(dict(original))
    target = {k:row[k] for k in ("database", "database_oid", "schema", "current_role", "session_role", "server_version_num", "server_started_at")}
    revision = _digest({k:row[k] for k in ("role_scope", "memberships", "functions", "relations", "guards")})
    return {"target":target,"observed_at":row["observed_at"],"snapshot":row["snapshot"],"current_set_revision":revision,
            "native_inventory_revision":_digest(originals),"originals":originals,"late_completion_grants":late}, observed


def observe_rpc_closure(*, runner, source_root, expected_source_sha, expected_project_ref, expected_database):
    """Two fixed owner reads; no JSON attestation/empty caller inventory entrance.

    Positive state is ONLY the declared DB-role facet at these observations.
    Already-admitted SQL/HTTP/native effects remain possible, even with no rows.
    """
    result = {"schema":"investigation.rpc_closure_observation.v1","state":"unavailable",
              "rpc_new_work_closed":False,"http_current_set_qualified":False,"admission_cutoff_proven":False,
              "drain_proven":False,"old_effects_reconciled":False,"cutover_qualified":False,
              "schema_application_provenance":"not_attested",
              "source_sha":expected_source_sha if type(expected_source_sha) is str and re.fullmatch(r"[0-9a-f]{40}",expected_source_sha) else None,
              "query_sha256":sha256(CATALOG_QUERY.encode()).hexdigest(),
              "coverage":{"new_work":sorted(NEW_WORK),"late_completion":LATE_COMPLETION,
                          "roles":list(ROLES),"dependent_tables":list(TABLES),"unknown_overloads":"refused"},
              "not_qualified":["product_http_current_set","admitted_request_cutoff","complete_native_drain",
                               "unregistered_rpc_families","0030_application_or_T03k","historical_effects","OPEN"],
              "observations":[],"errors":[]}
    if (type(runner) is not CurlRunner or runner.project_ref != expected_project_ref or
            type(expected_project_ref) is not str or not re.fullmatch(r"[a-z0-9]{20}", expected_project_ref) or
            type(expected_database) is not str or not IDENTIFIER.fullmatch(expected_database) or
            type(runner.token) is not str or not 1 <= len(runner.token) <= 4096 or
            type(runner.timeout) is not int or not 1 <= runner.timeout <= 120):
        result["errors"] = ["incumbent_target_binding_invalid"]
        return result
    binding = (runner.project_ref,runner.token,runner.timeout,runner.runner)
    started = time.monotonic(); wall_start = datetime.now(timezone.utc)
    try:
        expected, source_digest = _source_contract(source_root,expected_source_sha)
        result["source_contract_sha256"] = source_digest
        previous = None
        for _ in range(2):
            if (runner.project_ref,runner.token,runner.timeout,runner.runner) != binding:
                raise ValueError("owner_target_changed")
            if _source_contract(source_root,expected_source_sha)[1] != source_digest:
                raise ValueError("source_changed_during_observation")
            raw = runner(CATALOG_QUERY)
            if (runner.project_ref,runner.token,runner.timeout,runner.runner) != binding:
                raise ValueError("owner_target_changed")
            observation, observed = _snapshot(raw,expected,expected_database,wall_start)
            result["observations"].append(observation)
            if previous is not None:
                before, at = previous
                if observed <= at or (observed-at).total_seconds() > MAX_SPAN_SECONDS:
                    raise ValueError("observation_order_or_freshness_invalid")
                if observation["target"] != before["target"]:
                    raise ValueError("database_epoch_or_role_changed")
                if observation["current_set_revision"] != before["current_set_revision"]:
                    raise ValueError("rpc_or_role_current_set_changed")
                if observation["native_inventory_revision"] != before["native_inventory_revision"]:
                    raise ValueError("original_phase_inventory_changed")
            previous = observation, observed
        if _source_contract(source_root,expected_source_sha)[1] != source_digest:
            raise ValueError("source_changed_during_observation")
        if time.monotonic()-started > MAX_SPAN_SECONDS:
            raise ValueError("observation_window_exhausted")
        result.update(state="declared_rpc_new_work_closed",rpc_new_work_closed=True)
    except ApiError as error:
        status = error.status if type(error.status) is int and 100 <= error.status <= 599 else None
        result["errors"] = ["owner_query_denied" if status in (401,403) else "owner_query_unavailable"]
        result["http_status"] = status
    except (ValueError,UnicodeError,OSError,subprocess.SubprocessError,TypeError,KeyError) as error:
        # No raw API/catalog/source/error text, token, request or binding escapes.
        code = error.args[0] if type(error) is ValueError and len(error.args) == 1 and type(error.args[0]) is str else None
        result["errors"] = [code if code in REFUSALS else "source_or_current_observation_unqualified"]
    return result
