// Swing Failure Pattern (SFP) — Structure Core module.
//
// Contract: lib/indicator-canvas/types.ts (frozen). Visual spec: docs/
// PREMIUM_INDICATOR_VISUAL_DESIGN_BIBLE_2026-07-28.md §"Swing Failure Pattern — visual spec".
// Algorithm sketch: docs/PREMIUM_INDICATOR_SUITE_MASTERPLAN_2026-07-28.md §8.1.
//
// A swing failure is a liquidity sweep that fails: price trades THROUGH a prior confirmed swing
// level and closes back on the original side.
//   bullish  low[j] < swingLow.p  and  close[j] > swingLow.p           (same-bar reclaim)
//            ...or close[j] <= swingLow.p and close[j+1] > swingLow.p  (next-bar reclaim)
//   bearish  mirrored on a swing high.
// The sweep is scored 0-100 ("Volume Strength") = 70% volume percentile of the sweep bar against
// its trailing 200 bars + 30% reclaim speed (same bar 100, next bar 60).
//
// Non-repaint: swings come from findPivotsHL and are only usable AFTER their `confirmedAt` bar; a
// pattern is recorded on the bar its reclaim closes, from bars <= that bar only. Later bars can add
// an invalidation (a new, separately-dated state change) but never edit or withdraw an already
// recorded pattern or event. Pure — no wall clock, no randomness, no module-level mutable state.

import type {
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
  ZonePrim,
} from "@/lib/indicator-canvas/types";
import { findPivotsHL, type Pivot } from "./pivots";
import { SFP_META } from "./sfp.meta";

// ------------------------------------------------------------------------------------ constants

const ATR_LEN = 14;
const VOL_WINDOW = 200;       // trailing bars for the sweep-volume percentile
const VOL_MIN_SAMPLE = 10;    // below this the percentile is meaningless -> neutral 0.5
const W_VOL = 0.7;            // Volume Strength blend: percentile weight…
const W_SPEED = 0.3;          // …and reclaim-speed weight
const SPEED_SAME = 100;       // reclaim inside the sweep bar
const SPEED_NEXT = 60;        // reclaim on the following bar
const TIER_MIN = 50;          // Volume Strength that upgrades the mark to the "+SFP" tier
const EMA_FAST = 20;          // internal trend read (deliberately NOT the MS module — see filter())
const EMA_SLOW = 50;
const DEV_EXTEND = 12;        // deviation zone stops 12 bars after the sweep (never "right")
const MAX_WATCHED = 64;       // invalidation watch list (showLast <= 16; older marks stop updating)
const MAX_EVENTS = 80;        // recency cap on the emitted event tape
const ZONE_ALPHA = 0.07;
const MARKER_SIZE = 5;
const MARKER_ALPHA = 0.95;
const INVALID_ALPHA = 0.3;    // faded marker for an invalidated pattern
const LINE_ALPHA = 0.9;
const INVALID_LINE_ALPHA = 0.45;
const BRACKET_FRAC = 0.3;     // origin "L" tick length, in ATR
const MARKER_OFFSET = 0.35;   // marker stand-off from the wick tip, in ATR
const LABEL_DY = 4;           // extra px between the triangle and its label
const LABEL_MIN_PX = 2;       // density gate: text folds away on a zoomed-out chart
const BRACKET_MIN_PX = 3;

const FS_BY_SIZE: Record<string, number> = { small: 8, normal: 10, large: 12 };

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

/** Wilder ATR (marker stand-off only). Warm-up uses the running mean of the true ranges. */
function atrSeries(bars: SuiteBar[], len: number): Float64Array {
  const n = bars.length;
  const out = new Float64Array(n);
  let seedSum = 0;
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const b = bars[i];
    const pc = i > 0 && Number.isFinite(bars[i - 1].c) ? bars[i - 1].c : b.o;
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

/** SMA-seeded EMA; NaN before the seed completes. Prefix-stable (appending bars never edits it). */
function emaSeries(src: Float64Array, len: number): Float64Array {
  const n = src.length;
  const out = new Float64Array(n).fill(NaN);
  if (len < 1 || n < len) return out;
  let sum = 0;
  for (let i = 0; i < len; i++) sum += src[i];
  let e = sum / len;
  out[len - 1] = e;
  const k = 2 / (len + 1);
  for (let i = len; i < n; i++) {
    e = src[i] * k + e * (1 - k);
    out[i] = e;
  }
  return out;
}

/**
 * Internal trend read for the `filter` setting: EMA20 vs EMA50.
 *
 * Deliberately NOT the Market Structure module — a module must stay a pure function of bars +
 * its OWN settings, so it cannot depend on another module's parameters (its swingLen, its filter
 * mode) or on whether the user has it switched on at all.
 */
function trendSeries(bars: SuiteBar[]): Int8Array {
  const n = bars.length;
  const closes = new Float64Array(n);
  let last = NaN;
  for (let i = 0; i < n; i++) {
    const c = bars[i].c;
    if (Number.isFinite(c) && c > 0) last = c;
    closes[i] = Number.isFinite(last) ? last : 0;
  }
  const f = emaSeries(closes, EMA_FAST);
  const s = emaSeries(closes, EMA_SLOW);
  const out = new Int8Array(n);
  for (let i = 0; i < n; i++) {
    const a = f[i];
    const b = s[i];
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    out[i] = a > b ? 1 : a < b ? -1 : 0;
  }
  return out;
}

/** Fraction of the trailing window strictly below the sweep bar's volume, in [0,1]. */
function volPercentile(bars: SuiteBar[], j: number): number {
  const v = Number.isFinite(bars[j].v) ? bars[j].v : 0;
  const lo = Math.max(0, j - VOL_WINDOW);
  let cnt = 0;
  let below = 0;
  for (let k = lo; k < j; k++) {
    const x = bars[k].v;
    if (!Number.isFinite(x) || x <= 0) continue;
    cnt++;
    if (x < v) below++;
  }
  // No usable volume history (indices, thin CN/HK names): score the sweep neutrally rather than
  // punishing it to zero, which a threshold would then silently hide.
  if (cnt < VOL_MIN_SAMPLE || !(v > 0)) return 0.5;
  return below / cnt;
}

function fmtPrice(p: number): string {
  const a = Math.abs(p);
  const d = a >= 1 ? 2 : a >= 0.01 ? 4 : 6;
  return p.toFixed(d);
}

// ---------------------------------------------------------------------------------- pattern state

interface Sfp {
  id: string;
  dir: 1 | -1;     // +1 bullish (swept a swing low), -1 bearish
  origin: number;  // bar of the swept swing
  sweep: number;   // bar that traded through the level
  confirm: number; // bar whose close reclaimed the level (=== sweep when same-bar)
  level: number;   // swept swing price
  ext: number;     // sweep extreme (lowest low / highest high across sweep..confirm)
  strength: number; // Volume Strength 0..100
  same: boolean;   // same-bar reclaim
  invalAt: number; // bar that closed through the sweep extreme, or -1
}

interface Pending {
  lvl: Pivot;
  sweep: number;
  ext: number;
}

// -------------------------------------------------------------------------------------- compute

function compute(ctx: ModuleCtx): ModuleResult {
  const { bars, colors, lang } = ctx;
  const n = bars.length;
  const empty: ModuleResult = { prims: [], tooltips: [], events: [] };
  if (n < 3) return empty;

  const s = ctx.s || {};
  const swingLen = Math.round(numOpt(s.swingLen, 20, 5, 50));
  const threshold = numOpt(s.threshold, 0, 0, 100);
  const filter = selOpt(s.filter, "none" as const, ["none", "withTrend", "counterTrend"] as const);
  const showLast = Math.round(numOpt(s.showLast, 8, 2, 16));
  const deviationZone = boolOpt(s.deviationZone, true);
  const showInvalid = boolOpt(s.showInvalid, false);
  const textSize = selOpt(s.textSize, "normal" as const, ["small", "normal", "large"] as const);
  const fs = FS_BY_SIZE[textSize] ?? 10;
  const zh = lang === "zh";

  const atr = atrSeries(bars, ATR_LEN);
  const trend = filter === "none" ? null : trendSeries(bars);

  // Confirmed swings, indexed by the bar they became knowable on.
  const pivots = findPivotsHL(bars, swingLen, swingLen, "wick");
  const byConfirm = new Map<number, { hi?: Pivot; lo?: Pivot }>();
  for (const pv of pivots) {
    const e = byConfirm.get(pv.confirmedAt) ?? {};
    if (pv.kind === "high") e.hi = pv;
    else e.lo = pv;
    byConfirm.set(pv.confirmedAt, e);
  }

  const found: Sfp[] = [];
  let watch: Sfp[] = [];
  const events: SuiteEvent[] = [];

  let armedLow: Pivot | null = null;
  let armedHigh: Pivot | null = null;
  let pendLow: Pending | null = null;
  let pendHigh: Pending | null = null;

  /**
   * Record a reclaim. The level is spent by the CALLER either way: a sweep that scores below the
   * threshold, or that the trend filter rejects, still happened — it is hidden, not undetected
   * (vendor semantics), so it must not re-fire on the following bar.
   */
  const record = (dir: 1 | -1, lvl: Pivot, sweep: number, confirm: number, ext: number): void => {
    const same = confirm === sweep;
    const pct = volPercentile(bars, sweep) * 100;
    const strength = clamp(W_VOL * pct + W_SPEED * (same ? SPEED_SAME : SPEED_NEXT), 0, 100);
    if (strength < threshold) return;
    if (trend) {
      const t = trend[confirm];
      const want = filter === "withTrend" ? dir : -dir;
      if (t !== want) return;
    }
    const rec: Sfp = {
      id: `${dir > 0 ? "b" : "s"}${sweep}`,
      dir,
      origin: lvl.i,
      sweep,
      confirm,
      level: lvl.p,
      ext,
      strength,
      same,
      invalAt: -1,
    };
    found.push(rec);
    watch.push(rec);
    if (watch.length > MAX_WATCHED) watch = watch.slice(watch.length - MAX_WATCHED);
    events.push({
      type: "sfp",
      dir: dir > 0 ? "bull" : "bear",
      i: confirm,
      p: lvl.p,
      strength: Math.round(strength),
      label: zh
        ? `${dir > 0 ? "看涨" : "看跌"} SFP · 强度 ${Math.round(strength)}%`
        : `${dir > 0 ? "Bullish" : "Bearish"} SFP · ${Math.round(strength)}% strength`,
    });
  };

  for (let j = 0; j < n; j++) {
    // ---- 1) absorb swings that become knowable on this bar --------------------------
    // Usable only from j+1 on (the `j > confirmedAt` guards below): a level must never fire on a
    // bar that was still inside its own confirmation window.
    const e = byConfirm.get(j);
    if (e?.lo) armedLow = e.lo;
    if (e?.hi) armedHigh = e.hi;

    const b = bars[j];
    if (!validBar(b)) continue; // a missing print resolves nothing and sweeps nothing

    // ---- 2) invalidation: a close beyond the sweep extreme kills the setup -----------
    if (watch.length) {
      let dirty = false;
      for (let k = 0; k < watch.length; k++) {
        const w = watch[k];
        if (w.invalAt >= 0 || j <= w.confirm) continue;
        const through = w.dir > 0 ? b.c < w.ext : b.c > w.ext;
        if (!through) continue;
        w.invalAt = j;
        dirty = true;
        events.push({
          // dir = the market implication of the failure (a dead bullish SFP is a bearish tell),
          // matching the fvg module's inversion convention.
          type: "sfp_invalidated",
          dir: w.dir > 0 ? "bear" : "bull",
          i: j,
          p: w.ext,
          strength: Math.round(w.strength),
          label: zh
            ? `${w.dir > 0 ? "看涨" : "看跌"} SFP 失效`
            : `${w.dir > 0 ? "Bullish" : "Bearish"} SFP invalidated`,
        });
      }
      if (dirty) watch = watch.filter((w) => w.invalAt < 0);
    }

    // ---- 3) resolve a sweep left pending by the previous bar -------------------------
    if (pendLow) {
      const ext = Math.min(pendLow.ext, b.l);
      if (b.c > pendLow.lvl.p) record(1, pendLow.lvl, pendLow.sweep, j, ext);
      // Reclaimed or not, the level is finished: it was either used or genuinely broken.
      if (armedLow === pendLow.lvl) armedLow = null;
      pendLow = null;
    }
    if (pendHigh) {
      const ext = Math.max(pendHigh.ext, b.h);
      if (b.c < pendHigh.lvl.p) record(-1, pendHigh.lvl, pendHigh.sweep, j, ext);
      if (armedHigh === pendHigh.lvl) armedHigh = null;
      pendHigh = null;
    }

    // ---- 4) new sweeps on this bar ---------------------------------------------------
    if (armedLow && j > armedLow.confirmedAt && b.l < armedLow.p) {
      if (b.c > armedLow.p) {
        record(1, armedLow, j, j, b.l);
        armedLow = null;
      } else {
        pendLow = { lvl: armedLow, sweep: j, ext: b.l };
      }
    }
    if (armedHigh && j > armedHigh.confirmedAt && b.h > armedHigh.p) {
      if (b.c < armedHigh.p) {
        record(-1, armedHigh, j, j, b.h);
        armedHigh = null;
      } else {
        pendHigh = { lvl: armedHigh, sweep: j, ext: b.h };
      }
    }
  }

  // ----------------------------------------------------------------------------------- render

  const shown = found.filter((f) => showInvalid || f.invalAt < 0).slice(-showLast);
  const prims: Prim[] = [];
  const tooltips: TooltipDef[] = [];
  const last = n - 1;

  const L = {
    title: zh ? "扫单失败 (SFP)" : "Swing Failure Pattern",
    dir: zh ? "方向" : "Direction",
    bull: zh ? "看涨" : "Bullish",
    bear: zh ? "看跌" : "Bearish",
    vol: zh ? "成交量强度" : "Volume Strength",
    level: zh ? "扫单价位" : "Swept level",
    reclaim: zh ? "收复" : "Reclaim",
    same: zh ? "同根K线" : "Same bar",
    next: zh ? "下一根K线" : "Next bar",
    inval: zh ? "已失效" : "Invalidated",
    bars: zh ? "根K线前" : "bars ago",
  };

  for (const f of shown) {
    const invalid = f.invalAt >= 0;
    const tier = f.strength >= TIER_MIN;
    const col = f.dir > 0 ? colors.up : colors.down;
    const lineCol = invalid ? colors.muted : col;
    const tipId = `sfp-${f.id}`;
    const a = atr[f.sweep];
    const scale = a > 0 ? a : Math.max(Math.abs(f.level - f.ext), Math.abs(b0(bars, f.sweep)) * 1e-3);
    const off = scale * MARKER_OFFSET;
    const markP = f.dir > 0 ? f.ext - off : f.ext + off;

    // Swept level: 1px line from the origin swing to the sweep bar (the signature "L" bracket
    // ticks back into the origin candle).
    const line: LinePrim = {
      kind: "line",
      id: `${tipId}-l`,
      z: 0,
      a: { i: f.origin, p: f.level },
      b: { i: f.sweep, p: f.level },
      color: lineCol,
      w: tier && !invalid ? 1.5 : 1,
      alpha: invalid ? INVALID_LINE_ALPHA : LINE_ALPHA,
    };
    if (invalid) line.dash = "4 3";
    prims.push(line);

    const tick = scale * BRACKET_FRAC;
    prims.push({
      kind: "line",
      id: `${tipId}-b`,
      z: 0,
      a: { i: f.origin, p: f.level },
      b: { i: f.origin, p: f.dir > 0 ? f.level + tick : f.level - tick },
      color: lineCol,
      w: 1,
      alpha: invalid ? INVALID_LINE_ALPHA : LINE_ALPHA,
      minPxPerBar: BRACKET_MIN_PX,
    } as LinePrim);

    // Deviation zone: sweep extreme -> swept level, 12 bars wide, dashed hairline border.
    if (deviationZone && !invalid) {
      prims.push({
        kind: "zone",
        id: `${tipId}-z`,
        z: 0,
        i1: f.sweep,
        i2: f.sweep + DEV_EXTEND,
        p1: f.ext,
        p2: f.level,
        fill: col,
        fillAlpha: ZONE_ALPHA,
        stroke: col,
        strokeW: 1,
        dash: "4 3",
        radius: 2,
      } as ZonePrim);
    }

    // Marker: triangle just beyond the wick tip, pointing back at it.
    prims.push({
      kind: "marker",
      id: `${tipId}-m`,
      z: 2,
      i: f.sweep,
      p: markP,
      shape: f.dir > 0 ? "tri-up" : "tri-down",
      size: MARKER_SIZE,
      fill: col,
      alpha: invalid ? INVALID_ALPHA : MARKER_ALPHA,
      tooltipId: tipId,
    } as MarkerPrim);

    // Label sits OUTSIDE the triangle (triangle always between text and price).
    if (tier || invalid) {
      prims.push({
        kind: "label",
        id: `${tipId}-t`,
        z: 3,
        i: f.sweep,
        p: markP,
        text: invalid ? "SFP" : "+SFP",
        place: f.dir > 0 ? "below" : "above",
        style: "bare",
        color: invalid ? colors.muted : colors.warn,
        fs,
        bold: !invalid,
        dyPx: f.dir > 0 ? LABEL_DY : -LABEL_DY,
        minPxPerBar: LABEL_MIN_PX,
        tooltipId: tipId,
      } as LabelPrim);
    }

    const rows: TooltipDef["rows"] = [
      { k: L.dir, v: f.dir > 0 ? L.bull : L.bear, color: col },
      { k: L.vol, v: `${f.strength.toFixed(1)}%`, color: tier && !invalid ? colors.warn : undefined },
      { k: L.level, v: fmtPrice(f.level) },
      { k: L.reclaim, v: f.same ? L.same : L.next },
    ];
    if (invalid) rows.push({ k: L.inval, v: `${last - f.invalAt} ${L.bars}`, color: colors.muted });
    tooltips.push({
      id: tipId,
      title: L.title,
      accent: invalid ? colors.muted : tier ? colors.warn : col,
      rows,
    });
  }

  const tape = events.length > MAX_EVENTS ? events.slice(events.length - MAX_EVENTS) : events;
  return { prims, tooltips, events: tape };
}

/** Close of bar i, used only as a last-resort scale when ATR is degenerate (flat series). */
function b0(bars: SuiteBar[], i: number): number {
  const c = bars[i]?.c;
  return Number.isFinite(c) ? c : 0;
}

// --------------------------------------------------------------------------------- module def

export const SFP_MODULE: SuiteModuleDef = { ...SFP_META, compute };

export default SFP_MODULE;
