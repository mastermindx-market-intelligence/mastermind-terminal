import { describe, it, expect } from "vitest";
import {
  isSurfaceIndex,
  isSurfaceFrame,
  checkIndexFilesContract,
  levelStep,
  gridMaxAbs,
  gridPercentileAbs,
  parseOiChangeRows,
  topOiChangeStrikes,
  observedSurfaceCadenceSec,
  buildHeatBars,
  filterFrameToRange,
  toPerMinute,
  rebaseOffOpen,
  toAbsolute,
  composeSessionSeries,
  topExpiriesForStrike,
  readSurfaceExpiryMatrix,
  matrixForSurfaceObservation,
  metricEnabled,
  expiryPanelState,
  buildStrikeSeries,
  isSessionDate,
  isSurfaceDates,
  truncateSessionAt,
  archivedOverlayPolicy,
  removeHostedLines,
  type HostedLine,
  type SurfaceIndex,
  type SurfaceFrame,
  type SessionPoint,
  type MatrixCell,
  type OiChangeCell,
} from "@/lib/surfaceContract";
import type { Time } from "lightweight-charts";

const IDX: SurfaceIndex = {
  date: "2026-07-06",
  stamps: ["0931", "0941", "0951"],
  latest: "0951",
  cadenceSec: 600,
};

const FRAME: SurfaceFrame = {
  spot: 100,
  price_levels: [90, 95, 100, 105, 110],
  time_steps: ["09:31", "09:41", "09:51"],
  grids: {
    netprem: [
      [1, 2, 3], // level 90
      [-1, -2, -3], // 95
      [0, 5, 10], // 100
      [4, 4, 4], // 105
      [0, 0, -8], // 110
    ],
  },
  asof: "2026-07-06T13:51:00Z",
  cadence: "10-min",
};

describe("contract validators", () => {
  it("accepts a well-formed index / frame", () => {
    expect(isSurfaceIndex(IDX)).toBe(true);
    expect(isSurfaceFrame(FRAME)).toBe(true);
  });
  it("rejects malformed shapes", () => {
    expect(isSurfaceIndex({ date: "x", stamps: "no" })).toBe(false);
    expect(isSurfaceIndex(null)).toBe(false);
    expect(isSurfaceFrame({ price_levels: [1], grids: {} })).toBe(false); // missing asof/cadence/time_steps
  });
});

describe("checkIndexFilesContract — idx stamps ↔ files", () => {
  it("ok when files exactly match stamps and latest is the last", () => {
    const r = checkIndexFilesContract(IDX, ["0931", "0941", "0951"]);
    expect(r.ok).toBe(true);
    expect(r.missing).toEqual([]);
    expect(r.extra).toEqual([]);
    expect(r.latestOk).toBe(true);
  });
  it("flags a stamp with no file (missing)", () => {
    const r = checkIndexFilesContract(IDX, ["0931", "0951"]);
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(["0941"]);
  });
  it("flags a file the index doesn't list (extra)", () => {
    const r = checkIndexFilesContract(IDX, ["0931", "0941", "0951", "1001"]);
    expect(r.ok).toBe(false);
    expect(r.extra).toEqual(["1001"]);
  });
  it("flags a latest that isn't the last stamp", () => {
    const bad: SurfaceIndex = { ...IDX, latest: "0941" };
    const r = checkIndexFilesContract(bad, ["0931", "0941", "0951"]);
    expect(r.latestOk).toBe(false);
    expect(r.ok).toBe(false);
  });
  it("empty index requires latest === null", () => {
    const empty: SurfaceIndex = { date: "2026-07-06", stamps: [], latest: null, cadenceSec: 600 };
    expect(checkIndexFilesContract(empty, []).ok).toBe(true);
    expect(checkIndexFilesContract({ ...empty, latest: "0931" }, []).latestOk).toBe(false);
  });
});

describe("levelStep / gridMaxAbs", () => {
  it("median step of evenly-spaced levels", () => {
    expect(levelStep([90, 95, 100, 105, 110])).toBe(5);
  });
  it("degenerate inputs fall back to 1", () => {
    expect(levelStep([100])).toBe(1);
    expect(levelStep([])).toBe(1);
  });
  it("gridMaxAbs is the max magnitude across the grid", () => {
    expect(gridMaxAbs(FRAME.grids.netprem)).toBe(10);
    expect(gridMaxAbs([[0, 0], [0, 0]])).toBe(0);
  });
  it("gridMaxAbs ignores non-finite", () => {
    expect(gridMaxAbs([[Infinity, 3], [NaN, -4]])).toBe(4);
  });
});

describe("gridPercentileAbs — R1.4 percentile-range normalizer ('kill the bland')", () => {
  it("all-zero grid: no distribution to compress, degrades to gridMaxAbs's own answer (0)", () => {
    const grid = [[0, 0, 0], [0, 0, 0]];
    expect(gridPercentileAbs(grid)).toBe(0);
    expect(gridPercentileAbs(grid)).toBe(gridMaxAbs(grid));
  });

  it("single-cell outlier (the rest zero): the one nonzero value IS the 95th percentile", () => {
    const grid = [[0, 0, 0, 0], [0, 0, 0, 1000]];
    expect(gridPercentileAbs(grid)).toBe(1000);
    expect(gridPercentileAbs(grid)).toBe(gridMaxAbs(grid));
  });

  it("uniform grid: percentile is a no-op — every nonzero cell shares the same magnitude", () => {
    const grid = [[5, -5, 5], [-5, 5, -5]];
    expect(gridPercentileAbs(grid)).toBe(5);
    expect(gridPercentileAbs(grid)).toBe(gridMaxAbs(grid));
  });

  it("a monster outlier among many small cells: p95 clamps BELOW the raw max — the fix", () => {
    // 19 small cells (magnitude 1..19) + one outlier at 1000. gridMaxAbs would be 1000
    // (washing out the small cells under heatShade's o = |amount|/maxAbs); the 95th
    // percentile excludes the single largest of 20 values and lands on the second-largest.
    const small = Array.from({ length: 19 }, (_, i) => i + 1); // 1..19
    const grid = [[...small, 1000]];
    expect(gridMaxAbs(grid)).toBe(1000);
    expect(gridPercentileAbs(grid)).toBe(19);
    expect(gridPercentileAbs(grid)).toBeLessThan(gridMaxAbs(grid));
  });

  it("negative cells contribute by |magnitude|, same ranking as gridMaxAbs uses", () => {
    // Same shape as the monster-outlier case, sign-flipped: a negative outlier must be
    // excluded by the SAME magnitude ranking as a positive one — heatShade only ever sees
    // |amount|, so the normalizer must too.
    const small = Array.from({ length: 19 }, (_, i) => -(i + 1)); // -1..-19
    const grid = [[...small, -1000]];
    expect(gridMaxAbs(grid)).toBe(1000);
    expect(gridPercentileAbs(grid)).toBe(19);
    expect(gridPercentileAbs(grid)).toBeLessThan(gridMaxAbs(grid));
  });

  it("custom percentile parameter (e.g. the raw max via p=100)", () => {
    const grid = [[1, 2, 3, 4, 5]];
    expect(gridPercentileAbs(grid, 100)).toBe(gridMaxAbs(grid));
  });
});

describe("observedSurfaceCadenceSec", () => {
  it("reports the median interval actually present in the field", () => {
    expect(observedSurfaceCadenceSec(["10:06", "10:33", "11:01", "11:32", "12:05"]))
      .toBe(29.5 * 60);
  });

  it("does not substitute a configured cadence when observation is impossible", () => {
    expect(observedSurfaceCadenceSec(["10:06"])).toBeNull();
    expect(observedSurfaceCadenceSec(["bad", "11:00"])).toBeNull();
  });
});

const anchor = (hhmm: string): Time => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h * 60 + m) as unknown as Time; // deterministic minute-index anchor for tests
};

describe("buildHeatBars", () => {
  it("emits one bar per time step, each with a cell per level", () => {
    const bars = buildHeatBars(FRAME, "netprem", anchor);
    expect(bars).toHaveLength(3);
    expect(bars[0].cells).toHaveLength(5);
    // cell half-height = step/2 = 2.5, so level 100 → [97.5, 102.5]
    const mid = bars[0].cells[2];
    expect(mid.low).toBeCloseTo(97.5);
    expect(mid.high).toBeCloseTo(102.5);
    // amount = grid[levelIdx][timeIdx]; grid[2][0] = 0, grid[2][1] = 5
    expect(bars[0].cells[2].amount).toBe(0);
    expect(bars[1].cells[2].amount).toBe(5);
    expect(bars[2].cells[4].amount).toBe(-8);
  });
  it("returns [] for a missing metric or empty grid", () => {
    expect(buildHeatBars(FRAME, "gamma", anchor)).toEqual([]);
    expect(buildHeatBars({ ...FRAME, time_steps: [] }, "netprem", anchor)).toEqual([]);
  });
});

// ─── B3 regression: non-uniform price_levels must paint SOLID ────────────────
// The renderer (lib/heatSeries) builds its pixel grid from the UNION of every cell
// boundary in a bar and gives each cell the row starting at its `low`. So the field is
// gapless only when the cells tile the band exactly: contiguous (cell[i].high ===
// cell[i+1].low) and non-overlapping, which makes |union| === cells + 1 === rows + 1.
//
// The pre-fix construction gave every cell the SAME half-height (the MEDIAN level gap),
// so a non-uniform ladder produced overlapping cells AND a union with more rows than
// cells — the surplus rows were never written and showed as transparent stripes.
const NONUNIFORM: SurfaceFrame = {
  spot: 110,
  // gaps: 5,5,10,10 → median 10. Pre-fix every cell was ±5 regardless of its real gap.
  price_levels: [100, 105, 110, 120, 130],
  time_steps: ["09:31", "09:41"],
  grids: {
    netprem: [
      [1, 2],
      [3, 4],
      [5, 6],
      [7, 8],
      [9, 10],
    ],
  },
  asof: "2026-07-06T13:31:00Z",
  cadence: "10-min",
  session_date: "2026-07-06",
};

describe("buildHeatBars — non-uniform price_levels tile solid (B3)", () => {
  it("emits contiguous, non-overlapping cells: cell[i].high === cell[i+1].low", () => {
    const cells = buildHeatBars(NONUNIFORM, "netprem", anchor)[0].cells;
    expect(cells).toHaveLength(5);
    for (let i = 0; i < cells.length - 1; i++) {
      expect(cells[i].high).toBeCloseTo(cells[i + 1].low, 10);
      expect(cells[i].high).toBeGreaterThan(cells[i].low);
    }
  });

  it("boundary union has exactly cells+1 entries, so every row is owned by a cell", () => {
    const cells = buildHeatBars(NONUNIFORM, "netprem", anchor)[0].cells;
    const union = new Set<number>();
    for (const c of cells) { union.add(c.low); union.add(c.high); }
    // rows = union - 1; one row per cell means no unpainted stripe.
    expect(union.size).toBe(cells.length + 1);
  });

  it("sizes each band by its own local gap, not the median gap", () => {
    const cells = buildHeatBars(NONUNIFORM, "netprem", anchor)[0].cells;
    // 110 sits between a 5-wide gap below and a 10-wide gap above → [107.5, 115]
    expect(cells[2].low).toBeCloseTo(107.5);
    expect(cells[2].high).toBeCloseTo(115);
    // edge levels extend by half their single neighbouring gap
    expect(cells[0].low).toBeCloseTo(97.5);
    expect(cells[4].high).toBeCloseTo(135);
  });

  it("keeps the uniform-ladder geometry unchanged (no regression)", () => {
    const cells = buildHeatBars(FRAME, "netprem", anchor)[0].cells;
    const union = new Set<number>();
    for (const c of cells) { union.add(c.low); union.add(c.high); }
    expect(union.size).toBe(cells.length + 1);
    expect(cells[2].low).toBeCloseTo(97.5);
    expect(cells[2].high).toBeCloseTo(102.5);
  });

  it("survives a degenerate single-level ladder", () => {
    const one: SurfaceFrame = { ...NONUNIFORM, price_levels: [100], grids: { netprem: [[1, 2]] } };
    const cells = buildHeatBars(one, "netprem", anchor)[0].cells;
    expect(cells).toHaveLength(1);
    expect(cells[0].high).toBeGreaterThan(cells[0].low);
  });
});

describe("filterFrameToRange — spot ± q", () => {
  it("narrows levels and grid rows in lockstep", () => {
    const f = filterFrameToRange(FRAME, 100, 5); // keep 95..105
    expect(f.price_levels).toEqual([95, 100, 105]);
    expect(f.grids.netprem).toHaveLength(3);
    expect(f.grids.netprem[0]).toEqual([-1, -2, -3]); // the level-95 row
    expect(f.grids.netprem[2]).toEqual([4, 4, 4]); // the level-105 row
  });
  it("q <= 0 returns the frame unchanged", () => {
    expect(filterFrameToRange(FRAME, 100, 0)).toBe(FRAME);
  });
  it("an empty window returns the frame unchanged (never blanks the pane)", () => {
    expect(filterFrameToRange(FRAME, 1000, 1)).toBe(FRAME);
  });
});

// ── Session-flow rebase math ────────────────────────────────────────────────

const CUM: SessionPoint[] = [
  { t: "09:30", call: 100, put: -50 },
  { t: "09:31", call: 250, put: -120 },
  { t: "09:32", call: 400, put: -90 },
];

describe("toPerMinute", () => {
  it("differences a cumulative series (first point kept)", () => {
    expect(toPerMinute(CUM)).toEqual([
      { t: "09:30", call: 100, put: -50 },
      { t: "09:31", call: 150, put: -70 },
      { t: "09:32", call: 150, put: 30 },
    ]);
  });
  it("empty → empty", () => {
    expect(toPerMinute([])).toEqual([]);
  });
});

describe("rebaseOffOpen", () => {
  it("subtracts the 9:30 open; first point becomes 0/0", () => {
    expect(rebaseOffOpen(CUM)).toEqual([
      { t: "09:30", call: 0, put: 0 },
      { t: "09:31", call: 150, put: -70 },
      { t: "09:32", call: 300, put: -40 },
    ]);
  });
  it("empty → empty", () => {
    expect(rebaseOffOpen([])).toEqual([]);
  });
});

describe("toAbsolute", () => {
  it("takes magnitude of both legs", () => {
    expect(toAbsolute(CUM)).toEqual([
      { t: "09:30", call: 100, put: 50 },
      { t: "09:31", call: 250, put: 120 },
      { t: "09:32", call: 400, put: 90 },
    ]);
  });
});

describe("composeSessionSeries — fixed order permin → offOpen → absolute", () => {
  it("cumulative + no toggles = passthrough copy", () => {
    const s = composeSessionSeries(CUM, { mode: "cumulative", offOpen: false, absolute: false });
    expect(s).toEqual(CUM);
    expect(s).not.toBe(CUM); // defensive copy
  });
  it("per-min", () => {
    const s = composeSessionSeries(CUM, { mode: "permin", offOpen: false, absolute: false });
    expect(s[1]).toEqual({ t: "09:31", call: 150, put: -70 });
  });
  it("cumulative + off-open", () => {
    const s = composeSessionSeries(CUM, { mode: "cumulative", offOpen: true, absolute: false });
    expect(s[0]).toEqual({ t: "09:30", call: 0, put: 0 });
    expect(s[2]).toEqual({ t: "09:32", call: 300, put: -40 });
  });
  it("off-open then absolute (order matters: rebase first, then magnitude)", () => {
    const s = composeSessionSeries(CUM, { mode: "cumulative", offOpen: true, absolute: true });
    // rebase makes 09:32 put = -40, absolute → 40
    expect(s[2]).toEqual({ t: "09:32", call: 300, put: 40 });
  });
});

// ── Ladder hover: per-expiry breakdown ──────────────────────────────────────

const CELLS: MatrixCell[] = [
  { strike: 750, expiry: "2026-07-06", gex: 600 },
  { strike: 750, expiry: "2026-07-10", gex: -300 },
  { strike: 750, expiry: "2026-07-17", gex: 100 },
  { strike: 750, expiry: "2026-07-24", gex: 0 }, // dropped (zero)
  { strike: 755, expiry: "2026-07-06", gex: 999 }, // different strike
];

describe("topExpiriesForStrike", () => {
  it("returns top-N expiries by |gex| with shares summing to 1", () => {
    const top = topExpiriesForStrike(CELLS, 750);
    expect(top.map((e) => e.exp)).toEqual(["2026-07-06", "2026-07-10", "2026-07-17"]);
    expect(top[0].gex).toBe(600);
    // shares are |gex| / Σ|gex| over kept (non-zero) cells: 600/(600+300+100)=0.6
    expect(top[0].share).toBeCloseTo(0.6);
    expect(top[1].share).toBeCloseTo(0.3);
    expect(top[2].share).toBeCloseTo(0.1);
    expect(top.reduce((s, e) => s + e.share, 0)).toBeCloseTo(1);
  });
  it("drops zero / non-finite cells", () => {
    const top = topExpiriesForStrike(CELLS, 750);
    expect(top.find((e) => e.exp === "2026-07-24")).toBeUndefined();
  });
  it("respects the N cap", () => {
    expect(topExpiriesForStrike(CELLS, 750, 2)).toHaveLength(2);
  });
  it("preserves the sign of gex (negative expiries kept, ranked by magnitude)", () => {
    const top = topExpiriesForStrike(CELLS, 750);
    expect(top[1]).toMatchObject({ exp: "2026-07-10", gex: -300 });
  });
  it("returns [] for an unknown strike, empty, or null cells", () => {
    expect(topExpiriesForStrike(CELLS, 999)).toEqual([]);
    expect(topExpiriesForStrike([], 750)).toEqual([]);
    expect(topExpiriesForStrike(null, 750)).toEqual([]);
    expect(topExpiriesForStrike(undefined, 750)).toEqual([]);
  });
});

// ── OI Δ strike ranking (options_hub.oi_change/v1, nightly) ─────────────────

describe("parseOiChangeRows", () => {
  it("extracts {strike, d_oi} from a well-formed rows array", () => {
    const raw = { rows: [{ strike: 745, d_oi: 100, exp: "2026-08-21" }, { strike: 750, d_oi: -50 }] };
    expect(parseOiChangeRows(raw)).toEqual([{ strike: 745, d_oi: 100 }, { strike: 750, d_oi: -50 }]);
  });
  it("drops rows with a non-finite strike or d_oi", () => {
    const raw = { rows: [{ strike: 745, d_oi: 100 }, { strike: "nope", d_oi: 50 }, { strike: 750, d_oi: null }] };
    expect(parseOiChangeRows(raw)).toEqual([{ strike: 745, d_oi: 100 }]);
  });
  it("returns [] for a missing/malformed rows array — never throws", () => {
    expect(parseOiChangeRows(null)).toEqual([]);
    expect(parseOiChangeRows(undefined)).toEqual([]);
    expect(parseOiChangeRows({})).toEqual([]);
    expect(parseOiChangeRows({ rows: "not an array" })).toEqual([]);
    expect(parseOiChangeRows({ rows: [null, 5, "x"] })).toEqual([]);
  });

  // F8: root is optional (back-compat with every call site above, none of which passes
  // one) but a caller that fetched a root-keyed key must be able to reject a stale-root
  // payload — the payload's own top-level `root`, AND each row's `root` where present
  // (the cross-root board's rows carry one; a per-root payload should not, but a badge
  // must never wear another ticker's structure — same law as optionsLevels' pickRootPayload).
  it("rejects a payload whose top-level root does not match, when a root is given", () => {
    const raw = { root: "QQQ", rows: [{ strike: 500, d_oi: 100 }] };
    expect(parseOiChangeRows(raw, "SPY")).toEqual([]);
    expect(parseOiChangeRows(raw, "QQQ")).toEqual([{ strike: 500, d_oi: 100 }]);
  });

  it("without a root argument, a mismatched top-level root is NOT checked (back-compat)", () => {
    const raw = { root: "QQQ", rows: [{ strike: 500, d_oi: 100 }] };
    expect(parseOiChangeRows(raw)).toEqual([{ strike: 500, d_oi: 100 }]);
  });

  it("drops individual rows carrying a foreign root, keeping same-root rows", () => {
    const raw = {
      root: "SPY",
      rows: [
        { root: "SPY", strike: 745, d_oi: 100 },
        { root: "NVDA", strike: 300, d_oi: 500 },
        { strike: 750, d_oi: 50 }, // no per-row root — not rejected on that basis
      ],
    };
    expect(parseOiChangeRows(raw, "SPY")).toEqual([
      { strike: 745, d_oi: 100 },
      { strike: 750, d_oi: 50 },
    ]);
  });

  it("root match is case-insensitive", () => {
    const raw = { root: "spy", rows: [{ strike: 745, d_oi: 100 }] };
    expect(parseOiChangeRows(raw, "SPY")).toEqual([{ strike: 745, d_oi: 100 }]);
  });
});

describe("topOiChangeStrikes", () => {
  it("ranks strikes by Σ|d_oi| across expiries/rights at that strike, top-N only", () => {
    const rows: OiChangeCell[] = [
      { strike: 700, d_oi: 12000 },
      { strike: 745, d_oi: -9000 },
      { strike: 745, d_oi: -500 }, // combines with the row above → 9500 at 745
      { strike: 760, d_oi: 18000 },
      { strike: 800, d_oi: 7000 },
      { strike: 810, d_oi: 5000 },
    ];
    const top = topOiChangeStrikes(rows, 3);
    expect([...top.keys()]).toEqual([760, 700, 745]);
    expect(top.get(745)).toBe(9500); // 9000 + 500 combined
    expect(top.size).toBe(3);
  });
  it("respects N=5 default and a custom n", () => {
    const rows: OiChangeCell[] = Array.from({ length: 10 }, (_, i) => ({ strike: i, d_oi: i + 1 }));
    expect(topOiChangeStrikes(rows).size).toBe(5);
    expect(topOiChangeStrikes(rows, 2).size).toBe(2);
    expect(topOiChangeStrikes(rows, 0).size).toBe(0);
  });
  it("returns an empty map for no rows, never fabricating a highlight", () => {
    expect(topOiChangeStrikes([]).size).toBe(0);
    expect(topOiChangeStrikes(null).size).toBe(0);
    expect(topOiChangeStrikes(undefined).size).toBe(0);
  });
  it("drops non-finite strike/d_oi rows before ranking", () => {
    const rows = [{ strike: NaN, d_oi: 999 }, { strike: 700, d_oi: 10 }] as OiChangeCell[];
    const top = topOiChangeStrikes(rows, 5);
    expect([...top.keys()]).toEqual([700]);
  });
});

// ── F1: archived-session overlay withdrawal policy ───────────────────────────
// SurfacePane has no jsdom/component test harness in this repo (vitest runs in the NODE
// environment — see surfaceTheme.test.ts), so the F1 regression guard targets the pure
// policy function the component actually reads to decide what to render/draw, rather
// than a rendered tree. The function takes ONLY `isArchived` (no payload), so a passing
// test here proves the withdrawal is a SESSION-STATE decision — not something that could
// flip back on merely because a gexstate:/oi_change: fetch happens to resolve with data
// (i.e. it asserts the withdrawal itself, not just an absence a missing fetch would also
// produce). Levels staying live (dated twin exists) is asserted in the SAME test so a
// future edit can't silently withdraw all three overlays together.
describe("archivedOverlayPolicy", () => {
  it("live session: nothing is withdrawn, Levels reads the live gex:/moves: pair", () => {
    expect(archivedOverlayPolicy(false)).toEqual({
      useDatedLevels: false,
      regimeWithdrawn: false,
      oiDeltaWithdrawn: false,
    });
  });

  it("archived session: regime + OI Δ withdrawn, Levels switches to the dated payload", () => {
    expect(archivedOverlayPolicy(true)).toEqual({
      useDatedLevels: true,
      regimeWithdrawn: true,
      oiDeltaWithdrawn: true,
    });
  });
});

// ── N1: price lines must be removed from the host they were drawn on ────────
// SurfacePane's Levels/OI-Δ overlay effects used to remove via "whichever host this
// cleanup run currently resolves to" — a real host object, but not necessarily the one a
// given line was CREATED on. Lightweight-Charts' removePriceLine() is a silent no-op for a
// line belonging to a different series (no throw), so a host flip between the draw run and
// the cleanup run (F4/R1: the candle series gaining/losing its first plotted bar) orphaned
// the old host's lines while new ones were drawn on the new host — every wall/flip/EM
// level doubled. removeHostedLines is the fix: it always reads the host stored ON the
// record, never a separately-passed "current" host.
describe("removeHostedLines", () => {
  it("dispatches each line's removal to its OWN stored host, not a shared/other host", () => {
    const removedA: unknown[] = [];
    const removedB: unknown[] = [];
    const hostA = { removePriceLine: (l: unknown) => removedA.push(l) };
    const hostB = { removePriceLine: (l: unknown) => removedB.push(l) };
    // Mixed set (some records on hostA, some on hostB, interleaved) proves per-record
    // dispatch rather than "everything goes wherever the loop happens to point" — the
    // exact shape of a real draw-run-A-then-B / cleanup-mixed scenario.
    const records: HostedLine[] = [
      { host: hostA, line: "call_wall" },
      { host: hostB, line: "put_wall" },
      { host: hostA, line: "gamma_flip" },
    ];
    removeHostedLines(records);
    expect(removedA).toEqual(["call_wall", "gamma_flip"]);
    expect(removedB).toEqual(["put_wall"]);
  });

  it("simulates the actual N1 scenario: a host flip between the draw run and the cleanup run still removes via the ORIGINAL host", () => {
    // Run 1 draws on the heat series (no candle bars drawn yet — hasDrawnBars=false).
    const heatSeries = { removePriceLine: (l: unknown) => heatRemoved.push(l), createPriceLine: (o: unknown) => o };
    const heatRemoved: unknown[] = [];
    const drawn: HostedLine[] = [
      { host: heatSeries, line: heatSeries.createPriceLine({ price: 100 }) },
      { host: heatSeries, line: heatSeries.createPriceLine({ price: 105 }) },
    ];
    // The candle series gains its first bar — hasDrawnBars flips true — run 2 resolves a
    // DIFFERENT current host (the candle series) and must clean up run 1's lines first,
    // BEFORE it ever draws anything on the candle series itself.
    const candleRemoved: unknown[] = [];
    removeHostedLines(drawn); // the cleanup step of run 2
    expect(heatRemoved.length).toBe(2); // removed from where they actually live
    expect(candleRemoved.length).toBe(0); // never touches the new (unrelated) host
  });

  it("a host whose removePriceLine throws (already torn down, e.g. chart remount) does not stop the rest from being removed", () => {
    const removed: unknown[] = [];
    const dead = { removePriceLine: () => { throw new Error("series removed"); } };
    const alive = { removePriceLine: (l: unknown) => removed.push(l) };
    expect(() => removeHostedLines([
      { host: dead, line: "a" },
      { host: alive, line: "b" },
    ])).not.toThrow();
    expect(removed).toEqual(["b"]);
  });

  it("empty input is a no-op", () => {
    expect(() => removeHostedLines([])).not.toThrow();
  });
});

// ── Greek metric enablement (feature-detection) ─────────────────────────────

describe("metricEnabled — feature-detect a metric grid on a frame", () => {
  const withGex: SurfaceFrame = {
    ...FRAME,
    grids: { netprem: FRAME.grids.netprem, gex: [[1, -1, 2], [0, 3, -4], [0, 0, 0], [1, 1, 1], [0, 0, 0]] },
  };
  it("enabled when the frame carries a non-empty grid for the key", () => {
    expect(metricEnabled(FRAME, "netprem")).toBe(true);
    expect(metricEnabled(withGex, "gex")).toBe(true);
  });
  it("DISABLED when the key is missing (the greek tab stays off until the snapshotter ships)", () => {
    expect(metricEnabled(FRAME, "gex")).toBe(false);
    expect(metricEnabled(FRAME, "vanna")).toBe(false);
    expect(metricEnabled(FRAME, "charm")).toBe(false);
  });
  it("disabled for a null/undefined frame or an empty grid", () => {
    expect(metricEnabled(null, "netprem")).toBe(false);
    expect(metricEnabled(undefined, "gex")).toBe(false);
    expect(metricEnabled({ ...FRAME, grids: { gex: [] } }, "gex")).toBe(false);
    expect(metricEnabled({ ...FRAME, grids: { gex: [[]] } }, "gex")).toBe(false);
  });
});

// ── Strike intraday-evolution series (drill modal) ──────────────────────────

describe("buildStrikeSeries — one strike's session series + replay truncation", () => {
  // FRAME grid[2] (level 100) = [0, 5, 10] over time_steps 09:31/09:41/09:51.
  it("full series when the replay stamp is at (or past) the head", () => {
    const s = buildStrikeSeries(FRAME, 2, "netprem", null);
    expect(s.strike).toBe(100);
    expect(s.points).toEqual([
      { t: "09:31", v: 0 },
      { t: "09:41", v: 5 },
      { t: "09:51", v: 10 },
    ]);
    expect(s.nowT).toBe("09:51");
    expect(s.nowValue).toBe(10);
    expect(s.total).toBe(3);
  });
  it("TRUNCATES to the scrubbed stamp (left of NOW = realized only)", () => {
    const s = buildStrikeSeries(FRAME, 2, "netprem", 1); // scrubbed to the 2nd column
    expect(s.points).toEqual([
      { t: "09:31", v: 0 },
      { t: "09:41", v: 5 },
    ]);
    expect(s.nowT).toBe("09:41"); // NOW marker follows the scrubber, not the head
    expect(s.nowValue).toBe(5);
    expect(s.total).toBe(3); // "N snapshots" reflects the FULL day, not the truncation
  });
  it("first stamp → single realized point", () => {
    const s = buildStrikeSeries(FRAME, 2, "netprem", 0);
    expect(s.points).toEqual([{ t: "09:31", v: 0 }]);
    expect(s.nowT).toBe("09:31");
  });
  it("an out-of-range index falls back to the full realized series", () => {
    expect(buildStrikeSeries(FRAME, 2, "netprem", 99).points).toHaveLength(3);
    expect(buildStrikeSeries(FRAME, 2, "netprem", -1).points).toHaveLength(3);
  });
  it("negative-strike row (level 110 = [0,0,-8]) keeps its sign", () => {
    const s = buildStrikeSeries(FRAME, 4, "netprem", null);
    expect(s.nowValue).toBe(-8);
  });
  it("empty (no points) for a missing metric grid or empty frame — never fabricated", () => {
    const g = buildStrikeSeries(FRAME, 2, "gex", null);
    expect(g.points).toEqual([]);
    expect(g.strike).toBe(100); // strike still resolved from price_levels
    expect(buildStrikeSeries(null, 0, "netprem", null).points).toEqual([]);
    expect(buildStrikeSeries({ ...FRAME, time_steps: [] }, 2, "netprem", null).points).toEqual([]);
  });
  it("retains null, non-finite, zero, and truncated columns with their original times", () => {
    const values = [null, NaN, 0] as unknown as number[];
    const full = { ...FRAME, grids: { netprem: [values] } };
    expect(buildStrikeSeries(full, 0, "netprem", null).points).toEqual([
      { t: "09:31", v: null }, { t: "09:41", v: null }, { t: "09:51", v: 0 },
    ]);
    const truncated = { ...FRAME, grids: { netprem: [[5]] } };
    expect(buildStrikeSeries(truncated, 0, "netprem", null)).toMatchObject({
      points: [{ t: "09:31", v: 5 }, { t: "09:41", v: null }, { t: "09:51", v: null }],
      nowT: "09:51", nowValue: null, total: 3,
    });
    expect(buildStrikeSeries(truncated, 0, "netprem", 1)).toMatchObject({ nowT: "09:41", nowValue: null });
  });
});

describe("Surface expiry context keeps the matrix root, session and publication clock", () => {
  const session = "2026-07-06";
  const frame = { ...FRAME, session_date: session, root: "SPY" };
  const cell = { strike: 100, expiry: "2026-07-17", gex: -300 };
  const matrix = {
    schema: "options_structure.matrix/v1", root: "SPY", session,
    asof: "2026-07-06T09:50:00-04:00", cells: [cell],
  };
  function qualified(raw: unknown, target = frame, archived = false) {
    return matrixForSurfaceObservation(readSurfaceExpiryMatrix(raw, "SPY"), "SPY", target, archived);
  }

  it("preserves signed and measured-zero cells without fabricating invalid dollar amounts", () => {
    const cells = [cell, { ...cell, expiry: "2026-07-24", gex: 0 },
      { ...cell, expiry: "2026-07-31", gex: null }, { ...cell, expiry: "2026-08-07", gex: "" }];
    expect(qualified({ ...matrix, session: undefined, _build_meta: { asof_date: session }, cells })).toBeNull();
    const { session: omitted, ...withoutSession } = matrix;
    expect(qualified({ ...withoutSession, _build_meta: { asof_date: session }, cells })?.cells).toEqual(cells.slice(0, 2));
    expect(qualified(matrix)?.session).toBe(session);
  });

  it("refuses missing or conflicting dates, wrong root, duplicates and unknown build instants", () => {
    for (const raw of [
      { ...matrix, session: null }, { ...matrix, session: "2026-02-30" },
      { ...matrix, _build_meta: { asof_date: "2026-07-07" } }, { ...matrix, root: "QQQ" },
      { ...matrix, cells: [cell, cell] }, { ...matrix, asof: "2026-07-06" },
      { ...matrix, asof: "2026-07-06T09:50:00" }, { ...matrix, asof: "2026-02-30T12:00:00Z" },
    ]) expect(qualified(raw)).toBeNull();
    expect(matrixForSurfaceObservation(readSurfaceExpiryMatrix(matrix, "SPY"), "QQQ", frame, false)).toBeNull();
  });

  it("withholds an archive, a different source session, or a build later than the held observation", () => {
    expect(qualified(matrix, frame, true)).toBeNull();
    expect(qualified(matrix, { ...frame, session_date: "2026-07-07" })).toBeNull();
    expect(qualified({ ...matrix, asof: "2026-07-06T13:51:01Z" })).toBeNull();
    const rebuilt = { ...frame, asof: "2026-07-07T00:30:00Z" };
    expect(qualified({ ...matrix, asof: "2026-07-06T19:30:00Z" }, rebuilt)).toBeNull();
    expect(qualified({ ...matrix, asof: "2026-07-05T19:00:00Z" })).toBeNull();
    expect(qualified(matrix, { ...frame, asof: "09:51" })).toBeNull();
  });
});

// ─── B4: the expiry breakdown must not caption present-time shares "at NOW" ──
// The matrix is fetched once per root (no stamp in the key), so it always describes the
// present. Scrubbed back, there is nothing stamp-consistent to show — so the panel has to
// withdraw and say so rather than quietly relabelling today's split as a past moment's.
describe("expiryPanelState — point-in-time gate for the drill modal (B4)", () => {
  it("omits the section entirely when the matrix has no cells for this strike", () => {
    expect(expiryPanelState(0, true)).toBe("none");
    expect(expiryPanelState(0, false)).toBe("none");
  });

  it("shows the bars only at the head of the replay", () => {
    expect(expiryPanelState(3, true)).toBe("live");
  });

  it("withdraws the bars the moment the user scrubs back", () => {
    expect(expiryPanelState(3, false)).toBe("stale");
    expect(expiryPanelState(1, false)).toBe("stale");
  });

  it("never returns `live` while replayed, for any cell count", () => {
    for (const n of [1, 2, 5, 50]) expect(expiryPanelState(n, false)).not.toBe("live");
  });

  it("treats a negative/garbage count as nothing to show", () => {
    expect(expiryPanelState(-1, true)).toBe("none");
  });
});

// ─── Sessions index + replay truncation (OEU T-B) ───────────────────────────

describe("isSessionDate", () => {
  it("accepts exactly YYYY-MM-DD", () => {
    expect(isSessionDate("2026-07-02")).toBe(true);
  });
  it("rejects anything else", () => {
    expect(isSessionDate("2026-7-2")).toBe(false);
    expect(isSessionDate("2026-07-02T10:00:00Z")).toBe(false);
    expect(isSessionDate("")).toBe(false);
    expect(isSessionDate(20260702)).toBe(false);
    expect(isSessionDate(null)).toBe(false);
  });
});

describe("isSurfaceDates", () => {
  const ok = {
    root: "SPY",
    dates: ["2026-07-06", "2026-07-02", "2026-07-01"],
    latest: "2026-07-06",
    cadenceSec: 300,
  };

  it("accepts a well-formed sessions index", () => {
    expect(isSurfaceDates(ok)).toBe(true);
  });

  it("accepts an empty index with a null latest (no sessions retained yet)", () => {
    expect(isSurfaceDates({ root: "SPY", dates: [], latest: null, cadenceSec: 300 })).toBe(true);
  });

  // Each of these must FAIL rather than be coerced: the picker is gated on this validator, and
  // a payload we half-trust would offer the user a session that isn't really there.
  it("rejects an oldest-first list", () => {
    expect(isSurfaceDates({ ...ok, dates: [...ok.dates].reverse(), latest: "2026-07-01" })).toBe(false);
  });
  it("rejects a latest that isn't dates[0]", () => {
    expect(isSurfaceDates({ ...ok, latest: "2026-07-01" })).toBe(false);
  });
  it("rejects a non-null latest on an empty list", () => {
    expect(isSurfaceDates({ ...ok, dates: [], latest: "2026-07-06" })).toBe(false);
  });
  it("rejects a non-date entry", () => {
    expect(isSurfaceDates({ ...ok, dates: ["2026-07-06", "yesterday"], latest: "2026-07-06" })).toBe(false);
  });
  it("rejects a missing / mistyped cadence or root", () => {
    expect(isSurfaceDates({ ...ok, cadenceSec: "300" })).toBe(false);
    expect(isSurfaceDates({ ...ok, root: undefined })).toBe(false);
  });
  it("rejects non-objects and a bare list", () => {
    expect(isSurfaceDates(null)).toBe(false);
    expect(isSurfaceDates(ok.dates)).toBe(false);
    expect(isSurfaceDates("2026-07-06")).toBe(false);
  });
});

describe("truncateSessionAt", () => {
  const series: SessionPoint[] = [
    { t: "09:31", call: 10, put: -5 },
    { t: "10:00", call: 25, put: -9 },
    { t: "12:30", call: 40, put: -20 },
    { t: "15:56", call: 60, put: -31 },
  ];

  it("cuts at the stamp, inclusive", () => {
    expect(truncateSessionAt(series, "1230").map((p) => p.t)).toEqual(["09:31", "10:00", "12:30"]);
  });

  it("a stamp between points keeps only what had happened", () => {
    expect(truncateSessionAt(series, "1100").map((p) => p.t)).toEqual(["09:31", "10:00"]);
  });

  it("the head stamp is a no-op", () => {
    expect(truncateSessionAt(series, "1556")).toEqual(series);
  });

  it("a stamp before the first point empties the series (nothing had accrued)", () => {
    expect(truncateSessionAt(series, "0900")).toEqual([]);
  });

  it("a null or malformed stamp leaves the series untouched — never blanks a chart", () => {
    expect(truncateSessionAt(series, null)).toEqual(series);
    expect(truncateSessionAt(series, "")).toEqual(series);
    expect(truncateSessionAt(series, "12:30")).toEqual(series);
    expect(truncateSessionAt(series, "abc")).toEqual(series);
  });

  it("keeps points whose own time is unparseable rather than dropping feed data", () => {
    const messy: SessionPoint[] = [{ t: "??", call: 1, put: -1 }, ...series];
    expect(truncateSessionAt(messy, "1000").map((p) => p.t)).toEqual(["??", "09:31", "10:00"]);
  });

  it("truncation composes: totals and rebasing describe the replayed moment", () => {
    const cut = truncateSessionAt(series, "1000");
    // The pane's running totals read the LAST cumulative point.
    expect(cut[cut.length - 1]).toEqual({ t: "10:00", call: 25, put: -9 });
    // Off-open rebasing is relative to the cut series' own open, not the full day's.
    const rebased = composeSessionSeries(cut, { mode: "cumulative", offOpen: true, absolute: false });
    expect(rebased[0]).toEqual({ t: "09:31", call: 0, put: 0 });
    expect(rebased[rebased.length - 1]).toEqual({ t: "10:00", call: 15, put: -4 });
  });

  it("an empty series stays empty", () => {
    expect(truncateSessionAt([], "1200")).toEqual([]);
  });
});
