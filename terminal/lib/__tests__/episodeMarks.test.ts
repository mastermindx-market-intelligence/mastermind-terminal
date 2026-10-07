import { describe, it, expect } from "vitest";
import {
  isoToUnixSeconds,
  episodeMarks,
  snapToBars,
  toMarkerSpecs,
  MARK_TEXT,
  type EpisodeMark,
  type MarkTone,
} from "@/lib/dislocations/episodeMarks";

const T_1435_UTC = Date.UTC(2026, 9, 5, 14, 35, 0) / 1000;
const T_1035_EDT = Date.UTC(2026, 9, 5, 14, 35, 0) / 1000;

describe("isoToUnixSeconds", () => {
  it("parses Z and offset forms to the same instant", () => {
    expect(isoToUnixSeconds("2026-10-05T14:35:00Z")).toBe(T_1435_UTC);
    expect(isoToUnixSeconds("2026-10-05T10:35:00-04:00")).toBe(T_1035_EDT);
  });

  it("accepts fractional seconds", () => {
    const withFrac = Math.floor(Date.UTC(2026, 9, 5, 14, 35, 0, 123) / 1000);
    expect(isoToUnixSeconds("2026-10-05T14:35:00.123456Z")).toBe(withFrac);
  });

  it("rejects naive, empty, number, null, garbage", () => {
    expect(isoToUnixSeconds("2026-10-05T14:35:00")).toBeNull();
    expect(isoToUnixSeconds("")).toBeNull();
    expect(isoToUnixSeconds(12345)).toBeNull();
    expect(isoToUnixSeconds(null)).toBeNull();
    expect(isoToUnixSeconds("not-a-date")).toBeNull();
  });
});

function ep(
  overrides: Partial<{
    episode_id: string;
    state: string;
    first_armed_at: string | null;
    candidate_at: string | null;
    last_observed_at: string | null;
  }> = {},
) {
  return {
    episode_id: "ep-test",
    state: "ARMED",
    first_armed_at: null,
    candidate_at: null,
    last_observed_at: null,
    ...overrides,
  };
}

describe("episodeMarks", () => {
  it("ARMED with only first_armed_at → one flagged", () => {
    const marks = episodeMarks(
      ep({ state: "ARMED", first_armed_at: "2026-10-05T14:00:00Z" }),
    );
    expect(marks).toHaveLength(1);
    expect(marks[0].tone).toBe("flagged");
    expect(marks[0].id).toBe("ep-test:flagged");
  });

  it("CANDIDATE with three ascending clocks → flagged, confirmed, observed", () => {
    const marks = episodeMarks(
      ep({
        state: "CANDIDATE",
        first_armed_at: "2026-10-05T14:00:00Z",
        candidate_at: "2026-10-05T14:10:00Z",
        last_observed_at: "2026-10-05T14:20:00Z",
      }),
    );
    expect(marks.map((m) => m.tone)).toEqual(["flagged", "confirmed", "observed"]);
    expect(marks.every((m) => m.id === `ep-test:${m.tone}`)).toBe(true);
    for (let i = 1; i < marks.length; i++) {
      expect(marks[i].at).toBeGreaterThan(marks[i - 1].at);
    }
  });

  it("candidate_at === last_observed_at → two marks, no observed", () => {
    const marks = episodeMarks(
      ep({
        state: "CANDIDATE",
        first_armed_at: "2026-10-05T14:00:00Z",
        candidate_at: "2026-10-05T14:10:00Z",
        last_observed_at: "2026-10-05T14:10:00Z",
      }),
    );
    expect(marks).toHaveLength(2);
    expect(marks.map((m) => m.tone)).toEqual(["flagged", "confirmed"]);
  });

  it("INVALIDATED → last tone failed", () => {
    const marks = episodeMarks(
      ep({
        state: "INVALIDATED",
        first_armed_at: "2026-10-05T14:00:00Z",
        last_observed_at: "2026-10-05T14:30:00Z",
      }),
    );
    expect(marks[marks.length - 1].tone).toBe("failed");
  });

  it("EXPIRED → expired", () => {
    const marks = episodeMarks(
      ep({
        state: "EXPIRED",
        last_observed_at: "2026-10-05T15:00:00Z",
      }),
    );
    expect(marks[0].tone).toBe("expired");
  });

  it("RESOLVED → resolved", () => {
    const marks = episodeMarks(
      ep({
        state: "RESOLVED",
        last_observed_at: "2026-10-05T15:00:00Z",
      }),
    );
    expect(marks[0].tone).toBe("resolved");
  });

  it("all null clocks → []", () => {
    expect(episodeMarks(ep())).toEqual([]);
  });

  it("skips naive timestamp among valid ones", () => {
    const marks = episodeMarks(
      ep({
        first_armed_at: "2026-10-05T14:00:00",
        candidate_at: "2026-10-05T14:10:00Z",
      }),
    );
    expect(marks).toHaveLength(1);
    expect(marks[0].tone).toBe("confirmed");
  });

  it("same-second flagged+confirmed → confirmed wins", () => {
    const marks = episodeMarks(
      ep({
        first_armed_at: "2026-10-05T14:10:00Z",
        candidate_at: "2026-10-05T14:10:00Z",
      }),
    );
    expect(marks).toHaveLength(1);
    expect(marks[0].tone).toBe("confirmed");
  });
});

describe("snapToBars", () => {
  const bar0 = Date.UTC(2026, 9, 5, 14, 0, 0) / 1000;
  const bar1 = bar0 + 300;
  const bar2 = bar0 + 600;

  it("snaps mark 90s after bar open to that bar", () => {
    const markAt = bar0 + 90;
    const marks: EpisodeMark[] = [
      { id: "e:flagged", at: markAt, tone: "flagged", text: MARK_TEXT.flagged },
    ];
    const out = snapToBars(marks, [bar0, bar1, bar2]);
    expect(out).toHaveLength(1);
    expect(out[0].at).toBe(bar0);
  });

  it("drops mark before first bar", () => {
    const marks: EpisodeMark[] = [
      { id: "e:flagged", at: bar0 - 1, tone: "flagged", text: MARK_TEXT.flagged },
    ];
    expect(snapToBars(marks, [bar0, bar1])).toEqual([]);
  });

  it("snaps mark after last bar to last bar", () => {
    const marks: EpisodeMark[] = [
      { id: "e:observed", at: bar2 + 999, tone: "observed", text: MARK_TEXT.observed },
    ];
    expect(snapToBars(marks, [bar0, bar1, bar2])[0].at).toBe(bar2);
  });

  it("collapses two marks on one bar to stronger tone", () => {
    const marks: EpisodeMark[] = [
      { id: "e:flagged", at: bar1, tone: "flagged", text: MARK_TEXT.flagged },
      { id: "e:failed", at: bar1 + 10, tone: "failed", text: MARK_TEXT.failed },
    ];
    const out = snapToBars(marks, [bar0, bar1, bar2]);
    expect(out).toHaveLength(1);
    expect(out[0].tone).toBe("failed");
    expect(out[0].at).toBe(bar1);
  });

  it("empty barTimes → []", () => {
    const marks: EpisodeMark[] = [
      { id: "e:flagged", at: bar0, tone: "flagged", text: MARK_TEXT.flagged },
    ];
    expect(snapToBars(marks, [])).toEqual([]);
  });

  it("does not mutate input marks", () => {
    const marks: EpisodeMark[] = [
      { id: "e:flagged", at: bar1 + 50, tone: "flagged", text: MARK_TEXT.flagged },
    ];
    const snapshot = JSON.stringify(marks);
    snapToBars(marks, [bar0, bar1]);
    expect(JSON.stringify(marks)).toBe(snapshot);
  });
});

describe("toMarkerSpecs", () => {
  const palette: Record<MarkTone, string> = {
    flagged: "#a",
    confirmed: "#b",
    observed: "#c",
    failed: "#d",
    expired: "#e",
    resolved: "#f",
  };

  const tones: MarkTone[] = [
    "flagged",
    "confirmed",
    "observed",
    "failed",
    "expired",
    "resolved",
  ];

  const expectedShape: Record<MarkTone, { position: string; shape: string }> = {
    flagged: { position: "belowBar", shape: "arrowUp" },
    confirmed: { position: "aboveBar", shape: "circle" },
    observed: { position: "belowBar", shape: "circle" },
    failed: { position: "aboveBar", shape: "arrowDown" },
    expired: { position: "aboveBar", shape: "square" },
    resolved: { position: "aboveBar", shape: "square" },
  };

  const marks: EpisodeMark[] = tones.map((tone, i) => ({
    id: `ep:${tone}`,
    at: 1000 + i,
    tone,
    text: MARK_TEXT[tone],
  }));

  it("maps position, shape, color, id, size, and lang-specific text", () => {
    const en = toMarkerSpecs(marks, palette, "en");
    const zh = toMarkerSpecs(marks, palette, "zh");
    expect(en).toHaveLength(tones.length);
    en.forEach((spec, i) => {
      const tone = tones[i];
      expect(spec.position).toBe(expectedShape[tone].position);
      expect(spec.shape).toBe(expectedShape[tone].shape);
      expect(spec.color).toBe(palette[tone]);
      expect(spec.id).toBe(marks[i].id);
      expect(spec.time).toBe(marks[i].at);
      expect(spec.size).toBe(1);
      expect(spec.text).toBe(MARK_TEXT[tone][0]);
      expect(zh[i].text).toBe(MARK_TEXT[tone][1]);
    });
  });
});
