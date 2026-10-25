import { describe, expect, it } from "vitest";

import {
  compareReportedGamma,
  type ReportedGammaChange,
  type ReportedGammaMember,
  type ReportedGammaSnapshot,
} from "../exposureReportedChange";

const ROOT = "root-01";
const SECURITY = "SEC-X";
const DEFINITION = "reported_gamma/v1";
const SCOPE = "root:SEC-X:reported";
// Contract expiry is part of member identity, so BOTH vintages observe the
// same expiry; it only has to be canonical and not before either session.
const EXPIRY = "2026-04-17";
const ORIGIN_MS = Date.parse("2026-03-21T12:00:00Z");

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

function previousSession(members: ReportedGammaMember[]): ReportedGammaSnapshot {
  return snapshot({
    sourceSession: "2026-03-19",
    availableAt: "2026-03-19T21:00:00Z",
    oiReportDate: "2026-03-19",
    members,
  });
}

function currentSession(members: ReportedGammaMember[]): ReportedGammaSnapshot {
  return snapshot({ members });
}

type DataResult = Extract<ReportedGammaChange, { state: "data" }>;
type UnavailableResult = Extract<ReportedGammaChange, { state: "unavailable" }>;

function dataOf(result: ReportedGammaChange): DataResult {
  if (result.state !== "data") {
    throw new Error(`expected data, got unavailable:${result.reason}`);
  }
  return result;
}

function unavailableOf(result: ReportedGammaChange): UnavailableResult {
  if (result.state !== "unavailable") throw new Error("expected unavailable");
  return result;
}

function expectReason(result: ReportedGammaChange, expected: UnavailableResult["reason"]): void {
  expect(unavailableOf(result).reason).toBe(expected);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

describe("compareReportedGamma", () => {
  it("preserves integer and fractional strike coordinates without textual exponent aliases", () => {
    const old = previousSession([member(1000, "C", 1), member(1000.25, "P", -2)]);
    const next = currentSession([member(1e3, "C", 2), member(1000.25, "P", -3)]);
    const result = dataOf(compareReportedGamma(next, old, ORIGIN_MS));
    expect(result.aggregate.contracts).toBe(2);
    expect(result.byStrike.map(row => row.strike)).toEqual([1000, 1000.25]);
  });
  it("refuses normalized invalid capture dates and overflowing measured sums", () => {
    const old = previousSession([member(100, "C", 1), member(100, "P", 1)]);
    for (const availableAt of ["2026-02-30T21:00:00Z", "2026-03-20T24:00:00Z", "2026-03-20Z"]) {
      expectReason(compareReportedGamma(snapshot({ availableAt, members: [member(100, "C", 1)] }), old, ORIGIN_MS), "malformed");
    }
    const next = currentSession([member(100, "C", Number.MAX_VALUE), member(100, "P", Number.MAX_VALUE)]);
    expectReason(compareReportedGamma(next, old, ORIGIN_MS), "malformed");
  });
  it("aggregates a negative shrink as a signed increase with a falling net magnitude", () => {
    const previous = previousSession([member(100, "C", -10000)]);
    const current = currentSession([member(100, "C", -4000)]);
    const result = dataOf(compareReportedGamma(current, previous, ORIGIN_MS));
    expect(result.basis).toBe("matched_reported_gamma/v1");
    expect(result.aggregate.contracts).toBe(1);
    expect(result.aggregate.previousNetUsd).toBe(-10000);
    expect(result.aggregate.currentNetUsd).toBe(-4000);
    expect(result.aggregate.signedChangeUsd).toBe(6000);
    expect(result.aggregate.netMagnitudeChangeUsd).toBe(-6000);
    expect(result.aggregate.previousGrossUsd).toBe(10000);
    expect(result.aggregate.currentGrossUsd).toBe(4000);
    expect(result.aggregate.grossChangeUsd).toBe(-6000);
    expect(result.previousKey).toBe(previous.sourceKey);
    expect(result.currentKey).toBe(current.sourceKey);
    expect(result.velocity).toBeNull();
    expect(result.percentChange).toBeNull();
  });

  it("handles a zero crossing without flipping the magnitude sign", () => {
    const previous = previousSession([member(100, "C", -5000)]);
    const current = currentSession([member(100, "C", 3000)]);
    const result = dataOf(compareReportedGamma(current, previous, ORIGIN_MS));
    expect(result.aggregate.signedChangeUsd).toBe(8000);
    expect(result.aggregate.netMagnitudeChangeUsd).toBe(-2000);
    expect(result.aggregate.grossChangeUsd).toBe(-2000);
  });

  it("separates net cancellation from gross change", () => {
    const previous = previousSession([member(100, "C", 5000), member(110, "P", -5000)]);
    const current = currentSession([member(100, "C", 2500), member(110, "P", -2500)]);
    const result = dataOf(compareReportedGamma(current, previous, ORIGIN_MS));
    expect(result.aggregate.contracts).toBe(2);
    expect(result.aggregate.signedChangeUsd).toBe(0);
    expect(result.aggregate.previousGrossUsd).toBe(10000);
    expect(result.aggregate.currentGrossUsd).toBe(5000);
    expect(result.aggregate.grossChangeUsd).toBe(-5000);
  });

  it("keeps the aggregate net magnitude an absolute, not a per-strike sum", () => {
    const previous = previousSession([member(100, "C", 5000), member(200, "C", -5000)]);
    const current = currentSession([member(100, "C", -3000), member(200, "C", 7000)]);
    const result = dataOf(compareReportedGamma(current, previous, ORIGIN_MS));
    expect(result.aggregate.previousNetUsd).toBe(0);
    expect(result.aggregate.currentNetUsd).toBe(4000);
    expect(result.aggregate.netMagnitudeChangeUsd).toBe(4000);
    expect(result.byStrike.map((row) => row.strike)).toEqual([100, 200]);
    expect(result.byStrike.map((row) => row.netMagnitudeChangeUsd)).toEqual([-2000, 2000]);
    const perStrikeSum = result.byStrike.reduce((sum, row) => sum + row.netMagnitudeChangeUsd, 0);
    expect(perStrikeSum).not.toBe(result.aggregate.netMagnitudeChangeUsd);
    expect(result.byStrike.reduce((sum, row) => sum + row.contracts, 0)).toBe(result.aggregate.contracts);
  });

  it("counts an observed zero as qualified while null stays unqualified", () => {
    const previous = previousSession([member(300, "C", 0), member(310, "P", null)]);
    const current = currentSession([member(300, "C", 0), member(310, "P", null)]);
    const result = dataOf(compareReportedGamma(current, previous, ORIGIN_MS));
    expect(result.aggregate.contracts).toBe(1);
    expect(result.aggregate.signedChangeUsd).toBe(0);
    expect(result.population).toEqual({
      previousObserved: 2,
      currentObserved: 2,
      previousQualified: 1,
      currentQualified: 1,
      matchedQualified: 1,
      previousOnlyReported: 0,
      currentOnlyReported: 0,
      qualificationLost: 0,
      qualificationGained: 0,
      unavailableEither: 1,
    });
  });

  it("limits byStrike to strikes with at least one matched qualified member", () => {
    const previous = previousSession([member(100, "C", 1000), member(150, "P", null)]);
    const current = currentSession([member(100, "C", 2000), member(150, "P", null)]);
    const result = dataOf(compareReportedGamma(current, previous, ORIGIN_MS));
    expect(result.byStrike.length).toBe(1);
    expect(result.byStrike[0].strike).toBe(100);
    expect(result.population.unavailableEither).toBe(1);
    expect(result.population.matchedQualified).toBe(1);
  });

  it("reports a disjoint or empty matched set as empty_intersection with no fake zeros", () => {
    expectReason(
      compareReportedGamma(
        currentSession([member(200, "C", 1000)]),
        previousSession([member(100, "C", 1000)]),
        ORIGIN_MS,
      ),
      "empty_intersection",
    );
    expectReason(compareReportedGamma(currentSession([]), previousSession([]), ORIGIN_MS), "empty_intersection");
    expectReason(
      compareReportedGamma(
        currentSession([member(100, "C", null)]),
        previousSession([member(100, "C", null)]),
        ORIGIN_MS,
      ),
      "empty_intersection",
    );
  });

  it("does not match across rights even when expiry and strike line up", () => {
    expectReason(
      compareReportedGamma(
        currentSession([member(105, "P", 1000)]),
        previousSession([member(105, "C", 1000)]),
        ORIGIN_MS,
      ),
      "empty_intersection",
    );
    const mixed = dataOf(
      compareReportedGamma(
        currentSession([member(105, "P", 1000), member(110, "P", 3000)]),
        previousSession([member(105, "C", 1000), member(110, "P", 2000)]),
        ORIGIN_MS,
      ),
    );
    expect(mixed.aggregate.contracts).toBe(1);
    expect(mixed.aggregate.signedChangeUsd).toBe(1000);
    expect(mixed.population.previousOnlyReported).toBe(1);
    expect(mixed.population.currentOnlyReported).toBe(1);
  });

  it("keeps reported-set membership changes separate from qualification flips", () => {
    const previous = previousSession([
      member(100, "C", 1000),
      member(110, "C", 2000),
      member(120, "P", null),
      member(150, "C", 5000),
    ]);
    const current = currentSession([
      member(100, "C", 1000),
      member(110, "C", null),
      member(120, "P", 6000),
      member(130, "C", 4000),
      member(140, "C", null),
    ]);
    const result = dataOf(compareReportedGamma(current, previous, ORIGIN_MS));
    expect(result.population).toEqual({
      previousObserved: 4,
      currentObserved: 5,
      previousQualified: 3,
      currentQualified: 3,
      matchedQualified: 1,
      previousOnlyReported: 1,
      currentOnlyReported: 2,
      qualificationLost: 1,
      qualificationGained: 1,
      // Both flips are present-in-both with one side null, so they count here too.
      unavailableEither: 2,
    });
    expect(result.aggregate.contracts).toBe(1);
    expect(result.aggregate.signedChangeUsd).toBe(0);
  });

  it("reports an all-zero matched cohort as a valid zero change", () => {
    const result = dataOf(
      compareReportedGamma(
        currentSession([member(100, "C", 0)]),
        previousSession([member(100, "C", 0)]),
        ORIGIN_MS,
      ),
    );
    expect(result.aggregate.contracts).toBe(1);
    expect(result.aggregate.signedChangeUsd).toBe(0);
    expect(result.aggregate.netMagnitudeChangeUsd).toBe(0);
    expect(result.aggregate.grossChangeUsd).toBe(0);
    expect(result.byStrike[0].contracts).toBe(1);
  });

  it("rejects duplicate members, bad rights, non-finite values and out-of-range members", () => {
    const malformedCases: Array<() => [ReportedGammaSnapshot, ReportedGammaSnapshot]> = [
      () => [
        currentSession([member(100, "C", 1000), member(100, "C", 1000)]),
        previousSession([member(100, "C", 1000)]),
      ],
      () => [
        currentSession([member(100, "X" as unknown as "C", 1000)]),
        previousSession([member(100, "C", 1000)]),
      ],
      () => [
        currentSession([member(100, "C", Number.NaN)]),
        previousSession([member(100, "C", 1000)]),
      ],
      () => [
        currentSession([member(100, "C", Number.POSITIVE_INFINITY)]),
        previousSession([member(100, "C", 1000)]),
      ],
      () => [currentSession([member(-5, "C", 1000)]), previousSession([member(100, "C", 1000)])],
      () => [currentSession([member(0, "C", 1000)]), previousSession([member(100, "C", 1000)])],
      () => [
        currentSession([{ expiry: "2026-03-18", strike: 100, right: "C", valueUsd: 1000 }]),
        previousSession([member(100, "C", 1000)]),
      ],
      () => [
        currentSession([{ expiry: "2026-02-30", strike: 100, right: "C", valueUsd: 1000 }]),
        previousSession([member(100, "C", 1000)]),
      ],
      () => [
        snapshot({ oiReportDate: "2026-02-30", members: [member(100, "C", 1000)] }),
        previousSession([member(100, "C", 1000)]),
      ],
      () => [
        snapshot({ availableAt: "2026-03-20T21:00:00", members: [member(100, "C", 1000)] }),
        previousSession([member(100, "C", 1000)]),
      ],
      () => [
        snapshot({ definitionKey: "", members: [member(100, "C", 1000)] }),
        previousSession([member(100, "C", 1000)]),
      ],
      () => [
        currentSession(Array.from({ length: 100001 }, (_, index) => member(index + 1, "C", 100))),
        previousSession([member(1, "C", 100)]),
      ],
    ];
    for (const build of malformedCases) {
      const [current, previous] = build();
      expectReason(compareReportedGamma(current, previous, ORIGIN_MS), "malformed");
    }
  });

  it("returns identity, scope and definition mismatches distinctly", () => {
    const matchedPrevious = (): ReportedGammaSnapshot => previousSession([member(100, "C", 1000)]);
    expectReason(
      compareReportedGamma(snapshot({ root: "root-02", members: [] }), matchedPrevious(), ORIGIN_MS),
      "identity",
    );
    expectReason(
      compareReportedGamma(snapshot({ securityId: "SEC-Y", members: [] }), matchedPrevious(), ORIGIN_MS),
      "identity",
    );
    expectReason(
      compareReportedGamma(
        snapshot({ scopeKey: "root:SEC-X:other", members: [] }),
        matchedPrevious(),
        ORIGIN_MS,
      ),
      "scope",
    );
    expectReason(
      compareReportedGamma(
        snapshot({ definitionKey: "reported_gamma/v2", members: [] }),
        matchedPrevious(),
        ORIGIN_MS,
      ),
      "definition",
    );
  });

  it("rejects future provenance and out-of-window origins as time failures", () => {
    expectReason(
      compareReportedGamma(
        snapshot({ availableAt: "2026-03-22T00:00:00Z", members: [member(100, "C", 1000)] }),
        previousSession([member(100, "C", 1000)]),
        ORIGIN_MS,
      ),
      "time",
    );
    expectReason(
      compareReportedGamma(
        currentSession([member(100, "C", 1000)]),
        previousSession([member(100, "C", 1000)]),
        Date.parse("2026-03-19T00:00:00Z"),
      ),
      "time",
    );
    expectReason(
      compareReportedGamma(
        currentSession([member(100, "C", 1000)]),
        previousSession([member(100, "C", 1000)]),
        Date.parse("2026-03-19T23:00:00Z"),
      ),
      "time",
    );
    expectReason(
      compareReportedGamma(
        currentSession([member(100, "C", 1000)]),
        previousSession([member(100, "C", 1000)]),
        Number.NaN,
      ),
      "time",
    );
  });

  it("rejects a same-session revision as a time failure", () => {
    const previous = snapshot({ members: [member(100, "C", 1000)] });
    const current = snapshot({ members: [member(100, "C", 1200)] });
    expectReason(compareReportedGamma(current, previous, ORIGIN_MS), "time");
  });

  it("allows reversed acquisition order while sessions strictly advance", () => {
    const previous = snapshot({
      sourceSession: "2026-03-19",
      availableAt: "2026-03-21T00:00:00Z",
      oiReportDate: "2026-03-19",
      members: [member(100, "C", 1000)],
    });
    const current = snapshot({
      availableAt: "2026-03-20T12:00:00Z",
      members: [member(100, "C", 1500)],
    });
    const result = dataOf(compareReportedGamma(current, previous, ORIGIN_MS));
    expect(result.aggregate.signedChangeUsd).toBe(500);
  });

  it("does not treat differing sourceKey vintages as an identity failure", () => {
    const previous = snapshot({
      sourceSession: "2026-03-19",
      availableAt: "2026-03-19T21:00:00Z",
      oiReportDate: "2026-03-19",
      sourceKey: "vintage:alpha",
      members: [member(100, "C", 1000)],
    });
    const current = snapshot({ sourceKey: "vintage:beta", members: [member(100, "C", 1200)] });
    const result = dataOf(compareReportedGamma(current, previous, ORIGIN_MS));
    expect(result.previousKey).toBe("vintage:alpha");
    expect(result.currentKey).toBe("vintage:beta");
    expect(result.aggregate.signedChangeUsd).toBe(200);
  });

  it("reports missing basis for null or undefined vintages", () => {
    const valid = previousSession([member(100, "C", 1000)]);
    expectReason(compareReportedGamma(null, valid, ORIGIN_MS), "missing_basis");
    expectReason(compareReportedGamma(undefined, valid, ORIGIN_MS), "missing_basis");
    expectReason(compareReportedGamma(currentSession([]), null, ORIGIN_MS), "missing_basis");
    expectReason(compareReportedGamma(null, undefined, ORIGIN_MS), "missing_basis");
  });

  it("leaves the input snapshots untouched", () => {
    const previous = previousSession([member(100, "C", 1000), member(110, "P", -2000)]);
    const current = currentSession([member(100, "C", 1500), member(110, "P", -2500)]);
    const before = JSON.stringify([current, previous]);
    dataOf(compareReportedGamma(current, previous, ORIGIN_MS));
    expect(JSON.stringify([current, previous])).toBe(before);
    // Frozen inputs would throw on any write attempt under strict mode.
    dataOf(
      compareReportedGamma(
        deepFreeze(currentSession([member(100, "C", 1000)])),
        deepFreeze(previousSession([member(100, "C", 1000)])),
        ORIGIN_MS,
      ),
    );
  });

  it("accepts exactly 100000 members and rejects more", () => {
    const result = dataOf(
      compareReportedGamma(
        currentSession(Array.from({ length: 100000 }, (_, index) => member(index + 1, "C", 100))),
        previousSession(Array.from({ length: 100000 }, (_, index) => member(index + 1, "C", 100))),
        ORIGIN_MS,
      ),
    );
    expect(result.aggregate.contracts).toBe(100000);
    expect(result.aggregate.signedChangeUsd).toBe(0);
    expect(result.byStrike.length).toBe(100000);
    expect(result.byStrike[0].strike).toBe(1);
    expect(result.byStrike[99999].strike).toBe(100000);
    expectReason(
      compareReportedGamma(
        currentSession(Array.from({ length: 100001 }, (_, index) => member(index + 1, "C", 100))),
        previousSession([member(1, "C", 100)]),
        ORIGIN_MS,
      ),
      "malformed",
    );
  });
});
