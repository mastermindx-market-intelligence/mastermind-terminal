import { describe, expect, it } from "vitest";
import { ageLabel, freshnessLabel, nyMarketDate, readingDate, readingFreshness } from "@/lib/shared-shell/readingFreshness";

// Sunday 1 November 2026, 12:00 UTC = 07:00 in New York (EST after the 1 Nov DST change).
const SUNDAY = new Date("2026-11-01T12:00:00Z");

describe("readingFreshness", () => {
  it("uses the New York calendar, not UTC", () => {
    // 02:00 UTC on Saturday is still Friday evening in New York.
    expect(nyMarketDate(new Date("2026-10-31T02:00:00Z"))).toBe("2026-10-30");
    expect(readingDate("2026-10-31T02:00:00Z")).toBe("2026-10-30");
    expect(readingDate("2026-10-30T22:59:10Z")).toBe("2026-10-30");
  });

  it("treats a Friday close viewed on Sunday as the latest session", () => {
    expect(readingFreshness("2026-10-30", SUNDAY)).toEqual({ kind: "current", sessions: 0, days: 2 });
    expect(readingFreshness("2026-10-30T22:59:10Z", SUNDAY).kind).toBe("current");
  });

  it("counts the live 16 October strip as ten sessions old on 1 November", () => {
    const age = readingFreshness("2026-10-16", SUNDAY);
    expect(age).toEqual({ kind: "stale", sessions: 10, days: 16 });
    expect(freshnessLabel(age, "en")).toBe("10 sessions old — check source");
    expect(freshnessLabel(age, "zh")).toBe("已落后 10 个交易日，请核对来源");
    expect(ageLabel(age, "en")).toBe("16 days ago");
    expect(ageLabel(age, "zh")).toBe("16 天前");
  });

  it("marks one missing session as behind and absorbs no more than that", () => {
    const monday = new Date("2026-11-02T15:00:00Z");
    expect(readingFreshness("2026-10-29", monday)).toEqual({ kind: "behind", sessions: 1, days: 4 });
    expect(freshnessLabel(readingFreshness("2026-10-29", monday), "zh")).toBe("落后 1 个交易日");
    expect(readingFreshness("2026-10-28", monday).kind).toBe("stale");
    expect(readingFreshness("2026-11-02", monday)).toEqual({ kind: "current", sessions: 0, days: 0 });
  });

  it("never counts today's own session, which may still be open", () => {
    const tuesday = new Date("2026-11-03T15:00:00Z");
    expect(readingFreshness("2026-11-02", tuesday).kind).toBe("current");
    expect(ageLabel(readingFreshness("2026-11-02", tuesday), "en")).toBe("1 day ago");
  });

  it("counts today's session once it has closed at 16:00 New York", () => {
    // Monday 2 November: 15:59 and 16:01 EST are 20:59 and 21:01 UTC.
    expect(readingFreshness("2026-10-30", new Date("2026-11-02T20:59:00Z")).kind).toBe("current");
    expect(readingFreshness("2026-10-30", new Date("2026-11-02T21:01:00Z"))).toEqual({ kind: "behind", sessions: 1, days: 3 });
    expect(readingFreshness("2026-10-29", new Date("2026-11-02T21:01:00Z")).kind).toBe("stale");
    // A reading dated today is current all day, before and after the close.
    expect(readingFreshness("2026-11-02", new Date("2026-11-02T21:01:00Z")).kind).toBe("current");
    // A weekend has no session to close.
    expect(readingFreshness("2026-10-30", new Date("2026-11-01T22:00:00Z")).kind).toBe("current");
  });

  it("allows a reading one day ahead as current, and flags anything further ahead", () => {
    expect(readingFreshness("2026-11-02", SUNDAY)).toEqual({ kind: "current", sessions: 0, days: 0 });
    const ahead = readingFreshness("2026-11-05", SUNDAY);
    expect(ahead.kind).toBe("ahead");
    expect(freshnessLabel(ahead, "en")).toBe("Dated after today — check source");
    expect(freshnessLabel(ahead, "zh")).toBe("日期晚于今天，请核对来源");
    expect(ageLabel(ahead, "en")).toBeNull();
    expect(ageLabel(ahead, "zh")).toBeNull();
  });

  it.each([null, undefined, "", "16 Oct", "0000-01-01", "2026-02-30", "2026-13-01", 20261016, "2026-10-16T25:00Z", "2026-02-30T10:00Z"])(
    "never treats an unreadable date (%s) as current", value => {
      const age = readingFreshness(value, SUNDAY);
      expect(age.kind).toBe("undated");
      expect(freshnessLabel(age, "en")).toBe("Date unavailable");
      expect(freshnessLabel(age, "zh")).toBe("日期不可用");
      expect(ageLabel(age, "en")).toBeNull();
    });

  it("keeps the date of a zone-less timestamp instead of guessing a zone", () => {
    expect(readingDate("2026-10-16T23:30:00")).toBe("2026-10-16");
  });

  it("counts holidays from the exchange calendar, not from weekdays", () => {
    // July 3 2026 is closed (July 4 falls on a Saturday): a Thursday reading is one session
    // old after Monday's close, where a weekday count would already have called it stale.
    expect(readingFreshness("2026-07-02", new Date("2026-07-06T19:59:00Z"))).toEqual({ kind: "current", sessions: 0, days: 4 });
    expect(readingFreshness("2026-07-02", new Date("2026-07-06T20:01:00Z"))).toEqual({ kind: "behind", sessions: 1, days: 4 });
    expect(freshnessLabel(readingFreshness("2026-07-02", new Date("2026-07-06T20:01:00Z")), "en")).toBe("1 session old");
    // Good Friday, 3 April 2026.
    expect(readingFreshness("2026-04-02", new Date("2026-04-06T19:59:00Z")).kind).toBe("current");
    expect(readingFreshness("2026-04-02", new Date("2026-04-06T20:01:00Z"))).toEqual({ kind: "behind", sessions: 1, days: 4 });
    // The extraordinary 9 January 2025 closure: the reading stays current through that day.
    expect(readingFreshness("2025-01-08", new Date("2025-01-09T21:01:00Z")).kind).toBe("current");
    expect(readingFreshness("2025-01-08", new Date("2025-01-10T21:01:00Z"))).toEqual({ kind: "behind", sessions: 1, days: 2 });
    // The year roll: 1 January is a closure, not a missing session.
    expect(readingFreshness("2025-12-31", new Date("2026-01-02T20:59:00Z")).kind).toBe("current");
    expect(readingFreshness("2025-12-31", new Date("2026-01-02T21:01:00Z"))).toEqual({ kind: "behind", sessions: 1, days: 2 });
  });

  it("honours a shortened session's own close", () => {
    // Friday 27 November 2026 closes at 13:00 New York; Thanksgiving 26 November is closed.
    expect(readingFreshness("2026-11-25", new Date("2026-11-27T17:59:00Z"))).toEqual({ kind: "current", sessions: 0, days: 2 });
    expect(readingFreshness("2026-11-25", new Date("2026-11-27T18:00:00Z"))).toEqual({ kind: "behind", sessions: 1, days: 2 });
    // The same reading turns stale only once Monday 30 November itself has closed.
    expect(readingFreshness("2026-11-25", new Date("2026-11-30T20:00:00Z"))).toEqual({ kind: "behind", sessions: 1, days: 5 });
    expect(readingFreshness("2026-11-25", new Date("2026-11-30T21:01:00Z"))).toEqual({ kind: "stale", sessions: 2, days: 5 });
  });

  it("counts real completed sessions across quarter and leap-day boundaries", () => {
    // April 1/2 completed; Good Friday and the weekend do not add sessions.
    expect(readingFreshness("2026-03-31", new Date("2026-04-06T19:59:00Z"))).toEqual({ kind: "stale", sessions: 2, days: 6 });
    expect(readingFreshness("2026-03-31", new Date("2026-04-06T20:00:00Z"))).toEqual({ kind: "stale", sessions: 3, days: 6 });
    expect(readingFreshness("2024-02-28", new Date("2024-03-01T21:00:00Z"))).toEqual({ kind: "stale", sessions: 2, days: 2 });
  });

  it("reports unavailable instead of an invented count outside the projection's coverage", () => {
    const old = readingFreshness("2015-12-31", SUNDAY);
    expect(old).toEqual({ kind: "unavailable", sessions: null, days: 3958 });
    expect(freshnessLabel(old, "en")).toBe("Session age unavailable");
    expect(freshnessLabel(old, "zh")).toBe("交易日时效不可用");
    expect(ageLabel(old, "en")).toBe("3958 days ago");
    expect(ageLabel(old, "zh")).toBe("3958 天前");
    // A far-past date answers promptly from the calendar age alone, without walking the range.
    expect(readingFreshness("0001-01-01", SUNDAY)).toEqual({ kind: "unavailable", sessions: null, days: 739920 });
    // Calendar coverage does not erase a known future-date error.
    expect(readingFreshness("2029-06-01", SUNDAY).kind).toBe("ahead");
    // Session coverage does not prevent calculating calendar-day age.
    const futureNow = new Date("2030-06-01T12:00:00Z");
    expect(readingFreshness("2026-10-16", futureNow)).toEqual({ kind: "unavailable", sessions: null, days: 1324 });
    expect(ageLabel(readingFreshness("2026-10-16", futureNow), "en")).toBe("1324 days ago");
    expect(freshnessLabel(readingFreshness("2026-10-16", futureNow), "zh")).toBe("交易日时效不可用");
    expect(readingFreshness("2030-06-01", futureNow)).toEqual({ kind: "unavailable", sessions: null, days: 0 });
    expect(readingFreshness("2029-01-01", new Date("2028-12-31T12:00:00Z"))).toEqual({ kind: "unavailable", sessions: null, days: 0 });
  });

  it("uses covered boundary dates without inventing sessions outside them", () => {
    expect(readingFreshness("2016-01-01", new Date("2016-01-04T21:00:00Z"))).toEqual({ kind: "behind", sessions: 1, days: 3 });
    expect(readingFreshness("2028-12-29", new Date("2028-12-31T12:00:00Z"))).toEqual({ kind: "current", sessions: 0, days: 2 });
  });
  it("does not throw or imply today when the reader clock is invalid", () => {
    const age = readingFreshness("2026-10-16", new Date(NaN));
    expect(age).toEqual({ kind: "unavailable", sessions: null, days: null });
    expect(ageLabel(age, "en")).toBeNull();
    expect(freshnessLabel(age, "en")).toBe("Session age unavailable");
  });
});
