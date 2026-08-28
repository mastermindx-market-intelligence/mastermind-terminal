// Flow Band — Trend Waves module (HMA midline + ATR envelope + quality-scored retests).
//
// Contract: lib/indicator-canvas/types.ts (frozen). Visual spec: docs/
// PREMIUM_INDICATOR_VISUAL_DESIGN_BIBLE_2026-07-28.md §"Flow Trend — visual spec".
// Algorithm sketch: docs/PREMIUM_INDICATOR_SUITE_MASTERPLAN_2026-07-28.md §8.2 "Flow Band".
//
// Shape:
//   midline  = HMA(close, length)                       — Hull: WMA(2·WMA(n/2) − WMA(n), √n)
//   envelope = midline ± atrMult · RMA(TrueRange, 14)
//   trend    = sign of the midline slope with hysteresis: the state flips only when the slope
//              crosses ±10% of ATR, so a flat midline cannot chatter the direction.
//   cloud    = the envelope band, filled per-segment in the direction color
//   edge     = the bright polyline on the FAR side of price (lower in an uptrend, upper in a
//              downtrend) — the bible's signature. It jumps sides at a flip, which draws the
//              vertical "cliff" the reference shows.
//   turns    = triangle + bare price label at each direction flip
//   retests  = price dips into the envelope against the trend and closes back with it, scored 0-100
//
// HTF (2x/4x): bars are grouped into fixed blocks anchored at index 0 (group g covers source bars
// [g·f, g·f+f−1]) and the whole computation runs on those aggregate bars. Values are mapped back
// STEPWISE — a group's value applies only from its LAST source bar forward, and an incomplete
// trailing group applies to nothing. That is an honest approximation, not a smoothing: the HTF band
// repeats across a group (visible stair-steps, exactly as the reference renders it) and is stale by
// up to f−1 bars, but it never peeks inside a group it has not finished.
//
// Non-repaint: every series (HMA, ATR, RSI, volume percentile) is causal, the trend state machine is
// a forward pass, and the fixed HTF grouping means appending bars can never move an earlier group's
// boundary or value. Retests are capped FORWARD (the first N of a segment print) so a confirmed
// marker is never pruned by a later one. Pure — no wall clock, no randomness, no module state.

import type {
  CloudPrim,
  GradLinePrim,
  LabelPrim,
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
import { FLOW_BAND_META } from "./flowBand.meta";

// ------------------------------------------------------------------------------------ constants

const ATR_LEN = 14;
const RSI_LEN = 14;
const VOL_WIN = 50; // trailing window for the retest volume percentile
const HYST_FRAC = 0.1; // trend flips only when |slope| > 10% of ATR
const TURN_FULL_SLOPE = 0.4; // |slope| at which a turn scores strength 100 (in ATR units)
const RETEST_COOLDOWN = 3; // bars between two retests of the same segment
const MAX_RETESTS_PER_SEG = 6; // forward cap — the FIRST 6 retests of a segment print
const MAX_PLOT_BARS = 20000; // perf guard on the plotted point arrays
const MAX_EVENTS = 200; // recency cap on the emitted event tape

const CLOUD_ALPHA = 0.09;
const EDGE_W = 2;
const MID_W = 1;
const TURN_SIZE = 5;
const TURN_OFFSET_ATR = 0.4; // triangle stand-off from the band edge
const RETEST_SIZE = 4;
const TURN_FS = 9;
const CHIP_FS = 8;
const CHIP_MIN_PX_PER_BAR = 3;
const RETEST_MIN_PX_PER_BAR = 2;

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

/** Thousands-grouped price, decimals by magnitude. Locale-independent (no toLocaleString). */
function fmtPrice(p: number): string {
  const a = Math.abs(p);
  const d = a >= 1 ? 2 : a >= 0.01 ? 4 : 6;
  const s = a.toFixed(d);
  const dot = s.indexOf(".");
  const ip = dot < 0 ? s : s.slice(0, dot);
  const fp = dot < 0 ? "" : s.slice(dot);
  let grouped = "";
  for (let i = 0; i < ip.length; i++) {
    if (i > 0 && (ip.length - i) % 3 === 0) grouped += ",";
    grouped += ip[i];
  }
  return (p < 0 ? "-" : "") + grouped + fp;
}

/**
 * Rolling weighted moving average (newest bar carries weight `len`).
 * Values before the first full window stay NaN — a partial Hull window is not an HMA, and emitting
 * one would repaint as the window fills.
 */
function wma(src: Float64Array, len: number): Float64Array {
  const n = src.length;
  const out = new Float64Array(n).fill(NaN);
  const L = Math.max(1, Math.floor(len));
  if (n < L) return out;
  const denom = (L * (L + 1)) / 2;
  let sum = 0;
  let wsum = 0;
  for (let k = 0; k < L; k++) {
    sum += src[k];
    wsum += src[k] * (k + 1);
  }
  out[L - 1] = wsum / denom;
  for (let i = L; i < n; i++) {
    wsum = wsum + L * src[i] - sum;
    sum = sum + src[i] - src[i - L];
    out[i] = wsum / denom;
  }
  return out;
}

/** Hull MA: WMA(2·WMA(src, len/2) − WMA(src, len), round(√len)). NaN until fully warmed up. */
function hma(src: Float64Array, len: number): Float64Array {
  const n = src.length;
  const out = new Float64Array(n).fill(NaN);
  const L = Math.max(2, Math.floor(len));
  const half = Math.max(1, Math.round(L / 2));
  const sq = Math.max(1, Math.round(Math.sqrt(L)));
  if (n < L + sq - 1) return out;
  const w1 = wma(src, half);
  const w2 = wma(src, L);
  const start = L - 1;
  const raw = new Float64Array(n - start);
  for (let i = start; i < n; i++) raw[i - start] = 2 * w1[i] - w2[i];
  const w3 = wma(raw, sq);
  for (let i = start; i < n; i++) {
    const v = w3[i - start];
    if (Number.isFinite(v)) out[i] = v;
  }
  return out;
}

/** Wilder ATR. Warm-up uses the running mean of the true ranges so short series still gate. */
function atrSeries(bars: SuiteBar[], len: number): Float64Array {
  const n = bars.length;
  const out = new Float64Array(n);
  let seedSum = 0;
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const b = bars[i];
    const pc = i > 0 ? bars[i - 1].c : b.o;
    const tr = Math.max(b.h - b.l, Math.abs(b.h - pc), Math.abs(b.l - pc));
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

/** Wilder RSI on the sanitized closes; warm-up uses the running mean of gains/losses. */
function rsiSeries(close: Float64Array, len: number): Float64Array {
  const n = close.length;
  const out = new Float64Array(n).fill(50);
  let ag = 0;
  let al = 0;
  for (let i = 1; i < n; i++) {
    const d = close[i] - close[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    if (i <= len) {
      ag = (ag * (i - 1) + g) / i;
      al = (al * (i - 1) + l) / i;
    } else {
      ag = (ag * (len - 1) + g) / len;
      al = (al * (len - 1) + l) / len;
    }
    out[i] = al <= 0 ? (ag > 0 ? 100 : 50) : 100 - 100 / (1 + ag / al);
  }
  return out;
}

/** Causal percentile of v[i] inside the trailing VOL_WIN window (0..1). */
function volPercentile(vol: Float64Array, i: number): number {
  const from = Math.max(0, i - VOL_WIN + 1);
  const span = i - from;
  if (span < 1) return 0.5;
  let below = 0;
  for (let k = from; k < i; k++) if (vol[k] < vol[i]) below++;
  return below / span;
}

/** Fixed-block resample anchored at index 0. Only COMPLETE groups are produced. */
function resample(bars: SuiteBar[], f: number): SuiteBar[] {
  if (f <= 1) return bars;
  const g = Math.floor(bars.length / f);
  const out: SuiteBar[] = new Array(g);
  for (let k = 0; k < g; k++) {
    const a = k * f;
    const first = bars[a];
    let h = first.h;
    let l = first.l;
    let c = first.c;
    let v = 0;
    for (let j = 0; j < f; j++) {
      const b = bars[a + j];
      if (b.h > h) h = b.h;
      if (b.l < l) l = b.l;
      c = b.c;
      v += Number.isFinite(b.v) ? b.v : 0;
    }
    out[k] = { t: first.t, o: first.o, h, l, c, v };
  }
  return out;
}

// ----------------------------------------------------------------------------------- state types

interface Segment {
  start: number; // source bar where this direction took over
  dir: 1 | -1;
  turnAt: number; // flip bar, or -1 for the very first (established, not flipped) segment
  slope: number; // midline slope at the flip, in price units
  retests: number; // how many retests have already printed in this segment
  lastRetest: number;
}

interface Retest {
  i: number;
  dir: 1 | -1;
  p: number; // the band edge that was tagged
  score: number;
  depth: number;
  volPct: number;
  rsi: number;
  closePos: number;
}

// -------------------------------------------------------------------------------------- compute

function compute(ctx: ModuleCtx): ModuleResult {
  const { bars, colors, lang } = ctx;
  const n = bars.length;
  const empty: ModuleResult = { prims: [], tooltips: [], events: [] };
  if (n < 8) return empty;

  const s = ctx.s || {};
  const length = Math.round(numOpt(s.length, 50, 20, 100));
  const atrMult = numOpt(s.atrMult, 1.8, 1, 4);
  const htf = selOpt(s.htf, "chart" as const, ["chart", "2x", "4x"] as const);
  const cloud = boolOpt(s.cloud, true);
  const turnSignals = boolOpt(s.turnSignals, true);
  const retestSignals = boolOpt(s.retestSignals, true);
  const qualityChips = boolOpt(s.qualityChips, true);
  const showLast = Math.round(numOpt(s.showLast, 8, 2, 16));
  const f = htf === "4x" ? 4 : htf === "2x" ? 2 : 1;
  const zh = lang === "zh";

  // ---- 1) sanitize: a missing bar carries the previous close forward (flat, zero volume) -------
  let seed = NaN;
  for (let i = 0; i < n; i++) {
    if (validBar(bars[i])) {
      seed = bars[i].c;
      break;
    }
  }
  if (!Number.isFinite(seed)) return empty;

  const sane: SuiteBar[] = new Array(n);
  const closeS = new Float64Array(n);
  const volS = new Float64Array(n);
  let carry = seed;
  for (let i = 0; i < n; i++) {
    const b = bars[i];
    const bt = b ? b.t : 0; // read before the type-predicate narrows the else branch to `never`
    if (validBar(b)) {
      carry = b.c;
      sane[i] = b;
      volS[i] = Number.isFinite(b.v) && b.v > 0 ? b.v : 0;
    } else {
      sane[i] = { t: bt, o: carry, h: carry, l: carry, c: carry, v: 0 };
      volS[i] = 0;
    }
    closeS[i] = carry;
  }

  // ---- 2) compute series (chart bars, or complete HTF groups) ---------------------------------
  const cbars = resample(sane, f);
  const m = cbars.length;
  if (m < length + 2) return empty;

  const cclose = new Float64Array(m);
  for (let k = 0; k < m; k++) cclose[k] = cbars[k].c;
  const midC = hma(cclose, length);
  const atrC = atrSeries(cbars, ATR_LEN);

  // ---- 3) trend state machine with slope hysteresis (forward pass, compute resolution) --------
  const trendC = new Int8Array(m);
  const slopeC = new Float64Array(m);
  let st: 0 | 1 | -1 = 0;
  for (let k = 0; k < m; k++) {
    if (k > 0 && Number.isFinite(midC[k]) && Number.isFinite(midC[k - 1])) {
      const slope = midC[k] - midC[k - 1];
      slopeC[k] = slope;
      const thr = atrC[k] > 0 ? HYST_FRAC * atrC[k] : 0;
      if (slope > thr) st = 1;
      else if (slope < -thr) st = -1;
    }
    trendC[k] = st;
  }

  // ---- 4) map back stepwise: group g applies only from its LAST source bar forward ------------
  const mid = new Float64Array(n);
  const upper = new Float64Array(n);
  const lower = new Float64Array(n);
  const atrB = new Float64Array(n);
  const trend = new Int8Array(n);
  const slopeAt = new Float64Array(n);
  const okBand = new Array<boolean>(n).fill(false);
  for (let i = 0; i < n; i++) {
    const ci = Math.floor((i + 1) / f) - 1;
    if (ci < 0 || ci >= m) continue;
    const mv = midC[ci];
    if (!Number.isFinite(mv)) continue;
    const a = atrC[ci] > 0 ? atrC[ci] : 0;
    const half = atrMult * a;
    if (!(half > 0)) continue;
    mid[i] = mv;
    upper[i] = mv + half;
    lower[i] = mv - half;
    atrB[i] = a;
    trend[i] = trendC[ci];
    slopeAt[i] = slopeC[ci];
    okBand[i] = true;
  }

  // ---- 5) segments + turn events --------------------------------------------------------------
  const segs: Segment[] = [];
  const events: SuiteEvent[] = [];
  let prevTrend: 0 | 1 | -1 = 0;
  for (let i = 0; i < n; i++) {
    if (!okBand[i]) continue;
    const t = trend[i] as 0 | 1 | -1;
    if (t === 0) continue;
    if (prevTrend === 0) {
      // first established direction — not a flip, so it carries no turn signal
      segs.push({ start: i, dir: t, turnAt: -1, slope: slopeAt[i], retests: 0, lastRetest: -RETEST_COOLDOWN * 4 });
    } else if (t !== prevTrend) {
      segs.push({ start: i, dir: t, turnAt: i, slope: slopeAt[i], retests: 0, lastRetest: -RETEST_COOLDOWN * 4 });
      const px = validBar(bars[i]) ? bars[i].c : mid[i];
      const strength = atrB[i] > 0
        ? clamp(Math.round((Math.abs(slopeAt[i]) / (TURN_FULL_SLOPE * atrB[i])) * 100), 0, 100)
        : 0;
      events.push({
        type: "fb_turn",
        dir: t > 0 ? "bull" : "bear",
        i,
        p: px,
        strength,
        label: zh
          ? `流向带转向 ${t > 0 ? "▲" : "▼"} · ${fmtPrice(px)}`
          : `Flow Band turn ${t > 0 ? "▲" : "▼"} · ${fmtPrice(px)}`,
      });
    }
    prevTrend = t;
  }
  if (!segs.length) return empty;

  const plotStart = segs[0].start;
  const last = n - 1;

  // ---- 6) retests: a pullback tags the band against the trend and closes back with it ---------
  const rsi = rsiSeries(closeS, RSI_LEN);
  const retests: Retest[] = [];
  if (segs.length) {
    let sIdx = 0;
    for (let i = plotStart; i <= last; i++) {
      while (sIdx + 1 < segs.length && i >= segs[sIdx + 1].start) sIdx++;
      const seg = segs[sIdx];
      if (i <= seg.start) continue; // a retest needs an established leg, never the flip bar itself
      if (!okBand[i]) continue;
      if (seg.retests >= MAX_RETESTS_PER_SEG) continue;
      if (i - seg.lastRetest < RETEST_COOLDOWN) continue;
      const b = bars[i];
      if (!validBar(b)) continue;

      const dir = seg.dir;
      const edge = dir > 0 ? upper[i] : lower[i];
      const halfW = dir > 0 ? upper[i] - mid[i] : mid[i] - lower[i];
      if (!(halfW > 0)) continue;
      const tagged = dir > 0 ? b.l <= edge : b.h >= edge;
      const reclaimed = dir > 0 ? b.c > edge : b.c < edge;
      if (!tagged || !reclaimed) continue;

      const depth = clamp((dir > 0 ? edge - b.l : b.h - edge) / halfW, 0, 1);
      const vp = volPercentile(volS, i);
      const rv = rsi[i];
      const aligned = dir > 0 ? rv > 50 : rv < 50;
      const range = b.h - b.l;
      const closePos = range > 0 ? clamp(dir > 0 ? (b.c - b.l) / range : (b.h - b.c) / range, 0, 1) : 0.5;
      const score = clamp(Math.round(depth * 50 + vp * 25 + (aligned ? 15 : 0) + closePos * 10), 0, 100);

      seg.retests++;
      seg.lastRetest = i;
      retests.push({ i, dir, p: edge, score, depth, volPct: vp, rsi: rv, closePos });
      events.push({
        type: "fb_retest",
        dir: dir > 0 ? "bull" : "bear",
        i,
        p: edge,
        strength: score,
        label: zh ? `流向带回测 · 质量 ${score}` : `Flow Band retest · quality ${score}`,
      });
    }
  }

  // ---- 7) prims -------------------------------------------------------------------------------
  const prims: Prim[] = [];
  const tooltips: TooltipDef[] = [];

  const from = Math.max(plotStart, last - MAX_PLOT_BARS + 1);
  const pts = last - from + 1;
  if (pts >= 2) {
    const upPts: Array<{ i: number; p: number }> = new Array(pts);
    const loPts: Array<{ i: number; p: number }> = new Array(pts);
    const midPts: Array<{ i: number; p: number }> = new Array(pts);
    const edgePts: Array<{ i: number; p: number }> = new Array(pts);
    const cols: string[] = new Array(pts);
    for (let k = 0; k < pts; k++) {
      const i = from + k;
      const dirUp = trend[i] > 0;
      upPts[k] = { i, p: upper[i] };
      loPts[k] = { i, p: lower[i] };
      midPts[k] = { i, p: mid[i] };
      edgePts[k] = { i, p: dirUp ? lower[i] : upper[i] };
      cols[k] = dirUp ? colors.up : colors.down;
    }

    if (cloud) {
      const cl: CloudPrim = {
        kind: "cloud",
        id: "fb:cloud",
        z: 0,
        upper: upPts,
        lower: loPts,
        segColors: cols.slice(0, pts - 1),
        fillAlpha: CLOUD_ALPHA,
      };
      prims.push(cl);
    }

    const midLine: GradLinePrim = {
      kind: "gradline",
      id: "fb:mid",
      z: 1,
      pts: midPts,
      colors: cols,
      w: MID_W,
    };
    prims.push(midLine);

    // The far-side edge: bright, and it jumps sides at a flip — that vertical join IS the cliff.
    const edgeLine: GradLinePrim = {
      kind: "gradline",
      id: "fb:edge",
      z: 2,
      pts: edgePts,
      colors: cols,
      w: EDGE_W,
    };
    prims.push(edgeLine);
  }

  const shownFrom = segs.length > showLast ? segs[segs.length - showLast].start : segs[0].start;

  const L = {
    up: zh ? "流向带 · 上升" : "Flow Band · Uptrend",
    down: zh ? "流向带 · 下降" : "Flow Band · Downtrend",
    retest: zh ? "流向带回测" : "Flow Band retest",
    price: zh ? "价格" : "Price",
    midline: zh ? "中轨" : "Midline",
    band: zh ? "带宽" : "Band",
    held: zh ? "持续" : "Held",
    bars: zh ? "根K线" : "bars",
    quality: zh ? "质量" : "Quality",
    depth: zh ? "回撤深度" : "Depth",
    volume: zh ? "成交量分位" : "Volume pct",
    close: zh ? "收盘位置" : "Close in range",
    src: zh ? "计算周期" : "Source",
    chart: zh ? "图表" : "Chart",
  };
  const srcLabel = f === 1 ? L.chart : `${f}×`;

  if (turnSignals) {
    for (let k = 0; k < segs.length; k++) {
      const seg = segs[k];
      if (seg.turnAt < 0 || seg.turnAt < shownFrom) continue;
      const i = seg.turnAt;
      const off = (atrB[i] > 0 ? atrB[i] : Math.max(upper[i] - mid[i], 1e-9)) * TURN_OFFSET_ATR;
      const bull = seg.dir > 0;
      const col = bull ? colors.up : colors.down;
      const p = bull ? lower[i] - off : upper[i] + off;
      const tipId = `fb-t${i}`;
      const held = (k + 1 < segs.length ? segs[k + 1].start - 1 : last) - i;

      prims.push({
        kind: "marker",
        id: `fb:t${i}`,
        z: 3,
        i,
        p,
        shape: bull ? "tri-up" : "tri-down",
        size: TURN_SIZE,
        fill: col,
        tooltipId: tipId,
      } as MarkerPrim);

      const px = validBar(bars[i]) ? bars[i].c : mid[i];
      prims.push({
        kind: "label",
        id: `fb:t${i}:p`,
        z: 4,
        i,
        p,
        text: fmtPrice(px),
        place: bull ? "below" : "above",
        style: "bare",
        color: colors.muted,
        fs: TURN_FS,
        tooltipId: tipId,
      } as LabelPrim);

      tooltips.push({
        id: tipId,
        title: bull ? L.up : L.down,
        accent: col,
        rows: [
          { k: L.price, v: fmtPrice(px), color: col },
          { k: L.midline, v: fmtPrice(mid[i]) },
          { k: L.band, v: `±${atrMult.toFixed(1)}× ATR · ${fmtPrice(upper[i] - mid[i])}` },
          { k: L.held, v: `${held} ${L.bars}` },
          { k: L.src, v: srcLabel },
        ],
      });
    }
  }

  if (retestSignals) {
    for (const r of retests) {
      if (r.i < shownFrom) continue;
      const bull = r.dir > 0;
      const col = bull ? colors.up : colors.down;
      const tipId = `fb-r${r.i}`;

      prims.push({
        kind: "marker",
        id: `fb:r${r.i}`,
        z: 3,
        i: r.i,
        p: r.p,
        shape: "circle",
        size: RETEST_SIZE,
        fill: col,
        minPxPerBar: RETEST_MIN_PX_PER_BAR,
        tooltipId: tipId,
      } as MarkerPrim);

      if (qualityChips) {
        prims.push({
          kind: "label",
          id: `fb:r${r.i}:q`,
          z: 4,
          i: r.i,
          p: r.p,
          text: String(r.score),
          place: bull ? "below" : "above",
          style: "chip",
          color: colors.brand,
          fs: CHIP_FS,
          dyPx: bull ? 4 : -4,
          minPxPerBar: CHIP_MIN_PX_PER_BAR,
          tooltipId: tipId,
        } as LabelPrim);
      }

      tooltips.push({
        id: tipId,
        title: L.retest,
        accent: col,
        rows: [
          { k: L.quality, v: `${r.score} / 100`, color: col },
          { k: L.depth, v: `${Math.round(r.depth * 100)}%` },
          { k: L.volume, v: `${Math.round(r.volPct * 100)}%` },
          { k: "RSI", v: r.rsi.toFixed(1) },
          { k: L.close, v: `${Math.round(r.closePos * 100)}%` },
        ],
      });
    }
  }

  const tape = events.length > MAX_EVENTS ? events.slice(events.length - MAX_EVENTS) : events;
  return { prims, tooltips, events: tape };
}

// --------------------------------------------------------------------------------- module def

export const FLOW_BAND_MODULE: SuiteModuleDef = { ...FLOW_BAND_META, compute };

export default FLOW_BAND_MODULE;
