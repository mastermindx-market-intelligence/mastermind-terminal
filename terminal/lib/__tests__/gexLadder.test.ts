import { describe, it, expect } from "vitest";
import { readFile } from "fs/promises";
import path from "path";
import {
  fmtBn,
  fmtMn,
  fmtMnMag,
  lensNeedsMatrix,
  lensValueForStrike,
  matrixExpiryCoverage,
  matrixLensByStrike,
  MAX_SESSION_GAP_DAYS,
  matrixSessionsAgree,
  matrixStrikeSet,
  maxAbs,
  normExp,
  scaleBases,
  zeroDteExpiry,
  type ExpiryLens,
  type GexMatrix,
} from "@/lib/gexLadder";

const ASOF = "2026-07-10T20:15:00Z";

// Two strikes × three expiries, one of them the snapshot's own session day. `gex` is in
// whole dollars, exactly like options_structure.matrix/v1.
const MATRIX: GexMatrix = {
  asof: "2026-07-10T21:04:11Z",
  _build_meta: { asof_date: "2026-07-10" },
  spot: 751.71,
  expiries: ["2026-07-10", "2026-07-17", "2026-08-21"],
  // 730 is on the strike axis but carries no 0DTE cell — unresolved, never inferred zero.
  strikes: [730, 750, 760],
  cells: [
    { strike: 750, expiry: "2026-07-10", gex: 120_000_000 },
    { strike: 750, expiry: "2026-07-17", gex: 80_000_000 },
    { strike: 750, expiry: "2026-08-21", gex: -30_000_000 },
    { strike: 760, expiry: "2026-07-10", gex: 45_000_000 },
    { strike: 760, expiry: "2026-08-21", gex: 15_000_000 },
    { strike: 730, expiry: "2026-08-21", gex: -60_000_000 },
  ],
};

// 770 is NOT on the matrix's strike axis — the ladder shows it, the matrix never saw it.
const LADDER_STRIKES = [730, 750, 760, 770];

describe("normExp", () => {
  it("reduces every store's key shape to a date part", () => {
    expect(normExp("2026-07-17")).toBe("2026-07-17");
    expect(normExp("2026-07-17 00:00:00")).toBe("2026-07-17");
    expect(normExp(null)).toBe("");
  });
});

describe("matrixStrikeSet / zeroDteExpiry", () => {
  it("prefers the published strike axis", () => {
    expect([...matrixStrikeSet(MATRIX)].sort((a, b) => a - b)).toEqual([730, 750, 760]);
  });
  it("falls back to the strikes present in cells when the axis is absent", () => {
    const noAxis: GexMatrix = { cells: MATRIX.cells };
    expect([...matrixStrikeSet(noAxis)].sort((a, b) => a - b)).toEqual([730, 750, 760]);
  });
  it("is empty for a null matrix", () => {
    expect(matrixStrikeSet(null).size).toBe(0);
  });
  it("finds the expiry that IS the snapshot day", () => {
    expect(zeroDteExpiry(MATRIX.expiries!, ASOF)).toBe("2026-07-10");
  });
  it("returns null when no expiry lands on the snapshot day", () => {
    expect(zeroDteExpiry(["2026-07-17", "2026-08-21"], ASOF)).toBeNull();
    expect(zeroDteExpiry(MATRIX.expiries!, null)).toBeNull();
  });
});

describe("matrixExpiryCoverage — an expiry is only offered when it can be drawn", () => {
  it("lists expiries with cells at strikes the ladder actually renders", () => {
    const cov = matrixExpiryCoverage(MATRIX, LADDER_STRIKES);
    expect([...cov].sort()).toEqual(["2026-07-10", "2026-07-17", "2026-08-21"]);
  });
  it("is EMPTY when the two stores share no strikes (mismatched sessions)", () => {
    // The exact failure mode the live pair was in: matrix built for a different session,
    // so every ladder row would have rendered a dash. The control must go dark instead.
    expect(matrixExpiryCoverage(MATRIX, [510, 515, 520]).size).toBe(0);
  });
  it("is empty for a null matrix or an empty ladder", () => {
    expect(matrixExpiryCoverage(null, LADDER_STRIKES).size).toBe(0);
    expect(matrixExpiryCoverage(MATRIX, []).size).toBe(0);
  });
});

describe("matrixLensByStrike — the lens sums, in $mn", () => {
  it("all: reads nothing from the matrix (by_strike is the source)", () => {
    const v = matrixLensByStrike(MATRIX, { kind: "all" }, ASOF);
    expect(v.cellCount).toBe(0);
    expect(v.byStrike.size).toBe(0);
    expect(lensNeedsMatrix({ kind: "all" })).toBe(false);
  });

  it("zero: only the session-day expiry, converted dollars → $mn", () => {
    const v = matrixLensByStrike(MATRIX, { kind: "zero" }, ASOF);
    expect(v.byStrike.get(750)).toBe(120);
    expect(v.byStrike.get(760)).toBe(45);
    expect(v.byStrike.has(730)).toBe(false); // covered strike, no 0DTE cell
    expect(v.totalMn).toBeNull();
    expect(v.knownTotalMn).toBe(165);
    expect(v.unresolvedPairCount).toBe(1);
    expect(v.cellCount).toBe(2);
  });

  it("ex-zero: everything EXCEPT the session-day expiry", () => {
    const v = matrixLensByStrike(MATRIX, { kind: "ex-zero" }, ASOF);
    expect(v.byStrike.get(750)).toBe(50); // 80 − 30
    expect(v.byStrike.has(760)).toBe(false);
    expect(v.byStrike.has(730)).toBe(false);
    expect(v.byStrikeDetail.get(760)?.knownMn).toBe(15);
    expect(v.byStrikeDetail.get(730)?.knownMn).toBe(-60);
    expect(v.totalMn).toBeNull();
    expect(v.knownTotalMn).toBe(5);
  });

  it("zero + ex-zero known subtotals partition observed cells without certifying missing cells", () => {
    const z = matrixLensByStrike(MATRIX, { kind: "zero" }, ASOF);
    const x = matrixLensByStrike(MATRIX, { kind: "ex-zero" }, ASOF);
    const allCells = MATRIX.cells!.reduce((s, c) => s + (c.gex ?? 0), 0) / 1e6;
    expect(z.knownTotalMn! + x.knownTotalMn!).toBeCloseTo(allCells, 9);
    expect(z.totalMn).toBeNull();
    expect(x.totalMn).toBeNull();
    expect(z.cellCount + x.cellCount).toBe(MATRIX.cells!.length);
  });

  it("one: a single exact expiry, refusing ambiguous padded scope identity", () => {
    const v = matrixLensByStrike(MATRIX, { kind: "one", exp: "2026-07-17" }, ASOF);
    expect(v.byStrike.get(750)).toBe(80);
    expect(v.byStrike.size).toBe(1);
    const padded = matrixLensByStrike(MATRIX, { kind: "one", exp: "2026-07-17 00:00:00" }, ASOF);
    expect(padded.reason).toBe("unsupported_scope");
    expect(padded.totalMn).toBeNull();
  });

  it("with no as-of there is no 0DTE bucket to select (never guesses 'today')", () => {
    const v = matrixLensByStrike(MATRIX, { kind: "zero" }, null);
    expect(v.cellCount).toBe(0);
  });

  it("drops null/non-finite cells instead of counting them as zero", () => {
    const dirty: GexMatrix = {
      ...MATRIX,
      cells: [
        { strike: 750, expiry: "2026-07-10", gex: null },
        { strike: 760, expiry: "2026-07-10", gex: Number.NaN },
        { strike: 730, expiry: "2026-07-10", gex: 10_000_000 },
      ],
    };
    const v = matrixLensByStrike(dirty, { kind: "zero" }, ASOF);
    expect(v.cellCount).toBe(1);
    expect(v.totalMn).toBeNull();
    expect(v.knownTotalMn).toBe(10);
    expect(v.unresolvedPairCount).toBe(2);
  });
});

describe("matrixSessionsAgree — the drift gate", () => {
  it("agrees same-day", () => {
    expect(matrixSessionsAgree("2026-07-10T21:04:11Z", "2026-07-10T20:15:00Z")).toBe(true);
  });
  it("agrees across a routine weekend gap (Fri matrix, Mon payload)", () => {
    expect(matrixSessionsAgree("2026-07-10T21:00:00Z", "2026-07-13T20:15:00Z")).toBe(true);
  });
  it("disagrees across the documented two-week drift", () => {
    expect(matrixSessionsAgree("2026-07-10T21:00:00Z", "2026-07-24T20:15:00Z")).toBe(false);
  });
  it("disagrees when either side is unknown or unparseable", () => {
    expect(matrixSessionsAgree(null, "2026-07-10T20:15:00Z")).toBe(false);
    expect(matrixSessionsAgree("2026-07-10T21:00:00Z", null)).toBe(false);
    expect(matrixSessionsAgree(undefined, undefined)).toBe(false);
    expect(matrixSessionsAgree("not-a-date", "2026-07-10T20:15:00Z")).toBe(false);
  });
  it("is inclusive exactly at the tolerance boundary, exclusive one day past it", () => {
    const base = "2026-07-10T21:00:00Z";
    const atBound = new Date(Date.parse("2026-07-10T00:00:00Z") + MAX_SESSION_GAP_DAYS * 86_400_000)
      .toISOString();
    const pastBound = new Date(
      Date.parse("2026-07-10T00:00:00Z") + (MAX_SESSION_GAP_DAYS + 1) * 86_400_000
    ).toISOString();
    expect(matrixSessionsAgree(base, atBound)).toBe(true);
    expect(matrixSessionsAgree(base, pastBound)).toBe(false);
  });
});

describe("matrixLensByStrike — session drift guard (the exact bug this lens ships to prevent)", () => {
  // Matrix captured 2026-07-10; the live gex payload has moved on to 2026-07-24 — the
  // documented "two weeks behind" drift. From TODAY's (07-24) vantage, the 07-10/07-13/
  // 07-17 legs are already expired; only 07-31 genuinely survives tonight.
  const DRIFTED: GexMatrix = {
    asof: "2026-07-10T21:04:11Z",
    _build_meta: { asof_date: "2026-07-10" },
    expiries: ["2026-07-10", "2026-07-13", "2026-07-17", "2026-07-24", "2026-07-31"],
    strikes: [750],
    cells: [
      { strike: 750, expiry: "2026-07-10", gex: 40_000_000 },
      { strike: 750, expiry: "2026-07-13", gex: 30_000_000 },
      { strike: 750, expiry: "2026-07-17", gex: 20_000_000 },
      { strike: 750, expiry: "2026-07-24", gex: 90_000_000 }, // priced at 14 DTE by the stale matrix
      { strike: 750, expiry: "2026-07-31", gex: 10_000_000 }, // the only leg that truly survives
    ],
  };
  const GEX_ASOF = "2026-07-24T20:15:00Z"; // the LIVE payload's session — 14 days ahead

  /** The OLD (pre-fix) anchor: the gex payload's asof, no drift guard, no DTE filter —
   *  reproduced inline (not imported) so this test proves what the bug actually did. */
  function oldMatrixLensByStrike(matrix: GexMatrix, lens: ExpiryLens, gexAsOf: string) {
    const zeroDay = zeroDteExpiry(matrix.expiries ?? [], gexAsOf);
    let totalMn = 0;
    let cellCount = 0;
    const used: string[] = [];
    for (const c of matrix.cells ?? []) {
      const e = normExp(c.expiry);
      if (lens.kind === "zero" && e !== zeroDay) continue;
      if (lens.kind === "ex-zero" && e === zeroDay) continue;
      totalMn += (c.gex ?? 0) / 1e6;
      cellCount++;
      used.push(e);
    }
    return { zeroDay, totalMn, cellCount, used };
  }

  it("REGRESSION: the old (gex-anchored) lens summed already-expired legs and mislabeled a stale leg 0DTE", () => {
    const oldZero = oldMatrixLensByStrike(DRIFTED, { kind: "zero" }, GEX_ASOF);
    expect(oldZero.zeroDay).toBe("2026-07-24"); // borrowed from TODAY, not the matrix's own session
    expect(oldZero.totalMn).toBe(90); // the 14-DTE-priced leg, mislabeled "0DTE"

    const oldExZero = oldMatrixLensByStrike(DRIFTED, { kind: "ex-zero" }, GEX_ASOF);
    expect(oldExZero.used).toEqual(["2026-07-10", "2026-07-13", "2026-07-17", "2026-07-31"]);
    expect(oldExZero.cellCount).toBe(4); // three of these four legs are already EXPIRED
  });

  it("FIX: drift beyond the tolerance disables every narrow lens (honest dash, never a fabricated sum)", () => {
    const lenses: ExpiryLens[] = [
      { kind: "zero" },
      { kind: "ex-zero" },
      { kind: "one", exp: "2026-07-31" },
    ];
    for (const lens of lenses) {
      const v = matrixLensByStrike(DRIFTED, lens, GEX_ASOF);
      expect(v.cellCount).toBe(0);
      expect(v.covered.size).toBe(0); // strikes read as the honest dash, never a fabricated 0
      expect(v.totalMn).toBeNull();
      expect(v.reason).toBe("different_source_session");
    }
  });

  it("FIX: when the two stores agree on session, the anchor is the MATRIX's own day", () => {
    const v = matrixLensByStrike(DRIFTED, { kind: "zero" }, "2026-07-10T20:15:00Z");
    expect(v.totalMn).toBe(40); // the 07-10 leg — the matrix's OWN session day
    expect(v.cellCount).toBe(1);
    const x = matrixLensByStrike(DRIFTED, { kind: "ex-zero" }, "2026-07-10T20:15:00Z");
    // Every other expiry survives under the aligned anchor — none are pre-anchor here.
    expect(x.cellCount).toBe(4);
    expect(x.totalMn).toBe(30 + 20 + 90 + 10);
  });
});

describe("matrixLensByStrike — DTE>=0 filter drops cells before the matrix's own anchor", () => {
  it("a cell for an expiry strictly before the matrix's own session never counts, in any narrow lens", () => {
    const withStaleLeg: GexMatrix = {
      asof: "2026-07-17T21:00:00Z",
      _build_meta: { asof_date: "2026-07-17" },
      expiries: ["2026-07-10", "2026-07-17", "2026-07-24"],
      strikes: [750],
      cells: [
        { strike: 750, expiry: "2026-07-10", gex: 999_000_000 }, // already expired when the matrix was built
        { strike: 750, expiry: "2026-07-17", gex: 40_000_000 },
        { strike: 750, expiry: "2026-07-24", gex: 10_000_000 },
      ],
    };
    const exZero = matrixLensByStrike(withStaleLeg, { kind: "ex-zero" }, "2026-07-17T20:15:00Z");
    expect(exZero.totalMn).toBe(10); // 07-24 only — the pre-anchor 07-10 cell never leaks in
    expect(exZero.cellCount).toBe(1);
    const zero = matrixLensByStrike(withStaleLeg, { kind: "zero" }, "2026-07-17T20:15:00Z");
    expect(zero.totalMn).toBe(40); // 07-17, the matrix's own session day
  });
});

describe("lensValueForStrike — the honest-dash rule", () => {
  const zero = matrixLensByStrike(MATRIX, { kind: "zero" }, ASOF);

  it("All hands back the aggregate untouched", () => {
    expect(lensValueForStrike(750, -284.5, { kind: "all" }, zero)).toBe(-284.5);
  });
  it("a covered strike WITH a cell reads the lens value", () => {
    expect(lensValueForStrike(750, -284.5, { kind: "zero" }, zero)).toBe(120);
  });
  it("a covered strike WITHOUT a cell remains unresolved", () => {
    expect(lensValueForStrike(730, -284.5, { kind: "zero" }, zero)).toBeNull();
  });
  it("an UNCOVERED strike is null — never 0, never the aggregate", () => {
    // The regression this lane exists to prevent: silently showing the all-expiry number
    // while the control claims the ladder is scoped to one expiration.
    expect(lensValueForStrike(770, -284.5, { kind: "zero" }, zero)).toBeNull();
  });
});

describe("scaleBases (B1) — NOW | LADDER MAX", () => {
  // The bug: PEAK divided per-strike bars ($mn) by max|history.net_gex_bn| — the session
  // AGGREGATE in billions. Both bases below are the same quantity as the bars.
  const full = [-1003, -667, 126, 710, 1260];
  const visible = [-667, 126, 710];

  it("NOW follows the range filter; LADDER MAX pins to the whole snapshot", () => {
    const { nowMax, ladderMax } = scaleBases(visible, full);
    expect(nowMax).toBe(710);
    expect(ladderMax).toBe(1260);
  });
  it("LADDER MAX is never smaller than NOW", () => {
    const { nowMax, ladderMax } = scaleBases(full, visible);
    expect(ladderMax).toBeGreaterThanOrEqual(nowMax);
  });
  it("both bases are on the bars' own scale, so no bar can exceed full width", () => {
    const { ladderMax } = scaleBases(visible, full);
    for (const v of full) expect(Math.abs(v) / ladderMax).toBeLessThanOrEqual(1);
  });
  it("nulls (uncovered strikes) do not drag the scale", () => {
    const { nowMax } = scaleBases([null, 126, undefined, -667], [null]);
    expect(nowMax).toBe(667);
  });
  it("an all-zero ladder still divides safely", () => {
    const { nowMax, ladderMax } = scaleBases([0, 0], [0, 0]);
    expect(nowMax).toBeGreaterThan(0);
    expect(ladderMax).toBeGreaterThan(0);
  });
  it("maxAbs ignores nulls and non-finites", () => {
    expect(maxAbs([null, undefined, Number.NaN, Infinity, -4, 2])).toBe(4);
    expect(maxAbs([])).toBe(0);
  });
});

describe("formatters — one per unit", () => {
  it("fmtMn reads $mn (the by_strike / by_expiry / matrix-lens unit)", () => {
    // The live SPY payload's 660 strike: −284.503 $mn. The desk used to print "−284.50B".
    expect(fmtMn(-284.503)).toBe("-284.5M");
    expect(fmtMn(4673.5)).toBe("+4.67B");
    expect(fmtMn(0.42)).toBe("+420K");
  });
  it("fmtMn distinguishes a real zero from an unknown", () => {
    expect(fmtMn(0)).toBe("0"); // covered strike, nothing at this expiry
    expect(fmtMn(null)).toBe("—"); // strike outside the snapshot
    expect(fmtMn(Number.NaN)).toBe("—");
  });
  it("fmtBn reads $bn (net_gex_bn and the session history only)", () => {
    expect(fmtBn(4.6735)).toBe("+4.67B");
    expect(fmtBn(-18.3307)).toBe("-18.33B");
    expect(fmtBn(null)).toBe("—");
  });
  it("the two units never agree by accident — 4.67 is not 4673.5", () => {
    expect(fmtBn(4.6735)).toBe(fmtMn(4673.5));
    expect(fmtBn(4673.5)).not.toBe(fmtMn(4673.5));
  });
  it("fmtMnMag drops the sign for scale captions", () => {
    expect(fmtMnMag(-1350)).toBe("1.35B");
    expect(fmtMnMag(189.7)).toBe("189.7M");
  });
});

// ─── Committed fixtures: the three stores must describe ONE session ──────────────

async function readFixture<T>(name: string): Promise<T> {
  const p = path.join(process.cwd(), "public", "data", name);
  return JSON.parse(await readFile(p, "utf8")) as T;
}

describe("fixture coherence — the SPY desk in FLOW_FIXTURE mode", () => {
  it("gex + matrix + gexstate agree on spot and session", async () => {
    const gex = (await readFixture<Record<string, { spot_ref: number; asof: string }>>(
      "gex_fixture.json"
    )).SPY;
    const mx = (await readFixture<Record<string, GexMatrix>>("matrix_fixture.json")).SPY;
    const st = await readFixture<{ spot: number; net_gex_bn: number }>("gexstate_fixture.json");
    expect(mx.spot).toBe(gex.spot_ref);
    expect(st.spot).toBe(gex.spot_ref);
    expect(mx.asof!.slice(0, 10)).toBe(gex.asof.slice(0, 10));
  });

  it("the expiry lens is actually exercisable against them", async () => {
    const gex = (await readFixture<
      Record<string, { asof: string; by_strike: { strike: number }[]; by_expiry: { exp: string }[] }>
    >("gex_fixture.json")).SPY;
    const mx = (await readFixture<Record<string, GexMatrix>>("matrix_fixture.json")).SPY;
    const ladder = gex.by_strike.map((r) => r.strike);

    const cov = matrixExpiryCoverage(mx, ladder);
    expect(cov.size).toBeGreaterThan(1);
    // A same-day expiry exists, so the 0DTE chip and the All−0DTE cut are both real.
    expect(zeroDteExpiry(gex.by_expiry.map((r) => r.exp), gex.asof)).toBe(gex.asof.slice(0, 10));

    const zero = matrixLensByStrike(mx, { kind: "zero" }, gex.asof);
    const all = gex.by_strike.length;
    const covered = ladder.filter(
      (k) => lensValueForStrike(k, 0, { kind: "zero" }, zero) != null
    ).length;
    expect(covered).toBeGreaterThan(0);
    // …and NOT all of them: the wings sit outside the matrix window, which is what makes
    // the em-dash path visible in dev instead of only in production.
    expect(covered).toBeLessThan(all);
  });
});
