// Mastermind Chart Engine — lightweight-charts 5.2 adapter (P0).
//
// Thin, 1:1 mapping from the renderer-agnostic api.ts contract onto LWC 5.2. Every
// method here delegates to a single LWC call verified against the installed typings
// (node_modules/lightweight-charts/dist/typings.d.ts, v5.2.0). No behavior lives here
// that isn't already how ChartPanel drives LWC today — this is a boundary, not a policy
// layer. When a fact below contradicts intuition, it was checked against the source:
//
//   • series removal is chart.removeSeries(series) — ISeriesApi has NO .remove().
//   • markers are the createSeriesMarkers plugin, not a series method; the plugin
//     instance is created lazily on first setMarkers and reused thereafter.
//   • watermark is the createTextWatermark(pane, opts) plugin (chart-level watermark
//     was removed in v5); it is detached and recreated to "replace".
//   • addSeries(def, opts, paneIndex) clamps an out-of-range paneIndex to panes.length
//     and appends a new pane (getOrCreatePane); moveToPane does the same. The adapter
//     forwards the index untouched so that clamp still governs
//     (see lib/__tests__/subpaneAssign.test.ts).
//   • timeScale().scrollToRealTime() has a capital T in LWC; the contract's
//     scrollToRealtime() bridges to it.

import {
  createChart,
  CandlestickSeries,
  BarSeries,
  LineSeries,
  AreaSeries,
  HistogramSeries,
  BaselineSeries,
  createSeriesMarkers,
  createTextWatermark,
  type IChartApi,
  type ISeriesApi,
  type IPaneApi,
  type ITimeScaleApi,
  type IPriceLine,
  type ISeriesMarkersPluginApi,
  type ITextWatermarkPluginApi,
  type SeriesType,
  type SeriesDefinition,
  type SeriesMarker,
  type Time,
  type SeriesDataItemTypeMap,
  type SeriesPartialOptionsMap,
  type MouseEventParams,
  type LogicalRange,
  type DeepPartial,
  type ChartOptions,
  type TextWatermarkOptions,
} from "lightweight-charts";

import type {
  ChartEngine,
  EngineInventory,
  EngineOptions,
  EngineSeriesKind,
  EngineSeriesOptions,
  EngineSeriesRow,
  EngineLogicalRange,
  EngineLogicalRangeHandler,
  EngineMouseHandler,
  EngineMouseEventParams,
  EngineTime,
  MarkerSpec,
  PaneHandle,
  PriceLineHandle,
  PriceLineSpec,
  PriceScaleHandle,
  SeriesHandle,
  TimeScaleHandle,
  WatermarkLine,
  WatermarkSpec,
} from "../api";

const DISPOSED = "chart-engine: disposed";

// kind → LWC series-definition. The definition is what addSeries takes; the string
// literal type parameter (T extends SeriesType) is what threads through ISeriesApi.
const KIND_DEF: Record<EngineSeriesKind, SeriesDefinition<SeriesType>> = {
  candles: CandlestickSeries as SeriesDefinition<SeriesType>,
  bars: BarSeries as SeriesDefinition<SeriesType>,
  line: LineSeries as SeriesDefinition<SeriesType>,
  area: AreaSeries as SeriesDefinition<SeriesType>,
  histogram: HistogramSeries as SeriesDefinition<SeriesType>,
  baseline: BaselineSeries as SeriesDefinition<SeriesType>,
};

// The contract passes open bags (Record<string, unknown>) at the boundary; LWC's option
// and data types are exact per-kind unions. These casts are the single documented
// pass-through point — the contract deliberately does not model LWC's option surface
// (api.ts, law 1). Narrowing here would require re-deriving all of SeriesOptionsMap.
type LwcSeriesData = SeriesDataItemTypeMap<Time>[SeriesType][];
type LwcSeriesOptions = SeriesPartialOptionsMap[SeriesType];

// ── PriceLine handle ─────────────────────────────────────────────────────────
class LwcPriceLineHandle implements PriceLineHandle {
  private removed = false;
  constructor(
    private readonly series: ISeriesApi<SeriesType>,
    private readonly line: IPriceLine,
    private readonly aliveCheck: () => void,
  ) {}
  applyOptions(opts: Partial<PriceLineSpec>): void {
    this.aliveCheck();
    if (this.removed) return;
    this.line.applyOptions(opts);
  }
  remove(): void {
    if (this.removed) return;
    this.removed = true;
    // removePriceLine lives on the series; harmless if the series is already gone.
    try {
      this.series.removePriceLine(this.line);
    } catch {
      // series may have been removed already — the price line went with it.
    }
  }
  unwrap<T>(): T {
    return this.line as unknown as T;
  }
}

// ── Series handle ─────────────────────────────────────────────────────────────
class LwcSeriesHandle implements SeriesHandle {
  private removed = false;
  private markersPlugin: ISeriesMarkersPluginApi<Time> | null = null;
  constructor(
    public readonly kind: EngineSeriesKind,
    private readonly chart: IChartApi,
    private readonly series: ISeriesApi<SeriesType>,
    private readonly aliveCheck: () => void,
    private readonly onRemove: (h: LwcSeriesHandle) => void,
  ) {}

  private live(): void {
    this.aliveCheck();
    if (this.removed) throw new Error("chart-engine: series removed");
  }

  setData(rows: EngineSeriesRow[]): void {
    this.live();
    this.series.setData(rows as unknown as LwcSeriesData);
  }
  update(row: EngineSeriesRow, historicalUpdate?: boolean): void {
    this.live();
    this.series.update(row as unknown as LwcSeriesData[number], historicalUpdate);
  }
  applyOptions(opts: EngineSeriesOptions): void {
    this.live();
    this.series.applyOptions(opts as unknown as LwcSeriesOptions);
  }
  setMarkers(marks: MarkerSpec[]): void {
    this.live();
    const lwcMarks = marks as unknown as SeriesMarker<Time>[];
    if (this.markersPlugin) {
      this.markersPlugin.setMarkers(lwcMarks);
      return;
    }
    // Lazy: the plugin is only created the first time markers are actually set, so a
    // series that never shows markers never allocates one (mirrors ChartPanel).
    this.markersPlugin = createSeriesMarkers(this.series, lwcMarks);
  }
  createPriceLine(opts: PriceLineSpec): PriceLineHandle {
    this.live();
    const line = this.series.createPriceLine(opts);
    return new LwcPriceLineHandle(this.series, line, () => this.live());
  }
  priceToCoordinate(price: number): number | null {
    this.live();
    return this.series.priceToCoordinate(price) as number | null;
  }
  coordinateToPrice(y: number): number | null {
    this.live();
    return this.series.coordinateToPrice(y) as number | null;
  }
  paneIndex(): number {
    this.live();
    return this.series.getPane().paneIndex();
  }
  pane(): PaneHandle {
    this.live();
    // Resolve by index, not by caching the IPaneApi — pane objects dangle after a pane
    // collapse (see LwcPaneHandle).
    return new LwcPaneHandle(this.chart, this.series.getPane().paneIndex(), this.aliveCheck);
  }
  moveToPane(paneIndex: number): void {
    this.live();
    this.series.moveToPane(paneIndex);
  }
  attachPrimitive(primitive: unknown): void {
    this.live();
    this.series.attachPrimitive(primitive as Parameters<ISeriesApi<SeriesType>["attachPrimitive"]>[0]);
  }
  detachPrimitive(primitive: unknown): void {
    this.live();
    this.series.detachPrimitive(primitive as Parameters<ISeriesApi<SeriesType>["detachPrimitive"]>[0]);
  }
  remove(): void {
    if (this.removed) return;
    this.removed = true;
    // Detach the markers primitive first so it doesn't outlive the series.
    if (this.markersPlugin) {
      try {
        this.markersPlugin.detach();
      } catch {
        // plugin already detached with the series — ignore.
      }
      this.markersPlugin = null;
    }
    try {
      this.chart.removeSeries(this.series);
    } catch {
      // chart may be disposed — series is gone regardless.
    }
    this.onRemove(this);
  }
  unwrap<T>(): T {
    return this.series as unknown as T;
  }
}

// ── Pane handle ───────────────────────────────────────────────────────────────
// Panes are transient in LWC (removeSeries can splice an empty pane and slide the rest
// down), so a PaneHandle resolves the live IPaneApi by index on each call rather than
// caching one — a cached IPaneApi can dangle after a pane collapse.
class LwcPaneHandle implements PaneHandle {
  constructor(
    private readonly chart: IChartApi,
    private readonly idx: number,
    private readonly aliveCheck: () => void,
  ) {}
  private pane(): IPaneApi<Time> {
    this.aliveCheck();
    const panes = this.chart.panes();
    const p = panes[this.idx];
    if (!p) throw new Error(`chart-engine: pane ${this.idx} no longer exists`);
    return p;
  }
  index(): number {
    return this.idx;
  }
  height(): number {
    return this.pane().getHeight();
  }
  setHeight(px: number): void {
    this.pane().setHeight(px);
  }
  setStretchFactor(factor: number): void {
    this.pane().setStretchFactor(factor);
  }
  stretchFactor(): number {
    return this.pane().getStretchFactor();
  }
  getHTMLElement(): HTMLElement | null {
    return this.pane().getHTMLElement();
  }
  unwrap<T>(): T {
    return this.pane() as unknown as T;
  }
}

// ── PriceScale handle ─────────────────────────────────────────────────────────
// Resolved live per call by (id, paneIndex) — scales are chart-owned; holding the raw
// IPriceScaleApi across pane churn is safe in LWC but resolving keeps disposal honest.
class LwcPriceScaleHandle implements PriceScaleHandle {
  constructor(
    private readonly getChart: () => IChartApi,
    private readonly id: string,
    private readonly paneIdx: number | undefined,
  ) {}
  private scale() {
    return this.getChart().priceScale(this.id, this.paneIdx);
  }
  width(): number {
    return this.scale().width();
  }
  applyOptions(opts: Record<string, unknown>): void {
    this.scale().applyOptions(opts as Parameters<ReturnType<IChartApi["priceScale"]>["applyOptions"]>[0]);
  }
  unwrap<T>(): T {
    return this.scale() as unknown as T;
  }
}

// ── TimeScale handle ──────────────────────────────────────────────────────────
class LwcTimeScaleHandle implements TimeScaleHandle {
  constructor(
    private readonly ts: ITimeScaleApi<Time>,
    private readonly aliveCheck: () => void,
  ) {}
  getVisibleLogicalRange(): EngineLogicalRange | null {
    this.aliveCheck();
    const r = this.ts.getVisibleLogicalRange();
    return r ? { from: r.from as number, to: r.to as number } : null;
  }
  setVisibleLogicalRange(range: EngineLogicalRange): void {
    this.aliveCheck();
    this.ts.setVisibleLogicalRange(range);
  }
  subscribeVisibleLogicalRangeChange(handler: EngineLogicalRangeHandler): void {
    this.aliveCheck();
    this.ts.subscribeVisibleLogicalRangeChange(this.wrapRange(handler));
  }
  unsubscribeVisibleLogicalRangeChange(handler: EngineLogicalRangeHandler): void {
    this.aliveCheck();
    this.ts.unsubscribeVisibleLogicalRangeChange(this.wrapRange(handler));
  }
  timeToCoordinate(time: EngineTime): number | null {
    this.aliveCheck();
    return this.ts.timeToCoordinate(time as Time) as number | null;
  }
  coordinateToTime(x: number): EngineTime | null {
    this.aliveCheck();
    return this.ts.coordinateToTime(x) as EngineTime | null;
  }
  scrollToRealtime(): void {
    this.aliveCheck();
    this.ts.scrollToRealTime();
  }
  scrollToPosition(position: number, animated = false): void {
    this.aliveCheck();
    this.ts.scrollToPosition(position, animated);
  }
  applyOptions(opts: Record<string, unknown>): void {
    this.aliveCheck();
    this.ts.applyOptions(opts as Parameters<ITimeScaleApi<Time>["applyOptions"]>[0]);
  }
  fitContent(): void {
    this.aliveCheck();
    this.ts.fitContent();
  }
  unwrap<T>(): T {
    return this.ts as unknown as T;
  }

  // LWC identifies handlers by reference for unsubscribe. A fresh wrapper per call would
  // never match on unsubscribe, so wrappers are memoized by the user's handler identity —
  // subscribe and unsubscribe with the same handler resolve to the same LWC callback.
  private readonly rangeWrappers = new WeakMap<EngineLogicalRangeHandler, (r: LogicalRange | null) => void>();
  private wrapRange(handler: EngineLogicalRangeHandler): (r: LogicalRange | null) => void {
    let w = this.rangeWrappers.get(handler);
    if (!w) {
      w = (r: LogicalRange | null) => handler(r ? { from: r.from as number, to: r.to as number } : null);
      this.rangeWrappers.set(handler, w);
    }
    return w;
  }
}

// ── Engine ──────────────────────────────────────────────────────────────────
class LwcChartEngine implements ChartEngine {
  private chart: IChartApi | null;
  private readonly series = new Set<LwcSeriesHandle>();
  private readonly watermarks = new Map<number, ITextWatermarkPluginApi<Time>>();
  private timeScaleHandle: LwcTimeScaleHandle | null = null;

  // Same memoization contract as the time-scale range handlers: a user handler maps to
  // exactly one LWC callback so subscribe/unsubscribe pair up by reference.
  private readonly mouseWrappers = new WeakMap<EngineMouseHandler, (p: MouseEventParams) => void>();

  constructor(container: HTMLElement, options?: EngineOptions) {
    this.chart = createChart(container, (options ?? {}) as DeepPartial<ChartOptions>);
  }

  private ensure(): IChartApi {
    if (!this.chart) throw new Error(DISPOSED);
    return this.chart;
  }

  addSeries(kind: EngineSeriesKind, options?: EngineSeriesOptions, paneIndex?: number): SeriesHandle {
    const chart = this.ensure();
    const def = KIND_DEF[kind];
    const s = chart.addSeries(def, options as LwcSeriesOptions | undefined, paneIndex);
    const handle = new LwcSeriesHandle(
      kind,
      chart,
      s,
      () => this.ensure(),
      (h) => this.series.delete(h),
    );
    this.series.add(handle);
    return handle;
  }

  panes(): PaneHandle[] {
    const chart = this.ensure();
    return chart.panes().map((_p, i) => new LwcPaneHandle(chart, i, () => this.ensure()));
  }

  timeScale(): TimeScaleHandle {
    const chart = this.ensure();
    // One handle per engine keeps the range-handler wrapper memo stable across calls, so
    // subscribe/unsubscribe pairs survive repeated timeScale() lookups.
    if (!this.timeScaleHandle) {
      this.timeScaleHandle = new LwcTimeScaleHandle(chart.timeScale(), () => this.ensure());
    }
    return this.timeScaleHandle;
  }

  priceScale(priceScaleId: string, paneIndex?: number): PriceScaleHandle {
    this.ensure();
    return new LwcPriceScaleHandle(() => this.ensure(), priceScaleId, paneIndex);
  }

  paneSize(paneIndex?: number): { width: number; height: number } {
    const s = this.ensure().paneSize(paneIndex);
    return { width: s.width, height: s.height };
  }

  swapPanes(first: number, second: number): void {
    this.ensure().swapPanes(first, second);
  }

  takeScreenshot(): HTMLCanvasElement {
    return this.ensure().takeScreenshot();
  }

  applyOptions(options: EngineOptions): void {
    this.ensure().applyOptions(options as DeepPartial<ChartOptions>);
  }

  private wrapMouse(handler: EngineMouseHandler): (p: MouseEventParams) => void {
    let w = this.mouseWrappers.get(handler);
    if (!w) {
      w = (p: MouseEventParams) => handler(p as unknown as EngineMouseEventParams);
      this.mouseWrappers.set(handler, w);
    }
    return w;
  }

  subscribeCrosshairMove(handler: EngineMouseHandler): void {
    this.ensure().subscribeCrosshairMove(this.wrapMouse(handler));
  }
  unsubscribeCrosshairMove(handler: EngineMouseHandler): void {
    this.ensure().unsubscribeCrosshairMove(this.wrapMouse(handler));
  }
  subscribeClick(handler: EngineMouseHandler): void {
    this.ensure().subscribeClick(this.wrapMouse(handler));
  }
  unsubscribeClick(handler: EngineMouseHandler): void {
    this.ensure().unsubscribeClick(this.wrapMouse(handler));
  }
  subscribeDblClick(handler: EngineMouseHandler): void {
    this.ensure().subscribeDblClick(this.wrapMouse(handler));
  }
  unsubscribeDblClick(handler: EngineMouseHandler): void {
    this.ensure().unsubscribeDblClick(this.wrapMouse(handler));
  }

  setWatermark(paneIndex: number, spec: WatermarkSpec | WatermarkLine[]): void {
    const chart = this.ensure();
    const pane = chart.panes()[paneIndex];
    if (!pane) throw new Error(`chart-engine: pane ${paneIndex} does not exist`);
    // Replace: LWC watermarks are additive plugins, so drop the previous one on this pane
    // before creating the new one — otherwise re-calling stacks watermarks.
    const prev = this.watermarks.get(paneIndex);
    if (prev) {
      try {
        prev.detach();
      } catch {
        // pane/plugin already gone — nothing to detach.
      }
      this.watermarks.delete(paneIndex);
    }
    const norm: WatermarkSpec = Array.isArray(spec) ? { lines: spec } : spec;
    const opts: DeepPartial<TextWatermarkOptions> = {
      visible: norm.visible ?? true,
      horzAlign: norm.horzAlign,
      vertAlign: norm.vertAlign,
      lines: norm.lines.map((l) => ({
        text: l.text,
        color: l.color ?? "rgba(255,255,255,0.06)",
        fontSize: l.fontSize ?? 44,
        // LWC's TextWatermarkLineOptions requires fontFamily/fontStyle; supply neutral
        // defaults so callers pass only what varies.
        fontFamily: l.fontFamily,
        fontStyle: l.fontStyle ?? "",
        lineHeight: l.lineHeight,
      })),
    };
    const wm = createTextWatermark(pane, opts);
    this.watermarks.set(paneIndex, wm);
  }

  resize(width: number, height: number, forceRepaint?: boolean): void {
    this.ensure().resize(width, height, forceRepaint);
  }

  unwrap<T>(): T {
    return this.ensure() as unknown as T;
  }

  // Census read from LWC's own public surface (panes() / pane.getSeries() /
  // series.priceLines()), never from this.series — that Set only sees handles created
  // through addSeries(), and ChartPanel still creates most of its series on the
  // unwrapped IChartApi. Asking the renderer is what makes the count able to catch a
  // resource we never tracked. Every read is individually guarded: a pane or series
  // torn down between two lines of this loop must not turn a census into a throw.
  inventory(): EngineInventory {
    const chart = this.chart;
    if (!chart) return { alive: false, panes: 0, series: 0, seriesByPane: [], priceLines: 0, watermarks: 0 };
    let panes: ReturnType<IChartApi["panes"]> = [];
    try {
      panes = chart.panes();
    } catch {
      return { alive: true, panes: 0, series: 0, seriesByPane: [], priceLines: 0, watermarks: this.watermarks.size };
    }
    const seriesByPane: number[] = [];
    let series = 0;
    let priceLines = 0;
    for (const pane of panes) {
      let list: ISeriesApi<SeriesType>[] = [];
      try {
        list = pane.getSeries();
      } catch {
        // pane vanished mid-census — count it as empty rather than losing the whole reading.
      }
      seriesByPane.push(list.length);
      series += list.length;
      for (const s of list) {
        try {
          priceLines += s.priceLines().length;
        } catch {
          // series removed mid-census; its price lines went with it.
        }
      }
    }
    return { alive: true, panes: panes.length, series, seriesByPane, priceLines, watermarks: this.watermarks.size };
  }

  destroy(): void {
    if (!this.chart) return; // idempotent
    for (const wm of this.watermarks.values()) {
      try {
        wm.detach();
      } catch {
        // ignore — chart.remove() below tears everything down anyway.
      }
    }
    this.watermarks.clear();
    // Series markers/plugins are owned by the chart; chart.remove() disposes them. We
    // still clear our bookkeeping so post-destroy handle calls hit the removed guard.
    this.series.clear();
    this.timeScaleHandle = null;
    const chart = this.chart;
    this.chart = null;
    chart.remove();
  }
}

export function createLwcEngine(container: HTMLElement, options?: EngineOptions): ChartEngine {
  return new LwcChartEngine(container, options);
}
