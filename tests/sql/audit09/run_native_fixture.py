"""Causal entry-unit/older-writer/RLS checks on an isolated installed PostgreSQL."""
from pathlib import Path
import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import io
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--out-dir", required=True, type=Path)
parser.add_argument("--pg-bin", required=True, type=Path)
args = parser.parse_args()
repo = Path(__file__).resolve().parents[3]
out = args.out_dir.resolve()
if out == repo or repo in out.parents:
    raise SystemExit("Evidence must stay outside repository source")
out.mkdir(parents=True, exist_ok=True)
work = Path(tempfile.mkdtemp(prefix="a09-entry-unit-", dir=out))
data = work / "data"
# Unix socket filenames have a native length limit; keep the owned socket on
# the same external evidence volume without inheriting the long checkout path.
socket = Path(tempfile.mkdtemp(prefix=".a09pg-", dir=out.parent.parent))
bin = args.pg_bin.resolve()
migration = repo / "supabase/migrations/0035_portfolio_entry_currency.sql"
sys.path.insert(0, str(repo))
from scripts.supabase_apply import ApiError, idempotency_findings, readback_statements_detailed, run_apply, split_statements, strip_sql_comments

migration_sql = migration.read_text()
prepared = split_statements(migration_sql)
if len(prepared) != 1 or not strip_sql_comments(prepared[0]).lstrip().startswith("DO $portfolio_migration$"):
    raise SystemExit("Portfolio migration must be one outer DO statement through the real runner parser")
migration_statement = strip_sql_comments(prepared[0])
if idempotency_findings(migration_sql, prepared):
    raise SystemExit("Portfolio migration fails the existing application guard")
readbacks, dropped_readbacks = readback_statements_detailed(migration_sql)
if len(readbacks) != 5 or dropped_readbacks:
    raise SystemExit("Portfolio migration must preserve all five executable catalog readbacks")
receipt = {"proof_class": "isolated_actual_postgres", "production_effects": False,
           "cases_pass": [], "fixture_cleanup": False,
           "source_sql_sha256": hashlib.sha256(migration.read_bytes()).hexdigest(),
           "application_pipeline": "scripts.supabase_apply.run_apply with isolated native PostgreSQL QueryRunner",
           "network_used": False, "application_statements": len(prepared),
           "prepared_statement_sha256": hashlib.sha256(migration_statement.encode()).hexdigest(),
           "readback_statements": len(readbacks)}
started = False
logs = []
try:
    subprocess.run([str(bin / "initdb"), "-D", str(data), "-U", "postgres", "-A", "trust",
                    "--no-locale", "--encoding=UTF8"], check=True, capture_output=True, text=True)
    subprocess.run([str(bin / "pg_ctl"), "-D", str(data), "-l", str(work / "postgres.log"),
                    "-o", f"-c listen_addresses='' -c unix_socket_directories='{socket}' -c shared_buffers=32MB -c max_connections=8",
                    "-w", "start"], check=True, capture_output=True, text=True)
    started = True
    cmd = [str(bin / "psql"), "-h", str(socket), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atq"]

    def query(sql, expected_error=None):
        result = subprocess.run(cmd, input=sql, capture_output=True, text=True, timeout=30)
        logs.append(result.stdout + result.stderr)
        if expected_error:
            if result.returncode == 0 or expected_error not in result.stderr:
                raise AssertionError(f"Expected refusal: {expected_error}")
        elif result.returncode:
            raise RuntimeError(result.stderr[-2000:])
        return result.stdout.strip()

    def case(name, actual, expected):
        if actual != expected:
            raise AssertionError(f"{name}: {actual!r} != {expected!r}")
        receipt["cases_pass"].append(name)

    query(migration_statement, "portfolio_positions prerequisite missing")
    case("absent prerequisite publishes no receipt function", query("SELECT count(*) FROM pg_proc WHERE proname='portfolio_entry_currency_receipt';"), "0")
    query("CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);"
          "CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;"
          "GRANT USAGE ON SCHEMA auth TO authenticated; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;"
          "INSERT INTO auth.users VALUES('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');")
    query((repo / "supabase/migrations/0007_portfolio_positions.sql").read_text())
    query("GRANT SELECT,INSERT,UPDATE,DELETE ON public.portfolio_positions TO authenticated;"
          "INSERT INTO public.portfolio_positions(id,user_id,ticker,shares,entry_price) VALUES"
          "('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','AAA',1,100);")
    estate = "SELECT jsonb_build_object('acl',relacl::text,'rls',relrowsecurity,'force',relforcerowsecurity,'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY policyname) FROM pg_policies p WHERE schemaname='public' AND tablename='portfolio_positions')) FROM pg_class WHERE oid='public.portfolio_positions'::regclass;"
    before = query(estate)
    query("ALTER TABLE public.portfolio_positions DISABLE ROW LEVEL SECURITY;")
    query(migration_statement, "portfolio_positions RLS prerequisite missing")
    case("RLS refusal is atomic in real PostgreSQL", query("SELECT count(*) FROM pg_attribute WHERE attrelid='public.portfolio_positions'::regclass AND attname LIKE 'entry_currency%' AND NOT attisdropped;"), "0")
    query("ALTER TABLE public.portfolio_positions ENABLE ROW LEVEL SECURITY; ALTER TABLE public.portfolio_positions ADD COLUMN entry_currency boolean;")
    query(migration_statement, "portfolio entry-unit column type mismatch")
    case("type refusal publishes no receipt function", query("SELECT count(*) FROM pg_proc WHERE proname='portfolio_entry_currency_receipt';"), "0")
    query("ALTER TABLE public.portfolio_positions DROP COLUMN entry_currency; ALTER TABLE public.portfolio_positions ADD COLUMN entry_currency text NOT NULL DEFAULT 'USD';")
    query(migration_statement, "portfolio entry-unit columns must be nullable without defaults")
    case("default/not-null refusal rolls back basis column", query("SELECT count(*) FROM pg_attribute WHERE attrelid='public.portfolio_positions'::regclass AND attname='entry_currency_basis' AND NOT attisdropped;"), "0")
    query("ALTER TABLE public.portfolio_positions DROP COLUMN entry_currency;")
    query("ALTER TABLE public.portfolio_positions ADD COLUMN entry_currency text; ALTER TABLE public.portfolio_positions ADD CONSTRAINT portfolio_entry_currency_shape CHECK(entry_currency IS NULL);")
    query(migration_statement, "portfolio entry-unit constraint shape mismatch")
    case("same-named incompatible constraint refuses before publication", query("SELECT count(*) FROM pg_proc WHERE proname='portfolio_entry_currency_receipt';"), "0")
    query("ALTER TABLE public.portfolio_positions DROP COLUMN entry_currency;")

    # Exercise the actual wrapper's split, strip, pre-readback, apply and
    # post-readback lifecycle. Each native query uses a fresh psql connection,
    # matching the existing production runner's statement ownership boundary.
    def native_runner(statement):
        try:
            if statement.lstrip().lower().startswith("select"):
                result = query("SELECT COALESCE(jsonb_agg(to_jsonb(q)), '[]'::jsonb) FROM ("
                               + statement.strip().rstrip(";") + ") q;")
                return json.loads(result)
            query(statement)
            return []
        except RuntimeError as exc:
            raise ApiError(400, str(exc)) from exc

    failure_source = work / migration.name
    fault = "RAISE EXCEPTION 'portfolio fixture rollback after trigger';" + chr(10)
    fault_anchor = "COMMENT ON COLUMN public.portfolio_positions.entry_currency IS"
    assert migration_sql.count(fault_anchor) == 1
    failure_source.write_text(migration_sql.replace(fault_anchor, fault + fault_anchor, 1))
    wrapper_output = io.StringIO()
    failed_receipt_path = out / "wrapper-forced-failure.json"
    failure_exit = run_apply(failure_source, runner=native_runner, receipt_path=failed_receipt_path,
                             project_ref="isolated-local-fixture", out=wrapper_output)
    failed_receipt = json.loads(failed_receipt_path.read_text())
    case("actual wrapper reports one failed statement", [failure_exit, failed_receipt["status"],
         failed_receipt["statements_n"], failed_receipt["failed_statement_index"]], [5, "failed", 1, 1])
    failure_error = next((line.removeprefix("HTTP 400: ") for line in failed_receipt["error"].splitlines() if "ERROR:" in line), "")
    case("fault reaches the deliberate post-trigger exception", failure_error,
         "ERROR:  portfolio fixture rollback after trigger")
    partial = query("SELECT jsonb_build_array("
        "(SELECT count(*) FROM pg_attribute WHERE attrelid='public.portfolio_positions'::regclass AND attname IN ('entry_currency','entry_currency_basis') AND NOT attisdropped),"
        "(SELECT count(*) FROM pg_proc WHERE proname='portfolio_entry_currency_receipt'),"
        "(SELECT count(*) FROM pg_trigger WHERE tgrelid='public.portfolio_positions'::regclass AND tgname='portfolio_entry_currency_receipt'),"
        "(SELECT count(*) FROM pg_constraint WHERE conrelid='public.portfolio_positions'::regclass AND conname='portfolio_entry_currency_shape'));")
    case("late failure rolls back columns function trigger and constraint together", partial, "[0, 0, 0, 0]")
    case("late failure preserves grants and all owner policies", query(estate), before)
    success_receipt_path = out / "wrapper-success.json"
    success_exit = run_apply(migration, runner=native_runner, receipt_path=success_receipt_path,
                             project_ref="isolated-local-fixture", out=wrapper_output)
    success_receipt = json.loads(success_receipt_path.read_text())
    case("actual wrapper verifies one applied statement and five readbacks",
         [success_exit, success_receipt["status"], success_receipt["statements_n"], len(success_receipt["post"])],
         [0, "applied", 1, 5])
    receipt["wrapper_failure_receipt"] = failed_receipt_path.name
    receipt["wrapper_success_receipt"] = success_receipt_path.name
    logs.append(wrapper_output.getvalue())
    receipt["constraint_definition"] = query("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.portfolio_positions'::regclass AND conname='portfolio_entry_currency_shape';")
    case("migration preserves privileges and all owner policies", query(estate), before)
    prefix = "SET ROLE authenticated; SET request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';"
    row = "SELECT jsonb_build_array(entry_currency,entry_currency_basis)::text FROM public.portfolio_positions WHERE ticker='AAA';"
    case("legacy row remains unknown", query(prefix + row), "[null, null]")
    declare = "UPDATE public.portfolio_positions SET entry_currency='USD',entry_currency_basis=jsonb_build_object('ticker',ticker,'price',entry_price) WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';"
    query(prefix + declare)
    expected = '["USD", {"price": 100, "ticker": "AAA"}]'
    case("explicit same-price instrument receipt survives", query(prefix + row), expected)
    query(prefix + "UPDATE public.portfolio_positions SET status='closed',notes='older writer',shares=2 WHERE ticker='AAA';")
    case("older status/share/notes writer preserves declaration", query(prefix + row), expected)
    query(prefix + "UPDATE public.portfolio_positions SET entry_price=200 WHERE ticker='AAA';")
    case("older price write invalidates declaration", query(prefix + row), "[null, null]")
    query(prefix + "UPDATE public.portfolio_positions SET entry_price=100 WHERE ticker='AAA';")
    case("changing price back cannot resurrect unit", query(prefix + row), "[null, null]")
    query(prefix + declare + "UPDATE public.portfolio_positions SET ticker='BBB' WHERE ticker='AAA'; UPDATE public.portfolio_positions SET ticker='AAA' WHERE ticker='BBB';")
    case("changing instrument back cannot resurrect unit", query(prefix + row), "[null, null]")
    query(prefix + "UPDATE public.portfolio_positions SET entry_currency='HKD',entry_currency_basis='{" + '"ticker":"BBB","price":100' + "}'::jsonb WHERE ticker='AAA';")
    case("mismatched receipt clears unit instead of inventing authority", query(prefix + row), "[null, null]")
    query(prefix + declare + "UPDATE public.portfolio_positions SET entry_currency=NULL WHERE ticker='AAA';")
    case("explicit unknown clears receipt", query(prefix + row), "[null, null]")
    query(prefix + "UPDATE public.portfolio_positions SET entry_price=NULL,entry_currency='HKD',entry_currency_basis=jsonb_build_object('ticker',ticker,'price',NULL) WHERE ticker='AAA';")
    case("explicit unit permits intentionally unsized null price", query(prefix + row), '["HKD", {"price": null, "ticker": "AAA"}]')
    query(prefix + "UPDATE public.portfolio_positions SET entry_price=100,entry_currency='GBp',entry_currency_basis=jsonb_build_object('ticker',ticker,'price',100) WHERE ticker='AAA';", "portfolio_entry_currency_shape")
    case("rejected pence tag preserves prior row", query(prefix + row), '["HKD", {"price": null, "ticker": "AAA"}]')
    other = "SET ROLE authenticated; SET request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';"
    case("other tenant cannot read row", query(other + "SELECT count(*) FROM public.portfolio_positions;"), "0")
    case("other tenant cannot change row", query(other + "WITH changed AS (UPDATE public.portfolio_positions SET entry_price=999 RETURNING id) SELECT count(*) FROM changed;"), "0")
    replay_receipt_path = out / "wrapper-replay.json"
    replay_exit = run_apply(migration, runner=native_runner, receipt_path=replay_receipt_path,
                            project_ref="isolated-local-fixture", out=wrapper_output)
    replay_receipt = json.loads(replay_receipt_path.read_text())
    case("actual wrapper safely reapplies the one-statement migration",
         [replay_exit, replay_receipt["status"], replay_receipt["statements_n"]], [0, "applied", 1])
    receipt["wrapper_replay_receipt"] = replay_receipt_path.name
    case("reapplication preserves exact recorded receipt", query(prefix + row), '["HKD", {"price": null, "ticker": "AAA"}]')
    case("reapplication preserves privileges and policies", query(estate), before)
    case("one invoker receipt function with pinned path", query("SELECT count(*) FROM pg_proc WHERE proname='portfolio_entry_currency_receipt' AND NOT prosecdef AND proconfig=ARRAY['search_path=pg_catalog, public'];"), "1")
    receipt["version"] = query("SHOW server_version;")
except Exception as exc:
    receipt["error"] = str(exc)
finally:
    if started:
        stop = subprocess.run([str(bin / "pg_ctl"), "-D", str(data), "-w", "stop", "-m", "fast"], capture_output=True, text=True)
        receipt["stop_exit"] = stop.returncode
        receipt["fixture_cleanup"] = stop.returncode == 0 and not (data / "postmaster.pid").exists()
    else:
        receipt["fixture_cleanup"] = not (data / "postmaster.pid").exists()
    if (work / "postgres.log").exists():
        shutil.copy2(work / "postgres.log", out / "a09-native-pg-server-20261009.log")
    if receipt["fixture_cleanup"]:
        shutil.rmtree(work)
        shutil.rmtree(socket)
    (out / "a09-native-pg-causal-20261009.log").write_text("\n".join(logs))
    (out / "a09-native-pg-receipt-20261009.json").write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps(receipt))
if receipt.get("error") or not receipt["fixture_cleanup"]:
    raise SystemExit(1)
