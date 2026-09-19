import { afterEach, describe, expect, it, vi } from "vitest";
import {
  chartAxisRange,
  dispatchTerminalChartRange,
  isTerminalChartRangeDetail,
  TERMINAL_CHART_RANGE_EVENT,
  type TerminalChartRangeDetail,
} from "../chartRange";

afterEach(() => {
  vi.unstubAllGlobals();
});

const detail: TerminalChartRangeDetail = {
  sym: "NVDA",
  paneId: 2,
  from: Date.UTC(2026, 6, 1) / 1000,
  to: Date.UTC(2026, 6, 31) / 1000,
};

describe("Terminal chart-range contract", () => {
  it("preserves epoch seconds for an intraday axis", () => {
    expect(chartAxisRange(detail, true)).toEqual({
      from: detail.from,
      to: detail.to,
    });
  });

  it("converts epoch seconds to business-day strings for a daily-derived axis", () => {
    expect(chartAxisRange(detail, false)).toEqual({
      from: "2026-07-01",
      to: "2026-07-31",
    });
  });

  it("rejects malformed, inverted, or ownerless ranges", () => {
    expect(isTerminalChartRangeDetail({ ...detail, paneId: -1 })).toBe(false);
    expect(isTerminalChartRangeDetail({ ...detail, sym: "" })).toBe(false);
    expect(isTerminalChartRangeDetail({ ...detail, from: detail.to, to: detail.from })).toBe(false);
    expect(chartAxisRange({ ...detail, from: Number.NaN }, false)).toBeNull();
  });

  it("dispatches one exact pane-scoped range receipt", () => {
    const events: Array<{ type: string; detail: unknown }> = [];
    vi.stubGlobal("window", {
      dispatchEvent: (event: { type?: string; detail?: unknown }) => {
        events.push({ type: event.type ?? "", detail: event.detail });
        return true;
      },
    });
    class FakeCustomEvent<T> {
      readonly type: string;
      readonly detail: T;
      constructor(type: string, init: { detail: T }) {
        this.type = type;
        this.detail = init.detail;
      }
    }
    vi.stubGlobal("CustomEvent", FakeCustomEvent);

    expect(dispatchTerminalChartRange(detail)).toBe(true);
    expect(events).toEqual([{ type: TERMINAL_CHART_RANGE_EVENT, detail }]);
  });
});
