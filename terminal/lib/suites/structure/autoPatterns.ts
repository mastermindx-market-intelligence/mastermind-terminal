// Auto Patterns — Structure Core module (auto trendlines + parallel channels + measured moves).
//
// Contract: lib/indicator-canvas/types.ts (frozen). Visual spec: docs/
// PREMIUM_INDICATOR_VISUAL_DESIGN_BIBLE_2026-07-28.md §"Chart Patterns — visual spec".
// Algorithm sketch: docs/PREMIUM_INDICATOR_SUITE_MASTERPLAN_2026-07-28.md §8.1 "Auto Patterns".
//
// W4 scope is deliberately bounded to TRENDLINES + CHANNELS + measured-move targets.
// Wedges and Head & Shoulders are NOT in this wave (noted in the builder report).
//
// Geometry: a resistance line is a least-squares fit through 2+ confirmed pivot HIGHS whose
// residuals all stay within 0.4×ATR(14); we start from the most recent qualifying pair and extend
// to earlier pivots while the residual bound holds. Support mirrors on pivot lows. When both lines
// exist and their slopes differ by ≤15% of the steeper slope (and resistance sits above support
// across the span), the pair renders as a parallel CHANNEL with a dashed midline; otherwise only
// the single stronger line (more anchors, then the more recently confirmed) is drawn.
//
// NON-REPAINT: a line only exists once every defining pivot is confirmed (pivot confirmedAt =
// i + wing) — its existence bar E is the confirmedAt of its newest anchor. Break detection walks
// bars from E forward and compares each CLOSE against the line's projected value at that bar, so
// replaying the series bar-by-bar reproduces the same break/target events. The LAST segment of a
// live line grows as new bars arrive — that is extension of already-confirmed geometry along a
// fixed slope, not a restyle of history. One honest caveat, documented on purpose: which pivots
// fall into the 2nd..4th (historical) pattern sets depends on where the newest set's anchors sit,
// so historical CHROME can re-segment as new pivots confirm; each individual line's geometry and
// its events remain functions of bars ≤ their own bars only.
//
// Pure: no DOM, no CSS reads, no wall clock, no randomness, no cross-call mutable state.

import type {
  LabelPrim,
  LinePrim,
  ModuleCtx,
  ModuleResult,
  PolyPrim,
  Prim,
  SuiteBar,
  SuiteEvent,
  SuiteField,
  SuiteModuleDef,
  TooltipDef,
  XRef,
} from "@/lib/indicator-canvas/types";
import { findPivotsHL, type Pivot } from "./pivots";
import { AUTO_PATTERNS_META } from "./autoPatterns.meta";

// ------------------------------------------------------------------------------------ constants

const ATR_LEN = 14;
const SIZE_WING: Record<string, number> = { small: 5, medium: 8, big: 12 };
const RESID_ATR = 0.4;        // anchor residual tolerance = 0.4 × ATR(14) at the newest anchor
const SLOPE_TOL = 0.15;       // channel test: |mR − mS| ≤ 15% of the steeper slope
const MAX_ANCHORS = 6;        // fit extension cap — a trendline through 6 pivots is already rare
const PROJ_BARS = 20;         // dashed projection length past the last bar (live, unbroken lines)
const HIST_EXTEND = 20;       // unbroken historical lines extend this far past their newest anchor
const VOL_WINDOW = 200;       // trailing bars for the break-volume percentile
const VOL_MIN_SAMPLE = 10;    // below this the percentile is meaningless → neutral 0.5
const STRONG_PCT = 0.8;       // volume percentile at/above this prints the "+ Strong" break tier
const MAX_SETS = 4;
const MAX_EVENTS = 40;
const LINE_W = 1.5;
const PILL_FS = 10;
const CHIP_FS = 9;
const CHIP_MIN_PX_PER_BAR = 3;
const BROKEN_ALPHA = 0.4;     // a broken line flips dashed at this alpha
const BROKEN_DASH = "4 3";
const MID_DASH = "4 4";

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

/** Wilder ATR. Warm-up uses the running mean of the true ranges so short series still gate. */
function atrSeries(bars: SuiteBar[], len: number): number[] {
  const n = bars.length;
  const out = new Array<number>(n).fill(0);
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

/** Fraction of the trailing window strictly below bar j's volume, in [0,1]. */
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
  // No usable volume history (indices, thin CN/HK names): neutral rather than zero.
  if (cnt < VOL_MIN_SAMPLE || !(v > 0)) return 0.5;
  return below / cnt;
}

function fmtPrice(p: number): string {
  const a = Math.abs(p);
  const d = a >= 1 ? 2 : a >= 0.01 ? 4 : 6;
  return p.toFixed(d);
}

// ----------------------------------------------------------------------------------- line fitting

interface FitLine {
  kind: "res" | "sup";
  m: number;               // slope (price per bar)
  b: number;               // intercept (price at bar index 0)
  anchors: Pivot[];        // ascending by bar index, ≥2
  i0: number;              // earliest anchor bar
  iN: number;              // newest anchor bar
  exists: number;          // bar at which the line became knowable = newest anchor's confirmedAt
}

function yAt(l: { m: number; b: number }, i: number): number {
  return l.m * i + l.b;
}

/** Least-squares fit through points; returns null on degenerate input. */
function lsq(pts: Pivot[]): { m: number; b: number; maxResid: number } | null {
  const n = pts.length;
  if (n < 2) return null;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const p of pts) {
    sx += p.i;
    sy += p.p;
    sxx += p.i * p.i;
    sxy += p.i * p.p;
  }
  const den = n * sxx - sx * sx;
  if (!(Math.abs(den) > 1e-12)) return null; // duplicate x — cannot happen for distinct pivots
  const m = (n * sxy - sx * sy) / den;
  const b = (sy - m * sx) / n;
  let maxResid = 0;
  for (const p of pts) {
    const r = Math.abs(p.p - (m * p.i + b));
    if (r > maxResid) maxResid = r;
  }
  return { m, b, maxResid };
}

/**
 * Fit a trendline from the tail of `pivots` (ascending, all one kind): start with the most recent
 * pair, then extend to earlier pivots one at a time while every anchor's residual stays within
 * 0.4×ATR at the newest anchor. Stops at the first pivot that breaks the bound.
 */
function buildLine(pivots: Pivot[], kind: "res" | "sup", atr: number[]): FitLine | null {
  const k = pivots.length;
  if (k < 2) return null;
  const newest = pivots[k - 1];
  const a = atr[newest.i];
  if (!(a > 0)) return null;
  const tol = RESID_ATR * a;

  let anchors = [pivots[k - 2], newest];
  let fit = lsq(anchors);
  if (!fit) return null;

  for (let j = k - 3; j >= 0 && anchors.length < MAX_ANCHORS; j--) {
    const trial = [pivots[j], ...anchors];
    const f = lsq(trial);
    if (!f || f.maxResid > tol) break;
    anchors = trial;
    fit = f;
  }
  if (fit.maxResid > tol) return null; // pair always passes (residual 0); guard for completeness

  return {
    kind,
    m: fit.m,
    b: fit.b,
    anchors,
    i0: anchors[0].i,
    iN: anchors[anchors.length - 1].i,
    exists: newest.confirmedAt,
  };
}

// ---------------------------------------------------------------------------------- pattern sets

interface Break {
  i: number;          // break bar (close beyond the projected line value)
  dir: 1 | -1;        // +1 break up (through resistance), −1 break down (through support)
  p: number;          // line value at the break bar
  pct: number;        // volume percentile 0..1
}

interface PatternSet {
  res: FitLine | null;   // drawn lines only (the weaker line of a non-channel pair is dropped)
  sup: FitLine | null;
  isChannel: boolean;
  exists: number;        // pattern existence bar = max over drawn lines
  brk: Break | null;
  target: { p: number; from: number; hitAt: number; height: number } | null; // channels only
}

/** First bar ≥ from where a close crosses beyond the line (resistance up / support down). */
function scanBreak(bars: SuiteBar[], line: FitLine, from: number): { i: number; p: number } | null {
  // A line's authority decays: only a break within HIST_EXTEND bars of its newest anchor counts —
  // an unbounded scan drew stale lines hundreds of bars past their anchors and printed Break pills
  // on pure extrapolation (W4 review).
  const n = Math.min(bars.length, line.iN + HIST_EXTEND + 1);
  for (let i = from; i < n; i++) {
    const c = bars[i].c;
    if (!Number.isFinite(c) || !(c > 0)) continue; // OHLC=0 = missing print, never a break
    const y = yAt(line, i);
    if (line.kind === "res" ? c > y : c < y) return { i, p: y };
  }
  return null;
}

function buildSet(highs: Pivot[], lows: Pivot[], bars: SuiteBar[], atr: number[], targets: boolean): PatternSet | null {
  let res = buildLine(highs, "res", atr);
  let sup = buildLine(lows, "sup", atr);
  if (!res && !sup) return null;

  let isChannel = false;
  if (res && sup) {
    const steeper = Math.max(Math.abs(res.m), Math.abs(sup.m));
    const parallel = Math.abs(res.m - sup.m) <= SLOPE_TOL * steeper;
    if (parallel) {
      // sanity: resistance must sit above support across the joint span
      const s = Math.max(res.i0, sup.i0);
      const e = Math.max(res.iN, sup.iN);
      isChannel = yAt(res, s) > yAt(sup, s) && yAt(res, e) > yAt(sup, e);
    }
    if (!isChannel) {
      // keep the single stronger line: more anchors, then the more recently confirmed
      const keepRes =
        res.anchors.length !== sup.anchors.length
          ? res.anchors.length > sup.anchors.length
          : res.exists >= sup.exists;
      if (keepRes) sup = null;
      else res = null;
    }
  }

  const exists = Math.max(res ? res.exists : 0, sup ? sup.exists : 0);

  // first close beyond either drawn line, from the pattern's existence bar forward
  const bR = res ? scanBreak(bars, res, exists) : null;
  const bS = sup ? scanBreak(bars, sup, exists) : null;
  let brk: Break | null = null;
  const first =
    bR && bS ? (bR.i <= bS.i ? { hit: bR, dir: 1 as const } : { hit: bS, dir: -1 as const })
    : bR ? { hit: bR, dir: 1 as const }
    : bS ? { hit: bS, dir: -1 as const }
    : null;
  if (first) {
    brk = { i: first.hit.i, dir: first.dir, p: first.hit.p, pct: volPercentile(bars, first.hit.i) };
  }

  // measured-move target: channel height projected from the break bar (channels only)
  let target: PatternSet["target"] = null;
  if (targets && isChannel && brk && res && sup) {
    const height = yAt(res, brk.i) - yAt(sup, brk.i);
    if (height > 0) {
      const p = brk.dir > 0 ? brk.p + height : brk.p - height;
      let hitAt = -1;
      for (let i = brk.i + 1; i < bars.length; i++) {
        const b = bars[i];
        if (!Number.isFinite(b.h) || !Number.isFinite(b.l) || !(b.h > 0)) continue;
        if (brk.dir > 0 ? b.h >= p : b.l <= p) { hitAt = i; break; }
      }
      target = { p, from: brk.i, hitAt, height };
    }
  }

  return { res, sup, isChannel, exists, brk, target };
}

// ---------------------------------------------------------------------------------- compute

function compute(ctx: ModuleCtx): ModuleResult {
  const { bars, colors, lang } = ctx;
  const n = bars.length;
  const empty: ModuleResult = { prims: [], tooltips: [], events: [] };

  const s = ctx.s || {};
  const size = selOpt(s.size, "medium" as const, ["small", "medium", "big"] as const);
  const targets = boolOpt(s.targets, true);
  const showLast = Math.round(numOpt(s.showLast, 2, 1, 4));

  const wing = SIZE_WING[size];
  if (n < wing * 2 + 3) return empty;

  const atr = atrSeries(bars, ATR_LEN);
  const pivots = findPivotsHL(bars, wing, wing, "wick");
  let highs = pivots.filter((p) => p.kind === "high");
  let lows = pivots.filter((p) => p.kind === "low");

  // Build up to MAX_SETS pattern sets newest-first; each older set only sees pivots strictly
  // earlier than the previous set's earliest drawn anchor (no overlapping spider-web geometry).
  const sets: PatternSet[] = [];
  for (let si = 0; si < MAX_SETS; si++) {
    const set = buildSet(highs, lows, bars, atr, targets);
    if (!set) break;
    sets.push(set);
    const cut = Math.min(
      set.res ? set.res.i0 : Number.POSITIVE_INFINITY,
      set.sup ? set.sup.i0 : Number.POSITIVE_INFINITY,
    );
    highs = highs.filter((p) => p.i < cut);
    lows = lows.filter((p) => p.i < cut);
  }
  if (!sets.length) return empty;

  const shown = sets.slice(0, showLast);
  const zh = lang === "zh";
  const last = n - 1;
  const prims: Prim[] = [];
  const tooltips: TooltipDef[] = [];
  const events: SuiteEvent[] = [];

  const L = {
    channel: zh ? "通道" : "Channel",
    trendline: zh ? "趋势线" : "Trendline",
    res: zh ? "阻力" : "Resistance",
    sup: zh ? "支撑" : "Support",
    anchors: zh ? "锚点" : "Anchors",
    slope: zh ? "斜率" : "Slope",
    height: zh ? "通道高度" : "Height",
    breakK: zh ? "突破" : "Break",
    volK: zh ? "突破量能" : "Break Vol",
    targetK: zh ? "目标" : "Target",
    hit: zh ? "已达成" : "hit",
    open: zh ? "进行中" : "open",
    bars: zh ? "根K线" : "bars",
    up: zh ? "向上" : "up",
    down: zh ? "向下" : "down",
    none: zh ? "未突破" : "none yet",
  };

  const pillText = (dir: 1 | -1, strong: boolean): string => {
    if (dir > 0) return strong ? (zh ? "▲+ 强势向上突破" : "▲+ Strong Break Up") : (zh ? "▲ 向上突破" : "▲ Break Up");
    return strong ? (zh ? "▼+ 强势向下突破" : "▼+ Strong Break Down") : (zh ? "▼ 向下突破" : "▼ Break Down");
  };

  for (let si = 0; si < shown.length; si++) {
    const set = shown[si];
    const live = si === 0;
    const broken = !!set.brk;
    const tipId = `pat-${si}-${set.exists}`;

    // A broken pattern's lines stop at the break bar; a live unbroken pattern grows to the last
    // bar (+ dashed projection); an unbroken historical pattern keeps a fixed bounded span.
    const endFor = (l: FitLine): number =>
      broken ? set.brk!.i : live ? last : Math.min(last, l.iN + HIST_EXTEND);

    const drawLine = (l: FitLine) => {
      const col = l.kind === "res" ? colors.down : colors.up;
      const e = Math.max(endFor(l), l.iN); // never end before the newest anchor
      const body: PolyPrim = {
        kind: "poly",
        id: `${tipId}-${l.kind}`,
        z: 1,
        pts: [
          { i: l.i0, p: yAt(l, l.i0) },
          { i: e, p: yAt(l, e) },
        ],
        color: col,
        w: LINE_W,
      };
      if (broken) {
        body.dash = BROKEN_DASH; // the line flips dashed once broken
        body.alpha = BROKEN_ALPHA;
      }
      prims.push(body);
      if (live && !broken) {
        // dashed continuation: confirmed slope projected past the last bar (rightward)
        const proj: LinePrim = {
          kind: "line",
          id: `${tipId}-${l.kind}-x`,
          z: 1,
          a: { i: e, p: yAt(l, e) },
          b: { i: e + PROJ_BARS, p: yAt(l, e + PROJ_BARS) },
          color: col,
          w: LINE_W,
          dash: BROKEN_DASH,
          alpha: 0.8,
        };
        prims.push(proj);
      }
    };

    if (set.res) drawLine(set.res);
    if (set.sup) drawLine(set.sup);

    // channel midline (dashed, neutral chrome — never a direction color)
    if (set.isChannel && set.res && set.sup) {
      const ms = Math.max(set.res.i0, set.sup.i0);
      const me = Math.max(Math.min(endFor(set.res), endFor(set.sup)), ms + 1);
      prims.push({
        kind: "line",
        id: `${tipId}-mid`,
        z: 0,
        a: { i: ms, p: (yAt(set.res, ms) + yAt(set.sup, ms)) / 2 },
        b: { i: me, p: (yAt(set.res, me) + yAt(set.sup, me)) / 2 },
        color: colors.neutral,
        w: 1,
        dash: MID_DASH,
        alpha: broken ? BROKEN_ALPHA : 0.7,
      } as LinePrim);
    }

    // break pill — triangle-nearest-price rule: break up prints below the line, pointer up
    if (set.brk) {
      const bk = set.brk;
      const strong = bk.pct >= STRONG_PCT;
      const col = bk.dir > 0 ? colors.up : colors.down;
      prims.push({
        kind: "label",
        id: `${tipId}-bk`,
        z: 3,
        i: bk.i,
        p: bk.p,
        text: pillText(bk.dir, strong),
        place: bk.dir > 0 ? "below" : "above",
        style: "pill",
        color: col,
        fs: PILL_FS,
        bold: strong,
        pointer: true,
        tooltipId: tipId,
      } as LabelPrim);
      events.push({
        type: "pat_break",
        dir: bk.dir > 0 ? "bull" : "bear",
        i: bk.i,
        p: bk.p,
        strength: clamp(Math.round(bk.pct * 100), 0, 100),
        label: zh
          ? `${set.isChannel ? "通道" : "趋势线"}${bk.dir > 0 ? "向上" : "向下"}突破 · 量能 ${Math.round(bk.pct * 100)}%`
          : `${set.isChannel ? "Channel" : "Trendline"} break ${bk.dir > 0 ? "up" : "down"} · vol ${Math.round(bk.pct * 100)}%`,
      });
    }

    // measured-move target (channels only): dashed level from the break bar rightward
    if (set.target && set.brk) {
      const t = set.target;
      const col = set.brk.dir > 0 ? colors.up : colors.down;
      const hit = t.hitAt >= 0;
      const endRef: XRef = hit ? t.hitAt : "right";
      prims.push({
        kind: "line",
        id: `${tipId}-tl`,
        z: 2,
        a: { i: t.from, p: t.p },
        b: { i: endRef, p: t.p },
        color: col,
        w: 1,
        dash: "5 4",
        alpha: 0.9,
      } as LinePrim);
      prims.push({
        kind: "label",
        id: `${tipId}-tc`,
        z: 3,
        i: endRef,
        p: t.p,
        text: `${zh ? "目标" : "Target"} ${fmtPrice(t.p)}${hit ? " ✓" : ""}`,
        place: hit ? "above" : "left",
        style: "chip",
        color: col,
        fs: CHIP_FS,
        minPxPerBar: hit ? CHIP_MIN_PX_PER_BAR : undefined,
        tooltipId: tipId,
      } as LabelPrim);
      if (hit) {
        events.push({
          type: "pat_target_hit",
          dir: set.brk.dir > 0 ? "bull" : "bear",
          i: t.hitAt,
          p: t.p,
          label: zh ? `测量目标达成 · ${fmtPrice(t.p)}` : `Measured move hit · ${fmtPrice(t.p)}`,
        });
      }
    }

    // tooltip (attached to the pill / target chip)
    const main = set.res ?? set.sup!;
    const slopePct = (main.m / Math.max(Math.abs(yAt(main, main.iN)), 1e-9)) * 100;
    const rows: TooltipDef["rows"] = [
      {
        k: L.anchors,
        v: set.isChannel
          ? `${set.res!.anchors.length}H / ${set.sup!.anchors.length}L`
          : `${main.anchors.length} ${main.kind === "res" ? "H" : "L"}`,
      },
      { k: L.slope, v: `${slopePct >= 0 ? "+" : ""}${slopePct.toFixed(3)}%/${zh ? "K线" : "bar"}` },
    ];
    if (set.isChannel && set.res && set.sup) {
      const h0 = yAt(set.res, set.res.iN) - yAt(set.sup, set.res.iN);
      rows.push({ k: L.height, v: fmtPrice(h0) });
    }
    rows.push(
      set.brk
        ? {
            k: L.breakK,
            v: `${set.brk.dir > 0 ? L.up : L.down} · ${fmtPrice(set.brk.p)}`,
            color: set.brk.dir > 0 ? colors.up : colors.down,
          }
        : { k: L.breakK, v: L.none },
    );
    if (set.brk) rows.push({ k: L.volK, v: `${Math.round(set.brk.pct * 100)}%` });
    if (set.target) {
      rows.push({
        k: L.targetK,
        v: `${fmtPrice(set.target.p)} · ${set.target.hitAt >= 0 ? L.hit : L.open}`,
      });
    }
    const title = set.isChannel
      ? L.channel
      : `${L.trendline} · ${main.kind === "res" ? L.res : L.sup}`;
    tooltips.push({
      id: tipId,
      title,
      accent: set.isChannel ? colors.brand : main.kind === "res" ? colors.down : colors.up,
      rows,
    });
  }

  events.sort((a, b) => a.i - b.i);
  const tape = events.length > MAX_EVENTS ? events.slice(events.length - MAX_EVENTS) : events;
  return { prims, tooltips, events: tape };
}

// --------------------------------------------------------------------------------- module def

export const AUTO_PATTERNS_MODULE: SuiteModuleDef = { ...AUTO_PATTERNS_META, compute };

export default AUTO_PATTERNS_MODULE;
