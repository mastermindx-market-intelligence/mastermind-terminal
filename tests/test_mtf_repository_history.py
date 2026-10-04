"""Integration proof on the repository's existing dated market-data artifact.

The reduced sandbox source bundle lacks this file; the existing repository CI
checkout supplies it. This does not download data or use a new execution owner.
Any emitted result is a single-survivor historical illustration, not evidence of
universe-wide edge. The 2026 interval is reserved before features are computed.
"""
from pathlib import Path
import hashlib
import json
import warnings

import pandas as pd
import pytest

from signal_layer.mtf_experiments import RULES, compare_entry_rules
from signal_layer.mtf_screener import document_frame

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'terminal/public/data/NVDA.json'


def test_existing_nvda_history_runs_the_frozen_swing_comparison():
    if not SOURCE.is_file():
        pytest.skip('Existing NVDA artifact is absent from this reduced source checkout')
    raw = SOURCE.read_bytes()
    doc = json.loads(raw)
    assert doc.get('t') == 'NVDA'
    assert doc.get('bar_quality') == 'real_ohlc'
    assert isinstance(doc.get('src'), str)
    assert not any(word in doc['src'].lower() for word in ('synthetic', 'fixture'))
    daily, anchor, provenance = document_frame(doc, 'NVDA')
    # A frozen boundary, not the best-performing year chosen after seeing results.
    holdout = pd.Timestamp('2026-01-01')
    assert daily.index[0] < pd.Timestamp('2022-01-01')
    assert daily.index[-1] >= holdout
    report = compare_entry_rules(daily, bar_anchor=anchor, evaluation_end=daily.index[-1],
                                 holdout_start=holdout, preset='swing',
                                 horizons=(5,21,63), cost_bps=(0,5,25),
                                 min_train_years=3, min_train_rows=252)
    assert report['trial_count'] == len(RULES)*3*3 == 54
    assert report['holdout_status'] == 'not_consumed'
    assert pd.Timestamp(report['development_end']) < holdout
    assert report['common_coverage_sessions'] > 252
    chosen = [trial for trial in report['trials'] if trial['horizon']==21 and trial['entry_bps']==5]
    assert len(chosen) == 6
    assert any(trial['summary']['matured'] > 0 for trial in chosen)
    for trial in report['trials']:
        for event in trial['events']:
            end=event[f'label_end_{trial["horizon"]}']
            assert end is None or pd.Timestamp(end) < holdout
        for fold in trial['folds']:
            if fold['state']=='evaluated':
                assert pd.Timestamp(fold['train_last_label_end']) < pd.Timestamp(fold['test_start'])
    diagnostic = {
        'classification':'EXISTING_REPOSITORY_MARKET_ARTIFACT_SINGLE_TICKER_NOT_EDGE_VALIDATION',
        'source_path':str(SOURCE.relative_to(ROOT)), 'source_sha256':hashlib.sha256(raw).hexdigest(),
        'symbol':'NVDA', 'source':provenance, 'source_start':str(daily.index[0].date()),
        'source_end':str(daily.index[-1].date()), 'development_end':report['development_end'],
        'holdout_start':str(holdout.date()), 'holdout_status':report['holdout_status'],
        'trial_count':report['trial_count'], 'config_digest':report['config_digest'],
        'horizon_21_cost_5bps_each_side':[
            {'rule':t['rule'], **t['summary'],
             'evaluated_years':[f['test_year'] for f in t['folds'] if f['state']=='evaluated']}
            for t in chosen],
        'production_rank_authority':False,
        'limitations':['Single currently surviving ticker; no point-in-time universe test.',
                       'Source adjustment and exchange completeness are not independently certified.',
                       'Small, dependent samples; no calibrated probability or causal/portfolio-performance claim.']}
    # Like the repository's existing guard-proof tests, retain a compact diagnostic
    # in pytest's warning summary so CI reports the exact data/contract it exercised.
    warnings.warn('MTF_RESEARCH_DIAGNOSTIC '+json.dumps(diagnostic,sort_keys=True,allow_nan=False), UserWarning)
