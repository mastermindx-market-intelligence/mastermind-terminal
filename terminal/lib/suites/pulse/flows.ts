// Money Flows — Pulse Oscillator module (MFI + CVD flow lines with a divergence overlay).
//
// Contract: lib/indicator-canvas/types.ts (frozen). Visual specs: docs/
// PREMIUM_INDICATOR_VISUAL_DESIGN_BIBLE_2026-07-28.md §"Money Flow — visual spec",
// §"Volume Flow — visual spec" and §"Divergence Detection — visual spec".
// Algorithm sketch: docs/PREMIUM_INDICATOR_SUITE_MASTERPLAN_2026-07-28.md §8.3.
//
// A pane suite: every price value below is a PULSE PANE coordinate (pane range -110..110).
//
//   MFI = classic 14-bar money-flow index over typical price × volume, rescaled 0..100 → ±100
//         (x × 2 − 100), so pane ±40 is exactly the vendor's 70/30 overbought/oversold pair.
//   CVD = cumulative candle-geometry delta ((buyFrac − sellFrac) × volume), de-trended against its
//         own 200-bar mean and scaled by shared `normalizeSigned` over the same window.
//
// Both render as gradlines (per-point state color) rather than the vendor's filled mountains: two
// flow series share one pane here, and two translucent areas would mud each other — the color state
// carries the same information at a fraction of the ink. In "both" mode the CVD line is dashed so
// the pair stays separable at a glance.
//
// Divergences come from the shared 4-class detector run on the ACTIVE line (MFI when both are on)
// and draw as dashed pivot-to-pivot connectors with a bare "D"/"H" class letter at the second
// pivot — regular at full weight, hidden at half alpha (the Bible's "saturation tier = class" rule).
//
// Non-repaint: MFI, the CVD mean and its scale are forward recurrences over bars ≤ i (that is the
// documented normalizeSigned guarantee); every divergence is emitted at its own `confirmedAt`, the
// bar at which it became knowable, and the detector is run WITHOUT a `lookback` so its output is
// prefix-stable rather than a moving window. The event tape is independent of both the
// `divergences` toggle and `showLast` (the alert bridge reads it). Pure — no wall clock, randomness
// or module state.

import type {
  GradLinePrim,
  LabelPrim,
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
import { normalizeSigned } from "@/lib/suites/shared/oscUtils";
import {
  divergenceStrength,
  findDivergences,
  type DivergenceEvent,
} from "@/lib/suites/shared/divergence";
import { FLOWS_META } from "./flows.meta";

// ------------------------------------------------------------------------------------ constants

const MFI_LEN = 14;
const CVD_WIN = 200; // de-trend + normalizeSigned window for the CVD oscillator
const LINE_W = 1.2;
const CVD_ALPHA = 0.8;
const CVD_DASH_BOTH = "4 3"; // only when both lines share the pane
const MFI_HI = 40; // pane units — MFI 70
const MFI_LO = -40; // pane units — MFI 30
const PANE_CAP = 100; // pane is -110..110; a line never touches the rim

const DIV_WING = 5; // oscillator fractal wing (shared detector default, pinned here)
const DIV_MAX_SPAN = 60; // max bars between the two pivots (shared detector default, pinned here)
const DIV_W = 1.2;
const DIV_DASH = "3 3";
const REG_ALPHA = 0.9;
const HID_ALPHA = 0.5;
const DIV_FS = 8;
const DIV_MIN_PX_PER_BAR = 1.5; // the class letter turns to mush below this zoom
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

function selOpt(v: any, d: string, allowed: string[]): string {
  const k = String(v);
  return allowed.includes(k) ? k : d;
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

const isBull = (k: DivergenceEvent["kind"]): boolean => k === "bull" || k === "hiddenBull";
const isHidden = (k: DivergenceEvent["kind"]): boolean => k === "hiddenBull" || k === "hiddenBear";

// -------------------------------------------------------------------------------------- compute

function compute(ctx: ModuleCtx): ModuleResult {
  const { bars, colors, lang } = ctx;
  const n = bars.length;
  const empty: ModuleResult = { prims: [], tooltips: [], events: [] };
  if (n < 3) return empty;

  const s = ctx.s || {};
  const source = selOpt(s.source, "mfi", ["mfi", "cvd", "both"]);
  const wantDivs = boolOpt(s.divergences, true);
  const showLast = Math.round(numOpt(s.showLast, 6, 2, 12));
  const zh = lang === "zh";
  const wantMfi = source === "mfi" || source === "both";
  const wantCvd = source === "cvd" || source === "both";

  // ---- 1) MFI(14) and the cumulative geometry delta ------------------------------------
  const mfiA = new Float64Array(n).fill(NaN);
  const cvdRaw = new Float64Array(n).fill(NaN);
  const posBuf = new Float64Array(MFI_LEN);
  const negBuf = new Float64Array(MFI_LEN);
  let bufN = 0;
  let bufPos = 0;
  let prevTp = NaN;
  let cum = 0;
  let seenValid = false;

  for (let i = 0; i < n; i++) {
    const b = bars[i];
    if (!validBar(b)) {
      if (seenValid) cvdRaw[i] = cum; // hold the running total across a missing bar
      continue;
    }
    const vol = Number.isFinite(b.v) && b.v > 0 ? b.v : 0;
    const buyFrac = b.h > b.l ? clamp((b.c - b.l) / (b.h - b.l), 0, 1) : 0.5;
    cum += (2 * buyFrac - 1) * vol; // (buyFrac − sellFrac) × volume
    cvdRaw[i] = cum;
    seenValid = true;

    const tp = (b.h + b.l + b.c) / 3;
    const flow = tp * vol;
    if (Number.isFinite(prevTp)) {
      posBuf[bufPos] = tp > prevTp ? flow : 0;
      negBuf[bufPos] = tp < prevTp ? flow : 0;
      bufPos = (bufPos + 1) % MFI_LEN;
      if (bufN < MFI_LEN) bufN++;
      if (bufN === MFI_LEN) {
        // re-summed from the ring every bar (14 adds) — exact, never a drifting running total
        let pos = 0;
        let neg = 0;
        for (let k = 0; k < MFI_LEN; k++) {
          pos += posBuf[k];
          neg += negBuf[k];
        }
        const mfi = neg > 0 ? 100 - 100 / (1 + pos / neg) : pos > 0 ? 100 : 50;
        mfiA[i] = clamp(mfi * 2 - 100, -PANE_CAP, PANE_CAP);
      }
    }
    prevTp = tp;
  }

  // ---- 2) CVD → oscillator: de-trend against the trailing mean, then scale --------------
  // normalizeSigned scales by the trailing max |value|, which pins a monotonically rising
  // cumulative series at +100. Subtracting its own trailing mean first is what turns CVD into the
  // "z-normalized around zero" oscillator the masterplan asks for; both legs read bars ≤ i only.
  const cvdA = new Float64Array(n).fill(NaN);
  if (wantCvd && seenValid) {
    const det = new Float64Array(n).fill(NaN);
    const ring = new Float64Array(CVD_WIN);
    let rn = 0;
    let rp = 0;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const x = cvdRaw[i];
      if (!Number.isFinite(x)) continue;
      if (rn === CVD_WIN) sum -= ring[rp];
      else rn++;
      ring[rp] = x;
      sum += x;
      rp = (rp + 1) % CVD_WIN;
      det[i] = x - sum / rn;
    }
    for (let i = 0; i < n; i++) {
      if (!Number.isFinite(det[i])) continue;
      cvdA[i] = clamp(normalizeSigned(det, i, CVD_WIN), -PANE_CAP, PANE_CAP);
    }
  }

  // ---- 3) flow lines --------------------------------------------------------------------
  const prims: Prim[] = [];
  const tooltips: TooltipDef[] = [];

  const pushLine = (
    id: string,
    src: Float64Array,
    colorAt: (v: number) => string,
    alpha?: number,
    dash?: string,
  ): boolean => {
    const pts: Array<{ i: number; p: number }> = [];
    const cols: string[] = [];
    for (let i = 0; i < n; i++) {
      const v = src[i];
      if (!Number.isFinite(v)) continue;
      pts.push({ i, p: v });
      cols.push(colorAt(v));
    }
    if (pts.length < 2) return false;
    prims.push({
      kind: "gradline",
      id,
      z: 1,
      pts,
      colors: cols,
      w: LINE_W,
      ...(alpha === undefined ? {} : { alpha }),
      ...(dash === undefined ? {} : { dash }),
    } as GradLinePrim);
    return true;
  };

  let drewMfi = false;
  let drewCvd = false;
  if (wantMfi) {
    drewMfi = pushLine("flow-mfi", mfiA, (v) =>
      v > MFI_HI ? colors.up : v < MFI_LO ? colors.down : colors.muted,
    );
  }
  if (wantCvd) {
    drewCvd = pushLine(
      "flow-cvd",
      cvdA,
      (v) => (v > 0 ? colors.up : v < 0 ? colors.down : colors.muted),
      CVD_ALPHA,
      source === "both" ? CVD_DASH_BOTH : undefined,
    );
  }
  if (!drewMfi && !drewCvd) return empty;

  // ---- 4) divergences on the active line -------------------------------------------------
  // MFI is the active line whenever it is drawn: in "both" mode running the detector on two series
  // would stack two connector families on the same pivots, and the Bible caps connectors.
  const osc = drewMfi ? mfiA : cvdA;
  const srcTag = drewMfi ? "MFI" : "CVD";
  const divs = findDivergences(bars, osc, { wing: DIV_WING, maxSpan: DIV_MAX_SPAN });

  const L = {
    title: zh ? "资金流背离" : "Money Flows divergence",
    cls: zh ? "类型" : "Class",
    src: zh ? "来源" : "Source",
    strength: zh ? "强度" : "Strength",
    span: zh ? "跨度" : "Span",
    delta: zh ? "指标差" : "Osc Δ",
    price: zh ? "价格变动" : "Price Δ",
    bars: zh ? "根" : "bars",
    bull: zh ? "常规看涨背离" : "Regular bullish divergence",
    bear: zh ? "常规看跌背离" : "Regular bearish divergence",
    hiddenBull: zh ? "隐藏看涨背离" : "Hidden bullish divergence",
    hiddenBear: zh ? "隐藏看跌背离" : "Hidden bearish divergence",
  };

  // The tape is independent of the drawing toggle and of showLast — the alert bridge reads it.
  const events: SuiteEvent[] = [];
  const strengths = new Map<DivergenceEvent, number>();
  for (const d of divs) {
    const st = clamp(Math.round(divergenceStrength(d, bars)), 0, 100);
    strengths.set(d, st);
    events.push({
      type: "flow_div",
      dir: isBull(d.kind) ? "bull" : "bear",
      i: d.confirmedAt, // the bar at which the divergence became knowable
      p: d.oscB,
      strength: st,
      label: `${L[d.kind]} · ${srcTag}`,
    });
  }

  if (wantDivs && divs.length) {
    for (const d of divs.slice(-showLast)) {
      const bull = isBull(d.kind);
      const hidden = isHidden(d.kind);
      const col = bull ? colors.up : colors.down;
      const id = `flow-div-${d.iA}-${d.iB}-${d.kind}`;
      prims.push({
        kind: "poly",
        id,
        z: 2,
        pts: [
          { i: d.iA, p: d.oscA },
          { i: d.iB, p: d.oscB },
        ],
        color: col,
        w: DIV_W,
        dash: DIV_DASH,
        alpha: hidden ? HID_ALPHA : REG_ALPHA,
      } as PolyPrim);
      prims.push({
        kind: "label",
        id: `${id}-l`,
        z: 3,
        i: d.iB,
        p: d.oscB,
        text: hidden ? "H" : "D",
        place: bull ? "below" : "above",
        style: "bare",
        color: col,
        fs: DIV_FS,
        minPxPerBar: DIV_MIN_PX_PER_BAR,
        tooltipId: id,
      } as LabelPrim);

      const pctMove =
        Number.isFinite(d.priceA) && Number.isFinite(d.priceB) && d.priceA > 0
          ? `${(((d.priceB - d.priceA) / d.priceA) * 100).toFixed(2)}%`
          : "—";
      tooltips.push({
        id,
        title: L.title,
        accent: col,
        rows: [
          { k: L.cls, v: L[d.kind], color: col },
          { k: L.src, v: srcTag },
          { k: L.strength, v: `${strengths.get(d) ?? 0}` },
          { k: L.span, v: `${d.iB - d.iA} ${L.bars}` },
          { k: L.delta, v: (d.oscB - d.oscA).toFixed(1) },
          { k: L.price, v: pctMove },
        ],
      });
    }
  }

  const tape = events.length > MAX_EVENTS ? events.slice(events.length - MAX_EVENTS) : events;
  return { prims, tooltips, events: tape };
}

// ---------------------------------------------------------------------------------- module def

export const FLOWS_MODULE: SuiteModuleDef = { ...FLOWS_META, compute };

export default FLOWS_MODULE;
