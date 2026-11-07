/**
 * Optional Persistent Sector Leadership consumer contract.
 *
 * Reads only sectorPayload.measured_read.sector_dossiers and its sibling
 * sectorPayload.measured_read.sector_window_measurements. This module neither
 * fetches nor activates a producer, modifies the legacy measured panel, chooses
 * membership, computes a forecast, or grants trading authority. The cohort IDs
 * below are the closed v1 wire identities, not a second membership registry.
 *
 * The two documents are read separately and independently: the legacy closed21/63
 * dossier keeps its own reader and its own closed schema, and the exact-session
 * companion keeps its own reader and its own closed schema. Neither one is
 * derived from the other, and neither one may stand in for the other.
 */
import Ajv from "ajv";
import addFormats from "ajv-formats";

export const SECTOR_DOSSIERS_SCHEMA = "leadership_rotation_context.sector_dossiers/v1";
const MEASURED_SCHEMA = "leadership_rotation_context.measured_group_read/v1";
const COHORT = "us_sectors_11";
const GROUP_IDS = ["XLB", "XLC", "XLE", "XLF", "XLI", "XLK", "XLP", "XLRE", "XLU", "XLV", "XLY"] as const;
type GroupId = typeof GROUP_IDS[number];
type MeasurementStatus = "available" | "partial" | "unavailable";
type Unavailable = { status: "unavailable"; reason: string };
type WindowValues<T> = { rs_21d: T; rs_63d: T };
type BreadthCount = { expected_n: 11; measured_n: number; positive_n: number | null };

export interface SectorDossierGroup {
  group_id: GroupId;
  name_en: string | null;
  name_zh: string | null;
  status: MeasurementStatus;
  relative_wealth_pct: WindowValues<number | null>;
  null_reasons: WindowValues<string | null>;
  qualification_reasons: string[];
}

export interface SectorDossiers {
  schema: typeof SECTOR_DOSSIERS_SCHEMA;
  status: "partial" | "unavailable";
  measurement_status: MeasurementStatus;
  cohort_id: "us_sectors_11";
  population: "eleven_sector_etf_proxies";
  as_of: string | null;
  benchmark: string | null;
  price_basis: "total_return" | null;
  units: "pct";
  windows_sessions: [21, 63];
  unavailable_windows: { sessions: [5, 20]; reason: "not_supplied_by_owner" };
  absolute_returns: Unavailable;
  compatibility_key: string | null;
  source_generation: Unavailable & { id: null };
  availability: {
    mode: "dated_snapshot" | "as_known";
    decision_cutoff: string | null;
    original_available_at: null;
    historically_admissible: false;
    reason: string;
  };
  history: { mode: "reconstructed_price_history"; naturally_observed: false };
  freshness: { status: "unverified"; reason: "owner_freshness_receipt_not_supplied" };
  corrections: Unavailable;
  authority: {
    may_rank: false; may_gate: false; may_size: false;
    may_trade: false; may_escalate: false;
  };
  forecasts: {
    status: "not_qualified"; expected_return: null;
    persistence_estimate: null; allocation_weight: null;
  };
  mechanism: Unavailable & { owner: "engine.theme_graph" };
  risk: Unavailable & { owner: "engine.risk_envelope"; scope: null };
  constituent_breadth: Unavailable;
  constituent_concentration: Unavailable;
  cross_sector_breadth_counts: { "21": BreadthCount; "63": BreadthCount };
  dependency_audit: {
    source_roots: "engine.sector_cycles"[];
    source_family_count: 0 | 1;
    independence: "not_established";
    shared_rolling_windows: true;
    constituent_overlap: "unknown";
  };
  diagnostics: {
    qualification_reasons: string[];
    duplicate_groups: GroupId[];
    outside_cohort: string[];
    malformed_source_rows: number;
    malformed_measured_rows: number;
  };
  groups: SectorDossierGroup[];
}

export type SectorDossiersRead =
  | { state: "absent" | "invalid"; reason: string; dossier: null }
  | { state: "ok" | "outage"; reason: null; dossier: SectorDossiers };

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
const closed = (properties: Record<string, unknown>) => ({
  type: "object", properties, required: Object.keys(properties), additionalProperties: false,
});
const literal = (value: unknown) => ({ const: value });
const nullable = (schema: object) => ({ anyOf: [schema, { type: "null" }] });
const text = { type: "string", minLength: 1, maxLength: 120, pattern: "^[^\\u0000-\\u001f]+(?![\\s\\S])" };
const reasons = { type: "array", items: text, maxItems: 32, uniqueItems: true };
const count = (maximum: number) => ({ type: "integer", minimum: 0, maximum });
const unavailable = (reason: string, extras: Record<string, unknown> = {}) =>
  closed({ status: literal("unavailable"), reason: literal(reason), ...extras });
const windowValues = (value: object) => closed({ rs_21d: value, rs_63d: value });
const groupIds = { type: "array", items: { enum: GROUP_IDS }, maxItems: 11, uniqueItems: true };
const breadth = closed({ expected_n: literal(11), measured_n: count(11), positive_n: nullable(count(11)) });

const schema = closed({
  schema: literal(SECTOR_DOSSIERS_SCHEMA),
  status: { enum: ["partial", "unavailable"] },
  measurement_status: { enum: ["available", "partial", "unavailable"] },
  cohort_id: literal(COHORT),
  population: literal("eleven_sector_etf_proxies"),
  as_of: nullable({ type: "string", format: "date", pattern: "^\\d{4}-\\d{2}-\\d{2}(?![\\s\\S])" }),
  benchmark: nullable({
    type: "string", pattern: "^[A-Z][A-Z0-9.^-]{0,15}(?![\\s\\S])",
    not: { enum: ["UNKNOWN", "NONE", "NULL"] },
  }),
  price_basis: { enum: ["total_return", null] },
  units: literal("pct"),
  windows_sessions: literal([21, 63]),
  unavailable_windows: closed({ sessions: literal([5, 20]), reason: literal("not_supplied_by_owner") }),
  absolute_returns: unavailable("not_supplied_by_owner"),
  compatibility_key: nullable({ ...text, maxLength: 160 }),
  source_generation: unavailable("immutable_generation_not_supplied", { id: literal(null) }),
  availability: closed({
    mode: { enum: ["dated_snapshot", "as_known"] },
    decision_cutoff: nullable({ ...text, format: "date-time", maxLength: 64 }),
    original_available_at: literal(null),
    historically_admissible: literal(false),
    reason: { enum: ["original_availability_not_supplied", "invalid_decision_cutoff",
      "source_session_after_decision_cutoff", "availability_time_missing"] },
  }),
  history: closed({ mode: literal("reconstructed_price_history"), naturally_observed: literal(false) }),
  freshness: closed({ status: literal("unverified"), reason: literal("owner_freshness_receipt_not_supplied") }),
  corrections: unavailable("native_revision_selection_not_supplied"),
  authority: closed({
    may_rank: literal(false), may_gate: literal(false), may_size: literal(false),
    may_trade: literal(false), may_escalate: literal(false),
  }),
  forecasts: closed({
    status: literal("not_qualified"), expected_return: literal(null),
    persistence_estimate: literal(null), allocation_weight: literal(null),
  }),
  mechanism: unavailable("no_qualified_evidence", { owner: literal("engine.theme_graph") }),
  risk: unavailable("no_qualified_risk_context", { owner: literal("engine.risk_envelope"), scope: literal(null) }),
  constituent_breadth: unavailable("native_membership_not_supplied"),
  constituent_concentration: unavailable("native_weights_not_supplied"),
  cross_sector_breadth_counts: closed({ "21": breadth, "63": breadth }),
  dependency_audit: closed({
    source_roots: { type: "array", items: literal("engine.sector_cycles"), maxItems: 1, uniqueItems: true },
    source_family_count: count(1), independence: literal("not_established"),
    shared_rolling_windows: literal(true), constituent_overlap: literal("unknown"),
  }),
  diagnostics: closed({
    qualification_reasons: reasons, duplicate_groups: groupIds,
    outside_cohort: {
      type: "array", items: { type: "string", pattern: "^[A-Z][A-Z0-9]{0,7}(?![\\s\\S])" },
      maxItems: 11, uniqueItems: true,
    },
    malformed_source_rows: count(128), malformed_measured_rows: count(128),
  }),
  groups: {
    type: "array", minItems: 11, maxItems: 11,
    items: closed({
      group_id: { enum: GROUP_IDS }, name_en: nullable(text), name_zh: nullable(text),
      status: { enum: ["available", "partial", "unavailable"] },
      relative_wealth_pct: windowValues(nullable({ type: "number", minimum: -100 })),
      null_reasons: windowValues(nullable(text)), qualification_reasons: reasons,
    }),
  },
});
const ajv = new Ajv({ allErrors: false, strict: true, ownProperties: true });
addFormats(ajv);
const validate = ajv.compile<SectorDossiers>(schema);

function consistent(dossier: SectorDossiers, measured: Record<string, unknown>): boolean {
  const generation = record(measured.generation);
  if (!generation || generation.cohort_id !== COHORT) return false;
  if (dossier.as_of !== null && dossier.as_of !== generation.session_end) return false;
  if (dossier.benchmark !== null && dossier.benchmark !== generation.benchmark) return false;
  if (dossier.price_basis !== null && dossier.price_basis !== generation.price_basis) return false;
  if (dossier.compatibility_key !== null && dossier.compatibility_key !== generation.id) return false;
  if (!Array.isArray(measured.groups) || measured.groups.length !== 11) return false;
  const parentGroups = new Map<string, Record<string, unknown>>();
  for (const raw of measured.groups) {
    const row = record(raw);
    if (!row || typeof row.group_id !== "string" || row.group_kind !== "sector"
      || !GROUP_IDS.includes(row.group_id as GroupId) || parentGroups.has(row.group_id)) return false;
    parentGroups.set(row.group_id, row);
  }
  const seen = new Set<string>();
  let available = 0, anyValues = false;
  for (const row of dossier.groups) {
    if (seen.has(row.group_id)) return false;
    seen.add(row.group_id);
    const current = record(parentGroups.get(row.group_id)?.current);
    if (!current || current.metric !== "relative_wealth_pct" || current.units !== "pct") return false;
    let measuredN = 0;
    for (const key of ["rs_21d", "rs_63d"] as const) {
      const value = row.relative_wealth_pct[key], reason = row.null_reasons[key];
      if (value === null) {
        if (reason === null) return false;
      } else {
        if (reason !== null || row.qualification_reasons.length > 0 || current[key] !== value) return false;
        measuredN += 1;
      }
    }
    const expected = measuredN === 2 ? "available" : measuredN === 1 ? "partial" : "unavailable";
    if (row.status !== expected) return false;
    if (measuredN === 2) available += 1;
    anyValues ||= measuredN > 0;
  }
  if (dossier.measurement_status !== (available === 11 ? "available" : anyValues ? "partial" : "unavailable")
    || dossier.status !== (anyValues ? "partial" : "unavailable")) return false;
  if (dossier.diagnostics.qualification_reasons.length > 0 && anyValues) return false;
  if (dossier.diagnostics.outside_cohort.some(id => GROUP_IDS.includes(id as GroupId))) return false;
  for (const duplicate of dossier.diagnostics.duplicate_groups) {
    const row = dossier.groups.find(group => group.group_id === duplicate);
    if (!row || row.status !== "unavailable") return false;
  }
  for (const window of ["21", "63"] as const) {
    const field = window === "21" ? "rs_21d" : "rs_63d";
    const values = dossier.groups.map(row => row.relative_wealth_pct[field])
      .filter((value): value is number => value !== null);
    const owner = dossier.cross_sector_breadth_counts[window];
    // Validation of the owner's counts, never a replacement breadth/rank policy.
    if (owner.measured_n !== values.length
      || owner.positive_n !== (values.length ? values.filter(value => value > 0).length : null)) return false;
  }
  if (dossier.dependency_audit.source_family_count !== dossier.dependency_audit.source_roots.length) return false;
  if (anyValues && (dossier.as_of === null || dossier.benchmark === null
    || dossier.price_basis !== "total_return" || dossier.dependency_audit.source_family_count !== 1)) return false;
  const availability = dossier.availability;
  if (availability.mode === "dated_snapshot") {
    if (availability.decision_cutoff !== null || availability.reason !== "original_availability_not_supplied") return false;
  } else {
    if (anyValues || availability.reason === "original_availability_not_supplied") return false;
    if ((availability.reason === "invalid_decision_cutoff") !== (availability.decision_cutoff === null)) return false;
  }
  return true;
}

/** Decode a detached, closed v1 owner document; missing addenda stay absent. */
export function sectorDossiers(sectorPayload: unknown): SectorDossiersRead {
  const absent = (): SectorDossiersRead => ({ state: "absent", reason: "dossier_not_supplied", dossier: null });
  const invalid = (): SectorDossiersRead => ({ state: "invalid", reason: "invalid_dossier_contract", dossier: null });
  const root = record(sectorPayload);
  if (!root || !Object.hasOwn(root, "measured_read")) return absent();
  const measured = record(root.measured_read);
  if (!measured) return invalid();
  if (!Object.hasOwn(measured, "sector_dossiers")) return absent();
  if (measured.schema !== MEASURED_SCHEMA || typeof measured.status !== "string"
    || !["available", "partial", "unavailable"].includes(measured.status)) return invalid();
  const candidate = measured.sector_dossiers;
  if (!validate(candidate)) return invalid();
  // Clone after bounded schema admission. No references into a shared owner
  // payload escape, and non-JSON objects cannot change the returned contract.
  try {
    const dossier: unknown = structuredClone(candidate);
    if (!validate(dossier) || !consistent(dossier, measured)) return invalid();
    return { state: dossier.status === "unavailable" ? "outage" : "ok", reason: null, dossier };
  } catch {
    return invalid();
  }
}

/* -------------------------------------------------------------------------- *
 * Exact-session companion.
 *
 * leadership_rotation_context.sector_window_measurements/v1 is the producer's
 * native composed mode: exact 5/20/63-session endpoint returns for the eleven
 * sector ETF proxies against one owner-supplied benchmark. It is read from
 * sectorPayload.measured_read.sector_window_measurements only, and it is a
 * separate document from the legacy dossier above. This reader computes no
 * return, no date, no rank, no breadth and no coverage: it admits what the
 * producer published and refuses everything else.
 * -------------------------------------------------------------------------- */

export const SECTOR_WINDOW_MEASUREMENTS_SCHEMA =
  "leadership_rotation_context.sector_window_measurements/v1";

/** The producer's own endpoint definition, pinned to the frozen producer fixture. */
const EXACT_ENDPOINT_DEFINITION =
  "Endpoint return: P(T)/P(S_N) - 1, where T is the explicit end session and S_N is the canonical "
  + "US session exactly N positions before T, so a 5-session return spans 6 session endpoints. "
  + "Relative wealth is (1+R_group)/(1+R_benchmark) - 1 -- a wealth ratio, never a return "
  + "difference. Interior gaps never move an endpoint; they are disclosed as observed coverage. "
  + "Prices are strictly positive, finite, total-return adjusted closes read at the two endpoints only.";

export const EXACT_WINDOW_KEYS = ["5", "20", "63"] as const;
export type ExactWindowKey = typeof EXACT_WINDOW_KEYS[number];

/** The producer's full measurement reason vocabulary. */
const EXACT_REASONS = [
  "missing_input", "non_finite_input", "invalid_price", "benchmark_missing", "benchmark_invalid",
  "insufficient_reference_history", "empty_panel", "future_tail", "source_session_mismatch",
  "ambiguous_duplicate_price_index", "ambiguous_duplicate_column", "cohort_identity_mismatch",
  "benchmark_identity_mismatch", "return_basis_not_qualified",
] as const;
export type ExactMeasurementReason = typeof EXACT_REASONS[number];

/**
 * The last eight reasons refuse the whole panel. The first six qualify one
 * published value. `insufficient_reference_history` is a per-window condition
 * and is decided before any block reason.
 */
const EXACT_BLOCK_REASONS = [
  "empty_panel", "future_tail", "source_session_mismatch", "ambiguous_duplicate_price_index",
  "ambiguous_duplicate_column", "cohort_identity_mismatch", "benchmark_identity_mismatch",
  "return_basis_not_qualified",
] as const;
export type ExactBlockReason = typeof EXACT_BLOCK_REASONS[number];

/** The producer's own binding keys. Nothing outside this list is a binding. */
const EXACT_BINDING_KEYS = [
  "source_roots", "clocks", "receipt", "cohort_id", "benchmark", "source_session", "price_basis",
] as const;

export interface ExactCoverage { observed_n: number; expected_n: number; ratio: number }

export interface ExactCell {
  status: MeasurementStatus;
  absolute_return_pct: number | null;
  relative_wealth_pct: number | null;
  null_reasons: {
    absolute_return_pct: ExactMeasurementReason | null;
    relative_wealth_pct: ExactMeasurementReason | null;
  };
  coverage: ExactCoverage;
}

export interface ExactWindow {
  window_sessions: number;
  status: MeasurementStatus;
  start_session: string | null;
  end_session: string;
  benchmark_return_pct: number | null;
  benchmark_null_reason: ExactMeasurementReason | null;
  benchmark_coverage: ExactCoverage;
  null_reason: ExactMeasurementReason | null;
}

export interface ExactGroup {
  group_id: GroupId;
  name_en: string | null;
  name_zh: string | null;
  windows: { [K in ExactWindowKey]: ExactCell };
}

export type ExactClockLimitation =
  | {
    status: "unknown";
    reason: "owner_availability_clock_not_supplied" | "owner_publication_clock_not_supplied"
      | "owner_history_clock_not_supplied";
  }
  | { status: "supplied"; clock: string };

export type ExactLimitation =
  | ExactClockLimitation
  | { status: "unavailable"; reason: "native_revision_selection_not_supplied" }
  | { status: "unverified"; reason: "owner_freshness_receipt_not_supplied" }
  | { status: "not_qualified"; reason: "point_in_time_admission_not_supplied" };

export interface ExactLimitations {
  availability: ExactClockLimitation;
  publication: ExactClockLimitation;
  history: ExactClockLimitation;
  corrections: { status: "unavailable"; reason: "native_revision_selection_not_supplied" };
  freshness: { status: "unverified"; reason: "owner_freshness_receipt_not_supplied" };
  point_in_time: { status: "not_qualified"; reason: "point_in_time_admission_not_supplied" };
}

export interface ExactDiagnostics {
  panel_rows: number;
  malformed_rows: number;
  duplicate_sessions: string[];
  ambiguous_columns: string[];
  columns: string[];
  binding_keys: string[];
  receipt_withheld: boolean;
  future_tail_sessions: string[];
  expected_columns: number;
  qualification_reasons: ExactBlockReason[];
  measured_cells: number;
  complete_cells: number;
  total_cells: number;
  coverage_note: string;
}

export interface SectorWindowMeasurements {
  schema: typeof SECTOR_WINDOW_MEASUREMENTS_SCHEMA;
  status: "available" | "partial" | "unavailable";
  reason: ExactBlockReason | null;
  units: "pct";
  price_basis: "total_return";
  benchmark: string;
  cohort_id: "us_sectors_11";
  population: "eleven_sector_etf_proxies";
  source_session: string;
  end_session: string;
  windows_sessions: [5, 20, 63];
  endpoint_definition: string;
  clocks: {
    publication: string | null; availability: string | null;
    correction: string | null; history: string | null;
  };
  source_roots: string[];
  receipt: Record<string, unknown> | null;
  limitations: ExactLimitations;
  windows: { [K in ExactWindowKey]: ExactWindow };
  groups: ExactGroup[];
  diagnostics: ExactDiagnostics;
  authority: {
    may_rank: false; may_gate: false; may_size: false; may_trade: false; may_escalate: false;
  };
}

export type SectorWindowMeasurementsRead =
  | { state: "absent" | "invalid"; reason: string; measurements: null }
  | { state: "ok"; reason: null; measurements: SectorWindowMeasurements };

const boundedText = (maxLength: number) => ({
  type: "string", minLength: 1, maxLength, pattern: "^[^\\u0000-\\u001f]+(?![\\s\\S])",
});
const sessionDate = { type: "string", format: "date", pattern: "^\\d{4}-\\d{2}-\\d{2}(?![\\s\\S])" };
const clockText = boundedText(64);
const exactCoverage = closed({
  observed_n: count(64), expected_n: count(64), ratio: { type: "number", minimum: 0, maximum: 1 },
});
/* The published domain of a total-return percentage: -100% is the floor a strictly positive
 * total-return price can reach, zero and a signed zero are ordinary values, and there is no
 * upper bound — a return is not clipped at an arbitrary positive ceiling. */
const exactPercent = { type: "number", minimum: -100 };
const exactCell = closed({
  status: { enum: ["available", "partial", "unavailable"] },
  absolute_return_pct: nullable(exactPercent),
  relative_wealth_pct: nullable(exactPercent),
  null_reasons: closed({
    absolute_return_pct: nullable({ enum: EXACT_REASONS }),
    relative_wealth_pct: nullable({ enum: EXACT_REASONS }),
  }),
  coverage: exactCoverage,
});
const exactCellWindows = closed({ "5": exactCell, "20": exactCell, "63": exactCell });
const exactWindow = (sessions: number) => closed({
  window_sessions: literal(sessions),
  status: { enum: ["available", "partial", "unavailable"] },
  start_session: nullable(sessionDate),
  end_session: sessionDate,
  benchmark_return_pct: nullable(exactPercent),
  benchmark_null_reason: nullable({ enum: EXACT_REASONS }),
  benchmark_coverage: exactCoverage,
  null_reason: nullable({ enum: EXACT_REASONS }),
});
const exactWindows = closed({
  "5": exactWindow(5), "20": exactWindow(20), "63": exactWindow(63),
});
const clockLimitation = (reason: string) => ({
  anyOf: [
    closed({ status: literal("unknown"), reason: literal(reason) }),
    closed({ status: literal("supplied"), clock: clockText }),
  ],
});

const exactSchema = closed({
  schema: literal(SECTOR_WINDOW_MEASUREMENTS_SCHEMA),
  status: { enum: ["available", "partial", "unavailable"] },
  reason: nullable({ enum: EXACT_BLOCK_REASONS }),
  units: literal("pct"),
  price_basis: literal("total_return"),
  benchmark: {
    type: "string", pattern: "^[A-Z][A-Z0-9.^-]{0,15}(?![\\s\\S])",
    not: { enum: ["UNKNOWN", "NONE", "NULL"] },
  },
  cohort_id: literal(COHORT),
  population: literal("eleven_sector_etf_proxies"),
  source_session: sessionDate,
  end_session: sessionDate,
  windows_sessions: literal([5, 20, 63]),
  endpoint_definition: literal(EXACT_ENDPOINT_DEFINITION),
  clocks: closed({
    publication: nullable(clockText), availability: nullable(clockText),
    correction: nullable(clockText), history: nullable(clockText),
  }),
  source_roots: { type: "array", items: boundedText(256), maxItems: 32 },
  receipt: nullable({ type: "object" }),
  limitations: closed({
    availability: clockLimitation("owner_availability_clock_not_supplied"),
    publication: clockLimitation("owner_publication_clock_not_supplied"),
    history: clockLimitation("owner_history_clock_not_supplied"),
    corrections: closed({ status: literal("unavailable"), reason: literal("native_revision_selection_not_supplied") }),
    freshness: closed({ status: literal("unverified"), reason: literal("owner_freshness_receipt_not_supplied") }),
    point_in_time: closed({ status: literal("not_qualified"), reason: literal("point_in_time_admission_not_supplied") }),
  }),
  windows: exactWindows,
  groups: {
    type: "array", minItems: 11, maxItems: 11,
    items: closed({
      group_id: { enum: GROUP_IDS },
      name_en: nullable(text),
      name_zh: nullable(text),
      windows: exactCellWindows,
    }),
  },
  diagnostics: closed({
    panel_rows: count(20000),
    // Malformed rows count an invalid column key, so they may exceed the panel rows.
    malformed_rows: count(1000000000),
    duplicate_sessions: { type: "array", items: sessionDate, maxItems: 16 },
    ambiguous_columns: { type: "array", items: boundedText(64), maxItems: 16 },
    columns: { type: "array", items: boundedText(64), maxItems: 64 },
    binding_keys: { type: "array", items: { enum: EXACT_BINDING_KEYS }, maxItems: 8, uniqueItems: true },
    receipt_withheld: { type: "boolean" },
    future_tail_sessions: { type: "array", items: sessionDate, maxItems: 16 },
    expected_columns: literal(12),
    qualification_reasons: { type: "array", items: { enum: EXACT_BLOCK_REASONS }, maxItems: 8, uniqueItems: true },
    measured_cells: count(33),
    complete_cells: count(33),
    total_cells: literal(33),
    coverage_note: boundedText(512),
  }),
  authority: closed({
    may_rank: literal(false), may_gate: literal(false), may_size: literal(false),
    may_trade: literal(false), may_escalate: literal(false),
  }),
});
const validateExact = ajv.compile<SectorWindowMeasurements>(exactSchema);

/**
 * The producer's clock grammar is Python's datetime.fromisoformat, which is
 * broader than RFC 3339. This consumer admits a conservative, documented
 * subset — a real calendar date, a wall time with at least minutes, and an
 * explicit UTC offset — and keeps the owner's own text verbatim. It is not
 * Date.parse and it does not claim to be the producer's exact grammar.
 */
const AWARE_CLOCK = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,6})?)?(Z|[+-]\d{2}(?::?\d{2})?)$/;

function daysInMonth(year: number, month: number): number {
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

function isAwareClock(value: string): boolean {
  const match = AWARE_CLOCK.exec(value);
  if (!match) return false;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const hour = Number(match[4]), minute = Number(match[5]);
  const second = match[6] === undefined ? 0 : Number(match[6]);
  const offset = match[7];
  // The native datetime owner has no year zero and no year beyond 9999, so neither has this
  // consumer. A calendar date outside that range is not a real date.
  if (year < 1 || year > 9999) return false;
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;
  if (offset !== "Z") {
    const offsetHours = Number(offset.slice(1, 3));
    const offsetMinutes = offset.length > 3 ? Number(offset.slice(-2)) : 0;
    if (offsetHours > 23 || offsetMinutes > 59) return false;
  }
  return true;
}

/** The published ratio must agree with the published counts, to one rounding unit. */
function coverageAgrees(coverage: ExactCoverage, expectedN: number): boolean {
  if (coverage.expected_n !== expectedN) return false;
  if (!Number.isInteger(coverage.observed_n) || coverage.observed_n < 0) return false;
  if (coverage.observed_n > coverage.expected_n) return false;
  if (!Number.isFinite(coverage.ratio)) return false;
  return Math.abs(coverage.ratio - coverage.observed_n / coverage.expected_n) <= 1e-6;
}

/** A published return is a finite number or an explicit null. Nothing else is a measurement. */
function publishedNumber(value: number | null): boolean {
  return value === null || Number.isFinite(value);
}

function sortedAscending(values: string[]): boolean {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] < values[index - 1]) return false;
  }
  return true;
}

/**
 * The producer withholds a receipt it cannot bound, and it bounds the one it
 * publishes. The received object is qualified on its own terms, under the
 * producer's own limits, before the document is cloned: an oversized receipt or
 * a receipt that carries a value JSON cannot hold is refused rather than
 * expanded into a clone first.
 */
const RECEIPT_TOP_KEYS = 32;
const RECEIPT_MAX_DEPTH = 8;
const RECEIPT_MAX_CONTAINERS = 256;
const RECEIPT_MAX_NODES = 2048;
const RECEIPT_MAX_ENCODED_BYTES = 16384;

/** A refusal is a stable outcome. It never carries a raw exception and never a partial document. */
const RECEIPT_REFUSED = Symbol("receipt_refused");

/** Only a plain JSON object is a receipt container. A Date, a Map, a Set, a RegExp, a typed array
 * and a class instance are not, and neither is an object with a prototype of its own. */
function isPlainJsonObject(value: object): boolean {
  let prototype: unknown;
  try {
    prototype = Object.getPrototypeOf(value);
  } catch {
    return false;
  }
  return prototype === Object.prototype || prototype === null;
}

/**
 * Qualify the opaque receipt on the received object itself and return a detached plain-JSON
 * copy, or null when the receipt is refused.
 *
 * Only finite JSON primitives, arrays and plain JSON objects are admitted. A cycle, a Date, a
 * Map, a Set, an unsupported value and an oversized receipt are refused. `toJSON` is never
 * invoked, an exotic object is never coerced, no content is silently discarded, and the
 * encoded size is counted while the object is walked instead of being serialized to discover
 * that it is too large.
 */
function qualifyReceipt(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  let nodes = 0, bytes = 0;
  const path = new Set<object>();

  // The accepted Python producer uses json.dumps with ensure_ascii=True and the
  // default ", " / ": " separators. Count its string encoding incrementally.
  // Each UTF-16 surrogate is one six-byte escape, including pairs and lone surrogates.
  const addString = (text: string, extra: number): void => {
    bytes += 2 + extra;
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      if (code === 0x22 || code === 0x5c ||
          code === 0x08 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d) bytes += 2;
      else if (code < 0x20 || code >= 0x7f) bytes += 6;
      else bytes += 1;
      if (bytes > RECEIPT_MAX_ENCODED_BYTES) throw RECEIPT_REFUSED;
    }
  };

  const walk = (item: unknown, depth: number): unknown => {
    if (depth > RECEIPT_MAX_DEPTH) throw RECEIPT_REFUSED;
    nodes += 1;
    if (nodes > RECEIPT_MAX_NODES) throw RECEIPT_REFUSED;
    if (item === null) { bytes += 4; return null; }
    const kind = typeof item;
    if (kind === "boolean") { bytes += item ? 4 : 5; return item; }
    if (kind === "string") { addString(item as string, 0); return item; }
    if (kind === "number") {
      const number = item as number;
      if (!Number.isFinite(number)) throw RECEIPT_REFUSED;
      // Decoding loses Python int/float spelling (1 vs 1.0, and signed zero).
      // Safe integers need at most ".0" and a possible negative-zero sign.
      // Other finite binary64 floats need <=25 bytes; an original Python integer
      // may need hundreds of decimal digits. Include a digit of rounding margin.
      bytes += Number.isSafeInteger(number)
        ? Math.max(4, String(number).length + 2)
        : Math.max(25, Math.floor(Math.log10(Math.abs(number))) + 3);
      return item;
    }
    if (kind !== "object") throw RECEIPT_REFUSED;
    const object = item as object;
    if (path.has(object)) throw RECEIPT_REFUSED;
    if (Array.isArray(object)) {
      if (Object.getPrototypeOf(object) !== Array.prototype ||
          object.length > RECEIPT_MAX_CONTAINERS ||
          Reflect.ownKeys(object).length !== object.length + 1) throw RECEIPT_REFUSED;
      path.add(object);
      bytes += 2;
      const copy: unknown[] = [];
      for (let index = 0; index < object.length; index += 1) {
        // Do not invoke a custom iterator, an accessor, or silently fill a hole.
        const descriptor = Object.getOwnPropertyDescriptor(object, String(index));
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) throw RECEIPT_REFUSED;
        if (index > 0) bytes += 2;
        copy.push(walk(descriptor.value, depth + 1));
        if (bytes > RECEIPT_MAX_ENCODED_BYTES) throw RECEIPT_REFUSED;
      }
      path.delete(object);
      return copy;
    }
    if (!isPlainJsonObject(object)) throw RECEIPT_REFUSED;
    path.add(object);
    bytes += 2;
    const copy: Record<string, unknown> = {};
    const keys = Reflect.ownKeys(object);
    if (keys.length > RECEIPT_MAX_CONTAINERS ||
        (depth === 1 && keys.length > RECEIPT_TOP_KEYS)) throw RECEIPT_REFUSED;
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      if (typeof key !== "string" || key === "__proto__" || Object.hasOwn(copy, key)) throw RECEIPT_REFUSED;
      const descriptor = Object.getOwnPropertyDescriptor(object, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) throw RECEIPT_REFUSED;
      if (index > 0) bytes += 2;
      addString(key, 2);
      copy[key] = walk(descriptor.value, depth + 1);
      if (bytes > RECEIPT_MAX_ENCODED_BYTES) throw RECEIPT_REFUSED;
    }
    path.delete(object);
    return copy;
  };

  try {
    const admitted = walk(value, 1);
    if (bytes > RECEIPT_MAX_ENCODED_BYTES) return null;
    return admitted as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Admit the receipt, or refuse the whole document. The receipt is never a proof of anything. */
function admitReceipt(candidate: SectorWindowMeasurements):
  { admitted: true; receipt: Record<string, unknown> | null } | { admitted: false } {
  const supplied = candidate.receipt;
  if (supplied === null) return { admitted: true, receipt: null };
  // A present receipt and a withheld receipt cannot both be true.
  if (candidate.diagnostics.receipt_withheld) return { admitted: false };
  const receipt = qualifyReceipt(supplied);
  if (receipt === null) return { admitted: false };
  return { admitted: true, receipt };
}

function exactConsistent(doc: SectorWindowMeasurements, measured: Record<string, unknown>): boolean {
  // The parent generation binds the cohort, the basis, the session and the benchmark.
  const generation = record(measured.generation);
  if (!generation) return false;
  if (generation.cohort_id !== doc.cohort_id || generation.cohort_id !== COHORT) return false;
  if (generation.price_basis !== doc.price_basis || generation.price_basis !== "total_return") return false;
  if (typeof generation.session_end !== "string") return false;
  if (generation.session_end !== doc.source_session || generation.session_end !== doc.end_session) return false;
  if (typeof generation.benchmark !== "string") return false;
  // The benchmark is owner-supplied. It is never hardcoded here; it is compared
  // with the parent's own value, trimmed and uppercased.
  if (doc.benchmark !== generation.benchmark.trim().toUpperCase()) return false;

  const diagnostics = doc.diagnostics;
  if (!Number.isSafeInteger(diagnostics.malformed_rows) || diagnostics.malformed_rows < 0) return false;
  if (!sortedAscending(diagnostics.columns)) return false;
  if (!sortedAscending(diagnostics.duplicate_sessions)) return false;
  if (!sortedAscending(diagnostics.ambiguous_columns)) return false;
  if (!sortedAscending(diagnostics.future_tail_sessions)) return false;
  for (let index = 1; index < diagnostics.binding_keys.length; index += 1) {
    if (diagnostics.binding_keys[index] <= diagnostics.binding_keys[index - 1]) return false;
  }
  if (!sortedAscending(diagnostics.qualification_reasons)) return false;

  // The receipt is bounded and qualified on the received object itself, before the document is
  // cloned. See `admitReceipt`: a receipt that is oversized, cyclic or not plain JSON never
  // reaches this check, and a receipt is never a proof of custody, availability or measurement.

  // The clocks: the owner's own text, never restamped, never a naive stamp.
  for (const name of ["publication", "availability", "correction", "history"] as const) {
    const clock = doc.clocks[name];
    if (clock !== null && !isAwareClock(clock)) return false;
  }
  const clockLimitations: [ExactClockLimitation, string | null][] = [
    [doc.limitations.availability, doc.clocks.availability],
    [doc.limitations.publication, doc.clocks.publication],
    [doc.limitations.history, doc.clocks.history],
  ];
  for (const [limitation, clock] of clockLimitations) {
    if (clock === null) {
      if (limitation.status !== "unknown") return false;
    } else if (limitation.status !== "supplied" || limitation.clock !== clock) {
      return false;
    }
  }

  // The eleven cohort identities, in the producer's own order.
  for (let index = 0; index < GROUP_IDS.length; index += 1) {
    if (doc.groups[index].group_id !== GROUP_IDS[index]) return false;
  }

  // The block reason and the top status.
  const blockReasons = diagnostics.qualification_reasons;
  const topReason = blockReasons.length > 0 ? blockReasons[0] : null;
  if (doc.reason !== topReason) return false;
  if (blockReasons.length > 0 && doc.status !== "unavailable") return false;

  let measuredCells = 0, completeCells = 0;
  for (const key of EXACT_WINDOW_KEYS) {
    const sessions = Number(key);
    const expectedN = sessions + 1;
    const window = doc.windows[key];
    if (window.window_sessions !== sessions) return false;
    if (window.end_session !== doc.end_session) return false;
    if (window.start_session !== null && window.start_session >= doc.end_session) return false;
    if (!coverageAgrees(window.benchmark_coverage, expectedN)) return false;
    if (window.benchmark_return_pct === null) {
      if (window.benchmark_null_reason === null) return false;
    } else if (window.benchmark_null_reason !== null) {
      return false;
    }
    if (!publishedNumber(window.benchmark_return_pct)) return false;

    // Insufficient reference history is decided before any block reason.
    const insufficient = window.null_reason === "insufficient_reference_history";
    // A null start session belongs to insufficient reference history and to nothing else. A
    // normal window and a block-refusal window both keep the source's own earlier start, and
    // this reader never calculates or substitutes a canonical date.
    if (window.start_session === null && !insufficient) return false;
    if (window.null_reason !== null && !insufficient && window.null_reason !== topReason) return false;
    if (insufficient) {
      if (window.start_session !== null) return false;
      if (window.benchmark_return_pct !== null) return false;
      if (window.benchmark_null_reason !== "insufficient_reference_history") return false;
      if (window.benchmark_coverage.observed_n !== 0 || window.benchmark_coverage.ratio !== 0) return false;
    } else if (blockReasons.length > 0) {
      if (window.benchmark_return_pct !== null) return false;
      if (window.benchmark_null_reason !== topReason) return false;
      if (window.null_reason !== topReason) return false;
    }

    let anyMeasured = false;
    let allComplete = true;
    for (const group of doc.groups) {
      const cell = group.windows[key];
      if (!coverageAgrees(cell.coverage, expectedN)) return false;
      const absolute = cell.absolute_return_pct, relative = cell.relative_wealth_pct;
      if (!publishedNumber(absolute) || !publishedNumber(relative)) return false;
      // A number implies no reason; a null implies exactly one recognized reason.
      if (absolute === null ? cell.null_reasons.absolute_return_pct === null
        : cell.null_reasons.absolute_return_pct !== null) return false;
      if (relative === null ? cell.null_reasons.relative_wealth_pct === null
        : cell.null_reasons.relative_wealth_pct !== null) return false;
      const present = (absolute === null ? 0 : 1) + (relative === null ? 0 : 1);
      const expectedStatus = present === 2 ? "available" : present === 1 ? "partial" : "unavailable";
      if (cell.status !== expectedStatus) return false;
      if (present === 2) completeCells += 1; else allComplete = false;
      if (present > 0) { measuredCells += 1; anyMeasured = true; }
      if (insufficient) {
        if (absolute !== null || relative !== null) return false;
        if (cell.null_reasons.absolute_return_pct !== "insufficient_reference_history"
          || cell.null_reasons.relative_wealth_pct !== "insufficient_reference_history") return false;
        if (cell.coverage.observed_n !== 0 || cell.coverage.ratio !== 0) return false;
      } else if (blockReasons.length > 0) {
        // A block refusal withholds every return, and keeps the observed coverage.
        if (absolute !== null || relative !== null) return false;
        if (cell.null_reasons.absolute_return_pct !== topReason
          || cell.null_reasons.relative_wealth_pct !== topReason) return false;
      }
    }
    const expectedWindowStatus = allComplete ? "available" : anyMeasured ? "partial" : "unavailable";
    if (window.status !== expectedWindowStatus) return false;
  }

  // The published counts are verified against the cells, not replaced by them.
  if (diagnostics.measured_cells !== measuredCells) return false;
  if (diagnostics.complete_cells !== completeCells) return false;
  if (blockReasons.length === 0) {
    const expectedStatus = completeCells === diagnostics.total_cells ? "available"
      : measuredCells > 0 ? "partial" : "unavailable";
    if (doc.status !== expectedStatus) return false;
  }
  return true;
}

/**
 * Decode the producer's exact-session companion. An absent companion is not an
 * error, and an unreadable companion never becomes a figure.
 */
export function sectorWindowMeasurements(sectorPayload: unknown): SectorWindowMeasurementsRead {
  const absent = (): SectorWindowMeasurementsRead =>
    ({ state: "absent", reason: "window_measurements_not_supplied", measurements: null });
  const invalid = (): SectorWindowMeasurementsRead =>
    ({ state: "invalid", reason: "invalid_window_measurements_contract", measurements: null });
  const root = record(sectorPayload);
  if (!root || !Object.hasOwn(root, "measured_read")) return absent();
  const measured = record(root.measured_read);
  if (!measured) return invalid();
  if (!Object.hasOwn(measured, "sector_window_measurements")) return absent();
  if (measured.schema !== MEASURED_SCHEMA || typeof measured.status !== "string"
    || !["available", "partial", "unavailable"].includes(measured.status)) return invalid();
  const candidate = measured.sector_window_measurements;
  if (!validateExact(candidate)) return invalid();
  // The opaque receipt is bounded and qualified on the received object itself, before the
  // document is cloned. An oversized receipt, or one that carries a value JSON cannot hold, is
  // refused here rather than expanded into a clone first.
  const admission = admitReceipt(candidate);
  if (!admission.admitted) return invalid();
  try {
    // Clone after bounded admission, so no reference into a shared owner payload
    // escapes and no non-JSON object can change the returned contract.
    const measurements: unknown = structuredClone(candidate);
    if (!validateExact(measurements) || !exactConsistent(measurements, measured)) return invalid();
    // The admitted receipt is the detached plain-JSON copy, never the received object.
    if (admission.receipt !== null) {
      (measurements as SectorWindowMeasurements).receipt = admission.receipt;
    }
    return { state: "ok", reason: null, measurements };
  } catch {
    return invalid();
  }
}
