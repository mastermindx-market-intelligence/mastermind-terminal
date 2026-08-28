// Volume Mapping — Pulse Oscillator module (aggressor-side volume rail).
//
// Contract: lib/indicator-canvas/types.ts (frozen). Visual spec: docs/
// PREMIUM_INDICATOR_VISUAL_DESIGN_BIBLE_2026-07-28.md §"Volume Mapping — visual spec".
// Algorithm sketch: docs/PREMIUM_INDICATOR_SUITE_MASTERPLAN_2026-07-28.md §8.3.
//
// A pane suite: every price value below is a PULSE PANE coordinate (pane range -110..110), never a
// price. The rail is pinned to the bottom of the pane so the wave, its signals and the money-flow
// lines all live above it:
//
//   frac(i)  = volume(i) / max(volume over the trailing `window` bars, current bar included)
//   column   = [-108, -108 + frac × 26]                       (baseline -108, full height at frac 1)
//   color    = candle-geometry dominance of THIS bar:
//              buyFrac = clamp((c - l) / (h - l))  ≥ .58 ⇒ flowBuy, ≤ .42 ⇒ flowSell, else muted
//
// The vendor's rail is uniform-height and two-state; we keep the two-state hue (aggressor tokens,
// which never flip under html[data-updown="east"]) and add the height = relative volume improvement
// their doc suggests, capped so it can never reach the wave's trough lane.
//
// The tape is a 5-bar volume-weighted buy share with a .55/.45 hysteresis band: "vmap_flip" fires
// when that side actually changes, at most once per 5 bars.
//
// Non-repaint: the trailing maximum, the geometry split and the 5-bar state machine all read bars
// ≤ i only, so appending bars can never edit a column or an event already emitted. Pure — no wall
// clock, randomness or module state.

import type {
  ColumnsPrim,
  ModuleCtx,
  ModuleResult,
  Prim,
  SuiteBar,
  SuiteEvent,
  SuiteField,
  SuiteModuleDef,
} from "@/lib/indicator-canvas/types";
import { VOLUME_MAPPING_META } from "./volumeMapping.meta";

// ------------------------------------------------------------------------------------ constants

const BASE = -108; // rail baseline in pane units (pane is -110..110)
const RAIL_H = 26; // column height at frac = 1 ⇒ top of a full column is -82
const COL_ALPHA = 0.55; // ambient rail: it frames the pane, it must not compete with the wave
const WIDTH_FRAC = 0.6; // bar width as a fraction of bar spacing (Bible: ≈ candle width × 0.6)

const DOM_HI = 0.58; // per-bar geometry split: close in the top 42% of the range ⇒ buy-dominant
const DOM_LO = 0.42;
const DOM_WIN = 5; // bars in the dominance state machine
const DOM_ON = 0.55; // 5-bar weighted buy share needed to claim the buy side …
const DOM_OFF = 0.45; // … and to claim the sell side (hysteresis band in between)
const FLIP_COOLDOWN = 5; // bars between two emitted flips
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

// -------------------------------------------------------------------------------------- compute

function compute(ctx: ModuleCtx): ModuleResult {
  const { bars, colors, lang } = ctx;
  const n = bars.length;
  const empty: ModuleResult = { prims: [], events: [] };
  if (n < 2) return empty;

  const s = ctx.s || {};
  const win = Math.round(numOpt(s.window, 100, 50, 400));
  const zh = lang === "zh";

  // ---- 1) per-bar volume + candle-geometry split ---------------------------------------
  const vols = new Float64Array(n); // 0 on missing bars (0 volume = no column, not a print)
  const bfA = new Float64Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    const b = bars[i];
    if (!validBar(b)) continue;
    vols[i] = Number.isFinite(b.v) && b.v > 0 ? b.v : 0;
    bfA[i] = b.h > b.l ? clamp((b.c - b.l) / (b.h - b.l), 0, 1) : 0.5;
  }

  // ---- 2) single pass: rolling max (monotonic deque), columns, dominance tape -----------
  const items: ColumnsPrim["items"] = [];
  const events: SuiteEvent[] = [];

  const dq = new Int32Array(n); // indices, volumes strictly decreasing from head
  let head = 0;
  let tail = 0;

  const ringV = new Float64Array(DOM_WIN);
  const ringB = new Float64Array(DOM_WIN);
  const ringF = new Float64Array(DOM_WIN);
  let ringN = 0;
  let ringPos = 0;
  let side = 0; // -1 sell-dominant, 0 undecided, +1 buy-dominant
  let lastFlip = -1e9;

  for (let i = 0; i < n; i++) {
    const v = vols[i];
    while (tail > head && vols[dq[tail - 1]] <= v) tail--;
    dq[tail++] = i;
    while (dq[head] <= i - win) head++;
    const maxV = vols[dq[head]];

    const bf = bfA[i];
    if (!Number.isFinite(bf)) continue; // missing bar: no column and no state update

    const frac = maxV > 0 ? clamp(v / maxV, 0, 1) : 0;
    if (frac > 0) {
      items.push({
        i,
        v: BASE + frac * RAIL_H,
        color: bf >= DOM_HI ? colors.flowBuy : bf <= DOM_LO ? colors.flowSell : colors.muted,
        alpha: COL_ALPHA,
      });
    }

    ringV[ringPos] = v;
    ringB[ringPos] = bf;
    ringF[ringPos] = frac;
    ringPos = (ringPos + 1) % DOM_WIN;
    if (ringN < DOM_WIN) {
      ringN++;
      continue; // warm-up: no dominance side yet
    }

    let sumV = 0;
    let sumBV = 0;
    let sumB = 0;
    let sumF = 0;
    for (let k = 0; k < DOM_WIN; k++) {
      sumV += ringV[k];
      sumBV += ringV[k] * ringB[k];
      sumB += ringB[k];
      sumF += ringF[k];
    }
    // volume-weighted share, degrading to a plain average when the window carries no volume
    const share = sumV > 0 ? sumBV / sumV : sumB / DOM_WIN;
    const next = share >= DOM_ON ? 1 : share <= DOM_OFF ? -1 : side;

    if (next !== side) {
      if (side === 0) {
        side = next; // bootstrap: adopt the first decided side without publishing a flip
      } else if (i - lastFlip >= FLIP_COOLDOWN) {
        // .55 → 0, .70 → full: how lopsided the window is, plus how heavy it traded
        const domScore = clamp((Math.abs(share - 0.5) * 2 - 0.1) / 0.4, 0, 1);
        const volScore = clamp(sumF / DOM_WIN, 0, 1);
        const pct = Math.round(share * 100);
        events.push({
          type: "vmap_flip",
          dir: next > 0 ? "bull" : "bear",
          i,
          p: (share - 0.5) * 200, // pane units: signed dominance, -100..100
          strength: clamp(Math.round(60 * domScore + 40 * volScore), 0, 100),
          label: zh
            ? `${next > 0 ? "买盘主导" : "卖盘主导"} · 5根买入占比 ${pct}%`
            : `${next > 0 ? "Buy-side" : "Sell-side"} dominance · 5-bar buy share ${pct}%`,
        });
        lastFlip = i;
        side = next;
      }
      // Inside the cooldown the committed side is KEPT: a suppressed flip is published late rather
      // than swallowed, which is what keeps the tape strictly alternating (two "Buy-side dominance"
      // events with no sell-side event between them would misdescribe the state to an alert).
    }
  }

  if (!items.length) return empty;

  const prims: Prim[] = [
    {
      kind: "columns",
      id: "vmap-cols",
      z: 0,
      items,
      base: BASE,
      widthFrac: WIDTH_FRAC,
    } as ColumnsPrim,
  ];

  const tape = events.length > MAX_EVENTS ? events.slice(events.length - MAX_EVENTS) : events;
  return { prims, events: tape };
}

// ---------------------------------------------------------------------------------- module def

export const VOLUME_MAPPING_MODULE: SuiteModuleDef = { ...VOLUME_MAPPING_META, compute };

export default VOLUME_MAPPING_MODULE;
