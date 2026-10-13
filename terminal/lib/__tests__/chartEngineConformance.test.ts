// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Engine conformance suite (Q01). Runs lib/chart-engine/conformance.ts — the
// factory-agnostic harness — against two engines:
//
//   1. the real LWC adapter over a vi.hoisted fake "lightweight-charts"
//      registry, mirroring lwcAdapter.test.ts's mocking style (jsdom has no
//      canvas, so real LWC cannot run). The stand-in here is richer than the
//      house one where the harness needs behaviour, not just delegation:
//      setData/update/data() model LWC's replace-or-append, the time scale is
//      stateful and fires range subscribers on programmatic sets (LWC does,
//      via its invalidate mask), crosshair subscriptions are wired to the
//      container's mousemove, and swapPanes actually swaps.
//   2. a deliberately BROKEN fake engine, driven through the harness's
//      headless collector, proving each planted defect turns its check RED.
//      The falsifier asserts the failures EXIST — a broken engine must not
//      pass conformance.
// ─────────────────────────────────────────────────────────────────────────────

const H = vi.hoisted(() => {
  type Spy = ReturnType<typeof vi.fn>;
  interface FakePriceLine {
    __opts: unknown;
    applyOptions: Spy;
  }
  interface FakeSeries {
    __def: unknown;
    __opts: unknown;
    __paneIndex: number;
    __rows: unknown[];
    __priceLines: FakePriceLine[];
    setData: Spy;
    update: Spy;
    data: Spy;
    applyOptions: Spy;
    createPriceLine: Spy;
    removePriceLine: Spy;
    priceLines: Spy;
    priceToCoordinate: Spy;
    coordinateToPrice: Spy;
    moveToPane: Spy;
    getPane: Spy;
    attachPrimitive: Spy;
    detachPrimitive: Spy;
  }
  interface FakePane {
    __series: FakeSeries[];
    getSeries: Spy;
    paneIndex: Spy;
    getHeight: Spy;
    setHeight: Spy;
    getStretchFactor: Spy;
    setStretchFactor: Spy;
    getHTMLElement: Spy;
  }
  interface FakeTimeScale {
    __subs: Set<(r: unknown) => void>;
    getVisibleLogicalRange: Spy;
    setVisibleLogicalRange: Spy;
    subscribeVisibleLogicalRangeChange: Spy;
    unsubscribeVisibleLogicalRangeChange: Spy;
    timeToCoordinate: Spy;
    coordinateToTime: Spy;
    scrollToRealTime: Spy;
    scrollToPosition: Spy;
    applyOptions: Spy;
    fitContent: Spy;
  }
  interface FakeChart {
    __opts: unknown;
    __ts: FakeTimeScale;
    __panes: FakePane[];
    panes: Spy;
    timeScale: Spy;
    addSeries: Spy;
    removeSeries: Spy;
    applyOptions: Spy;
    subscribeCrosshairMove: Spy;
    unsubscribeCrosshairMove: Spy;
    subscribeClick: Spy;
    unsubscribeClick: Spy;
    subscribeDblClick: Spy;
    unsubscribeDblClick: Spy;
    resize: Spy;
    remove: Spy;
    priceScale: Spy;
    paneSize: Spy;
    swapPanes: Spy;
    takeScreenshot: Spy;
  }
  const reg = {
    charts: [] as FakeChart[],
    markers: [] as { __series: unknown; __initialMarkers: unknown; setMarkers: Spy; detach: Spy }[],
    watermarks: [] as { __pane: unknown; __opts: unknown; detach: Spy }[],
    reset(): void {
      reg.charts.length = 0;
      reg.markers.length = 0;
      reg.watermarks.length = 0;
    },
  };

  // chartRef breaks the pane/series → chart cycle during construction.
  const chartRef: { chart: FakeChart | null } = { chart: null };

  const makePane = (index: number): FakePane => {
    const pane: FakePane = {
      __series: [],
      getSeries: vi.fn(() => pane.__series),
      // Dynamic: after swapPanes the pane's index is its slot in the array.
      paneIndex: vi.fn(() => (chartRef.chart ? chartRef.chart.__panes.indexOf(pane) : index)),
      getHeight: vi.fn(() => 100 + index),
      setHeight: vi.fn(),
      getStretchFactor: vi.fn(() => index + 1),
      setStretchFactor: vi.fn(),
      getHTMLElement: vi.fn(() => null),
    };
    return pane;
  };

  const makeSeries = (def: unknown, opts: unknown, paneIndex: number): FakeSeries => {
    const s: FakeSeries = {
      __def: def,
      __opts: opts,
      __paneIndex: paneIndex,
      __rows: [],
      __priceLines: [],
      // LWC semantics: setData replaces; update replaces the last row when the
      // time matches, appends when it advances.
      setData: vi.fn((rows: unknown[]) => {
        s.__rows = rows.slice();
      }),
      update: vi.fn((row: { time: unknown }) => {
        const rows = s.__rows;
        const last = rows[rows.length - 1] as { time: unknown } | undefined;
        if (last && String(last.time) === String(row.time)) rows[rows.length - 1] = row;
        else rows.push(row);
      }),
      data: vi.fn(() => s.__rows.slice()),
      applyOptions: vi.fn(),
      priceToCoordinate: vi.fn((p: number) => p * 2),
      coordinateToPrice: vi.fn((y: number) => y / 2),
      moveToPane: vi.fn((idx: number) => {
        const chart = chartRef.chart;
        if (!chart) return;
        const from = chart.__panes[s.__paneIndex];
        if (from) {
          const at = from.__series.indexOf(s);
          if (at !== -1) from.__series.splice(at, 1);
        }
        s.__paneIndex = idx;
        while (chart.__panes.length <= idx) chart.__panes.push(makePane(chart.__panes.length));
        chart.__panes[Math.min(idx, chart.__panes.length - 1)].__series.push(s);
      }),
      getPane: vi.fn(() => {
        const chart = chartRef.chart as FakeChart;
        const idx = Math.min(chart.__panes.length, s.__paneIndex);
        while (chart.__panes.length <= idx) chart.__panes.push(makePane(chart.__panes.length));
        return chart.__panes[Math.min(idx, chart.__panes.length - 1)];
      }),
      attachPrimitive: vi.fn(),
      detachPrimitive: vi.fn(),
      createPriceLine: vi.fn((o: unknown) => {
        const pl: FakePriceLine = { __opts: o, applyOptions: vi.fn() };
        s.__priceLines.push(pl);
        return pl;
      }),
      removePriceLine: vi.fn((line: FakePriceLine) => {
        const at = s.__priceLines.indexOf(line);
        if (at !== -1) s.__priceLines.splice(at, 1);
      }),
      priceLines: vi.fn(() => s.__priceLines),
    };
    return s;
  };

  const makeTimeScale = (): FakeTimeScale => {
    let range = { from: 10, to: 20 };
    const subs = new Set<(r: unknown) => void>();
    return {
      __subs: subs,
      getVisibleLogicalRange: vi.fn(() => range),
      // A programmatic set fires subscribers with the applied range (LWC routes
      // this through its invalidate mask, which fires logical-range-changed).
      setVisibleLogicalRange: vi.fn((r: { from: number; to: number }) => {
        range = { from: r.from, to: r.to };
        for (const fn of subs) fn({ from: range.from, to: range.to });
      }),
      subscribeVisibleLogicalRangeChange: vi.fn((fn: (r: unknown) => void) => subs.add(fn)),
      unsubscribeVisibleLogicalRangeChange: vi.fn((fn: (r: unknown) => void) => subs.delete(fn)),
      timeToCoordinate: vi.fn(() => 42),
      coordinateToTime: vi.fn(() => 1_700_000_000),
      scrollToRealTime: vi.fn(),
      scrollToPosition: vi.fn(),
      applyOptions: vi.fn(),
      fitContent: vi.fn(),
    };
  };

  const createChart = vi.fn((_container: unknown, opts: unknown): FakeChart => {
    const ts = makeTimeScale();
    const crossSubs = new Set<(p: unknown) => void>();
    const clickSubs = new Set<(p: unknown) => void>();
    const dblSubs = new Set<(p: unknown) => void>();
    const chart: FakeChart = {
      __opts: opts,
      __ts: ts,
      __panes: [makePane(0)],
      panes: vi.fn(() => chart.__panes),
      timeScale: vi.fn(() => ts),
      addSeries: vi.fn((def: unknown, o: unknown, paneIndex?: number) => {
        const idx = Math.min(chart.__panes.length, paneIndex ?? 0);
        while (chart.__panes.length <= idx) chart.__panes.push(makePane(chart.__panes.length));
        const series = makeSeries(def, o, idx);
        chart.__panes[idx].__series.push(series);
        return series;
      }),
      removeSeries: vi.fn((series: FakeSeries) => {
        for (const pane of chart.__panes) {
          const at = pane.__series.indexOf(series);
          if (at !== -1) {
            pane.__series.splice(at, 1);
            series.__priceLines.length = 0; // lines die with their series
            return;
          }
        }
      }),
      applyOptions: vi.fn(),
      subscribeCrosshairMove: vi.fn((fn: (p: unknown) => void) => crossSubs.add(fn)),
      unsubscribeCrosshairMove: vi.fn((fn: (p: unknown) => void) => crossSubs.delete(fn)),
      subscribeClick: vi.fn((fn: (p: unknown) => void) => clickSubs.add(fn)),
      unsubscribeClick: vi.fn((fn: (p: unknown) => void) => clickSubs.delete(fn)),
      subscribeDblClick: vi.fn((fn: (p: unknown) => void) => dblSubs.add(fn)),
      unsubscribeDblClick: vi.fn((fn: (p: unknown) => void) => dblSubs.delete(fn)),
      resize: vi.fn(),
      remove: vi.fn(),
      priceScale: vi.fn(() => ({ width: vi.fn(() => 57), applyOptions: vi.fn() })),
      paneSize: vi.fn(() => ({ width: 800, height: 400 })),
      swapPanes: vi.fn((a: number, b: number) => {
        const pa = chart.__panes[a];
        const pb = chart.__panes[b];
        if (!pa || !pb) return;
        for (const s of pa.__series) s.__paneIndex = b;
        for (const s of pb.__series) s.__paneIndex = a;
        chart.__panes[a] = pb;
        chart.__panes[b] = pa;
      }),
      takeScreenshot: vi.fn(() => document.createElement("canvas")),
    };
    chartRef.chart = chart;
    // Crosshair wiring: subscriptions fire on the container's mousemove, the
    // stand-in for LWC's canvas-level crosshair events.
    const el = _container as HTMLElement | null | undefined;
    if (el && typeof el.addEventListener === "function") {
      el.addEventListener("mousemove", (ev: MouseEvent) => {
        for (const fn of crossSubs) fn({ point: { x: ev.clientX, y: ev.clientY } });
      });
    }
    reg.charts.push(chart);
    return chart;
  });

  const createSeriesMarkers = vi.fn((series: unknown, marks: unknown) => {
    const p = { __series: series, __initialMarkers: marks, setMarkers: vi.fn(), detach: vi.fn() };
    reg.markers.push(p);
    return p;
  });

  const createTextWatermark = vi.fn((pane: unknown, opts: unknown) => {
    const w = { __pane: pane, __opts: opts, detach: vi.fn() };
    reg.watermarks.push(w);
    return w;
  });

  const defs = {
    CandlestickSeries: { seriesType: "Candlestick" },
    BarSeries: { seriesType: "Bar" },
    LineSeries: { seriesType: "Line" },
    AreaSeries: { seriesType: "Area" },
    HistogramSeries: { seriesType: "Histogram" },
    BaselineSeries: { seriesType: "Baseline" },
  };

  const MismatchDirection = { NearestLeft: -1, None: 0, NearestRight: 1 } as const;

  return { reg, createChart, createSeriesMarkers, createTextWatermark, defs, MismatchDirection };
});

vi.mock("lightweight-charts", () => ({
  createChart: H.createChart,
  createSeriesMarkers: H.createSeriesMarkers,
  createTextWatermark: H.createTextWatermark,
  CandlestickSeries: H.defs.CandlestickSeries,
  BarSeries: H.defs.BarSeries,
  LineSeries: H.defs.LineSeries,
  AreaSeries: H.defs.AreaSeries,
  HistogramSeries: H.defs.HistogramSeries,
  BaselineSeries: H.defs.BaselineSeries,
  MismatchDirection: H.MismatchDirection,
}));

import { createLwcEngine } from "../chart-engine/lwc";
import {
  runEngineConformance,
  collectEngineConformance,
  loadConformanceCorpus,
  mulberry32,
} from "../chart-engine/conformance";
import type {
  ChartEngine,
  EngineLogicalRange,
  EngineLogicalRangeHandler,
  EngineMouseHandler,
  EngineOptions,
  EngineSeriesKind,
  EngineSeriesOptions,
  EngineSeriesRow,
  PaneHandle,
  PriceLineHandle,
  PriceLineSpec,
  PriceScaleHandle,
  SeriesHandle,
  TimeScaleHandle,
  WatermarkLine,
  WatermarkSpec,
} from "../chart-engine/api";
import corpusJson from "./fixtures/chart-engine-corpus.json";

beforeEach(() => {
  H.reg.reset();
  vi.clearAllMocks();
});

// ── (1) The LWC adapter through the factory-agnostic harness ─────────────────
runEngineConformance("LWC adapter (fake registry)", (container) => createLwcEngine(container));

// ── (2) Corpus laws (Q01-A02) ─────────────────────────────────────────────────
describe("conformance corpus", () => {
  it("is version 1, small (< 100 KB), and deterministic", () => {
    expect(corpusJson.version).toBe(1);
    expect(JSON.stringify(corpusJson).length).toBeLessThan(100 * 1024);
    const a = mulberry32(7);
    const b = mulberry32(7);
    expect(Array.from({ length: 16 }, () => a())).toEqual(Array.from({ length: 16 }, () => b()));
    const first = loadConformanceCorpus();
    const second = loadConformanceCorpus();
    expect(first.dense40k.rows.length).toBe(40000);
    expect(second.dense40k.rows.length).toBe(40000);
    expect(first.dense40k.rows[0]).toEqual(second.dense40k.rows[0]);
    expect(first.dense40k.rows[39999]).toEqual(second.dense40k.rows[39999]);
  });

  it("covers all six series kinds across its six inline fixtures", () => {
    const fixtures = corpusJson.fixtures as Record<string, { kind: EngineSeriesKind; rows: EngineSeriesRow[] }>;
    expect(Object.keys(fixtures)).toEqual(["daily", "intraday_1h", "gapped", "halted", "one_bar", "negative"]);
    expect(new Set(Object.values(fixtures).map((f) => f.kind)).size).toBe(6);
    expect(fixtures.daily.rows).toHaveLength(60);
    expect(fixtures.intraday_1h.rows).toHaveLength(48);
    // Two sessions with an overnight gap: stamps 23→24 jump a session boundary.
    const intra = fixtures.intraday_1h.rows as { time: number }[];
    expect(intra[24].time - intra[23].time).toBeGreaterThan(0);
    expect(fixtures.gapped.rows).toHaveLength(60);
    expect(fixtures.gapped.rows.filter((r) => !("value" in r))).toHaveLength(3);
    expect(fixtures.halted.rows).toHaveLength(10);
    expect(fixtures.one_bar.rows).toHaveLength(1);
    const neg = fixtures.negative.rows as { value: number }[];
    expect(neg.some((r) => r.value < 0)).toBe(true);
    expect(neg.some((r) => r.value > 0)).toBe(true);
  });
});

// ── (3) The falsifier: a broken engine must go RED per defect ─────────────────
// A self-contained ChartEngine stand-in (it does NOT use the LWC registry) with
// switchable defects. Clean, it passes conformance; each defect must turn its
// check(s) RED — asserted through the headless collector.
type FakeDefect = "update-appends-duplicates" | "destroy-not-zeroing" | "watermark-stacks";

function fakePriceScale(): PriceScaleHandle {
  return {
    width: () => 57,
    applyOptions: () => undefined,
    options: () => ({}),
    getVisibleRange: () => null,
    setVisibleRange: () => undefined,
    setAutoScale: () => undefined,
    unwrap: <T>(): T => ({}) as unknown as T,
  };
}

class FakeEngine implements ChartEngine {
  readonly impl = "lwc" as const;
  private destroyed = false;
  private paneSeries: FakeEngineSeries[][] = [[]];
  // One watermark entry list per pane; its length is the census count.
  private watermarksByPane = new Map<number, WatermarkLine[]>();
  private range: EngineLogicalRange = { from: 0, to: 0 };
  private rangeSubs = new Set<EngineLogicalRangeHandler>();
  private crossSubs = new Set<EngineMouseHandler>();

  constructor(
    private readonly container: HTMLElement,
    private readonly defects: FakeDefect[],
  ) {
    container.addEventListener("mousemove", (ev: MouseEvent) => {
      for (const fn of this.crossSubs) fn({ point: { x: ev.clientX, y: ev.clientY } });
    });
  }

  private has(defect: FakeDefect): boolean {
    return this.defects.includes(defect);
  }

  addSeries(kind: EngineSeriesKind, _options?: EngineSeriesOptions, paneIndex?: number): SeriesHandle {
    if (this.destroyed) throw new Error("fake-engine: disposed");
    const idx = Math.min(this.paneSeries.length, paneIndex ?? 0);
    while (this.paneSeries.length <= idx) this.paneSeries.push([]);
    const s = new FakeEngineSeries(this, kind, idx, this.has("update-appends-duplicates"));
    this.paneSeries[idx].push(s);
    return s;
  }

  panes(): PaneHandle[] {
    return this.paneSeries.map((_p, i) => new FakeEnginePane(i, this));
  }

  seriesInPane(idx: number): SeriesHandle[] {
    return (this.paneSeries[idx] ?? []).slice();
  }

  removeSeries(series: SeriesHandle): void {
    series.remove();
  }

  chartElement(): HTMLElement {
    return this.container;
  }

  options(): EngineOptions {
    return {};
  }

  setCrosshairPosition(): void {}
  clearCrosshairPosition(): void {}

  timeScale(): TimeScaleHandle {
    return {
      getVisibleLogicalRange: () => (this.destroyed ? null : this.range),
      setVisibleLogicalRange: (r) => {
        this.range = { from: r.from, to: r.to };
        for (const fn of this.rangeSubs) fn({ from: r.from, to: r.to });
      },
      subscribeVisibleLogicalRangeChange: (h) => this.rangeSubs.add(h),
      unsubscribeVisibleLogicalRangeChange: (h) => this.rangeSubs.delete(h),
      timeToCoordinate: () => null,
      coordinateToTime: () => null,
      scrollToRealtime: () => undefined,
      scrollToPosition: () => undefined,
      applyOptions: () => undefined,
      fitContent: () => undefined,
      getVisibleRange: () => null,
      setVisibleRange: () => undefined,
      logicalToCoordinate: () => null,
      coordinateToLogical: () => null,
      width: () => 800,
      timeToIndex: () => null,
      options: () => ({}),
      unwrap: <T>(): T => ({ __fakeTimeScale: true }) as unknown as T,
    };
  }

  priceScale(): PriceScaleHandle {
    return fakePriceScale();
  }

  paneSize(): { width: number; height: number } {
    return { width: 800, height: 400 };
  }

  swapPanes(first: number, second: number): void {
    const a = this.paneSeries[first];
    const b = this.paneSeries[second];
    if (!a || !b) return;
    for (const s of a) s.moveToIndex(second);
    for (const s of b) s.moveToIndex(first);
    this.paneSeries[first] = b;
    this.paneSeries[second] = a;
  }

  takeScreenshot(): HTMLCanvasElement {
    return document.createElement("canvas");
  }

  applyOptions(): void {}

  subscribeCrosshairMove(handler: EngineMouseHandler): void {
    this.crossSubs.add(handler);
  }
  unsubscribeCrosshairMove(handler: EngineMouseHandler): void {
    this.crossSubs.delete(handler);
  }
  subscribeClick(): void {}
  unsubscribeClick(): void {}
  subscribeDblClick(): void {}
  unsubscribeDblClick(): void {}

  setWatermark(paneIndex: number, spec: WatermarkSpec | WatermarkLine[]): void {
    if (this.destroyed) throw new Error("fake-engine: disposed");
    const lines = Array.isArray(spec) ? spec : spec.lines;
    const cur = this.watermarksByPane.get(paneIndex) ?? [];
    // Replace semantics: one watermark per pane. The defect stacks instead.
    this.watermarksByPane.set(paneIndex, this.has("watermark-stacks") ? [...cur, ...lines] : [...lines]);
  }

  resize(): void {}

  unwrap<T>(): T {
    return { __fakeEngine: true } as unknown as T;
  }

  inventory() {
    if (this.destroyed && !this.has("destroy-not-zeroing")) {
      return { alive: false, panes: 0, series: 0, seriesByPane: [], priceLines: 0, watermarks: 0 };
    }
    const seriesByPane = this.paneSeries.map((p) => p.length);
    let priceLines = 0;
    for (const pane of this.paneSeries) for (const s of pane) priceLines += s.priceLineCount();
    return {
      alive: true,
      panes: this.paneSeries.length,
      series: seriesByPane.reduce((a, b) => a + b, 0),
      seriesByPane,
      priceLines,
      watermarks: [...this.watermarksByPane.values()].reduce((a, b) => a + b.length, 0),
    };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.has("destroy-not-zeroing")) return; // defect: nothing is released
    this.paneSeries = [[]];
    this.watermarksByPane.clear();
    this.rangeSubs.clear();
    this.crossSubs.clear();
  }

  // Series-relocation internals (mirrors how the adapter delegates series
  // removal to the chart, not to the series).
  moveSeries(s: FakeEngineSeries, idx: number): void {
    for (const pane of this.paneSeries) {
      const at = pane.indexOf(s);
      if (at !== -1) pane.splice(at, 1);
    }
    while (this.paneSeries.length <= idx) this.paneSeries.push([]);
    this.paneSeries[idx].push(s);
  }

  dropSeries(s: FakeEngineSeries): void {
    for (const pane of this.paneSeries) {
      const at = pane.indexOf(s);
      if (at !== -1) pane.splice(at, 1);
    }
  }
}

class FakeEnginePane implements PaneHandle {
  constructor(
    private readonly idx: number,
    private readonly engine: FakeEngine | null = null,
  ) {}
  index(): number {
    return this.idx;
  }
  getSeries(): SeriesHandle[] {
    return this.engine ? this.engine.seriesInPane(this.idx) : [];
  }
  priceScale(): PriceScaleHandle {
    return fakePriceScale();
  }
  height(): number {
    return 100 + this.idx;
  }
  setHeight(): void {}
  setStretchFactor(): void {}
  stretchFactor(): number {
    return this.idx + 1;
  }
  getHTMLElement(): HTMLElement | null {
    return null;
  }
  unwrap<T>(): T {
    return {} as unknown as T;
  }
}

class FakeEngineSeries implements SeriesHandle {
  readonly kind: EngineSeriesKind;
  private rows: EngineSeriesRow[] = [];
  private removed = false;
  private lines: FakeEnginePriceLine[] = [];
  private markers: unknown[] = [];

  constructor(
    private readonly engine: FakeEngine,
    kind: EngineSeriesKind,
    private paneIdx: number,
    private readonly appendDuplicates: boolean,
  ) {
    this.kind = kind;
  }

  moveToIndex(idx: number): void {
    this.paneIdx = idx;
  }

  private live(): void {
    if (this.removed) throw new Error("fake-engine: series removed");
    if (this.engine.inventory().alive === false) throw new Error("fake-engine: disposed");
  }

  setData(rows: EngineSeriesRow[]): void {
    if (this.engine.inventory().alive === false) return; // post-destroy: silent no-op
    this.live();
    this.rows = rows.slice();
  }

  update(row: EngineSeriesRow): void {
    if (this.engine.inventory().alive === false) return;
    this.live();
    const last = this.rows[this.rows.length - 1];
    if (!this.appendDuplicates && last && String(last.time) === String(row.time)) {
      this.rows[this.rows.length - 1] = row;
    } else {
      this.rows.push(row);
    }
  }

  data(): EngineSeriesRow[] {
    return this.rows.slice();
  }

  applyOptions(): void {}
  setMarkers(marks: unknown[]): void {
    if (this.engine.inventory().alive === false) return;
    this.live();
    this.markers = marks.slice();
  }
  createPriceLine(opts: PriceLineSpec): PriceLineHandle {
    this.live();
    const line = new FakeEnginePriceLine(this, opts);
    this.lines.push(line);
    return line;
  }
  removePriceLine(line: PriceLineHandle): void {
    line.remove();
  }
  priceLines(): PriceLineHandle[] {
    return this.lines.filter((l) => !l.isRemoved());
  }
  priceScale(): PriceScaleHandle {
    return fakePriceScale();
  }
  options(): EngineSeriesOptions {
    return {};
  }
  dataByIndex(logicalIndex: number): EngineSeriesRow | null {
    const i = Math.round(logicalIndex);
    return i >= 0 && i < this.rows.length ? this.rows[i] : null;
  }
  priceToCoordinate(): number | null {
    return null;
  }
  coordinateToPrice(): number | null {
    return null;
  }
  paneIndex(): number {
    this.live();
    return this.paneIdx;
  }
  pane(): PaneHandle {
    this.live();
    return new FakeEnginePane(this.paneIdx, this.engine);
  }
  moveToPane(paneIndex: number): void {
    this.live();
    this.engine.moveSeries(this, paneIndex);
    this.paneIdx = paneIndex;
  }
  attachPrimitive(): void {}
  detachPrimitive(): void {}
  remove(): void {
    if (this.removed) return;
    this.removed = true;
    this.engine.dropSeries(this);
  }
  unwrap<T>(): T {
    return { __fakeSeries: true } as unknown as T;
  }

  priceLineCount(): number {
    return this.lines.filter((l) => !l.isRemoved()).length;
  }

  splicePriceLine(line: FakeEnginePriceLine): void {
    const at = this.lines.indexOf(line);
    if (at !== -1) this.lines.splice(at, 1);
  }
}

class FakeEnginePriceLine implements PriceLineHandle {
  private removed = false;
  constructor(
    private readonly owner: FakeEngineSeries,
    public readonly opts: PriceLineSpec,
  ) {}
  applyOptions(): void {}
  options(): Record<string, unknown> {
    return { ...this.opts };
  }
  remove(): void {
    if (this.removed) return;
    this.removed = true;
    this.owner.splicePriceLine(this);
  }
  isRemoved(): boolean {
    return this.removed;
  }
  unwrap<T>(): T {
    return this as unknown as T;
  }
}

describe("conformance harness — falsifier (broken engine must go RED)", () => {
  const DEFECTS: [FakeDefect, string[]][] = [
    ["update-appends-duplicates", ["Q01-C03", "Q01-C15"]],
    ["destroy-not-zeroing", ["Q01-C13", "Q01-C14"]],
    ["watermark-stacks", ["Q01-C10"]],
  ];

  it("positive control: the clean fake engine has zero failures", () => {
    const results = collectEngineConformance((c) => new FakeEngine(c, []));
    const fails = results.filter((r) => r.status === "fail");
    expect(fails).toEqual([]);
  });

  it.each(DEFECTS)("defect %s fails exactly its checks", (defect, expectedIds) => {
    const results = collectEngineConformance((c) => new FakeEngine(c, [defect]));
    const failedIds = results.filter((r) => r.status === "fail").map((r) => r.id).sort();
    expect(failedIds).toEqual([...expectedIds].sort());
    // The failure is attributable to the defect: the same ids pass on the clean engine.
    const clean = collectEngineConformance((c) => new FakeEngine(c, []));
    for (const id of expectedIds) {
      expect(results.find((r) => r.id === id)?.status).toBe("fail");
      expect(clean.find((r) => r.id === id)?.status).toBe("pass");
    }
  });

  it("all three defects together fail the union of their checks", () => {
    const results = collectEngineConformance((c) =>
      new FakeEngine(c, ["update-appends-duplicates", "destroy-not-zeroing", "watermark-stacks"]),
    );
    const failedIds = results.filter((r) => r.status === "fail").map((r) => r.id).sort();
    expect(failedIds).toEqual(["Q01-C03", "Q01-C10", "Q01-C13", "Q01-C14", "Q01-C15"].sort());
  });
});
