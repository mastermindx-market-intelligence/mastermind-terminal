// Candle Painter — Trend Waves module (FREE tier taste of the premium visual language).
//
// Contract: lib/indicator-canvas/types.ts (frozen). Visual spec: docs/
// PREMIUM_INDICATOR_VISUAL_DESIGN_BIBLE_2026-07-28.md §"Candle Coloring — visual spec".
// Algorithm sketch: docs/PREMIUM_INDICATOR_SUITE_MASTERPLAN_2026-07-28.md §8.2 "Candle Painter".
//
// Output is candlePaint entries ONLY — no prims, no tooltips, no events. The candles themselves
// ARE the indicator (full takeover: every bar gets an entry while the module is on).
//
// Modes
// -----
//   trend           EMA20/EMA50 regime.  ema20 > ema50 and close above both -> colors.up;
//                   ema20 < ema50 and close below both -> colors.down; inside the cross (price
//                   between the two averages, or the averages disagreeing with price) -> muted.
//   momentum        RSI(14) bands.  rsi >= 60 -> colors.up; rsi <= 40 -> colors.down;
//                   40 < rsi < 60 with a FALLING rsi -> colors.warn ("weakening"); else muted.
//   trendVolume     same hue as `trend`, intensity by relative volume (see below).
//   momentumVolume  same hue as `momentum`, intensity by relative volume.
//
// Intensity encoding (the "SVG-free trick")
// -----------------------------------------
// candlePaint colors are FLAT token strings and a module may not do alpha math on tokens (laws:
// ctx.colors only, renderer owns alpha). So the volume modes encode intensity by how MUCH of the
// candle the hue takes over, keyed on the bar's volume percentile vs the trailing 100 bars:
//
//   pct >= 0.65  (high volume)  -> color + borderColor + wickColor   (full takeover, brightest)
//   0.35 <= pct < 0.65 (normal) -> color + borderColor               (wick keeps the chart default)
//   pct <  0.35  (low volume)   -> borderColor + wickColor only      (BODY keeps the chart default,
//                                  so the bar reads as an outline — lowest visual presence)
//
// The non-volume modes always paint all three (color + border + wick), matching the vendor's flat
// two/three-color look.
//
// Non-repaint: EMA/RSI/percentile at bar i are functions of bars <= i only, in a single forward
// pass. Pure — no wall clock, no randomness, no module-level mutable state.

import type {
  CandlePaintEntry,
  ModuleCtx,
  ModuleResult,
  SuiteBar,
  SuiteField,
  SuiteModuleDef,
} from "@/lib/indicator-canvas/types";
import { CANDLE_PAINTER_META } from "./candlePainter.meta";

// ------------------------------------------------------------------------------------ constants

const EMA_FAST = 20;
const EMA_SLOW = 50;
const RSI_LEN = 14;
const VOL_WINDOW = 100; // trailing bars the relative-volume percentile is measured against
const VOL_MIN_SAMPLE = 20; // below this many trailing bars the percentile is treated as neutral
const VOL_HIGH = 0.65; // percentile at/above which the hue takes over body+border+wick
const VOL_LOW = 0.35; // percentile below which only border+wick are painted
const RSI_HI = 60;
const RSI_LO = 40;

type Mode = "trend" | "momentum" | "trendVolume" | "momentumVolume";
const MODES = ["trend", "momentum", "trendVolume", "momentumVolume"] as const;

// ------------------------------------------------------------------------------------- settings


// -------------------------------------------------------------------------------------- helpers

function selOpt<T extends string>(v: any, d: T, allowed: readonly T[]): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : d;
}

/** A bar with a zero/NaN price is MISSING, not a print (CN/HK premarket pushes OHLC=0). */
function validBar(b: SuiteBar | undefined): b is SuiteBar {
  if (!b) return false;
  return Number.isFinite(b.o) && Number.isFinite(b.h) && Number.isFinite(b.l) && Number.isFinite(b.c) && b.c > 0;
}

/**
 * EMA over closes. Invalid bars carry the previous value forward (they do not poison the average).
 * Values before `len` valid closes have been seen are null — the caller renders those bars neutral.
 */
function emaSeries(bars: SuiteBar[], len: number): Array<number | null> {
  const n = bars.length;
  const out = new Array<number | null>(n).fill(null);
  const k = 2 / (len + 1);
  let ema = 0;
  let seen = 0;
  let seedSum = 0;
  for (let i = 0; i < n; i++) {
    const b = bars[i];
    if (!validBar(b)) {
      out[i] = seen >= len ? ema : null;
      continue;
    }
    seen++;
    if (seen <= len) {
      seedSum += b.c;
      ema = seedSum / seen; // SMA seed (Wilder-style warm-up; identical for any bar count)
      out[i] = seen === len ? ema : null;
    } else {
      ema = b.c * k + ema * (1 - k);
      out[i] = ema;
    }
  }
  return out;
}

/** Wilder RSI over closes. Null until `len` deltas have accumulated. */
function rsiSeries(bars: SuiteBar[], len: number): Array<number | null> {
  const n = bars.length;
  const out = new Array<number | null>(n).fill(null);
  let prevC: number | null = null;
  let deltas = 0;
  let gainSum = 0;
  let lossSum = 0;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < n; i++) {
    const b = bars[i];
    if (!validBar(b)) {
      out[i] = deltas >= len ? out[i - 1] ?? null : null;
      continue;
    }
    if (prevC === null) {
      prevC = b.c;
      continue;
    }
    const d = b.c - prevC;
    prevC = b.c;
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    deltas++;
    if (deltas <= len) {
      gainSum += g;
      lossSum += l;
      if (deltas === len) {
        avgGain = gainSum / len;
        avgLoss = lossSum / len;
      } else {
        continue;
      }
    } else {
      avgGain = (avgGain * (len - 1) + g) / len;
      avgLoss = (avgLoss * (len - 1) + l) / len;
    }
    out[i] = avgLoss === 0 ? (avgGain === 0 ? 50 : 100) : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

/**
 * Fraction of the trailing VOL_WINDOW bars (strictly before i) whose volume is <= this bar's.
 * Returns 0.5 (neutral) while the sample is too small or the volume is unusable, so warm-up bars
 * get the mid-intensity treatment instead of a misleading "quiet bar" outline.
 */
function volPercentile(bars: SuiteBar[], i: number): number {
  const v = bars[i]?.v;
  if (!Number.isFinite(v) || (v as number) <= 0) return 0.5;
  const from = Math.max(0, i - VOL_WINDOW);
  let count = 0;
  let le = 0;
  for (let k = from; k < i; k++) {
    const pv = bars[k]?.v;
    if (!Number.isFinite(pv) || (pv as number) <= 0) continue;
    count++;
    if ((pv as number) <= (v as number)) le++;
  }
  if (count < VOL_MIN_SAMPLE) return 0.5;
  return le / count;
}

// ---------------------------------------------------------------------------------------- compute

function compute(ctx: ModuleCtx): ModuleResult {
  const { bars, colors } = ctx;
  const n = bars.length;
  if (!n) return { prims: [] };

  const s = ctx.s || {};
  const mode = selOpt(s.mode, "momentum" as Mode, MODES);
  const isMomentum = mode === "momentum" || mode === "momentumVolume";
  const byVolume = mode === "trendVolume" || mode === "momentumVolume";

  const fast = isMomentum ? null : emaSeries(bars, EMA_FAST);
  const slow = isMomentum ? null : emaSeries(bars, EMA_SLOW);
  const rsi = isMomentum ? rsiSeries(bars, RSI_LEN) : null;

  const paint: CandlePaintEntry[] = new Array(n);

  for (let i = 0; i < n; i++) {
    const b = bars[i];
    let col = colors.muted;

    if (validBar(b)) {
      if (isMomentum) {
        const r = rsi![i];
        if (r !== null) {
          if (r >= RSI_HI) col = colors.up;
          else if (r <= RSI_LO) col = colors.down;
          else {
            // inside the 40..60 band: falling RSI = momentum bleeding out
            let prev: number | null = null;
            for (let k = i - 1; k >= 0 && k >= i - 5; k--) {
              if (rsi![k] !== null) {
                prev = rsi![k];
                break;
              }
            }
            col = prev !== null && r < prev ? colors.warn : colors.muted;
          }
        }
      } else {
        const f = fast![i];
        const sl = slow![i];
        if (f !== null && sl !== null) {
          const hi = Math.max(f, sl);
          const lo = Math.min(f, sl);
          if (f > sl && b.c >= hi) col = colors.up;
          else if (f < sl && b.c <= lo) col = colors.down;
          else col = colors.muted; // inside the cross
        }
      }
    }

    if (!byVolume) {
      paint[i] = { i, color: col, borderColor: col, wickColor: col };
      continue;
    }

    // volume modes: the hue is constant, the AMOUNT of candle it takes over is the intensity
    const pct = volPercentile(bars, i);
    if (pct >= VOL_HIGH) paint[i] = { i, color: col, borderColor: col, wickColor: col };
    else if (pct >= VOL_LOW) paint[i] = { i, color: col, borderColor: col };
    else paint[i] = { i, borderColor: col, wickColor: col };
  }

  return { prims: [], candlePaint: paint };
}

// --------------------------------------------------------------------------------- module def

export const CANDLE_PAINTER_MODULE: SuiteModuleDef = { ...CANDLE_PAINTER_META, compute };

export default CANDLE_PAINTER_MODULE;
