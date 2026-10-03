from copy import deepcopy
import json
import pytest
from signal_layer.mtf_robustness import BASELINE_RULE, robustness_report


def event(day, net=.04, benchmark=.01, end=None):
    return {"decision_session": f"2025-{day}T00:00:00",
            "entry_time": f"2025-{day[:3]}{int(day[3:])+1:02d}T00:00:00",
            "label_end_5": f"2025-{end or day[:3]+str(int(day[3:])+5).zfill(2)}T00:00:00",
            "net_return_5": net, "benchmark_net_return": benchmark,
            "arithmetic_excess_return": net-benchmark, "benchmark_state": "paired"}


def row(symbol, rule, events):
    return {"symbol": symbol, "rule": rule, "horizon": 5,
            "entry_bps": 5, "exit_bps": 5, "benchmark_symbol": "SPY", "events": events}


def fixture():
    rows=[]
    for sym, value in (("AAA", .03), ("BBB", .07)):
        rows.append(row(sym, BASELINE_RULE, [event(f"{m:02d}-02", .01) for m in (1, 2, 3)]))
        rows.append(row(sym, "mtf", [event(f"{m:02d}-03", value) for m in (1, 2, 3)]))
    return rows


def report(rows=None, names=None):
    return robustness_report(fixture() if rows is None else rows,
                             requested_symbols=names or ["AAA", "BBB", "MISSING"],
                             reserved_holdout_start="2026-01-01")


def candidate(out):
    return next(r for r in out["rules"] if r["rule"]=="mtf")


def test_equal_ticker_arithmetic_and_fixed_support():
    out=report(); c=candidate(out)
    assert c["full_comparison"]["difference_from_baseline"]==pytest.approx(.04)
    assert c["common_baseline_tickers"]==["AAA", "BBB"]
    assert c["missing_or_zero_pair_tickers"]==["MISSING"]
    assert c["leave_one_ticker_out"]["summary"]["minimum"]==pytest.approx(.02)
    assert c["leave_one_ticker_out"]["summary"]["maximum"]==pytest.approx(.06)
    assert c["leave_one_calendar_month_out"]["summary"]["comparable"]==3
    assert c["leave_one_calendar_month_out"]["summary"]["minimum"]==pytest.approx(.04)


def test_deletes_outcome_overlap_not_only_entry_month():
    rows=fixture()
    rows[1]["events"][0]=event("01-28", .03, end="02-05")
    c=candidate(report(rows))
    feb=next(v for v in c["leave_one_calendar_month_out"]["cases"] if v["excluded_calendar_month"]=="2025-02")
    assert feb["rule_events_retained"]==3  # Jan AAA overlaps Feb as well as two Feb events.
    assert c["outcome_month_overlap_counts"]["2025-02"]==3


def test_missing_support_never_silently_becomes_a_better_comparison():
    rows=fixture()
    rows[1]["events"]=rows[1]["events"][:1]
    c=candidate(report(rows))
    january=c["leave_one_calendar_month_out"]["cases"][0]
    assert january["state"]=="insufficient_common_support"
    assert january["difference_from_baseline"] is None
    assert january["lost_ticker_support"]==["AAA"]
    assert c["leave_one_calendar_month_out"]["summary"]["incomparable"]==1


def test_single_ticker_is_not_fake_leave_one_out_evidence():
    rows=fixture()[:2]
    c=candidate(report(rows,["AAA"]))
    assert c["leave_one_ticker_out"]["summary"]["comparable"]==0
    assert c["leave_one_ticker_out"]["summary"]["minimum"] is None


def test_null_and_zero_event_rules_remain_visible():
    unresolved={"decision_session":"2025-12-31", "entry_time":None,
                "label_end_5":None,"net_return_5":None,"benchmark_net_return":None,
                "arithmetic_excess_return":None,"benchmark_state":"unresolved_ticker_outcome"}
    rows=fixture()+[row("AAA","no_events",[]),row("BBB","unresolved",[unresolved])]
    out=report(rows)
    for rule in ("no_events","unresolved"):
        r=next(r for r in out["rules"] if r["rule"]==rule)
        assert r["paired_events"]==0
        assert r["full_comparison"]["difference_from_baseline"] is None
    assert next(r for r in out["rules"] if r["rule"]=="unresolved")["selected_events"]==1


def test_concentration_counts_are_not_independent_sample_estimates():
    out=report(); c=candidate(out)
    assert c["unique_decision_dates"]==3
    assert c["maximum_same_decision_date_share"]==pytest.approx(1/3)
    assert out["confidence_interval"] is None
    assert out["effective_independent_sample_size"] is None
    assert out["production_rank_authority"] is False
    assert out["trade_authority"] is False
    assert out["holdout_consumed"] is False


def test_no_mutation_and_deterministic_strict_json():
    rows=fixture(); before=deepcopy(rows)
    a=report(rows); b=report(rows)
    assert a==b and rows==before
    json.dumps(a,allow_nan=False)
    changed=deepcopy(rows); changed[1]["events"][0]["net_return_5"]+=.1
    changed[1]["events"][0]["arithmetic_excess_return"]+=.1
    assert report(changed)["input_sha256"]!=a["input_sha256"]


@pytest.mark.parametrize("key,value",[("horizon",21),("entry_bps",25),("exit_bps",0),("benchmark_symbol","QQQ")])
def test_pooled_cells_rejected(key,value):
    rows=fixture(); rows[1][key]=value
    with pytest.raises(ValueError,match="pool"):
        report(rows)


@pytest.mark.parametrize("key,value",[("decision_session","2026-01-01"),
                                      ("entry_time","2026-01-01"),
                                      ("label_end_5","2026-01-01")])
def test_holdout_never_used(key,value):
    rows=fixture(); rows[1]["events"][-1][key]=value
    with pytest.raises(ValueError,match="holdout"):
        report(rows)


@pytest.mark.parametrize("key,value",[("decision_session","2025-01-03T12:01:00"),
                                      ("entry_time","2025-01-04T00:00:00Z"),
                                      ("label_end_5","2025-01-02")])
def test_bad_event_clocks_rejected(key,value):
    rows=fixture(); rows[1]["events"][0][key]=value
    with pytest.raises(ValueError): report(rows)


@pytest.mark.parametrize("key,value",[("arithmetic_excess_return",.9),
                                      ("arithmetic_excess_return",float("nan")),
                                      ("net_return_5",True),("benchmark_net_return",-1.1),
                                      ("benchmark_state","made_up"),("entry_time",None)])
def test_forged_pairing_not_accepted(key,value):
    rows=fixture(); rows[1]["events"][0][key]=value
    with pytest.raises(ValueError): report(rows)


def test_duplicate_or_unsorted_observations_rejected():
    rows=fixture(); rows[0]["events"].append(rows[0]["events"][0])
    with pytest.raises(ValueError,match="unique and ordered"): report(rows)
    rows=fixture()+[fixture()[0]]
    with pytest.raises(ValueError,match="repeated"): report(rows)


def test_no_baseline_not_inferred_from_best_rule():
    with pytest.raises(ValueError,match="baseline"):
        report([r for r in fixture() if r["rule"]!=BASELINE_RULE])


def test_negative_excess_below_minus_one_is_valid_for_high_benchmark_return():
    rows=fixture(); rows[1]["events"][0]=event("01-03",net=-.5,benchmark=2)
    assert candidate(report(rows))["full_comparison"]["difference_from_baseline"]<0


def test_group_sensitivity_detects_one_episode_driving_positive_mean():
    rows=fixture()
    for r in rows:
        if r["rule"]=="mtf":
            r["events"]=[event("01-03",.20),event("02-03",-.04),event("03-03",-.04)]
    c=candidate(report(rows))
    assert c["full_comparison"]["difference_from_baseline"]>0
    assert c["leave_one_calendar_month_out"]["summary"]["minimum"]<0
    assert c["leave_one_calendar_month_out"]["summary"]["negative"]==1
