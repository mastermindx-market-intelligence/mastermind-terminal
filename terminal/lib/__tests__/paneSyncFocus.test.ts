import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerPane, requestPaneFocus, type PaneRegistration } from "../paneSync";
import type { LogicalRange } from "../timeWindow";

// ── What this suite pins (E10 AC-E10-03) ─────────────────────────────────────────────────────
// The Data Inspector asks the chart owner to show ONE exact bar time. The pane resolves it on its
// own axis with an exact-match lookup: a time it plots lands (view centred on it, crosshair on
// it); a time it does not plot is reported as missing and the view does not move. A nearest-bar
// substitution — the easy wrong implementation: a nearest index plus that bar's own value — fails
// the "missing", hydration and weekend cases below (measured). The pane's value read is an exact
// time lookup too, so a nearest index alone is still refused; both reads must stay exact.

type BarTime = string | number;

class FakePane {
  range: LogicalRange;
  writes = 0;
  crosshair: { price: number; time: unknown } | null = null;

  constructor(readonly id: number, public bars: BarTime[], readonly tf = "5m") {
    this.range = { from: Math.max(0, bars.length - 60), to: bars.length - 1 };
  }

  get chart() {
    return {
      timeScale: () => ({
        getVisibleLogicalRange: () => ({ ...this.range }),
        setVisibleLogicalRange: (r: LogicalRange) => { this.writes++; this.range = { ...r }; },
        timeToIndex: (time: BarTime, findNearest?: boolean) => {
          const i = this.bars.indexOf(time);
          if (i >= 0) return i;
          // A nearest lookup would find something; the focus must never ask for one.
          return findNearest ? Math.max(0, this.bars.length - 1) : null;
        },
      }),
      clearCrosshairPosition: () => { this.crosshair = null; },
      setCrosshairPosition: (price: number, time: unknown) => { this.crosshair = { price, time }; },
    } as unknown as PaneRegistration["chart"];
  }

  get series() {
    return {
      dataByIndex: (i: number, mismatch?: number | string) => {
        const n = this.bars.length;
        if (i >= 0 && i < n && Number.isInteger(i)) return { time: this.bars[i], close: 100 + i };
        const dir = mismatch === "nearest-left" || mismatch === -1 ? -1
          : mismatch === "nearest-right" || mismatch === 1 ? 1 : 0;
        if (dir === -1) return i >= n && n ? { time: this.bars[n - 1], close: 100 + n - 1 } : null;
        if (dir === 1) return i < 0 && n ? { time: this.bars[0], close: 100 } : null;
        return null;
      },
    } as unknown as PaneRegistration["series"];
  }

  valueAt = (t: unknown) => {
    const i = this.bars.indexOf(t as BarTime);
    return i >= 0 ? 100 + i : null;
  };
}

/** 5-minute bars of one session, as display epochs in seconds (market wall clock read as UTC). */
function fiveMinute(n: number, day = 5, startH = 9, startM = 30): number[] {
  const t0 = Date.UTC(2026, 9, day, startH, startM) / 1000;
  return Array.from({ length: n }, (_, i) => t0 + i * 300);
}

const cleanups: (() => void)[] = [];
function mount(pane: FakePane) {
  const off = registerPane(pane.id, { chart: pane.chart, series: pane.series, tf: pane.tf, valueAt: pane.valueAt });
  cleanups.push(off);
  return off;
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(async () => {
  // Settle anything still pending and drop a held (recently landed) focus so module state never
  // leaks into the next case: a new request always clears the held focus, and this one expires.
  void requestPaneFocus(-1, { tf: "-", time: 0, timeoutMs: 1 });
  await vi.runAllTimersAsync();
  while (cleanups.length) cleanups.pop()!();
  vi.useRealTimers();
});

describe("requestPaneFocus", () => {
  it("lands on the exact bar once the pane registers, after its own view restore", async () => {
    const times = fiveMinute(300);
    const pane = new FakePane(0, times);
    const target = times[40];                        // far outside the restored last-60 view
    const result = requestPaneFocus(0, { tf: "5m", time: target });
    // The table view had unmounted the pane: the request waits for the next registration.
    mount(pane);
    await expect(result).resolves.toEqual({ status: "exact", index: 40 });
    expect(pane.writes).toBeGreaterThan(0);
    expect(pane.range.from).toBeLessThanOrEqual(40);
    expect(pane.range.to).toBeGreaterThanOrEqual(40);
    expect(pane.range.to - pane.range.from).toBeCloseTo(59, 6);   // keeps the user's zoom
    expect(pane.crosshair).toEqual({ price: 140, time: target });
  });

  it("keeps two same-date intraday bars distinct — 10:00 is not 10:05", async () => {
    const times = fiveMinute(78);
    const pane = new FakePane(0, times);
    mount(pane);
    const ten = Date.UTC(2026, 9, 5, 10, 0) / 1000;
    const tenOhFive = ten + 300;
    await expect(requestPaneFocus(0, { tf: "5m", time: ten })).resolves.toMatchObject({ status: "exact", index: 6 });
    expect(pane.crosshair?.time).toBe(ten);
    await expect(requestPaneFocus(0, { tf: "5m", time: tenOhFive })).resolves.toMatchObject({ status: "exact", index: 7 });
    expect(pane.crosshair?.time).toBe(tenOhFive);
  });

  it("reports a time the pane does not plot as missing and leaves the view alone", async () => {
    const times = fiveMinute(78);
    const pane = new FakePane(0, times);
    mount(pane);
    const before = { ...pane.range };
    const between = times[10] + 60;                  // 10:21 on a 5-minute axis
    const result = requestPaneFocus(0, { tf: "5m", time: between });
    await vi.advanceTimersByTimeAsync(1_500);
    await expect(result).resolves.toEqual({ status: "missing" });
    expect(pane.writes).toBe(0);
    expect(pane.range).toEqual(before);
    expect(pane.crosshair).toBeNull();
  });

  it("re-reads a bar set that hydrated in place during the grace before calling it missing", async () => {
    const full = fiveMinute(200);
    const pane = new FakePane(0, full.slice(150));  // registered with the latest page only
    mount(pane);
    const target = full[20];
    const result = requestPaneFocus(0, { tf: "5m", time: target });
    await vi.advanceTimersByTimeAsync(300);
    pane.bars = full;                                // older history arrives on the same registration
    await vi.advanceTimersByTimeAsync(1_200);
    await expect(result).resolves.toEqual({ status: "exact", index: 20 });
    expect(pane.crosshair?.time).toBe(target);
  });

  it("expires when the pane never registers", async () => {
    const result = requestPaneFocus(3, { tf: "5m", time: 1, timeoutMs: 2_000 });
    await vi.advanceTimersByTimeAsync(2_100);
    await expect(result).resolves.toEqual({ status: "expired" });
  });

  it("waits while the pane is on another timeframe instead of matching a different bar", async () => {
    const days = ["2026-10-01", "2026-10-02", "2026-10-05"];
    const daily = new FakePane(0, days, "D");
    mount(daily);
    const result = requestPaneFocus(0, { tf: "5m", time: fiveMinute(1)[0], timeoutMs: 3_000 });
    await vi.advanceTimersByTimeAsync(3_100);
    await expect(result).resolves.toEqual({ status: "expired" });
    expect(daily.writes).toBe(0);
    expect(daily.crosshair).toBeNull();
  });

  it("supersedes an older request instead of landing both", async () => {
    const first = requestPaneFocus(0, { tf: "5m", time: 1 });
    const times = fiveMinute(78);
    const second = requestPaneFocus(0, { tf: "5m", time: times[5] });
    await expect(first).resolves.toEqual({ status: "replaced" });
    const pane = new FakePane(0, times);
    mount(pane);
    await expect(second).resolves.toEqual({ status: "exact", index: 5 });
  });

  it("lands daily bars by their date-only key", async () => {
    const days = ["2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06"];
    const pane = new FakePane(0, days, "D");
    mount(pane);
    await expect(requestPaneFocus(0, { tf: "D", time: "2026-10-02" })).resolves.toEqual({ status: "exact", index: 1 });
    // A weekend date is not silently moved to Friday or Monday.
    const weekend = requestPaneFocus(0, { tf: "D", time: "2026-10-03" });
    await vi.advanceTimersByTimeAsync(1_500);
    await expect(weekend).resolves.toEqual({ status: "missing" });
  });
});
