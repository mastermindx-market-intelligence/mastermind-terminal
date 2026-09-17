// suiteAlerts.ts — canonical PURE evaluator + catalog for the suite-event alert family.
//
// NO I/O. This file is the single source of truth for BOTH the browser (AlertsView
// condition builder / creation preview) AND the Node firing sidecar
// (ingest/suite_alerts.ts, bundled to ingest/dist/suite_alerts.mjs). The sidecar does
// ZERO algorithm duplication: it runs the real suite modules via computeSuite() and
// hands their SuiteEvent stream to evalSuiteEvent() below.
//
// Contract for the evaluator (mirrors ingest/alerts_engine.py one-shot semantics):
//   fired === true  → the condition is met; the engine applies the one-shot disarm
//                     (active=false + condition.triggered stamp).
//   fired === false → armed, not met. There is no null tri-state here — "cannot
//                     evaluate" (missing bars / unknown suite) is the CALLER's skip,
//                     decided before events are ever computed.
//
// Fresh-only law: an alert must never fire off old history on its first evaluation.
// Two gates enforce it, both required:
//   1. the confirmation bar time must clear the creation floor; the previous fire
//      watermark is interpreted under its recorded clock version (legacy = anchor);
//   2. confirmation must sit on one of the last SUITE_EVENT_FRESH_BARS bars of the
//      series — a months-old BOS that happens to postdate creation of a stale-data
//      symbol still cannot fire.
//
// Determinism: pure functions of their inputs — no Date.now(), no randomness.

import type { SuiteEvent } from "./indicator-canvas/types";

// ─────────────────────────────────────────────────────────────────── curated catalog

export interface SuiteAlertEventDef {
  event: string;                      // SuiteEvent.type emitted by the owning module
  suite: string;                      // suite key in lib/suites/registry.ts
  module: string;                     // owning module key within the suite
  tier: "free" | "essential" | "pro"; // the OWNING module's tier (verified vs registry)
  dirs: boolean;                      // event carries a bull/bear direction (dir filter valid)
  strength: boolean;                  // event carries a 0..100 strength (minStrength valid)
  tkey: string;                       // LEX key for the localized event name
  en: string;                         // English event name
}

/**
 * The curated, alertable subset of the suite event stream. NOT every SuiteEvent type
 * is here on purpose — chatty types (ob_created, fvg_created, liq_created, rsi_mid_cross,
 * pulse_dip, macdx_phase, …) stay chart-only. Tiers are copied from each owning module's
 * registry definition; the alerts POST route must vet a condition's event tier against
 * the creating user's entitlement.
 */
export const SUITE_ALERT_EVENTS: SuiteAlertEventDef[] = [
  // Structure Core
  { event: "bos",             suite: "structure", module: "ms",   tier: "essential", dirs: true, strength: false, tkey: "suiteEvBos",           en: "Break of structure (BOS)" },
  { event: "choch",           suite: "structure", module: "ms",   tier: "essential", dirs: true, strength: false, tkey: "suiteEvChoch",         en: "Change of character (CHoCH)" },
  { event: "cisd",            suite: "structure", module: "ms",   tier: "essential", dirs: true, strength: false, tkey: "suiteEvCisd",          en: "CISD (failed delivery)" },
  { event: "ob_touch",        suite: "structure", module: "ob",   tier: "pro",       dirs: true, strength: true,  tkey: "suiteEvObTouch",       en: "Order block touch" },
  { event: "ob_break",        suite: "structure", module: "ob",   tier: "pro",       dirs: true, strength: true,  tkey: "suiteEvObBreak",       en: "Order block break" },
  { event: "fvg_retest",      suite: "structure", module: "fvg",  tier: "essential", dirs: true, strength: true,  tkey: "suiteEvFvgRetest",     en: "Fair value gap retest" },
  { event: "ifvg",            suite: "structure", module: "fvg",  tier: "essential", dirs: true, strength: true,  tkey: "suiteEvIfvg",          en: "Inverted FVG" },
  { event: "liq_grab",        suite: "structure", module: "liq",  tier: "pro",       dirs: true, strength: true,  tkey: "suiteEvLiqGrab",       en: "Liquidity grab" },
  { event: "sfp",             suite: "structure", module: "sfp",  tier: "pro",       dirs: true, strength: true,  tkey: "suiteEvSfp",           en: "Swing failure pattern (SFP)" },
  { event: "pd_golden_touch", suite: "structure", module: "pd",   tier: "essential", dirs: true, strength: true,  tkey: "suiteEvPdGoldenTouch", en: "Golden zone touch" },
  // Trend Waves
  { event: "te_flip",         suite: "trend",     module: "te",   tier: "essential", dirs: true, strength: true,  tkey: "suiteEvTeFlip",        en: "Trend Engine flip" },
  { event: "te_power",        suite: "trend",     module: "te",   tier: "essential", dirs: true, strength: true,  tkey: "suiteEvTePower",       en: "Trend Engine power move" },
  { event: "te_tp_hit",       suite: "trend",     module: "te",   tier: "essential", dirs: true, strength: true,  tkey: "suiteEvTeTpHit",       en: "Trend Engine take-profit hit" },
  { event: "fb_turn",         suite: "trend",     module: "fb",   tier: "essential", dirs: true, strength: true,  tkey: "suiteEvFbTurn",        en: "Flow Band turn" },
  { event: "vb_retest",       suite: "trend",     module: "vb",   tier: "essential", dirs: true, strength: true,  tkey: "suiteEvVbRetest",      en: "Voltix band retest" },
  // Pulse Oscillator
  { event: "pulse_buy",       suite: "pulse",     module: "sig",  tier: "essential", dirs: true, strength: true,  tkey: "suiteEvPulseBuy",      en: "Pulse buy signal" },
  { event: "pulse_sell",      suite: "pulse",     module: "sig",  tier: "essential", dirs: true, strength: true,  tkey: "suiteEvPulseSell",     en: "Pulse sell signal" },
  { event: "pulse_div",       suite: "pulse",     module: "div",  tier: "pro",       dirs: true, strength: true,  tkey: "suiteEvPulseDiv",      en: "Pulse divergence" },
  // RSI Ultimate
  { event: "rsix_reversal",   suite: "rsix",      module: "sig",  tier: "essential", dirs: true, strength: true,  tkey: "suiteEvRsixReversal",  en: "RSI reversal signal" },
  { event: "rsix_div",        suite: "rsix",      module: "div",  tier: "pro",       dirs: true, strength: true,  tkey: "suiteEvRsixDiv",       en: "RSI divergence" },
  { event: "rsix_chan_break", suite: "rsix",      module: "chan", tier: "pro",       dirs: true, strength: true,  tkey: "suiteEvRsixChanBreak", en: "RSI channel break" },
  // MACD Ultimate
  { event: "macdx_signal",    suite: "macdx",     module: "sig",  tier: "essential", dirs: true, strength: true,  tkey: "suiteEvMacdxSignal",   en: "MACD cross signal" },
  { event: "macdx_div",       suite: "macdx",     module: "div",  tier: "pro",       dirs: true, strength: true,  tkey: "suiteEvMacdxDiv",      en: "MACD divergence" },
  { event: "macdx_hist_flip", suite: "macdx",     module: "hist", tier: "essential", dirs: true, strength: true,  tkey: "suiteEvMacdxHistFlip", en: "MACD histogram flip" },
];

/** zh display names for suiteAlertPreview (the catalog stays UI-framework-free; LEX
 *  integration uses tkey — these are the same strings the LEX entries should carry). */
const ZH_EVENT_NAMES: Record<string, string> = {
  bos: "结构突破 (BOS)",
  choch: "结构反转 (CHoCH)",
  cisd: "CISD（失败交付）",
  ob_touch: "订单块触及",
  ob_break: "订单块破位",
  fvg_retest: "公允价值缺口回补",
  ifvg: "反转缺口 (iFVG)",
  liq_grab: "流动性掠夺",
  sfp: "摆动失败形态 (SFP)",
  pd_golden_touch: "黄金区触及",
  te_flip: "趋势引擎翻转",
  te_power: "趋势引擎强动能",
  te_tp_hit: "趋势引擎止盈触达",
  te_sl_hit: "趋势引擎止损触发",
  fb_turn: "流向带转向",
  vb_retest: "波动带回测",
  pulse_buy: "脉冲买入信号",
  pulse_sell: "脉冲卖出信号",
  pulse_div: "脉冲背离",
  rsix_reversal: "RSI 反转信号",
  rsix_div: "RSI 背离",
  rsix_chan_break: "RSI 通道突破",
  macdx_signal: "MACD 交叉信号",
  macdx_div: "MACD 背离",
  macdx_hist_flip: "MACD 柱状图翻转",
};

const EVENT_BY_TYPE: Map<string, SuiteAlertEventDef> = new Map(
  SUITE_ALERT_EVENTS.map((d) => [d.event, d]),
);

export function suiteAlertEventDef(event: string): SuiteAlertEventDef | null {
  return EVENT_BY_TYPE.get(event) ?? null;
}

// ─────────────────────────────────────────────────────────────────────── condition

export type SuiteAlertCondition = {
  type: "suite_event";
  suite: string;
  event: string;
  dir?: "bull" | "bear";
  minStrength?: number;                 // 0..100; only valid for strength-scored events
  _se?: { lastFiredT?: number; clockVersion?: 2 }; // absent version = legacy anchor clock
};

/** How many trailing bars count as "fresh" — an event older than this never fires. */
export const SUITE_EVENT_FRESH_BARS = 3;

const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/**
 * Structural + catalog validation. Returns a human-readable reason string when the
 * condition is invalid, or null when it is well-formed. Tier vetting is NOT done here
 * (the catalog exposes each event's tier; the POST route owns the entitlement check).
 */
export function validateSuiteCondition(cond: unknown): string | null {
  if (!cond || typeof cond !== "object") return "condition is not an object";
  const c = cond as Record<string, unknown>;
  if (c.type !== "suite_event") return `condition type is ${JSON.stringify(c.type)}, not "suite_event"`;
  if (typeof c.event !== "string" || !c.event) return "missing event";
  const def = EVENT_BY_TYPE.get(c.event);
  if (!def) return `unknown suite event "${c.event}"`;
  if (typeof c.suite !== "string" || !c.suite) return "missing suite";
  if (c.suite !== def.suite) return `event "${def.event}" belongs to suite "${def.suite}", not "${c.suite}"`;
  if (c.dir !== undefined) {
    if (c.dir !== "bull" && c.dir !== "bear") return `dir must be "bull" or "bear", got ${JSON.stringify(c.dir)}`;
    if (!def.dirs) return `event "${def.event}" carries no direction`;
  }
  if (c.minStrength !== undefined) {
    if (!isNum(c.minStrength) || c.minStrength < 0 || c.minStrength > 100) {
      return `minStrength must be a number in 0..100, got ${JSON.stringify(c.minStrength)}`;
    }
    if (!def.strength) return `event "${def.event}" carries no strength score`;
  }
  return null;
}

// ───────────────────────────────────────────────────────── source-bar confirmation clock

export interface SuiteEventTiming {
  anchorI: number;
  confirmedI: number;
  anchorT: number;
  confirmedT: number;
}

/** Resolve the same causal clock for alerts, sequences and the sidecar preview.
 * Never reinterpret malformed metadata as an immediate event. These timestamps are
 * source-bar identities, NOT wall-clock delivery times or proof a live bar closed. */
export function suiteEventTiming(e: SuiteEvent, barsT: number[]): SuiteEventTiming | null {
  if (!e || !Array.isArray(barsT) || !Number.isInteger(e.i) || e.i < 0 || e.i >= barsT.length) return null;
  const confirmedI = e.confirmedAt === undefined ? e.i : e.confirmedAt;
  if (!Number.isInteger(confirmedI) || confirmedI < e.i || confirmedI >= barsT.length) return null;
  const anchorT = barsT[e.i], confirmedT = barsT[confirmedI];
  if (!isNum(anchorT) || !isNum(confirmedT) || confirmedT < anchorT) return null;
  return { anchorI: e.i, confirmedI, anchorT, confirmedT };
}

type FireClock = { lastFiredT?: number; clockVersion?: 2 };
const supportedFireClock = (state: FireClock | undefined): boolean =>
  state?.clockVersion === undefined || state.clockVersion === 2;

/** Old fire stamps addressed anchors. Redating that already-delivered anchor must
 * not make it new again. New fire receipts explicitly opt into confirmation time. */
function afterFireWatermark(timing: SuiteEventTiming, state: FireClock | undefined): boolean {
  if (!isNum(state?.lastFiredT)) return true;
  return (state?.clockVersion === 2 ? timing.confirmedT : timing.anchorT) > state!.lastFiredT!;
}

// ─────────────────────────────────────────────────────────────────────── evaluator

export interface SuiteEventEvalResult {
  fired: boolean;
  value?: number;                       // strength for scored events, else the event price
  note?: string;                        // symbol-agnostic one-liner (the cron prefixes the symbol)
  state?: { lastFiredT: number; clockVersion: 2 }; // present ONLY on fire; confirmation-clock watermark
}

/** "YYYY-MM-DD" (plus " HH:MM" when the epoch has an intraday component), UTC. Pure. */
function stampOf(epochSec: number): string {
  const d = new Date(epochSec * 1000);
  const iso = d.toISOString();
  return epochSec % 86400 === 0 ? iso.slice(0, 10) : `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

/**
 * Evaluate a suite_event condition against a module's SuiteEvent stream.
 *
 * @param events the OWNING suite's merged event stream from computeSuite()
 * @param barsT  source-bar epoch seconds. i anchors geometry; confirmedAt dates knowability.
 * @param floorT creation floor in epoch secs. Only later confirmations qualify; prior
 *               delivery is separately fenced by its legacy/v2 fire-clock watermark.
 *
 * Fires on the NEWEST matching event that clears BOTH the floor and the
 * SUITE_EVENT_FRESH_BARS freshness window. false is "armed, not met"; the caller
 * decides "cannot evaluate" (missing bars / broken suite) before calling.
 */
/** Floor an epoch-seconds timestamp to 00:00 UTC of its calendar day, minus 1s — daily bars carry
 *  UTC-midnight keys, so an alert created intraday on day D must still see day-D events (mirrors the
 *  Python engine's created_at[:10] date-granular comparison). */
export function floorToUtcDayStart(epochSec: number): number {
  const d = new Date(epochSec * 1000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000 - 1;
}

export function evalSuiteEvent(
  cond: SuiteAlertCondition,
  events: SuiteEvent[],
  barsT: number[],
  floorT: number,
): SuiteEventEvalResult {
  const def = EVENT_BY_TYPE.get(cond?.event ?? "");
  if (!def || !Array.isArray(events) || !Array.isArray(barsT) || barsT.length === 0) {
    return { fired: false };
  }
  if (!supportedFireClock(cond._se)) return { fired: false };
  const floor = isNum(floorT) ? floorT : -Infinity;
  const freshFrom = Math.max(0, barsT.length - SUITE_EVENT_FRESH_BARS);

  let best: SuiteEvent | null = null;
  let bestT = -Infinity;
  for (const e of events) {
    if (!e || e.type !== cond.event) continue;
    if (cond.dir !== undefined && e.dir !== cond.dir) continue;
    if (cond.minStrength !== undefined && !(isNum(e.strength) && e.strength >= cond.minStrength)) continue;
    const timing = suiteEventTiming(e, barsT);
    if (!timing || timing.confirmedI < freshFrom) continue; // fresh since confirmation, not the pivot
    const t = timing.confirmedT;
    if (t <= floor || !afterFireWatermark(timing, cond._se)) continue;
    if (t >= bestT) { best = e; bestT = t; }     // >= : same-bar ties → the later-emitted event wins
  }
  if (!best) return { fired: false };

  const value = def.strength && isNum(best.strength) ? Math.round(best.strength) : isNum(best.p) ? best.p : undefined;
  const dirWord = best.dir === "bull" ? " (bullish)" : best.dir === "bear" ? " (bearish)" : "";
  const strWord = def.strength && isNum(best.strength) ? `, strength ${Math.round(best.strength)}` : "";
  const timing = suiteEventTiming(best, barsT)!;
  const confirmation = timing.confirmedI > timing.anchorI
    ? ` (confirmed; anchor ${stampOf(timing.anchorT)}, ${timing.confirmedI - timing.anchorI} bars earlier)` : "";
  const note = `${def.en}${dirWord}${strWord} on ${stampOf(bestT)}${confirmation} — ${def.suite} suite, daily bars, module defaults`;
  return { fired: true, value, note, state: { lastFiredT: bestT, clockVersion: 2 } };
}

// ────────────────────────────────────────────────── two-step sequence (suite_sequence)

/**
 * "Event A then event B within N bars" — same-suite, bar-ordered. The steps ARRAY is the
 * forward-compatible shape (a 5-step chain is the same machine with more hops); only the
 * validator pins length 2 today.
 *
 * _sq is the engine's persisted state (mirrors _se, but genuinely stateful):
 *   stepIdx 0 = waiting for step A;  stepIdx 1 = armed at armedT, waiting for step B.
 *   lastFiredT = dedupe watermark — after a fire, a step-A event at or before it never re-arms.
 */
export type SuiteSequenceCondition = {
  type: "suite_sequence";
  suite: string;
  steps: Array<{ event: string; dir?: "bull" | "bear" }>;
  maxBarsBetween: number;               // bar-index gap allowed between A and B, 2..50
  _sq?: SuiteSequenceState;             // engine state (persisted on EVERY change)
};

export interface SuiteSequenceState {
  stepIdx: number;                      // 0 = idle, 1 = armed
  armedT?: number;                      // epoch secs of the arming (step A) bar, when armed
  lastFiredT?: number;                  // epoch secs of the last completed fire (step B bar)
  clockVersion?: 2;                     // absent = lastFiredT still uses the legacy anchor clock
}

/**
 * Structural + catalog validation for suite_sequence. Reason string when invalid, null
 * when well-formed. Tier vetting stays with the POST route (highest tier across steps).
 */
export function validateSuiteSequence(cond: unknown): string | null {
  if (!cond || typeof cond !== "object") return "condition is not an object";
  const c = cond as Record<string, unknown>;
  if (c.type !== "suite_sequence") return `condition type is ${JSON.stringify(c.type)}, not "suite_sequence"`;
  if (typeof c.suite !== "string" || !c.suite) return "missing suite";
  const steps = c.steps;
  if (!Array.isArray(steps) || steps.length === 0) return "missing steps";
  // Exactly 2 for now: the evaluator's replay machine and the preview strings are written
  // for a single A→B hop. The condition SHAPE (steps[]) already carries longer chains —
  // lift this check and generalize evalSuiteSequence's arm/complete pair (and the preview
  // join) when sequences grow to up-to-5 steps.
  if (steps.length !== 2) return `sequences support exactly 2 steps for now, got ${steps.length}`;
  for (let n = 0; n < steps.length; n++) {
    const s = steps[n] as Record<string, unknown> | null;
    if (!s || typeof s !== "object") return `step ${n + 1} is not an object`;
    if (typeof s.event !== "string" || !s.event) return `step ${n + 1} is missing its event`;
    const def = EVENT_BY_TYPE.get(s.event);
    if (!def) return `unknown suite event "${s.event}" in step ${n + 1}`;
    if (def.suite !== c.suite) {
      return `step ${n + 1} event "${def.event}" belongs to suite "${def.suite}", not "${c.suite}" — sequence steps must share one suite`;
    }
    if (s.dir !== undefined) {
      if (s.dir !== "bull" && s.dir !== "bear") return `step ${n + 1} dir must be "bull" or "bear", got ${JSON.stringify(s.dir)}`;
      if (!def.dirs) return `event "${def.event}" carries no direction`;
    }
  }
  if (!isNum(c.maxBarsBetween) || !Number.isInteger(c.maxBarsBetween) || c.maxBarsBetween < 2 || c.maxBarsBetween > 50) {
    return `maxBarsBetween must be an integer in 2..50, got ${JSON.stringify(c.maxBarsBetween)}`;
  }
  return null;
}

export interface SuiteSequenceEvalResult {
  fired: boolean;
  value?: number;                       // step-B strength for scored events, else its price
  note?: string;                        // symbol-agnostic one-liner (the cron prefixes the symbol)
  /** Present on fire, AND on any armed/disarmed change vs cond._sq — the caller persists
   *  it on _sq every time it appears (this path is genuinely stateful, unlike _se). */
  state?: SuiteSequenceState;
}

/**
 * Confirmation-ordered state machine over the existing event stream. Replay clears
 * the creation floor and the separately versioned preceding-fire watermark:
 *   • a step-A match arms {stepIdx:1, armedT} (arming needs no freshness — it may predate
 *     this run by many bars);
 *   • a step-B match on a LATER bar within maxBarsBetween bars of the arming bar completes;
 *   • a gap beyond maxBarsBetween disarms back to {stepIdx:0}.
 * The NEWEST completion fires only if its step-B bar sits inside the last
 * SUITE_EVENT_FRESH_BARS bars (fresh-only law — a sequence that completed while the cron
 * was down is stale history, never a late fire). Fire state = {stepIdx:0, lastFiredT}.
 * floorT is the same day-floored creation floor the caller passes to evalSuiteEvent.
 */
export function evalSuiteSequence(
  cond: SuiteSequenceCondition,
  events: SuiteEvent[],
  barsT: number[],
  floorT: number,
): SuiteSequenceEvalResult {
  const steps = Array.isArray(cond?.steps) ? cond.steps : [];
  const defA = EVENT_BY_TYPE.get(steps[0]?.event ?? "");
  const defB = EVENT_BY_TYPE.get(steps[1]?.event ?? "");
  const maxGap = cond?.maxBarsBetween;
  if (
    steps.length !== 2 || !defA || !defB || !isNum(maxGap) ||
    !Array.isArray(events) || !Array.isArray(barsT) || barsT.length === 0
  ) {
    return { fired: false };
  }
  const prev = cond._sq;
  if (!supportedFireClock(prev)) return { fired: false };
  const prevLastFired = isNum(prev?.lastFiredT) ? (prev!.lastFiredT as number) : undefined;
  const floor = isNum(floorT) ? floorT : -Infinity;

  // Candidate confirmations above the floor, ordered by knowability, not drawn anchors.
  const matches = (s: { event: string; dir?: "bull" | "bear" }, def: SuiteAlertEventDef, e: SuiteEvent) =>
    e.type === def.event && (s.dir === undefined || e.dir === s.dir);
  const cands: Array<{ i: number; t: number; e: SuiteEvent; mA: boolean; mB: boolean }> = [];
  for (const e of events) {
    const timing = suiteEventTiming(e, barsT);
    if (!timing || timing.confirmedT <= floor || !afterFireWatermark(timing, prev)) continue;
    const mA = matches(steps[0], defA, e);
    const mB = matches(steps[1], defB, e);
    if (mA || mB) cands.push({ i: timing.confirmedI, t: timing.confirmedT, e, mA, mB });
  }
  cands.sort((a, b) => a.i - b.i);

  // Replay. dedupeT: within this run, an arm after a completion needs a strictly later event.
  let stepIdx = 0;
  let armedI = -1;
  let armedT: number | undefined;
  let dedupeT = -Infinity;
  let best: { i: number; t: number; e: SuiteEvent } | null = null; // newest completion
  for (const c of cands) {
    if (stepIdx === 1 && c.i - armedI > maxGap) { stepIdx = 0; armedI = -1; armedT = undefined; } // expiry
    if (stepIdx === 1 && c.mB && c.i > armedI) {  // B strictly after A in bar terms
      best = { i: c.i, t: c.t, e: c.e };
      dedupeT = c.t;
      stepIdx = 0; armedI = -1; armedT = undefined;
      continue;
    }
    if (stepIdx === 0 && c.mA && c.t > dedupeT) { stepIdx = 1; armedI = c.i; armedT = c.t; }
  }
  // Trailing expiry: armed, but the newest bar already sits past the window — B can never come.
  if (stepIdx === 1 && barsT.length - 1 - armedI > maxGap) { stepIdx = 0; armedI = -1; armedT = undefined; }

  const dirWord = (s: { dir?: "bull" | "bear" }) =>
    s.dir === "bull" ? " (bullish)" : s.dir === "bear" ? " (bearish)" : "";

  const freshFrom = Math.max(0, barsT.length - SUITE_EVENT_FRESH_BARS);
  if (best && best.i >= freshFrom) {
    const value = defB.strength && isNum(best.e.strength) ? Math.round(best.e.strength)
      : isNum(best.e.p) ? best.e.p : undefined;
    const note =
      `Sequence ${defA.en}${dirWord(steps[0])} → ${defB.en}${dirWord(steps[1])} completed on ` +
      `${stampOf(best.t)} (within ${maxGap} bars) — ${defA.suite} suite, daily bars, module defaults`;
    return { fired: true, value, note, state: { stepIdx: 0, lastFiredT: best.t, clockVersion: 2 } };
  }

  // No fire. Emit the final machine state ONLY when it differs from the persisted _sq
  // (idle → idle stays PATCH-free; arm / disarm / stale-completion consumption persist).
  const finalState: SuiteSequenceState = {
    stepIdx,
    ...(armedT !== undefined ? { armedT } : {}),
    ...(prevLastFired !== undefined ? { lastFiredT: prevLastFired } : {}),
    // An arm/disarm update is NOT a migration of the preceding fire stamp.
    ...(prevLastFired !== undefined && prev?.clockVersion === 2 ? { clockVersion: 2 as const } : {}),
  };
  const prevIdx = prev?.stepIdx === 1 ? 1 : 0;
  const prevArmedT = isNum(prev?.armedT) ? prev!.armedT : undefined;
  const changed = finalState.stepIdx !== prevIdx || finalState.armedT !== prevArmedT;
  return changed ? { fired: false, state: finalState } : { fired: false };
}

// ─────────────────────────────────────────────────────────── creation preview (UI)

/**
 * Plain-word "what will fire" line for the creation preview, mirroring
 * optAlertPreview in lib/optionsAlerts.ts. Symbol-agnostic (the alert row carries
 * the symbol); honest about the evaluation basis (daily bars, module defaults).
 */
export function suiteAlertPreview(cond: SuiteAlertCondition, lang: "en" | "zh"): string {
  const def = EVENT_BY_TYPE.get(cond?.event ?? "");
  const zh = lang === "zh";
  if (!def) return zh ? "未知的套件事件" : "Unknown suite event";
  const minS = isNum(cond.minStrength) ? cond.minStrength : undefined;
  if (zh) {
    const name = ZH_EVENT_NAMES[def.event] || def.en;
    const dirTxt = cond.dir === "bull" ? "（看涨）" : cond.dir === "bear" ? "（看跌）" : "";
    const strTxt = minS !== undefined ? `且强度 ≥ ${minS} ` : "";
    return `当日线图出现${name}${dirTxt}${strTxt}时提醒我（按模块默认参数评估）`;
  }
  const dirTxt = cond.dir === "bull" ? " bullish" : cond.dir === "bear" ? " bearish" : "";
  const strTxt = minS !== undefined ? ` at strength ≥ ${minS}` : "";
  return `Alert me on a${dirTxt} ${def.en}${strTxt} on the daily chart (module defaults)`;
}

/** Sequence preview: "BOS (bullish) → FVG retest, within 10 bars" / zh equivalent. */
export function suiteSequencePreview(cond: SuiteSequenceCondition, lang: "en" | "zh"): string {
  const zh = lang === "zh";
  const steps = Array.isArray(cond?.steps) ? cond.steps : [];
  const defA = EVENT_BY_TYPE.get(steps[0]?.event ?? "");
  const defB = EVENT_BY_TYPE.get(steps[1]?.event ?? "");
  if (steps.length !== 2 || !defA || !defB) return zh ? "未知的套件事件" : "Unknown suite event";
  const gap = isNum(cond.maxBarsBetween) ? cond.maxBarsBetween : 10;
  if (zh) {
    const name = (d: SuiteAlertEventDef, s: { dir?: "bull" | "bear" }) =>
      `${ZH_EVENT_NAMES[d.event] || d.en}${s.dir === "bull" ? "（看涨）" : s.dir === "bear" ? "（看跌）" : ""}`;
    return `${name(defA, steps[0])} → ${name(defB, steps[1])}，${gap} 根K线内（日线，按模块默认参数评估）`;
  }
  const name = (d: SuiteAlertEventDef, s: { dir?: "bull" | "bear" }) =>
    `${d.en}${s.dir === "bull" ? " (bullish)" : s.dir === "bear" ? " (bearish)" : ""}`;
  return `${name(defA, steps[0])} → ${name(defB, steps[1])}, within ${gap} bars (daily, module defaults)`;
}
