import copy
import pandas as pd
import pytest
from signal_layer.mtf_screener import screen_ticker, scan_universe, history_calendar_status
from signal_layer.mtf_evaluation import ExecutionCosts
from test_mtf_calendar import fixture, args


def test_review_duplicate_document_is_rejected_before_calendar_certification():
    doc,cal=fixture(); doc['bars'].insert(151,copy.deepcopy(doc['bars'][150]))
    with pytest.raises(ValueError,match='unique and strictly increasing'):
        screen_ticker(doc,**args(doc),session_calendar=cal)
    out=scan_universe({'TEST':doc},[{**args(doc),'calendar_id':'US'}],
                     as_of=doc['bars'][-1][0],session_calendars={'US':cal})
    assert out['rows'][0]['state']=='invalid_data'
    assert out['research_order']==[]


def test_review_cost_formula_is_multiplicative_and_cannot_breach_total_loss():
    costs=ExecutionCosts(4,4)
    assert costs.net_return(100,0)==-1
    assert costs.net_return(100,1)>-1


@pytest.mark.parametrize('dates',[
    pd.DatetimeIndex(['2020-01-02','2020-01-02']),
    pd.DatetimeIndex(['2020-01-03','2020-01-02']),
    pd.DatetimeIndex(['2020-01-02T10:00:00']),
    pd.DatetimeIndex(['2020-01-02T00:00:00Z']),
    pd.DatetimeIndex([pd.NaT]),pd.Index([1,2]),
])
def test_standalone_calendar_helper_also_refuses_invalid_observed_sessions(dates):
    with pytest.raises(ValueError):
        history_calendar_status(dates,{'source':'fixture','session_dates':['2020-01-02','2020-01-03']})