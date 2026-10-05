import { describe, expect, it } from "vitest";
import {
  buildReturnsCalendarSessions,
  previousCalendarDate,
  returnsCalendarDayKey,
} from "./ReturnsCalendar";

type Bar6 = [number, number, number, number, number, number];
const t = (h: number, m = 0) => Date.UTC(2026, 9, 14, h, m) / 1000;
const p = (h: number, m = 0) => Date.UTC(2026, 9, 13, h, m) / 1000;
const bar = (ts: number, o: number, h: number, l: number, c: number): Bar6 => [ts, o, h, l, c, 100];

describe("ReturnsCalendar session partitioning", () => {
  it("assigns the prior evening and current early bars to one overnight trading-date range", () => {
    const previous = [bar(p(20), 100, 103, 99, 102), bar(p(23), 102, 104, 101, 103)];
    const current = [
      bar(t(2), 103, 105, 102, 104),
      bar(t(4), 104, 106, 103, 105),
      bar(t(9, 30), 105, 110, 104, 109),
      bar(t(16), 109, 111, 108, 110),
    ];
    const sessions = buildReturnsCalendarSessions(current, previous);
    const overnight = sessions.find((s) => s.key === "overnight");
    const pre = sessions.find((s) => s.key === "pre");
    const regular = sessions.find((s) => s.key === "regular");
    const post = sessions.find((s) => s.key === "post");

    expect(overnight).toMatchObject({ low: 99, high: 105, open: 100, close: 104, barCount: 3 });
    expect(pre).toMatchObject({ low: 103, high: 106, barCount: 1 });
    expect(regular).toMatchObject({ low: 104, high: 110, barCount: 1 });
    expect(post).toMatchObject({ low: 108, high: 111, barCount: 1 });
  });

  it("keeps an unavailable session null instead of estimating a range", () => {
    const sessions = buildReturnsCalendarSessions([bar(t(10), 100, 101, 99, 100.5)], []);
    expect(sessions.find((s) => s.key === "overnight")).toMatchObject({
      low: null, high: null, open: null, close: null, ret: null, barCount: 0,
    });
  });

  it("normalizes daily keys and calendar-date rollover deterministically", () => {
    expect(returnsCalendarDayKey("2026-10-14T16:00:00Z")).toBe("2026-10-14");
    expect(returnsCalendarDayKey(Date.UTC(2026, 9, 14) / 1000)).toBe("2026-10-14");
    expect(previousCalendarDate("2026-10-01")).toBe("2026-09-30");
  });
});
