// Liquidity Concepts — Structure Core module (W1).
//
// Contract: lib/indicator-canvas/types.ts (frozen). Visual spec: docs/
// PREMIUM_INDICATOR_VISUAL_DESIGN_BIBLE_2026-07-28.md §"Liquidity Concepts — visual spec".
// Algorithm sketch: docs/PREMIUM_INDICATOR_SUITE_MASTERPLAN_2026-07-28.md §8.1 "Liquidity Suite".
//
// Four of the vendor's six sub-features (Dynamic Liquidity Map and the right-side Liquidity
// Profile are deferred to W2):
//   1. Equal highs/lows  — confirmed pivots clustered inside tolerance×ATR14 become one horizontal
//      liquidity line anchored at the FIRST pivot; touch count drives intensity.
//   2. Grabs             — a wick that pierces an active level by ≥ grabSens×ATR and closes back
//      through it sweeps the line (marker + event); the line restyles to "swept" and expires.
//   3. Heat lines        — the same pre-grab lines ARE the heat layer: three discrete age tiers
//      (fresh brand → warn half → warn full). No gradient math.
//   4. Bubbles           — circles at confirmed pivots sized by the pivot bar's volume percentile.
//
// Non-repaint: every decision at bar i uses bars ≤ i only. Pivots enter the state machine on their
// `confirmedAt` bar (never on the extreme's bar), and a line's LEVEL is frozen at its anchor pivot —
// later touches raise the count but never move the price, so previously drawn geometry and already
// emitted events can never change when more bars arrive.
//
// Pure: no wall clock, no randomness, no module-level mutable state.

import type {
  LabelPrim,
  LinePrim,
  MarkerPrim,
  ModuleCtx,
  ModuleResult,
  Prim,
  SuiteBar,
  SuiteEvent,
  SuiteField,
  SuiteModuleDef,
  TooltipDef,
  XRef,
} from "@/lib/indicator-canvas/types";
import { findPivotsHL, type Pivot } from "./pivots";
import { LIQUIDITY_META } from "./liquidity.meta";

// ------------------------------------------------------------------------------------ constants

const ATR_LEN = 14;
const PIVOT_WING = 10; // left = right = 10 → a pivot is knowable 10 bars after its extreme
const SWEPT_LINGER = 20; // bars a swept line stays on the chart after the grab
const CLUSTER_WINDOW = 500; // a pivot may only join a cluster touched within this many bars
const PENDING_MAX = 64; // memory bound on single-touch (not yet a line) clusters
const VOL_WIN = 100; // trailing window for the bubble volume percentile
const MAX_BUBBLES = 60; // recency cap on rendered bubbles
const MAX_EVENTS = 80; // recency cap on the emitted event tape

// heat tiers (discrete — never interpolate)
const HEAT_FRESH_BARS = 20;
const HEAT_MID_BARS = 60;
const HEAT_MID_ALPHA = 0.5;

const SWEPT_ALPHA = 0.3;
const SWEPT_DASH = "4 3";
const MARKER_ALPHA = 0.85;
const MARKER_SIZE = 4.5;
const MARKER_OFFSET_ATR = 0.35;
const BUBBLE_ALPHA = 0.5;
const BUBBLE_MIN_PX_PER_BAR = 1.5;
const CHIP_FS = 9;
const CHIP_MIN_PX_PER_BAR = 2.5;

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

function fmtPrice(p: number): string {
  const a = Math.abs(p);
  const d = a >= 1 ? 2 : a >= 0.01 ? 4 : 6;
  return p.toFixed(d);
}

/** Touch-count intensity: 2 → .45, 3 → .7, 4+ → 1.0. */
function touchAlpha(touches: number): number {
  if (touches <= 2) return 0.45;
  if (touches === 3) return 0.7;
  return 1;
}

/**
 * Percentile (0..100) of the bar's volume inside the trailing VOL_WIN window ending at that bar.
 * Bars with a non-finite volume are ignored; an all-zero window returns 0 (no bubble).
 */
function volPercentile(bars: SuiteBar[], i: number): number {
  const v = bars[i]?.v;
  if (!Number.isFinite(v) || !(v > 0)) return 0;
  const from = Math.max(0, i - VOL_WIN + 1);
  let seen = 0;
  let below = 0;
  for (let k = from; k <= i; k++) {
    const x = bars[k].v;
    if (!Number.isFinite(x)) continue;
    seen++;
    if (x <= v) below++;
  }
  if (seen < 2) return 0;
  return (below / seen) * 100;
}

// ------------------------------------------------------------------------------- cluster state

interface Cluster {
  id: string;
  kind: "high" | "low";
  level: number; // FROZEN at the anchor pivot — later touches never move it
  anchorI: number; // bar index of the first pivot in the cluster
  touches: number;
  lastTouchI: number; // bar index of the most recent pivot
  createdAt: number; // bar where the cluster reached minTouches (-1 while pending)
  grabAt: number; // bar of the sweep (-1 until swept)
  grabExcess: number; // wick excess of the sweep, in ATR multiples
  dead: boolean;
}

interface Bubble {
  i: number;
  p: number;
  size: number;
  kind: "high" | "low";
  pct: number;
}

/** Bubble size tiers: floor..40 → 3, 40–60 → 4.5, 60–80 → 6, 80+ → 8. */
function bubbleSize(pct: number): number {
  if (pct < 40) return 3;
  if (pct < 60) return 4.5;
  if (pct < 80) return 6;
  return 8;
}

// ------------------------------------------------------------------------------------- compute

function compute(ctx: ModuleCtx): ModuleResult {
  const { bars, colors, lang } = ctx;
  const n = bars.length;
  const empty: ModuleResult = { prims: [], tooltips: [], events: [] };
  if (n < PIVOT_WING * 2 + 2) return empty;

  const s = ctx.s || {};
  const tolerance = numOpt(s.tolerance, 0.25, 0.05, 1);
  const minTouches = Math.round(numOpt(s.minTouches, 2, 2, 5));
  const grabs = boolOpt(s.grabs, true);
  const grabSens = numOpt(s.grabSens, 0.5, 0.2, 2);
  const heatLines = boolOpt(s.heatLines, true);
  const maxLines = Math.round(numOpt(s.maxLines, 10, 4, 20));
  const bubblesOn = boolOpt(s.bubbles, false);
  const bubbleThreshold = numOpt(s.bubbleThreshold, 20, 20, 80);
  const showLast = Math.round(numOpt(s.showLast, 12, 4, 24));
  const zh = lang === "zh";

  const atr = atrSeries(bars, ATR_LEN);
  const pivots: Pivot[] = findPivotsHL(bars, PIVOT_WING, PIVOT_WING, "wick");
  // findPivotsHL emits pivots ordered by bar index, so confirmedAt (= i + wing) is monotone too:
  // one cursor walks the list in lockstep with the bar loop.
  let pc = 0;

  let pending: Cluster[] = []; // fewer than minTouches touches — tracked, never drawn
  let lines: Cluster[] = []; // drawable liquidity lines (active or swept)
  const bubbles: Bubble[] = [];
  const events: SuiteEvent[] = [];

  /** Weakest-first ordering for the maxLines cap: swept before active, fewest touches, oldest. */
  function weakestFirst(a: Cluster, b: Cluster): number {
    const as = a.grabAt >= 0 ? 0 : 1;
    const bs = b.grabAt >= 0 ? 0 : 1;
    if (as !== bs) return as - bs;
    if (a.touches !== b.touches) return a.touches - b.touches;
    return a.createdAt - b.createdAt;
  }

  for (let i = 0; i < n; i++) {
    const b = bars[i];
    const ok = validBar(b);
    const a = atr[i];

    // ---- 1) advance every drawable line with this bar (bars ≤ i only) -------------------
    if (ok && lines.length) {
      for (let k = 0; k < lines.length; k++) {
        const ln = lines[k];
        if (ln.dead || i <= ln.createdAt) continue;

        if (ln.grabAt >= 0) {
          if (i - ln.grabAt >= SWEPT_LINGER) ln.dead = true;
          continue;
        }

        const high = ln.kind === "high";
        // Acceptance beyond the level (a close through it) mitigates the pool outright.
        const accepted = high ? b.c > ln.level : b.c < ln.level;
        if (accepted) {
          ln.dead = true;
          const exc = a > 0 ? Math.abs(b.c - ln.level) / a : 0;
          events.push({
            type: "liq_cross",
            dir: high ? "bull" : "bear",
            i,
            p: ln.level,
            strength: clamp(Math.round(exc * 33), 0, 100),
            label: zh
              ? `${high ? "等高" : "等低"}流动性被突破 · ${fmtPrice(ln.level)}`
              : `${high ? "EQH" : "EQL"} liquidity crossed · ${fmtPrice(ln.level)}`,
          });
          continue;
        }

        if (!grabs || !(a > 0)) continue;
        const excess = high ? b.h - ln.level : ln.level - b.l;
        if (excess >= grabSens * a) {
          const mult = excess / a;
          ln.grabAt = i;
          ln.grabExcess = mult;
          events.push({
            type: "liq_grab",
            dir: high ? "bear" : "bull",
            i,
            p: ln.level,
            strength: clamp(Math.round(mult * 33), 0, 100),
            label: zh
              ? `${high ? "上方" : "下方"}流动性猎取 · ${mult.toFixed(2)}× ATR`
              : `${high ? "Buyside" : "Sellside"} liquidity grab · ${mult.toFixed(2)}× ATR`,
          });
        }
      }
      if (lines.some((l) => l.dead)) lines = lines.filter((l) => !l.dead);
    }

    // ---- 2) ingest every pivot that becomes knowable on this bar ------------------------
    if (pc < pivots.length && pivots[pc].confirmedAt === i) {
      // drop stale single-touch clusters before matching (bounded memory, bounded scan)
      if (pending.length) pending = pending.filter((c) => i - c.lastTouchI <= CLUSTER_WINDOW);

      while (pc < pivots.length && pivots[pc].confirmedAt === i) {
        const pv = pivots[pc++];
        if (!Number.isFinite(pv.p)) continue;

        if (bubblesOn) {
          const pct = volPercentile(bars, pv.i);
          if (pct >= bubbleThreshold) {
            bubbles.push({ i: pv.i, p: pv.p, size: bubbleSize(pct), kind: pv.kind, pct });
          }
        }

        const tol = a > 0 ? tolerance * a : 0;
        let best: Cluster | null = null;
        let bestD = Infinity;
        for (const pool of [lines, pending]) {
          for (const c of pool) {
            if (c.dead || c.kind !== pv.kind || c.grabAt >= 0) continue;
            if (i - c.lastTouchI > CLUSTER_WINDOW) continue;
            const d = Math.abs(pv.p - c.level);
            if (d <= tol && d < bestD) {
              bestD = d;
              best = c;
            }
          }
        }

        if (best) {
          best.touches++;
          best.lastTouchI = pv.i;
          if (best.createdAt < 0 && best.touches >= minTouches) {
            // The pivot's right window means the cluster only becomes knowable `PIVOT_WING` bars
            // after its last touch — and price may already have ACCEPTED through the level inside
            // that confirmation lag. Publishing anyway prints create→cross on consecutive bars.
            // Re-anchor the cluster on the latest pivot instead: the pool has to rebuild.
            let mitigated = false;
            for (let k = best.lastTouchI + 1; k <= i; k++) {
              const bb = bars[k];
              if (!validBar(bb)) continue;
              if (best.kind === "high" ? bb.c > best.level : bb.c < best.level) {
                mitigated = true;
                break;
              }
            }
            if (mitigated) {
              best.touches = 1;
              best.anchorI = pv.i;
              best.level = pv.p;
              best.id = `${pv.kind === "high" ? "h" : "l"}${pv.i}`;
              continue;
            }
            best.createdAt = i;
            pending = pending.filter((c) => c !== best);
            lines.push(best);
            events.push({
              type: "liq_created",
              dir: best.kind === "high" ? "bear" : "bull",
              i,
              p: best.level,
              strength: clamp(best.touches * 25, 0, 100),
              label: zh
                ? `${best.kind === "high" ? "等高" : "等低"}流动性 ×${best.touches} · ${fmtPrice(best.level)}`
                : `${best.kind === "high" ? "EQH" : "EQL"} liquidity ×${best.touches} · ${fmtPrice(best.level)}`,
            });
          }
          continue;
        }

        const fresh: Cluster = {
          id: `${pv.kind === "high" ? "h" : "l"}${pv.i}`,
          kind: pv.kind,
          level: pv.p,
          anchorI: pv.i,
          touches: 1,
          lastTouchI: pv.i,
          createdAt: -1,
          grabAt: -1,
          grabExcess: 0,
          dead: false,
        };
        pending.push(fresh);
        if (pending.length > PENDING_MAX) pending = pending.slice(pending.length - PENDING_MAX);
      }

      // ---- 3) simultaneous-line cap: drop the weakest (fewest touches, then oldest) -----
      if (lines.length > maxLines) {
        const drop = lines.slice().sort(weakestFirst).slice(0, lines.length - maxLines);
        const cut = new Set(drop);
        lines = lines.filter((l) => !cut.has(l));
      }
    }
  }

  // ------------------------------------------------------------------------------ render
  const prims: Prim[] = [];
  const tooltips: TooltipDef[] = [];
  const last = n - 1;

  const L = {
    level: zh ? "价位" : "Level",
    touches: zh ? "触及" : "Touches",
    age: zh ? "存续" : "Age",
    bars: zh ? "根K线" : "bars",
    state: zh ? "状态" : "State",
    active: zh ? "有效" : "Resting",
    swept: zh ? "已猎取" : "Swept",
    sweep: zh ? "猎取幅度" : "Sweep",
    eqh: zh ? "等高流动性" : "Equal Highs (buyside)",
    eql: zh ? "等低流动性" : "Equal Lows (sellside)",
    vol: zh ? "成交量分位" : "Volume %ile",
  };

  const shown = lines
    .filter((l) => !l.dead && l.createdAt >= 0)
    .sort((x, y) => x.createdAt - y.createdAt)
    .slice(-showLast);

  for (const ln of shown) {
    const high = ln.kind === "high";
    const swept = ln.grabAt >= 0;
    const age = last - ln.createdAt;
    const tipId = `liq-${ln.id}`;

    // heat tier — discrete, never interpolated
    let col = colors.neutral;
    let ageAlpha = 1;
    if (heatLines) {
      if (age < HEAT_FRESH_BARS) {
        col = colors.brand;
      } else if (age < HEAT_MID_BARS) {
        col = colors.warn;
        ageAlpha = HEAT_MID_ALPHA;
      } else {
        col = colors.warn;
      }
    }

    const alpha = swept ? SWEPT_ALPHA : clamp(touchAlpha(ln.touches) * ageAlpha, 0.15, 1);
    const width = ln.touches >= 4 && !swept ? 2 : 1;
    // a swept line stops at the sweeping wick (vendor anatomy); a live one runs to the edge
    const endRef: XRef = swept ? Math.min(ln.grabAt, last) : "right";

    const line: LinePrim = {
      kind: "line",
      id: `${tipId}-l`,
      z: 0,
      a: { i: ln.anchorI, p: ln.level },
      b: { i: endRef, p: ln.level },
      color: col,
      w: width,
      alpha,
    };
    if (swept) line.dash = SWEPT_DASH;
    prims.push(line);

    // right-edge chip: "EQH ×3"
    const chip: LabelPrim = {
      kind: "label",
      id: `${tipId}-c`,
      z: 2,
      i: endRef,
      p: ln.level,
      text: `${high ? "EQH" : "EQL"} ×${ln.touches}`,
      place: "left",
      style: "chip",
      color: colors.muted,
      fs: CHIP_FS,
      minPxPerBar: CHIP_MIN_PX_PER_BAR,
      tooltipId: tipId,
    };
    prims.push(chip);

    // sweep glyph — EQH: ▼ above the sweep bar; EQL: ▲ below it
    if (swept) {
      const gb = bars[ln.grabAt];
      const off = (atr[ln.grabAt] > 0 ? atr[ln.grabAt] : Math.abs(ln.level) * 0.001) * MARKER_OFFSET_ATR;
      const m: MarkerPrim = {
        kind: "marker",
        id: `${tipId}-g`,
        z: 3,
        i: ln.grabAt,
        p: high ? gb.h + off : gb.l - off,
        shape: high ? "tri-down" : "tri-up",
        size: MARKER_SIZE,
        fill: high ? colors.down : colors.up,
        alpha: MARKER_ALPHA,
        tooltipId: tipId,
      };
      prims.push(m);
    }

    const rows: TooltipDef["rows"] = [
      { k: L.level, v: fmtPrice(ln.level) },
      { k: L.touches, v: `${ln.touches}` },
      { k: L.age, v: `${age} ${L.bars}` },
      { k: L.state, v: swept ? L.swept : L.active },
    ];
    if (swept) rows.push({ k: L.sweep, v: `${ln.grabExcess.toFixed(2)}× ATR` });
    tooltips.push({
      id: tipId,
      title: high ? L.eqh : L.eql,
      accent: swept ? (high ? colors.down : colors.up) : col,
      rows,
    });
  }

  // ------------------------------------------------------------------------------ bubbles
  if (bubblesOn && bubbles.length) {
    const shownBubbles = bubbles.slice(-MAX_BUBBLES);
    for (const bu of shownBubbles) {
      const tipId = `liqb-${bu.kind === "high" ? "h" : "l"}${bu.i}`;
      prims.push({
        kind: "marker",
        id: tipId,
        z: 1,
        i: bu.i,
        p: bu.p,
        shape: "circle",
        size: bu.size,
        fill: bu.kind === "high" ? colors.down : colors.up,
        alpha: BUBBLE_ALPHA,
        minPxPerBar: BUBBLE_MIN_PX_PER_BAR,
        tooltipId: tipId,
      } as MarkerPrim);
      tooltips.push({
        id: tipId,
        title: bu.kind === "high" ? L.eqh : L.eql,
        accent: bu.kind === "high" ? colors.down : colors.up,
        rows: [
          { k: L.level, v: fmtPrice(bu.p) },
          { k: L.vol, v: `${Math.round(bu.pct)}%` },
        ],
      });
    }
  }

  const tape = events.length > MAX_EVENTS ? events.slice(events.length - MAX_EVENTS) : events;
  return { prims, tooltips, events: tape };
}

// --------------------------------------------------------------------------------- module def

export const LIQUIDITY_MODULE: SuiteModuleDef = { ...LIQUIDITY_META, compute };

export default LIQUIDITY_MODULE;
