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

  it.each([null, undefined, "", "16 Oct", "2026-02-30", "2026-13-01", 20261016, "2026-10-16T25:00Z", "2026-02-30T10:00Z"])(
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
});
