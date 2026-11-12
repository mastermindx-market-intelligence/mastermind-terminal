/**
 * alertDryRunContract.ts — the wire vocabulary of the read-only alert dry run
 * (POST /api/alerts/dry-run). Dependency-free so the client panel can read a response without
 * pulling suite computation into its bundle. The decision itself lives in lib/alertDryRun.ts.
 */

export const ALERT_DRY_RUN_SCHEMA = "alert-dry-run/1" as const;

/**
 * would_trigger   — on this data, a NEW alert's next evaluation fires.
 * not_met         — evaluated; the condition is not met, so the alert would stay armed and wait.
 * cannot_evaluate — an input is missing, stale or not permitted. Says nothing about the condition.
 * unsupported     — this preview does not evaluate the request (type, or supplied state).
 */
export type DryRunVerdict = "would_trigger" | "not_met" | "cannot_evaluate" | "unsupported";

export type DryRunReason =
  | "signed_out"
  | "plan_not_confirmed"
  | "rate_limited"
  | "malformed"
  | "invalid_symbol"
  | "no_data"
  | "stale_data"
  | "compute_failed"
  | "unsupported_type"
  | "supplied_state";

export type DryRunTier = "free" | "essential" | "pro";

export type DryRunTraceStatus = "pass" | "fail" | "skipped" | "not_applicable" | "unsupported";

/** One bounded step of the explanation. `id` is stable vocabulary; the UI localizes it. */
export interface DryRunTraceStep {
  id: "data" | "fresh_window" | "event_in_window" | "filters" | "creation_floor"
    | "initial_state" | "sequence_replay" | "prior_history";
  status: DryRunTraceStatus;
  /** Confirmation date ("YYYY-MM-DD") of the event that step's evaluator call selected. */
  at?: string;
}

export interface DryRunConditionIdentity {
  type: "suite_event" | "suite_sequence";
  suite: string;
  /** Stable identity: "rsix:rsix_div", "rsix:rsix_div>rsix_x". */
  key: string;
  steps: Array<{ event: string; label: string; dir?: "bull" | "bear"; minStrength?: number }>;
  maxBarsBetween?: number;
  tier: DryRunTier;
}

export interface DryRunClocks {
  /** Wall clock the preview ran at (ISO). */
  evaluatedAt: string;
  /** Availability: newest daily bar the source file holds, and the file's own write time. */
  lastBarDate: string;
  barCount: number;
  sourceAsOf: string | null;
  /** The firing lane's freshness window: an event must CONFIRM on one of these bars. */
  freshFrom: string;
  freshTo: string;
  /** A new alert only counts confirmations on/after this UTC day. */
  creationFloorDate: string;
}

export interface DryRunRecentEvent {
  event: string;
  dir?: "bull" | "bear";
  strength?: number;
  /** Event clock: the bar the event is drawn on vs the bar it became knowable on. */
  anchorDate: string;
  confirmedDate: string;
}

export interface DryRunSequenceState {
  /** What the replay STARTED from: always the new alert's exact initial state. */
  input: "initial";
  /** What it ENDED at. "simulated" = computed by this preview, never read from or written to a store. */
  output: "idle" | "simulated_armed" | "completed";
  armedDate?: string;
}

export interface DryRunResult {
  schema: typeof ALERT_DRY_RUN_SCHEMA;
  /** Constant: nothing was created, armed, acknowledged or sent. */
  readOnly: true;
  verdict: DryRunVerdict;
  reason?: DryRunReason;
  /** Machine-generated English detail for malformed / unsupported inputs. */
  detail?: string;
  symbol?: string;
  timeframe?: "1D";
  basis?: "daily_bars_module_defaults";
  condition?: DryRunConditionIdentity;
  /** Plan tier the condition needs (present when the plan could not be confirmed). */
  requiredTier?: DryRunTier;
  clocks?: DryRunClocks;
  /** The canonical evaluator's own note + value when it fires. */
  decision?: { fired: boolean; note?: string; value?: number; confirmedDate?: string };
  trace?: DryRunTraceStep[];
  recent?: DryRunRecentEvent[];
  sequenceState?: DryRunSequenceState;
}

/** Older than this (calendar days before today, UTC) and the bars cannot answer "right now". */
export const DRY_RUN_MAX_BAR_AGE_DAYS = 5;
/** Bounded explanation: at most this many recent events are listed. */
export const DRY_RUN_RECENT_EVENTS = 5;

export function dryRunResult(verdict: DryRunVerdict, extra: Partial<DryRunResult> = {}): DryRunResult {
  return { ...extra, schema: ALERT_DRY_RUN_SCHEMA, readOnly: true, verdict };
}

// ──────────────────────────────────────────────────────────────────────────── client reading

const VERDICTS: ReadonlySet<string> = new Set(["would_trigger", "not_met", "cannot_evaluate", "unsupported"]);

/**
 * Client-side admission of a response body. Anything that is not a well-formed dry-run result
 * (a gateway page, a 5xx, a truncated body) is null → "unavailable", NEVER "not met".
 */
export function readDryRunResult(body: unknown): DryRunResult | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (b.schema !== ALERT_DRY_RUN_SCHEMA || b.readOnly !== true || typeof b.verdict !== "string") return null;
  if (!VERDICTS.has(b.verdict)) return null;
  if ((b.verdict === "would_trigger" || b.verdict === "not_met") && (!b.clocks || !b.condition || !b.decision)) return null;
  return body as DryRunResult;
}
