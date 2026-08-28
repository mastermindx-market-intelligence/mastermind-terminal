// Pulse Wave — flagship oscillator of the Pulse suite (pane y-space −110..110).
//
// Contract: lib/indicator-canvas/types.ts (frozen). Visual spec: docs/
// PREMIUM_INDICATOR_VISUAL_DESIGN_BIBLE_2026-07-28.md §"Nautilus — visual spec".
// Algorithm sketch: docs/PREMIUM_INDICATOR_SUITE_MASTERPLAN_2026-07-28.md §8.3 "Pulse Oscillator".
//
//   diff   = close[k] − close[k−1]                       (valid closes only; 0-price = MISSING)
//   mom    = EMA(EMA(diff, long), short)                 (TSI-style double smoothing)
//   wave   = normalizeSigned(mom, 200)                   (trailing-|max| scale → −100..100)
//   gapped = EMA(wave, signal×2)                         (companion line; cloud fills the spread)
//
// 4-STATE COLORING (bible → our tokens, sanctioned by the bible's adaptation notes):
//   bible green  "rising below the midline" (accumulation)  → colors.up
//   bible blue   "rising above the midline" (momentum)      → colors.brand
//   bible red    "declining momentum / OB-OS decay"         → colors.down   (all falling segments;
//                                                             decay out of the ±60 zone is the
//                                                             canonical case the bible pictures)
//   bible magenta "down→up transition"                      → colors.neutral (NOT warn — warn is
//                                                             reserved for exhaustion glyphs)
// Priority: transition (slope flipped −→+ within the last 2 bars) > rising states > decay.
//
// The suite pane (registry) owns the zero line and the ±60 extreme guides via pane.lines —
// this module deliberately emits NO static guide prims.
//
// Non-repaint: every series is a forward recurrence over bars ≤ k (EMA chains) or a trailing
// window (normalizeSigned); states/events at bar k depend only on bars ≤ k. Recomputing with
// more bars never alters confirmed history. Pure — no wall clock, randomness or module state.

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
import { emaArr, normalizeSigned } from "@/lib/suites/shared/oscUtils";
import { PULSE_WAVE_META } from "./pulseWave.meta";

// ------------------------------------------------------------------------------------ constants

const NORM_WINDOW = 200; // trailing-|max| window for the −100..100 scale
const EXTREME = 60;      // ±60 extreme zone (pane guides drawn by the integrator)
const WAVE_W = 2;
const GAP_W = 1;
const FILL_ALPHA = 0.08;
const MAX_EVENTS = 80;

export type PulseProfile = "scalper" | "day" | "swing";

/** The Wave module's key inside this suite — the prefix satellites read out of `ctx.suite`. */
export const PULSE_WAVE_KEY = "wave";
/** Suite-wide profile knob: ONE control on the Wave module governs every module in the pane. */
export const PULSE_PROFILE_PARAM = `${PULSE_WAVE_KEY}.profile`;
export const PULSE_PROFILE_DEFAULT: PulseProfile = "day";

/** Read the Wave module's live profile from the suite-wide flat params (tolerates absence). */
export function pulseProfileOf(suite: Record<string, any> | undefined): PulseProfile {
  const v = suite?.[PULSE_PROFILE_PARAM];
  return v === "scalper" || v === "swing" || v === "day" ? v : PULSE_PROFILE_DEFAULT;
}

export const PROFILE_PERIODS: Record<PulseProfile, { short: number; long: number; signal: number }> = {
  scalper: { short: 7, long: 15, signal: 6 },
  day: { short: 13, long: 25, signal: 9 },
  swing: { short: 21, long: 40, signal: 13 },
};

/** Wave color-state codes (see header for the bible mapping). */
export const WAVE_STATE = {
  NONE: 0,       // warmup / unknown → colors.muted
  RISE_BELOW: 1, // rising, wave < 0 → colors.up
  RISE_ABOVE: 2, // rising, wave ≥ 0 → colors.brand
  DECAY: 3,      // falling          → colors.down
  TRANSITION: 4, // −→+ slope flip within last 2 bars → colors.neutral
} as const;

// ------------------------------------------------------------------------------------- settings


// -------------------------------------------------------------------------------------- helpers

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function boolOpt(v: any, d: boolean): boolean {
  return typeof v === "boolean" ? v : d;
}

function profileOpt(v: any): PulseProfile {
  return v === "scalper" || v === "swing" || v === "day" ? v : "day";
}

/**
 * emaArr with leading-NaN tolerance: trims non-finite warmup values, smooths the finite tail,
 * scatters back. Keeps this module independent of oscUtils' exact warmup policy.
 */
function emaTail(src: ArrayLike<number>, len: number): Float64Array {
  const n = src.length;
  const out = new Float64Array(n).fill(NaN);
  let f = 0;
  while (f < n && !Number.isFinite(src[f])) f++;
  if (n - f < Math.max(2, len)) return out;
  const seg: number[] = new Array(n - f);
  for (let k = f; k < n; k++) seg[k - f] = src[k];
  const sm = emaArr(seg, len);
  for (let k = 0; k < sm.length; k++) {
    const v = sm[k];
    if (Number.isFinite(v)) out[f + k] = v;
  }
  return out;
}

// -------------------------------------------------------------------------- shared computation

export interface PulseWaveSeries {
  /** −100..100 wave, NaN during warmup / on invalid bars; indexed by bar index. */
  wave: Float64Array;
  /** EMA(wave, signal×2) companion line, same indexing. */
  gapped: Float64Array;
  /** WAVE_STATE codes per bar (0 while unknown). */
  states: Int8Array;
}

/**
 * The one Pulse wave computation. Pulse Signals imports this same pure function and recomputes
 * through the identical deterministic path — host-level memoization keys on (suite, symbol, tf,
 * bars, params), so the duplicate call is cheap and the two modules can never disagree.
 */
export function computePulseWave(bars: SuiteBar[], profile: PulseProfile): PulseWaveSeries {
  const n = bars.length;
  const wave = new Float64Array(n).fill(NaN);
  const gapped = new Float64Array(n).fill(NaN);
  const states = new Int8Array(n);
  const P = PROFILE_PERIODS[profile] ?? PROFILE_PERIODS.day;

  // Compact to valid closes — a zero/NaN equity price is MISSING, not a print (CN/HK premarket).
  const bi: number[] = [];
  const closes: number[] = [];
  for (let i = 0; i < n; i++) {
    const c = bars[i]?.c;
    if (Number.isFinite(c) && c > 0) {
      bi.push(i);
      closes.push(c);
    }
  }
  const m = bi.length;
  if (m < P.long + P.short + 4) return { wave, gapped, states };

  const diff: number[] = new Array(m);
  diff[0] = 0; // neutral seed — first bar has no prior close
  for (let k = 1; k < m; k++) diff[k] = closes[k] - closes[k - 1];

  const mom = emaTail(emaTail(diff, P.long), P.short);
  const waveC = new Float64Array(m).fill(NaN);
  for (let k = 0; k < m; k++) {
    // normalizeSigned is a PER-BAR reading (vals, i, window), not a series transform.
    if (!Number.isFinite(mom[k])) continue;
    waveC[k] = clamp(normalizeSigned(mom, k, NORM_WINDOW), -100, 100);
  }
  const gapC = emaTail(waveC, P.signal * 2);

  // 4-state machine over the compacted wave (priority: transition > rising > decay).
  const stC = new Int8Array(m);
  for (let k = 2; k < m; k++) {
    const w0 = waveC[k];
    const w1 = waveC[k - 1];
    const w2 = waveC[k - 2];
    if (!Number.isFinite(w0) || !Number.isFinite(w1) || !Number.isFinite(w2)) continue;
    const s0 = w0 - w1;
    const s1 = w1 - w2;
    const flipNow = s0 > 0 && s1 <= 0;
    const flipPrev = k >= 3 && Number.isFinite(waveC[k - 3]) && s1 > 0 && w2 - waveC[k - 3] <= 0;
    if (flipNow || flipPrev) stC[k] = WAVE_STATE.TRANSITION;
    else if (s0 > 0) stC[k] = w0 < 0 ? WAVE_STATE.RISE_BELOW : WAVE_STATE.RISE_ABOVE;
    else stC[k] = WAVE_STATE.DECAY;
  }

  for (let k = 0; k < m; k++) {
    const i = bi[k];
    wave[i] = waveC[k];
    const g = gapC[k];
    if (Number.isFinite(g)) gapped[i] = clamp(g, -100, 100);
    states[i] = stC[k];
  }
  return { wave, gapped, states };
}

// ------------------------------------------------------------------------------------- compute

function compute(ctx: ModuleCtx): ModuleResult {
  const { bars, colors, lang } = ctx;
  const n = bars.length;
  const empty: ModuleResult = { prims: [], tooltips: [], events: [] };
  if (n < 3) return empty;

  const s = ctx.s || {};
  const profile = profileOpt(s.profile);
  const wantGap = boolOpt(s.gapped, true);
  const wantFill = boolOpt(s.fillGaps, true);
  const zh = lang === "zh";

  const { wave, gapped, states } = computePulseWave(bars, profile);

  const stateColor = (st: number): string =>
    st === WAVE_STATE.RISE_BELOW
      ? colors.up
      : st === WAVE_STATE.RISE_ABOVE
        ? colors.brand
        : st === WAVE_STATE.DECAY
          ? colors.down
          : st === WAVE_STATE.TRANSITION
            ? colors.neutral
            : colors.muted;

  // ---- prims -------------------------------------------------------------------------
  const wavePts: Array<{ i: number; p: number }> = [];
  const waveCols: string[] = [];
  const gapPts: Array<{ i: number; p: number }> = [];
  const gapCols: string[] = [];
  const cloudUp: Array<{ i: number; p: number }> = [];
  const cloudLo: Array<{ i: number; p: number }> = [];
  const cloudCols: string[] = [];

  for (let i = 0; i < n; i++) {
    const w = wave[i];
    if (!Number.isFinite(w)) continue;
    wavePts.push({ i, p: w });
    waveCols.push(stateColor(states[i]));
    const g = gapped[i];
    if (wantGap && Number.isFinite(g)) {
      gapPts.push({ i, p: g });
      gapCols.push(colors.muted);
      if (wantFill) {
        cloudUp.push({ i, p: w });
        cloudLo.push({ i, p: g });
        cloudCols.push(stateColor(states[i]));
      }
    }
  }
  if (wavePts.length < 2) return empty;

  const prims: Prim[] = [];
  if (wantGap && wantFill && cloudUp.length >= 2) {
    prims.push({
      kind: "cloud",
      id: "pw-fill",
      z: 0,
      upper: cloudUp,
      lower: cloudLo,
      segColors: cloudCols.slice(0, -1),
      fillAlpha: FILL_ALPHA,
    } as CloudPrim);
  }
  if (wantGap && gapPts.length >= 2) {
    prims.push({
      kind: "gradline",
      id: "pw-gapped",
      z: 1,
      pts: gapPts,
      colors: gapCols,
      w: GAP_W,
    } as GradLinePrim);
  }
  prims.push({
    kind: "gradline",
    id: "pw-wave",
    z: 2,
    pts: wavePts,
    colors: waveCols,
    w: WAVE_W,
  } as GradLinePrim);

  // ---- events (independent of visual toggles — the alert bridge keeps firing) ---------
  const events: SuiteEvent[] = [];
  const fmt = (v: number) => `${v > 0 ? "+" : ""}${Math.round(v)}`;
  let prev = NaN;
  for (let i = 0; i < n; i++) {
    const cur = wave[i];
    if (!Number.isFinite(cur)) continue;
    if (Number.isFinite(prev)) {
      const strength = clamp(Math.round(Math.abs(cur)), 0, 100);
      if (prev <= 0 && cur > 0) {
        events.push({
          type: "pw_cross_zero", dir: "bull", i, p: cur, strength,
          label: zh ? `脉冲上穿零轴 (${fmt(cur)})` : `Pulse crossed zero ▲ (${fmt(cur)})`,
        });
      } else if (prev >= 0 && cur < 0) {
        events.push({
          type: "pw_cross_zero", dir: "bear", i, p: cur, strength,
          label: zh ? `脉冲下穿零轴 (${fmt(cur)})` : `Pulse crossed zero ▼ (${fmt(cur)})`,
        });
      }
      // Convention: entering the −60 zone = opportunity (bull); entering +60 = risk (bear).
      if (prev > -EXTREME && cur <= -EXTREME) {
        events.push({
          type: "pw_extreme_enter", dir: "bull", i, p: cur, strength,
          label: zh ? `进入超卖区 (${fmt(cur)})` : `Pulse entered oversold (${fmt(cur)})`,
        });
      }
      if (prev < EXTREME && cur >= EXTREME) {
        events.push({
          type: "pw_extreme_enter", dir: "bear", i, p: cur, strength,
          label: zh ? `进入超买区 (${fmt(cur)})` : `Pulse entered overbought (${fmt(cur)})`,
        });
      }
      if (prev <= -EXTREME && cur > -EXTREME) {
        events.push({
          type: "pw_extreme_exit", dir: "bull", i, p: cur, strength,
          label: zh ? `脱离超卖区 (${fmt(cur)})` : `Pulse left oversold (${fmt(cur)})`,
        });
      }
      if (prev >= EXTREME && cur < EXTREME) {
        events.push({
          type: "pw_extreme_exit", dir: "bear", i, p: cur, strength,
          label: zh ? `脱离超买区 (${fmt(cur)})` : `Pulse left overbought (${fmt(cur)})`,
        });
      }
    }
    prev = cur;
  }

  const tape = events.length > MAX_EVENTS ? events.slice(events.length - MAX_EVENTS) : events;
  return { prims, tooltips: [], events: tape };
}

// --------------------------------------------------------------------------------- module def

export const PULSE_WAVE_MODULE: SuiteModuleDef = { ...PULSE_WAVE_META, compute };

export default PULSE_WAVE_MODULE;
