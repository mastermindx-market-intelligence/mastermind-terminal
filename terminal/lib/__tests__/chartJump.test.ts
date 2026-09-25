import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dispatchTerminalChartJump,
  isTerminalChartJumpDetail,
  TERMINAL_CHART_JUMP_EVENT,
  terminalChartJumpTargetsPane,
  type TerminalChartJumpDetail,
} from "../chartJump";

afterEach(() => {
  vi.unstubAllGlobals();
});

const jump: TerminalChartJumpDetail = {
  sym: "NVDA",
  ts: "2026-07-24",
  paneId: 0,
};

describe("Terminal chart-jump contract", () => {
  it("targets only the owning pane even when another pane shows the same symbol", () => {
    expect(terminalChartJumpTargetsPane(jump, "NVDA", 0)).toBe(true);
    expect(terminalChartJumpTargetsPane(jump, "NVDA", 1)).toBe(false);
    expect(terminalChartJumpTargetsPane(jump, "AAPL", 0)).toBe(false);
  });

  it("rejects ownerless or malformed jumps", () => {
    expect(isTerminalChartJumpDetail({ sym: "NVDA", ts: "2026-07-24" })).toBe(false);
    expect(isTerminalChartJumpDetail({ ...jump, paneId: -1 })).toBe(false);
    expect(isTerminalChartJumpDetail({ ...jump, sym: "" })).toBe(false);
    expect(isTerminalChartJumpDetail({ ...jump, ts: "" })).toBe(false);
  });

  it("dispatches the exact pane-scoped receipt", () => {
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

    expect(dispatchTerminalChartJump(jump)).toBe(true);
    expect(events).toEqual([{ type: TERMINAL_CHART_JUMP_EVENT, detail: jump }]);
  });
});
