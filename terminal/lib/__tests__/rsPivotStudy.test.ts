import { describe, expect, it } from "vitest";
import { prepareStudyBarsFrom5m, nextStudyBarOpen, runRSPivotStudy, summarizeTrades } from "../rsPivotStudy";
import { usRegularSessionWindow } from "../usEquitySessionClock";
import { liveDisplayEpoch } from "../liveCandle";
import type { Bar6 } from "../intradayShared";
const cutoff = Date.parse("2026-10-01T17:00:00Z") / 1000;
const settings = { rsShortBars: 5, rsLongBars: 26 };
function history(days = 36): Bar6[] {
  const out: Bar6[] = []; let t = Date.parse("2026-08-03T00:00:00Z") / 1000;
  for (let n = 0; n < days; t += 86400) {
    const w = usRegularSessionWindow(t); if (!w) continue;
    for (let m = w[0]; m < w[1]; m += 30) { const p = 100 + out.length * .03; out.push([t+m*60,p-.1,p+.3,p-.3,p,10000]); }
    n++;
  } return out;
}
function bench(s: Bar6[]): Bar6[] { return s.map(b => [b[0],100,100.3,99.7,100,10000]); }
function panel(signal = 64) {
  const stock = history(), benchmark = bench(stock);
  stock[signal-3] = [stock[signal-3][0],101,102,100,101.5,10000];
  stock[signal] = [stock[signal][0],101.4,102.4,100.1,102.2,10000];
  return {stock,benchmark};
}
const run = (s: Bar6[], b = bench(s), costBps = 10) => runRSPivotStudy(s,b,"SPY",{...settings,costBps},cutoff);
const arm = (r: ReturnType<typeof run>, name="rs_pivot") => r.results.find(x=>x.arm===name)!;
describe("RS 30-minute causal research lab", () => {
  it("rejects corrupt/duplicate/unsorted bars, invalid costs and missing benchmark", () => {
    const s=history(); expect(()=>run([s[0],s[0]])).toThrow(/duplicate/); expect(()=>run([...s].reverse())).toThrow(/out-of-order/);
    const wrong=s.map(b=>[...b] as Bar6); wrong[0][2]=wrong[0][3]-1; expect(()=>run(wrong)).toThrow(/malformed/);
    wrong[0][2]=NaN; expect(()=>run(wrong)).toThrow(/malformed/); expect(()=>run(s,[])).toThrow(/Insufficient/); expect(()=>run(s,bench(s),-1)).toThrow(/parameters/);
  });
  it("never synthesizes missing benchmark mates",()=>{const s=history(); expect(()=>run(s,bench(s).filter((_,i)=>i%13!==0))).toThrow(/Insufficient/);});
  it("confirms at candle close, observes reclaim at close, enters next-session open",()=>{
    const {stock,benchmark}=panel(); const ts=arm(run(stock,benchmark)).trades; expect(ts.length).toBeGreaterThan(0); const t=ts[0];
    expect(t.pivotAt).toBe(stock[61][0]); expect(t.confirmedAt).toBe(stock[63][0]+1800); expect(t.signalBarAt).toBe(stock[64][0]);
    expect(t.signalAt).toBe(stock[64][0]+1800); expect(t.entryAt).toBe(stock[65][0]); expect(t.entry).toBe(stock[65][1]);
    for(const t of ts) {expect(t.confirmedAt!).toBeLessThanOrEqual(t.signalBarAt); expect(t.entryAt).toBeGreaterThanOrEqual(t.signalAt); expect(t.exitAt).toBe(t.exitBarAt+(t.exitTiming==="open"?0:1800));}
  });
  it("stop wins an OHLC stop/target tie without counting the post-stop high",()=>{
    const {stock,benchmark}=panel(); stock[65]=[stock[65][0],102,110,98,102,10000]; const t=arm(run(stock,benchmark)).trades[0];
    expect(t).toBeDefined(); expect(t.exitReason).toBe("stop"); expect(t.exit).toBe(t.stop); expect(t.exitTiming).toBe("within_bar_unknown"); expect(t.mfeR).toBe(0); expect(t.maeR).toBe(-1);
  });
  it("rejects gap-through-stop entries",()=>{const {stock,benchmark}=panel(); stock[65]=[stock[65][0],98,99,97,98.5,10000]; const a=arm(run(stock,benchmark)); expect(a.rejectedRisk).toBeGreaterThan(0); expect(a.trades.some(t=>t.signalBarAt===stock[64][0])).toBe(false);});
  it("books an overnight stop at the actual open",()=>{
    const {stock,benchmark}=panel(63); stock[65]=[stock[65][0],98,99,97,98.5,10000]; const t=arm(run(stock,benchmark)).trades.find(t=>t.signalBarAt===stock[63][0]);
    expect(t).toBeDefined(); expect(t!.exit).toBe(98); expect(t!.exitAt).toBe(stock[65][0]); expect(t!.exitTiming).toBe("open"); expect(t!.grossR).toBeLessThan(-1);
  });
  it("costs change only net results on identical fills",()=>{
    const {stock,benchmark}=panel(); const free=arm(run(stock,benchmark,0)), costly=arm(run(stock,benchmark,50)); expect(free.trades.length).toBeGreaterThan(0); expect(costly.trades.length).toBe(free.trades.length);
    free.trades.forEach((t,i)=>{const c=costly.trades[i]; expect(c.entryAt).toBe(t.entryAt); expect(c.exitAt).toBe(t.exitAt); expect(c.rNet).toBeCloseTo(c.grossR-c.costsR,10); expect(c.rNet).toBeLessThan(t.rNet);});
  });
  it("RS controls share candidate populations; negative RS filters only RS arms",()=>{
    const {stock,benchmark}=panel(); benchmark.forEach((b,i)=>{const p=100+i*.2; b.splice(1,4,p,p+.3,p-.3,p);}); const r=run(stock,benchmark);
    expect(arm(r).candidates).toBe(arm(r,"pivot").candidates); expect(arm(r,"rs_ema").candidates).toBe(arm(r,"ema").candidates);
    expect(arm(r).trades).toHaveLength(0); expect(arm(r).filteredRS).toBeGreaterThan(0); expect(arm(r,"pivot").trades.length).toBeGreaterThan(0);
  });
  it("missing exchange sessions reset state and leave crossing positions unresolved",()=>{
    const {stock,benchmark}=panel(63); const missing=new Date(stock[65][0]*1000).toISOString().slice(0,10); const keep=(b:Bar6)=>!new Date(b[0]*1000).toISOString().startsWith(missing);
    const r=run(stock.filter(keep),benchmark.filter(keep)); expect(r.coverage.segments).toBe(2); expect(r.coverage.missingExchangeSessions).toBe(1); expect(arm(r).unresolved).toBeGreaterThan(0); expect(arm(r).trades.some(t=>t.signalBarAt===stock[63][0])).toBe(false);
  });
  it("excludes a live candle despite a full set of final-day timestamps",()=>{const s=history(); const r=runRSPivotStudy(s,bench(s),"SPY",settings,s.at(-1)![0]+900); expect(r.coverage.excludedFutureBars).toBe(1); expect(r.coverage.alignedBars).toBe(s.length-13); expect(r.results.flatMap(x=>x.trades).every(t=>t.exitAt<=r.asOfDisplayEpoch)).toBe(true);});
  it("discloses a partial interior session separately from wholly missing sessions",()=>{
    const stock=history().filter((_,i)=>i!==100); const r=run(stock);
    expect(r.coverage.incompleteSessions).toBe(1); expect(r.coverage.missingExchangeSessions).toBe(0);
    expect(r.coverage.segments).toBe(2);
  });
  it("shows a pivot confirmed by the latest completed candle without making an earlier trade",()=>{
    const stock=history(), i=stock.length-3; stock[i]=[stock[i][0],113,114,98,113.5,10000];
    const r=run(stock); expect(r.lastCompleted?.pivotPrice).toBe(98);
    expect(r.lastCompleted?.confirmedAt).toBe(stock.at(-1)![0]+1800);
    expect(r.results.flatMap(x=>x.trades).some(t=>t.pivotAt===stock[i][0])).toBe(false);
  });
  it("split-like ambiguous gaps reset state and cannot produce a bridged P&L",()=>{
    const {stock,benchmark}=panel(); for(let i=100;i<stock.length;i++) for(let j=1;j<=4;j++) stock[i][j]/=2;
    const r=run(stock,benchmark); expect(r.coverage.discontinuities).toBe(1); expect(r.coverage.segments).toBe(2); expect(r.results.flatMap(x=>x.trades).every(t=>!(t.entryAt<stock[100][0]&&t.exitAt>=stock[100][0]))).toBe(true);
  });
  it("uses the owner calendar for DST, half-days and holidays",()=>{
    const at=(d:string)=>Date.parse(d+"Z")/1000;
    expect(nextStudyBarOpen(at("2026-03-06T15:30:00"))).toBe(at("2026-03-09T09:30:00")); expect(nextStudyBarOpen(at("2026-11-27T12:30:00"))).toBe(at("2026-11-30T09:30:00")); expect(nextStudyBarOpen(at("2026-09-04T15:30:00"))).toBe(at("2026-09-08T09:30:00"));
    expect(liveDisplayEpoch(Date.parse("2026-03-09T13:30:00Z"),"us")).toBe(at("2026-03-09T09:30:00")); expect(liveDisplayEpoch(Date.parse("2026-03-06T14:30:00Z"),"us")).toBe(at("2026-03-06T09:30:00"));
  });
  it("replays with frozen cutoff, conserves denominators and avoids overlap",()=>{
    const {stock,benchmark}=panel(); const r=run(stock,benchmark); expect(run(stock,benchmark)).toEqual(r); expect(r.schema).toBe("terminal.rs_pivot_study.v2");
    for(const a of r.results) {expect(a.candidates).toBe(a.trades.length+a.censored+a.unresolved+a.filteredRS+a.rejectedRisk+a.missedEntry+a.overlapping); for(let i=1;i<a.trades.length;i++) expect(a.trades[i].entryAt).toBeGreaterThan(a.trades[i-1].exitBarAt);}
  });
  it("never invents profitability from no trades",()=>{expect(summarizeTrades([])).toMatchObject({trades:0,winRate:null,expectancyR:null,profitFactor:null});});
});

describe("5m constituent geometry", () => {
  const base = Date.parse("2026-11-27T09:30:00Z") / 1000;
  const raw = Array.from({length:42},(_,i)=>[base+i*300,100,102,99,101,10] as Bar6);
  it("aggregates six slots, preserving OHLCV and half-day close",()=>{
    const out=prepareStudyBarsFrom5m(raw,base+12600); expect(out.bars).toHaveLength(7);
    expect(out.bars[0]).toEqual([base,100,102,99,101,60]); expect(out.bars.at(-1)![0]+1800).toBe(base+12600);
  });
  it("excludes a missing 5m slot rather than stitching a partial bucket",()=>{
    const out=prepareStudyBarsFrom5m(raw.filter((_,i)=>i!==2),base+12600); expect(out.bars).toHaveLength(6); expect(out.incompleteBuckets).toBe(1);
  });
  it("rejects a 4m observation on the declared 5m grid",()=>{
    const wrong=raw.map(b=>[...b] as Bar6); wrong[1][0]=base+240; expect(()=>prepareStudyBarsFrom5m(wrong,base+12600)).toThrow(/5m input grid/);
  });
  it("excludes the current bucket even with a full grid",()=>{
    const out=prepareStudyBarsFrom5m(raw,base+12300); expect(out.bars).toHaveLength(6); expect(out.futureBuckets).toBe(1);
  });
});
