import { describe, it, expect } from "vitest";
import { boatsChartHistoryBars, boatsChartHistoryFromResponse, boatsChartCoverageView } from "../extQuoteCopy";

const base = {
  schema: "terminal.tiingo_boats_history_evidence.v1",
  status: "available",
  source: "tiingo-boats-rest",
  venue: "BOATS",
  complete: false,
  volume_basis: "vendor_reported_shares",
  requested_symbol: "AMD",
  returned_bars: 134,
};
const live = {
  status: "applied",
  session_date: "2026-11-04",
  observed_at_utc: "2026-11-04T03:13:01.847447Z",
};
const response = (extra: Record<string, unknown> = {}) => ({ ...base, live_history: { ...live, ...extra } });
const clock = Date.parse("2026-11-04T03:13:03Z");

describe("BOATS 24H UI freshness — provider receipt, not browser clock", () => {
  it("renders a current-night source-verified snapshot within the overnight window", () => {
    const data = boatsChartHistoryFromResponse("AMD", "1m", response());
    expect(data.bars).toBe(134);
    const view = boatsChartCoverageView("en", "AMD", "1m", data, clock);
    expect(view.state).toBe("fresh");
    expect(view.headline).toContain("Current-night BOATS history");
    expect(view.headline).toContain("ET");
    expect(view.detail).toContain("Gaps kept");
    expect(boatsChartCoverageView("zh", "AMD", "1m", data, clock).headline).toContain("当夜夜盘K线");
  });

  it("withdraws 'live' after 120 seconds, at session close, and on explicit stale state", () => {
    const data = boatsChartHistoryFromResponse("AMD", "1m", response());
    expect(boatsChartCoverageView("en", "AMD", "1m", data, clock + 121_000).state).toBe("stale");
    const atClose = boatsChartHistoryFromResponse("AMD", "1m",
      response({observed_at_utc: "2026-11-04T08:59:30Z"}));
    expect(boatsChartCoverageView("en", "AMD", "1m", atClose,
      Date.parse("2026-11-04T09:00:05Z")).state).toBe("stale");
    const rejected = boatsChartHistoryFromResponse("AMD", "1m", response({status:"stale"}));
    expect(boatsChartCoverageView("en", "AMD", "1m", rejected, clock).state).toBe("stale");
  });

  it("does not equate an invalid future stamp, unknown provenance or ticker switch with live", () => {
    const future = boatsChartHistoryFromResponse("AMD", "1m",
      response({observed_at_utc: "2026-11-04T03:23:01Z"}));
    expect(boatsChartCoverageView("en", "AMD", "1m", future, clock).state).not.toBe("fresh");
    const unverified = boatsChartHistoryFromResponse("AMD", "1m",
      {...response(), requested_symbol: "NVDA"});
    expect(unverified.liveHistory).toBeUndefined();
    expect(boatsChartCoverageView("en", "AMD", "1m", unverified, clock).state).toBe("captured");
    const valid = boatsChartHistoryFromResponse("AMD", "1m", response());
    expect(boatsChartCoverageView("en", "NVDA", "1m", valid, clock).state).toBe("empty");
    expect(boatsChartCoverageView("en", "AMD", "5m", valid, clock).state).toBe("empty");
  });

  it("honors provisional daytime assembly and errors over a received vendor snapshot", () => {
    const pending = boatsChartHistoryFromResponse("AMD", "1m", response(), { pending: true });
    expect(boatsChartCoverageView("en", "AMD", "1m", pending, clock).state).toBe("loading");
    const failed = boatsChartHistoryFromResponse("AMD", "1m", response(), { error: true });
    expect(boatsChartCoverageView("en", "AMD", "1m", failed, clock).state).toBe("unavailable");
  });

  it("keeps archived history and authoritative empty windows distinct", () => {
    const archive = boatsChartHistoryFromResponse("AMD", "1m", base);
    expect(boatsChartCoverageView("en", "AMD", "1m", archive, clock).state).toBe("captured");
    expect(boatsChartHistoryBars({...base, complete:true})).toBe(0);
    const empty = boatsChartHistoryFromResponse("AMD", "1m", response({ status: "empty" }));
    expect(boatsChartCoverageView("en", "AMD", "1m", empty, clock).state).toBe("empty");
    const noHistory = boatsChartHistoryFromResponse("AMD", "1m", null);
    expect(boatsChartCoverageView("en", "AMD", "1m", noHistory, clock).state).toBe("empty");
  });
});
