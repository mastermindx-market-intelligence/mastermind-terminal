import { describe, expect, it } from "vitest";
import { isoSession } from "@/lib/dte";
import { isoSession as companionIsoSession } from "@/lib/optionsCompanion";
import {
  lensValueForStrike, matrixDescribedSessionsMatch, matrixLensByStrike,
  matrixSessionsAgree, matrixSourceSession, type GexMatrix,
} from "@/lib/gexLadder";

const session = "2026-09-25";
const later = "2026-09-28";
const cell = (strike: number, gex: number | null, expiry = session) => ({ strike, expiry, gex });
const matrix = (cells: GexMatrix["cells"]): GexMatrix => ({
  asof: "2026-09-26T00:05:00Z", _build_meta: { asof_date: session },
  strikes: [770, 771], expiries: [session, later], cells,
});
const zero = { kind: "zero" } as const;

describe("source-session selected-grid arithmetic", () => {
  it.each([null, NaN, Infinity, -Infinity])("does not promote an incomplete $8M subtotal (%s)", (unknown) => {
    const result = matrixLensByStrike(matrix([cell(770, 8e6), cell(771, unknown)]), zero, session);
    expect(result).toMatchObject({ totalMn: null, knownTotalMn: 8, complete: false,
      unresolvedPairCount: 1, cellCount: 1, sourceSession: session });
    expect(lensValueForStrike(771, 12, zero, result)).toBeNull();
  });
  it("counts absent pairs as unresolved, including an entirely absent strike", () => {
    const result = matrixLensByStrike(matrix([cell(770, 8e6)]), zero, session);
    expect(result.totalMn).toBeNull();
    expect(result.byStrikeDetail.get(771)).toEqual({ knownMn: null, knownCells: 0, unresolvedCells: 1 });
  });
  it("preserves a measured zero without equating it with completeness", () => {
    const result = matrixLensByStrike(matrix([cell(770, 0), cell(771, null)]), zero, session);
    expect(result.knownTotalMn).toBe(0);
    expect(result.totalMn).toBeNull();
    expect(result.byStrike.get(770)).toBe(0);
  });
  it("returns a complete numerical total when every selected pair is known", () => {
    const result = matrixLensByStrike(matrix([cell(770, 8e6), cell(771, -8e6)]), zero, session);
    expect(result).toMatchObject({ totalMn: 0, knownTotalMn: 0, complete: true, unresolvedPairCount: 0 });
  });
  it("keeps 0DTE on the source day after the build crosses UTC midnight", () => {
    const doc = matrix([cell(770, 1e6), cell(771, 2e6), cell(770, 9e6, later)]);
    expect(matrixSourceSession(doc)).toBe(session);
    expect(matrixLensByStrike(doc, zero, session)).toMatchObject({ totalMn: 3, requestedExpiries: [session] });
    expect(matrixLensByStrike({ ...doc, _build_meta: null }, zero, session).reason).toBe("source_session_unavailable");
  });
  it("preserves independent historical inspection while requiring matching coupled sessions", () => {
    const doc = matrix([cell(770, 1e6), cell(771, 2e6)]);
    expect(matrixLensByStrike(doc, zero, later).reason).toBe("different_source_session");
    expect(matrixLensByStrike(doc, zero, later, "source-local").totalMn).toBe(3);
    expect(matrixSessionsAgree(session, later)).toBe(true);
    expect(matrixDescribedSessionsMatch(session, later)).toBe(false);
  });
  it("refuses duplicates outside the selected expiry before filtering", () => {
    const doc = matrix([cell(770, 1e6), cell(771, 2e6), cell(770, 4e6, later), cell(770, 5e6, later)]);
    expect(matrixLensByStrike(doc, zero, session).reason).toBe("duplicate_cell_identity");
  });
  it.each([
    { strikes: [770, 770] }, { strikes: [770] }, { strikes: [770, -1] },
    { expiries: [session, session] }, { expiries: [later] }, { expiries: ["2026-02-30"] },
  ])("refuses inconsistent axes %j", (axes) => {
    const doc = { ...matrix([cell(770, 1e6), cell(771, 2e6)]), ...axes };
    expect(matrixLensByStrike(doc, zero, session).reason).toBe("invalid_axis");
  });
  it("rejects invalid cell dates rather than rolling them into another month", () => {
    expect(matrixLensByStrike(matrix([cell(770, 1e6, "2026-02-30")]), zero, session).reason).toBe("invalid_cell_identity");
  });
  it("shares the companion validator by identity and retains leap-day validation", () => {
    expect(isoSession).toBe(companionIsoSession);
    expect(isoSession("2024-02-29")).toBe("2024-02-29");
    expect(isoSession("2026-02-29")).toBeNull();
    expect(isoSession("2026-09-25T00:00:00Z")).toBeNull();
  });
});
