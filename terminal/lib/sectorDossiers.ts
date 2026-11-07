/**
 * Optional Persistent Sector Leadership consumer contract.
 *
 * Reads only sectorPayload.measured_read.sector_dossiers. This module neither
 * fetches nor activates a producer, modifies the legacy measured panel, chooses
 * membership, computes a forecast, or grants trading authority. The cohort IDs
 * below are the closed v1 wire identities, not a second membership registry.
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
