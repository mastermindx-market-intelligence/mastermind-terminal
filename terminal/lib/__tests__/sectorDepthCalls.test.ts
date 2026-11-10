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
 *    buy_soon `days` ordering, the preview budget's hold-first/avoid-remainder
 *    arithmetic (split_actnow), the at-cap ships-whole case, sector stat
 *    rows, the watch payload's id-membership sets, and the payload-only
 *    fields that must never reach a rendered model output.
 *
 * Pure Node vitest — no DOM, no jsdom: everything here is the props-in/model
 * seam the components render, plus the S2 closed-shape boundary verified with
 * renderToStaticMarkup (server render, no DOM needed).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SectorCallsBoard } from "../../components/sector-intelligence/depth/SectorCallsBoard";
import { SectorBottomingWatch } from "../../components/sector-intelligence/depth/SectorBottomingWatch";
import {
  BOARD_LANE_ORDER,
  BOTTOMING_CAP,
  NO_GRADE,
  PREVIEW_ROWS,
  actionBoardFromCarried,
  boardTotals,
  bottomingWatchFromCarried,
  columnPreview,
  foldSixToFive,
  hasRecovering,
  isBottomingWatchUnavailable,
  isCallsBoardUnavailable,
  laneMeasuredEmpty,
  laneRowsSorted,
  previewSlice,
  sectorStat,
  standAsideGroups,
  standAsidePreview,
  traceModel,
  watchDisclosure,
  watchModel,
  type ActionBoardData,
  type BottomingWatchData,
  type CallRow,
  type LaneData,
  type SourceLaneKey,
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
  bottoming_watch_payload: BottomingWatchData;
};

/** Minimal synthetic row factory for inline arithmetic cases. */
const row = (over: Partial<CallRow>): CallRow => ({
  kind: "theme",
  ticker: "R",
  slug: "r",
  name: "Row",
  name_zh: "行",
  reco: "hold",
  label: "HOLD",
  label_zh: "持有",
  score: 50,
  alloc_rank: 1,
  above_trend: true,
  eligible: true,
  durability: 1.0,
  book_wt: null,
  validated: false,
  signal_grade: null,
  clean_entry: false,
  clean_quality: 0.5,
  perf_20d_rel: 0.01,
  breadth_pct50: 1.0,
  top_members: ["M1"],
  rollover_band: "low",
  rollover_band_zh: "低",
  reco_why_en: "why",
  reco_why_zh: "理由",
  rs_pctile: 0.5,
  flip_distance: 1.0,
  href: "basket/r.html",
  ...over,
});

const lane = (rows: CallRow[], total: number, locked = 0): LaneData => ({ rows, total, locked });

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
    expect(hold.rows.every((r) => r.kind === "theme")).toBe(true);
  });

  it("preserves the captured hrefs verbatim through the fold and the sort", () => {
    const folded = foldSixToFive(capturedBoard.lanes);
    const sourceHrefs = capturedBoard.lanes.hold.rows.map((r) => r.href);
    // The exact strings the owner generation carries — no rewriting, no prefixing.
    expect(sourceHrefs).toEqual([
      "basket/test_theme.html",
      "basket/theme_1.html",
      "basket/theme_2.html",
    ]);
    expect(laneRowsSorted("stand_aside", folded.stand_aside.rows).map((r) => r.href)).toEqual(
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
    expect(laneMeasuredEmpty(folded.buy_now)).toBe(true);
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

  it("ships the captured board's visible rows whole: every lane is at or under the cap", () => {
    // 3 visible hold rows, 0 everywhere else — nothing hides behind Show more,
    // and the only withheld line input is the upstream locked count (1).
    const folded = foldSixToFive(capturedBoard.lanes);
    for (const key of BOARD_LANE_ORDER) {
      const col = columnPreview(key, folded[key].rows, false);
      expect(col.hidden).toBe(0);
    }
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
    expect(sorted.map((r) => r.ticker)).toEqual([
      "SYN_SOON_A",
      "SYN_SOON_B",
      "SYN_SOON_C",
      "SYN_SOON_N",
      "SYN_SOON_S",
    ]);
    expect(sorted.map((r) => r.days ?? null)).toEqual([2, 5, 9, null, 1]);
  });
});

describe("synthetic contract fixture — themes before sectors, stable", () => {
  it("promotes a theme above a sector that preceded it in source order", () => {
    const l = contract.action_board.lanes.buy_now;
    expect(l.rows.map((r) => r.kind)).toEqual(["sector", "theme"]);
    const sorted = laneRowsSorted("buy_now", l.rows);
    expect(sorted.map((r) => r.ticker)).toEqual(["SYN_T1", "SYN_S1"]);
  });

  it("keeps source order stable within each kind", () => {
    const sorted = laneRowsSorted("take_profits", contract.action_board.lanes.take_profits.rows);
    expect(sorted.map((r) => r.ticker)).toEqual([
      "SYN_TP_T1",
      "SYN_TP_T2",
      "SYN_TP_T3",
      "SYN_TP_T4",
      "SYN_TP_S1",
    ]);
  });

  it("appends avoid rows after hold rows in the folded stand_aside column", () => {
    const folded = foldSixToFive(contract.action_board.lanes);
    expect(folded.stand_aside.rows.map((r) => r.ticker)).toEqual([
      "SYN_HOLD_T1",
      "SYN_HOLD_T2",
      "SYN_HOLD_T3",
      "SYN_AVOID_S1",
      "SYN_AVOID_S2",
    ]);
    expect(folded.stand_aside.total).toBe(5);
  });
});

describe("preview budget — split_actnow arithmetic (fold first, one budget per column)", () => {
  it("spends the stand-aside budget on hold first; avoid takes the remainder", () => {
    const folded = foldSixToFive(contract.action_board.lanes);
    // Fixture: hold 3 rows, avoid 2 rows → hold spends all 3, avoid gets 3-3=0.
    const collapsed = columnPreview("stand_aside", folded.stand_aside.rows, false);
    expect(collapsed.shown.map((r) => r.ticker)).toEqual([
      "SYN_HOLD_T1",
      "SYN_HOLD_T2",
      "SYN_HOLD_T3",
    ]);
    expect(collapsed.hidden).toBe(2); // both avoid rows
    const expanded = columnPreview("stand_aside", folded.stand_aside.rows, true);
    expect(expanded.shown).toHaveLength(5);
    expect(expanded.hidden).toBe(0);
  });

  it("gives avoid the remainder when hold under-spends the budget", () => {
    // hold 1 row + avoid 3 rows: hold shows 1, avoid takes 3-1=2, one hides.
    const hold = lane([row({ ticker: "H1", kind: "sector" })], 1);
    const avoid = lane(
      [
        row({ ticker: "A1", kind: "theme" }),
        row({ ticker: "A2", kind: "theme" }),
        row({ ticker: "A3", kind: "theme" }),
      ],
      3,
    );
    const folded = foldSixToFive(makeLanes({ hold, avoid }));
    const collapsed = columnPreview("stand_aside", folded.stand_aside.rows, false);
    // Budget ships hold's sector plus the first two avoid themes (source
    // order); the display sort then leads with the themes that shipped. A
    // sort-then-slice would have shipped A1/A2/A3 and dropped the hold sector.
    expect(collapsed.shown.map((r) => r.ticker)).toEqual(["A1", "A2", "H1"]);
    expect(collapsed.hidden).toBe(1);
  });

  it("sorts only what shipped — a hold sector ships even when avoid themes would win the sort", () => {
    const hold = lane([row({ ticker: "H_SEC", kind: "sector" })], 1);
    const avoid = lane(
      [row({ ticker: "A_T1", kind: "theme" }), row({ ticker: "A_T2", kind: "theme" })],
      2,
    );
    const folded = foldSixToFive(makeLanes({ hold, avoid }));
    const collapsed = columnPreview("stand_aside", folded.stand_aside.rows, false);
    // Budget: hold 1 + avoid remainder 2 → all 3 ship, sorted themes-first.
    expect(collapsed.shown.map((r) => r.ticker)).toEqual(["A_T1", "A_T2", "H_SEC"]);
    expect(collapsed.hidden).toBe(0);
  });

  it("ships a board at or under the cap whole — no hidden rows in any column", () => {
    const atCap: Record<SourceLaneKey, LaneData> = makeLanes({
      buy_now: lane([row({ ticker: "B1" }), row({ ticker: "B2" })], 2),
      buy_soon: lane([row({ ticker: "S1", days: 2 }), row({ ticker: "S2", days: 4 }), row({ ticker: "S3", days: 6 })], 3),
      hold: lane([row({ ticker: "H1" })], 1),
    });
    const folded = foldSixToFive(atCap);
    for (const key of BOARD_LANE_ORDER) {
      const col = columnPreview(key, folded[key].rows, false);
      expect(col.hidden).toBe(0);
      expect(col.shown).toHaveLength(folded[key].rows.length);
    }
    // And nothing is withheld upstream anywhere: no withheld line input.
    expect(Object.values(folded).every((l) => l.locked === 0)).toBe(true);
  });

  it("exposes PREVIEW_ROWS = 3 and BOTTOMING_CAP = 8", () => {
    expect(PREVIEW_ROWS).toBe(3);
    expect(BOTTOMING_CAP).toBe(8);
  });

  it("keeps the plain previewSlice primitive for direct callers", () => {
    const rows = [row({ ticker: "R1" }), row({ ticker: "R2" }), row({ ticker: "R3" }), row({ ticker: "R4" })];
    const collapsed = previewSlice(rows, false);
    expect(collapsed.shown).toHaveLength(3);
    expect(collapsed.hidden).toBe(1);
    const expanded = previewSlice(rows, true);
    expect(expanded.shown).toHaveLength(4);
    expect(expanded.hidden).toBe(0);
  });
});

describe("lane headings read FULL totals — withheld, never empty copy", () => {
  it("treats a lane with total > 0 and nothing visible as withheld, not empty", () => {
    const allLocked = lane([], 2, 2); // 2 qualified rows, both withheld upstream
    expect(laneMeasuredEmpty(allLocked)).toBe(false);
    expect(allLocked.locked).toBe(2); // the withheld line's count
    const folded = foldSixToFive(makeLanes({ hold: allLocked }));
    expect(folded.stand_aside.total).toBe(2);
    expect(folded.stand_aside.rows).toHaveLength(0);
    expect(laneMeasuredEmpty(folded.stand_aside)).toBe(false);
  });

  it("reserves measured-empty for a FULL total of zero", () => {
    expect(laneMeasuredEmpty(lane([], 0, 0))).toBe(true);
    expect(laneMeasuredEmpty(contract.action_board.lanes.on_the_run)).toBe(true);
  });

  it("drives the withheld line from the lane's locked count, not rows.length", () => {
    const l = contract.action_board.lanes.take_profits;
    expect(l.locked).toBe(2);
    expect(l.total).toBe(7);
    expect(l.rows).toHaveLength(5); // 7 qualified − 2 locked = 5 visible
    expect(l.total - l.rows.length).toBe(l.locked);
  });

  it("previews take_profits at 3 rows with the sector display-sorted last", () => {
    const rows = contract.action_board.lanes.take_profits.rows;
    const collapsed = columnPreview("take_profits", rows, false);
    expect(collapsed.shown.map((r) => r.ticker)).toEqual([
      "SYN_TP_T1",
      "SYN_TP_T2",
      "SYN_TP_T3",
    ]);
    expect(collapsed.hidden).toBe(2); // "Show more (2)"
    const expanded = columnPreview("take_profits", rows, true);
    expect(expanded.shown.map((r) => r.ticker)).toEqual([
      "SYN_TP_T1",
      "SYN_TP_T2",
      "SYN_TP_T3",
      "SYN_TP_T4",
      "SYN_TP_S1",
    ]);
    expect(expanded.hidden).toBe(0); // "Show less"
  });
});

describe("row content law — themes score+perf, sectors the owner stat only", () => {
  it("returns the localized stat sentence for a sector row that carries one", () => {
    const sectorWithStat = contract.action_board.lanes.buy_now.rows.find(
      (r) => r.ticker === "SYN_S1",
    )!;
    expect(sectorWithStat.kind).toBe("sector");
    expect(sectorStat(sectorWithStat, "en")).toBe(
      "Synthetic sector stat — breadth improving three sessions running.",
    );
    expect(sectorStat(sectorWithStat, "zh")).toBe(
      "合成板块统计——广度连续三个交易日改善。",
    );
  });

  it("returns null for a sector row without stats — no stat line, no score", () => {
    const sectorNoStat = contract.action_board.lanes.take_profits.rows.find(
      (r) => r.ticker === "SYN_TP_S1",
    )!;
    expect(sectorNoStat.kind).toBe("sector");
    expect(sectorNoStat.stat_en).toBeUndefined();
    expect(sectorStat(sectorNoStat, "en")).toBeNull();
    expect(sectorStat(sectorNoStat, "zh")).toBeNull();
  });

  it("never offers a stat face to a theme row", () => {
    const theme = contract.action_board.lanes.buy_now.rows.find((r) => r.ticker === "SYN_T1")!;
    expect(theme.kind).toBe("theme");
    expect(sectorStat(theme, "en")).toBeNull();
    expect(sectorStat(theme, "zh")).toBeNull();
  });
});

describe("Bottoming Watch model — theme_intel.act_now contract", () => {
  const payload = contract.bottoming_watch_payload;

  it("sorts pos ASC; the cap is a display budget, not a truncation (v1.1)", () => {
    const model = watchModel(payload);
    expect(payload.bottoming_watch).toHaveLength(10);
    expect(model).toHaveLength(8);
    expect(model.map((e) => e.pos)).toEqual([5, 14, 20, 31, 47, 55, 62, 73]);
    // The two deepest-in-cycle entries past the budget are HIDDEN behind the
    // continuation control, not dropped.
    expect(model.map((e) => e.id)).not.toContain("syn_w3"); // pos 88
    expect(model.map((e) => e.id)).not.toContain("syn_w9"); // pos 96
    // v1.1 full-population continuation: expanded returns the WHOLE population
    // in the same pos-ASC order — every entry stays reachable.
    const expandedModel = watchModel(payload, true);
    expect(expandedModel).toHaveLength(10);
    expect(expandedModel.map((e) => e.id)).toContain("syn_w3");
    expect(expandedModel.map((e) => e.id)).toContain("syn_w9");
    expect(expandedModel.map((e) => e.pos)).toEqual([5, 14, 20, 31, 47, 55, 62, 73, 88, 96]);
  });

  it("derives dual-read and recovering chips from the id membership sets", () => {
    const model = watchModel(payload);
    for (const entry of model) {
      expect(entry.chips[0]).toBe("cycle_turn");
      const day200 = entry.chips.filter((c) => c === "above_200d" || c === "below_200d");
      expect(day200).toHaveLength(1);
      expect(entry.dualRead).toBe(payload.dual_read_ids.includes(entry.id));
      expect(entry.recovering).toBe(payload.recovering_ids.includes(entry.id));
    }
    const deepest = model[0]!; // syn_w5: pos 5 — dual, recovering, conflict, below 200d
    expect(deepest.id).toBe("syn_w5");
    expect(deepest.chips).toEqual([
      "cycle_turn",
      "dual_read",
      "recovering",
      "gate_conflict",
      "below_200d",
    ]);
    const second = model[1]!; // syn_w2: pos 14 — in neither set, above 200d
    expect(second.id).toBe("syn_w2");
    expect(second.chips).toEqual(["cycle_turn", "above_200d"]);
  });

  it("renders the gate-conflict chip when the row carries the flag", () => {
    const model = watchModel(payload);
    const conflict = model.find((e) => e.id === "syn_w4")!; // pos 31, gate_conflict
    expect(conflict.chips).toContain("gate_conflict");
    const noConflict = model.find((e) => e.id === "syn_w6")!; // pos 47
    expect(noConflict.chips).not.toContain("gate_conflict");
  });

  it("never surfaces the payload-only fields, hrefs, or raw identity enums", () => {
    const model = watchModel(payload);
    const json = JSON.stringify(model);
    expect(json).not.toContain("PAYLOAD-SIGNAL");
    expect(json).not.toContain("PAYLOAD-TIMING");
    expect(json).not.toContain("PAYLOAD-CYCLE");
    expect(json).not.toContain(".html"); // href carried, never actionable
    const assertNoPayloadKeys = (node: unknown): void => {
      if (Array.isArray(node)) {
        for (const child of node) assertNoPayloadKeys(child);
        return;
      }
      if (node && typeof node === "object") {
        for (const [key, value] of Object.entries(node)) {
          expect(["signal", "cycle_signal", "timing_state", "osc_slope", "href", "cid", "kind"]).not.toContain(key);
          assertNoPayloadKeys(value);
        }
      }
    };
    assertNoPayloadKeys(model);
  });

  it("flags the recovering disclosure from the FULL population (v1.1)", () => {
    // Fixture: recovering on syn_w5 and syn_w8 (both visible) and syn_w3 (hidden
    // behind the continuation budget). Population truth: any recovering entry
    // flags the disclosure — the entry is reachable via Show all, and the
    // population-level fact never depends on the current display slice.
    expect(hasRecovering(payload)).toBe(true);
    // v1.1 full-population continuation: hasRecovering is POPULATION truth —
    // an entry beyond the collapsed display budget still flags the disclosure,
    // because Show all makes it reachable without changing what is true.
    const cappedOutOnly: BottomingWatchData = {
      bottoming_watch: [
        ...Array.from({ length: 8 }, (_, i) => ({
          id: `full_${i}`,
          cid: `c${i}`,
          kind: "BASKET" as const,
          name: `Full ${i}`,
          name_zh: `满 ${i}`,
          pos: i + 1,
          osc_slope: 0,
          signal: null,
          timing_state: "steady",
          above200d: true,
          cycle_signal: null,
          gate_conflict: false,
          href: "basket/full.html",
        })),
        {
          id: "capped_out",
          cid: "c9",
          kind: "SECTOR",
          name: "Capped out",
          name_zh: "被截断",
          pos: 90,
          osc_slope: 0,
          signal: null,
          timing_state: "steady",
          above200d: true,
          cycle_signal: null,
          gate_conflict: false,
          href: "sector/capped.html",
        },
      ],
      dual_read_ids: [],
      recovering_ids: ["capped_out"], // recovering only beyond the cap
      bottoming_authority: {
        tier: "display",
        may_rank: false,
        may_gate: false,
        may_size: false,
        may_escalate: false,
        null_disclosure_en: null,
        null_disclosure_zh: null,
      },
    };
    expect(cappedOutOnly.bottoming_watch).toHaveLength(9);
    // v1.1: recovering beyond the collapsed display budget STILL flags the
    // disclosure — population truth, independent of what is shown.
    expect(hasRecovering(cappedOutOnly)).toBe(true);
  });

  it("renders the authority's null disclosure when present, per language", () => {
    expect(watchDisclosure(payload, "en")).toBe(
      "Synthetic authority null disclosure — nothing here ranks or gates anything.",
    );
    expect(watchDisclosure(payload, "zh")).toBe(
      "合成权威空披露——此处内容不参与任何排序或门槛。",
    );
    // Absent disclosures fall back to the lexicon copy (null return).
    const bare: BottomingWatchData = {
      bottoming_watch: [],
      dual_read_ids: [],
      recovering_ids: [],
      bottoming_authority: {
        tier: "display",
        may_rank: false,
        may_gate: false,
        may_size: false,
        may_escalate: false,
        null_disclosure_en: null,
        null_disclosure_zh: null,
      },
    };
    expect(watchDisclosure(bare, "en")).toBeNull();
    expect(watchDisclosure(bare, "zh")).toBeNull();
    // The authority tier is display-only and every may_* stays false.
    expect(payload.bottoming_authority.tier).toBe("display");
    expect(payload.bottoming_authority.may_rank).toBe(false);
    expect(payload.bottoming_authority.may_gate).toBe(false);
    expect(payload.bottoming_authority.may_size).toBe(false);
    expect(payload.bottoming_authority.may_escalate).toBe(false);
  });
});

describe("zero is measured, missing is missing", () => {
  it("treats a zero-total lane as a measured empty, never as unavailable", () => {
    const onTheRun = contract.action_board.lanes.on_the_run;
    expect(onTheRun.total).toBe(0);
    expect(onTheRun.rows).toHaveLength(0);
    expect(laneRowsSorted("on_the_run", onTheRun.rows)).toEqual([]);
    expect(isCallsBoardUnavailable(contract.action_board)).toBe(false);
  });

  it("treats an empty watch entry list as a measured empty", () => {
    const emptyPayload: BottomingWatchData = {
      bottoming_watch: [],
      dual_read_ids: [],
      recovering_ids: [],
      bottoming_authority: contract.bottoming_watch_payload.bottoming_authority,
    };
    expect(watchModel(emptyPayload)).toEqual([]);
    expect(isBottomingWatchUnavailable(emptyPayload)).toBe(false);
  });

  it("reserves the unavailable path for null input only", () => {
    expect(isCallsBoardUnavailable(null)).toBe(true);
    expect(isCallsBoardUnavailable(undefined)).toBe(true);
    expect(isBottomingWatchUnavailable(null)).toBe(true);
    expect(isBottomingWatchUnavailable(undefined)).toBe(true);
  });
});

/** Build a full six-lane record for inline cases; unspecified lanes are
 * measured-empty. */
function makeLanes(over: Partial<Record<SourceLaneKey, LaneData>>): Record<SourceLaneKey, LaneData> {
  const empty = lane([], 0);
  return {
    buy_now: over.buy_now ?? empty,
    buy_soon: over.buy_soon ?? empty,
    on_the_run: over.on_the_run ?? empty,
    take_profits: over.take_profits ?? empty,
    hold: over.hold ?? empty,
    avoid: over.avoid ?? empty,
  };
}

describe("stand-aside groups (R5 C01) — hold/avoid keep named identity", () => {
  it("exposes both source lanes with their OWN full totals for group headers", () => {
    const groups = standAsideGroups(contract.action_board.lanes);
    expect(groups.hold.total).toBe(contract.action_board.lanes.hold.total);
    expect(groups.avoid.total).toBe(contract.action_board.lanes.avoid.total);
    // Folding arithmetic is untouched: group totals sum to the merged column.
    const folded = foldSixToFive(contract.action_board.lanes);
    expect(groups.hold.total + groups.avoid.total).toBe(folded.stand_aside.total);
  });

  it("spends the merged budget exactly like columnPreview: hold first, avoid takes the remainder", () => {
    // Fixture: hold 3 rows, avoid 2 → hold shows 3, avoid shows 0/hidden 2.
    const preview = standAsidePreview(contract.action_board.lanes, false, false);
    expect(preview.hold.shown.map((r) => r.ticker)).toEqual([
      "SYN_HOLD_T1",
      "SYN_HOLD_T2",
      "SYN_HOLD_T3",
    ]);
    expect(preview.hold.hidden).toBe(0);
    expect(preview.avoid.shown).toHaveLength(0);
    expect(preview.avoid.hidden).toBe(2);
    // Cross-check against the merged-list slice the plain column uses.
    const merged = columnPreview("stand_aside", foldedStandAside().rows, false);
    expect(preview.hold.shown.length + preview.avoid.shown.length).toBe(merged.shown.length);
    expect(preview.hold.hidden + preview.avoid.hidden).toBe(merged.hidden);
  });

  it("expands each group independently — expanding Hold never re-collapses Avoid", () => {
    // hold 9 / avoid 16, budget 3: collapsed shows hold 3, avoid 0.
    const many = makeLanes({
      hold: lane(Array.from({ length: 9 }, (_, i) => row({ ticker: `H${i}` })), 9),
      avoid: lane(Array.from({ length: 16 }, (_, i) => row({ ticker: `A${i}` })), 16),
    });
    const collapsed = standAsidePreview(many, false, false);
    expect(collapsed.hold.shown).toHaveLength(3);
    expect(collapsed.avoid.shown).toHaveLength(0);
    const holdOpen = standAsidePreview(many, true, false);
    expect(holdOpen.hold.shown).toHaveLength(9);
    expect(holdOpen.avoid.shown).toHaveLength(0); // budget arithmetic is a source property
    const bothOpen = standAsidePreview(many, true, true);
    expect(bothOpen.hold.shown).toHaveLength(9);
    expect(bothOpen.avoid.shown).toHaveLength(16);
  });

  it("keeps the per-group display sort — themes first inside each group", () => {
    const mixed = makeLanes({
      hold: lane(
        [row({ ticker: "H_SEC", kind: "sector" }), row({ ticker: "H_T", kind: "theme" })],
        2,
      ),
      avoid: lane([row({ ticker: "A_SEC", kind: "sector" })], 1),
    });
    const preview = standAsidePreview(mixed, false, false);
    expect(preview.hold.shown.map((r) => r.ticker)).toEqual(["H_T", "H_SEC"]);
    // Hold spent 2 of the 3-row budget → avoid takes the 1-row remainder.
    expect(preview.avoid.shown.map((r) => r.ticker)).toEqual(["A_SEC"]);
  });
});

function foldedStandAside(): LaneData {
  return foldSixToFive(contract.action_board.lanes).stand_aside;
}

// ── S2: closed-shape carried readers ─────────────────────────────────────────

describe("S2 — actionBoardFromCarried (closed-shape reader)", () => {
  it("accepts the real captured board and the synthetic contract board, as the SAME object", () => {
    expect(actionBoardFromCarried(capturedBoard)).toBe(capturedBoard);
    expect(actionBoardFromCarried(contract.action_board)).toBe(contract.action_board);
    expect(actionBoardFromCarried(capturedBoard)?.lanes.hold.rows).toHaveLength(3);
  });

  it("returns null for every malformed or incomplete board — never throws", () => {
    const variant = (mutate: (b: Record<string, unknown>) => void): unknown => {
      const b = JSON.parse(JSON.stringify(contract.action_board)) as Record<string, unknown>;
      mutate(b);
      return b;
    };
    const lanes = (b: Record<string, unknown>) => b.lanes as Record<string, unknown>;
    /** The hold lane's FIRST row of this variant's own clone. */
    const holdRow0 = (b: Record<string, unknown>) =>
      (lanes(b).hold as { rows: Record<string, unknown>[] }).rows[0]!;

    // Not an object.
    for (const bad of [undefined, null, "board", 42, [], true]) {
      expect(actionBoardFromCarried(bad)).toBeNull();
    }
    // Envelope violations.
    expect(actionBoardFromCarried(variant((b) => { delete b.as_of; }))).toBeNull();
    expect(actionBoardFromCarried(variant((b) => { b.as_of = "2026/11/03"; }))).toBeNull();
    expect(actionBoardFromCarried(variant((b) => { b.as_of = 20261103; }))).toBeNull();
    // Absent total never reaches the reader as "undefined" text (S2 defect).
    expect(actionBoardFromCarried(variant((b) => { delete b.total; }))).toBeNull();
    expect(actionBoardFromCarried(variant((b) => { b.total = "19"; }))).toBeNull();
    expect(actionBoardFromCarried(variant((b) => { b.total = 19.5; }))).toBeNull();
    expect(actionBoardFromCarried(variant((b) => { b.total = -1; }))).toBeNull();
    expect(actionBoardFromCarried(variant((b) => { delete b.locked; }))).toBeNull();
    // Lane-record violations — a missing lanes object or ONE missing lane was
    // the S2 defect that threw inside the component.
    expect(actionBoardFromCarried(variant((b) => { delete b.lanes; }))).toBeNull();
    expect(actionBoardFromCarried(variant((b) => { b.lanes = []; }))).toBeNull();
    expect(actionBoardFromCarried(variant((b) => { delete lanes(b).avoid; }))).toBeNull();
    expect(actionBoardFromCarried(variant((b) => { delete lanes(b).buy_now; }))).toBeNull();
    expect(actionBoardFromCarried(variant((b) => { delete (lanes(b).hold as { rows?: unknown }).rows; }))).toBeNull();
    expect(actionBoardFromCarried(variant((b) => { delete (lanes(b).hold as { total?: unknown }).total; }))).toBeNull();
    expect(actionBoardFromCarried(variant((b) => { delete (lanes(b).hold as { locked?: unknown }).locked; }))).toBeNull();
    // Row-shape violations on one row poison the whole board (closed shape).
    expect(actionBoardFromCarried(variant((b) => { delete holdRow0(b).href; }))).toBeNull();
    expect(actionBoardFromCarried(variant((b) => { delete holdRow0(b).name_zh; }))).toBeNull();
    expect(actionBoardFromCarried(variant((b) => { holdRow0(b).kind = "basket"; }))).toBeNull();
    expect(actionBoardFromCarried(variant((b) => { holdRow0(b).score = "63"; }))).toBeNull();
    expect(actionBoardFromCarried(variant((b) => { holdRow0(b).score = Number.NaN; }))).toBeNull();
    expect(actionBoardFromCarried(variant((b) => { holdRow0(b).eligible = "true"; }))).toBeNull();
    expect(actionBoardFromCarried(variant((b) => { holdRow0(b).top_members = "H0001"; }))).toBeNull();
    expect(actionBoardFromCarried(variant((b) => { holdRow0(b).top_members = [1]; }))).toBeNull();
    expect(actionBoardFromCarried(variant((b) => { holdRow0(b).book_wt = "0.2"; }))).toBeNull();
    expect(actionBoardFromCarried(variant((b) => { holdRow0(b).signal_grade = 1; }))).toBeNull();
    expect(actionBoardFromCarried(variant((b) => { holdRow0(b).days = "3"; }))).toBeNull();
    expect(actionBoardFromCarried(variant((b) => { holdRow0(b).stat_en = 5; }))).toBeNull();
    expect(actionBoardFromCarried(variant((b) => { holdRow0(b).emerging = "yes"; }))).toBeNull();
    expect(actionBoardFromCarried(variant((b) => { holdRow0(b).emergence_href = 7; }))).toBeNull();
    // buy_soon's nullable days and null book_wt/signal_grade stay accepted.
    expect(
      actionBoardFromCarried(
        variant((b) => {
          const rows = (lanes(b).buy_soon as { rows: Record<string, unknown>[] }).rows;
          rows[4].days = null;
          rows[0].book_wt = null;
        }),
      ),
    ).not.toBeNull();
  });
});

describe("S2 — bottomingWatchFromCarried (closed-shape reader)", () => {
  const watch = contract.bottoming_watch_payload;

  it("accepts the contract watch payload as the SAME object", () => {
    expect(bottomingWatchFromCarried(watch)).toBe(watch);
    expect(bottomingWatchFromCarried(watch)?.bottoming_watch).toHaveLength(10);
  });

  it("returns null for every malformed or incomplete payload — never throws", () => {
    const variant = (mutate: (w: Record<string, unknown>) => void): unknown => {
      const w = JSON.parse(JSON.stringify(watch)) as Record<string, unknown>;
      mutate(w);
      return w;
    };
    const entries = (w: Record<string, unknown>) => w.bottoming_watch as Record<string, unknown>[];

    for (const bad of [undefined, null, "watch", 42, [], true]) {
      expect(bottomingWatchFromCarried(bad)).toBeNull();
    }
    // A missing/empty entries array was the S2 defect ("is not iterable").
    expect(bottomingWatchFromCarried(variant((w) => { delete w.bottoming_watch; }))).toBeNull();
    expect(bottomingWatchFromCarried(variant((w) => { w.bottoming_watch = {}; }))).toBeNull();
    // A shorter (but well-formed) list is fine — measured empties stay legal.
    expect(
      bottomingWatchFromCarried(variant((w) => { entries(w).splice(2, 1); })),
    ).not.toBeNull();
    // Entry-shape violations poison the whole payload.
    expect(bottomingWatchFromCarried(variant((w) => { entries(w)[0].kind = "basket"; }))).toBeNull();
    expect(bottomingWatchFromCarried(variant((w) => { delete entries(w)[0].name_zh; }))).toBeNull();
    expect(bottomingWatchFromCarried(variant((w) => { entries(w)[1].pos = "14"; }))).toBeNull();
    expect(bottomingWatchFromCarried(variant((w) => { entries(w)[1].osc_slope = Number.POSITIVE_INFINITY; }))).toBeNull();
    expect(bottomingWatchFromCarried(variant((w) => { entries(w)[3].above200d = "false"; }))).toBeNull();
    expect(bottomingWatchFromCarried(variant((w) => { entries(w)[3].gate_conflict = 1; }))).toBeNull();
    expect(bottomingWatchFromCarried(variant((w) => { entries(w)[0].signal = 5; }))).toBeNull();
    expect(bottomingWatchFromCarried(variant((w) => { entries(w)[0].cycle_signal = 5; }))).toBeNull();
    expect(bottomingWatchFromCarried(variant((w) => { delete entries(w)[0].timing_state; }))).toBeNull();
    expect(bottomingWatchFromCarried(variant((w) => { delete entries(w)[0].href; }))).toBeNull();
    // Membership-set violations.
    expect(bottomingWatchFromCarried(variant((w) => { delete w.dual_read_ids; }))).toBeNull();
    expect(bottomingWatchFromCarried(variant((w) => { w.recovering_ids = "syn_w5"; }))).toBeNull();
    expect(bottomingWatchFromCarried(variant((w) => { (w.dual_read_ids as unknown[])[0] = 5; }))).toBeNull();
    // Authority violations: wrong tier, an escaped may_* flag, bad disclosure.
    expect(bottomingWatchFromCarried(variant((w) => { delete w.bottoming_authority; }))).toBeNull();
    expect(bottomingWatchFromCarried(variant((w) => { (w.bottoming_authority as { tier: string }).tier = "trade"; }))).toBeNull();
    expect(bottomingWatchFromCarried(variant((w) => { (w.bottoming_authority as { may_rank: boolean }).may_rank = true; }))).toBeNull();
    expect(bottomingWatchFromCarried(variant((w) => { (w.bottoming_authority as { may_size: boolean }).may_size = true; }))).toBeNull();
    expect(
      bottomingWatchFromCarried(
        variant((w) => { (w.bottoming_authority as { null_disclosure_en: unknown }).null_disclosure_en = 5; }),
      ),
    ).toBeNull();
  });
});

describe("S2 — component boundary: malformed payloads render unavailable, never throw", () => {
  const renderBoard = (board: unknown): string =>
    renderToStaticMarkup(createElement(SectorCallsBoard, { board: board as never }));
  const renderWatch = (watch: unknown): string =>
    renderToStaticMarkup(createElement(SectorBottomingWatch, { watch: watch as never }));

  it("a valid board still renders fully (control)", () => {
    const markup = renderBoard(contract.action_board);
    expect(markup).not.toContain("data-depth-unavailable");
    expect(markup).toContain("Synthetic theme 1");
  });

  it("a missing lanes object renders the typed unavailable state — the S2 throw is gone", () => {
    const bad = JSON.parse(JSON.stringify(contract.action_board)) as Record<string, unknown>;
    delete bad.lanes;
    const markup = renderBoard(bad);
    expect(markup).toContain('data-depth-unavailable="action_board"');
  });

  it("an absent board total renders unavailable — never 'undefined qualified rows' text", () => {
    const bad = JSON.parse(JSON.stringify(contract.action_board)) as Record<string, unknown>;
    delete bad.total;
    const markup = renderBoard(bad);
    expect(markup).toContain('data-depth-unavailable="action_board"');
    expect(markup).not.toContain("undefined");
    expect(markup).not.toContain("NaN");
  });

  it("one malformed row renders unavailable for the whole board (closed shape)", () => {
    const bad = JSON.parse(JSON.stringify(contract.action_board)) as {
      lanes: { hold: { rows: Record<string, unknown>[] } };
    };
    delete bad.lanes.hold.rows[0].href;
    expect(renderBoard(bad)).toContain('data-depth-unavailable="action_board"');
  });

  it("an absent or {} watch payload renders unavailable — the iterable throw is gone", () => {
    for (const bad of [undefined, null, {}]) {
      const markup = renderWatch(bad);
      expect(markup).toContain('data-depth-unavailable="bottoming_watch"');
      expect(markup).not.toContain("undefined");
      expect(markup).not.toContain("NaN");
    }
    const noEntries = JSON.parse(JSON.stringify(contract.bottoming_watch_payload)) as Record<string, unknown>;
    delete noEntries.bottoming_watch;
    expect(renderWatch(noEntries)).toContain('data-depth-unavailable="bottoming_watch"');
  });

  it("a valid watch still renders fully (control)", () => {
    const markup = renderWatch(contract.bottoming_watch_payload);
    expect(markup).not.toContain("data-depth-unavailable");
    expect(markup).toContain("Synthetic watch 5");
  });

  it("S5 wiring: the unavailable state names the localized owner, never the raw wire id", () => {
    const markup = renderBoard(null);
    expect(markup).toContain("Macro sector generation");
    expect(markup).toContain("the action board");
    expect(markup).not.toContain("macro_sector_generation");
    const watchMarkup = renderWatch(null);
    expect(watchMarkup).toContain("Macro sector generation");
    expect(watchMarkup).toContain("the bottoming watch");
  });
});
