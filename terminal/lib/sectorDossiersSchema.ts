/**
 * The two closed JSON Schemas of the Persistent Sector Leadership consumer contract, and the
 * wire vocabularies they are built from.
 *
 * This module is the single source of truth for both schemas. It deliberately imports nothing:
 * the browser never compiles a schema. Ajv turns a schema into a validator with `new Function`,
 * which the production Content-Security-Policy refuses (no 'unsafe-eval'), so the validators are
 * compiled ahead of time by scripts/gen_sector_dossiers_validator.mjs into
 * lib/generated/sectorDossiersValidator.mjs and lib/sectorDossiers.ts imports that module.
 *
 * After any change here, regenerate and commit the validator:
 *   npm run gen:sector-dossiers-validator
 * lib/__tests__/sectorDossiersValidator.test.ts fails while the committed module is stale.
 */

export const SECTOR_DOSSIERS_SCHEMA = "leadership_rotation_context.sector_dossiers/v1";
export const MEASURED_SCHEMA = "leadership_rotation_context.measured_group_read/v1";
export const COHORT = "us_sectors_11";
export const GROUP_IDS = ["XLB", "XLC", "XLE", "XLF", "XLI", "XLK", "XLP", "XLRE", "XLU", "XLV", "XLY"] as const;

/** The Ajv options both validators are compiled with. Shared by the generator and the tests. */
export const SECTOR_DOSSIERS_AJV_OPTIONS = { allErrors: false, strict: true, ownProperties: true } as const;

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

/** leadership_rotation_context.sector_dossiers/v1 — the legacy closed 21/63 dossier. */
export const sectorDossiersJsonSchema = closed({
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

/* -------------------------------------------------------------------------- *
 * Exact-session companion: leadership_rotation_context.sector_window_measurements/v1.
 * -------------------------------------------------------------------------- */

export const SECTOR_WINDOW_MEASUREMENTS_SCHEMA =
  "leadership_rotation_context.sector_window_measurements/v1";

/** The producer's own endpoint definition, pinned to the frozen producer fixture. */
export const EXACT_ENDPOINT_DEFINITION =
  "Endpoint return: P(T)/P(S_N) - 1, where T is the explicit end session and S_N is the canonical "
  + "US session exactly N positions before T, so a 5-session return spans 6 session endpoints. "
  + "Relative wealth is (1+R_group)/(1+R_benchmark) - 1 -- a wealth ratio, never a return "
  + "difference. Interior gaps never move an endpoint; they are disclosed as observed coverage. "
  + "Prices are strictly positive, finite, total-return adjusted closes read at the two endpoints only.";

export const EXACT_WINDOW_KEYS = ["5", "20", "63"] as const;

/** The producer's full measurement reason vocabulary. */
export const EXACT_REASONS = [
  "missing_input", "non_finite_input", "invalid_price", "benchmark_missing", "benchmark_invalid",
  "insufficient_reference_history", "empty_panel", "future_tail", "source_session_mismatch",
  "ambiguous_duplicate_price_index", "ambiguous_duplicate_column", "cohort_identity_mismatch",
  "benchmark_identity_mismatch", "return_basis_not_qualified",
] as const;

/**
 * The last eight reasons refuse the whole panel. The first six qualify one
 * published value. `insufficient_reference_history` is a per-window condition
 * and is decided before any block reason.
 */
export const EXACT_BLOCK_REASONS = [
  "empty_panel", "future_tail", "source_session_mismatch", "ambiguous_duplicate_price_index",
  "ambiguous_duplicate_column", "cohort_identity_mismatch", "benchmark_identity_mismatch",
  "return_basis_not_qualified",
] as const;

/** The producer's own binding keys. Nothing outside this list is a binding. */
export const EXACT_BINDING_KEYS = [
  "source_roots", "clocks", "receipt", "cohort_id", "benchmark", "source_session", "price_basis",
] as const;

const boundedText = (maxLength: number) => ({
  type: "string", minLength: 1, maxLength, pattern: "^[^\\u0000-\\u001f]+(?![\\s\\S])",
});
const sessionDate = { type: "string", format: "date", pattern: "^(?!0000)\\d{4}-\\d{2}-\\d{2}(?![\\s\\S])" };
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

/** leadership_rotation_context.sector_window_measurements/v1 — the exact 5/20/63 companion. */
export const sectorWindowMeasurementsJsonSchema = closed({
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
