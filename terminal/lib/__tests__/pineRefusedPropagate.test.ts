// F2/F3/F4 — refused request.security values must not leak as objects through str.*,
// arithmetic/math/fixnan, or RunResult.inputs.
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

describe("F2 — str.* treats a refused value exactly like ordinary na", () => {
  it("str.upper/lower/length/contains/tonumber/tostring/format match na on a refused security result", () => {
    const out = run(`
//@version=6
indicator("t")
refused = request.security(syminfo.tickerid, "FOO", close)
plot(str.length(refused), "lenR")
plot(str.length(na), "lenN")
plot(str.tostring(refused) == str.tostring(na) ? 1 : 0, "tostr")
plot(str.upper(refused) == str.upper(na) ? 1 : 0, "up")
plot(str.lower(refused) == str.lower(na) ? 1 : 0, "lo")
plot(str.contains(refused, "OBJECT") ? 1 : 0, "obj")
plot(str.contains(na, "OBJECT") ? 1 : 0, "objN")
plot(na(str.tonumber(refused)) ? 1 : 0, "tonumR")
plot(na(str.tonumber(na)) ? 1 : 0, "tonumN")
plot(str.format("{0}", refused) == str.format("{0}", na) ? 1 : 0, "fmt")
`);
    expect(plotValues(out, "lenR")).toEqual(plotValues(out, "lenN"));
    expect(plotValues(out, "lenR").some((v) => v === 15)).toBe(false); // "[object Object]".length
    expect(plotValues(out, "tostr").every((v) => v === 1)).toBe(true);
    expect(plotValues(out, "up").every((v) => v === 1)).toBe(true);
    expect(plotValues(out, "lo").every((v) => v === 1)).toBe(true);
    expect(plotValues(out, "obj")).toEqual(plotValues(out, "objN"));
    expect(plotValues(out, "tonumR")).toEqual(plotValues(out, "tonumN"));
    expect(plotValues(out, "fmt").every((v) => v === 1)).toBe(true);
  });
});

describe("F3 — refusal is sticky through arithmetic, math.*, fixnan; ta.* currently coerces to na", () => {
  it("nz(refused+1,0), nz(fixnan(refused),0), nz(math.abs(refused),0) stay na; math.avg(refused,5) does not become 5", () => {
    const out = run(`
//@version=6
indicator("t")
refused = request.security(syminfo.tickerid, "FOO", close)
plot(nz(refused + 1, 0), "add")
plot(nz(fixnan(refused), 0), "fix")
plot(nz(math.abs(refused), 0), "abs")
plot(nz(math.avg(refused, 5), 0), "avg")
plot(nz(math.sum(refused, 5), 0), "sum")
plot(nz(math.max(refused, 5), 0), "max")
plot(nz(na, 0), "ordinary")
`);
    expect(plotValues(out, "add").every((v) => v === undefined)).toBe(true);
    expect(plotValues(out, "fix").every((v) => v === undefined)).toBe(true);
    expect(plotValues(out, "abs").every((v) => v === undefined)).toBe(true);
    expect(plotValues(out, "avg").every((v) => v === undefined)).toBe(true);
    expect(plotValues(out, "sum").every((v) => v === undefined)).toBe(true);
    expect(plotValues(out, "max").every((v) => v === undefined)).toBe(true);
    expect(plotValues(out, "ordinary").every((v) => v === 0)).toBe(true);
    expect(out.result!.warnings.some((w) => w.includes("nz()") && w.includes("refused"))).toBe(true);
  });

  it("ta.* currently coerces a refused input to ordinary na, so nz(ta.sma(refused,3),0) is 0 (documented limit)", () => {
    const out = run(`
//@version=6
indicator("t")
refused = request.security(syminfo.tickerid, "FOO", close)
plot(nz(ta.sma(refused, 3), 0), "sma")
`);
    // Pin: refusal is NOT sticky through ta.* history buffers. A refused operand is stored
    // as ordinary na, so the window is all-na and nz replaces it with 0.
    expect(plotValues(out, "sma").every((v) => v === 0)).toBe(true);
  });
});

describe("F4 — a refused input default is stored as ordinary na, never the sentinel object", () => {
  it("input.float(refused) stores NaN and JSON.stringify(result) has no __pineRefused", () => {
    const out = run(`
//@version=6
indicator("t")
refused = request.security(syminfo.tickerid, "FOO", close)
x = input.float(refused, "refused default")
y = input.float(na, "na default")
plot(x, "x")
plot(y, "y")
`);
    const inputs = out.result!.inputs;
    const refusedIn = inputs.find((i) => i.title === "refused default");
    const naIn = inputs.find((i) => i.title === "na default");
    expect(refusedIn, JSON.stringify(inputs)).toBeTruthy();
    expect(naIn).toBeTruthy();
    expect(typeof refusedIn!.value).toBe("number");
    expect(Number.isNaN(refusedIn!.value)).toBe(true);
    expect(Number.isNaN(naIn!.value)).toBe(true);
    expect(JSON.stringify(refusedIn)).not.toContain("__pineRefused");
    expect(JSON.stringify(out.result)).not.toContain("__pineRefused");
    expect(JSON.stringify(out.result)).not.toContain("pineRefused");
  });
});
