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

// Repair round 1 (review P1): the required population of a narrow lens is what the desk
// DISPLAYS and the lens NAMES — the ladder's strikes (gex `by_strike`) × the chain
// expiries the lens selects (gex `by_expiry`) — not the matrix's own, differently windowed
// grid. The matrix producer windows strikes to ±20% with no cap and expiries to ≤90 DTE;
// the ladder is capped at the 160 strikes nearest spot and by_expiry is the full chain.
describe("(e) the required population is the displayed ladder × the chain expiries the lens names", () => {
  const leaps = "2027-12-17";
  const wide = (cells: GexMatrix["cells"], strikes = [770, 771, 900]): GexMatrix => ({
    asof: "2026-09-25T21:04:00Z", _build_meta: { asof_date: session },
    strikes, expiries: [session, later], cells,
  });
  const grid = (strikes: number[], g: (k: number, e: string) => number) =>
    strikes.flatMap((k) => [cell(k, g(k, session)), cell(k, g(k, later), later)]);

  it("a matrix strike that is not on the ladder never enters the total (probe A: -46 vs +4)", () => {
    const doc = wide(grid([770, 771, 900], (k, e) => (e === session ? 1e6 : k === 900 ? -50e6 : 2e6)));
    const population = { strikes: [770, 771], expiries: [session, later] };
    const result = matrixLensByStrike(doc, exZero, session, "coupled-view", population);
    const ladderSum = population.strikes.reduce((a, k) => a + (lensValueForStrike(k, null, exZero, result) ?? NaN), 0);
    expect(ladderSum).toBe(4);
    expect(result.totalMn).toBe(ladderSum);
    expect([...result.byStrikeDetail.keys()].sort()).toEqual([770, 771]);
    expect(result).toMatchObject({ complete: true, unresolvedPairCount: 0, missingStrikeCount: 0, missingExpiryCount: 0 });
  });

  it("a chain expiry outside the matrix window withholds the ex-0DTE total (probe B)", () => {
    const doc = wide(grid([770, 771], (_k, e) => (e === session ? 1e6 : 3.5e6)), [770, 771]);
    const result = matrixLensByStrike(doc, exZero, session, "coupled-view",
      { strikes: [770, 771], expiries: [session, later, `${leaps} 00:00:00`] });
    expect(result.totalMn).toBeNull();
    expect(result.complete).toBe(false);
    expect(result.unresolvedPairCount).toBe(2);
    expect(result.knownTotalMn).toBe(7);
    expect(result.missingExpiryCount).toBe(1);
    expect(result.requestedExpiries).toEqual([later, leaps]);
    expect(lensValueForStrike(770, null, exZero, result)).toBeNull();
    expect(lensValueForStrike(771, null, exZero, result)).toBeNull();
  });

  it("a ladder strike outside the matrix strike axis withholds the total and its row", () => {
    const doc = wide(grid([770, 771], () => 1e6), [770, 771]);
    const result = matrixLensByStrike(doc, zero, session, "coupled-view",
      { strikes: [768, 770, 771], expiries: [session, later] });
    expect(result.totalMn).toBeNull();
    expect(result.knownTotalMn).toBe(2);
    expect(result).toMatchObject({ unresolvedPairCount: 1, missingStrikeCount: 1 });
    expect(lensValueForStrike(768, null, zero, result)).toBeNull();
    expect([...result.covered].sort()).toEqual([770, 771]);
  });

  it("an expired chain row (before the source session) is not required", () => {
    const doc = wide(grid([770, 771], () => 1e6), [770, 771]);
    const result = matrixLensByStrike(doc, exZero, session, "coupled-view",
      { strikes: [770, 771], expiries: ["2026-09-18", session, later] });
    expect(result.totalMn).toBe(2);
  });

  it("without the chain's expiries the coupled population is unknown, never assumed", () => {
    const doc = wide(grid([770, 771], () => 1e6), [770, 771]);
    const result = matrixLensByStrike(doc, exZero, session, "coupled-view", { strikes: [770, 771], expiries: null });
    expect(result.totalMn).toBeNull();
    expect(result.reason).toBe("population_unavailable");
    expect(matrixLensByStrike(doc, exZero, session, "coupled-view",
      { strikes: [770, 771], expiries: [session, "not-a-date"] }).reason).toBe("invalid_axis");
  });

  it("a complete total equals the sum of the displayed ladder rows under every narrow lens", () => {
    const doc = wide(grid([770, 771, 900], (k, e) => (k * (e === session ? 1 : -3)) * 1e3));
    const population = { strikes: [770, 771], expiries: [session, later] };
    for (const lens of [zero, exZero, { kind: "one", exp: later } as ExpiryLens]) {
      const result = matrixLensByStrike(doc, lens, session, "coupled-view", population);
      const rows = population.strikes.map((k) => lensValueForStrike(k, null, lens, result));
      expect(rows.every((v) => v != null)).toBe(true);
      expect(result.totalMn).toBeCloseTo(rows.reduce<number>((a, v) => a + (v as number), 0), 9);
    }
  });
});

describe("(f) per-strike expiry shares are offered only over a fully known gamma grid", () => {
  const doc = (cells: GexMatrix["cells"]): GexMatrix => ({
    asof: "2026-09-25T21:04:00Z", _build_meta: { asof_date: session },
    strikes: [770, 771], expiries: [session, later], cells,
  });
  const population = { strikes: [770, 771], expiries: [session, later] };

  it("withholds the shares of a strike with an unresolved cell, keeps a fully known strike", () => {
    const cells = ladder.matrixShareCells(doc([cell(770, 10e6), cell(770, null, later), cell(771, 1e6), cell(771, 3e6, later)]),
      ladder.LENS_ALL, session, population);
    expect(cells?.filter((c) => c.strike === 770)).toEqual([]);
    expect(cells?.filter((c) => c.strike === 771).map((c) => c.expiry).sort()).toEqual([session, later]);
  });

  it("withholds every share when the matrix describes a different session", () => {
    const full = doc([cell(770, 1e6), cell(770, 2e6, later), cell(771, 1e6), cell(771, 3e6, later)]);
    expect(ladder.matrixShareCells(full, ladder.LENS_ALL, later, population)).toBeNull();
    expect(ladder.matrixShareCells(full, ladder.LENS_ALL, session, population)?.length).toBe(4);
  });

  it("under a narrow lens, offers only the selected expiries' cells", () => {
    const full = doc([cell(770, 1e6), cell(770, 2e6, later), cell(771, 1e6), cell(771, 3e6, later)]);
    const cells = ladder.matrixShareCells(full, zero, session, population);
    expect(cells?.map((c) => c.expiry)).toEqual([session, session]);
  });
});
