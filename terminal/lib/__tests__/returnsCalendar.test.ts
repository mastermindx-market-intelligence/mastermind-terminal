import { describe, expect, it } from "vitest";
import {
  buildReturnsCalendarSessions,
  previousCalendarDate,
  returnsCalendarDayKey,
} from "../returnsCalendar";

type Bar6 = [number, number, number, number, number, number];
const t = (h: number, m = 0) => Date.UTC(2026, 9, 14, h, m) / 1000;
const p = (h: number, m = 0) => Date.UTC(2026, 9, 13, h, m) / 1000;
const bar = (ts: number, o: number, h: number, l: number, c: number): Bar6 => [ts, o, h, l, c, 100];

describe("returns calendar session partitioning", () => {
  it("assigns the prior evening and current early bars to one overnight trading-date range", () => {
    const previous = [bar(p(20), 100, 103, 99, 102), bar(p(23), 102, 104, 101, 103)];
    const current = [
      bar(t(2), 103, 105, 102, 104),
      bar(t(4), 104, 106, 103, 105),
      bar(t(9, 30), 105, 110, 104, 109),
      bar(t(16), 109, 111, 108, 110),
    ];
    const sessions = buildReturnsCalendarSessions(current, previous);

    expect(sessions.find((s) => s.key === "overnight")).toMatchObject({
      low: 99, high: 105, open: 100, close: 104, barCount: 3,
    });
    expect(sessions.find((s) => s.key === "pre")).toMatchObject({ low: 103, high: 106, barCount: 1 });
    expect(sessions.find((s) => s.key === "regular")).toMatchObject({ low: 104, high: 110, barCount: 1 });
    expect(sessions.find((s) => s.key === "post")).toMatchObject({ low: 108, high: 111, barCount: 1 });
  });

  it("keeps an unavailable session null instead of estimating a range", () => {
    const sessions = buildReturnsCalendarSessions([bar(t(10), 100, 101, 99, 100.5)], []);
    expect(sessions.find((s) => s.key === "overnight")).toMatchObject({
      low: null, high: null, open: null, close: null, ret: null, barCount: 0,
    });
  });

  it("uses half-open boundaries so a bar cannot belong to two sessions", () => {
    const current = [
      bar(t(3, 59), 100, 100, 100, 100),
      bar(t(4), 101, 101, 101, 101),
      bar(t(9, 29), 102, 102, 102, 102),
      bar(t(9, 30), 103, 103, 103, 103),
      bar(t(15, 59), 104, 104, 104, 104),
      bar(t(16), 105, 105, 105, 105),
      bar(t(19, 59), 106, 106, 106, 106),
      bar(t(20), 107, 107, 107, 107),
    ];
    const sessions = buildReturnsCalendarSessions(current, []);
    expect(sessions.find((s) => s.key === "overnight")?.barCount).toBe(1);
    expect(sessions.find((s) => s.key === "pre")?.barCount).toBe(2);
    expect(sessions.find((s) => s.key === "regular")?.barCount).toBe(2);
    expect(sessions.find((s) => s.key === "post")?.barCount).toBe(2);
  });

  it("normalizes daily keys and calendar-date rollover deterministically", () => {
    expect(returnsCalendarDayKey("2026-10-14T16:00:00Z")).toBe("2026-10-14");
    expect(returnsCalendarDayKey(Date.UTC(2026, 9, 14) / 1000)).toBe("2026-10-14");
    expect(previousCalendarDate("2026-10-01")).toBe("2026-09-30");
  });
});
