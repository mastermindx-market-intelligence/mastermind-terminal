/**
 * sectorDepthCalls.test.ts — contract tests for the native calls board reader
 * and the display-only Bottoming Watch model.
 *
 * Two fixtures, two jobs:
 *  - `sector_generation.captured.preview.v1.json` is a REAL captured owner
 *    generation (donor PR #1339): its action_board pins the incumbent
 *    semantics — hold+avoid fold, full-lane totals, locked rows withheld,
 *    hrefs carried verbatim.
 *  - `sectorDepthCallsContract.v1.json` is clearly SYNTHETIC (its top-level
 *    `note` says so): it exercises the paths the capture does not carry —
 *    buy_soon `days` ordering, preview slicing past three rows, the watch
 *    strip's pos-ASC cap-at-8, and the payload-only fields that must never
 *    reach a rendered model output.
 *
 * Pure Node vitest — no DOM, no React: everything here is the props-in/model
 * seam the components render.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BOARD_LANE_ORDER,
  BOTTOMING_CAP,
  NO_GRADE,
  PREVIEW_ROWS,
  boardTotals,
  foldSixToFive,
  hasRecovering,
  isBottomingWatchUnavailable,
  isCallsBoardUnavailable,
  laneRowsSorted,
  previewSlice,
  traceModel,
  watchModel,
  type ActionBoardData,
  type WatchEntry,
} from "../sectorDepthCalls";

const fixturesDir = fileURLToPath(new URL("./fixtures/", import.meta.url));

const capturedDoc = JSON.parse(
  readFileSync(join(fixturesDir, "sector_generation.captured.preview.v1.json"), "utf8"),
) as { projection: { data: { action_board: ActionBoardData } } };
const capturedBoard = capturedDoc.projection.data.action_board;

const contract = JSON.parse(
  readFileSync(join(fixturesDir, "sectorDepthCallsContract.v1.json"), "utf8"),
) as {
  note: string;
  action_board: ActionBoardData;
  bottoming_watch: WatchEntry[];
};

describe("captured generation — the real action_board", () => {
  it("carries the real qualified totals: 4 rows, 1 locked, as of 2026-11-03", () => {
    expect(capturedBoard.total).toBe(4);
    expect(capturedBoard.locked).toBe(1);
    expect(capturedBoard.as_of).toBe("2026-11-03");
  });

  it("holds its three visible rows in the hold lane (total 4, locked 1, all themes)", () => {
    const hold = capturedBoard.lanes.hold;
    expect(hold.rows).toHaveLength(3);
    expect(hold.total).toBe(4);
    expect(hold.locked).toBe(1);
    expect(hold.rows.every((row) => row.kind === "theme")).toBe(true);
  });

  it("preserves the captured hrefs verbatim through the fold and the sort", () => {
    const folded = foldSixToFive(capturedBoard.lanes);
    const sourceHrefs = capturedBoard.lanes.hold.rows.map((row) => row.href);
    // The exact strings the owner generation carries — no rewriting, no prefixing.
    expect(sourceHrefs).toEqual([
      "basket/test_theme.html",
      "basket/theme_1.html",
      "basket/theme_2.html",
    ]);
    expect(laneRowsSorted("stand_aside", folded.stand_aside.rows).map((row) => row.href)).toEqual(
      sourceHrefs,
    );
  });

  it("folds six lanes to five: hold + avoid merge into stand_aside, others pass through", () => {
    const folded = foldSixToFive(capturedBoard.lanes);
    expect(BOARD_LANE_ORDER).toEqual([
      "buy_now",
      "buy_soon",
      "on_the_run",
      "take_profits",
      "stand_aside",
    ]);
    // Stand aside: hold rows first, then avoid rows; totals and locked add.
    expect(folded.stand_aside.rows).toEqual(capturedBoard.lanes.hold.rows);
    expect(folded.stand_aside.total).toBe(
      capturedBoard.lanes.hold.total + capturedBoard.lanes.avoid.total,
    );
    expect(folded.stand_aside.total).toBe(4);
    expect(folded.stand_aside.locked).toBe(1);
    // The other four lanes pass through unchanged — the very same objects.
    expect(folded.buy_now).toBe(capturedBoard.lanes.buy_now);
    expect(folded.buy_soon).toBe(capturedBoard.lanes.buy_soon);
    expect(folded.on_the_run).toBe(capturedBoard.lanes.on_the_run);
    expect(folded.take_profits).toBe(capturedBoard.lanes.take_profits);
  });

  it("reports the buy_now column as a measured empty (total 0, rows 0)", () => {
    const folded = foldSixToFive(capturedBoard.lanes);
    expect(folded.buy_now.total).toBe(0);
    expect(folded.buy_now.rows).toHaveLength(0);
    expect(laneRowsSorted("buy_now", folded.buy_now.rows)).toEqual([]);
  });

  it("carries heading totals from the board and FULL lane totals per column", () => {
    const totals = boardTotals(capturedBoard);
    expect(totals.total).toBe(4);
    expect(totals.locked).toBe(1);
    expect(totals.columns.stand_aside.total).toBe(4);
    expect(totals.columns.stand_aside.locked).toBe(1);
    expect(totals.columns.buy_now.total).toBe(0);
  });

  it("normalizes a captured row's trace, with null signal grade as an em dash", () => {
    const first = capturedBoard.lanes.hold.rows[0]!;
    const trace = traceModel(first);
    expect(trace.signalGrade).toBe(NO_GRADE);
    expect(trace.signalGrade).toBe("—");
    expect(trace.score).toBe(67);
    expect(trace.rolloverBand).toBe("low");
    expect(trace.rolloverBandZh).toBe("低");
    expect(trace.perf20dRel).toBeCloseTo(0.0389, 10);
    expect(trace.flipDistance).toBeCloseTo(3.89, 10);
    expect(trace.topMembers).toEqual(["T0000", "T0001", "T0002"]);
    expect(trace.bookWt).toBe(0.25);
    // The second captured row carries no book weight — null stays null.
    expect(traceModel(capturedBoard.lanes.hold.rows[1]!).bookWt).toBeNull();
  });
});

describe("synthetic contract fixture — buy_soon days ordering", () => {
  it("is clearly labeled synthetic, never a real generation", () => {
    expect(contract.note).toBe(
      "synthetic contract-shape fixture for tests; not a real generation",
    );
  });

  it("sorts buy_soon themes by days ascending with null days last, sectors after themes", () => {
    const sorted = laneRowsSorted("buy_soon", contract.action_board.lanes.buy_soon.rows);
    // Source order was: theme(5), theme(2), sector(1), theme(9), theme(null).
    // Themes first (days 2, 5, 9, null→99 last), then the sector — even though
    // the sector's days (1) would win a global days sort, themes lead the lane.
    expect(sorted.map((row) => row.ticker)).toEqual([
      "SYN_SOON_A",
      "SYN_SOON_B",
      "SYN_SOON_C",
      "SYN_SOON_N",
      "SYN_SOON_S",
    ]);
    expect(sorted.map((row) => row.days ?? null)).toEqual([2, 5, 9, null, 1]);
  });
});

describe("synthetic contract fixture — themes before sectors, stable", () => {
  it("promotes a theme above a sector that preceded it in source order", () => {
    const lane = contract.action_board.lanes.buy_now;
    expect(lane.rows.map((row) => row.kind)).toEqual(["sector", "theme"]);
    const sorted = laneRowsSorted("buy_now", lane.rows);
    expect(sorted.map((row) => row.ticker)).toEqual(["SYN_T1", "SYN_S1"]);
  });

  it("keeps source order stable within each kind", () => {
    const sorted = laneRowsSorted("take_profits", contract.action_board.lanes.take_profits.rows);
    expect(sorted.map((row) => row.ticker)).toEqual([
      "SYN_TP_T1",
      "SYN_TP_T2",
      "SYN_TP_T3",
      "SYN_TP_T4",
      "SYN_TP_S1",
    ]);
  });

  it("appends avoid rows after hold rows in the folded stand_aside column", () => {
    const folded = foldSixToFive(contract.action_board.lanes);
    expect(folded.stand_aside.rows.map((row) => row.ticker)).toEqual([
      "SYN_HOLD_T1",
      "SYN_AVOID_S1",
    ]);
    expect(folded.stand_aside.total).toBe(2);
  });
});

describe("preview slice and withheld counts", () => {
  it("exposes PREVIEW_ROWS = 3 and BOTTOMING_CAP = 8", () => {
    expect(PREVIEW_ROWS).toBe(3);
    expect(BOTTOMING_CAP).toBe(8);
  });

  it("shows the first 3 rows collapsed with the hidden count, all rows expanded", () => {
    const rows = laneRowsSorted("take_profits", contract.action_board.lanes.take_profits.rows);
    expect(rows).toHaveLength(5);
    const collapsed = previewSlice(rows, false);
    expect(collapsed.shown).toHaveLength(3);
    expect(collapsed.shown.map((row) => row.ticker)).toEqual([
      "SYN_TP_T1",
      "SYN_TP_T2",
      "SYN_TP_T3",
    ]);
    expect(collapsed.hidden).toBe(2); // "Show more (2)"
    const expanded = previewSlice(rows, true);
    expect(expanded.shown).toHaveLength(5);
    expect(expanded.hidden).toBe(0); // "Show less"
  });

  it("drives the withheld line from the lane's locked count, not rows.length", () => {
    const lane = contract.action_board.lanes.take_profits;
    expect(lane.locked).toBe(2);
    expect(lane.total).toBe(7);
    expect(lane.rows).toHaveLength(5); // 7 qualified − 2 locked = 5 visible
    expect(lane.total - lane.rows.length).toBe(lane.locked);
  });
});

describe("Bottoming Watch model (display-only)", () => {
  it("sorts pos ASC and caps at 8 of 10 entries", () => {
    const model = watchModel(contract.bottoming_watch);
    expect(contract.bottoming_watch).toHaveLength(10);
    expect(model).toHaveLength(8);
    expect(model.map((entry) => entry.pos)).toEqual([5, 14, 20, 31, 47, 55, 62, 73]);
    // The two deepest-in-cycle entries past the cap are dropped, not merged in.
    expect(model.map((entry) => entry.ticker)).not.toContain("SYN_W3"); // pos 88
    expect(model.map((entry) => entry.ticker)).not.toContain("SYN_W9"); // pos 96
  });

  it("builds the chip set: cycle-turn base, dual-read, recovering, 200-day", () => {
    const model = watchModel(contract.bottoming_watch);
    for (const entry of model) {
      expect(entry.chips[0]).toBe("cycle_turn");
      const day200 = entry.chips.filter((c) => c === "above_200d" || c === "below_200d");
      expect(day200).toHaveLength(1);
    }
    const deepest = model[0]!; // SYN_W5: pos 5, dual read, recovering, below 200d
    expect(deepest.ticker).toBe("SYN_W5");
    expect(deepest.chips).toEqual(["cycle_turn", "dual_read", "recovering", "below_200d"]);
    const second = model[1]!; // SYN_W2: pos 14, above 200d, no extras
    expect(second.ticker).toBe("SYN_W2");
    expect(second.chips).toEqual(["cycle_turn", "above_200d"]);
  });

  it("never surfaces the payload-only signal/timing_state fields", () => {
    const model = watchModel(contract.bottoming_watch);
    const json = JSON.stringify(model);
    expect(json).not.toContain("PAYLOAD-SIGNAL");
    expect(json).not.toContain("PAYLOAD-TIMING");
    const assertNoPayloadKeys = (node: unknown): void => {
      if (Array.isArray(node)) {
        for (const child of node) assertNoPayloadKeys(child);
        return;
      }
      if (node && typeof node === "object") {
        for (const [key, value] of Object.entries(node)) {
          expect(key).not.toBe("signal");
          expect(key).not.toBe("timing_state");
          assertNoPayloadKeys(value);
        }
      }
    };
    assertNoPayloadKeys(model);
  });

  it("flags the recovering disclosure from VISIBLE entries only", () => {
    // Synthetic fixture: recovering on pos 5 and 20 (both visible) and pos 88 (capped out).
    expect(hasRecovering(contract.bottoming_watch)).toBe(true);
    const cappedOutOnly = [
      ...Array.from({ length: 8 }, (_, i) => ({
        ticker: `F${i}`,
        name: `Full ${i}`,
        name_zh: `满 ${i}`,
        pos: i + 1,
        above_200d: true,
        dual_read: false,
        recovering: false,
      })),
      { ticker: "F9", name: "Full 9", name_zh: "满 9", pos: 90, above_200d: true, dual_read: false, recovering: true },
    ];
    expect(cappedOutOnly).toHaveLength(9);
    expect(hasRecovering(cappedOutOnly)).toBe(false);
  });
});

describe("zero is measured, missing is missing", () => {
  it("treats a zero-total lane as a measured empty, never as unavailable", () => {
    const lane = contract.action_board.lanes.on_the_run;
    expect(lane.total).toBe(0);
    expect(lane.rows).toHaveLength(0);
    expect(laneRowsSorted("on_the_run", lane.rows)).toEqual([]);
    expect(isCallsBoardUnavailable(contract.action_board)).toBe(false);
  });

  it("treats an empty watch array as a measured empty", () => {
    expect(watchModel([])).toEqual([]);
    expect(isBottomingWatchUnavailable([])).toBe(false);
  });

  it("reserves the unavailable path for null input only", () => {
    expect(isCallsBoardUnavailable(null)).toBe(true);
    expect(isCallsBoardUnavailable(undefined)).toBe(true);
    expect(isBottomingWatchUnavailable(null)).toBe(true);
    expect(isBottomingWatchUnavailable(undefined)).toBe(true);
  });
});
