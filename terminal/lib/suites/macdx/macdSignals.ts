// MACD Signals — MACD-Ultimate pane suite (extreme-zone-only momentum reversals).
//
// Contract: lib/indicator-canvas/types.ts (frozen). Visual spec: docs/
// PREMIUM_INDICATOR_VISUAL_DESIGN_BIBLE_2026-07-28.md §"MACD Signals — visual spec".
//
// The whole point of this module is what it does NOT print. A macd×signal cross is a coin flip in
// the middle of the range; the same cross taken while the normalized MACD is pinned against a
// saturation rail is a high-conviction momentum reversal. So a triangle prints only when the cross
// happens INSIDE an extreme zone, and only in the zone's own direction:
//
//   ▲ (up)   macd crosses ABOVE signal while macd ≤ −threshold   (turning up out of oversold)
//   ▼ (down) macd crosses BELOW signal while macd ≥ +threshold   (rolling over out of overbought)
//
// A cross up inside the OVERBOUGHT zone is momentum continuation, not a reversal, and is silent.
//
// Non-repaint: the cross is decided from bars i−1 and i only and the marker is plotted on bar i —
// no confirmation window to slide and nothing to move when future bars arrive. Values live in the
// suite's pane y-space (±100 rails, ±120 pane). Pure and deterministic.

import type {
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
  MACDX_PANE_MAX,
  MACDX_PANE_MIN,
  clamp,
  intOpt,
  paneVal,
  sharedMacd,
  tape,
} from "./macdEngine";
import { MACD_SIGNALS_META } from "./macdSignals.meta";

// ------------------------------------------------------------------------------------ constants

const MARKER_SIZE = 6;
const MARKER_OFF = 10; // pane units between the curve and the triangle
const MARKER_ALPHA = 0.95;

// ------------------------------------------------------------------------------------- settings


// -------------------------------------------------------------------------------------- compute

interface Sig {
  i: number;
  bull: boolean;
  macd: number;
  signal: number;
}

function compute(ctx: ModuleCtx): ModuleResult {
  const { bars, colors, lang } = ctx;
  const n = bars?.length ?? 0;
  const empty: ModuleResult = { prims: [], tooltips: [], events: [] };
  if (n < 5) return empty;

  const s = ctx.s || {};
  const threshold = intOpt(s.threshold, 80, 60, 95);
  const showLast = intOpt(s.showLast, 12, 4, 24);
  const zh = lang === "zh";

  // The Engine's OWN curve + signal line (its user settings ride in ctx.suite) — a retuned Engine
  // must move these triangles with the cross they mark, not leave them on a default calibration.
  const { macd, signal } = sharedMacd(bars, ctx.suite);

  // ---- scan: crosses gated to their own extreme zone -----------------------------------
  const hits: Sig[] = [];
  let pm = NaN;
  let ps = NaN;
  for (let i = 0; i < n; i++) {
    const m = macd[i];
    const g = signal[i];
    if (!Number.isFinite(m) || !Number.isFinite(g)) continue;
    if (Number.isFinite(pm) && Number.isFinite(ps)) {
      const up = pm <= ps && m > g;
      const dn = pm >= ps && m < g;
      if (up && m <= -threshold) hits.push({ i, bull: true, macd: m, signal: g });
      else if (dn && m >= threshold) hits.push({ i, bull: false, macd: m, signal: g });
    }
    pm = m;
    ps = g;
  }
  if (!hits.length) return empty;

  // ---- event tape (never gated by showLast — the alert bridge reads it) -----------------
  const events: SuiteEvent[] = hits.map((h) => ({
    type: "macdx_signal",
    dir: h.bull ? "bull" : "bear",
    i: h.i,
    p: h.macd,
    strength: Math.round(clamp(Math.abs(h.macd), 0, 100)),
    label: zh
      ? `${h.bull ? "超卖区动能反转" : "超买区动能反转"} · MACD ${h.macd.toFixed(1)}`
      : `${h.bull ? "Oversold" : "Overbought"} momentum reversal · MACD ${h.macd.toFixed(1)}`,
  }));

  // ---- draw ----------------------------------------------------------------------------
  const prims: Prim[] = [];
  const tooltips: TooltipDef[] = [];
  const L = {
    title: zh ? "MACD 极值反转" : "MACD extreme reversal",
    side: zh ? "方向" : "Side",
    bull: zh ? "由超卖转多" : "Bullish (oversold)",
    bear: zh ? "由超买转空" : "Bearish (overbought)",
    macd: zh ? "MACD" : "MACD",
    sig: zh ? "信号线" : "Signal",
    zone: zh ? "极值门槛" : "Zone",
  };

  for (const h of hits.slice(-showLast)) {
    const p = paneVal(
      h.bull ? h.macd - MARKER_OFF : h.macd + MARKER_OFF,
      MACDX_PANE_MIN + 2,
      MACDX_PANE_MAX - 2,
    );
    if (p == null) continue;
    const tipId = `mx-sig-${h.i}`;
    prims.push({
      kind: "marker",
      id: `${tipId}-m`,
      z: 3,
      i: h.i,
      p,
      shape: h.bull ? "tri-up" : "tri-down",
      size: MARKER_SIZE,
      fill: h.bull ? colors.up : colors.down,
      alpha: MARKER_ALPHA,
      tooltipId: tipId,
    } as MarkerPrim);
    tooltips.push({
      id: tipId,
      title: L.title,
      accent: h.bull ? colors.up : colors.down,
      rows: [
        { k: L.side, v: h.bull ? L.bull : L.bear, color: h.bull ? colors.up : colors.down },
        { k: L.macd, v: h.macd.toFixed(1) },
        { k: L.sig, v: h.signal.toFixed(1) },
        { k: L.zone, v: `±${threshold}` },
      ],
    });
  }

  return { prims, tooltips, events: tape(events) };
}

// ----------------------------------------------------------------------------------- module def

export const MACD_SIGNALS_MODULE: SuiteModuleDef = { ...MACD_SIGNALS_META, compute };

export default MACD_SIGNALS_MODULE;
