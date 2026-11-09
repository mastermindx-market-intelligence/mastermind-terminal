import { describe, expect, it } from "vitest";
import {
  calendarCandleClose,
  calendarCandleCloseDisplay,
  candleCountdownSeconds,
  exchangeWallCloseUtc,
  intradayCandleWindow,
} from "@/lib/candleCalendar";

/** DISPLAY epoch: a "YYYY-MM-DD hh:mm" wall clock read as if UTC. */
const at = (date: string, hh: number, mm: number) => Date.parse(`${date}T00:00:00Z`) / 1000 + hh * 3600 + mm * 60;
const wall = (date: string, hh: number, mm: number) =>
  Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), hh, mm, 0) / 1000;

describe("exchangeWallCloseUtc", () => {
  it("measures the DST hour instead of assuming -5", () => {
    // 16:00 on a summer day is 20:00Z; the same wall clock in winter is 21:00Z.
    expect(exchangeWallCloseUtc("America/New_York", "2026-07-15", 16 * 60)).toBe(wall("2026-07-15", 20, 0));
    expect(exchangeWallCloseUtc("America/New_York", "2026-01-15", 16 * 60)).toBe(wall("2026-01-15", 21, 0));
  });

  it("fails null on a wall time the zone skips, instead of inventing one", () => {
    // America/New_York jumps 02:00 → 03:00 on 2026-03-08: 02:30 does not exist that day.
    expect(exchangeWallCloseUtc("America/New_York", "2026-03-08", 2 * 60 + 30)).toBeNull();
    expect(exchangeWallCloseUtc("America/New_York", "2026-03-08", 16 * 60)).toBe(wall("2026-03-08", 20, 0));
  });

  it("rejects a malformed date rather than coercing it", () => {
    expect(exchangeWallCloseUtc("America/New_York", "2026-02-30", 16 * 60)).toBeNull();
    expect(exchangeWallCloseUtc("America/New_York", "not-a-date", 16 * 60)).toBeNull();
  });
});

describe("intradayCandleWindow — US", () => {
  it("ends the 13:30 four-hour bar at the ACTUAL 16:00 close", () => {
    const start = at("2026-10-21", 13, 30);
    expect(intradayCandleWindow(start, "4h", "us", "regular")).toEqual({
      start,
      end: at("2026-10-21", 16, 0),
    });
    // A print inside the candle answers that candle, not a new one.
    expect(intradayCandleWindow(at("2026-10-21", 15, 10), "4h", "us", "regular")).toEqual({
      start,
      end: at("2026-10-21", 16, 0),
    });
  });

  it("ends a wide bar at an early close, and has no bar after it", () => {
    // 2025-11-28 is [570, 780] in the canonical projection: the session ends at 13:00.
    expect(intradayCandleWindow(at("2025-11-28", 9, 30), "4h", "us", "regular"))
      .toEqual({ start: at("2025-11-28", 9, 30), end: at("2025-11-28", 13, 0) });
    // 13:30 that day is past the close, so no regular candle owns it.
    expect(intradayCandleWindow(at("2025-11-28", 13, 30), "4h", "us", "regular")).toBeNull();
  });

  it("keeps the extended policy at 04:00–20:00", () => {
    const start = at("2026-10-21", 16, 0);
    expect(intradayCandleWindow(start, "4h", "us", "extended")).toEqual({ start, end: at("2026-10-21", 20, 0) });
  });

  it("answers null on a holiday and outside projection coverage", () => {
    expect(intradayCandleWindow(at("2026-11-26", 13, 30), "4h", "us", "regular")).toBeNull(); // Thanksgiving
    expect(intradayCandleWindow(at("2030-01-02", 13, 30), "4h", "us", "regular")).toBeNull(); // past 2028-12-31
  });

  it("clips a 24h candle at the session phase boundary", () => {
    const open = at("2026-10-20", 4, 0);
    expect(intradayCandleWindow(open, "12h", "us", "24h")).toEqual({ start: open, end: at("2026-10-20", 9, 30) });
  });
});

describe("intradayCandleWindow — HK", () => {
  it("anchors to the segment open, not the absolute hour", () => {
    expect(intradayCandleWindow(at("2026-10-21", 9, 45), "1h", "hk", "regular")).toEqual({
      start: at("2026-10-21", 9, 30),
      end: at("2026-10-21", 10, 30),
    });
  });

  it("folds a 12:30 lunch print into the last morning candle", () => {
    // No lunch stub: the print belongs to the 11:30 candle, which ends when the break starts.
    expect(intradayCandleWindow(at("2026-10-21", 12, 30), "30m", "hk", "regular")).toEqual({
      start: at("2026-10-21", 11, 30),
      end: at("2026-10-21", 12, 0),
    });
  });

  it("does not span the break into the afternoon", () => {
    expect(intradayCandleWindow(at("2026-10-21", 13, 10), "4h", "hk", "regular")).toEqual({
      start: at("2026-10-21", 13, 0),
      end: at("2026-10-21", 16, 0),
    });
  });
});

describe("intradayCandleWindow — CN / CA preserve the absolute grid", () => {
  it("clips a CN bar that overlaps a real session end", () => {
    const start = at("2026-10-21", 11, 0);
    expect(intradayCandleWindow(start, "1h", "cn", "regular")).toEqual({ start, end: at("2026-10-21", 11, 30) });
  });

  it("leaves a CN bar that sits wholly in the lunch break exactly on the grid", () => {
    const start = at("2026-10-21", 12, 0);
    expect(intradayCandleWindow(start, "1h", "cn", "regular")).toEqual({ start, end: at("2026-10-21", 13, 0) });
  });

  it("gives CA the absolute grid and no borrowed US session", () => {
    // 09:45 buckets to 09:00 — the US rule anchors regular candles at 09:30, and CA never borrows it.
    expect(intradayCandleWindow(at("2026-10-21", 9, 45), "1h", "ca", "regular"))
      .toEqual({ start: at("2026-10-21", 9, 0), end: at("2026-10-21", 10, 0) });
    // A wide CA bar keeps the untouched absolute grid.
    expect(intradayCandleWindow(at("2026-10-21", 13, 30), "4h", "ca", "regular"))
      .toEqual({ start: at("2026-10-21", 12, 0), end: at("2026-10-21", 16, 0) });
  });
});

describe("calendarCandleClose — US daily", () => {
  it("returns the true UTC close for a plain session day", () => {
    expect(calendarCandleClose("2026-10-21", "D", "us")).toBe(wall("2026-10-21", 20, 0));
    expect(calendarCandleCloseDisplay("2026-10-21", "D", "us")).toBe(at("2026-10-21", 16, 0));
  });

  it("uses the early close the projection actually publishes", () => {
    expect(calendarCandleClose("2025-11-28", "D", "us")).toBe(wall("2025-11-28", 18, 0));
  });

  it("returns null on a closure and outside coverage", () => {
    expect(calendarCandleClose("2026-12-25", "D", "us")).toBeNull();
    expect(calendarCandleClose("2030-01-02", "D", "us")).toBeNull();
  });
});

describe("calendarCandleClose — W and 2W", () => {
  it("resolves the end of a forming week from its last observed session", () => {
    // The week of 2026-10-19 ends on Friday the 23rd; the 21st is mid-week.
    expect(calendarCandleClose("2026-10-23", "W", "us")).toBe(wall("2026-10-23", 20, 0));
    expect(calendarCandleClose("2026-10-21", "W", "us")).toBe(wall("2026-10-23", 20, 0));
  });

  it("keeps W and 2W on one grid but distinct groupings", () => {
    // Both weeks of 2026-10-19/10-26 sit in the same fortnight, so 2026-10-21 keys a W bar and
    // not a 2W bar; only the fortnight's own last session keys the 2W one.
    expect(calendarCandleClose("2026-10-21", "W", "us")).toBe(wall("2026-10-23", 20, 0));
    expect(calendarCandleClose("2026-10-23", "2W", "us")).toBe(wall("2026-10-23", 20, 0));
    expect(calendarCandleClose("2026-11-06", "2W", "us")).toBe(wall("2026-11-06", 21, 0)); // EST
  });
});

describe("calendarCandleClose — 1M", () => {
  it("answers only the last trading session of the month", () => {
    expect(calendarCandleClose("2026-10-30", "1M", "us")).toBe(wall("2026-10-30", 20, 0)); // Fri, month end
    expect(calendarCandleClose("2026-10-21", "1M", "us")).toBe(wall("2026-10-30", 20, 0));
  });

  it("steps back over a weekend and over a holiday to the real month end", () => {
    expect(calendarCandleClose("2026-05-31", "1M", "us")).toBeNull(); // Sunday
    expect(calendarCandleClose("2026-05-29", "1M", "us")).toBe(wall("2026-05-29", 20, 0));
    expect(calendarCandleClose("2026-12-25", "1M", "us")).toBeNull(); // Christmas, a Friday
    expect(calendarCandleClose("2026-12-31", "1M", "us")).toBe(wall("2026-12-31", 21, 0)); // EST
  });
});

describe("calendarCandleClose — 2D / 3D global session grid", () => {
  const dailyTimes = ["2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06", "2026-10-07"];
  // Sits on row 1 with index 7, so barAnchor is 6: row 0 is global 6.
  const anchor = { date: "2026-10-02", index: 7, basis: "ipo" };

  it("groups from the published anchor, not floor(i/mult)", () => {
    // Row 1 is global 7, and 7 % 3 === 1, so that bar runs 10-02, 10-05, 10-06. `floor(i / 3)`
    // would have merged it with row 0 — a different grid in a different phase.
    expect(calendarCandleClose("2026-10-02", "3D", "us", { dailyTimes, publishedSessionAnchor: anchor }))
      .toBe(wall("2026-10-06", 20, 0));
  });

  it("closes the forced first partial inside its own session", () => {
    // Row 0 is global 6, and 6 % 2 === 0 — the one bar that completes on the session it opens.
    expect(calendarCandleClose("2026-10-01", "2D", "us", { dailyTimes, publishedSessionAnchor: anchor }))
      .toBe(wall("2026-10-01", 20, 0));
  });

  it("closes a normal bar on the session after the one before its next open", () => {
    // Row 1 is global 7; 7 % 2 === 1, so it takes exactly one more session.
    expect(calendarCandleClose("2026-10-02", "2D", "us", { dailyTimes, publishedSessionAnchor: anchor }))
      .toBe(wall("2026-10-05", 20, 0));
  });

  it("walks the projection once the held feed runs out", () => {
    // Row 4 is global 10; 10 % 3 === 1, so it needs 10-08 and 10-09 from the canonical projection.
    expect(calendarCandleClose("2026-10-07", "3D", "us", { dailyTimes, publishedSessionAnchor: anchor }))
      .toBe(wall("2026-10-09", 20, 0));
  });

  it("returns null without the session sequence it cannot guess", () => {
    expect(calendarCandleClose("2026-10-01", "3D", "us")).toBeNull();
    // Row 2 is not a 3D bar opening, so it keys no 3D bar.
    expect(calendarCandleClose("2026-10-05", "3D", "us", { dailyTimes, publishedSessionAnchor: anchor })).toBeNull();
  });
});

describe("calendarCandleClose — crypto", () => {
  it("uses the UTC 24h day", () => {
    expect(calendarCandleClose("2026-10-21", "D", "crypto")).toBe(wall("2026-10-22", 0, 0));
  });

  it("groups calendar units over a 24/7 calendar", () => {
    expect(calendarCandleClose("2026-10-31", "1M", "crypto")).toBe(wall("2026-11-01", 0, 0));
    expect(calendarCandleClose("2026-10-21", "1M", "crypto")).toBe(wall("2026-11-01", 0, 0));
  });
});

describe("calendarCandleClose — CA does not borrow the US calendar", () => {
  it("returns null for a date it cannot prove traded", () => {
    expect(calendarCandleClose("2026-10-21", "D", "ca")).toBeNull();
  });

  it("answers the observed session it is handed, in Toronto wall time", () => {
    expect(calendarCandleClose("2026-10-21", "D", "ca", { dailyTimes: ["2026-10-20", "2026-10-21"], sessionCloseMinutes: { "2026-10-21": 960 } }))
      .toBe(wall("2026-10-21", 20, 0));
  });

  it("keeps a CA holiday unknown even when a US session exists that day", () => {
    // 2026-12-25 is closed in both markets; CA is never answered from the US projection.
    expect(calendarCandleClose("2026-12-24", "D", "ca", { dailyTimes: ["2026-12-24"] })).toBeNull();
  });
});

describe("candleCountdownSeconds", () => {
  it("floors at zero and never fabricates a candle", () => {
    expect(candleCountdownSeconds(at("2026-10-21", 16, 0), at("2026-10-21", 15, 30))).toBe(1800);
    expect(candleCountdownSeconds(at("2026-10-21", 16, 0), at("2026-10-21", 16, 30))).toBe(0);
  });
});


describe("forming period and session boundary regressions",()=>{
  it("keeps the fortnight distinct from a single week",()=>{
    expect(calendarCandleClose("2026-10-12","W","us")).toBe(wall("2026-10-16",20,0));
    expect(calendarCandleClose("2026-10-12","2W","us")).toBe(wall("2026-10-23",20,0));
  });
  it("uses the last real session, including Thanksgiving's early close",()=>{
    expect(calendarCandleClose("2026-11-23","W","us")).toBe(wall("2026-11-27",18,0));
    expect(calendarCandleClose("2026-10-21","3M","us")).toBe(wall("2026-12-31",21,0));
  });
  it("does not infer an exchange period end from sparse observed days",()=>{
    expect(calendarCandleClose("2026-10-21","W","hk",{dailyTimes:["2026-10-21","2026-10-26"]})).toBeNull();
    expect(calendarCandleClose("2028-12-29","2W","us")).toBe(wall("2028-12-29",21,0));
  });
  it("clips a CN absolute-grid afternoon bucket at 15:00",()=>{
    expect(intradayCandleWindow(at("2026-10-21",13,10),"4h","cn","regular"))
      .toEqual({start:at("2026-10-21",12,0),end:at("2026-10-21",15,0)});
  });
  it("preserves the session grid when the history slice is shortened",()=>{
    const publishedSessionAnchor={date:"2026-10-02",index:7};
    const dailyTimes=["2026-10-01","2026-10-02","2026-10-05","2026-10-06"];
    expect(calendarCandleClose("2026-10-02","3D","us",{dailyTimes:dailyTimes.slice(1),publishedSessionAnchor}))
      .toBe(calendarCandleClose("2026-10-02","3D","us",{dailyTimes,publishedSessionAnchor}));
  });
});
