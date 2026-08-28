// MACD Engine — MACD-Ultimate PANE suite (normalized ±100 momentum curve + signal line).
//
// Contract: lib/indicator-canvas/types.ts (frozen). Visual spec: docs/
// PREMIUM_INDICATOR_VISUAL_DESIGN_BIBLE_2026-07-28.md §"MACD Engine — visual spec".
// Algorithm sketch: docs/PREMIUM_INDICATOR_SUITE_MASTERPLAN_2026-07-28.md §8.4.
//
// PANE Y-SPACE. Every prim this suite emits carries a value in the suite's own y-space
// (SuiteDef.pane = { min: -120, max: 120 }), not a price. The suite's static guide lines (0 and
// ±100) belong to the SuiteDef — modules never emit them.
//
//   raw[i]   = ma(close, fast, oscMa) − ma(close, slow, oscMa)      (classic MACD, price units)
//   macd[i]  = normalizeSigned(raw, i, 250)                          → −100..+100
//   signal[i]= ma(macd, signalLen, sigMa)                            (smoothed on the NORMALIZED
//                                                                     series, so both share a scale)
//   hist[i]  = macd[i] − signal[i]
//
// Why normalize: a raw MACD is in price units, so its scale is symbol- and era-dependent and no
// fixed threshold means anything. `normalizeSigned(raw, i, 250)` rescales bar i against the
// trailing 250-bar window only (never the future — that is what keeps it non-repainting), which
// turns the curve into a bounded oscillator where **±100 acts as an overbought/oversold rail**:
// +100 = the strongest up-momentum of the last ~year of bars, −100 the strongest down-momentum.
// The vendor's signature "flat line hugging the strip" at saturation falls straight out of it.
//
// Non-repaint: every stage is either a forward recurrence (ma) or a trailing-window transform
// (normalizeSigned), so recomputing with more bars never alters a confirmed bar. Pure — no wall
// clock, no randomness, no leaking module state (the memo below is keyed by the bars ARRAY plus a
// full parameter string, so a hit returns exactly what a recompute would have produced).

import type {
  GradLinePrim,
  ModuleCtx,
  ModuleResult,
  Prim,
  SuiteBar,
  SuiteEvent,
  SuiteField,
  SuiteModuleDef,
  ZonePrim,
} from "@/lib/indicator-canvas/types";
import { emaArr, normalizeSigned } from "@/lib/suites/shared/oscUtils";
import { MACD_ENGINE_META, MACDX_ENGINE_DEFAULTS, type MacdMaType } from "./macdEngine.meta";
// The engine's shared parameter data moved to the metadata file (a settings dialog must be
// able to read it without this file's computation). Re-exported so every satellite and test
// that imports it from here keeps working.
export { MACDX_ENGINE_DEFAULTS, MACDX_MA_OPTIONS, type MacdMaType } from "./macdEngine.meta";

// ------------------------------------------------------------------------------------ constants


/** Trailing window (bars) the ±100 normalization is measured against. */
export const MACDX_NORM_WINDOW = 250;
/** Saturation rail — also the suite's OB/OS level. */
export const MACDX_EXTREME = 100;
/** Suite pane y-space (mirrors SuiteDef.pane; the trend lanes live between EXTREME and PANE_MAX). */
export const MACDX_PANE_MIN = -120;
export const MACDX_PANE_MAX = 120;

const MAX_EVENTS = 80;
const LINE_W = 1.8;
const SIGNAL_W = 1;
const SIGNAL_ALPHA = 0.85;
const HEAT_MID = 40; // |v| under this = noise (muted)
const ZONE_ALPHA = 0.1;

// -------------------------------------------------------------------------------------- helpers

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function numOpt(v: any, d: number, lo: number, hi: number): number {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? clamp(n, lo, hi) : d;
}

export function intOpt(v: any, d: number, lo: number, hi: number): number {
  return Math.round(numOpt(v, d, lo, hi));
}

export function boolOpt(v: any, d: boolean): boolean {
  return typeof v === "boolean" ? v : d;
}

export function maOpt(v: any, d: MacdMaType): MacdMaType {
  return v === "sma" ? "sma" : v === "ema" ? "ema" : d;
}

/** A close of 0/NaN is MISSING, not a print (CN/HK premarket pushes OHLC = 0). */
function validClose(b: SuiteBar | undefined): boolean {
  return !!b && Number.isFinite(b.c) && b.c > 0;
}

// ------------------------------------------------------------------------------- local smoothers
// oscUtils owns rma/ema; SMA lives with each pane suite that needs it (the RSI-x engine keeps its
// own copy for the same reason). Conventions follow oscUtils exactly: honest NaN warm-up, holes
// skipped rather than zeroed, no lookahead.

function sanLen(len: number): number {
  const n = Math.floor(Number(len));
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

function smaArr(vals: Float64Array | number[], len: number): Float64Array {
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

function maSeries(vals: Float64Array, len: number, type: MacdMaType): Float64Array {
  return type === "sma" ? smaArr(vals, len) : emaArr(vals, len);
}

/** Clamp a pane value into the drawable band, dropping non-finites. */
export function paneVal(v: number, lo = MACDX_PANE_MIN + 2, hi = MACDX_PANE_MAX - 2): number | null {
  return Number.isFinite(v) ? clamp(v, lo, hi) : null;
}

// ------------------------------------------------------------------------------------- the maths

export interface UltimateMacd {
  /** normalized MACD, −100..+100; NaN through warm-up and on missing prints. Treat as read-only. */
  macd: Float64Array;
  /** MA of the normalized MACD, same scale; NaN until it has `signalLen` real samples. */
  signal: Float64Array;
  /** macd − signal, clamped to ±100 by consumers that draw it. NaN where either input is NaN. */
  hist: Float64Array;
}

// Memo: the host builds ONE bars array per compute pass and hands the same reference to every
// module of the suite, so five modules share a single computation. Keyed by (array identity ×
// params) — a hit is by construction identical to a recompute, so determinism is preserved.
const memo = new WeakMap<object, Map<string, UltimateMacd>>();

function emptyResult(n: number): UltimateMacd {
  return {
    macd: new Float64Array(n).fill(NaN),
    signal: new Float64Array(n).fill(NaN),
    hist: new Float64Array(n).fill(NaN),
  };
}

/**
 * The suite's one source of truth. `fast`/`slow` use `oscMa`; the signal line uses `sigMa` and is
 * taken over the NORMALIZED macd so both lines live on the same ±100 scale.
 */
export function computeUltimateMacd(
  bars: SuiteBar[],
  fast: number,
  slow: number,
  signalLen: number,
  oscMa: MacdMaType,
  sigMa: MacdMaType,
): UltimateMacd {
  const n = bars?.length ?? 0;
  if (n === 0) return emptyResult(0);

  const F = intOpt(fast, MACDX_ENGINE_DEFAULTS.fast, 2, 50);
  const S = intOpt(slow, MACDX_ENGINE_DEFAULTS.slow, 5, 100);
  const G = intOpt(signalLen, MACDX_ENGINE_DEFAULTS.signalLen, 2, 50);
  const oT = maOpt(oscMa, MACDX_ENGINE_DEFAULTS.oscMa);
  const sT = maOpt(sigMa, MACDX_ENGINE_DEFAULTS.sigMa);
  const key = `${F}|${S}|${G}|${oT}|${sT}`;

  let perBars = memo.get(bars as unknown as object);
  const hit = perBars?.get(key);
  if (hit) return hit;

  const out = build(bars, n, F, S, G, oT, sT);
  if (!perBars) {
    perBars = new Map();
    memo.set(bars as unknown as object, perBars);
  }
  perBars.set(key, out);
  return out;
}

function build(
  bars: SuiteBar[],
  n: number,
  F: number,
  S: number,
  G: number,
  oT: MacdMaType,
  sT: MacdMaType,
): UltimateMacd {
  // 1) source: closes with holes forward-filled and the pre-history back-filled, so the shared
  //    smoothers never see a hole (a NaN inside the window would push the MA's warm-up forward and
  //    make the whole curve start late). A validity mask carries the holes to the output instead.
  const src = new Float64Array(n);
  const ok = new Uint8Array(n);
  let last = NaN;
  let first = -1;
  for (let i = 0; i < n; i++) {
    const b = bars[i];
    if (validClose(b)) {
      last = b.c;
      if (first < 0) first = i;
      ok[i] = 1;
    }
    src[i] = last;
  }
  if (first < 0) return emptyResult(n);
  for (let i = 0; i < first; i++) src[i] = src[first];

  const warm = first + Math.max(F, S) - 1; // first bar with a fully-formed slow/fast MA
  if (warm >= n) return emptyResult(n);

  // 2) raw MACD in price units. Warm-up bars are pinned to 0 so MA settling artefacts can never
  //    inflate the normalization window that later bars are measured against.
  const fa = maSeries(src, F, oT);
  const sa = maSeries(src, S, oT);
  const raw = new Float64Array(n);
  for (let i = warm; i < n; i++) {
    const d = fa[i] - sa[i];
    raw[i] = Number.isFinite(d) ? d : 0;
  }

  // 3) ±100 normalization against the trailing window only.
  const macd = new Float64Array(n).fill(NaN);
  const normFill = new Float64Array(n);
  let firstNorm = NaN;
  for (let i = warm; i < n; i++) {
    const v = normalizeSigned(raw, i, MACDX_NORM_WINDOW);
    if (!Number.isFinite(v)) continue;
    const c = clamp(v, -MACDX_EXTREME, MACDX_EXTREME);
    normFill[i] = c;
    if (!Number.isFinite(firstNorm)) firstNorm = c;
    macd[i] = ok[i] ? c : NaN; // a missing print draws nothing, but still feeds the signal MA
  }
  if (!Number.isFinite(firstNorm)) return emptyResult(n);
  for (let i = 0; i < warm; i++) normFill[i] = firstNorm; // constant seed → no MA settling ramp

  // 4) signal line over the normalized macd.
  const sig = maSeries(normFill, G, sT);
  const signal = new Float64Array(n).fill(NaN);
  const hist = new Float64Array(n).fill(NaN);
  const sigWarm = warm + G - 1;
  for (let i = sigWarm; i < n; i++) {
    const sv = sig[i];
    if (!Number.isFinite(sv) || !ok[i]) continue;
    signal[i] = clamp(sv, -MACDX_EXTREME, MACDX_EXTREME);
    if (Number.isFinite(macd[i])) hist[i] = macd[i] - signal[i];
  }

  return { macd, signal, hist };
}

/** The Engine module's key inside this suite — the prefix satellites read out of `ctx.suite`. */
export const MACDX_ENGINE_KEY = "eng";

/**
 * Series for the four dependent modules, built from the Engine's LIVE settings. `suite` is
 * `ctx.suite` (whole-suite flat params, module-prefixed); a missing key falls back to the default,
 * and computeUltimateMacd sanitizes every value exactly as the Engine's own compute does — so the
 * satellites and the drawn curve are identical by construction.
 */
export function sharedMacd(bars: SuiteBar[], suite?: Record<string, any>): UltimateMacd {
  const d = MACDX_ENGINE_DEFAULTS;
  const q = suite || {};
  const p = `${MACDX_ENGINE_KEY}.`;
  return computeUltimateMacd(
    bars,
    q[`${p}fast`] ?? d.fast,
    q[`${p}slow`] ?? d.slow,
    q[`${p}signalLen`] ?? d.signalLen,
    q[`${p}oscMa`] ?? d.oscMa,
    q[`${p}sigMa`] ?? d.sigMa,
  );
}

/** Trim an event tape to the most recent MAX_EVENTS (the tape is never gated by a draw cap). */
export function tape(events: SuiteEvent[]): SuiteEvent[] {
  return events.length > MAX_EVENTS ? events.slice(events.length - MAX_EVENTS) : events;
}

// ------------------------------------------------------------------------------------- settings


// -------------------------------------------------------------------------------------- compute

function compute(ctx: ModuleCtx): ModuleResult {
  const { bars, colors, lang } = ctx;
  const n = bars?.length ?? 0;
  const empty: ModuleResult = { prims: [], tooltips: [], events: [] };
  if (n < 5) return empty;

  const s = ctx.s || {};
  const fast = intOpt(s.fast, MACDX_ENGINE_DEFAULTS.fast, 2, 50);
  const slow = intOpt(s.slow, MACDX_ENGINE_DEFAULTS.slow, 5, 100);
  const signalLen = intOpt(s.signalLen, MACDX_ENGINE_DEFAULTS.signalLen, 2, 50);
  const oscMa = maOpt(s.oscMa, MACDX_ENGINE_DEFAULTS.oscMa);
  const sigMa = maOpt(s.sigMa, MACDX_ENGINE_DEFAULTS.sigMa);
  const heat = s.colorMode !== "slope";
  const zh = lang === "zh";

  const { macd, signal } = computeUltimateMacd(bars, fast, slow, signalLen, oscMa, sigMa);

  // ---- curve colors -------------------------------------------------------------------
  // HeatMap: distance from zero. Quiet middle = muted, working range = brand accent, saturated
  // extreme = the directional OPPORTUNITY hue (deep oversold reads as up-heat, per the vendor's
  // green-at-−100 ramp) — deliberately not the sign of the value.
  const heatColor = (v: number): string => {
    const a = Math.abs(v);
    if (a < HEAT_MID) return colors.muted;
    if (a <= 80) return colors.brand;
    return v < 0 ? colors.up : colors.down;
  };

  const pts: Array<{ i: number; p: number }> = [];
  const cols: string[] = [];
  let prevV = NaN;
  let prevCol = colors.muted;
  for (let i = 0; i < n; i++) {
    const v = macd[i];
    if (!Number.isFinite(v)) continue;
    pts.push({ i, p: v });
    if (heat) {
      cols.push(heatColor(v));
    } else {
      const c = !Number.isFinite(prevV) || v === prevV ? prevCol : v > prevV ? colors.up : colors.down;
      cols.push(c);
      prevCol = c;
    }
    prevV = v;
  }
  if (pts.length < 2) return empty;

  const prims: Prim[] = [];

  // OB/OS strips (bible: translucent caps above +100 and below −100 that the saturated curve
  // clamps flat against). The ±100 GUIDE LINES themselves belong to the SuiteDef, not here.
  prims.push({
    kind: "zone",
    id: "mx-eng-ob",
    z: -1,
    i1: pts[0].i,
    i2: "right",
    p1: MACDX_EXTREME,
    p2: MACDX_PANE_MAX,
    fill: colors.down,
    fillAlpha: ZONE_ALPHA,
  } as ZonePrim);
  prims.push({
    kind: "zone",
    id: "mx-eng-os",
    z: -1,
    i1: pts[0].i,
    i2: "right",
    p1: -MACDX_EXTREME,
    p2: MACDX_PANE_MIN,
    fill: colors.up,
    fillAlpha: ZONE_ALPHA,
  } as ZonePrim);

  // signal line first (subordinate: thin, single hue), curve on top
  const sPts: Array<{ i: number; p: number }> = [];
  for (let i = 0; i < n; i++) {
    const v = signal[i];
    if (Number.isFinite(v)) sPts.push({ i, p: v });
  }
  if (sPts.length >= 2) {
    prims.push({
      kind: "gradline",
      id: "mx-eng-signal",
      z: 1,
      pts: sPts,
      colors: new Array(sPts.length).fill(colors.warn),
      w: SIGNAL_W,
      alpha: SIGNAL_ALPHA,
    } as GradLinePrim);
  }
  prims.push({
    kind: "gradline",
    id: "mx-eng-macd",
    z: 2,
    pts,
    colors: cols,
    w: LINE_W,
  } as GradLinePrim);

  // ---- zero-cross tape ----------------------------------------------------------------
  const events: SuiteEvent[] = [];
  let prev = NaN;
  for (let i = 0; i < n; i++) {
    const v = macd[i];
    if (!Number.isFinite(v)) continue;
    if (Number.isFinite(prev) && ((prev < 0 && v > 0) || (prev > 0 && v < 0))) {
      const bull = v > 0;
      events.push({
        type: "macdx_zero_cross",
        dir: bull ? "bull" : "bear",
        i,
        p: v,
        strength: Math.round(clamp(Math.abs(v), 0, 100)),
        label: zh
          ? `MACD ${bull ? "上穿零轴" : "下破零轴"} · ${v.toFixed(1)}`
          : `MACD crossed ${bull ? "above" : "below"} zero · ${v.toFixed(1)}`,
      });
    }
    prev = v;
  }

  return { prims, tooltips: [], events: tape(events) };
}

// ----------------------------------------------------------------------------------- module def

export const MACD_ENGINE_MODULE: SuiteModuleDef = { ...MACD_ENGINE_META, compute };

export default MACD_ENGINE_MODULE;
