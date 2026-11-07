import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { sectorDossiers, sectorWindowMeasurements } from "../sectorDossiers";
import { readableOwnerEnvelope, sectorMeasuredRead } from "../sectorIntelligence";
import fixture from "./fixtures/sector_dossiers_v1.json";
import outage from "./fixtures/sector_dossiers_unavailable_v1.json";
import legacy from "./fixtures/measured_read_v1.json";
import complete from "./fixtures/sector_window_measurements.complete.v1.json";
import unavailable from "./fixtures/sector_window_measurements.unavailable.v1.json";

const payload = (read: unknown = fixture) => ({ measured_read: read });
const clone = () => structuredClone(fixture);
const object = (value: unknown) => value as Record<string, unknown>;
function changed(path: string[], value: unknown) {
  const read = clone();
  let target = object(read);
  for (const key of path.slice(0, -1)) target = object(target[key]);
  target[path[path.length - 1]] = value;
  return payload(read);
}

describe("Persistent Sector Leadership dossier consumer", () => {
  it("pins actual producer bytes and leaves the accepted legacy fixture intact", () => {
    const bytes = readFileSync(new URL("./fixtures/sector_dossiers_v1.json", import.meta.url));
    expect(createHash("sha256").update(bytes).digest("hex"))
      .toBe("22bb12e0516db2ca8f99b8d10af93deab0f75c96d362ae84a3fa99d95855fcb3");
    const { sector_dossiers: addendum, ...old } = fixture;
    expect(addendum.schema).toBe("leadership_rotation_context.sector_dossiers/v1");
    expect(old).toEqual(legacy);
    expect(sectorMeasuredRead(payload())).toEqual(sectorMeasuredRead(payload(legacy)));
  });

  it("preserves all eleven identities, owner missingness, zero and exact windows", () => {
    const result = sectorDossiers(payload());
    expect(result.state).toBe("ok");
    if (result.state !== "ok") throw new Error("Expected producer dossier");
    expect(result.dossier).toEqual(fixture.sector_dossiers);
    expect(result.dossier).not.toBe(fixture.sector_dossiers);
    expect(result.dossier.groups.map(row => row.group_id))
      .toEqual(["XLB", "XLC", "XLE", "XLF", "XLI", "XLK", "XLP", "XLRE", "XLU", "XLV", "XLY"]);
    const zero = result.dossier.groups.find(row => row.group_id === "XLK")!;
    expect(zero.relative_wealth_pct.rs_63d).toBe(0);
    expect(zero.null_reasons.rs_63d).toBeNull();
    for (const id of ["XLU", "XLRE"]) {
      const row = result.dossier.groups.find(row => row.group_id === id)!;
      expect(row.relative_wealth_pct).toEqual({ rs_21d: null, rs_63d: null });
      expect(row.null_reasons.rs_63d).not.toBeNull();
    }
    expect(result.dossier.windows_sessions).toEqual([21, 63]);
    expect(result.dossier.unavailable_windows.sessions).toEqual([5, 20]);
    expect(result.dossier.availability.historically_admissible).toBe(false);
    expect(Object.values(result.dossier.authority)).toEqual([false, false, false, false, false]);
  });

  it("returns absent for old or missing addenda without recursive fallback", () => {
    for (const input of [null, [], {}, "bad", payload(legacy),
      { sector_dossiers: fixture.sector_dossiers },
      { data: payload() }]) {
      expect(sectorDossiers(input)).toEqual({
        state: "absent", reason: "dossier_not_supplied", dossier: null,
      });
    }
  });

  it("preserves the actual owner's unavailable document without inventing a zero", () => {
    const result = sectorDossiers(payload(outage));
    expect(result.state).toBe("outage");
    expect(result.dossier).toEqual(outage.sector_dossiers);
    expect(result.dossier?.groups).toHaveLength(11);
    expect(result.dossier?.cross_sector_breadth_counts["21"].positive_n).toBeNull();
    expect(result.dossier?.as_of).toBeNull();
  });

  it("survives the existing sector owner-envelope boundary without a new gateway", () => {
    const ownerBody = { as_of: "2026-10-09", sectors: [], measured_read: fixture };
    expect(readableOwnerEnvelope("sector", ownerBody)).toBe(true);
    expect(sectorDossiers(ownerBody).dossier).toEqual(fixture.sector_dossiers);
  });

  it("returns detached content and never mutates the shared owner object", () => {
    const source = clone(), before = structuredClone(source);
    const result = sectorDossiers(payload(source));
    expect(source).toEqual(before);
    if (result.state !== "ok") throw new Error("Expected producer dossier");
    result.dossier.groups[0].relative_wealth_pct.rs_21d = 999;
    result.dossier.diagnostics.qualification_reasons.push("consumer_edit");
    expect(source).toEqual(before);
  });

  it.each([
    [["schema"], "other"],
    [["status"], "unknown"],
    [["generation", "cohort_id"], "top_six"],
    [["generation", "session_end"], "2026-10-08"],
    [["sector_dossiers", "schema"], "other/v1"],
    [["sector_dossiers", "cohort_id"], "top_six"],
    [["sector_dossiers", "as_of"], "2026-02-30"],
    [["sector_dossiers", "as_of"], "2026-10-08"],
    [["sector_dossiers", "benchmark"], "QQQ"],
    [["sector_dossiers", "price_basis"], "price_only"],
    [["sector_dossiers", "units"], "fraction"],
    [["sector_dossiers", "windows_sessions"], [20, 63]],
    [["sector_dossiers", "source_generation", "id"], "invented"],
    [["sector_dossiers", "availability", "original_available_at"], "2026-10-09T12:00:00Z"],
    [["sector_dossiers", "availability", "historically_admissible"], true],
    [["sector_dossiers", "availability", "mode"], "as_known"],
    [["sector_dossiers", "history", "naturally_observed"], true],
    [["sector_dossiers", "freshness", "status"], "fresh"],
    [["sector_dossiers", "authority", "may_trade"], true],
    [["sector_dossiers", "forecasts", "allocation_weight"], 0.2],
    [["sector_dossiers", "independent_confidence"], 0.9],
    [["sector_dossiers", "groups", "0", "group_id"], "QQQ"],
    [["sector_dossiers", "groups", "0", "relative_wealth_pct", "rs_21d"], false],
    [["sector_dossiers", "groups", "0", "relative_wealth_pct", "rs_21d"], Number.NaN],
    [["sector_dossiers", "groups", "0", "relative_wealth_pct", "rs_21d"], Number.POSITIVE_INFINITY],
    [["sector_dossiers", "groups", "0", "relative_wealth_pct", "rs_21d"], -101],
    [["sector_dossiers", "groups", "0", "relative_wealth_pct", "rs_21d"], 999],
    [["sector_dossiers", "groups", "0", "null_reasons", "rs_21d"], "missing_input"],
    [["sector_dossiers", "groups", "0", "qualification_reasons"], ["contradiction"]],
    [["sector_dossiers", "cross_sector_breadth_counts", "63", "positive_n"], 0],
    [["sector_dossiers", "dependency_audit", "source_family_count"], 0],
    [["sector_dossiers", "dependency_audit", "independence"], "independent"],
    [["sector_dossiers", "measurement_status"], "available"],
    [["sector_dossiers", "compatibility_key"], "another_generation"],
  ] as [string[], unknown][])("refuses incompatible contract at %j", (path, value) => {
    expect(sectorDossiers(changed(path, value))).toEqual({
      state: "invalid", reason: "invalid_dossier_contract", dossier: null,
    });
  });

  it("refuses duplicate, omitted and extra sector identities before rendering coverage", () => {
    const duplicate = clone();
    duplicate.sector_dossiers.groups[1].group_id = duplicate.sector_dossiers.groups[0].group_id;
    const missing = clone(); missing.sector_dossiers.groups.pop();
    const extra = clone(); extra.sector_dossiers.groups.push(structuredClone(extra.sector_dossiers.groups[0]));
    const parentDuplicate = clone(); parentDuplicate.groups[1].group_id = parentDuplicate.groups[0].group_id;
    for (const input of [duplicate, missing, extra, parentDuplicate]) {
      expect(sectorDossiers(payload(input)).state).toBe("invalid");
    }
  });

  it("refuses a null measurement that lost its explicit owner reason", () => {
    const read = clone();
    const missing = read.sector_dossiers.groups.find(row => row.group_id === "XLRE")!;
    missing.null_reasons.rs_63d = null;
    expect(sectorDossiers(payload(read)).state).toBe("invalid");
  });
});


it("rejects trailing control characters even when parent and addendum agree", () => {
  const benchmark = clone();
  benchmark.generation.benchmark = "SPY\n";
  benchmark.sector_dossiers.benchmark = "SPY\n";
  const session = clone();
  session.generation.session_end = "2026-10-09\n";
  session.sector_dossiers.as_of = "2026-10-09\n";
  const name = clone();
  name.sector_dossiers.groups[0].name_en = "Materials\n";
  for (const source of [benchmark, session, name]) {
    expect(sectorDossiers(payload(source)).state).toBe("invalid");
  }
});

it("rejects an audit that calls a native member outside its own cohort", () => {
  expect(sectorDossiers(changed(["sector_dossiers", "diagnostics", "outside_cohort"], ["XLB"])).state)
    .toBe("invalid");
});

/* -------------------------------------------------------------------------- *
 * The exact-session companion.
 *
 * The canonical fixtures are the producer's own frozen documents, fetched verbatim from the
 * pinned comment and copied byte for byte. The parent below is a clearly labelled synthetic
 * November 5 parent: it binds the cohort generation the companion was measured against, and it
 * is NOT the October 9 legacy fixture with its dates moved.
 * -------------------------------------------------------------------------- */

type CompanionCell = {
  status: string;
  absolute_return_pct: number | null;
  relative_wealth_pct: number | null;
  null_reasons: { absolute_return_pct: string | null; relative_wealth_pct: string | null };
  coverage: { observed_n: number; expected_n: number; ratio: number };
};
type CompanionWindow = {
  window_sessions: number;
  status: string;
  start_session: string | null;
  end_session: string;
  benchmark_return_pct: number | null;
  benchmark_null_reason: string | null;
  benchmark_coverage: { observed_n: number; expected_n: number; ratio: number };
  null_reason: string | null;
};
type CompanionDoc = {
  schema: string;
  status: string;
  reason: string | null;
  units: string;
  price_basis: string;
  cohort_id: string;
  population: string;
  benchmark: string;
  source_session: string;
  end_session: string;
  windows_sessions: number[];
  endpoint_definition: string;
  clocks: Record<string, string | null>;
  limitations: {
    availability: { status: string; reason?: string; clock?: string };
    publication: { status: string; reason?: string; clock?: string };
    history: { status: string; reason?: string; clock?: string };
    corrections: { status: string; reason: string };
    freshness: { status: string; reason: string };
    point_in_time: { status: string; reason: string };
  };
  windows: Record<string, CompanionWindow>;
  groups: { group_id: string; name_en: string | null; name_zh: string | null; windows: Record<string, CompanionCell> }[];
  diagnostics: {
    panel_rows: number;
    malformed_rows: number;
    duplicate_sessions: string[];
    ambiguous_columns: string[];
    columns: string[];
    binding_keys: string[];
    receipt_withheld: boolean;
    future_tail_sessions: string[];
    expected_columns: number;
    qualification_reasons: string[];
    measured_cells: number;
    complete_cells: number;
    total_cells: number;
    coverage_note: string;
  };
  authority: Record<string, boolean>;
  source_roots: string[];
  receipt: Record<string, unknown> | null;
};
type CompanionParent = {
  schema: string;
  status: string;
  generation: Record<string, string>;
  groups: unknown[];
  sector_window_measurements: unknown;
};

const COHORT_ORDER = ["XLB", "XLC", "XLE", "XLF", "XLI", "XLK", "XLP", "XLRE", "XLU", "XLV", "XLY"];
const WINDOW_KEYS = ["5", "20", "63"] as const;

/** The clearly labelled synthetic November 5 parent. It carries no legacy dossier, so the
 * companion is proved on its own, and it never reuses the October 9 legacy fixture. */
function nov5Parent(read: unknown = complete): CompanionParent {
  return {
    schema: "leadership_rotation_context.measured_group_read/v1",
    status: "available",
    generation: {
      benchmark: "SPY", cohort_id: "us_sectors_11", history_as_of: "2026-11-05",
      history_schema: "sector_cycles.rs_history.v1", id: "2026-11-05|SPY|us_sectors_11",
      price_basis: "total_return", session_end: "2026-11-05",
    },
    groups: [],
    sector_window_measurements: read,
  };
}
const companionPayload = (read: unknown = complete) => ({ measured_read: nov5Parent(read) });
const companion = (read: unknown = complete) => sectorWindowMeasurements(companionPayload(read));
const doc = (): CompanionDoc => structuredClone(complete) as unknown as CompanionDoc;
const cell = (source: CompanionDoc, group: string, window: string) =>
  source.groups.find(row => row.group_id === group)!.windows[window];

/** The clearly labelled synthetic insufficient-reference-history window. It is the one case in
 * which a null start session is legitimate, so it is built once and reused. */
function thinHistoryDoc(): CompanionDoc {
  const source = doc();
  const window = source.windows["63"];
  window.start_session = null;
  window.null_reason = "insufficient_reference_history";
  window.benchmark_return_pct = null;
  window.benchmark_null_reason = "insufficient_reference_history";
  window.benchmark_coverage = { observed_n: 0, expected_n: 64, ratio: 0 };
  window.status = "unavailable";
  for (const group of source.groups) {
    const value = group.windows["63"];
    value.absolute_return_pct = null;
    value.relative_wealth_pct = null;
    value.null_reasons = {
      absolute_return_pct: "insufficient_reference_history",
      relative_wealth_pct: "insufficient_reference_history",
    };
    value.status = "unavailable";
    value.coverage = { observed_n: 0, expected_n: 64, ratio: 0 };
  }
  source.diagnostics.measured_cells = 22;
  source.diagnostics.complete_cells = 22;
  source.status = "partial";
  return source;
}

/** The clearly labelled synthetic legacy dossier for the coherent November 5 parent. It is not the
 * October 9 fixture with its dates moved: it carries its own synthetic 21/63 values, and no
 * numeric equality with the exact 5/20/63 companion is claimed or required. */
function syntheticLegacyDossier() {
  const groups = COHORT_ORDER.map((group_id, index) => ({
    group_id, name_en: null, name_zh: null, status: "available",
    relative_wealth_pct: { rs_21d: (index - 5) * 0.5, rs_63d: (index - 5) * 0.25 },
    null_reasons: { rs_21d: null, rs_63d: null },
    qualification_reasons: [] as string[],
  }));
  const positives = (key: "rs_21d" | "rs_63d") =>
    groups.filter(group => group.relative_wealth_pct[key] > 0).length;
  return {
    schema: "leadership_rotation_context.sector_dossiers/v1",
    status: "partial", measurement_status: "available",
    cohort_id: "us_sectors_11", population: "eleven_sector_etf_proxies",
    as_of: "2026-11-05", benchmark: "SPY", price_basis: "total_return", units: "pct",
    windows_sessions: [21, 63],
    unavailable_windows: { sessions: [5, 20], reason: "not_supplied_by_owner" },
    absolute_returns: { status: "unavailable", reason: "not_supplied_by_owner" },
    compatibility_key: "2026-11-05|SPY|us_sectors_11",
    source_generation: { status: "unavailable", reason: "immutable_generation_not_supplied", id: null },
    availability: {
      mode: "dated_snapshot", decision_cutoff: null, original_available_at: null,
      historically_admissible: false, reason: "original_availability_not_supplied",
    },
    history: { mode: "reconstructed_price_history", naturally_observed: false },
    freshness: { status: "unverified", reason: "owner_freshness_receipt_not_supplied" },
    corrections: { status: "unavailable", reason: "native_revision_selection_not_supplied" },
    authority: {
      may_rank: false, may_gate: false, may_size: false, may_trade: false, may_escalate: false,
    },
    forecasts: {
      status: "not_qualified", expected_return: null,
      persistence_estimate: null, allocation_weight: null,
    },
    mechanism: { status: "unavailable", reason: "no_qualified_evidence", owner: "engine.theme_graph" },
    risk: {
      status: "unavailable", reason: "no_qualified_risk_context",
      owner: "engine.risk_envelope", scope: null,
    },
    constituent_breadth: { status: "unavailable", reason: "native_membership_not_supplied" },
    constituent_concentration: { status: "unavailable", reason: "native_weights_not_supplied" },
    cross_sector_breadth_counts: {
      "21": { expected_n: 11, measured_n: 11, positive_n: positives("rs_21d") },
      "63": { expected_n: 11, measured_n: 11, positive_n: positives("rs_63d") },
    },
    dependency_audit: {
      source_roots: ["engine.sector_cycles"], source_family_count: 1,
      independence: "not_established", shared_rolling_windows: true, constituent_overlap: "unknown",
    },
    diagnostics: {
      qualification_reasons: [] as string[], duplicate_groups: [] as string[],
      outside_cohort: [] as string[], malformed_source_rows: 0, malformed_measured_rows: 0,
    },
    groups,
  };
}

/** The coherent November 5 owner document: the synthetic legacy dossier and the exact companion
 * in the same parent generation, with the same cohort, basis, benchmark and session. */
function coherentBothPayload() {
  const legacy = syntheticLegacyDossier();
  return {
    measured_read: {
      ...nov5Parent(),
      groups: legacy.groups.map(group => ({
        group_id: group.group_id, group_kind: "sector",
        current: {
          metric: "relative_wealth_pct", units: "pct",
          rs_21d: group.relative_wealth_pct.rs_21d, rs_63d: group.relative_wealth_pct.rs_63d,
        },
      })),
      sector_dossiers: legacy,
    },
  };
}

describe("Persistent Sector Leadership exact-session companion", () => {
  it("pins the actual producer fixture bytes and leaves the legacy fixtures intact", () => {
    const completeBytes = readFileSync(new URL("./fixtures/sector_window_measurements.complete.v1.json", import.meta.url));
    expect(completeBytes.length).toBe(14961);
    expect(createHash("sha256").update(completeBytes).digest("hex"))
      .toBe("6b33895711742dee8cb1366baab5572a6aef31d6ca9ca6d0f81e32ab879e6dae");
    const unavailableBytes = readFileSync(new URL("./fixtures/sector_window_measurements.unavailable.v1.json", import.meta.url));
    expect(unavailableBytes.length).toBe(15421);
    expect(createHash("sha256").update(unavailableBytes).digest("hex"))
      .toBe("e4419e3a4d7dabce4ad4fd760c1fc37d05b8fe1111102ac5b0bb13b1a980f17e");
    // The October 9 legacy fixtures are untouched by the companion.
    const { sector_dossiers: addendum, ...old } = fixture;
    expect(addendum.schema).toBe("leadership_rotation_context.sector_dossiers/v1");
    expect(old).toEqual(legacy);
  });

  it("reads the producer's complete companion with its own identities, windows and values", () => {
    const result = companion();
    expect(result.state).toBe("ok");
    if (result.state !== "ok") throw new Error("Expected the producer companion");
    const read = result.measurements;
    expect(read.schema).toBe("leadership_rotation_context.sector_window_measurements/v1");
    expect(read.status).toBe("available");
    expect(read.reason).toBeNull();
    expect(read.units).toBe("pct");
    expect(read.price_basis).toBe("total_return");
    expect(read.cohort_id).toBe("us_sectors_11");
    expect(read.population).toBe("eleven_sector_etf_proxies");
    expect(read.benchmark).toBe("SPY");
    expect(read.source_session).toBe("2026-11-05");
    expect(read.end_session).toBe("2026-11-05");
    expect(read.windows_sessions).toEqual([5, 20, 63]);
    expect(read.groups.map(row => row.group_id)).toEqual(COHORT_ORDER);
    expect(Object.keys(read.windows).sort()).toEqual(["20", "5", "63"]);
    expect(read.windows["5"].start_session).toBe("2026-10-29");
    expect(read.windows["20"].start_session).toBe("2026-10-08");
    expect(read.windows["63"].start_session).toBe("2026-08-07");
    expect(read.windows["63"].window_sessions).toBe(63);
    expect(read.diagnostics.complete_cells).toBe(33);
    expect(read.diagnostics.measured_cells).toBe(33);
    expect(read.diagnostics.total_cells).toBe(33);
    expect(read.diagnostics.expected_columns).toBe(12);
    expect(Object.values(read.authority)).toEqual([false, false, false, false, false]);
    expect(read.limitations.availability)
      .toEqual({ status: "unknown", reason: "owner_availability_clock_not_supplied" });
    expect(read.limitations.corrections)
      .toEqual({ status: "unavailable", reason: "native_revision_selection_not_supplied" });
    expect(read.limitations.freshness)
      .toEqual({ status: "unverified", reason: "owner_freshness_receipt_not_supplied" });
    expect(read.limitations.point_in_time)
      .toEqual({ status: "not_qualified", reason: "point_in_time_admission_not_supplied" });
  });

  it("keeps the producer's own values, including the pinned signed zero", () => {
    const result = companion();
    if (result.state !== "ok") throw new Error("Expected the producer companion");
    const xlp = result.measurements.groups.find(row => row.group_id === "XLP")!;
    expect(xlp.windows["63"].absolute_return_pct).toBe(14.376506);
    // The producer published a negative signed zero. It is kept exactly as published.
    expect(Object.is(xlp.windows["63"].relative_wealth_pct, -0)).toBe(true);
    expect(Object.is(xlp.windows["20"].relative_wealth_pct, 0)).toBe(true);
    expect(xlp.windows["63"].null_reasons).toEqual({ absolute_return_pct: null, relative_wealth_pct: null });
    expect(xlp.windows["63"].status).toBe("available");
    expect(xlp.windows["63"].coverage).toEqual({ observed_n: 64, expected_n: 64, ratio: 1 });
    // The relative wealth is a wealth ratio, not the difference of two percentage returns.
    const absolute = xlp.windows["63"].absolute_return_pct!;
    const benchmark = result.measurements.windows["63"].benchmark_return_pct!;
    expect(xlp.windows["63"].relative_wealth_pct).not.toBe(absolute - benchmark);
  });

  it("keeps a valid all-null block with its identities, dates, coverage and cause", () => {
    const result = companion(unavailable);
    expect(result.state).toBe("ok");
    if (result.state !== "ok") throw new Error("Expected the producer's unavailable companion");
    const read = result.measurements;
    expect(read.status).toBe("unavailable");
    expect(read.reason).toBe("future_tail");
    expect(read.diagnostics.qualification_reasons).toEqual(["future_tail"]);
    expect(read.diagnostics.future_tail_sessions).toEqual(["2026-11-06"]);
    expect(read.groups).toHaveLength(11);
    for (const group of read.groups) {
      for (const key of WINDOW_KEYS) {
        const value = group.windows[key];
        expect(value.absolute_return_pct).toBeNull();
        expect(value.relative_wealth_pct).toBeNull();
        expect(value.null_reasons).toEqual({
          absolute_return_pct: "future_tail", relative_wealth_pct: "future_tail",
        });
        expect(value.status).toBe("unavailable");
        // The observed coverage is retained even when every return is withheld.
        expect(value.coverage.observed_n).toBe(value.coverage.expected_n);
        expect(value.coverage.ratio).toBe(1);
      }
    }
    // The exact dates survive the refusal.
    expect(read.windows["63"].start_session).toBe("2026-08-07");
    expect(read.windows["63"].end_session).toBe("2026-11-05");
    expect(read.windows["63"].benchmark_return_pct).toBeNull();
    expect(read.diagnostics.complete_cells).toBe(0);
    expect(read.diagnostics.measured_cells).toBe(0);
  });

  it("reads an absent companion as a missing capability, never as an error", () => {
    for (const input of [null, [], {}, "bad", payload(legacy),
      { measured_read: { schema: "leadership_rotation_context.measured_group_read/v1", status: "available" } },
      { data: companionPayload() }]) {
      expect(sectorWindowMeasurements(input)).toEqual({
        state: "absent", reason: "window_measurements_not_supplied", measurements: null,
      });
    }
  });

  it("never lets the companion stand in for the dossier, or the dossier for the companion", () => {
    expect(sectorDossiers(payload()).state).toBe("ok");
    expect(sectorDossiers(companionPayload()).state).toBe("absent");
    expect(sectorWindowMeasurements(payload()).state).toBe("absent");
    // The legacy dossier is bound to its own October 9 generation, so it is refused here.
    const both = { measured_read: { ...nov5Parent(), sector_dossiers: fixture.sector_dossiers } };
    expect(sectorDossiers(both).state).toBe("invalid");
    expect(sectorWindowMeasurements(both).state).toBe("ok");
  });

  it("returns detached content and never mutates the shared owner object", () => {
    const source = structuredClone(complete);
    const before = structuredClone(source);
    const result = companion(source);
    expect(source).toEqual(before);
    if (result.state !== "ok") throw new Error("Expected the producer companion");
    expect(result.measurements).not.toBe(source);
    result.measurements.groups[0].windows["63"].absolute_return_pct = 999;
    expect(source).toEqual(before);
  });

  it.each([
    ["schema", "other/v1"],
    ["units", "fraction"],
    ["price_basis", "price_only"],
    ["cohort_id", "top_six"],
    ["population", "other_population"],
    ["status", "unknown"],
    ["benchmark", "QQQ"],
    ["source_session", "2026-11-04"],
    ["end_session", "2026-11-04"],
    ["source_session", "2026-02-30"],
    ["endpoint_definition", "another definition"],
    ["windows_sessions", [5, 20, 64]],
  ] as [string, unknown][])("refuses the incompatible document field %s", (field, value) => {
    const source = doc();
    (source as unknown as Record<string, unknown>)[field] = value;
    expect(companion(source).state).toBe("invalid");
  });

  it("refuses a duplicated, missing or reordered cohort identity", () => {
    const duplicate = doc();
    duplicate.groups[1].group_id = duplicate.groups[0].group_id;
    const missing = doc();
    missing.groups.pop();
    const extra = doc();
    extra.groups.push(structuredClone(extra.groups[0]));
    const reordered = doc();
    const swapped = reordered.groups[0];
    reordered.groups[0] = reordered.groups[1];
    reordered.groups[1] = swapped;
    for (const source of [duplicate, missing, extra, reordered]) {
      expect(companion(source).state).toBe("invalid");
    }
  });

  it("refuses the wrong window, the wrong session and a parent that does not match", () => {
    const window = doc();
    window.windows["63"].window_sessions = 62;
    const date = doc();
    date.windows["63"].start_session = "2026-11-06";
    const endDate = doc();
    endDate.end_session = "2026-11-04";
    expect(companion(window).state).toBe("invalid");
    expect(companion(date).state).toBe("invalid");
    expect(companion(endDate).state).toBe("invalid");
    for (const [field, value] of [["session_end", "2026-10-09"], ["cohort_id", "top_six"],
      ["price_basis", "price_only"], ["benchmark", "QQQ"]] as [string, string][]) {
      const parent = nov5Parent();
      parent.generation[field] = value;
      expect(sectorWindowMeasurements({ measured_read: parent }).state).toBe("invalid");
    }
  });

  it("refuses a non-finite or out-of-domain published value", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -101]) {
      const source = doc();
      cell(source, "XLB", "63").absolute_return_pct = value;
      expect(companion(source).state).toBe("invalid");
    }
    const relative = doc();
    cell(relative, "XLB", "63").relative_wealth_pct = Number.POSITIVE_INFINITY;
    expect(companion(relative).state).toBe("invalid");
    // -100% is inside the domain, and a large positive value is not clipped away.
    const boundary = doc();
    cell(boundary, "XLB", "63").absolute_return_pct = -100;
    expect(companion(boundary).state).toBe("ok");
    const large = doc();
    cell(large, "XLB", "63").absolute_return_pct = 9999;
    expect(companion(large).state).toBe("ok");
  });

  it("refuses a value, reason, status or count that contradicts itself", () => {
    const reasonOnAValue = doc();
    cell(reasonOnAValue, "XLB", "63").null_reasons.absolute_return_pct = "missing_input";
    const reasonMissingOnANull = doc();
    const nulled = reasonMissingOnANull.groups[0].windows["63"];
    nulled.absolute_return_pct = null;
    nulled.status = "partial";
    nulled.null_reasons.absolute_return_pct = null;
    const wrongStatus = doc();
    wrongStatus.groups[0].windows["63"].status = "partial";
    const wrongMeasured = doc();
    wrongMeasured.diagnostics.measured_cells = 32;
    const wrongComplete = doc();
    wrongComplete.diagnostics.complete_cells = 34;
    const wrongTotal = doc();
    wrongTotal.diagnostics.total_cells = 32;
    const wrongExpected = doc();
    wrongExpected.diagnostics.expected_columns = 11;
    const wrongRatio = doc();
    wrongRatio.groups[0].windows["63"].coverage.ratio = 0.5;
    const wrongObserved = doc();
    wrongObserved.groups[0].windows["63"].coverage.observed_n = 65;
    const wrongExpectedN = doc();
    wrongExpectedN.groups[0].windows["63"].coverage.expected_n = 21;
    for (const source of [reasonOnAValue, reasonMissingOnANull, wrongStatus, wrongMeasured,
      wrongComplete, wrongTotal, wrongExpected, wrongRatio, wrongObserved, wrongExpectedN]) {
      expect(companion(source).state).toBe("invalid");
    }
  });

  it("refuses an authority escalation and a receipt the producer could not have published", () => {
    const escalation = doc();
    escalation.authority.may_trade = true;
    const gate = doc();
    gate.authority.may_gate = true;
    const manyKeys = doc();
    manyKeys.receipt = Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`k${index}`, index]));
    const tooDeep = doc();
    tooDeep.receipt = { a: { b: { c: { d: { e: { f: { g: { h: { i: 1 } } } } } } } } };
    const contradictory = doc();
    contradictory.receipt = { a: 1 };
    contradictory.diagnostics.receipt_withheld = true;
    for (const source of [escalation, gate, manyKeys, tooDeep, contradictory]) {
      expect(companion(source).state).toBe("invalid");
    }
    // A bounded receipt is accepted, and it is never a measurement.
    const bounded = doc();
    bounded.receipt = { a: 1, b: "two" };
    expect(companion(bounded).state).toBe("ok");
  });

  it("refuses a naive or malformed owner clock, and a limitation that contradicts its clock", () => {
    for (const clock of ["2026-11-05", "2026-11-05T21:00:00", "2026-11-05T21:00:00+99:00",
      "2026-02-30T21:00:00Z", "2026-11-05T25:00:00Z", "not a clock"]) {
      const source = doc();
      source.clocks.publication = clock;
      expect(companion(source).state).toBe("invalid");
    }
    const mismatch = doc();
    mismatch.clocks.publication = "2026-11-05T21:00:00Z";
    expect(companion(mismatch).state).toBe("invalid");
    const supplied = doc();
    supplied.clocks.publication = "2026-11-05T21:00:00Z";
    supplied.limitations.publication = { status: "supplied", clock: "2026-11-05T21:00:00Z" };
    expect(companion(supplied).state).toBe("ok");
    // A supplied correction clock never qualifies corrections or point-in-time.
    const corrected = doc();
    corrected.clocks.correction = "2026-11-05T21:00:00Z";
    const correctedRead = companion(corrected);
    expect(correctedRead.state).toBe("ok");
    if (correctedRead.state !== "ok") throw new Error("Expected a corrected companion");
    expect(correctedRead.measurements.limitations.corrections)
      .toEqual({ status: "unavailable", reason: "native_revision_selection_not_supplied" });
  });

  it("publishes each value independently and keeps the other one", () => {
    const absoluteMissing = doc();
    const xlp63 = cell(absoluteMissing, "XLP", "63");
    xlp63.absolute_return_pct = null;
    xlp63.null_reasons.absolute_return_pct = "missing_input";
    xlp63.status = "partial";
    absoluteMissing.windows["63"].status = "partial";
    absoluteMissing.diagnostics.complete_cells = 32;
    absoluteMissing.status = "partial";
    const first = companion(absoluteMissing);
    expect(first.state).toBe("ok");
    if (first.state !== "ok") throw new Error("Expected a partial companion");
    expect(first.measurements.groups[6].windows["63"].absolute_return_pct).toBeNull();
    expect(first.measurements.groups[6].windows["63"].relative_wealth_pct).toBe(-0);
    expect(first.measurements.windows["63"].status).toBe("partial");
    expect(first.measurements.windows["5"].status).toBe("available");

    const relativeMissing = doc();
    const xlp20 = cell(relativeMissing, "XLP", "20");
    xlp20.relative_wealth_pct = null;
    xlp20.null_reasons.relative_wealth_pct = "benchmark_missing";
    xlp20.status = "partial";
    relativeMissing.windows["20"].status = "partial";
    relativeMissing.diagnostics.complete_cells = 32;
    relativeMissing.status = "partial";
    const second = companion(relativeMissing);
    expect(second.state).toBe("ok");
    if (second.state !== "ok") throw new Error("Expected a partial companion");
    expect(second.measurements.groups[6].windows["20"].relative_wealth_pct).toBeNull();
    expect(second.measurements.groups[6].windows["20"].absolute_return_pct).toBe(4.391291);
  });

  it("keeps both endpoints when an interior observation is missing", () => {
    const gap = doc();
    cell(gap, "XLP", "63").coverage = { observed_n: 63, expected_n: 64, ratio: 0.984375 };
    const result = companion(gap);
    expect(result.state).toBe("ok");
    if (result.state !== "ok") throw new Error("Expected the producer companion");
    expect(result.measurements.groups[6].windows["63"].absolute_return_pct).toBe(14.376506);
    expect(result.measurements.groups[6].windows["63"].relative_wealth_pct).toBe(-0);
    expect(result.measurements.windows["63"].start_session).toBe("2026-08-07");
    expect(result.measurements.windows["63"].end_session).toBe("2026-11-05");
    expect(result.measurements.diagnostics.complete_cells).toBe(33);
  });

  it("treats insufficient reference history as a window condition, before any block reason", () => {
    const thin = thinHistoryDoc();
    const result = companion(thin);
    expect(result.state).toBe("ok");
    if (result.state !== "ok") throw new Error("Expected a partially measured companion");
    expect(result.measurements.windows["63"].start_session).toBeNull();
    expect(result.measurements.windows["63"].null_reason).toBe("insufficient_reference_history");
    expect(result.measurements.groups[0].windows["63"].coverage)
      .toEqual({ observed_n: 0, expected_n: 64, ratio: 0 });
    expect(result.measurements.windows["5"].status).toBe("available");
  });

  it("refuses a block reason that does not withhold every measurement", () => {
    const source = doc();
    source.diagnostics.qualification_reasons = ["future_tail"];
    source.reason = "future_tail";
    source.status = "unavailable";
    expect(companion(source).state).toBe("invalid");
    const honest = doc();
    honest.diagnostics.qualification_reasons = ["future_tail"];
    honest.reason = "future_tail";
    honest.status = "unavailable";
    for (const key of WINDOW_KEYS) {
      const window = honest.windows[key];
      window.status = "unavailable";
      window.null_reason = "future_tail";
      window.benchmark_return_pct = null;
      window.benchmark_null_reason = "future_tail";
    }
    for (const group of honest.groups) {
      for (const key of WINDOW_KEYS) {
        const value = group.windows[key];
        value.absolute_return_pct = null;
        value.relative_wealth_pct = null;
        value.null_reasons = {
          absolute_return_pct: "future_tail", relative_wealth_pct: "future_tail",
        };
        value.status = "unavailable";
      }
    }
    honest.diagnostics.measured_cells = 0;
    honest.diagnostics.complete_cells = 0;
    expect(companion(honest).state).toBe("ok");
    // A reason that is not one of the producer's own block reasons is refused.
    const invented = doc();
    invented.diagnostics.qualification_reasons = ["because_i_said_so"];
    invented.reason = "because_i_said_so";
    expect(companion(invented).state).toBe("invalid");
  });

  it("refuses a document whose own top reason is not its first qualification reason", () => {
    const source = doc();
    source.diagnostics.qualification_reasons = ["future_tail"];
    source.reason = null;
    source.status = "unavailable";
    expect(companion(source).state).toBe("invalid");
  });

  it("admits a null start session only for insufficient reference history", () => {
    // A complete normal window keeps a real earlier source start. Only the start is changed, and
    // every published value, reason, coverage and count stays exactly as the producer left it.
    const nullStart = doc();
    nullStart.windows["63"].start_session = null;
    expect(companion(nullStart).state).toBe("invalid");

    // A block-refusal window keeps its own earlier source start too.
    const refused = structuredClone(unavailable) as unknown as CompanionDoc;
    refused.windows["63"].start_session = null;
    expect(companion(refused).state).toBe("invalid");

    // The legitimate insufficient-history window still reads, and so does the canonical
    // future-tail fixture: a null start is not a general licence.
    const thin = companion(thinHistoryDoc());
    expect(thin.state).toBe("ok");
    expect(companion(unavailable).state).toBe("ok");
    expect(companion(complete).state).toBe("ok");
  });

  it("refuses an opaque receipt that is not bounded plain JSON, before the document is cloned", () => {
    const oversized = doc();
    oversized.receipt = Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`k${index}`, index]));
    const dated = doc();
    dated.receipt = { when: new Date("2026-11-05T00:00:00Z") };
    const mapped = doc();
    mapped.receipt = { rows: new Map([["a", 1]]) };
    const set = doc();
    set.receipt = { rows: new Set([1]) };
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    const cyclicSource = doc();
    cyclicSource.receipt = cyclic;
    const unsupported = doc();
    unsupported.receipt = { a: undefined, b: () => 1, c: BigInt(1) };

    // The document is never cloned while an unbounded or non-JSON receipt is present: the refusal
    // happens on the received object itself, before anything is expanded.
    let clones = 0;
    const original = globalThis.structuredClone;
    vi.stubGlobal("structuredClone", (value: unknown) => { clones += 1; return original(value); });
    try {
      for (const source of [oversized, dated, mapped, set, cyclicSource, unsupported]) {
        expect(companion(source).state).toBe("invalid");
      }
      expect(clones).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }

    // A bounded plain-JSON receipt is admitted, and the admitted copy is detached.
    const bounded = doc();
    bounded.receipt = { a: 1, nested: { b: [1, 2, { c: "three" }] } };
    const before = structuredClone(bounded);
    const result = companion(bounded);
    expect(result.state).toBe("ok");
    if (result.state !== "ok") throw new Error("Expected the producer companion");
    const receipt = result.measurements.receipt as Record<string, unknown>;
    expect(receipt).toEqual({ a: 1, nested: { b: [1, 2, { c: "three" }] } });
    (receipt.nested as Record<string, unknown>).b = "changed";
    expect(bounded.receipt).toEqual(before.receipt);

    // The producer's own encoded-byte bound is enforced, and it is not relaxed.
    const withinLimit = doc();
    withinLimit.receipt = { pad: "x".repeat(16000) };
    expect(companion(withinLimit).state).toBe("ok");
    const overLimit = doc();
    overLimit.receipt = { pad: "x".repeat(17000) };
    expect(companion(overLimit).state).toBe("invalid");
  });

  // Producer-backed boundary vectors: executed against Macro _window_receipt at SHA256
  // 43b1cf3a19d3f73dc6a29a319bcc81f3745cda153c3419e492396b48b9068c61.
  // Python uses ensure_ascii=True and separators ", " / ": ". The exact-limit
  // string cases encode to 16384 bytes; their one-character successors encode to 16385.
  it.each([
    ["ASCII at limit", { a: "x".repeat(16375) }, "ok"],
    ["ASCII one over", { a: "x".repeat(16376) }, "invalid"],
    ["BMP at limit", { a: "中".repeat(2729) + "x" }, "ok"],
    ["BMP one over", { a: "中".repeat(2729) + "xx" }, "invalid"],
    ["BMP expanded", { a: "中".repeat(3000) }, "invalid"],
    ["astral at limit", { a: "😀".repeat(1364) + "x".repeat(7) }, "ok"],
    ["astral one over", { a: "😀".repeat(1364) + "x".repeat(8) }, "invalid"],
    ["Python separators", { a: ["x".repeat(16370), "x"] }, "invalid"],
    ["integral Python float over budget", { a: 1.0, pad: "x".repeat(16364) }, "invalid"],
    ["Python negative zero over budget", { a: -0.0, pad: "x".repeat(16363) }, "invalid"],
    ["large Python integer over budget", { a: 1e100, pad: "x".repeat(16270) }, "invalid"],
    ["array length 256", { a: Array(256).fill(0) }, "ok"],
    ["array length 257", { a: Array(257).fill(0) }, "invalid"],
    ["object length 256", { a: Object.fromEntries(Array.from({ length: 256 }, (_, i) => [`k${i}`, 0])) }, "ok"],
    ["object length 257", { a: Object.fromEntries(Array.from({ length: 257 }, (_, i) => [`k${i}`, 0])) }, "invalid"],
    ["separately bounded containers", { a: Array.from({ length: 200 }, () => ({})),
      b: Array.from({ length: 200 }, () => ({})) }, "ok"],
    ["finite Python number forms", { a: [1.0, -0.0, 1e-7, 1e20, 1e100, -1e100,
      Number.MAX_VALUE, -Number.MAX_VALUE] }, "ok"],
  ] as Array<[string, Record<string, unknown>, "ok" | "invalid"]>)(
    "enforces actual producer receipt bounds: %s", (_name, receipt, state) => {
      const source = doc();
      source.receipt = receipt;
      expect(companion(source).state).toBe(state);
    },
  );

  it("refuses non-JSON array receipts without invoking accessors or iterators", () => {
    let touches = 0;
    const accessor = [0];
    Object.defineProperty(accessor, "0", { enumerable: true, get: () => { touches += 1; return 0; } });
    const iterator = [0];
    Object.defineProperty(iterator, Symbol.iterator, { value: () => { touches += 1; return [0][Symbol.iterator](); } });
    const sparse = new Array(1);
    const extra = Object.assign([0], { discarded: true });
    for (const array of [accessor, iterator, sparse, extra]) {
      const source = doc();
      source.receipt = { a: array };
      expect(companion(source).state).toBe("invalid");
    }
    expect(touches).toBe(0);
  });

  it("refuses a year-zero owner clock and keeps the real boundary years", () => {
    for (const clock of ["0000-01-01T00:00:00Z", "0000-02-29T00:00:00Z"]) {
      const source = doc();
      source.clocks.publication = clock;
      source.limitations.publication = { status: "supplied", clock };
      expect(companion(source).state).toBe("invalid");
    }
    for (const clock of ["0001-01-01T00:00:00Z", "9999-12-31T23:59:59Z"]) {
      const source = doc();
      source.clocks.publication = clock;
      source.limitations.publication = { status: "supplied", clock };
      expect(companion(source).state).toBe("ok");
    }
    // The already accepted aware extended forms stay accepted, with the owner's own text.
    for (const clock of ["2026-11-05T21:00:00Z", "2026-11-05T21:00:00+08:00",
      "2026-11-05T21:00:00.123456Z", "2026-11-05 21:00:00Z", "2026-11-05T21:00Z"]) {
      const source = doc();
      source.clocks.publication = clock;
      source.limitations.publication = { status: "supplied", clock };
      expect(companion(source).state).toBe("ok");
    }
    // Both canonical fixtures stay admitted.
    expect(companion(complete).state).toBe("ok");
    expect(companion(unavailable).state).toBe("ok");
  });

  it("admits a coherent legacy dossier and exact companion in the same owner document", () => {
    // There is no general mutual exclusion: the two documents are separate owners' documents and
    // one parent generation may carry both.
    const both = coherentBothPayload();
    expect(sectorDossiers(both).state).toBe("ok");
    expect(sectorWindowMeasurements(both).state).toBe("ok");

    // The genuine mismatch is still rejected: the October 9 legacy fixture does not belong to the
    // November 5 parent, and the companion is unaffected by that legacy refusal.
    const mismatched = { measured_read: { ...nov5Parent(), sector_dossiers: fixture.sector_dossiers } };
    expect(sectorDossiers(mismatched).state).toBe("invalid");
    expect(sectorWindowMeasurements(mismatched).state).toBe("ok");
  });
});
