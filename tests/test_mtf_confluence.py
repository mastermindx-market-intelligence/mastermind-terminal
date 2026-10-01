import numpy as np, pandas as pd
from signal_layer.mtf_confluence import feature_frame, add_forward_labels, walk_forward_summary

COLS=["mtf_score","setup_score","d_score","3d_score","w_score","2w_score","1m_score"]

def _ohlc_series(n=1800):
    idx=pd.bdate_range("2018-01-02",periods=n)
    x=np.arange(n)
    close=100+0.03*x+8*np.sin(x/31)+2*np.sin(x/7)
    high=close+1.2+0.4*np.sin(x/17)
    low=close-1.1-0.35*np.cos(x/19)
    return pd.DataFrame({"high":high,"low":low,"close":close},index=idx)

def _assert_prefix(full, prefix, *, bar_anchor=0):
    a=feature_frame(prefix,bar_anchor=bar_anchor)
    b=feature_frame(full,bar_anchor=bar_anchor).reindex(a.index)
    pd.testing.assert_frame_equal(a[COLS],b[COLS],check_exact=False,rtol=1e-10,atol=1e-10)

def test_features_are_prefix_stable_and_bounded_across_phases():
    x=_ohlc_series()
    for bar_anchor in (0,1,2):
        _assert_prefix(x,x.iloc[:1200],bar_anchor=bar_anchor)
    f=feature_frame(x)
    assert f["setup_score"].dropna().between(0,100).all()


def test_2w_grid_is_absolute_calendar_not_feed_or_ipo_phased():
    from signal_layer.mtf_confluence import _groups_2w
    x=_ohlc_series(60)
    full,_=_groups_2w(x)
    # Drop an arbitrary leading window: overlapping completed 2W bars retain the
    # same last-session labels because the grid is anchored to Unix-calendar fortnights.
    trunc,_=_groups_2w(x.iloc[7:])
    overlap=[t for t in trunc.index if t in set(full.index)]
    assert overlap
    assert overlap==[t for t in full.index if t in set(trunc.index)]

def test_calendar_boundaries_do_not_backdate_new_information():
    x=_ohlc_series()
    month_cut=x.loc[:"2020-02-28"]  # month ends Saturday
    _assert_prefix(x,month_cut)
    fridays=x.index[(x.index.weekday==4) & (x.index>"2021-01-01")]
    holiday=fridays[8]
    no_friday=x.drop(index=holiday)
    thursday=holiday-pd.offsets.BDay(1)
    _assert_prefix(no_friday,no_friday.loc[:thursday])

def test_suffix_price_changes_cannot_mutate_prior_features():
    x=_ohlc_series()
    cut=1200
    altered=x.copy()
    scale=np.linspace(1.0,1.7,len(altered)-cut)
    altered.iloc[cut:,altered.columns.get_indexer(["high","low","close"])]=altered.iloc[cut:][["high","low","close"]].to_numpy()*scale[:,None]
    a=feature_frame(x).iloc[:cut]
    b=feature_frame(altered).iloc[:cut]
    pd.testing.assert_frame_equal(a[COLS],b[COLS],check_exact=False,rtol=1e-10,atol=1e-10)

def test_close_only_series_remains_supported_for_research_fixtures():
    x=_ohlc_series()
    close=x["close"]
    f=feature_frame(close)
    assert len(f)==len(close)
    assert f["setup_score"].dropna().between(0,100).all()

def test_labels_are_separate_and_walk_forward_uses_prior_years():
    x=_ohlc_series()
    f=feature_frame(x)
    assert not any(k.startswith("fwd_") for k in f.columns)
    z=add_forward_labels(f,x)
    wf=walk_forward_summary(z,min_train_years=2)
    assert {"test_year","threshold","signals","mean_fwd"}.issubset(wf.columns)
