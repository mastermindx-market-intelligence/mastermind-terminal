"""Source candidate against the existing private-socket disposable PG harness.
No production connection, provider call or application permission is implied.
"""
from pathlib import Path
import subprocess
import pytest
import test_pinned_research_handoff_postgres as base

ROOT = Path(__file__).resolve().parents[1]
SQL = ROOT / "supabase/migrations/0044_portfolio_target_role.sql"

@pytest.fixture(scope="module")
def pg(tmp_path_factory):
    run, data, sock = base._spawn_postgres(tmp_path_factory, "target-role-pg", 55519)
    try:
        base._bootstrap_base_schema(run)
        run((ROOT / "supabase/migrations/0023_portfolio_targets.sql").read_text())
        run("grant select,insert,update,delete on public.portfolio_targets to authenticated; grant select on public.portfolio_targets to anon;")
        before = run("select relacl::text from pg_class where oid='public.portfolio_targets'::regclass")
        policies = run("select string_agg(pg_get_expr(polqual,polrelid)||coalesce(pg_get_expr(polwithcheck,polrelid),''),'|' order by polname) from pg_policy where polrelid='public.portfolio_targets'::regclass")
        run(SQL.read_text())
        assert run("select relacl::text from pg_class where oid='public.portfolio_targets'::regclass") == before
        assert run("select string_agg(pg_get_expr(polqual,polrelid)||coalesce(pg_get_expr(polwithcheck,polrelid),''),'|' order by polname) from pg_policy where polrelid='public.portfolio_targets'::regclass") == policies
        yield run
    finally:
        subprocess.run(["pg_ctl", "-D", str(data), "-m", "fast", "-w", "stop"], check=True, capture_output=True)
        sock.cleanup()

def test_legacy_writes_and_owner_isolation(pg):
    pg("insert into public.portfolio_targets(user_id,ticker,target_weight_pct) values ('"+base.A+"','AAA',40)", who=base.A)
    assert pg("select role_label is null from public.portfolio_targets where ticker='AAA'", who=base.A) == 't'
    pg("update public.portfolio_targets set role_label='观察仓位' where ticker='AAA'", who=base.A)
    pg("update public.portfolio_targets set target_weight_pct=55 where ticker='AAA'", who=base.A)
    assert pg("select target_weight_pct||'|'||role_label from public.portfolio_targets where ticker='AAA'", who=base.A) == '55|观察仓位'
    assert pg("select count(*) from public.portfolio_targets", who=base.B) == '0'
    assert pg("select count(*) from public.portfolio_targets", role='anon') == '0'
    pg("update public.portfolio_targets set role_label='foreign' where ticker='AAA'", who=base.B)
    assert pg("select role_label from public.portfolio_targets where ticker='AAA'", who=base.A) == '观察仓位'
    pg("update public.portfolio_targets set role_label=null where ticker='AAA'", who=base.A)

@pytest.mark.parametrize('text', ['', ' ', ' leading', 'trailing ', '　', 'a\nb', 'a\u0085b', 'x'*49, '𠮷'*49])
def test_database_refuses_invalid_role(pg,text):
    result=pg("update public.portfolio_targets set role_label="+base.quote(text)+" where ticker='AAA'",who=base.A,check=False)
    assert result.returncode != 0
    assert 'portfolio_targets_role_label_valid' in result.stderr

@pytest.mark.parametrize('text', ['𠮷'*48, '观察仓位', 'My <core> & ideas'])
def test_database_accepts_descriptive_unicode(pg,text):
    pg("update public.portfolio_targets set role_label="+base.quote(text)+" where ticker='AAA'",who=base.A)
    assert pg("select role_label from public.portfolio_targets where ticker='AAA'",who=base.A)==text

def test_repeat_preserves_saved_label(pg):
    before=pg("select role_label from public.portfolio_targets where ticker='AAA'",who=base.A)
    result=pg(SQL.read_text(),check=False)
    assert result.returncode == 0
    assert pg("select role_label from public.portfolio_targets where ticker='AAA'",who=base.A)==before

@pytest.mark.parametrize('change', [
    "alter table public.portfolio_targets alter column role_label set default 'core'",
    "alter table public.portfolio_targets drop constraint portfolio_targets_role_label_valid; alter table public.portfolio_targets add constraint portfolio_targets_role_label_valid check (role_label is null or length(role_label)<500)",
    "alter table public.portfolio_targets disable row level security",
])
def test_conflicting_catalog_refuses_without_changes(pg,change):
    before=pg("select role_label from public.portfolio_targets where ticker='AAA'",who=base.A)
    result=pg("begin;"+change+";"+SQL.read_text()+"rollback;",check=False)
    assert result.returncode != 0
    assert pg("select role_label from public.portfolio_targets where ticker='AAA'",who=base.A)==before
