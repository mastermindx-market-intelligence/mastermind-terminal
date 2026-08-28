// Pulse Signals — glyph layer of the Pulse suite (pane y-space −110..110, wave units).
//
// Contract: lib/indicator-canvas/types.ts (frozen). Visual spec: docs/
// PREMIUM_INDICATOR_VISUAL_DESIGN_BIBLE_2026-07-28.md §"Signals — visual spec".
// Algorithm sketch: docs/PREMIUM_INDICATOR_SUITE_MASTERPLAN_2026-07-28.md §8.3 "Pulse Oscillator".
//
// Consumes the SAME wave computation as Pulse Wave: `computePulseWave` (exported pure helper in
// ./pulseWave) is re-invoked here through the identical deterministic path — the host memoizes per
// (suite, symbol, tf, bars, params), so the duplicate call is cheap and the two modules can never
// disagree about the wave. Detection always runs (fvg precedent): visual toggles gate prims only,
// so the alert bridge keeps firing when a user hides a glyph family.
//
// Glyph vocabulary (bible law: shape = family, color token = direction, lane = polarity):
//   ☰ triple-lines  Buy below a trough turning up from ≤−60 (colors.up) / Sell mirror ≥+60 (down)
//   ✦ small diamond Dip: local trough held above 0 in a rising regime (colors.warn, α .7); mirror
//   ● circle        Peak: local extremum beyond ±80, drawn ON the line (colors.warn)
//   ◆ diamond       Gapped cross inside the ±60 zone (up-cross oversold = up / down-cross OB = down)
//
// Every family respects a 5-bar cooldown; confirmed-extremum detection (bar k−1 confirmed at k)
// means recomputing with more bars never alters confirmed history. Pure + deterministic.

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
import { computePulseWave, pulseProfileOf } from "./pulseWave";
import { PULSE_SIGNALS_META } from "./pulseSignals.meta";

// ------------------------------------------------------------------------------------ constants

const EXTREME = 60;      // buy/sell + gapped-cross zone
const PEAK_LVL = 80;     // peak-dot threshold
const COOLDOWN = 5;      // bars, per signal family
const BS_OFF = 8;        // ☰ stand-off from the trough/peak, wave units
const DIP_OFF = 4;       // ✦ stand-off, wave units
const BS_SIZE = 5;
const DIP_SIZE = 3;
const PEAK_SIZE = 3;
const GC_SIZE = 5;
const DIP_ALPHA = 0.7;
const DENSE_MIN_PX = 2;  // declutter gate for dip/peak glyphs at far zoom-out
const MAX_EVENTS = 80;

// ------------------------------------------------------------------------------------- settings


// -------------------------------------------------------------------------------------- helpers

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function numOpt(v: any, d: number, lo: number, hi: number): number {
  const x = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(x) ? clamp(x, lo, hi) : d;
}

function boolOpt(v: any, d: boolean): boolean {
  return typeof v === "boolean" ? v : d;
}

// ------------------------------------------------------------------------------------- compute

interface BS { i: number; p: number; up: boolean; wTr: number }
interface Glyph { i: number; p: number; up: boolean }

function compute(ctx: ModuleCtx): ModuleResult {
  const { bars, colors, lang } = ctx;
  const n = bars.length;
  const empty: ModuleResult = { prims: [], tooltips: [], events: [] };
  if (n < 5) return empty;

  const s = ctx.s || {};
  // ONE profile knob per pane: the Wave module owns it and this module follows it through
  // ctx.suite. A private copy here would silently detect on a wave nobody is looking at.
  const profile = pulseProfileOf(ctx.suite);
  const wantBS = boolOpt(s.buySell, true);
  const wantDip = boolOpt(s.dipDiamonds, true);
  const wantPeak = boolOpt(s.peaks, false);
  const wantGC = boolOpt(s.gappedCross, false);
  const showLast = Math.round(numOpt(s.showLast, 16, 4, 40));
  const zh = lang === "zh";

  const { wave, gapped } = computePulseWave(bars, profile);

  // Compact the finite wave (bar index preserved) so extrema scan over real prints only.
  const K: Array<{ i: number; w: number; g: number }> = [];
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(wave[i])) K.push({ i, w: wave[i], g: gapped[i] });
  }
  const m = K.length;
  if (m < 4) return empty;

  const events: SuiteEvent[] = [];
  const buySell: BS[] = [];
  const dips: Glyph[] = [];
  const peaks: Glyph[] = [];
  const gcross: Glyph[] = [];

  const lastFire: Record<string, number> = {};
  const fire = (fam: string, i: number): boolean => {
    const last = lastFire[fam];
    if (last !== undefined && i - last < COOLDOWN) return false;
    lastFire[fam] = i;
    return true;
  };

  for (let k = 2; k < m; k++) {
    const c0 = K[k]; // confirming bar
    const c1 = K[k - 1]; // candidate extremum
    const c2 = K[k - 2];
    const trough = c1.w < c2.w && c0.w > c1.w;
    const peak = c1.w > c2.w && c0.w < c1.w;
    const gapOk = Number.isFinite(c0.g) && Number.isFinite(c1.g);
    const strengthAt = (w: number) => clamp(Math.round(Math.abs(w)), 0, 100);

    if (trough) {
      // Buy: wave turned up from the oversold zone.
      if (c1.w <= -EXTREME && fire("buy", c0.i)) {
        buySell.push({ i: c1.i, p: c1.w, up: true, wTr: c1.w });
        events.push({
          type: "pulse_buy", dir: "bull", i: c0.i, p: c1.w, strength: strengthAt(c1.w),
          label: zh ? `脉冲买入 · 波值 ${Math.round(c1.w)}` : `Pulse Buy · wave ${Math.round(c1.w)}`,
        });
      } else if (c1.w > 0 && gapOk && c0.g > c1.g && fire("dip_bull", c0.i)) {
        // Dip: rising regime (gapped line rising), trough held above zero.
        dips.push({ i: c1.i, p: c1.w, up: true });
        events.push({
          type: "pulse_dip", dir: "bull", i: c0.i, p: c1.w, strength: strengthAt(c1.w),
          label: zh ? `上升趋势回踩 · 波值 ${Math.round(c1.w)}` : `Pulse dip · rising regime (${Math.round(c1.w)})`,
        });
      }
      if (c1.w <= -PEAK_LVL && fire("peak_bull", c0.i)) peaks.push({ i: c1.i, p: c1.w, up: true });
    }

    if (peak) {
      // Sell: wave rolled over from the overbought zone.
      if (c1.w >= EXTREME && fire("sell", c0.i)) {
        buySell.push({ i: c1.i, p: c1.w, up: false, wTr: c1.w });
        events.push({
          type: "pulse_sell", dir: "bear", i: c0.i, p: c1.w, strength: strengthAt(c1.w),
          label: zh ? `脉冲卖出 · 波值 ${Math.round(c1.w)}` : `Pulse Sell · wave ${Math.round(c1.w)}`,
        });
      } else if (c1.w < 0 && gapOk && c0.g < c1.g && fire("dip_bear", c0.i)) {
        // Mirror dip: falling regime, bounce held below zero.
        dips.push({ i: c1.i, p: c1.w, up: false });
        events.push({
          type: "pulse_dip", dir: "bear", i: c0.i, p: c1.w, strength: strengthAt(c1.w),
          label: zh ? `下降趋势反抽 · 波值 ${Math.round(c1.w)}` : `Pulse dip · falling regime (${Math.round(c1.w)})`,
        });
      }
      if (c1.w >= PEAK_LVL && fire("peak_bear", c0.i)) peaks.push({ i: c1.i, p: c1.w, up: false });
    }

    // Gapped cross inside the extreme zone (only the aligned combos signal).
    if (gapOk) {
      const dPrev = c1.w - c1.g;
      const dCur = c0.w - c0.g;
      if (dPrev <= 0 && dCur > 0 && c0.w <= -EXTREME && fire("gc_bull", c0.i)) {
        gcross.push({ i: c0.i, p: c0.w, up: true });
        events.push({
          type: "pulse_gapped_cross", dir: "bull", i: c0.i, p: c0.w, strength: strengthAt(c0.w),
          label: zh ? `超卖区上穿间隔线` : `Gapped cross ▲ in oversold`,
        });
      } else if (dPrev >= 0 && dCur < 0 && c0.w >= EXTREME && fire("gc_bear", c0.i)) {
        gcross.push({ i: c0.i, p: c0.w, up: false });
        events.push({
          type: "pulse_gapped_cross", dir: "bear", i: c0.i, p: c0.w, strength: strengthAt(c0.w),
          label: zh ? `超买区下穿间隔线` : `Gapped cross ▼ in overbought`,
        });
      }
    }
  }

  // ---- prims (toggles + showLast apply here only) -------------------------------------
  const prims: Prim[] = [];
  const tooltips: TooltipDef[] = [];

  if (wantBS) {
    const L = {
      buy: zh ? "脉冲买入" : "Pulse Buy",
      sell: zh ? "脉冲卖出" : "Pulse Sell",
      wave: zh ? "波值" : "Wave",
      strength: zh ? "强度" : "Strength",
    };
    for (const g of buySell.slice(-showLast)) {
      const tipId = `ps-bs-${g.i}`;
      prims.push({
        kind: "marker",
        id: `${tipId}-m`,
        z: 3,
        i: g.i,
        p: g.up ? g.p - BS_OFF : g.p + BS_OFF,
        shape: "triple-lines",
        size: BS_SIZE,
        fill: g.up ? colors.up : colors.down,
        tooltipId: tipId,
      } as MarkerPrim);
      tooltips.push({
        id: tipId,
        title: g.up ? L.buy : L.sell,
        accent: g.up ? colors.up : colors.down,
        rows: [
          { k: L.wave, v: `${Math.round(g.wTr)}` },
          { k: L.strength, v: `${clamp(Math.round(Math.abs(g.wTr)), 0, 100)}` },
        ],
      });
    }
  }

  if (wantDip) {
    for (const g of dips.slice(-showLast)) {
      prims.push({
        kind: "marker",
        id: `ps-dip-${g.i}`,
        z: 2,
        i: g.i,
        p: g.up ? g.p - DIP_OFF : g.p + DIP_OFF,
        shape: "diamond",
        size: DIP_SIZE,
        fill: colors.warn,
        alpha: DIP_ALPHA,
        minPxPerBar: DENSE_MIN_PX,
      } as MarkerPrim);
    }
  }

  if (wantPeak) {
    for (const g of peaks.slice(-showLast)) {
      prims.push({
        kind: "marker",
        id: `ps-pk-${g.i}`,
        z: 2,
        i: g.i,
        p: g.p, // ON the line (bible: peak dots sit directly on the polyline)
        shape: "circle",
        size: PEAK_SIZE,
        fill: colors.warn,
        minPxPerBar: DENSE_MIN_PX,
      } as MarkerPrim);
    }
  }

  if (wantGC) {
    for (const g of gcross.slice(-showLast)) {
      prims.push({
        kind: "marker",
        id: `ps-gc-${g.i}`,
        z: 3,
        i: g.i,
        p: g.p,
        shape: "diamond",
        size: GC_SIZE,
        fill: g.up ? colors.up : colors.down,
      } as MarkerPrim);
    }
  }

  const tape = events.length > MAX_EVENTS ? events.slice(events.length - MAX_EVENTS) : events;
  return { prims, tooltips, events: tape };
}

// --------------------------------------------------------------------------------- module def

export const PULSE_SIGNALS_MODULE: SuiteModuleDef = { ...PULSE_SIGNALS_META, compute };

export default PULSE_SIGNALS_MODULE;
