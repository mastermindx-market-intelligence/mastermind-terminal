// F3 — unparseable timeframes return na from timeframe.in_seconds() (no 1D guess), and
// isdaily/isweekly/ismonthly/isintraday derive from the SAME parsed tfParts as in_seconds
// (so "w" is weekly, "d" is daily, not just by regex case-sensitivity on "W" / "D").
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

function run(src: string, opts: { timeframe?: string; symbol?: string; bars?: Bar[] } = {}): PineRunOutput {
  const out = runPine(src, opts.bars ?? genBars(12), {
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

const allNa = (vals: (number | undefined)[]) => vals.every((v) => v === undefined);

describe("F3 (a) — unparseable timeframes make timeframe.in_seconds() = NA, not 86400", () => {
  it("chart TF '0m' yields timeframe.in_seconds() na on every bar", () => {
    const out = run(`
//@version=6
indicator("t")
plot(timeframe.in_seconds(), "s")
`, { timeframe: "0m" });
    expect(allNa(plotValues(out, "s"))).toBe(true);
  });

  it("chart TF '-5' yields timeframe.in_seconds() na on every bar", () => {
    const out = run(`
//@version=6
indicator("t")
plot(timeframe.in_seconds(), "s")
`, { timeframe: "-5" });
    expect(allNa(plotValues(out, "s"))).toBe(true);
  });

  it("chart TF '1.5' yields timeframe.in_seconds() na on every bar", () => {
    const out = run(`
//@version=6
indicator("t")
plot(timeframe.in_seconds(), "s")
`, { timeframe: "1.5" });
    expect(allNa(plotValues(out, "s"))).toBe(true);
  });

  it("timeframe.in_seconds()('FOO') with a junk argument is na on every bar", () => {
    const out = run(`
//@version=6
indicator("t")
plot(timeframe.in_seconds("FOO"), "s")
`);
    expect(allNa(plotValues(out, "s"))).toBe(true);
  });

  it("timeframe.in_seconds()('0D') (zero-second junk) is na — matches the refusal contract", () => {
    const out = run(`
//@version=6
indicator("t")
plot(timeframe.in_seconds("0D"), "s")
`);
    expect(allNa(plotValues(out, "s"))).toBe(true);
  });

  it("control: parseable chart TFs keep their seconds", () => {
    const out = run(`
//@version=6
indicator("t")
plot(timeframe.in_seconds(), "s")
`, { timeframe: "1W" });
    expect(plotValues(out, "s")[0]).toBe(604800);
  });
});

describe("F3 (b) — isdaily/isweekly/ismonthly/isintraday derive from the same parsed tfParts", () => {
  it("chart TF 'w' (lowercase) is weekly: in_seconds=604800 AND isweekly=1 (no longer regex-only)", () => {
    const out = run(`
//@version=6
indicator("t")
plot(timeframe.in_seconds(), "s")
plot(timeframe.isweekly ? 1 : 0, "w")
plot(timeframe.isdaily ? 1 : 0, "d")
plot(timeframe.ismonthly ? 1 : 0, "m")
`, { timeframe: "w" });
    expect(plotValues(out, "s")[0]).toBe(604800);
    expect(plotValues(out, "w")[0]).toBe(1);
    expect(plotValues(out, "d")[0]).toBe(0);
    expect(plotValues(out, "m")[0]).toBe(0);
  });

  it("chart TF 'd' (lowercase) is daily: in_seconds=86400 AND isdaily=1", () => {
    const out = run(`
//@version=6
indicator("t")
plot(timeframe.in_seconds(), "s")
plot(timeframe.isdaily ? 1 : 0, "d")
`, { timeframe: "d" });
    expect(plotValues(out, "s")[0]).toBe(86400);
    expect(plotValues(out, "d")[0]).toBe(1);
  });

  it("chart TF 'D' is daily: in_seconds=86400 AND isdaily=1", () => {
    const out = run(`
//@version=6
indicator("t")
plot(timeframe.in_seconds(), "s")
plot(timeframe.isdaily ? 1 : 0, "d")
`, { timeframe: "D" });
    expect(plotValues(out, "s")[0]).toBe(86400);
    expect(plotValues(out, "d")[0]).toBe(1);
  });

  it("chart TF 'W' is weekly: in_seconds=604800 AND isweekly=1", () => {
    const out = run(`
//@version=6
indicator("t")
plot(timeframe.in_seconds(), "s")
plot(timeframe.isweekly ? 1 : 0, "w")
`, { timeframe: "W" });
    expect(plotValues(out, "s")[0]).toBe(604800);
    expect(plotValues(out, "w")[0]).toBe(1);
  });

  it("chart TF 'M' (uppercase) is monthly: in_seconds=2592000 AND ismonthly=1, isintraday=0", () => {
    const out = run(`
//@version=6
indicator("t")
plot(timeframe.in_seconds(), "s")
plot(timeframe.ismonthly ? 1 : 0, "mo")
plot(timeframe.isintraday ? 1 : 0, "intra")
`, { timeframe: "M" });
    expect(plotValues(out, "s")[0]).toBe(2592000);
    expect(plotValues(out, "mo")[0]).toBe(1);
    expect(plotValues(out, "intra")[0]).toBe(0);
  });

  it("chart TF 'm' (lowercase) is minutes: in_seconds=60 AND isintraday=1, ismonthly=0 (case-sensitivity preserved)", () => {
    const out = run(`
//@version=6
indicator("t")
plot(timeframe.in_seconds(), "s")
plot(timeframe.isintraday ? 1 : 0, "intra")
plot(timeframe.ismonthly ? 1 : 0, "mo")
`, { timeframe: "m" });
    expect(plotValues(out, "s")[0]).toBe(60);
    expect(plotValues(out, "intra")[0]).toBe(1);
    expect(plotValues(out, "mo")[0]).toBe(0);
  });

  it("chart TF '5m' (5-minute intraday): isintraday=1, in_seconds=300", () => {
    const out = run(`
//@version=6
indicator("t")
plot(timeframe.in_seconds(), "s")
plot(timeframe.isintraday ? 1 : 0, "intra")
`, { timeframe: "5m" });
    expect(plotValues(out, "s")[0]).toBe(300);
    expect(plotValues(out, "intra")[0]).toBe(1);
  });

  it("unparseable chart TF '0m' makes all isdaily/isweekly/ismonthly/isintraday na (no values read in)", () => {
    const out = run(`
//@version=6
indicator("t")
plot(timeframe.isdaily, "d")
plot(timeframe.isweekly, "w")
plot(timeframe.ismonthly, "m")
plot(timeframe.isintraday, "intra")
`, { timeframe: "0m" });
    expect(allNa(plotValues(out, "d"))).toBe(true);
    expect(allNa(plotValues(out, "w"))).toBe(true);
    expect(allNa(plotValues(out, "m"))).toBe(true);
    expect(allNa(plotValues(out, "intra"))).toBe(true);
  });
});