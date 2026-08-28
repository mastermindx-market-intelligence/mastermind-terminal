// Trend Engine — Trend Waves suite flagship (the PhantomFlow "Shift" equivalent).
//
// Contract: lib/indicator-canvas/types.ts (frozen). Visual spec: docs/
// PREMIUM_INDICATOR_VISUAL_DESIGN_BIBLE_2026-07-28.md §"Trend Signals — visual spec".
// Algorithm sketch: docs/PREMIUM_INDICATOR_SUITE_MASTERPLAN_2026-07-28.md §8.2.
//
// Core: an ATR trailing-stop flip engine. sensitivity s∈1..10 maps to
// (atrPeriod, mult) = (round(7 + s·1.5), 1.2 + s·0.28) — s=1 ≈ (9, 1.5) fast,
// s=10 ≈ (22, 4.0) slow. In an uptrend the stop only ratchets up
// (stop = max(prevStop, hl2 − mult·ATR)); a close through the stop flips the regime.
// On top of the flips: tiered BUY/SELL pills (momentum-percentile "+" tier, RSI-extreme
// "POWER" bottoms/tops), band retest dots, background regime tint, and a TP/SL ladder
// on the most recent episodes.
//
// Non-repaint: one forward pass; every state at bar n derives from bars ≤ n only, so
// appending bars never alters previously-confirmed flips/retests/TP hits. The ONE
// documented exception is autoOpt (default OFF): re-optimizing sensitivity on new data
// restyles history by design — the field tip warns, and non-repaint tests run with it off.
// Pure — no wall clock, no randomness, no module-level mutable state.

import type {
  BgShadePrim,
  CloudPrim,
  GradLinePrim,
  LabelPrim,
  LinePrim,
  MarkerPrim,
  ModuleCtx,
  ModuleResult,
  Prim,
  SuiteBar,
  SuiteEvent,
  SuiteField,
  SuiteModuleDef,
  TooltipDef,
} from "@/lib/indicator-canvas/types";
import { TREND_ENGINE_META } from "./trendEngine.meta";

// ------------------------------------------------------------------------------------ constants

const K_DYN = [1.5, 2.5, 3.5, 5, 6.5, 8]; // dynamic TP ladder, k·ATR(flipBar) from entry
const ROC_LEN = 10; // momentum = |ROC(10)|
const MOM_WIN = 200; // percentile window for the momentum tier
const STRONG_PCT = 70; // ≥70th percentile ⇒ "+" tier
const RSI_LEN = 14;
const RSI_OS = 25; // Power Bottom: flip ≤10 bars after RSI crossed back UP through 25
const RSI_OB = 75; // Power Top: flip ≤10 bars after RSI crossed back DOWN through 75
const POWER_WINDOW = 10;
const RETEST_COOLDOWN = 5; // max one retest dot per 5 bars
const TP_MAX_BARS = 120; // TP lines never extend further than this past the flip
const AUTO_OPT_WINDOW = 2000;
const MAX_BAND_SEGMENTS = 24; // band/shadow drawn for the most recent regime runs
const MAX_TINT_SEGMENTS = 12; // bgshade cap (spec: last 12 segments)
const MAX_SIGNAL_FLIPS = 30; // flip chrome (marker+pill+power) for the most recent flips
const MAX_RETEST_MARKERS = 40;
const MAX_EVENTS = 100;
const BAND_W = 2;
const SHADOW_W = 1;
const SHADOW_ALPHA = 0.06;
const TINT_ALPHA = 0.05;
const PILL_FS = 10;
const POWER_FS = 8;
const CHIP_FS = 9;
const AUTO_FS = 8;
const MARKER_SIZE = 6;
const MARKER_SIZE_STRONG = 7;
const RETEST_SIZE = 3.5;
const RETEST_ALPHA = 0.7;
const CHIP_MIN_PX_PER_BAR = 2;

// ------------------------------------------------------------------------------------- settings


// -------------------------------------------------------------------------------------- helpers

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function numOpt(v: any, d: number, lo: number, hi: number): number {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? clamp(n, lo, hi) : d;
}

function selOpt<T extends string>(v: any, d: T, allowed: readonly T[]): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : d;
}

function boolOpt(v: any, d: boolean): boolean {
  return typeof v === "boolean" ? v : d;
}

/** A bar with a zero/NaN price is MISSING, not a print (CN/HK premarket pushes OHLC=0). */
function validBar(b: SuiteBar | undefined): b is SuiteBar {
  if (!b) return false;
  return (
    Number.isFinite(b.o) &&
    Number.isFinite(b.h) &&
    Number.isFinite(b.l) &&
    Number.isFinite(b.c) &&
    b.h > 0 &&
    b.l > 0 &&
    b.h >= b.l
  );
}

function fmtPrice(p: number): string {
  const a = Math.abs(p);
  const d = a >= 1 ? 2 : a >= 0.01 ? 4 : 6;
  return p.toFixed(d);
}

/** sensitivity 1..10 → engine params. s=1 ≈ (9, 1.5) fast, s=10 ≈ (22, 4.0) slow. */
function mapSens(s: number): { period: number; mult: number } {
  return { period: Math.round(7 + s * 1.5), mult: 1.2 + s * 0.28 };
}

/** Wilder ATR. Warm-up uses the running mean of the true ranges so short series still work. */
function atrSeries(bars: SuiteBar[], len: number): Float64Array {
  const n = bars.length;
  const out = new Float64Array(n);
  let seedSum = 0;
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const b = bars[i];
    const pc = i > 0 && Number.isFinite(bars[i - 1].c) && bars[i - 1].c > 0 ? bars[i - 1].c : b.o;
    const hl = b.h - b.l;
    const tr = Math.max(
      Number.isFinite(hl) ? hl : 0,
      Number.isFinite(pc) ? Math.abs(b.h - pc) : 0,
      Number.isFinite(pc) ? Math.abs(b.l - pc) : 0,
    );
    const t = Number.isFinite(tr) && tr > 0 ? tr : 0;
    if (i < len) {
      seedSum += t;
      prev = seedSum / (i + 1);
    } else {
      prev = (prev * (len - 1) + t) / len;
    }
    out[i] = prev;
  }
  return out;
}

/** Wilder RSI over closes (invalid bars inherit the previous close ⇒ zero delta). */
function rsiSeries(bars: SuiteBar[], len: number): Float64Array {
  const n = bars.length;
  const out = new Float64Array(n).fill(50);
  let prevC = NaN;
  let avgG = 0;
  let avgL = 0;
  let k = 0; // count of deltas seen (warm-up divisor)
  for (let i = 0; i < n; i++) {
    const b = bars[i];
    const c = validBar(b) ? b.c : prevC;
    if (!Number.isFinite(c)) {
      out[i] = 50;
      continue;
    }
    if (Number.isFinite(prevC)) {
      const d = c - prevC;
      const g = d > 0 ? d : 0;
      const l = d < 0 ? -d : 0;
      k++;
      if (k <= len) {
        avgG += (g - avgG) / k;
        avgL += (l - avgL) / k;
      } else {
        avgG = (avgG * (len - 1) + g) / len;
        avgL = (avgL * (len - 1) + l) / len;
      }
    }
    out[i] = avgL > 0 ? 100 - 100 / (1 + avgG / avgL) : avgG > 0 ? 100 : 50;
    prevC = c;
  }
  return out;
}

/** Percentile rank (0..100) of vals[i] within the trailing window [i-win+1, i]. O(win). */
function percentileAt(vals: Float64Array, i: number, win: number): number {
  const v = vals[i];
  if (!Number.isFinite(v)) return 0;
  const lo = Math.max(0, i - win + 1);
  let cnt = 0;
  let atOrBelow = 0;
  for (let j = lo; j <= i; j++) {
    const x = vals[j];
    if (Number.isFinite(x)) {
      cnt++;
      if (x <= v) atOrBelow++;
    }
  }
  return cnt ? Math.round((atOrBelow / cnt) * 100) : 0;
}

/**
 * autoOpt scorer: run the flip engine over bars[from..] with window-local ATR warm-up and
 * score flip-to-flip trades: net% + 0.5·winrate%. Deterministic; ties resolve to the lowest s.
 */
function scoreWindow(bars: SuiteBar[], from: number, period: number, mult: number): number {
  let avgTr = 0;
  let k = 0;
  let prevC = NaN;
  let dir: 1 | -1 | 0 = 0;
  let stop = 0;
  let entry = 0;
  let net = 0;
  let wins = 0;
  let trades = 0;
  for (let i = from; i < bars.length; i++) {
    const b = bars[i];
    if (!validBar(b)) continue;
    const pc = Number.isFinite(prevC) ? prevC : b.o;
    const tr = Math.max(b.h - b.l, Math.abs(b.h - pc), Math.abs(b.l - pc));
    k++;
    if (k <= period) avgTr += (tr - avgTr) / k;
    else avgTr = (avgTr * (period - 1) + tr) / period;
    prevC = b.c;
    const a = avgTr;
    const hl2 = (b.h + b.l) / 2;
    if (dir === 0) {
      dir = b.c >= hl2 ? 1 : -1;
      stop = hl2 - dir * mult * a;
      entry = b.c;
      continue;
    }
    if (dir === 1) {
      stop = Math.max(stop, hl2 - mult * a);
      if (b.c < stop) {
        const r = entry > 0 ? (b.c / entry - 1) * 100 : 0;
        net += r;
        trades++;
        if (r > 0) wins++;
        dir = -1;
        stop = hl2 + mult * a;
        entry = b.c;
      }
    } else {
      stop = Math.min(stop, hl2 + mult * a);
      if (b.c > stop) {
        const r = entry > 0 ? (1 - b.c / entry) * 100 : 0;
        net += r;
        trades++;
        if (r > 0) wins++;
        dir = 1;
        stop = hl2 - mult * a;
        entry = b.c;
      }
    }
  }
  const winrate = trades ? (wins / trades) * 100 : 0;
  return net + 0.5 * winrate;
}

// ------------------------------------------------------------------------------------ compute

interface Flip {
  i: number;
  dir: 1 | -1;
  entry: number;
  atr: number; // ATR at the flip bar (TP ladder unit)
  mom: number; // momentum percentile 0..100
  power: boolean;
}

function compute(ctx: ModuleCtx): ModuleResult {
  const { bars, colors, lang } = ctx;
  const n = bars.length;
  const empty: ModuleResult = { prims: [], tooltips: [], events: [] };
  if (n < 15) return empty;

  const s = ctx.s || {};
  const sensitivity = Math.round(numOpt(s.sensitivity, 5, 1, 10));
  const autoOpt = boolOpt(s.autoOpt, false);
  const bands = boolOpt(s.bands, true);
  const shadow = boolOpt(s.shadow, false);
  const bgTint = boolOpt(s.bgTint, true);
  const pills = boolOpt(s.pills, true);
  const tiers = boolOpt(s.tiers, true);
  const retestsOn = boolOpt(s.retests, true);
  const tpMode = selOpt(s.tpMode, "dynamic" as const, ["off", "dynamic", "fixed"] as const);
  const tpCount = Math.round(numOpt(s.tpCount, 3, 1, 6));
  const tpFixed = [
    numOpt(s.tpFixed1, 2, 0.1, 100),
    numOpt(s.tpFixed2, 4, 0.1, 200),
    numOpt(s.tpFixed3, 8, 0.1, 400),
  ];
  const slMode = selOpt(s.slMode, "trailing" as const, ["off", "fixed", "trailing"] as const);
  const slFixed = numOpt(s.slFixed, 3, 0.1, 50);
  const showLast = Math.round(numOpt(s.showLast, 2, 1, 6));
  const zh = lang === "zh";

  // ---- autoOpt (DEFAULT OFF — documented repaint hazard) --------------------------------
  let effSens = sensitivity;
  if (autoOpt) {
    const from = Math.max(0, n - Math.min(AUTO_OPT_WINDOW, n));
    let best = -Infinity;
    for (let cand = 1; cand <= 10; cand++) {
      const p = mapSens(cand);
      const sc = scoreWindow(bars, from, p.period, p.mult);
      if (sc > best) {
        best = sc;
        effSens = cand;
      }
    }
  }
  const { period, mult } = mapSens(effSens);

  // ---- series (all forward-only) --------------------------------------------------------
  const atr = atrSeries(bars, period);
  const rsi = rsiSeries(bars, RSI_LEN);

  // |ROC(10)| for the momentum tier
  const rocAbs = new Float64Array(n).fill(NaN);
  for (let i = ROC_LEN; i < n; i++) {
    const c0 = bars[i - ROC_LEN];
    const c1 = bars[i];
    if (validBar(c0) && validBar(c1) && c0.c > 0) rocAbs[i] = Math.abs(c1.c / c0.c - 1);
  }

  // last bar where RSI crossed back from an extreme (carry-forward indices)
  const NEG = -(1 << 30);
  const lastUp25 = new Int32Array(n).fill(NEG);
  const lastDn75 = new Int32Array(n).fill(NEG);
  let lu = NEG;
  let ld = NEG;
  for (let i = 1; i < n; i++) {
    if (rsi[i - 1] < RSI_OS && rsi[i] >= RSI_OS) lu = i;
    if (rsi[i - 1] > RSI_OB && rsi[i] <= RSI_OB) ld = i;
    lastUp25[i] = lu;
    lastDn75[i] = ld;
  }

  // ---- flip engine: single forward pass -------------------------------------------------
  const stops = new Float64Array(n).fill(NaN);
  const dirs = new Int8Array(n); // 0 = pre-seed
  const flips: Flip[] = [];
  const retests: Array<{ i: number; p: number; dir: 1 | -1 }> = [];
  const events: SuiteEvent[] = [];

  let dir: 1 | -1 | 0 = 0;
  let stop = NaN;
  let lastFlipI = -1;
  let lastRetestI = -RETEST_COOLDOWN * 4;

  for (let i = 0; i < n; i++) {
    const b = bars[i];
    if (!validBar(b)) {
      stops[i] = stop;
      dirs[i] = dir;
      continue; // missing bar: carry state, no flip/retest decisions on garbage prints
    }
    const a = atr[i];
    const hl2 = (b.h + b.l) / 2;
    if (dir === 0) {
      dir = b.c >= hl2 ? 1 : -1;
      stop = hl2 - dir * mult * a;
    } else if (dir === 1) {
      stop = Math.max(stop, hl2 - mult * a);
      if (b.c < stop) {
        dir = -1;
        stop = hl2 + mult * a;
        const mom = percentileAt(rocAbs, i, MOM_WIN);
        const power = i - lastDn75[i] <= POWER_WINDOW;
        flips.push({ i, dir: -1, entry: b.c, atr: a, mom, power });
        lastFlipI = i;
      } else if (lastFlipI >= 0 && b.l <= stop && b.c > stop && i - lastRetestI >= RETEST_COOLDOWN) {
        retests.push({ i, p: stop, dir: 1 });
        lastRetestI = i;
        events.push({
          type: "te_retest",
          dir: "bull",
          i,
          p: stop,
          label: zh ? "趋势带回测 · 支撑成立" : "Band retest held · support",
        });
      }
    } else {
      stop = Math.min(stop, hl2 + mult * a);
      if (b.c > stop) {
        dir = 1;
        stop = hl2 - mult * a;
        const mom = percentileAt(rocAbs, i, MOM_WIN);
        const power = i - lastUp25[i] <= POWER_WINDOW;
        flips.push({ i, dir: 1, entry: b.c, atr: a, mom, power });
        lastFlipI = i;
      } else if (lastFlipI >= 0 && b.h >= stop && b.c < stop && i - lastRetestI >= RETEST_COOLDOWN) {
        retests.push({ i, p: stop, dir: -1 });
        lastRetestI = i;
        events.push({
          type: "te_retest",
          dir: "bear",
          i,
          p: stop,
          label: zh ? "趋势带回测 · 阻力成立" : "Band retest held · resistance",
        });
      }
    }
    stops[i] = stop;
    dirs[i] = dir;
  }

  // flip + power events
  for (const f of flips) {
    const strong = f.mom >= STRONG_PCT;
    events.push({
      type: "te_flip",
      dir: f.dir > 0 ? "bull" : "bear",
      i: f.i,
      p: f.entry,
      strength: f.mom,
      label: zh
        ? `${f.dir > 0 ? "买入" : "卖出"}${strong ? "+" : ""}信号 · 动能分位 ${f.mom}`
        : `${f.dir > 0 ? "BUY" : "SELL"}${strong ? "+" : ""} · momentum ${f.mom}th pct`,
    });
    if (f.power) {
      events.push({
        type: "te_power",
        dir: f.dir > 0 ? "bull" : "bear",
        i: f.i,
        p: f.entry,
        strength: f.mom,
        label: zh
          ? f.dir > 0 ? "强力底信号" : "强力顶信号"
          : f.dir > 0 ? "Power Bottom" : "Power Top",
      });
    }
  }

  // ---- regime runs (band segments / bg tint) --------------------------------------------
  const runs: Array<{ i1: number; i2: number; dir: 1 | -1 }> = [];
  for (let i = 0; i < n; i++) {
    const d = dirs[i];
    if (d === 0) continue;
    const cur = runs[runs.length - 1];
    if (cur && cur.dir === d && cur.i2 === i - 1) cur.i2 = i;
    else runs.push({ i1: i, i2: i, dir: d as 1 | -1 });
  }

  const prims: Prim[] = [];
  const tooltips: TooltipDef[] = [];
  const last = n - 1;
  const dirColor = (d: 1 | -1) => (d > 0 ? colors.up : colors.down);

  // ---- background tint (last 12 regime segments) ----------------------------------------
  if (bgTint) {
    for (const r of runs.slice(-MAX_TINT_SEGMENTS)) {
      prims.push({
        kind: "bgshade",
        id: `te-bg${r.i1}`,
        z: 0,
        i1: r.i1,
        i2: r.i2,
        color: dirColor(r.dir),
        alpha: TINT_ALPHA,
      } as BgShadePrim);
    }
  }

  // ---- band + shadow (per-segment gradlines; no connector across the flip jump) ---------
  if (bands || shadow) {
    for (const r of runs.slice(-MAX_BAND_SEGMENTS)) {
      const pts: Array<{ i: number; p: number }> = [];
      const off: Array<{ i: number; p: number }> = [];
      for (let i = r.i1; i <= r.i2; i++) {
        const p = stops[i];
        if (!Number.isFinite(p)) continue;
        pts.push({ i, p });
        if (shadow) off.push({ i, p: p - r.dir * atr[i] }); // one ATR further from price
      }
      if (pts.length < 2) continue;
      const col = dirColor(r.dir);
      if (bands) {
        prims.push({
          kind: "gradline",
          id: `te-band${r.i1}`,
          z: 2,
          pts,
          colors: new Array(pts.length).fill(col),
          w: BAND_W,
        } as GradLinePrim);
      }
      if (shadow) {
        prims.push({
          kind: "gradline",
          id: `te-sh${r.i1}`,
          z: 1,
          pts: off,
          colors: new Array(off.length).fill(col),
          w: SHADOW_W,
        } as GradLinePrim);
        prims.push({
          kind: "cloud",
          id: `te-cl${r.i1}`,
          z: 1,
          upper: pts,
          lower: off,
          segColors: new Array(pts.length - 1).fill(col),
          fillAlpha: SHADOW_ALPHA,
        } as CloudPrim);
      }
    }
  }

  // ---- flip signals: triangle + pill + POWER (most recent flips) ------------------------
  const L = {
    buy: "BUY",
    sell: "SELL",
    entry: zh ? "入场价" : "Entry",
    mom: zh ? "动能分位" : "Momentum",
    tier: zh ? "级别" : "Tier",
    tPower: zh ? "强力反转" : "Power reversal",
    tPlus: zh ? "强信号 +" : "Strong +",
    tStd: zh ? "标准" : "Standard",
    ttBuy: zh ? "买入信号" : "BUY signal",
    ttSell: zh ? "卖出信号" : "SELL signal",
  };

  for (const f of flips.slice(-MAX_SIGNAL_FLIPS)) {
    const b = bars[f.i];
    if (!validBar(b)) continue;
    const col = dirColor(f.dir);
    const strong = tiers && f.mom >= STRONG_PCT;
    const power = tiers && f.power;
    const unit = f.atr > 0 ? f.atr : Math.abs(f.entry) * 0.005 + 1e-9;
    const tipId = `te-f${f.i}`;

    const markerP = f.dir > 0 ? b.l - unit * 0.4 : b.h + unit * 0.4;
    prims.push({
      kind: "marker",
      id: `${tipId}-m`,
      z: 3,
      i: f.i,
      p: markerP,
      shape: f.dir > 0 ? "tri-up" : "tri-down",
      size: strong ? MARKER_SIZE_STRONG : MARKER_SIZE,
      fill: col,
      tooltipId: tipId,
    } as MarkerPrim);

    if (pills) {
      const pillP = f.dir > 0 ? b.l - unit * 1.1 : b.h + unit * 1.1;
      prims.push({
        kind: "label",
        id: `${tipId}-p`,
        z: 4,
        i: f.i,
        p: pillP,
        text: (f.dir > 0 ? L.buy : L.sell) + (strong ? "+" : ""),
        place: f.dir > 0 ? "below" : "above",
        style: "pill",
        color: colors.text,
        bg: col,
        fs: PILL_FS,
        bold: true,
        pointer: true,
        tooltipId: tipId,
      } as LabelPrim);
    }

    if (power) {
      const powerP = f.dir > 0 ? b.l - unit * 1.1 : b.h + unit * 1.1;
      prims.push({
        kind: "label",
        id: `${tipId}-pw`,
        z: 4,
        i: f.i,
        p: powerP,
        text: "POWER",
        place: f.dir > 0 ? "below" : "above",
        style: "bare",
        color: colors.warn,
        fs: POWER_FS,
        bold: true,
        dyPx: pills ? (f.dir > 0 ? 22 : -22) : 0, // clear the pill when it is shown
        tooltipId: tipId,
      } as LabelPrim);
    }

    tooltips.push({
      id: tipId,
      title: (f.dir > 0 ? L.ttBuy : L.ttSell) + (strong ? " +" : ""),
      accent: col,
      rows: [
        { k: L.entry, v: fmtPrice(f.entry) },
        { k: L.mom, v: `${f.mom} pct` },
        { k: L.tier, v: power ? L.tPower : strong ? L.tPlus : L.tStd, color: power ? colors.warn : undefined },
      ],
    });
  }

  // ---- retest dots ----------------------------------------------------------------------
  if (retestsOn) {
    for (const r of retests.slice(-MAX_RETEST_MARKERS)) {
      prims.push({
        kind: "marker",
        id: `te-r${r.i}`,
        z: 3,
        i: r.i,
        p: r.p,
        shape: "circle",
        size: RETEST_SIZE,
        fill: dirColor(r.dir),
        alpha: RETEST_ALPHA,
        minPxPerBar: CHIP_MIN_PX_PER_BAR,
      } as MarkerPrim);
    }
  }

  // ---- TP/SL ladder on the last `showLast` episodes -------------------------------------
  if ((tpMode !== "off" || slMode !== "off") && flips.length) {
    const episodes = flips.map((f, k) => ({
      flip: f,
      end: k + 1 < flips.length ? flips[k + 1].i : last,
      closed: k + 1 < flips.length,
    }));
    // Every episode is EVALUATED (TP/SL hits are state changes the W2 alert bridge consumes, and a
    // tape that dropped them as episodes scrolled out would repaint); only the last `showLast`
    // episodes are DRAWN.
    const drawFrom = Math.max(0, episodes.length - showLast);
    for (let ei = 0; ei < episodes.length; ei++) {
      const ep = episodes[ei];
      const draw = ei >= drawFrom;
      const f = ep.flip;
      const sign = f.dir; // +1 long, -1 short
      const col = dirColor(f.dir);
      const capEnd = Math.min(ep.end, f.i + TP_MAX_BARS);

      if (tpMode !== "off") {
        const ks = tpMode === "dynamic" ? K_DYN.slice(0, tpCount) : tpFixed;
        const levels = ks.map((k, idx) =>
          tpMode === "dynamic" ? f.entry + sign * k * f.atr : f.entry * (1 + (sign * tpFixed[idx]) / 100),
        );
        for (let t = 0; t < levels.length; t++) {
          const level = levels[t];
          if (!Number.isFinite(level) || level <= 0) continue;
          // first touch after the flip, inside the episode + 120-bar cap
          let hit = -1;
          for (let j = f.i + 1; j <= capEnd; j++) {
            const bj = bars[j];
            if (!validBar(bj)) continue;
            if (sign > 0 ? bj.h >= level : bj.l <= level) {
              hit = j;
              break;
            }
          }
          const lineEnd = hit >= 0 ? hit : capEnd;
          const tag = `TP${t + 1}`;
          if (draw && lineEnd > f.i) {
            prims.push({
              kind: "line",
              id: `te-tp${f.i}-${t}`,
              z: 2,
              a: { i: f.i, p: level },
              b: { i: lineEnd, p: level },
              color: colors.muted,
              w: 1,
              dash: "4 3",
              alpha: 0.9,
            } as LinePrim);
          }
          if (draw) {
            prims.push({
              kind: "label",
              id: `te-tpc${f.i}-${t}`,
              z: 3,
              i: f.i,
              p: level,
              text: hit >= 0 ? `${tag} ✓` : tag,
              place: "left",
              style: "chip",
              color: hit >= 0 ? colors.up : colors.muted,
              fs: CHIP_FS,
              minPxPerBar: CHIP_MIN_PX_PER_BAR,
            } as LabelPrim);
          }
          if (hit >= 0) {
            events.push({
              type: "te_tp_hit",
              dir: f.dir > 0 ? "bull" : "bear",
              i: hit,
              p: level,
              strength: Math.round(((t + 1) / levels.length) * 100),
              label: tag,
            });
          }
        }
      }

      if (slMode === "trailing" && draw) {
        // the band itself is the stop — chip only, no extra line
        const p0 = Number.isFinite(stops[f.i]) ? stops[f.i] : f.entry * (1 - sign * 0.02);
        prims.push({
          kind: "label",
          id: `te-slt${f.i}`,
          z: 3,
          i: f.i,
          p: p0,
          text: "SL trail",
          place: "left",
          style: "chip",
          color: colors.muted,
          fs: CHIP_FS,
          minPxPerBar: CHIP_MIN_PX_PER_BAR,
        } as LabelPrim);
      } else if (slMode === "fixed") {
        const level = f.entry * (1 - (sign * slFixed) / 100);
        let hit = -1;
        for (let j = f.i + 1; j <= ep.end; j++) {
          const bj = bars[j];
          if (!validBar(bj)) continue;
          if (sign > 0 ? bj.l <= level : bj.h >= level) {
            hit = j;
            break;
          }
        }
        const lineEnd = Math.min(hit >= 0 ? hit : ep.end, capEnd);
        if (draw && lineEnd > f.i) {
          prims.push({
            kind: "line",
            id: `te-sl${f.i}`,
            z: 2,
            a: { i: f.i, p: level },
            b: { i: lineEnd, p: level },
            color: hit >= 0 ? col : colors.muted,
            w: 1,
            dash: "3 3",
            alpha: 0.9,
          } as LinePrim);
        }
        if (draw) {
          prims.push({
            kind: "label",
            id: `te-slc${f.i}`,
            z: 3,
            i: f.i,
            p: level,
            text: hit >= 0 ? "SL ✗" : "SL",
            place: "left",
            style: "chip",
            color: hit >= 0 ? colors.down : colors.muted,
            fs: CHIP_FS,
            minPxPerBar: CHIP_MIN_PX_PER_BAR,
          } as LabelPrim);
        }
        if (hit >= 0) {
          events.push({
            type: "te_sl_hit",
            dir: f.dir > 0 ? "bear" : "bull", // adverse move direction
            i: hit,
            p: level,
            label: "SL",
          });
        }
      }
    }
  }

  // ---- autoOpt info chip ----------------------------------------------------------------
  if (autoOpt && validBar(bars[last])) {
    prims.push({
      kind: "label",
      id: "te-auto",
      z: 5,
      i: last,
      p: bars[last].c,
      text: `AUTO s=${effSens}`,
      place: "above",
      style: "chip",
      color: colors.brand,
      fs: AUTO_FS,
      dxPx: 6,
    } as LabelPrim);
  }

  // chronological, recency-capped event tape (stable sort keeps same-bar emit order)
  events.sort((a, b) => a.i - b.i);
  const tape = events.length > MAX_EVENTS ? events.slice(events.length - MAX_EVENTS) : events;
  return { prims, tooltips, events: tape };
}

// --------------------------------------------------------------------------------- module def

export const TREND_ENGINE_MODULE: SuiteModuleDef = { ...TREND_ENGINE_META, compute };

export default TREND_ENGINE_MODULE;
