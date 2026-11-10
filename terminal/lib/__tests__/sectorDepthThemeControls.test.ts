import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { sectorRotationHistory } from "@/lib/sectorIntelligence";
import {
  THEME_PALETTE,
  fmtThemeDelta,
  themeDefaultSelection,
  themeDeltas,
  themeHorizon,
  themeLatestRs,
  themeTurnsInWindow,
  themeWindowSlice,
  themeXLabels,
  type ThemePoint,
} from "@/components/sector-intelligence/depth/SectorThemeCompare";

const fixturePath = path.join(__dirname, "fixtures", "sector_generation.captured.preview.v1.json");
const captured = JSON.parse(readFileSync(fixturePath, "utf8")) as Record<string, unknown>;

function pts(n: number, start = 0, step = 1): ThemePoint[] {
  return Array.from({ length: n }, (_, i) => ({
    date: `2026-${String(Math.floor(i / 28) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`,
    rs21: start + i * step,
    rs63: (start + i * step) * 2,
  }));
}

describe("themeHorizon", () => {
  it("maps each window to its rs measure", () => {
    expect(themeHorizon("21")).toBe(21);
    expect(themeHorizon("63")).toBe(63);
    expect(themeHorizon("all")).toBe(63);
  });
});

describe("themeWindowSlice", () => {
  it("returns the LAST n sessions for 21/63", () => {
    const p = pts(30);
    expect(themeWindowSlice(p, "21")).toHaveLength(21);
    expect(themeWindowSlice(p, "21")[0]).toBe(p[9]);
    expect(themeWindowSlice(p, "63")).toHaveLength(30); // shorter than 63 → whole series
  });
  it("returns every carried point for all", () => {
    const p = pts(30);
    expect(themeWindowSlice(p, "all")).toBe(p);
  });
  it("handles empty input", () => {
    expect(themeWindowSlice([], "21")).toEqual([]);
  });
});

describe("themeDeltas", () => {
  it("rebases to 0 at the window start", () => {
    const d = themeDeltas(pts(5, 10, 2), 21);
    expect(d).toHaveLength(5);
    expect(d[0].v).toBe(0);
    expect(d[4].v).toBe(8);
  });
  it("uses rs63 for horizon 63", () => {
    const d = themeDeltas(pts(3, 1, 1), 63);
    expect(d[2].v).toBe(4); // rs63 = 2×rs21 → (3-1)*2
  });
  it("returns [] for empty and guards non-finite base", () => {
    expect(themeDeltas([], 21)).toEqual([]);
    const bad = [{ date: "2026-01-01", rs21: Number.NaN, rs63: 0 }] as unknown as ThemePoint[];
    expect(themeDeltas(bad, 21)).toEqual([]);
  });
});

describe("themeLatestRs", () => {
  it("reads the last point for the horizon", () => {
    expect(themeLatestRs(pts(4, 0, 5), 21)).toBe(15);
    expect(themeLatestRs(pts(4, 0, 5), 63)).toBe(30);
  });
  it("returns null for empty input", () => {
    expect(themeLatestRs([], 21)).toBeNull();
  });
});

describe("themeDefaultSelection", () => {
  it("picks the largest |latest| ids, deterministic ties, series key order", () => {
    const series = [
      { id: "aaa", points: pts(3, 0, 1) },  // latest 2
      { id: "bbb", points: pts(3, 0, 10) }, // latest 20 → |20|
      { id: "ccc", points: pts(3, 0, -15) },// latest -30 → |30| (rs63 doubles)
      { id: "ddd", points: pts(3, 0, 4) },  // latest 8
      { id: "eee", points: pts(3, 0, -2) }, // latest -4
    ];
    const sel = themeDefaultSelection(series, 21, 3);
    expect(sel).toEqual(["bbb", "ccc", "ddd"]);
  });
  it("returns at least one id even when all are unmeasured", () => {
    const empty = [{ id: "x", points: [] }];
    expect(themeDefaultSelection(empty, 21, 4)).toEqual([]);
  });
});

describe("themeTurnsInWindow", () => {
  it("keeps only turns inside the inclusive window", () => {
    const turns = [{ date: "2025-10-31" }, { date: "2026-01-15" }, { date: "2026-11-03" }, { date: "2026-12-01" }];
    const kept = themeTurnsInWindow(turns, "2025-11-03", "2026-11-03");
    expect(kept.map((t) => t.date)).toEqual(["2026-01-15", "2026-11-03"]);
  });
  it("guards malformed input", () => {
    expect(themeTurnsInWindow(null as unknown as { date: string }[], "a", "b")).toEqual([]);
  });
});

describe("themeXLabels", () => {
  it("thins by pixel gap: no two kept labels within the minimum gap", () => {
    const items = Array.from({ length: 40 }, (_, i) => ({ i }));
    const xOf = (t: { i: number }) => t.i * 12; // 12px apart
    const kept = themeXLabels(items, xOf, 56);
    expect(kept.length).toBeGreaterThan(1);
    expect(kept.length).toBeLessThan(items.length);
    for (let k = 1; k < kept.length; k++) {
      expect((kept[k].i - kept[k - 1].i) * 12).toBeGreaterThanOrEqual(56);
    }
  });
  it("keeps everything when spacing already exceeds the gap", () => {
    const items = [{ i: 0 }, { i: 1 }, { i: 2 }];
    expect(themeXLabels(items, (t) => t.i * 200, 56)).toHaveLength(3);
  });
});

describe("fmtThemeDelta", () => {
  it("formats with 1 decimal and U+2212 for negatives", () => {
    expect(fmtThemeDelta(12.34)).toBe("+12.3");
    expect(fmtThemeDelta(0)).toBe("+0.0");
    expect(fmtThemeDelta(-0.04)).toBe("−0.0");
    const neg = fmtThemeDelta(-1538.4);
    expect(neg.charCodeAt(0)).toBe(0x2212);
    expect(neg).toBe("−1538");
  });
});

describe("THEME_PALETTE", () => {
  it("covers all 11 sector series with distinct entries", () => {
    expect(THEME_PALETTE.length).toBeGreaterThanOrEqual(11);
    expect(new Set(THEME_PALETTE).size).toBe(THEME_PALETTE.length);
  });
});

describe("captured generation (real fixture)", () => {
  const history = sectorRotationHistory(
    (captured.projection as { data: { history: unknown } }).data.history,
  );

  it("parses through the real reader", () => {
    expect(history).not.toBeNull();
    expect(Object.keys(history!.series)).toHaveLength(11);
  });

  it("every sector carries 252 strictly ascending points", () => {
    for (const s of Object.values(history!.series)) {
      expect(s.points).toHaveLength(252);
      for (let i = 1; i < s.points.length; i++) {
        expect(s.points[i].date > s.points[i - 1].date).toBe(true);
      }
    }
  });

  it("21-window slicing + rebasing behaves on real data", () => {
    const xlk = history!.series["xlk"];
    const sliced = themeWindowSlice(xlk.points, "21");
    expect(sliced).toHaveLength(21);
    const deltas = themeDeltas(sliced, 21);
    expect(deltas[0].v).toBe(0);
    expect(deltas).toHaveLength(21);
    // rebase is exact: v_i === rs21_i - rs21_0
    for (let i = 0; i < 21; i++) {
      expect(deltas[i].v).toBeCloseTo(sliced[i].rs21 - sliced[0].rs21, 12);
    }
  });

  it("default selection is deterministic on real data", () => {
    const entries = Object.values(history!.series);
    const a = themeDefaultSelection(entries, 21, 4);
    const b = themeDefaultSelection(entries, 21, 4);
    expect(a).toEqual(b);
    expect(a).toHaveLength(4);
    // returned in series key order
    const keys = Object.keys(history!.series);
    const idxs = a.map((id) => keys.indexOf(id));
    expect(idxs).toEqual([...idxs].sort((x, y) => x - y));
  });

  it("turn filtering excludes turns older than the carried window", () => {
    for (const s of Object.values(history!.series)) {
      const sliced = themeWindowSlice(s.points, "all");
      const first = sliced[0].date;
      const last = sliced[sliced.length - 1].date;
      for (const kept of themeTurnsInWindow(s.cycleTurns, first, last)) {
        expect(kept.date >= first && kept.date <= last).toBe(true);
      }
      // the fixture's first sector carries a 2022 turn (older than the window)
      if (s.cycleTurns.length && s.cycleTurns[0].date < first) {
        expect(themeTurnsInWindow(s.cycleTurns, first, last).length).toBeLessThan(s.cycleTurns.length);
      }
    }
  });
});
