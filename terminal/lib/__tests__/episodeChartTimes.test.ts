import { describe, it, expect } from "vitest";
import { etDisplay } from "@/lib/intradaySources";
import { episodeMarks, toMarkerSpecs, type MarkTone } from "@/lib/dislocations/episodeMarks";
import { chartMarkerSpecs, toChartMarks } from "@/lib/dislocations/episodeChartTimes";

const EP = {
  episode_id: "ep-1",
  state: "CANDIDATE",
  first_armed_at: "2026-10-02T13:37:00Z",
  candidate_at: "2026-10-02T13:51:00Z",
  last_observed_at: "2026-10-02T14:02:00Z",
};

const MARK_AT_1337Z = Date.UTC(2026, 9, 2, 13, 37, 0) / 1000;

describe("toChartMarks intraday", () => {
  it("snaps a true-UTC mark to the prior ET display bar", () => {
    const bars = [
      Date.UTC(2026, 9, 2, 9, 30) / 1000,
      Date.UTC(2026, 9, 2, 9, 35) / 1000,
      Date.UTC(2026, 9, 2, 9, 40) / 1000,
      Date.UTC(2026, 9, 2, 9, 45) / 1000,
    ];
    const marks = episodeMarks(EP);
    const flagged = marks.find((m) => m.tone === "flagged")!;
    expect(flagged.at).toBe(MARK_AT_1337Z);

    const chartMarks = toChartMarks([flagged], bars, true);
    expect(chartMarks).toHaveLength(1);
    const bar0935 = Date.UTC(2026, 9, 2, 9, 35) / 1000;
    expect(etDisplay(MARK_AT_1337Z * 1000).epoch).toBe(Date.UTC(2026, 9, 2, 9, 37) / 1000);
    expect(chartMarks[0].chartTime).toBe(bar0935);
    expect(chartMarks[0].at).toBe(bar0935);
  });
});

describe("toChartMarks daily", () => {
  it("maps snapped session day to the bar date string", () => {
    const bars = ["2026-09-30", "2026-10-01", "2026-10-02"];
    const marks = episodeMarks(EP);
    const flagged = marks.find((m) => m.tone === "flagged")!;
    const chartMarks = toChartMarks([flagged], bars, false);
    expect(chartMarks).toHaveLength(1);
    expect(chartMarks[0].chartTime).toBe("2026-10-02");
  });

  it("snaps a Saturday mark down to Friday's bar", () => {
    const bars = ["2026-10-02", "2026-10-05"];
    const saturdayMark = {
      id: "ep-1:flagged",
      at: Date.UTC(2026, 9, 4, 14, 0, 0) / 1000,
      tone: "flagged" as const,
      text: ["Flagged", "已标记"] as const,
    };
    const chartMarks = toChartMarks([saturdayMark], bars, false);
    expect(chartMarks).toHaveLength(1);
    expect(chartMarks[0].chartTime).toBe("2026-10-02");
  });
});

describe("toChartMarks guards", () => {
  it("empty bars → []", () => {
    expect(toChartMarks(episodeMarks(EP), [], true)).toEqual([]);
    expect(toChartMarks(episodeMarks(EP), [], false)).toEqual([]);
  });

  it("mixed bar types → []", () => {
    const marks = episodeMarks(EP);
    expect(toChartMarks(marks, ["2026-10-02"], true)).toEqual([]);
    expect(toChartMarks(marks, [Date.UTC(2026, 9, 2, 9, 30) / 1000], false)).toEqual([]);
  });
});

describe("chartMarkerSpecs", () => {
  it("uses chartTime for time and matches toMarkerSpecs tone styling", () => {
    const bars = ["2026-09-30", "2026-10-01", "2026-10-02"];
    const chartMarks = toChartMarks(episodeMarks(EP), bars, false);
    const palette: Record<MarkTone, string> = {
      flagged: "#f5a524",
      confirmed: "#26c281",
      observed: "#8a94a6",
      failed: "#f0566b",
      expired: "#8a94a6",
      resolved: "#5b8def",
    };
    const baseSpecs = toMarkerSpecs(chartMarks, palette, "en");
    const specs = chartMarkerSpecs(chartMarks, palette, "en");
    expect(specs).toHaveLength(chartMarks.length);
    for (let i = 0; i < specs.length; i++) {
      expect(specs[i].time).toBe(chartMarks[i].chartTime);
      expect(specs[i].text).toBe(baseSpecs[i].text);
      expect(specs[i].position).toBe(baseSpecs[i].position);
      expect(specs[i].shape).toBe(baseSpecs[i].shape);
    }
    const zhSpecs = chartMarkerSpecs(chartMarks, palette, "zh");
    expect(zhSpecs[0].text).toBe(chartMarks[0].text[1]);
  });
});
