/**
 * Catalyst Intelligence common read model.
 *
 * This module is deliberately a projection boundary, not a new truth store.
 * It accepts only the two owner contracts admitted by the first Catalyst
 * product slice and copies a bounded set of owner facts into one display
 * shape. It never manufactures issuer identity, probability, financial
 * materiality, payoff, ranking, recommendation, or trading authority.
 */

export const CATALYST_READ_ITEM_SCHEMA = "catalyst_read_item.v1" as const;
export const CATALYST_READ_PAGE_SCHEMA = "catalyst_read_page.v1" as const;

type JsonRecord = Record<string, unknown>;

export type CatalystIdentityState =
  | "resolved"
  | "unresolved"
  | "ambiguous"
  | "not_reviewed";

export interface CatalystIdentity {
  readonly state: CatalystIdentityState;
  readonly issuerId: string | null;
  readonly securityIds: readonly string[];
  readonly displaySymbols: readonly string[];
  readonly role: string | null;
}

export interface CatalystTiming {
  readonly lowerDate: string | null;
  readonly upperDate: string | null;
  readonly precision: string | null;
  readonly sourceClass?: string | null;
  readonly sourceWording?: string | null;
}

export interface CatalystUnavailable {
  readonly state: "unavailable";
  readonly reason: string;
}

export interface CatalystNotAdmitted {
  readonly state: "not_admitted";
  readonly reason: string;
}

export interface CatalystResearchPriority {
  readonly state: "research_only";
  readonly lane: "ACT_NOW" | "RECONCILE" | "RESEARCH_NEXT" | "MONITOR";
}

export interface CatalystBioFacts {
  readonly kind: "bio_catalyst";
  readonly occurrence: string | null;
}

export interface CatalystFmsFacts {
  readonly kind: "fms_notification";
  readonly customerCountry: string | null;
  readonly capabilityTitle: string | null;
  readonly stage: string;
  readonly estimatedNotificationValue: number | null;
  readonly currency: string | null;
  readonly contractorNames: readonly string[];
  readonly sourceCaveat: string | null;
}

export interface CatalystReadItem {
  readonly schema: typeof CATALYST_READ_ITEM_SCHEMA;
  readonly owner: "biocatalyst" | "government_revenue_fms";
  readonly ownerContract: "biocatalyst_what_matters_next.v1" | "government_fms_case.v1";
  readonly ownerGeneration: string;
  readonly eventRef: string;
  readonly eventFamily: string;
  readonly identity: CatalystIdentity;
  readonly timing: CatalystTiming;
  readonly facts: CatalystBioFacts | CatalystFmsFacts;
  readonly researchPriority: CatalystResearchPriority | CatalystUnavailable;
  readonly nativeProbability: CatalystUnavailable;
  readonly financialMateriality: CatalystUnavailable;
  readonly conditionalPayoff: CatalystUnavailable;
  readonly recommendation: CatalystNotAdmitted;
}

export interface CatalystReadPage {
  readonly schema: typeof CATALYST_READ_PAGE_SCHEMA;
  readonly items: readonly CatalystReadItem[];
}

const BIO_CONTRACT = "biocatalyst_what_matters_next.v1" as const;
const FMS_CONTRACT = "government_fms_case.v1" as const;
const VERSION = "1.0.0";
const BIO_LANES = new Set(["ACT_NOW", "RECONCILE", "RESEARCH_NEXT", "MONITOR"]);

function record(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} contract must be an object`);
  }
  return value as JsonRecord;
}

function list(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} contract must be an array`);
  }
  return value;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} contract must be a non-empty string`);
  }
  return value;
}

function textOrNull(value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null;
  return text(value, label);
}

function finiteNumberOrNull(value: unknown, label: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} contract must be finite or null`);
  }
  return value;
}

function requireSchema(root: JsonRecord, contractKey: "contract" | "contract_id", expected: string): void {
  if (root[contractKey] !== expected || root.schema_version !== VERSION) {
    throw new Error(`unsupported catalyst owner contract: expected ${expected}@${VERSION}`);
  }
}

function requireAuthority(root: JsonRecord, expected: Readonly<Record<string, unknown>>, owner: string): void {
  const authority = record(root.authority, `${owner}.authority`);
  for (const [key, value] of Object.entries(expected)) {
    if (authority[key] !== value) {
      throw new Error(`${owner} authority contract violated at ${key}`);
    }
  }
}

function unavailableFromOwner(
  row: JsonRecord,
  key: string,
  fallbackReason: string,
): CatalystUnavailable {
  const value = record(row[key], `biocatalyst row.${key}`);
  if (value.state !== "NOT_ESTIMABLE") {
    throw new Error(`biocatalyst ${key} authority is not admitted in the common read model`);
  }
  if (value.value !== null || value.method_ref !== null || value.as_of !== null) {
    throw new Error(`biocatalyst ${key} NOT_ESTIMABLE slot carries an estimate`);
  }
  const evidenceRefs = list(value.evidence_refs, `biocatalyst row.${key}.evidence_refs`);
  if (evidenceRefs.length !== 0) {
    throw new Error(`biocatalyst ${key} NOT_ESTIMABLE slot carries evidence`);
  }
  return {
    state: "unavailable",
    reason:
      typeof value.reason_code === "string" && value.reason_code.trim()
        ? value.reason_code
        : fallbackReason,
  };
}

function normalizeBioIdentity(row: JsonRecord): CatalystIdentity {
  const issuer = record(row.issuer, "biocatalyst row.issuer");
  const state = issuer.state;
  if (state === "unresolved" || state === "ambiguous") {
    if (issuer.issuer_id !== null && issuer.issuer_id !== undefined) {
      throw new Error(`biocatalyst ${state} identity cannot carry issuer_id`);
    }
    const securities = list(issuer.securities, "biocatalyst row.issuer.securities");
    if (securities.length !== 0) {
      throw new Error(`biocatalyst ${state} identity cannot carry securities`);
    }
    return {
      state,
      issuerId: null,
      securityIds: [],
      displaySymbols: [],
      role: null,
    };
  }
  if (state !== "resolved") {
    throw new Error("biocatalyst identity state is unsupported");
  }

  const issuerId = text(issuer.issuer_id, "biocatalyst row.issuer.issuer_id");
  const role = textOrNull(issuer.relationship_role, "biocatalyst row.issuer.relationship_role");
  const securities = list(issuer.securities, "biocatalyst row.issuer.securities");
  if (securities.length === 0) {
    throw new Error("biocatalyst resolved identity requires at least one security");
  }
  const securityIds: string[] = [];
  const displaySymbols: string[] = [];
  for (const rawSecurity of securities) {
    const security = record(rawSecurity, "biocatalyst security");
    securityIds.push(text(security.security_id, "biocatalyst security.security_id"));
    displaySymbols.push(text(security.display_symbol, "biocatalyst security.display_symbol"));
  }

  return {
    state: "resolved",
    issuerId,
    securityIds,
    displaySymbols,
    role,
  };
}

function normalizeBioTiming(row: JsonRecord): CatalystTiming {
  const timing = record(row.timing, "biocatalyst row.timing");
  return {
    lowerDate: textOrNull(timing.lower_date, "biocatalyst timing.lower_date"),
    upperDate: textOrNull(timing.upper_date, "biocatalyst timing.upper_date"),
    precision: textOrNull(timing.precision, "biocatalyst timing.precision"),
    sourceClass: textOrNull(timing.source_class, "biocatalyst timing.source_class"),
    sourceWording: textOrNull(timing.source_wording, "biocatalyst timing.source_wording"),
  };
}

function normalizeBioPriority(row: JsonRecord): CatalystResearchPriority {
  const priority = record(row.research_priority, "biocatalyst row.research_priority");
  if (priority.disposition !== "SELECTED") {
    throw new Error("biocatalyst read page contains a non-selected row");
  }
  const lane = text(priority.lane, "biocatalyst row.research_priority.lane");
  if (!BIO_LANES.has(lane)) {
    throw new Error("biocatalyst research lane is unsupported");
  }
  return {
    state: "research_only",
    lane: lane as CatalystResearchPriority["lane"],
  };
}

export function normalizeBioCatalystPage(payload: unknown): CatalystReadPage {
  const root = record(payload, "biocatalyst page");
  requireSchema(root, "contract_id", BIO_CONTRACT);
  requireAuthority(
    root,
    {
      classification: "research_priority_only",
      trade_origination: false,
      changes_availability: false,
      position_sizing: false,
      prophet_admission: false,
    },
    "biocatalyst",
  );

  const generation = text(root.generation_id, "biocatalyst generation_id");
  const rows = list(root.rows, "biocatalyst rows");
  const items = rows.map((rawRow): CatalystReadItem => {
    const row = record(rawRow, "biocatalyst row");
    const eventRef = text(row.event_fact_ref, "biocatalyst row.event_fact_ref");
    const eventFamily = text(row.event_family, "biocatalyst row.event_family");

    return {
      schema: CATALYST_READ_ITEM_SCHEMA,
      owner: "biocatalyst",
      ownerContract: BIO_CONTRACT,
      ownerGeneration: generation,
      eventRef,
      eventFamily,
      identity: normalizeBioIdentity(row),
      timing: normalizeBioTiming(row),
      facts: {
        kind: "bio_catalyst",
        occurrence: textOrNull(row.occurrence, "biocatalyst row.occurrence"),
      },
      researchPriority: normalizeBioPriority(row),
      nativeProbability: unavailableFromOwner(
        row,
        "probability",
        "probability_owner_not_admitted",
      ),
      financialMateriality: unavailableFromOwner(
        row,
        "materiality",
        "materiality_owner_not_admitted",
      ),
      conditionalPayoff: {
        state: "unavailable",
        reason: "conditional_payoff_owner_not_admitted",
      },
      recommendation: {
        state: "not_admitted",
        reason: "trade_authority_not_admitted",
      },
    };
  });

  return { schema: CATALYST_READ_PAGE_SCHEMA, items };
}

function normalizeFmsContractors(raw: unknown): {
  names: string[];
  identity: CatalystIdentity;
} {
  const contractors = list(raw, "FMS contractors");
  const names: string[] = [];
  for (const rawContractor of contractors) {
    const contractor = record(rawContractor, "FMS contractor");
    const identityState = text(contractor.identity_state, "FMS contractor.identity_state");
    if (identityState !== "not_reviewed") {
      throw new Error("FMS contractor identity state is not admitted in the first common slice");
    }
    if (contractor.issuer_ref !== null && contractor.issuer_ref !== undefined) {
      throw new Error("FMS contractor identity is not reviewed but carries an issuer_ref");
    }
    names.push(text(contractor.name_as_printed, "FMS contractor.name_as_printed"));
  }

  return {
    names,
    identity: {
      state: "not_reviewed",
      issuerId: null,
      securityIds: [],
      displaySymbols: [],
      role: null,
    },
  };
}

function normalizeFmsTiming(row: JsonRecord): CatalystTiming {
  const clocks = record(row.clocks, "FMS case.clocks");
  const rawClock = clocks.official_notification_date;
  if (rawClock === null || rawClock === undefined) {
    return { lowerDate: null, upperDate: null, precision: null };
  }
  const clock = record(rawClock, "FMS official_notification_date");
  const date = textOrNull(clock.value, "FMS official_notification_date.value");
  return {
    lowerDate: date,
    upperDate: date,
    precision: date === null ? null : "day",
    sourceClass: textOrNull(clock.provenance, "FMS official_notification_date.provenance"),
  };
}

export function normalizeFmsCasePage(payload: unknown): CatalystReadPage {
  const root = record(payload, "FMS page");
  requireSchema(root, "contract", FMS_CONTRACT);
  requireAuthority(
    root,
    {
      tier: "display",
      context_only: true,
      can_rank: false,
      can_size: false,
      can_gate: false,
      can_originate_signal: false,
      can_add_candidates: false,
      can_escalate: false,
    },
    "FMS",
  );

  const generation = text(root.content_id, "FMS content_id");
  const cases = list(root.cases, "FMS cases");
  const items = cases.map((rawCase): CatalystReadItem => {
    const row = record(rawCase, "FMS case");
    const eventRef = text(row.case_key, "FMS case.case_key");
    const stage = text(row.stage, "FMS case.stage");
    if (stage !== "congressional_notification") {
      throw new Error("FMS stage is outside the admitted congressional-notification slice");
    }
    const contractors = normalizeFmsContractors(row.contractors);

    return {
      schema: CATALYST_READ_ITEM_SCHEMA,
      owner: "government_revenue_fms",
      ownerContract: FMS_CONTRACT,
      ownerGeneration: generation,
      eventRef,
      eventFamily: "fms_congressional_notification",
      identity: contractors.identity,
      timing: normalizeFmsTiming(row),
      facts: {
        kind: "fms_notification",
        customerCountry: textOrNull(row.customer_country, "FMS case.customer_country"),
        capabilityTitle: textOrNull(row.capability_title, "FMS case.capability_title"),
        stage,
        estimatedNotificationValue: finiteNumberOrNull(
          row.estimated_notification_value,
          "FMS case.estimated_notification_value",
        ),
        currency: textOrNull(row.currency, "FMS case.currency"),
        contractorNames: contractors.names,
        sourceCaveat: textOrNull(row.source_caveat, "FMS case.source_caveat"),
      },
      researchPriority: {
        state: "unavailable",
        reason: "research_priority_owner_not_admitted",
      },
      nativeProbability: {
        state: "unavailable",
        reason: "probability_owner_not_admitted",
      },
      financialMateriality: {
        state: "unavailable",
        reason: "financial_owner_not_qualified",
      },
      conditionalPayoff: {
        state: "unavailable",
        reason: "conditional_payoff_owner_not_admitted",
      },
      recommendation: {
        state: "not_admitted",
        reason: "trade_authority_not_admitted",
      },
    };
  });

  return { schema: CATALYST_READ_PAGE_SCHEMA, items };
}
