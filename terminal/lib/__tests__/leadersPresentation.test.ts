import { describe, expect, it } from "vitest";
import {
  LEADERS_PREVIEW_ROWS,
  leaderCountLabel,
  leaderCoverageFootnote,
  leaderEmptyLabel,
  leaderMissingRecurrenceLabel,
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

  it("summarizes coverage instead of dumping hundreds of ticker names", () => {
    const copy = leaderCoverageFootnote("en", 349);
    expect(copy).toContain("349 names");
    expect(copy).not.toContain("AAPL");
    expect(copy.length).toBeLessThan(140);
  });
});
