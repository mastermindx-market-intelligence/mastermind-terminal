import { describe, expect, it } from "vitest";
import {
  selectOptionsFlowBoardRows,
  summarizeOptionsFlowBoard,
  type OptionsFlowBoardSource,
} from "@/lib/optionsFlowBoards";

function event(overrides: Partial<OptionsFlowBoardSource> = {}): OptionsFlowBoardSource {
  return {
    id: "e-1",
    ts: "2026-08-10T15:30:00Z",
    root: "SPY",
    right: "C",
    premium: 100_000,
    size: 20,
    n_prints: 2,
    side: "~buy",
    zerodte: false,
    ...overrides,
  };
}

const ALL_FILTERS = { rootQuery: "", right: "" as const, side: "" as const };

describe("Options Flow derived boards", () => {
  it("uses the publisher's 0DTE flag and never mutates the source order", () => {
    const source = [
      event({ id: "later", premium: 200_000, zerodte: false }),
      event({ id: "zero-small", premium: 90_000, zerodte: true }),
      event({ id: "zero-big", premium: 300_000, zerodte: true }),
    ];

    expect(selectOptionsFlowBoardRows(source, "zero_dte", ALL_FILTERS).map((row) => row.id))
      .toEqual(["zero-big", "zero-small"]);
    expect(source.map((row) => row.id)).toEqual(["later", "zero-small", "zero-big"]);
  });

  it("orders largest aggregate events deterministically by premium, time, then id", () => {
    const source = [
      event({ id: "b", ts: "2026-08-10T15:31:00Z", premium: 200_000 }),
      event({ id: "c", ts: "2026-08-10T15:32:00Z", premium: 200_000 }),
      event({ id: "a", ts: "2026-08-10T15:31:00Z", premium: 200_000 }),
      event({ id: "largest", premium: 500_000 }),
    ];

    expect(selectOptionsFlowBoardRows(source, "largest", ALL_FILTERS).map((row) => row.id))
      .toEqual(["largest", "c", "a", "b"]);
  });

  it("composes root, call/put, and retained heuristic-side filters", () => {
    const source = [
      event({ id: "spy-call", root: "SPY", right: "C", side: "~buy" }),
      event({ id: "spy-put", root: "SPY", right: "P", side: "~sell" }),
      event({ id: "spx-call", root: "SPX", right: "C", side: "~buy" }),
    ];

    const rows = selectOptionsFlowBoardRows(source, "largest", {
      rootQuery: "spy",
      right: "C",
      side: "~buy",
    });
    expect(rows.map((row) => row.id)).toEqual(["spy-call"]);
  });

  it("reports exact additive receipts and leaves a zero-denominator share unknown", () => {
    const rows = [
      event({ id: "call", root: "SPY", right: "C", premium: 300, size: 4, n_prints: 2 }),
      event({ id: "put", root: "QQQ", right: "P", premium: 100, size: 6, n_prints: 3 }),
    ];

    expect(summarizeOptionsFlowBoard(rows)).toEqual({
      eventCount: 2,
      printCount: 5,
      contractCount: 10,
      rootCount: 2,
      grossPremium: 400,
      callPremium: 300,
      putPremium: 100,
      callPremiumShare: 0.75,
    });
    expect(summarizeOptionsFlowBoard([]).callPremiumShare).toBeNull();
  });
});
