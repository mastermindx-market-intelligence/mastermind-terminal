"""Frozen historical-artifact pilot. No 2026 returns or parameter search."""
from pathlib import Path
from collections import defaultdict
import hashlib, json, sys, time
import pandas as pd
ROOT=Path('/Volumes/Mastermind/research/mtf779-804ed675-pilot')
sys.path.insert(0,str(ROOT/'candidate'))
from signal_layer.mtf_confluence import feature_frame
from signal_layer.mtf_evaluation import ExecutionCosts, outcome_frame
from signal_layer.mtf_experiments import compare_entry_rules, RULES
from signal_layer.mtf_screener import document_frame
from signal_layer.mtf_panel import pair_benchmark_events, equal_ticker_rule_summary
HOLDOUT='2026-01-01'
SYMBOLS='NVDA AAPL MSFT AMZN GOOGL META TSLA AMD AVGO INTC MU JPM XOM UNH SPY QQQ IWM TLT 0700.HK 600519.SS'.split()
STOCKS=SYMBOLS[:14]
BENCHMARKS=['SPY','QQQ']; HORIZONS=[5,21,63]; COSTS=[0,5,25]
OUT=ROOT/'pilot-output'; OUT.mkdir(exist_ok=False)
(OUT/'studies').mkdir(); (OUT/'paired').mkdir()
verified={r['symbol']:r for r in json.loads((ROOT/'data-verification.json').read_text())}
def save(path,value):
    with path.open('x') as out: json.dump(value,out,indent=2,allow_nan=False)
frames={}; anchors={}; sources={}; coverage=[]
for sym in SYMBOLS:
    if verified[sym]['state']!='verified':
        coverage.append({'symbol':sym,'state':'missing_data'}); continue
    raw=(ROOT/'data'/f'{sym}.json').read_bytes()
    assert hashlib.sha256(raw).hexdigest()==verified[sym]['sha256']
    doc=json.loads(raw); doc['bars']=[r for r in doc['bars'] if r[0]<HOLDOUT]
    frames[sym],anchors[sym],sources[sym]=document_frame(doc,sym)
# Gate before observing any return: do not trust a session-count grid with holes.
reference=frames['SPY'].index
eligible=[]
for sym,x in frames.items():
    expected=reference[(reference>=x.index[0])&(reference<=x.index[-1])]
    missing=expected.difference(x.index); extra=x.index.difference(expected)
    item={'symbol':sym,'source_start':str(x.index[0].date()),'development_end':str(x.index[-1].date()),
          'development_sessions':len(x),'missing_vs_SPY':missing.strftime('%Y-%m-%d').tolist(),
          'extra_vs_SPY':extra.strftime('%Y-%m-%d').tolist(),'source_sha256':verified[sym]['sha256']}
    if len(missing) or len(extra):
        item['state']='withheld_calendar_gaps'; coverage.append(item); continue
    features=feature_frame(x,anchors[sym])
    item.update(state='pilot_eligible',known_monthly_bars=int(features['1m_closed_bars'].iloc[-1]),
                ready_monthly_sessions=int(features['1m_score'].notna().sum()),
                full_score_sessions=int(features.setup_score.notna().sum()),
                swing_score_sessions=int(features.swing_score.notna().sum()))
    coverage.append(item); eligible.append(sym)
save(OUT/'coverage.json',coverage)
# Benchmark prices use the same next-open owner and side-specific cost assumptions.
benchmark={(sym,cost):outcome_frame(frames[sym],HORIZONS,costs=ExecutionCosts(cost,cost))
           for sym in BENCHMARKS for cost in COSTS}
rows=defaultdict(list); stats=[]
for sym in eligible:
    x=frames[sym]; start=time.monotonic()
    study=compare_entry_rules(x,bar_anchor=anchors[sym],evaluation_end=x.index[-1],
                             holdout_start=HOLDOUT,preset='swing',horizons=HORIZONS,
                             cost_bps=COSTS,min_train_years=3,min_train_rows=252)
    assert study['holdout_status']=='not_consumed' and study['development_end']<HOLDOUT
    save(OUT/'studies'/f'{sym}.json',study)
    pairs=[]
    for trial in study['trials']:
        h,cost=trial['horizon'],trial['entry_bps']
        for event in trial['events']:
            assert event['decision_session'][:10]<HOLDOUT
            assert event[f'label_end_{h}'] is None or event[f'label_end_{h}'][:10]<HOLDOUT
        for peer in BENCHMARKS:
            events=pair_benchmark_events(trial['events'],benchmark[peer,cost],horizon=h,entry_bps=cost,exit_bps=cost)
            row={'symbol':sym,'rule':trial['rule'],'horizon':h,'entry_bps':cost,'exit_bps':cost,
                 'benchmark_symbol':peer,'events':events}
            pairs.append(row)
            if sym in STOCKS: rows[peer,h,cost].append(row)
        stats.append({'symbol':sym,'rule':trial['rule'],'horizon':h,'entry_bps':cost,**trial['summary'],
                      'evaluated_years':[f['test_year'] for f in trial['folds'] if f['state']=='evaluated']})
    save(OUT/'paired'/f'{sym}.json',pairs)
    print(json.dumps({'symbol':sym,'cells':len(study['trials']),'seconds':round(time.monotonic()-start,3)}),flush=True)
aggregate=[]
for (peer,h,cost),values in rows.items():
    summary=equal_ticker_rule_summary(values,requested_symbols=STOCKS,baseline_rule=RULES[0])
    aggregate.append({'benchmark':peer,'horizon':h,'cost_bps_per_side':cost,**summary})
save(OUT/'aggregate.json',aggregate); save(OUT/'event-statistics.json',stats)
manifest={'schema':'terminal-mtf-frozen-artifact-pilot/v1','status':'pilot_not_edge_validation',
          'source_ref':'804ed6754591eef508f1a667000608a8ab9167f9',
          'panel_ref':'2f5005168a7ef73e1d86ea7f651bfcd25b501510',
          'kernel_null_fix_ref':'3b0e3784e0ca3d6ed7471c4573758e6be47f9a8e',
          'reserved_holdout_start':HOLDOUT,'holdout_status':'not_consumed','sample':SYMBOLS,
          'eligible':eligible,'stock_summary_population':STOCKS,
          'comparison_cells_per_ticker':54,'no_training_or_rules_changed':True,
          'limitations':['Current-survivor convenience sample; not point-in-time universe evidence.',
                         'SPY dates are only an observed reference, not a certified exchange calendar.',
                         'Adjustment/vintage and actual execution liquidity are not certified.',
                         'Correlated names and different rule entry dates prevent causal or portfolio inference.',
                         'No confidence interval, best-rule selection or production rank is emitted.'],
          'production_rank_authority':False,'trade_authority':False,
          'runner_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
          'files':[{ 'path':str(p.relative_to(OUT)),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
                   for p in sorted(OUT.rglob('*.json'))]}
save(OUT/'manifest.json',manifest)
print(json.dumps({'state':'complete','eligible':eligible,'studied_cells':len(stats),'aggregate_cells':len(aggregate)}))
