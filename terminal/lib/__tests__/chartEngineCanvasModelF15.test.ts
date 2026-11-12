// F-15: scrollToPosition honours `animated` over 1000 ms (LWC dev:12862-12868)
// and timeToMs / toBarKey share one epoch-seconds ceiling.
import { describe, expect, it, vi } from "vitest";

import { ChartModel, timeToMs, type ModelClock } from "@/lib/chart-engine/canvas/model";
import { EPOCH_SECONDS_MAX, toBarKey } from "@/lib/chart-engine/time";
import { SCROLL_TO_POSITION_MS } from "@/lib/chart-engine/canvas/modelTime";

function makeClock(): ModelClock & { nowMs: number; flush(): void } {
  const queued: Array<() => void> = [];
  const clock: ModelClock & { nowMs: number; flush(): void } = {
    nowMs: 0,
    now: () => clock.nowMs,
    schedule(cb) {
      queued.push(cb);
      return cb;
    },
    cancel(handle) {
      const i = queued.indexOf(handle as () => void);
      if (i >= 0) queued.splice(i, 1);
    },
    flush() {
      const batch = queued.splice(0);
      for (const cb of batch) cb();
    },
  };
  return clock;
}

function mounted(clock?: ModelClock): ChartModel {
  const m = new ChartModel({
    onInvalidate: () => undefined,
    onStructure: () => undefined,
    clock,
  });
  m.applyOptions({ width: 200, height: 100 });
  m.addSeries("line").setData(
    Array.from({ length: 10 }, (_, i) => ({ time: 1000 * (i + 1), value: i })),
  );
  return m;
}

describe("F-15 scrollToPosition animated + epoch constant", () => {
  it("animated=false sets rightOffset immediately", () => {
    const m = mounted();
    m.timeScaleHandleFor().scrollToPosition(4, false);
    expect(m.time.rightOffset).toBe(4);
    expect(m.getVisibleLogicalRange()).toEqual({ from: 4, to: 14 });
  });

  it("animated=true is linear over 1000 ms and ends exactly on the target", () => {
    const clock = makeClock();
    const m = mounted(clock);
    expect(SCROLL_TO_POSITION_MS).toBe(1000);
    m.timeScaleHandleFor().scrollToPosition(10, true);
    expect(m.time.rightOffset).toBe(0);
    clock.flush();
    expect(m.time.rightOffset).toBe(0);
    clock.nowMs = 500;
    clock.flush();
    expect(m.time.rightOffset).toBe(5);
    expect(m.getVisibleLogicalRange()).toEqual({ from: 5, to: 15 });
    clock.nowMs = 1000;
    clock.flush();
    // PERF-A TEST-CORRECTION (LWC dev:6574-6603): the always-on correctOffset
    // bound caps rightOffset at width/barSpacing - min(2, n) = 10 - 2 = 8 for
    // this fixture (10 rows, spacing 20, width 200), so the animation lands on
    // 8, not the unclamped 10 the previous pin encoded.
    expect(m.time.rightOffset).toBe(8);
    expect(m.getVisibleLogicalRange()).toEqual({ from: 8, to: 18 });
    clock.flush();
    expect(m.time.rightOffset).toBe(8);
  });

  it("a new scroll cancels a running animation", () => {
    const clock = makeClock();
    const m = mounted(clock);
    m.timeScaleHandleFor().scrollToPosition(10, true);
    clock.nowMs = 200;
    clock.flush();
    expect(m.time.rightOffset).toBe(2);
    m.timeScaleHandleFor().scrollToPosition(0, true);
    clock.nowMs = 200;
    clock.flush();
    expect(m.time.rightOffset).toBe(2);
    clock.nowMs = 1200;
    clock.flush();
    expect(m.time.rightOffset).toBe(0);
    expect(m.getVisibleLogicalRange()).toEqual({ from: 0, to: 10 });
  });

  it("destroy cancels a running animation", () => {
    const clock = makeClock();
    const m = mounted(clock);
    m.timeScaleHandleFor().scrollToPosition(10, true);
    clock.nowMs = 200;
    clock.flush();
    expect(m.time.rightOffset).toBe(2);
    m.destroy();
    clock.nowMs = 1000;
    clock.flush();
    expect(m.time.rightOffset).toBe(2);
  });

  it("EPOCH_SECONDS_MAX is the shared seconds/ms boundary", () => {
    expect(EPOCH_SECONDS_MAX).toBe(1e11);
    expect(toBarKey(EPOCH_SECONDS_MAX)).toBe(EPOCH_SECONDS_MAX);
    expect(toBarKey(EPOCH_SECONDS_MAX + 1)).toBeNull();
    expect(timeToMs(EPOCH_SECONDS_MAX)).toBe(EPOCH_SECONDS_MAX * 1000);
    expect(timeToMs(EPOCH_SECONDS_MAX + 1)).toBe(EPOCH_SECONDS_MAX + 1);
  });

  it("vi.useFakeTimers drives the default clock to the target", () => {
    vi.useFakeTimers();
    try {
      const m = mounted();
      m.timeScaleHandleFor().scrollToPosition(8, true);
      vi.advanceTimersByTime(1000);
      expect(m.time.rightOffset).toBe(8);
      expect(m.getVisibleLogicalRange()).toEqual({ from: 8, to: 18 });
    } finally {
      vi.useRealTimers();
    }
  });
});
