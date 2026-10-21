import { describe, expect, it } from "vitest";
import { createLiveCandleState, liveDisplayEpoch, mutateLiveCandle, type LiveCandleBar } from "../liveCandle";
import { mergeFormingQuote, parseFormingTimeframes, projectFormingSnapshot } from "../formingCandles";
const T = Date.parse("2026-10-21T13:30:00Z");
const D = liveDisplayEpoch(T,"us")!;
const generation = "d4606eb2-61c0-43a9-b89e-ff8da926ebf4";
const row = (t:number,c:number,v:number,h=c,l=c) => [t,c,h,l,c,v];
const hub = (patch:Record<string,unknown>={}) => ({
  version:1,source:"polygon-live-second",generation,generationStartedMs:T-1000,
  revision:1,sessionDate:"2026-10-21",asOfMs:T+121999,prefixThroughMs:T+60000,
  streamFromMs:T+60000,dirtyPrefix:false,
  minutes:[row(T,100,100),row(T+60000,105,20),row(T+120000,101,30,104,95)],
  seconds:[row(T+120000,100,10),row(T+121000,101,20,104,95)],...patch,
});
const project = (patch:Record<string,unknown>={},tfs=["1h"]) => projectFormingSnapshot(hub(patch),tfs,T+123000)!;
const quote = (snapshot=project()) => ({basis:"REALTIME",source:"polygon-live-second",
  asOfMs:snapshot.asOfMs,last:101,formingCandles:snapshot});
const initial = ():LiveCandleBar[] => [{time:D,o:100,h:101,l:99,c:100,v:100}];
const apply = (bars:LiveCandleBar[],snapshot=project(),state=createLiveCandleState(),tf="1h") =>
  mutateLiveCandle(bars,quote(snapshot),tf,"us",false,false,state,T+123000);

describe("forming candle projection and consumer",()=>{
  it("replaces an opaque partial seed with a disjoint authoritative 100+20+30 snapshot",()=>{
    const result=apply(initial())!;
    expect(result.bar).toMatchObject({time:D,o:100,h:105,l:95,c:101,v:150,liveCoverage:"complete"});
    expect(result.bars).toHaveLength(1);
  });
  it("duplicate polling is a no-op and an older-window revision retracts extrema and volume",()=>{
    const state=createLiveCandleState();
    const first=apply(initial(),project(),state)!;
    expect(apply(first.bars,project(),state)).toBeNull();
    const corrected=project({revision:2,minutes:[row(T,100,100),row(T+60000,103,17),row(T+120000,101,30,104,95)]});
    const next=apply(first.bars,corrected,state)!;
    expect(next.bar).toMatchObject({h:104,l:95,c:101,v:147});
    expect(apply(next.bars,project(),state)).toBeNull();
  });
  it("keeps partial volume explicit and replaces revised live extrema against the original seed",()=>{
    const state=createLiveCandleState();
    const incomplete=project({prefixThroughMs:0,streamFromMs:T+20000,
      minutes:[row(T,100,50,110,95)]});
    const first=apply(initial(),incomplete,state)!;
    expect(first.bar).toMatchObject({v:100,h:110,liveCoverage:"partial"});
    const corrected=project({revision:2,prefixThroughMs:0,streamFromMs:T+20000,
      minutes:[row(T,100,47,105,96)]});
    const next=apply(first.bars,corrected,state)!;
    expect(next.bar).toMatchObject({v:100,h:105,l:96,liveCoverage:"partial"});
  });
  it("returns every changed bucket when one poll crosses a candle boundary",()=>{
    const result=apply(initial(),project({},["1m"]),createLiveCandleState(),"1m")!;
    expect(result.bars.map(b=>b.time)).toEqual([D,D+60,D+120]);
    expect(result.changedBars).toHaveLength(3);
    expect(result.bar.v).toBe(30);
  });
  it("resamples seconds instead of treating a five-second request as one-second data",()=>{
    const s=project({},["1s","5s","15s","30s"]);
    expect(s.series["regular:5s"]).toHaveLength(1);
    expect(s.series["regular:5s"][0]).toMatchObject({time:D+120,v:30,h:104,l:95});
    expect(s.series["regular:1s"]).toHaveLength(2);
  });
  it("requests history repair for a gap beyond the retained second window",()=>{
    const result=apply(initial(),project({},["1s"]),createLiveCandleState(),"1s")!;
    expect(result.kind).toBe("history-gap");
    expect(result.bars).toEqual(initial());
  });
  it("rejects stale, invalid, duplicate and malformed raw components",()=>{
    expect(projectFormingSnapshot(hub(),["1h"],T+300000)).toBeNull();
    expect(projectFormingSnapshot(hub({minutes:[row(T,100,-1)]}),["1h"],T+123000)).toBeNull();
    expect(projectFormingSnapshot(hub({minutes:[row(T,100,1),row(T,100,1)]}),["1h"],T+123000)).toBeNull();
    expect(projectFormingSnapshot(hub({generation:"bad"}),["1h"],T+123000)).toBeNull();
  });
  it("keeps raw windows off the public contract and projects only selected timeframes",()=>{
    const s=project({},["1m"]);
    expect(Object.keys(s.series)).toEqual(["regular:1m","extended:1m","24h:1m"]);
    expect(s).not.toHaveProperty("minutes");
    expect(s).not.toHaveProperty("seconds");
    expect(s.day).toMatchObject({o:100,h:105,l:95,c:101,v:150,complete:true});
  });
  it("canonicalizes and bounds the requested timeframe cache identity",()=>{
    expect(parseFormingTimeframes("5m,1m,5m")).toEqual(["1m","5m"]);
    expect(parseFormingTimeframes("1m,2m,3m,5m,15m")).toBeNull();
    expect(parseFormingTimeframes("D")).toBeNull();
  });
});

describe("quote lane reconciliation",()=>{
  it("a wide quote cannot erase a forming snapshot or move its price clock backwards",()=>{
    const old=quote(project());
    expect(mergeFormingQuote(old,{basis:"REALTIME",source:old.source,asOfMs:T,last:90})).toBe(old);
    expect(mergeFormingQuote(old,{basis:"REALTIME",source:old.source,asOfMs:T+122999,last:102}).formingCandles).toBe(old.formingCandles);
  });
  it("rejects older generations/revisions and removes provenance on demotion",()=>{
    const old=quote(project({revision:3}));
    expect(mergeFormingQuote(old,quote(project({revision:2}))).formingCandles.revision).toBe(3);
    const demoted={basis:"DELAYED_15M",source:"polygon-delayed",asOfMs:T,last:90};
    expect(mergeFormingQuote(old,demoted)).toBe(demoted);
  });
});


describe("forming recovery regressions",()=>{
  it("preserves accepted complete OHLCV as the seed after a producer reset",()=>{
    const state=createLiveCandleState();
    const accepted=apply(initial(),project({minutes:[row(T,100,1500,150,90)]}),state)!;
    const partial=project({generation:"e4606eb2-61c0-43a9-b89e-ff8da926ebf4",generationStartedMs:T+1000,
      prefixThroughMs:0,streamFromMs:T+20000,minutes:[row(T,101,50,105,99)]});
    const result=apply(accepted.bars,partial,state)!;
    expect(result.bar).toMatchObject({h:150,l:90,v:1500,liveCoverage:"partial"});
  });
  it("does not let a retained snapshot suppress a newer measured price",()=>{
    const state=createLiveCandleState(), snapshot=project();
    const first=apply(initial(),snapshot,state)!;
    const newer=mergeFormingQuote(quote(snapshot),{basis:"REALTIME",source:"polygon-live-second",asOfMs:T+122999,last:107});
    const next=mutateLiveCandle(first.bars,newer,"1h","us",false,false,state,T+123000)!;
    expect(next.bar).toMatchObject({h:107,c:107,v:150,liveCoverage:"partial"});
    expect(next.changedBars).toHaveLength(1);
    expect(mutateLiveCandle(next.bars,newer,"1h","us",false,false,state,T+123000)).toBeNull();
  });
  it("repairs an unfinished prior session before applying today's retained minutes",()=>{
    const history=[{time:D-86400+4.5*3600,o:100,h:100,l:100,c:100,v:50}];
    expect(apply(history,project({},["1m"]),createLiveCandleState(),"1m")?.kind).toBe("history-gap");
  });
  it("allows a completed adjacent session to roll over on the first real tick",()=>{
    const history=[{time:D-86400+389*60,o:100,h:100,l:100,c:100,v:50}];
    expect(apply(history,project({},["1m"]),createLiveCandleState(),"1m")?.kind).toBe("new-bar");
  });
});


it("fences a retained snapshot after a history load until the producer advances",()=>{
  const snapshot=project();
  const state=createLiveCandleState(snapshot);
  const loaded=[{time:D,o:100,h:120,l:90,c:110,v:200}];
  expect(apply(loaded,snapshot,state)).toBeNull();
  const revision=project({revision:2,minutes:[row(T,110,210,121,90)]});
  expect(apply(loaded,revision,state)?.bar).toMatchObject({h:121,c:110,v:210});
});

it("does not certify a live-owned minute while an expired-component repair is pending",()=>{
  const snapshot=project({dirtyPrefix:true},["1m"]);
  expect(snapshot.series["regular:1m"].every(bar=>!bar.complete)).toBe(true);
});
