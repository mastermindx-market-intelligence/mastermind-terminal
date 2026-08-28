// Fair Value Gap (FVG) — Structure Core module.
//
// Contract: lib/indicator-canvas/types.ts (frozen). Visual spec: docs/
// PREMIUM_INDICATOR_VISUAL_DESIGN_BIBLE_2026-07-28.md §"Fair Value Gap — visual spec".
// Algorithm sketch: docs/PREMIUM_INDICATOR_SUITE_MASTERPLAN_2026-07-28.md §8.1.
//
// A fair value gap is the 3-candle imbalance where the middle candle's range is never traded:
// bullish  low[j] > high[j-2]   → zone [high[j-2], low[j]]
// bearish  high[j] < low[j-2]   → zone [high[j], low[j-2]]
// The zone is anchored at bar j-1 (the imbalance candle) and extends right.
//
// Non-repaint: a gap only exists once bar j has closed, and every state (fill %, inversion,
// retests) at bar n is derived from bars ≤ n in a single forward pass. Pure — no wall clock,
// no randomness, no module-level mutable state.

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
  ZonePrim,
} from "@/lib/indicator-canvas/types";
import { FVG_META } from "./fvg.meta";

// ------------------------------------------------------------------------------------ constants

const ATR_LEN = 14;
const LIMITED_EXTEND_BARS = 20; // "limited" extension = 20 bars past creation
const OVERLAP_HIDE_FRAC = 0.6; // a new zone ≥60% covered by a live same-side zone is dropped
const RETEST_COOLDOWN = 5; // bars between two retest events of the same zone
// A fully-filled zone leaves the ACTIVE set immediately (it stops rendering and stops counting
// toward showLast) but, with iFvg on, stays tracked this many bars so a body close-through can
// still flip it. Without the grace, inversion is unreachable: a body fully beyond the far edge
// needs open beyond it too, and by then the fill already completed on an earlier bar.
const INVERSION_WINDOW = 20;
const MAX_RETESTS_PER_ZONE = 3; // keep only the most recent retest markers
const MAX_LIVE_ZONES = 120; // perf guard: showLast ≤ 20, oldest live zones can be dropped
const MAX_EVENTS = 80; // recency cap on the emitted event tape
const ZONE_ALPHA = 0.08;
const IFVG_ALPHA = 0.07;
const FILL_ALPHA = 0.14;
const MARKER_SIZE = 4;
const MARKER_ALPHA = 0.8;
const CHIP_FS = 9;
const CHIP_MIN_PX_PER_BAR = 3;

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

// ---------------------------------------------------------------------------------- zone state

interface Zone {
  id: string;
  dir: 1 | -1; // +1 bullish imbalance, -1 bearish
  i: number; // creation bar (j — the third candle)
  lo: number;
  hi: number;
  size: number;
  sizeATR: number;
  poc: number;
  watermark: number; // deepest penetration from the entry side
  filled: number; // 0..1, monotonic
  filledAt: number; // bar index where filled first reached 1, or -1
  invAt: number; // bar index of the body close-through, or -1
  invWatermark: number; // penetration from the flipped side, tracked after inversion
  invFilled: number; // 0..1 re-fill of the flipped zone
  dead: boolean;
  retests: Array<{ i: number; fresh: number }>;
  lastRetest: number;
}

/** Rendered (and showLast-counted) zones: still open, or flipped into an iFVG. */
function isActive(z: Zone): boolean {
  return !z.dead && (z.invAt >= 0 || z.filled < 1);
}

// ---------------------------------------------------------------------------------- compute

function compute(ctx: ModuleCtx): ModuleResult {
  const { bars, colors, lang } = ctx;
  const n = bars.length;
  const empty: ModuleResult = { prims: [], tooltips: [], events: [] };
  if (n < 3) return empty;

  const s = ctx.s || {};
  const thresholdATR = numOpt(s.thresholdATR, 0.25, 0, 1);
  const showLast = Math.round(numOpt(s.showLast, 8, 2, 20));
  const type = selOpt(s.type, "all" as const, ["all", "bull", "bear"] as const);
  const showPoc = selOpt(s.showPoc, "highestVolume" as const, ["off", "highestVolume", "mean"] as const);
  const iFvg = boolOpt(s.iFvg, true);
  const hideOverlap = boolOpt(s.hideOverlap, true);
  const signals = selOpt(s.signals, "created" as const, ["off", "created", "retest", "both"] as const);
  const extend = selOpt(s.extend, "right" as const, ["right", "limited"] as const);

  const wantCreated = signals === "created" || signals === "both";
  const wantRetest = signals === "retest" || signals === "both";
  const zh = lang === "zh";

  const atr = atrSeries(bars, ATR_LEN);
  let live: Zone[] = [];
  const events: SuiteEvent[] = [];

  for (let i = 0; i < n; i++) {
    const b = bars[i];
    const ok = validBar(b);

    // ---- 1) advance every live zone with this bar (bars ≤ i only) --------------------
    if (ok && live.length) {
      for (let k = 0; k < live.length; k++) {
        const z = live[k];
        if (z.dead || i <= z.i) continue;

        if (z.invAt >= 0) {
          // inverted: role flipped, track the re-fill from the opposite side
          if (z.dir > 0) {
            z.invWatermark = Math.max(z.invWatermark, b.h);
            z.invFilled = clamp((z.invWatermark - z.lo) / z.size, 0, 1);
            if (z.invWatermark >= z.hi) z.dead = true;
          } else {
            z.invWatermark = Math.min(z.invWatermark, b.l);
            z.invFilled = clamp((z.hi - z.invWatermark) / z.size, 0, 1);
            if (z.invWatermark <= z.lo) z.dead = true;
          }
        } else {
          // fill watermark: bullish gaps fill downward from the top, bearish upward
          if (z.dir > 0) {
            z.watermark = Math.min(z.watermark, b.l);
            z.filled = clamp((z.hi - z.watermark) / z.size, 0, 1);
          } else {
            z.watermark = Math.max(z.watermark, b.h);
            z.filled = clamp((z.watermark - z.lo) / z.size, 0, 1);
          }
          if (z.filled >= 1 && z.filledAt < 0) z.filledAt = i;

          // a full BODY beyond the far edge flips the zone's role
          const bodyLo = Math.min(b.o, b.c);
          const bodyHi = Math.max(b.o, b.c);
          const through = z.dir > 0 ? bodyHi < z.lo : bodyLo > z.hi;
          if (iFvg && through) {
            z.invAt = i;
            z.filled = 1;
            if (z.filledAt < 0) z.filledAt = i;
            z.invWatermark = z.dir > 0 ? z.lo : z.hi;
            z.invFilled = 0;
            events.push({
              type: "ifvg",
              dir: z.dir > 0 ? "bear" : "bull",
              i,
              p: z.dir > 0 ? z.lo : z.hi,
              strength: clamp(Math.round(z.sizeATR * 50), 0, 100),
              label: zh
                ? `FVG 反转 · ${z.sizeATR.toFixed(2)}× ATR`
                : `FVG inverted · ${z.sizeATR.toFixed(2)}× ATR`,
            });
          } else if (z.filled >= 1) {
            // fully traded through: leaves the active set at once; with iFvg on it stays
            // tracked (invisible) for a bounded window in case a body closes through.
            if (!iFvg || i - z.filledAt >= INVERSION_WINDOW) z.dead = true;
          }
        }

        if (!isActive(z)) continue;

        // retest of the in-gap POC (throttled per zone)
        if (b.l <= z.poc && b.h >= z.poc && i - z.lastRetest >= RETEST_COOLDOWN) {
          z.lastRetest = i;
          const bias = z.invAt >= 0 ? -z.dir : z.dir; // an iFVG retests the other way
          const fresh = clamp(Math.round((1 - (z.invAt >= 0 ? z.invFilled : z.filled)) * 100), 0, 100);
          z.retests.push({ i, fresh });
          if (z.retests.length > MAX_RETESTS_PER_ZONE) z.retests.shift();
          events.push({
            type: "fvg_retest",
            dir: bias > 0 ? "bull" : "bear",
            i,
            p: z.poc,
            strength: fresh,
            label: zh ? `FVG 回测 · ${fresh}% 未填` : `FVG retest · ${fresh}% unfilled`,
          });
        }
      }
      if (live.some((z) => z.dead)) live = live.filter((z) => !z.dead);
    }

    // ---- 2) detect a new gap closing on this bar -------------------------------------
    if (i < 2 || !ok) continue;
    const b0 = bars[i - 2];
    const b1 = bars[i - 1];
    if (!validBar(b0) || !validBar(b1)) continue;

    const a = atr[i];
    if (!(a > 0)) continue;

    let dir: 1 | -1 | 0 = 0;
    let lo = 0;
    let hi = 0;
    if (b.l > b0.h) {
      dir = 1;
      lo = b0.h;
      hi = b.l;
    } else if (b.h < b0.l) {
      dir = -1;
      lo = b.h;
      hi = b0.l;
    }
    if (dir === 0) continue;
    if (type === "bull" && dir !== 1) continue;
    if (type === "bear" && dir !== -1) continue;

    const size = hi - lo;
    if (!(size > 0) || size < thresholdATR * a) continue;

    // overlap suppression against still-open same-side zones
    if (hideOverlap) {
      let covered = false;
      for (let k = 0; k < live.length; k++) {
        const z = live[k];
        // same side as the new gap by CURRENT role (an inverted zone reads the other way)
        const bias = z.invAt >= 0 ? -z.dir : z.dir;
        if (bias !== dir || !isActive(z)) continue;
        const inter = Math.min(hi, z.hi) - Math.max(lo, z.lo);
        if (inter > 0 && inter / size >= OVERLAP_HIDE_FRAC) {
          covered = true;
          break;
        }
      }
      if (covered) continue;
    }

    // POC inside the gap, from the three formation bars
    let poc = (lo + hi) / 2;
    if (showPoc === "highestVolume") {
      let best = b0;
      let bestV = Number.isFinite(b0.v) ? b0.v : 0;
      for (const cand of [b1, b]) {
        const v = Number.isFinite(cand.v) ? cand.v : 0;
        if (v > bestV) {
          bestV = v;
          best = cand;
        }
      }
      poc = clamp((best.h + best.l + best.c) / 3, lo, hi);
    }

    const sizeATR = size / a;
    const z: Zone = {
      id: `${dir > 0 ? "b" : "s"}${i}`,
      dir,
      i,
      lo,
      hi,
      size,
      sizeATR,
      poc,
      watermark: dir > 0 ? hi : lo,
      filled: 0,
      filledAt: -1,
      invAt: -1,
      invWatermark: dir > 0 ? lo : hi,
      invFilled: 0,
      dead: false,
      retests: [],
      lastRetest: -RETEST_COOLDOWN * 4,
    };
    live.push(z);
    if (live.length > MAX_LIVE_ZONES) live = live.slice(live.length - MAX_LIVE_ZONES);

    events.push({
      type: "fvg_created",
      dir: dir > 0 ? "bull" : "bear",
      i,
      p: poc,
      strength: clamp(Math.round(sizeATR * 50), 0, 100),
      label: zh
        ? `${dir > 0 ? "看涨" : "看跌"} FVG · ${sizeATR.toFixed(2)}× ATR`
        : `${dir > 0 ? "Bullish" : "Bearish"} FVG · ${sizeATR.toFixed(2)}× ATR`,
    });
  }

  // ------------------------------------------------------------------------------ render
  const shown = live.filter(isActive).slice(-showLast);
  const prims: Prim[] = [];
  const tooltips: TooltipDef[] = [];
  const last = n - 1;

  const L = {
    size: zh ? "缺口" : "Size",
    filled: zh ? "已回补" : "Filled",
    reclaimed: zh ? "反向回补" : "Retraced",
    age: zh ? "存续" : "Age",
    bars: zh ? "根K线" : "bars",
    bull: zh ? "看涨 FVG" : "Bullish FVG",
    bear: zh ? "看跌 FVG" : "Bearish FVG",
    inv: zh ? " · 已反转" : " · inverted",
  };

  for (const z of shown) {
    const inverted = z.invAt >= 0;
    const bias: 1 | -1 = inverted ? ((z.dir * -1) as 1 | -1) : z.dir;
    const col = bias > 0 ? colors.up : colors.down;
    const anchor = z.i - 1;
    const extRef: XRef = extend === "limited" ? z.i + LIMITED_EXTEND_BARS : "right";
    const bandEnd = extend === "limited" ? Math.min(last, z.i + LIMITED_EXTEND_BARS) : last;
    const tipId = `fvg-${z.id}`;
    const mid = (z.lo + z.hi) / 2;

    // zone box
    const zone: ZonePrim = {
      kind: "zone",
      id: `${tipId}-z`,
      z: 0,
      i1: anchor,
      i2: extRef,
      p1: z.lo,
      p2: z.hi,
      fill: col,
      fillAlpha: inverted ? IFVG_ALPHA : ZONE_ALPHA,
      stroke: col,
      strokeW: 1,
      radius: 2,
    };
    if (inverted) zone.dash = "4 3";
    prims.push(zone);

    // partial-fill sub-zone + chip
    if (!inverted && z.filled > 0.01 && z.filled < 1 && bandEnd > anchor) {
      const bp1 = z.dir > 0 ? z.watermark : z.lo;
      const bp2 = z.dir > 0 ? z.hi : z.watermark;
      prims.push({
        kind: "zone",
        id: `${tipId}-f`,
        z: 1,
        i1: anchor,
        i2: bandEnd,
        p1: bp1,
        p2: bp2,
        fill: colors.neutral,
        fillAlpha: FILL_ALPHA,
        radius: 2,
      });
      const pct = Math.round(z.filled * 100);
      const chip: LabelPrim = {
        kind: "label",
        id: `${tipId}-fc`,
        z: 3,
        i: bandEnd,
        p: (bp1 + bp2) / 2,
        text: zh ? `已回补 ${pct}%` : `${pct}% filled`,
        place: "left",
        style: "chip",
        color: colors.muted,
        fs: CHIP_FS,
        minPxPerBar: CHIP_MIN_PX_PER_BAR,
        tooltipId: tipId,
      };
      prims.push(chip);
    }

    // in-gap POC
    if (showPoc !== "off") {
      const poc: LinePrim = {
        kind: "line",
        id: `${tipId}-poc`,
        z: 2,
        a: { i: anchor, p: z.poc },
        b: { i: extRef, p: z.poc },
        color: colors.brand,
        w: 1,
        dash: "5 4",
        alpha: 0.9,
      };
      prims.push(poc);
    }

    // inversion label
    if (inverted) {
      const lab: LabelPrim = {
        kind: "label",
        id: `${tipId}-inv`,
        z: 3,
        i: Math.min(z.invAt + 1, last),
        p: mid,
        text: "iFVG",
        place: "right",
        style: "bare",
        color: col,
        fs: CHIP_FS,
        tooltipId: tipId,
      };
      prims.push(lab);
    }

    // creation glyph — bible geometry: bull prints ▼ above the creation candle, bear ▲ below.
    if (wantCreated) {
      const cb = bars[z.i];
      const off = (atr[z.i] > 0 ? atr[z.i] : Math.max(z.size, 1e-9)) * 0.35;
      const m: MarkerPrim = {
        kind: "marker",
        id: `${tipId}-c`,
        z: 3,
        i: z.i,
        p: z.dir > 0 ? cb.h + off : cb.l - off,
        shape: z.dir > 0 ? "tri-down" : "tri-up",
        size: MARKER_SIZE,
        fill: z.dir > 0 ? colors.up : colors.down,
        alpha: MARKER_ALPHA,
        tooltipId: tipId,
      };
      prims.push(m);
    }

    // retest glyphs — point back into the gap from the side price approached
    if (wantRetest) {
      for (const r of z.retests) {
        const off = (atr[r.i] > 0 ? atr[r.i] : Math.max(z.size, 1e-9)) * 0.35;
        prims.push({
          kind: "marker",
          id: `${tipId}-r${r.i}`,
          z: 3,
          i: r.i,
          p: bias > 0 ? z.lo - off : z.hi + off,
          shape: bias > 0 ? "tri-up" : "tri-down",
          size: MARKER_SIZE,
          fill: col,
          alpha: MARKER_ALPHA,
          tooltipId: tipId,
        } as MarkerPrim);
      }
    }

    // tooltip (attached to the chip / iFVG label / signal glyphs above)
    // for an iFVG the live number is how far the FLIPPED zone has been retraced (100% = removed)
    const frac = inverted ? z.invFilled : z.filled;
    const rows: TooltipDef["rows"] = [
      { k: L.size, v: `${((z.size / mid) * 100).toFixed(2)}% · ${z.sizeATR.toFixed(2)}× ATR` },
      { k: inverted ? L.reclaimed : L.filled, v: `${Math.round(frac * 100)}%` },
      { k: L.age, v: `${last - z.i} ${L.bars}` },
    ];
    if (showPoc !== "off") rows.push({ k: "POC", v: fmtPrice(z.poc) });
    tooltips.push({
      id: tipId,
      title: (z.dir > 0 ? L.bull : L.bear) + (inverted ? L.inv : ""),
      accent: col,
      rows,
    });
  }

  const tape = events.length > MAX_EVENTS ? events.slice(events.length - MAX_EVENTS) : events;
  return { prims, tooltips, events: tape };
}

// --------------------------------------------------------------------------------- module def

export const FVG_MODULE: SuiteModuleDef = { ...FVG_META, compute };

export default FVG_MODULE;
