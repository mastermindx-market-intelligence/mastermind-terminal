// suiteModules.test.ts — deterministic tests for the premium suite modules (W0 + W1 + W2).
//
// W0 (Structure Core): pivots (exact fractals / ties / body-vs-wick), Market Structure (BOS,
// CHoCH, NON-REPAINT), Order Blocks (zone bounds, mitigation, breaker flip, grade monotonicity),
// FVG (zone bounds, partial-fill watermark, iFVG flip, threshold filter).
// W1: Premium & Discount (range + fib arithmetic), Liquidity (clustering tolerance, grabs, caps),
// SFP (confirm-bar semantics, reclaim speed, invalidation), Trend Engine (flip engine, TP ladder,
// NON-REPAINT), Volt Bands (expansion memory), Candle Painter (coverage + intensity tiers),
// Flow Band (HMA vs a reference WMA-of-WMA, HTF no-lookahead).
// Plus contract hygiene (prim ids, finite numbers, zero hex literals, token-only colors, settings
// schema) and drawn-density caps.
//
// W2 (PANE suites — Pulse Oscillator, RSI Ultimate, MACD Ultimate): the shared oscillator math
// (Wilder RSI vs an independent reference, no-lookahead normalization, resampling), the shared
// 4-class divergence detector on a crafted known divergence, and each pane suite's modules —
// crafted signal fixtures, histogram column contract, phase hysteresis, channel models, draw caps.
// Every pane module's y-values are additionally asserted to live inside its SuiteDef pane range.
//
// W2 tolerances (deliberate): the shared math is checked against independent references at 1e-8
// (RSI, per the brief) and 1e-9..1e-12 elsewhere, because those are closed-form recurrences. The
// pane modules' own values are NOT hand-computed — a ±100 reading is the output of a trailing-window
// normalization, so a literal would encode float noise rather than behaviour. Those tests instead
// assert SHAPE against the module's own engine (`computePulseWave` / `computeUltimateRsi` /
// `computeUltimateMacd`): the drawn point IS the series value (exact ===), and every signal is
// re-derived from that series and compared as a set.
//
// W3 (DASHBOARD modules — Market Dashboard + the three MTF dashboards): these draw NO prims; their
// output is `ModuleResult.tables` (the W3 addition to the frozen contract). Tested here: the shared
// `buildMtfTable` plumbing (padding/trimming/sanitizing/the mandatory footnote), the Market
// Dashboard's arithmetic on a fixture where every row is hand-computable, the MTF columns' exclusion
// of the trailing PARTIAL resample block (the non-repaint rule that makes the dashboards honest),
// and the W2 satellite law — every dashboard recomputes its producer's series at the producer's LIVE
// settings from ctx.suite. ChartTables.tsx is DOM and is NOT tested here (no jsdom in this suite);
// only the TableSpec these modules emit is.
//
// All inputs are crafted or generated from a seeded LCG — no Date.now, no Math.random.
//
// Fixture note: several W1 fixtures are built by `levelBars`, whose bars have a true range of
// EXACTLY 2 on every bar (bar i spans [L, L+2], closes at L+1, and |ΔL| <= 1 keeps
// max(h-l, |h-prevClose|, |l-prevClose|) pinned at 2). ATR is therefore exactly 2 everywhere,
// which makes every ATR-scaled threshold in the modules hand-computable.

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

import { findPivotsHL, type Pivot } from "../suites/structure/pivots";
import { MARKET_STRUCTURE_MODULE } from "../suites/structure/marketStructure";
import { ORDER_BLOCKS_MODULE } from "../suites/structure/orderBlocks";
import { FVG_MODULE } from "../suites/structure/fvg";
import { PREMIUM_DISCOUNT_MODULE } from "../suites/structure/premiumDiscount";
import { LIQUIDITY_MODULE } from "../suites/structure/liquidity";
import { SFP_MODULE } from "../suites/structure/sfp";
import { SMART_SR_MODULE } from "../suites/structure/smartSR";
import { MONEY_FLOW_PROFILE_MODULE } from "../suites/structure/moneyFlowProfile";
import { AUTO_PATTERNS_MODULE } from "../suites/structure/autoPatterns";
import { TREND_ENGINE_MODULE } from "../suites/trend/trendEngine";
import { VOLT_BANDS_MODULE } from "../suites/trend/voltixBands";
import { CANDLE_PAINTER_MODULE } from "../suites/trend/candlePainter";
import { FLOW_BAND_MODULE } from "../suites/trend/flowBand";
import {
  emaArr,
  normalizeSigned,
  resampleOhlcv,
  rollingPercentile,
  rsiArr,
  wilderRma,
} from "../suites/shared/oscUtils";
import {
  divergenceStrength,
  findDivergences,
  type DivergenceEvent,
} from "../suites/shared/divergence";
import { PULSE_WAVE_MODULE, computePulseWave } from "../suites/pulse/pulseWave";
import { PULSE_SIGNALS_MODULE } from "../suites/pulse/pulseSignals";
import { PULSE_DIVERGENCE_MODULE } from "../suites/pulse/divergences";
import { VOLUME_MAPPING_MODULE } from "../suites/pulse/volumeMapping";
import { FLOWS_MODULE } from "../suites/pulse/flows";
import { RSI_ENGINE_MODULE, RSI_DEFAULTS, computeUltimateRsi } from "../suites/rsix/rsiEngine";
import { RSI_SIGNALS_MODULE } from "../suites/rsix/rsiSignals";
import { RSI_DIVERGENCE_MODULE } from "../suites/rsix/rsiDivergence";
import { RSI_CHANNELS_MODULE } from "../suites/rsix/rsiChannels";
import {
  MACD_ENGINE_MODULE,
  MACDX_ENGINE_DEFAULTS,
  computeUltimateMacd,
} from "../suites/macdx/macdEngine";
import { MACD_SIGNALS_MODULE } from "../suites/macdx/macdSignals";
import { MACD_DIVERGENCE_MODULE } from "../suites/macdx/macdDivergence";
import { MACD_HISTOGRAM_MODULE } from "../suites/macdx/macdHistogram";
import { MACD_TREND_MODULE } from "../suites/macdx/macdTrend";
import { MARKET_DASHBOARD_MODULE } from "../suites/trend/marketDashboard";
import { PULSE_MTF_MODULE } from "../suites/pulse/mtfDash";
import { RSIX_MTF_MODULE } from "../suites/rsix/mtfDash";
import { MACDX_MTF_MODULE } from "../suites/macdx/mtfDash";
import {
  EM_DASH,
  MTF_COLUMN_KEYS,
  MTF_COLUMN_LABELS,
  MTF_FACTORS,
  MTF_SIGNAL_WINDOW,
  buildMtfTable,
  mtfAgo,
  mtfBasisTip,
  mtfBool,
  mtfFade,
  mtfFootnote,
  mtfPos,
  mtfSlope,
} from "../suites/shared/mtfTable";
import { SUITE_ORDER } from "../suites/registry";
// B7: `SUITE_DEFS` is the METADATA graph now, so its module objects are not the ones this file
// imports and computes with. These tests are about COMPUTATION, so they read the runtime defs —
// the same objects, statically imported because a node test has no bundle to protect.
import { STRUCTURE_SUITE } from "../suites/runtime/structure";
import { TREND_SUITE } from "../suites/runtime/trend";
import { PULSE_SUITE } from "../suites/runtime/pulse";
import { RSIX_SUITE } from "../suites/runtime/rsix";
import { MACDX_SUITE } from "../suites/runtime/macdx";

const SUITE_DEFS: Record<string, SuiteDef> = {
  structure: STRUCTURE_SUITE,
  trend: TREND_SUITE,
  pulse: PULSE_SUITE,
  rsix: RSIX_SUITE,
  macdx: MACDX_SUITE,
};
import {
  MAX_PRIMS_PER_MODULE,
  type ModuleCtx,
  type ModuleResult,
  type Prim,
  type SuiteBar,
  type SuiteColors,
  type SuiteDef,
  type SuiteEvent,
  type SuiteModuleDef,
  type TableSpec,
} from "../indicator-canvas/types";

// ─── Harness ──────────────────────────────────────────────────────────────────

/** Token-shaped color strings: distinct, non-hex, and traceable back to their slot. */
const COLORS: SuiteColors = {
  up: "var(--up)",
  down: "var(--down)",
  flowBuy: "var(--flow-buy)",
  flowSell: "var(--flow-sell)",
  warn: "var(--warn)",
  brand: "var(--brand-2)",
  text: "var(--text)",
  muted: "var(--muted)",
  neutral: "var(--text-dim)",
};

/** The suite a module belongs to, by object identity (module keys repeat across suites). */
function suiteOf(mod: SuiteModuleDef): SuiteDef | undefined {
  for (const k of SUITE_ORDER) if (SUITE_DEFS[k].modules.includes(mod)) return SUITE_DEFS[k];
  return undefined;
}

/**
 * `ctx.suite` exactly as host.ts assembles it: every module of the owning suite, module-prefixed,
 * defaults merged — then this module's own `overrides` under its own prefix, then any explicit
 * `flat` params. `flat` is how a test retunes a PRODUCER module (e.g. { "eng.len": 4 }) while
 * computing one of its satellites.
 */
function suiteFlatFor(
  mod: SuiteModuleDef,
  overrides: Record<string, any>,
  flat: Record<string, any>,
): Record<string, any> {
  const out: Record<string, any> = {};
  const def = suiteOf(mod);
  for (const m of def ? def.modules : [mod]) {
    out[`${m.key}.on`] = m.defaultOn;
    for (const k of Object.keys(m.defaults ?? {})) out[`${m.key}.${k}`] = m.defaults[k];
  }
  for (const k of Object.keys(overrides)) out[`${mod.key}.${k}`] = overrides[k];
  for (const k of Object.keys(flat)) out[k] = flat[k];
  return out;
}

function ctxFor(
  mod: SuiteModuleDef,
  bars: SuiteBar[],
  overrides: Record<string, any> = {},
  lang: "en" | "zh" = "en",
  flat: Record<string, any> = {},
): ModuleCtx {
  return {
    bars,
    tf: "1D",
    symbol: "TEST",
    isIntraday: false,
    s: { ...mod.defaults, ...overrides },
    suite: suiteFlatFor(mod, overrides, flat),
    colors: COLORS,
    lang,
  };
}

const run = (
  mod: SuiteModuleDef,
  bars: SuiteBar[],
  overrides: Record<string, any> = {},
  lang: "en" | "zh" = "en",
  flat: Record<string, any> = {},
): ModuleResult => mod.compute(ctxFor(mod, bars, overrides, lang, flat));

/** Explicit OHLCV rows -> SuiteBar[] with a monotonic synthetic time axis. */
function mkBars(rows: Array<[number, number, number, number, number?]>): SuiteBar[] {
  return rows.map((r, i) => ({ t: 86400 * (i + 1), o: r[0], h: r[1], l: r[2], c: r[3], v: r[4] ?? 1000 }));
}

/** Close-path -> valid OHLC bars (o = previous close, ±0.2 wicks). */
function pathBars(prices: number[], vol = 1000): SuiteBar[] {
  return prices.map((p, i) => {
    const o = i === 0 ? p : prices[i - 1];
    return {
      t: 86400 * (i + 1),
      o,
      h: Math.max(o, p) + 0.2,
      l: Math.min(o, p) - 0.2,
      c: p,
      v: vol,
    };
  });
}

/** Deterministic LCG — reproducible "noise" without Math.random. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Seeded random walk with a deterministic swing carrier — produces real structure.
 * `shockEvery > 0` injects a periodic alternating-direction impulse bar on heavy volume so that
 * Order Blocks actually fire (a smooth walk never clears the ATR + volume-percentile gates).
 */
function walkBars(n: number, seed = 20260728, shockEvery = 0): SuiteBar[] {
  const rnd = lcg(seed);
  const out: SuiteBar[] = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    const r1 = rnd(), r2 = rnd(), r3 = rnd(), r4 = rnd();
    const shock = shockEvery > 0 && i > 24 && i % shockEvery === 0;
    const drift = Math.sin(i / 5) * 0.8;
    const o = p;
    const c = shock
      ? Math.max(5, p + (i % (2 * shockEvery) === 0 ? 3.4 : -3.4))
      : Math.max(5, p + (r1 - 0.5) * 1.2 + drift);
    const h = Math.max(o, c) + r2 * 0.7;
    const l = Math.max(0.5, Math.min(o, c) - r3 * 0.7);
    out.push({ t: 86400 * (i + 1), o, h, l, c, v: shock ? 9000 : 800 + Math.floor(r4 * 1400) });
    p = c;
  }
  return out;
}

const structural = (evs: SuiteEvent[] | undefined) =>
  (evs ?? []).filter((e) => e.type === "bos" || e.type === "choch");

/**
 * Level path -> bars whose TRUE RANGE is exactly 2 on every bar (see the file header), so every
 * ATR-derived threshold in a module is exact. Requires |L[i] - L[i-1]| <= 1.
 */
function levelBars(Ls: number[], vols?: number[]): SuiteBar[] {
  return Ls.map((L, i) => ({
    t: 86400 * (i + 1),
    o: i === 0 ? L + 1 : Ls[i - 1] + 1,
    h: L + 2,
    l: L,
    c: L + 1,
    v: vols?.[i] ?? 1000,
  }));
}

/** `steps` values walking from `from` (exclusive) to `to` (inclusive). */
function ramp(from: number, to: number, steps: number): number[] {
  const out: number[] = [];
  for (let k = 1; k <= steps; k++) out.push(from + ((to - from) * k) / steps);
  return out;
}

/** [high, low, close] rows -> bars (open = previous close). */
function hlcBars(rows: Array<[number, number, number]>, vols: number[] = []): SuiteBar[] {
  return rows.map((r, i) => ({
    t: 86400 * (i + 1),
    o: i === 0 ? r[2] : rows[i - 1][2],
    h: r[0],
    l: r[1],
    c: r[2],
    v: vols[i] ?? 1000,
  }));
}

const evOf = (res: ModuleResult, type: string) => (res.events ?? []).filter((e) => e.type === type);
const primOf = (res: ModuleResult, id: string) => res.prims.find((p) => p.id === id) as any;

// ─── 1. pivots ────────────────────────────────────────────────────────────────

describe("findPivotsHL", () => {
  // idx:   0     1     2     3     4     5     6     7     8     9    10
  // h:    10    11    15    11    10     9     8    12     9    10     9
  // l:     5     6     7     6     5     2     4     6     5     6     5
  const CRAFTED = mkBars([
    [7, 10, 5, 8], [8, 11, 6, 9], [9, 15, 7, 11], [11, 11, 6, 8], [8, 10, 5, 7],
    [7, 9, 2, 4], [4, 8, 4, 6], [6, 12, 6, 10], [10, 9, 5, 7], [7, 10, 6, 8], [8, 9, 5, 7],
  ]);

  it("finds the exact fractal highs and lows with confirmation bars", () => {
    expect(findPivotsHL(CRAFTED, 2, 2)).toEqual<Pivot[]>([
      { i: 2, p: 15, kind: "high", confirmedAt: 4 },
      { i: 5, p: 2, kind: "low", confirmedAt: 7 },
      { i: 7, p: 12, kind: "high", confirmedAt: 9 },
    ]);
  });

  it("never returns a pivot whose right window runs past the last bar", () => {
    for (const R of [1, 2, 3, 4]) {
      for (const pv of findPivotsHL(CRAFTED, 2, R)) {
        expect(pv.confirmedAt).toBe(pv.i + R);
        expect(pv.confirmedAt).toBeLessThanOrEqual(CRAFTED.length - 1);
      }
    }
  });

  it("returns nothing when the series is shorter than left+right+1", () => {
    expect(findPivotsHL(CRAFTED.slice(0, 4), 2, 2)).toEqual([]);
    expect(findPivotsHL([], 2, 2)).toEqual([]);
  });

  it("resolves plateau ties to the FIRST bar of the run", () => {
    // highs 1, 5, 5, 1, 1 — the two 5s tie; only the earlier one is a pivot.
    const tie = mkBars([
      [1, 1, 0.5, 1], [3, 5, 2.5, 4], [4, 5, 2.6, 4], [4, 1, 0.6, 1], [1, 1, 0.7, 1],
    ]);
    const highs = findPivotsHL(tie, 1, 1).filter((p) => p.kind === "high");
    expect(highs).toEqual<Pivot[]>([{ i: 1, p: 5, kind: "high", confirmedAt: 2 }]);
  });

  it("distinguishes wick source from body source", () => {
    // Bar 2 has a 20-high spike but a body top of 11 (lower than both neighbours).
    const src = mkBars([
      [9.5, 10.5, 9, 10],
      [11, 12.5, 10.5, 12],
      [11, 20, 10, 10.5],
      [12, 13, 11.5, 12.5],
      [10, 10.5, 9.5, 9.8],
    ]);
    const wick = findPivotsHL(src, 1, 1, "wick").filter((p) => p.kind === "high");
    const body = findPivotsHL(src, 1, 1, "body").filter((p) => p.kind === "high");
    expect(wick.map((p) => p.i)).toEqual([2]);
    expect(wick[0].p).toBe(20);
    expect(body.map((p) => p.i)).toEqual([1, 3]);
    expect(body.map((p) => p.p)).toEqual([12, 12.5]);
  });

  it("sanitizes out-of-range wings instead of throwing", () => {
    const bars = walkBars(80);
    expect(() => findPivotsHL(bars, 0, 0)).not.toThrow();
    expect(() => findPivotsHL(bars, -5, 1e9)).not.toThrow();
    expect(findPivotsHL(bars, 0, 0)).toEqual(findPivotsHL(bars, 5, 5)); // wing(0) -> fallback 5
  });
});

// ─── 2. marketStructure ───────────────────────────────────────────────────────

/**
 * Close path with one confirmed swing high (bar 21, wick 101.2) that is closed through at bar 40.
 * Wings of 10 bars on either side of every extreme; no swing low is ever taken out.
 */
function bosPath(): number[] {
  const p: number[] = [];
  for (let i = 0; i <= 10; i++) p.push(100 - i);              // 100 → 90
  for (let i = 11; i <= 21; i++) p.push(90 + (i - 10));       // 91 → 101 (swing high @21)
  for (let i = 22; i <= 32; i++) p.push(101 - (i - 21));      // 100 → 90 (swing low @32)
  for (let i = 33; i <= 44; i++) p.push(90 + 1.5 * (i - 32)); // 91.5 → 108 (breaks 101.2 at bar 40)
  return p;
}

/** bosPath + a reversal leg: swing low @55 (96.8) is closed through at bar 74 while trend = up. */
function chochPath(): number[] {
  const p = bosPath();
  for (let i = 45; i <= 55; i++) p.push(108 - (i - 44));        // 107 → 97 (swing low @55)
  for (let i = 56; i <= 66; i++) p.push(97 + (i - 55));         // 98 → 108
  for (let i = 67; i <= 80; i++) p.push(108 - 1.5 * (i - 66));  // 106.5 → 87
  return p;
}

const MS_S = { swingLen: 10, internalLen: 5, showLast: 40 };

describe("marketStructure — break detection", () => {
  it("prints exactly one bullish BOS at the expected bar and level", () => {
    const bars = pathBars(bosPath());
    const evs = structural(run(MARKET_STRUCTURE_MODULE, bars, MS_S).events);
    expect(evs.length).toBe(1);
    expect(evs[0].type).toBe("bos");
    expect(evs[0].dir).toBe("bull");
    expect(evs[0].i).toBe(40);
    expect(evs[0].p).toBeCloseTo(101.2, 9);
  });

  it("emits the matching BOS line + label prims", () => {
    const bars = pathBars(bosPath());
    const { prims } = run(MARKET_STRUCTURE_MODULE, bars, MS_S);
    const line = prims.find((p) => p.id === "ms-sw-bos-40");
    expect(line).toBeDefined();
    expect(line!.kind).toBe("line");
    const label = prims.find((p) => p.id === "ms-sw-bos-l-40");
    expect(label).toBeDefined();
    expect((label as any).text).toBe("BOS");
  });

  it("calls the counter-trend break a CHoCH", () => {
    const bars = pathBars(chochPath());
    const evs = structural(run(MARKET_STRUCTURE_MODULE, bars, MS_S).events);
    expect(evs.map((e) => [e.type, e.dir, e.i])).toEqual([
      ["bos", "bull", 40],
      ["choch", "bear", 74],
    ]);
    expect(evs[1].p).toBeCloseTo(96.8, 9);
  });

  it("honours the direction filter without changing detection", () => {
    const bars = pathBars(chochPath());
    const bull = run(MARKET_STRUCTURE_MODULE, bars, { ...MS_S, filter: "bull" });
    // events are the full tape; only the drawn set is filtered
    expect(structural(bull.events).length).toBe(2);
    expect(bull.prims.some((p) => p.id === "ms-sw-choch-74")).toBe(false);
    expect(bull.prims.some((p) => p.id === "ms-sw-bos-40")).toBe(true);
  });

  it("is deterministic across repeated computes", () => {
    const bars = pathBars(chochPath());
    expect(run(MARKET_STRUCTURE_MODULE, bars, MS_S)).toEqual(run(MARKET_STRUCTURE_MODULE, bars, MS_S));
  });
});

describe("marketStructure — non-repaint", () => {
  it("keeps every settled event identical when 40 future bars are appended", () => {
    const swingLen = 20;
    const full = walkBars(340, 991);
    const short = full.slice(0, 300);
    const cut = 300 - swingLen; // events at or before this bar can no longer change

    const a = run(MARKET_STRUCTURE_MODULE, short, { swingLen, showLast: 40 }).events ?? [];
    const b = run(MARKET_STRUCTURE_MODULE, full, { swingLen, showLast: 40 }).events ?? [];

    const key = (e: SuiteEvent) => `${e.type}|${e.dir}|${e.i}|${e.p}`;
    const settledA = a.filter((e) => e.i <= cut).map(key);
    const settledB = b.filter((e) => e.i <= cut).map(key);

    expect(structural(a).length).toBeGreaterThanOrEqual(3); // the fixture must actually exercise this
    expect(settledA.length).toBeGreaterThan(0);
    expect(settledB).toEqual(settledA);
  });
});

// ─── 3. orderBlocks ───────────────────────────────────────────────────────────

/**
 * 40 quiet up-candles, one opposing (down) candle at bar 40, then a 2.5-point bullish body
 * (~5× ATR) on 5× volume at bar 41 — one, and only one, bullish order block.
 * `tailFrom` optionally replaces the post-impulse plateau with a slow decline that eventually
 * closes below the block.
 */
function obBars(opts: { decline?: boolean } = {}): SuiteBar[] {
  const rows: Array<[number, number, number, number, number?]> = [];
  // Two volume regimes (heavy 0..19, light 20..39) keep the trailing volume percentile off its
  // ceiling, so the grade actually responds to the formation window's volume.
  for (let i = 0; i < 40; i++) rows.push([100.0, 100.3, 99.8, 100.1, i < 20 ? 2000 : 500]);
  rows.push([100.1, 100.3, 99.7, 99.9, 500]);   // 40 — anchor (last opposing candle)
  rows.push([99.9, 102.5, 99.8, 102.4, 2000]);  // 41 — impulse (~5x ATR body, top-decile volume)
  if (!opts.decline) {
    for (let i = 42; i < 60; i++) rows.push([102.4, 102.7, 102.2, 102.5, 500]);
  } else {
    let prev = 102.4;
    for (let i = 42; i < 75; i++) {
      const c = 102.4 - 0.15 * (i - 41);
      rows.push([prev, Math.max(prev, c) + 0.1, Math.min(prev, c) - 0.1, c, 500]);
      prev = c;
    }
  }
  return mkBars(rows);
}

const obZone = (prims: Prim[]) => prims.filter((p) => p.kind === "zone" && /^ob:\d+:z$/.test(p.id));

describe("orderBlocks", () => {
  it("creates exactly one block whose zone bounds are the anchor candle's range", () => {
    const bars = obBars();
    const { prims, events } = run(ORDER_BLOCKS_MODULE, bars);
    const created = (events ?? []).filter((e) => e.type === "ob_created");
    expect(created.length).toBe(1);
    expect(created[0].dir).toBe("bull");
    expect(created[0].i).toBe(41);

    const zones = obZone(prims) as any[];
    expect(zones.length).toBe(1);
    expect(zones[0].i1).toBe(40);           // anchor candle
    expect(zones[0].p1).toBeCloseTo(99.7, 9);  // anchor low
    expect(zones[0].p2).toBeCloseTo(100.3, 9); // anchor high
    expect(zones[0].i2).toBe("right");
  });

  it("uses body bounds when boundsMode = body", () => {
    const zones = obZone(run(ORDER_BLOCKS_MODULE, obBars(), { boundsMode: "body" }).prims) as any[];
    expect(zones.length).toBe(1);
    expect(zones[0].p1).toBeCloseTo(99.9, 9);  // min(o,c) of the anchor
    expect(zones[0].p2).toBeCloseTo(100.1, 9); // max(o,c) of the anchor
  });

  it("removes the block when price closes through it (breaker off)", () => {
    const bars = obBars({ decline: true });
    const { prims, events } = run(ORDER_BLOCKS_MODULE, bars, { breaker: false });
    const broke = (events ?? []).filter((e) => e.type === "ob_break");
    expect(broke.length).toBe(1);
    expect(broke[0].dir).toBe("bull");
    expect(obZone(prims).length).toBe(0);
    expect(prims.length).toBe(0);
  });

  it("converts the mitigated block into a breaker when enabled", () => {
    const bars = obBars({ decline: true });
    const { prims } = run(ORDER_BLOCKS_MODULE, bars, { breaker: true });
    expect(obZone(prims).length).toBe(0); // no longer a live block
    const brk = prims.find((p) => /^ob:\d+:brk$/.test(p.id)) as any;
    expect(brk).toBeDefined();
    expect(brk.kind).toBe("zone");
    expect(brk.p1).toBeCloseTo(99.7, 9);
    expect(brk.p2).toBeCloseTo(100.3, 9);
    expect(brk.fill).toBe(COLORS.down); // role-flipped from a bullish block

    const lbl = prims.find((p) => /^ob:\d+:brklbl$/.test(p.id)) as any;
    expect(lbl?.text).toBe("Breaker Block");
    const zhLbl = run(ORDER_BLOCKS_MODULE, bars, { breaker: true }, "zh").prims
      .find((p) => /^ob:\d+:brklbl$/.test(p.id)) as any;
    expect(zhLbl?.text).toBe("破位块");
    expect(zhLbl?.text).not.toBe(lbl?.text);
  });

  it("does not lower the grade when the formation volume is doubled", () => {
    const base = obBars();
    const doubled = base.map((b, i) => (i >= 38 && i <= 41 ? { ...b, v: b.v * 2 } : b));

    const g = (bars: SuiteBar[]) => {
      const ev = (run(ORDER_BLOCKS_MODULE, bars).events ?? []).find((e) => e.type === "ob_created");
      expect(ev).toBeDefined();
      return ev!;
    };
    const a = g(base);
    const b = g(doubled);
    expect(a.strength).toBeLessThan(100); // the measurement must not be pinned at its ceiling
    expect(b.strength!).toBeGreaterThanOrEqual(a.strength!);

    const RANK = ["WEAK", "BALANCED", "HIGH", "STRONG"];
    const tierOf = (e: SuiteEvent) => RANK.findIndex((t) => (e.label ?? "").endsWith(t));
    expect(tierOf(a)).toBeGreaterThanOrEqual(0);
    expect(tierOf(b)).toBeGreaterThanOrEqual(tierOf(a));
  });

  it("returns nothing below the minimum bar count", () => {
    expect(run(ORDER_BLOCKS_MODULE, obBars().slice(0, 20)).prims).toEqual([]);
  });
});

// ─── 4. fvg ───────────────────────────────────────────────────────────────────

type FvgTail = "clean" | "half" | "invert" | "tiny";

/**
 * Bars 0..19 quiet, then a 3-candle bullish imbalance closing on bar 21:
 * high[19] = 100.5, low[21] = 103.0 → zone [100.5, 103.0] anchored at bar 20, size 2.5 (≈2.1× ATR).
 */
function fvgBars(tail: FvgTail): SuiteBar[] {
  const rows: Array<[number, number, number, number, number?]> = [];
  for (let i = 0; i < 20; i++) rows.push([100.0, 100.5, 99.5, 100.2, 1000]); // 0..19
  if (tail === "tiny") {
    rows.push([100.4, 100.6, 100.4, 100.55, 1000]);   // 20 — micro imbalance candle
    rows.push([100.55, 100.8, 100.55, 100.7, 1000]);  // 21 — gap of only 0.05
    for (let i = 22; i <= 29; i++) rows.push([100.7, 100.9, 100.6, 100.8, 1000]);
    return mkBars(rows);
  }
  rows.push([100.2, 103.6, 100.1, 103.5, 3000]); // 20 — imbalance candle
  rows.push([103.5, 104.2, 103.0, 104.0, 2000]); // 21 — gap closes here
  for (let i = 22; i <= 29; i++) {
    if (tail === "half" && i === 25) rows.push([103.3, 103.6, 101.75, 103.4, 1000]);       // fills 50%
    else if (tail === "invert" && i === 25) rows.push([100.3, 100.4, 99.5, 100.0, 1000]);  // body below the gap
    else if (tail === "invert" && i > 25) rows.push([100.0, 100.2, 99.6, 99.8, 1000]);     // stays below
    else rows.push([103.6, 104.0, 103.2, 103.8, 1000]);
  }
  return mkBars(rows);
}

const fvgZones = (prims: Prim[]) => prims.filter((p) => p.kind === "zone" && /-z$/.test(p.id)) as any[];

describe("fvg", () => {
  it("anchors the zone at [high[j-2], low[j]] on the imbalance candle", () => {
    const { prims, events } = run(FVG_MODULE, fvgBars("clean"));
    const created = (events ?? []).filter((e) => e.type === "fvg_created");
    expect(created.length).toBe(1);
    expect(created[0].dir).toBe("bull");
    expect(created[0].i).toBe(21);

    const zones = fvgZones(prims);
    expect(zones.length).toBe(1);
    expect(zones[0].i1).toBe(20); // anchored at the middle (imbalance) candle
    expect(zones[0].p1).toBeCloseTo(100.5, 9);
    expect(zones[0].p2).toBeCloseTo(103.0, 9);
    expect(zones[0].fill).toBe(COLORS.up);
  });

  it("tracks the fill watermark: a bar covering half the gap reads 50% filled", () => {
    const { prims, tooltips } = run(FVG_MODULE, fvgBars("half"));
    const tip = (tooltips ?? []).find((t) => /^fvg-b21$/.test(t.id));
    expect(tip).toBeDefined();
    const filledRow = tip!.rows.find((r) => r.k === "Filled");
    expect(filledRow).toBeDefined();
    const frac = parseFloat(filledRow!.v) / 100;
    expect(frac).toBeGreaterThan(0.49);
    expect(frac).toBeLessThan(0.51);

    const chip = prims.find((p) => p.id === "fvg-b21-fc") as any;
    expect(chip?.text).toBe("50% filled");
    const sub = prims.find((p) => p.id === "fvg-b21-f") as any; // partial-fill sub-zone
    expect(sub?.kind).toBe("zone");
    expect(sub.p1).toBeCloseTo(101.75, 9); // watermark
    expect(sub.p2).toBeCloseTo(103.0, 9);  // far edge
  });

  it("flips to an iFVG when a full body closes through the far edge", () => {
    const { prims, events } = run(FVG_MODULE, fvgBars("invert"));
    const inv = (events ?? []).filter((e) => e.type === "ifvg");
    expect(inv.length).toBe(1);
    expect(inv[0].dir).toBe("bear"); // a bullish gap inverts bearish
    expect(inv[0].i).toBe(25);

    const lab = prims.find((p) => p.id === "fvg-b21-inv") as any;
    expect(lab?.text).toBe("iFVG");
    const zone = fvgZones(prims).find((z) => z.id === "fvg-b21-z");
    expect(zone.fill).toBe(COLORS.down); // role-flipped
    expect(zone.dash).toBe("4 3");
  });

  it("deletes rather than flips the zone when iFvg is off", () => {
    const { prims, events } = run(FVG_MODULE, fvgBars("invert"), { iFvg: false });
    expect((events ?? []).some((e) => e.type === "ifvg")).toBe(false);
    expect(fvgZones(prims).some((z) => z.id === "fvg-b21-z")).toBe(false);
  });

  it("filters a sub-threshold gap and keeps it once the threshold is removed", () => {
    const bars = fvgBars("tiny");
    const gated = run(FVG_MODULE, bars, { thresholdATR: 0.25 });
    expect((gated.events ?? []).filter((e) => e.type === "fvg_created").length).toBe(0);
    expect(fvgZones(gated.prims).length).toBe(0);

    const open = run(FVG_MODULE, bars, { thresholdATR: 0 });
    const created = (open.events ?? []).filter((e) => e.type === "fvg_created");
    expect(created.length).toBeGreaterThan(0);
    expect(created[0].i).toBe(21);
  });

  it("is deterministic across repeated computes", () => {
    const bars = fvgBars("half");
    expect(run(FVG_MODULE, bars)).toEqual(run(FVG_MODULE, bars));
  });
});

// ─── 5. premiumDiscount ───────────────────────────────────────────────────────

/**
 * One clean dealing range, hand-built for exact fib arithmetic.
 *   pivot low  @4  = 100 (wings of 3, confirmed on bar 7)
 *   pivot high @12 = 200 (wings of 3, confirmed on bar 15)
 * -> range [100, 200], span 100, uptrend (the high is the newer pivot), startBar 12,
 *    activeFrom 15. Premium >= 170, discount <= 130, EQ 150,
 *    0.618 -> 138.2, 0.650 -> 135, 0.786 -> 121.4 (measured DOWN from the high).
 * The tail descends monotonically (no further pivots) through premium, the pocket and discount.
 */
const PD_ROWS: Array<[number, number, number]> = [
  [160, 150, 155], [155, 145, 150], [150, 140, 145], [145, 130, 140], [140, 100, 120],
  [145, 120, 130], [150, 130, 140], [155, 140, 150], [160, 150, 155], [170, 155, 165],
  [180, 160, 170], [190, 170, 180], [200, 180, 190], [195, 175, 185], [190, 170, 180],
  [185, 165, 175], [180, 160, 170], [175, 155, 165], [170, 150, 160], [165, 145, 155],
  [160, 140, 150], [155, 135, 145], [150, 130, 140], [145, 125, 135], [140, 120, 130],
  [135, 115, 125], [130, 110, 120], [125, 105, 115],
];
/** Same geometry mirrored about 150: pivot HIGH @4, pivot LOW @12 -> the same range, downtrend. */
const PD_ROWS_DOWN: Array<[number, number, number]> = PD_ROWS.map(([h, l, c]) => [300 - l, 300 - h, 300 - c]);

const PD_S = { rangeLen: 3 };

describe("premiumDiscount — range geometry", () => {
  it("stripes the upper and lower 30% of the last confirmed swing pair", () => {
    const res = run(PREMIUM_DISCOUNT_MODULE, hlcBars(PD_ROWS), PD_S);
    const prem = primOf(res, "pd-12-prem");
    const disc = primOf(res, "pd-12-disc");
    expect(prem.kind).toBe("zone");
    expect(prem.i1).toBe(12);       // the newer pivot's bar is the range's left edge
    expect(prem.i2).toBe("right");
    expect(prem.p1).toBeCloseTo(170, 9); // hi - 0.30 * span
    expect(prem.p2).toBeCloseTo(200, 9);
    expect(prem.fill).toBe(COLORS.down);
    expect(disc.p1).toBeCloseTo(100, 9);
    expect(disc.p2).toBeCloseTo(130, 9); // lo + 0.30 * span
    expect(disc.fill).toBe(COLORS.up);
  });

  it("prices 0.618 / 0.650 / 0.786 DOWN from the high in an uptrend", () => {
    const res = run(PREMIUM_DISCOUNT_MODULE, hlcBars(PD_ROWS), PD_S);
    const gp = primOf(res, "pd-12-gp");
    expect(gp.p1).toBeCloseTo(135, 9);    // 200 - 0.650 * 100
    expect(gp.p2).toBeCloseTo(138.2, 9);  // 200 - 0.618 * 100
    expect(gp.fill).toBe(COLORS.warn);
    expect(primOf(res, "pd-12-f786").a.p).toBeCloseTo(121.4, 9); // 200 - 0.786 * 100
    expect(primOf(res, "pd-12-eq").a.p).toBeCloseTo(150, 9);
    expect(primOf(res, "pd-12-l618").text).toBe("0.618 138.20");
    expect(primOf(res, "pd-12-l786").text).toBe("0.786 121.40");
    expect(primOf(res, "pd-12-leq").text).toBe("EQ 150.00");
  });

  it("measures the retracement UP from the low in a downtrend", () => {
    const res = run(PREMIUM_DISCOUNT_MODULE, hlcBars(PD_ROWS_DOWN), PD_S);
    const gp = primOf(res, "pd-12-gp");
    expect(gp.p1).toBeCloseTo(161.8, 9);  // 100 + 0.618 * 100
    expect(gp.p2).toBeCloseTo(165, 9);    // 100 + 0.650 * 100
    expect(primOf(res, "pd-12-f786").a.p).toBeCloseTo(178.6, 9);
    // the stripes are orientation-independent — only the fib anchor flips
    expect(primOf(res, "pd-12-prem").p1).toBeCloseTo(170, 9);
    expect(primOf(res, "pd-12-disc").p2).toBeCloseTo(130, 9);
    const tip = (res.tooltips ?? [])[0];
    expect(tip.rows.find((r) => r.k === "Trend")!.v).toBe("Down");
    expect(tip.rows.find((r) => r.k === "Range")!.v).toBe("100.00 – 200.00");
  });
});

describe("premiumDiscount — events", () => {
  it("fires premium / golden-pocket / discount exactly once each, never before activeFrom", () => {
    const evs = run(PREMIUM_DISCOUNT_MODULE, hlcBars(PD_ROWS), PD_S).events ?? [];
    expect(evs.map((e) => [e.type, e.i, e.strength])).toEqual([
      // bars 13 (close 185) and 14 (close 180) are ALSO inside premium, but the range only
      // becomes knowable on bar 15 = confirmedAt of the pivot that completed it.
      ["pd_enter_premium", 15, 75],   // (175 - 100) / 100
      ["pd_golden_touch", 21, 73],    // close 145 sits 6.8 above the pocket: 100 - 6.8/100*400
      ["pd_enter_discount", 24, 70],  // close 130 -> 30% of range -> 100 - 30
    ]);
    expect(evs[0].dir).toBe("bear");
    expect(evs[2].dir).toBe("bull");
  });

  it("mirrors the event tape on the mirrored range", () => {
    const evs = run(PREMIUM_DISCOUNT_MODULE, hlcBars(PD_ROWS_DOWN), PD_S).events ?? [];
    expect(evs.map((e) => [e.type, e.i, e.strength])).toEqual([
      ["pd_enter_discount", 15, 75],
      ["pd_golden_touch", 21, 73],
      ["pd_enter_premium", 24, 70],
    ]);
  });

  it("drops fib + equilibrium geometry (and the tooltip) when those toggles are off", () => {
    const res = run(PREMIUM_DISCOUNT_MODULE, hlcBars(PD_ROWS), {
      ...PD_S, showFib: false, equilibrium: false,
    });
    expect(res.prims.map((p) => p.id)).toEqual(["pd-12-prem", "pd-12-disc", "pd-12-cprem", "pd-12-cdisc"]);
    expect(res.tooltips).toEqual([]);
  });

  it("returns nothing before a range can be confirmed", () => {
    const res = run(PREMIUM_DISCOUNT_MODULE, hlcBars(PD_ROWS).slice(0, 7), PD_S);
    expect(res.prims).toEqual([]);
    expect(res.events).toEqual([]);
  });

  it("is deterministic across repeated computes", () => {
    const bars = hlcBars(PD_ROWS);
    expect(run(PREMIUM_DISCOUNT_MODULE, bars, PD_S)).toEqual(run(PREMIUM_DISCOUNT_MODULE, bars, PD_S));
  });
});

// ─── 6. liquidity ─────────────────────────────────────────────────────────────

/**
 * TR == 2 everywhere (ATR == 2), so tolerance 0.25 -> 0.5 and grabSens 0.5 -> 1.0 exactly.
 *   pivot high @10 = 107.0 (confirmed 20) and @31 = 107.4 (confirmed 41)  -> 0.4 apart -> cluster
 *   pivot low  @20 =  95.0 (confirmed 30) and @41 =  95.4 (confirmed 51)  -> 0.4 apart -> cluster
 *   bar 52 wicks to 108.0 (= level + 1.0 = grabSens x ATR) and closes at 107 -> buyside grab
 */
const LIQ_LEVELS = [
  95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105,
  104, 103, 102, 101, 100, 99, 98, 97, 96, 95,
  95.4, 96.4, 97.4, 98.4, 99.4, 100.4, 101.4, 102.4, 103.4, 104.4, 105.4,
  104.4, 103.4, 102.4, 101.4, 100.4, 99.4, 98.4, 97.4, 96.4, 95.4,
  96.4, 97.4, 98.4, 99.4, 100.4, 101.4, 102.4, 103.4, 104.4, 105.4,
  106,
  105, 104, 103, 102, 101, 100, 99, 98,
];
const liqBars = () => levelBars(LIQ_LEVELS);

/** Eight descending double-tops: eight equal-high pools that later price never closes back above. */
function liqStaircase(): SuiteBar[] {
  const peaks = [200, 180, 160, 140, 120, 100, 80, 60];
  const Ls: number[] = [peaks[0] - 12];
  for (let k = 0; k < peaks.length; k++) {
    const p = peaks[k];
    const t = p - 12;
    const tNext = k + 1 < peaks.length ? peaks[k + 1] - 12 : t;
    Ls.push(...ramp(t, p, 11), ...ramp(p, t, 11), ...ramp(t, p, 11), ...ramp(p, tNext, 11));
  }
  return levelBars(Ls);
}

const liqLines = (res: ModuleResult) => res.prims.filter((p) => /^liq-[hl]\d+-l$/.test(p.id)) as any[];

describe("liquidity — clustering", () => {
  it("freezes the pool at the FIRST pivot of the cluster and counts the touches", () => {
    const res = run(LIQUIDITY_MODULE, liqBars());
    const line = primOf(res, "liq-h10-l");
    expect(line.a.i).toBe(10);            // anchored at the first pivot, not the newest
    expect(line.a.p).toBeCloseTo(107, 9); // level FROZEN at 107 — never the 107.2 mean
    expect(primOf(res, "liq-h10-c").text).toBe("EQH ×2");

    const created = evOf(res, "liq_created");
    expect(created.map((e) => [e.dir, e.i, e.p, e.strength])).toEqual([
      ["bear", 41, 107, 50],  // published on the CONFIRM bar of the second pivot (31 + 10)
      ["bull", 51, 95, 50],
    ]);
    expect(primOf(res, "liq-l20-l").a.p).toBeCloseTo(95, 9);
    expect(primOf(res, "liq-l20-c").text).toBe("EQL ×2");
  });

  it("refuses to cluster pivots further apart than tolerance x ATR", () => {
    // 0.4 apart, ATR 2: tolerance 0.25 -> 0.50 clusters; 0.15 -> 0.30 does not.
    const wide = run(LIQUIDITY_MODULE, liqBars(), { tolerance: 0.15 });
    expect(evOf(wide, "liq_created")).toEqual([]);
    expect(liqLines(wide)).toEqual([]);
    expect(evOf(run(LIQUIDITY_MODULE, liqBars(), { tolerance: 0.25 }), "liq_created").length).toBe(2);
  });
});

describe("liquidity — grabs", () => {
  it("sweeps the pool when a wick clears it by grabSens x ATR and closes back inside", () => {
    const res = run(LIQUIDITY_MODULE, liqBars());
    const grabs = evOf(res, "liq_grab");
    expect(grabs.length).toBe(1);
    expect(grabs[0].i).toBe(52);
    expect(grabs[0].dir).toBe("bear"); // buyside liquidity taken
    expect(grabs[0].p).toBeCloseTo(107, 9);
    expect(grabs[0].strength).toBe(17); // (108 - 107) / 2 = 0.50x ATR -> round(0.5 * 33)
    expect(grabs[0].label).toContain("0.50× ATR");

    const line = primOf(res, "liq-h10-l");
    expect(line.b.i).toBe(52);          // a swept line stops at the sweeping wick
    expect(line.dash).toBe("4 3");
    expect(line.alpha).toBeCloseTo(0.3, 9);
    const mark = primOf(res, "liq-h10-g");
    expect(mark.shape).toBe("tri-down");
    expect(mark.i).toBe(52);
    expect(mark.p).toBeCloseTo(108.7, 9); // wick tip + 0.35 x ATR
    expect(mark.fill).toBe(COLORS.down);
  });

  it("leaves the pool resting and edge-anchored when grabs are off", () => {
    const res = run(LIQUIDITY_MODULE, liqBars(), { grabs: false });
    expect(evOf(res, "liq_grab")).toEqual([]);
    const line = primOf(res, "liq-h10-l");
    expect(line.b.i).toBe("right");
    expect(line.dash).toBeUndefined();
  });

  it("circles each confirmed pivot when bubbles are on", () => {
    const res = run(LIQUIDITY_MODULE, liqBars(), { bubbles: true });
    const bubbles = res.prims.filter((p) => p.id.startsWith("liqb-")) as any[];
    expect(bubbles.map((b) => [b.id, b.i, b.shape])).toEqual([
      ["liqb-h10", 10, "circle"], ["liqb-l20", 20, "circle"],
      ["liqb-h31", 31, "circle"], ["liqb-l41", 41, "circle"],
    ]);
    expect(bubbles.every((b) => b.size === 8)).toBe(true); // flat volume -> top percentile
    expect(run(LIQUIDITY_MODULE, liqBars()).prims.some((p) => p.id.startsWith("liqb-"))).toBe(false);
  });
});

describe("liquidity — caps", () => {
  const STAIRS = liqStaircase();

  it("tracks at most maxLines pools at once and draws at most showLast", () => {
    // 15 pools are detected over the fixture; 9 are still alive at the last bar.
    expect(evOf(run(LIQUIDITY_MODULE, STAIRS, { maxLines: 20, showLast: 24 }), "liq_created").length).toBe(15);
    for (const maxLines of [4, 6, 10, 20]) {
      const n = liqLines(run(LIQUIDITY_MODULE, STAIRS, { maxLines, showLast: 24 })).length;
      expect(n, `maxLines=${maxLines}`).toBeLessThanOrEqual(maxLines);
      expect(n, `maxLines=${maxLines} drew nothing`).toBeGreaterThan(0);
    }
    expect(liqLines(run(LIQUIDITY_MODULE, STAIRS, { maxLines: 4, showLast: 24 })).length).toBe(4);
    for (const showLast of [4, 8, 24]) {
      const res = run(LIQUIDITY_MODULE, STAIRS, { maxLines: 20, showLast });
      expect(liqLines(res).length).toBeLessThanOrEqual(showLast);
      expect(res.prims.length).toBeLessThanOrEqual(showLast * 3);
    }
  });

  it("is deterministic across repeated computes", () => {
    expect(run(LIQUIDITY_MODULE, STAIRS)).toEqual(run(LIQUIDITY_MODULE, STAIRS));
  });
});

// ─── 7. sfp ───────────────────────────────────────────────────────────────────

/**
 * Pivot low @6 = 90 with wings of 5 -> confirmed on bar 11. Bar 13 sweeps it.
 * Volumes are flat 1000 with 1500 on the sweep bar, so the volume percentile is exactly 100
 * (13 usable trailing bars, all below) and Volume Strength = 0.7 x 100 + 0.3 x speed.
 */
const SFP_BASE: Array<[number, number, number]> = [
  [110, 105, 108], [108, 103, 105], [106, 100, 102], [104, 98, 100], [102, 96, 98],
  [100, 94, 96], [98, 90, 95], [100, 93, 97], [102, 95, 99], [104, 97, 101],
  [106, 99, 103], [108, 101, 105], [107, 100, 103],
];
const SFP_QUIET: Array<[number, number, number]> = Array.from({ length: 8 }, () => [104, 96, 100] as [number, number, number]);
const SFP_VOLS = (() => { const v = new Array(40).fill(1000); v[13] = 1500; return v; })();
const sfpBars = (tail: Array<[number, number, number]>) => hlcBars([...SFP_BASE, ...tail], SFP_VOLS);

const SFP_S = { swingLen: 5 };

describe("sfp — reclaim semantics", () => {
  it("records a same-bar reclaim on the sweep bar with full speed credit", () => {
    const res = run(SFP_MODULE, sfpBars([[104, 89, 95], ...SFP_QUIET]), SFP_S);
    const evs = evOf(res, "sfp");
    expect(evs.length).toBe(1);
    expect(evs[0].dir).toBe("bull");
    expect(evs[0].i).toBe(13);            // the reclaim bar, not the pivot bar
    expect(evs[0].p).toBeCloseTo(90, 9);
    expect(evs[0].strength).toBe(100);    // 0.7 * 100 percentile + 0.3 * 100 same-bar speed

    const line = primOf(res, "sfp-b13-l");
    expect([line.a.i, line.b.i]).toEqual([6, 13]); // origin swing -> sweep bar
    expect(line.a.p).toBeCloseTo(90, 9);
    const zone = primOf(res, "sfp-b13-z");
    expect(zone.p1).toBeCloseTo(89, 9);   // sweep extreme
    expect(zone.p2).toBeCloseTo(90, 9);   // swept level
    expect(zone.i1).toBe(13);
    expect(zone.i2).toBe(25);             // 12 bars wide — never "right"
    const mark = primOf(res, "sfp-b13-m");
    expect(mark.shape).toBe("tri-up");
    expect(mark.p).toBeLessThan(89);      // stands off BELOW the wick tip
    expect(primOf(res, "sfp-b13-t").text).toBe("+SFP");
    const tip = (res.tooltips ?? [])[0];
    expect(tip.rows.find((r) => r.k === "Reclaim")!.v).toBe("Same bar");
  });

  it("scores a next-bar reclaim lower and dates it on the reclaim bar", () => {
    const res = run(SFP_MODULE, sfpBars([[104, 89, 89.5], [100, 92, 95], ...SFP_QUIET]), SFP_S);
    const evs = evOf(res, "sfp");
    expect(evs.length).toBe(1);
    expect(evs[0].i).toBe(14);            // reclaim bar
    expect(evs[0].strength).toBe(88);     // 0.7 * 100 + 0.3 * 60 next-bar speed
    expect((res.tooltips ?? [])[0].rows.find((r) => r.k === "Reclaim")!.v).toBe("Next bar");
    // the pattern is unknown until the reclaim CLOSES: truncating at the sweep bar prints nothing
    const upTo13 = run(SFP_MODULE, sfpBars([[104, 89, 89.5]]), SFP_S);
    expect(evOf(upTo13, "sfp")).toEqual([]);
    expect(upTo13.prims).toEqual([]);
  });

  it("never fires before the swept swing's confirmation bar", () => {
    const bars = sfpBars([[104, 89, 95], ...SFP_QUIET]);
    const pivot = findPivotsHL(bars, 5, 5, "wick").find((p) => p.kind === "low" && p.i === 6)!;
    expect(pivot.confirmedAt).toBe(11);
    for (const e of evOf(run(SFP_MODULE, bars, SFP_S), "sfp")) {
      expect(e.i).toBeGreaterThan(pivot.confirmedAt);
    }
  });

  it("spends the level when the close never reclaims it", () => {
    const res = run(SFP_MODULE, sfpBars([[104, 89, 89.5], [100, 88, 88], [100, 94, 95], ...SFP_QUIET]), SFP_S);
    expect(res.events).toEqual([]); // the break is real: no retro-fire when price comes back
    expect(res.prims).toEqual([]);
  });
});

describe("sfp — invalidation, threshold, filters", () => {
  const INVAL = sfpBars([
    [104, 89, 95], [104, 96, 100], [104, 96, 100], [104, 96, 100], [104, 96, 100],
    [100, 84, 85], [104, 96, 100], [104, 96, 100],
  ]);

  it("invalidates on a close through the sweep extreme and drops the mark by default", () => {
    const res = run(SFP_MODULE, INVAL, SFP_S);
    expect((res.events ?? []).map((e) => [e.type, e.dir, e.i])).toEqual([
      ["sfp", "bull", 13],
      ["sfp_invalidated", "bear", 18], // close 85 < sweep extreme 89
    ]);
    expect(res.prims).toEqual([]);
    expect(res.tooltips).toEqual([]);

    const kept = run(SFP_MODULE, INVAL, { ...SFP_S, showInvalid: true });
    expect(kept.prims.map((p) => p.id)).toEqual(["sfp-b13-l", "sfp-b13-b", "sfp-b13-m", "sfp-b13-t"]);
    expect(primOf(kept, "sfp-b13-l").color).toBe(COLORS.muted);
    expect(primOf(kept, "sfp-b13-l").dash).toBe("4 3");
    expect(primOf(kept, "sfp-b13-t").text).toBe("SFP"); // loses the "+" tier
    expect(kept.prims.some((p) => p.id === "sfp-b13-z")).toBe(false); // no deviation zone
  });

  it("hides sweeps below the Volume Strength threshold without un-spending the level", () => {
    const same = sfpBars([[104, 89, 95], ...SFP_QUIET]);
    const next = sfpBars([[104, 89, 89.5], [100, 92, 95], ...SFP_QUIET]);
    expect(evOf(run(SFP_MODULE, same, { ...SFP_S, threshold: 95 }), "sfp").length).toBe(1); // 100
    expect(evOf(run(SFP_MODULE, next, { ...SFP_S, threshold: 95 }), "sfp").length).toBe(0); // 88
    expect(run(SFP_MODULE, next, { ...SFP_S, threshold: 95 }).prims).toEqual([]);
  });

  it("partitions — never invents — detections under the trend filter", () => {
    const bars = walkBars(400, 4242, 31);
    const key = (e: SuiteEvent) => `${e.i}|${e.p}`;
    const all = new Set(evOf(run(SFP_MODULE, bars), "sfp").map(key));
    const withT = evOf(run(SFP_MODULE, bars, { filter: "withTrend" }), "sfp").map(key);
    const counter = evOf(run(SFP_MODULE, bars, { filter: "counterTrend" }), "sfp").map(key);
    expect(all.size).toBeGreaterThan(0);
    expect(withT.every((k) => all.has(k))).toBe(true);
    expect(counter.every((k) => all.has(k))).toBe(true);
    expect(withT.filter((k) => counter.includes(k))).toEqual([]);
  });

  it("keeps settled events identical when 50 future bars are appended", () => {
    const full = walkBars(400, 4242, 31);
    const short = full.slice(0, 350);
    const key = (e: SuiteEvent) => `${e.type}|${e.dir}|${e.i}|${e.p}|${e.strength}`;
    const a = (run(SFP_MODULE, short).events ?? []).filter((e) => e.i <= 330).map(key);
    const b = (run(SFP_MODULE, full).events ?? []).filter((e) => e.i <= 330).map(key);
    expect(a.length).toBeGreaterThan(0);
    expect(b).toEqual(a);
  });
});

// ─── 8. trendEngine ───────────────────────────────────────────────────────────

/**
 * TR == 2 (ATR == 2) with sensitivity 1 -> mult 1.48, so the trailing stop is hl2 -/+ 2.96 and
 * every flip is hand-computable:
 *   up leg 100..110 (bars 0..10), down leg 109..100 (11..20), up leg 101..110 (21..30).
 *   bar 13 (close 108) is the first close under the ratcheted stop 108.04 -> SELL flip.
 *   bar 23 (close 104) is the first close over the ratcheted stop 103.96 -> BUY flip.
 */
const TE_LEVELS = [
  100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110,
  109, 108, 107, 106, 105, 104, 103, 102, 101, 100,
  101, 102, 103, 104, 105, 106, 107, 108, 109, 110,
];
const TE_S = { sensitivity: 1 };

describe("trendEngine — flip engine", () => {
  it("flips only when a close breaks the ratcheted ATR stop", () => {
    const res = run(TREND_ENGINE_MODULE, levelBars(TE_LEVELS), TE_S);
    const flips = evOf(res, "te_flip");
    expect(flips.map((e) => [e.dir, e.i, e.p])).toEqual([
      ["bear", 13, 108],
      ["bull", 23, 104],
    ]);
    // one marker + one pill per flip, both anchored on the flip bar
    expect(primOf(res, "te-f13-m").shape).toBe("tri-down");
    expect(primOf(res, "te-f23-m").shape).toBe("tri-up");
    expect(primOf(res, "te-f13-p").text.startsWith("SELL")).toBe(true);
    expect(primOf(res, "te-f23-p").text.startsWith("BUY")).toBe(true);
    expect(primOf(res, "te-f13-p").bg).toBe(COLORS.down);
    expect(primOf(res, "te-f23-p").bg).toBe(COLORS.up);
  });

  it("walks the dynamic TP ladder at k x ATR from the entry", () => {
    const res = run(TREND_ENGINE_MODULE, levelBars(TE_LEVELS), { ...TE_S, tpMode: "dynamic", tpCount: 3 });
    // short from 108 with ATR 2: TP1 105, TP2 103, TP3 101 — first touched at bars 15/17/19.
    expect(evOf(res, "te_tp_hit").map((e) => [e.i, e.p, e.label])).toEqual([
      [15, 105, "TP1"], [17, 103, "TP2"], [19, 101, "TP3"],
      // long from 104: TP1 107, TP2 109, TP3 111 — first touched at bars 25/27/29.
      [25, 107, "TP1"], [27, 109, "TP2"], [29, 111, "TP3"],
    ]);
    expect(primOf(res, "te-tpc13-0").text).toBe("TP1 ✓");
    expect(primOf(res, "te-tp13-0").b.i).toBe(15); // the line stops at the touch
  });

  it("never loosens the stop inside a regime", () => {
    const res = run(TREND_ENGINE_MODULE, walkBars(600, 77, 29), { sensitivity: 4 });
    const bands = res.prims.filter((p) => p.id.startsWith("te-band")) as any[];
    expect(bands.length).toBeGreaterThan(2);
    for (const band of bands) {
      const rising = band.colors[0] === COLORS.up;
      for (let k = 1; k < band.pts.length; k++) {
        if (rising) expect(band.pts[k].p).toBeGreaterThanOrEqual(band.pts[k - 1].p - 1e-9);
        else expect(band.pts[k].p).toBeLessThanOrEqual(band.pts[k - 1].p + 1e-9);
      }
    }
  });
});

describe("trendEngine — non-repaint", () => {
  const key = (e: SuiteEvent) => `${e.type}|${e.dir}|${e.i}|${e.p}|${e.strength}`;

  it("keeps every settled event identical when 40 future bars are appended (autoOpt off)", () => {
    const full = walkBars(340, 991);
    const short = full.slice(0, 300);
    const cut = 300 - 30;
    for (const opt of [{}, { showLast: 6 }, { showLast: 6, tpMode: "fixed", slMode: "fixed" }]) {
      const a = (run(TREND_ENGINE_MODULE, short, opt).events ?? []).filter((e) => e.i <= cut).map(key);
      const b = (run(TREND_ENGINE_MODULE, full, opt).events ?? []).filter((e) => e.i <= cut).map(key);
      expect(a.length, `${JSON.stringify(opt)}: nothing settled`).toBeGreaterThan(10);
      expect(a.some((k) => k.startsWith("te_flip"))).toBe(true);
      expect(b, `${JSON.stringify(opt)}`).toEqual(a);
    }
  });

  it("keeps TP hits on episodes that have scrolled out of the drawn window", () => {
    // the drawn ladder is capped by showLast; the event TAPE is not (the W2 alert bridge reads it)
    const bars = walkBars(340, 991);
    const one = run(TREND_ENGINE_MODULE, bars, { showLast: 1 });
    const six = run(TREND_ENGINE_MODULE, bars, { showLast: 6 });
    expect(one.events).toEqual(six.events);
    expect(one.prims.length).toBeLessThan(six.prims.length);
  });

  it("is deterministic across repeated computes", () => {
    const bars = walkBars(400, 4242, 31);
    expect(run(TREND_ENGINE_MODULE, bars)).toEqual(run(TREND_ENGINE_MODULE, bars));
  });
});

// ─── 9. voltixBands ───────────────────────────────────────────────────────────

/** 40 quiet bars, one 120-wide shock bar, then 40 quiet bars again. */
function vbShockBars(): SuiteBar[] {
  const out: SuiteBar[] = [];
  for (let i = 0; i < 40; i++) out.push({ t: 86400 * (i + 1), o: 100, h: 101, l: 99, c: 100, v: 1000 });
  out.push({ t: 86400 * 41, o: 100, h: 160, l: 40, c: 100, v: 5000 });
  for (let i = 0; i < 40; i++) out.push({ t: 86400 * (42 + i), o: 100, h: 101, l: 99, c: 100, v: 1000 });
  return out;
}

/** half-widths of the rendered envelope, indexed by bar. */
function vbHalves(res: ModuleResult): Array<{ i: number; h: number }> {
  const up = res.prims.find((p) => p.id === "vb-upper") as any;
  const lo = res.prims.find((p) => p.id === "vb-lower") as any;
  return up.pts.map((q: any, k: number) => ({ i: q.i, h: (q.p - lo.pts[k].p) / 2 }));
}

describe("voltixBands — expansion memory", () => {
  it("inflates at once on a volatility burst and then deflates at exactly 3% per bar", () => {
    const res = run(VOLT_BANDS_MODULE, vbShockBars(), { length: 10, mult: 2 });
    const halves = vbHalves(res);
    const shock = halves.findIndex((x) => x.i === 40);
    expect(shock).toBeGreaterThan(0);
    expect(halves[shock].h / halves[shock - 1].h).toBeGreaterThan(3); // instant expansion
    for (let k = shock + 1; k < shock + 20; k++) {
      // raw ATR collapses far faster than the floor, so the memory floor binds exactly
      expect(halves[k].h / halves[k - 1].h, `bar ${halves[k].i}`).toBeCloseTo(0.97, 10);
    }
  });

  it("never deflates faster than 3% per bar on a noisy series", () => {
    for (const mult of [1, 2.2, 4]) {
      const halves = vbHalves(run(VOLT_BANDS_MODULE, walkBars(600, 77, 29), { mult }));
      expect(halves.length).toBeGreaterThan(100);
      for (let k = 1; k < halves.length; k++) {
        expect(halves[k].h / halves[k - 1].h, `mult=${mult} bar ${halves[k].i}`).toBeGreaterThanOrEqual(0.97 - 1e-9);
      }
    }
  });

  it("keeps the rails symmetric about the midline", () => {
    const res = run(VOLT_BANDS_MODULE, walkBars(400, 4242, 31));
    const up = res.prims.find((p) => p.id === "vb-upper") as any;
    const lo = res.prims.find((p) => p.id === "vb-lower") as any;
    const mid = new Map<number, number>();
    for (const p of res.prims.filter((x) => x.id === "vb-mid" || x.id.startsWith("vb-mid-")) as any[]) {
      for (const q of p.pts) mid.set(q.i, q.p);
    }
    expect(mid.size).toBeGreaterThan(100);
    let checked = 0;
    up.pts.forEach((q: any, k: number) => {
      const m = mid.get(q.i);
      if (m === undefined) return;
      expect((q.p + lo.pts[k].p) / 2).toBeCloseTo(m, 9);
      checked++;
    });
    expect(checked).toBeGreaterThan(100);
  });
});

describe("voltixBands — excursions", () => {
  it("pairs every re-entry with a preceding break of the opposite implication", () => {
    const res = run(VOLT_BANDS_MODULE, walkBars(600, 77, 29));
    const evs = (res.events ?? []).filter((e) => e.type === "vb_break" || e.type === "vb_retest");
    expect(evs.filter((e) => e.type === "vb_retest").length).toBeGreaterThan(3);
    let open: SuiteEvent | null = null;
    for (const e of evs) {
      if (e.type === "vb_break") {
        expect(open, "two breaks without a re-entry between them").toBeNull();
        open = e;
      } else {
        expect(open, "re-entry without a break").not.toBeNull();
        expect(e.dir).not.toBe(open!.dir); // a fade of the excursion
        expect(e.i).toBeGreaterThan(open!.i);
        open = null;
      }
    }
  });

  it("draws one warn triangle per kept re-entry, pointing back at the band", () => {
    const bars = walkBars(600, 77, 29);
    for (const showLast of [2, 5, 20]) {
      const res = run(VOLT_BANDS_MODULE, bars, { showLast });
      const marks = res.prims.filter((p) => p.kind === "marker") as any[];
      const retests = evOf(res, "vb_retest");
      expect(marks.length).toBe(Math.min(showLast, retests.length));
      for (const m of marks) {
        expect(m.fill).toBe(COLORS.warn);
        const ev = retests.find((e) => e.i === m.i)!;
        expect(ev, `no retest event for marker at ${m.i}`).toBeDefined();
        expect(m.shape).toBe(ev.dir === "bull" ? "tri-up" : "tri-down");
      }
    }
  });

  it("is deterministic across repeated computes", () => {
    const bars = walkBars(400, 4242, 31);
    expect(run(VOLT_BANDS_MODULE, bars)).toEqual(run(VOLT_BANDS_MODULE, bars));
  });
});

// ─── 10. candlePainter ────────────────────────────────────────────────────────

describe("candlePainter", () => {
  const RISE = pathBars(Array.from({ length: 80 }, (_, i) => 100 + i));
  const FALL = pathBars(Array.from({ length: 80 }, (_, i) => 200 - i));

  it("paints every bar exactly once and draws nothing else", () => {
    for (const mode of ["trend", "momentum", "trendVolume", "momentumVolume"]) {
      const res = run(CANDLE_PAINTER_MODULE, RISE, { mode });
      expect(res.prims).toEqual([]);
      expect(res.tooltips).toBeUndefined();
      expect(res.events).toBeUndefined();
      expect(res.candlePaint!.length).toBe(RISE.length);
      res.candlePaint!.forEach((e, i) => expect(e.i).toBe(i));
    }
  });

  it("separates the trend and momentum modes", () => {
    const bars = walkBars(300, 5, 31);
    const hue = (mode: string) => run(CANDLE_PAINTER_MODULE, bars, { mode }).candlePaint!.map((e) => e.color).join(",");
    expect(hue("momentum")).not.toBe(hue("trend"));
    // momentum carries the "weakening" shade; trend has only up / down / muted
    const momentum = run(CANDLE_PAINTER_MODULE, bars, { mode: "momentum" }).candlePaint!;
    expect(momentum.some((e) => e.color === COLORS.warn)).toBe(true);
    const trend = run(CANDLE_PAINTER_MODULE, bars, { mode: "trend" }).candlePaint!;
    expect(trend.every((e) => [COLORS.up, COLORS.down, COLORS.muted].includes(e.color!))).toBe(true);
  });

  it("colours a clean trend and stays neutral through the warm-up", () => {
    for (const mode of ["trend", "momentum"]) {
      const up = run(CANDLE_PAINTER_MODULE, RISE, { mode }).candlePaint!;
      const down = run(CANDLE_PAINTER_MODULE, FALL, { mode }).candlePaint!;
      expect(up[79].color).toBe(COLORS.up);
      expect(down[79].color).toBe(COLORS.down);
      expect(up[0].color).toBe(COLORS.muted); // no average yet
      expect(up[0].borderColor).toBe(COLORS.muted);
      expect(up[0].wickColor).toBe(COLORS.muted);
    }
  });

  it("encodes volume intensity by how much of the candle the hue takes over", () => {
    // 40 alternating 500/1500 bars, then one median / one heavy / one light bar
    const rows: SuiteBar[] = [];
    for (let i = 0; i < 40; i++) {
      rows.push({ t: 86400 * (i + 1), o: 100, h: 101, l: 99, c: 100, v: i % 2 === 0 ? 500 : 1500 });
    }
    rows.push({ t: 1, o: 100, h: 101, l: 99, c: 100, v: 1000 }); // 40 — 50th pct  -> normal
    rows.push({ t: 2, o: 100, h: 101, l: 99, c: 100, v: 2000 }); // 41 — 100th pct -> high
    rows.push({ t: 3, o: 100, h: 101, l: 99, c: 100, v: 100 });  // 42 — 0th pct   -> low
    const paint = run(CANDLE_PAINTER_MODULE, rows, { mode: "momentumVolume" }).candlePaint!;

    expect(Object.keys(paint[40]).sort()).toEqual(["borderColor", "color", "i"]);      // body + border
    expect(Object.keys(paint[41]).sort()).toEqual(["borderColor", "color", "i", "wickColor"]);
    expect(Object.keys(paint[42]).sort()).toEqual(["borderColor", "i", "wickColor"]);  // outline only
    // the non-volume modes always paint all three
    const flat = run(CANDLE_PAINTER_MODULE, rows, { mode: "momentum" }).candlePaint!;
    for (const e of flat) expect(Object.keys(e).sort()).toEqual(["borderColor", "color", "i", "wickColor"]);
  });

  it("is deterministic and survives dirty bars", () => {
    const bars = dirtyBars();
    expect(run(CANDLE_PAINTER_MODULE, bars)).toEqual(run(CANDLE_PAINTER_MODULE, bars));
    const paint = run(CANDLE_PAINTER_MODULE, bars).candlePaint!;
    expect(paint.length).toBe(bars.length);
    expect(paint[120].color).toBe(COLORS.muted); // OHLC = 0 is MISSING, never a print
  });
});

// ─── 11. flowBand ─────────────────────────────────────────────────────────────

/** Naive O(n·len) weighted MA — the independent reference the module's rolling update is checked against. */
function wmaRef(src: number[], len: number): Array<number | null> {
  const out: Array<number | null> = new Array(src.length).fill(null);
  const denom = (len * (len + 1)) / 2;
  for (let i = len - 1; i < src.length; i++) {
    let s = 0;
    for (let k = 0; k < len; k++) s += src[i - len + 1 + k] * (k + 1);
    out[i] = s / denom;
  }
  return out;
}

/** HMA = WMA(2·WMA(n/2) − WMA(n), round(√n)), computed from the naive reference above. */
function hmaRef(src: number[], len: number): Array<number | null> {
  const half = Math.round(len / 2);
  const sq = Math.round(Math.sqrt(len));
  const w1 = wmaRef(src, half);
  const w2 = wmaRef(src, len);
  const raw: number[] = [];
  for (let i = len - 1; i < src.length; i++) raw.push(2 * (w1[i] as number) - (w2[i] as number));
  const w3 = wmaRef(raw, sq);
  const out: Array<number | null> = new Array(src.length).fill(null);
  for (let i = len - 1; i < src.length; i++) out[i] = w3[i - (len - 1)];
  return out;
}

const fbPts = (res: ModuleResult, id: string) => (res.prims.find((p) => p.id === id) as any)?.pts as Array<{ i: number; p: number }>;

describe("flowBand — midline", () => {
  it("matches an independent WMA-of-WMA Hull reference", () => {
    const bars = walkBars(400, 991);
    for (const length of [20, 50, 100]) {
      const mid = fbPts(run(FLOW_BAND_MODULE, bars, { length }), "fb:mid");
      const ref = hmaRef(bars.map((b) => b.c), length);
      expect(mid.length).toBeGreaterThan(100);
      for (const q of mid) {
        expect(ref[q.i], `length=${length} bar ${q.i} has no reference value`).not.toBeNull();
        expect(q.p, `length=${length} bar ${q.i}`).toBeCloseTo(ref[q.i] as number, 8);
      }
    }
  });

  it("centres the envelope on the midline and puts the bright edge on the far side of price", () => {
    const res = run(FLOW_BAND_MODULE, walkBars(400, 991));
    const mid = fbPts(res, "fb:mid");
    const edge = fbPts(res, "fb:edge");
    const cloud = res.prims.find((p) => p.id === "fb:cloud") as any;
    expect(cloud.upper.length).toBe(mid.length);
    for (let k = 0; k < mid.length; k++) {
      expect((cloud.upper[k].p + cloud.lower[k].p) / 2).toBeCloseTo(mid[k].p, 9);
      expect(cloud.upper[k].p).toBeGreaterThan(cloud.lower[k].p);
      // the edge rides the lower rail in an uptrend, the upper rail in a downtrend
      expect([cloud.upper[k].p, cloud.lower[k].p]).toContain(edge[k].p);
    }
  });
});

describe("flowBand — HTF resampling", () => {
  const FULL = walkBars(840, 991);

  it("never lets a group's value appear before that group's last source bar", () => {
    for (const [htf, f] of [["chart", 1], ["2x", 2], ["4x", 4]] as Array<[string, number]>) {
      const mid = fbPts(run(FLOW_BAND_MODULE, FULL, { htf }), "fb:mid");
      const byI = new Map(mid.map((q) => [q.i, q.p]));
      expect(mid.length).toBeGreaterThan(50);
      for (const q of mid) {
        const g = Math.floor((q.i + 1) / f) - 1;   // group whose value bar q.i carries
        expect((g + 1) * f - 1, `htf=${htf} bar ${q.i} peeks`).toBeLessThanOrEqual(q.i);
        const next = byI.get(q.i + 1);             // same group -> the value must repeat, not move
        if (next !== undefined && Math.floor((q.i + 2) / f) - 1 === g) expect(next).toBe(q.p);
      }
    }
  });

  it("is prefix-stable: appending 40 bars never moves an earlier value", () => {
    for (const htf of ["chart", "2x", "4x"]) {
      const a = fbPts(run(FLOW_BAND_MODULE, FULL.slice(0, 800), { htf }), "fb:mid");
      const b = new Map(fbPts(run(FLOW_BAND_MODULE, FULL, { htf }), "fb:mid").map((q) => [q.i, q.p]));
      let shared = 0;
      for (const q of a) {
        if (!b.has(q.i)) continue;
        expect(b.get(q.i), `htf=${htf} bar ${q.i}`).toBe(q.p);
        shared++;
      }
      expect(shared, `htf=${htf}`).toBeGreaterThan(50);
    }
  });
});

describe("flowBand — signals", () => {
  const BARS = walkBars(600, 77, 29);

  it("scores retests 0-100 and prints the score on the chip", () => {
    const res = run(FLOW_BAND_MODULE, BARS);
    const retests = evOf(res, "fb_retest");
    expect(retests.length).toBeGreaterThan(2);
    for (const e of retests) {
      expect(e.strength).toBeGreaterThanOrEqual(0);
      expect(e.strength).toBeLessThanOrEqual(100);
      const chip = primOf(res, `fb:r${e.i}:q`);
      if (chip) expect(chip.text).toBe(String(e.strength));
    }
  });

  it("caps retests per trend segment (forward, so a confirmed mark is never pruned)", () => {
    const res = run(FLOW_BAND_MODULE, BARS);
    const turns = evOf(res, "fb_turn").map((e) => e.i);
    const counts = new Map<number, number>();
    for (const e of evOf(res, "fb_retest")) {
      let seg = -1;
      for (const t of turns) if (t <= e.i) seg = t;
      counts.set(seg, (counts.get(seg) ?? 0) + 1);
    }
    for (const [seg, n] of counts) expect(n, `segment @${seg}`).toBeLessThanOrEqual(6);
  });

  it("windows the drawn markers by showLast without changing the tape", () => {
    const few = run(FLOW_BAND_MODULE, BARS, { showLast: 2 });
    const many = run(FLOW_BAND_MODULE, BARS, { showLast: 16 });
    expect(few.events).toEqual(many.events);
    expect(few.prims.length).toBeLessThan(many.prims.length);
    expect(run(FLOW_BAND_MODULE, BARS, { turnSignals: false, retestSignals: false }).prims
      .every((p) => p.id.startsWith("fb:"))).toBe(true);
  });

  it("is deterministic across repeated computes", () => {
    expect(run(FLOW_BAND_MODULE, BARS)).toEqual(run(FLOW_BAND_MODULE, BARS));
  });
});

// ─── 12. Contract hygiene ─────────────────────────────────────────────────────

const MODULES: SuiteModuleDef[] = [MARKET_STRUCTURE_MODULE, ORDER_BLOCKS_MODULE, FVG_MODULE];

/** Every W1 module. `cp` paints candles instead of drawing prims — see its own describe. */
const W1_MODULES: SuiteModuleDef[] = [
  PREMIUM_DISCOUNT_MODULE, LIQUIDITY_MODULE, SFP_MODULE,
  TREND_ENGINE_MODULE, VOLT_BANDS_MODULE, CANDLE_PAINTER_MODULE, FLOW_BAND_MODULE,
];
const ALL_MODULES: SuiteModuleDef[] = [...MODULES, ...W1_MODULES];

const SRC_FILES = [
  "structure/pivots.ts", "structure/marketStructure.ts", "structure/orderBlocks.ts", "structure/fvg.ts",
  "structure/premiumDiscount.ts", "structure/liquidity.ts", "structure/sfp.ts",
  "trend/trendEngine.ts", "trend/voltixBands.ts", "trend/candlePainter.ts", "trend/flowBand.ts",
];

function scanNumbers(v: any, path: string, out: string[]): void {
  if (typeof v === "number") {
    if (!Number.isFinite(v)) out.push(path);
    return;
  }
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) scanNumbers(v[i], `${path}[${i}]`, out);
    return;
  }
  if (v && typeof v === "object") for (const k of Object.keys(v)) scanNumbers(v[k], `${path}.${k}`, out);
}

/** Exercise every optional surface of every module on one noisy fixture. */
function allResults(): Array<{ mod: string; res: ModuleResult }> {
  const bars = walkBars(600, 77, 29);
  const out: Array<{ mod: string; res: ModuleResult }> = [];
  for (const lang of ["en", "zh"] as const) {
    out.push({
      mod: `ms/${lang}`,
      res: run(MARKET_STRUCTURE_MODULE, bars, {
        swingLen: 15, internalLen: 4, mapping: true, strongWeak: true, structCandles: true, showLast: 20,
      }, lang),
    });
    for (const method of ["volume", "priceAction", "peak"]) {
      out.push({ mod: `ob/${method}/${lang}`, res: run(ORDER_BLOCKS_MODULE, bars, { method, extendRight: false, sizeDetail: "large" }, lang) });
    }
    for (const extend of ["right", "limited"]) {
      out.push({ mod: `fvg/${extend}/${lang}`, res: run(FVG_MODULE, bars, { extend, signals: "both", showPoc: "mean", hideOverlap: false }, lang) });
    }
    // W1 — every optional surface on (cp draws no prims and is checked in its own describe)
    out.push({ mod: `pd/${lang}`, res: run(PREMIUM_DISCOUNT_MODULE, bars, { rangeLen: 4, showLast: 3 }, lang) });
    out.push({ mod: `liq/${lang}`, res: run(LIQUIDITY_MODULE, bars, { bubbles: true, showLast: 24, maxLines: 20 }, lang) });
    out.push({ mod: `sfp/${lang}`, res: run(SFP_MODULE, bars, { showInvalid: true, swingLen: 8, textSize: "large" }, lang) });
    out.push({ mod: `te/${lang}`, res: run(TREND_ENGINE_MODULE, bars, { shadow: true, slMode: "fixed", tpMode: "fixed", showLast: 4 }, lang) });
    out.push({ mod: `vb/${lang}`, res: run(VOLT_BANDS_MODULE, bars, { showLast: 20 }, lang) });
    for (const htf of ["chart", "2x"]) {
      out.push({ mod: `fb/${htf}/${lang}`, res: run(FLOW_BAND_MODULE, bars, { htf, showLast: 16 }, lang) });
    }
  }
  return out;
}

/** Colors may only ever be the token strings the host resolved — no hex, rgb() or CSS names. */
const COLOR_KEYS = ["color", "fill", "stroke", "bg", "accent", "borderColor", "wickColor", "overlayColor"];
function scanColors(v: any, path: string, out: string[]): void {
  if (Array.isArray(v)) {
    v.forEach((x, i) => scanColors(x, `${path}[${i}]`, out));
    return;
  }
  if (v && typeof v === "object") {
    for (const k of Object.keys(v)) scanColors(v[k], `${path}.${k}`, out);
    return;
  }
  if (typeof v !== "string") return;
  const leaf = (path.split(".").pop() ?? "").replace(/\[\d+\]$/, "");
  if (!COLOR_KEYS.includes(leaf) && leaf !== "colors" && leaf !== "segColors") return;
  if (!TOKEN_VALUES.has(v)) out.push(`${path}=${v}`);
}
const TOKEN_VALUES = new Set(Object.values(COLORS));

describe("contract hygiene", () => {
  it("every prim carries a non-empty id and only finite numbers", () => {
    for (const { mod, res } of allResults()) {
      expect(res.prims.length, `${mod}: drew nothing — fixture no longer exercises the module`).toBeGreaterThan(0);
      for (const p of res.prims) {
        expect(typeof p.id, `${mod}: prim id type`).toBe("string");
        expect(p.id.length, `${mod}: empty prim id`).toBeGreaterThan(0);
        const bad: string[] = [];
        scanNumbers(p, `${mod}:${p.id}`, bad);
        expect(bad, `${mod}: non-finite numbers`).toEqual([]);
      }
      for (const c of res.candlePaint ?? []) expect(Number.isFinite(c.i)).toBe(true);
      for (const e of res.events ?? []) {
        const bad: string[] = [];
        scanNumbers(e, `${mod}:event`, bad);
        expect(bad, `${mod}: non-finite event numbers`).toEqual([]);
      }
    }
  });

  it("prim ids are unique within one compute pass", () => {
    for (const { mod, res } of allResults()) {
      const seen = new Set<string>();
      const dupes: string[] = [];
      for (const p of res.prims) {
        if (seen.has(p.id)) dupes.push(p.id);
        seen.add(p.id);
      }
      expect(dupes, `${mod}: duplicate prim ids`).toEqual([]);
    }
  });

  it("every tooltipId resolves to a declared tooltip", () => {
    for (const { mod, res } of allResults()) {
      const ids = new Set((res.tooltips ?? []).map((t) => t.id));
      for (const p of res.prims) {
        const tid = (p as any).tooltipId;
        if (tid) expect(ids.has(tid), `${mod}: dangling tooltipId ${tid}`).toBe(true);
      }
    }
  });

  it("respects the alpha discipline (zone fills <= 0.18, bgshade <= 0.10)", () => {
    for (const { mod, res } of allResults()) {
      for (const p of res.prims) {
        if (p.kind === "zone" && p.fillAlpha !== undefined) {
          expect(p.fillAlpha, `${mod}: ${p.id}`).toBeLessThanOrEqual(0.18);
        }
        if (p.kind === "bgshade") expect(p.alpha, `${mod}: ${p.id}`).toBeLessThanOrEqual(0.1);
      }
    }
  });

  it("module sources contain zero hex color literals", () => {
    for (const f of SRC_FILES) {
      const src = readFileSync(join(__dirname, "..", "suites", f), "utf8");
      const code = src
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
      const hits = code.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
      expect(hits, `${f} hex literals`).toEqual([]);
      expect(code.match(/\brgba?\s*\(/g) ?? [], `${f} rgb()/rgba() literals`).toEqual([]);
    }
  });

  it("module sources contain no clock or randomness", () => {
    for (const f of SRC_FILES) {
      const src = readFileSync(join(__dirname, "..", "suites", f), "utf8");
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
      expect(code.includes("Date.now"), `${f}: Date.now`).toBe(false);
      expect(code.includes("Math.random"), `${f}: Math.random`).toBe(false);
      expect(code.includes("new Date"), `${f}: new Date`).toBe(false);
    }
  });

  it("module sources name no CSS colour outside ctx.colors", () => {
    // catches named colours ("red", "white", …) that the hex/rgb scan would miss
    const NAMED = /\b(?:red|green|blue|white|black|gray|grey|orange|yellow|purple|cyan|magenta|lime|teal|navy|silver|gold|pink|brown|maroon|olive|aqua|fuchsia|transparent|currentColor)\b\s*['"]/i;
    for (const f of SRC_FILES) {
      const code = readFileSync(join(__dirname, "..", "suites", f), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
      const strings = code.match(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g) ?? [];
      const hits = strings.filter((s) => NAMED.test(`${s.slice(1, -1)}"`) || /^["'`]#/.test(s));
      expect(hits, `${f}: literal colour strings`).toEqual([]);
    }
  });

  it("emits only host-resolved colour tokens", () => {
    for (const { mod, res } of allResults()) {
      const bad: string[] = [];
      scanColors(res.prims, `${mod}:prims`, bad);
      scanColors(res.tooltips ?? [], `${mod}:tooltips`, bad);
      scanColors(res.candlePaint ?? [], `${mod}:paint`, bad);
      expect(bad, `${mod}: non-token colours`).toEqual([]);
    }
    const paint = run(CANDLE_PAINTER_MODULE, walkBars(600, 77, 29), { mode: "trendVolume" }).candlePaint ?? [];
    const bad: string[] = [];
    scanColors(paint, "cp:paint", bad);
    expect(bad).toEqual([]);
  });

  it("declares unique tooltip ids", () => {
    for (const { mod, res } of allResults()) {
      const ids = (res.tooltips ?? []).map((t) => t.id);
      expect(new Set(ids).size, `${mod}: duplicate tooltip ids`).toBe(ids.length);
    }
  });

  it("ships a complete, self-consistent settings schema", () => {
    for (const m of ALL_MODULES) {
      const fieldKeys = m.fields.map((f) => f.key).sort();
      expect(Object.keys(m.defaults).sort(), `${m.key}: fields vs defaults`).toEqual(fieldKeys);
      expect(new Set(fieldKeys).size, `${m.key}: duplicate field keys`).toBe(fieldKeys.length);
      for (const f of m.fields) {
        expect(f.key, `${m.key}.${f.key}: prefixed key`).not.toContain(".");
        expect(f.label.length, `${m.key}.${f.key}: empty label`).toBeGreaterThan(0);
        if (f.type === "number") {
          expect(typeof f.min, `${m.key}.${f.key}: min`).toBe("number");
          expect(typeof f.max, `${m.key}.${f.key}: max`).toBe("number");
          expect(m.defaults[f.key], `${m.key}.${f.key}: default below min`).toBeGreaterThanOrEqual(f.min!);
          expect(m.defaults[f.key], `${m.key}.${f.key}: default above max`).toBeLessThanOrEqual(f.max!);
        }
        if (f.type === "select") {
          expect(f.options?.some((o) => o.v === m.defaults[f.key]), `${m.key}.${f.key}: default not an option`).toBe(true);
        }
        if (f.showIf) expect(fieldKeys, `${m.key}.${f.key}: showIf target`).toContain(f.showIf.key);
      }
    }
  });

  it("carries the registered identity for every W1 module", () => {
    const idOf = (m: SuiteModuleDef) => [m.key, m.label, m.tag, m.tier, m.defaultOn];
    expect(W1_MODULES.map(idOf)).toEqual([
      ["pd", "Premium & Discount", "PD", "essential", false],
      ["liq", "Liquidity", "LIQ", "pro", false],
      ["sfp", "Swing Failure", "SFP", "pro", false],
      ["te", "Trend Engine", "TE", "essential", true],
      ["vb", "Volt Bands", "VB", "essential", false],
      ["cp", "Candle Painter", "CP", "free", true],
      ["fb", "Flow Band", "FB", "essential", false],
    ]);
    expect(new Set(ALL_MODULES.map((m) => m.key)).size).toBe(ALL_MODULES.length);
    expect(new Set(ALL_MODULES.map((m) => m.tag)).size).toBe(ALL_MODULES.length);
  });
});

// ─── 5b. Robustness & i18n ────────────────────────────────────────────────────

/** Splice CN/HK-style dirty bars (OHLC = 0 = MISSING) and NaNs into a clean series. */
function dirtyBars(): SuiteBar[] {
  const bars = walkBars(400, 4242, 31).map((b) => ({ ...b }));
  bars[120] = { ...bars[120], o: 0, h: 0, l: 0, c: 0, v: 0 };
  bars[121] = { ...bars[121], h: NaN, l: NaN };
  bars[200] = { ...bars[200], v: NaN };
  bars[201] = { ...bars[201], o: bars[201].c, h: bars[201].c, l: bars[201].c }; // zero range
  return bars;
}

describe("robustness", () => {
  it("survives zero / NaN / zero-range bars without emitting non-finite geometry", () => {
    const bars = dirtyBars();
    for (const mod of ALL_MODULES) {
      let res!: ModuleResult;
      expect(() => { res = run(mod, bars); }, `${mod.key} threw`).not.toThrow();
      for (const p of res.prims) {
        const bad: string[] = [];
        scanNumbers(p, `${mod.key}:${p.id}`, bad);
        expect(bad, `${mod.key}: non-finite prim geometry`).toEqual([]);
      }
      for (const t of res.tooltips ?? []) {
        for (const r of t.rows) expect(r.v.includes("NaN"), `${mod.key}: NaN leaked into ${t.id}/${r.k}`).toBe(false);
      }
    }
  });

  it("returns an empty result for degenerate inputs instead of throwing", () => {
    for (const mod of ALL_MODULES) {
      for (const bars of [[], walkBars(2), walkBars(11)]) {
        const res = run(mod, bars);
        expect(Array.isArray(res.prims), `${mod.key}`).toBe(true);
      }
    }
  });

  it("never plots a zero or negative price on a series with missing prints", () => {
    const bars = dirtyBars();
    for (const mod of ALL_MODULES) {
      for (const p of run(mod, bars).prims as any[]) {
        for (const arr of [p.pts, p.upper, p.lower]) {
          if (!Array.isArray(arr)) continue;
          for (const q of arr) expect(q.p, `${mod.key}:${p.id}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("paints exactly one candle entry per bar when structure candles are on", () => {
    const bars = walkBars(200, 5, 31);
    const res = run(MARKET_STRUCTURE_MODULE, bars, { structCandles: true, swingLen: 15 });
    expect(res.candlePaint?.length).toBe(bars.length);
    res.candlePaint!.forEach((e, i) => {
      expect(e.i).toBe(i);
      expect([COLORS.up, COLORS.down, COLORS.neutral]).toContain(e.color);
    });
    expect(run(MARKET_STRUCTURE_MODULE, bars, { structCandles: false }).candlePaint).toBeUndefined();
  });
});

describe("i18n", () => {
  const bars = walkBars(400, 4242, 31);

  it("localizes tooltip copy without leaking the other language", () => {
    for (const mod of MODULES) {
      const en = run(mod, bars, mod === MARKET_STRUCTURE_MODULE ? { swingLen: 15 } : {}, "en");
      const zh = run(mod, bars, mod === MARKET_STRUCTURE_MODULE ? { swingLen: 15 } : {}, "zh");
      expect(en.tooltips?.length, `${mod.key}: no tooltips to compare`).toBeGreaterThan(0);
      expect(zh.tooltips?.length).toBe(en.tooltips?.length);
      const enText = JSON.stringify(en.tooltips);
      const zhText = JSON.stringify(zh.tooltips);
      expect(zhText, `${mod.key}: zh output identical to en`).not.toBe(enText);
      expect(/[\u4e00-\u9fff]/.test(enText), `${mod.key}: CJK leaked into the en tooltip`).toBe(false);
      expect(/[\u4e00-\u9fff]/.test(zhText), `${mod.key}: zh tooltip has no CJK`).toBe(true);
    }
  });

  it("localizes every W1 module's tooltips and event copy", () => {
    const cases: Array<[SuiteModuleDef, SuiteBar[], Record<string, any>]> = [
      [PREMIUM_DISCOUNT_MODULE, hlcBars(PD_ROWS), PD_S],
      [LIQUIDITY_MODULE, liqBars(), { bubbles: true }],
      [SFP_MODULE, sfpBars([[104, 89, 95], ...SFP_QUIET]), SFP_S],
      [TREND_ENGINE_MODULE, bars, {}],
      [VOLT_BANDS_MODULE, bars, {}],
      [FLOW_BAND_MODULE, bars, {}],
    ];
    for (const [mod, fixture, opts] of cases) {
      const en = run(mod, fixture, opts, "en");
      const zh = run(mod, fixture, opts, "zh");
      expect(en.tooltips?.length, `${mod.key}: no tooltips to compare`).toBeGreaterThan(0);
      expect(zh.tooltips?.length).toBe(en.tooltips?.length);
      for (const [a, b] of [[en.tooltips, zh.tooltips], [en.events, zh.events]] as const) {
        const at = JSON.stringify(a);
        const bt = JSON.stringify(b);
        expect(bt, `${mod.key}: zh output identical to en`).not.toBe(at);
        expect(/[一-鿿]/.test(at), `${mod.key}: CJK leaked into the en output`).toBe(false);
        expect(/[一-鿿]/.test(bt), `${mod.key}: zh output has no CJK`).toBe(true);
      }
      // geometry is language-independent
      const strip = (r: ModuleResult) => r.prims.filter((p) => p.kind !== "label").length;
      expect(strip(zh)).toBe(strip(en));
    }
  });

  it("keeps the W1 chart tags language-neutral", () => {
    const teBars = levelBars(TE_LEVELS);
    const tags = (lang: "en" | "zh") =>
      run(TREND_ENGINE_MODULE, teBars, TE_S, lang).prims
        .filter((p) => p.kind === "label").map((p: any) => p.text);
    expect(tags("en").length).toBeGreaterThan(0);
    expect(tags("zh")).toEqual(tags("en")); // BUY / SELL / TP1 ✓ are not translated
    const sfpEn = run(SFP_MODULE, sfpBars([[104, 89, 95], ...SFP_QUIET]), SFP_S, "en");
    const sfpZh = run(SFP_MODULE, sfpBars([[104, 89, 95], ...SFP_QUIET]), SFP_S, "zh");
    expect(primOf(sfpZh, "sfp-b13-t").text).toBe(primOf(sfpEn, "sfp-b13-t").text);
  });

  it("keeps language-neutral chart microcopy identical across languages", () => {
    const en = run(MARKET_STRUCTURE_MODULE, bars, { swingLen: 15 }, "en");
    const zh = run(MARKET_STRUCTURE_MODULE, bars, { swingLen: 15 }, "zh");
    const tags = (r: ModuleResult) =>
      r.prims.filter((p) => p.kind === "label" && /^ms-(sw|in)-(bos|choch)-l-/.test(p.id)).map((p: any) => p.text);
    expect(tags(en).length).toBeGreaterThan(0);
    expect(tags(zh)).toEqual(tags(en)); // "BOS"/"CHoCH" are not translated
  });
});

// ─── 13. Caps / density ───────────────────────────────────────────────────────

describe("drawn-density caps", () => {
  const PATHOLOGICAL = walkBars(5000, 991, 37);

  it("keeps each module under MAX_PRIMS_PER_MODULE on a 5000-bar series", () => {
    for (const mod of MODULES) {
      const res = run(mod, PATHOLOGICAL, mod === MARKET_STRUCTURE_MODULE
        ? { swingLen: 12, internalLen: 3, mapping: true, strongWeak: true, showLast: 40 }
        : {});
      expect(res.prims.length, `${mod.key} drew nothing`).toBeGreaterThan(0);
      expect(res.prims.length, `${mod.key} prim count`).toBeLessThanOrEqual(MAX_PRIMS_PER_MODULE);
    }
  });

  it("keeps every W1 module under MAX_PRIMS_PER_MODULE with every surface on", () => {
    const heavy: Record<string, Record<string, any>> = {
      pd: { showLast: 3, rangeLen: 3 },
      liq: { bubbles: true, showLast: 24, maxLines: 20 },
      sfp: { showLast: 16, showInvalid: true, swingLen: 8 },
      te: { showLast: 6, shadow: true, slMode: "fixed", tpMode: "dynamic", tpCount: 6, sensitivity: 2 },
      vb: { showLast: 20 },
      fb: { showLast: 16, htf: "2x" },
    };
    for (const mod of W1_MODULES) {
      const res = run(mod, PATHOLOGICAL, heavy[mod.key] ?? {});
      if (mod === CANDLE_PAINTER_MODULE) {
        // the candles ARE the drawing: no prims, one paint entry per bar
        expect(res.prims).toEqual([]);
        expect(res.candlePaint?.length).toBe(PATHOLOGICAL.length);
        continue;
      }
      expect(res.prims.length, `${mod.key} drew nothing`).toBeGreaterThan(0);
      expect(res.prims.length, `${mod.key} prim count`).toBeLessThanOrEqual(MAX_PRIMS_PER_MODULE);
    }
  });

  it("bounds W1 prims by a small multiple of showLast", () => {
    // per drawn item: pd range <= 10, liq line <= 3, sfp pattern <= 5, vb triangle 1 (+262 fixed
    // rails/midline/glow), fb turn 2 + <=6 retests x 2, te ladder <= 13 (+240 fixed chrome).
    const bounds: Array<[SuiteModuleDef, number[], number, number, Record<string, any>]> = [
      [PREMIUM_DISCOUNT_MODULE, [1, 2, 3], 10, 0, { rangeLen: 3 }],
      [LIQUIDITY_MODULE, [4, 8, 24], 3, 0, { maxLines: 20 }],
      [SFP_MODULE, [2, 8, 16], 5, 0, { showInvalid: true, swingLen: 8 }],
      [TREND_ENGINE_MODULE, [1, 2, 6], 14, 240, { shadow: true, slMode: "fixed" }],
      [VOLT_BANDS_MODULE, [2, 10, 20], 1, 262, {}],
      [FLOW_BAND_MODULE, [2, 8, 16], 14, 3, {}],
    ];
    for (const [mod, showLasts, per, fixed, opts] of bounds) {
      for (const showLast of showLasts) {
        const res = run(mod, PATHOLOGICAL, { ...opts, showLast });
        expect(res.prims.length, `${mod.key} showLast=${showLast} drew nothing`).toBeGreaterThan(0);
        expect(res.prims.length, `${mod.key} showLast=${showLast}`).toBeLessThanOrEqual(showLast * per + fixed);
      }
    }
  });

  it("stays deterministic on the pathological fixture (W1)", () => {
    for (const mod of W1_MODULES) {
      expect(run(mod, PATHOLOGICAL), `${mod.key}`).toEqual(run(mod, PATHOLOGICAL));
    }
  });

  it("bounds order-block prims by a small multiple of showLast", () => {
    for (const showLast of [1, 3, 6, 12]) {
      const res = run(ORDER_BLOCKS_MODULE, PATHOLOGICAL, { showLast });
      // per drawn block: zone + tick + 4 internals + 2 chips + 2 rating + tier = 11
      // plus up to `showLast` breakers at 2 prims each.
      expect(res.prims.length, `ob showLast=${showLast} drew nothing`).toBeGreaterThan(0);
      expect(res.prims.length, `ob showLast=${showLast}`).toBeLessThanOrEqual(showLast * 16);
    }
  });

  it("bounds fvg prims by a small multiple of showLast", () => {
    for (const showLast of [2, 5, 8, 20]) {
      const res = run(FVG_MODULE, PATHOLOGICAL, { showLast, signals: "both" });
      // per zone: box + fill box + chip + poc + iFVG label + creation glyph + <=3 retests = 9
      expect(res.prims.length, `fvg showLast=${showLast} drew nothing`).toBeGreaterThan(0);
      expect(res.prims.length, `fvg showLast=${showLast}`).toBeLessThanOrEqual(showLast * 12);
    }
  });

  it("bounds market-structure prims by showLast plus the fixed pivot-mark ceiling", () => {
    for (const showLast of [4, 12, 40]) {
      const res = run(MARKET_STRUCTURE_MODULE, PATHOLOGICAL, {
        swingLen: 12, internalLen: 3, mapping: true, showLast,
      });
      // 2 prims per drawn swing break + 2 per drawn internal break (<= showLast each),
      // + <= 24 pivot marks x 4 families + a fixed <= 20 for projections / DT-DB.
      expect(res.prims.length, `ms showLast=${showLast} drew nothing`).toBeGreaterThan(0);
      expect(res.prims.length, `ms showLast=${showLast}`).toBeLessThanOrEqual(showLast * 4 + 24 * 4 + 20);
    }
  });

  it("stays deterministic on the pathological fixture", () => {
    for (const mod of MODULES) {
      expect(run(mod, PATHOLOGICAL)).toEqual(run(mod, PATHOLOGICAL));
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// W2 — PANE SUITES (Pulse Oscillator, RSI Ultimate, MACD Ultimate)
// ══════════════════════════════════════════════════════════════════════════════

const clampTo = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

// ─── 14. shared/oscUtils ──────────────────────────────────────────────────────

/** Independent Wilder RSI: SMA seed over the first `len` deltas, then the classic recurrence. */
function rsiRef(closes: number[], len: number): Array<number | null> {
  const out: Array<number | null> = new Array(closes.length).fill(null);
  const g: number[] = [];
  const l: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    g.push(d > 0 ? d : 0);
    l.push(d < 0 ? -d : 0);
  }
  if (g.length < len) return out;
  let ag = 0;
  let al = 0;
  for (let k = 0; k < len; k++) {
    ag += g[k];
    al += l[k];
  }
  ag /= len;
  al /= len;
  const rsi = () => (al > 0 ? 100 - 100 / (1 + ag / al) : ag > 0 ? 100 : 50);
  out[len] = rsi(); // g[len-1] belongs to bar `len`
  for (let k = len; k < g.length; k++) {
    ag = (ag * (len - 1) + g[k]) / len;
    al = (al * (len - 1) + l[k]) / len;
    out[k + 1] = rsi();
  }
  return out;
}

/** Independent seeded EMA (SMA seed then the k-recurrence), matching the oscUtils convention. */
function emaRef(vals: number[], len: number): Array<number | null> {
  const out: Array<number | null> = new Array(vals.length).fill(null);
  if (vals.length < len) return out;
  const k = 2 / (len + 1);
  let sum = 0;
  for (let i = 0; i < len; i++) sum += vals[i];
  let prev = sum / len;
  out[len - 1] = prev;
  for (let i = len; i < vals.length; i++) {
    prev = vals[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** A deterministic, non-monotonic close path — real gains AND losses in every window. */
function oscCloses(n: number, seed = 4242): number[] {
  const rnd = lcg(seed);
  const out: number[] = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    p = Math.max(5, p + (rnd() - 0.48) * 2 + Math.sin(i / 7) * 0.9);
    out.push(p);
  }
  return out;
}

describe("oscUtils — smoothers", () => {
  it("matches an independent 20-bar Wilder RSI to 1e-8, with an honest NaN warm-up", () => {
    const closes = oscCloses(300);
    const ref = rsiRef(closes, 20);
    const got = rsiArr(closes, 20);
    expect(got.length).toBe(closes.length);
    let checked = 0;
    for (let i = 0; i < closes.length; i++) {
      if (ref[i] === null) {
        expect(Number.isFinite(got[i]), `bar ${i} should be warm-up NaN`).toBe(false);
        continue;
      }
      expect(got[i], `bar ${i}`).toBeCloseTo(ref[i] as number, 8);
      checked++;
    }
    expect(checked).toBeGreaterThan(250);
    expect(Number.isFinite(got[19])).toBe(false); // seed completes on bar 20, not 19
    expect(Number.isFinite(got[20])).toBe(true);
  });

  it("uses the neutral-50 / pure-advance-100 conventions on degenerate series", () => {
    const flat = new Array(60).fill(100);
    const rising = Array.from({ length: 60 }, (_, i) => 100 + i);
    const falling = Array.from({ length: 60 }, (_, i) => 200 - i);
    expect(rsiArr(flat, 14)[40]).toBe(50);
    expect(rsiArr(rising, 14)[40]).toBe(100);
    expect(rsiArr(falling, 14)[40]).toBe(0);
    expect(rsiArr([], 14).length).toBe(0);
    expect(rsiArr([1, 2], 14).every((v) => !Number.isFinite(v))).toBe(true);
  });

  it("skips holes instead of zeroing them (a NaN delays the seed, never corrupts it)", () => {
    const closes = oscCloses(120);
    const holed = closes.slice();
    holed[50] = NaN;
    const got = rsiArr(holed, 14);
    expect(Number.isFinite(got[50])).toBe(false); // the hole itself has no reading
    expect(Number.isFinite(got[52])).toBe(true); // the smoother resumes from its own state
    // bars before the hole are untouched by it
    const clean = rsiArr(closes, 14);
    for (let i = 0; i < 49; i++) expect(got[i]).toBe(clean[i]);
  });

  it("seeds wilderRma from the SMA of the first len usable samples", () => {
    const vals = [2, 4, 6, 8, 10, 12, 14, 16];
    const out = wilderRma(vals, 4);
    expect(Number.isFinite(out[2])).toBe(false);
    expect(out[3]).toBeCloseTo((2 + 4 + 6 + 8) / 4, 12); // 5
    expect(out[4]).toBeCloseTo((5 * 3 + 10) / 4, 12); // 6.25
    expect(out[5]).toBeCloseTo((6.25 * 3 + 12) / 4, 12);
    expect(wilderRma([], 4).length).toBe(0);
  });

  it("matches an independent seeded EMA", () => {
    const vals = oscCloses(200, 7);
    for (const len of [5, 14, 34]) {
      const ref = emaRef(vals, len);
      const got = emaArr(vals, len);
      for (let i = 0; i < vals.length; i++) {
        if (ref[i] === null) expect(Number.isFinite(got[i]), `len=${len} bar ${i}`).toBe(false);
        else expect(got[i], `len=${len} bar ${i}`).toBeCloseTo(ref[i] as number, 9);
      }
    }
  });
});

describe("oscUtils — window statistics", () => {
  it("returns the neutral 50 below the minimum sample count and ranks above it", () => {
    const vals = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    expect(rollingPercentile(vals, 5, 20, 3)).toBe(50); // only 6 usable samples
    expect(rollingPercentile(vals, 11, 12, 12)).toBe(100); // window max
    expect(rollingPercentile(vals, 11, 12, 0)).toBe(0); // below every sample
    expect(rollingPercentile(vals, 11, 12, 6)).toBeCloseTo(50, 9); // 6 of 12 at or below
    expect(rollingPercentile(vals, 99, 12, 6)).toBe(50); // out of range
    expect(rollingPercentile(vals, 11, 12, NaN)).toBe(50);
    const holed = [1, 2, NaN, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    expect(rollingPercentile(holed, 11, 12, 12)).toBe(100); // the NaN is skipped, not counted
  });

  it("bounds normalizeSigned to -100..100 and never looks ahead", () => {
    const src = new Float64Array(400);
    const rnd = lcg(99);
    for (let i = 0; i < src.length; i++) src[i] = (rnd() - 0.5) * (1 + i / 40);
    for (let i = 0; i < src.length; i++) {
      const v = normalizeSigned(src, i, 50);
      expect(v).toBeGreaterThanOrEqual(-100);
      expect(v).toBeLessThanOrEqual(100);
      // the reading at i must not change when the future is truncated away
      expect(normalizeSigned(src.slice(0, i + 1), i, 50), `bar ${i}`).toBe(v);
    }
    // the running |max| bar always reads exactly ±100
    const ramp = new Float64Array([1, -2, 3, -4, 5]);
    expect(normalizeSigned(ramp, 4, 10)).toBe(100);
    expect(normalizeSigned(ramp, 3, 10)).toBe(-100);
    expect(normalizeSigned(new Float64Array([0, 0, 0]), 2, 10)).toBe(0); // no scale -> 0, never NaN
    expect(normalizeSigned(new Float64Array(0), 0, 10)).toBe(0);
    const withHole = new Float64Array([4, NaN, 2]);
    expect(normalizeSigned(withHole, 1, 10)).toBe(0);
    expect(normalizeSigned(withHole, 2, 10)).toBe(50);
  });
});

describe("oscUtils — resampleOhlcv", () => {
  const SRC = mkBars([
    [10, 12, 9, 11, 100], [11, 15, 10, 14, 200], [14, 16, 8, 9, 300],
    [9, 11, 7, 10, 400], [10, 13, 10, 12, 500], [12, 12, 6, 7, 600],
    [7, 9, 5, 8, 700],
  ]);

  it("aggregates complete groups only, anchored at index 0", () => {
    const { groups, lastSrc } = resampleOhlcv(SRC, 3);
    expect(groups.length).toBe(2); // the trailing partial group is dropped on purpose
    expect(groups[0]).toEqual({ t: SRC[0].t, o: 10, h: 16, l: 8, c: 9, v: 600 });
    expect(groups[1]).toEqual({ t: SRC[3].t, o: 9, h: 13, l: 6, c: 7, v: 1500 });
    expect(Array.from(lastSrc)).toEqual([2, 5]); // a group is knowable at its LAST source bar
  });

  it("treats factor <= 1 as the identity and survives an empty series", () => {
    for (const f of [1, 0, -3, NaN]) {
      const r = resampleOhlcv(SRC, f);
      expect(r.groups).toBe(SRC); // same reference, no copy
      expect(Array.from(r.lastSrc)).toEqual(SRC.map((_, i) => i));
    }
    const e = resampleOhlcv([], 4);
    expect(e.groups).toEqual([]);
    expect(e.lastSrc.length).toBe(0);
  });

  it("is prefix-stable: appending bars never edits an earlier group", () => {
    const full = walkBars(840, 991);
    for (const f of [2, 4, 7]) {
      const a = resampleOhlcv(full.slice(0, 800), f);
      const b = resampleOhlcv(full, f);
      expect(a.groups.length).toBeGreaterThan(50);
      for (let g = 0; g < a.groups.length; g++) {
        expect(b.groups[g], `factor=${f} group ${g}`).toEqual(a.groups[g]);
        expect(b.lastSrc[g]).toBe(a.lastSrc[g]);
        expect(a.lastSrc[g], `factor=${f} group ${g} peeks`).toBe((g + 1) * f - 1);
      }
    }
  });

  it("emits NaN OHLC (not a fabricated zero) for an all-missing group", () => {
    const dirty = SRC.map((b, i) => (i < 3 ? { ...b, o: NaN, h: NaN, l: NaN, c: NaN, v: NaN } : b));
    const { groups } = resampleOhlcv(dirty, 3);
    expect(Number.isNaN(groups[0].o)).toBe(true);
    expect(Number.isNaN(groups[0].c)).toBe(true);
    expect(groups[0].v).toBe(0);
    expect(groups[1].c).toBe(7);
  });
});

// ─── 15. shared/divergence ────────────────────────────────────────────────────

/**
 * Crafted oscillator with EXACTLY two swing lows (wing 2) — at bars 3 and 9, values supplied by the
 * caller — and exactly one swing high (bar 6, value 50), so only ONE same-kind pair can ever form:
 *
 *   osc: 50 40 30 [A] 30 40 50 45 40 [B] 35 45 55       (A < 30, B < 35)
 *
 * The class is then selected purely by the price printed at those two bars (bar lows, since both
 * pivots are oscillator LOWS). Beyond bar 12 the filler is a flat 60 — no further pivots.
 */
function divOsc(oscA: number, oscB: number, n = 13): Float64Array {
  const head = [50, 40, 30, oscA, 30, 40, 50, 45, 40, oscB, 35, 45, 55];
  return Float64Array.from(Array.from({ length: n }, (_, i) => (i < head.length ? head[i] : 60)));
}

function divBars(lowAt3: number, lowAt9: number, n = 13): SuiteBar[] {
  return Array.from({ length: n }, (_, i) => {
    const l = i === 3 ? lowAt3 : i === 9 ? lowAt9 : 120;
    return { t: 86400 * (i + 1), o: l + 1, h: l + 2, l, c: l + 1, v: 1000 };
  });
}

describe("shared divergence detector", () => {
  it("finds the crafted regular BULL divergence and nothing else", () => {
    // price lower-low (100 -> 95) while the oscillator prints a higher low (20 -> 25)
    const evs = findDivergences(divBars(100, 95), divOsc(20, 25), { wing: 2, maxSpan: 60 });
    expect(evs.length).toBe(1);
    const e = evs[0];
    expect(e.kind).toBe("bull");
    expect([e.iA, e.iB, e.confirmedAt]).toEqual([3, 9, 11]); // confirmedAt = iB + wing
    expect([e.oscA, e.oscB]).toEqual([20, 25]);
    expect([e.priceA, e.priceB]).toEqual([100, 95]); // read at the pivot bars' LOWS
  });

  it("needs BOTH legs: an agreeing pair is not a divergence", () => {
    // price lower-low AND oscillator lower-low — momentum agrees, so nothing fires
    expect(findDivergences(divBars(100, 95), divOsc(25, 20), { wing: 2 })).toEqual([]);
  });

  it("classifies price-HL + osc-LL as a HIDDEN bull and honours the toggle", () => {
    const bars = divBars(100, 105);
    const osc = divOsc(25, 20);
    const hid = findDivergences(bars, osc, { wing: 2 });
    expect(hid.length).toBe(1);
    expect(hid[0].kind).toBe("hiddenBull");
    expect([hid[0].iA, hid[0].iB, hid[0].confirmedAt]).toEqual([3, 9, 11]);
    expect(findDivergences(bars, osc, { wing: 2, hidden: false })).toEqual([]);
  });

  it("rejects a pair wider than maxSpan", () => {
    const bars = divBars(100, 95);
    expect(findDivergences(bars, divOsc(20, 25), { wing: 2, maxSpan: 5 })).toEqual([]); // span is 6
    expect(findDivergences(bars, divOsc(20, 25), { wing: 2, maxSpan: 6 }).length).toBe(1);
  });

  it("never grows a pivot out of a NaN warm-up window", () => {
    const osc = divOsc(20, 25);
    osc[1] = NaN; // poisons the left wing of the bar-3 low
    expect(findDivergences(divBars(100, 95), osc, { wing: 2 })).toEqual([]);
  });

  it("emits nothing for degenerate inputs", () => {
    expect(findDivergences([], new Float64Array(0), {})).toEqual([]);
    expect(findDivergences(divBars(100, 95).slice(0, 2), divOsc(20, 25, 2), {})).toEqual([]);
  });

  it("is non-repainting: appending bars never edits a settled event", () => {
    const key = (e: DivergenceEvent) => `${e.kind}|${e.iA}|${e.iB}|${e.confirmedAt}|${e.oscA}|${e.oscB}`;
    const a = findDivergences(divBars(100, 95, 13), divOsc(20, 25, 13), { wing: 2 }).map(key);
    const b = findDivergences(divBars(100, 95, 53), divOsc(20, 25, 53), { wing: 2 })
      .filter((e) => e.confirmedAt <= 11)
      .map(key);
    expect(a.length).toBe(1);
    expect(b).toEqual(a);
  });

  it("scores 0..100 and stays bounded on real series", () => {
    const bars = walkBars(600, 77, 29);
    const { rsi } = computeUltimateRsi(bars, 14, "close", 14, "ema");
    const evs = findDivergences(bars, rsi, {});
    expect(evs.length).toBeGreaterThan(3);
    for (const e of evs) {
      const s = divergenceStrength(e, bars);
      expect(Number.isFinite(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(100);
    }
    expect(divergenceStrength(evs[0], [])).toBe(0);
    expect(divergenceStrength({ ...evs[0], iB: 1e9 }, bars)).toBe(0);
  });
});

// ─── 16. Pulse Oscillator suite ───────────────────────────────────────────────

/** Append `n` bars stepping by `step` from the running last value. */
function seg(p: number[], n: number, step: number): number[] {
  let last = p.length ? p[p.length - 1] : 100;
  for (let i = 0; i < n; i++) {
    last += step;
    p.push(last);
  }
  return p;
}

/**
 * Two-dip path, hand-tuned so the pulse wave prints a genuine V-trough INSIDE the oversold zone:
 *   0..59    quiet grind        1..59   (+0.05)
 *   60..84   first decline      (-1.20) — sets the trailing |momentum| ceiling, so the wave pins
 *                                         at -100 here and cannot form a trough
 *   85..124  recovery           (+1.00) — the wave peaks above +60 (a Pulse Sell)
 *   125..149 second decline     (-1.15) — SHALLOWER than the first, so the wave bottoms at ~-73
 *   150..189 recovery           (+1.00) — bar 150 is the trough, bar 151 confirms it
 */
function pulseDipPath(): number[] {
  const p = [100];
  seg(p, 59, 0.05);
  seg(p, 25, -1.2);
  seg(p, 40, 1.0);
  seg(p, 25, -1.15);
  seg(p, 40, 1.0);
  return p;
}
const PULSE_DIP = pathBars(pulseDipPath());
const PULSE_NOISE = walkBars(600, 77, 29);

describe("pulseWave", () => {
  it("draws the wave inside the pane and honours the companion-line toggles", () => {
    const res = run(PULSE_WAVE_MODULE, PULSE_NOISE);
    const wave = primOf(res, "pw-wave");
    expect(wave.kind).toBe("gradline");
    expect(wave.pts.length).toBeGreaterThan(300);
    expect(wave.colors.length).toBe(wave.pts.length);
    for (const q of wave.pts) {
      expect(q.p).toBeGreaterThanOrEqual(-100);
      expect(q.p).toBeLessThanOrEqual(100);
    }
    expect(primOf(res, "pw-gapped")).toBeDefined();
    expect(primOf(res, "pw-fill")).toBeDefined();

    const bare = run(PULSE_WAVE_MODULE, PULSE_NOISE, { gapped: false });
    expect(bare.prims.map((p) => p.id)).toEqual(["pw-wave"]);
    const noFill = run(PULSE_WAVE_MODULE, PULSE_NOISE, { fillGaps: false });
    expect(noFill.prims.map((p) => p.id)).toEqual(["pw-gapped", "pw-wave"]);
    // the tape never depends on what is drawn
    expect(bare.events).toEqual(res.events);
    expect(noFill.events).toEqual(res.events);
  });

  it("reports exactly the zero / ±60 transitions the wave actually made", () => {
    const { wave } = computePulseWave(PULSE_DIP, "day");
    const want: Array<[string, string, number]> = [];
    let prev = NaN;
    for (let i = 0; i < PULSE_DIP.length; i++) {
      const cur = wave[i];
      if (!Number.isFinite(cur)) continue;
      if (Number.isFinite(prev)) {
        if (prev <= 0 && cur > 0) want.push(["pw_cross_zero", "bull", i]);
        else if (prev >= 0 && cur < 0) want.push(["pw_cross_zero", "bear", i]);
        if (prev > -60 && cur <= -60) want.push(["pw_extreme_enter", "bull", i]);
        if (prev < 60 && cur >= 60) want.push(["pw_extreme_enter", "bear", i]);
        if (prev <= -60 && cur > -60) want.push(["pw_extreme_exit", "bull", i]);
        if (prev >= 60 && cur < 60) want.push(["pw_extreme_exit", "bear", i]);
      }
      prev = cur;
    }
    const got = (run(PULSE_WAVE_MODULE, PULSE_DIP).events ?? []).map((e) => [e.type, e.dir, e.i]);
    expect(want.length).toBeGreaterThan(3);
    expect(got).toEqual(want);
  });

  it("survives a profile switch and stays deterministic", () => {
    for (const profile of ["scalper", "day", "swing"]) {
      const a = run(PULSE_WAVE_MODULE, PULSE_NOISE, { profile });
      expect(a).toEqual(run(PULSE_WAVE_MODULE, PULSE_NOISE, { profile }));
      expect(a.prims.length, `${profile} drew nothing`).toBeGreaterThan(0);
    }
    expect(run(PULSE_WAVE_MODULE, PULSE_NOISE, { profile: "scalper" }).prims)
      .not.toEqual(run(PULSE_WAVE_MODULE, PULSE_NOISE, { profile: "swing" }).prims);
  });
});

describe("pulseSignals", () => {
  it("prints the crafted oversold turn as a Pulse Buy on the confirming bar", () => {
    const { wave } = computePulseWave(PULSE_DIP, "day");
    const buys = evOf(run(PULSE_SIGNALS_MODULE, PULSE_DIP), "pulse_buy");
    expect(buys.length).toBe(1);
    expect(buys[0].i).toBe(151); // the CONFIRMING bar; the trough itself is 150
    expect(buys[0].dir).toBe("bull");
    expect(buys[0].p).toBe(wave[150]);
    expect(buys[0].p!).toBeLessThanOrEqual(-60); // …and it happened inside the oversold zone
    expect(wave[151]).toBeGreaterThan(wave[150]); // the turn is real
    expect(wave[149]).toBeGreaterThan(wave[150]);
    expect(buys[0].strength).toBe(Math.round(Math.abs(wave[150])));

    // the marker sits 8 wave-units BELOW the trough, anchored on the trough bar
    const m = primOf(run(PULSE_SIGNALS_MODULE, PULSE_DIP), "ps-bs-150-m");
    expect(m.shape).toBe("triple-lines");
    expect(m.i).toBe(150);
    expect(m.p).toBeCloseTo(wave[150] - 8, 9);
    expect(m.fill).toBe(COLORS.up);
    expect(m.tooltipId).toBe("ps-bs-150");
  });

  it("mirrors it into a Pulse Sell on the overbought peak", () => {
    const sells = evOf(run(PULSE_SIGNALS_MODULE, PULSE_DIP), "pulse_sell");
    expect(sells.length).toBe(1);
    expect(sells[0].dir).toBe("bear");
    expect(sells[0].p!).toBeGreaterThanOrEqual(60);
    const m = primOf(run(PULSE_SIGNALS_MODULE, PULSE_DIP), `ps-bs-${sells[0].i - 1}-m`);
    expect(m.fill).toBe(COLORS.down);
    expect(m.p).toBeCloseTo(sells[0].p! + 8, 9);
  });

  it("gates prims — never the tape — on the family toggles and showLast", () => {
    const all = run(PULSE_SIGNALS_MODULE, PULSE_NOISE, { peaks: true, gappedCross: true });
    const none = run(PULSE_SIGNALS_MODULE, PULSE_NOISE, {
      buySell: false, dipDiamonds: false, peaks: false, gappedCross: false,
    });
    expect(none.prims).toEqual([]);
    expect(none.events).toEqual(all.events); // the alert bridge keeps firing
    for (const showLast of [4, 8, 16, 40]) {
      const res = run(PULSE_SIGNALS_MODULE, PULSE_NOISE, { showLast, peaks: true, gappedCross: true });
      for (const fam of ["ps-bs-", "ps-dip-", "ps-pk-", "ps-gc-"]) {
        const n = res.prims.filter((p) => p.id.startsWith(fam)).length;
        expect(n, `${fam} showLast=${showLast}`).toBeLessThanOrEqual(showLast);
      }
      expect(res.events).toEqual(all.events);
    }
  });

  it("honours the 5-bar per-family cooldown", () => {
    const byFam = new Map<string, number[]>();
    for (const e of run(PULSE_SIGNALS_MODULE, PULSE_NOISE, { peaks: true, gappedCross: true }).events ?? []) {
      const fam = `${e.type}|${e.dir}`;
      if (!byFam.has(fam)) byFam.set(fam, []);
      byFam.get(fam)!.push(e.i);
    }
    expect(byFam.size).toBeGreaterThan(2);
    for (const [fam, idxs] of byFam) {
      for (let k = 1; k < idxs.length; k++) {
        expect(idxs[k] - idxs[k - 1], `${fam} fired twice inside the cooldown`).toBeGreaterThanOrEqual(5);
      }
    }
  });
});

describe("pulse divergences", () => {
  it("detects on the pulse wave and draws one label per group, fan capped at 2", () => {
    const res = run(PULSE_DIVERGENCE_MODULE, PULSE_NOISE);
    const evs = evOf(res, "pulse_div");
    expect(evs.length, "the detector row contract regressed — nothing was read").toBeGreaterThan(2);

    const labels = res.prims.filter((p) => p.kind === "label") as any[];
    const conns = res.prims.filter((p) => p.kind === "poly") as any[];
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.length).toBeLessThanOrEqual(8); // default showLast
    expect(conns.length).toBeLessThanOrEqual(labels.length * 2);
    expect((res.tooltips ?? []).length).toBe(labels.length);
    for (const l of labels) expect(/^(Bull Div|Bear Div|H Bull|H Bear)( ×\d+)?$/.test(l.text)).toBe(true);
    for (const c of conns) {
      expect(c.pts.length).toBe(2);
      expect(c.pts[1].i).toBeGreaterThan(c.pts[0].i);
      for (const q of c.pts) {
        expect(q.p).toBeGreaterThanOrEqual(-100);
        expect(q.p).toBeLessThanOrEqual(100);
      }
    }
  });

  it("windows the drawing by showLast without touching the tape", () => {
    const few = run(PULSE_DIVERGENCE_MODULE, PULSE_NOISE, { showLast: 2 });
    const many = run(PULSE_DIVERGENCE_MODULE, PULSE_NOISE, { showLast: 16 });
    expect(few.events).toEqual(many.events);
    expect(few.prims.filter((p) => p.kind === "label").length).toBeLessThanOrEqual(2);
    expect(few.prims.length).toBeLessThan(many.prims.length);
  });

  it("drops the hidden classes when the toggle is off", () => {
    const on = run(PULSE_DIVERGENCE_MODULE, PULSE_NOISE);
    const off = run(PULSE_DIVERGENCE_MODULE, PULSE_NOISE, { hidden: false });
    const dashed = (r: ModuleResult) => r.prims.filter((p: any) => p.kind === "poly" && p.dash).length;
    expect(dashed(on)).toBeGreaterThan(0);
    expect(dashed(off)).toBe(0);
    expect((off.events ?? []).length).toBeLessThan((on.events ?? []).length);
  });
});

/**
 * ONE profile knob per pane. The Wave module owns `profile`; Signals and Divergences must read it
 * out of ctx.suite instead of carrying a private duplicate — a private copy silently detects on a
 * wave nobody is looking at.
 */
describe("pulse satellites follow the Wave module's profile", () => {
  it("re-detects divergences under the suite profile, on the wave that profile draws", () => {
    const scalper = run(PULSE_DIVERGENCE_MODULE, PULSE_NOISE, {}, "en", { "wave.profile": "scalper" });
    const swing = run(PULSE_DIVERGENCE_MODULE, PULSE_NOISE, {}, "en", { "wave.profile": "swing" });
    expect((scalper.events ?? []).length).toBeGreaterThan(0);
    expect((swing.events ?? []).length).toBeGreaterThan(0);
    expect(scalper.events, "the module ignored the suite profile").not.toEqual(swing.events);
    for (const [profile, res] of [["scalper", scalper], ["swing", swing]] as const) {
      const { wave } = computePulseWave(PULSE_NOISE, profile);
      const conns = res.prims.filter((p) => p.kind === "poly") as any[];
      expect(conns.length, `${profile} drew no connectors`).toBeGreaterThan(0);
      for (const c of conns) for (const q of c.pts) expect(q.p).toBeCloseTo(wave[q.i], 6);
    }
  });

  it("moves Pulse Signals with the suite profile and no longer honours a private one", () => {
    const scalper = run(PULSE_SIGNALS_MODULE, PULSE_NOISE, {}, "en", { "wave.profile": "scalper" });
    const swing = run(PULSE_SIGNALS_MODULE, PULSE_NOISE, {}, "en", { "wave.profile": "swing" });
    expect((scalper.events ?? []).length).toBeGreaterThan(0);
    expect(scalper.events, "the module ignored the suite profile").not.toEqual(swing.events);
    const { wave } = computePulseWave(PULSE_NOISE, "scalper");
    for (const e of evOf(scalper, "pulse_buy")) expect(e.p).toBeCloseTo(wave[e.i - 1], 6);
    // the removed per-module knob must steer nothing, even if a stale params blob still carries it
    expect(run(PULSE_SIGNALS_MODULE, PULSE_NOISE, { profile: "scalper" }).events)
      .toEqual(run(PULSE_SIGNALS_MODULE, PULSE_NOISE).events);
    expect(PULSE_SIGNALS_MODULE.fields.some((f) => f.key === "profile")).toBe(false);
    expect(PULSE_DIVERGENCE_MODULE.fields.some((f) => f.key === "profile")).toBe(false);
  });
});

describe("volumeMapping", () => {
  it("emits one sorted, pane-pinned column series", () => {
    const res = run(VOLUME_MAPPING_MODULE, PULSE_NOISE);
    expect(res.prims.length).toBe(1);
    const col = res.prims[0] as any;
    expect(col.kind).toBe("columns");
    expect(col.base).toBe(-108);
    expect(col.widthFrac).toBe(0.6);
    expect(col.items.length).toBeGreaterThan(400);
    let prevI = -1;
    for (const it of col.items) {
      expect(it.i, "columns items must be sorted by bar index").toBeGreaterThan(prevI);
      prevI = it.i;
      expect(it.v).toBeGreaterThan(-108); // above the baseline …
      expect(it.v).toBeLessThanOrEqual(-82); // … and never into the wave's lane
      expect(it.alpha).toBeLessThanOrEqual(1);
      expect([COLORS.flowBuy, COLORS.flowSell, COLORS.muted]).toContain(it.color);
    }
    // the tallest column is the window's volume maximum
    expect(Math.max(...col.items.map((x: any) => x.v))).toBeCloseTo(-82, 9);
  });

  it("keeps the dominance tape hysteretic (alternating sides, 5-bar cooldown)", () => {
    const evs = evOf(run(VOLUME_MAPPING_MODULE, PULSE_NOISE), "vmap_flip");
    expect(evs.length).toBeGreaterThan(3);
    for (let k = 1; k < evs.length; k++) {
      expect(evs[k].dir, "two flips to the same side in a row").not.toBe(evs[k - 1].dir);
      expect(evs[k].i - evs[k - 1].i).toBeGreaterThanOrEqual(5);
    }
    for (const e of evs) {
      expect(e.strength).toBeGreaterThanOrEqual(0);
      expect(e.strength).toBeLessThanOrEqual(100);
      expect(Math.abs(e.p!)).toBeLessThanOrEqual(100);
    }
  });

  it("shrinks the rail when the volume window is widened past a spike", () => {
    const spiky = PULSE_NOISE.map((b, i) => (i === 100 ? { ...b, v: 500000 } : b));
    const short = run(VOLUME_MAPPING_MODULE, spiky, { window: 50 }).prims[0] as any;
    const long = run(VOLUME_MAPPING_MODULE, spiky, { window: 400 }).prims[0] as any;
    const at = (c: any, i: number) => c.items.find((x: any) => x.i === i)?.v;
    expect(at(long, 300)).toBeLessThan(at(short, 300)); // the memory of the spike keeps scaling it
  });
});

describe("money flows", () => {
  it("draws the selected line(s) inside the pane", () => {
    const mfi = run(FLOWS_MODULE, PULSE_NOISE);
    const cvd = run(FLOWS_MODULE, PULSE_NOISE, { source: "cvd" });
    const both = run(FLOWS_MODULE, PULSE_NOISE, { source: "both" });
    expect(primOf(mfi, "flow-mfi")).toBeDefined();
    expect(primOf(mfi, "flow-cvd")).toBeUndefined();
    expect(primOf(cvd, "flow-cvd")).toBeDefined();
    expect(primOf(both, "flow-mfi")).toBeDefined();
    expect(primOf(both, "flow-cvd").dash).toBe("4 3"); // separable when they share the pane
    for (const id of ["flow-mfi", "flow-cvd"]) {
      const line = primOf(both, id);
      expect(line.pts.length).toBeGreaterThan(100);
      for (const q of line.pts) expect(Math.abs(q.p)).toBeLessThanOrEqual(100);
    }
  });

  it("labels divergences D / H and keeps the tape independent of the toggle", () => {
    const on = run(FLOWS_MODULE, PULSE_NOISE);
    const off = run(FLOWS_MODULE, PULSE_NOISE, { divergences: false });
    expect(evOf(on, "flow_div").length).toBeGreaterThan(2);
    expect(off.events).toEqual(on.events);
    expect(off.prims.every((p) => !p.id.startsWith("flow-div-"))).toBe(true);

    const labels = on.prims.filter((p) => p.id.startsWith("flow-div-") && p.kind === "label") as any[];
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.length).toBeLessThanOrEqual(6); // default showLast
    for (const l of labels) expect(["D", "H"]).toContain(l.text);
    expect((on.tooltips ?? []).length).toBe(labels.length);
  });

  it("windows the drawing by showLast", () => {
    for (const showLast of [2, 6, 12]) {
      const res = run(FLOWS_MODULE, PULSE_NOISE, { showLast });
      const labels = res.prims.filter((p) => p.id.endsWith("-l") && p.kind === "label");
      expect(labels.length).toBeLessThanOrEqual(showLast);
    }
  });
});

// ─── 17. RSI Ultimate suite ───────────────────────────────────────────────────

const RSI_BARS = walkBars(600, 77, 29);
const rsiOf = (bars: SuiteBar[]) =>
  computeUltimateRsi(bars, RSI_DEFAULTS.len, RSI_DEFAULTS.source, RSI_DEFAULTS.smoothLen, RSI_DEFAULTS.smoothType);

describe("rsiEngine", () => {
  it("draws the RSI itself, inside 0..100, colored by band", () => {
    const { rsi } = rsiOf(RSI_BARS);
    const res = run(RSI_ENGINE_MODULE, RSI_BARS);
    const wave = primOf(res, "rsi-wave");
    expect(wave.pts.length).toBeGreaterThan(500);
    for (let k = 0; k < wave.pts.length; k++) {
      const { i, p } = wave.pts[k];
      expect(p).toBe(rsi[i]); // the pane draws the series, not a re-derivation
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(100);
      const want =
        p >= 65 ? COLORS.down : p <= 35 ? COLORS.up : Math.abs(p - 50) < 8 ? COLORS.muted : COLORS.brand;
      expect(wave.colors[k], `bar ${i} @ ${p}`).toBe(want);
    }
    expect(primOf(res, "rsi-smooth")).toBeDefined();
    expect(primOf(run(RSI_ENGINE_MODULE, RSI_BARS, { smooth: false }), "rsi-smooth")).toBeUndefined();
  });

  it("fills only OUTSIDE the 65/35 band, pinned to the level it broke", () => {
    const fills = run(RSI_ENGINE_MODULE, RSI_BARS).prims.filter((p) => p.id.startsWith("rsi-fill-")) as any[];
    expect(fills.length).toBeGreaterThan(3);
    for (const f of fills) {
      expect(f.kind).toBe("cloud");
      expect(f.upper.length).toBe(f.lower.length);
      expect(f.fillAlpha).toBeLessThanOrEqual(0.18);
      const ob = f.segColors[0] === COLORS.down;
      const level = ob ? 65 : 35;
      const flat = ob ? f.lower : f.upper; // the rail side is pinned to the level
      const free = ob ? f.upper : f.lower;
      for (const q of flat) expect(q.p).toBe(level);
      let outside = 0;
      for (const q of free) {
        if (ob) expect(q.p).toBeGreaterThanOrEqual(level);
        else expect(q.p).toBeLessThanOrEqual(level);
        if (q.p !== level) outside++;
      }
      expect(outside, "a fill run with no excursion in it").toBeGreaterThan(0);
    }
  });

  it("reports exactly the 65 / 35 / 50 transitions the series made", () => {
    const { rsi } = rsiOf(RSI_BARS);
    const want: Array<[string, string, number]> = [];
    let prev = NaN;
    for (let i = 0; i < RSI_BARS.length; i++) {
      const v = rsi[i];
      if (!Number.isFinite(v)) continue;
      if (Number.isFinite(prev)) {
        if (prev < 65 && v >= 65) want.push(["rsi_ob_enter", "bear", i]);
        else if (prev > 35 && v <= 35) want.push(["rsi_os_enter", "bull", i]);
        if (prev < 50 && v >= 50) want.push(["rsi_mid_cross", "bull", i]);
        else if (prev > 50 && v <= 50) want.push(["rsi_mid_cross", "bear", i]);
      }
      prev = v;
    }
    const got = (run(RSI_ENGINE_MODULE, RSI_BARS).events ?? []).map((e) => [e.type, e.dir, e.i]);
    expect(want.length).toBeGreaterThan(20);
    expect(got).toEqual(want.slice(-80)); // the tape is tail-capped at MAX_EVENTS
  });

  it("responds to length and source without leaving the pane", () => {
    const fast = run(RSI_ENGINE_MODULE, RSI_BARS, { len: 4 });
    const slow = run(RSI_ENGINE_MODULE, RSI_BARS, { len: 34 });
    expect(primOf(fast, "rsi-wave").pts).not.toEqual(primOf(slow, "rsi-wave").pts);
    for (const src of ["close", "hl2", "hlc3"]) {
      for (const q of primOf(run(RSI_ENGINE_MODULE, RSI_BARS, { source: src }), "rsi-wave").pts) {
        expect(q.p).toBeGreaterThanOrEqual(0);
        expect(q.p).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe("rsiSignals", () => {
  const { rsi, smooth } = rsiOf(RSI_BARS);

  it("fires at most one reversal per excursion into a zone", () => {
    const revs = evOf(run(RSI_SIGNALS_MODULE, RSI_BARS), "rsix_reversal");
    expect(revs.length).toBeGreaterThan(4);
    for (const e of revs) {
      expect(e.p).toBe(rsi[e.i]);
      if (e.dir === "bull") expect(e.p!).toBeLessThanOrEqual(35);
      else expect(e.p!).toBeGreaterThanOrEqual(65);
    }
    // between two same-side signals the RSI must have left the zone (the re-arm rule)
    for (let k = 1; k < revs.length; k++) {
      const a = revs[k - 1];
      const b = revs[k];
      if (a.dir !== b.dir) continue;
      let left = false;
      for (let i = a.i + 1; i < b.i; i++) {
        const v = rsi[i];
        if (!Number.isFinite(v)) continue;
        if (a.dir === "bull" ? v > 35 : v < 65) left = true;
      }
      expect(left, `two ${a.dir} reversals at ${a.i}/${b.i} without leaving the zone`).toBe(true);
    }
  });

  it("projects the deviation levels 12 and 24 points out and dates their first touch", () => {
    const res = run(RSI_SIGNALS_MODULE, RSI_BARS);
    const revs = evOf(res, "rsix_reversal");
    const touches = evOf(res, "rsix_dev_touch");
    expect(touches.length).toBeGreaterThan(2);
    for (const t of touches) {
      expect([50, 100]).toContain(t.strength);
      const step = t.strength === 50 ? 1 : 2;
      const sig = revs.find((r) => r.dir === t.dir && r.i < t.i && t.i - r.i <= 12);
      expect(sig, `dev touch at ${t.i} has no parent signal`).toBeDefined();
      const want = sig!.p! + (t.dir === "bull" ? 1 : -1) * 12 * step;
      expect(t.p).toBeCloseTo(want, 9);
      // the touch is the FIRST bar that reached it
      for (let j = sig!.i + 1; j < t.i; j++) {
        const v = rsi[j];
        if (!Number.isFinite(v)) continue;
        expect(t.dir === "bull" ? v < want : v > want, `bar ${j} touched first`).toBe(true);
      }
    }
    const line = res.prims.find((p) => /^rsix-dev-\d+-1$/.test(p.id)) as any;
    expect(line.kind).toBe("line");
    expect(line.b.i - line.a.i).toBe(12); // carried 12 bars, then dropped
    expect(line.a.p).toBe(line.b.p);
  });

  it("plots crossover dots only outside the 45–55 neutral band", () => {
    const res = run(RSI_SIGNALS_MODULE, RSI_BARS);
    const dots = res.prims.filter((p) => p.id.startsWith("rsix-x-")) as any[];
    expect(dots.length).toBeGreaterThan(3);
    for (const d of dots) {
      expect(d.p === rsi[d.i]).toBe(true);
      expect(d.p < 45 || d.p > 55, `dot at ${d.i} sits in the neutral band`).toBe(true);
      // it really is a cross of the two series
      const prev = (() => {
        for (let j = d.i - 1; j >= 0; j--) if (Number.isFinite(rsi[j]) && Number.isFinite(smooth[j])) return j;
        return -1;
      })();
      expect((rsi[prev] - smooth[prev]) * (rsi[d.i] - smooth[d.i])).toBeLessThan(0);
    }
    expect(run(RSI_SIGNALS_MODULE, RSI_BARS, { crossDots: false }).prims.some((p) => p.id.startsWith("rsix-x-"))).toBe(false);
  });

  it("gates prims — never the tape — on the toggles and showLast", () => {
    const all = run(RSI_SIGNALS_MODULE, RSI_BARS);
    const none = run(RSI_SIGNALS_MODULE, RSI_BARS, { signals: false, deviations: false, crossDots: false });
    expect(none.prims).toEqual([]);
    expect(none.events).toEqual(all.events);
    for (const showLast of [4, 12, 30]) {
      const res = run(RSI_SIGNALS_MODULE, RSI_BARS, { showLast, crossDots: false });
      expect(res.prims.filter((p) => /^rsix-sig-\d+-m$/.test(p.id)).length).toBeLessThanOrEqual(showLast);
      expect(res.events).toEqual(all.events);
    }
  });
});

describe("rsiChannels", () => {
  const { rsi } = rsiOf(RSI_BARS);
  const railsOf = (res: ModuleResult) => ({
    up: primOf(res, "rsix-ch-up").pts as Array<{ i: number; p: number }>,
    lo: primOf(res, "rsix-ch-lo").pts as Array<{ i: number; p: number }>,
    mid: primOf(res, "rsix-ch-mid").pts as Array<{ i: number; p: number }>,
  });

  it("keeps the three rails ordered and the models genuinely distinct", () => {
    const seen: string[] = [];
    for (const model of ["bollinger", "keltner", "donchian"]) {
      const { up, lo, mid } = railsOf(run(RSI_CHANNELS_MODULE, RSI_BARS, { model }));
      expect(up.length).toBeGreaterThan(400);
      expect(lo.length).toBe(up.length);
      expect(mid.length).toBe(up.length);
      for (let k = 0; k < up.length; k++) {
        expect(up[k].i).toBe(lo[k].i);
        expect(up[k].p, `${model} bar ${up[k].i}`).toBeGreaterThanOrEqual(mid[k].p - 1e-9);
        expect(mid[k].p).toBeGreaterThanOrEqual(lo[k].p - 1e-9);
      }
      seen.push(JSON.stringify(up.slice(0, 40)));
    }
    expect(new Set(seen).size, "two channel models produced identical rails").toBe(3);
  });

  it("builds the Donchian staircase from the bars BEFORE i, so a break is possible", () => {
    const { up, lo } = railsOf(run(RSI_CHANNELS_MODULE, RSI_BARS, { model: "donchian", length: 20 }));
    const finite: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i < RSI_BARS.length; i++) if (Number.isFinite(rsi[i])) { finite.push(rsi[i]); idx.push(i); }
    const at = new Map(idx.map((i, k) => [i, k]));
    let checked = 0;
    for (const q of up.slice(0, 120)) {
      const k = at.get(q.i)!;
      const win = finite.slice(k - 20, k); // the 20 DEFINED values strictly before this bar
      expect(q.p, `up rail at ${q.i}`).toBeCloseTo(Math.max(...win), 9);
      checked++;
    }
    expect(checked).toBeGreaterThan(100);
    for (const q of lo.slice(0, 40)) {
      const k = at.get(q.i)!;
      expect(q.p).toBeCloseTo(Math.min(...finite.slice(k - 20, k)), 9);
    }
    expect(evOf(run(RSI_CHANNELS_MODULE, RSI_BARS, { model: "donchian" }), "rsix_chan_break").length).toBeGreaterThan(0);
  });

  it("pins the break dots to the opposite pane margin and respects the cooldown", () => {
    for (const model of ["bollinger", "keltner", "donchian"]) {
      const res = run(RSI_CHANNELS_MODULE, RSI_BARS, { model, length: 20 });
      const evs = evOf(res, "rsix_chan_break");
      const dots = res.prims.filter((p) => /^rsix-chb-\d+-m$/.test(p.id)) as any[];
      expect(dots.length, `${model} drew no break dots`).toBeGreaterThan(0);
      expect(dots.length).toBeLessThanOrEqual(evs.length);
      for (const d of dots) {
        const ev = evs.find((e) => e.i === d.i)!;
        expect(ev).toBeDefined();
        expect(d.p).toBe(ev.dir === "bull" ? 4 : 96); // up-break pinned low, down-break pinned high
        expect(d.fill).toBe(ev.dir === "bull" ? COLORS.up : COLORS.down);
      }
      const perDir: Record<string, number> = {};
      for (const e of evs) {
        const last = perDir[e.dir];
        if (last !== undefined) expect(e.i - last, `${model} ${e.dir} cooldown`).toBeGreaterThanOrEqual(10);
        perDir[e.dir] = e.i;
      }
    }
  });

  it("returns an empty result when the series is shorter than the window", () => {
    expect(run(RSI_CHANNELS_MODULE, RSI_BARS.slice(0, 25), { length: 60 }).prims).toEqual([]);
  });
});

describe("rsiDivergence", () => {
  it("draws one label per group with the fan capped at 2 connectors", () => {
    const res = run(RSI_DIVERGENCE_MODULE, RSI_BARS);
    expect(evOf(res, "rsix_div").length).toBeGreaterThan(2);
    const labels = res.prims.filter((p) => p.kind === "label") as any[];
    const conns = res.prims.filter((p) => p.kind === "poly") as any[];
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.length).toBeLessThanOrEqual(8);
    expect(conns.length).toBeLessThanOrEqual(labels.length * 2);
    expect((res.tooltips ?? []).length).toBe(labels.length);
    const { rsi } = rsiOf(RSI_BARS);
    for (const c of conns) for (const q of c.pts) expect(q.p).toBe(rsi[q.i]);
  });

  it("windows the drawing by showLast and honours the hidden toggle", () => {
    const few = run(RSI_DIVERGENCE_MODULE, RSI_BARS, { showLast: 2 });
    const many = run(RSI_DIVERGENCE_MODULE, RSI_BARS, { showLast: 16 });
    expect(few.events).toEqual(many.events);
    expect(few.prims.filter((p) => p.kind === "label").length).toBeLessThanOrEqual(2);
    const off = run(RSI_DIVERGENCE_MODULE, RSI_BARS, { hidden: false });
    expect((off.events ?? []).length).toBeLessThan((many.events ?? []).length);
    expect(off.prims.some((p: any) => p.kind === "poly" && p.dash)).toBe(false);
  });
});

/**
 * The Engine owns the RSI; the satellites must DRAW ON IT. Each case retunes the Engine through the
 * suite-wide flat params (what host.ts hands a module as ctx.suite) and asserts the satellite's
 * geometry lands on the retuned curve — the regression guard for satellites recomputing from
 * RSI_DEFAULTS, which detached every glyph from the wave the moment a user changed the length.
 */
describe("rsix satellites follow the Engine's user settings", () => {
  const TUNE = { len: 4, smoothLen: 3, smoothType: "wma" };
  const FLAT = { "eng.len": 4, "eng.smoothLen": 3, "eng.smoothType": "wma" };
  /** bar index -> the Engine's own drawn RSI under TUNE. */
  const engineCurve = () =>
    new Map<number, number>(
      (primOf(run(RSI_ENGINE_MODULE, RSI_BARS, TUNE), "rsi-wave").pts as Array<{ i: number; p: number }>)
        .map((q) => [q.i, q.p] as [number, number]),
    );

  it("pins every RSI Signals glyph to the retuned Engine curve", () => {
    const curve = engineCurve();
    const tuned = run(RSI_SIGNALS_MODULE, RSI_BARS, {}, "en", FLAT);
    expect(tuned.events, "the retune did not move the module — it is still on RSI_DEFAULTS")
      .not.toEqual(run(RSI_SIGNALS_MODULE, RSI_BARS).events);

    // crossover dots sit ON the curve: marker y IS the Engine's value at that bar
    const dots = tuned.prims.filter((p) => /^rsix-x-\d+$/.test(p.id)) as any[];
    expect(dots.length).toBeGreaterThan(3);
    for (const d of dots) expect(d.p).toBeCloseTo(curve.get(d.i)!, 6);

    const revs = evOf(tuned, "rsix_reversal");
    expect(revs.length).toBeGreaterThan(2);
    for (const e of revs) {
      expect(e.p).toBeCloseTo(curve.get(e.i)!, 6);
      const m = tuned.prims.find((p) => p.id === `rsix-sig-${e.i}-m`) as any;
      if (!m) continue; // outside showLast
      expect(m.p).toBeCloseTo(clampTo(curve.get(e.i)! + (e.dir === "bull" ? -6 : 6), 2, 98), 6);
    }
  });

  it("re-detects RSI Divergence and RSI Channels on the retuned curve", () => {
    const curve = engineCurve();
    const div = run(RSI_DIVERGENCE_MODULE, RSI_BARS, {}, "en", FLAT);
    expect(div.events).not.toEqual(run(RSI_DIVERGENCE_MODULE, RSI_BARS).events);
    const conns = div.prims.filter((p) => p.kind === "poly") as any[];
    expect(conns.length).toBeGreaterThan(0);
    for (const c of conns) for (const q of c.pts) expect(q.p).toBeCloseTo(curve.get(q.i)!, 6);

    const chan = run(RSI_CHANNELS_MODULE, RSI_BARS, {}, "en", FLAT);
    expect(chan.events).not.toEqual(run(RSI_CHANNELS_MODULE, RSI_BARS).events);
    const breaks = evOf(chan, "rsix_chan_break");
    expect(breaks.length).toBeGreaterThan(0);
    for (const b of breaks) expect(b.p).toBeCloseTo(curve.get(b.i)!, 6);
  });

  it("falls back to the Engine defaults when ctx.suite is absent", () => {
    for (const mod of [RSI_SIGNALS_MODULE, RSI_DIVERGENCE_MODULE, RSI_CHANNELS_MODULE]) {
      const bare: any = { ...ctxFor(mod, RSI_BARS) };
      delete bare.suite;
      expect(mod.compute(bare), `${mod.key} without ctx.suite`).toEqual(run(mod, RSI_BARS));
    }
  });
});

// ─── 18. MACD Ultimate suite ──────────────────────────────────────────────────

/**
 * Deterministic multi-period wave. The three sines put the normalized MACD against BOTH saturation
 * rails several times, which is what makes the extreme-zone signal gate testable; the path is not
 * piecewise-linear anywhere, so the ±100 normalization never degenerates into a constant.
 */
function macdWavePath(n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push(100 + 20 * Math.sin(i / 17) + 8 * Math.sin(i / 5) + 3 * Math.sin(i / 41) + i * 0.01);
  }
  return out;
}
const MACD_BARS = pathBars(macdWavePath(400));
const macdOf = (bars: SuiteBar[]) => {
  const d = MACDX_ENGINE_DEFAULTS;
  return computeUltimateMacd(bars, d.fast, d.slow, d.signalLen, d.oscMa, d.sigMa);
};

describe("macdEngine", () => {
  it("draws the normalized curve and its signal line on one ±100 scale", () => {
    const { macd, signal } = macdOf(MACD_BARS);
    const res = run(MACD_ENGINE_MODULE, MACD_BARS);
    const curve = primOf(res, "mx-eng-macd");
    const sig = primOf(res, "mx-eng-signal");
    expect(curve.pts.length).toBeGreaterThan(300);
    for (const q of curve.pts) {
      expect(q.p).toBe(macd[q.i]);
      expect(Math.abs(q.p)).toBeLessThanOrEqual(100);
    }
    for (const q of sig.pts) {
      expect(q.p).toBe(signal[q.i]);
      expect(Math.abs(q.p)).toBeLessThanOrEqual(100);
    }
    expect(curve.pts.some((q: any) => Math.abs(q.p) >= 99)).toBe(true); // the rails are reached
  });

  it("caps the pane with OB/OS strips inside the alpha discipline", () => {
    const res = run(MACD_ENGINE_MODULE, MACD_BARS);
    const ob = primOf(res, "mx-eng-ob");
    const os = primOf(res, "mx-eng-os");
    expect([ob.p1, ob.p2]).toEqual([100, 120]);
    expect([os.p1, os.p2]).toEqual([-100, -120]);
    expect(ob.i2).toBe("right");
    expect(ob.fillAlpha).toBeLessThanOrEqual(0.18);
    expect(ob.fill).toBe(COLORS.down);
    expect(os.fill).toBe(COLORS.up);
  });

  it("separates the heatmap and slope color modes", () => {
    const heat = primOf(run(MACD_ENGINE_MODULE, MACD_BARS), "mx-eng-macd");
    const slope = primOf(run(MACD_ENGINE_MODULE, MACD_BARS, { colorMode: "slope" }), "mx-eng-macd");
    expect(slope.colors).not.toEqual(heat.colors);
    heat.pts.forEach((q: any, k: number) => {
      const a = Math.abs(q.p);
      expect(heat.colors[k], `bar ${q.i}`).toBe(
        a < 40 ? COLORS.muted : a <= 80 ? COLORS.brand : q.p < 0 ? COLORS.up : COLORS.down,
      );
    });
    for (const c of slope.colors) expect([COLORS.up, COLORS.down, COLORS.muted]).toContain(c);
  });

  it("reports exactly the zero crosses the curve made", () => {
    const { macd } = macdOf(MACD_BARS);
    const want: Array<[string, number]> = [];
    let prev = NaN;
    for (let i = 0; i < MACD_BARS.length; i++) {
      const v = macd[i];
      if (!Number.isFinite(v)) continue;
      if (Number.isFinite(prev) && ((prev < 0 && v > 0) || (prev > 0 && v < 0))) {
        want.push([v > 0 ? "bull" : "bear", i]);
      }
      prev = v;
    }
    const got = (run(MACD_ENGINE_MODULE, MACD_BARS).events ?? []).map((e) => [e.dir, e.i]);
    expect(want.length).toBeGreaterThan(5);
    expect(got).toEqual(want.slice(-80));
  });
});

describe("macdSignals", () => {
  /** Every macd × signal cross, with the side it happened on — the reference the gate is read against. */
  function crossesOf(bars: SuiteBar[]): Array<{ i: number; bull: boolean; m: number }> {
    const { macd, signal } = macdOf(bars);
    const out: Array<{ i: number; bull: boolean; m: number }> = [];
    let pm = NaN;
    let ps = NaN;
    for (let i = 0; i < bars.length; i++) {
      const m = macd[i];
      const g = signal[i];
      if (!Number.isFinite(m) || !Number.isFinite(g)) continue;
      if (Number.isFinite(pm) && Number.isFinite(ps)) {
        if (pm <= ps && m > g) out.push({ i, bull: true, m });
        else if (pm >= ps && m < g) out.push({ i, bull: false, m });
      }
      pm = m;
      ps = g;
    }
    return out;
  }

  it("fires only on a cross that happens inside its own extreme zone", () => {
    const all = crossesOf(MACD_BARS);
    expect(all.length).toBeGreaterThan(20); // most crosses are mid-range noise …
    for (const threshold of [60, 80, 95]) {
      const want = all
        .filter((c) => (c.bull ? c.m <= -threshold : c.m >= threshold))
        .map((c) => [c.bull ? "bull" : "bear", c.i]);
      const got = (run(MACD_SIGNALS_MODULE, MACD_BARS, { threshold }).events ?? []).map((e) => [e.dir, e.i]);
      expect(got, `threshold=${threshold}`).toEqual(want);
    }
    const at80 = (run(MACD_SIGNALS_MODULE, MACD_BARS, { threshold: 80 }).events ?? []);
    expect(at80.length, "the fixture no longer exercises the extreme zone").toBeGreaterThan(0);
    for (const e of at80) {
      expect(Math.abs(e.p!)).toBeGreaterThanOrEqual(80);
      expect(e.dir).toBe(e.p! < 0 ? "bull" : "bear"); // ▲ out of oversold, ▼ out of overbought
      expect(e.strength).toBe(Math.round(Math.abs(e.p!)));
    }
  });

  it("shrinks monotonically as the zone is deepened", () => {
    const key = (r: ModuleResult) => (r.events ?? []).map((e) => `${e.dir}|${e.i}`);
    const wide = new Set(key(run(MACD_SIGNALS_MODULE, MACD_BARS, { threshold: 60 })));
    const mid = key(run(MACD_SIGNALS_MODULE, MACD_BARS, { threshold: 80 }));
    const deep = key(run(MACD_SIGNALS_MODULE, MACD_BARS, { threshold: 95 }));
    expect(mid.every((k) => wide.has(k))).toBe(true);
    expect(deep.every((k) => mid.includes(k))).toBe(true);
    expect(mid.length).toBeLessThan(wide.size);
  });

  it("stands the triangle off the curve, inside the pane, capped by showLast", () => {
    const res = run(MACD_SIGNALS_MODULE, MACD_BARS, { threshold: 60 });
    const evs = res.events ?? [];
    for (const m of res.prims as any[]) {
      const ev = evs.find((e) => `mx-sig-${e.i}-m` === m.id)!;
      expect(ev).toBeDefined();
      expect(m.shape).toBe(ev.dir === "bull" ? "tri-up" : "tri-down");
      expect(m.p).toBeCloseTo(ev.p! + (ev.dir === "bull" ? -10 : 10), 9);
      expect(m.p).toBeGreaterThanOrEqual(-118);
      expect(m.p).toBeLessThanOrEqual(118);
    }
    for (const showLast of [4, 8, 24]) {
      const r = run(MACD_SIGNALS_MODULE, MACD_BARS, { threshold: 60, showLast });
      expect(r.prims.length).toBeLessThanOrEqual(showLast);
      expect(r.events).toEqual(evs); // the tape is never gated by the draw cap
    }
  });
});

describe("macdHistogram", () => {
  it("emits sorted columns off a zero baseline, in pane units", () => {
    const { hist } = macdOf(MACD_BARS);
    const col = primOf(run(MACD_HISTOGRAM_MODULE, MACD_BARS), "mx-hist-cols");
    expect(col.kind).toBe("columns");
    expect(col.base).toBe(0);
    expect(col.items.length).toBeGreaterThan(300);
    let prevI = -1;
    for (const it of col.items) {
      expect(it.i, "columns items must be sorted by bar index").toBeGreaterThan(prevI);
      prevI = it.i;
      expect(it.v).toBe(clampTo(hist[it.i], -100, 100));
      expect(Math.abs(it.v)).toBeLessThanOrEqual(100);
      expect(it.color).toBe(hist[it.i] > 0 ? COLORS.up : COLORS.down);
    }
  });

  it("encodes momentum as an expanding / contracting alpha tier", () => {
    const { hist } = macdOf(MACD_BARS);
    const items = primOf(run(MACD_HISTOGRAM_MODULE, MACD_BARS), "mx-hist-cols").items as any[];
    const tiers = new Set(items.map((x) => x.alpha));
    expect([...tiers].sort()).toEqual([0.35, 0.8]); // exactly two tiers, both under 1
    expect(items[0].alpha).toBe(0.8); // nothing to shrink from yet
    for (let k = 1; k < items.length; k++) {
      const a = Math.abs(hist[items[k].i]);
      const b = Math.abs(hist[items[k - 1].i]);
      expect(items[k].alpha, `bar ${items[k].i}`).toBe(a >= b ? 0.8 : 0.35);
    }
  });

  it("publishes a flip only once the new side survives a second bar", () => {
    const { hist } = macdOf(MACD_BARS);
    const res = run(MACD_HISTOGRAM_MODULE, MACD_BARS);
    const flips = evOf(res, "macdx_hist_flip");
    expect(flips.length).toBeGreaterThan(5);
    const sideAt = (i: number) => (hist[i] > 0 ? 1 : hist[i] < 0 ? -1 : 0);
    for (const f of flips) {
      const want = f.dir === "bull" ? 1 : -1;
      expect(sideAt(f.i)).toBe(want);
      // the next defined bar holds the same side — that is the confirmation
      let next = -1;
      for (let j = f.i + 1; j < MACD_BARS.length; j++) if (Number.isFinite(hist[j])) { next = j; break; }
      expect(sideAt(next), `flip at ${f.i} was not confirmed`).toBe(want);
      expect(f.label, "the prior side's length rides in the label").toMatch(/\d+ bars$/);
    }
    for (let k = 1; k < flips.length; k++) {
      expect(flips[k].dir, "two flips to the same side in a row").not.toBe(flips[k - 1].dir);
    }
    const marks = res.prims.filter((p) => p.kind === "label") as any[];
    expect(marks.length).toBeLessThanOrEqual(40);
    for (const m of marks) expect(m.text).toBe("+"); // language-neutral microcopy
    expect(run(MACD_HISTOGRAM_MODULE, MACD_BARS, { flips: false }).prims.length).toBe(1);
    expect(run(MACD_HISTOGRAM_MODULE, MACD_BARS, { flips: false }).events).toEqual(res.events);
  });
});

describe("macdTrend — phase hysteresis", () => {
  it("commits a phase only on 3 aligned bars past the signal line", () => {
    const { macd, signal } = macdOf(MACD_BARS);
    const commits = evOf(run(MACD_TREND_MODULE, MACD_BARS), "macdx_phase");
    expect(commits.length).toBeGreaterThan(4);
    for (const c of commits) {
      const bull = c.dir === "bull";
      expect(bull ? macd[c.i] > signal[c.i] : macd[c.i] < signal[c.i], `commit ${c.i} is on the wrong side`).toBe(true);
      // three consecutive moves in the phase's direction ending on the commit bar
      const seq: number[] = [];
      for (let j = c.i; j >= 0 && seq.length < 4; j--) if (Number.isFinite(macd[j])) seq.unshift(macd[j]);
      expect(seq.length).toBe(4);
      for (let k = 1; k < 4; k++) {
        expect(bull ? seq[k] > seq[k - 1] : seq[k] < seq[k - 1], `commit ${c.i} step ${k}`).toBe(true);
      }
    }
  });

  it("never flips on a one-bar wiggle (the lane is a regime, not an event stream)", () => {
    // the noisy fixture is the one that chops: it is full of single counter-trend bars inside a
    // committed phase, and NONE of them may move the lane.
    const bars = walkBars(600, 77, 29);
    const { macd } = macdOf(bars);
    const commits = evOf(run(MACD_TREND_MODULE, bars), "macdx_phase");
    expect(commits.length).toBeGreaterThan(4);
    for (let k = 1; k < commits.length; k++) {
      expect(commits[k].dir, "two commits to the same side in a row").not.toBe(commits[k - 1].dir);
    }
    const fin: number[] = [];
    for (let i = 0; i < bars.length; i++) if (Number.isFinite(macd[i])) fin.push(i);
    const commitAt = new Map(commits.map((c) => [c.i, c.dir]));

    // Walk the phase timeline and measure how long each counter-trend excursion lasted. A run of
    // 1 or 2 bars is a wiggle and must leave the lane alone; only a run reaching STREAK (3) that is
    // ALSO on the far side of the signal line may commit — and when it does, the module must have
    // published exactly that commit on that bar.
    let phase = 0;
    let counterRun = 0;
    let wiggles = 0;
    for (let x = 1; x < fin.length; x++) {
      const i = fin[x];
      const moved = macd[i] - macd[fin[x - 1]];
      const dir = commitAt.get(i);
      if (phase !== 0) {
        const counter = phase > 0 ? moved < 0 : moved > 0;
        if (counter) {
          counterRun++;
          if (counterRun < 3) {
            expect(dir, `a ${counterRun}-bar wiggle at ${i} flipped the phase`).toBeUndefined();
            wiggles++;
          }
        } else counterRun = 0;
      }
      if (dir) phase = dir === "bull" ? 1 : -1;
    }
    expect(wiggles, "the fixture no longer exercises the hysteresis").toBeGreaterThan(20);
  });

  it("paints one dotted lane, outside the ±100 rails, for the last 300 bars only", () => {
    const res = run(MACD_TREND_MODULE, MACD_BARS);
    const sq = res.prims.filter((p) => p.kind === "marker") as any[];
    expect(sq.length).toBeGreaterThan(20);
    for (const s of sq) {
      expect([-112, 112]).toContain(s.p);
      expect(s.p === -112 ? s.fill === COLORS.up : s.fill === COLORS.down).toBe(true);
      expect(s.i % 2).toBe(0); // STRIDE 2
      expect(s.i).toBeGreaterThanOrEqual(MACD_BARS.length - 300);
      expect(s.alpha).toBeLessThanOrEqual(1);
    }
    // exactly one lane per bar, and the tooltip only rides the first square of each run
    expect(new Set(sq.map((s) => s.i)).size).toBe(sq.length);
    expect((res.tooltips ?? []).length).toBe(sq.filter((s) => s.tooltipId).length);
  });
});

describe("macdDivergence", () => {
  it("draws one label per group with the fan capped at 2 connectors", () => {
    const res = run(MACD_DIVERGENCE_MODULE, MACD_BARS);
    const { macd } = macdOf(MACD_BARS);
    expect(evOf(res, "macdx_div").length).toBeGreaterThan(2);
    const labels = res.prims.filter((p) => p.kind === "label") as any[];
    const conns = res.prims.filter((p) => p.kind === "poly") as any[];
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.length).toBeLessThanOrEqual(8);
    expect(conns.length).toBeLessThanOrEqual(labels.length * 2);
    for (const c of conns) for (const q of c.pts) expect(q.p).toBe(macd[q.i]);
  });

  it("windows the drawing by showLast and honours the hidden toggle", () => {
    const few = run(MACD_DIVERGENCE_MODULE, MACD_BARS, { showLast: 2 });
    const many = run(MACD_DIVERGENCE_MODULE, MACD_BARS, { showLast: 16 });
    expect(few.events).toEqual(many.events);
    expect(few.prims.filter((p) => p.kind === "label").length).toBeLessThanOrEqual(2);
    const off = run(MACD_DIVERGENCE_MODULE, MACD_BARS, { hidden: false });
    expect((off.events ?? []).length).toBeLessThan((many.events ?? []).length);
    expect(off.prims.some((p: any) => p.kind === "poly" && p.dash)).toBe(false);
  });
});

/**
 * Same guard for the MACD pane: the four satellites build their series through
 * `sharedMacd(bars, ctx.suite)`, so retuning the Engine's fast/slow must move the histogram, the
 * triangles, the connectors and the phase lane with the curve — not leave them on the defaults.
 */
describe("macdx satellites follow the Engine's user settings", () => {
  const TUNE = { fast: 4, slow: 60 };
  const FLAT = { "eng.fast": 4, "eng.slow": 60 };
  const tuned = () => {
    const d = MACDX_ENGINE_DEFAULTS;
    return computeUltimateMacd(MACD_BARS, TUNE.fast, TUNE.slow, d.signalLen, d.oscMa, d.sigMa);
  };

  it("draws the histogram of the retuned Engine, column for column", () => {
    const { hist } = tuned();
    const res = run(MACD_HISTOGRAM_MODULE, MACD_BARS, {}, "en", FLAT);
    const items = primOf(res, "mx-hist-cols").items as any[];
    expect(items.length).toBeGreaterThan(200);
    expect(primOf(run(MACD_HISTOGRAM_MODULE, MACD_BARS), "mx-hist-cols").items,
      "the retune did not move the columns — they are still on MACDX_ENGINE_DEFAULTS").not.toEqual(items);
    for (const it of items) expect(it.v).toBeCloseTo(clampTo(hist[it.i], -100, 100), 6);
  });

  it("pins the MACD Signals triangles to the retuned Engine curve", () => {
    const curve = new Map<number, number>(
      (primOf(run(MACD_ENGINE_MODULE, MACD_BARS, TUNE), "mx-eng-macd").pts as Array<{ i: number; p: number }>)
        .map((q) => [q.i, q.p] as [number, number]),
    );
    const res = run(MACD_SIGNALS_MODULE, MACD_BARS, { threshold: 60 }, "en", FLAT);
    expect(res.events).not.toEqual(run(MACD_SIGNALS_MODULE, MACD_BARS, { threshold: 60 }).events);
    const evs = res.events ?? [];
    expect(evs.length).toBeGreaterThan(0);
    for (const e of evs) expect(e.p).toBeCloseTo(curve.get(e.i)!, 6);
    for (const m of res.prims as any[]) {
      const e = evs.find((x) => `mx-sig-${x.i}-m` === m.id)!;
      expect(e, `stray marker ${m.id}`).toBeDefined();
      expect(m.p).toBeCloseTo(curve.get(e.i)! + (e.dir === "bull" ? -10 : 10), 6);
    }
  });

  it("re-detects MACD Divergence and the phase lane on the retuned curve", () => {
    const { macd } = tuned();
    const div = run(MACD_DIVERGENCE_MODULE, MACD_BARS, {}, "en", FLAT);
    expect(div.events).not.toEqual(run(MACD_DIVERGENCE_MODULE, MACD_BARS).events);
    const conns = div.prims.filter((p) => p.kind === "poly") as any[];
    expect(conns.length).toBeGreaterThan(0);
    for (const c of conns) for (const q of c.pts) expect(q.p).toBeCloseTo(macd[q.i], 6);

    const trend = run(MACD_TREND_MODULE, MACD_BARS, {}, "en", FLAT);
    expect(trend.events).not.toEqual(run(MACD_TREND_MODULE, MACD_BARS).events);
    const phases = evOf(trend, "macdx_phase");
    expect(phases.length).toBeGreaterThan(0);
    for (const e of phases) expect(e.p).toBeCloseTo(macd[e.i], 6);
  });

  it("falls back to the Engine defaults when ctx.suite is absent", () => {
    for (const mod of [MACD_SIGNALS_MODULE, MACD_HISTOGRAM_MODULE, MACD_DIVERGENCE_MODULE, MACD_TREND_MODULE]) {
      const bare: any = { ...ctxFor(mod, MACD_BARS) };
      delete bare.suite;
      expect(mod.compute(bare), `${mod.key} without ctx.suite`).toEqual(run(mod, MACD_BARS));
    }
  });
});

// ─── 19. W2 contract hygiene, pane geometry, non-repaint ──────────────────────

const W2_SRC_FILES = [
  "shared/oscUtils.ts", "shared/divergence.ts",
  "pulse/pulseWave.ts", "pulse/pulseSignals.ts", "pulse/divergences.ts",
  "pulse/volumeMapping.ts", "pulse/flows.ts",
  "rsix/rsiEngine.ts", "rsix/rsiSignals.ts", "rsix/rsiDivergence.ts", "rsix/rsiChannels.ts",
  "macdx/macdEngine.ts", "macdx/macdSignals.ts", "macdx/macdDivergence.ts",
  "macdx/macdHistogram.ts", "macdx/macdTrend.ts",
];

/** Every pane module with a settings blob that switches its optional surfaces ON. */
const W2_CASES: Array<{ suite: string; mod: SuiteModuleDef; opts: Record<string, any> }> = [
  { suite: "pulse", mod: PULSE_WAVE_MODULE, opts: {} },
  { suite: "pulse", mod: PULSE_SIGNALS_MODULE, opts: { peaks: true, gappedCross: true, showLast: 40 } },
  { suite: "pulse", mod: PULSE_DIVERGENCE_MODULE, opts: { showLast: 16 } },
  { suite: "pulse", mod: VOLUME_MAPPING_MODULE, opts: {} },
  { suite: "pulse", mod: FLOWS_MODULE, opts: { source: "both", showLast: 12 } },
  { suite: "rsix", mod: RSI_ENGINE_MODULE, opts: {} },
  { suite: "rsix", mod: RSI_SIGNALS_MODULE, opts: { showLast: 30 } },
  { suite: "rsix", mod: RSI_DIVERGENCE_MODULE, opts: { showLast: 16 } },
  { suite: "rsix", mod: RSI_CHANNELS_MODULE, opts: { model: "keltner" } },
  { suite: "macdx", mod: MACD_ENGINE_MODULE, opts: {} },
  { suite: "macdx", mod: MACD_SIGNALS_MODULE, opts: { threshold: 60, showLast: 24 } },
  { suite: "macdx", mod: MACD_HISTOGRAM_MODULE, opts: {} },
  { suite: "macdx", mod: MACD_DIVERGENCE_MODULE, opts: { showLast: 16 } },
  { suite: "macdx", mod: MACD_TREND_MODULE, opts: {} },
];
const W2_MODULES = W2_CASES.map((c) => c.mod);

/** Exercise every W2 module on both noisy fixtures, in both languages. */
function w2Results(): Array<{ mod: string; suite: string; res: ModuleResult }> {
  const out: Array<{ mod: string; suite: string; res: ModuleResult }> = [];
  for (const bars of [PULSE_NOISE, MACD_BARS]) {
    for (const lang of ["en", "zh"] as const) {
      for (const c of W2_CASES) {
        out.push({ mod: `${c.suite}/${c.mod.key}/${lang}`, suite: c.suite, res: run(c.mod, bars, c.opts, lang) });
      }
    }
  }
  return out;
}

/** Every y-value a prim addresses, in the suite's own pane units. */
function paneYs(p: any): number[] {
  const out: number[] = [];
  const add = (v: any) => { if (typeof v === "number") out.push(v); };
  switch (p.kind) {
    case "zone": add(p.p1); add(p.p2); break;
    case "line": add(p.a?.p); add(p.b?.p); break;
    case "poly": case "gradline": for (const q of p.pts ?? []) add(q.p); break;
    case "cloud": for (const q of [...(p.upper ?? []), ...(p.lower ?? [])]) add(q.p); break;
    case "label": case "marker": add(p.p); break;
    case "columns": add(p.base ?? 0); for (const it of p.items ?? []) add(it.v); break;
    case "profile": for (const b of p.bins ?? []) { add(b.p1); add(b.p2); } break;
    default: break;
  }
  return out;
}

describe("W2 contract hygiene", () => {
  it("every prim carries a unique, non-empty id and only finite numbers", () => {
    for (const { mod, res } of w2Results()) {
      expect(res.prims.length, `${mod}: drew nothing — the fixture no longer exercises it`).toBeGreaterThan(0);
      const seen = new Set<string>();
      for (const p of res.prims) {
        expect(typeof p.id).toBe("string");
        expect(p.id.length, `${mod}: empty prim id`).toBeGreaterThan(0);
        expect(seen.has(p.id), `${mod}: duplicate prim id ${p.id}`).toBe(false);
        seen.add(p.id);
        const bad: string[] = [];
        scanNumbers(p, `${mod}:${p.id}`, bad);
        expect(bad, `${mod}: non-finite numbers`).toEqual([]);
      }
      for (const e of res.events ?? []) {
        const bad: string[] = [];
        scanNumbers(e, `${mod}:event`, bad);
        expect(bad, `${mod}: non-finite event numbers`).toEqual([]);
      }
      const tips = (res.tooltips ?? []).map((t) => t.id);
      expect(new Set(tips).size, `${mod}: duplicate tooltip ids`).toBe(tips.length);
      const tipSet = new Set(tips);
      for (const p of res.prims) {
        const tid = (p as any).tooltipId;
        if (tid) expect(tipSet.has(tid), `${mod}: dangling tooltipId ${tid}`).toBe(true);
      }
    }
  });

  it("keeps every drawn value inside its suite's declared pane range", () => {
    for (const { mod, suite, res } of w2Results()) {
      const pane = SUITE_DEFS[suite].pane!;
      expect(pane).toBeDefined();
      const slack = (pane.max - pane.min) * 0.1;
      for (const p of res.prims) {
        for (const y of paneYs(p)) {
          expect(y, `${mod}:${p.id} below the pane`).toBeGreaterThanOrEqual(pane.min - slack);
          expect(y, `${mod}:${p.id} above the pane`).toBeLessThanOrEqual(pane.max + slack);
        }
      }
      for (const e of res.events ?? []) {
        if (e.p === undefined) continue;
        expect(e.p, `${mod}: event p out of pane`).toBeGreaterThanOrEqual(pane.min - slack);
        expect(e.p, `${mod}: event p out of pane`).toBeLessThanOrEqual(pane.max + slack);
      }
    }
  });

  it("keeps columns items sorted and every alpha inside 0..1", () => {
    for (const { mod, res } of w2Results()) {
      for (const p of res.prims as any[]) {
        if (p.kind === "columns") {
          let prev = -Infinity;
          for (const it of p.items) {
            expect(it.i, `${mod}:${p.id} unsorted columns`).toBeGreaterThan(prev);
            prev = it.i;
            if (it.alpha !== undefined) {
              expect(it.alpha).toBeGreaterThan(0);
              expect(it.alpha).toBeLessThanOrEqual(1);
            }
          }
          if (p.widthFrac !== undefined) {
            expect(p.widthFrac).toBeGreaterThanOrEqual(0.1);
            expect(p.widthFrac).toBeLessThanOrEqual(1);
          }
        }
        if (p.alpha !== undefined) {
          expect(p.alpha, `${mod}:${p.id} alpha`).toBeGreaterThan(0);
          expect(p.alpha, `${mod}:${p.id} alpha`).toBeLessThanOrEqual(1);
        }
        if (p.kind === "zone" && p.fillAlpha !== undefined) expect(p.fillAlpha).toBeLessThanOrEqual(0.18);
        if (p.kind === "cloud" && p.fillAlpha !== undefined) expect(p.fillAlpha).toBeLessThanOrEqual(0.18);
        if (p.kind === "bgshade") expect(p.alpha).toBeLessThanOrEqual(0.1);
        if (p.kind === "label" && p.fs !== undefined) {
          expect(p.fs).toBeGreaterThanOrEqual(8);
          expect(p.fs).toBeLessThanOrEqual(20);
        }
      }
    }
  });

  it("emits only host-resolved colour tokens", () => {
    for (const { mod, res } of w2Results()) {
      const bad: string[] = [];
      scanColors(res.prims, `${mod}:prims`, bad);
      scanColors(res.tooltips ?? [], `${mod}:tooltips`, bad);
      scanColors(res.candlePaint ?? [], `${mod}:paint`, bad);
      expect(bad, `${mod}: non-token colours`).toEqual([]);
    }
  });

  it("W2 sources contain zero colour literals, no clock and no randomness", () => {
    const NAMED = /\b(?:red|green|blue|white|black|gray|grey|orange|yellow|purple|cyan|magenta|lime|teal|navy|silver|gold|pink|brown|maroon|olive|aqua|fuchsia|transparent|currentColor)\b\s*['"]/i;
    for (const f of W2_SRC_FILES) {
      const src = readFileSync(join(__dirname, "..", "suites", f), "utf8");
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
      expect(code.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [], `${f} hex literals`).toEqual([]);
      expect(code.match(/\brgba?\s*\(/g) ?? [], `${f} rgb()/rgba() literals`).toEqual([]);
      expect(code.includes("Date.now"), `${f}: Date.now`).toBe(false);
      expect(code.includes("Math.random"), `${f}: Math.random`).toBe(false);
      expect(code.includes("new Date"), `${f}: new Date`).toBe(false);
      const strings = code.match(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g) ?? [];
      const hits = strings.filter((s) => NAMED.test(`${s.slice(1, -1)}"`) || /^["'`]#/.test(s));
      expect(hits, `${f}: literal colour strings`).toEqual([]);
    }
  });

  it("ships a complete settings schema and the registered identity for every W2 module", () => {
    for (const m of W2_MODULES) {
      const fieldKeys = m.fields.map((f) => f.key).sort();
      expect(Object.keys(m.defaults).sort(), `${m.key}: fields vs defaults`).toEqual(fieldKeys);
      expect(new Set(fieldKeys).size, `${m.key}: duplicate field keys`).toBe(fieldKeys.length);
      for (const f of m.fields) {
        expect(f.key, `${m.key}.${f.key}: prefixed key`).not.toContain(".");
        expect(f.label.length).toBeGreaterThan(0);
        if (f.type === "number") {
          expect(typeof f.min).toBe("number");
          expect(typeof f.max).toBe("number");
          expect(m.defaults[f.key]).toBeGreaterThanOrEqual(f.min!);
          expect(m.defaults[f.key]).toBeLessThanOrEqual(f.max!);
        }
        if (f.type === "select") {
          expect(f.options?.some((o) => o.v === m.defaults[f.key]), `${m.key}.${f.key}`).toBe(true);
        }
        if (f.showIf) expect(fieldKeys, `${m.key}.${f.key}: showIf target`).toContain(f.showIf.key);
      }
    }
    const idOf = (m: SuiteModuleDef) => [m.key, m.label, m.tag, m.tier, m.defaultOn];
    expect(W2_MODULES.map(idOf)).toEqual([
      ["wave", "Pulse Wave", "PW", "essential", true],
      ["sig", "Pulse Signals", "PS", "essential", true],
      ["div", "Divergences", "DV", "pro", true],
      ["vmap", "Volume Mapping", "VM", "pro", false],
      ["flow", "Money Flows", "MF", "pro", false],
      ["eng", "RSI Engine", "RE", "essential", true],
      ["sig", "RSI Signals", "RS", "essential", true],
      ["div", "RSI Divergence", "RD", "pro", true],
      ["chan", "RSI Channels", "RC", "pro", false],
      ["eng", "MACD Engine", "ME", "essential", true],
      ["sig", "MACD Signals", "MS", "essential", true],
      ["hist", "Histogram", "MH", "essential", true],
      ["div", "MACD Divergence", "MD", "pro", true],
      ["trend", "Phase Trend", "MT", "pro", false],
    ]);
  });

  it("registers each pane suite with a sane pane range and unique module keys", () => {
    const paneKeys = SUITE_ORDER.filter((k) => SUITE_DEFS[k].kind === "pane");
    expect(paneKeys).toEqual(["pulse", "rsix", "macdx"]);
    for (const k of paneKeys) {
      const def = SUITE_DEFS[k];
      expect(def.pane, `${k}: pane suite without a range`).toBeDefined();
      expect(def.pane!.max).toBeGreaterThan(def.pane!.min);
      for (const l of def.pane!.lines ?? []) {
        expect(l.p).toBeGreaterThanOrEqual(def.pane!.min);
        expect(l.p).toBeLessThanOrEqual(def.pane!.max);
      }
      const keys = def.modules.map((m) => m.key);
      expect(new Set(keys).size, `${k}: duplicate module keys`).toBe(keys.length);
      const tags = def.modules.map((m) => m.tag);
      expect(new Set(tags).size, `${k}: duplicate module tags`).toBe(tags.length);
    }
    // Tags are unique WITHIN a suite (asserted above). Across suites the collision list is pinned
    // here on purpose — every entry is a program-specified identity, and this assertion exists to
    // stop the list growing silently:
    //   "MS"  — Market Structure (structure) vs MACD Signals (macdx).
    //   "MTF" — the three pane suites each ship the SAME concept, an MTF Dashboard (W3). Giving
    //           them per-suite tags would invent three names for one thing; the legend qualifies a
    //           module chip by its suite, so the shared tag is the honest one.
    // W3 note: Market Dashboard was accidentally a fourth collision ("MD", already MACD
    // Divergence's) and was retagged "DSH" at the source rather than accepted here.
    const allTags = SUITE_ORDER.flatMap((k) => SUITE_DEFS[k].modules.map((m) => m.tag));
    const dupes = allTags.filter((t, i) => allTags.indexOf(t) !== i);
    expect(dupes.sort()).toEqual(["MS", "MTF", "MTF"]);
  });
});

describe("W2 robustness & i18n", () => {
  it("survives zero / NaN / zero-range bars and degenerate inputs", () => {
    const dirty = dirtyBars();
    for (const c of W2_CASES) {
      let res!: ModuleResult;
      expect(() => { res = run(c.mod, dirty, c.opts); }, `${c.suite}/${c.mod.key} threw`).not.toThrow();
      for (const p of res.prims) {
        const bad: string[] = [];
        scanNumbers(p, `${c.mod.key}:${p.id}`, bad);
        expect(bad, `${c.suite}/${c.mod.key}: non-finite prim geometry`).toEqual([]);
      }
      for (const t of res.tooltips ?? []) {
        for (const r of t.rows) expect(r.v.includes("NaN"), `${c.mod.key}: NaN in ${t.id}/${r.k}`).toBe(false);
      }
      for (const e of res.events ?? []) expect(e.label?.includes("NaN") ?? false).toBe(false);
      for (const bars of [[], walkBars(2), walkBars(11), walkBars(40)]) {
        const r = run(c.mod, bars, c.opts);
        expect(Array.isArray(r.prims), `${c.mod.key}`).toBe(true);
        for (const p of r.prims) {
          const bad: string[] = [];
          scanNumbers(p, `${c.mod.key}:${p.id}`, bad);
          expect(bad, `${c.suite}/${c.mod.key}: warm-up geometry`).toEqual([]);
        }
      }
    }
  });

  it("localizes tooltips and event copy without leaking the other language", () => {
    for (const c of W2_CASES) {
      const en = run(c.mod, PULSE_NOISE, c.opts, "en");
      const zh = run(c.mod, PULSE_NOISE, c.opts, "zh");
      const pair: Array<[any, any]> = [[en.tooltips ?? [], zh.tooltips ?? []], [en.events ?? [], zh.events ?? []]];
      let compared = 0;
      for (const [a, b] of pair) {
        if (!a.length) continue;
        const at = JSON.stringify(a);
        const bt = JSON.stringify(b);
        expect(/[一-鿿]/.test(at), `${c.mod.key}: CJK leaked into the en output`).toBe(false);
        expect(/[一-鿿]/.test(bt), `${c.mod.key}: zh output has no CJK`).toBe(true);
        compared++;
      }
      expect(compared, `${c.suite}/${c.mod.key}: nothing localized to compare`).toBeGreaterThan(0);
      // geometry and chart microcopy are language-independent
      expect(zh.prims).toEqual(en.prims);
    }
  });
});

describe("W2 non-repaint & density", () => {
  const FULL = walkBars(380, 77, 29);
  const SHORT = FULL.slice(0, 340);
  const CUT = 310; // events at or before this bar are settled 30 bars before the short series ends
  const key = (e: SuiteEvent) => `${e.type}|${e.dir}|${e.i}|${e.p}|${e.strength}`;

  it("keeps every settled event identical when 40 future bars are appended", () => {
    for (const c of W2_CASES) {
      const a = (run(c.mod, SHORT, c.opts).events ?? []).filter((e) => e.i <= CUT).map(key);
      const b = (run(c.mod, FULL, c.opts).events ?? []).filter((e) => e.i <= CUT).map(key);
      expect(a.length, `${c.suite}/${c.mod.key}: nothing settled to compare`).toBeGreaterThan(0);
      expect(b.length, `${c.suite}/${c.mod.key}: the longer run lost its settled tape`).toBeGreaterThan(0);
      // the tape is tail-capped, so the longer run's settled events are a SUFFIX of the short one's
      expect(a.slice(a.length - b.length), `${c.suite}/${c.mod.key}`).toEqual(b);
    }
  });

  it("keeps every module under MAX_PRIMS_PER_MODULE on a 5000-bar series", () => {
    const PATHOLOGICAL = walkBars(5000, 991, 37);
    for (const c of W2_CASES) {
      const res = run(c.mod, PATHOLOGICAL, c.opts);
      expect(res.prims.length, `${c.suite}/${c.mod.key} drew nothing`).toBeGreaterThan(0);
      expect(res.prims.length, `${c.suite}/${c.mod.key} prim count`).toBeLessThanOrEqual(MAX_PRIMS_PER_MODULE);
      expect((res.tooltips ?? []).length).toBeLessThanOrEqual(MAX_PRIMS_PER_MODULE);
      expect(run(c.mod, PATHOLOGICAL, c.opts), `${c.mod.key} determinism`).toEqual(res);
    }
  });

  it("bounds the drawn glyph families by showLast", () => {
    const bars = walkBars(5000, 991, 37);
    const cases: Array<[SuiteModuleDef, number[], (r: ModuleResult) => number, number]> = [
      [PULSE_SIGNALS_MODULE, [4, 16, 40], (r) => r.prims.filter((p) => p.id.startsWith("ps-bs-")).length, 1],
      [PULSE_DIVERGENCE_MODULE, [2, 8, 16], (r) => r.prims.filter((p) => p.kind === "label").length, 1],
      [RSI_SIGNALS_MODULE, [4, 12, 30], (r) => r.prims.filter((p) => /^rsix-sig-\d+-m$/.test(p.id)).length, 1],
      [RSI_DIVERGENCE_MODULE, [2, 8, 16], (r) => r.prims.filter((p) => p.kind === "label").length, 1],
      [MACD_SIGNALS_MODULE, [4, 12, 24], (r) => r.prims.length, 1],
      [MACD_DIVERGENCE_MODULE, [2, 8, 16], (r) => r.prims.filter((p) => p.kind === "label").length, 1],
      [FLOWS_MODULE, [2, 6, 12], (r) => r.prims.filter((p) => p.kind === "label").length, 1],
    ];
    for (const [mod, showLasts, count, per] of cases) {
      for (const showLast of showLasts) {
        const res = run(mod, bars, { showLast, threshold: 60, peaks: true, gappedCross: true });
        expect(count(res), `${mod.key} showLast=${showLast} drew nothing`).toBeGreaterThan(0);
        expect(count(res), `${mod.key} showLast=${showLast}`).toBeLessThanOrEqual(showLast * per);
      }
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// W3 — DASHBOARD MODULES (Market Dashboard + the three MTF dashboards)
// ══════════════════════════════════════════════════════════════════════════════

// ─── 20. Fixtures + table helpers ─────────────────────────────────────────────

/**
 * A strictly linear price path through `pathBars`, which makes every dashboard statistic exact:
 *   - true range is EXACTLY 0.7 on every bar after the first (h−l = 0.7 dominates both gap terms),
 *     so ATR(14) settles on 0.7 and ATR/close is strictly monotone in the close;
 *   - EMA20 vs EMA50 and close vs EMA200 never flip;
 *   - the Trend Engine's ATR trailing stop seeds on bar 0 in the path's direction and never flips;
 *   - Bollinger σ over any 20-bar window is constant, so bandwidth = 4σ/mean moves ONLY with the
 *     mean — monotonically DOWN on the up ramp and UP on the down ramp.
 * Hence Trend Score = 5·(±1) + 3·(±1) + 2·(±1) = ±10 exactly, and the percentile rows sit on their
 * rails. 320 bars clears the EMA200 warm-up.
 */
function rampBars(n: number, from: number, step: number): SuiteBar[] {
  return pathBars(Array.from({ length: n }, (_, i) => from + i * step));
}
const DASH_UP = rampBars(320, 100, 0.3);
const DASH_DOWN = rampBars(320, 200, -0.3);

const tableOf = (res: ModuleResult, id: string): TableSpec =>
  (res.tables ?? []).find((t) => t.id === id) as TableSpec;
const rowOf = (tb: TableSpec, label: string) => tb.rows.find((r) => r.label === label)!;
const cellText = (tb: TableSpec, label: string, k = 0) => rowOf(tb, label).cells[k]?.text;

// ─── 21. Market Dashboard ─────────────────────────────────────────────────────

describe("marketDashboard — hand-computed rows", () => {
  it("reads every row off a pure linear uptrend", () => {
    const res = run(MARKET_DASHBOARD_MODULE, DASH_UP);
    expect(res.prims).toEqual([]); // the table IS the drawing
    const tb = tableOf(res, "trend-dash");
    expect(tb).toBeDefined();
    expect(tb.pos).toBe("tr"); // module default
    expect(tb.title).toBe("Market Dashboard");
    expect(tb.rows.map((r) => r.label)).toEqual([
      "Volatility", "Compression", "Trend", "Pressure", "Rating", "MTF",
    ]);

    // ATR/close = 0.7/close is at its 320-bar MINIMUM on the last bar: 1 of 252 samples at or
    // below it -> 100/252 = 0.397% -> "0%", and nowhere near the 80% warn line.
    expect(cellText(tb, "Volatility")).toBe("0%");
    expect(rowOf(tb, "Volatility").cells[0].color).toBe(COLORS.muted);
    expect(rowOf(tb, "Volatility").cells[0].bold).toBe(false); // below the 80% warn line

    // bandwidth 4σ/mean is likewise at its minimum -> percentile 0.397 -> (100−0.397)/10 = 9.96.
    expect(cellText(tb, "Compression")).toBe("10.0/10");
    expect(rowOf(tb, "Compression").cells[0].color).toBe(COLORS.brand); // >= 8 -> squeeze watch
    expect(rowOf(tb, "Compression").cells[0].bold).toBe(true);

    // 5·(+1 engine) + 3·(EMA20 > EMA50) + 2·(close > EMA200)
    expect(cellText(tb, "Trend")).toBe("+10");
    expect(rowOf(tb, "Trend").cells[0].color).toBe(COLORS.up);
    expect(rowOf(tb, "Trend").cells[0].bold).toBe(true);

    // every bar contributes the same v·body/range, so the 20-bar sum ranks at the top: (100−50)/5.
    expect(cellText(tb, "Pressure")).toBe("+10.0");
    expect(rowOf(tb, "Pressure").cells[0].color).toBe(COLORS.flowBuy); // aggressor family, never flips

    // |Trend| >= 7 and pressure agrees, but Compression 9.96 >= 8 is a squeeze -> STRONG is blocked.
    expect(cellText(tb, "Rating")).toBe("BUY");
    expect(rowOf(tb, "Rating").cells[0].bold).toBe(false); // bold is reserved for the STRONG bands

    expect(rowOf(tb, "MTF").cells.map((c) => c.text)).toEqual(["chart ▲", "2× ▲", "4× ▲"]);
    expect(rowOf(tb, "MTF").cells.every((c) => c.color === COLORS.up)).toBe(true);
  });

  it("flips every sign on the mirrored downtrend", () => {
    const tb = tableOf(run(MARKET_DASHBOARD_MODULE, DASH_DOWN), "trend-dash");
    // ATR/close now RISES with the falling close: the last bar is the 252-window maximum.
    expect(cellText(tb, "Volatility")).toBe("100%");
    expect(rowOf(tb, "Volatility").cells[0].color).toBe(COLORS.warn);
    expect(rowOf(tb, "Volatility").cells[0].bold).toBe(true);
    // bandwidth rises with the falling mean -> widest on the last bar -> no compression at all.
    expect(cellText(tb, "Compression")).toBe("0.0/10");
    expect(rowOf(tb, "Compression").cells[0].color).toBe(COLORS.muted);

    expect(cellText(tb, "Trend")).toBe("-10");
    expect(rowOf(tb, "Trend").cells[0].color).toBe(COLORS.down);
    // Pressure is a RANK of the 20-bar delta against its own history; every window is identical, so
    // it ranks top even though the deltas are negative. The rating vote therefore sees pressure
    // DISAGREEING with the down trend and honestly refuses to call it STRONG.
    expect(cellText(tb, "Rating")).toBe("SELL");
    expect(rowOf(tb, "Rating").cells[0].color).toBe(COLORS.down);
    expect(rowOf(tb, "MTF").cells.map((c) => c.text)).toEqual(["chart ▼", "2× ▼", "4× ▼"]);
  });

  it("localizes the labels and the copy without leaking either language", () => {
    const en = tableOf(run(MARKET_DASHBOARD_MODULE, DASH_UP, {}, "en"), "trend-dash");
    const zh = tableOf(run(MARKET_DASHBOARD_MODULE, DASH_UP, {}, "zh"), "trend-dash");
    expect(/[一-鿿]/.test(JSON.stringify(en)), "CJK leaked into the en table").toBe(false);
    expect(/[一-鿿]/.test(JSON.stringify(zh)), "zh table has no CJK").toBe(true);
    expect(zh.title).toBe("市场仪表盘");
    expect(cellText(zh, "综合评级")).toBe("买入");
    // the numbers are language-independent
    expect(cellText(zh, "趋势分")).toBe(cellText(en, "Trend"));
    expect(cellText(zh, "多周期", 1)).toBe("2× ▲"); // the resample labels are not translated
  });
});

describe("marketDashboard — rows, settings and shape", () => {
  const ROWS: Array<[string, string]> = [
    ["volatility", "Volatility"], ["compression", "Compression"], ["trendScore", "Trend"],
    ["pressure", "Pressure"], ["rating", "Rating"], ["mtf", "MTF"],
  ];

  it("drops exactly the row whose toggle is off", () => {
    for (const [key, label] of ROWS) {
      const tb = tableOf(run(MARKET_DASHBOARD_MODULE, DASH_UP, { [key]: false }), "trend-dash");
      const labels = tb.rows.map((r) => r.label);
      expect(labels, `${key} off`).not.toContain(label);
      expect(labels.length, `${key} off`).toBe(ROWS.length - 1);
    }
  });

  it("emits no table at all when every row is off, but keeps the event tape alive", () => {
    const off = Object.fromEntries(ROWS.map(([k]) => [k, false]));
    const res = run(MARKET_DASHBOARD_MODULE, DASH_UP, off);
    expect(res.tables).toEqual([]);
    expect(res.prims).toEqual([]);
    // The alert bridge must keep firing when the row is hidden (voltixBands/fvg precedent), so the
    // tape is computed from the settings-independent vote, not from the drawn rows.
    const noisy = walkBars(900, 4242, 31);
    const hidden = run(MARKET_DASHBOARD_MODULE, noisy, off).events ?? [];
    const shown = run(MARKET_DASHBOARD_MODULE, noisy).events ?? [];
    expect(shown.length, "the fixture prints no rating changes").toBeGreaterThan(0);
    expect(hidden, "hiding the rating row silenced the alert tape").toEqual(shown);
  });

  it("carries the honest resample footnote only while the MTF row is shown", () => {
    const on = tableOf(run(MARKET_DASHBOARD_MODULE, DASH_UP), "trend-dash");
    expect(on.footnote).toBe("2× / 4× = the loaded chart bars resampled — not fetched higher timeframes.");
    expect(tableOf(run(MARKET_DASHBOARD_MODULE, DASH_UP, { mtf: false }), "trend-dash").footnote).toBeUndefined();
  });

  it("honours pos and compact", () => {
    for (const pos of ["tl", "tr", "bl", "br"] as const) {
      expect(tableOf(run(MARKET_DASHBOARD_MODULE, DASH_UP, { pos }), "trend-dash").pos).toBe(pos);
    }
    expect(tableOf(run(MARKET_DASHBOARD_MODULE, DASH_UP, { pos: "nope" }), "trend-dash").pos).toBe("tr");
    // (this module always states `compact` explicitly; the MTF tables omit it when false)
    expect(tableOf(run(MARKET_DASHBOARD_MODULE, DASH_UP), "trend-dash").compact).toBe(false);
    expect(tableOf(run(MARKET_DASHBOARD_MODULE, DASH_UP, { compact: true }), "trend-dash").compact).toBe(true);
    expect(tableOf(run(MARKET_DASHBOARD_MODULE, DASH_UP, { compact: "yes" }), "trend-dash").compact).toBe(false);
  });

  it("ships a self-consistent TableSpec (no row wider than the column set)", () => {
    for (const bars of [DASH_UP, DASH_DOWN, walkBars(600, 77, 29)]) {
      const tb = tableOf(run(MARKET_DASHBOARD_MODULE, bars), "trend-dash");
      expect(tb.columns.map((c) => c.key)).toEqual(["a", "b", "c"]);
      expect(new Set(tb.columns.map((c) => c.key)).size).toBe(tb.columns.length);
      for (const r of tb.rows) {
        expect(r.label.length, "empty row label").toBeGreaterThan(0);
        expect(r.cells.length, `${r.label}: no cells`).toBeGreaterThan(0);
        expect(r.cells.length, `${r.label}: more cells than columns`).toBeLessThanOrEqual(tb.columns.length);
        for (const c of r.cells) {
          expect(typeof c.text).toBe("string");
          expect(c.text.length, `${r.label}: empty cell`).toBeGreaterThan(0);
          expect(c.text.includes("NaN"), `${r.label}: NaN leaked`).toBe(false);
          expect(c.text.includes("undefined"), `${r.label}: undefined leaked`).toBe(false);
        }
      }
    }
  });

  it("returns an empty result below the minimum bar count and survives dirty bars", () => {
    for (const bars of [[], walkBars(2), walkBars(24)]) {
      const res = run(MARKET_DASHBOARD_MODULE, bars);
      expect(res.tables).toEqual([]);
      expect(res.events).toEqual([]);
    }
    expect(() => run(MARKET_DASHBOARD_MODULE, dirtyBars())).not.toThrow();
    const dirty = tableOf(run(MARKET_DASHBOARD_MODULE, dirtyBars()), "trend-dash");
    for (const r of dirty.rows) for (const c of r.cells) expect(c.text.includes("NaN")).toBe(false);
  });

  it("is deterministic across repeated computes", () => {
    for (const bars of [DASH_UP, walkBars(600, 77, 29)]) {
      expect(run(MARKET_DASHBOARD_MODULE, bars)).toEqual(run(MARKET_DASHBOARD_MODULE, bars));
    }
  });
});

describe("marketDashboard — rating tape", () => {
  const BARS = walkBars(900, 4242, 31);

  it("publishes rating changes with a 10-bar cooldown and a bounded tape", () => {
    const evs = evOf(run(MARKET_DASHBOARD_MODULE, BARS), "dash_rating_change");
    expect(evs.length, "the fixture no longer exercises the tape").toBeGreaterThan(2);
    const RATINGS = ["STRONG BUY", "BUY", "NEUTRAL", "SELL", "STRONG SELL"];
    const seen = new Set<string>();
    let prevI = -Infinity;
    for (const e of evs) {
      expect(e.i - prevI, "cooldown violated").toBeGreaterThanOrEqual(10);
      prevI = e.i;
      const label = (e.label ?? "").replace("Rating → ", "");
      expect(RATINGS, `unknown rating ${label}`).toContain(label);
      seen.add(label);
      expect(e.strength).toBeGreaterThanOrEqual(0);
      expect(e.strength).toBeLessThanOrEqual(100);
      const sign = label.includes("BUY") ? "bull" : label.includes("SELL") ? "bear" : "neutral";
      expect(e.dir, `${label}: dir disagrees with the rating`).toBe(sign);
    }
    expect(seen.size, "the tape never changed rating").toBeGreaterThan(1);
    expect(evs.length).toBeLessThanOrEqual(60);
  });

  it("never repaints a settled rating change when future bars arrive", () => {
    const short = BARS.slice(0, 800);
    const key = (e: SuiteEvent) => `${e.type}|${e.dir}|${e.i}|${e.p}|${e.strength}|${e.label}`;
    const a = (run(MARKET_DASHBOARD_MODULE, short).events ?? []).map(key);
    const b = (run(MARKET_DASHBOARD_MODULE, BARS).events ?? []).filter((e) => e.i <= 799).map(key);
    expect(a.length).toBeGreaterThan(0);
    expect(b, "appending 100 bars rewrote settled history").toEqual(a);
  });
});

describe("marketDashboard follows the Trend Engine's live sensitivity", () => {
  const BARS = walkBars(700, 991, 37);
  /** The engine's own regime at the last bar = the direction of its most recent flip. */
  const engineDir = (sens: number): "bull" | "bear" | null => {
    const flips = evOf(run(TREND_ENGINE_MODULE, BARS, { sensitivity: sens }), "te_flip");
    return flips.length ? (flips[flips.length - 1].dir as "bull" | "bear") : null;
  };
  const chartArrow = (sens: number) =>
    cellText(tableOf(run(MARKET_DASHBOARD_MODULE, BARS, {}, "en", { "te.sensitivity": sens }), "trend-dash"), "MTF");

  it("agrees with the Trend Engine's regime at both ends of the sensitivity range", () => {
    for (const sens of [1, 3, 5, 8, 10]) {
      const dir = engineDir(sens);
      expect(dir, `sensitivity ${sens}: the engine never flipped`).not.toBeNull();
      expect(chartArrow(sens), `sensitivity ${sens}`).toBe(`chart ${dir === "bull" ? "▲" : "▼"}`);
    }
  });

  it("moves the whole dashboard when the producer is retuned", () => {
    const at = (sens: number) => run(MARKET_DASHBOARD_MODULE, BARS, {}, "en", { "te.sensitivity": sens });
    expect(JSON.stringify(at(1)), "the retune did not reach the dashboard").not.toBe(JSON.stringify(at(10)));
  });

  it("falls back to the engine default (5) when ctx.suite is absent", () => {
    const bare: any = { ...ctxFor(MARKET_DASHBOARD_MODULE, BARS) };
    delete bare.suite;
    expect(MARKET_DASHBOARD_MODULE.compute(bare)).toEqual(
      run(MARKET_DASHBOARD_MODULE, BARS, {}, "en", { "te.sensitivity": 5 }),
    );
  });
});

// ─── 22. shared/mtfTable ──────────────────────────────────────────────────────

describe("buildMtfTable", () => {
  const base = { id: "t", pos: "br" as const, footnote: "F" };

  it("fixes the column set to the three honest labels", () => {
    const tb = buildMtfTable({ ...base, rows: [] });
    expect(MTF_FACTORS).toEqual([1, 2, 4]);
    expect(tb.columns.map((c) => c.key)).toEqual([...MTF_COLUMN_KEYS]);
    expect(tb.columns.map((c) => c.label)).toEqual([...MTF_COLUMN_LABELS]);
    expect(tb.columns.map((c) => c.label)).toEqual(["chart", "2×", "4×"]);
  });

  it("pads short rows and trims long ones so a cell can never sit under the wrong header", () => {
    const tb = buildMtfTable({
      ...base,
      rows: [
        { label: "short", cells: [{ text: "a" }] },
        { label: "long", cells: [{ text: "a" }, { text: "b" }, { text: "c" }, { text: "d" }] },
      ],
    });
    expect(tb.rows[0].cells.map((c) => c.text)).toEqual(["a", EM_DASH, EM_DASH]);
    expect(tb.rows[1].cells.map((c) => c.text)).toEqual(["a", "b", "c"]);
  });

  it("sanitizes cells: blank text dashes out, fade clamps, empty extras are dropped", () => {
    const tb = buildMtfTable({
      ...base,
      rows: [{
        label: "  padded  ",
        cells: [
          { text: "   ", color: "", bg: "", fade: -1 },
          { text: " x ", fade: 5, bold: false, tip: "   " },
          { text: "y", color: COLORS.up, bg: COLORS.down, bold: true, fade: 0.4, tip: " why " },
        ],
      }],
    });
    const [a, b, c] = tb.rows[0].cells;
    expect(tb.rows[0].label).toBe("padded");
    expect(a).toEqual({ text: EM_DASH });         // blank text + blank colors + negative fade
    expect(b).toEqual({ text: "x", fade: 1 });    // trimmed, fade clamped to 1, falsy extras dropped
    expect(c).toEqual({ text: "y", color: COLORS.up, bg: COLORS.down, bold: true, fade: 0.4, tip: "why" });
  });

  it("never lets the honest-basis footnote go missing", () => {
    const EN = "Rows are resampled from the loaded bars — not independent timeframe feeds.";
    expect(buildMtfTable({ ...base, footnote: "  ", rows: [] }).footnote).toBe(EN);
    expect(buildMtfTable({ ...base, footnote: undefined as any, rows: [] }).footnote).toBe(EN);
    expect(mtfFootnote("en")).toBe(EN);
    expect(/[一-鿿]/.test(mtfFootnote("zh"))).toBe(true);
  });

  it("caps the row list and sanitizes id / pos / title / compact", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ label: `r${i}`, cells: [] }));
    expect(buildMtfTable({ ...base, rows: many }).rows.length).toBe(8);
    expect(buildMtfTable({ ...base, id: "  ", rows: [] }).id).toBe("mtf");
    expect(buildMtfTable({ ...base, pos: "nope" as any, rows: [] }).pos).toBe("br");
    expect(buildMtfTable({ ...base, title: "  T  ", rows: [] }).title).toBe("T");
    expect(buildMtfTable({ ...base, title: "   ", rows: [] }).title).toBeUndefined();
    expect(buildMtfTable({ ...base, compact: false, rows: [] }).compact).toBeUndefined();
    expect(buildMtfTable({ ...base, compact: true, rows: [] }).compact).toBe(true);
    expect(buildMtfTable({ ...base, rows: [{ label: "  ", cells: [] }] }).rows[0].label).toBe(EM_DASH);
  });

  it("is pure — same opts, same spec", () => {
    const opts = { ...base, title: "x", rows: [{ label: "a", cells: [{ text: "1" }] }] };
    expect(buildMtfTable(opts)).toEqual(buildMtfTable(opts));
  });
});

describe("mtfTable microcopy helpers", () => {
  it("prints the basis line with the block size and the disclosed lag", () => {
    expect(mtfBasisTip(1, 0, "en")).toBe("Chart timeframe · 1 bar per cell (the last bar may still be forming)");
    expect(mtfBasisTip(4, 3, "en")).toBe("4× resample · 4 chart bars per cell · last complete block sits 3 chart bars behind");
    expect(mtfBasisTip(2, 1, "en")).toContain("sits 1 chart bar behind"); // singular
    expect(/[一-鿿]/.test(mtfBasisTip(4, 3, "zh"))).toBe(true);
    expect(mtfBasisTip(NaN as any, -5, "en")).toBe(mtfBasisTip(1, 0, "en")); // sanitized
  });

  it("reads ages in words and fades linearly to a readable floor", () => {
    expect(mtfAgo(0, "en")).toBe("now");
    expect(mtfAgo(4, "en")).toBe("4 ago");
    expect(mtfAgo(-3, "en")).toBe("now");
    expect(mtfAgo(0, "zh")).toBe("当前");
    expect(mtfFade(0, 30)).toBe(0);
    expect(mtfFade(15, 30)).toBeCloseTo(0.35, 12);
    expect(mtfFade(30, 30)).toBeCloseTo(0.7, 12);  // oldest in-window cell stays readable
    expect(mtfFade(99, 30)).toBeCloseTo(0.7, 12);
    expect(mtfFade(5, 0)).toBe(0);
    expect(mtfFade(NaN, 30)).toBe(0);
  });

  it("keeps the slope glyph language-neutral and sanitizes the settings readers", () => {
    expect(mtfSlope(2, 1)).toBe("▲");
    expect(mtfSlope(1, 2)).toBe("▼");
    expect(mtfSlope(1, 1)).toBe("·");
    expect(mtfSlope(1, NaN)).toBe("·");
    expect(mtfPos("tl")).toBe("tl");
    expect(mtfPos("nope")).toBe("br");
    expect(mtfPos(undefined, "tr")).toBe("tr");
    expect(mtfBool(true, false)).toBe(true);
    expect(mtfBool("yes", false)).toBe(false);
  });
});

// ─── 23. MTF dashboards (pulse / rsix / macdx) ────────────────────────────────

const MTF_CASES: Array<{ suite: string; mod: SuiteModuleDef; id: string; title: string; rows: string[] }> = [
  { suite: "pulse", mod: PULSE_MTF_MODULE, id: "pulse-mtf", title: "Pulse MTF", rows: ["State", "Signal", "Divergence"] },
  { suite: "rsix", mod: RSIX_MTF_MODULE, id: "rsix-mtf", title: "RSI MTF", rows: ["RSI", "Signal", "Divergence"] },
  { suite: "macdx", mod: MACDX_MTF_MODULE, id: "macdx-mtf", title: "MACD MTF", rows: ["MACD", "Signal", "Phase"] },
];

/** The lag the cell tip discloses, i.e. how far behind the column's last COMPLETE block sits. */
function tipLag(tip: string | undefined): number {
  const m = (tip ?? "").match(/sits (\d+) chart bar/);
  return m ? Number(m[1]) : 0;
}

describe("MTF dashboards — table shape", () => {
  const BARS = walkBars(600, 77, 29);

  it("emits exactly one well-formed table and zero prims", () => {
    for (const c of MTF_CASES) {
      const res = run(c.mod, BARS);
      expect(res.prims, `${c.suite}: drew prims`).toEqual([]);
      expect(res.events ?? [], `${c.suite}: a dashboard has no event tape`).toEqual([]);
      expect((res.tables ?? []).length, c.suite).toBe(1);
      const tb = tableOf(res, c.id);
      expect(tb.title).toBe(c.title);
      expect(tb.pos).toBe("br");
      expect(tb.columns.map((x) => x.label)).toEqual(["chart", "2×", "4×"]);
      expect(tb.rows.map((r) => r.label)).toEqual(c.rows);
      for (const r of tb.rows) {
        expect(r.cells.length, `${c.suite}/${r.label}`).toBe(3);
        for (const cell of r.cells) {
          expect(cell.text.length, `${c.suite}/${r.label}: empty cell`).toBeGreaterThan(0);
          expect(cell.text.includes("NaN"), `${c.suite}/${r.label}: NaN leaked`).toBe(false);
          expect(cell.tip ?? "", `${c.suite}/${r.label}: NaN in the tip`).not.toContain("NaN");
          if (cell.fade !== undefined) {
            expect(cell.fade).toBeGreaterThan(0);
            expect(cell.fade).toBeLessThanOrEqual(0.7);
          }
        }
      }
      expect(tb.footnote, `${c.suite}: missing basis footnote`).toBe(mtfFootnote("en"));
    }
  });

  it("discloses each column's resample basis in every cell tip", () => {
    for (const c of MTF_CASES) {
      const tb = tableOf(run(c.mod, BARS), c.id);
      for (const r of tb.rows) {
        expect(r.cells[0].tip, `${c.suite}/${r.label}`).toContain("Chart timeframe");
        expect(r.cells[1].tip, `${c.suite}/${r.label}`).toContain("2× resample");
        expect(r.cells[2].tip, `${c.suite}/${r.label}`).toContain("4× resample");
      }
    }
  });

  it("honours pos / compact and stays deterministic", () => {
    for (const c of MTF_CASES) {
      for (const pos of ["tl", "tr", "bl", "br"] as const) {
        expect(tableOf(run(c.mod, BARS, { pos }), c.id).pos).toBe(pos);
      }
      expect(tableOf(run(c.mod, BARS, { pos: "nope" }), c.id).pos).toBe("br");
      expect(tableOf(run(c.mod, BARS, { compact: true }), c.id).compact).toBe(true);
      expect(run(c.mod, BARS), c.suite).toEqual(run(c.mod, BARS));
    }
  });

  it("returns an empty result below the minimum bar count and survives dirty bars", () => {
    for (const c of MTF_CASES) {
      for (const bars of [[], walkBars(2), walkBars(11)]) {
        const res = run(c.mod, bars);
        expect(res.prims, c.suite).toEqual([]);
        expect(res.tables ?? [], `${c.suite}: table below MIN_BARS`).toEqual([]);
      }
      expect(run(c.mod, walkBars(12)).tables?.length, `${c.suite}: 12 bars is enough`).toBe(1);
      expect(() => run(c.mod, dirtyBars()), `${c.suite} threw on dirty bars`).not.toThrow();
      for (const r of tableOf(run(c.mod, dirtyBars()), c.id).rows) {
        for (const cell of r.cells) expect(cell.text.includes("NaN"), `${c.suite}/${r.label}`).toBe(false);
      }
    }
  });

  it("localizes the table without leaking either language, and keeps the columns neutral", () => {
    for (const c of MTF_CASES) {
      const en = tableOf(run(c.mod, BARS, {}, "en"), c.id);
      const zh = tableOf(run(c.mod, BARS, {}, "zh"), c.id);
      expect(/[一-鿿]/.test(JSON.stringify(en)), `${c.suite}: CJK leaked into the en table`).toBe(false);
      expect(/[一-鿿]/.test(JSON.stringify(zh)), `${c.suite}: zh table has no CJK`).toBe(true);
      expect(zh.footnote).toBe(mtfFootnote("zh"));
      expect(zh.columns.map((x) => x.label)).toEqual(en.columns.map((x) => x.label));
      expect(zh.rows.length).toBe(en.rows.length);
    }
  });
});

describe("MTF dashboards — the trailing PARTIAL block is never read", () => {
  // Review W3-8 semantics: a block is only READ once it is closed AND the next bar has opened.
  // With 400 bars (divisible by 4), the count-complete last 4× block still CONTAINS the live bar
  // 399, so the column steps back to the block ending at 395 (lag 4). At 401 bars, block 396..399
  // is genuinely closed (bar 400 is live) → lag 1; then 2, 3, and back to 4 at 404.
  const FULL = walkBars(403, 20260728, 29);
  const at = (mod: SuiteModuleDef, n: number, id: string) => tableOf(run(mod, FULL.slice(0, n)), id);

  it("keeps the 4× column frozen while its next block is still forming", () => {
    for (const c of MTF_CASES) {
      const base = at(c.mod, 401, c.id); // first run where block 396..399 is safely closed
      for (const n of [402, 403]) {
        const tb = at(c.mod, n, c.id);
        for (let r = 0; r < base.rows.length; r++) {
          expect(tb.rows[r].cells[2].text, `${c.suite}/${base.rows[r].label} @${n} bars`)
            .toBe(base.rows[r].cells[2].text);
        }
      }
    }
  });

  it("discloses the growing staleness instead of hiding it — and never reads a block holding the live bar", () => {
    for (const c of MTF_CASES) {
      for (const [n, lag] of [[400, 4], [401, 1], [402, 2], [403, 3]] as const) {
        const tb = at(c.mod, n, c.id);
        expect(tipLag(tb.rows[0].cells[2].tip), `${c.suite}: 4× lag @${n} bars`).toBe(lag);
        expect(tipLag(tb.rows[0].cells[0].tip), `${c.suite}: the chart column never lags`).toBe(0);
      }
      // 2×: the live-bar rule makes the cycle 2,1 instead of 0,1 — a count-complete block ending on
      // the live bar is skipped (n=400,402 → lag 2), a closed block with one live bar after → lag 1.
      for (const [n, lag] of [[400, 2], [401, 1], [402, 2], [403, 1]] as const) {
        expect(tipLag(at(c.mod, n, c.id).rows[0].cells[1].tip), `${c.suite}: 2× lag @${n} bars`).toBe(lag);
      }
    }
  });

  it("advances the 4× column only once the next block CLOSES and a new bar opens", () => {
    const LONGER = walkBars(405, 20260728, 29); // bars 400..403 close a block; bar 404 is the live one
    expect(LONGER.slice(0, 403)).toEqual(FULL);
    for (const c of MTF_CASES) {
      const closed = tableOf(run(c.mod, LONGER), c.id);
      expect(tipLag(closed.rows[0].cells[2].tip), `${c.suite}: the new block reads with lag 1`).toBe(1);
      // the column is now reading bars 400..403, which the 403-bar run could not see at all
      const forming = at(c.mod, 403, c.id);
      expect(tipLag(forming.rows[0].cells[2].tip)).toBe(3);
      expect(closed.rows[0].cells[2].tip).not.toBe(forming.rows[0].cells[2].tip);
    }
  });
});

describe("MTF dashboards follow their producer's live settings (W2 law)", () => {
  const BARS = walkBars(600, 77, 29);
  /** The numeric head of a cell — the part that must equal the producer's own series. */
  const num = (s: string) => parseFloat(s.replace(/^[^\d+-]*/, ""));

  it("pulse: the State row is the Wave module's series at the Wave module's profile", () => {
    const tuned = tableOf(run(PULSE_MTF_MODULE, BARS, {}, "en", { "wave.profile": "scalper" }), "pulse-mtf");
    const base = tableOf(run(PULSE_MTF_MODULE, BARS), "pulse-mtf");
    expect(cellText(tuned, "State"), "the retune never reached the dashboard")
      .not.toBe(cellText(base, "State"));
    // the chart column is the identity resample, so its last block IS the last bar
    const { wave } = computePulseWave(BARS, "scalper");
    expect(num(cellText(tuned, "State")!)).toBe(Math.round(wave[BARS.length - 1]));
    const { wave: dayWave } = computePulseWave(BARS, "day");
    expect(num(cellText(base, "State")!)).toBe(Math.round(dayWave[BARS.length - 1]));
  });

  /** The exact "<value> <slope>" a value row renders for a series' last entry. */
  const levelCell = (series: Float64Array): string => {
    const g = series.length - 1;
    let prev = NaN;
    for (let k = g - 1; k >= 0; k--) if (Number.isFinite(series[k])) { prev = series[k]; break; }
    return `${series[g].toFixed(1)} ${mtfSlope(series[g], prev)}`;
  };

  it("rsix: the RSI row is the Engine's curve at the Engine's length", () => {
    const p = RSI_DEFAULTS;
    const seen = new Set<string>();
    for (const len of [5, 14, 30]) {
      const tb = tableOf(run(RSIX_MTF_MODULE, BARS, {}, "en", { "eng.len": len }), "rsix-mtf");
      const { rsi } = computeUltimateRsi(BARS, len, p.source, p.smoothLen, p.smoothType);
      expect(cellText(tb, "RSI"), `len=${len}`).toBe(levelCell(rsi)); // value AND slope glyph
      seen.add(cellText(tb, "RSI")!);
    }
    expect(seen.size, "the length retune never reached the dashboard").toBe(3);
    expect(cellText(tableOf(run(RSIX_MTF_MODULE, BARS), "rsix-mtf"), "RSI"), "default is len 14")
      .toBe(levelCell(computeUltimateRsi(BARS, p.len, p.source, p.smoothLen, p.smoothType).rsi));
  });

  it("macdx: the MACD row is the Engine's curve at the Engine's fast/slow", () => {
    const d = MACDX_ENGINE_DEFAULTS;
    const tb = tableOf(run(MACDX_MTF_MODULE, BARS, {}, "en", { "eng.fast": 4, "eng.slow": 60 }), "macdx-mtf");
    expect(cellText(tb, "MACD")).toBe(levelCell(computeUltimateMacd(BARS, 4, 60, d.signalLen, d.oscMa, d.sigMa).macd));
    const base = tableOf(run(MACDX_MTF_MODULE, BARS), "macdx-mtf");
    expect(cellText(base, "MACD"))
      .toBe(levelCell(computeUltimateMacd(BARS, d.fast, d.slow, d.signalLen, d.oscMa, d.sigMa).macd));
    expect(cellText(tb, "MACD"), "the retune never reached the dashboard").not.toBe(cellText(base, "MACD"));
  });

  it("macdx: the Signal row uses the Signals module's live extreme zone", () => {
    const wide = tableOf(run(MACDX_MTF_MODULE, BARS, {}, "en", { "sig.threshold": 60 }), "macdx-mtf");
    const tight = tableOf(run(MACDX_MTF_MODULE, BARS, {}, "en", { "sig.threshold": 95 }), "macdx-mtf");
    expect(JSON.stringify(rowOf(wide, "Signal")), "the zone retune did not reach the Signal row")
      .not.toBe(JSON.stringify(rowOf(tight, "Signal")));
    for (const cell of rowOf(tight, "Signal").cells) {
      if (cell.text === EM_DASH) expect(cell.tip).toContain("±95");
      else expect(cell.tip).toContain("zone ±95");
    }
  });

  it("pulse / rsix: the Divergence row honours the Divergence module's hidden toggle", () => {
    // seed chosen because BOTH panes print a hidden (continuation) divergence inside the window here
    const DIVBARS = walkBars(300, 991, 29);
    for (const [mod, id] of [[PULSE_MTF_MODULE, "pulse-mtf"], [RSIX_MTF_MODULE, "rsix-mtf"]] as const) {
      const on = tableOf(run(mod, DIVBARS, {}, "en", { "div.hidden": true }), id);
      const off = tableOf(run(mod, DIVBARS, {}, "en", { "div.hidden": false }), id);
      expect(JSON.stringify(rowOf(off, "Divergence")), `${id}: the toggle changed nothing`)
        .not.toBe(JSON.stringify(rowOf(on, "Divergence")));
      // with the producer's toggle off, a continuation class can never be reported
      for (const bars of [DIVBARS, BARS, walkBars(900, 4242, 31)]) {
        const cells = rowOf(tableOf(run(mod, bars, {}, "en", { "div.hidden": false }), id), "Divergence");
        expect(cells.cells.map((c) => c.text).join("|"), `${id}: a hidden divergence survived the toggle`)
          .not.toContain("H ");
      }
    }
  });

  it("falls back to the producer defaults when ctx.suite is absent", () => {
    for (const c of MTF_CASES) {
      const bare: any = { ...ctxFor(c.mod, BARS) };
      delete bare.suite;
      expect(c.mod.compute(bare), `${c.suite} without ctx.suite`).toEqual(run(c.mod, BARS));
    }
  });

  it("keeps the recency window honest — nothing older than the window is ever shown", () => {
    for (const c of MTF_CASES) {
      const tb = tableOf(run(c.mod, BARS), c.id);
      for (const cell of rowOf(tb, "Signal").cells) {
        if (cell.text === EM_DASH) continue;
        const m = cell.text.match(/(\d+) ago$/);
        const ago = m ? Number(m[1]) : 0; // "now"
        expect(ago, `${c.suite}: signal older than the window`).toBeLessThanOrEqual(MTF_SIGNAL_WINDOW);
        expect(cell.fade ?? 0).toBeCloseTo(mtfFade(ago, MTF_SIGNAL_WINDOW), 12);
      }
    }
  });
});

// ─── 24. W3 contract hygiene ──────────────────────────────────────────────────

const W3_MODULES: SuiteModuleDef[] = [
  MARKET_DASHBOARD_MODULE, PULSE_MTF_MODULE, RSIX_MTF_MODULE, MACDX_MTF_MODULE,
];

const W3_SRC_FILES = [
  "shared/mtfTable.ts", "trend/marketDashboard.ts",
  "pulse/mtfDash.ts", "rsix/mtfDash.ts", "macdx/mtfDash.ts",
];

/** Every W3 module on both fixtures, in both languages, with the optional rows switched around. */
function w3Results(): Array<{ mod: string; res: ModuleResult }> {
  const out: Array<{ mod: string; res: ModuleResult }> = [];
  for (const bars of [DASH_UP, walkBars(600, 77, 29), dirtyBars()]) {
    for (const lang of ["en", "zh"] as const) {
      out.push({ mod: `dash/${lang}`, res: run(MARKET_DASHBOARD_MODULE, bars, { pos: "bl", compact: true }, lang) });
      for (const c of MTF_CASES) {
        out.push({ mod: `${c.suite}/mtf/${lang}`, res: run(c.mod, bars, { compact: true }, lang) });
      }
    }
  }
  return out;
}

describe("W3 contract hygiene", () => {
  it("emits only host-resolved colour tokens in every table cell", () => {
    for (const { mod, res } of w3Results()) {
      const bad: string[] = [];
      scanColors(res.tables ?? [], `${mod}:tables`, bad);
      expect(bad, `${mod}: non-token colours`).toEqual([]);
    }
  });

  it("W3 sources contain zero colour literals, no clock and no randomness", () => {
    const NAMED = /\b(?:red|green|blue|white|black|gray|grey|orange|yellow|purple|cyan|magenta|lime|teal|navy|silver|gold|pink|brown|maroon|olive|aqua|fuchsia|transparent|currentColor)\b\s*['"]/i;
    for (const f of W3_SRC_FILES) {
      const src = readFileSync(join(__dirname, "..", "suites", f), "utf8");
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
      expect(code.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [], `${f} hex literals`).toEqual([]);
      expect(code.match(/\brgba?\s*\(/g) ?? [], `${f} rgb()/rgba() literals`).toEqual([]);
      expect(code.includes("Date.now"), `${f}: Date.now`).toBe(false);
      expect(code.includes("Math.random"), `${f}: Math.random`).toBe(false);
      expect(code.includes("new Date"), `${f}: new Date`).toBe(false);
      const strings = code.match(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g) ?? [];
      const hits = strings.filter((s) => NAMED.test(`${s.slice(1, -1)}"`) || /^["'`]#/.test(s));
      expect(hits, `${f}: literal colour strings`).toEqual([]);
    }
  });

  it("keeps every emitted TableSpec structurally valid and uniquely identified", () => {
    const POS = ["tl", "tr", "bl", "br"];
    for (const { mod, res } of w3Results()) {
      const ids = (res.tables ?? []).map((t) => t.id);
      expect(new Set(ids).size, `${mod}: duplicate table ids`).toBe(ids.length);
      for (const tb of res.tables ?? []) {
        expect(tb.id.length, `${mod}: empty table id`).toBeGreaterThan(0);
        expect(POS, `${mod}: bad pos`).toContain(tb.pos);
        expect(tb.columns.length, `${mod}: no columns`).toBeGreaterThan(0);
        expect(new Set(tb.columns.map((c) => c.key)).size).toBe(tb.columns.length);
        expect(tb.rows.length, `${mod}: no rows`).toBeGreaterThan(0);
        for (const r of tb.rows) {
          expect(r.cells.length, `${mod}/${r.label}`).toBeLessThanOrEqual(tb.columns.length);
          for (const c of r.cells) {
            expect(typeof c.text, `${mod}/${r.label}`).toBe("string");
            expect(c.text.length, `${mod}/${r.label}: empty cell text`).toBeGreaterThan(0);
            if (c.fade !== undefined) {
              expect(c.fade, `${mod}/${r.label}: fade`).toBeGreaterThan(0);
              expect(c.fade, `${mod}/${r.label}: fade`).toBeLessThanOrEqual(1);
            }
          }
        }
      }
      // a dashboard draws no prims and never paints candles
      expect(res.prims, `${mod}: prims`).toEqual([]);
      expect(res.candlePaint, `${mod}: candlePaint`).toBeUndefined();
      for (const e of res.events ?? []) {
        const bad: string[] = [];
        scanNumbers(e, `${mod}:event`, bad);
        expect(bad, `${mod}: non-finite event numbers`).toEqual([]);
      }
    }
  });

  it("ships a complete settings schema and the registered identity for every W3 module", () => {
    for (const m of W3_MODULES) {
      const fieldKeys = m.fields.map((f) => f.key).sort();
      expect(Object.keys(m.defaults).sort(), `${m.key}: fields vs defaults`).toEqual(fieldKeys);
      expect(new Set(fieldKeys).size, `${m.key}: duplicate field keys`).toBe(fieldKeys.length);
      for (const f of m.fields) {
        expect(f.key, `${m.key}.${f.key}: prefixed key`).not.toContain(".");
        expect(f.label.length, `${m.key}.${f.key}: empty label`).toBeGreaterThan(0);
        expect(/[一-鿿]/.test(f.label), `${m.key}.${f.key}: CJK in a field label`).toBe(false);
        if (f.type === "select") {
          expect(f.options?.some((o) => o.v === m.defaults[f.key]), `${m.key}.${f.key}`).toBe(true);
        }
        if (f.showIf) expect(fieldKeys, `${m.key}.${f.key}: showIf target`).toContain(f.showIf.key);
      }
    }
    // the three MTF modules must not SHARE their field objects (the settings UI mutates per module)
    const [a, b, c] = [PULSE_MTF_MODULE, RSIX_MTF_MODULE, MACDX_MTF_MODULE];
    expect(a.fields).not.toBe(b.fields);
    expect(b.fields).not.toBe(c.fields);
    expect(a.fields[0]).not.toBe(b.fields[0]);
    expect(a.defaults).not.toBe(b.defaults);

    const idOf = (m: SuiteModuleDef) => [m.key, m.label, m.tag, m.tier, m.defaultOn];
    expect(W3_MODULES.map(idOf)).toEqual([
      ["dash", "Market Dashboard", "DSH", "pro", false],
      ["mtf", "MTF Dashboard", "MTF", "pro", false],
      ["mtf", "MTF Dashboard", "MTF", "pro", false],
      ["mtf", "MTF Dashboard", "MTF", "pro", false],
    ]);
    // every W3 module is registered in the suite it claims, and none is on by default (a table
    // that appears uninvited on every chart is a regression, not a feature)
    for (const [suite, mod] of [["trend", MARKET_DASHBOARD_MODULE], ["pulse", PULSE_MTF_MODULE],
      ["rsix", RSIX_MTF_MODULE], ["macdx", MACDX_MTF_MODULE]] as const) {
      expect(SUITE_DEFS[suite].modules.includes(mod), `${suite}: module not registered`).toBe(true);
      expect(mod.defaultOn, `${suite}: dashboard defaults ON`).toBe(false);
    }
  });

  it("stays cheap and deterministic on a 5000-bar series", () => {
    const PATHOLOGICAL = walkBars(5000, 991, 37);
    for (const m of W3_MODULES) {
      const res = run(m, PATHOLOGICAL);
      expect(res.prims.length, `${m.key}: prims on a dashboard`).toBe(0);
      expect((res.tables ?? []).length, `${m.key}: table count`).toBe(1);
      for (const tb of res.tables ?? []) expect(tb.rows.length, `${m.key}: runaway row list`).toBeLessThanOrEqual(8);
      expect((res.events ?? []).length, `${m.key}: unbounded tape`).toBeLessThanOrEqual(60);
      expect(run(m, PATHOLOGICAL), `${m.key}: determinism`).toEqual(res);
    }
  });
});

// ─── 25. Mirror fidelity: the chart column vs the pane module it copies ───────
//
// Each MTF dashboard re-implements its pane's detector (those modules export no scanner). The
// chart column is the IDENTITY resample, so on that column the dashboard and the pane module must
// describe the same event — otherwise the table quietly contradicts the glyphs drawn beside it.

describe("MTF dashboards agree with the pane modules they mirror", () => {
  const FIXTURES = [walkBars(600, 77, 29), walkBars(300, 991, 29), walkBars(900, 4242, 31)];

  /** "BUY 4 ago" / "▲ now" -> { bull, ago } (null when the cell is an honest dash). */
  const parseSignal = (text: string): { bull: boolean; ago: number } | null => {
    if (text === EM_DASH) return null;
    const bull = text.startsWith("BUY") || text.startsWith("▲");
    const m = text.match(/(\d+) ago$/);
    return { bull, ago: m ? Number(m[1]) : 0 };
  };

  it("pulse: the chart Signal cell is the pane's own newest Pulse Buy/Sell", () => {
    let checked = 0;
    for (const bars of FIXTURES) {
      const cell = parseSignal(cellText(tableOf(run(PULSE_MTF_MODULE, bars), "pulse-mtf"), "Signal", 0)!);
      // pulseSignals dates the event on the CONFIRM bar, which is what the dashboard counts back from
      const evs = (run(PULSE_SIGNALS_MODULE, bars).events ?? [])
        .filter((e) => e.type === "pulse_buy" || e.type === "pulse_sell");
      const last = evs.length ? evs[evs.length - 1] : null;
      const ago = last ? bars.length - 1 - last.i : Infinity;
      if (!last || ago > MTF_SIGNAL_WINDOW) {
        expect(cell, "the dashboard invented a signal the pane never drew").toBeNull();
        continue;
      }
      expect(cell, "the dashboard dashed out a signal the pane drew").not.toBeNull();
      expect(cell!.ago, "signal age disagrees with the pane").toBe(ago);
      expect(cell!.bull, "signal direction disagrees with the pane").toBe(last.type === "pulse_buy");
      checked++;
    }
    expect(checked, "no fixture exercised the agreement").toBeGreaterThan(0);
  });

  it("macdx: the chart Signal cell is the pane's own newest extreme-zone cross", () => {
    let checked = 0;
    for (const bars of FIXTURES) {
      for (const threshold of [60, 80]) {
        const tb = tableOf(run(MACDX_MTF_MODULE, bars, {}, "en", { "sig.threshold": threshold }), "macdx-mtf");
        const cell = parseSignal(cellText(tb, "Signal", 0)!);
        const evs = evOf(run(MACD_SIGNALS_MODULE, bars, { threshold }), "macdx_signal");
        const last = evs.length ? evs[evs.length - 1] : null;
        const ago = last ? bars.length - 1 - last.i : Infinity;
        if (!last || ago > MTF_SIGNAL_WINDOW) {
          expect(cell, `threshold ${threshold}: invented a signal`).toBeNull();
          continue;
        }
        expect(cell, `threshold ${threshold}: dashed out a drawn signal`).not.toBeNull();
        expect(cell!.ago, `threshold ${threshold}: age`).toBe(ago);
        expect(cell!.bull, `threshold ${threshold}: direction`).toBe(last.dir === "bull");
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("rsix: the chart Signal cell is the pane's own newest in-zone reversal", () => {
    let checked = 0;
    for (const bars of FIXTURES) {
      const cell = parseSignal(cellText(tableOf(run(RSIX_MTF_MODULE, bars), "rsix-mtf"), "Signal", 0)!);
      // rsiSignals dates its event on the PIVOT; the dashboard counts from the confirming bar, which
      // is at or after it — so the pane's age is the upper bound on the dashboard's.
      const evs = evOf(run(RSI_SIGNALS_MODULE, bars), "rsix_reversal");
      const last = evs.length ? evs[evs.length - 1] : null;
      const pivotAgo = last ? bars.length - 1 - last.i : Infinity;
      if (!last || pivotAgo > MTF_SIGNAL_WINDOW) {
        if (cell) expect(cell.ago, "the dashboard outran the pane's tape").toBeLessThanOrEqual(pivotAgo);
        continue;
      }
      expect(cell, "the dashboard dashed out a reversal the pane drew").not.toBeNull();
      expect(cell!.bull, "reversal direction disagrees with the pane").toBe(last.dir === "bull");
      expect(cell!.ago).toBeLessThanOrEqual(pivotAgo);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("macdx: the chart Phase cell is the pane's own locked regime", () => {
    let checked = 0;
    for (const bars of FIXTURES) {
      const text = cellText(tableOf(run(MACDX_MTF_MODULE, bars), "macdx-mtf"), "Phase", 0)!;
      const phases = evOf(run(MACD_TREND_MODULE, bars), "macdx_phase");
      if (!phases.length) {
        expect(text, "the dashboard committed a phase the pane never did").toBe(EM_DASH);
        continue;
      }
      const last = phases[phases.length - 1];
      expect(text.startsWith(last.dir === "bull" ? "▲" : "▼"), "phase disagrees with the pane").toBe(true);
      // "▲ 12" — the held count must reach back to (but not past) the commit bar
      const held = Number(text.slice(2));
      expect(held).toBeGreaterThan(0);
      expect(held, "held count outruns the pane's commit").toBe(bars.length - last.i);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });
});


// ── §26 W4 structure modules — core behavioral + hygiene coverage (deep spec follows in W4b) ──────
describe("W4 structure modules — Smart S/R / Money Flow Profile / Auto Patterns", () => {
  const MODS = [SMART_SR_MODULE, MONEY_FLOW_PROFILE_MODULE, AUTO_PATTERNS_MODULE];

  it("registry identity + determinism + dirty-bar survival + finite geometry", () => {
    for (const m of MODS) {
      const bars = walkBars(600, 20260729, 37);
      const a = run(m, bars), b = run(m, bars);
      expect(JSON.stringify(a), `${m.key}: deterministic`).toBe(JSON.stringify(b));
      expect(() => run(m, dirtyBars()), `${m.key}: dirty bars`).not.toThrow();
      for (const pr of a.prims) {
        for (const v of Object.values(pr)) {
          if (typeof v === "number") expect(Number.isFinite(v), `${m.key}/${pr.id}: finite`).toBe(true);
        }
      }
    }
  });

  it("non-repaint: settled prims and events survive a 60-bar extension", () => {
    // mfp is EXEMPT by design: its profile is a trailing window, so its poc-touch tape is
    // window-relative (the alert bridge only ever evaluates the fresh 3-bar window, where this is
    // safe). sr and pat carry the strict guarantee.
    for (const m of MODS.filter((x) => x.key !== "mfp")) {
      const full = walkBars(660, 20260729, 37);
      const shortRun = run(m, full.slice(0, 600));
      const longRun = run(m, full);
      const cut = 540; // safely behind every confirmation window
      const pick = (r: ModuleResult) => (r.events ?? []).filter((e) => e.i <= cut).map((e) => `${e.type}|${e.dir}|${e.i}`);
      expect(pick(longRun), `${m.key}: settled event tape stable`).toEqual(pick(shortRun));
    }
  });

  it("smartSR freezes the level anchor at the first pivot and counts touches", () => {
    // two clean touches of 100 within tolerance, second slightly off — anchor must stay at the first
    const warmup = Array.from({ length: 20 }, (_, i) => 106 + Math.sin(i / 3) * 1.5); // ATR14 warm-up
    // second trough sits 8 bars after the first so the fractal window clears the neighbor bar
    // that re-prints the first trough's low as its open (pathBars semantics)
    const path = [104, 103, 102, 101, 100, 101.5, 103, 104, 104.5, 103.5, 102.5, 101.5, 100.2, 101.8, 103.5, 104.5, 105, 105.5, 106, 106.5, 107, 107.5, 108];
    const bars = pathBars(warmup.concat(path, Array.from({ length: 30 }, (_, i) => 108 + i * 0.2)));
    const res = run(SMART_SR_MODULE, bars, { sensitivity: "high", minTouches: 2 });
    const lines = res.prims.filter((p) => p.kind === "line");
    expect(lines.length, "at least one level").toBeGreaterThan(0);
    const supports = lines.filter((p: any) => Math.abs(p.a.p - 99.8) < 1.2); // pathBars adds ±0.2 wicks
    expect(supports.length, "the ~100 support exists, anchored near the FIRST pivot low").toBeGreaterThan(0);
  });

  it("moneyFlowProfile bins a confined fixture into the right thirds", () => {
    // 300 bars pinned inside 100..103: nearly all volume must land in that band's bins
    const bars = pathBars(Array.from({ length: 300 }, (_, i) => 101.5 + Math.sin(i / 7)));
    const res = run(MONEY_FLOW_PROFILE_MODULE, bars, { length: 300, levels: 12 });
    const prof: any = res.prims.find((p) => p.kind === "profile");
    expect(prof, "profile prim exists").toBeTruthy();
    expect(prof.bins.length).toBeGreaterThan(3);
    const strongest = Math.max(...prof.bins.map((b: any) => b.frac));
    expect(strongest, "a dominant bin exists").toBeGreaterThan(0.9);
    for (const b of prof.bins) {
      expect(b.p1, "bins inside the traded range").toBeGreaterThan(98);
      expect(b.p2).toBeLessThan(105);
    }
  });

  it("autoPatterns fits a line through collinear pivot highs and projects it", () => {
    // sawtooth with highs on an exact descending line: 110 - 0.5 * i at each peak
    const path: number[] = Array.from({ length: 16 }, (_, i) => 112 + Math.sin(i / 3)); // warm-up
    for (let k = 0; k < 6; k++) {
      const peak = 110 - k * 3;
      path.push(peak - 8, peak - 6, peak - 4, peak - 2, peak, peak - 2, peak - 4, peak - 6);
    }
    const bars = pathBars(path.concat(path[path.length - 1] - 1, path[path.length - 1] - 2));
    const res = run(AUTO_PATTERNS_MODULE, bars, { size: "small" });
    const polys = res.prims.filter((p) => p.kind === "poly" || p.kind === "line");
    expect(polys.length, "a trendline was drawn").toBeGreaterThan(0);
  });
});


// ══════════════════════════════════════════════════════════════════════════════
//   §27 W4b — the deep spec §26 promised: exact geometry, exact arithmetic, caps
// ══════════════════════════════════════════════════════════════════════════════
//
// Everything below is hand-computable. Two fixture builders carry the weight:
//
//   `zigBars(turns, leg)` — a linear zigzag through `turns`, `leg` bars per leg, bars built as
//   o = previous close, h/l = that open/close pair (no extra wick). Two properties make it exact:
//     • every bar's TRUE RANGE equals the leg step, so ATR(14) is that step EVERYWHERE (a Wilder
//       RMA of a constant is the constant, and the warm-up mean of equal values matches it) —
//       bar 0 is seeded with the same range on purpose;
//     • each turning bar's wick IS the turning price, so `findPivotsHL(..., "wick")` returns the
//       turn exactly, and the bar after it (whose open re-prints that extreme) disqualifies itself
//       against its own left window.
//   With turns [110,100,110,...] at leg 5 the step is 2 → ATR = 2, the S/R cluster tolerance is
//   0.3×2 = 0.6, the buffer half-height is 0.25×2 = 0.5, and a 5-bar reaction spans the full 10
//   points = 5×ATR, i.e. exactly REACTION_CAP — so two levels can be compared at EQUAL reaction.
//
//   `appendBars(bars, rows)` — explicit continuation bars (optional h/l/v overrides) for the
//   close-only / volume-percentile branches that need a wick or a volume the zigzag cannot express.

/** Zigzag through `turns`, `leg` bars per leg. See the note above for the exactness properties. */
function zigBars(turns: number[], leg: number): SuiteBar[] {
  const closes: number[] = [turns[0]];
  for (let t = 1; t < turns.length; t++) {
    const from = turns[t - 1];
    const to = turns[t];
    for (let k = 1; k <= leg; k++) closes.push(from + ((to - from) * k) / leg);
  }
  const step = Math.abs(closes[1] - closes[0]);
  return closes.map((c, i) => {
    const o = i === 0 ? c + step : closes[i - 1]; // seed bar 0 with the same true range
    return { t: 86400 * (i + 1), o, h: Math.max(o, c), l: Math.min(o, c), c, v: 1000 };
  });
}

/** Continuation bars: close is required, h/l default to the open/close pair, v defaults to 1000. */
function appendBars(
  bars: SuiteBar[],
  rows: Array<{ c: number; h?: number; l?: number; v?: number }>,
): SuiteBar[] {
  const out = bars.slice();
  for (const r of rows) {
    const o = out[out.length - 1].c;
    out.push({
      t: 86400 * (out.length + 1),
      o,
      c: r.c,
      h: r.h ?? Math.max(o, r.c),
      l: r.l ?? Math.min(o, r.c),
      v: r.v ?? 1000,
    });
  }
  return out;
}

// ─── 27a. smartSR — scoring order, sensitivity, break restyle, buffers ────────

describe("smartSR — score ordering at equal reaction", () => {
  // turns: peak 110 at bar 0 (not a pivot — no left wing), then lows at 5/15/25 and highs at 10/20.
  // Bar 30 is the last bar, so the final peak never confirms → a 3-touch support vs a 2-touch
  // resistance, both with a 5-bar reaction of exactly 10 points = 5×ATR = REACTION_CAP.
  const BARS = zigBars([110, 100, 110, 100, 110, 100, 110], 5);
  const SENS = { sensitivity: "high", minTouches: 2, showLast: 12 };
  const lines = (r: ModuleResult) => r.prims.filter((p) => p.kind === "line") as any[];
  const tipRow = (r: ModuleResult, id: string, k: string) =>
    r.tooltips!.find((t) => t.id === id)!.rows.find((x) => x.k === k)!.v;

  it("builds the fixture the arithmetic assumes", () => {
    expect(BARS.length).toBe(31);
    expect(BARS[5].l).toBe(100);
    expect(BARS[10].h).toBe(110);
    expect(BARS[25].l).toBe(100);
    expect(findPivotsHL(BARS, 5, 5, "wick").map((p) => [p.i, p.p, p.kind])).toEqual([
      [5, 100, "low"], [10, 110, "high"], [15, 100, "low"], [20, 110, "high"], [25, 100, "low"],
    ]);
  });

  it("ranks the 3-touch level above the 2-touch one when the reaction is identical", () => {
    const res = run(SMART_SR_MODULE, BARS, SENS);
    const ls = lines(res);
    expect(ls.map((p) => p.a.p), "both levels are drawn, anchored at their FIRST pivot").toEqual([100, 110]);
    expect(ls.map((p) => p.a.i)).toEqual([5, 10]);
    // the two levels are compared at the SAME mean reaction — the win is the touch count alone
    expect(tipRow(res, "sr-l5", "Reaction")).toBe("5.00× ATR");
    expect(tipRow(res, "sr-h10", "Reaction")).toBe("5.00× ATR");
    expect(tipRow(res, "sr-l5", "Touches")).toBe("×3");
    expect(tipRow(res, "sr-h10", "Touches")).toBe("×2");
    // drawn order IS score order; the winner also carries the full-strength alpha
    expect(ls[0].id).toBe("sr-l5-l");
    expect(ls[0].alpha).toBeCloseTo(0.95, 12);
    expect(ls[1].alpha).toBeLessThan(ls[0].alpha);
    // ...and it beats the 2-touch level even though the latter's decay is the MILDER one
    // (last touch bar 25 vs 20 → 0.5^(5/250) vs 0.5^(10/250)); 3×5×0.9862 > 2×5×0.9727.
    expect(3 * 5 * Math.pow(0.5, 5 / 250)).toBeGreaterThan(2 * 5 * Math.pow(0.5, 10 / 250));
  });

  it("respects the showLast floor, and widens the line with the touch count", () => {
    expect(lines(run(SMART_SR_MODULE, BARS, { ...SENS, showLast: 2 })).length).toBe(2);
    // the field's own minimum is 2 levels — a smaller request is clamped, never honoured silently
    expect(lines(run(SMART_SR_MODULE, BARS, { ...SENS, showLast: 1 })).length).toBe(2);
    expect(lines(run(SMART_SR_MODULE, BARS, { ...SENS, showLast: 0 })).length).toBe(2);
    // minTouches is the honest way to demand the stronger level only
    const strict = run(SMART_SR_MODULE, BARS, { ...SENS, minTouches: 3 });
    expect(lines(strict).map((p) => p.a.p)).toEqual([100]);
    // width = 1 + min(2, touches × 0.4)
    expect(lines(strict)[0].w).toBeCloseTo(1 + 3 * 0.4, 12);
  });

  it("moves with the sensitivity wing — the same tape yields 2 / 1 / 0 levels", () => {
    // The zigzag's extremes are 10 bars apart: at wing 12 every extreme is disqualified by the
    // identical extreme one cycle back, and at wing 8 each trough is killed by the bar right after
    // the PREVIOUS trough (whose open re-prints that low). Wing 5 sees all five pivots.
    const count = (sensitivity: string) =>
      lines(run(SMART_SR_MODULE, BARS, { ...SENS, sensitivity })).length;
    expect(count("high")).toBe(2);
    expect(count("medium")).toBe(1);
    expect(count("low")).toBe(0);
    // and on real structure the ordering is monotone: finer wing, never fewer levels
    for (const seed of [1, 20260729, 777, 31337]) {
      const bars = walkBars(500, seed, 37);
      const c = (sensitivity: string) =>
        lines(run(SMART_SR_MODULE, bars, { sensitivity, showLast: 12 })).length;
      const [hi, mid, lo] = [c("high"), c("medium"), c("low")];
      expect(hi, `seed ${seed}: high ≥ medium`).toBeGreaterThanOrEqual(mid);
      expect(mid, `seed ${seed}: medium ≥ low`).toBeGreaterThanOrEqual(lo);
    }
  });

  it("draws a ±0.25×ATR buffer band, frozen at the publication bar, only when asked", () => {
    const off = run(SMART_SR_MODULE, BARS, SENS);
    expect(off.prims.filter((p) => p.kind === "zone")).toEqual([]);
    const on = run(SMART_SR_MODULE, BARS, { ...SENS, bufferZone: true });
    const zones = on.prims.filter((p) => p.kind === "zone") as any[];
    expect(zones.map((z) => z.id)).toEqual(["sr-l5-b", "sr-h10-b"]);
    for (const [z, level] of [[zones[0], 100], [zones[1], 110]] as Array<[any, number]>) {
      expect((z.p1 + z.p2) / 2, "band centred on the frozen level").toBeCloseTo(level, 12);
      expect(z.p2 - z.p1, "height = 2 × 0.25 × ATR(=2)").toBeCloseTo(1, 12); // ATR is exactly 2 here
      expect(z.fillAlpha).toBe(0.05);
      expect(z.i2).toBe("right");
    }
    // the band never displaces the line
    expect(lines(on).map((p) => p.a.p)).toEqual(lines(off).map((p) => p.a.p));
  });
});

describe("smartSR — a broken level restyles, then retires", () => {
  // The 31-bar zigzag, then a straight walk down through the 100 support and a flat 96/98 tail
  // (same 2-point true range throughout, so ATR stays exactly 2).
  const TAIL: Array<{ c: number }> = [];
  for (let k = 1; k <= 7; k++) TAIL.push({ c: 110 - 2 * k });       // 108 … 96, closing below 100 at bar 36
  for (let k = 0; k < 40; k++) TAIL.push({ c: k % 2 === 0 ? 98 : 96 });
  const BARS = appendBars(zigBars([110, 100, 110, 100, 110, 100, 110], 5), TAIL);
  const SENS = { sensitivity: "high", minTouches: 2, showLast: 12 };
  const supportLine = (r: ModuleResult) =>
    r.prims.find((p) => p.kind === "line" && (p as any).a.p === 100) as any;

  it("emits sr_break on the CLOSE through the level, once, on the exact bar", () => {
    const res = run(SMART_SR_MODULE, BARS.slice(0, 40), SENS);
    const breaks = evOf(res, "sr_break");
    expect(BARS[35].c, "bar 35 closes ON the level — not through it").toBe(100);
    expect(BARS[36].c).toBe(98);
    expect(breaks.map((e) => [e.i, e.dir, e.p])).toEqual([[36, "bear", 100]]);
    expect(breaks[0].label).toBe("Support broken · 100.00 ×3");
  });

  it("restyles the broken level dashed and dimmed instead of deleting it", () => {
    const res = run(SMART_SR_MODULE, BARS.slice(0, 40), SENS);
    const l = supportLine(res);
    expect(l, "the broken level is still drawn").toBeTruthy();
    expect(l.dash).toBe("4 3");
    expect(l.alpha).toBe(0.3);
    // The ROLE is the module's ONE repaint-exempt styling choice: it is read from the LAST close,
    // so a support price has become a resistance price now that price closed under it. The frozen
    // history (the break event's own label) still says Support — that is the honest pairing.
    expect(res.tooltips!.find((t) => t.id === "sr-l5")!.title).toBe("Resistance · broken");
    expect(evOf(res, "sr_break")[0].label).toBe("Support broken · 100.00 ×3");
    expect(l.color, "role hue follows the last close too").toBe(COLORS.down);
    // it also stops competing at full weight (BROKEN_SCORE_MULT) — the intact 110 is drawn first
    expect((res.prims.filter((p) => p.kind === "line")[0] as any).a.p).toBe(110);
  });

  it("retires it exactly BROKEN_LINGER bars after the break, keeping the event tape", () => {
    for (const cut of [40, 50, 56]) {
      expect(supportLine(run(SMART_SR_MODULE, BARS.slice(0, cut), SENS)), `cut ${cut}`).toBeTruthy();
    }
    for (const cut of [57, 60, 70]) {
      const res = run(SMART_SR_MODULE, BARS.slice(0, cut), SENS);
      expect(supportLine(res), `cut ${cut}: faded out`).toBeUndefined();
      // the geometry retires; the history does not
      expect(evOf(res, "sr_break").map((e) => e.i), `cut ${cut}`).toEqual([36]);
    }
    // bar 56 = 36 + 20 is the retirement bar itself (i - brokenAt >= 20)
    expect(56 - 36).toBe(20);
  });

  it("never lets a broken level absorb a new touch", () => {
    const res = run(SMART_SR_MODULE, BARS, SENS);
    // the 96/98 tail tags 100 from below many times; the spent level must not count them
    expect(evOf(res, "sr_break").length).toBe(1);
    for (const e of evOf(res, "sr_hold")) expect(e.i, "no hold after the break").toBeLessThan(36);
  });
});

// ─── 27b. moneyFlowProfile — a hand-computed profile ──────────────────────────

describe("moneyFlowProfile — the hand-computed 3-bin fixture", () => {
  // 12 bins over [100, 136] → binH = 3, bins k = [100+3k, 103+3k). Every bar sits INSIDE one bin,
  // so the overlap split is trivially 1.0 and every number below is exact arithmetic:
  //
  //   bar        bin  v    buyFrac=(c−l)/(h−l)   → bin volume / buy volume
  //   100–102     0   100  (102−100)/2 = 1         bin0  v=250  buy=100  delta=−50
  //   100.5–102.5 0   150  (100.5−100.5)/2 = 0
  //   112.5–114.5 4    60  (114.5−112.5)/2 = 1     bin4  v= 60  buy= 60  delta=+60
  //   133.5–136  11    40  (134.5−133.5)/2.5 = .4  bin11 v= 40  buy= 16  delta=− 8
  //
  //   totals: v = 350, buy = 176 → delta = +2, buy share = 50%; maxV = 250 → fracs 1 / .24 / .16
  //   money flow per bin = mid × v: 101.5×250 = 25375 ▸ 113.5×60 = 6810 ▸ 134.5×40 = 5380
  const BARS = mkBars([
    [101, 102, 100, 102, 100],
    [102, 102.5, 100.5, 100.5, 150],
    [113, 114.5, 112.5, 114.5, 60],
    [134, 136, 133.5, 134.5, 40],
  ]);
  const S = { length: 100, levels: 12 };
  const profileOf = (r: ModuleResult) => r.prims.find((p) => p.kind === "profile") as any;
  const priceOf = (r: ModuleResult, id: string) => (primOf(r, id) as any)?.a?.p;

  it("bins the volume exactly, with the delta-sign colors and the ≥60% label rule", () => {
    const prof = profileOf(run(MONEY_FLOW_PROFILE_MODULE, BARS, S));
    expect(prof.side).toBe("right");
    expect(prof.bins.length, "empty bins are omitted").toBe(3);
    expect(prof.bins.map((b: any) => [b.p1, b.p2])).toEqual([[100, 103], [112, 115], [133, 136]]);
    expect(prof.bins.map((b: any) => b.frac)).toEqual([1, 0.24, 0.16]);
    // aggressor family, never the locale-flipping up/down pair
    expect(prof.bins.map((b: any) => b.color)).toEqual([
      COLORS.flowSell, COLORS.flowBuy, COLORS.flowSell,
    ]);
    for (const b of prof.bins) expect(b.overlayColor).toBe(COLORS.flowBuy);
    // overlay = the buy slice OF THIS BAR: frac × buyShare
    expect(prof.bins.map((b: any) => b.overlayFrac)).toEqual([0.4, 0.24, 0.064]);
    // only rows at ≥60% strength carry text
    expect(prof.bins.map((b: any) => b.label)).toEqual(["100%", undefined, undefined]);
  });

  it("moves the POC when the metric changes", () => {
    const poc = (pocMetric: string) => priceOf(run(MONEY_FLOW_PROFILE_MODULE, BARS, { ...S, pocMetric }), "mfp-poc");
    expect(poc("moneyFlow"), "heaviest money flow = bin0 (25375)").toBe(101.5);
    expect(poc("strength"), "most volume = bin0").toBe(101.5);
    expect(poc("deltaNeg"), "most sell-side delta = bin0 (−50)").toBe(101.5);
    expect(poc("deltaPos"), "most buy-side delta = bin4 (+60) — the POC MOVES").toBe(113.5);
    // the chip and the tooltip follow the line
    const dp = run(MONEY_FLOW_PROFILE_MODULE, BARS, { ...S, pocMetric: "deltaPos" });
    expect((primOf(dp, "mfp-poc-c") as any).p).toBe(113.5);
    const rows = dp.tooltips![0].rows;
    expect(rows.find((r) => r.k === "POC")!.v).toBe("113.50");
    expect(rows.find((r) => r.k === "POC by")!.v).toBe("Delta +");
    expect(rows.find((r) => r.k === "Buy share")!.v).toBe("50%");   // 176 / 350
    expect(rows.find((r) => r.k === "Delta")!.v).toBe("+2.00");     // 176 − 174
    expect(rows.find((r) => r.k === "Window")!.v).toBe("4 bars · 12 × 3.00");
  });

  it("expands the value area until it holds ≥ vaPct of the window volume, contiguously", () => {
    const at = (vaPct: number) => {
      const r = run(MONEY_FLOW_PROFILE_MODULE, BARS, { ...S, vaPct });
      return { val: priceOf(r, "mfp-val"), vah: priceOf(r, "mfp-vah") };
    };
    // 70% of 350 = 245 — the POC bin alone (250) already clears it
    expect(at(70)).toEqual({ val: 100, vah: 103 });
    // 90% = 315 — POC + bin4 is 310, still short, so the band grows to bin11
    expect(at(90)).toEqual({ val: 100, vah: 136 });
    expect(at(50)).toEqual({ val: 100, vah: 103 });
    // ...and the same law holds on real structure: the band is contiguous, contains the POC,
    // and carries at least vaPct of the drawn mass.
    for (const bars of [walkBars(400, 20260729, 37), walkBars(600, 77, 29)]) {
      for (const vaPct of [50, 70, 90]) {
        const r = run(MONEY_FLOW_PROFILE_MODULE, bars, { length: 300, levels: 24, vaPct });
        const prof = profileOf(r);
        const poc = priceOf(r, "mfp-poc");
        const val = priceOf(r, "mfp-val");
        const vah = priceOf(r, "mfp-vah");
        expect(val).toBeLessThanOrEqual(poc);
        expect(vah).toBeGreaterThanOrEqual(poc);
        const total = prof.bins.reduce((s: number, b: any) => s + b.frac, 0);
        const inside = prof.bins.filter((b: any) => b.p1 >= val - 1e-9 && b.p2 <= vah + 1e-9);
        const mass = inside.reduce((s: number, b: any) => s + b.frac, 0);
        expect(mass / total, `vaPct=${vaPct}: value area holds its mass`).toBeGreaterThanOrEqual(
          vaPct / 100 - 1e-9,
        );
        // contiguity: the kept bins are a consecutive run of the drawn profile
        const idx = prof.bins.map((b: any, i: number) => (inside.includes(b) ? i : -1)).filter((i: number) => i >= 0);
        expect(idx[idx.length - 1] - idx[0], "value-area bins are contiguous").toBe(idx.length - 1);
      }
    }
  });

  it("prints the candle-shape honesty note in the user's language, and never mixes them", () => {
    const en = run(MONEY_FLOW_PROFILE_MODULE, BARS, S, "en");
    const zh = run(MONEY_FLOW_PROFILE_MODULE, BARS, S, "zh");
    expect((primOf(en, "mfp-note") as any).text).toBe("delta = candle-shape estimate");
    expect((primOf(zh, "mfp-note") as any).text).toBe("净量为K线形态估算");
    expect((primOf(zh, "mfp-note") as any).p, "pinned to the window high").toBe(136);
    const basis = (r: ModuleResult) => r.tooltips![0].rows.find((x) => x.k === "口径" || x.k === "Basis")!.v;
    expect(basis(en)).toBe("buy/sell split estimated from candle shape, not trade tape");
    expect(basis(zh)).toBe("买卖拆分按 (收−低)/(高−低) 估算，非逐笔主动成交");
    const enText = JSON.stringify([en.prims, en.tooltips]);
    expect(/[一-鿿]/.test(enText), "CJK leaked into the en profile").toBe(false);
    expect(zh.tooltips![0].title).toBe("资金流分布");
  });

  it("says so honestly when the symbol has no volume at all", () => {
    const noVol = BARS.map((b) => ({ ...b, v: 0 }));
    const en = run(MONEY_FLOW_PROFILE_MODULE, noVol, S);
    expect(en.prims.map((p) => p.id)).toEqual(["mfp-novol"]);
    expect((en.prims[0] as any).text).toBe("no volume data");
    expect(en.tooltips).toEqual([]);
    expect(en.events).toEqual([]);
    expect((run(MONEY_FLOW_PROFILE_MODULE, noVol, S, "zh").prims[0] as any).text).toBe("无成交量数据");
  });
});

// ─── 27c. autoPatterns — exact fit, projection, break, target, caps ───────────

describe("autoPatterns — exact geometry on a crafted channel", () => {
  // Peaks 110/109/108/107 at bars 5/15/25/35 and troughs 100/99/98/97 at 10/20/30/40 — two exactly
  // collinear anchor sets of slope −0.1/bar:  resistance y = −0.1i + 110.5,  support y = −0.1i + 101.
  // Parallel (|Δm| = 0) → a CHANNEL of constant height 9.5. The tail stays inside the channel, so
  // the newest pattern is live and unbroken.
  const RES = (i: number) => -0.1 * i + 110.5;
  const SUP = (i: number) => -0.1 * i + 101;
  const CHANNEL = appendBars(zigBars([100, 110, 100, 109, 99, 108, 98, 107, 97], 5), [
    { c: 98.5 }, { c: 100 }, { c: 101.5 }, { c: 103 }, { c: 104.5 },
  ]);
  const S = { size: "small" as const };
  const ID = "pat-0-45"; // set 0, existence bar = the newest anchor's confirmedAt (40 + 5)

  it("fits both anchor lines through the collinear pivots to 1e-6", () => {
    const res = run(AUTO_PATTERNS_MODULE, CHANNEL, S);
    const poly = (k: string) => primOf(res, `${ID}-${k}`) as any;
    for (const [k, f] of [["res", RES], ["sup", SUP]] as Array<[string, (i: number) => number]>) {
      const p = poly(k);
      expect(p.kind).toBe("poly");
      expect(p.pts.length).toBe(2);
      for (const pt of p.pts) expect(pt.p, `${k} @${pt.i}`).toBeCloseTo(f(pt.i), 6);
    }
    expect(poly("res").pts[0].i, "line starts at its earliest anchor").toBe(5);
    expect(poly("sup").pts[0].i).toBe(10);
    // every crafted pivot sits ON its line (that is what "anchored" means)
    for (const [i, p] of [[5, 110], [15, 109], [25, 108], [35, 107]] as Array<[number, number]>) {
      expect(RES(i)).toBeCloseTo(p, 9);
    }
    const tip = res.tooltips!.find((t) => t.id === ID)!;
    expect(tip.title).toBe("Channel");
    expect(tip.rows.find((r) => r.k === "Anchors")!.v).toBe("4H / 4L");
    expect(tip.rows.find((r) => r.k === "Height")!.v).toBe("9.50"); // 110.5 − 101
    expect(tip.rows.find((r) => r.k === "Break")!.v).toBe("none yet");
  });

  it("projects the confirmed slope past the last bar — exact at +10 bars", () => {
    const res = run(AUTO_PATTERNS_MODULE, CHANNEL, S);
    const last = CHANNEL.length - 1;
    for (const [k, f] of [["res", RES], ["sup", SUP]] as Array<[string, (i: number) => number]>) {
      const proj = primOf(res, `${ID}-${k}-x`) as any;
      expect(proj.kind).toBe("line");
      expect(proj.dash).toBe("4 3");
      expect(proj.a.i, "the projection starts where the body ends").toBe(last);
      expect(proj.b.i).toBe(last + 20);
      expect(proj.a.p).toBeCloseTo(f(last), 6);
      expect(proj.b.p).toBeCloseTo(f(last + 20), 6);
      // the value 10 bars out, read off the drawn segment, is the fitted line's value
      const at10 = proj.a.p + ((proj.b.p - proj.a.p) * 10) / (proj.b.i - proj.a.i);
      expect(at10, `${k} @ +10 bars`).toBeCloseTo(f(last + 10), 6);
    }
    // the dashed midline runs between the two lines
    const mid = primOf(res, `${ID}-mid`) as any;
    expect(mid.color).toBe(COLORS.neutral);
    expect(mid.a.p).toBeCloseTo((RES(mid.a.i) + SUP(mid.a.i)) / 2, 6);
    expect(mid.b.p).toBeCloseTo((RES(mid.b.i) + SUP(mid.b.i)) / 2, 6);
  });

  it("breaks on the CLOSE only — a wick through the line is not a break", () => {
    const i = CHANNEL.length; // the appended bar's index
    const poke = appendBars(CHANNEL, [{ c: RES(i) - 2, h: RES(i) + 2 }]);
    const rp = run(AUTO_PATTERNS_MODULE, poke, S);
    expect(evOf(rp, "pat_break"), "a wick above the line fires nothing").toEqual([]);
    expect(rp.prims.some((p) => p.id.endsWith("-bk")), "no break pill").toBe(false);
    expect(rp.tooltips![0].rows.find((r) => r.k === "Break")!.v).toBe("none yet");

    const brk = appendBars(CHANNEL, [{ c: RES(i) + 2.1 }]);
    const rb = run(AUTO_PATTERNS_MODULE, brk, S);
    const evs = evOf(rb, "pat_break");
    expect(evs.map((e) => [e.type, e.dir, e.i])).toEqual([["pat_break", "bull", i]]);
    expect(evs[0].p, "the event price is the LINE value at the break bar").toBeCloseTo(RES(i), 9);
    // a broken pattern stops at the break bar, flips dashed, and drops its projection
    const body = primOf(rb, `${ID}-res`) as any;
    expect(body.pts[1].i).toBe(i);
    expect(body.dash).toBe("4 3");
    expect(body.alpha).toBe(0.4);
    expect(rb.prims.some((p) => p.id.endsWith("-res-x")), "no projection past a broken line").toBe(false);
  });

  it("upgrades the break to the Strong tier only on a top-percentile volume bar", () => {
    const i = CHANNEL.length;
    const quiet = run(AUTO_PATTERNS_MODULE, appendBars(CHANNEL, [{ c: RES(i) + 2.1, v: 1 }]), S);
    const loud = run(AUTO_PATTERNS_MODULE, appendBars(CHANNEL, [{ c: RES(i) + 2.1, v: 99999 }]), S);
    const pill = (r: ModuleResult) => primOf(r, `${ID}-bk`) as any;
    expect(pill(quiet).text).toBe("▲ Break Up");
    expect(pill(quiet).bold).toBe(false);
    expect(evOf(quiet, "pat_break")[0].strength, "0th percentile").toBe(0);
    expect(pill(loud).text).toBe("▲+ Strong Break Up");
    expect(pill(loud).bold).toBe(true);
    expect(evOf(loud, "pat_break")[0].strength, "100th percentile").toBe(100);
    expect(evOf(loud, "pat_break")[0].label).toBe("Channel break up · vol 100%");
    // the pill points at the line and sits on the side price came from
    expect(pill(loud).place).toBe("below");
    expect(pill(loud).pointer).toBe(true);
    expect(pill(loud).p).toBeCloseTo(RES(i), 9);
    // zh keeps the same glyph vocabulary
    const zh = run(AUTO_PATTERNS_MODULE, appendBars(CHANNEL, [{ c: RES(i) + 2.1, v: 99999 }]), S, "zh");
    expect((primOf(zh, `${ID}-bk`) as any).text).toBe("▲+ 强势向上突破");
    expect(evOf(zh, "pat_break")[0].label).toBe("通道向上突破 · 量能 100%");
  });

  it("projects the measured move by the channel HEIGHT and closes it on the touch", () => {
    const i = CHANNEL.length;
    const height = RES(i) - SUP(i); // 9.5 at every bar — the channel is parallel
    expect(height).toBeCloseTo(9.5, 9);
    const open = run(AUTO_PATTERNS_MODULE, appendBars(CHANNEL, [{ c: RES(i) + 2.1, v: 99999 }]), S);
    const tl = primOf(open, `${ID}-tl`) as any;
    expect(tl.a.p, "target = line value at the break + channel height").toBeCloseTo(RES(i) + height, 6);
    expect(tl.a.i).toBe(i);
    expect(tl.b.i, "an unhit target runs to the right edge").toBe("right");
    expect((primOf(open, `${ID}-tc`) as any).text).toBe(`Target ${(RES(i) + height).toFixed(2)}`);
    expect(evOf(open, "pat_target_hit"), "not hit yet").toEqual([]);
    expect(open.tooltips![0].rows.find((r) => r.k === "Target")!.v).toContain("open");

    const hit = run(
      AUTO_PATTERNS_MODULE,
      appendBars(CHANNEL, [{ c: RES(i) + 2.1, v: 99999 }, { c: RES(i) + 6 }, { c: RES(i) + height + 2 }]),
      S,
    );
    const hits = evOf(hit, "pat_target_hit");
    expect(hits.map((e) => e.i), "the first bar whose HIGH reaches the level").toEqual([i + 2]);
    expect(hits[0].p).toBeCloseTo(RES(i) + height, 6);
    expect((primOf(hit, `${ID}-tc`) as any).text).toContain("✓");
    expect((primOf(hit, `${ID}-tl`) as any).b.i, "the level stops at the touch").toBe(i + 2);
    // targets are a channel-only measured move, and they are opt-out
    const off = run(AUTO_PATTERNS_MODULE, appendBars(CHANNEL, [{ c: RES(i) + 2.1, v: 99999 }]), { ...S, targets: false });
    expect(off.prims.some((p) => p.id.endsWith("-tl"))).toBe(false);
    expect(evOf(off, "pat_target_hit")).toEqual([]);
  });

  it("refuses the channel when the two slopes disagree by more than 15%", () => {
    // troughs 100/98/96/94 → support slope −0.2 vs resistance −0.1: |Δm| = 0.1 > 0.15 × 0.2 = 0.03
    const wedge = appendBars(zigBars([100, 110, 100, 109, 98, 108, 96, 107, 94], 5), [
      { c: 96 }, { c: 98 }, { c: 100 },
    ]);
    const res = run(AUTO_PATTERNS_MODULE, wedge, S);
    expect(res.prims.some((p) => p.id.endsWith("-mid")), "no midline without a channel").toBe(false);
    const drawn = res.prims.filter((p) => p.id.endsWith("-res") || p.id.endsWith("-sup"));
    expect(drawn.length, "only the stronger single line survives").toBe(1);
    expect(res.tooltips![0].title).toBe("Trendline · Resistance");
    expect(res.tooltips![0].rows.find((r) => r.k === "Anchors")!.v).toBe("4 H");
    expect(res.tooltips![0].rows.some((r) => r.k === "Height"), "height is a channel row").toBe(false);
    // the crafted channel above DOES pass the same gate — the difference is the slope, nothing else
    expect(run(AUTO_PATTERNS_MODULE, CHANNEL, S).tooltips![0].title).toBe("Channel");
  });

  it("caps the drawn pattern sets at showLast, newest first", () => {
    const bars = walkBars(600, 20260729, 37);
    const setsOf = (showLast: number) =>
      [...new Set(run(AUTO_PATTERNS_MODULE, bars, { showLast }).prims.map((p) => p.id.split("-").slice(0, 3).join("-")))];
    const four = setsOf(4);
    expect(four.length).toBe(4);
    for (const showLast of [1, 2, 3, 4]) {
      const got = setsOf(showLast);
      expect(got.length, `showLast=${showLast}`).toBe(showLast);
      expect(got, "the kept sets are the newest ones, in order").toEqual(four.slice(0, showLast));
      expect(got[0], "set 0 is always the live one").toBe(four[0]);
    }
    // older sets sit strictly further left (no overlapping spider web)
    const ends = four.map((id) => Number(id.split("-")[2]));
    for (let k = 1; k < ends.length; k++) expect(ends[k]).toBeLessThan(ends[k - 1]);
  });
});

// ─── 27d. orderBlocks — the opt-in macro (4× resampled) layer ─────────────────

describe("orderBlocks — macro blocks", () => {
  const BARS = walkBars(400, 20260729, 37);
  const macroPrims = (r: ModuleResult) => r.prims.filter((p) => p.id.startsWith("obm:"));
  const macroEvents = (r: ModuleResult) => (r.events ?? []).filter((e) => (e.label ?? "").startsWith("Macro "));

  it("is off by default and leaves the 1× layer byte-identical when on (golden compare)", () => {
    expect(ORDER_BLOCKS_MODULE.defaults.macro).toBe(false);
    for (const bars of [BARS, walkBars(400, 4242, 37), walkBars(700, 77, 29)]) {
      const off = run(ORDER_BLOCKS_MODULE, bars);
      expect(macroPrims(off), "macro:false draws no macro chrome").toEqual([]);
      expect(macroEvents(off)).toEqual([]);
      const on = run(ORDER_BLOCKS_MODULE, bars, { macro: true });
      // strip the macro layer from the macro:true run — what is left must be the untouched module
      expect(on.prims.filter((p) => !p.id.startsWith("obm:"))).toEqual(off.prims);
      expect((on.events ?? []).filter((e) => !(e.label ?? "").startsWith("Macro "))).toEqual(off.events ?? []);
      expect(on.tooltips ?? []).toEqual(off.tooltips ?? []);
      expect((off.events ?? []).length, "these fixtures stay under the tape cap").toBeLessThan(240);
    }
  });

  it("merges the two legs into ONE bar-ordered, capped tape", () => {
    // The macro leg is detected separately and appended, so without a merge step the stream would
    // end on an OLD (group-end) event and could run to twice the module's declared MAX_EVENTS.
    for (const n of [400, 2000, 5000]) {
      const evs = run(ORDER_BLOCKS_MODULE, walkBars(n, 20260729, 11), { macro: true }).events ?? [];
      for (let k = 1; k < evs.length; k++) {
        expect(evs[k].i, `n=${n}: tape is bar-ordered at ${k}`).toBeGreaterThanOrEqual(evs[k - 1].i);
      }
      expect(evs.length, `n=${n}: tape stays bounded`).toBeLessThanOrEqual(240);
      expect(evs.some((e) => (e.label ?? "").startsWith("Macro ")), `n=${n}: macro leg present`).toBe(true);
      // the newest event in the tape is a real 1× event, not a stale macro one
      const last1x = [...evs].reverse().find((e) => !(e.label ?? "").startsWith("Macro "))!;
      expect(evs[evs.length - 1].i).toBeGreaterThanOrEqual(last1x.i - 3);
    }
  });

  it("only reads CLOSED 4-bar groups — the boundary fixture proves the one-group lag", () => {
    // walkBars is a prefix-stable generator, so bars 0..391 are identical in both runs. At n = 392
    // the group covering 388..391 ENDS on the live forming bar and must be invisible; one bar later
    // it has closed and its detection appears, mapped to the group's last source bar (391).
    const at392 = macroEvents(run(ORDER_BLOCKS_MODULE, walkBars(392, 20260729, 37), { macro: true }));
    const at393 = macroEvents(run(ORDER_BLOCKS_MODULE, walkBars(393, 20260729, 37), { macro: true }));
    expect(392 % 4, "the fixture sits exactly on a group boundary").toBe(0);
    expect(Math.max(...at392.map((e) => e.i)), "nothing from the forming group").toBe(387);
    expect(at393.length, "one bar later the group is closed and usable").toBe(at392.length + 1);
    expect(at393[at393.length - 1].i).toBe(391);
    // the older tape is untouched — a closed group never repaints
    expect(at393.slice(0, at392.length)).toEqual(at392);
    // and EVERY macro event lands on a group's last source bar (i ≡ 3 mod 4), never mid-group
    for (const n of [392, 393, 400, 401, 402, 403]) {
      const evs = macroEvents(run(ORDER_BLOCKS_MODULE, walkBars(n, 20260729, 37), { macro: true }));
      for (const e of evs) {
        expect((e.i + 1) % 4, `n=${n}: event ${e.i} is a group end`).toBe(0);
        expect(e.i, `n=${n}: never the live bar`).toBeLessThanOrEqual(n - 2);
      }
    }
  });

  it("draws quiet dashed macro bands with an M- tier label, in the user's language", () => {
    const on = run(ORDER_BLOCKS_MODULE, BARS, { macro: true });
    const zones = macroPrims(on).filter((p) => p.kind === "zone") as any[];
    const tiers = macroPrims(on).filter((p) => p.kind === "label") as any[];
    expect(zones.length).toBeGreaterThan(0);
    expect(tiers.length).toBe(zones.length);
    for (const z of zones) {
      expect(z.fillAlpha, "quieter than the 1× layer").toBe(0.06);
      expect(z.dash).toBe("4 3");
      expect(z.strokeW).toBe(1);
      expect(z.z, "drawn UNDER the 1× blocks").toBe(0);
      expect(z.edges.length, "one hairline outer edge only").toBe(1);
      expect(z.edges[0]).toBe(z.fill === COLORS.up ? "bottom" : "top");
      expect(z.p2).toBeGreaterThan(z.p1);
      expect(z.i2).toBe("right"); // extendRight default
    }
    for (const t of tiers) {
      expect(t.text.startsWith("M-"), `macro tier label: ${t.text}`).toBe(true);
      expect(["WEAK", "BALANCED", "HIGH", "STRONG"]).toContain(t.text.slice(2));
      expect(t.color, "chrome, never a direction color").toBe(COLORS.muted);
      expect(t.minPxPerBar).toBe(2);
    }
    // zh localizes the tier word but keeps the M- prefix (language-neutral, like "BOS")
    const zh = run(ORDER_BLOCKS_MODULE, BARS, { macro: true }, "zh");
    for (const t of (zh.prims.filter((p) => p.id.startsWith("obm:") && p.kind === "label") as any[])) {
      expect(t.text.startsWith("M-")).toBe(true);
      expect(/[一-鿿]/.test(t.text), `zh tier word missing in ${t.text}`).toBe(true);
    }
    // non-extending macro bands live 15 MACRO bars = 60 source bars past their impulse group; the
    // band starts at the ANCHOR group, up to ANCHOR_SCAN(5) macro bars earlier, so the drawn span
    // is bounded by 60 + 5×4 + the anchor group's own 4 bars.
    const noExt = run(ORDER_BLOCKS_MODULE, BARS, { macro: true, extendRight: false });
    const noExtZones = noExt.prims.filter((p) => p.id.startsWith("obm:") && p.kind === "zone") as any[];
    expect(noExtZones.length).toBe(zones.length);
    for (let k = 0; k < noExtZones.length; k++) {
      const z = noExtZones[k];
      expect(typeof z.i2).toBe("number");
      expect(z.i2).toBeGreaterThan(z.i1);
      expect(z.i2 - z.i1).toBeLessThanOrEqual(15 * 4 + 5 * 4 + 4);
      expect(z.i2).toBeLessThanOrEqual(BARS.length - 1);
      // only the right edge moves — the block's identity and price bounds are unchanged
      expect([z.id, z.i1, z.p1, z.p2]).toEqual([zones[k].id, zones[k].i1, zones[k].p1, zones[k].p2]);
    }
  });

  it("caps the macro layer at min(3, showLast)", () => {
    for (const showLast of [1, 2, 3, 5, 8]) {
      const zones = macroPrims(run(ORDER_BLOCKS_MODULE, BARS, { macro: true, showLast })).filter((p) => p.kind === "zone");
      expect(zones.length, `showLast=${showLast}`).toBeLessThanOrEqual(Math.min(3, showLast));
    }
    expect(macroPrims(run(ORDER_BLOCKS_MODULE, BARS, { macro: true, showLast: 1 })).filter((p) => p.kind === "zone").length).toBe(1);
    expect(macroPrims(run(ORDER_BLOCKS_MODULE, BARS, { macro: true, showLast: 8 })).filter((p) => p.kind === "zone").length).toBe(3);
    // the `type` filter applies to macro blocks too (same `keep` predicate as the 1× layer)
    for (const [type, col] of [["bull", COLORS.up], ["bear", COLORS.down]] as Array<[string, string]>) {
      const only = run(ORDER_BLOCKS_MODULE, BARS, { macro: true, type });
      const zones = macroPrims(only).filter((p) => p.kind === "zone") as any[];
      expect(zones.length, `type=${type}`).toBeGreaterThan(0);
      for (const z of zones) expect(z.fill, `type=${type}`).toBe(col);
    }
  });

  it("stays deterministic, finite and quiet on a short or dirty series", () => {
    const a = run(ORDER_BLOCKS_MODULE, BARS, { macro: true });
    expect(JSON.stringify(run(ORDER_BLOCKS_MODULE, BARS, { macro: true }))).toBe(JSON.stringify(a));
    // fewer than MIN_BARS closed groups (30 × 4 = 120 source bars) → no macro layer at all
    expect(macroPrims(run(ORDER_BLOCKS_MODULE, BARS.slice(0, 100), { macro: true }))).toEqual([]);
    expect(() => run(ORDER_BLOCKS_MODULE, dirtyBars(), { macro: true })).not.toThrow();
    const dirty = run(ORDER_BLOCKS_MODULE, dirtyBars(), { macro: true });
    for (const p of macroPrims(dirty)) {
      const bad: string[] = [];
      scanNumbers(p, `ob-macro:${p.id}`, bad);
      expect(bad, "non-finite macro geometry").toEqual([]);
    }
    expect(macroPrims(a).every((p) => p.id.startsWith("obm:")), "macro ids are namespaced").toBe(true);
    expect(new Set(a.prims.map((p) => p.id)).size, "prim ids stay unique with macro on").toBe(a.prims.length);
    expect(a.prims.length).toBeLessThanOrEqual(MAX_PRIMS_PER_MODULE);
  });
});
