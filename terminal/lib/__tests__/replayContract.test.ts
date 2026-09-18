import { describe, it, expect } from "vitest";
import {
  REPLAY_MIN_IDX,
  REPLAY_MIN_TOTAL,
  replayIsAvailable,
  replayChartKey,
  resolveReplayTotal,
  replayHasSpan,
  clampReplayIdx,
  initialReplayIdx,
} from "@/lib/replayContract";

// ─────────────────────────────────────────────────────────────────────────────
// Bar Replay temporal authority. The defect this locks: a workspace presented one
// global Replay transport while only the ACTIVE pane was sliced into history, so
// its neighbour silently stayed at present time — and the transport's own length
// came from whichever pane last reported, which was not necessarily either of them.
//
// The numbers below are the shipped fixtures (terminal/public/data/*.json), and
// they are the whole argument for the contract: on IDENTICAL daily bars, one
// integer index names two dates almost two years apart.
//
//   AAPL  1255 bars from 2021-06-28   → index 300 = 2022-09-06
//   ARM    698 bars from 2023-09-14   → index 300 = 2024-11-21
// ─────────────────────────────────────────────────────────────────────────────
const AAPL_TOTAL = 1255;
const ARM_TOTAL = 698;

describe("replay availability — the single-chart contract", () => {
  it("offers Replay only to a workspace of exactly one chart", () => {
    expect(replayIsAvailable(1)).toBe(true);
    expect(replayIsAvailable(2)).toBe(false);
    expect(replayIsAvailable(4)).toBe(false);
  });

  it("still refuses a grid whose panes share a timeframe", () => {
    // The old gate was `mixedTfs` — matching timeframes were allowed through, which
    // is exactly how AAPL and ARM both entered Replay on "D" and then disagreed
    // about what bar 300 meant. Pane COUNT is the contract; timeframe is not.
    expect(replayIsAvailable(2)).toBe(false);
    expect(resolveReplayTotal({ "AAPL|D": AAPL_TOTAL, "ARM|D": ARM_TOTAL }, ["AAPL", "ARM"], ["D", "D"])).toBe(0);
  });

  it("refuses a grid of the SAME symbol at the same timeframe", () => {
    expect(resolveReplayTotal({ "AAPL|D": AAPL_TOTAL }, ["AAPL", "AAPL"], ["D", "D"])).toBe(0);
  });
});

describe("replay span — bound to the chart on screen, never to a neighbour", () => {
  const totals = { "AAPL|D": AAPL_TOTAL, "AAPL|3D": 419, "ARM|D": ARM_TOTAL };

  it("reports the bar count of the one chart that may replay", () => {
    expect(resolveReplayTotal(totals, ["AAPL"], ["D"])).toBe(AAPL_TOTAL);
    expect(resolveReplayTotal(totals, ["ARM"], ["D"])).toBe(ARM_TOTAL);
  });

  it("keys the span by timeframe, so a resampled series cannot borrow the daily length", () => {
    expect(resolveReplayTotal(totals, ["AAPL"], ["3D"])).toBe(419);
    expect(replayChartKey("AAPL", "3D")).not.toBe(replayChartKey("AAPL", "D"));
  });

  it("reports 0 — not a stale number — when the chart on screen has not measured itself", () => {
    // The live defect: the shell held one `total` written by the last pane to load
    // while active. Focusing AAPL (1255 bars) left the transport reading ARM's 698,
    // so the rail claimed "619 / 698" about a 1255-bar chart. An unknown span must
    // read as unknown.
    expect(resolveReplayTotal(totals, ["NVDA"], ["D"])).toBe(0);
    expect(resolveReplayTotal({}, ["AAPL"], ["D"])).toBe(0);
    expect(resolveReplayTotal({ "AAPL|D": 0 }, ["AAPL"], ["D"])).toBe(0);
  });

  it("treats an unscrubbable span as no span", () => {
    expect(replayHasSpan(0)).toBe(false);
    expect(replayHasSpan(REPLAY_MIN_TOTAL - 1)).toBe(false);
    expect(replayHasSpan(REPLAY_MIN_TOTAL)).toBe(true);
    expect(replayHasSpan(AAPL_TOTAL)).toBe(true);
  });
});

describe("transport authority — every control clamps the same way", () => {
  it("never addresses a bar the chart will not honor", () => {
    expect(clampReplayIdx(-5, AAPL_TOTAL)).toBe(REPLAY_MIN_IDX);
    expect(clampReplayIdx(0, AAPL_TOTAL)).toBe(REPLAY_MIN_IDX);
    expect(clampReplayIdx(300, AAPL_TOTAL)).toBe(300);
    expect(clampReplayIdx(99_999, AAPL_TOTAL)).toBe(AAPL_TOTAL - 1);
  });

  it("collapses to the floor when there is no span to scrub", () => {
    expect(clampReplayIdx(300, 0)).toBe(REPLAY_MIN_IDX);
    expect(clampReplayIdx(300, 5)).toBe(REPLAY_MIN_IDX);
  });

  it("carries a position from a longer chart into a shorter one without inventing bars", () => {
    // AAPL's last bar is index 1254; ARM's series ends at 697. Carried onto ARM the
    // position clamps to ARM's own last bar instead of addressing 557 bars ARM never
    // had — which is what a shared index across panes would have asked for.
    expect(AAPL_TOTAL - 1).toBeGreaterThan(ARM_TOTAL - 1);
    expect(clampReplayIdx(AAPL_TOTAL - 1, ARM_TOTAL)).toBe(ARM_TOTAL - 1);
    expect(clampReplayIdx(618, ARM_TOTAL)).toBe(618);   // in range on both — no clamp
  });

  it("opens on a run-up of recent history, never past the warmup floor", () => {
    expect(initialReplayIdx(AAPL_TOTAL)).toBe(AAPL_TOTAL - 80);
    expect(initialReplayIdx(ARM_TOTAL)).toBe(ARM_TOTAL - 80);
    expect(initialReplayIdx(60)).toBe(REPLAY_MIN_IDX);   // shorter than the run-up
    expect(initialReplayIdx(0)).toBe(REPLAY_MIN_IDX);
  });

  it("keeps the opening position inside the span it was computed from", () => {
    for (const total of [REPLAY_MIN_TOTAL, 60, ARM_TOTAL, AAPL_TOTAL]) {
      const idx = initialReplayIdx(total);
      expect(idx).toBeGreaterThanOrEqual(REPLAY_MIN_IDX);
      expect(idx).toBeLessThanOrEqual(total - 1);
    }
  });
});

describe("chart identity", () => {
  it("distinguishes symbols and timeframes, and tolerates an unmounted pane", () => {
    expect(replayChartKey("AAPL", "D")).toBe("AAPL|D");
    expect(replayChartKey("ARM", "D")).toBe("ARM|D");
    expect(replayChartKey(undefined, undefined)).toBe("|");
  });
});
