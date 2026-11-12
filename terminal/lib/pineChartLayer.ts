// Pine → chart-engine contract: translate RunResult onto owned SeriesHandle /
// PriceLineHandle / MarkerSpec, with pooled price lines for overlay scripts anchored
// on the shared price series. ChartPanel wires refs and host/cache; this module
// stays free of lightweight-charts and speaks only ChartEngine + pine-engine types.

import type {
  ChartEngine,
  EnginePointRow,
  EngineSeriesKind,
  EngineSeriesOptions,
  MarkerSpec,
  PriceLineHandle,
  SeriesHandle,
} from "@/lib/chart-engine";
import type { Bar, RunResult } from "@/lib/pine-engine";
import type { PineResult } from "@/lib/pine-engine/host";

export const pineKeyOf = (id: string) => "pine:" + id;
export const isPineKey = (k: string) => k.startsWith("pine:");

export const PINE_NO_OUTPUT_MSG = "Script produced no output";
export const PINE_LEGEND_WARN_SUFFIX = " ⚠";

export type PineScriptRow = {
  id: string;
  name: string;
  source: string;
  params: Record<string, unknown>;
};

export type PineLayerMaps = {
  series: Map<string, SeriesHandle[]>;
  priceShapes: Map<string, MarkerSpec[]>;
  paneMap: Map<string, number>;
  errors: Map<string, string>;
};

/** Price lines on the shared price series are pooled under pine:<scriptId>. */
export type PinePriceLinePool = {
  removeAllPineKeys(): void;
  removeForScript(scriptId: string): void;
  track(scriptId: string, line: PriceLineHandle): void;
};

export type PineCacheHit = { result: RunResult | null; error: string | null };

export const pineOutcome = (
  out: PineResult | null,
  crash?: unknown,
): PineCacheHit => {
  if (crash !== undefined) {
    const msg = crash instanceof Error ? crash.message : (crash as { message?: string })?.message;
    return { result: null, error: msg ? String(msg) : "Script crashed" };
  }
  if (!out) return { result: null, error: PINE_NO_OUTPUT_MSG };
  if (out.budgetExceeded) return { result: null, error: "Script exceeded the run budget (cancelled)" };
  if (!out.ok) {
    const e = out.errors[0];
    return {
      result: null,
      error: e ? (e.line ? `Line ${e.line}: ${e.message}` : e.message) : "Script failed to run",
    };
  }
  return { result: out.result, error: null };
};

export function addPinePlot(
  engine: ChartEngine,
  plot: RunResult["plots"][number],
  pane: number,
): SeriesHandle | null {
  const data = plot.data.filter((d) => d.value != null && isFinite(d.value));
  if (!data.length) return null;
  const lineWidth = Math.max(1, plot.linewidth || 1);
  if (plot.kind === "histogram" || plot.kind === "columns") {
    const opts: EngineSeriesOptions = {
      priceLineVisible: false,
      lastValueVisible: false,
      title: plot.title,
    };
    const h = engine.addSeries("histogram", opts, pane);
    const rows: EnginePointRow[] = data.map((d) => ({
      time: d.time,
      value: d.value,
      color: d.color || plot.color,
    }));
    h.setData(rows);
    return h;
  }
  if (plot.kind === "area") {
    const opts: EngineSeriesOptions = {
      lineColor: plot.color,
      topColor: plot.color,
      bottomColor: "rgba(0,0,0,0)",
      lineWidth,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    };
    const h = engine.addSeries("area", opts, pane);
    h.setData(data.map((d) => ({ time: d.time, value: d.value })));
    return h;
  }
  const kind: EngineSeriesKind = "line";
  const opts: EngineSeriesOptions = {
    color: plot.color,
    lineWidth,
    lineStyle: plot.kind === "stepline" ? 0 : 0,
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
    title: plot.title,
  };
  const h = engine.addSeries(kind, opts, pane);
  h.setData(data.map((d) => ({ time: d.time, value: d.value })));
  return h;
}

export function buildPineScriptOnEngine(
  engine: ChartEngine | null,
  priceH: SeriesHandle | null,
  script: PineScriptRow,
  rows: Bar[],
  subPane: number,
  maps: PineLayerMaps,
  pool: PinePriceLinePool,
  applyPriceMarkers: () => void,
  readCache: (script: PineScriptRow, rows: Bar[]) => PineCacheHit | null,
): { ok: boolean; usedPane: boolean } {
  if (!engine || !priceH) return { ok: false, usedPane: false };
  const outcome = readCache(script, rows);
  if (!outcome) return { ok: false, usedPane: false };
  const { result, error } = outcome;
  if (error || !result) {
    maps.errors.set(script.id, error || PINE_NO_OUTPUT_MSG);
    return { ok: false, usedPane: false };
  }
  maps.errors.delete(script.id);
  const overlay = result.meta.overlay;
  const pane = overlay ? 0 : subPane;
  const series: SeriesHandle[] = [];
  for (const plot of result.plots) {
    const s = addPinePlot(engine, plot, pane);
    if (s) series.push(s);
  }
  const anchor: SeriesHandle | null = series[0] || (overlay ? priceH : null);
  const anchoredOnPrice = anchor != null && anchor === priceH;
  if (anchoredOnPrice) pool.removeForScript(script.id);
  if (anchor) {
    for (const hl of result.hlines) {
      try {
        const pl = anchor.createPriceLine({
          price: hl.price,
          color: hl.color,
          lineWidth: 1,
          lineStyle: hl.style === "dashed" ? 2 : hl.style === "dotted" ? 1 : 0,
          axisLabelVisible: true,
          title: hl.title,
        });
        if (anchoredOnPrice) pool.track(script.id, pl);
      } catch { /* disposed mid-paint */ }
    }
  }
  if (anchor && result.shapes.length) {
    try {
      const markers: MarkerSpec[] = result.shapes.map((sh) => ({
        time: sh.time as MarkerSpec["time"],
        position: sh.position,
        shape: sh.shape,
        color: sh.color,
        text: sh.text,
      }));
      if (anchoredOnPrice) {
        maps.priceShapes.set(script.id, markers);
        applyPriceMarkers();
      } else {
        anchor.setMarkers(markers);
      }
    } catch { /* disposed mid-paint */ }
  }
  maps.series.set(script.id, series);
  const usedPane = !overlay && series.length > 0;
  if (usedPane) maps.paneMap.set(script.id, subPane);
  return { ok: true, usedPane };
}

export function clearPineLayer(
  maps: PineLayerMaps,
  pool: PinePriceLinePool,
  applyPriceMarkers: () => void,
): void {
  maps.priceShapes.clear();
  applyPriceMarkers();
  pool.removeAllPineKeys();
  for (const arr of maps.series.values()) {
    for (const s of arr) {
      try { s.remove(); } catch { /* idempotent / disposed */ }
    }
  }
  maps.series.clear();
  maps.paneMap.clear();
}

export function paintPineFromCacheOnEngine(
  engine: ChartEngine | null,
  priceH: SeriesHandle | null,
  scripts: PineScriptRow[],
  rows: Bar[],
  maps: PineLayerMaps,
  pool: PinePriceLinePool,
  applyPriceMarkers: () => void,
  readCache: (script: PineScriptRow, rows: Bar[]) => PineCacheHit | null,
  builtinPaneMax: number,
): void {
  if (!engine || !priceH || !scripts.length) return;
  let pane = builtinPaneMax;
  for (const s of scripts) {
    const { usedPane } = buildPineScriptOnEngine(
      engine, priceH, s, rows, pane, maps, pool, applyPriceMarkers, readCache,
    );
    if (usedPane) pane++;
  }
}

export function pineEpochStillCurrent(stamped: number, current: number): boolean {
  return current === stamped;
}

export type BuildAllPineHooks = {
  getEngine: () => ChartEngine | null;
  getScripts: () => PineScriptRow[];
  bumpEpoch: () => number;
  getEpoch: () => number;
  readCache: (script: PineScriptRow, rows: Bar[]) => PineCacheHit | null;
  clear: () => void;
  paint: (rows: Bar[]) => void;
  runMisses: (misses: PineScriptRow[], rows: Bar[]) => Promise<void>;
  afterSlowRepaint: () => void;
};

/** Sync fast path + optional async slow path with epoch guard. */
export function buildAllPineOnEngine(rows: Bar[], hooks: BuildAllPineHooks): void {
  if (!hooks.getEngine()) return;
  const scripts = hooks.getScripts();
  if (!scripts.length) return;
  const epoch = hooks.bumpEpoch();
  hooks.paint(rows);
  const misses = scripts.filter((s) => hooks.readCache(s, rows) === null);
  if (!misses.length) return;
  void hooks.runMisses(misses, rows).then(() => {
    if (!pineEpochStillCurrent(epoch, hooks.getEpoch())) return;
    if (!hooks.getEngine()) return;
    hooks.clear();
    hooks.paint(rows);
    hooks.afterSlowRepaint();
  });
}
