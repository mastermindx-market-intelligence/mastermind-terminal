import { describe, expect, it } from "vitest";
import { parseReturnsStudy } from "../returnsCalendarStudy";
import { buildDailyReturnRecords, buildReturnCalendarSlots, returnCalendarFocusTarget,
  returnCalendarMonthFocus, returnsCalendarDayKey, serializeReturnsMonth } from "../returnsCalendar";
import type { Bar6 } from "../intradayShared";

const day = Date.parse("2026-10-14T00:00:00Z") / 1000;
const bar = (minute: number, close = 101): Bar6 => [day + minute * 60, 100, 102, 99, close, 10];
function envelope(bars: Bar6[] = [bar(-240), bar(120), bar(570)]) {
  return {
    t: "AAPL", tf: "30m", session_date: "2026-10-14", bars,
    source_evidence: { schema: "terminal.intraday_source_evidence.v1", authority: "descriptive_only",
      symbol: "AAPL", requested_timeframe: "30m", session: "24h", timestamp_basis: "market_local_display_epoch",
      response_scope: { requested_date: "2026-10-14", returned_bars: bars.length } },
    regular_session_window: { start_minute: 570, end_minute: 960, post_end_minute: 1200 } as object | null,
    session_study_evidence: { source: "canonical-daytime", status: "available", bars: bars.filter(b => b[0] >= day + 240 * 60).length },
    boats_history: { schema: "terminal.tiingo_boats_history_evidence.v1", requested_symbol: "AAPL",
      source: "tiingo-boats-rest", venue: "BOATS", status: "available", complete: false,
      coverage: "captured_vendor_bars_only", price_basis: "vendor_reported_unqualified" },
  };
}
const parse = (value: unknown) => parseReturnsStudy(value, "AAPL", "2026-10-14");
const regular = (value: ReturnType<typeof parse>) => value.sessions.find(s => s.key === "regular")!;
const night = (value: ReturnType<typeof parse>) => value.sessions.find(s => s.key === "overnight")!;

describe("current-owner Returns evidence", () => {
  it("keeps both overnight halves and observed OHLC without inventing a full-night return", () => {
    const value = parse(envelope());
    expect(night(value)).toMatchObject({ barCount: 2, open: 100, close: 101, low: 99, high: 102, ret: null });
    expect(value.overnightStatus).toBe("partial");
    expect(regular(value).ret).toBe(1);
    expect(value.daytimeStatus).toBe("available");
  });
  for (const status of ["missing", "unreadable", "malformed", "disabled", "empty"]) {
    it(`retains valid daytime when BOATS is ${status}`, () => {
      const value = envelope([bar(570)]); value.boats_history.status = status;
      const parsed = parse(value);
      expect(regular(parsed).ret).toBe(1);
      expect(parsed.overnightStatus).toBe(status === "disabled" ? "not_configured" : status === "empty" ? "empty" : "unavailable");
      expect(night(parsed).ret).toBeNull();
    });
  }
  for (const status of ["unavailable", "pending"]) {
    it(`keeps observed night and day OHLC when daytime is ${status}`, () => {
      const value = envelope(); value.session_study_evidence.status = status;
      const parsed = parse(value);
      expect(night(parsed).barCount).toBe(2);
      expect(regular(parsed)).toMatchObject({ open: 100, close: 101, ret: null });
      expect(parsed.daytimeStatus).toBe(status === "pending" ? "pending" : "partial");
    });
  }
  it("does not upgrade contradictory empty evidence into an available return", () => {
    const value = envelope(); value.session_study_evidence.status = "empty";
    expect(parse(value).daytimeStatus).toBe("partial");
    expect(regular(parse(value)).ret).toBeNull();
  });
  it("does not upgrade a positive receipt with zero observations into confirmed empty", () => {
    const value = envelope([]);
    expect(parse(value).daytimeStatus).toBe("unavailable");
    value.session_study_evidence.status = "empty";
    expect(parse(value).daytimeStatus).toBe("empty");
  });
  it("requires matching current-owner identity and returned-bar count", () => {
    for (const mutate of [
      (v: ReturnType<typeof envelope>) => { v.t = "MSFT"; },
      (v: ReturnType<typeof envelope>) => { v.tf = "1h"; },
      (v: ReturnType<typeof envelope>) => { v.session_date = "2026-10-13"; },
      (v: ReturnType<typeof envelope>) => { v.source_evidence.symbol = "MSFT"; },
      (v: ReturnType<typeof envelope>) => { v.source_evidence.requested_timeframe = "5m"; },
      (v: ReturnType<typeof envelope>) => { v.source_evidence.timestamp_basis = "utc"; },
      (v: ReturnType<typeof envelope>) => { v.source_evidence.response_scope.returned_bars = 999; },
    ]) {
      const value = envelope(); mutate(value); expect(parse(value).ok).toBe(false);
    }
  });
  it("rejects a malformed daytime row but keeps sound independent overnight observations", () => {
    const value = envelope(); value.bars[2][2] = 90;
    const parsed = parse(value);
    expect(parsed.daytimeStatus).toBe("unavailable"); expect(night(parsed).barCount).toBe(2);
  });
  it("scopes a clearly overnight malformed or conflicting row to the overnight leg", () => {
    const value = envelope(); value.bars[0][2] = 90;
    expect(regular(parse(value)).ret).toBe(1);
    const conflict = envelope([bar(-240), bar(-240, 102), bar(570)]);
    expect(night(parse(conflict)).barCount).toBe(0);
    expect(regular(parse(conflict)).ret).toBe(1);
  });
  it("does not certify unplaceable or conflicting daytime rows", () => {
    const value = envelope([bar(570), bar(570, 102)]);
    expect(regular(parse(value)).ret).toBeNull();
    const unplaceable = envelope(); unplaceable.bars[0][0] = Number.NaN;
    expect(regular(parse(unplaceable)).ret).toBeNull();
  });
  it("keeps real zero distinct from missing data and preserves source-qualified hours", () => {
    const value = envelope([bar(570, 100), bar(780), bar(990)]);
    value.regular_session_window = { start_minute: 570, end_minute: 780, post_end_minute: 1020 };
    const parsed = parse(value);
    expect(regular(parsed).ret).toBe(0);
    expect(parsed.sessions.find(s => s.key === "post")).toMatchObject({ hours: "13:00–17:00", barCount: 2 });
  });
  it("uses explicit closed evidence without making up session hours", () => {
    const value = envelope([]); value.regular_session_window = null; value.session_study_evidence.status = "closed";
    expect(parse(value)).toMatchObject({ daytimeStatus: "closed", overnightStatus: "closed" });
  });
});

describe("Returns navigation geometry and CSV truth", () => {
  const records = buildDailyReturnRecords(["2026-10-01", "2026-10-02", "2026-10-05", "2026-10-09", "2026-10-12", "2026-11-02"]
    .map(time => ({ time, o: 100, h: 102, l: 99, c: 100, v: 10 })));
  it("keeps calendar gaps in their real positions for vertical arrows", () => {
    const slots = buildReturnCalendarSlots(records, "2026-10", false);
    expect(returnCalendarFocusTarget(slots, "2026-10-02", "ArrowDown", 5)).toBe("2026-10-09");
    expect(returnCalendarFocusTarget(slots, "2026-10-05", "ArrowDown", 5)).toBe("2026-10-12");
    expect(returnCalendarFocusTarget(slots, "2026-10-09", "Home", 5)).toBe("2026-10-05");
    expect(returnCalendarFocusTarget(slots, "2026-10-05", "End", 5)).toBe("2026-10-09");
  });
  it("skips absent observations horizontally without changing the input records", () => {
    const slots = buildReturnCalendarSlots(records, "2026-10", false);
    expect(returnCalendarFocusTarget(slots, "2026-10-05", "ArrowRight", 5)).toBe("2026-10-09");
    expect(returnCalendarFocusTarget(slots, "2026-10-01", "ArrowLeft", 5)).toBe("2026-10-01");
    expect(returnCalendarFocusTarget(slots, "2026-10-05", "Enter", 5)).toBeNull();
    expect(records).toHaveLength(6);
  });
  it("chooses a real adjacent-month focus and leaves empty months without a fake date", () => {
    expect(returnCalendarMonthFocus(records, "2026-11", "2026-10-31")).toBe("2026-11-02");
    expect(returnCalendarMonthFocus(records, "2026-12", "2026-11-02")).toBeNull();
  });
  it("retains seven-column crypto week geometry", () => {
    const rows = buildDailyReturnRecords(["2026-10-04", "2026-10-11"].map(time => ({ time, o: 100, h: 101, l: 99, c: 100, v: 0 })));
    expect(returnCalendarFocusTarget(buildReturnCalendarSlots(rows, "2026-10", true), "2026-10-04", "ArrowDown", 7)).toBe("2026-10-11");
  });
  it("exports the displayed full year/month, missing prior, actual zero, basis and quality", () => {
    const rows = serializeReturnsMonth(records, "2026-10").trimEnd().split("\n").map(row => row.split(","));
    expect(rows).toHaveLength(6); expect(rows[0]).toHaveLength(11);
    expect(rows[0].slice(-2)).toEqual(["return_basis", "quality"]);
    expect(rows[1][7]).toBe(""); expect(rows[1][10]).toBe("missing_prior_reference");
    expect(rows[2][7]).toBe("0"); expect(rows[2][9]).toBe("daily_price_return_adjustment_unverified");
    expect(rows[4][10]).toBe("observed_return_with_calendar_gap");
    expect(serializeReturnsMonth(records, "2025-10").trimEnd().split("\n")).toHaveLength(1);
  });
  it("does not throw on finite daily timestamps beyond the Date range", () => {
    expect(returnsCalendarDayKey(1e18)).toBeNull();
  });
});
