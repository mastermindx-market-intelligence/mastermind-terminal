from copy import deepcopy
import pandas as pd
import pytest
from signal_layer.mtf_panel import pair_benchmark_events, equal_ticker_rule_summary, summarize_paired_events


def benchmark():
    x = pd.DataFrame({'entry_time': pd.to_datetime(['2020-01-03','2020-01-06']),
                      'label_end_2': pd.to_datetime(['2020-01-06','2020-01-07']),
                      'net_return_2': [.10,-.20]}, index=pd.to_datetime(['2020-01-02','2020-01-03']))
    x.attrs = {'execution':'next_observed_session_open_to_hth_session_close',
               'costs':{'entry_bps':5,'exit_bps':5}}
    return x


def event():
    return {'decision_session':'2020-01-02','entry_time':'2020-01-03',
            'label_end_2':'2020-01-06','net_return_2':.15}


def pair(es, b=None):
    return pair_benchmark_events(es, benchmark() if b is None else b, horizon=2,entry_bps=5,exit_bps=5)


def test_exact_windows_and_immutability():
    e=event(); saved=deepcopy(e)
    out=pair([e])
    assert out[0]['benchmark_state']=='paired'
    assert out[0]['arithmetic_excess_return']==pytest.approx(.05)
    assert e==saved
    assert summarize_paired_events(out)['paired']==1


@pytest.mark.parametrize('changes,state', [
    ({'decision_session':'2020-01-01'},'missing_benchmark_decision'),
    ({'entry_time':'2020-01-04'},'execution_window_mismatch'),
    ({'label_end_2':'2020-01-07'},'execution_window_mismatch'),
    ({'net_return_2':None,'label_end_2':None},'unresolved_ticker_outcome'),
])
def test_never_fills_or_drops_unpaired_events(changes,state):
    out=pair([{**event(),**changes}])
    assert len(out)==1 and out[0]['benchmark_state']==state
    assert out[0]['arithmetic_excess_return'] is None
    assert summarize_paired_events(out)['paired']==0


def test_missing_benchmark_label_is_retained():
    b=benchmark(); b.loc[b.index[0],'label_end_2']=pd.NaT
    assert pair([event()],b)[0]['benchmark_state']=='unresolved_benchmark_outcome'


@pytest.mark.parametrize('value',[float('inf'),float('-inf'),True,-1.01])
def test_invalid_ticker_returns_fail(value):
    with pytest.raises(ValueError): pair([{**event(),'net_return_2':value}])


def test_invalid_benchmark_returns_fail():
    b=benchmark(); b.loc[b.index[0],'net_return_2']=float('inf')
    with pytest.raises(ValueError): pair([event()],b)


def test_cost_and_execution_contracts_fail_closed():
    for change in ({'costs':{'entry_bps':0,'exit_bps':0}}, {'execution':'same_close'}):
        b=benchmark(); b.attrs.update(change)
        with pytest.raises(ValueError): pair([event()],b)


@pytest.mark.parametrize('date',['2020-01-02T12:00:00','2020-01-02T00:00:00Z',3,None])
def test_bad_decision_dates_fail(date):
    with pytest.raises(ValueError): pair([{**event(),'decision_session':date}])


def test_duplicates_and_bad_maturity_fail():
    with pytest.raises(ValueError): pair([event(),event()])
    with pytest.raises(ValueError): pair([{**event(),'entry_time':'2020-01-01'}])
    b=pd.concat([benchmark(),benchmark()]); b.attrs=benchmark().attrs
    with pytest.raises(ValueError): pair([event()],b)


def row(sym,rule,values):
    return {'symbol':sym,'rule':rule,'horizon':2,'entry_bps':5,'exit_bps':5,'benchmark_symbol':'SPY',
            'events':[{'benchmark_state':'paired','arithmetic_excess_return':v} for v in values]}


def test_equal_ticker_weight_not_sample_volume_weight():
    rows=[row('A','base',[0]*50),row('B','base',[0]),row('A','mtf',[.1]*100),row('B','mtf',[-.3])]
    out=equal_ticker_rule_summary(rows,requested_symbols=['A','B','MISSING'],baseline_rule='base')
    mtf=next(r for r in out['rules'] if r['rule']=='mtf')
    assert mtf['equal_ticker_mean_excess']==pytest.approx(-.1)
    assert mtf['equal_ticker_difference_from_baseline']==pytest.approx(-.1)
    assert mtf['paired_events']==101
    assert mtf['tickers_beating_baseline']==1
    assert mtf['missing_or_zero_pair_tickers']==['MISSING']
    assert out['production_rank_authority'] is False


def test_zero_event_rules_and_common_baseline_names_are_explicit():
    rows=[row('A','base',[.1]),row('B','base',[]),row('A','mtf',[]),row('B','mtf',[.3]),row('A','rare',[])]
    out=equal_ticker_rule_summary(rows,requested_symbols=['A','B'],baseline_rule='base')
    mtf=next(r for r in out['rules'] if r['rule']=='mtf')
    rare=next(r for r in out['rules'] if r['rule']=='rare')
    assert mtf['common_baseline_tickers']==[]
    assert mtf['equal_ticker_difference_from_baseline'] is None
    assert rare['paired_events']==0 and rare['equal_ticker_mean_excess'] is None


def test_mixed_cells_and_duplicate_symbols_fail():
    rows=[row('A','base',[0]),row('A','mtf',[.1])]
    with pytest.raises(ValueError): equal_ticker_rule_summary(rows,requested_symbols=['A','A'],baseline_rule='base')
    with pytest.raises(ValueError): equal_ticker_rule_summary(rows+[rows[0]],requested_symbols=['A'],baseline_rule='base')
    rows[1]['entry_bps']=25
    with pytest.raises(ValueError): equal_ticker_rule_summary(rows,requested_symbols=['A'],baseline_rule='base')


def test_bad_summary_cannot_imply_paired_performance():
    with pytest.raises(ValueError): summarize_paired_events([{'benchmark_state':'paired','arithmetic_excess_return':None}])
    with pytest.raises(ValueError): summarize_paired_events([{'benchmark_state':'missing','arithmetic_excess_return':.1}])


@pytest.mark.parametrize("cost",[True,float("nan"),-1,10000])
def test_invalid_costs_fail(cost):
    with pytest.raises(ValueError):
        pair_benchmark_events([event()],benchmark(),horizon=2,entry_bps=cost,exit_bps=5)
