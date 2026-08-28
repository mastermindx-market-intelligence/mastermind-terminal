// RSI Signals — in-zone reversal triangles, Deviation +1/+2 follow-through levels and neutral-gated
// crossover dots for the RSI Ultimate pane suite ("rsix").
//
// Contract: lib/indicator-canvas/types.ts (frozen). Visual spec: docs/
// PREMIUM_INDICATOR_VISUAL_DESIGN_BIBLE_2026-07-28.md §"RSI Signals — visual spec".
// Algorithm sketch: docs/PREMIUM_INDICATOR_SUITE_MASTERPLAN_2026-07-28.md §8.4.
//
// All prims are in the suite's pane y-space (0..100) — see rsiEngine.ts for the RSI math this module
// shares with the rest of the folder.
//
// Three layers, each answering a different question:
//
//  1. REVERSAL (▲/▼) — "the extreme is in". A trough at or below 35 that the next bar turns up from
//     prints a bull triangle under the wave; mirrored at 65. ONE signal per excursion: the zone must
//     be left and re-entered before the module will fire again, which is what keeps a 40-bar grind
//     along the 35 line from printing a picket fence of triangles.
//  2. DEVIATION +1/+2 — "did it follow through?". From the signal's RSI reading the module projects
//     two levels 12 and 24 RSI points in the signal's direction and holds them for 12 bars. Solid =
//     pending, dashed at half alpha = the wave has traded through it. That solid→dashed flip is the
//     only consumed state in the module and it is what traders actually read (bible).
//  3. CROSSOVER DOTS — "momentum handed over". RSI × smoothing-MA crosses, plotted ONLY outside the
//     45..55 neutral band: a cross at 50 is noise, a cross at 72 or 28 is a handover.
//
// Non-repaint: a reversal is emitted only on the bar AFTER the trough (1-bar confirm) and its
// geometry is fixed from that moment; a deviation level's touch scan is bounded by the 12 bars that
// follow the signal, and a level that has been touched stays touched; a cross is a function of two
// consecutive defined bars. Pure — no wall clock, randomness or module-level state.

import type {
  LabelPrim,
  LinePrim,
  MarkerPrim,
  ModuleCtx,
  ModuleResult,
  Prim,
  SuiteEvent,
  SuiteField,
  SuiteModuleDef,
  TooltipDef,
} from "@/lib/indicator-canvas/types";
import {
  MAX_EVENTS,
  MID_LEVEL,
  NEUTRAL_HI,
  NEUTRAL_LO,
  OB_LEVEL,
  OS_LEVEL,
  PANE_MAX,
  PANE_MIN,
  boolOpt,
  clampNum,
  clampPane,
  finiteIdx,
  intOpt,
  sharedRsi,
} from "./rsiEngine";
import { RSI_SIGNALS_META } from "./rsiSignals.meta";

// ------------------------------------------------------------------------------------ constants

const DEV_STEP = 12; // RSI points between deviation levels (+1 = 12, +2 = 24)
const DEV_BARS = 12; // how far right a deviation level is carried
const MARKER_SIZE = 4.5;
const MARKER_ALPHA = 0.9;
const MARKER_OFF = 6; // RSI points of stand-off between the wave and its triangle
const DEV_W = 1;
const DEV_ALPHA_PENDING = 0.85;
const DEV_ALPHA_TOUCHED = 0.5;
const DEV_DASH = "4 3";
const DOT_SIZE = 2.5;
const DOT_ALPHA = 0.8;
const MAX_DOTS = 80;
const DOT_MIN_PX_PER_BAR = 1.5; // dots turn to a smear below this zoom

// ------------------------------------------------------------------------------------- settings


// --------------------------------------------------------------------------------------- model

interface Signal {
  i: number; // the trough/peak bar (where the triangle sits)
  confirm: number; // the bar that confirmed the turn
  dir: 1 | -1; // +1 bullish (from oversold), -1 bearish (from overbought)
  rsi: number; // reading at the extreme — the anchor for the deviation levels
}

interface DevLevel {
  sig: Signal;
  step: 1 | 2;
  p: number;
  touch: number; // bar index of first touch, -1 while pending
}

// ------------------------------------------------------------------------------------- compute

function compute(ctx: ModuleCtx): ModuleResult {
  const { bars, colors, lang } = ctx;
  const n = bars?.length ?? 0;
  const empty: ModuleResult = { prims: [], tooltips: [], events: [] };
  if (n < 4) return empty;

  const s = ctx.s || {};
  const wantSignals = boolOpt(s.signals, true);
  const wantDev = boolOpt(s.deviations, true);
  const wantDots = boolOpt(s.crossDots, true);
  const showLast = intOpt(s.showLast, 12, 4, 30);
  const zh = lang === "zh";

  // The Engine's OWN series (its user settings ride in ctx.suite) — never the module defaults, or
  // retuning the Engine would detach every triangle and dot from the curve they describe.
  const { rsi, smooth } = sharedRsi(ctx);
  const fin = finiteIdx(rsi);
  if (fin.length < 3) return empty;

  // ---- 1) in-zone reversals (1-bar confirm, one per excursion) -------------------------
  const signals: Signal[] = [];
  let bullFired = false;
  let bearFired = false;
  for (let k = 2; k < fin.length; k++) {
    const iP = fin[k - 1];
    const vPrev = rsi[fin[k - 2]];
    const vPiv = rsi[iP];
    const vNow = rsi[fin[k]];

    if (vPiv > OS_LEVEL) bullFired = false; // left the zone: re-arm
    if (vPiv < OB_LEVEL) bearFired = false;

    if (!bullFired && vPiv <= OS_LEVEL && vPrev > vPiv && vNow > vPiv) {
      signals.push({ i: iP, confirm: fin[k], dir: 1, rsi: vPiv });
      bullFired = true;
    } else if (!bearFired && vPiv >= OB_LEVEL && vPrev < vPiv && vNow < vPiv) {
      signals.push({ i: iP, confirm: fin[k], dir: -1, rsi: vPiv });
      bearFired = true;
    }
  }

  // ---- 2) deviation levels + their touch lifecycle ------------------------------------
  const levels: DevLevel[] = [];
  for (const sig of signals) {
    for (const step of [1, 2] as const) {
      const p = sig.rsi + sig.dir * DEV_STEP * step;
      if (p <= PANE_MIN + 1 || p >= PANE_MAX - 1) continue; // off-pane: the level would be a lie
      let touch = -1;
      const stop = Math.min(n - 1, sig.i + DEV_BARS);
      for (let j = sig.i + 1; j <= stop; j++) {
        const v = rsi[j];
        if (!Number.isFinite(v)) continue;
        if (sig.dir > 0 ? v >= p : v <= p) {
          touch = j;
          break;
        }
      }
      levels.push({ sig, step, p, touch });
    }
  }

  // ---- 3) MA crossover dots outside the neutral band ----------------------------------
  const crosses: Array<{ i: number; dir: 1 | -1; p: number }> = [];
  let prevDiff = NaN;
  for (let i = 0; i < n; i++) {
    const v = rsi[i];
    const m = smooth[i];
    if (!Number.isFinite(v) || !Number.isFinite(m)) continue;
    const diff = v - m;
    if (Number.isFinite(prevDiff) && prevDiff !== 0 && diff !== 0 && prevDiff * diff < 0) {
      if (v < NEUTRAL_LO || v > NEUTRAL_HI) crosses.push({ i, dir: diff > 0 ? 1 : -1, p: v });
    }
    prevDiff = diff;
  }

  // ------------------------------------------------------------------------------ events
  const events: SuiteEvent[] = [];
  const revLabel = (dir: 1 | -1, v: number) =>
    zh
      ? `${dir > 0 ? "超卖反转" : "超买反转"} · RSI ${v.toFixed(1)}`
      : `${dir > 0 ? "Oversold" : "Overbought"} reversal · RSI ${v.toFixed(1)}`;
  for (const sig of signals) {
    events.push({
      type: "rsix_reversal",
      dir: sig.dir > 0 ? "bull" : "bear",
      i: sig.i,
      p: sig.rsi,
      strength: clampNum(Math.round(Math.abs(MID_LEVEL - sig.rsi) * 2), 0, 100),
      label: revLabel(sig.dir, sig.rsi),
    });
  }
  for (const lv of levels) {
    if (lv.touch < 0) continue;
    events.push({
      type: "rsix_dev_touch",
      dir: lv.sig.dir > 0 ? "bull" : "bear",
      i: lv.touch,
      p: lv.p,
      strength: lv.step === 1 ? 50 : 100,
      label: zh
        ? `偏离 +${lv.step} 触及 · RSI ${lv.p.toFixed(1)}`
        : `Deviation +${lv.step} reached · RSI ${lv.p.toFixed(1)}`,
    });
  }
  for (const c of crosses) {
    events.push({
      type: "rsix_cross",
      dir: c.dir > 0 ? "bull" : "bear",
      i: c.i,
      p: c.p,
      strength: clampNum(Math.round(Math.abs(MID_LEVEL - c.p) * 2), 0, 100),
      label: zh
        ? `RSI ${c.dir > 0 ? "上穿" : "下穿"}均线 · ${c.p.toFixed(1)}`
        : `RSI crossed ${c.dir > 0 ? "above" : "below"} its MA · ${c.p.toFixed(1)}`,
    });
  }
  events.sort((a, b) => a.i - b.i);

  // ------------------------------------------------------------------------------ render
  const prims: Prim[] = [];
  const tooltips: TooltipDef[] = [];
  const keptSignals = signals.slice(-showLast);
  const keepFrom = keptSignals.length ? keptSignals[0].i : Infinity;

  if (wantSignals) {
    const L = {
      title: zh ? "RSI 反转信号" : "RSI reversal",
      dir: zh ? "方向" : "Side",
      bull: zh ? "超卖转折" : "Oversold turn",
      bear: zh ? "超买转折" : "Overbought turn",
      rsi: zh ? "极值 RSI" : "Extreme RSI",
      d1: zh ? "偏离 +1" : "Deviation +1",
      d2: zh ? "偏离 +2" : "Deviation +2",
      hit: zh ? "已触及" : "reached",
      pend: zh ? "待触及" : "pending",
      off: zh ? "超出面板" : "off pane",
    };
    for (const sig of keptSignals) {
      const tipId = `rsix-sig-${sig.i}`;
      prims.push({
        kind: "marker",
        id: `${tipId}-m`,
        z: 3,
        i: sig.i,
        p: clampPane(sig.rsi + (sig.dir > 0 ? -MARKER_OFF : MARKER_OFF)),
        shape: sig.dir > 0 ? "tri-up" : "tri-down",
        size: MARKER_SIZE,
        fill: sig.dir > 0 ? colors.up : colors.down,
        alpha: MARKER_ALPHA,
        tooltipId: tipId,
      } as MarkerPrim);

      const mine = levels.filter((l) => l.sig === sig);
      const devRow = (step: 1 | 2) => {
        const lv = mine.find((l) => l.step === step);
        if (!lv) return L.off;
        return `${lv.p.toFixed(1)} · ${lv.touch >= 0 ? L.hit : L.pend}`;
      };
      tooltips.push({
        id: tipId,
        title: L.title,
        accent: sig.dir > 0 ? colors.up : colors.down,
        rows: [
          { k: L.dir, v: sig.dir > 0 ? L.bull : L.bear },
          { k: L.rsi, v: sig.rsi.toFixed(1) },
          { k: L.d1, v: devRow(1) },
          { k: L.d2, v: devRow(2) },
        ],
      });
    }
  }

  if (wantDev) {
    for (const lv of levels) {
      if (lv.sig.i < keepFrom) continue;
      const touched = lv.touch >= 0;
      const id = `rsix-dev-${lv.sig.i}-${lv.step}`;
      prims.push({
        kind: "line",
        id,
        z: 1,
        a: { i: lv.sig.i, p: lv.p },
        b: { i: lv.sig.i + DEV_BARS, p: lv.p },
        color: colors.text,
        w: DEV_W,
        alpha: touched ? DEV_ALPHA_TOUCHED : DEV_ALPHA_PENDING,
        dash: touched ? DEV_DASH : undefined,
      } as LinePrim);
      prims.push({
        kind: "label",
        id: `${id}-t`,
        z: 4,
        i: lv.sig.i,
        p: lv.p,
        text: `+${lv.step}`,
        place: "left",
        style: "chip",
        color: colors.text,
        fs: 9,
        minPxPerBar: DOT_MIN_PX_PER_BAR,
      } as LabelPrim);
    }
  }

  if (wantDots) {
    const dots = crosses.length > MAX_DOTS ? crosses.slice(crosses.length - MAX_DOTS) : crosses;
    for (const c of dots) {
      prims.push({
        kind: "marker",
        id: `rsix-x-${c.i}`,
        z: 2,
        i: c.i,
        p: c.p,
        shape: "circle",
        size: DOT_SIZE,
        fill: colors.brand,
        alpha: DOT_ALPHA,
        minPxPerBar: DOT_MIN_PX_PER_BAR,
      } as MarkerPrim);
    }
  }

  const tape = events.length > MAX_EVENTS ? events.slice(events.length - MAX_EVENTS) : events;
  return { prims, tooltips, events: tape };
}

// ---------------------------------------------------------------------------------- module def

export const RSI_SIGNALS_MODULE: SuiteModuleDef = { ...RSI_SIGNALS_META, compute };

export default RSI_SIGNALS_MODULE;
