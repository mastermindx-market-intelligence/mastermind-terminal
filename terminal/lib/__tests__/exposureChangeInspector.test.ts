import { describe, expect, it } from "vitest";

import {
  buildChangeInspector,
  CHANGE_INSPECTOR_FLAT_USD,
  CHANGE_INSPECTOR_MAX_K,
  CHANGE_INSPECTOR_TOP_K,
  formatUsdCompact,
  type ChangeInspectorModel,
  type ChangeInspectorReason,
} from "../exposureChangeInspector";
import {
  compareReportedGamma,
  type ReportedGammaChange,
  type ReportedGammaMember,
  type ReportedGammaSnapshot,
} from "../exposureReportedChange";

const ROOT = "root-01";
const SECURITY = "SEC-X";
const SCOPE = "root:SEC-X:reported";
const DEFINITION = "reported_gamma/v1";
const EXPIRY = "2026-04-17";
const ORIGIN_MS = Date.parse("2026-03-21T12:00:00Z");
const PREVIOUS_SESSION = "2026-03-19";
const CURRENT_SESSION = "2026-03-20";
const SESSIONS = { previousSession: PREVIOUS_SESSION, currentSession: CURRENT_SESSION };

let sourceKeyCounter = 0;

function snapshot(
  overrides: Partial<ReportedGammaSnapshot> & { members?: ReportedGammaMember[] },
): ReportedGammaSnapshot {
  sourceKeyCounter += 1;
  return {
    root: ROOT,
    securityId: SECURITY,
    sourceSession: "2026-03-20",
    sourceKey: `vintage:${sourceKeyCounter}`,
    definitionKey: DEFINITION,
    scopeKey: SCOPE,
    availableAt: "2026-03-20T21:00:00Z",
    oiReportDate: "2026-03-20",
    oiPositionSession: "2026-03-20T16:15:00-04:00",
    correctionRef: null,
    members: [],
    ...overrides,
  };
}

function member(strike: number, right: "C" | "P", valueUsd: number | null): ReportedGammaMember {
  return { expiry: EXPIRY, strike, right, valueUsd };
}

function previousOf(
  members: ReportedGammaMember[],
  overrides: Partial<ReportedGammaSnapshot> = {},
): ReportedGammaSnapshot {
  return snapshot({
    sourceSession: PREVIOUS_SESSION,
    availableAt: "2026-03-19T21:00:00Z",
    oiReportDate: PREVIOUS_SESSION,
    members,
    ...overrides,
  });
}

function currentOf(
  members: ReportedGammaMember[],
  overrides: Partial<ReportedGammaSnapshot> = {},
): ReportedGammaSnapshot {
  return snapshot({ members, ...overrides });
}

function compared(previous: ReportedGammaSnapshot, current: ReportedGammaSnapshot): ReportedGammaChange {
  return compareReportedGamma(current, previous, ORIGIN_MS);
}

type DataChange = Extract<ReportedGammaChange, { state: "data" }>;

function dataOf(change: ReportedGammaChange): DataChange {
  if (change.state !== "data") {
    throw new Error(`expected data, got ${change.state}${change.state === "unavailable" ? `:${change.reason}` : ""}`);
  }
  return change;
}

function dataModelOf(input: Parameters<typeof buildChangeInspector>[0]): ChangeInspectorModel {
  const model = buildChangeInspector(input);
  if (model.state !== "data") throw new Error(`expected data, got ${model.state}:${String(model.reason)}`);
  return model;
}

const WITHDRAWN_AGGREGATE = {
  contracts: null,
  previousNetUsd: null,
  currentNetUsd: null,
  signedChangeUsd: null,
  netMagnitudeChangeUsd: null,
  grossChangeUsd: null,
};

function expectWithdrawn(model: ChangeInspectorModel): void {
  expect(model.populations).toBeNull();
  expect(model.aggregate).toEqual(WITHDRAWN_AGGREGATE);
  expect(model.rows).toEqual([]);
  expect(model.more).toBe(0);
  expect(model.focus).toBeNull();
  expect(model.velocity).toBeNull();
  expect(model.percentChange).toBeNull();
}

// Two matched strikes (100, 120) beside a qualification gain (110), a
// previous-only strike (150) and a current-only strike (140).
const POPULATED_CHANGE = dataOf(
  compared(
    previousOf([member(100, "C", 1000), member(110, "C", null), member(120, "P", 3000), member(150, "C", 5000)]),
    currentOf([member(100, "C", 2000), member(110, "C", 3000), member(120, "P", 1000), member(140, "C", 4000)]),
  ),
);

// Ten matched strikes with distinct |net magnitude change| values, a tie at
// 110/115 (|−2000| each), a sub-flat change at 130 and a change of exactly
// CHANGE_INSPECTOR_FLAT_USD at 135.
const PREVIOUS_TEN: ReportedGammaMember[] = [
  member(100, "C", 1000),
  member(105, "C", 5000),
  member(110, "P", 2000),
  member(115, "P", 4000),
  member(120, "P", 0),
  member(125, "C", 700),
  member(130, "C", 500),
  member(135, "C", 500),
  member(140, "P", -2000),
  member(145, "C", 300),
];
const CURRENT_TEN: ReportedGammaMember[] = [
  member(100, "C", 9000),
  member(105, "C", -4500),
  member(110, "P", 4000),
  member(115, "P", 2000),
  member(120, "P", 100),
  member(125, "C", 701),
  member(130, "C", 500.4),
  member(135, "C", 500.5),
  member(140, "P", -9000),
  member(145, "C", -100),
];
const TEN_STRIKE_CHANGE = dataOf(compared(previousOf(PREVIOUS_TEN), currentOf(CURRENT_TEN)));

describe("buildChangeInspector", () => {
  it("builds a data model from a matched comparison with populations kept apart from the change", () => {
    const model = dataModelOf({ ...SESSIONS, change: POPULATED_CHANGE });
    expect(model.state).toBe("data");
    expect(model.basis).toBe("matched_reported_gamma/v1");
    expect(model.reason).toBeNull();
    expect(model.populations).toEqual({
      matched: 2,
      previousOnly: 1,
      currentOnly: 1,
      qualificationLost: 0,
      qualificationGained: 1,
      unavailableEither: 1,
      previousObserved: 4,
      currentObserved: 4,
    });
    expect(model.aggregate).toEqual({
      contracts: 2,
      previousNetUsd: 4000,
      currentNetUsd: 3000,
      signedChangeUsd: -1000,
      netMagnitudeChangeUsd: -1000,
      grossChangeUsd: -1000,
    });
    // Populations stay counts beside the change: no population figure is a
    // change figure, and the matched cohort is exactly the aggregate's own.
    expect(model.aggregate.contracts).not.toBe(model.populations?.previousObserved);
    expect(model.rows.reduce((sum, row) => sum + row.contracts, 0)).toBe(model.aggregate.contracts);
    expect(model.rows.map(row => [row.strike, row.signedChangeUsd, row.direction])).toEqual([
      [120, -2000, "down"],
      [100, 1000, "up"],
    ]);
    expect(model.more).toBe(0);
    expect(model.focus).toBeNull();
  });

  it("sorts rows by absolute net magnitude change, ties by strike, and limits to the top K", () => {
    const model = dataModelOf({ ...SESSIONS, change: TEN_STRIKE_CHANGE, topK: 4 });
    // |Δ net magnitude| descending; the 110/115 tie at 2000 breaks by strike.
    expect(model.rows.map(row => row.strike)).toEqual([100, 140, 110, 115]);
    expect(model.more).toBe(6);
    const full = dataModelOf({ ...SESSIONS, change: TEN_STRIKE_CHANGE, topK: CHANGE_INSPECTOR_MAX_K });
    expect(full.rows.map(row => row.strike)).toEqual([100, 140, 110, 115, 105, 145, 120, 125, 135, 130]);
    const directions = new Map(full.rows.map(row => [row.strike, row.direction]));
    expect(CHANGE_INSPECTOR_FLAT_USD).toBe(0.5);
    expect(directions.get(130)).toBe("flat"); // |Δ| below the flat threshold
    expect(directions.get(135)).toBe("up"); // exactly the flat threshold is not flat
  });

  it("appends the focus strike after the top K and reports it as included but outside the top K", () => {
    const model = dataModelOf({ ...SESSIONS, change: TEN_STRIKE_CHANGE, topK: 4, focusStrike: 145 });
    expect(model.rows.map(row => row.strike)).toEqual([100, 140, 110, 115, 145]);
    expect(model.focus).toEqual({ strike: 145, included: true, inTopK: false });
    expect(model.rows.at(-1)?.focus).toBe(true);
    expect(model.rows.filter(row => row.focus)).toHaveLength(1);
    expect(model.more).toBe(6); // the appended focus row is not subtracted
  });

  it("reports more as the number of strikes beyond the top K", () => {
    const model = dataModelOf({ ...SESSIONS, change: TEN_STRIKE_CHANGE, topK: 3, focusStrike: 100 });
    expect(model.rows.map(row => row.strike)).toEqual([100, 140, 110]);
    expect(model.more).toBe(7);
    expect(model.focus).toEqual({ strike: 100, included: true, inTopK: true });
    expect(model.rows.filter(row => row.focus).map(row => row.strike)).toEqual([100]);
  });

  it("clamps topK to 1..50", () => {
    expect(CHANGE_INSPECTOR_TOP_K).toBe(8);
    expect(CHANGE_INSPECTOR_MAX_K).toBe(50);
    const low = dataModelOf({ ...SESSIONS, change: TEN_STRIKE_CHANGE, topK: 0 });
    expect(low.rows.map(row => row.strike)).toEqual([100]);
    expect(low.more).toBe(9);
    const high = dataModelOf({ ...SESSIONS, change: TEN_STRIKE_CHANGE, topK: 999 });
    expect(high.rows).toHaveLength(10);
    expect(high.more).toBe(0);
    const byDefault = dataModelOf({ ...SESSIONS, change: TEN_STRIKE_CHANGE });
    expect(byDefault.rows).toHaveLength(8);
    expect(byDefault.more).toBe(2);
  });

  it("returns single_session when only one session is present and unavailable with missing_basis when both are present without a comparison", () => {
    const oneCurrent = buildChangeInspector({ change: null, currentSession: CURRENT_SESSION, previousSession: null });
    expect(oneCurrent.state).toBe("single_session");
    expect(oneCurrent.reason).toBe("one_session");
    const onePrevious = buildChangeInspector({ change: undefined, currentSession: null, previousSession: PREVIOUS_SESSION });
    expect(onePrevious.state).toBe("single_session");
    expect(onePrevious.reason).toBe("one_session");
    const both = buildChangeInspector({ change: null, ...SESSIONS });
    expect(both.state).toBe("unavailable");
    expect(both.reason).toBe("missing_basis");
    const none = buildChangeInspector({ change: null, currentSession: null, previousSession: null });
    expect(none.state).toBe("unavailable");
    expect(none.reason).toBe("missing_basis");
    for (const model of [oneCurrent, onePrevious, both, none]) expectWithdrawn(model);
  });

  it("passes every unavailable reason through from the comparison", () => {
    const cases: Array<[ReportedGammaChange, ChangeInspectorReason]> = [
      [compareReportedGamma(null, undefined, ORIGIN_MS), "missing_basis"],
      [compared(previousOf([member(100, "C", 1000)], { root: "root-02" }), currentOf([member(100, "C", 1000)])), "identity"],
      [
        compared(previousOf([member(100, "C", 1000)], { scopeKey: "root:SEC-X:other" }), currentOf([member(100, "C", 1000)])),
        "scope",
      ],
      [
        compared(previousOf([member(100, "C", 1000)], { definitionKey: "reported_gamma/v2" }), currentOf([member(100, "C", 1000)])),
        "definition",
      ],
      [compared(currentOf([member(100, "C", 1000)]), currentOf([member(100, "C", 1200)])), "time"],
      [compared(previousOf([member(100, "C", 1000)]), currentOf([member(100, "C", Number.NaN)])), "malformed"],
      [compared(previousOf([member(200, "C", 1000)]), currentOf([member(100, "C", 1000)])), "empty_intersection"],
    ];
    for (const [change, reason] of cases) {
      const model = buildChangeInspector({ ...SESSIONS, change });
      expect(model.state, reason).toBe("unavailable");
      expect(model.reason, reason).toBe(reason);
      expectWithdrawn(model);
    }
  });

  it("returns invalid for a non-finite aggregate, a negative population count, a non-array byStrike and a wrong basis", () => {
    const base = POPULATED_CHANGE;
    const malformedCases: DataChange[] = [
      { ...base, aggregate: null as unknown as DataChange["aggregate"] },
      { ...base, aggregate: { ...base.aggregate, contracts: Number.NaN } },
      { ...base, aggregate: { ...base.aggregate, grossChangeUsd: Number.POSITIVE_INFINITY } },
      { ...base, population: null as unknown as DataChange["population"] },
      { ...base, population: { ...base.population, matchedQualified: -1 } },
      { ...base, population: { ...base.population, previousObserved: 1.5 } },
      { ...base, byStrike: null as unknown as DataChange["byStrike"] },
      { ...base, byStrike: [{ ...base.byStrike[0], strike: -5 }] },
      { ...base, byStrike: [{ ...base.byStrike[0], signedChangeUsd: Number.NaN }] },
      { ...base, basis: "matched_reported_gamma/v2" as unknown as DataChange["basis"] },
    ];
    for (const [index, change] of malformedCases.entries()) {
      const model = buildChangeInspector({ ...SESSIONS, change });
      expect(model.state, `case ${index}`).toBe("invalid");
      expect(model.reason, `case ${index}`).toBe("malformed_input");
      expectWithdrawn(model);
    }
  });

  it("keeps velocity and percentChange null and never derives a rate", () => {
    const model = dataModelOf({ ...SESSIONS, change: POPULATED_CHANGE });
    expect(model.velocity).toBeNull();
    expect(model.percentChange).toBeNull();
    // No derived ratio hides anywhere: the model carries exactly these fields.
    expect(Object.keys(model)).toEqual([
      "state",
      "basis",
      "reason",
      "sessions",
      "populations",
      "aggregate",
      "rows",
      "more",
      "focus",
      "velocity",
      "percentChange",
    ]);
  });

  it("echoes only canonical session dates", () => {
    const model = dataModelOf({ currentSession: "2026-03-20", previousSession: "2026-03-19", change: POPULATED_CHANGE });
    expect(model.sessions).toEqual({ previous: "2026-03-19", current: "2026-03-20" });
    const messy = dataModelOf({ currentSession: "2026-3-20", previousSession: "2026-02-30", change: POPULATED_CHANGE });
    expect(messy.sessions).toEqual({ previous: null, current: null });
    const partial = buildChangeInspector({ change: null, currentSession: "2026-03-20", previousSession: "2026-03-99" });
    expect(partial.sessions).toEqual({ previous: null, current: "2026-03-20" });
    expect(partial.state).toBe("single_session");
    const empty = buildChangeInspector({ change: null, currentSession: "", previousSession: null });
    expect(empty.sessions).toEqual({ previous: null, current: null });
    expect(empty.state).toBe("unavailable");
  });

  it("formatUsdCompact formats thresholds, the minus sign, the plus sign and null", () => {
    expect(formatUsdCompact(null)).toBe("—");
    expect(formatUsdCompact(Number.NaN)).toBe("—");
    expect(formatUsdCompact(Number.POSITIVE_INFINITY)).toBe("—");
    expect(formatUsdCompact(-1234567)).toBe("−$1.23M");
    expect(formatUsdCompact(-1234567).codePointAt(0)).toBe(0x2212); // U+2212 minus, not a hyphen
    expect(formatUsdCompact(1500)).toBe("+$1.5K");
    expect(formatUsdCompact(2.5e9)).toBe("+$2.5B");
    expect(formatUsdCompact(1e9)).toBe("+$1B");
    expect(formatUsdCompact(3400000)).toBe("+$3.4M");
    expect(formatUsdCompact(1000000)).toBe("+$1M");
    expect(formatUsdCompact(123)).toBe("+$123");
    expect(formatUsdCompact(0)).toBe("$0");
    expect(formatUsdCompact(-0)).toBe("$0");
    expect(formatUsdCompact(0.4)).toBe("+$0");
    expect(formatUsdCompact(-123, false)).toBe("−$123");
    expect(formatUsdCompact(123, false)).toBe("$123");
  });
});
