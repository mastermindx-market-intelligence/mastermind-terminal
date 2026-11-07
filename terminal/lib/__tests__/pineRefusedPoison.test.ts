// F1 — a refused request.security value must remain a gap (na) through the small set of
// non-comparison operators that previously leaked it as a definite number, while keeping
// the reviewed-golden flagship marks (F2/F3/F4) byte-identical. A comparison involving a
// REFUSED operand stays NA on purpose: the shipped scripts use a refused higher-TF value
// inside `k_l >= d_l`, `macd_c >= sig_c`, etc., and those go to FALSE in Pine (so the
// truthy view of the comparison is unchanged); the gap shows up only through the non-
// comparison operators below. Locked by the golden: `npx vitest run
// lib/__tests__/flagshipPineMarks.test.ts` must pass without -u.
import { describe, it, expect } from "vitest";
import { runPine, type Bar, type PineRunOutput } from "../pine-engine";

function genBars(n: number, base = 100): Bar[] {
  const bars: Bar[] = [];
  const start = Date.UTC(2021, 0, 4);
  for (let i = 0; i < n; i++) {
    const c = base + i;
    bars.push({
      time: new Date(start + i * 86400000).toISOString().slice(0, 10),
      o: c - 0.5, h: c + 1, l: c - 1.5, c, v: 1_000_000,
    });
  }
  return bars;
}

function run(src: string): PineRunOutput {
  const out = runPine(src, genBars(12), { timeframe: "1D", symbol: "TEST" });
  expect(out.ok, "run errors: " + JSON.stringify(out.errors)).toBe(true);
  expect(out.result).toBeTruthy();
  return out;
}

function plotValues(out: PineRunOutput, title: string): (number | undefined)[] {
  const p = out.result!.plots.find((pl) => pl.title === title);
  expect(p, `plot '${title}' missing; plots=${JSON.stringify(out.result!.plots.map((q) => q.title))}`).toBeTruthy();
  return p!.data.map((pt) => ("value" in pt ? pt.value : undefined));
}

// A plot point is a gap on a line-family series when its `value` is missing (whitespace point
// emitted by the runtime). Histograms/columns/cross are absent for na; the equality checks below
// are the right shape for line plots where the bug previously painted a definite 0.
const isGap = (v: number | undefined) => v === undefined;
const isNum = (v: number | undefined) => typeof v === "number";

describe("F1 — refused request.security value is a gap through non-comparison operators", () => {
  it("(2) ternary `c ? a : b` with REFUSED c stays a gap (neither arm fires); plain na c keeps BASE behavior", () => {
    const out = run(`
//@version=6
indicator("t")
r = request.security(syminfo.tickerid, "FOO", close)
x = na
plot(r ? 1 : 0, "refCond")
plot(x ? 1 : 0, "naCond")
plot(r ? 1 : na, "refTrueNa")
plot(x ? 1 : na, "naTrueNa")
`);
    // (2) a REFUSED condition is a gap, not the false arm
    expect(plotValues(out, "refCond").every(isGap)).toBe(true);
    // (7) plain na condition: unchanged BASE behavior — the false arm fires (0)
    expect(plotValues(out, "naCond").every((v) => v === 0)).toBe(true);
    // Independence: when the true arm is plain na, the gap survives regardless of the condition
    expect(plotValues(out, "refTrueNa").every(isGap)).toBe(true);
    expect(plotValues(out, "naTrueNa").every(isGap)).toBe(true);
  });

  it("(3) na(x) with REFUSED x is REFUSED; na(plainNa) is true; na(number) is false", () => {
    const out = run(`
//@version=6
indicator("t")
r = request.security(syminfo.tickerid, "FOO", close)
plot(na(r) ? 0 : r, "repro")
plot(na(na) ? 1 : 0, "naNa")
plot(na(5) ? 1 : 0, "naNum")
plot(na(r) ? 0 : 7, "reproNumArm")
`);
    // (3) na(REFUSED) is REFUSED; REFUSED ? 0 : REFUSED is REFUSED; plot emits a gap
    expect(plotValues(out, "repro").every(isGap)).toBe(true);
    // (7) plain na behavior: na(na) = true → 1
    expect(plotValues(out, "naNa").every((v) => v === 1)).toBe(true);
    // (7) na(number) = false → 0
    expect(plotValues(out, "naNum").every((v) => v === 0)).toBe(true);
    // (3) na(REFUSED) is REFUSED; REFUSED ? 0 : 7 — the gap shows because (2) returns REFUSED
    expect(plotValues(out, "reproNumArm").every(isGap)).toBe(true);
  });

  it("(4) not REFUSED is REFUSED; not na keeps BASE behavior (true); not number keeps BASE behavior", () => {
    const out = run(`
//@version=6
indicator("t")
r = request.security(syminfo.tickerid, "FOO", close)
x = na
plot(not r ? 1 : 0, "repro")
plot(not x ? 1 : 0, "notNa")
plot(not 0 ? 1 : 0, "notZero")
plot(not 5 ? 1 : 0, "notFive")
`);
    // (4) not(REFUSED) is REFUSED; REFUSED ? 1 : 0 is a gap
    expect(plotValues(out, "repro").every(isGap)).toBe(true);
    // (7) plain na: truthy(na)=false; !false=true; BASE behavior unchanged
    expect(plotValues(out, "notNa").every((v) => v === 1)).toBe(true);
    // (7) not 0 = true → 1
    expect(plotValues(out, "notZero").every((v) => v === 1)).toBe(true);
    // (7) not 5 = false → 0
    expect(plotValues(out, "notFive").every((v) => v === 0)).toBe(true);
  });

  it("(1) a comparison involving a REFUSED operand is NA (false in boolean context); not poisoned", () => {
    const out = run(`
//@version=6
indicator("t")
r = request.security(syminfo.tickerid, "FOO", close)
x = na
// a refused value compared with a number: NA, NOT a definite true/false
plot(r > 0 ? 1 : 0, "rGT0")
plot(r < 0 ? 1 : 0, "rLT0")
plot(r == 0 ? 1 : 0, "rEQ0")
plot(r != 0 ? 1 : 0, "rNE0")
// plain na comparison: unchanged BASE behavior (the false arm fires)
plot(x > 0 ? 1 : 0, "xGT0")
`);
    // (1) comparison with REFUSED is NA; in a ternary, the false arm fires (Pine semantics, locked)
    expect(plotValues(out, "rGT0").every((v) => v === 0)).toBe(true);
    expect(plotValues(out, "rLT0").every((v) => v === 0)).toBe(true);
    expect(plotValues(out, "rEQ0").every((v) => v === 0)).toBe(true);
    expect(plotValues(out, "rNE0").every((v) => v === 0)).toBe(true);
    // (7) plain na comparison: BASE behavior unchanged
    expect(plotValues(out, "xGT0").every((v) => v === 0)).toBe(true);
  });

  it("(5) and/or with REFUSED operand follow Pine short-circuit; plain na operands keep BASE", () => {
    const out = run(`
//@version=6
indicator("t")
r = request.security(syminfo.tickerid, "FOO", close)
x = na
// false and _ = false (the false is a plain number 0 / literal false)
plot((0 and r) ? 1 : 0, "falseAndRefused")
// REFUSED and false = false (short-circuit via the right operand)
plot((r and false) ? 1 : 0, "refusedAndFalse")
// true or _ = true
plot((1 or r) ? 1 : 0, "trueOrRefused")
// REFUSED or true = true (short-circuit via the right operand)
plot((r or true) ? 1 : 0, "refusedOrTrue")
// true and REFUSED = REFUSED → gap
plot((1 and r) ? 1 : 0, "trueAndRefused")
// REFUSED and true = REFUSED → gap
plot((r and 1) ? 1 : 0, "refusedAndTrue")
// false or REFUSED = REFUSED → gap
plot((0 or r) ? 1 : 0, "falseOrRefused")
// REFUSED or false = REFUSED → gap
plot((r or 0) ? 1 : 0, "refusedOrFalse")
// REFUSED and REFUSED = REFUSED → gap
plot((r and r) ? 1 : 0, "refusedAndRefused")
// REFUSED or REFUSED = REFUSED → gap
plot((r or r) ? 1 : 0, "refusedOrRefused")
// plain na and/or — unchanged BASE behavior
plot((x and true) ? 1 : 0, "naAndTrue")
plot((x or true) ? 1 : 0, "naOrTrue")
plot((true and x) ? 1 : 0, "trueAndNa")
plot((true or x) ? 1 : 0, "trueOrNa")
`);
    // false and REFUSED = false → 0
    expect(plotValues(out, "falseAndRefused").every((v) => v === 0)).toBe(true);
    // REFUSED and false = false → 0
    expect(plotValues(out, "refusedAndFalse").every((v) => v === 0)).toBe(true);
    // true or REFUSED = true → 1
    expect(plotValues(out, "trueOrRefused").every((v) => v === 1)).toBe(true);
    // REFUSED or true = true → 1
    expect(plotValues(out, "refusedOrTrue").every((v) => v === 1)).toBe(true);
    // true and REFUSED = REFUSED → gap
    expect(plotValues(out, "trueAndRefused").every(isGap)).toBe(true);
    // REFUSED and true = REFUSED → gap
    expect(plotValues(out, "refusedAndTrue").every(isGap)).toBe(true);
    // false or REFUSED = REFUSED → gap
    expect(plotValues(out, "falseOrRefused").every(isGap)).toBe(true);
    // REFUSED or false = REFUSED → gap
    expect(plotValues(out, "refusedOrFalse").every(isGap)).toBe(true);
    // REFUSED and REFUSED = REFUSED → gap
    expect(plotValues(out, "refusedAndRefused").every(isGap)).toBe(true);
    // REFUSED or REFUSED = REFUSED → gap
    expect(plotValues(out, "refusedOrRefused").every(isGap)).toBe(true);
    // (7) plain na: BASE behavior preserved (truthy(na)=false, so na and true = false, na or true = true)
    expect(plotValues(out, "naAndTrue").every((v) => v === 0)).toBe(true);
    expect(plotValues(out, "naOrTrue").every((v) => v === 1)).toBe(true);
    expect(plotValues(out, "trueAndNa").every((v) => v === 0)).toBe(true);
    expect(plotValues(out, "trueOrNa").every((v) => v === 1)).toBe(true);
  });

  it("(6) an `if` statement whose condition is REFUSED takes the false/else branch (no value from REFUSED escapes as a number)", () => {
    const out = run(`
//@version=6
indicator("t")
r = request.security(syminfo.tickerid, "FOO", close)
var float a = 0
if r
  a := 7
else
  a := 11
plot(a, "ifA")
// A plotshape whose series-bool condition is REFUSED does NOT fire (treats as false)
plotshape(r, "ifShape", style=shape.triangleup)
`);
    // (6) if r with REFUSED r takes the else branch (truthy(refused)=false)
    expect(plotValues(out, "ifA").every((v) => v === 11)).toBe(true);
    // (6) no marker is emitted when the condition is REFUSED
    expect(out.result!.shapes.length).toBe(0);
  });

  it("repro from the bug report: r ? 1 : 0 AND na(r) ? 0 : r both paint 0 today (locked by tests above); `r > 0 ? 1 : 0` is the documented residual (Pine na semantics)", () => {
    const out = run(`
//@version=6
indicator("t")
r = request.security(syminfo.tickerid, "FOO", close)
// Before the fix these two painted 0 on every bar (a refused request showed as a definite number).
// After the fix they paint a gap on every bar (the bug is closed).
plot(r ? 1 : 0, "repro1")
plot(na(r) ? 0 : r, "repro2")
// The reviewed golden keeps r > 0 ? 1 : 0 painting 0: a comparison with REFUSED is NA, which
// makes the ternary's condition false (Pine na semantics), and that's what the shipped flagship
// signal scripts rely on. Test the value with na(r) first if a gap is what you want.
plot(r > 0 ? 1 : 0, "documentedResidual")
`);
    // (2)+(3) close: both repros now paint a gap, not 0
    expect(plotValues(out, "repro1").every(isGap)).toBe(true);
    expect(plotValues(out, "repro2").every(isGap)).toBe(true);
    // (1) residual: comparison with REFUSED is NA → ternary's false arm (0); painted 0 by design
    expect(plotValues(out, "documentedResidual").every((v) => v === 0)).toBe(true);
  });

  it("independence: close > open ? 1 : 0 in the same script is unaffected by the refused-poison changes", () => {
    // A same-script independence control. A refused request value, routed through the operators
    // above, must not change how a simple boolean series (no refused operand) plots.
    const out = run(`
//@version=6
indicator("t")
r = request.security(syminfo.tickerid, "FOO", close)
plot(r ? 1 : 0, "refGap")
plot(close > open ? 1 : 0, "ok")
plot(close > open and r ? 1 : 0, "okAndGap")
plot(r and close > open ? 1 : 0, "gapAndOk")
`);
    // 12 bars, all with close > open (genBars(12,100) has c = 100+i, o = c - 0.5): every bar paints 1
    expect(plotValues(out, "ok").every((v) => v === 1)).toBe(true);
    // ok AND REFUSED = REFUSED → gap
    expect(plotValues(out, "okAndGap").every(isGap)).toBe(true);
    // REFUSED AND ok = REFUSED → gap
    expect(plotValues(out, "gapAndOk").every(isGap)).toBe(true);
    // The refused repro still paints a gap
    expect(plotValues(out, "refGap").every(isGap)).toBe(true);
  });
});
