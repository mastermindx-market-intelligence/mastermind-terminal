import { object, text } from "./sectorIntelligence";
import { strictDay } from "./sectorCycleRhythm";

/* ────────────────────────────────────────────────────────────────────────────
 * Per-head forecast capabilities (Sector Intelligence v1.1). Binds EXACTLY to
 * lane 8's published wire contract `sector_cycles.forecast_heads.v1`
 * (macro engine/sector_heads.py @3e6b51ef09fc): a per-record block carrying
 * the four remaining-opportunity heads, each judged ALONE — a head that
 * fails is withdrawn on its own and its siblings and the observed Cycles
 * facts stay untouched (SP10).
 *
 * This reader never invents a field, never re-dates a value, and never
 * surfaces a number: a head reading carries status/reason/target/horizon
 * text only. The strict key allowlist is the no-number invariant — a head
 * that tries to carry an estimate field outside the published contract is
 * refused per head (withheld, payload_invalid), never partially drawn.
 *
 * Qualification WITHDRAWAL is a first-class state: a head that was
 * qualified and no longer is reads as `withdrawn` with the date the
 * withdrawal took effect — never a stale pass.
 * ──────────────────────────────────────────────────────────────────────────── */

export const FORECAST_HEADS_SCHEMA = "sector_cycles.forecast_heads.v1";
export const FORECAST_HEAD_KEYS = [
  "remaining_return_distribution",
  "adverse_tail",
  "target_before_invalidation",
  "transition_time",
] as const;
export type ForecastHeadKey = (typeof FORECAST_HEAD_KEYS)[number];

export type ForecastHeadStatus = "qualified" | "withheld" | "withdrawn";

/** The published per-head fields, exactly (lane 8 contract). Anything else
 * on a head object is a contract violation — and a numeric one can never
 * become a shown value. */
const HEAD_WIRE_FIELDS = new Set([
  "status",
  "reason_code",
  "research_disposition",
  "research_reasons",
  "evidence",
  "target",
  "horizon_sessions",
  "market",
  "withdrawn_asof",
]);
const AUTHORITY_FLAGS = [
  "may_rank",
  "may_gate",
  "may_size",
  "may_trade",
  "may_escalate",
] as const;

const finite = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

export interface ForecastHeadEvidence {
  protocol: string | null;
  reportRef: string | null;
  resultsDoc: string | null;
}

export interface ForecastHead {
  key: ForecastHeadKey;
  status: ForecastHeadStatus;
  /** The published reason code, verbatim (rendered through the lexicon). */
  reasonCode: string | null;
  researchDisposition: string | null;
  /** What the head would measure — producer text, never a value. */
  target: string | null;
  /** Protocol horizon in completed sessions — a window, never an estimate. */
  horizonSessions: number | null;
  market: string | null;
  /** Present only on a withdrawn head: the date the withdrawal took effect. */
  withdrawnAsOf: string | null;
  evidence: ForecastHeadEvidence;
}

export type ForecastHeadsState = "ready" | "absent" | "invalid";

export interface ForecastHeadsReading {
  state: ForecastHeadsState;
  schema: string | null;
  observedCycles: "shown" | null;
  protocol: string | null;
  reportRef: string | null;
  /** All four heads in canonical order — one row each, judged alone. */
  heads: ForecastHead[];
}

const ABSENT: ForecastHeadsReading = {
  state: "absent",
  schema: null,
  observedCycles: null,
  protocol: null,
  reportRef: null,
  heads: [],
};

const isStatus = (v: unknown): v is ForecastHeadStatus =>
  v === "qualified" || v === "withheld" || v === "withdrawn";

/** Strict per-head read. Any contract violation degrades ONLY this head to
 * `withheld`/payload_invalid — siblings are never collateral damage (SP10). */
function readHead(key: ForecastHeadKey, raw: unknown): ForecastHead {
  const h = object(raw);
  const invalid: ForecastHead = {
    key,
    status: "withheld",
    reasonCode: "payload_invalid",
    researchDisposition: null,
    target: null,
    horizonSessions: null,
    market: null,
    withdrawnAsOf: null,
    evidence: { protocol: null, reportRef: null, resultsDoc: null },
  };
  // The wire contract is an exact allowlist: an unknown field is never
  // interpreted, and an estimate number can never become a shown value.
  for (const field of Object.keys(h)) {
    if (!HEAD_WIRE_FIELDS.has(field)) return invalid;
  }
  const status = h.status;
  if (!isStatus(status)) return invalid;
  // A withdrawal is never downgraded to a withholding — the two states are
  // distinct facts. The wire has not yet published the withdrawal date field,
  // so a withdrawn head without a date stays withdrawn, dated when the wire
  // carries one. A date on a live head is a contract violation.
  const withdrawnAsOf = strictDay(h.withdrawn_asof);
  if (status !== "withdrawn" && h.withdrawn_asof !== undefined) return invalid;
  const evidence = object(h.evidence);
  return {
    key,
    status,
    reasonCode: text(h.reason_code) || null,
    researchDisposition: text(h.research_disposition) || null,
    target: text(h.target) || null,
    horizonSessions: finite(h.horizon_sessions),
    market: text(h.market) || null,
    withdrawnAsOf: status === "withdrawn" ? withdrawnAsOf : null,
    evidence: {
      protocol: text(evidence.protocol) || null,
      reportRef: text(evidence.report_ref) || null,
      resultsDoc: text(evidence.results_doc) || null,
    },
  };
}

export function forecastHeadsReading(record: unknown): ForecastHeadsReading {
  const block = object(object(record).forecast_heads);
  if (!block.schema) return ABSENT;
  if (block.schema !== FORECAST_HEADS_SCHEMA) {
    return { ...ABSENT, state: "invalid", schema: text(block.schema) };
  }
  // Observed Cycles facts are the record's own; the block only ever
  // confirms they stay shown. Anything else is a contract break.
  if (block.observed_cycles !== "shown") {
    return { ...ABSENT, state: "invalid", schema: FORECAST_HEADS_SCHEMA };
  }
  // The block never carries authority. A payload that claims any is refused
  // whole — the card is withheld, the observed facts are untouched.
  for (const flag of AUTHORITY_FLAGS) {
    if (block[flag] === true) {
      return { ...ABSENT, state: "invalid", schema: FORECAST_HEADS_SCHEMA };
    }
  }
  const headsRaw = object(block.heads);
  const heads: ForecastHead[] = [];
  for (const key of FORECAST_HEAD_KEYS) {
    if (headsRaw[key] === undefined || headsRaw[key] === null) {
      // All four heads are part of the contract; a missing one breaks the
      // block, and a broken optional depth never erases the qualified core.
      return { ...ABSENT, state: "invalid", schema: FORECAST_HEADS_SCHEMA };
    }
    heads.push(readHead(key, headsRaw[key]));
  }
  return {
    state: "ready",
    schema: FORECAST_HEADS_SCHEMA,
    observedCycles: "shown",
    protocol: text(block.protocol) || null,
    reportRef: text(block.report_ref) || null,
    heads,
  };
}
