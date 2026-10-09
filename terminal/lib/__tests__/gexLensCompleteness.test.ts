// T09 — expiry partial-total integrity. A narrow expiry lens sums matrix cells over a
// selected grid (every matrix strike × every selected expiry). One unknown cell in that
// grid makes the selected total unknown; the known part stays visible as a subtotal, and a
// measured zero stays a zero. Adapted from the consumed #768 cases onto the #723 carrier.
import { describe, expect, it } from "vitest";
import * as dte from "@/lib/dte";
import * as companion from "@/lib/optionsCompanion";
import * as ladder from "@/lib/gexLadder";
import { lensValueForStrike, matrixLensByStrike, type ExpiryLens, type GexMatrix } from "@/lib/gexLadder";

const session = "2026-09-25";
const later = "2026-09-28";
const cell = (strike: number, gex: number | null, expiry = session) => ({ strike, expiry, gex });
// Built the same evening as its source session, so the old build-clock anchor and the
// source-session anchor agree here: these cases isolate the arithmetic defect.
const matrix = (cells: GexMatrix["cells"], asof = "2026-09-25T21:04:00Z"): GexMatrix => ({
  asof, _build_meta: { asof_date: session },
  strikes: [770, 771], expiries: [session, later], cells,
});
const zero: ExpiryLens = { kind: "zero" };
const exZero: ExpiryLens = { kind: "ex-zero" };

describe("(a) one unknown required cell makes the selected total unknown", () => {
  it.each([null, NaN, Infinity, -Infinity])("withholds the total but keeps the $8M known subtotal (%s)", (unknown) => {
    const result = matrixLensByStrike(matrix([cell(770, 8e6), cell(771, unknown)]), zero, session);
    expect(result.totalMn).toBeNull();
    expect(result).toMatchObject({ knownTotalMn: 8, complete: false, unresolvedPairCount: 1, cellCount: 1 });
    expect(lensValueForStrike(771, 12, zero, result)).toBeNull();
    expect(lensValueForStrike(770, 12, zero, result)).toBe(8);
  });

  it("an absent pair inside the matrix window is unresolved, never an inferred zero", () => {
    const result = matrixLensByStrike(matrix([cell(770, 8e6), cell(770, 1e6, later)]), zero, session);
    expect(result.totalMn).toBeNull();
    expect(lensValueForStrike(771, 12, zero, result)).toBeNull();
    expect(result.byStrikeDetail.get(771)).toEqual({ knownMn: null, knownCells: 0, unresolvedCells: 1 });
  });

  it("a strike row is shown only when every selected expiry for it is known", () => {
    // ex-zero selects the single later expiry here; 770 has it, 771 does not.
    const doc = matrix([cell(770, 8e6), cell(771, 2e6), cell(770, 5e6, later)]);
    const result = matrixLensByStrike(doc, exZero, session);
    expect(result.totalMn).toBeNull();
    expect(result.knownTotalMn).toBe(5);
    expect(lensValueForStrike(770, 0, exZero, result)).toBe(5);
    expect(lensValueForStrike(771, 0, exZero, result)).toBeNull();
  });

  it("returns a complete total only when every selected cell is known", () => {
    const result = matrixLensByStrike(matrix([cell(770, 8e6), cell(771, -8e6)]), zero, session);
    expect(result).toMatchObject({ totalMn: 0, knownTotalMn: 0, complete: true, unresolvedPairCount: 0 });
  });
});

describe("(b) a measured zero survives every transform", () => {
  it("keeps a measured zero cell as 0 in the row, the subtotal and a complete total", () => {
    const partial = matrixLensByStrike(matrix([cell(770, 0), cell(771, null)]), zero, session);
    expect(partial.byStrike.get(770)).toBe(0);
    expect(lensValueForStrike(770, 99, zero, partial)).toBe(0);
    expect(partial.knownTotalMn).toBe(0);
    expect(partial.totalMn).toBeNull();
    const full = matrixLensByStrike(matrix([cell(770, 0), cell(771, 0)]), zero, session);
    expect(full.totalMn).toBe(0);
    expect(ladder.fmtMn(full.totalMn)).toBe("0");
    expect(ladder.fmtMn(partial.totalMn)).toBe("—");
  });
});

describe("(c) changing the expiry lens never changes the strike population silently", () => {
  it("every narrow lens is judged over the same strike axis", () => {
    const doc = matrix([cell(770, 8e6), cell(771, 2e6), cell(770, 5e6, later)]);
    const lenses: ExpiryLens[] = [zero, exZero, { kind: "one", exp: later }, { kind: "one", exp: session }];
    for (const lens of lenses) {
      const result = matrixLensByStrike(doc, lens, session);
      expect([...result.covered].sort()).toEqual([770, 771]);
      expect([...result.byStrikeDetail.keys()].sort()).toEqual([770, 771]);
    }
  });

  it("keeps 0DTE on the source session after the build crosses UTC midnight", () => {
    const doc = matrix([cell(770, 1e6), cell(771, 2e6), cell(770, 9e6, later)], "2026-09-26T00:05:00Z");
    expect(ladder.matrixSourceSession(doc)).toBe(session);
    expect(matrixLensByStrike(doc, zero, session)).toMatchObject({ totalMn: 3, requestedExpiries: [session] });
    expect(matrixLensByStrike({ ...doc, _build_meta: null }, zero, session).reason).toBe("source_session_unavailable");
  });

  it("requires the matrix and gex payload to describe the same session for the coupled view", () => {
    const doc = matrix([cell(770, 1e6), cell(771, 2e6)]);
    expect(matrixLensByStrike(doc, zero, later).reason).toBe("different_source_session");
    expect(matrixLensByStrike(doc, zero, later).totalMn).toBeNull();
    expect(matrixLensByStrike(doc, zero, later, "source-local").totalMn).toBe(3);
    expect(ladder.matrixDescribedSessionsMatch(session, "2026-09-25T20:15:00Z")).toBe(true);
    expect(ladder.matrixDescribedSessionsMatch(session, later)).toBe(false);
  });

  it("refuses a duplicated strike/expiry pair anywhere in the document", () => {
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

  it("rejects an impossible cell date rather than rolling it into another month", () => {
    expect(matrixLensByStrike(matrix([cell(770, 1e6, "2026-02-30")]), zero, session).reason).toBe("invalid_cell_identity");
  });

  it("shares one strict session validator with the companion", () => {
    expect(dte.isoSession).toBeTypeOf("function");
    expect(dte.isoSession).toBe(companion.isoSession);
    expect(dte.isoSession("2024-02-29")).toBe("2024-02-29");
    expect(dte.isoSession("2026-02-29")).toBeNull();
    expect(dte.isoSession("2026-09-25T00:00:00Z")).toBeNull();
  });
});
