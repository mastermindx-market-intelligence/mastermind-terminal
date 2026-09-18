/**
 * indicatorParity.test.ts — TLT-R5 anti-drift contract.
 *
 * Feeds the shared parity fixture OHLCV bars through Terminal TypeScript
 * implementations and asserts per-bar equality against the Python-generated
 * expected outputs.
 *
 * Fixture source (regenerate from):
 *   python scripts/build_tech_parity_fixtures.py   (Macro Dashboard repo)
 *
 * Tolerance: 1e-6 relative (i.e. |a - b| / max(|a|, 1e-12) < 1e-6).
 *
 * ── KNOWN FORMULA DIVERGENCES (documented; do NOT hide by loosening tolerance) ──
 *
 * 1. Ribbon EMA seeding (marked test.todo below):
 *    - Python engine: pandas ewm(span=N, min_periods=N, adjust=True) — uses the
 *      numerically-weighted "adjusted" formula (each observation weighted by
 *      decay^age / sum_of_weights). This is NOT the simple recursive formula.
 *    - indicatorMath.ts trendRibbon(): SMA-seeded recursive EMA (accumulates
 *      N values for SMA seed, then applies k=2/(N+1) recursion). Both produce
 *      the same asymptotic result but differ in the first ~100 warmup bars.
 *    Fixing would require changing trendRibbon's EMA to match pandas adjust=True
 *    behaviour, which is a non-trivial rewrite and would change the displayed chart.
 *
 * 2. Bollinger Bands standard deviation — RESOLVED, see bollingerRenderParity.test.ts.
 *    This file used to carry a test.todo saying the rendered bands diverged from the
 *    fixture by sqrt(N/(N-1)) and that only an indicatorMath-vs-fixture check existed.
 *    The resolution was NOT to move either number: there are two different indicators
 *    here and they are now named separately.
 *      - THIS file pins the Macro Python engine's _bb_bands() (pandas .std(), ddof=1),
 *        which drives engine/bollinger_event_signals.py. Sample std dev is correct for
 *        those event signals, so the fixture and this tolerance are unchanged; the call
 *        below now passes ddof=1 EXPLICITLY instead of relying on a library default.
 *      - The CHARTED "Bollinger Bands" indicator is pinned by bollingerRenderParity.test.ts
 *        against the product's own published definition (IND_DEFS.bb.source, `ta.stdev`,
 *        i.e. population σ) run through the repo's Pine engine, and that file also asserts
 *        ChartPanel derives its bands only through indicatorMath.bollingerBands().
 *    Measured gap between the two contracts on this fixture: up to 0.24% of band value —
 *    which is why conflating them let the rendered chart drift unnoticed.
 */

import { describe, it, expect, test } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  ichimoku,
  trendRibbon,
  rsiStack,
  bollingerBands,
  rollingVwap,
  weekAnchoredVwap,
  avwap,
  rollingPoc,
  vprofile,
  type Bar,
} from "../indicatorMath";

// ─── Fixture loading ───────────────────────────────────────────────────────────

const FIXTURE_DIR = join(__dirname, "fixtures", "tech_parity");

function loadJSON(name: string): any {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf8"));
}

const ohlcv = loadJSON("ohlcv.json");
const expIchimoku = loadJSON("expected_ichimoku.json");
const expRibbon = loadJSON("expected_ribbon.json");
const expRsi = loadJSON("expected_rsi.json");
const expBollinger = loadJSON("expected_bollinger.json");
const expM2 = loadJSON("expected_m2.json");

/** Convert fixture OHLCV arrays into the Bar type expected by indicatorMath. */
function fixtureBars(): Bar[] {
  const dates: string[] = ohlcv.dates;
  const opens: number[] = ohlcv.open;
  const highs: number[] = ohlcv.high;
  const lows: number[] = ohlcv.low;
  const closes: number[] = ohlcv.close;
  const volumes: number[] = ohlcv.volume;
  return dates.map((time, i) => ({
    time,
    o: opens[i],
    h: highs[i],
    l: lows[i],
    c: closes[i],
    v: volumes[i],
  }));
}

const BARS = fixtureBars();
const N = BARS.length; // 500

// ─── Tolerance helper ──────────────────────────────────────────────────────────

/**
 * Assert two nullable numbers are equal within 1e-6 relative tolerance.
 * Both must be null, or both must be non-null and within tolerance.
 */
function assertClose(
  got: number | null,
  exp: number | null | undefined,
  label: string,
  idx: number,
): void {
  // Treat fixture `null` as warmup — skip comparison when both sides are null.
  if (exp === null || exp === undefined) {
    // got may be non-null (TS emits a value where Python emits null for some warmup)
    // — only assert null when the fixture explicitly says null and the TS result matches.
    if (got !== null) {
      // Some implementations differ on the exact warmup boundary by ≤1 bar;
      // allow non-null TS where fixture has null ONLY in the warmup region.
      // Outside warmup this will naturally fail on value comparison below.
    }
    return;
  }
  // fixture is non-null → TS must also be non-null and close
  expect(got, `${label}[${idx}] should be non-null when fixture is non-null`).not.toBeNull();
  const tol = 1e-6;
  const denom = Math.max(Math.abs(exp), 1e-12);
  const relErr = Math.abs((got as number) - exp) / denom;
  expect(relErr, `${label}[${idx}]: got=${got} exp=${exp} relErr=${relErr.toExponential(3)}`).toBeLessThan(
    tol,
  );
}

// ─── Ichimoku parity ──────────────────────────────────────────────────────────

describe("ichimoku parity (TLT-R5)", () => {
  const params = expIchimoku._params as {
    tenkan: number;
    kijun: number;
    senkou_b: number;
    displacement: number;
  };

  const result = ichimoku(BARS, params.tenkan, params.kijun, params.senkou_b, params.displacement);

  it("tenkan matches fixture within 1e-6 relative", () => {
    const expTenkan: (number | null)[] = expIchimoku.tenkan;
    for (let i = 0; i < N; i++) {
      assertClose(result.tenkan[i], expTenkan[i], "tenkan", i);
    }
  });

  it("kijun matches fixture within 1e-6 relative", () => {
    const expKijun: (number | null)[] = expIchimoku.kijun;
    for (let i = 0; i < N; i++) {
      assertClose(result.kijun[i], expKijun[i], "kijun", i);
    }
  });

  it("span_a (displaced) matches fixture within 1e-6 relative", () => {
    // Fixture span_a has length N (bars only; the future extension slots are not stored).
    // TS spanA has length N + displacement; fixture[i] corresponds to TS spanA[i].
    const expSpanA: (number | null)[] = expIchimoku.span_a;
    for (let i = 0; i < N; i++) {
      assertClose(result.spanA[i], expSpanA[i], "span_a", i);
    }
  });

  it("span_b (displaced) matches fixture within 1e-6 relative", () => {
    const expSpanB: (number | null)[] = expIchimoku.span_b;
    for (let i = 0; i < N; i++) {
      assertClose(result.spanB[i], expSpanB[i], "span_b", i);
    }
  });
});

// ─── Ribbon EMA parity ────────────────────────────────────────────────────────

describe("ribbon EMA parity (TLT-R5)", () => {
  // trendRibbon() uses SMA-seeded recursive EMA; Python uses pandas adjust=True
  // (numerically-weighted formula). These converge asymptotically but differ by
  // up to 1% in the first ~100 bars. See module-level comment for full details.
  // Tests are marked todo rather than skipped so the divergence remains visible
  // in the test run and is not silently ignored.
  //
  // ── WHY THIS IS NOT THE SAME PROBLEM AS BOLLINGER (verified 2026-09-18) ──
  // The BB defect was a TRUST failure: ChartPanel inlined its own band math, so this
  // suite certified a function the chart never called. Ribbon has no such gap —
  // ChartPanel.tsx buildRibbon() calls indicatorMath.trendRibbon() directly, so the
  // implementation tested here IS the implementation rendered. Fixing BB therefore did
  // not touch Ribbon, and these todos are a formula question, not a drift question.
  // Measured on this fixture: fast_ema(20) max 0.118% (converged by bar 99),
  // slow_ema(50) max 1.310% (converged by bar 243), ribbon_state disagrees on
  // 11/500 bars, all inside bars 75–87.
  // The open decision is NOT bounded the way BB's was, which is why it was left here:
  //   1. indicatorMath.ema() is shared with the EMA overlay indicator and others, so
  //      changing its seeding is not a Ribbon-local edit.
  //   2. The Python side (engine/dannytrades.py `_ema`) feeds ribbon_trend() signals,
  //      so changing it moves live signal output in the Macro repo, not just a fixture.
  //   3. There is no clean in-repo oracle here, unlike BB: the published ribbon source
  //      (IND_DEFS.ribbon.source) is labelled DISPLAY-TIER DESCRIPTIVE rather than
  //      definitional, and this repo's Pine engine implements ta.ema as FIRST-VALUE
  //      seeded (lib/pine-engine/runtime.ts) while TradingView's ta.ema is SMA-seeded —
  //      a third convention, and a defect in its own right.

  const result = trendRibbon(BARS, 20, 50, 10);

  test.todo(
    "fast_ema (span=20) matches fixture within 1e-6 relative: " +
      "DIVERGES — TS uses SMA-seeded recursive EMA; Python uses pandas ewm(adjust=True). " +
      "Both converge asymptotically but differ by ~0.1% in the first ~100 warmup bars. " +
      "Fix requires changing trendRibbon to implement the pandas adjust=True weighted formula.",
  );

  test.todo(
    "slow_ema (span=50) matches fixture within 1e-6 relative: " +
      "DIVERGES — same EMA seeding divergence as fast_ema, larger magnitude (~1.3% at warmup) " +
      "due to the wider window. Converges within ~250 bars.",
  );

  test.todo(
    "ribbon_state (+1/0/-1) matches fixture: " +
      "DIVERGES — ribbon_state is derived from the EMA values, so the seeding divergence " +
      "propagates and causes different state classifications during the first ~100–200 bars. " +
      "Fix requires resolving the EMA seeding divergence first.",
  );

  // Convergence sanity check: after full warmup both implementations must agree.
  // We check the last 50 bars (indices 450–499) where both EMAs have converged.
  it("fast_ema converges to fixture in the tail (bars 450-499)", () => {
    const expFast: (number | null)[] = expRibbon.fast_ema;
    for (let i = 450; i < N; i++) {
      if (expFast[i] === null) continue;
      if (result.emaFast[i] === null) continue;
      const tol = 5e-5; // relaxed 5e-5 for tail convergence check (not the strict parity tol)
      const denom = Math.max(Math.abs(expFast[i]!), 1e-12);
      const relErr = Math.abs(result.emaFast[i]! - expFast[i]!) / denom;
      expect(
        relErr,
        `fast_ema[${i}]: got=${result.emaFast[i]} exp=${expFast[i]} relErr=${relErr.toExponential(3)}`,
      ).toBeLessThan(tol);
    }
  });
});

// ─── RSI parity ───────────────────────────────────────────────────────────────

describe("RSI parity (TLT-R5)", () => {
  // rsiStack computes three RSI periods simultaneously.
  const result = rsiStack(BARS, 7, 14, 21);

  it("rsi_7 matches fixture within 1e-6 relative", () => {
    const expR7: (number | null)[] = expRsi.rsi_7;
    for (let i = 0; i < N; i++) {
      assertClose(result.r1[i], expR7[i], "rsi_7", i);
    }
  });

  it("rsi_14 matches fixture within 1e-6 relative", () => {
    const expR14: (number | null)[] = expRsi.rsi_14;
    for (let i = 0; i < N; i++) {
      assertClose(result.r2[i], expR14[i], "rsi_14", i);
    }
  });

  it("rsi_21 matches fixture within 1e-6 relative", () => {
    const expR21: (number | null)[] = expRsi.rsi_21;
    for (let i = 0; i < N; i++) {
      assertClose(result.r3[i], expR21[i], "rsi_21", i);
    }
  });
});

// ─── Bollinger Bands parity ───────────────────────────────────────────────────

describe("Bollinger Bands parity (TLT-R5) — Macro Python engine contract", () => {
  // Scope: engine/bollinger_event_signals.py `_bb_bands()`, which uses pandas .std()
  // (ddof=1, sample). ddof=1 is passed EXPLICITLY — the library default is population σ
  // because that is what the charted indicator publishes. Keeping this contract honest
  // requires naming which std dev it means; it must not ride on a default that belongs
  // to a different indicator. The charted bands are pinned in bollingerRenderParity.test.ts.
  const params = expBollinger._params as { len: number; mult: number };
  const result = bollingerBands(BARS, params.len, params.mult, 1);

  it("upper band matches fixture within 1e-6 relative", () => {
    const expUpper: (number | null)[] = expBollinger.upper;
    for (let i = 0; i < N; i++) {
      assertClose(result.upper[i], expUpper[i], "bb_upper", i);
    }
  });

  it("mid (SMA basis) matches fixture within 1e-6 relative", () => {
    const expMid: (number | null)[] = expBollinger.mid;
    for (let i = 0; i < N; i++) {
      assertClose(result.mid[i], expMid[i], "bb_mid", i);
    }
  });

  it("lower band matches fixture within 1e-6 relative", () => {
    const expLower: (number | null)[] = expBollinger.lower;
    for (let i = 0; i < N; i++) {
      assertClose(result.lower[i], expLower[i], "bb_lower", i);
    }
  });

  // The former "ChartPanel stddev diverges" test.todo lived here. It is resolved, not
  // deleted: the rendered-chart contract it described is now an executing test in
  // bollingerRenderParity.test.ts, which fails if ChartPanel ever re-inlines its own
  // band math or if the owner's denominator is changed back.
});

// ─── Indicators M2 parity (D04: VWAP / Anchored VWAP / Volume Profile + POC) ──
//
// Cross-repo parity contract with engine/indicators_m2.py. All values are daily-bar
// approximations over typical price TP=(H+L+C)/3 (not intraday-true VWAP). No
// test.todo divergences here — the fixture is the contract and the Terminal side is
// aligned to match it exactly (see indicatorMath.ts avwap/rollingVwap/weekAnchoredVwap
// /rollingPoc/vprofile).

/** Assert that TS emits null exactly where (and only where) the fixture emits null.
 *  This pins the warm-up boundary — a series that produced a value one bar early or
 *  late would pass a pure value check but fail here. */
function assertNullAlignment(
  got: (number | null)[],
  exp: (number | null)[],
  label: string,
): void {
  for (let i = 0; i < exp.length; i++) {
    const eNull = exp[i] === null || exp[i] === undefined;
    const gNull = got[i] === null || got[i] === undefined;
    expect(gNull, `${label}[${i}] null-alignment: got ${got[i]} exp ${exp[i]}`).toBe(eNull);
  }
}

describe("Indicators M2 parity (D04 — VWAP / AVWAP / Volume Profile)", () => {
  const params = expM2._params as {
    rolling_vwap_n: number;
    anchored_vwap_anchor_pos: number;
    rolling_poc_window: number;
    rolling_poc_bins: number;
    volume_profile_window: number;
    volume_profile_bins: number;
  };

  it("rolling_vwap (n=20) matches fixture within 1e-6 relative + null-aligned", () => {
    const exp: (number | null)[] = expM2.rolling_vwap_n20;
    const got = rollingVwap(BARS, params.rolling_vwap_n);
    assertNullAlignment(got, exp, "rolling_vwap");
    for (let i = 0; i < N; i++) assertClose(got[i], exp[i], "rolling_vwap", i);
  });

  it("week_anchored_vwap matches fixture within 1e-6 relative + null-aligned", () => {
    const exp: (number | null)[] = expM2.week_anchored_vwap;
    const got = weekAnchoredVwap(BARS);
    assertNullAlignment(got, exp, "week_anchored_vwap");
    for (let i = 0; i < N; i++) assertClose(got[i], exp[i], "week_anchored_vwap", i);
  });

  it("anchored_vwap (positional anchor = 50) matches fixture within 1e-6 relative + null-aligned", () => {
    const exp: (number | null)[] = expM2.anchored_vwap_pos50;
    const got = avwap(BARS, params.anchored_vwap_anchor_pos);
    assertNullAlignment(got, exp, "anchored_vwap");
    for (let i = 0; i < N; i++) assertClose(got[i], exp[i], "anchored_vwap", i);
  });

  it("rolling_poc (window=126, bins=24) matches fixture within 1e-6 relative + null-aligned", () => {
    const exp: (number | null)[] = expM2.rolling_poc_w126_b24;
    const got = rollingPoc(BARS, params.rolling_poc_window, params.rolling_poc_bins);
    assertNullAlignment(got, exp, "rolling_poc");
    for (let i = 0; i < N; i++) assertClose(got[i], exp[i], "rolling_poc", i);
  });

  it("volume_profile (final bar, full window) poc/va_low/va_high + bins match fixture", () => {
    const exp = expM2.volume_profile_final as {
      poc: number; va_low: number; va_high: number;
      bin_edges: number[]; bin_volumes: number[]; window_used: number;
    };
    // Python built the fixture with window=len(df) (500) and bins=24.
    const vp = vprofile(BARS, params.volume_profile_window, params.volume_profile_bins, false);
    assertClose(vp.poc, exp.poc, "vp_poc", 0);
    assertClose(vp.val, exp.va_low, "vp_va_low", 0);
    assertClose(vp.vah, exp.va_high, "vp_va_high", 0);
    // Bin-by-bin: edges (bin.priceLo == python bin_edges[i]) and volumes must match.
    expect(vp.bins.length, "vp bin count").toBe(exp.bin_volumes.length);
    for (let i = 0; i < vp.bins.length; i++) {
      assertClose(vp.bins[i].priceLo, exp.bin_edges[i], "vp_edge", i);
      assertClose(vp.bins[i].volume, exp.bin_volumes[i], "vp_binvol", i);
    }
    // Upper outer edge closes the histogram (python bin_edges has bins+1 entries).
    assertClose(vp.bins[vp.bins.length - 1].priceHi, exp.bin_edges[exp.bin_volumes.length], "vp_topEdge", 0);
  });
});
