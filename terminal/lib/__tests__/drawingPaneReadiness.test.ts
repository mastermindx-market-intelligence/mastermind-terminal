import type { ISeriesApi, ISeriesPrimitive, SeriesType } from "lightweight-charts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { paneDrawingScaleReady, watchPaneDrawingReadiness } from "../drawingPaneReadiness";

afterEach(() => vi.unstubAllGlobals());

function fixture() {
  let range: { from: number; to: number } | null = { from: 0, to: 0 };
  let epoch = 1;
  let primitive: ISeriesPrimitive | undefined;
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback); return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  const detach = vi.fn();
  const series = {
    priceScale: () => ({ getVisibleRange: () => range }),
    attachPrimitive: (value: ISeriesPrimitive) => { primitive = value; },
    detachPrimitive: detach,
  } as unknown as ISeriesApi<SeriesType>;
  const ready = vi.fn();
  const watcher = watchPaneDrawingReadiness(() => epoch, ready);
  watcher.sync(new Set([series]));
  return {
    series, watcher, ready, frames, detach,
    range: (value: typeof range) => { range = value; },
    nextGeneration: () => { epoch += 1; },
    paint: () => primitive?.updateAllViews?.(),
    flush: () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach((callback) => callback(0)); },
  };
}

describe("legacy pane drawing readiness", () => {
  it.each([null, { from: 0, to: 0 }, { from: 1, to: 0 }, { from: NaN, to: 1 }, { from: 0, to: Infinity }])(
    "does not retry or schedule frames for an unusable scale %j", (range) => {
      const f = fixture(); f.range(range);
      for (let paint = 0; paint < 20; paint += 1) f.paint();
      expect(paneDrawingScaleReady(f.series)).toBe(false);
      expect(f.frames.size).toBe(0); expect(f.ready).not.toHaveBeenCalled();
      f.watcher.dispose();
    },
  );
  it("retries on a later usable scale paint, coalesces paints and detaches after migration", () => {
    const f = fixture(); f.paint();
    f.range({ from: -10, to: 11 }); f.paint(); f.paint();
    expect(f.frames.size).toBe(1); f.flush();
    expect(f.ready).toHaveBeenCalledTimes(1);
    f.watcher.sync(new Set()); f.paint(); f.flush();
    expect(f.ready).toHaveBeenCalledTimes(1); expect(f.detach).toHaveBeenCalledTimes(1);
    f.watcher.dispose();
  });
  it("ignores an already queued retry after the data generation changes", () => {
    const f = fixture(); f.range({ from: -10, to: 11 }); f.paint();
    f.nextGeneration(); f.flush();
    expect(f.ready).not.toHaveBeenCalled();
    f.watcher.dispose();
  });
  it("cancels a queued retry and ignores old primitive callbacks after teardown", () => {
    const f = fixture(); f.range({ from: -10, to: 11 }); f.paint();
    f.watcher.dispose(); f.paint(); f.flush();
    expect(f.frames.size).toBe(0); expect(f.ready).not.toHaveBeenCalled();
    expect(f.detach).toHaveBeenCalledTimes(1);
  });
  it("does not lose the new generation's ready paint behind an obsolete queued frame", () => {
    const f = fixture(); f.range({ from: -10, to: 11 }); f.paint();
    f.nextGeneration(); f.watcher.sync(new Set([f.series])); f.paint(); f.flush();
    expect(f.ready).toHaveBeenCalledTimes(1); f.watcher.dispose();
  });
  it("rechecks readiness if the scale empties again before the retry frame", () => {
    const f = fixture(); f.range({ from: -10, to: 11 }); f.paint();
    f.range({ from: 0, to: 0 }); f.flush(); expect(f.ready).not.toHaveBeenCalled();
    f.range({ from: -10, to: 11 }); f.paint(); f.flush();
    expect(f.ready).toHaveBeenCalledTimes(1); f.watcher.dispose();
  });
  it("fails closed when the pending indicator series has been removed", () => {
    const f = fixture();
    f.series.priceScale = () => { throw new Error("removed"); };
    f.paint(); expect(paneDrawingScaleReady(f.series)).toBe(false);
    expect(f.frames.size).toBe(0); f.watcher.dispose();
  });
});
