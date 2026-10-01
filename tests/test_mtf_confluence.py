import numpy as np, pandas as pd
from signal_layer.mtf_confluence import feature_frame, add_forward_labels, walk_forward_summary

COLS=["mtf_score","setup_score","d_score","3d_score","w_score","2w_score","1m_score"]

def _series(n=1800):
    idx=pd.bdate_range("2018-01-02",periods=n)
    x=np.arange(n)
    return pd.Series(100+0.03*x+8*np.sin(x/31)+2*np.sin(x/7),index=idx)

def _assert_prefix(full, prefix, *, bar_anchor=0, week_parity=0):
    a=feature_frame(prefix,bar_anchor=bar_anchor,week_parity=week_parity)
    b=feature_frame(full,bar_anchor=bar_anchor,week_parity=week_parity).reindex(a.index)
    pd.testing.assert_frame_equal(a[COLS],b[COLS],check_exact=False,rtol=1e-10,atol=1e-10)

def test_features_are_prefix_stable_and_bounded_across_phases():
    c=_series()
    for bar_anchor in (0,1,2):
        for week_parity in (0,1):
            _assert_prefix(c,c.iloc[:1200],bar_anchor=bar_anchor,week_parity=week_parity)
    f=feature_frame(c)
    assert f["setup_score"].dropna().between(0,100).all()

def test_calendar_boundaries_do_not_backdate_new_information():
    c=_series()
    # 2020-02-29 was Saturday: a month-end value must not appear retroactively
    # on Friday 2020-02-28 merely because March data later exists.
    month_cut=c.loc[:"2020-02-28"]
    _assert_prefix(c,month_cut)
    # Simulate a Friday market holiday. Thursday's weekly state must remain the
    # previous closed state until the next observed session.
    fridays=c.index[(c.index.weekday==4) & (c.index>"2021-01-01")]
    holiday=fridays[8]
    no_friday=c.drop(index=holiday)
    thursday=holiday-pd.offsets.BDay(1)
    _assert_prefix(no_friday,no_friday.loc[:thursday])

def test_suffix_price_changes_cannot_mutate_prior_features():
    c=_series()
    cut=1200
    altered=c.copy()
    altered.iloc[cut:]=altered.iloc[cut:]*np.linspace(1.0,1.7,len(altered)-cut)
    a=feature_frame(c).iloc[:cut]
    b=feature_frame(altered).iloc[:cut]
    pd.testing.assert_frame_equal(a[COLS],b[COLS],check_exact=False,rtol=1e-10,atol=1e-10)

def test_labels_are_separate_and_walk_forward_uses_prior_years():
    c=_series()
    f=feature_frame(c)
    assert not any(x.startswith("fwd_") for x in f.columns)
    z=add_forward_labels(f,c)
    wf=walk_forward_summary(z,min_train_years=2)
    assert {"test_year","threshold","signals","mean_fwd"}.issubset(wf.columns)
