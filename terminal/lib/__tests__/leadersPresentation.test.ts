import { describe, expect, it } from "vitest";
import {
  LEADERS_PREVIEW_ROWS,
  filterLeaderRows,
  leaderCountLabel,
  leaderCoverageFootnote,
  leaderDirectionCaveat,
  leaderHistoryLabel,
  leaderEmptyLabel,
  leaderMissingRecurrenceLabel,
  leaderSearchCountLabel,
  leaderSearchEmptyLabel,
  normalizeLeaderQuery,
  visibleLeaderRows,
} from "@/lib/leadersPresentation";

describe("Flow Leaders presentation", () => {
  it("shows a bounded preview until the reader explicitly expands it", () => {
    const rows = Array.from({ length: 133 }, (_, i) => i + 1);
    expect(LEADERS_PREVIEW_ROWS).toBe(12);
    expect(visibleLeaderRows(rows, false)).toEqual(rows.slice(0, 12));
    expect(visibleLeaderRows(rows, true)).toEqual(rows);
    expect(rows).toHaveLength(133);
  });

  it("searches the complete board with ticker-friendly normalization", () => {
    const rows = [{ ticker: "AAPL" }, { ticker: "BRK.B" }, { ticker: "MSFT" }];
    expect(normalizeLeaderQuery("  $brk  ")).toBe("BRK");
    expect(filterLeaderRows(rows, "$brk")).toEqual([{ ticker: "BRK.B" }]);
    expect(filterLeaderRows(rows, "")).toEqual(rows);
    expect(leaderSearchCountLabel("en", 1, 133, 368)).toBe(
      "1 match in 133 · 368-name universe",
    );
    expect(leaderSearchCountLabel("zh", 2, 133, 368)).toBe(
      "匹配 2 / 133 · 368 标的范围",
    );
    expect(leaderSearchEmptyLabel("en", "$xyz")).toBe("No names match “XYZ”");
    expect(leaderSearchEmptyLabel("zh", "xyz")).toBe("没有标的匹配“XYZ”");
  });

  it("separates board count from universe coverage", () => {
    expect(leaderCountLabel("en", 12, 133, 368)).toBe(
      "Showing 12 of 133 · 368-name universe",
    );
    expect(leaderCountLabel("zh", 12, 133, 368)).toBe(
      "显示 12 / 133 · 368 标的范围",
    );
  });

  it("uses snapshot-honest empty and stale labels", () => {
    expect(leaderEmptyLabel("en")).toBe("No qualifying names in this snapshot");
    expect(leaderMissingRecurrenceLabel("en", true)).toBe("historical");
    expect(leaderMissingRecurrenceLabel("en", false)).toBe("accruing");
  });

  it("translates source mechanics into reader-facing history and confidence copy", () => {
    expect(leaderHistoryLabel("en", 145)).toBe("145 sessions of history");
    expect(leaderHistoryLabel("en", 1)).toBe("1 session of history");
    expect(leaderHistoryLabel("zh", 145)).toBe("145 个历史会话");
    expect(leaderDirectionCaveat("en")).toBe(
      "Magnitude is more reliable than direction in this snapshot.",
    );
    expect(leaderDirectionCaveat("zh")).toBe("此快照中，幅度比方向更可靠。");
  });

  it("summarizes coverage instead of dumping hundreds of ticker names", () => {
    const copy = leaderCoverageFootnote("en", 349);
    expect(copy).toContain("349 names");
    expect(copy).not.toContain("AAPL");
    expect(copy).not.toContain("Direction is approximate");
    expect(copy.length).toBeLessThan(120);
  });
});
