// RSI Channels — a Bollinger / Keltner / Donchian channel computed ON THE RSI SERIES, with margin-
// pinned breakout dots, for the RSI Ultimate pane suite ("rsix").
//
// Contract: lib/indicator-canvas/types.ts (frozen). Visual spec: docs/
// PREMIUM_INDICATOR_VISUAL_DESIGN_BIBLE_2026-07-28.md §"RSI Channel — visual spec".
// Algorithm sketch: docs/PREMIUM_INDICATOR_SUITE_MASTERPLAN_2026-07-28.md §8.4.
//
// All prims are in the suite's pane y-space (0..100). One model is active at a time:
//
//   bollinger  mid = SMA(rsi, len)            half = mult × population stdev(rsi, len)
//   keltner    mid = EMA(rsi, len)            half = mult × Wilder RMA(|Δrsi|, len)
//   donchian   up  = max(rsi, len)  lo = min(rsi, len)   mid = (up + lo) / 2
//
// The point of a channel over RSI rather than over price: 72 is not "overbought" on a tape that has
// been printing 80s for a month, but a break of the RSI's own envelope is a genuine regime event on
// any tape. That is why the channel is drawn in STRUCTURE colors (muted / neutral), never in the
// up/down pair — the channel describes the shape of momentum, not its direction (bible).
//
// Break dots follow the vendor's signature placement: an UP break pins a dot to the BOTTOM margin of
// the pane and a DOWN break to the TOP margin, so a marker can never collide with the wave it
// describes. Donchian steppiness is preserved verbatim — no smoothing — because the staircase IS the
// visual identifier of that model.
//
// Non-repaint: every statistic is a trailing window over bars <= i, and a break is a function of two
// consecutive defined bars. Pure — no wall clock, randomness or module-level state.

import type {
  GradLinePrim,
  MarkerPrim,
  ModuleCtx,
  ModuleResult,
  Prim,
  SuiteEvent,
  SuiteField,
  SuiteModuleDef,
  TooltipDef,
} from "@/lib/indicator-canvas/types";
import { emaArr, wilderRma } from "@/lib/suites/shared/oscUtils";
import {
  MAX_EVENTS,
  PANE_MAX,
  PANE_MIN,
  clampNum,
  finiteIdx,
  intOpt,
  numOpt,
  selOpt,
  sharedRsi,
  smaArr,
} from "./rsiEngine";
import { RSI_CHANNELS_META } from "./rsiChannels.meta";

// ------------------------------------------------------------------------------------ constants

const RAIL_W = 1;
const RAIL_ALPHA = 0.7;
const MID_W = 1;
const MID_ALPHA = 0.6;
const MID_DASH = "2 3";
const MID_MIN_PX_PER_BAR = 1.2;
const DOT_SIZE = 3;
const DOT_ALPHA = 0.9;
const DOT_MARGIN = 4; // RSI points from the pane edge the break dots are pinned at
const MAX_DOTS = 60;
const STRENGTH_PER_RSI = 6; // penetration beyond the rail (RSI points) -> 0..100

type ChannelModel = "bollinger" | "keltner" | "donchian";
const MODELS: readonly ChannelModel[] = ["bollinger", "keltner", "donchian"];

// ------------------------------------------------------------------------------------- settings


// ---------------------------------------------------------------------------------- channel math

interface Channel {
  up: Float64Array;
  mid: Float64Array;
  lo: Float64Array;
}

/** Trailing population stdev of the last `len` DEFINED values (honest NaN warm-up, holes skipped). */
function stdevArr(vals: Float64Array, len: number): Float64Array {
  const n = vals.length;
  const out = new Float64Array(n).fill(NaN);
  const L = Math.max(1, Math.round(len));
  const buf = new Float64Array(L);
  let cnt = 0;
  let head = 0;
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const v = vals[i];
    if (!Number.isFinite(v)) continue;
    if (cnt < L) cnt++;
    else {
      const old = buf[head];
      sum -= old;
      sumSq -= old * old;
    }
    buf[head] = v;
    sum += v;
    sumSq += v * v;
    head = (head + 1) % L;
    if (cnt < L) continue;
    const mean = sum / L;
    const varr = sumSq / L - mean * mean;
    out[i] = varr > 0 ? Math.sqrt(varr) : 0;
  }
  return out;
}

/**
 * Donchian staircase over the `len` DEFINED values that PRECEDE each bar (the current value is
 * deliberately excluded). Including the current bar would make the channel unbreakable — a value can
 * never exceed a maximum it is itself part of — which is why the classic breakout convention offsets
 * the window by one. The window still ends at i-1, so there is no lookahead. Unsmoothed: the
 * staircase is the visual identifier of this model (bible).
 */
function donchianArr(vals: Float64Array, len: number): { hi: Float64Array; lo: Float64Array } {
  const n = vals.length;
  const hi = new Float64Array(n).fill(NaN);
  const lo = new Float64Array(n).fill(NaN);
  const L = Math.max(1, Math.round(len));
  const buf = new Float64Array(L);
  let cnt = 0;
  let head = 0;
  for (let i = 0; i < n; i++) {
    const v = vals[i];
    if (!Number.isFinite(v)) continue;
    if (cnt === L) {
      let mx = -Infinity;
      let mn = Infinity;
      for (let k = 0; k < L; k++) {
        const x = buf[k];
        if (x > mx) mx = x;
        if (x < mn) mn = x;
      }
      hi[i] = mx;
      lo[i] = mn;
    } else cnt++;
    buf[head] = v; // the current value only enters the window for the NEXT bar
    head = (head + 1) % L;
  }
  return { hi, lo };
}

function buildChannel(
  rsi: Float64Array,
  fin: number[],
  model: ChannelModel,
  length: number,
  mult: number,
): Channel {
  const n = rsi.length;
  const up = new Float64Array(n).fill(NaN);
  const mid = new Float64Array(n).fill(NaN);
  const lo = new Float64Array(n).fill(NaN);

  if (model === "donchian") {
    const d = donchianArr(rsi, length);
    for (let i = 0; i < n; i++) {
      if (!Number.isFinite(d.hi[i]) || !Number.isFinite(d.lo[i])) continue;
      up[i] = d.hi[i];
      lo[i] = d.lo[i];
      mid[i] = (d.hi[i] + d.lo[i]) / 2;
    }
    return { up, mid, lo };
  }

  if (model === "keltner") {
    const base = emaArr(rsi, length);
    // Mean absolute change of the RSI itself — the pane's analogue of ATR.
    const absd = new Float64Array(n).fill(NaN);
    let prev = NaN;
    for (const i of fin) {
      const v = rsi[i];
      if (Number.isFinite(prev)) absd[i] = Math.abs(v - prev);
      prev = v;
    }
    const rng = wilderRma(absd, length);
    for (let i = 0; i < n; i++) {
      if (!Number.isFinite(base[i]) || !Number.isFinite(rng[i])) continue;
      const half = mult * rng[i];
      mid[i] = base[i];
      up[i] = base[i] + half;
      lo[i] = base[i] - half;
    }
    return { up, mid, lo };
  }

  const base = smaArr(rsi, length);
  const sd = stdevArr(rsi, length);
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(base[i]) || !Number.isFinite(sd[i])) continue;
    const half = mult * sd[i];
    mid[i] = base[i];
    up[i] = base[i] + half;
    lo[i] = base[i] - half;
  }
  return { up, mid, lo };
}

// ------------------------------------------------------------------------------------- compute

function compute(ctx: ModuleCtx): ModuleResult {
  const { bars, colors, lang } = ctx;
  const n = bars?.length ?? 0;
  const empty: ModuleResult = { prims: [], tooltips: [], events: [] };
  if (n < 4) return empty;

  const s = ctx.s || {};
  const model = selOpt<ChannelModel>(s.model, "bollinger", MODELS);
  const length = intOpt(s.length, 20, 10, 60);
  const mult = numOpt(s.mult, 2, 1, 3);
  const zh = lang === "zh";

  // The channel wraps the Engine's OWN RSI (settings read from ctx.suite) — a channel built around
  // a different length than the drawn wave would rail-break on a curve nobody can see.
  const { rsi } = sharedRsi(ctx);
  const fin = finiteIdx(rsi);
  if (fin.length < length + 2) return empty;

  const ch = buildChannel(rsi, fin, model, length, mult);

  // ---- rails ---------------------------------------------------------------------------
  const upPts: Array<{ i: number; p: number }> = [];
  const loPts: Array<{ i: number; p: number }> = [];
  const midPts: Array<{ i: number; p: number }> = [];
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(ch.up[i]) || !Number.isFinite(ch.lo[i]) || !Number.isFinite(ch.mid[i])) continue;
    upPts.push({ i, p: ch.up[i] });
    loPts.push({ i, p: ch.lo[i] });
    midPts.push({ i, p: ch.mid[i] });
  }
  if (upPts.length < 2) return empty;

  // ---- breaks --------------------------------------------------------------------------
  // A break is a CROSS of the rail, not "outside the rail", plus a per-direction cooldown: a
  // Donchian channel prints a new N-bar extreme every few bars in a trend, and a dot on every one
  // of them is a picket fence, not information (README law 4 — density).
  const cooldown = Math.max(4, Math.round(length / 2));
  const breaks: Array<{ i: number; dir: 1 | -1; rsi: number; rail: number }> = [];
  const lastBreak: Record<string, number> = { up: -Infinity, dn: -Infinity };
  let prevI = -1;
  for (const i of fin) {
    if (prevI >= 0 && Number.isFinite(ch.up[i]) && Number.isFinite(ch.up[prevI])) {
      const v = rsi[i];
      const pv = rsi[prevI];
      if (pv <= ch.up[prevI] && v > ch.up[i]) {
        if (i - lastBreak.up >= cooldown) {
          breaks.push({ i, dir: 1, rsi: v, rail: ch.up[i] });
          lastBreak.up = i;
        }
      } else if (pv >= ch.lo[prevI] && v < ch.lo[i]) {
        if (i - lastBreak.dn >= cooldown) {
          breaks.push({ i, dir: -1, rsi: v, rail: ch.lo[i] });
          lastBreak.dn = i;
        }
      }
    }
    if (Number.isFinite(ch.up[i])) prevI = i;
  }

  // ------------------------------------------------------------------------------ events
  const modelName: Record<ChannelModel, string> = zh
    ? { bollinger: "布林", keltner: "肯特纳", donchian: "唐奇安" }
    : { bollinger: "Bollinger", keltner: "Keltner", donchian: "Donchian" };
  const events: SuiteEvent[] = breaks.map((b) => ({
    type: "rsix_chan_break",
    dir: b.dir > 0 ? ("bull" as const) : ("bear" as const),
    i: b.i,
    p: b.rsi,
    strength: clampNum(Math.round(Math.abs(b.rsi - b.rail) * STRENGTH_PER_RSI), 0, 100),
    label: zh
      ? `RSI ${b.dir > 0 ? "上破" : "下破"}${modelName[model]}通道 · ${b.rsi.toFixed(1)}`
      : `RSI broke ${b.dir > 0 ? "above" : "below"} the ${modelName[model]} channel · ${b.rsi.toFixed(1)}`,
  }));

  // ------------------------------------------------------------------------------ render
  const prims: Prim[] = [];
  const tooltips: TooltipDef[] = [];

  prims.push({
    kind: "gradline",
    id: "rsix-ch-up",
    z: 1,
    pts: upPts,
    colors: new Array(upPts.length).fill(colors.muted),
    w: RAIL_W,
    alpha: RAIL_ALPHA,
  } as GradLinePrim);
  prims.push({
    kind: "gradline",
    id: "rsix-ch-lo",
    z: 1,
    pts: loPts,
    colors: new Array(loPts.length).fill(colors.muted),
    w: RAIL_W,
    alpha: RAIL_ALPHA,
  } as GradLinePrim);
  prims.push({
    kind: "gradline",
    id: "rsix-ch-mid",
    z: 1,
    pts: midPts,
    colors: new Array(midPts.length).fill(colors.neutral),
    w: MID_W,
    dash: MID_DASH,
    alpha: MID_ALPHA,
    minPxPerBar: MID_MIN_PX_PER_BAR,
  } as GradLinePrim);

  const L = {
    title: zh ? "RSI 通道突破" : "RSI channel break",
    model: zh ? "模型" : "Model",
    dir: zh ? "方向" : "Direction",
    up: zh ? "上破" : "Break up",
    dn: zh ? "下破" : "Break down",
    rsi: "RSI",
    rail: zh ? "通道边界" : "Channel rail",
  };
  const dots = breaks.length > MAX_DOTS ? breaks.slice(breaks.length - MAX_DOTS) : breaks;
  for (const b of dots) {
    const tipId = `rsix-chb-${b.i}`;
    prims.push({
      kind: "marker",
      id: `${tipId}-m`,
      z: 3,
      i: b.i,
      p: b.dir > 0 ? PANE_MIN + DOT_MARGIN : PANE_MAX - DOT_MARGIN,
      shape: "circle",
      size: DOT_SIZE,
      fill: b.dir > 0 ? colors.up : colors.down,
      alpha: DOT_ALPHA,
      tooltipId: tipId,
    } as MarkerPrim);
    tooltips.push({
      id: tipId,
      title: L.title,
      accent: b.dir > 0 ? colors.up : colors.down,
      rows: [
        { k: L.model, v: modelName[model] },
        { k: L.dir, v: b.dir > 0 ? L.up : L.dn },
        { k: L.rsi, v: b.rsi.toFixed(1) },
        { k: L.rail, v: b.rail.toFixed(1) },
      ],
    });
  }

  const tape = events.length > MAX_EVENTS ? events.slice(events.length - MAX_EVENTS) : events;
  return { prims, tooltips, events: tape };
}

// ---------------------------------------------------------------------------------- module def

export const RSI_CHANNELS_MODULE: SuiteModuleDef = { ...RSI_CHANNELS_META, compute };

export default RSI_CHANNELS_MODULE;
