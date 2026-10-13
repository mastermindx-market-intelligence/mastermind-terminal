import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerPane, requestPaneFocus, type PaneRegistration } from "../paneSync";
import { dataInspectorFocusMessage } from "../dataInspectorLex";
import type { LogicalRange } from "../timeWindow";

// PF-OWNER-001: a pane id is a reusable slot. The selected row's symbol must survive
// queued navigation, hydration and the short remount hold. These extend the five
// original synthetic witnesses; the original failed evidence remains untouched.
type FocusOwner = { symbol: string; tf: string } | null;
const t0 = Date.UTC(2026, 9, 5, 9, 30) / 1000;
const times = Array.from({ length: 300 }, (_, i) => t0 + i * 300);
const target = times[40];

class SyntheticPane {
  range: LogicalRange;
  readonly restoredRange: LogicalRange;
  owner: FocusOwner;
  writes = 0;
  crosshairWrites = 0;
  crosshair: { price: number; time: unknown } | null = null;

  constructor(
    public symbol: string,
    public bars: number[],
    public priceBase: number,
    readonly id = 0,
    readonly tf = "5m",
  ) {
    this.range = { from: Math.max(0, bars.length - 60), to: bars.length - 1 };
    this.restoredRange = { ...this.range };
    this.owner = { symbol, tf };
  }

  get chart() {
    return {
      timeScale: () => ({
        getVisibleLogicalRange: () => ({ ...this.range }),
        setVisibleLogicalRange: (range: LogicalRange) => {
          this.writes++;
          this.range = { ...range };
        },
        timeToIndex: (time: number, nearest?: boolean) => {
          const index = this.bars.indexOf(time);
          return index >= 0 ? index : nearest ? Math.max(0, this.bars.length - 1) : null;
        },
      }),
      clearCrosshairPosition: () => { this.crosshair = null; },
      setCrosshairPosition: (price: number, time: unknown) => {
        this.crosshairWrites++;
        this.crosshair = { price, time };
      },
    } as unknown as PaneRegistration["chart"];
  }

  get series() {
    return {
      dataByIndex: (index: number, mismatch?: number | string) => {
        const n = this.bars.length;
        if (index >= 0 && index < n && Number.isInteger(index)) {
          return { time: this.bars[index], close: this.priceBase + index };
        }
        const dir = mismatch === "nearest-left" || mismatch === -1 ? -1
          : mismatch === "nearest-right" || mismatch === 1 ? 1 : 0;
        if (dir === -1) {
          return index >= n && n ? { time: this.bars[n - 1], close: this.priceBase + n - 1 } : null;
        }
        if (dir === 1) {
          return index < 0 && n ? { time: this.bars[0], close: this.priceBase } : null;
        }
        return null;
      },
    } as unknown as PaneRegistration["series"];
  }

  valueAt = (time: unknown) => {
    const index = this.bars.indexOf(time as number);
    return index >= 0 ? this.priceBase + index : null;
  };
}

const cleanups: (() => void)[] = [];
function mount(pane: SyntheticPane, includeOwnerAccessor = true) {
  const off = registerPane(pane.id, {
    chart: pane.chart,
    series: pane.series,
    tf: pane.tf,
    valueAt: pane.valueAt,
    ...(includeOwnerAccessor ? { focusOwner: () => pane.owner } : {}),
  });
  cleanups.push(off);
  return off;
}

function expectUntouched(pane: SyntheticPane) {
  expect(pane.writes).toBe(0);
  expect(pane.crosshairWrites).toBe(0);
  expect(pane.crosshair).toBeNull();
  expect(pane.range).toEqual(pane.restoredRange);
}

const unavailableRegistrations = ["unknown owner", "no accessor"] as const;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-12T00:00:00Z"));
});

afterEach(async () => {
  // Preserve the existing focus suite's public cleanup contract. A new request
  // settles any pending one, clears the hold and expires without a registered pane.
  void requestPaneFocus(-1, { tf: "-", time: 0, timeoutMs: 1 });
  await vi.runAllTimersAsync();
  while (cleanups.length) cleanups.pop()!();
  vi.useRealTimers();
});

describe("symbol-scoped requestPaneFocus ownership", () => {
  it("queues for the same owner, keeps zoom, and preserves exact intraday time semantics", async () => {
    const pending = requestPaneFocus(0, { symbol: "AAPL", tf: "5m", time: target });
    const pane = new SyntheticPane("AAPL", [...times], 100);
    mount(pane);

    await expect(pending).resolves.toEqual({ status: "exact", index: 40 });
    expect(pane.writes).toBe(1);
    expect(pane.crosshairWrites).toBe(1);
    expect(pane.crosshair).toEqual({ price: 140, time: target });
    expect(pane.range.from).toBeLessThanOrEqual(40);
    expect(pane.range.to).toBeGreaterThanOrEqual(40);
    expect(pane.range.to - pane.range.from).toBeCloseTo(59, 6);

    // A nearby bar on the same date remains a different navigation target.
    await expect(requestPaneFocus(0, { symbol: "AAPL", tf: "5m", time: times[41] }))
      .resolves.toEqual({ status: "exact", index: 41 });
    expect(pane.crosshair).toEqual({ price: 141, time: times[41] });

    const beforeMissing = {
      range: { ...pane.range }, writes: pane.writes, crosshairWrites: pane.crosshairWrites,
    };
    const missing = requestPaneFocus(0, { symbol: "AAPL", tf: "5m", time: target + 60 });
    await vi.advanceTimersByTimeAsync(1_500);
    await expect(missing).resolves.toEqual({ status: "missing" });
    expect(pane.range).toEqual(beforeMissing.range);
    expect(pane.writes).toBe(beforeMissing.writes);
    expect(pane.crosshairWrites).toBe(beforeMissing.crosshairWrites);
    expect(pane.crosshair).toEqual({ price: 141, time: times[41] });
  });

  it("silently replaces queued AAPL navigation when the reused pane belongs to NVDA", async () => {
    const pending = requestPaneFocus(0, { symbol: "AAPL", tf: "5m", time: target });
    const pane = new SyntheticPane("NVDA", [...times], 1000);
    mount(pane);

    const result = await pending;
    expect(result).toEqual({ status: "replaced" });
    expectUntouched(pane);
    expect(dataInspectorFocusMessage(result.status, "12:50", "en")).toBeNull();
    expect(dataInspectorFocusMessage(result.status, "12:50", "zh")).toBeNull();
  });

  it("does not finish AAPL's missing-bar grace on a replacement NVDA pane", async () => {
    const oldPane = new SyntheticPane("AAPL", times.slice(150), 100);
    const off = mount(oldPane);
    const pending = requestPaneFocus(0, { symbol: "AAPL", tf: "5m", time: target });

    await vi.advanceTimersByTimeAsync(300);
    off();
    const replacement = new SyntheticPane("NVDA", [...times], 1000);
    mount(replacement);

    await expect(pending).resolves.toEqual({ status: "replaced" });
    await vi.advanceTimersByTimeAsync(1_500);
    expectUntouched(oldPane);
    expectUntouched(replacement);
  });

  it("re-reads the accessor when the same registration changes owner during grace", async () => {
    const pane = new SyntheticPane("AAPL", times.slice(150), 100);
    mount(pane);
    const pending = requestPaneFocus(0, { symbol: "AAPL", tf: "5m", time: target });

    await vi.advanceTimersByTimeAsync(300);
    // No unregister/register edge: the existing closures now read the new owner.
    pane.symbol = "NVDA";
    pane.priceBase = 1000;
    pane.bars = [...times];
    pane.owner = { symbol: "NVDA", tf: "5m" };
    await vi.advanceTimersByTimeAsync(1_200);

    await expect(pending).resolves.toEqual({ status: "replaced" });
    expectUntouched(pane);
  });

  it.each(unavailableRegistrations)(
    "refuses a scoped request with %s after grace while preserving legacy unscoped navigation",
    async (kind) => {
      const pane = new SyntheticPane("AAPL", [...times], 100);
      if (kind === "unknown owner") pane.owner = null;
      mount(pane, kind !== "no accessor");

      let settled = false;
      const pending = requestPaneFocus(0, { symbol: "AAPL", tf: "5m", time: target });
      void pending.then(() => { settled = true; });
      await vi.advanceTimersByTimeAsync(300);
      expect(settled).toBe(false);
      expectUntouched(pane);
      await vi.advanceTimersByTimeAsync(1_200);
      await expect(pending).resolves.toEqual({ status: "unavailable" });
      expectUntouched(pane);

      // The optional API must not reject existing callers that omit symbol.
      await expect(requestPaneFocus(0, { tf: "5m", time: target }))
        .resolves.toEqual({ status: "exact", index: 40 });
      expect(pane.writes).toBe(1);
      expect(pane.crosshair).toEqual({ price: 140, time: target });
    },
  );

  it("allows ownership and older bars to hydrate in place to the requested owner", async () => {
    const pane = new SyntheticPane("AAPL", times.slice(150), 100);
    pane.owner = null;
    mount(pane);
    const pending = requestPaneFocus(0, { symbol: "AAPL", tf: "5m", time: target });

    await vi.advanceTimersByTimeAsync(300);
    expectUntouched(pane);
    pane.bars = [...times];
    pane.owner = { symbol: "AAPL", tf: "5m" };
    await vi.advanceTimersByTimeAsync(1_200);

    await expect(pending).resolves.toEqual({ status: "exact", index: 40 });
    expect(pane.writes).toBe(1);
    expect(pane.crosshair).toEqual({ price: 140, time: target });
    expect(pane.range.to - pane.range.from).toBeCloseTo(59, 6);
  });

  it("preserves held focus through an absent-pane interval and a same-owner remount", async () => {
    const oldPane = new SyntheticPane("AAPL", [...times], 100);
    const off = mount(oldPane);
    await expect(requestPaneFocus(0, { symbol: "AAPL", tf: "5m", time: target }))
      .resolves.toEqual({ status: "exact", index: 40 });

    off();
    await vi.advanceTimersByTimeAsync(500);
    const replacement = new SyntheticPane("AAPL", [...times], 100);
    mount(replacement);

    expect(replacement.writes).toBe(1);
    expect(replacement.crosshairWrites).toBe(1);
    expect(replacement.crosshair).toEqual({ price: 140, time: target });
  });

  it("permanently drops held AAPL focus after visiting NVDA, even when AAPL returns", async () => {
    const oldPane = new SyntheticPane("AAPL", [...times], 100);
    const off = mount(oldPane);
    await expect(requestPaneFocus(0, { symbol: "AAPL", tf: "5m", time: target }))
      .resolves.toEqual({ status: "exact", index: 40 });

    off();
    const otherOwner = new SyntheticPane("NVDA", [...times], 1000);
    const offOther = mount(otherOwner);
    expectUntouched(otherOwner);
    await vi.advanceTimersByTimeAsync(300);
    offOther();
    const returnedOwner = new SyntheticPane("AAPL", [...times], 100);
    mount(returnedOwner);
    await vi.advanceTimersByTimeAsync(500);

    expectUntouched(otherOwner);
    expectUntouched(returnedOwner);
  });

  it.each(unavailableRegistrations)(
    "permanently drops held scoped focus when a present replacement has %s",
    async (kind) => {
      const oldPane = new SyntheticPane("AAPL", [...times], 100);
      const off = mount(oldPane);
      await expect(requestPaneFocus(0, { symbol: "AAPL", tf: "5m", time: target }))
        .resolves.toEqual({ status: "exact", index: 40 });

      off();
      const unready = new SyntheticPane("AAPL", [...times], 100);
      if (kind === "unknown owner") unready.owner = null;
      const offUnready = mount(unready, kind !== "no accessor");
      expectUntouched(unready);
      await vi.advanceTimersByTimeAsync(300);
      offUnready();
      const readyAgain = new SyntheticPane("AAPL", [...times], 100);
      mount(readyAgain);
      await vi.advanceTimersByTimeAsync(500);

      expectUntouched(unready);
      expectUntouched(readyAgain);
    },
  );

  it("keeps the existing wait and expiry when the same owner is registered on another timeframe", async () => {
    const pane = new SyntheticPane("AAPL", [...times], 100, 0, "1m");
    mount(pane);
    let settled = false;
    const pending = requestPaneFocus(0, {
      symbol: "AAPL", tf: "5m", time: target, timeoutMs: 2_000,
    });
    void pending.then(() => { settled = true; });

    await vi.advanceTimersByTimeAsync(1_500);
    expect(settled).toBe(false);
    expectUntouched(pane);
    await vi.advanceTimersByTimeAsync(600);
    await expect(pending).resolves.toEqual({ status: "expired" });
    expectUntouched(pane);
  });
});
