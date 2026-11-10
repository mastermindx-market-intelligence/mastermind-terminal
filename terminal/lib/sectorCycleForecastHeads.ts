import { object, text } from "./sectorIntelligence";

/* ────────────────────────────────────────────────────────────────────────────
 * Per-head forecast capabilities (Sector Intelligence v1.1). Binds EXACTLY to
 * lane 8's published wire contract `sector_cycles.forecast_heads.v1` (macro
 * engine/sector_heads.py @d70025383c2d): a per-record block carrying the four
 * remaining-opportunity heads, each judged ALONE — withdrawing one head
 * touches only that head and its siblings and the observed Cycles facts stay
 * untouched (SP10).
 *
 * The producer is the contract. `head_capabilities()` emits exactly one
 * status today — `withheld` — with the head's own reason code from its
 * eight-code precedence ladder; `withdraw()` likewise writes `withheld` plus
 * a caller-supplied reason code. The reader accepts ONLY what the producer
 * can emit: any other status (`withdrawn`, `qualified`, anything else) is a
 * contract violation and degrades that head to payload_invalid. A DATED
 * withdrawal is not on the wire — no `withdrawn_asof` field exists — and
 * waits for lane 8 to publish one; this reader claims no such state.
 *
 * This reader never invents a field, never re-dates a value, and never
 * surfaces a number: a head reading carries status/reason/target/horizon
 * text only. The strict key allowlist is the no-number invariant — a head
 * that tries to carry an estimate field outside the published contract is
 * refused per head (withheld, payload_invalid), never partially drawn.
 * ──────────────────────────────────────────────────────────────────────────── */

export const FORECAST_HEADS_SCHEMA = "sector_cycles.forecast_heads.v1";
export const FORECAST_HEAD_KEYS = [
  "remaining_return_distribution",
  "adverse_tail",
  "target_before_invalidation",
  "transition_time",
] as const;
export type ForecastHeadKey = (typeof FORECAST_HEAD_KEYS)[number];

/** The only status the producer emits today (sector_heads.py `_head`). */
export type ForecastHeadStatus = "withheld";

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
]);
const AUTHORITY_FLAGS = [
  "may_rank",
  "may_gate",
  "may_size",
  "may_trade",
  "may_escalate",
] as const;

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

/** Strict per-head read. Any contract violation — unknown field, a status
 * the producer cannot emit, a non-positive-integer horizon — degrades ONLY
 * this head to withheld/payload_invalid; siblings are never collateral
 * damage (SP10). */
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
    evidence: { protocol: null, reportRef: null, resultsDoc: null },
  };
  // The wire contract is an exact allowlist: an unknown field is never
  // interpreted, and an estimate number can never become a shown value.
  for (const field of Object.keys(h)) {
    if (!HEAD_WIRE_FIELDS.has(field)) return invalid;
  }
  // The producer emits exactly one status ("withheld", from `_head` and
  // `withdraw` alike). "withdrawn"/"qualified" are not on the wire — a head
  // claiming one is a contract violation, not a stale pass and not an
  // implied qualified forecast.
  if (h.status !== "withheld") return invalid;
  // The horizon is a session count: a positive integer, never a fraction.
  const hz = h.horizon_sessions;
  if (typeof hz !== "number" || !Number.isInteger(hz) || hz <= 0) return invalid;
  const evidence = object(h.evidence);
  return {
    key,
    status: "withheld",
    reasonCode: text(h.reason_code) || null,
    researchDisposition: text(h.research_disposition) || null,
    target: text(h.target) || null,
    horizonSessions: hz,
    market: text(h.market) || null,
    evidence: {
      protocol: text(evidence.protocol) || null,
      reportRef: text(evidence.report_ref) || null,
      resultsDoc: text(evidence.results_doc) || null,
    },
  };
}

export function forecastHeadsReading(record: unknown): ForecastHeadsReading {
  const rec = object(record);
  // Only a truly absent block reads absent. A block that IS attached but is
  // not an object, or carries no recognizable schema, is malformed — it
  // reads invalid; "absent" would claim nothing was attached.
  if (rec.forecast_heads === undefined || rec.forecast_heads === null) return ABSENT;
  const block = object(rec.forecast_heads);
  if (block.schema !== FORECAST_HEADS_SCHEMA) {
    return { ...ABSENT, state: "invalid", schema: text(block.schema) || null };
  }
  // Observed Cycles facts are the record's own; the block only ever
  // confirms they stay shown. Anything else is a contract break.
  if (block.observed_cycles !== "shown") {
    return { ...ABSENT, state: "invalid", schema: FORECAST_HEADS_SCHEMA };
  }
  // The block never carries authority. The producer emits the five flags
  // FLAT on the block, each boolean false; every one must be present and
  // exactly `false` — missing, stringly-typed, numeric, object-valued or
  // nested inside an `authority` object, all refuse the block.
  if (block.authority !== undefined && block.authority !== null) {
    return { ...ABSENT, state: "invalid", schema: FORECAST_HEADS_SCHEMA };
  }
  for (const flag of AUTHORITY_FLAGS) {
    if (block[flag] !== false) {
      return { ...ABSENT, state: "invalid", schema: FORECAST_HEADS_SCHEMA };
    }
  }
  // A missing, null or malformed head degrades ONLY that head; a broken
  // optional depth never erases the qualified core (SP10).
  const headsRaw = object(block.heads);
  const heads: ForecastHead[] = [];
  for (const key of FORECAST_HEAD_KEYS) {
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
