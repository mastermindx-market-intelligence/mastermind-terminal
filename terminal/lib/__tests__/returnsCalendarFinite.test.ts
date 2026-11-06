import { describe, expect, it } from "vitest";
import {
  buildDailyReturnRecords, buildReturnsCalendarSessions, dailyReturnQuality,
  serializeReturnsMonth, summarizeReturnMonth,
} from "../returnsCalendar";
import { parseReturnsStudy } from "../returnsCalendarStudy";
import type { Bar } from "../fund";
import type { Bar6 } from "../intradayShared";

const daily = (time: string, close: number, open = close): Bar =>
  ({ time, o: open, h: Math.max(open, close), l: Math.min(open, close), c: close, v: 10 });
const overflow = [
  { name: "ratio overflow", reference: 1e-308, close: 1e308 },
  { name: "percentage conversion overflow", reference: 1, close: 1e307 },
];

describe("Returns finite calculation boundaries", () => {
  it.each(overflow)("withholds an overflowed daily and monthly return: $name", ({ reference, close }) => {
    const records = buildDailyReturnRecords([
      daily("2026-09-30", reference), daily("2026-10-01", close),
    ]);
    expect(records).toHaveLength(2);
    expect(records[1]).toMatchObject({
      previousDate: "2026-09-30", previousClose: reference, returnPct: null,
      bar: { o: close, h: close, l: close, c: close }, gapCalendarDays: 0,
    });
    expect(summarizeReturnMonth(records, "2026-10")).toMatchObject({
      referenceDate: "2026-09-30", referenceClose: reference, endDate: "2026-10-01",
      endClose: close, returnPct: null, observedDays: 1,
      upDays: 0, downDays: 0, flatDays: 0, best: null, worst: null,
    });
    expect(dailyReturnQuality(records[1])).toBe("unavailable_return");
  });

  it.each(overflow)("retains every session's observed OHLC while withholding $name", ({ reference, close }) => {
    const day = Date.parse("2026-10-14T00:00:00Z") / 1000;
    const at = (minute: number, price: number): Bar6 =>
      [day + minute * 60, price, price, price, price, 10];
    const previous = [at(-240, reference)];
    const current = [
      at(120, close), at(240, reference), at(270, close),
      at(570, reference), at(600, close), at(960, reference), at(990, close),
    ];
    const sessions = buildReturnsCalendarSessions(current, previous, [570, 960], 1200);
    expect(sessions.map(s => s.key)).toEqual(["overnight", "pre", "regular", "post"]);
    for (const session of sessions) {
      expect(session).toMatchObject({
        open: reference, close, low: reference, high: close, barCount: 2, ret: null,
      });
    }
  });

  it.each(overflow)("keeps the actual study consumer finite for $name", ({ reference, close }) => {
    const day = Date.parse("2026-10-14T00:00:00Z") / 1000;
    const bars: Bar6[] = [
      [day + 570 * 60, reference, reference, reference, reference, 10],
      [day + 600 * 60, close, close, close, close, 10],
    ];
    const parsed = parseReturnsStudy({
      t: "AAPL", tf: "30m", session_date: "2026-10-14", bars,
      source_evidence: {
        schema: "terminal.intraday_source_evidence.v1", authority: "descriptive_only",
        symbol: "AAPL", requested_timeframe: "30m", session: "24h",
        timestamp_basis: "market_local_display_epoch",
        response_scope: { requested_date: "2026-10-14", returned_bars: 2 },
      },
      regular_session_window: { start_minute: 570, end_minute: 960, post_end_minute: 1200 },
      session_study_evidence: { source: "canonical-daytime", status: "available", bars: 2 },
    }, "AAPL", "2026-10-14");
    expect(parsed.ok).toBe(true);
    expect(parsed.daytimeStatus).toBe("available");
    expect(parsed.sessions.find(s => s.key === "regular")).toMatchObject({
      open: reference, close, low: reference, high: close, barCount: 2, ret: null,
    });
  });

  it("counts only finite observations while retaining actual zero and deterministic best/worst", () => {
    const records = buildDailyReturnRecords([
      daily("2026-09-30", 100), daily("2026-10-01", 100),
      daily("2026-10-02", 110), daily("2026-10-03", 99),
    ]);
    const invalid = [Infinity, -Infinity, NaN, null].map((returnPct, i) => ({
      ...records[3], date: "2026-10-0" + (i + 4), returnPct,
    }));
    const summary = summarizeReturnMonth([...records, ...invalid], "2026-10");
    expect(summary.observedDays).toBe(7);
    expect(summary.upDays).toBe(1);
    expect(summary.downDays).toBe(1);
    expect(summary.flatDays).toBe(1);
    expect(summary.best?.date).toBe("2026-10-02");
    expect(summary.worst?.date).toBe("2026-10-03");
    expect(summary.returnPct).toBeCloseTo(-1);
  });

  it.each([Infinity, -Infinity, NaN, null])("exports an unavailable calculation without losing its reference: %s", (returnPct) => {
    const records = buildDailyReturnRecords([
      daily("2026-09-30", 100), daily("2026-10-01", 100), daily("2026-10-02", 100),
    ]);
    records[1] = { ...records[1], returnPct };
    const rows = serializeReturnsMonth(records, "2026-10").trimEnd().split("\n").map(r => r.split(","));
    expect(rows[0]).toEqual([
      "date", "open", "high", "low", "close", "previous_date", "previous_close",
      "close_to_close_return_pct", "observed_gap_calendar_days", "return_basis", "quality",
    ]);
    expect(rows).toHaveLength(3);
    expect(rows[1]).toEqual([
      "2026-10-01", "100", "100", "100", "100", "2026-09-30", "100", "", "0",
      "daily_price_return_adjustment_unverified", "unavailable_return",
    ]);
    expect(rows[2][7]).toBe("0");
    expect(rows[2][10]).toBe("observed_return");
    expect(dailyReturnQuality(records[0])).toBe("missing_prior_reference");
  });
});
