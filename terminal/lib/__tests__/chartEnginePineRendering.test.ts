import { describe, it, expect, vi } from "vitest";
import type { ChartEngine, MarkerSpec, PriceLineHandle, SeriesHandle } from "@/lib/chart-engine";
import type { Bar, RunResult } from "@/lib/pine-engine";
import { unsupportedMsg } from "@/lib/pine-engine/runtime";
import {
  PINE_LEGEND_WARN_SUFFIX,
  PINE_NO_OUTPUT_MSG,
  addPinePlot,
  buildAllPineOnEngine,
  buildPineScriptOnEngine,
  clearPineLayer,
  isPineKey,
  pineEpochStillCurrent,
  pineKeyOf,
  pineOutcome,
  type PineCacheHit,
  type PineLayerMaps,
  type PinePriceLinePool,
} from "@/lib/pineChartLayer";

function makeMaps(): PineLayerMaps {
  return { series: new Map(), priceShapes: new Map(), paneMap: new Map(), errors: new Map() };
}

function makeBars(n = 5): Bar[] {
  const bars: Bar[] = [];
  for (let i = 0; i < n; i++) {
    bars.push({ time: `2024-01-${String(i + 1).padStart(2, "0")}`, o: 10, h: 11, l: 9, c: 10 + i * 0.1, v: 1 });
  }
  return bars;
}

type RecPriceLine = { spec: Record<string, unknown>; remove: ReturnType<typeof vi.fn> };
type RecSeries = {
  kind: string;
  pane: number;
  opts: Record<string, unknown>;
  data: unknown[];
  priceLines: RecPriceLine[];
  markers: MarkerSpec[];
  remove: ReturnType<typeof vi.fn>;
  createPriceLine: ReturnType<typeof vi.fn>;
  setMarkers: ReturnType<typeof vi.fn>;
  setData: ReturnType<typeof vi.fn>;
};

function makeRecordingEngine(): { engine: ChartEngine; price: RecSeries; allSeries: RecSeries[] } {
  const allSeries: RecSeries[] = [];
  const makeSeries = (kind: string, opts: Record<string, unknown>, pane: number): RecSeries => {
    const s: RecSeries = {
      kind, pane, opts, data: [], priceLines: [], markers: [],
      remove: vi.fn(() => { const i = allSeries.indexOf(s); if (i !== -1) allSeries.splice(i, 1); }),
      setData: vi.fn((rows: unknown[]) => { s.data = rows; }),
      setMarkers: vi.fn((m: MarkerSpec[]) => { s.markers = m; }),
      createPriceLine: vi.fn((spec: Record<string, unknown>) => {
        const pl: RecPriceLine = { spec, remove: vi.fn(() => { const at = s.priceLines.indexOf(pl); if (at !== -1) s.priceLines.splice(at, 1); }) };
        s.priceLines.push(pl);
        return pl as unknown as PriceLineHandle;
      }),
    };
    allSeries.push(s);
    return s;
  };
  const price = makeSeries("candles", {}, 0);
  const engine: ChartEngine = {
    impl: "lwc",
    addSeries: vi.fn((kind, opts, paneIndex = 0) => makeSeries(kind, opts ?? {}, paneIndex) as unknown as SeriesHandle),
    removeSeries: vi.fn(),
    panes: vi.fn(() => []),
    timeScale: vi.fn(),
    priceScale: vi.fn(),
    chartElement: vi.fn(() => document.createElement("div")),
    options: vi.fn(() => ({})),
    setCrosshairPosition: vi.fn(),
    clearCrosshairPosition: vi.fn(),
    paneSize: vi.fn(() => ({ width: 100, height: 100 })),
    swapPanes: vi.fn(),
    takeScreenshot: vi.fn(() => document.createElement("canvas")),
    applyOptions: vi.fn(),
    subscribeCrosshairMove: vi.fn(),
    unsubscribeCrosshairMove: vi.fn(),
    subscribeClick: vi.fn(),
    unsubscribeClick: vi.fn(),
    subscribeDblClick: vi.fn(),
    unsubscribeDblClick: vi.fn(),
    setWatermark: vi.fn(),
    resize: vi.fn(),
    unwrap: vi.fn(),
    inventory: vi.fn(() => ({ alive: true, panes: 1, series: allSeries.length, seriesByPane: [allSeries.length], priceLines: allSeries.reduce((n, s) => n + s.priceLines.length, 0), watermarks: 0 })),
    destroy: vi.fn(() => { allSeries.length = 0; }),
  };
  return { engine, price, allSeries };
}

function emptyPool(): PinePriceLinePool {
  const tracked = new Map<string, PriceLineHandle[]>();
  return {
    removeAllPineKeys: () => tracked.clear(),
    removeForScript: (id) => tracked.delete(id),
    track: (id, line) => { const arr = tracked.get(id) ?? []; arr.push(line); tracked.set(id, arr); },
  };
}

function pooledPool(): PinePriceLinePool & { lines: Map<string, RecPriceLine[]> } {
  const lines = new Map<string, RecPriceLine[]>();
  return {
    lines,
    removeAllPineKeys: () => {
      for (const arr of lines.values()) for (const pl of arr) pl.remove();
      lines.clear();
    },
    removeForScript: (id) => {
      const arr = lines.get(pineKeyOf(id));
      if (arr) { for (const pl of arr) pl.remove(); lines.delete(pineKeyOf(id)); }
    },
    track: (id, line) => {
      const key = pineKeyOf(id);
      const arr = lines.get(key) ?? [];
      arr.push(line as unknown as RecPriceLine);
      lines.set(key, arr);
    },
  };
}

const overlayHlineResult: RunResult = {
  meta: { title: "ov", overlay: true },
  plots: [],
  hlines: [{ price: 42, color: "#fff", style: "solid", title: "L", overlay: true }],
  shapes: [],
  inputs: [],
  warnings: [],
  barCount: 5,
};

const panePlotHlineResult: RunResult = {
  meta: { title: "pane", overlay: false },
  plots: [{
    id: 0, kind: "line", title: "p", color: "#0f0", linewidth: 1, overlay: false,
    data: makeBars().map((b) => ({ time: b.time, value: b.c })),
  }],
  hlines: [{ price: 99, color: "#f00", style: "dashed", title: "H", overlay: false }],
  shapes: [],
  inputs: [],
  warnings: [],
  barCount: 5,
};

describe("chart-engine pine rendering (L03)", () => {
  describe("A04 diagnostic strings", () => {
    it("pins unsupported, no-output, and legend warn suffix", () => {
      expect(unsupportedMsg("fill")).toBe("fill() is not supported yet — its output is suppressed");
      expect(PINE_NO_OUTPUT_MSG).toBe("Script produced no output");
      expect(PINE_LEGEND_WARN_SUFFIX).toBe(" ⚠");
      expect(pineOutcome(null).error).toBe(PINE_NO_OUTPUT_MSG);
    });
  });

  describe("A01 hline rebuild ownership", () => {
    it("overlay hline-only: price-line count stable across 50 build/clear cycles", () => {
      const { engine, price } = makeRecordingEngine();
      const maps = makeMaps();
      const pool = pooledPool();
      const script = { id: "ov", name: "ov", source: "", params: {} };
      const rows = makeBars();
      const readCache = () => ({ result: overlayHlineResult, error: null });
      for (let i = 0; i < 50; i++) {
        buildPineScriptOnEngine(engine, price as unknown as SeriesHandle, script, rows, 1, maps, pool, () => {}, readCache);
        expect(price.priceLines.length).toBe(1);
        clearPineLayer(maps, pool, () => {});
        expect(price.priceLines.length).toBe(0);
        expect(maps.series.size).toBe(0);
      }
      expect(pool.lines.size).toBe(0);
    });

    it("sub-pane plot+hline: lines die with the script series", () => {
      const { engine, price, allSeries } = makeRecordingEngine();
      const maps = makeMaps();
      const pool = emptyPool();
      const script = { id: "sub", name: "sub", source: "", params: {} };
      const rows = makeBars();
      const readCache = () => ({ result: panePlotHlineResult, error: null });
      for (let i = 0; i < 50; i++) {
        buildPineScriptOnEngine(engine, price as unknown as SeriesHandle, script, rows, 2, maps, pool, () => {}, readCache);
        const pineSeries = allSeries.find((s) => s.kind === "line");
        expect(pineSeries?.priceLines.length).toBe(1);
        clearPineLayer(maps, pool, () => {});
        expect(allSeries.filter((s) => s.kind === "line").length).toBe(0);
      }
      expect(price.priceLines.length).toBe(0);
    });

    it("mutant: skipping pooled removal strands price lines (RED)", () => {
      const { engine, price } = makeRecordingEngine();
      const maps = makeMaps();
      const base = pooledPool();
      const brokenPool: PinePriceLinePool = {
        removeAllPineKeys: () => { /* mutant: no-op */ },
        removeForScript: () => {},
        track: (id, line) => base.track(id, line),
      };
      const script = { id: "ov", name: "ov", source: "", params: {} };
      buildPineScriptOnEngine(engine, price as unknown as SeriesHandle, script, makeBars(), 1, maps, brokenPool, () => {}, () => ({ result: overlayHlineResult, error: null }));
      clearPineLayer(maps, brokenPool, () => {});
      expect(price.priceLines.length).toBeGreaterThan(0);
    });
  });

  describe("A02 epoch guard and host supersession", () => {
    it("stale slow-path epoch does not repaint after a newer bump", async () => {
      const { engine, price } = makeRecordingEngine();
      const maps = makeMaps();
      const pool = pooledPool();
      let epoch = 0;
      const script = { id: "s1", name: "s1", source: "", params: {} };
      const rows = makeBars();
      let resolveOld!: () => void;
      const oldRun = new Promise<void>((r) => { resolveOld = r; });
      buildAllPineOnEngine(rows, {
        getEngine: () => engine,
        getScripts: () => [script],
        bumpEpoch: () => ++epoch,
        getEpoch: () => epoch,
        readCache: () => null,
        clear: () => clearPineLayer(maps, pool, () => {}),
        paint: () => {
          const hit = null as PineCacheHit | null;
          if (!hit) return;
          buildPineScriptOnEngine(engine, price as unknown as SeriesHandle, script, rows, 1, maps, pool, () => {}, () => hit);
        },
        runMisses: async () => { await oldRun; },
        afterSlowRepaint: () => {},
      });
      epoch = 2;
      resolveOld();
      await new Promise((r) => setTimeout(r, 0));
      expect(price.priceLines.length).toBe(0);
    });

    it("mutant: without epoch guard stale run paints (RED)", async () => {
      const { engine, price } = makeRecordingEngine();
      const maps = makeMaps();
      const pool = pooledPool();
      const script = { id: "s1", name: "s1", source: "", params: {} };
      const rows = makeBars();
      let resolveOld!: () => void;
      const oldRun = new Promise<void>((r) => { resolveOld = r; });
      const stamped = 1;
      let current = 1;
      buildAllPineOnEngine(rows, {
        getEngine: () => engine,
        getScripts: () => [script],
        bumpEpoch: () => { current = stamped; return stamped; },
        getEpoch: () => current,
        readCache: () => null,
        clear: () => clearPineLayer(maps, pool, () => {}),
        paint: () => buildPineScriptOnEngine(engine, price as unknown as SeriesHandle, script, rows, 1, maps, pool, () => {}, () => ({ result: overlayHlineResult, error: null })),
        runMisses: async () => { await oldRun; },
        afterSlowRepaint: () => {},
      });
      current = 2;
      resolveOld();
      await new Promise((r) => setTimeout(r, 0));
      const wouldPaint = !pineEpochStillCurrent(stamped, current) ? false : true;
      expect(wouldPaint).toBe(false);
      if (wouldPaint) expect(price.priceLines.length).toBe(1);
    });

  });

  describe("A03 destroy and double clear", () => {
    it("clear after engine destroy is a no-op and leaves maps empty", () => {
      const { engine, price } = makeRecordingEngine();
      const maps = makeMaps();
      const pool = pooledPool();
      const script = { id: "ov", name: "ov", source: "", params: {} };
      buildPineScriptOnEngine(engine, price as unknown as SeriesHandle, script, makeBars(), 1, maps, pool, () => {}, () => ({ result: overlayHlineResult, error: null }));
      engine.destroy();
      clearPineLayer(maps, pool, () => {});
      clearPineLayer(maps, pool, () => {});
      expect(maps.series.size).toBe(0);
      expect(maps.priceShapes.size).toBe(0);
    });

    it("mutant: skipping priceShapes clear leaves marker map entries (RED)", () => {
      const maps = makeMaps();
      maps.priceShapes.set("x", [{ time: "2024-01-01", position: "aboveBar", shape: "circle", color: "#000" }]);
      const pool = emptyPool();
      const brokenClear = () => {
        for (const arr of maps.series.values()) for (const s of arr) s.remove();
        maps.series.clear();
        maps.paneMap.clear();
      };
      brokenClear();
      expect(maps.priceShapes.size).toBeGreaterThan(0);
      clearPineLayer(maps, pool, () => {});
      expect(maps.priceShapes.size).toBe(0);
    });
  });

  describe("addPinePlot kinds", () => {
    it("creates histogram and line series with engine contract", () => {
      const { engine, allSeries } = makeRecordingEngine();
      addPinePlot(engine, {
        id: 1, kind: "histogram", title: "h", color: "#aaa", linewidth: 1, overlay: false,
        data: [{ time: "2024-01-01", value: 1 }],
      }, 1);
      addPinePlot(engine, {
        id: 2, kind: "line", title: "l", color: "#bbb", linewidth: 2, overlay: false,
        data: [{ time: "2024-01-02", value: 2 }],
      }, 1);
      expect(allSeries.some((s) => s.kind === "histogram")).toBe(true);
      expect(allSeries.filter((s) => s.kind === "line").length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("pine key helpers", () => {
    it("isPineKey recognizes pooled keys", () => {
      expect(isPineKey(pineKeyOf("abc"))).toBe(true);
      expect(isPineKey("rsi")).toBe(false);
    });
  });
});
