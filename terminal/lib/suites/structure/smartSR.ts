// Smart S/R — Structure Core module (W4).
//
// Contract: lib/indicator-canvas/types.ts (frozen). Visual spec: docs/
// PREMIUM_INDICATOR_VISUAL_DESIGN_BIBLE_2026-07-28.md §"Support and Resistance — visual spec".
// Algorithm sketch: docs/PREMIUM_INDICATOR_SUITE_MASTERPLAN_2026-07-28.md §8.1 "Smart S/R".
//
// Confirmed pivots are clustered into horizontal price levels: a pivot joins a cluster when it sits
// within 0.3×ATR14 of the cluster's ANCHOR price, and the anchor is the FIRST pivot's extreme —
// frozen forever (liquidity.ts precedent). Later touches raise the count and the score but can never
// move the price, so drawn geometry and already-emitted events never change as bars arrive.
//
// Clustering is pivot-KIND-AGNOSTIC on purpose: a prior swing high and a prior swing low at the same
// price are the same level, and which side price happens to be on decides whether it currently reads
// as support or resistance (the vendor recolors the whole band on a break — same idea).
//
// Scoring: score = touches × mean forward reaction × recency decay.
//   * reaction = the 5-bar excursion away from the level after each touch, in ATR units. It is
//     written as (favorable − adverse), but note the adverse leg is STRUCTURALLY ZERO here: the
//     touch is a fractal pivot whose right wing (≥5 bars, see SENS_WING) already guarantees price
//     never traded past the extreme inside the window. The subtraction is kept because it is the
//     honest definition and it stays correct if the window/wing ratio ever changes.
//   * recency decay = 0.5 ^ (barsSinceLastTouch / 250) — a level nobody has visited in a year of
//     daily bars stops competing for the showLast slots.
//
// Non-repaint: every decision at bar i uses bars ≤ i only. Pivots enter the state machine on their
// `confirmedAt` bar, and the 5-bar reaction window is contained INSIDE that confirmation lag, so
// scoring never looks ahead of the bar that publishes it. Breaks and holds are close-based and
// evaluated bar-by-bar. The ONE repaint-exempt choice is documented at the render step: the
// support/resistance ROLE (line color + tooltip title) is resolved against the LAST bar's close.
// That is text and hue, never geometry — a level's price, width and touch count are all frozen.
//
// Pure: no wall clock, no randomness, no module-level mutable state.

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
  ZonePrim,
} from "@/lib/indicator-canvas/types";
import { findPivotsHL, type Pivot } from "./pivots";
import { SMART_SR_META } from "./smartSR.meta";

// ------------------------------------------------------------------------------------ constants

const ATR_LEN = 14;
const TOLERANCE_ATR = 0.3; // cluster join distance, in ATR14 at the ingest bar
const REACTION_WINDOW = 5; // bars of forward reaction measured after each touch
const REACTION_CAP = 5; // ATR multiples — one freak bar must not own the ranking
const HALF_LIFE_BARS = 250; // recency decay half-life
const BROKEN_LINGER = 20; // bars a broken level stays on the chart before it drops
const BROKEN_SCORE_MULT = 0.5; // a broken level competes at half weight for the showLast slots
const HOLD_COOLDOWN = 5; // bars between two sr_hold events on the same level
const BUFFER_ATR = 0.25; // buffer-zone half-height, frozen at the level's publication bar
const CLUSTER_WINDOW = 1000; // staleness bound for single-touch (not yet drawable) clusters
const PENDING_MAX = 96; // memory bound on the pending pool
const MAX_TRACKED = 48; // simultaneous tracked levels (weakest dropped first)
const MAX_EVENTS = 80; // recency cap on the emitted event tape

/** Sensitivity → fractal wing. Higher sensitivity = shorter wing = more, finer levels. */
const SENS_WING: Record<string, number> = { high: 5, medium: 8, low: 12 };

const LINE_ALPHA_BASE = 0.5;
const LINE_ALPHA_SPAN = 0.45; // → 0.95 at the strongest kept level
const BROKEN_ALPHA = 0.3;
const BROKEN_DASH = "4 3";
const BUFFER_ALPHA = 0.05;
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

function selOpt<T extends string>(v: any, d: T, allowed: readonly T[]): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : d;
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

/**
 * Forward reaction of one touch, in ATR units: how hard price left the level over the next
 * REACTION_WINDOW bars, minus how far it kept pushing through. Both legs are read from bars that
 * are already inside the pivot's own confirmation lag (wing ≥ REACTION_WINDOW), so this never
 * looks ahead of the bar that ingests the pivot.
 */
function reactionATR(
  bars: SuiteBar[],
  atr: number[],
  t: number,
  kind: "high" | "low",
  level: number,
): number {
  const a = atr[t];
  if (!(a > 0)) return 0;
  const end = Math.min(t + REACTION_WINDOW, bars.length - 1);
  let hi = -Infinity;
  let lo = Infinity;
  for (let k = t + 1; k <= end; k++) {
    const b = bars[k];
    if (!validBar(b)) continue;
    if (b.h > hi) hi = b.h;
    if (b.l < lo) lo = b.l;
  }
  if (!Number.isFinite(hi) || !Number.isFinite(lo)) return 0;
  const fav = kind === "low" ? hi - level : level - lo;
  const adv = kind === "low" ? Math.max(0, level - lo) : Math.max(0, hi - level);
  return clamp((fav - adv) / a, 0, REACTION_CAP);
}

// -------------------------------------------------------------------------------- level state

interface Level {
  id: string;
  level: number; // FROZEN at the anchor pivot — later touches never move it
  anchorI: number; // bar index of the first pivot in the cluster
  touches: number; // clustered pivots
  reactSum: number; // Σ reactionATR over the touches
  lastTouchI: number; // bar index of the most recent clustered pivot
  createdAt: number; // bar where the cluster reached minTouches (-1 while pending)
  side: 1 | -1; // +1 price above (support), -1 price below (resistance) — set at publication
  atrAtCreate: number; // frozen buffer half-height source
  holds: number;
  lastHold: number;
  brokenAt: number; // bar of the close-through (-1 until broken)
  dead: boolean;
}

function meanReaction(lv: Level): number {
  return lv.touches > 0 ? lv.reactSum / lv.touches : 0;
}

// ------------------------------------------------------------------------------------- compute

function compute(ctx: ModuleCtx): ModuleResult {
  const { bars, colors, lang } = ctx;
  const n = bars.length;
  const empty: ModuleResult = { prims: [], tooltips: [], events: [] };
  if (n < 3) return empty;

  const s = ctx.s || {};
  const sensitivity = selOpt(s.sensitivity, "medium" as const, ["high", "medium", "low"] as const);
  const minTouches = Math.round(numOpt(s.minTouches, 2, 2, 5));
  const showLast = Math.round(numOpt(s.showLast, 6, 2, 12));
  const bufferZone = boolOpt(s.bufferZone, false);
  const labels = boolOpt(s.labels, true);
  const zh = lang === "zh";

  const wingLen = SENS_WING[sensitivity] ?? SENS_WING.medium;
  if (n < wingLen * 2 + 2) return empty;

  const atr = atrSeries(bars, ATR_LEN);
  const pivots: Pivot[] = findPivotsHL(bars, wingLen, wingLen, "wick");
  // findPivotsHL emits pivots ordered by bar index, so confirmedAt (= i + wing) is monotone too:
  // one cursor walks the list in lockstep with the bar loop.
  let pc = 0;

  let pending: Level[] = []; // fewer than minTouches touches — tracked, never drawn
  let levels: Level[] = []; // drawable levels (live or broken-lingering)
  const events: SuiteEvent[] = [];

  /** Weakest-first ordering for the MAX_TRACKED cap: broken before live, fewest touches, oldest. */
  function weakestFirst(a: Level, b: Level): number {
    const ab = a.brokenAt >= 0 ? 0 : 1;
    const bb = b.brokenAt >= 0 ? 0 : 1;
    if (ab !== bb) return ab - bb;
    if (a.touches !== b.touches) return a.touches - b.touches;
    return a.lastTouchI - b.lastTouchI;
  }

  for (let i = 0; i < n; i++) {
    const b = bars[i];
    const ok = validBar(b);
    const a = atr[i];

    // ---- 1) advance every drawable level with this bar (bars ≤ i only) -------------------
    if (ok && levels.length) {
      for (let k = 0; k < levels.length; k++) {
        const lv = levels[k];
        if (lv.dead || i <= lv.createdAt) continue;

        if (lv.brokenAt >= 0) {
          if (i - lv.brokenAt >= BROKEN_LINGER) lv.dead = true;
          continue;
        }

        const sup = lv.side > 0;
        // BREAK: a CLOSE through the level against the side price has been holding.
        if (sup ? b.c < lv.level : b.c > lv.level) {
          lv.brokenAt = i;
          const exc = a > 0 ? Math.abs(b.c - lv.level) / a : 0;
          events.push({
            type: "sr_break",
            dir: sup ? "bear" : "bull",
            i,
            p: lv.level,
            strength: clamp(Math.round(exc * 50), 0, 100),
            label: zh
              ? `${sup ? "支撑" : "阻力"}被跌破 · ${fmtPrice(lv.level)} ×${lv.touches}`
              : `${sup ? "Support" : "Resistance"} broken · ${fmtPrice(lv.level)} ×${lv.touches}`,
          });
          continue;
        }

        // HOLD: the bar's range tags the level and the close stays on the holding side.
        const tagged = sup ? b.l <= lv.level : b.h >= lv.level;
        if (tagged && i - lv.lastHold >= HOLD_COOLDOWN) {
          lv.lastHold = i;
          lv.holds++;
          events.push({
            type: "sr_hold",
            dir: sup ? "bull" : "bear",
            i,
            p: lv.level,
            strength: clamp(Math.round(lv.touches * 20 + Math.min(meanReaction(lv), 3) * 10), 0, 100),
            label: zh
              ? `${sup ? "支撑" : "阻力"}守住 · ${fmtPrice(lv.level)} ×${lv.touches}`
              : `${sup ? "Support" : "Resistance"} held · ${fmtPrice(lv.level)} ×${lv.touches}`,
          });
        }
      }
      if (levels.some((l) => l.dead)) levels = levels.filter((l) => !l.dead);
    }

    // ---- 2) ingest every pivot that becomes knowable on this bar ------------------------
    if (pc < pivots.length && pivots[pc].confirmedAt === i) {
      // drop stale single-touch clusters before matching (bounded memory, bounded scan)
      if (pending.length) pending = pending.filter((c) => i - c.lastTouchI <= CLUSTER_WINDOW);

      while (pc < pivots.length && pivots[pc].confirmedAt === i) {
        const pv = pivots[pc++];
        if (!Number.isFinite(pv.p) || !ok) continue;

        const tol = a > 0 ? TOLERANCE_ATR * a : 0;
        let best: Level | null = null;
        let bestD = Infinity;
        for (const pool of [levels, pending]) {
          for (const c of pool) {
            // A broken level is spent: it may not absorb new touches, it only fades out.
            if (c.dead || c.brokenAt >= 0) continue;
            if (c.lastTouchI === pv.i) continue; // one bar can be both a pivot high and low
            const d = Math.abs(pv.p - c.level);
            if (d <= tol && d < bestD) {
              bestD = d;
              best = c;
            }
          }
        }

        const react = reactionATR(bars, atr, pv.i, pv.kind, best ? best.level : pv.p);

        if (best) {
          best.touches++;
          best.reactSum += react;
          best.lastTouchI = pv.i;
          if (best.createdAt < 0 && best.touches >= minTouches) {
            // Publication. The side is read from THIS bar's close, not the anchor's: price may have
            // crossed the level during the pivot's confirmation lag, and publishing with a stale
            // side would print create→break on consecutive bars for a level nobody was defending.
            best.createdAt = i;
            best.side = b.c >= best.level ? 1 : -1;
            best.atrAtCreate = a > 0 ? a : 0;
            pending = pending.filter((c) => c !== best);
            levels.push(best);
          }
          continue;
        }

        const fresh: Level = {
          id: `${pv.kind === "high" ? "h" : "l"}${pv.i}`,
          level: pv.p,
          anchorI: pv.i,
          touches: 1,
          reactSum: react,
          lastTouchI: pv.i,
          createdAt: -1,
          side: 1,
          atrAtCreate: 0,
          holds: 0,
          lastHold: -HOLD_COOLDOWN * 4,
          brokenAt: -1,
          dead: false,
        };
        if (minTouches <= 1) {
          // defensive: the field clamps to ≥2, but never let a one-touch cluster skip publication
          fresh.createdAt = i;
          fresh.side = b.c >= fresh.level ? 1 : -1;
          fresh.atrAtCreate = a > 0 ? a : 0;
          levels.push(fresh);
        } else {
          pending.push(fresh);
          if (pending.length > PENDING_MAX) pending = pending.slice(pending.length - PENDING_MAX);
        }
      }

      // ---- 3) tracked-level cap: drop the weakest (broken, then fewest touches, then oldest) ---
      if (levels.length > MAX_TRACKED) {
        const drop = levels.slice().sort(weakestFirst).slice(0, levels.length - MAX_TRACKED);
        const cut = new Set(drop);
        levels = levels.filter((l) => !cut.has(l));
      }
    }
  }

  // ------------------------------------------------------------------------------ render
  const prims: Prim[] = [];
  const tooltips: TooltipDef[] = [];
  const last = n - 1;

  // Reference close for the ROLE decision. This is the ONE repaint-exempt styling choice in the
  // module: a level below the last close reads as support (colors.up), above it as resistance
  // (colors.down), exactly as the vendor recolors a whole band once price closes past it. Role is
  // hue + tooltip title only — the level price, width, touch count and event tape are all frozen.
  let px = NaN;
  for (let i = last; i >= 0; i--) {
    if (validBar(bars[i])) {
      px = bars[i].c;
      break;
    }
  }
  if (!Number.isFinite(px)) return { prims, tooltips, events: [] };

  const scored = levels
    .filter((l) => !l.dead && l.createdAt >= 0)
    .map((lv) => {
      const decay = Math.pow(0.5, (last - lv.lastTouchI) / HALF_LIFE_BARS);
      const raw = lv.touches * meanReaction(lv) * decay;
      return { lv, raw, rank: lv.brokenAt >= 0 ? raw * BROKEN_SCORE_MULT : raw };
    })
    .sort((x, y) => {
      if (y.rank !== x.rank) return y.rank - x.rank;
      if (y.lv.touches !== x.lv.touches) return y.lv.touches - x.lv.touches;
      return y.lv.lastTouchI - x.lv.lastTouchI;
    });
  // Proximity dedupe at PUBLISH time: cluster tolerance is ATR-at-ingest while anchors are frozen,
  // so a volatility expansion can leave two levels far inside one CURRENT tolerance — draw only the
  // strongest per price area (0.6×ATR at the last bar), the rest keep scoring silently (W4 review).
  const dedupeTol = 0.6 * (Number.isFinite(atr[last]) && atr[last] > 0 ? atr[last] : 0);
  const kept: typeof scored = [];
  for (const e of scored) {
    if (dedupeTol > 0 && kept.some((k) => Math.abs(k.lv.level - e.lv.level) <= dedupeTol)) continue;
    kept.push(e);
    if (kept.length >= showLast) break;
  }
  const published = kept;

  let maxRank = 0;
  for (const e of published) if (e.rank > maxRank) maxRank = e.rank;

  const L = {
    support: zh ? "支撑" : "Support",
    resistance: zh ? "阻力" : "Resistance",
    level: zh ? "价位" : "Level",
    touches: zh ? "触及" : "Touches",
    react: zh ? "平均反应" : "Reaction",
    holds: zh ? "守住次数" : "Holds",
    age: zh ? "存续" : "Age",
    bars: zh ? "根K线" : "bars",
    state: zh ? "状态" : "State",
    holding: zh ? "有效" : "Holding",
    broken: zh ? "已跌破" : "Broken",
    brokenSuffix: zh ? " · 已跌破" : " · broken",
  };

  for (const { lv, rank } of published) {
    const broken = lv.brokenAt >= 0;
    const support = lv.level < px;
    const col = support ? colors.up : colors.down;
    const tipId = `sr-${lv.id}`;
    const strength = maxRank > 0 ? clamp(rank / maxRank, 0, 1) : 0;
    const alpha = broken ? BROKEN_ALPHA : LINE_ALPHA_BASE + LINE_ALPHA_SPAN * strength;
    const width = 1 + Math.min(2, lv.touches * 0.4);

    if (bufferZone && lv.atrAtCreate > 0) {
      const half = BUFFER_ATR * lv.atrAtCreate;
      const band: ZonePrim = {
        kind: "zone",
        id: `${tipId}-b`,
        z: 0,
        i1: lv.anchorI,
        i2: "right",
        p1: lv.level - half,
        p2: lv.level + half,
        fill: col,
        fillAlpha: BUFFER_ALPHA,
      };
      prims.push(band);
    }

    const line: LinePrim = {
      kind: "line",
      id: `${tipId}-l`,
      z: 1,
      a: { i: lv.anchorI, p: lv.level },
      b: { i: "right", p: lv.level },
      color: col,
      w: width,
      alpha,
    };
    if (broken) line.dash = BROKEN_DASH;
    prims.push(line);

    if (labels) {
      const chip: LabelPrim = {
        kind: "label",
        id: `${tipId}-c`,
        z: 2,
        i: "right",
        p: lv.level,
        text: `${fmtPrice(lv.level)} ×${lv.touches}`,
        place: "left",
        style: "chip",
        color: colors.muted,
        fs: CHIP_FS,
        minPxPerBar: CHIP_MIN_PX_PER_BAR,
        tooltipId: tipId,
      };
      prims.push(chip);

      const rows: TooltipDef["rows"] = [
        { k: L.level, v: fmtPrice(lv.level) },
        { k: L.touches, v: `×${lv.touches}` },
        { k: L.react, v: `${meanReaction(lv).toFixed(2)}× ATR` },
        { k: L.age, v: `${last - lv.anchorI} ${L.bars}` },
        { k: L.state, v: broken ? L.broken : L.holding, color: broken ? colors.muted : col },
      ];
      if (lv.holds > 0) rows.splice(3, 0, { k: L.holds, v: `${lv.holds}` });
      tooltips.push({
        id: tipId,
        title: (support ? L.support : L.resistance) + (broken ? L.brokenSuffix : ""),
        accent: col,
        rows,
      });
    }
  }

  const tape = events.length > MAX_EVENTS ? events.slice(events.length - MAX_EVENTS) : events;
  return { prims, tooltips, events: tape };
}

// --------------------------------------------------------------------------------- module def

export const SMART_SR_MODULE: SuiteModuleDef = { ...SMART_SR_META, compute };

export default SMART_SR_MODULE;
