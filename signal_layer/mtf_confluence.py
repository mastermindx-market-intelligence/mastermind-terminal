"""Leakage-safe multi-timeframe momentum research producer.

Produces point-in-time D/3D/W/2W/1M StochRSI + RSI-MACD states and forward
labels for evaluation. It reuses signal_layer.confluence indicator math and
TradingView-phased 3D grouping; labels never enter feature construction.
"""
from __future__ import annotations
import numpy as np
import pandas as pd
from .confluence import rsi_macd, stoch_rsi_kd, _3d_groups, _resample_2w

TFS=("D","3D","W","2W","1M")
WEIGHTS={"D":1.0,"3D":1.25,"W":1.5,"2W":1.25,"1M":1.0}

def _tf_close(daily: pd.Series, tf: str, bar_anchor: int=0, week_parity: int=0) -> tuple[pd.Series,pd.DatetimeIndex]:
    """Return only CLOSED higher-timeframe bars and their first-knowable session."""
    c=daily.dropna().sort_index()
    if tf=="D":
        return c,pd.DatetimeIndex(c.index)
    if tf=="3D":
        od,cd,px=_3d_groups(c,bar_anchor)
        x=pd.Series(px,index=pd.DatetimeIndex(od))
        known=pd.DatetimeIndex(cd)
        # _3d_groups emits the final partial group too; admit it only when the
        # anchored global session index proves this is a real 3D close.
        if len(x) and ((len(c)-1+int(bar_anchor)) % 3 != 0):
            x=x.iloc[:-1]
            known=known[:-1]
        return x,known
    if tf=="2W":
        x=_resample_2w(c,week_parity)
        # A prefix cannot prove its final 2W pair is closed until a later week exists.
        if len(x):
            x=x.iloc[:-1]
        pos=np.searchsorted(c.index.values,x.index.values,side="right")-1
        return x,pd.DatetimeIndex(c.index[np.maximum(pos,0)])

    if tf=="W":
        keys=c.index.to_period("W-FRI")
    elif tf=="1M":
        keys=c.index.to_period("M")
    else:
        raise ValueError(tf)

    # A later source bucket proves the preceding calendar bucket closed. Omitting
    # the current tail makes feature values prefix-stable and avoids lookahead.
    unique=keys.drop_duplicates()
    closed=unique[:-1]
    vals=[]
    known=[]
    for k in closed:
        idx=np.flatnonzero(keys==k)
        vals.append(c.iloc[idx[-1]])
        known.append(c.index[idx[-1]])
    x=pd.Series(vals,index=pd.DatetimeIndex(known),dtype="float64")
    return x,pd.DatetimeIndex(known)

def _state(close: pd.Series) -> pd.DataFrame:
    k,d=stoch_rsi_kd(close); m,s=rsi_macd(close)
    up=k>d; mu=m>s
    reclaim=(up & (k<35) & (k>k.shift(1))) | (mu & (m<0) & (m.shift(1)<=s.shift(1)))
    wash=(k<20)&(d<20)&~up
    score=(50+(k-50)*.28+np.where(up,12,-12)+np.where(mu,16,-16)+np.where(reclaim,10,0)-np.where(wash,8,0)).clip(0,100)
    return pd.DataFrame({"k":k,"d":d,"macd":m,"signal":s,"score":score,"reclaim":reclaim.astype(float),"washout":wash.astype(float)})

def feature_frame(daily_close: pd.Series, bar_anchor: int=0, week_parity: int=0) -> pd.DataFrame:
    """Features indexed by DAILY session. Every HTF value is joined by close-time, never open-time."""
    base=pd.DataFrame(index=daily_close.dropna().sort_index().index)
    for tf in TFS:
        c,known=_tf_close(daily_close,tf,bar_anchor,week_parity)
        z=_state(c).copy(); z["known"]=known.values
        z=z.dropna(subset=["known"]).sort_values("known").set_index("known")
        z=z[~z.index.duplicated(keep="last")]
        z=z.add_prefix(tf.lower()+"_")
        base=pd.merge_asof(base.sort_index(),z.sort_index(),left_index=True,right_index=True,direction="backward")
    parts=[base[f"{tf.lower()}_score"]*WEIGHTS[tf] for tf in TFS]
    den=sum(WEIGHTS.values())
    base["mtf_score"]=sum(parts)/den
    base["reclaim_count"]=sum(base[f"{tf.lower()}_reclaim"].fillna(0) for tf in TFS)
    base["washout_count"]=sum(base[f"{tf.lower()}_washout"].fillna(0) for tf in TFS)
    # ticker-relative bottom context: distance from trailing 252-session high/low,
    # computed with trailing data only. 0=at trailing low, 1=at trailing high.
    c=daily_close.reindex(base.index)
    lo=c.rolling(252,min_periods=63).min(); hi=c.rolling(252,min_periods=63).max()
    base["bottom_position"]=((c-lo)/(hi-lo).replace(0,np.nan)).clip(0,1)
    base["setup_score"]=(base["mtf_score"]+10*(1-base["bottom_position"])+np.minimum(10,base["reclaim_count"]*3)-np.maximum(0,base["washout_count"]-2)*4).clip(0,100)
    return base

def add_forward_labels(features: pd.DataFrame, daily_close: pd.Series, horizons=(5,21,63)) -> pd.DataFrame:
    """Evaluation-only labels. Call only after feature_frame is frozen."""
    out=features.copy(); c=daily_close.reindex(out.index)
    for h in horizons: out[f"fwd_{h}d"]=c.shift(-h)/c-1
    return out

def walk_forward_summary(frame: pd.DataFrame, score="setup_score", horizon=21, min_train_years=3) -> pd.DataFrame:
    """Expanding-train / one-calendar-year test summary; no parameter fitting occurs in test."""
    y=frame.index.year; years=sorted(set(y)); rows=[]
    for test_year in years[min_train_years:]:
        train=frame[y<test_year].dropna(subset=[score,f"fwd_{horizon}d"])
        test=frame[y==test_year].dropna(subset=[score,f"fwd_{horizon}d"])
        if len(train)<100 or len(test)<20: continue
        q=float(train[score].quantile(.9)); picked=test[test[score]>=q]
        rows.append({"test_year":test_year,"train_n":len(train),"test_n":len(test),"threshold":q,"signals":len(picked),"mean_fwd":picked[f"fwd_{horizon}d"].mean() if len(picked) else np.nan,"median_fwd":picked[f"fwd_{horizon}d"].median() if len(picked) else np.nan,"hit_rate":(picked[f"fwd_{horizon}d"]>0).mean() if len(picked) else np.nan})
    return pd.DataFrame(rows)
