"""Regression tests for regional history, deadlines, cache retention and publication effects."""
from __future__ import annotations
import argparse
import copy
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from types import SimpleNamespace
import pytest
from ingest import regional_refresh as rr
from ingest import reported_ownership as ro
from ingest import cn_statement_rules as rules
from ingest.statement_history import merge_statement_history, annual_earnings_from_statements
from ingest.run_bounded import daily_budget, run_bounded

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(autouse=True)
def regional_publication_clock(monkeypatch):
    """Keep direct publisher tests deterministic outside the protected 21:00-22:30 UTC window.

    Only regional_refresh's datetime dependency is injected. No system clock,
    other test's datetime module, or production publication guard is changed.
    """
    class FixedUtcMidday(dt.datetime):
        @classmethod
        def now(cls, tz=None):
            if tz is dt.timezone.utc:
                return cls(2026, 10, 21, 12, 0, tzinfo=tz)
            return super().now(tz)
    monkeypatch.setattr(rr, "dt", SimpleNamespace(datetime=FixedUtcMidday,
                                                 date=dt.date, timezone=dt.timezone))


def args_for(tmp_path, phase="fund"):
    return argparse.Namespace(repo=str(ROOT), data=str(tmp_path/"data"), python=sys.executable,
        key="/test/key", remote="test@fake:/served", status=str(tmp_path/"cnhk_status.json"),
        run_id="test-run", phase=phase, market="all", limit=0, force_hk=False, skip_collect=False, dry_run=False)

class FakeStages:
    """Runs the production orchestration against explicit source/artifact/remote outcomes."""
    def __init__(self, *, fail_collector=None, fail_emitter=None, transfer="ok", partial_collection=False):
        self.fail_collector=fail_collector
        self.fail_emitter=fail_emitter
        self.transfer=transfer
        self.partial_collection=partial_collection
        self.calls=[]
        self.remote={}
    def __call__(self, command, **kwargs):
        command=[str(part) for part in command]
        self.calls.append(command)
        rc=0; stdout=""
        if command[0]=="ssh":
            request=json.loads(kwargs["input"])
            stdout=json.dumps({name:self.remote.get(name) for name in request["names"]})
        elif command[0]=="rsync":
            manifest=Path(next(v.split("=",1)[1] for v in command if v.startswith("--files-from=")))
            names=manifest.read_text().splitlines()
            selected=names if self.transfer=="ok" else names[:1] if self.transfer=="partial" else []
            for name in selected:
                self.remote[name]=hashlib.sha256((manifest.parent/name).read_bytes()).hexdigest()
            rc=0 if self.transfer=="ok" else 23
        else:
            name=Path(command[1]).name
            if name=="run_bounded.py" and any(part.endswith("collect_cn_yahoo.py") for part in command):
                admitted={symbol:{"status":"qualified","raw_input_sha256":"a"*64,"acquired_at":"2026-10-22T06:00:00Z"}
                          for symbol in ("600519.SS","430047.BJ")}
                requested=sorted(list(admitted)+(["000858.SZ"] if self.partial_collection else []))
                outcomes={symbol:{"status":"qualified" if symbol in admitted else "deferred"} for symbol in requested}
                receipt={"schema":"mastermind.cn-yahoo-collection/v1",
                    "run_id":command[command.index("--run-id")+1],"finalized":True,
                    "completed_at":"2026-10-22T06:00:01Z","scope":"manifest",
                    "requested":len(requested),"requested_symbols":requested,
                    "scope_sha256":hashlib.sha256(json.dumps(requested,separators=(",",":")).encode()).hexdigest(),
                    "admitted":admitted,"outcomes":outcomes,
                    "counts":{"qualified":2,"fresh":0,"unavailable":0,"source_error":0,"deferred":int(self.partial_collection)},
                    "coverage_complete":not self.partial_collection}
                Path(command[command.index("--receipt")+1]).write_text(json.dumps(receipt))
            market=command[command.index("--market")+1] if "--market" in command else ("cn" if "_cn." in name else "hk")
            if name.startswith("collect_"):
                rc=1 if self.fail_collector==market else 0
            if name.startswith("gen_fund_") or name=="pull_cn_hk_intel.py":
                if name.startswith("gen_fund_"):
                    market="ca" if name == "gen_fund_us.py" and "--canada" in command else "cn" if name in ("gen_fund_cn.py","gen_fund_cn_yahoo.py") else "hk"
                stage=Path(command[command.index("--out")+1])
                suffix=".fund.json" if name.startswith("gen_fund_") else ".intel.json"
                schema="mastermind.fund/v1" if suffix==".fund.json" else "intel/v1"
                for ticker in (("600519.SS","430047.BJ") if market=="cn" else ("RY.TO","SHOP.TO") if market=="ca" else ("0700.HK","0005.HK")):
                    (stage/(ticker+suffix)).write_text(json.dumps({"ticker":ticker,"schema":schema}))
                rc=2 if self.fail_emitter==market else 0
        return subprocess.CompletedProcess(command,rc,stdout,"")

def test_failed_china_holds_only_china_while_hk_publishes(tmp_path):
    args=args_for(tmp_path)
    fake=FakeStages(fail_collector="cn")
    cn,rc_cn=rr.refresh_market(args,"cn",runner=fake)
    hk,rc_hk=rr.refresh_market(args,"hk",runner=fake)
    assert (rc_cn,rc_hk)==(1,0)
    assert cn["publication"]=="held" and hk["publication"]=="published"
    assert set(fake.remote)=={"0700.HK.fund.json","0005.HK.fund.json"}
    assert not any("gen_fund_cn.py" in call for call in fake.calls)

def test_publication_window_still_refuses_real_regional_transfer(tmp_path, monkeypatch):
    """The fixed noon fixture must not weaken the shipped overnight safety gate."""
    class BlackoutUtc(dt.datetime):
        @classmethod
        def now(cls, tz=None):
            if tz is dt.timezone.utc:
                return cls(2026, 10, 21, 21, 15, tzinfo=tz)
            return super().now(tz)
    monkeypatch.setattr(rr.dt, "datetime", BlackoutUtc)
    fake = FakeStages()
    outcome, code = rr.refresh_market(args_for(tmp_path), "hk", runner=fake)
    assert code == 1
    assert outcome["publication"] == "held"
    assert outcome["error"] == "publication window blocked (21:00–22:30 UTC)"
    assert not fake.remote


def test_partly_emitted_market_never_reaches_publication(tmp_path):
    fake=FakeStages(fail_emitter="hk")
    outcome,code=rr.refresh_market(args_for(tmp_path),"hk",runner=fake)
    assert code==1 and outcome["emission"]=="failed"
    assert not any(call[0] in ("rsync","ssh") for call in fake.calls)
    assert not (tmp_path/"data").exists()

def test_partial_transfer_retains_candidates_and_fences_next_run(tmp_path):
    args=args_for(tmp_path)
    fake=FakeStages(transfer="partial")
    outcome,code=rr.refresh_market(args,"hk",runner=fake)
    assert code==1 and outcome["publication"]=="partially_applied"
    pending=outcome["pending_publication"]
    assert Path(pending["receipt"]).is_file()
    assert all((Path(pending["stage"])/name).is_file() for name in pending["candidate_sha256"])
    rr.record_outcome(args.status,args.run_id,"hk",args.phase,outcome)
    fake.calls=[]
    again,code=rr.refresh_market(args,"hk",runner=fake)
    assert code==1 and again["publication"]=="partially_applied"
    assert [call[0] for call in fake.calls]==["ssh"]
    assert not (tmp_path/"data").exists()

def test_completed_remote_transfer_is_reconciled_without_replay(tmp_path):
    args=args_for(tmp_path)
    fake=FakeStages(transfer="partial")
    outcome,_=rr.refresh_market(args,"hk",runner=fake)
    pending=outcome["pending_publication"]
    fake.remote.update(pending["candidate_sha256"])
    rr.record_outcome(args.status,args.run_id,"hk",args.phase,outcome)
    fake.calls=[]
    args.run_id="next-run"
    fake.fail_collector="hk"
    reconciled,code=rr.refresh_market(args,"hk",runner=fake)
    assert code==1 and reconciled["publication"]=="held"
    assert reconciled["reconciled_publication"]["run_id"]=="test-run"
    assert reconciled["collection"]=="failed"
    assert fake.calls[0][0]=="ssh"
    assert not any(call[0]=="rsync" for call in fake.calls)
    persisted=rr._read_phase(args,"hk")
    assert persisted["run_id"]=="test-run" and persisted["last_success"] is None
    assert not persisted.get("pending_publication")
    assert set(path.name for path in (tmp_path/"data").glob("*.json"))==set(fake.remote)

def test_disabled_china_has_no_provider_attempt(tmp_path,monkeypatch):
    monkeypatch.setenv("MM_CN_SOURCE_DISABLED","1")
    fake=FakeStages()
    outcome,code=rr.refresh_market(args_for(tmp_path),"cn",runner=fake)
    assert code==1 and outcome["collection"]=="source_disabled" and not fake.calls

def test_dry_run_cannot_write_a_success_stamp_or_artifact(tmp_path):
    args=args_for(tmp_path); args.dry_run=True
    outcome,code=rr.refresh_market(args,"cn",runner=FakeStages())
    assert code==0 and outcome["publication"]=="dry_run"
    assert not Path(args.status).exists() and not Path(args.data).exists()

def test_statement_family_merge_preserves_history_without_field_coalescing():
    identity={"schema":"mastermind.fund/v1","ticker":"ATS.TO","stmt_currency":"CAD","src":{"statements":"yfinance"}}
    old={**identity,"statements":{"annual":{"periods":["FY2024","FY2025"],"period_end":["2024-03-31","2025-03-31"],
            "income":{"revenue":[80,100],"eps_basic":[1,2]},"balance":{"cash":[5,7]}},
            "quarterly":None}}
    fresh={**identity,"statements":{"annual":{"periods":["FY2025","FY2026"],"period_end":["2025-03-31","2026-03-31"],
            "income":{"revenue":[110,140],"eps_basic":[None,3]},"balance":{}},"quarterly":None}}
    merged=merge_statement_history(fresh,old)
    block=merged["statements"]["annual"]
    assert block["period_end"]==["2024-03-31","2025-03-31","2026-03-31"]
    assert block["income"]["eps_basic"]==[1,None,3]  # no borrowing old EPS into a new filing
    assert block["balance"]["cash"]==[5,7,None]
    assert block["period_provenance"]["income"][0]=={"origin":"retained_history","acquired_at":None,"scope":"legacy_unknown"}
    assert len(annual_earnings_from_statements(merged))==3
    assert merge_statement_history(merged,old)==merged
    changed=copy.deepcopy(fresh);changed["stmt_currency"]="USD"
    with pytest.raises(ValueError,match="stmt_currency"):
        merge_statement_history(changed,old)

def test_sparse_cn_income_does_not_drop_annual_or_q1_actuals():
    from ingest.gen_fund_cn import _merge_fund
    identity={"schema":"mastermind.fund/v1","ticker":"600519.SS","stmt_currency":"CNY","src":{"statements":"tushare"}}
    old={**identity,"statements":{"annual":{"periods":["FY2025"],"period_end":["2025-12-31"],
        "income":{"revenue":[1000],"eps_basic":[20]}},"quarterly":{"periods":["Q1 2026"],
        "period_end":["2026-03-31"],"income":{"revenue":[250],"eps_basic":[5]}}}}
    fresh={**identity,"statements":{"annual":None,"quarterly":{"periods":["Q2 2026"],"period_end":["2026-06-30"],
        "income":{"revenue":[550],"eps_basic":[11]}}},"earnings":{"q":[{"period":"Q2 2026","end":"2026-06-30",
        "eps_a":None,"rev_a":None,"eps_basis":"discrete_eps_unavailable"}],"fy":[]}}
    result=_merge_fund(fresh,old)
    assert result["earnings"]["fy"][0]["eps_a"]==20
    assert [row["eps_a"] for row in result["earnings"]["q"]]==[5,None]
    assert result["earnings"]["fy"][0]["actuals_provenance"]["scope"]=="legacy_unknown"

@pytest.mark.parametrize("flag",[None,"1"])
def test_unknown_or_corrected_comparatives_do_not_support_a_quarter_bridge(flag):
    q1={"report_type":"1","end_date":"20260331","ann_date":"20260420","comp_type":"1","update_flag":flag}
    q2={**q1,"end_date":"20260630","ann_date":"20260820"}
    assert not rules.compatible_cumulative_rows(q2,q1)
    q1["update_flag"]=q2["update_flag"]="0"
    assert rules.compatible_cumulative_rows(q2,q1)

def test_deadline_does_not_roll_over_after_the_daily_cutoff():
    assert daily_budget(dt.datetime(2026,10,22,16,0))==1800
    assert daily_budget(dt.datetime(2026,10,22,17,14,59))==1
    assert daily_budget(dt.datetime(2026,10,22,17,15))==0
    assert daily_budget(dt.datetime(2026,10,22,23,0))==0

def test_deadline_terminates_a_process_that_ignores_term(tmp_path):
    pidfile=tmp_path/"child.pid"
    program="import os,signal,time,pathlib;signal.signal(signal.SIGTERM,signal.SIG_IGN);pathlib.Path(%r).write_text(str(os.getpid()));time.sleep(60)"%str(pidfile)
    start=time.monotonic()
    assert run_bounded([sys.executable,"-c",program],.3,grace=.1)==124
    assert time.monotonic()-start<3
    with pytest.raises(ProcessLookupError):
        os.kill(int(pidfile.read_text()),0)

def test_stale_or_unidentified_lock_is_never_reclaimed(tmp_path):
    lock=tmp_path/"lock"; lock.mkdir(); (lock/"pid").write_text("99999999\n")
    env={**os.environ,"LOCK_DIR":str(lock)}
    program='. "$1"; acquire_fund_writer_lock 0; exit $?'
    result=subprocess.run(["bash","-c",program,"lock-test",str(ROOT/"ops/fund_writer_lock.sh")],env=env)
    assert result.returncode==10 and (lock/"pid").read_text()=="99999999\n"

def test_only_one_concurrent_writer_enters(tmp_path):
    lock=tmp_path/"lock"; entered=tmp_path/"entered"
    script=tmp_path/"writer.sh"
    script.write_text('. "$1"\nacquire_fund_writer_lock 0 || exit $?\ntrap release_fund_writer_lock EXIT\nprintf "%s\\n" "$$" >> "$2"\nsleep 0.3\n')
    env={**os.environ,"LOCK_DIR":str(lock)}
    command=["bash",str(script),str(ROOT/"ops/fund_writer_lock.sh"),str(entered)]
    a=subprocess.Popen(command,env=env);b=subprocess.Popen(command,env=env)
    assert sorted((a.wait(),b.wait()))==[0,10]
    assert len(entered.read_text().splitlines())==1 and not lock.exists()

def test_hk_total_failure_retains_cache_and_fails(tmp_path,monkeypatch):
    from ingest import collect_cn_hk_fund as hk
    cache=tmp_path/"0700.HK.json"; cache.write_text('{"ticker":"0700.HK","financials":{"income":[{"end":"2025-12-31"}]}}')
    before=cache.read_bytes()
    monkeypatch.setattr(hk,"HK_OUT",tmp_path)
    monkeypatch.setattr(hk,"_fetch_hk",lambda *a,**k:None)
    with pytest.raises(hk.UpstreamError):
        hk.collect_hk_fund(["0700.HK"],True)
    assert cache.read_bytes()==before

def raw_holder(ticker="0700.HK",stamp="2026-10-21T01:00:00Z"):
    return {"ticker":ticker,"fetched_at":stamp,"_errors":[],"institutional_holders":{
        "columns":["Holder","Date Reported","Shares","pctHeld"],
        "data":[["Manager","2026-06-30",100,0.01]]}}

def test_hk_holder_cache_failure_keeps_source_clock_and_separate_attempt(tmp_path):
    from ingest.collect_reported_ownership import collect
    payload=raw_holder();cache=tmp_path/"0700.HK.json";cache.write_text(json.dumps(payload));before=cache.read_bytes()
    def fail(_): raise TimeoutError("not exposed")
    counts=collect(["0700.HK"],tmp_path,stale_days=0,delay=(0,0),fetcher=fail)
    assert counts["source_error"]==1 and cache.read_bytes()==before
    attempt=json.loads((tmp_path/"_attempts/0700.HK.json").read_text())
    assert attempt["reason"]=="fetch_field_error" and "not exposed" not in json.dumps(attempt)

def test_ownership_failed_or_older_observation_keeps_qualified_previous():
    prior_raw=raw_holder("RY.TO")
    previous=ro.build_reported_ownership(json.dumps(prior_raw).encode(),expected_ticker="RY.TO")
    for raw in (b"[]",json.dumps({**prior_raw,"_errors":["institutional_holders:TimeoutError"],
                                 "fetched_at":"2026-10-22T01:00:00Z"}).encode(),
                json.dumps({**prior_raw,"fetched_at":"2026-09-01T01:00:00Z"}).encode()):
        block=ro.build_reported_ownership(raw,expected_ticker="RY.TO",previous=previous,
                                         latest_attempt_at="2026-10-22T02:00:00Z")
        assert block["rows"]==previous["rows"]
        assert block["acquired_at"]==previous["acquired_at"]
        assert block["raw_input_sha256"]==previous["raw_input_sha256"]
        assert block["availability"]=="partial"

@pytest.mark.parametrize("field,value",[("percentage_basis","fraction_of_float"),("normalizer_version","2"),
                                       ("population","beneficial_owners")])
def test_incompatible_previous_ownership_is_not_relabelled(field,value):
    previous=ro.build_reported_ownership(json.dumps(raw_holder("RY.TO")).encode(),expected_ticker="RY.TO")
    previous[field]=value;previous["content_sha256"]=ro.content_sha256(previous)
    block=ro.build_reported_ownership(b"[]",expected_ticker="RY.TO",previous=previous)
    assert block["rows"]==[] and block["acquired_at"] is None


def test_unchanged_owner_cache_cannot_erase_later_failure():
    raw=json.dumps(raw_holder("RY.TO", "2026-10-01T01:00:00Z")).encode()
    first=ro.build_reported_ownership(raw,expected_ticker="RY.TO")
    degraded=ro.build_reported_ownership(b"[]",expected_ticker="RY.TO",previous=first,
        latest_attempt_at="2026-10-20T01:00:00Z")
    again=ro.build_reported_ownership(raw,expected_ticker="RY.TO",previous=degraded)
    assert again==degraded
    later=json.dumps(raw_holder("RY.TO", "2026-10-21T01:00:00Z")).encode()
    recovered=ro.build_reported_ownership(later,expected_ticker="RY.TO",previous=degraded)
    assert recovered["availability"]=="available"
    assert recovered["latest_attempt_at"]=="2026-10-21T01:00:00Z"


def test_prior_owner_with_unknown_reason_is_not_requalified():
    raw=json.dumps(raw_holder("RY.TO")).encode()
    previous=ro.build_reported_ownership(raw,expected_ticker="RY.TO")
    previous.update(availability="partial",unavailable_reason="future_unknown_reason")
    previous=ro._seal(previous)
    assert not ro.build_reported_ownership(b"[]",expected_ticker="RY.TO",previous=previous)["rows"]


def test_explicit_yahoo_fund_mode_bypasses_disabled_tushare_only_for_fund(tmp_path,monkeypatch):
    monkeypatch.setenv("MM_CN_SOURCE_DISABLED","1")
    monkeypatch.setenv("MM_CN_FUND_SOURCE","yahoo")
    args=args_for(tmp_path); fake=FakeStages()
    outcome,code=rr.refresh_market(args,"cn",runner=fake)
    assert code==0 and outcome["source_mode"]=="yahoo_append_only"
    assert any(any(part.endswith("collect_cn_yahoo.py") for part in call) for call in fake.calls)
    assert not any(any(part.endswith("collect_cn_hk_fund.py") for part in call) for call in fake.calls)
    args.phase="intel"; fake.calls=[]
    outcome,code=rr.refresh_market(args,"cn",runner=fake)
    assert code==1 and outcome["collection"]=="source_disabled" and fake.calls==[]


def test_partial_fallback_publication_keeps_refresh_success_clock(tmp_path,monkeypatch):
    monkeypatch.setenv("MM_CN_FUND_SOURCE","yahoo")
    args=args_for(tmp_path);fake=FakeStages(partial_collection=True)
    rr.record_outcome(args.status,"previous","cn","fund",{"collection":"completed","publication":"published"})
    before=rr._read_phase(args,"cn")["last_success"]
    outcome,code=rr.refresh_market(args,"cn",runner=fake)
    rr.record_outcome(args.status,args.run_id,"cn","fund",outcome)
    after=rr._read_phase(args,"cn")
    assert code==1 and outcome["collection"]=="partial" and outcome["publication"]=="published"
    assert outcome["source_counts"]["deferred"]==1
    assert after["last_success"]==before and after["last_publication"]
    assert set(fake.remote)=={"600519.SS.fund.json","430047.BJ.fund.json"}


@pytest.mark.parametrize("market,symbol", [("hk", "0700.HK"), ("ca", "RY.TO")])
@pytest.mark.parametrize("local_baseline", [None, "older"])
def test_served_history_must_match_exact_emitter_baseline(tmp_path, local_baseline, market, symbol):
    args = args_for(tmp_path)
    fake = FakeStages()
    args.skip_collect = market == "ca"
    fake.remote[symbol + ".fund.json"] = hashlib.sha256(b"richer served history").hexdigest()
    if local_baseline:
        Path(args.data).mkdir()
        (Path(args.data) / (symbol + ".fund.json")).write_text(local_baseline)
    outcome, code = rr.refresh_market(args, market, runner=fake)
    assert code == 1 and outcome["publication"] == "baseline_mismatch"
    assert not any(call[0] == "rsync" for call in fake.calls)
    assert not outcome.get("pending_publication")


@pytest.mark.parametrize("market,symbol,emitter_name", [("hk", "0700.HK", "gen_fund_hk.py"), ("ca", "RY.TO", "gen_fund_us.py")])
def test_publication_retains_hash_bound_prior_bytes_for_rollback(tmp_path, market, symbol, emitter_name):
    args = args_for(tmp_path)
    args.skip_collect = market == "ca"
    Path(args.data).mkdir()
    original = json.dumps({"ticker":symbol,"schema":"mastermind.fund/v1","history":"preserve me"}).encode()
    path = Path(args.data) / (symbol + ".fund.json")
    path.write_bytes(original)
    fake = FakeStages()
    fake.remote[path.name] = hashlib.sha256(original).hexdigest()
    outcome, code = rr.refresh_market(args, market, runner=fake)
    assert code == 0
    receipt = json.loads(Path(outcome["publication_receipt"]).read_text())
    assert (Path(receipt["previous_artifact_dir"]) / path.name).read_bytes() == original
    assert receipt["before_sha256"][path.name] == hashlib.sha256(original).hexdigest()
    emitter = next(call for call in fake.calls if any(part.endswith(emitter_name) for part in call))
    assert emitter[emitter.index("--previous-dir") + 1] != args.data
    assert path.read_bytes() != original


def test_hk_retry_starts_with_unattempted_names_and_preserves_failed_status(tmp_path):
    from ingest.collect_reported_ownership import collect, atomic_json, utc_now
    atomic_json(tmp_path / "_attempts" / "0005.HK.json",
                {"availability": "source_error", "attempted_at": utc_now()})
    calls = []
    def fetcher(symbol):
        calls.append(symbol)
        return raw_holder(symbol, utc_now())
    counts = collect(["0005.HK", "0700.HK"], tmp_path, delay=(0, 0), fetcher=fetcher)
    assert calls == ["0700.HK"]
    assert counts["source_error"] == 1 and counts["available"] == 1


def test_failed_attempt_keeps_both_verified_clocks(tmp_path):
    args = args_for(tmp_path)
    rr.record_outcome(args.status, "old", "ca", "fund", {"collection":"completed","publication":"published"})
    before = rr._read_phase(args, "ca")
    rr.record_outcome(args.status, "new", "ca", "fund", {"collection":"failed","publication":"held"})
    after = rr._read_phase(args, "ca")
    assert after["last_success"] == before["last_success"]
    assert after["last_publication"] == before["last_publication"]


def test_canada_publication_uses_existing_cache_without_claiming_collection(tmp_path):
    args = args_for(tmp_path)
    args.skip_collect = True
    fake = FakeStages()
    outcome, code = rr.refresh_market(args, "ca", runner=fake)
    rr.record_outcome(args.status, args.run_id, "ca", "fund", outcome)
    assert code == 0 and outcome["collection"] == "explicitly_skipped"
    assert set(fake.remote) == {"RY.TO.fund.json", "SHOP.TO.fund.json"}
    assert not any(any("collect_" in part for part in call) for call in fake.calls)
    status = rr._read_phase(args, "ca")
    assert status["last_success"] is None and status["last_publication"]


def test_canada_cannot_start_another_collector_or_intelligence_pipeline(tmp_path):
    args = args_for(tmp_path)
    fake = FakeStages()
    outcome, code = rr.refresh_market(args, "ca", runner=fake)
    assert code == 1 and fake.calls == []
    args.skip_collect = True
    args.phase = "intel"
    outcome, code = rr.refresh_market(args, "ca", runner=fake)
    assert code == 1 and fake.calls == []


@pytest.mark.parametrize("defect", ["lost_period", "currency", "duration", "duplicate_period", "unaligned"])
def test_publication_refuses_history_loss_or_incompatible_period_identity(tmp_path, defect):
    args = args_for(tmp_path)
    previous_dir = tmp_path / "before"
    stage = tmp_path / "stage"
    previous_dir.mkdir(); stage.mkdir()
    symbol = "0700.HK"
    name = symbol + ".fund.json"
    prior = {"schema":"mastermind.fund/v1","ticker":symbol,"stmt_currency":"CNY","quote_currency":"HKD",
             "statements":{"annual":None,"quarterly":{"periods":["H1 2025","H1 2026"],
                 "period_end":["2025-06-30","2026-06-30"],"period_duration_months":[6,6],
                 "flow_basis":"cumulative","income":{"revenue":[100,120]}}}}
    candidate = copy.deepcopy(prior)
    q = candidate["statements"]["quarterly"]
    if defect == "lost_period":
        q.update(periods=["H1 2026"], period_end=["2026-06-30"], period_duration_months=[6])
    if defect == "currency": candidate["stmt_currency"] = "HKD"
    if defect == "duration": q["period_duration_months"][1] = 3
    if defect == "duplicate_period": q["period_end"][1] = q["period_end"][0]
    if defect == "unaligned": q["periods"].pop()
    (previous_dir / name).write_text(json.dumps(prior))
    (stage / name).write_text(json.dumps(candidate))
    fake = FakeStages()
    hashes = {name:hashlib.sha256((previous_dir/name).read_bytes()).hexdigest()}
    fake.remote.update(hashes)
    with pytest.raises(ValueError):
        rr.publish_stage(args,"hk",stage,[stage/name],{"collection":"completed","publication":"held"},
                         previous_dir=previous_dir,previous_sha256=hashes,runner=fake)
    assert not any(call[0] == "rsync" for call in fake.calls)
    assert fake.remote == hashes


def test_hk_unreadable_incumbent_cannot_be_replaced_by_a_fresh_emission(tmp_path, monkeypatch):
    from ingest import gen_fund_hk as hk
    cache = tmp_path / "cache"; cache.mkdir()
    previous = tmp_path / "previous"; previous.mkdir()
    out = tmp_path / "out"
    (cache / "0700.HK.json").write_text("{}")
    old = previous / "0700.HK.fund.json"
    old.write_text('{"statements":')
    monkeypatch.setattr(hk, "HK_FUND", cache)
    monkeypatch.setattr(hk, "MACRO", tmp_path)
    monkeypatch.setattr(hk, "build_fund", lambda *a: {"schema":"mastermind.fund/v1","ticker":"0700.HK"})
    assert hk.main(["--only","0700.HK","--out",str(out),"--previous-dir",str(previous)]) == 1
    assert not (out / old.name).exists()
    assert old.read_text() == '{"statements":'


def test_unknown_currency_only_permits_an_exactly_retained_statement_view():
    previous = {"schema":"mastermind.fund/v1","ticker":"9997.HK","stmt_currency":None,
                "statements":{"annual":{"periods":["FY2025"],"period_end":["2025-12-31"],
                    "income":{"revenue":[10]}}}}
    same = copy.deepcopy(previous);same["ownership"] = {"reported":{"rows":[]}}
    rr.validate_retained_history(same,previous)
    changed = copy.deepcopy(same);changed["statements"]["annual"]["income"]["revenue"][0]=11
    with pytest.raises(ValueError,match="known incumbent currency"):
        rr.validate_retained_history(changed,previous)
    changed = copy.deepcopy(same);changed["stmt_currency"]="HKD"
    with pytest.raises(ValueError,match="known incumbent currency"):
        rr.validate_retained_history(changed,previous)


def test_unknown_currency_cannot_add_a_previously_absent_statement_family():
    previous = {"schema":"mastermind.fund/v1","ticker":"9997.HK","stmt_currency":None,
                "statements":{"annual":{"periods":["FY2025"],"period_end":["2025-12-31"],
                    "income":{"revenue":[10]}},"quarterly":None}}
    candidate = copy.deepcopy(previous)
    candidate["statements"]["quarterly"] = {"periods":["H1 2026"],"period_end":["2026-06-30"],
                                             "income":{"revenue":[6]}}
    with pytest.raises(ValueError,match="known incumbent currency"):
        rr.validate_retained_history(candidate,previous)
