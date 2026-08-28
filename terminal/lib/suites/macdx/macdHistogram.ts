// MACD Histogram — MACD-Ultimate pane suite (momentum columns + confirmed flip markers).
//
// Contract: lib/indicator-canvas/types.ts (frozen). Visual spec: docs/
// PREMIUM_INDICATOR_VISUAL_DESIGN_BIBLE_2026-07-28.md §"MACD Histogram — visual spec".
//
//   hist[i] = macd[i] − signal[i]   (both already normalized to ±100 by the engine)
//
// Two encodings, and only two, so the mountain range stays readable at any zoom:
//   • HUE  = sign. Above zero = up, below = down (the locale-aware pair, per the bible's note that
//     the histogram hues equal the candle pair).
//   • ALPHA = momentum. The vendor renders "saturated when strong, lighter tones when weak"; we
//     encode that as an EXPANDING/CONTRACTING tier rather than a magnitude ramp, because the
//     tradeable fact is not how tall the bar is, it is whether the bar is still growing:
//     |hist| growing vs the previous bar → 0.8, shrinking → 0.35. A fading mound is visibly
//     translucent bars before it crosses zero.
//
// The "+" glyph marks a CONFIRMED sign flip: the histogram changes side and the new side survives
// a second bar. Plotted on the flip bar itself, published only once the confirming bar exists —
// a marker therefore appears one bar late but never moves or disappears (non-repaint). Pure and
// deterministic; all values are in the suite's pane y-space.

import type {
  ColumnsPrim,
  LabelPrim,
  ModuleCtx,
  ModuleResult,
  Prim,
  SuiteEvent,
  SuiteField,
  SuiteModuleDef,
  TooltipDef,
} from "@/lib/indicator-canvas/types";
import { MACDX_EXTREME, boolOpt, clamp, paneVal, sharedMacd, tape } from "./macdEngine";
import { MACD_HISTOGRAM_META } from "./macdHistogram.meta";

// ------------------------------------------------------------------------------------ constants

const WIDTH_FRAC = 0.55;
const ALPHA_EXPAND = 0.8;
const ALPHA_SHRINK = 0.35;
const FLIP_FS = 11;
const FLIP_MIN_PX_PER_BAR = 2.5; // "+" glyphs speckle a zoomed-out pane
const MAX_FLIPS = 40; // drawn glyphs; the event tape is uncapped (see tape())
const CONFIRM_BARS = 2; // the flip bar + one more bar on the same side

// ------------------------------------------------------------------------------------- settings


// -------------------------------------------------------------------------------------- compute

interface Flip {
  i: number; // the bar the histogram changed side on
  bull: boolean;
  v: number; // histogram value at the flip bar
  prevRun: number; // bars the previous side lasted
}

function compute(ctx: ModuleCtx): ModuleResult {
  const { bars, colors, lang } = ctx;
  const n = bars?.length ?? 0;
  const empty: ModuleResult = { prims: [], tooltips: [], events: [] };
  if (n < 5) return empty;

  const s = ctx.s || {};
  const wantFlips = boolOpt(s.flips, true);
  const zh = lang === "zh";

  // hist = macd − signal from the ENGINE's live settings (ctx.suite), so the columns always measure
  // the spread of the two lines actually drawn above them.
  const { hist } = sharedMacd(bars, ctx.suite);

  // ---- columns + confirmed-flip scan, one pass -----------------------------------------
  const items: ColumnsPrim["items"] = [];
  const flips: Flip[] = [];

  let prevAbs = NaN;
  let runSign = 0; // sign of the run in progress
  let runLen = 0;
  let prevRunLen = 0;
  let confirmedSign = 0; // last side that actually held CONFIRM_BARS bars
  let pending: Flip | null = null;

  for (let i = 0; i < n; i++) {
    const h = hist[i];
    if (!Number.isFinite(h)) continue;

    const v = paneVal(h, -MACDX_EXTREME, MACDX_EXTREME);
    if (v == null) continue;
    const a = Math.abs(h);
    const expanding = !Number.isFinite(prevAbs) || a >= prevAbs;
    items.push({
      i,
      v,
      color: h > 0 ? colors.up : colors.down,
      alpha: expanding ? ALPHA_EXPAND : ALPHA_SHRINK,
    });
    prevAbs = a;

    const sign = h > 0 ? 1 : h < 0 ? -1 : 0;
    if (sign === 0) continue; // exactly-zero bar: no side, and it cannot start or break a run

    if (sign === runSign) {
      runLen++;
    } else {
      prevRunLen = runLen;
      runSign = sign;
      runLen = 1;
      // A flip is only pending against the last side that ACTUALLY held: a 1-bar blip inside a
      // phase resolves back to the same confirmed side and prints nothing.
      pending =
        confirmedSign !== 0 && sign !== confirmedSign
          ? { i, bull: sign > 0, v, prevRun: prevRunLen }
          : null;
    }
    if (runLen >= CONFIRM_BARS && confirmedSign !== runSign) {
      if (pending) flips.push(pending); // the new side held — publish
      pending = null;
      confirmedSign = runSign; // first confirmed side bootstraps without printing a flip
    }
  }

  if (!items.length) return empty;

  // ---- event tape (independent of the "flips" toggle — the alert bridge reads it) --------
  const events: SuiteEvent[] = flips.map((f) => ({
    type: "macdx_hist_flip",
    dir: f.bull ? "bull" : "bear",
    i: f.i,
    p: f.v,
    strength: Math.round(clamp(Math.abs(f.v), 0, 100)),
    label: zh
      ? `MACD 柱状${f.bull ? "翻多" : "翻空"} · 前段 ${f.prevRun} 根`
      : `Histogram flipped ${f.bull ? "positive" : "negative"} · prior side ${f.prevRun} bars`,
  }));

  // ---- draw ------------------------------------------------------------------------------
  const prims: Prim[] = [
    {
      kind: "columns",
      id: "mx-hist-cols",
      z: 0,
      items,
      base: 0,
      widthFrac: WIDTH_FRAC,
    } as ColumnsPrim,
  ];
  const tooltips: TooltipDef[] = [];

  if (wantFlips && flips.length) {
    const L = {
      title: zh ? "MACD 柱状翻转" : "Histogram flip",
      dir: zh ? "方向" : "Direction",
      bull: zh ? "转多" : "Turned positive",
      bear: zh ? "转空" : "Turned negative",
      val: zh ? "柱值" : "Histogram",
      prev: zh ? "前段长度" : "Prior side",
      bars: zh ? "根" : "bars",
      conf: zh ? "确认" : "Confirmed",
      confV: zh ? "2 根同向" : "2 bars same side",
    };
    for (const f of flips.slice(-MAX_FLIPS)) {
      const color = f.bull ? colors.up : colors.down;
      const tipId = `mx-hist-${f.i}`;
      prims.push({
        kind: "label",
        id: `${tipId}-t`,
        z: 2,
        i: f.i,
        p: f.v,
        text: "+", // language-neutral chart microcopy
        place: f.bull ? "above" : "below",
        style: "bare",
        color,
        fs: FLIP_FS,
        bold: true,
        minPxPerBar: FLIP_MIN_PX_PER_BAR,
        tooltipId: tipId,
      } as LabelPrim);
      tooltips.push({
        id: tipId,
        title: L.title,
        accent: color,
        rows: [
          { k: L.dir, v: f.bull ? L.bull : L.bear, color },
          { k: L.val, v: f.v.toFixed(1) },
          { k: L.prev, v: `${f.prevRun} ${L.bars}` },
          { k: L.conf, v: L.confV },
        ],
      });
    }
  }

  return { prims, tooltips, events: tape(events) };
}

// ----------------------------------------------------------------------------------- module def

export const MACD_HISTOGRAM_MODULE: SuiteModuleDef = { ...MACD_HISTOGRAM_META, compute };

export default MACD_HISTOGRAM_MODULE;
