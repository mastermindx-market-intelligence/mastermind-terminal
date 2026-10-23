// F1 — Terminal chart TFs are case-sensitive: lowercase m = minutes, uppercase M = months.
// One parser (tfParts) is shared by tfSeconds / timeframe.in_seconds / request.security.
import { describe, it, expect } from "vitest";
import { runPine, type Bar, type PineRunOutput } from "../pine-engine";
import { tfSeconds, tfParts, tfPartsToSeconds } from "../pine-engine/builtins";
import { FLAGSHIP_PINE } from "../pine";

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

function run(src: string, opts: { timeframe?: string; symbol?: string; bars?: Bar[] } = {}): PineRunOutput {
  const out = runPine(src, opts.bars ?? genBars(30), {
    timeframe: opts.timeframe ?? "1D",
    symbol: opts.symbol ?? "TEST",
  });
  expect(out.ok, "run errors: " + JSON.stringify(out.errors)).toBe(true);
  expect(out.result).toBeTruthy();
  return out;
}

function plotValues(out: PineRunOutput, title: string): (number | undefined)[] {
  const p = out.result!.plots.find((pl) => pl.title === title);
  expect(p, `plot '${title}' missing`).toBeTruthy();
  return p!.data.map((pt) => ("value" in pt ? pt.value : undefined));
}

const hasNumbers = (vals: (number | undefined)[]) => vals.some((v) => typeof v === "number" && !Number.isNaN(v));
const allNa = (vals: (number | undefined)[]) => vals.every((v) => v === undefined);
const warnings = (out: PineRunOutput, needle: string) => out.result!.warnings.filter((w) => w.includes(needle));

describe("shared timeframe grammar (tfParts / tfSeconds / tfPartsToSeconds)", () => {
  it("lowercase m is minutes, uppercase M is months, s/S seconds, h/H hours, bare number minutes", () => {
    expect(tfSeconds("1m")).toBe(60);
    expect(tfSeconds("5m")).toBe(300);
    expect(tfSeconds("15m")).toBe(900);
    expect(tfSeconds("30m")).toBe(1800);
    expect(tfSeconds("1M")).toBe(2592000);
    expect(tfSeconds("3M")).toBe(7776000);
    expect(tfSeconds("1s")).toBe(1);
    expect(tfSeconds("1S")).toBe(1);
    expect(tfSeconds("5s")).toBe(5);
    expect(tfSeconds("1h")).toBe(3600);
    expect(tfSeconds("1H")).toBe(3600);
    expect(tfSeconds("4h")).toBe(14400);
    expect(tfSeconds("12h")).toBe(43200);
    expect(tfSeconds("D")).toBe(86400);
    expect(tfSeconds("1D")).toBe(86400);
    expect(tfSeconds("W")).toBe(604800);
    expect(tfSeconds("1W")).toBe(604800);
    expect(tfSeconds("15")).toBe(900); // Pine: bare number = minutes
    expect(tfSeconds("60")).toBe(3600);
  });

  it("tfParts is the one parser: tfSeconds equals tfPartsToSeconds(tfParts(tf)) for every canonical chart TF", () => {
    const tfs = ["1s", "5s", "15s", "30s", "1m", "5m", "15m", "30m", "1h", "2h", "4h", "12h", "D", "2D", "3D", "W", "2W", "1M", "3M"];
    for (const tf of tfs) {
      const p = tfParts(tf);
      expect(p, tf).not.toBeNull();
      expect(tfPartsToSeconds(p!), tf).toBe(tfSeconds(tf));
    }
  });
});

describe("timeframe.in_seconds and request.security on a minute chart", () => {
  it("timeframe.in_seconds() on a 1m chart is 60", () => {
    const out = run(`
//@version=6
indicator("t")
plot(timeframe.in_seconds(), "sec")
plot(timeframe.in_seconds("1m"), "sec1m")
plot(timeframe.in_seconds("15m"), "sec15m")
plot(timeframe.in_seconds("1M"), "sec1M")
`, { timeframe: "1m" });
    expect(plotValues(out, "sec").every((v) => v === 60)).toBe(true);
    expect(plotValues(out, "sec1m").every((v) => v === 60)).toBe(true);
    expect(plotValues(out, "sec15m").every((v) => v === 900)).toBe(true);
    expect(plotValues(out, "sec1M").every((v) => v === 2592000)).toBe(true);
  });

  it("request.security(timeframe.period) on a 1m chart is in-place with no warning", () => {
    const src = `
//@version=6
indicator("t")
x = request.security(syminfo.tickerid, timeframe.period, close)
plot(x, "x")
plot(close, "c")
`;
    const out = run(src, { timeframe: "1m" });
    expect(plotValues(out, "x")).toEqual(plotValues(out, "c"));
    expect(hasNumbers(plotValues(out, "x"))).toBe(true);
    expect(warnings(out, "unsupported timeframe").length).toBe(0);
    expect(warnings(out, "unknown/unparseable").length).toBe(0);
    expect(warnings(out, "finer than chart").length).toBe(0);
  });

  it("request.security(\"W\") and (\"1D\") on a 1m chart are coarser, never finer or unparseable", () => {
    const src = `
//@version=6
indicator("t")
w = request.security(syminfo.tickerid, "W", close)
d = request.security(syminfo.tickerid, "1D", close)
plot(w, "w")
plot(d, "d")
`;
    const out = run(src, { timeframe: "1m" });
    expect(warnings(out, "finer than chart").length, JSON.stringify(out.result!.warnings)).toBe(0);
    expect(warnings(out, "unknown/unparseable").length, JSON.stringify(out.result!.warnings)).toBe(0);
    expect(warnings(out, "not recognised").length, JSON.stringify(out.result!.warnings)).toBe(0);
    // Coarser than 1m: the engine still cannot regroup minute-unit bars into a calendar week/day
    // (admitted HTF plans are daily→W/M/nD). The request is a valid higher-TF request that
    // hits that regrouping boundary, not the finer-than / unparseable paths.
    expect(out.result!.warnings.some((w) => w.includes("'W'") && w.includes("'1m'"))).toBe(true);
    expect(out.result!.warnings.some((w) => w.includes("'1D'") && w.includes("'1m'"))).toBe(true);
  });

  it("request.security(\"5m\")/(\"15m\")/(\"30m\") on those charts is in-place", () => {
    for (const tf of ["5m", "15m", "30m"] as const) {
      const out = run(`
//@version=6
indicator("t")
x = request.security(syminfo.tickerid, timeframe.period, close)
plot(x, "x")
plot(close, "c")
`, { timeframe: tf });
      expect(plotValues(out, "x"), tf).toEqual(plotValues(out, "c"));
      expect(warnings(out, "unsupported timeframe").length, tf).toBe(0);
    }
  });
});

describe("on a D chart, lowercase m is minutes (finer), never a month", () => {
  it("request.security(\"1m\") is refused as finer than the chart, not as a month and not as unparseable", () => {
    const src = `
//@version=6
indicator("t")
mins = request.security(syminfo.tickerid, "1m", close)
months = request.security(syminfo.tickerid, "1M", close)
plot(mins, "mins")
plot(months, "months")
plot(close, "c")
`;
    const out = run(src, { timeframe: "D" });
    expect(allNa(plotValues(out, "mins"))).toBe(true);
    expect(hasNumbers(plotValues(out, "months"))).toBe(true);
    expect(plotValues(out, "mins")).not.toEqual(plotValues(out, "months"));
    expect(warnings(out, "finer than chart").some((w) => w.includes("'1m'"))).toBe(true);
    expect(warnings(out, "unknown/unparseable").some((w) => w.includes("'1m'"))).toBe(false);
  });
});

describe("FLAGSHIP on a 1m chart no longer misreads the chart as a month", () => {
  it("does not warn that 3M is unrecognised or that timeframe 1m is unsupported", () => {
    const out = runPine(FLAGSHIP_PINE, genBars(80), { timeframe: "1m", symbol: "TEST", budgetMs: 30_000 });
    expect(out.ok, JSON.stringify(out.errors)).toBe(true);
    const w = out.result!.warnings;
    const dump = JSON.stringify(w);
    expect(w.some((x) => x.includes("'3M'") && (x.includes("not recognised") || x.includes("unrecognised"))), dump).toBe(false);
    expect(w.some((x) => x.includes("unsupported timeframe '1m'")), dump).toBe(false);
    // After the grammar fix, oneUp is 1D (tfSec=60 < 86400). The engine still cannot regroup
    // 1m-unit bars into 1D, so the confirm request is refused at the regrouping boundary.
    expect(w.some((x) => x.includes("'1D'") && x.includes("'1m'")), dump).toBe(true);
  });
});
