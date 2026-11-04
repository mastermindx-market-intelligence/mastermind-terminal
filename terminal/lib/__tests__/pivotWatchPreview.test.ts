import { it, expect } from "vitest";
import { buildPivotWatchPreview } from "@/lib/pivotWatchPreview";
import type { Bar6 } from "@/lib/intradayShared";
const eq = (a: unknown, b: unknown) => expect(a).toEqual(b);
const ok = (v: unknown) => expect(v).toBeTruthy();

const START = 2_000_000_100; // Abstract ET display epoch, aligned to 5m grid by session origin.
const base = (n: number): Bar6[] => Array.from({length:n},(_,i)=>[START+i*300,100,101,99,100,10000]);
const evidence = (symbol = "XLK", changes: Record<string, unknown> = {}) => ({
  schema: "terminal.intraday_source_evidence.v1", symbol, requested_timeframe: "5m",
  session: "regular", timestamp_basis: "market_local_display_epoch",
  assembly_clock: { cache_state: "new_assembly" }, point_in_time_availability: "not_verified", ...changes,
});
const history = (bars: readonly Bar6[], changes: Record<string, unknown> = {}) => ({
  bars, source_evidence: evidence("XLK", changes),
});
const make = (bars: readonly Bar6[], cutoff = START+bars.length*300, qualified=true, sessionEnd=START+78*300) =>
  buildPivotWatchPreview({history: qualified ? history(bars) : {bars}, symbol: "XLK",
    cutoffDisplayEpoch:cutoff,sessionStartDisplayEpoch:START,sessionEndDisplayEpoch:sessionEnd});
const bottom = (bars: readonly Bar6[],cutoff?: number) => make(bars,cutoff).rows[0];
const top = (bars: readonly Bar6[],cutoff?: number) => make(bars,cutoff).rows[1];

// 6 bars: OR high=101, low=99, frozen zone width=0.2.
it("warmup uses only completed six 5m bars",()=>{
 const b=base(6); eq(make(b.slice(0,5)).rows[0].state,"warming_up");
 const r=make(b); eq(r.levelKnownAtDisplayEpoch,START+1800); eq(r.rows[0].levelPrice,99);
 eq(r.rows[1].levelPrice,101); eq(r.rows[0].state,"watching");
});
it("no origin until sixth bar completes, forming bar ignored",()=>{
 const b=base(6); b[5]=[START+1500,100,999,0,0,0] as Bar6;
 const r=make(b,START+1600); eq(r.rows[0].state,"warming_up"); eq(r.levelKnownAtDisplayEpoch,null);
});
it("encounter and later confirmation have distinct timestamps",()=>{
 const b=base(6); b.push([START+1800,100,100.5,98.9,99.5,1200]);
 const mid=bottom(b); eq(mid.state,"forming"); eq(mid.firstEncounterAtDisplayEpoch,START+2100);
 eq(mid.resolutionAtDisplayEpoch,null);
 b.push([START+2100,99.7,101.2,99.5,101.1,1000]);
 const end=bottom(b); eq(end.state,"confirmed"); eq(end.firstEncounterAtDisplayEpoch,START+2100);
 eq(end.resolutionAtDisplayEpoch,START+2400);eq(end.reason,"reclaim_confirmed");
});
it("cannot confirm on encounter candle despite close above its prior range",()=>{
 const b=base(6); b.push([START+1800,100,103,98.95,102,1000]);
 eq(bottom(b).state,"forming");
});
it("same-bar invalidation takes precedence over favorable close",()=>{
 const b=base(6); b.push([START+1800,100,100.5,98.9,99.5,1000]);
 b.push([START+2100,99.5,103,98.7,102,1000]);
 eq(bottom(b).state,"failed");eq(bottom(b).reason,"level_breached");
});
it("top watch confirms later rejection independently",()=>{
 const b=base(6); b.push([START+1800,101,101.1,100.3,100.8,1000]);
 eq(top(b).state,"forming");
 b.push([START+2100,100,100.5,98.4,98.7,1000]);
 eq(top(b).state,"confirmed"); eq(top(b).reason,"rejection_confirmed");
});
it("opposite side may fail while near-side is only forming",()=>{
 const b=base(6); b.push([START+1800,100,100.4,98.6,99.5,1000]);
 eq(bottom(b).state,"failed"); eq(top(b).state,"watching");
});
it("unvisited watch expires after 24 post-origin completed bars",()=>{
 const b=base(6);
 for(let i=0;i<24;i++) b.push([START+(i+6)*300,100,100.5,99.5,100,1000]);
 eq(bottom(b.slice(0,-1)).state,"watching");
 eq(bottom(b).state,"expired"); eq(bottom(b).reason,"watch_timeout");
});
it("an unresolved encounter expires only after six subsequent bars",()=>{
 const b=base(6); b.push([START+1800,100,100.1,99.05,99.6,1000]);
 for(let i=0;i<6;i++) b.push([START+(7+i)*300,99.6,100.1,99.1,99.7,1000]);
 eq(bottom(b.slice(0,-1)).state,"forming");
 eq(bottom(b).state,"expired");eq(bottom(b).reason,"confirmation_timeout");
});
it("no backward repaint after later confirmation; prefix is still forming",()=>{
 const b=base(6);b.push([START+1800,99.7,100.2,99.0,99.5,1000]);
 b.push([START+2100,99.8,100.5,99.5,100.4,1000]);
 eq(bottom(b,START+2100).state,"forming");
 eq(bottom(b,START+2400).state,"confirmed");
});
it("bad series missing middle bar refuses instead of bridging",()=>{
 const b=base(8).filter((_,i)=>i!==3);eq(make(b).rows[0].reason,"missing_interval");
});
it("duplicate and out-of-order completed bars refuse",()=>{
 const b=base(6);eq(make([...b,b[5]]).rows[0].reason,"invalid_series");
 eq(make([b[1],b[0],...b.slice(2)]).rows[0].reason,"invalid_series");
});
it("future OHLCV is ignored without inspection",()=>{
 const b=base(6);b.push([START+1800,Number.NaN,Number.NaN,0,0,0]);
 eq(make(b,START+1800).rows[0].state,"watching");
});
it("wrong session and early-close boundaries never bridge",()=>{
 const b=base(6);b.push([START+78*300,100,100,99,100,100]);
 eq(make(b,START+1800).rows[0].state,"watching");
 const early=make(base(7),START+7*300,true,START+6*300);
 eq(early.rows[0].state,"watching");
});
it("source qualification and malformed data fail closed",()=>{
 const b=base(6);eq(make(b,START+1800,false).rows[0].reason,"source_unqualified");
 b[0]=[START,100,90,99,100,100];eq(make(b).rows[0].reason,"invalid_series");
});
it("cannot pass invalid clock, no forecast and no issuer evidence claim",()=>{
 const b=base(6);const r=make(b,-1);eq(r.rows[0].reason,"invalid_clock");
 const result=make(b);eq(result.authority,"reconstructed_descriptive_only");
 eq(result.outcomesAreAsIssued,false);ok(!("probability" in result.rows[0]));
});
it("a known level stays fixed with later extrema",()=>{
 const b=base(6);b.push([START+1800,100,100.2,99.5,100,100]);
 const r=make(b); eq(r.rows[0].levelPrice,99);eq(r.rows[1].levelPrice,101);
});

it("requires exact source evidence rather than a caller-supplied boolean", () => {
  for(const raw of [null, {bars:base(6)}, {bars:base(6),source_evidence:{}},
    {bars:base(6),source_evidence:"unverified"}]) {
    const r=buildPivotWatchPreview({history:raw,symbol:"XLK",cutoffDisplayEpoch:START+1800,
      sessionStartDisplayEpoch:START,sessionEndDisplayEpoch:START+78*300});
    eq(r.rows[0].reason,"source_unqualified");eq(r.sourceQualified,false);
  }
});
it("rejects mismatched source symbol, timeframe, session, schema and clock basis", () => {
  for(const delta of [{symbol:"XLF"},{requested_timeframe:"1m"},{requested_timeframe:"30m"},
    {session:"extended"},{timestamp_basis:"utc_ms"},{schema:"wrong"}]){
    const r=buildPivotWatchPreview({history:history(base(6),delta),symbol:"XLK",
      cutoffDisplayEpoch:START+1800,sessionStartDisplayEpoch:START,sessionEndDisplayEpoch:START+78*300});
    eq(r.rows[0].reason,"source_unqualified");eq(r.sourceQualified,false);
  }
});
it("rejects a stale cache without promoting the HTTP receipt into a source event time",()=>{
  const r=buildPivotWatchPreview({history:history(base(6),{assembly_clock:{cache_state:"stale_cache"}}),
    symbol:"XLK",cutoffDisplayEpoch:START+1800,sessionStartDisplayEpoch:START,sessionEndDisplayEpoch:START+78*300});
  eq(r.rows[0].reason,"source_unqualified");eq(r.sourceQualified,false);
});
it("admits evidence basis only, never as-issued or PIT semantic claims",()=>{
  const r=make(base(7));eq(r.sourceQualified,true);eq(r.authority,"reconstructed_descriptive_only");
  eq(r.outcomesAreAsIssued,false);ok(!("probability" in r.rows[0]));
});
it("missing input bars and malformed instrument identities fail closed",()=>{
  const clock={cutoffDisplayEpoch:START+1800,sessionStartDisplayEpoch:START,sessionEndDisplayEpoch:START+78*300};
  eq(buildPivotWatchPreview({history:{source_evidence:evidence()},symbol:"XLK",...clock}).rows[0].reason,"source_unqualified");
  for(const symbol of ["", "xlk", "XLK$", "A".repeat(16)])
    eq(buildPivotWatchPreview({history:history(base(6),{symbol}),symbol,...clock}).rows[0].reason,"source_unqualified");
});
it("a newer cutoff with missing completed bars is unavailable, not fresh",()=>{
  const r=make(base(7),START+3900);eq(r.rows[0].state,"unavailable");
  eq(r.rows[0].reason,"missing_interval");eq(r.measuredUntilDisplayEpoch,START+2100);
});
it("a preceding session's bar cannot redefine the known opening range",()=>{
  const b=base(6);b.unshift([START-300,100,200,1,100,1000]);
  const r=make(b,START+1800);eq(r.sourceQualified,true);eq(r.rows[0].state,"watching");eq(r.rows[0].levelPrice,99);
});

it("approach is observable before first touch and never a forecast", () => {
  const b = base(6);
  b.push([START+1800, 100, 100.1, 99.4, 99.5, 1000]);
  const r = make(b), s = r.rows[0];
  eq(s.state, "approaching"); eq(s.reason, "approach_observed");
  eq(s.firstEncounterAtDisplayEpoch, null); eq(s.resolutionAtDisplayEpoch, null);
  eq(s.levelKnownAtDisplayEpoch, START+1800);
  eq(s.lastClose, 99.5); ok(Math.abs((s.distanceFromLevelPct ?? 0) - 100 * (.5/99)) < 1e-8);
  eq(r.authority, "reconstructed_descriptive_only"); eq(r.outcomesAreAsIssued, false);
});
it("top can approach while support is still unvisited", () => {
  const b = base(6); b.push([START+1800, 100.4, 100.6, 100.2, 100.5, 1000]);
  eq(top(b).state, "approaching"); eq(top(b).reason, "approach_observed");
  eq(bottom(b).state, "watching");
});
it("approach is a current measurement and can withdraw without a persistent event", () => {
  const b = base(6); b.push([START+1800,100,100.1,99.4,99.5,1000]);
  eq(bottom(b).state, "approaching");
  b.push([START+2100,100,100.5,99.7,100.1,1000]);
  eq(bottom(b).state, "watching"); eq(bottom(b).firstEncounterAtDisplayEpoch, null);
});
it("confirmed touch outranks proximity; invalidation outranks both", () => {
  const b = base(6); b.push([START+1800,100,100.1,99.1,99.5,1000]);
  eq(bottom(b).state,"forming");
  b[6] = [START+1800,100,102,98.6,99.5,1000];
  eq(bottom(b).state,"failed");
});
it("chart-visible bars are only the qualified completed prefix", () => {
  const b=base(6); b.push([START+1800, Number.NaN, Number.NaN, 0, 0, 0]);
  const r=make(b,START+1800);
  eq(r.visibleBars.length, 6); eq(r.visibleBars.at(-1)?.[0],START+1500);
  eq(r.rows[0].levelPrice,99);
  eq(make(b,START+2100).visibleBars.length,0);
});
it("source refusal and gaps cannot leak chart bars or an inferred level", () => {
  const b=base(6); eq(make(b, START+1800, false).visibleBars, []);
  b.splice(2,1); eq(make(b).visibleBars, []);
});

it("returned chart prefix is frozen against later source revisions",()=>{
 const b=base(6),r=make(b);
 eq(Object.isFrozen(r.visibleBars),true);
 b[0][4]=999;b[1]=[START+300,0,0,0,0,0] as Bar6;
 eq(r.visibleBars[0][4],100);eq(r.visibleBars[1][4],100);
 eq(Object.isFrozen(r.visibleBars[0]),true);
});
