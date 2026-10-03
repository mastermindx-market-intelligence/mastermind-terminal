from pathlib import Path
import copy
import hashlib
import json
import subprocess
import sys
import numpy as np
import pandas as pd
import pytest
from ingest.compare_mtf import build_study, main


def inputs(tmp_path, n=1500):
    dates=pd.bdate_range('2015-01-02',periods=n).strftime('%Y-%m-%d').tolist()
    values=100+.01*np.arange(n)+8*np.sin(np.arange(n)/21)
    document={'t':'TEST','src':'synthetic_test_only','bar_quality':'real_ohlc',
        'bars':[[d,float(c),float(c+2),float(c-2),float(c),1000] for d,c in zip(dates,values)],
        'session_anchor':{'v':1,'date':dates[0],'index':0,'basis':'feed'}}
    cutoff=dates[-1]
    request={'schema':'terminal-mtf-screen-request/v1','as_of':cutoff,
        'policy':{'preset':'swing'},
        'session_calendars':{'TEST':{'source':'synthetic_sessions','session_dates':dates}},
        'tickers':[{'symbol':'TEST','market':'us','closed_through':cutoff,
                    'expected_session':cutoff,'calendar_id':'TEST'}]}
    data=tmp_path/'data'; data.mkdir()
    (data/'TEST.json').write_text(json.dumps(document))
    return data,document,request


def test_real_study_has_frozen_recipe_and_reserved_holdout(tmp_path):
    data,doc,request=inputs(tmp_path)
    before=copy.deepcopy(request)
    result=build_study(data,request,holdout_start='2026-01-01')
    assert result['state']=='research_ready'
    assert result['study']['trial_count']==54
    assert len(set(t['rule'] for t in result['study']['trials']))==6
    assert result['study']['holdout_status']=='not_consumed'
    assert result['study']['development_end']<'2026-01-01'
    assert result['source_file_sha256']==hashlib.sha256((data/'TEST.json').read_bytes()).hexdigest()
    assert result['trade_authority'] is False and request==before


@pytest.mark.parametrize('failure',['missing','gap','proxy','stale','short','unreadable'])
def test_unqualified_inputs_are_reported_without_trials(tmp_path,failure):
    data,doc,req=inputs(tmp_path,100 if failure=='short' else 600)
    want={'missing':'missing_data','gap':'incomplete_history','proxy':'invalid_data',
          'stale':'stale_data','short':'insufficient_history','unreadable':'unreadable_data'}[failure]
    path=data/'TEST.json'
    if failure=='missing': path.unlink()
    elif failure=='unreadable': path.write_text('{broken')
    elif failure=='gap':
        doc['bars'].pop(200);path.write_text(json.dumps(doc))
    elif failure=='proxy':
        doc['bar_quality']='synthetic_open_deepstore';path.write_text(json.dumps(doc))
    elif failure=='stale':
        req['as_of']='2025-12-31';req['tickers'][0]['expected_session']='2025-12-31'
    result=build_study(data,req,holdout_start='2026-01-01')
    assert result['state']==want and result['study'] is None


@pytest.mark.parametrize('holdout',['2010-01-01','not-a-date','2020-01-01T12:00:00'])
def test_bad_or_consumed_holdout_refused_before_source_use(tmp_path,holdout):
    data,_,req=inputs(tmp_path)
    with pytest.raises(ValueError): build_study(data,req,holdout_start=holdout)


def test_single_ticker_request_and_calendar_reference_are_strict(tmp_path):
    data,_,req=inputs(tmp_path)
    req['tickers'].append({**req['tickers'][0],'symbol':'OTHER'})
    with pytest.raises(ValueError,match='one explicit ticker'):build_study(data,req,holdout_start='2026-01-01')
    req['tickers']=req['tickers'][:1];req['tickers'][0]['calendar_id']='unknown'
    with pytest.raises(ValueError):build_study(data,req,holdout_start='2026-01-01')


def test_future_suffix_cannot_change_study_or_prefix_identity(tmp_path):
    data,doc,req=inputs(tmp_path)
    cutoff=doc['bars'][1199][0]
    req['as_of']=cutoff
    req['tickers'][0].update(closed_through=cutoff,expected_session=cutoff)
    a=build_study(data,req,holdout_start='2026-01-01')
    for row in doc['bars'][1200:]:
        row[1:5]=[v*1.25 for v in row[1:5]]
    (data/'TEST.json').write_text(json.dumps(doc))
    b=build_study(data,req,holdout_start='2026-01-01')
    assert a['study']==b['study']
    assert a['screen']['input_sha256']==b['screen']['input_sha256']
    assert a['source_file_sha256']!=b['source_file_sha256']


def test_actual_cli_from_foreign_cwd_writes_strict_json_without_overwrite(tmp_path):
    data,_,req=inputs(tmp_path,600)
    request=tmp_path/'request.json';request.write_text(json.dumps(req))
    output=tmp_path/'study.json'
    import ingest.compare_mtf as module
    command=[sys.executable,str(Path(module.__file__).resolve()),'--data-dir',str(data),
             '--request',str(request),'--output',str(output),'--holdout-start','2026-01-01']
    proc=subprocess.run(command,cwd=tmp_path,capture_output=True,text=True,timeout=30)
    assert proc.returncode==0,proc.stderr
    payload=json.loads(output.read_text());receipt=json.loads(proc.stdout)
    assert payload['schema']=='terminal-mtf-single-ticker-study/v1'
    assert receipt['artifact_sha256']==hashlib.sha256(output.read_bytes()).hexdigest()
    assert payload['request_sha256']==hashlib.sha256(request.read_bytes()).hexdigest()
    before=output.read_bytes()
    second=subprocess.run(command,cwd=tmp_path,capture_output=True,text=True,timeout=30)
    assert second.returncode==2 and output.read_bytes()==before


def test_source_and_request_cannot_be_overwritten(tmp_path):
    data,doc,req=inputs(tmp_path,100)
    request=tmp_path/'request.json';request.write_text(json.dumps(req))
    for output in (data/'TEST.json',request):
        before=output.read_bytes()
        assert main(['--data-dir',str(data),'--request',str(request),'--output',str(output),
                     '--holdout-start','2026-01-01'])==2
        assert output.read_bytes()==before


def test_source_directory_symlink_is_not_followed(tmp_path):
    data,doc,req=inputs(tmp_path)
    link=tmp_path/'alias';link.symlink_to(data,target_is_directory=True)
    with pytest.raises(ValueError):build_study(link,req,holdout_start='2026-01-01')