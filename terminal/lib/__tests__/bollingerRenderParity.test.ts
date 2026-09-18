/**
 * bollingerRenderParity.test.ts — the CHARTED Bollinger Bands contract.
 *
 * ── WHY THIS FILE EXISTS ──────────────────────────────────────────────────────
 * indicatorParity.test.ts asserted indicatorMath.bollingerBands() against the Macro
 * Python fixture and PASSED — while the Bollinger Bands a user actually sees were
 * computed by a *different*, untested formula inlined in ChartPanel.tsx. So
 * "indicator parity passes" did not imply "the displayed Bollinger Bands have
 * parity": the anti-drift evidence and the rendered product were two different
 * implementations that happened to never be compared.
 *
 * This file tests the math that reaches the screen.
 *
 * ── THE ORACLE (why this is not circular) ─────────────────────────────────────
 * The expected values here are NOT copied from ChartPanel, and they are not the
 * Python fixture either. They are produced by running the product's OWN published
 * indicator definition — `IND_DEFS.bb.source`, the read-only Pine that the chart's
 * "Source code…" button shows the user — through this repo's independent Pine
 * interpreter (lib/pine-engine).
 *
 *   basis = ta.sma(close, length)
 *   dev   = mult * ta.stdev(close, length)
 *
 * Pine's `ta.stdev` is POPULATION standard deviation (lib/pine-engine/runtime.ts
 * divides by `len`), which is what TradingView computes and what the rest of this
 * repo already matches on purpose — see marketDashboard.ts ("population σ, like
 * ta.stdev"), intradayMath.ts ttmSqueeze, suites/rsix/rsiChannels.ts and
 * indicatorMath.ts volbox.
 *
 * So the published definition, the Pine engine, and the rendered chart must all
 * agree. Three independent implementations of one published contract. If someone
 * edits the published source, this expectation moves with it — that is the point:
 * the authority is what the product tells its users the indicator computes.
 *
 * ── RELATIONSHIP TO indicatorParity.test.ts ───────────────────────────────────
 * That file pins a DIFFERENT, still-valid contract: the Macro Python engine's
 * `_bb_bands()` (pandas `.std()`, i.e. ddof=1 sample std dev) which drives
 * engine/bollinger_event_signals.py. Those bands are a statistical event-signal
 * input, not the charted indicator. Both contracts are real; they are now named
 * separately instead of being conflated. Neither tolerance is loosened.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { runPine, type Bar as PineBar } from "../pine-engine";
import { IND_DEFS, withDefaults } from "../indicators";
import { bollingerBands, type Bar } from "../indicatorMath";

// ─── Fixture (same deterministic 500-bar OHLCV the cross-repo parity suite uses) ──

const FIXTURE_DIR = join(__dirname, "fixtures", "tech_parity");
const ohlcv = JSON.parse(readFileSync(join(FIXTURE_DIR, "ohlcv.json"), "utf8"));
/** The Python (ddof=1) bands — used ONLY as a negative control below. */
const expPython = JSON.parse(readFileSync(join(FIXTURE_DIR, "expected_bollinger.json"), "utf8"));

const BARS: Bar[] = (ohlcv.dates as string[]).map((time, i) => ({
  time,
  o: ohlcv.open[i],
  h: ohlcv.high[i],
  l: ohlcv.low[i],
  c: ohlcv.close[i],
  v: ohlcv.volume[i],
}));
const N = BARS.length;

const chartPanelSrc = readFileSync(
  join(__dirname, "..", "..", "components", "ChartPanel.tsx"),
  "utf8",
);

// ─── The oracle: the product's published BB source, run by the repo's Pine engine ──

/** Chart defaults are read from the product registry, not hardcoded, so this test
 *  also pins the settings the chart actually ships with. */
const BB_PARAMS = withDefaults("bb", {}) as { length: number; mult: number };

function oracleBands(): { basis: (number | null)[]; upper: (number | null)[]; lower: (number | null)[] } {
  const out = runPine(IND_DEFS.bb.source, BARS as unknown as PineBar[], {
    timeframe: "D",
    symbol: "PARITY",
  });
  expect(out.ok, "published BB Pine source failed to run: " + JSON.stringify(out.errors)).toBe(true);
  const plots = out.result!.plots;
  const pick = (title: string): (number | null)[] => {
    const plot = plots.find((p) => p.title === title);
    expect(plot, `published BB source emitted no "${title}" plot`).toBeTruthy();
    const byTime = new Map(plot!.data.map((d) => [d.time, d.value]));
    return BARS.map((b) => {
      const v = byTime.get(b.time as string);
      return v == null || !Number.isFinite(v) ? null : v;
    });
  };
  return { basis: pick("Basis"), upper: pick("Upper"), lower: pick("Lower") };
}

const ORACLE = oracleBands();

/** Largest relative gap between two nullable series, and the bar it occurs on.
 *  Returns Infinity if the two disagree about where the warmup ends. */
function maxRel(
  got: (number | null)[],
  exp: (number | null)[],
): { rel: number; index: number } {
  let worst = { rel: 0, index: -1 };
  for (let i = 0; i < exp.length; i++) {
    const g = got[i], e = exp[i];
    if (g == null && e == null) continue;
    if (g == null || e == null) return { rel: Infinity, index: i };
    const rel = Math.abs(g - e) / Math.max(Math.abs(e), 1e-12);
    if (rel > worst.rel) worst = { rel, index: i };
  }
  return worst;
}

/** Strict equality budget for "the same formula computed twice". The two sides sum
 *  the same window in the same order, so the only admissible difference is IEEE-754
 *  noise — observed 0 here and 1.4e-15 against ChartPanel's rolling-sum basis.
 *  This is 1e6× TIGHTER than the cross-repo 1e-6 parity tolerance, never looser. */
const SAME_FORMULA_TOL = 1e-12;

describe("charted Bollinger Bands — published source oracle", () => {
  it("the published BB source compiles, runs, and plots Basis/Upper/Lower", () => {
    const out = runPine(IND_DEFS.bb.source, BARS as unknown as PineBar[], {
      timeframe: "D",
      symbol: "PARITY",
    });
    expect(out.ok, JSON.stringify(out.errors)).toBe(true);
    expect(out.result!.plots.map((p) => p.title).sort()).toEqual(["Basis", "Lower", "Upper"]);
    expect(out.result!.barCount).toBe(N);
  });

  it("uses the shipped chart defaults (length 20, mult 2)", () => {
    expect(BB_PARAMS.length).toBe(20);
    expect(BB_PARAMS.mult).toBe(2);
    expect(IND_DEFS.bb.source).toContain("ta.stdev(close, length)");
  });

  it("emits a value on every bar from the warmup boundary onward", () => {
    for (let i = 0; i < N; i++) {
      const defined = ORACLE.upper[i] != null;
      expect(defined, `oracle upper[${i}] definedness`).toBe(i >= BB_PARAMS.length - 1);
    }
  });

  // POSITIVE CONTROL — proves this oracle can actually detect the regression it guards.
  // The Python fixture is the sample-std-dev (ddof=1) contract; the oracle must REJECT it,
  // or a comparison against the oracle would prove nothing.
  it("REJECTS the ddof=1 (sample std dev) bands — the check has power", () => {
    const worst = maxRel(expPython.upper as (number | null)[], ORACLE.upper);
    expect(worst.rel).toBeGreaterThan(1e-3);
    expect(worst.rel).toBeLessThan(1e-2);
    // The published basis is shared by both contracts; only the deviation differs.
    expect(maxRel(expPython.mid as (number | null)[], ORACLE.basis).rel).toBeLessThan(SAME_FORMULA_TOL);
  });
});

describe("charted Bollinger Bands — canonical owner", () => {
  const owner = bollingerBands(BARS, BB_PARAMS.length, BB_PARAMS.mult);

  it("upper band matches the published source", () => {
    const worst = maxRel(owner.upper, ORACLE.upper);
    expect(worst.rel, `worst bar ${worst.index}: owner ${owner.upper[worst.index]} vs published ${ORACLE.upper[worst.index]}`)
      .toBeLessThan(SAME_FORMULA_TOL);
  });

  it("mid (basis) matches the published source", () => {
    expect(maxRel(owner.mid, ORACLE.basis).rel).toBeLessThan(SAME_FORMULA_TOL);
  });

  it("lower band matches the published source", () => {
    const worst = maxRel(owner.lower, ORACLE.lower);
    expect(worst.rel, `worst bar ${worst.index}: owner ${owner.lower[worst.index]} vs published ${ORACLE.lower[worst.index]}`)
      .toBeLessThan(SAME_FORMULA_TOL);
  });

  it("emits null exactly where the published source has no value (warmup boundary)", () => {
    for (let i = 0; i < N; i++) {
      expect(owner.upper[i] == null, `upper[${i}] null-alignment`).toBe(ORACLE.upper[i] == null);
      expect(owner.mid[i] == null, `mid[${i}] null-alignment`).toBe(ORACLE.basis[i] == null);
      expect(owner.lower[i] == null, `lower[${i}] null-alignment`).toBe(ORACLE.lower[i] == null);
    }
  });

  it("still exposes the ddof=1 sample bands for the Macro Python engine contract", () => {
    const sample = bollingerBands(BARS, BB_PARAMS.length, BB_PARAMS.mult, 1);
    expect(maxRel(sample.upper, expPython.upper as (number | null)[]).rel).toBeLessThan(1e-6);
    expect(maxRel(sample.lower, expPython.lower as (number | null)[]).rel).toBeLessThan(1e-6);
  });
});

describe("charted Bollinger Bands — render path binds to the canonical owner", () => {
  // ChartPanel must not carry its own band math. Before this contract existed it had an
  // inline population `stddev()` duplicated across the full build and the in-place update;
  // that duplicate is what let the tested implementation and the rendered one drift apart.

  // These assert on booleans/counts rather than on `chartPanelSrc` itself: a failing
  // toMatch() against an 8,800-line file prints the whole file into the CI log.

  it("ChartPanel imports the canonical owner", () => {
    const imported = /import \{[^}]*\bbollingerBands\b[^}]*\} from "@\/lib\/indicatorMath"/.test(chartPanelSrc);
    expect(imported, "ChartPanel.tsx must import bollingerBands from @/lib/indicatorMath").toBe(true);
  });

  it("derives BB through the owner at EVERY consumer: build, in-place update, and readout", () => {
    // Three call sites, and the count is asserted exactly so that fixing one path while
    // leaving another on its own math — the exact shape of the original defect — fails here.
    //   1. buildBb()            — the plotted series on a full chart build
    //   2. updateAllIndicators()— the in-place setData path on timeframe/data change
    //   3. buildIndDataMap()    — the "bb" column behind the chart table / legend readout
    const calls = chartPanelSrc.match(/bollingerBands\(rows, p\.length, p\.mult\)/g) ?? [];
    expect(calls.length, "expected buildBb, updateAllIndicators and buildIndDataMap").toBe(3);
  });

  it("does not re-derive the BB basis with a second SMA implementation", () => {
    // buildIndDataMap used to compute the table's basis with ChartPanel's rolling-accumulator
    // sma() while the plotted basis came from elsewhere — two implementations of one number.
    expect(/P\("bb"\);\s*const basis = sma\(/.test(chartPanelSrc)).toBe(false);
  });

  it("carries no inline standard-deviation implementation of its own", () => {
    const declares = /function stddev\s*\(/.test(chartPanelSrc);
    const calls = (chartPanelSrc.match(/\bstddev\(/g) ?? []).length;
    expect(declares, "ChartPanel.tsx must not declare its own stddev()").toBe(false);
    expect(calls, "ChartPanel.tsx must not call an inline stddev()").toBe(0);
  });
});
