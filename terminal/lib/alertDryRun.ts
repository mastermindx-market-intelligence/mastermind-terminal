/**
 * alertDryRun.ts — "would this alert trigger right now?" for a suite alert that has NOT been
 * created yet. Read-only by construction.
 *
 * WHAT DECIDES: only the canonical evaluators in lib/suiteAlerts.ts (evalSuiteEvent /
 * evalSuiteSequence), fed through the SAME input adapter the firing sidecar uses
 * (lib/suiteAlertInputs.ts: bar parser, module-defaults compute, creation floor). This file holds
 * no condition predicate of its own — the trace below is built from extra calls to the same
 * evaluator with one input relaxed, never from a re-implemented filter. If the evaluator changes,
 * the preview changes with it.
 *
 * WHAT IT CAN NEVER DO: write. The orchestrator's dependencies are read-only by type (read the
 * symbol's bar file, compute the suite, ask whether the plan admits the tier). There is no store,
 * outbox, notifier or re-arm handle anywhere in the graph, so no code path — success, refusal,
 * error or cancellation — can create, arm, acknowledge or deliver an alert.
 *
 * SCOPE: the two condition families evaluated by the Node suite lane (suite_event,
 * suite_sequence). Everything else — signal/regime/price/RSI and options-flow alerts — is
 * evaluated by the Python engine, which this preview does not run, so those answer
 * `unsupported`, never a guessed verdict.
 *
 * STATE: the dry run previews a NEW alert, whose exact state is "no prior events" — the same
 * state the firing lane sees on that alert's first evaluation. A condition that carries engine
 * state (_se / _sq / triggered) is refused (`unsupported`): this preview cannot prove that state
 * matches what the store recorded, and it never invents prior events to fill it in. Any armed
 * step a sequence replay reaches is labelled SIMULATED, never recorded.
 */

import {
  SUITE_EVENT_FRESH_BARS,
  evalSuiteEvent,
  evalSuiteSequence,
  suiteAlertEventDef,
  suiteEventTiming,
  validateSuiteCondition,
  validateSuiteSequence,
} from "./suiteAlerts";
import type { SuiteAlertCondition, SuiteSequenceCondition } from "./suiteAlerts";
import type { SuiteEvent } from "./indicator-canvas/types";
import { suiteAlertFloorT } from "./suiteAlertInputs";
import type { SuiteSymbolData } from "./suiteAlertInputs";

import {
  DRY_RUN_MAX_BAR_AGE_DAYS,
  DRY_RUN_RECENT_EVENTS,
  dryRunResult,
} from "./alertDryRunContract";
import type {
  DryRunClocks,
  DryRunConditionIdentity,
  DryRunRecentEvent,
  DryRunResult,
  DryRunSequenceState,
  DryRunTier,
  DryRunTraceStep,
} from "./alertDryRunContract";

export * from "./alertDryRunContract";

const ENGINE_STATE_KEYS = ["_se", "_sq", "triggered"] as const;
// Bar-file names: tickers (BRK.B, 0700.HK, BTC-USD), an optional index caret, underscores (fixture
// files). Path-safe by construction: no separators, and ".." is refused below.
const SYMBOL_RE = /^\^?[A-Z0-9][A-Z0-9._-]{0,23}$/;

const dayOf = (epochSec: number): string => new Date(epochSec * 1000).toISOString().slice(0, 10);

// ──────────────────────────────────────────────────────────────────────────── admission

export type DryRunAdmission =
  | { ok: true; symbol: string; kind: "event"; condition: SuiteAlertCondition }
  | { ok: true; symbol: string; kind: "sequence"; condition: SuiteSequenceCondition }
  | { ok: false; result: DryRunResult };

/** Upper-cased bar-file symbol, or null. No path separators, no traversal, bounded length. */
export function normalizeDryRunSymbol(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toUpperCase();
  if (!SYMBOL_RE.test(s) || s.includes("..")) return null;
  return s;
}

/**
 * Admit the exact request snapshot: {symbol, condition}. Order matters and is part of the
 * contract — supplied engine state is refused BEFORE validation so a condition can never smuggle
 * a recorded-looking state into the evaluator.
 */
export function admitDryRunRequest(body: unknown): DryRunAdmission {
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  const cond = b?.condition;
  if (!b || !cond || typeof cond !== "object" || Array.isArray(cond)) {
    return { ok: false, result: dryRunResult("cannot_evaluate", { reason: "malformed", detail: "body must be {symbol, condition}" }) };
  }
  const c = cond as Record<string, unknown>;
  if (c.type !== "suite_event" && c.type !== "suite_sequence") {
    return {
      ok: false,
      result: dryRunResult("unsupported", {
        reason: "unsupported_type",
        detail: `condition type ${JSON.stringify(c.type ?? null)} is evaluated by the server alert engine, which the dry run does not run`,
      }),
    };
  }
  const supplied = ENGINE_STATE_KEYS.filter((k) => Object.prototype.hasOwnProperty.call(c, k));
  if (supplied.length) {
    return {
      ok: false,
      result: dryRunResult("unsupported", {
        reason: "supplied_state",
        detail: `condition carries engine state (${supplied.join(", ")}); the dry run previews a new alert only`,
      }),
    };
  }
  const why = c.type === "suite_sequence" ? validateSuiteSequence(c) : validateSuiteCondition(c);
  if (why) return { ok: false, result: dryRunResult("cannot_evaluate", { reason: "malformed", detail: why }) };
  const symbol = normalizeDryRunSymbol(b.symbol);
  if (!symbol) return { ok: false, result: dryRunResult("cannot_evaluate", { reason: "invalid_symbol" }) };
  return c.type === "suite_sequence"
    ? { ok: true, symbol, kind: "sequence", condition: c as unknown as SuiteSequenceCondition }
    : { ok: true, symbol, kind: "event", condition: c as unknown as SuiteAlertCondition };
}

// ──────────────────────────────────────────────────────────────────────────── entitlement

const TIER_RANK: Record<DryRunTier, number> = { free: 0, essential: 1, pro: 2 };

function eventTier(event: string | undefined): DryRunTier {
  const def = suiteAlertEventDef(event ?? "");
  if (!def) return "pro";
  return def.tier === "free" || def.tier === "essential" ? def.tier : "pro";
}

/**
 * The plan tier the alerts POST route demands before it will store this condition: the event's
 * catalog tier, or the highest tier across a sequence's steps (an unknown event or empty steps
 * fail closed to "pro"). A dry run never evaluates what its creator could not save.
 */
export function dryRunRequiredTier(cond: SuiteAlertCondition | SuiteSequenceCondition): DryRunTier {
  if (cond.type === "suite_sequence") {
    const steps = Array.isArray(cond.steps) ? cond.steps : [];
    if (!steps.length) return "pro";
    return steps.reduce<DryRunTier>((hi, s) => {
      const t = eventTier(s?.event);
      return TIER_RANK[t] > TIER_RANK[hi] ? t : hi;
    }, "free");
  }
  return eventTier(cond.event);
}

function identityOf(cond: SuiteAlertCondition | SuiteSequenceCondition): DryRunConditionIdentity {
  const label = (event: string) => suiteAlertEventDef(event)?.en ?? event;
  if (cond.type === "suite_sequence") {
    return {
      type: "suite_sequence",
      suite: cond.suite,
      key: `${cond.suite}:${cond.steps.map((s) => s.event).join(">")}`,
      steps: cond.steps.map((s) => ({ event: s.event, label: label(s.event), ...(s.dir ? { dir: s.dir } : {}) })),
      maxBarsBetween: cond.maxBarsBetween,
      tier: dryRunRequiredTier(cond),
    };
  }
  return {
    type: "suite_event",
    suite: cond.suite,
    key: `${cond.suite}:${cond.event}`,
    steps: [{
      event: cond.event,
      label: label(cond.event),
      ...(cond.dir ? { dir: cond.dir } : {}),
      ...(cond.minStrength !== undefined ? { minStrength: cond.minStrength } : {}),
    }],
    tier: dryRunRequiredTier(cond),
  };
}

// ──────────────────────────────────────────────────────────────────────────── explanation

function clocksOf(data: SuiteSymbolData, nowMs: number, sourceAsOfMs: number | null, floorT: number): DryRunClocks {
  const n = data.barsT.length;
  return {
    evaluatedAt: new Date(nowMs).toISOString(),
    lastBarDate: dayOf(data.barsT[n - 1]),
    barCount: n,
    sourceAsOf: sourceAsOfMs !== null && Number.isFinite(sourceAsOfMs) ? new Date(sourceAsOfMs).toISOString() : null,
    freshFrom: dayOf(data.barsT[Math.max(0, n - SUITE_EVENT_FRESH_BARS)]),
    freshTo: dayOf(data.barsT[n - 1]),
    creationFloorDate: dayOf(floorT + 1),
  };
}

/** Whole calendar days between the newest bar's UTC day and `nowMs`'s UTC day. */
export function barAgeDays(data: SuiteSymbolData, nowMs: number): number {
  const last = data.barsT[data.barsT.length - 1];
  const today = Math.floor(nowMs / 86_400_000) * 86_400;
  return Math.floor((today - Math.floor(last / 86_400) * 86_400) / 86_400);
}

/** Newest N events of the requested types, by confirmation. Raw facts from the canonical clock. */
function recentOf(events: SuiteEvent[], barsT: number[], types: string[]): DryRunRecentEvent[] {
  const rows: Array<{ t: number; row: DryRunRecentEvent }> = [];
  for (const e of events) {
    if (!e || !types.includes(e.type)) continue;
    const timing = suiteEventTiming(e, barsT);
    if (!timing) continue;
    rows.push({
      t: timing.confirmedT,
      row: {
        event: e.type,
        ...(e.dir === "bull" || e.dir === "bear" ? { dir: e.dir } : {}),
        ...(typeof e.strength === "number" && Number.isFinite(e.strength) ? { strength: Math.round(e.strength) } : {}),
        anchorDate: dayOf(timing.anchorT),
        confirmedDate: dayOf(timing.confirmedT),
      },
    });
  }
  rows.sort((a, b) => b.t - a.t);
  return rows.slice(0, DRY_RUN_RECENT_EVENTS).map((x) => x.row);
}

const firedAt = (r: { fired: boolean; state?: { lastFiredT?: number } }): string | undefined =>
  r.fired && typeof r.state?.lastFiredT === "number" ? dayOf(r.state.lastFiredT) : undefined;

export interface DryRunExplainInput {
  symbol: string;
  kind: "event" | "sequence";
  condition: SuiteAlertCondition | SuiteSequenceCondition;
  data: SuiteSymbolData;
  events: SuiteEvent[];
  nowMs: number;
  sourceAsOfMs: number | null;
}

/**
 * Decide + explain. The verdict is the canonical evaluator's `fired` with the creation floor a
 * NEW alert created at `nowMs` would carry — the exact call the firing lane makes on that alert's
 * first run over these bars.
 */
export function explainDryRun(input: DryRunExplainInput): DryRunResult {
  const { symbol, kind, condition, data, events, nowMs, sourceAsOfMs } = input;
  const floorT = suiteAlertFloorT(new Date(nowMs).toISOString());
  const base = {
    symbol,
    timeframe: "1D" as const,
    basis: "daily_bars_module_defaults" as const,
    condition: identityOf(condition),
    clocks: clocksOf(data, nowMs, sourceAsOfMs, floorT),
  };

  if (kind === "event") {
    const cond = condition as SuiteAlertCondition;
    // THE decision.
    const r = evalSuiteEvent(cond, events, data.barsT, floorT);
    // Trace probes: the SAME evaluator with one input relaxed (no creation floor; then also no
    // direction/strength filter). Each relaxation can only add candidates, so the chain is monotone.
    const noFloor = evalSuiteEvent(cond, events, data.barsT, Number.NEGATIVE_INFINITY);
    const bare: SuiteAlertCondition = { type: "suite_event", suite: cond.suite, event: cond.event };
    const anyInWindow = evalSuiteEvent(bare, events, data.barsT, Number.NEGATIVE_INFINITY);
    const hasFilters = cond.dir !== undefined || cond.minStrength !== undefined;
    const trace: DryRunTraceStep[] = [
      { id: "data", status: "pass" },
      { id: "fresh_window", status: "pass" },
      { id: "event_in_window", status: anyInWindow.fired ? "pass" : "fail", at: firedAt(anyInWindow) },
      {
        id: "filters",
        status: !hasFilters ? "not_applicable" : !anyInWindow.fired ? "skipped" : noFloor.fired ? "pass" : "fail",
        at: hasFilters ? firedAt(noFloor) : undefined,
      },
      { id: "creation_floor", status: !noFloor.fired ? "skipped" : r.fired ? "pass" : "fail", at: firedAt(r) },
    ];
    return dryRunResult(r.fired ? "would_trigger" : "not_met", {
      ...base,
      decision: { fired: r.fired, note: r.note, value: r.value, confirmedDate: firedAt(r) },
      trace: trace.map((s) => (s.at === undefined ? { id: s.id, status: s.status } : s)),
      recent: recentOf(events, data.barsT, [cond.event]),
    });
  }

  const cond = condition as SuiteSequenceCondition;
  // THE decision, from the new alert's exact initial state (no _sq: admission refused any).
  const r = evalSuiteSequence(cond, events, data.barsT, floorT);
  const armed = !r.fired && r.state?.stepIdx === 1 && typeof r.state.armedT === "number";
  const sequenceState: DryRunSequenceState = r.fired
    ? { input: "initial", output: "completed" }
    : armed
      ? { input: "initial", output: "simulated_armed", armedDate: dayOf(r.state!.armedT!) }
      : { input: "initial", output: "idle" };
  const trace: DryRunTraceStep[] = [
    { id: "data", status: "pass" },
    { id: "fresh_window", status: "pass" },
    { id: "initial_state", status: "pass" },
    { id: "sequence_replay", status: r.fired ? "pass" : "fail", ...(firedAt(r) ? { at: firedAt(r) } : {}) },
    // Replaying confirmations BEFORE the creation floor would fabricate an arming this alert never
    // recorded. Refused, not approximated.
    { id: "prior_history", status: "unsupported" },
  ];
  return dryRunResult(r.fired ? "would_trigger" : "not_met", {
    ...base,
    decision: { fired: r.fired, note: r.note, value: r.value, confirmedDate: firedAt(r) },
    trace,
    recent: recentOf(events, data.barsT, [...new Set(cond.steps.map((s) => s.event))]),
    sequenceState,
  });
}

// ──────────────────────────────────────────────────────────────────────────── orchestration

/** Everything the dry run may touch. Read-only by type: there is no write handle to inject. */
export interface DryRunDeps {
  /** Parsed `<SYM>.json` plus its write time, or null when the file is absent/unreadable. */
  readSymbolDoc(symbol: string): Promise<{ doc: unknown; asOfMs: number | null } | null>;
  /** The shared adapter's parser (lib/suiteAlertInputs.ts parseSuiteDailyBars). */
  parseBars(doc: unknown): SuiteSymbolData | null;
  /** The shared adapter's compute (lib/suiteAlertInputs.ts suiteEventsAtDefaults). */
  computeEvents(suite: string, symbol: string, data: SuiteSymbolData, nowMs?: number): Promise<SuiteEvent[]>;
  /** Does the caller's plan admit this tier? Fail-closed: an unreachable authority answers false. */
  planAdmits(tier: DryRunTier): Promise<boolean>;
  nowMs(): number;
  /** Aborted by the client: stop before any further read. */
  signal?: AbortSignal;
}

export class DryRunAborted extends Error {
  constructor() {
    super("dry run aborted");
    this.name = "DryRunAborted";
  }
}

const checkAbort = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DryRunAborted();
};

/**
 * Body (already authenticated) → verdict. Order: admission → plan → bars → freshness → compute →
 * canonical evaluation. Every early exit is cannot_evaluate / unsupported, never not_met.
 */
export async function runAlertDryRun(body: unknown, deps: DryRunDeps): Promise<DryRunResult> {
  const admitted = admitDryRunRequest(body);
  if (!admitted.ok) return admitted.result;
  const { symbol, kind, condition } = admitted;
  const tier = dryRunRequiredTier(condition);
  const identity = { symbol, condition: identityOf(condition) };

  checkAbort(deps.signal);
  if (tier !== "free" && !(await deps.planAdmits(tier))) {
    return dryRunResult("cannot_evaluate", { ...identity, reason: "plan_not_confirmed", requiredTier: tier });
  }

  checkAbort(deps.signal);
  const read = await deps.readSymbolDoc(symbol);
  const data = read ? deps.parseBars(read.doc) : null;
  if (!read || !data) return dryRunResult("cannot_evaluate", { ...identity, reason: "no_data" });

  const nowMs = deps.nowMs();
  if (barAgeDays(data, nowMs) > DRY_RUN_MAX_BAR_AGE_DAYS) {
    const floorT = suiteAlertFloorT(new Date(nowMs).toISOString());
    return dryRunResult("cannot_evaluate", {
      ...identity,
      reason: "stale_data",
      timeframe: "1D",
      basis: "daily_bars_module_defaults",
      clocks: clocksOf(data, nowMs, read.asOfMs, floorT),
    });
  }

  checkAbort(deps.signal);
  let events: SuiteEvent[];
  try {
    events = await deps.computeEvents(condition.suite, symbol, data, nowMs);
  } catch {
    return dryRunResult("cannot_evaluate", { ...identity, reason: "compute_failed" });
  }
  if (!Array.isArray(events)) return dryRunResult("cannot_evaluate", { ...identity, reason: "compute_failed" });
  checkAbort(deps.signal);

  return explainDryRun({ symbol, kind, condition, data, events, nowMs, sourceAsOfMs: read.asOfMs });
}
