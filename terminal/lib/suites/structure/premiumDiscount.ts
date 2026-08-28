// Premium & Discount + Golden Pocket — Structure Core module.
//
// Contract: lib/indicator-canvas/types.ts (frozen). Visual spec: docs/
// PREMIUM_INDICATOR_VISUAL_DESIGN_BIBLE_2026-07-28.md §"Price Action Concept — visual spec".
// Algorithm sketch: docs/PREMIUM_INDICATOR_SUITE_MASTERPLAN_2026-07-28.md §8.1.
//
// The active dealing range is the last CONFIRMED swing-high / swing-low pair from the shared pivot
// engine. Over that range we paint the three things a price-action trader actually reads:
//   • premium (upper 30%) and discount (lower 30%) stripes — where in the range price is trading,
//   • equilibrium — the 50% midpoint,
//   • the retracement overlay anchored on the trend side: the 0.618–0.65 golden pocket and the
//     0.786 OTE bound, measured DOWN from the high in an uptrend and UP from the low in a downtrend.
//
// Non-repaint: a range exists only from `activeFrom` = the confirmation bar of the pivot that
// completed the pair (pivot i is knowable at i + rangeLen, never before). Ranges are appended in
// confirmation order and never rewritten, and the event pass reads bars ≤ i only — so replaying the
// same series bar-by-bar reproduces the identical event list. Pure: no wall clock, no randomness,
// no module-level mutable state.

import type {
  LabelPrim,
  LinePrim,
  ModuleCtx,
  ModuleResult,
  Prim,
  SuiteBar,
  SuiteEvent,
  SuiteField,
  SuiteModuleDef,
  TooltipDef,
  XRef,
  ZonePrim,
} from "@/lib/indicator-canvas/types";
import { findPivotsHL, type Pivot } from "./pivots";
import { MAX_SHOW_LAST, PREMIUM_DISCOUNT_META } from "./premiumDiscount.meta";

// ------------------------------------------------------------------------------------ constants

const ZONE_FRAC = 0.3; // premium = top 30% of the range, discount = bottom 30%
const ZONE_ALPHA = 0.06;
const GP_ALPHA = 0.1;
const FIB_618 = 0.618;
const FIB_GP = 0.65; // far edge of the golden pocket
const FIB_786 = 0.786; // OTE bound
const EQ_ALPHA = 0.8;
const FIB_ALPHA = 0.9;
const SUPERSEDED_DIM = 0.55; // older ranges keep fills+lines, dimmed, and drop every label
const LABEL_FS = 9;
const LABEL_MIN_PX_PER_BAR = 3;
const EVENT_COOLDOWN = 5; // bars between two events of the same type
const MAX_EVENTS = 80; // recency cap on the emitted event tape

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

function fmtPrice(p: number): string {
  const a = Math.abs(p);
  const d = a >= 1 ? 2 : a >= 0.01 ? 4 : 6;
  return p.toFixed(d);
}

// ---------------------------------------------------------------------------------- range state

interface Range {
  startBar: number; // bar of the LATER pivot — the range's left edge on the chart
  activeFrom: number; // confirmation bar of that pivot — first bar the range may act on
  lo: number;
  hi: number;
  span: number;
  up: boolean; // uptrend when the high pivot is the newer of the pair
}

/** Retracement price at fraction `f`, measured back from the trend-side extreme. */
function fibLevel(r: Range, f: number): number {
  return r.up ? r.hi - f * r.span : r.lo + f * r.span;
}

// ---------------------------------------------------------------------------------- compute

function compute(ctx: ModuleCtx): ModuleResult {
  const { bars, colors, lang } = ctx;
  const n = bars.length;
  const empty: ModuleResult = { prims: [], tooltips: [], events: [] };

  const s = ctx.s || {};
  const rangeLen = Math.round(numOpt(s.rangeLen, 5, 3, 12));
  const zonesOn = boolOpt(s.zones, true);
  const eqOn = boolOpt(s.equilibrium, true);
  const fibOn = boolOpt(s.showFib, true);
  const gpOn = fibOn && boolOpt(s.goldenPocket, true);
  const labelsOn = boolOpt(s.labels, true);
  const showLast = Math.round(numOpt(s.showLast, 1, 1, MAX_SHOW_LAST));
  const zh = lang === "zh";

  if (n < rangeLen * 2 + 2) return empty;

  // ---- 1) build the range chain from confirmed pivots ---------------------------------
  const pivots: Pivot[] = findPivotsHL(bars, rangeLen, rangeLen, "wick") ?? [];
  const ranges: Range[] = [];
  let lastHigh: Pivot | null = null;
  let lastLow: Pivot | null = null;

  for (const pv of pivots) {
    if (!Number.isFinite(pv.p) || pv.p <= 0) continue; // a 0 print is missing data, not a swing
    if (pv.kind === "high") lastHigh = pv;
    else lastLow = pv;
    if (!lastHigh || !lastLow) continue;

    const hi = lastHigh.p;
    const lo = lastLow.p;
    const span = hi - lo;
    if (!(span > 0)) continue; // pair crossed over (low above high) — no dealing range yet

    const prev = ranges.length ? ranges[ranges.length - 1] : null;
    if (prev && prev.hi === hi && prev.lo === lo) continue; // same pair, nothing changed

    const r: Range = {
      startBar: pv.i, // pv carries the largest index seen so far → strictly increasing
      activeFrom: pv.confirmedAt,
      lo,
      hi,
      span,
      up: lastHigh.i > lastLow.i,
    };
    // one bar can be both a pivot high and a pivot low — the later pair wins that bar
    if (prev && prev.startBar === r.startBar) ranges[ranges.length - 1] = r;
    else ranges.push(r);
  }

  if (!ranges.length) return empty;

  // ---- 2) forward event pass (bars ≤ i only) ------------------------------------------
  const events: SuiteEvent[] = [];
  let ri = 0;
  let cur: Range | null = null;
  let inPrem = false;
  let inDisc = false;
  let lastPrem = -1e9;
  let lastDisc = -1e9;
  let lastGP = -1e9;

  for (let i = 0; i < n; i++) {
    while (ri < ranges.length && ranges[ri].activeFrom <= i) {
      cur = ranges[ri];
      ri++;
      inPrem = false;
      inDisc = false;
    }
    if (!cur) continue;
    const b = bars[i];
    if (!validBar(b)) continue;

    const premLine = cur.hi - ZONE_FRAC * cur.span;
    const discLine = cur.lo + ZONE_FRAC * cur.span;
    const pos = clamp(Math.round(((b.c - cur.lo) / cur.span) * 100), 0, 100);

    const nowPrem = b.c >= premLine;
    if (nowPrem && !inPrem && i - lastPrem >= EVENT_COOLDOWN) {
      lastPrem = i;
      events.push({
        type: "pd_enter_premium",
        dir: "bear",
        i,
        p: b.c,
        strength: pos,
        label: zh ? `进入溢价区 · 区间 ${pos}%` : `Premium zone · ${pos}% of range`,
      });
    }
    inPrem = nowPrem;

    const nowDisc = b.c <= discLine;
    if (nowDisc && !inDisc && i - lastDisc >= EVENT_COOLDOWN) {
      lastDisc = i;
      events.push({
        type: "pd_enter_discount",
        dir: "bull",
        i,
        p: b.c,
        strength: 100 - pos,
        label: zh ? `进入折价区 · 区间 ${pos}%` : `Discount zone · ${pos}% of range`,
      });
    }
    inDisc = nowDisc;

    const g1 = fibLevel(cur, FIB_618);
    const g2 = fibLevel(cur, FIB_GP);
    const gLo = Math.min(g1, g2);
    const gHi = Math.max(g1, g2);
    if (b.h >= gLo && b.l <= gHi && i - lastGP >= EVENT_COOLDOWN) {
      lastGP = i;
      const dist = b.c > gHi ? b.c - gHi : b.c < gLo ? gLo - b.c : 0;
      events.push({
        type: "pd_golden_touch",
        dir: cur.up ? "bull" : "bear",
        i,
        p: (gLo + gHi) / 2,
        strength: clamp(Math.round(100 - (dist / cur.span) * 400), 0, 100),
        label: zh ? "黄金口袋 · 0.618–0.650" : "Golden pocket · 0.618–0.650",
      });
    }
  }

  // ---- 3) render ----------------------------------------------------------------------
  const prims: Prim[] = [];
  const tooltips: TooltipDef[] = [];
  const base = Math.max(0, ranges.length - showLast);
  const last = n - 1;

  const L = {
    premium: zh ? "溢价" : "Premium",
    discount: zh ? "折价" : "Discount",
    title: zh ? "溢价 / 折价" : "Premium & Discount",
    range: zh ? "区间" : "Range",
    eq: zh ? "均衡位" : "Equilibrium",
    pos: zh ? "价格位置" : "Position",
    trend: zh ? "方向" : "Trend",
    up: zh ? "上升" : "Up",
    down: zh ? "下降" : "Down",
    gp: zh ? "黄金口袋" : "Golden pocket",
    ote: zh ? "OTE 边界" : "OTE bound",
  };

  for (let k = base; k < ranges.length; k++) {
    const r = ranges[k];
    const next = k + 1 < ranges.length ? ranges[k + 1] : null;
    const active = !next;
    const i2: XRef = next ? next.startBar : "right";
    const dim = active ? 1 : SUPERSEDED_DIM;
    const id = `pd-${r.startBar}`;
    const eq = (r.lo + r.hi) / 2;
    const premLo = r.hi - ZONE_FRAC * r.span;
    const discHi = r.lo + ZONE_FRAC * r.span;

    // premium / discount stripes — flat low-alpha fills behind the candles
    if (zonesOn) {
      prims.push({
        kind: "zone",
        id: `${id}-prem`,
        z: 0,
        i1: r.startBar,
        i2,
        p1: premLo,
        p2: r.hi,
        fill: colors.down,
        fillAlpha: ZONE_ALPHA * dim,
      } as ZonePrim);
      prims.push({
        kind: "zone",
        id: `${id}-disc`,
        z: 0,
        i1: r.startBar,
        i2,
        p1: r.lo,
        p2: discHi,
        fill: colors.up,
        fillAlpha: ZONE_ALPHA * dim,
      } as ZonePrim);
    }

    // golden pocket 0.618–0.650, hairline edges
    if (gpOn) {
      const g1 = fibLevel(r, FIB_618);
      const g2 = fibLevel(r, FIB_GP);
      prims.push({
        kind: "zone",
        id: `${id}-gp`,
        z: 1,
        i1: r.startBar,
        i2,
        p1: Math.min(g1, g2),
        p2: Math.max(g1, g2),
        fill: colors.warn,
        fillAlpha: GP_ALPHA * dim,
        stroke: colors.warn,
        strokeW: 1,
        edges: ["top", "bottom"],
      } as ZonePrim);
    }

    // equilibrium — dashed midpoint
    if (eqOn) {
      prims.push({
        kind: "line",
        id: `${id}-eq`,
        z: 2,
        a: { i: r.startBar, p: eq },
        b: { i: i2, p: eq },
        color: colors.neutral,
        w: 1,
        dash: "5 4",
        alpha: EQ_ALPHA * dim,
      } as LinePrim);
    }

    if (fibOn) {
      // 0.618 gets its own hairline only when the pocket is off (else it IS the pocket edge)
      if (!gpOn) {
        prims.push({
          kind: "line",
          id: `${id}-f618`,
          z: 2,
          a: { i: r.startBar, p: fibLevel(r, FIB_618) },
          b: { i: i2, p: fibLevel(r, FIB_618) },
          color: colors.warn,
          w: 1,
          alpha: FIB_ALPHA * dim,
        } as LinePrim);
      }
      prims.push({
        kind: "line",
        id: `${id}-f786`,
        z: 2,
        a: { i: r.startBar, p: fibLevel(r, FIB_786) },
        b: { i: i2, p: fibLevel(r, FIB_786) },
        color: colors.brand,
        w: 1,
        alpha: FIB_ALPHA * dim,
      } as LinePrim);
    }

    // labels ride the newest range only — superseded ranges keep fills+lines and drop text
    if (!active || !labelsOn) continue;
    const tipId = `pd-tip-${r.startBar}`;

    const bare = (suffix: string, p: number, text: string, tip: boolean): LabelPrim => ({
      kind: "label",
      id: `${id}-${suffix}`,
      z: 3,
      i: "right",
      p,
      text,
      place: "left",
      style: "bare",
      color: colors.muted,
      fs: LABEL_FS,
      minPxPerBar: LABEL_MIN_PX_PER_BAR,
      ...(tip ? { tooltipId: tipId } : {}),
    });

    if (fibOn) {
      const p618 = fibLevel(r, FIB_618);
      const p786 = fibLevel(r, FIB_786);
      prims.push(bare("l618", p618, `0.618 ${fmtPrice(p618)}`, true));
      prims.push(bare("l786", p786, `0.786 ${fmtPrice(p786)}`, true));
    }
    if (eqOn) prims.push(bare("leq", eq, `EQ ${fmtPrice(eq)}`, true));

    // stripe captions anchored at the range's left edge so they never stack with the price labels
    if (zonesOn) {
      const caption = (suffix: string, p: number, text: string): LabelPrim => ({
        kind: "label",
        id: `${id}-${suffix}`,
        z: 3,
        i: r.startBar,
        p,
        text,
        place: "right",
        style: "bare",
        color: colors.muted,
        fs: LABEL_FS,
        minPxPerBar: LABEL_MIN_PX_PER_BAR,
      });
      prims.push(caption("cprem", (premLo + r.hi) / 2, L.premium));
      prims.push(caption("cdisc", (r.lo + discHi) / 2, L.discount));
    }

    // one tooltip for the active range, hung off the price labels (skip when none were emitted)
    if (!fibOn && !eqOn) continue;
    const lastBar = validBar(bars[last]) ? bars[last] : null;
    const rows: TooltipDef["rows"] = [
      { k: L.range, v: `${fmtPrice(r.lo)} – ${fmtPrice(r.hi)}` },
      { k: L.eq, v: fmtPrice(eq) },
      { k: L.trend, v: r.up ? L.up : L.down, color: r.up ? colors.up : colors.down },
    ];
    if (lastBar) {
      const pos = clamp(Math.round(((lastBar.c - r.lo) / r.span) * 100), 0, 100);
      const zone = lastBar.c >= premLo ? L.premium : lastBar.c <= discHi ? L.discount : L.eq;
      rows.splice(2, 0, {
        k: L.pos,
        v: `${pos}% · ${zone}`,
        color: lastBar.c >= premLo ? colors.down : lastBar.c <= discHi ? colors.up : colors.muted,
      });
    }
    if (gpOn) {
      const g1 = fibLevel(r, FIB_618);
      const g2 = fibLevel(r, FIB_GP);
      rows.push({
        k: L.gp,
        v: `${fmtPrice(Math.min(g1, g2))} – ${fmtPrice(Math.max(g1, g2))}`,
        color: colors.warn,
      });
    }
    if (fibOn) rows.push({ k: L.ote, v: fmtPrice(fibLevel(r, FIB_786)), color: colors.brand });
    tooltips.push({
      id: tipId,
      title: L.title,
      accent: r.up ? colors.up : colors.down,
      rows,
    });
  }

  const tape = events.length > MAX_EVENTS ? events.slice(events.length - MAX_EVENTS) : events;
  return { prims, tooltips, events: tape };
}

// --------------------------------------------------------------------------------- module def

export const PREMIUM_DISCOUNT_MODULE: SuiteModuleDef = { ...PREMIUM_DISCOUNT_META, compute };

export default PREMIUM_DISCOUNT_MODULE;
