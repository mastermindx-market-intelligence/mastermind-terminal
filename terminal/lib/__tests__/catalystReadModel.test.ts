import { describe, expect, it } from "vitest";
import {
  CATALYST_READ_ITEM_SCHEMA,
  normalizeBioCatalystPage,
  normalizeFmsCasePage,
} from "../catalystReadModel";

function notEstimable(kind: string) {
  return {
    state: "NOT_ESTIMABLE",
    value: null,
    reason_code: `${kind.toUpperCase()}_OWNER_NOT_ADMITTED`,
    method_ref: null,
    as_of: null,
    evidence_refs: [],
  } as const;
}

function bioRow(identity: "resolved" | "unresolved" | "ambiguous" = "resolved") {
  return {
    row_key: { event_fact_ref: "evt-biib-readout", issuer_id: identity === "resolved" ? "ISS:US-XNAS-BIIB" : null },
    event_fact_ref: "evt-biib-readout",
    event_family: "issuer_readout_guidance",
    event_revision_ref: "sec:biib:q2:r1",
    revision_is_current: true,
    occurrence: "uncorroborated",
    timing: {
      state: "consistent",
      source_class: "issuer_guided",
      lower_date: "2026-12-01",
      upper_date: "2026-12-31",
      precision: "month",
      source_timezone: null,
      source_wording: "expects registrational data by year end",
      evidence_refs: ["sec:biib:q2"],
    },
    issuer:
      identity === "resolved"
        ? {
            state: "resolved",
            issuer_id: "ISS:US-XNAS-BIIB",
            company_id: "company:cik:0000875045",
            relationship_role: "issuer",
            identity_scope: "current_only",
            identity_observed_at: "2026-10-04T05:57:46Z",
            securities: [
              {
                security_id: "SEC:US-XNAS-BIIB",
                listing_key: "US-XNAS-BIIB",
                display_symbol: "BIIB",
                symbol_observed_on: "2026-10-04",
                state: "active",
              },
            ],
          }
        : {
            state: identity,
            issuer_id: null,
            company_id: "company:cik:0001280776",
            relationship_role: null,
            identity_scope: "unavailable",
            identity_observed_at: "2026-10-04T05:57:46Z",
            securities: [],
          },
    assets: [],
    relationships: [],
    economic_exposure_state: "unresolved",
    evidence: [],
    revision_summary: {
      revision_ref: "sec:biib:q2:r1",
      revision_is_current: true,
      last_material_revision_known_at: null,
    },
    research_priority: {
      method_id: "biocatalyst.research_triage.v1",
      lane: identity === "resolved" ? "RESEARCH_NEXT" : "RECONCILE",
      disposition: "SELECTED",
      reason_codes: identity === "resolved" ? [] : ["CURRENT_ISSUER_UNRESOLVED"],
    },
    probability: notEstimable("probability"),
    materiality: notEstimable("materiality"),
    historical_response: notEstimable("historical_response"),
    incorporation: notEstimable("incorporation"),
    missingness: {
      source: [],
      identity: identity === "resolved" ? [] : ["CURRENT_ISSUER_UNRESOLVED"],
      asset: ["ASSET_PORT_NOT_ADMITTED"],
      economic: ["ECONOMIC_EXPOSURE_UNRESOLVED"],
      estimates: [
        "PROBABILITY_OWNER_NOT_ADMITTED",
        "MATERIALITY_OWNER_NOT_ADMITTED",
        "HISTORICAL_RESPONSE_OWNER_NOT_ADMITTED",
        "INCORPORATION_OWNER_NOT_ADMITTED",
      ],
    },
    links: {
      stock_research:
        identity === "resolved"
          ? [{ security_id: "SEC:US-XNAS-BIIB", relationship_role: "issuer", href: "stock.html?ticker=BIIB" }]
          : [],
    },
  };
}

function bioPage(identity: "resolved" | "unresolved" | "ambiguous" = "resolved") {
  return {
    contract_id: "biocatalyst_what_matters_next.v1",
    schema_version: "1.0.0",
    generation_id: "ctgov_run_20261004",
    state: "partial",
    reason_codes: [],
    input_cut: { cutoff: "2026-10-04T05:57:46Z", members: [] },
    query: { view: "upcoming", horizon_days: 90, q: null, event_family: null, lane: null, limit: 50 },
    evaluation_cutoff: "2026-10-04T05:58:00Z",
    anchor_date: "2026-10-04",
    method_id: "biocatalyst.research_triage.v1",
    authority: {
      classification: "research_priority_only",
      trade_origination: false,
      changes_availability: false,
      position_sizing: false,
      prophet_admission: false,
    },
    coverage: {
      declared_universe_ref: "bio:first-company-event-slice",
      source_event_count: 1,
      issuer_event_count: identity === "resolved" ? 1 : 0,
      security_count: identity === "resolved" ? 1 : 0,
      unresolved_event_count: identity === "resolved" ? 0 : 1,
      rejected_count: 0,
      superseded_count: 0,
      lane_counts: { ACT_NOW: 0, RECONCILE: identity === "resolved" ? 0 : 1, RESEARCH_NEXT: identity === "resolved" ? 1 : 0, MONITOR: 0 },
      selected_row_count: 1,
      family_states: {},
      missing_owner_ports: ["economic_exposure", "probability", "materiality"],
    },
    rows: [bioRow(identity)],
    pagination: { limit: 50, total: 1, next_cursor: null },
  };
}

function fmsPage() {
  return {
    contract: "government_fms_case.v1",
    schema_version: "1.0.0",
    content_id: "grfms1-1234567890abcdef12345678",
    as_of: "2026-10-04",
    known_at: "2026-10-04T06:10:00Z",
    authority: {
      tier: "display",
      context_only: true,
      can_rank: false,
      can_size: false,
      can_gate: false,
      can_originate_signal: false,
      can_add_candidates: false,
      can_escalate: false,
    },
    scope: { delivered_from: "2026-01-01", delivered_through: "2026-10-04" },
    coverage: {
      law: "official_union_v1",
      sources: {
        federal_register: { status: "ok" },
        state_pm_bureau: { status: "stale" },
        dsca_press: { status: "stale" },
      },
      reconciliation: {
        denominator_transmittals: 1,
        cases_built: 1,
        denominator_unbuilt: [],
        web_only_cases: 0,
        web_absent_cases: [],
      },
    },
    limitations: ["Congressional notification is not an award or recognized issuer revenue."],
    cases: [
      {
        case_key: "fms:transmittal:26-61",
        transmittal_number: "26-61",
        identity_basis: "transmittal",
        case_identity_state: "resolved",
        aliases: [],
        customer_country: "Kuwait",
        capability_title: "F/A-18 sustainment and related support",
        source_item_enumeration: "Official notification items",
        stage: "congressional_notification",
        later_stages: "stage_not_observed",
        advancement_condition: "official_evidence_of_offered_accepted_or_implemented_loa",
        estimated_notification_value: 484000000,
        currency: "USD",
        source_caveat: "Estimated proposed-sale value; not an award.",
        value_provenance: "fr_total_estimated_value",
        contractors: [
          {
            name_as_printed: "The Boeing Company",
            location_as_printed: "St. Louis, MO",
            identity_state: "not_reviewed",
            issuer_ref: null,
          },
        ],
        contractor_note: "Contractor identity is not reviewed for issuer linkage.",
        program_links: [
          {
            state: "not_reviewed",
            reason_code: "no_reviewed_program_link",
            program_id: null,
            program_case_link_id: null,
            ontology_graph_id: null,
          },
        ],
        clocks: {
          official_notification_date: { value: "2026-07-15", provenance: "fr_delivered_to_congress" },
        },
        source_coverage: { state: "partial" },
        observations: [],
        case_state: "current",
      },
    ],
    total: 1,
  };
}

describe("catalyst common read model", () => {
  it("normalizes a resolved Bio WMN row without inventing economics or trade authority", () => {
    const page = normalizeBioCatalystPage(bioPage());
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      schema: CATALYST_READ_ITEM_SCHEMA,
      owner: "biocatalyst",
      ownerContract: "biocatalyst_what_matters_next.v1",
      ownerGeneration: "ctgov_run_20261004",
      eventRef: "evt-biib-readout",
      eventFamily: "issuer_readout_guidance",
      identity: {
        state: "resolved",
        issuerId: "ISS:US-XNAS-BIIB",
        securityIds: ["SEC:US-XNAS-BIIB"],
        displaySymbols: ["BIIB"],
      },
      timing: { lowerDate: "2026-12-01", upperDate: "2026-12-31", precision: "month" },
      researchPriority: { state: "research_only", lane: "RESEARCH_NEXT" },
      nativeProbability: { state: "unavailable" },
      financialMateriality: { state: "unavailable" },
      conditionalPayoff: { state: "unavailable" },
      recommendation: { state: "not_admitted" },
    });
  });

  it("preserves unresolved Bio identity instead of creating a ticker or issuer link", () => {
    const page = normalizeBioCatalystPage(bioPage("unresolved"));
    expect(page.items[0].identity).toEqual({
      state: "unresolved",
      issuerId: null,
      securityIds: [],
      displaySymbols: [],
      role: null,
    });
    expect(page.items[0].researchPriority).toEqual({ state: "research_only", lane: "RECONCILE" });
  });

  it("preserves ambiguous Bio identity without selecting a candidate issuer", () => {
    const page = normalizeBioCatalystPage(bioPage("ambiguous"));
    expect(page.items[0].identity).toEqual({
      state: "ambiguous",
      issuerId: null,
      securityIds: [],
      displaySymbols: [],
      role: null,
    });
    expect(page.items[0].researchPriority).toEqual({ state: "research_only", lane: "RECONCILE" });
  });

  it("rejects a Bio estimate slot that pretends an owner estimate is admitted", () => {
    const raw = bioPage() as any;
    raw.rows[0].probability = { state: "unavailable", reason: "owner_not_admitted" };
    expect(() => normalizeBioCatalystPage(raw)).toThrow(/probability/i);
  });

  it("normalizes FMS source facts while keeping contractor identity and financial materiality unavailable", () => {
    const page = normalizeFmsCasePage(fmsPage());
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      schema: CATALYST_READ_ITEM_SCHEMA,
      owner: "government_revenue_fms",
      ownerContract: "government_fms_case.v1",
      ownerGeneration: "grfms1-1234567890abcdef12345678",
      eventRef: "fms:transmittal:26-61",
      eventFamily: "fms_congressional_notification",
      identity: {
        state: "not_reviewed",
        issuerId: null,
        securityIds: [],
        displaySymbols: [],
      },
      facts: {
        kind: "fms_notification",
        customerCountry: "Kuwait",
        stage: "congressional_notification",
        estimatedNotificationValue: 484000000,
        currency: "USD",
        contractorNames: ["The Boeing Company"],
      },
      nativeProbability: { state: "unavailable" },
      financialMateriality: { state: "unavailable" },
      conditionalPayoff: { state: "unavailable" },
      recommendation: { state: "not_admitted" },
    });
  });

  it("rejects a Bio owner envelope that claims trade authority", () => {
    const raw = bioPage();
    raw.authority.trade_origination = true;
    expect(() => normalizeBioCatalystPage(raw)).toThrow(/authority/i);
  });

  it("rejects an FMS contractor that tries to smuggle an issuer link through not_reviewed", () => {
    const raw = fmsPage();
    (raw.cases[0].contractors[0] as any).issuer_ref = "ISS:US-XNYS-BA";
    expect(() => normalizeFmsCasePage(raw)).toThrow(/contractor/i);
  });

  it("never converts proposed-sale amount into financial materiality or a cross-sector score", () => {
    const item = normalizeFmsCasePage(fmsPage()).items[0] as any;
    expect(item.facts.estimatedNotificationValue).toBe(484000000);
    expect(item.financialMateriality).toEqual({ state: "unavailable", reason: "financial_owner_not_qualified" });
    expect(item.score).toBeUndefined();
    expect(item.expectedReturn).toBeUndefined();
  });

  it("rejects unknown owner contracts instead of guessing a family", () => {
    const raw = bioPage() as any;
    raw.contract_id = "biocatalyst_what_matters_next.v2";
    expect(() => normalizeBioCatalystPage(raw)).toThrow(/contract/i);

    const fms = fmsPage() as any;
    fms.contract = "government_fms_case.v2";
    expect(() => normalizeFmsCasePage(fms)).toThrow(/contract/i);
  });
});
