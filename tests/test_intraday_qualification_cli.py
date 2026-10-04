"""Subprocess coverage for the actual offline consumer, not a mocked entrypoint."""
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CLI = ROOT / 'scripts/qualify_intraday_research.py'


def run(tmp_path, *extra):
    store = tmp_path / 'store'; store.mkdir(exist_ok=True)
    env = {k:v for k,v in os.environ.items() if k not in ('POLYGON_API_KEY','MASSIVE_API_KEY')}
    return subprocess.run([sys.executable,str(CLI),'--input-dir',str(store),
                           '--start','2026-09-16','--end','2026-09-16',
                           '--cutoff','2026-09-16T20:00:00Z',*extra],
                          cwd=tmp_path,env=env,text=True,capture_output=True)


def test_real_cli_retains_all_missing_pilot_cells_without_credentials(tmp_path):
    result=run(tmp_path)
    assert result.returncode==0, result.stderr
    d=json.loads(result.stdout)
    assert len(d['files'])==36
    assert d['status_counts']=={'missing':36}
    assert d['membership_basis']=='fixed_current_development_only'
    assert d['research_admission']=='not_assessed'
    assert len(d['calendar']['sha256'])==64


def test_cli_json_and_markdown_describe_the_same_input(tmp_path):
    output=tmp_path/'report.json'; markdown=tmp_path/'report.md'
    result=run(tmp_path,'--json-out',str(output),'--markdown-out',str(markdown))
    assert result.returncode==0, result.stderr
    d=json.loads(output.read_text())
    assert 'INTC' in markdown.read_text()
    assert '36' in markdown.read_text()
    assert 'not a signal' in markdown.read_text().lower()
    assert len(d['files'])==36


def test_output_is_create_only_and_never_overwrites(tmp_path):
    out=tmp_path/'report.json'; out.write_text('preserve me')
    result=run(tmp_path,'--json-out',str(out))
    assert result.returncode==2
    assert out.read_text()=='preserve me'


def test_report_must_not_be_written_into_store_directory(tmp_path):
    result=run(tmp_path,'--json-out',str(tmp_path/'store'/'INTC.5m.json'))
    assert result.returncode==2
    assert not (tmp_path/'store'/'INTC.5m.json').exists()


def test_pilot_path_traversal_and_duplicates_are_refused(tmp_path):
    base=json.loads((ROOT/'config/tactical_research_pilot.json').read_text())
    for names in (['../INTC'],['INTC','INTC']):
        base['symbols']=names
        p=tmp_path/'pilot.json'; p.write_text(json.dumps(base))
        result=run(tmp_path,'--pilot',str(p))
        assert result.returncode==2


def test_cutoff_requires_an_explicit_timezone(tmp_path):
    result=run(tmp_path,'--cutoff','2026-09-16T20:00:00')
    assert result.returncode==2


def test_as_observed_mode_refuses_legacy_store_even_with_fresh_asof(tmp_path):
    store=tmp_path/'store'; store.mkdir()
    store.joinpath('INTC.5m.json').write_text(json.dumps({'t':'INTC','tf':'5m','src':'polygon',
        'asof':1789551000,'bars':[[1789551000,100,101,99,100,1000]]}))
    result=run(tmp_path,'--mode','as_observed')
    assert result.returncode==0,result.stderr
    d=json.loads(result.stdout)
    cell=next(x for x in d['files'] if x['symbol']=='INTC' and x['timeframe']=='5m')
    assert cell['status']=='available'
    assert cell['cutoff']['count']==0
    assert cell['knowledge_time']=='not_recorded'


def test_local_absence_is_not_reported_as_provider_coverage_failure(tmp_path):
    result=run(tmp_path)
    assert result.returncode==0,result.stderr
    d=json.loads(result.stdout)
    assert d['input_scope']=='explicit_local_files_not_vendor_inventory'


def test_cli_reports_a_real_three_leg_chain_without_price_export(tmp_path):
    from datetime import datetime, timezone
    store=tmp_path/'store'; store.mkdir()
    rows=[]
    for day,start,end in [('2026-09-11',570,1200),('2026-09-14',240,570)]:
        midnight=int(datetime.fromisoformat(day).replace(tzinfo=timezone.utc).timestamp())
        rows.extend([[midnight+m*60,100,101,99,100,10] for m in range(start,end,5)])
    (store/'AMD.5m.json').write_text(json.dumps({'t':'AMD','tf':'5m','src':'polygon','bars':rows}))
    md=tmp_path/'chain.md'
    result=run(tmp_path,'--start','2026-09-11','--end','2026-09-14','--markdown-out',str(md))
    assert result.returncode==0,result.stderr
    doc=json.loads(result.stdout)
    cell=next(x for x in doc['files'] if x['symbol']=='AMD' and x['timeframe']=='5m')
    assert len(cell['session_chains'])==2
    assert cell['session_chains'][-1]['state']=='full_nominal_grid'
    assert cell['session_chains'][0]['state']=='incomplete_or_unknown'
    missing=next(x for x in doc['files'] if x['symbol']=='JPM' and x['timeframe']=='5m')
    assert len(missing['session_chains'])==2
    assert missing['session_chains'][-1]['state']=='source_unavailable'
    assert 'Pre-open session-chain inventory' in md.read_text()
    assert '| AMD | 5m | 2 | 1 |' in md.read_text()
    assert 'ohlcv' not in result.stdout and '"bars"' not in result.stdout
