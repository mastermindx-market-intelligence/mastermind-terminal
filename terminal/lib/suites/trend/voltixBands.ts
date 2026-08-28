// Volt Bands — Trend Waves module (volatility envelope with expansion memory).
//
// Contract: lib/indicator-canvas/types.ts (frozen). Visual spec: docs/
// PREMIUM_INDICATOR_VISUAL_DESIGN_BIBLE_2026-07-28.md §"Voltix Bands — visual spec".
// Algorithm sketch: docs/PREMIUM_INDICATOR_SUITE_MASTERPLAN_2026-07-28.md §8.2 "Volatility Bands".
//
//   mid       = EMA(hl2, length)                       (SMA-seeded, like ta.ema)
//   rawHalf   = mult × RMA(TR, length)                 (Wilder ATR, SMA-seeded)
//   halfWidth = max(rawHalf, prevHalf × 0.97)          (expansion memory: bands inflate instantly
//                                                       on a volatility burst, deflate ~3%/bar)
//   upper/lower = mid ± halfWidth
//
// The envelope is drawn as two slope-colored rails (the midline's regime, not price's, drives the
// color — that is what makes the two rails read as one instrument). While price closes beyond a
// rail, the space between that rail and the price extreme is filled with a low-alpha cloud; the bar
// that re-enters and closes inside prints a reversal triangle pointing back at the mid.
//
// Non-repaint: every series is a forward recurrence over bars ≤ i; a break event carries only the
// penetration known at the break bar, a retest event only the penetration accumulated up to the
// re-entry bar, and a glow cloud is never edited after its run's bars are in (the left taper sits on
// the bar BEFORE the run, never on a future bar). Pure — no wall clock, randomness or module state.

import type {
  CloudPrim,
  GradLinePrim,
  MarkerPrim,
  ModuleCtx,
  ModuleResult,
  PolyPrim,
  Prim,
  SuiteBar,
  SuiteEvent,
  SuiteField,
  SuiteModuleDef,
  TooltipDef,
} from "@/lib/indicator-canvas/types";
import { VOLT_BANDS_META } from "./voltixBands.meta";

// ------------------------------------------------------------------------------------ constants

const DEFLATE = 0.97; // expansion memory: halfWidth may only shrink 3% per bar
const NEUTRAL_SLOPE_ATR = 0.05; // |mid slope| under 5% of ATR ⇒ neutral regime
const BAND_W = 1.5;
const MID_W = 1;
const MID_DASH = "2 3";
const MID_ALPHA = 0.9;
const MID_MIN_PX_PER_BAR = 1.2; // dotted midline turns to mush below this zoom
const GLOW_ALPHA = 0.08;
const MARKER_SIZE = 4;
const MARKER_ALPHA = 0.85;
const MARKER_OFF_ATR = 0.35; // marker stand-off from the bar extreme, in ATR
const STRENGTH_PER_ATR = 25; // excursion (ATR) → 0..100 strength
const MAX_GLOW_CLOUDS = 60;
const MAX_EVENTS = 80;

// ------------------------------------------------------------------------------------- settings


// -------------------------------------------------------------------------------------- helpers

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function numOpt(v: any, d: number, lo: number, hi: number): number {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? clamp(n, lo, hi) : d;
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

// --------------------------------------------------------------------------------- excursion run

interface Run {
  side: 1 | -1; // +1 above the upper band, -1 below the lower band
  start: number;
  end: number; // last bar still outside
  maxPen: number; // deepest penetration beyond the band, in ATR
}

// ------------------------------------------------------------------------------------- compute

function compute(ctx: ModuleCtx): ModuleResult {
  const { bars, colors, lang } = ctx;
  const n = bars.length;
  const empty: ModuleResult = { prims: [], tooltips: [], events: [] };
  if (n < 3) return empty;

  const s = ctx.s || {};
  const length = Math.round(numOpt(s.length, 20, 10, 60));
  const mult = numOpt(s.mult, 2.2, 1, 4);
  const wantMid = boolOpt(s.midline, true);
  const wantGlow = boolOpt(s.glow, true);
  const wantRetest = boolOpt(s.retestSignals, true);
  const showLast = Math.round(numOpt(s.showLast, 10, 2, 20));
  const zh = lang === "zh";
  if (n < length + 2) return empty;

  // ---- 1) series: EMA midline, Wilder ATR, half-width with expansion memory -----------
  const midA = new Float64Array(n).fill(NaN);
  const upA = new Float64Array(n).fill(NaN);
  const loA = new Float64Array(n).fill(NaN);
  const halfA = new Float64Array(n).fill(NaN);
  const atrA = new Float64Array(n).fill(NaN);

  const kE = 2 / (length + 1);
  let vc = 0; // count of VALID bars seen (drives warm-up, so holes never shorten it)
  let emaSum = 0;
  let emaPrev = 0;
  let atrSum = 0;
  let atrPrev = 0;
  let prevClose = NaN;
  let halfPrev = NaN;

  for (let i = 0; i < n; i++) {
    const b = bars[i];
    if (!validBar(b)) continue;
    const src = (b.h + b.l) / 2;
    const pc = Number.isFinite(prevClose) ? prevClose : b.o;
    const rawTr = Math.max(b.h - b.l, Math.abs(b.h - pc), Math.abs(b.l - pc));
    const tr = Number.isFinite(rawTr) && rawTr > 0 ? rawTr : 0;
    vc++;
    if (vc <= length) {
      emaSum += src;
      emaPrev = emaSum / vc;
      atrSum += tr;
      atrPrev = atrSum / vc;
    } else {
      emaPrev = src * kE + emaPrev * (1 - kE);
      atrPrev = (atrPrev * (length - 1) + tr) / length;
    }
    prevClose = b.c;
    atrA[i] = atrPrev;
    if (vc < length) continue; // warm-up: no band yet

    const raw = mult * atrPrev;
    const half = Number.isFinite(halfPrev) ? Math.max(raw, halfPrev * DEFLATE) : raw;
    if (!(half > 0)) continue;
    halfPrev = half;
    halfA[i] = half;
    midA[i] = emaPrev;
    upA[i] = emaPrev + half;
    loA[i] = emaPrev - half;
  }

  // ---- 2) slope regime of the midline (drives every line color) -----------------------
  const reg = new Int8Array(n); // -1 falling, 0 neutral, +1 rising
  let prevMid = NaN;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(midA[i])) continue;
    if (Number.isFinite(prevMid)) {
      const slope = midA[i] - prevMid;
      const a = Number.isFinite(atrA[i]) ? atrA[i] : 0;
      const thr = NEUTRAL_SLOPE_ATR * a;
      reg[i] = slope > thr ? 1 : slope < -thr ? -1 : 0;
    }
    prevMid = midA[i];
  }
  const regColor = (r: number): string => (r > 0 ? colors.up : r < 0 ? colors.down : colors.muted);

  // ---- 3) excursion state machine (breaks, runs, re-entries) --------------------------
  const events: SuiteEvent[] = [];
  const runs: Run[] = [];
  const retests: Array<{ i: number; run: Run }> = [];
  let cur: Run | null = null;

  const breakLabel = (side: 1 | -1, pen: number) =>
    zh
      ? `${side > 0 ? "上轨突破" : "下轨突破"} · ${pen.toFixed(2)}× ATR`
      : `${side > 0 ? "Upper" : "Lower"} band break · ${pen.toFixed(2)}× ATR`;
  const retestLabel = (side: 1 | -1, pen: number) =>
    zh
      ? `${side > 0 ? "上轨回归" : "下轨回归"} · 最深 ${pen.toFixed(2)}× ATR`
      : `Re-entry from ${side > 0 ? "above" : "below"} · ${pen.toFixed(2)}× ATR peak`;

  for (let i = 0; i < n; i++) {
    const b = bars[i];
    if (!validBar(b) || !Number.isFinite(upA[i]) || !Number.isFinite(loA[i])) continue;
    const a = Number.isFinite(atrA[i]) && atrA[i] > 0 ? atrA[i] : halfA[i] / (mult || 1);
    const side: 1 | -1 | 0 = b.c > upA[i] ? 1 : b.c < loA[i] ? -1 : 0;

    if (cur && side !== cur.side) {
      // the run closed on the previous bar; this bar either re-entered or flipped straight over
      runs.push(cur);
      // A straight flip (above → below in one bar) never closed inside: no re-entry signal.
      if (side === 0) {
        retests.push({ i, run: cur });
        // The event tape is independent of the visual toggle (fvg precedent) so the W2 alert
        // bridge keeps firing when a user hides the triangles.
        events.push({
          type: "vb_retest",
          dir: cur.side > 0 ? "bear" : "bull", // re-entry from above is a fade of the up-excursion
          i,
          p: cur.side > 0 ? upA[i] : loA[i],
          strength: clamp(Math.round(cur.maxPen * STRENGTH_PER_ATR), 0, 100),
          label: retestLabel(cur.side, cur.maxPen),
        });
      }
      cur = null;
    }

    if (side === 0) continue;

    if (!cur) {
      const pen: number = a > 0 ? (side > 0 ? b.c - upA[i] : loA[i] - b.c) / a : 0;
      cur = { side, start: i, end: i, maxPen: Math.max(0, pen) };
      events.push({
        type: "vb_break",
        dir: side > 0 ? "bull" : "bear",
        i,
        p: side > 0 ? upA[i] : loA[i],
        strength: clamp(Math.round(cur.maxPen * STRENGTH_PER_ATR), 0, 100),
        label: breakLabel(side, cur.maxPen),
      });
    } else {
      const pen: number = a > 0 ? (side > 0 ? b.c - upA[i] : loA[i] - b.c) / a : 0;
      cur.end = i;
      if (pen > cur.maxPen) cur.maxPen = pen;
    }
  }
  if (cur) runs.push(cur); // still outside on the last bar — glow renders, no retest yet

  // ---------------------------------------------------------------------------- render
  const prims: Prim[] = [];
  const tooltips: TooltipDef[] = [];

  // band rails — one gradline each, per-point colored by the midline regime
  const upPts: Array<{ i: number; p: number }> = [];
  const loPts: Array<{ i: number; p: number }> = [];
  const cols: string[] = [];
  const midPts: Array<{ i: number; p: number }> = [];
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(upA[i]) || !Number.isFinite(loA[i])) continue;
    upPts.push({ i, p: upA[i] });
    loPts.push({ i, p: loA[i] });
    midPts.push({ i, p: midA[i] });
    cols.push(regColor(reg[i]));
  }
  if (upPts.length < 2) return empty;

  prims.push({
    kind: "gradline",
    id: "vb-upper",
    z: 1,
    pts: upPts,
    colors: cols,
    w: BAND_W,
  } as GradLinePrim);
  prims.push({
    kind: "gradline",
    id: "vb-lower",
    z: 1,
    pts: loPts,
    colors: cols.slice(),
    w: BAND_W,
  } as GradLinePrim);

  // dotted midline — ONE gradline covering the full plotted range (dash support added to the
  // contract after review finding W1-3: the old per-run poly emission capped at 200 runs and
  // truncated the line mid-history while the rails ran full length)
  if (wantMid) {
    prims.push({
      kind: "gradline",
      id: "vb-mid",
      z: 2,
      pts: midPts,
      colors: cols,
      w: MID_W,
      dash: MID_DASH,
      alpha: MID_ALPHA,
      minPxPerBar: MID_MIN_PX_PER_BAR,
    } as GradLinePrim);
  }
  // overextension glow — cloud between the breached rail and the price extreme of the run
  if (wantGlow) {
    const glowRuns = runs.length > MAX_GLOW_CLOUDS ? runs.slice(runs.length - MAX_GLOW_CLOUDS) : runs;
    for (const r of glowRuns) {
      const hi: Array<{ i: number; p: number }> = [];
      const lo: Array<{ i: number; p: number }> = [];
      // left taper: the bar BEFORE the run pins the cloud to the rail at zero thickness
      const t = r.start - 1;
      if (t >= 0 && Number.isFinite(upA[t]) && Number.isFinite(loA[t])) {
        const band = r.side > 0 ? upA[t] : loA[t];
        hi.push({ i: t, p: band });
        lo.push({ i: t, p: band });
      }
      for (let i = r.start; i <= r.end; i++) {
        const b = bars[i];
        if (!validBar(b) || !Number.isFinite(upA[i]) || !Number.isFinite(loA[i])) continue;
        if (r.side > 0) {
          hi.push({ i, p: Math.max(b.h, b.c) });
          lo.push({ i, p: upA[i] });
        } else {
          hi.push({ i, p: loA[i] });
          lo.push({ i, p: Math.min(b.l, b.c) });
        }
      }
      if (hi.length < 2) continue;
      const col = r.side > 0 ? colors.up : colors.down;
      prims.push({
        kind: "cloud",
        id: `vb-glow-${r.start}`,
        z: 0,
        upper: hi,
        lower: lo,
        segColors: new Array(hi.length).fill(col),
        fillAlpha: GLOW_ALPHA,
      } as CloudPrim);
    }
  }

  // reversal triangles — one per excursion, on the bar that closed back inside
  if (wantRetest && retests.length) {
    const kept = retests.slice(-showLast);
    const L = {
      title: zh ? "Volt 波段回归" : "Volt Bands reversal",
      side: zh ? "方向" : "Side",
      above: zh ? "上轨之上" : "Above upper",
      below: zh ? "下轨之下" : "Below lower",
      peak: zh ? "最深偏离" : "Peak excursion",
      out: zh ? "在外根数" : "Bars outside",
      width: zh ? "带宽" : "Band width",
      bars: zh ? "根" : "bars",
    };
    for (const rt of kept) {
      const b = bars[rt.i];
      if (!validBar(b)) continue;
      const a = Number.isFinite(atrA[rt.i]) && atrA[rt.i] > 0 ? atrA[rt.i] : halfA[rt.i] / (mult || 1);
      const off = (a > 0 ? a : Math.max(halfA[rt.i], 1e-9)) * MARKER_OFF_ATR;
      const up = rt.run.side < 0; // came back UP from below the lower band
      const tipId = `vb-rt-${rt.i}`;
      prims.push({
        kind: "marker",
        id: `${tipId}-m`,
        z: 3,
        i: rt.i,
        p: up ? b.l - off : b.h + off,
        shape: up ? "tri-up" : "tri-down",
        size: MARKER_SIZE,
        fill: colors.warn,
        alpha: MARKER_ALPHA,
        tooltipId: tipId,
      } as MarkerPrim);

      const mid = midA[rt.i];
      const widthPct =
        Number.isFinite(mid) && mid > 0 && Number.isFinite(halfA[rt.i])
          ? `${((halfA[rt.i] * 2) / mid * 100).toFixed(2)}%`
          : "—";
      tooltips.push({
        id: tipId,
        title: L.title,
        accent: colors.warn,
        rows: [
          { k: L.side, v: rt.run.side > 0 ? L.above : L.below },
          { k: L.peak, v: `${rt.run.maxPen.toFixed(2)}× ATR` },
          { k: L.out, v: `${rt.run.end - rt.run.start + 1} ${L.bars}` },
          { k: L.width, v: widthPct },
        ],
      });
    }
  }

  const tape = events.length > MAX_EVENTS ? events.slice(events.length - MAX_EVENTS) : events;
  return { prims, tooltips, events: tape };
}

// --------------------------------------------------------------------------------- module def

export const VOLT_BANDS_MODULE: SuiteModuleDef = { ...VOLT_BANDS_META, compute };

export default VOLT_BANDS_MODULE;
