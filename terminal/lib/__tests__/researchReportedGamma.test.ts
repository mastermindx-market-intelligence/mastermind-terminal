/**
 * Tests for the reported-Gamma Lab view-model.
 *
 * Everything here is deterministic synthetic test data: explicit clocks,
 * explicit source keys, no network, no real symbols and no runtime claims.
 */
import { describe, expect, it } from "vitest";
import { buildResearchReportedGamma } from "../../components/researchlab/researchReportedGamma";
import type {
  ReportedGammaMember,
  ReportedGammaSnapshot,
} from "../../lib/exposureReportedChange";
import type { ResearchRow } from "../../components/researchlab/researchLabAdapter";

const ORIGIN_MS = Date.parse("2026-11-01T00:00:00Z");
const SESSION_A = "2026-10-30";
const SESSION_B = "2026-10-31";
const EXPIRY = "2026-11-20";
const EXPIRY_LATER = "2026-12-18";
const ROOT = "SPX";

const member = (
  expiry: string,
  strike: number,
  right: "C" | "P",
  valueUsd: number | null,
): ReportedGammaMember => ({ expiry, strike, right, valueUsd });

function snapshot(overrides: Partial<ReportedGammaSnapshot> = {}): ReportedGammaSnapshot {
  return {
    root: ROOT,
    securityId: "SPX-INDEX",
    sourceSession: SESSION_B,
    sourceKey: `coordinator:${ROOT}:${SESSION_B}:v1`,
    definitionKey: "reported_gamma/black-scholes/v1",
    scopeKey: "0dte-excluded",
    availableAt: "2026-10-31T15:00:00Z",
    oiReportDate: SESSION_A,
    oiPositionSession: SESSION_A,
    correctionRef: null,
    members: [
      member(EXPIRY, 6500, "C", 1000),
      member(EXPIRY, 6500, "P", -500),
      member(EXPIRY, 6600, "C", 250),
    ],
    ...overrides,
  };
}

function previousSnapshot(overrides: Partial<ReportedGammaSnapshot> = {}): ReportedGammaSnapshot {
  return snapshot({
    sourceSession: SESSION_A,
    sourceKey: `coordinator:${ROOT}:${SESSION_A}:v1`,
    availableAt: "2026-10-30T15:00:00Z",
    oiReportDate: "2026-10-29",
    oiPositionSession: "2026-10-29",
    members: [
      member(EXPIRY, 6500, "C", 800),
      member(EXPIRY, 6500, "P", -400),
      member(EXPIRY, 6600, "C", 250),
    ],
    ...overrides,
  });
}

function row(overrides: Partial<ResearchRow> = {}): ResearchRow {
  return {
    key: `${ROOT}|${EXPIRY}|call|6500`,
    root: ROOT,
    expiry: EXPIRY,
    strike: 6500,
    side: "call",
    volume: 12,
    openInterest: 34,
    deltaOi: 1,
    ...overrides,
  };
}

const context = (overrides: Record<string, unknown> = {}) => ({
  root: ROOT,
  matrixSession: SESSION_B,
  originMs: ORIGIN_MS,
  selected: null as ResearchRow | null,
  ...overrides,
});

const sortedKeys = (value: Record<string, unknown>): string[] => Object.keys(value).sort();

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

describe("buildResearchReportedGamma", () => {
  it("returns the matched-cohort comparison plus an exact pinned member", () => {
    const previous = previousSnapshot();
    const current = snapshot();
    const result = buildResearchReportedGamma(
      current,
      previous,
      context({ selected: row() }),
    );
    expect(result.state).toBe("data");
    if (result.state !== "data") return;
    expect(result.comparison.basis).toBe("matched_reported_gamma/v1");
    expect(result.comparison.aggregate.signedChangeUsd).toBe(100);
    expect(result.comparison.population.matchedQualified).toBe(3);
    expect(result.comparison.previousKey).toBe(`coordinator:${ROOT}:${SESSION_A}:v1`);
    expect(result.comparison.currentKey).toBe(`coordinator:${ROOT}:${SESSION_B}:v1`);
    expect(result.previousSession).toBe(SESSION_A);
    expect(result.currentSession).toBe(SESSION_B);
    expect(result.pin).toEqual({
      pin: "pinned",
      coordinates: { root: ROOT, expiry: EXPIRY, strike: 6500, right: "C" },
      previousValueUsd: 800,
      currentValueUsd: 1000,
      signedChangeUsd: 200,
    });
  });

  it("pins by the full coordinate tuple: same strike at a different expiry stays unpinned", () => {
    const result = buildResearchReportedGamma(
      snapshot(),
      previousSnapshot(),
      context({ selected: row({ expiry: EXPIRY_LATER, key: `${ROOT}|${EXPIRY_LATER}|call|6500` }) }),
    );
    expect(result.state).toBe("data");
    if (result.state !== "data") return;
    // Strike 6500 IS in the byStrike cohort, yet the pin does not use it.
    expect(result.comparison.byStrike.map((entry) => entry.strike)).toContain(6500);
    expect(result.pin).toEqual({ pin: "unpinned", reason: "member_absent" });
  });

  it("maps the put side onto the P member", () => {
    const result = buildResearchReportedGamma(
      snapshot(),
      previousSnapshot(),
      context({ selected: row({ side: "put", key: `${ROOT}|${EXPIRY}|put|6500` }) }),
    );
    expect(result.state).toBe("data");
    if (result.state !== "data") return;
    expect(result.pin).toEqual({
      pin: "pinned",
      coordinates: { root: ROOT, expiry: EXPIRY, strike: 6500, right: "P" },
      previousValueUsd: -400,
      currentValueUsd: -500,
      signedChangeUsd: -100,
    });
  });

  it("never falls back across right: a call selection where only a put is reported stays unpinned", () => {
    const previous = previousSnapshot({
      members: [member(EXPIRY, 6500, "P", -400)],
    });
    const current = snapshot({ members: [member(EXPIRY, 6500, "P", -500)] });
    const result = buildResearchReportedGamma(
      current,
      previous,
      context({ selected: row() }),
    );
    expect(result.state).toBe("data");
    if (result.state !== "data") return;
    expect(result.pin).toEqual({ pin: "unpinned", reason: "member_absent" });
  });

  it("treats a member reported on only one vintage as absent, not as a change", () => {
    const previous = previousSnapshot();
    const current = snapshot({
      members: [member(EXPIRY, 6500, "C", 1000), member(EXPIRY, 6600, "C", 250)],
    });
    const result = buildResearchReportedGamma(
      current,
      previous,
      context({ selected: row({ side: "put", key: `${ROOT}|${EXPIRY}|put|6500` }) }),
    );
    expect(result.state).toBe("data");
    if (result.state !== "data") return;
    expect(result.comparison.population.previousOnlyReported).toBe(1);
    expect(result.comparison.population.matchedQualified).toBe(2);
    expect(result.pin).toEqual({ pin: "unpinned", reason: "member_absent" });
  });

  it("treats a reported-but-null member as unqualified, distinct from absent", () => {
    const previous = previousSnapshot();
    const current = snapshot({
      members: [
        member(EXPIRY, 6500, "C", 1000),
        member(EXPIRY, 6500, "P", null),
        member(EXPIRY, 6600, "C", 250),
      ],
    });
    const result = buildResearchReportedGamma(
      current,
      previous,
      context({ selected: row({ side: "put", key: `${ROOT}|${EXPIRY}|put|6500` }) }),
    );
    expect(result.state).toBe("data");
    if (result.state !== "data") return;
    expect(result.comparison.population.qualificationLost).toBe(1);
    expect(result.comparison.population.unavailableEither).toBe(1);
    expect(result.pin).toEqual({ pin: "unpinned", reason: "member_unqualified" });
  });

  it("treats a genuine zero as finite and pins its signed difference", () => {
    const previous = previousSnapshot({
      members: [
        member(EXPIRY, 6500, "C", 0),
        member(EXPIRY, 6500, "P", -400),
        member(EXPIRY, 6600, "C", 250),
      ],
    });
    const current = snapshot({
      members: [
        member(EXPIRY, 6500, "C", 300),
        member(EXPIRY, 6500, "P", -500),
        member(EXPIRY, 6600, "C", 250),
      ],
    });
    const result = buildResearchReportedGamma(
      current,
      previous,
      context({ selected: row() }),
    );
    expect(result.state).toBe("data");
    if (result.state !== "data") return;
    expect(result.pin).toMatchObject({
      pin: "pinned",
      previousValueUsd: 0,
      currentValueUsd: 300,
      signedChangeUsd: 300,
    });
  });

  it("keeps the comparison intact with an explicitly unpinned view when nothing is selected", () => {
    const result = buildResearchReportedGamma(snapshot(), previousSnapshot(), context());
    expect(result.state).toBe("data");
    if (result.state !== "data") return;
    expect(result.pin).toEqual({ pin: "unpinned", reason: "no_selection" });
    expect(result.comparison.aggregate.signedChangeUsd).toBe(100);
  });

  it("never pins a selected row rooted at another underlying", () => {
    const result = buildResearchReportedGamma(
      snapshot(),
      previousSnapshot(),
      context({ selected: row({ root: "AAPL", key: "AAPL|2026-11-20|call|6500" }) }),
    );
    expect(result.state).toBe("data");
    if (result.state !== "data") return;
    expect(result.pin).toEqual({ pin: "unpinned", reason: "foreign_selection" });
  });

  it("withholds on a mismatched expected root even when the snapshots alone would compare", () => {
    const result = buildResearchReportedGamma(
      snapshot(),
      previousSnapshot(),
      context({ root: "NDX" }),
    );
    expect(result).toEqual({ state: "withheld", reason: "context_root_mismatch" });
  });

  it("fences the matrix session against the CURRENT snapshot, not the previous one", () => {
    // SESSION_A matches the PREVIOUS snapshot's session and would match nothing current.
    const result = buildResearchReportedGamma(
      snapshot(),
      previousSnapshot(),
      context({ matrixSession: SESSION_A }),
    );
    expect(result).toEqual({ state: "withheld", reason: "context_session_mismatch" });
  });

  it("withholds on an unknown matrix session without inferring one", () => {
    const result = buildResearchReportedGamma(
      snapshot(),
      previousSnapshot(),
      context({ matrixSession: null }),
    );
    expect(result).toEqual({ state: "withheld", reason: "context_session_unknown" });
  });

  it("an unknown session withholds even when the expected root mismatches too", () => {
    const result = buildResearchReportedGamma(
      snapshot(),
      previousSnapshot(),
      context({ root: "NDX", matrixSession: null }),
    );
    expect(result).toEqual({ state: "withheld", reason: "context_session_unknown" });
  });

  it("propagates the incumbent's future-availability refusal verbatim", () => {
    const result = buildResearchReportedGamma(
      snapshot({ availableAt: "2026-11-02T00:00:00Z" }),
      previousSnapshot(),
      context({ selected: row() }),
    );
    expect(result).toEqual({ state: "unavailable", reason: "time" });
  });

  it("propagates the incumbent's definition mismatch verbatim", () => {
    const result = buildResearchReportedGamma(
      snapshot(),
      previousSnapshot({ definitionKey: "reported_gamma/black-scholes/v2" }),
      context(),
    );
    expect(result).toEqual({ state: "unavailable", reason: "definition" });
  });

  it("refuses a same-session correction through the incumbent's time fence", () => {
    const result = buildResearchReportedGamma(
      snapshot(),
      previousSnapshot({ sourceSession: SESSION_B }),
      context({ matrixSession: SESSION_B }),
    );
    expect(result).toEqual({ state: "unavailable", reason: "time" });
  });

  it("propagates missing_basis when a snapshot is missing", () => {
    const result = buildResearchReportedGamma(null, previousSnapshot(), context());
    expect(result).toEqual({ state: "unavailable", reason: "missing_basis" });
    const other = buildResearchReportedGamma(snapshot(), undefined, context());
    expect(other).toEqual({ state: "unavailable", reason: "missing_basis" });
  });

  it("propagates empty_intersection when the vintages share no member", () => {
    const result = buildResearchReportedGamma(
      snapshot({ members: [member(EXPIRY_LATER, 6500, "C", 1000)] }),
      previousSnapshot({ members: [member(EXPIRY, 6500, "C", 800)] }),
      context(),
    );
    expect(result).toEqual({ state: "unavailable", reason: "empty_intersection" });
  });

  it("propagates malformed for an invalid member instead of truncating", () => {
    const result = buildResearchReportedGamma(
      snapshot({
        members: [
          member(EXPIRY, 6500, "C", 1000),
          member(EXPIRY, 0, "P", -500),
          member(EXPIRY, 6600, "C", 250),
        ],
      }),
      previousSnapshot(),
      context(),
    );
    expect(result).toEqual({ state: "unavailable", reason: "malformed" });
  });

  it("never mutates its inputs", () => {
    const previous = deepFreeze(previousSnapshot());
    const current = deepFreeze(snapshot());
    const selected = deepFreeze(row());
    const result = buildResearchReportedGamma(
      current,
      previous,
      context({ selected, originMs: ORIGIN_MS }),
    );
    expect(result.state).toBe("data");
    expect(current).toEqual(snapshot());
    expect(previous).toEqual(previousSnapshot());
    expect(selected).toEqual(row());
  });

  it("exposes no synthesized identity and no rate, percentage or causal fields", () => {
    const result = buildResearchReportedGamma(
      snapshot(),
      previousSnapshot(),
      context({ selected: row() }),
    );
    expect(result.state).toBe("data");
    if (result.state !== "data") return;
    expect(sortedKeys(result as unknown as Record<string, unknown>)).toEqual([
      "comparison",
      "currentSession",
      "pin",
      "previousSession",
      "state",
    ]);
    expect(sortedKeys(result.comparison as unknown as Record<string, unknown>)).toEqual([
      "aggregate",
      "basis",
      "byStrike",
      "currentKey",
      "percentChange",
      "population",
      "previousKey",
      "state",
      "velocity",
    ]);
    expect(result.comparison.velocity).toBeNull();
    expect(result.comparison.percentChange).toBeNull();
    if (result.pin.pin !== "pinned") return;
    expect(sortedKeys(result.pin)).toEqual([
      "coordinates",
      "currentValueUsd",
      "pin",
      "previousValueUsd",
      "signedChangeUsd",
    ]);
    expect(sortedKeys(result.pin.coordinates)).toEqual(["expiry", "right", "root", "strike"]);
  });
});
