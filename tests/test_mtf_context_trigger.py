import pandas as pd
from signal_layer.mtf_screener import context_trigger_snapshot, ScreenPolicy, screen_ticker
from test_mtf_screener import document, args

def point(**overrides):
    now=pd.Timestamp('2025-01-10')
    values={}
    for tf in ('d','3d','w','2w','1m'):
        values[f'{tf}_score']=60.0
        values[f'{tf}_phase']='bull'
        values[f'{tf}_reclaim']=0.0
        values[f'{tf}_k']=55.0
        values[f'{tf}_known_at']=now
    values.update(overrides)
    return pd.Series(values),now

def test_supported_new_reclaim_is_explicit_but_not_a_probability():
    p,now=point(d_reclaim=1.0,d_k=30.0)
    x=context_trigger_snapshot(p,now)
    assert x['slow_support'] is True
    assert x['new_fast_reclaim_timeframes']==['D']
    assert x['fast_pullback_timeframes']==['D']
    assert x['entry_readiness']=='supported_reclaim_now'
    assert x['ranking_role']=='context_score_remains_primary_research_order'
    assert 'probability' in x['status']

def test_supported_pullback_waits_for_reclaim():
    p,now=point(d_k=25.0)
    x=context_trigger_snapshot(p,now)
    assert x['entry_readiness']=='supported_pullback_waiting_reclaim'
    assert x['fast_reclaim_timeframes']==[]

def test_reclaim_without_full_slow_support_is_not_upgraded():
    p,now=point(**{'1m_score':45.0,'d_reclaim':1.0})
    x=context_trigger_snapshot(p,now)
    assert not x['slow_support']
    assert x['entry_readiness']=='reclaim_without_full_slow_support'

def test_missing_slow_lane_is_unavailable():
    p,now=point(**{'1m_score':float('nan')})
    x=context_trigger_snapshot(p,now)
    assert x['entry_readiness']=='unavailable'
    assert x['slow_context_ready'] is False

def test_falling_fast_lane_stays_risk_state_without_support():
    p,now=point(**{'w_score':45.0,'d_phase':'washout'})
    x=context_trigger_snapshot(p,now)
    assert x['entry_readiness']=='fast_momentum_falling'
    assert x['fast_falling_timeframes']==['D']

def test_full_screen_exposes_context_trigger_without_rank_authority():
    doc=document()
    row=screen_ticker(doc,**args(doc,policy=ScreenPolicy(preset='full')))
    assert row['state']=='research_ready'
    x=row['context_trigger']
    assert x['status']=='descriptive_research_state_not_probability'
    assert x['ranking_role']=='context_score_remains_primary_research_order'
    assert row['production_rank'] is None and row['trade_authority'] is False