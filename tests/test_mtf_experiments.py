import json
import numpy as np
import pandas as pd
import pytest
from signal_layer.mtf_experiments import RULES, compare_entry_rules
from signal_layer.mtf_evaluation import outcome_frame, walk_forward_events
from signal_layer.mtf_confluence import feature_frame


def data(n=2300):
    i=np.arange(n)
    c=100*np.exp(.0001*i+.15*np.sin(i/25)+.03*np.cos(i/6))
    o=c*(1+.005*np.sin(i/13))
    return pd.DataFrame({"open":o,"high":np.maximum(c,o)*1.02,
                         "low":np.minimum(c,o)*.98,"close":c},
                         index=pd.bdate_range("2011-01-03",periods=n))


def study(x, **kwargs):
    return compare_entry_rules(x,bar_anchor=0,evaluation_end=x.index[-1],
                              horizons=(5,21),cost_bps=(0,25),min_train_years=2,min_train_rows=100,**kwargs)


def test_every_predeclared_trial_is_retained_without_selecting_a_winner():
    r=study(data())
    assert r["trial_count"] == len(RULES)*2*2 == 24
    assert set(t["rule"] for t in r["trials"]) == set(RULES)
    assert all("folds" in t and "summary" in t for t in r["trials"])
    assert r["common_coverage_sessions"]>100
    assert r["selection_adjustment"]["pbo"] is None
    assert not r["production_rank_authority"]
    json.dumps(r, allow_nan=False)


def test_costs_do_not_move_signals_and_cannot_improve_matched_returns():
    r=study(data())
    for rule in RULES:
        for h in (5,21):
            a=next(t for t in r["trials"] if t["rule"]==rule and t["horizon"]==h and t["entry_bps"]==0)
            b=next(t for t in r["trials"] if t["rule"]==rule and t["horizon"]==h and t["entry_bps"]==25)
            assert [v["decision_session"] for v in a["events"]] == [v["decision_session"] for v in b["events"]]
            for left,right in zip(a["events"],b["events"]):
                if left[f"net_return_{h}"] is not None:
                    assert right[f"net_return_{h}"] < left[f"net_return_{h}"]


def test_final_holdout_changes_cannot_change_any_development_result():
    x=data()
    cutoff=x.index[1900]
    r=study(x,holdout_start=cutoff)
    altered=x.copy()
    altered.loc[altered.index>=cutoff]*=2
    assert r == study(altered,holdout_start=cutoff)
    assert r["holdout_status"] == "not_consumed"
    assert pd.Timestamp(r["development_end"]) < cutoff
    for t in r["trials"]:
        for e in t["events"]:
            end=e[f'label_end_{t["horizon"]}']
            assert end is None or pd.Timestamp(end)<cutoff


def test_trigger_restricts_decisions_not_training_population():
    x=data()
    f=feature_frame(x)
    o=outcome_frame(x,(21,))
    kwargs=dict(min_train_years=2,min_train_rows=100)
    a,ea=walk_forward_events(f,o,**kwargs)
    trigger=pd.Series(False,index=x.index)
    b,eb=walk_forward_events(f,o,trigger=trigger,**kwargs)
    assert a.threshold.equals(b.threshold)
    assert len(ea)>0 and len(eb)==0


@pytest.mark.parametrize("costs", [[],[5,5],[True],[-5]])
def test_invalid_trial_costs_rejected(costs):
    x=data(20)
    with pytest.raises(ValueError):
        compare_entry_rules(x,bar_anchor=0,evaluation_end=x.index[-1],cost_bps=costs)
