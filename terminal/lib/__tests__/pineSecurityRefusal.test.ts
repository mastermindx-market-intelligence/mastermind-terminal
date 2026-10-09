// A01 r3/r4 — request.security silent-substitution boundary + empty-string symbol correction.
// r4: unknown syminfo.* members and unimplemented str.* calls return na (never an empty-string
// stub accepted as current-context). Explicit "" and valid ticker/tickerid stay supported.
//
// Frozen supported semantics under test:
//   - positional/named symbol + timeframe are read BEFORE the security expression is evaluated;
//   - same canonical exact chart symbol (syminfo.tickerid / syminfo.ticker / explicit identical
//     string) keeps existing same/coarser behavior;
//   - empty-string symbol argument (positional or named) means CURRENT CONTEXT (Pine same-chart
//     convention) — uses the existing same-context series, NO unsupported-symbol warning;
//   - a different, missing, or ambiguous requested symbol → NA + deduplicated unsupported-symbol
//     warning (chart bars are never used as a cross-symbol data plane);
//   - a timeframe FINER than the chart → NA + deduplicated unsupported-finer-TF warning
//     (never chart-TF substituted values);
//   - empty timeframe preserves the Pine same-chart convention (named assumption: "" ≡ chart TF);
//   - unknown/unparseable timeframe refuses — never treated as zero-second valid;
//   - refusing a finer-than-inner-context request during the engine whole-script HTF pass must
//     NOT change an otherwise supported coarser request evaluated in that same pass.
//
// These tests import the actual engine module (runPine from ../pine-engine) — no mocks.
import { describe, it, expect } from "vitest";
import { runPine, type Bar, type PineRunOutput } from "../pine-engine";

// Distinct daily closes so chart-TF substitution is detectable against any sentinel.
function genBars(n: number, base = 100): Bar[] {
  const bars: Bar[] = [];
  const start = Date.UTC(2021, 0, 4);
  for (let i = 0; i < n; i++) {
    const c = base + i; // 100, 101, 102, …
    const o = c - 0.5;
    const h = c + 1;
    const l = o - 1;
    const time = new Date(start + i * 86400000).toISOString().slice(0, 10);
    bars.push({ time, o, h, l, c, v: 1_000_000 });
  }
  return bars;
}

const CHART_SYM = "TEST";
const CHART_TF = "1D";

function run(src: string, opts: { timeframe?: string; symbol?: string; bars?: Bar[] } = {}): PineRunOutput {
  const out = runPine(src, opts.bars ?? genBars(30), {
    timeframe: opts.timeframe ?? CHART_TF,
    symbol: opts.symbol ?? CHART_SYM,
  });
  expect(out.ok, "run errors: " + JSON.stringify(out.errors)).toBe(true);
  expect(out.result).toBeTruthy();
  return out;
}

/** Per-bar values of a named plot; `undefined` = na (line-family whitespace gap). */
function plotValues(out: PineRunOutput, title: string): (number | undefined)[] {
  const p = out.result!.plots.find((pl) => pl.title === title);
  expect(p, `plot '${title}' missing; plots=${JSON.stringify(out.result!.plots.map((q) => q.title))}`).toBeTruthy();
  return p!.data.map((pt) => ("value" in pt ? pt.value : undefined));
}

const allNa = (vals: (number | undefined)[]) => vals.every((v) => v === undefined);
const hasNumbers = (vals: (number | undefined)[]) => vals.some((v) => typeof v === "number" && !Number.isNaN(v));
const countWarnings = (out: PineRunOutput, needle: string) => out.result!.warnings.filter((w) => w.includes(needle));

// ── unsupported / different / missing / ambiguous symbol ────────────────────────────────────────
describe("request.security — unsupported symbol boundary", () => {
  it("positional different symbol returns na + explicit unsupported-symbol warning", () => {
    const src = `
//@version=6
indicator("t")
x = request.security("OTHER", "1D", close)
plot(x, "x")
plot(close, "c")
`;
    const out = run(src);
    expect(allNa(plotValues(out, "x"))).toBe(true);
    // Chart series itself is untouched — refusal is only inside request.security.
    expect(hasNumbers(plotValues(out, "c"))).toBe(true);
    const symW = countWarnings(out, "unsupported symbol");
    expect(symW.length).toBe(1);
    expect(symW[0]).toContain("OTHER");
    expect(symW[0]).toContain(CHART_SYM);
  });

  it("named different symbol returns na + unsupported-symbol warning", () => {
    const src = `
//@version=6
indicator("t")
x = request.security(symbol="OTHER", timeframe="W", expression=close)
plot(x, "x")
`;
    const out = run(src);
    expect(allNa(plotValues(out, "x"))).toBe(true);
    const symW = countWarnings(out, "unsupported symbol");
    expect(symW.length).toBe(1);
    expect(symW[0]).toContain("OTHER");
  });

  it("different symbol is refused even when the timeframe is coarser (no chart-HTF fallback)", () => {
    const src = `
//@version=6
indicator("t")
x = request.security("OTHER", "W", close)
plot(x, "x")
`;
    const out = run(src);
    expect(allNa(plotValues(out, "x"))).toBe(true);
    expect(countWarnings(out, "unsupported symbol").length).toBe(1);
  });

  it("missing symbol argument returns na + unsupported-symbol warning", () => {
    const src = `
//@version=6
indicator("t")
x = request.security(timeframe="W", expression=close)
plot(x, "x")
`;
    const out = run(src);
    expect(allNa(plotValues(out, "x"))).toBe(true);
    expect(countWarnings(out, "unsupported symbol").length).toBe(1);
  });

  it("ambiguous/unresolvable symbol expression returns na + unsupported-symbol warning", () => {
    // ticker.new(...) has no data plane here — result is na/ambiguous, must not fall back to chart bars.
    const src = `
//@version=6
indicator("t")
x = request.security(ticker.new("NASDAQ", "AAPL"), "1D", close)
plot(x, "x")
`;
    const out = run(src);
    expect(allNa(plotValues(out, "x"))).toBe(true);
    expect(countWarnings(out, "unsupported symbol").length).toBe(1);
  });

  it("non-string symbol argument returns na + unsupported-symbol warning", () => {
    const src = `
//@version=6
indicator("t")
x = request.security(close, "1D", close)
plot(x, "x")
`;
    const out = run(src);
    expect(allNa(plotValues(out, "x"))).toBe(true);
    expect(countWarnings(out, "unsupported symbol").length).toBe(1);
  });

  it("repeated per-bar different-symbol calls dedupe the warning to one", () => {
    const src = `
//@version=6
indicator("t")
a = request.security("OTHER", "1D", close)
b = request.security("OTHER", "1D", close)
c = request.security("OTHER", "1D", close)
plot(a, "a")
plot(b, "b")
plot(c, "c")
`;
    const out = run(src);
    expect(allNa(plotValues(out, "a"))).toBe(true);
    expect(allNa(plotValues(out, "b"))).toBe(true);
    expect(allNa(plotValues(out, "c"))).toBe(true);
    expect(countWarnings(out, "unsupported symbol").length).toBe(1);
  });
});

// ── same-symbol controls (existing behavior preserved) ─────────────────────────────────────────
describe("request.security — same canonical chart symbol controls", () => {
  it("explicit identical positional symbol + same TF evaluates in place (values = chart series)", () => {
    const src = `
//@version=6
indicator("t")
x = request.security("${CHART_SYM}", "${CHART_TF}", close)
plot(x, "x")
plot(close, "c")
`;
    const out = run(src);
    const x = plotValues(out, "x");
    const c = plotValues(out, "c");
    expect(hasNumbers(x)).toBe(true);
    expect(x).toEqual(c);
    expect(countWarnings(out, "unsupported symbol").length).toBe(0);
  });

  it("syminfo.tickerid same-symbol control matches chart close values", () => {
    const src = `
//@version=6
indicator("t")
x = request.security(syminfo.tickerid, "1D", close)
plot(x, "x")
plot(close, "c")
`;
    const out = run(src);
    const x = plotValues(out, "x");
    expect(hasNumbers(x)).toBe(true);
    expect(x).toEqual(plotValues(out, "c"));
    expect(countWarnings(out, "unsupported symbol").length).toBe(0);
  });

  it("syminfo.ticker same-symbol control matches chart close values", () => {
    const src = `
//@version=6
indicator("t")
x = request.security(syminfo.ticker, "1D", close)
plot(x, "x")
plot(close, "c")
`;
    const out = run(src);
    const x = plotValues(out, "x");
    expect(hasNumbers(x)).toBe(true);
    expect(x).toEqual(plotValues(out, "c"));
    expect(countWarnings(out, "unsupported symbol").length).toBe(0);
  });

  it("named same-symbol + coarser TF still resamples (existing coarser arithmetic unchanged)", () => {
    const src = `
//@version=6
indicator("t")
x = request.security(symbol=syminfo.tickerid, timeframe="W", expression=close)
plot(x, "x")
plot(close, "c")
`;
    const out = run(src);
    const x = plotValues(out, "x");
    // Weekly resample exists and produces values (not a refusal).
    expect(hasNumbers(x)).toBe(true);
    expect(countWarnings(out, "unsupported symbol").length).toBe(0);
    expect(countWarnings(out, "finer than chart").length).toBe(0);
    // Not identical to chart daily closes on every bar (grouping actually happened).
    const c = plotValues(out, "c");
    const anyDiff = x.some((v, i) => typeof v === "number" && typeof c[i] === "number" && v !== c[i]);
    expect(anyDiff).toBe(true);
  });
});

// ── finer-than-chart timeframe refusal ─────────────────────────────────────────────────────────
describe("request.security — finer-timeframe boundary", () => {
  it("finer TF than chart returns na + unsupported-finer-TF warning (never chart-substituted)", () => {
    const src = `
//@version=6
indicator("t")
x = request.security(syminfo.tickerid, "60", close)
plot(x, "x")
plot(close, "c")
`;
    const out = run(src, { timeframe: "1D", symbol: CHART_SYM });
    const x = plotValues(out, "x");
    expect(allNa(x)).toBe(true);
    // Sentinel: values must NOT equal chart close (the old silent substitution).
    expect(x).not.toEqual(plotValues(out, "c"));
    const finerW = countWarnings(out, "finer than chart");
    expect(finerW.length).toBe(1);
    expect(finerW[0]).toContain("60");
    expect(finerW[0]).toContain("1D");
    // Chart series itself still runs.
    expect(hasNumbers(plotValues(out, "c"))).toBe(true);
  });

  it("finer-TF sentinel constant is never substituted from chart execution", () => {
    // If the engine silently returned chart-TF values, 9999 would appear; refusal → all na.
    const src = `
//@version=6
indicator("t")
x = request.security(syminfo.tickerid, "60", 9999)
plot(x, "x")
`;
    const out = run(src, { timeframe: "1D", symbol: CHART_SYM });
    const x = plotValues(out, "x");
    expect(allNa(x)).toBe(true);
    expect(x.some((v) => v === 9999)).toBe(false);
    expect(countWarnings(out, "finer than chart").length).toBe(1);
  });

  it("finer TF is refused with the explicit named-symbol form too", () => {
    const src = `
//@version=6
indicator("t")
x = request.security(symbol="${CHART_SYM}", timeframe="240", expression=close)
plot(x, "x")
`;
    const out = run(src, { timeframe: "1D", symbol: CHART_SYM });
    expect(allNa(plotValues(out, "x"))).toBe(true);
    expect(countWarnings(out, "finer than chart").length).toBe(1);
  });

  it("repeated per-bar finer-TF calls dedupe the warning to one", () => {
    const src = `
//@version=6
indicator("t")
a = request.security(syminfo.tickerid, "60", close)
b = request.security(syminfo.tickerid, "60", close)
c = request.security(syminfo.tickerid, "60", close)
plot(a, "a")
plot(b, "b")
plot(c, "c")
`;
    const out = run(src, { timeframe: "1D", symbol: CHART_SYM });
    expect(allNa(plotValues(out, "a"))).toBe(true);
    expect(allNa(plotValues(out, "b"))).toBe(true);
    expect(allNa(plotValues(out, "c"))).toBe(true);
    expect(countWarnings(out, "finer than chart").length).toBe(1);
  });

  it("unknown/unparseable timeframe refuses (not treated as zero-second valid)", () => {
    const src = `
//@version=6
indicator("t")
x = request.security(syminfo.tickerid, "FOO", close)
plot(x, "x")
`;
    const out = run(src, { timeframe: "1D", symbol: CHART_SYM });
    expect(allNa(plotValues(out, "x"))).toBe(true);
    expect(countWarnings(out, "unknown/unparseable").length).toBe(1);
  });

  it("zero-second / nonsense multiplier timeframe refuses (never valid)", () => {
    const src = `
//@version=6
indicator("t")
x = request.security(syminfo.tickerid, "0D", close)
plot(x, "x")
`;
    const out = run(src, { timeframe: "1D", symbol: CHART_SYM });
    expect(allNa(plotValues(out, "x"))).toBe(true);
    expect(countWarnings(out, "unknown/unparseable").length).toBe(1);
  });

  it("empty timeframe preserves the Pine same-chart convention (values = chart series)", () => {
    // Named assumption: empty timeframe ≡ chart timeframe in this engine.
    const src = `
//@version=6
indicator("t")
x = request.security(syminfo.tickerid, "", close)
plot(x, "x")
plot(close, "c")
`;
    const out = run(src, { timeframe: "1D", symbol: CHART_SYM });
    const x = plotValues(out, "x");
    expect(hasNumbers(x)).toBe(true);
    expect(x).toEqual(plotValues(out, "c"));
    expect(countWarnings(out, "finer than chart").length).toBe(0);
    expect(countWarnings(out, "unknown/unparseable").length).toBe(0);
    expect(countWarnings(out, "unsupported symbol").length).toBe(0);
  });

  it("missing timeframe argument with valid symbol keeps existing same-TF in-place behavior", () => {
    // Named form only — positional second arg is timeframe in request.security(symbol, tf, expr).
    const src = `
//@version=6
indicator("t")
x = request.security(symbol="${CHART_SYM}", expression=close)
plot(x, "x")
plot(close, "c")
`;
    const out = run(src, { timeframe: "1D", symbol: CHART_SYM });
    const x = plotValues(out, "x");
    expect(hasNumbers(x)).toBe(true);
    expect(x).toEqual(plotValues(out, "c"));
  });

  it("valid coarser same-symbol TF still returns resampled values (not na)", () => {
    const src = `
//@version=6
indicator("t")
x = request.security(syminfo.tickerid, "W", close)
plot(x, "x")
`;
    const out = run(src, { timeframe: "1D", symbol: CHART_SYM });
    const x = plotValues(out, "x");
    expect(hasNumbers(x)).toBe(true);
    expect(countWarnings(out, "finer than chart").length).toBe(0);
    expect(countWarnings(out, "unsupported symbol").length).toBe(0);
  });
});

// ── empty-string symbol = current context (Pine same-chart convention) ──────────────────────────
describe("request.security — empty-string symbol means current context", () => {
  it("positional empty-string symbol + same TF uses existing same-context series (no unsupported-symbol warning)", () => {
    const src = `
//@version=6
indicator("t")
x = request.security("", "${CHART_TF}", close)
plot(x, "x")
plot(close, "c")
`;
    const out = run(src);
    const x = plotValues(out, "x");
    expect(hasNumbers(x)).toBe(true);
    expect(x).toEqual(plotValues(out, "c"));
    expect(countWarnings(out, "unsupported symbol").length).toBe(0);
  });

  it("named empty-string symbol + same TF uses existing same-context series (no unsupported-symbol warning)", () => {
    const src = `
//@version=6
indicator("t")
x = request.security(symbol="", timeframe="${CHART_TF}", expression=close)
plot(x, "x")
plot(close, "c")
`;
    const out = run(src);
    const x = plotValues(out, "x");
    expect(hasNumbers(x)).toBe(true);
    expect(x).toEqual(plotValues(out, "c"));
    expect(countWarnings(out, "unsupported symbol").length).toBe(0);
  });

  it("positional empty-string symbol + coarser TF still resamples like the chart symbol", () => {
    const src = `
//@version=6
indicator("t")
x = request.security("", "W", close)
plot(x, "x")
plot(close, "c")
`;
    const out = run(src, { timeframe: "1D", symbol: CHART_SYM });
    const x = plotValues(out, "x");
    expect(hasNumbers(x)).toBe(true);
    expect(countWarnings(out, "unsupported symbol").length).toBe(0);
    expect(countWarnings(out, "finer than chart").length).toBe(0);
    const c = plotValues(out, "c");
    const anyDiff = x.some((v, i) => typeof v === "number" && typeof c[i] === "number" && v !== c[i]);
    expect(anyDiff).toBe(true);
  });

  it("named empty-string symbol + coarser TF matches syminfo.tickerid coarser behavior", () => {
    const src = `
//@version=6
indicator("t")
a = request.security(symbol="", timeframe="W", expression=close)
b = request.security(syminfo.tickerid, "W", close)
plot(a, "a")
plot(b, "b")
`;
    const out = run(src, { timeframe: "1D", symbol: CHART_SYM });
    const a = plotValues(out, "a");
    const b = plotValues(out, "b");
    expect(hasNumbers(a)).toBe(true);
    expect(a).toEqual(b);
    expect(countWarnings(out, "unsupported symbol").length).toBe(0);
  });

  it("empty-string symbol + finer TF refuses on TF grounds (not as unsupported symbol)", () => {
    const src = `
//@version=6
indicator("t")
x = request.security("", "60", close)
plot(x, "x")
`;
    const out = run(src, { timeframe: "1D", symbol: CHART_SYM });
    expect(allNa(plotValues(out, "x"))).toBe(true);
    expect(countWarnings(out, "unsupported symbol").length).toBe(0);
    expect(countWarnings(out, "finer than chart").length).toBe(1);
  });

  it("missing symbol argument still refuses — empty-string is not a missing arg", () => {
    const src = `
//@version=6
indicator("t")
x = request.security(timeframe="W", expression=close)
plot(x, "x")
`;
    const out = run(src);
    expect(allNa(plotValues(out, "x"))).toBe(true);
    expect(countWarnings(out, "unsupported symbol").length).toBe(1);
  });

  it("unresolved/non-string symbol still refuses even with empty timeframe and valid chart context", () => {
    const src = `
//@version=6
indicator("t")
x = request.security(ticker.new("NASDAQ", "AAPL"), "", close)
plot(x, "x")
`;
    const out = run(src);
    expect(allNa(plotValues(out, "x"))).toBe(true);
    expect(countWarnings(out, "unsupported symbol").length).toBe(1);
  });

  it("explicit different non-empty symbol still refuses alongside empty-string same-context calls", () => {
    const src = `
//@version=6
indicator("t")
ok = request.security("", "1D", close)
bad = request.security("OTHER", "1D", close)
plot(ok, "ok")
plot(bad, "bad")
plot(close, "c")
`;
    const out = run(src);
    const ok = plotValues(out, "ok");
    const bad = plotValues(out, "bad");
    expect(ok).toEqual(plotValues(out, "c"));
    expect(allNa(bad)).toBe(true);
    expect(countWarnings(out, "unsupported symbol").length).toBe(1);
  });
});

// ── unresolved symbol-producing members/functions must not stub empty-string current context ──
describe("request.security — unresolved symbol-producing members/functions refuse", () => {
  it("unknown syminfo member returns na + unsupported-symbol warning (never chart-substituted)", () => {
    const src = `
//@version=6
indicator("t")
x = request.security(syminfo.unsupported_member, "1D", close)
plot(x, "x")
plot(close, "c")
`;
    const out = run(src);
    const x = plotValues(out, "x");
    expect(allNa(x)).toBe(true);
    expect(x).not.toEqual(plotValues(out, "c"));
    expect(hasNumbers(plotValues(out, "c"))).toBe(true);
    const symW = countWarnings(out, "unsupported symbol");
    expect(symW.length).toBe(1);
    expect(symW[0]).toContain("unresolved/ambiguous");
  });

  it("unsupported str.notImplemented() as symbol returns na + unsupported-symbol warning (never chart-substituted)", () => {
    const src = `
//@version=6
indicator("t")
x = request.security(str.notImplemented(), "1D", close)
plot(x, "x")
plot(close, "c")
`;
    const out = run(src);
    const x = plotValues(out, "x");
    expect(allNa(x)).toBe(true);
    expect(x).not.toEqual(plotValues(out, "c"));
    expect(hasNumbers(plotValues(out, "c"))).toBe(true);
    const symW = countWarnings(out, "unsupported symbol");
    expect(symW.length).toBe(1);
    expect(symW[0]).toContain("unresolved/ambiguous");
  });

  it("explicit empty-string current-context still works alongside an unresolved-member refusal", () => {
    const src = `
//@version=6
indicator("t")
ok = request.security("", "1D", close)
bad = request.security(syminfo.unsupported_member, "1D", close)
plot(ok, "ok")
plot(bad, "bad")
plot(close, "c")
`;
    const out = run(src);
    expect(plotValues(out, "ok")).toEqual(plotValues(out, "c"));
    expect(allNa(plotValues(out, "bad"))).toBe(true);
    expect(countWarnings(out, "unsupported symbol").length).toBe(1);
  });
});

// ── HTF-pass discriminator: finer refusal must not change supported coarser requests ────────────
describe("request.security — HTF-pass discriminator (refusal isolation)", () => {
  it("two coarser requests still yield HTF values when a finer request in the same script is refused", () => {
    // Whole-script HTF pass: chart=1D, coarser=W. The finer "60" request is refused on both the
    // chart pass and inside the W re-run (finer than the inner W context). Both supported coarser
    // calls must still produce resampled values — the refusal must not poison the HTF pass.
    const src = `
//@version=6
indicator("t")
a = request.security(syminfo.tickerid, "W", close)
b = request.security("", "W", close)
c = request.security(syminfo.tickerid, "60", close)
plot(a, "a")
plot(b, "b")
plot(c, "c")
plot(close, "ch")
`;
    const out = run(src, { timeframe: "1D", symbol: CHART_SYM });
    const a = plotValues(out, "a");
    const b = plotValues(out, "b");
    const c = plotValues(out, "c");
    const ch = plotValues(out, "ch");
    // Finer request refused — never chart-TF substituted.
    expect(allNa(c)).toBe(true);
    expect(c).not.toEqual(ch);
    // Both coarser requests evaluated during the whole-script HTF pass still have values.
    expect(hasNumbers(a)).toBe(true);
    expect(hasNumbers(b)).toBe(true);
    // Same symbol context + same TF → the two coarser series agree.
    expect(a).toEqual(b);
    // Resampling actually happened (not silently chart-substituted).
    const anyDiff = a.some((v, i) => typeof v === "number" && typeof ch[i] === "number" && v !== ch[i]);
    expect(anyDiff).toBe(true);
    // Warning surface: no unsupported-symbol; finer refusal is present.
    // NOTE (not a value contradiction): the engine whole-script HTF re-run evaluates the finer
    // call-site again against the inner W context, so a second distinct finer warning may appear
    // (chartTf label 'W' vs chart-pass '1D'). Supported coarser request VALUES are unchanged —
    // that is the DONE_WHEN isolation requirement. HTF math is not altered to silence this.
    expect(countWarnings(out, "unsupported symbol").length).toBe(0);
    const finerAll = countWarnings(out, "finer than chart");
    expect(finerAll.length).toBeGreaterThanOrEqual(1);
    expect(finerAll.some((w) => w.includes("'1D'"))).toBe(true);
  });

  it("original-chart-TF in-place values on the chart pass are unchanged by HTF-pass finer refusal of the same call-site", () => {
    // During the W whole-script re-run, a "1D" request is finer than the inner W context and is
    // refused inside that pass. The chart-pass in-place evaluation of the same call-site must
    // still produce the chart series (no cross-pass value corruption).
    const src = `
//@version=6
indicator("t")
htf = request.security(syminfo.tickerid, "W", close)
same = request.security(syminfo.tickerid, "1D", close)
plot(htf, "htf")
plot(same, "same")
plot(close, "ch")
`;
    const out = run(src, { timeframe: "1D", symbol: CHART_SYM });
    const htf = plotValues(out, "htf");
    const same = plotValues(out, "same");
    const ch = plotValues(out, "ch");
    expect(hasNumbers(htf)).toBe(true);
    expect(hasNumbers(same)).toBe(true);
    // Chart-pass in-place evaluation of the original chart TF is unchanged.
    expect(same).toEqual(ch);
    // The coarser HTF series still differs from daily closes on some bars.
    const anyDiff = htf.some((v, i) => typeof v === "number" && typeof ch[i] === "number" && v !== ch[i]);
    expect(anyDiff).toBe(true);
    expect(countWarnings(out, "unsupported symbol").length).toBe(0);
  });

  it("empty-string coarser + syminfo coarser + different-symbol refusal coexist without HTF value loss", () => {
    const src = `
//@version=6
indicator("t")
a = request.security(syminfo.tickerid, "W", close)
b = request.security(symbol="", timeframe="W", expression=close)
c = request.security("OTHER", "W", close)
plot(a, "a")
plot(b, "b")
plot(c, "c")
`;
    const out = run(src, { timeframe: "1D", symbol: CHART_SYM });
    const a = plotValues(out, "a");
    const b = plotValues(out, "b");
    const c = plotValues(out, "c");
    expect(hasNumbers(a)).toBe(true);
    expect(hasNumbers(b)).toBe(true);
    expect(a).toEqual(b);
    expect(allNa(c)).toBe(true);
    expect(countWarnings(out, "unsupported symbol").length).toBe(1);
  });
});
