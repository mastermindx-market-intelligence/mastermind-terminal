import type { ISeriesApi, ISeriesPrimitive, SeriesType } from "lightweight-charts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { paneDrawingScaleReady, watchPaneDrawingReadiness } from "../drawingPaneReadiness";

afterEach(() => vi.unstubAllGlobals());

function fixture() {
  let range: { from: number; to: number } | null = { from: 0, to: 0 };
  let epoch = 1;
  let primitive: ISeriesPrimitive | undefined;
  let collapsed = false;
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback); return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  const detach = vi.fn();
  const series = {
    priceScale: () => ({ getVisibleRange: () => range }),
    priceToCoordinate: (price: number) => collapsed ? 0 : 200 - price * 5,
    coordinateToPrice: (y: number) => collapsed ? 0 : (200 - y) / 5,
    attachPrimitive: (value: ISeriesPrimitive) => { primitive = value; },
    detachPrimitive: detach,
  } as unknown as ISeriesApi<SeriesType>;
  const ready = vi.fn();
  const watcher = watchPaneDrawingReadiness(() => epoch, ready);
  watcher.sync(new Set([series]));
  return {
    series, watcher, ready, frames, detach,
    range: (value: typeof range) => { range = value; },
    collapseMap: (value: boolean) => { collapsed = value; },
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
  it("preserves a legacy document while a positive cached range still has a collapsed coordinate map", () => {
    const f = fixture(); f.range({ from: -10, to: 11 }); f.collapseMap(true);
    for (let paint = 0; paint < 20; paint += 1) f.paint();
    expect(paneDrawingScaleReady(f.series)).toBe(false);
    expect(f.frames.size).toBe(0); expect(f.ready).not.toHaveBeenCalled();
    f.collapseMap(false); f.paint(); f.flush();
    expect(f.ready).toHaveBeenCalledTimes(1); f.watcher.dispose();
  });
  it("allows a legitimate zero price on a usable inverted coordinate map", () => {
    const f = fixture(); f.range({ from: 0, to: 11 });
    expect(paneDrawingScaleReady(f.series)).toBe(true); f.watcher.dispose();
  });
  it("rejects a collapsed inverse map even when forward coordinates differ", () => {
    const f = fixture(); f.range({ from: -10, to: 11 });
    f.series.coordinateToPrice = () => 0 as never;
    expect(paneDrawingScaleReady(f.series)).toBe(false); f.watcher.dispose();
  });
  it("accepts a usable logarithmic map without rejecting its zero pixel endpoint", () => {
    const f = fixture(); f.range({ from: 1, to: 100 });
    f.series.priceToCoordinate = (price) => Math.log(price) as never;
    f.series.coordinateToPrice = (y) => Math.exp(y) as never;
    expect(paneDrawingScaleReady(f.series)).toBe(true); f.watcher.dispose();
  });
  it.each([null, NaN, Infinity])("rejects an unavailable forward projection %j", (coordinate) => {
    const f = fixture(); f.range({ from: -10, to: 11 });
    f.series.priceToCoordinate = () => coordinate as never;
    expect(paneDrawingScaleReady(f.series)).toBe(false); f.watcher.dispose();
  });
  it("rechecks the current range after public projections refresh the cached scale", () => {
    const f = fixture(); f.range({ from: -10, to: 11 });
    f.series.priceToCoordinate = (price) => { f.range({ from: 0, to: 0 }); return (200 - price * 5) as never; };
    expect(paneDrawingScaleReady(f.series)).toBe(false); f.watcher.dispose();
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
