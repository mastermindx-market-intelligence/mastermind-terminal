"""Leakage-safe multi-timeframe momentum research producer.

The default feature contract mirrors the two EXISTING Terminal panes:
  * CM_Stochastic_MTF price stochastic on H/L/C (14,3,3)
  * TH_RSIMACD+ on close (RSI14 -> EMA14-EMA60 -> signal EMA5)

Every higher-timeframe observation carries a first-knowable DAILY session and
forming tails are excluded. Forward labels are a separate evaluation layer.
"""
from __future__ import annotations
import numpy as np
import pandas as pd
from .confluence import rsi_macd

TFS=("D","3D","W","2W","1M")
WEIGHTS={"D":1.0,"3D":1.25,"W":1.5,"2W":1.25,"1M":1.0}

def _ohlc(daily: pd.Series | pd.DataFrame) -> pd.DataFrame:
    if isinstance(daily,pd.Series):
        c=daily.dropna().sort_index().astype(float)
        return pd.DataFrame({"high":c,"low":c,"close":c},index=c.index)
    x=daily.sort_index().copy()
    aliases={
        "high":("high","h","High"),
        "low":("low","l","Low"),
        "close":("close","c","Close"),
    }
    out={}
    for dst,names in aliases.items():
        src=next((n for n in names if n in x.columns),None)
        if src is None:
            raise ValueError(f"daily OHLC missing {dst}")
        out[dst]=pd.to_numeric(x[src],errors="coerce")
    return pd.DataFrame(out,index=x.index).dropna(subset=["high","low","close"])

def _terminal_stochastic(x: pd.DataFrame, n=14, k_smooth=3, d_smooth=3):
    lo=x["low"].rolling(n).min()
    hi=x["high"].rolling(n).max()
    raw=(x["close"]-lo)/(hi-lo).replace(0,np.nan)*100
    raw=raw.mask((hi-lo)==0,50.0)
    k=raw.rolling(k_smooth).mean()
    return k,k.rolling(d_smooth).mean()

def _groups_3d(x: pd.DataFrame, bar_anchor: int):
    n=len(x)
    if not n:
        return x.iloc[:0],pd.DatetimeIndex([])
    gi=np.arange(n)+int(bar_anchor)
    opens=np.empty(n,dtype=bool)
    opens[0]=True
    opens[1:]=(gi[:-1] % 3 == 0)
    op=np.flatnonzero(opens)
    cp=np.append(op[1:]-1,n-1)
    rows=[]
    labels=[]
    known=[]
    for a,b in zip(op,cp):
        # The helper intentionally exposes a forming tail elsewhere. Research
        # admits only a canonical close session.
        if b==n-1 and gi[b] % 3 != 0:
            continue
        w=x.iloc[a:b+1]
        rows.append({"high":w["high"].max(),"low":w["low"].min(),"close":w["close"].iloc[-1]})
        labels.append(x.index[a])
        known.append(x.index[b])
    return pd.DataFrame(rows,index=pd.DatetimeIndex(labels)),pd.DatetimeIndex(known)

def _calendar_groups(x: pd.DataFrame, tf: str):
    if tf=="W":
        keys=x.index.to_period("W-FRI")
    elif tf=="1M":
        keys=x.index.to_period("M")
    else:
        raise ValueError(tf)
    unique=keys.drop_duplicates()
    rows=[]; labels=[]; known=[]
    for i,k in enumerate(unique[:-1]):
        idx=np.flatnonzero(keys==k)
        nxt=np.flatnonzero(keys==unique[i+1])
        w=x.iloc[idx]
        rows.append({"high":w["high"].max(),"low":w["low"].min(),"close":w["close"].iloc[-1]})
        labels.append(x.index[idx[-1]])
        # Conservative availability: first observed source session of next bucket.
        known.append(x.index[nxt[0]])
    return pd.DataFrame(rows,index=pd.DatetimeIndex(labels)),pd.DatetimeIndex(known)

def _groups_2w(x: pd.DataFrame):
    """Match ChartPanel.resampleTf's fixed absolute-calendar 2W grid."""
    # ChartPanel: floor(days-since-epoch of ISO-week Monday / 14). The fixed
    # epoch makes the pairing independent of feed start, symbol IPO and prefix.
    monday=x.index.normalize()-pd.to_timedelta(x.index.weekday,unit="D")
    key=(monday.astype("int64")//86_400_000_000_000//14).astype("int64")
    unique=pd.Index(key).drop_duplicates()
    rows=[]; labels=[]; known=[]
    for i,k in enumerate(unique[:-1]):
        idx=np.flatnonzero(key==k)
        nxt=np.flatnonzero(key==unique[i+1])
        w=x.iloc[idx]
        rows.append({"high":w["high"].max(),"low":w["low"].min(),"close":w["close"].iloc[-1]})
        labels.append(x.index[idx[-1]])
        known.append(x.index[nxt[0]])
    return pd.DataFrame(rows,index=pd.DatetimeIndex(labels)),pd.DatetimeIndex(known)

def _tf_ohlc(daily: pd.Series | pd.DataFrame, tf: str, bar_anchor: int=0):
    x=_ohlc(daily)
    if tf=="D":
        return x,pd.DatetimeIndex(x.index)
    if tf=="3D":
        return _groups_3d(x,bar_anchor)
    if tf=="2W":
        return _groups_2w(x)
    return _calendar_groups(x,tf)

def _state(x: pd.DataFrame) -> pd.DataFrame:
    k,d=_terminal_stochastic(x)
    m,s=rsi_macd(x["close"])
    up=k>d
    mu=m>s
    reclaim=(up & (k<35) & (k>k.shift(1))) | (mu & (m<0) & (m.shift(1)<=s.shift(1)))
    wash=(k<20)&(d<20)&~up
    score=(50+(k-50)*.28+np.where(up,12,-12)+np.where(mu,16,-16)+np.where(reclaim,10,0)-np.where(wash,8,0)).clip(0,100)
    return pd.DataFrame({"k":k,"d":d,"macd":m,"signal":s,"score":score,"reclaim":reclaim.astype(float),"washout":wash.astype(float)})

def feature_frame(daily: pd.Series | pd.DataFrame, bar_anchor: int=0) -> pd.DataFrame:
    """Point-in-time product-parity features on the daily session index."""
    dx=_ohlc(daily)
    base=pd.DataFrame(index=dx.index)
    for tf in TFS:
        x,known=_tf_ohlc(dx,tf,bar_anchor)
        z=_state(x).copy()
        z["known"]=known.values
        z=z.dropna(subset=["known"]).sort_values("known").set_index("known")
        z=z[~z.index.duplicated(keep="last")].add_prefix(tf.lower()+"_")
        base=pd.merge_asof(base.sort_index(),z.sort_index(),left_index=True,right_index=True,direction="backward")
    parts=[base[f"{tf.lower()}_score"]*WEIGHTS[tf] for tf in TFS]
    base["mtf_score"]=sum(parts)/sum(WEIGHTS.values())
    base["reclaim_count"]=sum(base[f"{tf.lower()}_reclaim"].fillna(0) for tf in TFS)
    base["washout_count"]=sum(base[f"{tf.lower()}_washout"].fillna(0) for tf in TFS)
    c=dx["close"]
    lo=c.rolling(252,min_periods=63).min()
    hi=c.rolling(252,min_periods=63).max()
    base["bottom_position"]=((c-lo)/(hi-lo).replace(0,np.nan)).clip(0,1)
    base["setup_score"]=(base["mtf_score"]+10*(1-base["bottom_position"])+np.minimum(10,base["reclaim_count"]*3)-np.maximum(0,base["washout_count"]-2)*4).clip(0,100)
    return base

def add_forward_labels(features: pd.DataFrame, daily: pd.Series | pd.DataFrame, horizons=(5,21,63)) -> pd.DataFrame:
    """Evaluation-only labels. Feature construction never reads these columns."""
    out=features.copy()
    c=_ohlc(daily)["close"].reindex(out.index)
    for h in horizons:
        out[f"fwd_{h}d"]=c.shift(-h)/c-1
    return out

def walk_forward_summary(frame: pd.DataFrame, score="setup_score", horizon=21, min_train_years=3) -> pd.DataFrame:
    """Expanding-train / one-calendar-year test; threshold is fit on prior years only."""
    y=frame.index.year
    years=sorted(set(y))
    rows=[]
    for test_year in years[min_train_years:]:
        train=frame[y<test_year].dropna(subset=[score,f"fwd_{horizon}d"])
        test=frame[y==test_year].dropna(subset=[score,f"fwd_{horizon}d"])
        if len(train)<100 or len(test)<20:
            continue
        q=float(train[score].quantile(.9))
        picked=test[test[score]>=q]
        rows.append({
            "test_year":test_year,"train_n":len(train),"test_n":len(test),
            "threshold":q,"signals":len(picked),
            "mean_fwd":picked[f"fwd_{horizon}d"].mean() if len(picked) else np.nan,
            "median_fwd":picked[f"fwd_{horizon}d"].median() if len(picked) else np.nan,
            "hit_rate":(picked[f"fwd_{horizon}d"]>0).mean() if len(picked) else np.nan,
        })
    return pd.DataFrame(rows)
