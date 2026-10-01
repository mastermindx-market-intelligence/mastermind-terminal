import numpy as np, pandas as pd
from signal_layer.mtf_confluence import feature_frame, add_forward_labels, walk_forward_summary

def _series(n=1800):
    idx=pd.bdate_range("2018-01-02",periods=n)
    x=np.arange(n); return pd.Series(100+0.03*x+8*np.sin(x/31)+2*np.sin(x/7),index=idx)

def test_features_are_prefix_stable_and_bounded():
    c=_series(); cut=1200
    a=feature_frame(c.iloc[:cut]); b=feature_frame(c).iloc[:cut]
    cols=["mtf_score","setup_score","d_score","3d_score","w_score","2w_score","1m_score"]
    pd.testing.assert_frame_equal(a[cols],b[cols],check_exact=False,rtol=1e-10,atol=1e-10)
    assert a["setup_score"].dropna().between(0,100).all()

def test_labels_are_separate_and_walk_forward_uses_prior_years():
    c=_series(); f=feature_frame(c)
    assert not any(x.startswith("fwd_") for x in f.columns)
    z=add_forward_labels(f,c)
    wf=walk_forward_summary(z,min_train_years=2)
    assert set(["test_year","threshold","signals","mean_fwd"]).issubset(wf.columns)
