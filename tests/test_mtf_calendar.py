import copy, json
import numpy as np
import pandas as pd
import pytest
from ingest.research_mtf import build_report
from signal_layer.mtf_screener import screen_ticker, scan_universe


def fixture():
    dates=pd.bdate_range('2018-01-02',periods=600).strftime('%Y-%m-%d').tolist()
    close=100+10*np.sin(np.arange(600)/8)
    doc={'t':'TEST','src':'synthetic_test_only','bar_quality':'real_ohlc',
         'session_anchor':{'v':1,'date':dates[0],'index':0,'basis':'feed'},
         'bars':[[d,float(c),float(c+2),float(c-2),float(c),1000] for d,c in zip(dates,close)]}
    cal={'source':'synthetic_ordinal_sessions_not_exchange_calendar','session_dates':dates}
    return doc,cal


def args(doc):
    d=doc['bars'][-1][0]
    return dict(symbol='TEST',market='us',as_of=d,closed_through=d,expected_session=d)


def test_cli_honors_supplied_calendar_and_withholds_gappy_history(tmp_path):
    doc,cal=fixture(); doc['bars'].pop(150)
    (tmp_path/'TEST.json').write_text(json.dumps(doc))
    request={'schema':'terminal-mtf-screen-request/v1','as_of':doc['bars'][-1][0],
             'session_calendars':{'US':cal},'tickers':[{**{k:v for k,v in args(doc).items() if k!='as_of'},'calendar_id':'US'}]}
    result=build_report(tmp_path,request)
    assert result['rows'][0]['state']=='incomplete_history'
    assert result['rows'][0]['setup_score'] is None
    assert result['research_order']==[]


def test_calendar_evidence_does_not_self_certify_or_promote():
    doc,cal=fixture()
    unknown=screen_ticker(doc,**args(doc))
    verified=screen_ticker(doc,**args(doc),session_calendar=cal)
    assert unknown['calendar_quality']['state']=='not_provided'
    assert verified['calendar_quality']['state']=='matches_supplied_calendar'
    assert verified['calendar_quality']['authority']=='caller_supplied_not_certified'
    assert verified['state']=='research_ready' and verified['trade_authority'] is False


def test_middle_hole_is_not_silently_rephased():
    doc,cal=fixture(); removed=doc['bars'].pop(150)[0]
    row=screen_ticker(doc,**args(doc),session_calendar=cal)
    assert row['state']=='incomplete_history' and row['setup_score'] is None
    assert row['calendar_quality']['missing_sessions']==[removed]
    assert row['historical_analogs'] is None and row['timeframes']==[]


def test_calendar_must_cover_observed_history():
    doc,cal=fixture(); cal['session_dates']=cal['session_dates'][1:]
    row=screen_ticker(doc,**args(doc),session_calendar=cal)
    assert row['state']=='incomplete_history'
    assert row['calendar_quality']['state']=='incomplete_calendar'


@pytest.mark.parametrize('mutation',['reverse','duplicate','numeric','empty','source'])
def test_malformed_calendar_is_not_admitted(mutation):
    doc,cal=fixture()
    if mutation=='reverse': cal['session_dates'].reverse()
    if mutation=='duplicate': cal['session_dates'][2]=cal['session_dates'][1]
    if mutation=='numeric': cal['session_dates'][2]=1000
    if mutation=='empty': cal['session_dates']=[]
    if mutation=='source': cal['source']=''
    with pytest.raises(ValueError): screen_ticker(doc,**args(doc),session_calendar=cal)


def test_unexpected_session_is_not_silently_kept():
    doc,cal=fixture()
    sample=copy.deepcopy(doc['bars'][3]); sample[0]='2018-01-06'
    doc['bars'].append(sample); doc['bars'].sort(key=lambda row:row[0])
    row=screen_ticker(doc,**args(doc),session_calendar=cal)
    assert row['state']=='incomplete_history'
    assert row['calendar_quality']['unexpected_sessions']==['2018-01-06']


def test_future_calendar_suffix_does_not_change_prior_snapshot():
    doc,cal=fixture(); cutoff=doc['bars'][499][0]
    kwargs={**args(doc),'as_of':cutoff,'closed_through':cutoff,'expected_session':cutoff}
    prefix=copy.deepcopy(cal); prefix['session_dates']=prefix['session_dates'][:500]
    assert screen_ticker(doc,**kwargs,session_calendar=cal)==screen_ticker(doc,**kwargs,session_calendar=prefix)


@pytest.mark.parametrize('calendar_id',['MISSING',[],None])
def test_explicit_bad_calendar_reference_is_not_silently_downgraded(calendar_id):
    doc,cal=fixture(); req={**args(doc),'calendar_id':calendar_id}
    # A null dictionary entry is not evidence that an explicitly requested calendar exists.
    registry={'US':None} if calendar_id is None else {'US':cal}
    if calendar_id is None: req['calendar_id']='US'
    out=scan_universe({'TEST':doc},[req],as_of=doc['bars'][-1][0],session_calendars=registry)
    assert out['coverage']=={'invalid_data':1} and out['research_order']==[]


def test_explicit_null_calendar_id_is_not_an_implicit_opt_out():
    doc,cal=fixture(); req={**args(doc),'calendar_id':None}
    out=scan_universe({'TEST':doc},[req],as_of=doc['bars'][-1][0],session_calendars={'US':cal})
    assert out['rows'][0]['state']=='invalid_data'
    assert out['research_order']==[]
