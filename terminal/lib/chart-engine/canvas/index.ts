// Mastermind Chart Engine — native Canvas2D renderer (P3 / R01).
//
// Implements the renderer-agnostic ChartEngine contract with an owned ChartModel
// and pane canvases. unwrap() returns that ChartModel: the native engine has no
// vendor instance. Dark-launched as impl "mm".
//
// R01 is a skeleton: placeholder series paint (close-price polyline / 1px candle
// stems), linear/normal price math, lifecycle, inventory, and a synchronous
// screenshot. Pretty geometry lands in R02 (canvas/series.ts).

import type {
  ChartEngine,
  EngineInventory,
  EngineOptions,
  EngineSeriesKind,
  EngineTime,
  EngineSeriesOptions,
  EngineMouseHandler,
  PaneHandle,
  PriceScaleHandle,
  SeriesHandle,
  TimeScaleHandle,
  WatermarkLine,
  WatermarkSpec,
} from "../api";
import {
  createChartDom,
  destroyChartDom,
  layoutChartDom,
  paneElement,
  syncPaneCount,
  takeDomScreenshot,
  type ChartDom,
  type ResizeObserverCtor,
} from "./dom";
import {
  ChartModel,
  seriesClose,
  type Projection,
  type SeriesModel,
} from "./model";

export { ChartModel, priceScaleMath, futureSlotResolver, xOfLogical, logicalOfX } from "./model";
export type {
  LogicalIndex,
  TimeScaleState,
  PriceScaleState,
  Projection,
  SeriesModel,
  PaneModel,
  PriceLineModel,
} from "./model";

export const CANVAS_ENGINE_IMPL = "mm" as const;

export const CANVAS_CAPABILITIES = {
  seriesKinds: ["candles", "bars", "line", "area", "histogram", "baseline"] as const,
  priceScaleModes: ["normal"] as const,
  watermark: true,
  markers: true,
  primitives: true,
  screenshot: true,
  kineticScroll: false,
};

export class EngineRefusalError extends Error {
  readonly reason: string;
  readonly unsupported: string[];
  constructor(reason: string, unsupported: string[]) {
    super(reason);
    this.name = "EngineRefusalError";
    this.reason = reason;
    this.unsupported = unsupported;
  }
}

export type PaintScheduler = {
  schedule(cb: () => void): unknown;
  cancel(handle: unknown): void;
};

export function createManualScheduler(): PaintScheduler & { flush(): void } {
  let pending: (() => void) | null = null;
  return {
    schedule(cb) {
      pending = cb;
      return cb;
    },
    cancel() {
      pending = null;
    },
    flush() {
      const p = pending;
      pending = null;
      if (p) p();
    },
  };
}

function rafScheduler(): PaintScheduler {
  return {
    schedule: (cb) => requestAnimationFrame(cb),
    cancel: (h) => cancelAnimationFrame(h as number),
  };
}

export type CanvasEngineOptions = EngineOptions & {
  scheduler?: PaintScheduler;
  resizeObserverCtor?: ResizeObserverCtor | null;
  devicePixelRatio?: number;
};

function isNormalMode(mode: unknown): boolean {
  return mode === "normal" || mode === 0 || mode === "Normal";
}

function kineticRequested(k: unknown): boolean {
  if (k == null || k === false) return false;
  if (k === true) return true;
  if (typeof k !== "object") return false;
  return Object.values(k as Record<string, unknown>).some((v) => v === true);
}

function collectUnsupported(options: EngineOptions | undefined): string[] {
  if (!options) return [];
  const bad: string[] = [];
  for (const key of ["rightPriceScale", "leftPriceScale"] as const) {
    const scale = options[key];
    if (!scale || typeof scale !== "object") continue;
    const mode = (scale as { mode?: unknown }).mode;
    if (mode != null && !isNormalMode(mode)) bad.push(`priceScaleMode:${String(mode)}`);
  }
  if (!CANVAS_CAPABILITIES.kineticScroll && kineticRequested(options.kineticScroll)) {
    bad.push("kineticScroll");
  }
  return bad;
}

function seriesStroke(options: EngineSeriesOptions): string {
  if (typeof options.lineColor === "string") return options.lineColor;
  if (typeof options.color === "string") return options.color;
  if (typeof options.topColor === "string") return options.topColor;
  if (typeof options.upColor === "string") return options.upColor;
  if (typeof options.borderColor === "string") return options.borderColor;
  return "#848484";
}

function optionColor(bag: unknown, fallback: string): string {
  if (bag && typeof bag === "object" && typeof (bag as { color?: unknown }).color === "string") {
    return (bag as { color: string }).color;
  }
  return fallback;
}

function optionVisible(bag: unknown): boolean {
  if (bag && typeof bag === "object" && (bag as { visible?: unknown }).visible === false) return false;
  return true;
}

// R02 replaces with canvas/series.ts geometry
function paintSeries(ctx: CanvasRenderingContext2D, series: SeriesModel, projection: Projection): void {
  const color = seriesStroke(series.options);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  if (series.kind === "candles" || series.kind === "bars") {
    for (let i = 0; i < series.rows.length; i++) {
      const row = series.rows[i] as { high?: number; low?: number; close?: number };
      if (typeof row.high !== "number" || typeof row.low !== "number") continue;
      const x = projection.xOfLogical(i);
      ctx.beginPath();
      ctx.moveTo(x, projection.yOfPrice(row.high));
      ctx.lineTo(x, projection.yOfPrice(row.low));
      ctx.stroke();
    }
    return;
  }
  ctx.beginPath();
  let started = false;
  for (let i = 0; i < series.rows.length; i++) {
    const v = seriesClose(series.rows[i]);
    if (v == null) {
      started = false;
      continue;
    }
    const x = projection.xOfLogical(i);
    const y = projection.yOfPrice(v);
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else {
      ctx.lineTo(x, y);
    }
  }
  if (started) ctx.stroke();
}

function paintGrid(
  ctx: CanvasRenderingContext2D,
  model: ChartModel,
  width: number,
  height: number,
): void {
  const grid = model.options.grid;
  if (!grid || typeof grid !== "object") return;
  const g = grid as { vertLines?: unknown; horzLines?: unknown };
  if (optionVisible(g.vertLines)) {
    ctx.strokeStyle = optionColor(g.vertLines, "rgba(128,128,128,0.2)");
    ctx.lineWidth = 1;
    const from = Math.floor(model.time.visibleFrom);
    const to = Math.ceil(model.time.visibleTo);
    for (let i = from; i <= to; i++) {
      const x = model.xOfLogical(i);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
  }
  if (optionVisible(g.horzLines)) {
    ctx.strokeStyle = optionColor(g.horzLines, "rgba(128,128,128,0.2)");
    ctx.lineWidth = 1;
    const steps = 4;
    for (let s = 1; s < steps; s++) {
      const y = (height * s) / steps;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
  }
}

function backgroundColor(options: EngineOptions): string | null {
  const layout = options.layout;
  if (!layout || typeof layout !== "object") return null;
  const bag = layout as Record<string, unknown>;
  if (typeof bag.backgroundColor === "string") return bag.backgroundColor;
  const bg = bag.background;
  if (bg && typeof bg === "object") {
    const c = (bg as { color?: unknown }).color;
    if (typeof c === "string") return c;
  }
  return null;
}

export type CanvasChartEngine = ChartEngine & {
  readonly impl: typeof CANVAS_ENGINE_IMPL;
};

class CanvasEngine implements CanvasChartEngine {
  readonly impl = CANVAS_ENGINE_IMPL;
  private readonly model: ChartModel;
  private readonly container: HTMLElement;
  private dom: ChartDom | null;
  // Kept after destroy so chartElement() stays a (detached) HTMLElement, as the contract requires.
  private lastRoot: HTMLElement | null = null;
  private readonly scheduler: PaintScheduler;
  private paintHandle: unknown = null;
  private readonly overlayListeners: Array<[string, EventListener]> = [];
  private lastPoint: { x: number; y: number } | null = null;

  constructor(container: HTMLElement, options: CanvasEngineOptions | undefined, dpr: number) {
    const width = typeof options?.width === "number" ? options.width : container.clientWidth || 0;
    const height = typeof options?.height === "number" ? options.height : container.clientHeight || 0;
    this.scheduler = options?.scheduler ?? rafScheduler();

    this.model = new ChartModel({
      onInvalidate: () => this.invalidate(),
      onStructure: () => this.syncStructure(),
    });
    this.model.dpr = dpr;
    this.model.options = { ...(options ?? {}) };
    this.model.setWidth(width);
    this.model.layoutHeights(height);

    this.dom = createChartDom(container, {
      dpr,
      width,
      height,
      paneCount: 1,
      autoSize: options?.autoSize === true,
      resizeObserverCtor: options?.resizeObserverCtor,
      onAutoSize: (w, h) => {
        if (!this.dom) return;
        this.resize(w, h);
      },
    });
    this.container = container;
    this.lastRoot = this.dom.root;
    this.model.paneElementLookup = (i) => (this.dom ? paneElement(this.dom, i) : null);
    this.bindOverlay();
    this.syncStructure();
    this.invalidate();
  }

  private syncStructure(): void {
    if (!this.dom) return;
    syncPaneCount(this.dom, this.model.panes.length);
    layoutChartDom(
      this.dom,
      this.model.time.widthPx,
      this.model.totalHeight,
      this.model.panes.map((p) => p.height),
    );
  }

  private invalidate(): void {
    if (!this.dom) return;
    if (this.paintHandle != null) return;
    this.paintHandle = this.scheduler.schedule(() => {
      this.paintHandle = null;
      this.paint();
    });
  }

  private paint(): void {
    const dom = this.dom;
    if (!dom) return;
    const bg = backgroundColor(this.model.options);
    for (let i = 0; i < this.model.panes.length; i++) {
      const pane = this.model.panes[i];
      const surface = dom.panes[i];
      if (!pane || !surface) continue;
      const ctx = surface.canvas.getContext("2d");
      if (!ctx) continue;
      const w = this.model.time.widthPx;
      const h = pane.height;
      if (bg) {
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, w, h);
      } else {
        ctx.clearRect(0, 0, w, h);
      }
      paintGrid(ctx, this.model, w, h);
      for (const sid of pane.seriesIds) {
        const s = this.model.getSeries(sid);
        if (!s || s.removed) continue;
        paintSeries(ctx, s, this.model.projectionFor(s));
      }
    }
    const octx = dom.overlay.getContext("2d");
    if (octx) {
      octx.clearRect(0, 0, this.model.time.widthPx, this.model.totalHeight);
      const point = this.lastPoint ?? this.externalCrosshairPoint();
      if (point) {
        const ch = this.model.options.crosshair;
        const vert = ch && typeof ch === "object" ? (ch as { vertLine?: unknown }).vertLine : undefined;
        octx.strokeStyle = optionColor(vert, "rgba(180,180,180,0.6)");
        octx.beginPath();
        octx.moveTo(point.x, 0);
        octx.lineTo(point.x, this.model.totalHeight);
        octx.stroke();
        octx.beginPath();
        octx.moveTo(0, point.y);
        octx.lineTo(this.model.time.widthPx, point.y);
        octx.stroke();
      }
    }
  }

  /** Pixel position of the programmatic crosshair (setCrosshairPosition), or null. */
  private externalCrosshairPoint(): { x: number; y: number } | null {
    const xc = this.model.externalCrosshair;
    if (!xc) return null;
    const s = this.model.getSeries(xc.seriesId);
    if (!s || s.removed) return null;
    const x = this.model.timeToCoordinate(xc.time);
    if (x == null) return null;
    let y = this.model.projectionFor(s).yOfPrice(xc.price);
    for (let i = 0; i < s.paneIndex; i++) y += this.model.panes[i]?.height ?? 0;
    return { x, y };
  }

  private bindOverlay(): void {
    const overlay = this.dom?.overlay;
    if (!overlay) return;
    const point = (ev: Event): { x: number; y: number } => {
      const e = ev as MouseEvent;
      const rect = overlay.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const param = (ev: Event) => {
      const p = point(ev);
      this.lastPoint = p;
      return {
        point: p,
        logical: this.model.logicalOfX(p.x),
        time: this.model.coordinateToTime(p.x) ?? undefined,
      };
    };
    const move: EventListener = (ev) => {
      this.model.emitMouse("crosshair", param(ev));
      this.invalidate();
    };
    const click: EventListener = (ev) => this.model.emitMouse("click", param(ev));
    const dbl: EventListener = (ev) => this.model.emitMouse("dblclick", param(ev));
    overlay.addEventListener("mousemove", move);
    overlay.addEventListener("click", click);
    overlay.addEventListener("dblclick", dbl);
    this.overlayListeners.push(["mousemove", move], ["click", click], ["dblclick", dbl]);
  }

  /** The owned chart root; after destroy() the detached root (never null — contract). */
  chartElement(): HTMLElement {
    return this.dom?.root ?? this.lastRoot ?? this.container;
  }
  options(): EngineOptions {
    return { ...this.model.options };
  }

  addSeries(kind: EngineSeriesKind, options?: EngineSeriesOptions, paneIndex?: number): SeriesHandle {
    return this.model.addSeries(kind, options, paneIndex);
  }
  removeSeries(series: SeriesHandle): void {
    series.remove();
  }
  setCrosshairPosition(price: number, time: EngineTime, series: SeriesHandle): void {
    if (!this.dom) return;
    const s = series.unwrap<{ id?: number; removed?: boolean }>();
    if (!s || typeof s.id !== "number" || s.removed) return;
    this.model.externalCrosshair = { price, time, seriesId: s.id };
    this.invalidate();
  }
  clearCrosshairPosition(): void {
    if (!this.dom) return;
    if (this.model.externalCrosshair == null) return;
    this.model.externalCrosshair = null;
    this.invalidate();
  }
  panes(): PaneHandle[] {
    return this.model.paneHandles();
  }
  timeScale(): TimeScaleHandle {
    return this.model.timeScaleHandleFor();
  }
  priceScale(priceScaleId: string, paneIndex?: number): PriceScaleHandle {
    return this.model.priceScaleHandle(priceScaleId, paneIndex);
  }
  paneSize(paneIndex?: number): { width: number; height: number } {
    return this.model.paneSize(paneIndex);
  }
  swapPanes(first: number, second: number): void {
    this.model.swapPanes(first, second);
  }
  takeScreenshot(): HTMLCanvasElement {
    if (!this.dom) {
      const empty = document.createElement("canvas");
      empty.width = 1;
      empty.height = 1;
      return empty;
    }
    return takeDomScreenshot(this.dom);
  }
  applyOptions(options: EngineOptions): void {
    this.model.applyOptions(options);
    if (typeof options.width === "number" || typeof options.height === "number") {
      this.syncStructure();
    }
  }
  subscribeCrosshairMove(handler: EngineMouseHandler): void {
    this.model.subscribe("crosshair", handler);
  }
  unsubscribeCrosshairMove(handler: EngineMouseHandler): void {
    this.model.unsubscribe("crosshair", handler);
  }
  subscribeClick(handler: EngineMouseHandler): void {
    this.model.subscribe("click", handler);
  }
  unsubscribeClick(handler: EngineMouseHandler): void {
    this.model.unsubscribe("click", handler);
  }
  subscribeDblClick(handler: EngineMouseHandler): void {
    this.model.subscribe("dblclick", handler);
  }
  unsubscribeDblClick(handler: EngineMouseHandler): void {
    this.model.unsubscribe("dblclick", handler);
  }
  setWatermark(paneIndex: number, spec: WatermarkSpec | WatermarkLine[]): void {
    this.model.setWatermark(paneIndex, spec);
  }
  resize(width: number, height: number, forceRepaint?: boolean): void {
    if (!this.dom) return;
    this.model.setWidth(width);
    this.model.layoutHeights(height);
    this.syncStructure();
    if (forceRepaint) {
      if (this.paintHandle != null) {
        this.scheduler.cancel(this.paintHandle);
        this.paintHandle = null;
      }
      this.paint();
    } else {
      this.invalidate();
    }
  }
  /** Returns this engine's owned ChartModel (the native renderer has no vendor instance). */
  unwrap<T>(): T {
    return this.model as unknown as T;
  }
  inventory(): EngineInventory {
    return this.model.inventory();
  }
  destroy(): void {
    if (!this.dom) return;
    if (this.paintHandle != null) {
      this.scheduler.cancel(this.paintHandle);
      this.paintHandle = null;
    }
    const overlay = this.dom.overlay;
    for (const [type, listener] of this.overlayListeners) {
      overlay.removeEventListener(type, listener);
    }
    this.overlayListeners.length = 0;
    destroyChartDom(this.dom);
    this.dom = null;
    this.model.externalCrosshair = null;
    this.model.destroy();
  }
}

export function createCanvasEngine(
  container: HTMLElement,
  options?: CanvasEngineOptions,
): CanvasChartEngine {
  const unsupported = collectUnsupported(options);
  if (unsupported.length > 0) {
    throw new EngineRefusalError(
      `canvas engine refused: ${unsupported.join(", ")}`,
      unsupported,
    );
  }
  const dpr = options?.devicePixelRatio
    ?? (typeof window !== "undefined" && window.devicePixelRatio ? window.devicePixelRatio : 1);
  return new CanvasEngine(container, options, dpr);
}


