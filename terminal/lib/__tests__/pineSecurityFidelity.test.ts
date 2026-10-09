import { describe, it, expect } from "vitest";
import { runPine, type Bar } from "../pine-engine";
// Parent reproduction: actual runtime historical default, not a universal prefix equality claim.
// Primary contract: https://www.tradingview.com/pine-script-docs/concepts/other-timeframes-and-data/
// lookahead_off publishes new historical values at HTF-period end; current engine isrealtime=false.
// Daily→1W period end is the last actual session of a *closed* ISO-week group (successor bar in a
// later ISO week). RunOpts has no period-closed/calendar witness — the final tail is uncertified.
const dates = ["2025-01-06","2025-01-07","2025-01-08","2025-01-09","2025-01-10","2025-01-13","2025-01-14","2025-01-15","2025-01-16","2025-01-17"];
function fixture(): Bar[] { return dates.map((time,i)=>({time,o:100+i,h:102+i,l:99+i,c:101+i,v:1000+i})); }
function barsOn(days: string[]): Bar[] { return days.map((time,i)=>({time,o:100+i,h:102+i,l:99+i,c:101+i,v:1000+i})); }
function runSec(bars: Bar[], expression="close", extra="") {
  const merge = extra ? `, ${extra}` : "";
  const out = runPine(`//@version=6
indicator("historical knowledge")
x=request.security(syminfo.tickerid, "W", ${expression}${merge})
plot(x,"x")`, bars, { timeframe: "1D", symbol: "TEST" });
  expect(out.ok, JSON.stringify(out.errors)).toBe(true);
  return out;
}
function values(bars: Bar[], expression="close", extra="") {
  return runSec(bars, expression, extra).result!.plots.find(p => p.title === "x")!.data.map(p => p.value);
}
describe("historical default HTF knowledge", () => {
  it("weekly inline expression uses requested timeframe metadata, not chart daily metadata",()=>{
    const closed=barsOn([...dates,"2025-01-20"]);
    expect(values(closed,"timeframe.isweekly ? close : -1")[4]).toBe(105);
    expect(values(closed,'timeframe.period == "W" ? close : -1')[4]).toBe(105);
  });
  it("daily seven-session weeks cannot publish Sunday's future close on Friday",()=>{
    const days=["2025-01-06","2025-01-07","2025-01-08","2025-01-09","2025-01-10","2025-01-11","2025-01-12","2025-01-13"];
    const a=days.map((time,i)=>({time,o:100+i,h:102+i,l:99+i,c:101+i,v:1000+i}));
    const b=a.map(r=>({...r}));b[6].c=8888;b[6].h=9999;b[6].v=99999;
    expect(values(b).slice(0,5)).toEqual(values(a).slice(0,5));
  });
  it("changing Friday OHLCV cannot alter earlier Monday-Thursday default security values", () => {
    const a = fixture(), b = fixture(); b[4] = { ...b[4], h: 9999, l: 1, c: 8888, v: 999999 };
    for (const expr of ["close", "high", "low", "volume"]) { expect(values(b, expr).slice(0, 4), expr).toEqual(values(a, expr).slice(0, 4)); }
  });
  it("historical lookahead_off publishes weekly close at Friday then carries that confirmed value", () => {
    // NAMED CONTRADICTION parent-original-final-Friday-closed-without-calendar-witness:
    // the parent strict five-day example assumed fixture()[9] (Friday 2025-01-17, close 110) was
    // period-closed, but RunOpts has no calendar/period-closed metadata and array end is not HTF
    // period close. W1 (Mon-Fri ending 2025-01-10) IS closed — a later ISO-week bar exists — and
    // still publishes 105 at Friday last actual session. The uncertified final tail carries that
    // previous confirmed value rather than inventing a Friday-closed 110.
    expect(values(fixture())).toEqual([undefined, undefined, undefined, undefined, 105, 105, 105, 105, 105, 105]);
  });
  it("completed five-session ISO weeks with a next-period bar publish at Friday last actual session", () => {
    const closed = barsOn([...dates, "2025-01-20"]);
    expect(values(closed).slice(0, 10)).toEqual([undefined, undefined, undefined, undefined, 105, 105, 105, 105, 105, 110]);
  });
});

describe("named weekly lookahead/gaps witnesses", () => {
  it("explicit lookahead_off + gaps_off matches omitted-default publication", () => {
    const extra = "gaps=barmerge.gaps_off, lookahead=barmerge.lookahead_off";
    expect(values(fixture(), "close", extra)).toEqual(values(fixture()));
  });
  it("lookahead_off + gaps_on returns NA except at Friday confirmation", () => {
    const extra = "gaps=barmerge.gaps_on, lookahead=barmerge.lookahead_off";
    // NAMED CONTRADICTION parent-original-final-Friday-closed-without-calendar-witness: last 110
    // assumed the uncertified final Friday was a confirmation. Closed W1 Friday 105 is retained;
    // final tail is NA (gaps_on does not carry). Completed-group equivalent is the next test.
    expect(values(fixture(), "close", extra)).toEqual([undefined, undefined, undefined, undefined, 105, undefined, undefined, undefined, undefined, undefined]);
  });
  it("lookahead_off + gaps_on on completed five-session groups confirms at Friday last actual session", () => {
    const extra = "gaps=barmerge.gaps_on, lookahead=barmerge.lookahead_off";
    const closed = barsOn([...dates, "2025-01-20"]);
    expect(values(closed, "close", extra).slice(0, 10)).toEqual([undefined, undefined, undefined, undefined, 105, undefined, undefined, undefined, undefined, 110]);
  });
  it("lookahead_on publishes current weekly close from period start (sees Friday from Monday)", () => {
    const extra = "lookahead=barmerge.lookahead_on";
    expect(values(fixture(), "close", extra)).toEqual([105, 105, 105, 105, 105, 110, 110, 110, 110, 110]);
  });
  it("lookahead_on + close[1] projects prior confirmed at period start", () => {
    const extra = "lookahead=barmerge.lookahead_on";
    expect(values(fixture(), "close[1]", extra)).toEqual([undefined, undefined, undefined, undefined, undefined, 105, 105, 105, 105, 105]);
  });
  it("lookahead_off + close[1] offsets the published HTF bar (not the old leaky intra-week confirmed[1])", () => {
    // Conflict named: flagship secScalar is request.security(..., rep ? _src : _src[1], lookahead=barmerge.lookahead_off)
    // intending confirmed-on-every-intra-week-bar. That matched the old full-bucket mapping where
    // close[1] was W1 on all of W2. Vendor historical lookahead_off publishes unshifted close at
    // closed-group last session; [1] is then one published HTF bar earlier. NAMED CONTRADICTION
    // parent-original-final-Friday-closed-without-calendar-witness: 105 on fixture W2 Friday assumed
    // that uncertified tail was a published HTF bar. Uncertified tail close[1] is NA; completed
    // groups with a next-period bar still publish 105 on W2 Friday (see next test).
    // Default flagship confirmTF on daily is 3D — outside this 1W vertical.
    const extra = "lookahead=barmerge.lookahead_off";
    expect(values(fixture(), "close[1]", extra)).toEqual([undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined]);
  });
  it("lookahead_off + close[1] on completed five-session groups is the prior published HTF bar at Friday", () => {
    const extra = "lookahead=barmerge.lookahead_off";
    const closed = barsOn([...dates, "2025-01-20"]);
    expect(values(closed, "close[1]", extra).slice(0, 10)).toEqual([undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 105]);
  });
  it("lookahead_on Friday perturbation alters Monday of the same week; lookahead_off does not", () => {
    const a = fixture(), b = fixture(); b[4] = { ...b[4], c: 8888 };
    expect(values(b, "close", "lookahead=barmerge.lookahead_on").slice(0, 4)).toEqual([8888, 8888, 8888, 8888]);
    expect(values(a, "close", "lookahead=barmerge.lookahead_on").slice(0, 4)).toEqual([105, 105, 105, 105]);
    expect(values(b).slice(0, 4)).toEqual(values(a).slice(0, 4));
  });
});

describe("partial-tail and future-perturbation weekly witnesses", () => {
  const tailDates = [...dates, "2025-01-20", "2025-01-21", "2025-01-22"]; // Mon-Wed truncated week; not Friday close
  function tailFixture(): Bar[] { return tailDates.map((time, i) => ({ time, o: 100 + i, h: 102 + i, l: 99 + i, c: 101 + i, v: 1000 + i })); }
  it("Wednesday truncated tail is not confirmed merely because it is the last array item", () => {
    const got = values(tailFixture());
    expect(got).toEqual([undefined, undefined, undefined, undefined, 105, 105, 105, 105, 105, 110, 110, 110, 110]);
    expect(got.slice(10)).not.toEqual([113, 113, 113]);
  });
  it("truncated tail emits explicit missing calendar/session evidence (array end ≠ period close)", () => {
    const out = runSec(tailFixture());
    const w = out.result!.warnings.filter((m) => m.includes("period close") || m.includes("calendar/session") || m.includes("not confirmed"));
    expect(w.length, JSON.stringify(out.result!.warnings)).toBeGreaterThanOrEqual(1);
    expect(w.some((m) => m.includes("array end") && m.includes("period close"))).toBe(true);
  });
  it("perturbing the unconfirmed Wednesday tail cannot alter earlier confirmed Friday publication", () => {
    const a = tailFixture(), b = tailFixture();
    b[12] = { ...b[12], h: 9999, l: 1, c: 7777, v: 9 };
    expect(values(b).slice(0, 10)).toEqual(values(a).slice(0, 10));
    expect(values(b).slice(10)).toEqual([110, 110, 110]);
  });
  it("lookahead_on on a truncated tail does see the unconfirmed Wednesday close from Monday", () => {
    expect(values(tailFixture(), "close", "lookahead=barmerge.lookahead_on").slice(10)).toEqual([113, 113, 113]);
  });
});

describe("closed-group last-session availability (5-day, 7-day, holiday, missing Friday)", () => {
  it("seven-session closed ISO week publishes at Sunday last actual session, not Friday", () => {
    const days=["2025-01-06","2025-01-07","2025-01-08","2025-01-09","2025-01-10","2025-01-11","2025-01-12","2025-01-13"];
    const a=barsOn(days);
    expect(values(a)).toEqual([undefined, undefined, undefined, undefined, undefined, undefined, 107, 107]);
  });
  it("mutating Sunday of a closed seven-session week cannot alter Monday-Saturday defaults", () => {
    const days=["2025-01-06","2025-01-07","2025-01-08","2025-01-09","2025-01-10","2025-01-11","2025-01-12","2025-01-13"];
    const a=barsOn(days);
    const b=a.map(r=>({...r}));b[6].c=8888;b[6].h=9999;b[6].v=99999;
    expect(values(b).slice(0,6)).toEqual(values(a).slice(0,6));
    expect(values(b)[6]).toBe(8888);
    expect(values(a)[6]).toBe(107);
  });
  it("missing Friday in a closed ISO week confirms at Thursday last actual session", () => {
    const days=["2025-01-06","2025-01-07","2025-01-08","2025-01-09","2025-01-13"];
    expect(values(barsOn(days))).toEqual([undefined, undefined, undefined, 104, 104]);
  });
  it("mutating Thursday of a holiday-closed week cannot alter Monday-Wednesday defaults", () => {
    const days=["2025-01-06","2025-01-07","2025-01-08","2025-01-09","2025-01-13"];
    const a=barsOn(days);
    const b=a.map(r=>({...r}));b[3]={...b[3],h:9999,l:1,c:8888,v:9};
    expect(values(b).slice(0,3)).toEqual(values(a).slice(0,3));
    expect(values(a)[3]).toBe(104);
    expect(values(b)[3]).toBe(8888);
  });
  it("Mon-Thu without a later ISO-week bar is an uncertified tail, not a holiday close", () => {
    const days=["2025-01-06","2025-01-07","2025-01-08","2025-01-09"];
    const got=values(barsOn(days));
    expect(got).toEqual([undefined, undefined, undefined, undefined]);
    const out=runSec(barsOn(days));
    const w=out.result!.warnings.filter((m)=>m.includes("period close")||m.includes("calendar/session")||m.includes("not confirmed"));
    expect(w.length, JSON.stringify(out.result!.warnings)).toBeGreaterThanOrEqual(1);
  });
  it("missing Friday with a Saturday session confirms at Saturday, not Thursday", () => {
    const days=["2025-01-06","2025-01-07","2025-01-08","2025-01-09","2025-01-11","2025-01-13"];
    const a=barsOn(days);
    expect(values(a)).toEqual([undefined, undefined, undefined, undefined, 105, 105]);
    const b=a.map(r=>({...r}));b[4].c=8888;
    expect(values(b).slice(0,4)).toEqual(values(a).slice(0,4));
    expect(values(b)[4]).toBe(8888);
  });
  it("completed five-session future-price perturbation cannot alter the prior closed week", () => {
    const closed=barsOn([...dates,"2025-01-20"]);
    const b=closed.map(r=>({...r}));b[9]={...b[9],h:9999,l:1,c:8888,v:9};
    expect(values(b).slice(0,5)).toEqual(values(closed).slice(0,5));
    expect(values(closed).slice(0,5)).toEqual([undefined, undefined, undefined, undefined, 105]);
  });
});

describe("requested timeframe metadata binds to request context", () => {
  const closed = () => barsOn([...dates, "2025-01-20"]);
  function runSrc(src: string, bars: Bar[] = closed()) {
    const out = runPine(src, bars, { timeframe: "1D", symbol: "TEST" });
    expect(out.ok, JSON.stringify(out.errors)).toBe(true);
    return out;
  }
  function plot(out: ReturnType<typeof runSrc>, title: string) {
    return out.result!.plots.find((p) => p.title === title)!.data.map((p) => p.value);
  }

  it("chart-context timeframe metadata stays daily outside request", () => {
    const out = runSrc(`//@version=6
indicator("chart context")
plot(timeframe.isweekly ? 1 : 0, "w")
plot(timeframe.isdaily ? 1 : 0, "d")
plot(timeframe.ismonthly ? 1 : 0, "mo")
plot(timeframe.isintraday ? 1 : 0, "i")
plot(timeframe.period == "1D" ? 1 : 0, "p")
plot(timeframe.multiplier, "m")
plot(close, "c")
`);
    const n = plot(out, "c").length;
    expect(plot(out, "w")).toEqual(Array(n).fill(0));
    expect(plot(out, "d")).toEqual(Array(n).fill(1));
    expect(plot(out, "mo")).toEqual(Array(n).fill(0));
    expect(plot(out, "i")).toEqual(Array(n).fill(0));
    expect(plot(out, "p")).toEqual(Array(n).fill(1));
    expect(plot(out, "m")).toEqual(Array(n).fill(1));
  });

  it("weekly request binds multiplier/isdaily/isweekly/ismonthly/isintraday together", () => {
    const out = runSrc(`//@version=6
indicator("htf meta")
plot(request.security(syminfo.tickerid, "W", timeframe.isweekly ? close : -1), "w")
plot(request.security(syminfo.tickerid, "W", timeframe.isdaily ? -1 : close), "d")
plot(request.security(syminfo.tickerid, "W", timeframe.ismonthly ? -1 : close), "mo")
plot(request.security(syminfo.tickerid, "W", timeframe.isintraday ? -1 : close), "i")
plot(request.security(syminfo.tickerid, "W", timeframe.multiplier == 1 ? close : -1), "m")
plot(request.security(syminfo.tickerid, "W", timeframe.period == "W" ? close : -1), "p")
`);
    for (const title of ["w", "d", "mo", "i", "m", "p"]) {
      expect(plot(out, title)[4], title).toBe(105);
    }
  });

  it("user function in weekly request retains timeframe binding", () => {
    const out = runSrc(`//@version=6
indicator("fn bind")
f() => timeframe.isweekly ? close : -1
plot(request.security(syminfo.tickerid, "W", f()), "x")
`);
    expect(plot(out, "x")[4]).toBe(105);
  });

  it("user function expression-arg and [1] history retain requested binding", () => {
    const extra = "lookahead=barmerge.lookahead_off";
    expect(values(closed(), "close[1]", extra).slice(0, 10)).toEqual([undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 105]);
    const out = runSrc(`//@version=6
indicator("fn hist")
f(src) => src
g(src) => src[1]
plot(request.security(syminfo.tickerid, "W", f(timeframe.isweekly ? close : -1)), "f")
plot(request.security(syminfo.tickerid, "W", g(timeframe.isweekly ? close : -1), lookahead=barmerge.lookahead_off), "g")
plot(request.security(syminfo.tickerid, "W", (timeframe.isweekly ? close : -1)[1], lookahead=barmerge.lookahead_off), "h")
`);
    expect(plot(out, "f")[4]).toBe(105);
    expect(plot(out, "g").slice(0, 10)).toEqual([undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 105]);
    expect(plot(out, "h").slice(0, 10)).toEqual([undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 105]);
  });

  it("nested finer request inside weekly expression is NA + diagnostic, not lexical daily", () => {
    const out = runSrc(`//@version=6
indicator("nested finer")
x = request.security(syminfo.tickerid, "W", request.security(syminfo.tickerid, "1D", close))
plot(x, "x")
plot(close, "c")
`);
    const x = plot(out, "x");
    expect(x.every((v) => v === undefined)).toBe(true);
    expect(x).not.toEqual(plot(out, "c"));
    expect(x[4]).not.toBe(105);
    const finer = out.result!.warnings.filter((w) => w.includes("finer than chart"));
    expect(finer.length, JSON.stringify(out.result!.warnings)).toBeGreaterThanOrEqual(1);
    expect(finer.some((w) => w.includes("'W'"))).toBe(true);
  });

  it("nested coarser request inside weekly expression is NA + deduplicated diagnostic", () => {
    const out = runSrc(`//@version=6
indicator("nested coarser")
x = request.security(syminfo.tickerid, "W", request.security(syminfo.tickerid, "M", close))
y = request.security(syminfo.tickerid, "W", request.security(syminfo.tickerid, "M", close))
plot(x, "x")
plot(y, "y")
`);
    expect(plot(out, "x").every((v) => v === undefined)).toBe(true);
    expect(plot(out, "y").every((v) => v === undefined)).toBe(true);
    const coarse = out.result!.warnings.filter((w) => w.includes("coarser than current context"));
    expect(coarse.length, JSON.stringify(out.result!.warnings)).toBe(1);
    expect(coarse[0]).toContain("'M'");
    expect(coarse[0]).toContain("'W'");
  });

  it("nested same weekly request keeps requested context", () => {
    const out = runSrc(`//@version=6
indicator("nested same")
x = request.security(syminfo.tickerid, "W", request.security(syminfo.tickerid, "W", timeframe.isweekly ? close : -1))
plot(x, "x")
`);
    expect(plot(out, "x")[4]).toBe(105);
  });

  it("separate coarser monthly request still resamples alongside a weekly request", () => {
    // A February session closes January, so the monthly request has a confirmed period to
    // publish. Without it, January is the uncertified final period and stays na (no lookahead).
    const out = runSrc(`//@version=6
indicator("separate coarser")
w = request.security(syminfo.tickerid, "W", close)
m = request.security(syminfo.tickerid, "M", close)
plot(w, "w")
plot(m, "m")
plot(close, "c")
`, barsOn([...dates, "2025-01-20", "2025-02-03"]));
    expect(plot(out, "w")[4]).toBe(105);
    const m = plot(out, "m");
    expect(m.some((v) => typeof v === "number" && !Number.isNaN(v))).toBe(true);
    const c = plot(out, "c");
    expect(m.some((v, i) => typeof v === "number" && typeof c[i] === "number" && v !== c[i])).toBe(true);
    expect(out.result!.warnings.filter((w) => w.includes("unsupported symbol")).length).toBe(0);
  });
});


describe("unresolved timeframe does not become explicit empty context", () => {
 it("an unresolved timeframe member refuses instead of substituting chart close", () => {
  const out = runPine(`//@version=6
indicator("unresolved tf")
x = request.security(syminfo.tickerid, timeframe.no_such_member, close)
plot(x, "x")
`, fixture(), { timeframe:"1D", symbol:"TEST" });
  expect(out.ok).toBe(true);
  expect(out.result!.plots[0].data.every(p=>p.value===undefined)).toBe(true);
  expect(out.result!.warnings.some(w=>w.includes("unsupported timeframe"))).toBe(true);
 });
});


describe("chart and HTF function histories are distinct", () => {
 it("an HTF call cannot overwrite the daily expression history of the same user function", () => {
  const src = (weekly: boolean) => `//@version=6
indicator("separate histories")
f() => (timeframe.isweekly ? close : -1)[5]
${weekly ? 'plot(request.security(syminfo.tickerid, "W", f()), "w")' : ''}
plot(f(), "d")
`;
  const bars = barsOn([...dates, "2025-01-20"]);
  expect(bars.length).toBe(11);
  const a = runPine(src(false), bars, {timeframe:"1D",symbol:"TEST"});
  const b = runPine(src(true), bars, {timeframe:"1D",symbol:"TEST"});
  expect(a.ok, JSON.stringify(a.errors)).toBe(true);
  expect(b.ok, JSON.stringify(b.errors)).toBe(true);
  const d = (x: typeof a) => x.result!.plots.find(p=>p.title==="d")!.data.map(p=>p.value);
  const dailyA = d(a), dailyB = d(b);
  // chart without HTF: daily [5] is bar-0 of (isweekly?close:-1) = -1. Adding the weekly
  // call must not publish 105 into that slot (shared AST hid / lexical histStore).
  expect(dailyA[5]).toBe(-1);
  expect(dailyB[5]).toBe(-1);
  expect(dailyB).toEqual(dailyA);
  const w = b.result!.plots.find(p=>p.title==="w")!.data.map(p=>p.value);
  expect(w.length).toBe(11);
  expect(w[4]).not.toBe(105);
 });

 it("weekly and monthly requests cannot mix into daily function-body history", () => {
  const src = `//@version=6
indicator("three contexts")
f() => (timeframe.isweekly ? 2 : timeframe.ismonthly ? 3 : -1)[5]
plot(request.security(syminfo.tickerid, "W", f()), "w")
plot(request.security(syminfo.tickerid, "M", f()), "m")
plot(f(), "d")
`;
  const bars = barsOn([...dates, "2025-01-20"]);
  const out = runPine(src, bars, {timeframe:"1D",symbol:"TEST"});
  expect(out.ok, JSON.stringify(out.errors)).toBe(true);
  const d = out.result!.plots.find(p=>p.title==="d")!.data.map(p=>p.value);
  expect(d[5]).toBe(-1);
  expect(d[5]).not.toBe(2);
  expect(d[5]).not.toBe(3);
 });

 it("two call sites with different expression args keep separate function-body histories", () => {
  const src = `//@version=6
indicator("two args")
f(src) => (src + 0)[5]
plot(f(-1), "a")
plot(f(close), "b")
`;
  const bars = barsOn([...dates, "2025-01-20"]);
  const out = runPine(src, bars, {timeframe:"1D",symbol:"TEST"});
  expect(out.ok, JSON.stringify(out.errors)).toBe(true);
  const a = out.result!.plots.find(p=>p.title==="a")!.data.map(p=>p.value);
  const b = out.result!.plots.find(p=>p.title==="b")!.data.map(p=>p.value);
  expect(a[5]).toBe(-1);
  expect(b[5]).toBe(101);
  expect(a).not.toEqual(b);
 });
});
