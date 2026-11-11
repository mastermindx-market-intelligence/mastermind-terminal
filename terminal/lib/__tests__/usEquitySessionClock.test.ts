import { describe, expect, it } from "vitest";
import { usCompletedSessionsAfterDate, usRegularSessionWindow } from "../usEquitySessionClock";
import { filterUsEquitySession, resampleUsEquitySession, type Bar6 } from "../intradayShared";
import projection from "../usEquitySessionProjection.json";

const at = (day: string, minute: number, value = 100): Bar6 =>
  [Date.parse(`${day}T00:00:00Z`) / 1000 + minute * 60, value, value + 1, value - 1, value, 10];
const fiveMinuteTape = (day: string, end: number): Bar6[] =>
  Array.from({ length: (end - 570) / 5 }, (_, i) => at(day, 570 + i * 5, 100 + i));

describe("existing calendar projection", () => {
  it.each(["2025-11-28", "2026-11-27", "2026-12-24"])("knows the shortened session %s", day => {
    expect(usRegularSessionWindow(at(day, 570)[0])).toEqual([570, 780]);
  });
  it.each(["2026-07-03", "2025-01-09", "2026-09-12", "2026-09-13"])("knows full closure %s", day => {
    expect(usRegularSessionWindow(at(day, 570)[0])).toBeNull();
    expect(filterUsEquitySession([at(day, 570), at(day, 600)], "regular")).toEqual([]);
  });
  it.each(["2026-03-06", "2026-03-09", "2025-10-31", "2025-11-03"])("retains local clock across DST %s", day => {
    expect(usRegularSessionWindow(at(day, 570)[0])).toEqual([570, 960]);
  });
  it.each([NaN, Infinity, -Infinity, Date.parse("2015-12-31T12:00:00Z") / 1000,
    Date.parse("2029-01-01T12:00:00Z") / 1000])("refuses unknown time rather than assuming 16:00", epoch => {
    expect(() => usRegularSessionWindow(epoch)).toThrow("US_SESSION_CLOCK_UNAVAILABLE");
  });
  it("returns an immutable session window", () => {
    const window = usRegularSessionWindow(at("2025-11-28", 570)[0]);
    expect(Object.isFrozen(window)).toBe(true);
  });
});

describe("regular candles obey the actual close", () => {
  it("excludes the 13:00 sentinel that contaminated the real early-close path", () => {
    const day = "2025-11-28";
    const raw = [...fiveMinuteTape(day, 780), at(day, 780, 99999), at(day, 810, 99999)];
    const selected = filterUsEquitySession(raw, "regular");
    expect(selected).toHaveLength(42);
    const bars = resampleUsEquitySession(selected, 240, "regular");
    expect(bars).toEqual([[at(day, 570)[0], 100, 142, 99, 141, 420]]);
  });
  it("cannot bypass close filtering by calling the resampler directly", () => {
    const day = "2025-11-28";
    const raw = [...fiveMinuteTape(day, 780), at(day, 780, 99999)];
    expect(resampleUsEquitySession(raw, 240, "regular"))
      .toEqual([[at(day, 570)[0], 100, 142, 99, 141, 420]]);
    expect(resampleUsEquitySession(raw, 1, "regular")).toHaveLength(42);
  });
  it("retains two correct 4H candles in an ordinary session", () => {
    const day = "2026-03-09";
    const bars = resampleUsEquitySession([...fiveMinuteTape(day, 960), at(day, 960, 99999)], 240, "regular");
    expect(bars).toEqual([
      [at(day, 570)[0], 100, 148, 99, 147, 480],
      [at(day, 810)[0], 148, 178, 147, 177, 300],
    ]);
  });
  it("does not fabricate bars when a session has no prints", () => {
    expect(resampleUsEquitySession([], 240, "regular")).toEqual([]);
    expect(resampleUsEquitySession([at("2026-07-03", 600)], 240, "regular")).toEqual([]);
  });
  it("does not mutate inputs and is independent of other sessions", () => {
    const a = fiveMinuteTape("2025-11-28", 780);
    const b = fiveMinuteTape("2025-12-01", 960);
    const combined = [...a, ...b];
    const before = JSON.stringify(combined);
    expect(resampleUsEquitySession(combined, 240, "regular"))
      .toEqual([...resampleUsEquitySession(a, 240, "regular"), ...resampleUsEquitySession(b, 240, "regular")]);
    expect(JSON.stringify(combined)).toBe(before);
  });
  it("does not silently truncate history beyond the calendar coverage", () => {
    const raw = [at("2015-12-31", 600), at("2026-03-09", 600)];
    expect(() => filterUsEquitySession(raw, "regular")).toThrow("US_SESSION_CLOCK_UNAVAILABLE");
  });
  it("leaves the extended-session window unchanged", () => {
    const day = "2025-11-28";
    const raw = [at(day, 239), at(day, 240), at(day, 780), at(day, 1199), at(day, 1200)];
    expect(filterUsEquitySession(raw, "extended")).toEqual([raw[1], raw[2], raw[3]]);
  });
  it("conserves admitted volume across every projected session", () => {
    expect(Object.keys(projection.sessions)).toHaveLength(3267);
    for (const [day, window] of Object.entries(projection.sessions)) {
      const raw = [...fiveMinuteTape(day, window[1]), at(day, window[1], 99999)];
      const result = resampleUsEquitySession(raw, 240, "regular");
      expect(result.reduce((n, row) => n + row[5], 0), day).toBe((window[1] - window[0]) * 2);
      expect(result.map(row => row[0]), day).toEqual(window[1] === 780
        ? [at(day, 570)[0]] : [at(day, 570)[0], at(day, 810)[0]]);
    }
  });
});

describe("completed session counts", () => {
  // ET wall-clock as a display epoch: the date at midnight plus the minutes since.
  const display = (day: string, minute: number): number => Date.parse(`${day}T00:00:00Z`) / 1000 + minute * 60;

  it("counts sessions strictly after the reading, through today's projected close", () => {
    // Ten sessions after 16 October, viewed on a Sunday that has no session of its own.
    expect(usCompletedSessionsAfterDate("2026-10-16", display("2026-11-01", 700))).toBe(10);
    // A reading dated today is never behind itself, even after the close.
    expect(usCompletedSessionsAfterDate("2026-11-27", display("2026-11-27", 1_000))).toBe(0);
    expect(usCompletedSessionsAfterDate("2026-11-25", display("2026-11-30", 600))).toBe(1);
    expect(usCompletedSessionsAfterDate("2026-11-25", display("2026-11-30", 960))).toBe(2);
  });

  it("closes each day at its own projected minute, not an assumed 16:00", () => {
    // 27 November 2026 closes at 13:00; one minute either side decides the count.
    expect(usCompletedSessionsAfterDate("2026-11-25", display("2026-11-27", 779))).toBe(0);
    expect(usCompletedSessionsAfterDate("2026-11-25", display("2026-11-27", 780))).toBe(1);
    // An ordinary 6 July 2026 closes at 16:00.
    expect(usCompletedSessionsAfterDate("2026-07-02", display("2026-07-06", 959))).toBe(0);
    expect(usCompletedSessionsAfterDate("2026-07-02", display("2026-07-06", 960))).toBe(1);
  });

  it("returns zero for a covered reading dated later than today", () => {
    expect(usCompletedSessionsAfterDate("2026-11-30", display("2026-11-02", 600))).toBe(0);
  });

  it.each(["2015-12-31", "2029-01-01", "0001-01-01", "2026-02-30", "16 Oct"])(
    "refuses an invalid or uncovered reading date %s", reading => {
      expect(() => usCompletedSessionsAfterDate(reading, display("2026-11-02", 600)))
        .toThrow("US_SESSION_CLOCK_UNAVAILABLE");
    });

  it.each([NaN, Infinity, -Infinity, display("2029-01-01", 600), display("2015-12-31", 600)])(
    "refuses an invalid or uncovered current moment %s", epoch => {
      expect(() => usCompletedSessionsAfterDate("2026-10-16", epoch))
        .toThrow("US_SESSION_CLOCK_UNAVAILABLE");
    });
});
