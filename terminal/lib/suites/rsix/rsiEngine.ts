// RSI Engine — the core module of the RSI Ultimate PANE suite ("rsix"), plus the shared RSI math
// every other module in the suite builds on.
//
// Contract: lib/indicator-canvas/types.ts (frozen). Visual spec: docs/
// PREMIUM_INDICATOR_VISUAL_DESIGN_BIBLE_2026-07-28.md §"RSI Engine — visual spec".
// Algorithm sketch: docs/PREMIUM_INDICATOR_SUITE_MASTERPLAN_2026-07-28.md §8.4.
//
// PANE Y-SPACE. This suite declares `pane: { min: 0, max: 100 }`, so every price value emitted by a
// module in this folder is an RSI reading, not a price. Bar indexing is unchanged. The 30/50/70
// guide lines are the SuiteDef's `pane.lines` — modules never draw them.
//
//   rsi    = Wilder RSI(source, len)                        (oscUtils.rsiArr -> wilderRma)
//   smooth = EMA | SMA | WMA of rsi over smoothLen          (the vendor's "signal MA")
//
// The wave is one gradline whose per-point color IS the reading: overbought leans bear, oversold
// leans bull (an oversold tape is an opportunity, which is why the vendor paints it with the bull
// hue), and the middle of the range decays from brand to muted as the reading approaches 50 — so a
// glance at saturation answers "is anything happening?" before the eye reads the level. Beyond the
// 65/35 lines the space between the wave and the line it broke is filled, and nowhere else: fills
// inside the band would turn the pane to mush (bible: "keep fills OUTSIDE the band only").
//
// Non-repaint: every series is a forward recurrence over bars <= i (oscUtils guarantees it), the
// coloring is a pure function of the value at that bar, and an OB/OS fill run is closed by the bar
// that re-enters — the left taper sits on the bar BEFORE the run, never on a future bar. Pure: no
// wall clock, no randomness, no module-level mutable state.

import type {
  CloudPrim,
  GradLinePrim,
  ModuleCtx,
  ModuleResult,
  Prim,
  SuiteBar,
  SuiteEvent,
  SuiteField,
  SuiteModuleDef,
} from "@/lib/indicator-canvas/types";
import { emaArr, rsiArr } from "@/lib/suites/shared/oscUtils";
import { RSI_DEFAULTS, RSI_ENGINE_META, type RsiSmoothType, type RsiSource } from "./rsiEngine.meta";
// Moved to the metadata file (the settings schema is built from it); re-exported so every
// satellite and test that imports it from here keeps working.
export { RSI_DEFAULTS, type RsiSmoothType, type RsiSource } from "./rsiEngine.meta";

// ------------------------------------------------------------------------- suite-wide constants

/** Pane y-space (mirrors the SuiteDef's `pane` range — modules clamp their chrome into it). */
export const PANE_MIN = 0;
export const PANE_MAX = 100;
/** Overbought / oversold / midline levels. The suite's `pane.lines` draw them; modules do not. */
export const OB_LEVEL = 65;
export const OS_LEVEL = 35;
export const MID_LEVEL = 50;
/** MA-cross dots are muted inside this band (a cross at 50 is noise, not a signal). */
export const NEUTRAL_LO = 45;
export const NEUTRAL_HI = 55;

export const MAX_EVENTS = 80;

// ------------------------------------------------------------------------------ shared settings



/** The Engine module's key inside this suite — the prefix satellites read out of `ctx.suite`. */
export const RSI_ENGINE_KEY = "eng";

// ------------------------------------------------------------------- shared numeric helpers

export function clampNum(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function numOpt(v: any, d: number, lo: number, hi: number): number {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? clampNum(n, lo, hi) : d;
}

export function intOpt(v: any, d: number, lo: number, hi: number): number {
  return Math.round(numOpt(v, d, lo, hi));
}

export function boolOpt(v: any, d: boolean): boolean {
  return typeof v === "boolean" ? v : d;
}

export function selOpt<T extends string>(v: any, d: T, allowed: readonly T[]): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : d;
}

/** Keep pane chrome (marker offsets, label rows) inside the visible 0..100 range. */
export function clampPane(v: number): number {
  return clampNum(v, PANE_MIN + 2, PANE_MAX - 2);
}

/** A bar with a zero/NaN price is MISSING, not a print (CN/HK premarket pushes OHLC=0). */
export function validBar(b: SuiteBar | undefined): b is SuiteBar {
  if (!b) return false;
  return (
    Number.isFinite(b.o) &&
    Number.isFinite(b.h) &&
    Number.isFinite(b.l) &&
    Number.isFinite(b.c) &&
    b.h > 0 &&
    b.l > 0 &&
    b.c > 0 &&
    b.h >= b.l
  );
}

/** Indices whose RSI is defined, ascending — the walk order every module in the suite uses. */
export function finiteIdx(a: Float64Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < a.length; i++) if (Number.isFinite(a[i])) out.push(i);
  return out;
}

// ------------------------------------------------------------------------------- local smoothers
// oscUtils owns rma/ema/rsi; SMA and WMA live here because only this suite needs them. Both follow
// the oscUtils conventions exactly: honest NaN warm-up, holes skipped (never zeroed), no lookahead.

function sanLen(len: number): number {
  const n = Math.floor(Number(len));
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

export function smaArr(vals: Float64Array | number[], len: number): Float64Array {
  const n = vals?.length ?? 0;
  const out = new Float64Array(n);
  if (n === 0) return out;
  out.fill(NaN);
  const L = sanLen(len);
  const buf = new Float64Array(L);
  let cnt = 0;
  let head = 0; // oldest slot once the ring is full
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = vals[i];
    if (!Number.isFinite(v)) continue;
    if (cnt < L) cnt++;
    else sum -= buf[head];
    buf[head] = v;
    sum += v;
    head = (head + 1) % L;
    if (cnt === L) out[i] = sum / L;
  }
  return out;
}

export function wmaArr(vals: Float64Array | number[], len: number): Float64Array {
  const n = vals?.length ?? 0;
  const out = new Float64Array(n);
  if (n === 0) return out;
  out.fill(NaN);
  const L = sanLen(len);
  const denom = (L * (L + 1)) / 2;
  const buf = new Float64Array(L);
  let cnt = 0;
  let head = 0;
  for (let i = 0; i < n; i++) {
    const v = vals[i];
    if (!Number.isFinite(v)) continue;
    if (cnt < L) cnt++;
    buf[head] = v;
    head = (head + 1) % L;
    if (cnt < L) continue;
    let num = 0; // weight 1 = oldest ... weight L = newest
    for (let k = 0; k < L; k++) num += buf[(head + k) % L] * (k + 1);
    out[i] = num / denom;
  }
  return out;
}

// ---------------------------------------------------------------------------- shared computation

export interface UltimateRsi {
  /** Wilder RSI of the selected source, 0..100, NaN during warm-up. */
  rsi: Float64Array;
  /** The signal MA over `rsi`, NaN during its own warm-up (=== rsi when smoothLen <= 1). */
  smooth: Float64Array;
}

/** Price series for the selected source, with unusable bars punched out to NaN. */
function sourceSeries(bars: SuiteBar[], source: RsiSource): Float64Array {
  const n = bars.length;
  const out = new Float64Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    const b = bars[i];
    if (!validBar(b)) continue;
    out[i] = source === "hl2" ? (b.h + b.l) / 2 : source === "hlc3" ? (b.h + b.l + b.c) / 3 : b.c;
  }
  return out;
}

/**
 * The suite's single source of truth for the RSI pair. Every module calls this — nothing in the
 * folder re-implements RSI, so the wave, the signals, the divergence pivots and the channel all
 * describe the same series by construction.
 */
export function computeUltimateRsi(
  bars: SuiteBar[],
  len: number,
  source: RsiSource,
  smoothLen: number,
  smoothType: RsiSmoothType,
): UltimateRsi {
  const n = bars?.length ?? 0;
  if (n === 0) return { rsi: new Float64Array(0), smooth: new Float64Array(0) };
  const rsi = rsiArr(sourceSeries(bars, source), Math.max(2, Math.round(len)));
  const sl = Math.max(1, Math.round(smoothLen));
  if (sl <= 1) return { rsi, smooth: rsi.slice() };
  const smooth =
    smoothType === "sma" ? smaArr(rsi, sl) : smoothType === "wma" ? wmaArr(rsi, sl) : emaArr(rsi, sl);
  return { rsi, smooth };
}

/**
 * The Engine's USER settings, read from the suite-wide flat params. Sanitized through the very same
 * option readers `compute()` below uses, so a satellite calling `sharedRsi` gets bit-identical
 * series to the ones the Engine draws. Tolerates a missing/partial `ctx.suite` (tests, warm-up).
 */
export function rsiEngineParams(suite: Record<string, any> | undefined): {
  len: number;
  source: RsiSource;
  smooth: boolean;
  smoothLen: number;
  smoothType: RsiSmoothType;
} {
  const q = suite || {};
  const p = `${RSI_ENGINE_KEY}.`;
  return {
    len: intOpt(q[`${p}len`] ?? RSI_DEFAULTS.len, RSI_DEFAULTS.len, 2, 50),
    source: selOpt<RsiSource>(q[`${p}source`] ?? RSI_DEFAULTS.source, RSI_DEFAULTS.source, [
      "close",
      "hl2",
      "hlc3",
    ]),
    smooth: boolOpt(q[`${p}smooth`] ?? RSI_DEFAULTS.smooth, RSI_DEFAULTS.smooth),
    smoothLen: intOpt(q[`${p}smoothLen`] ?? RSI_DEFAULTS.smoothLen, RSI_DEFAULTS.smoothLen, 1, 50),
    smoothType: selOpt<RsiSmoothType>(
      q[`${p}smoothType`] ?? RSI_DEFAULTS.smoothType,
      RSI_DEFAULTS.smoothType,
      ["ema", "sma", "wma"],
    ),
  };
}

/** The RSI pair the ENGINE is drawing for this pass — the one series every satellite must read. */
export function sharedRsi(ctx: ModuleCtx): UltimateRsi {
  const p = rsiEngineParams(ctx.suite);
  return computeUltimateRsi(ctx.bars, p.len, p.source, p.smoothLen, p.smoothType);
}

// -------------------------------------------------------------------------------- module settings

const WAVE_W = 1.8;
const SMOOTH_W = 1;
const SMOOTH_ALPHA = 0.95;
const FILL_ALPHA = 0.1;
const MAX_FILL_RUNS = 60;
/** |rsi - 50| below this reads as "nothing happening" -> muted; above it the wave takes the accent. */
const DEAD_ZONE = 8;


// -------------------------------------------------------------------------------------- compute

interface FillRun {
  side: 1 | -1; // +1 above OB, -1 below OS
  idxs: number[];
  before: number; // bar before the run (taper anchor), -1 when the run opens the series
  after: number; // bar that re-entered (taper anchor), -1 while the run is still open
}

function compute(ctx: ModuleCtx): ModuleResult {
  const { bars, colors, lang } = ctx;
  const n = bars?.length ?? 0;
  const empty: ModuleResult = { prims: [], events: [] };
  if (n < 3) return empty;

  const s = ctx.s || {};
  const len = intOpt(s.len, RSI_DEFAULTS.len, 2, 50);
  const source = selOpt<RsiSource>(s.source, RSI_DEFAULTS.source, ["close", "hl2", "hlc3"]);
  const wantSmooth = boolOpt(s.smooth, RSI_DEFAULTS.smooth);
  const smoothLen = intOpt(s.smoothLen, RSI_DEFAULTS.smoothLen, 1, 50);
  const smoothType = selOpt<RsiSmoothType>(s.smoothType, RSI_DEFAULTS.smoothType, ["ema", "sma", "wma"]);
  const zh = lang === "zh";

  const { rsi, smooth } = computeUltimateRsi(bars, len, source, smoothLen, smoothType);
  const fin = finiteIdx(rsi);
  if (fin.length < 2) return empty;

  // ---- 1) wave points + value coloring ------------------------------------------------
  const wavePts: Array<{ i: number; p: number }> = [];
  const waveCols: string[] = [];
  for (const i of fin) {
    const v = rsi[i];
    wavePts.push({ i, p: v });
    waveCols.push(
      v >= OB_LEVEL
        ? colors.down
        : v <= OS_LEVEL
          ? colors.up
          : Math.abs(v - MID_LEVEL) < DEAD_ZONE
            ? colors.muted
            : colors.brand,
    );
  }

  // ---- 2) OB/OS runs (fills) + the event tape -----------------------------------------
  const runs: FillRun[] = [];
  const events: SuiteEvent[] = [];
  let cur: FillRun | null = null;
  let prev = NaN;

  const obLabel = zh ? "RSI 进入超买" : "RSI entered overbought";
  const osLabel = zh ? "RSI 进入超卖" : "RSI entered oversold";
  const midUp = zh ? "RSI 上穿 50" : "RSI crossed above 50";
  const midDn = zh ? "RSI 下穿 50" : "RSI crossed below 50";

  for (let k = 0; k < fin.length; k++) {
    const i = fin[k];
    const v = rsi[i];

    if (Number.isFinite(prev)) {
      if (prev < OB_LEVEL && v >= OB_LEVEL) {
        events.push({
          type: "rsi_ob_enter",
          dir: "bear",
          i,
          p: v,
          strength: clampNum(Math.round((v - MID_LEVEL) * 2), 0, 100),
          label: `${obLabel} · ${v.toFixed(1)}`,
        });
      } else if (prev > OS_LEVEL && v <= OS_LEVEL) {
        events.push({
          type: "rsi_os_enter",
          dir: "bull",
          i,
          p: v,
          strength: clampNum(Math.round((MID_LEVEL - v) * 2), 0, 100),
          label: `${osLabel} · ${v.toFixed(1)}`,
        });
      }
      if (prev < MID_LEVEL && v >= MID_LEVEL) {
        events.push({ type: "rsi_mid_cross", dir: "bull", i, p: v, strength: 50, label: midUp });
      } else if (prev > MID_LEVEL && v <= MID_LEVEL) {
        events.push({ type: "rsi_mid_cross", dir: "bear", i, p: v, strength: 50, label: midDn });
      }
    }

    const side: 1 | -1 | 0 = v > OB_LEVEL ? 1 : v < OS_LEVEL ? -1 : 0;
    if (cur && side !== cur.side) {
      cur.after = i;
      runs.push(cur);
      cur = null;
    }
    if (side !== 0 && !cur) cur = { side, idxs: [i], before: k > 0 ? fin[k - 1] : -1, after: -1 };
    else if (side !== 0 && cur) cur.idxs.push(i);
    prev = v;
  }
  if (cur) runs.push(cur); // still beyond the line on the last bar — fill renders, no re-entry yet

  // ------------------------------------------------------------------------------ render
  const prims: Prim[] = [];

  const kept = runs.length > MAX_FILL_RUNS ? runs.slice(runs.length - MAX_FILL_RUNS) : runs;
  for (const r of kept) {
    const level = r.side > 0 ? OB_LEVEL : OS_LEVEL;
    const upper: Array<{ i: number; p: number }> = [];
    const lower: Array<{ i: number; p: number }> = [];
    const push = (i: number, p: number) => {
      if (r.side > 0) {
        upper.push({ i, p });
        lower.push({ i, p: level });
      } else {
        upper.push({ i, p: level });
        lower.push({ i, p });
      }
    };
    // tapers pin the polygon to the level on the bars either side of the excursion
    if (r.before >= 0) push(r.before, level);
    for (const i of r.idxs) push(i, rsi[i]);
    if (r.after >= 0) push(r.after, level);
    if (upper.length < 2) continue;
    prims.push({
      kind: "cloud",
      id: `rsi-fill-${r.idxs[0]}`,
      z: 0,
      upper,
      lower,
      segColors: new Array(Math.max(0, upper.length - 1)).fill(r.side > 0 ? colors.down : colors.up),
      fillAlpha: FILL_ALPHA,
    } as CloudPrim);
  }

  if (wantSmooth) {
    const sPts: Array<{ i: number; p: number }> = [];
    for (let i = 0; i < n; i++) if (Number.isFinite(smooth[i])) sPts.push({ i, p: smooth[i] });
    if (sPts.length >= 2) {
      prims.push({
        kind: "gradline",
        id: "rsi-smooth",
        z: 1,
        pts: sPts,
        colors: new Array(sPts.length).fill(colors.warn),
        w: SMOOTH_W,
        alpha: SMOOTH_ALPHA,
      } as GradLinePrim);
    }
  }

  prims.push({
    kind: "gradline",
    id: "rsi-wave",
    z: 2,
    pts: wavePts,
    colors: waveCols,
    w: WAVE_W,
  } as GradLinePrim);

  const tape = events.length > MAX_EVENTS ? events.slice(events.length - MAX_EVENTS) : events;
  return { prims, events: tape };
}

// ---------------------------------------------------------------------------------- module def

export const RSI_ENGINE_MODULE: SuiteModuleDef = { ...RSI_ENGINE_META, compute };

export default RSI_ENGINE_MODULE;
