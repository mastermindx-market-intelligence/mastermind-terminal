// Mastermind Chart Engine — native Canvas2D renderer (P3).
//
// Implements the renderer-agnostic ChartEngine contract with an owned ChartModel
// and pane canvases. unwrap() returns that ChartModel: the native engine has no
// vendor instance. Dark-launched as impl "mm". Frame composition lives in frame.ts.

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
import { normalizeEngineOptions } from "../options";
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
  deliverPrimitiveUpdates,
  paintOverlayFrame,
  paintPaneFrame,
} from "./frame";
import {
  createInvalidator,
  dataChangeMask,
  liveTickMask,
  type FlushReport,
  type InvalidationMask,
  type Invalidator,
} from "./invalidation";
import {
  ChartModel,
  seriesClose,
  timeToMs,
  type SeriesModel,
} from "./model";
import { createPrimitiveHost, type HostPrimitive, type PrimitiveHost } from "./primitives";
import { EngineRefusalError } from "./refusal";
import { crosshairInvalidation, dataAt, resolveCrosshair, snapLogicalToBar } from "./crosshair";
import { attachEngineInput, type EngineInputBinding } from "./inputBridge";

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
export { EngineRefusalError, assertEnginePrimitive } from "./refusal";
export { CANVAS_NEUTRAL_DEFAULTS } from "./frame";

export const CANVAS_ENGINE_IMPL = "mm" as const;

export const CANVAS_CAPABILITIES = {
  seriesKinds: ["candles", "bars", "line", "area", "histogram", "baseline"] as const,
  priceScaleModes: ["normal", "log", "percent", "indexed100"] as const,
  watermark: true,
  markers: true,
  primitives: true,
  screenshot: true,
  kineticScroll: true,
};

export type PaintScheduler = {
  schedule(cb: () => void): unknown;
  cancel(handle: unknown): void;
};

export function createManualScheduler(): PaintScheduler & { flush(): void } {
  const pending = new Map<unknown, () => void>();
  let seq = 0;
  return {
    schedule(cb) {
      const handle = ++seq;
      pending.set(handle, cb);
      return handle;
    },
    cancel(handle) {
      pending.delete(handle);
    },
    flush() {
      const batch = [...pending.values()];
      pending.clear();
      for (const p of batch) p();
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
  now?: () => number;
};

const LOCAL_KEYS = ["scheduler", "resizeObserverCtor", "devicePixelRatio", "now"] as const;

function stripLocalKeys(options: CanvasEngineOptions | undefined): {
  engine: EngineOptions;
  scheduler?: PaintScheduler;
  resizeObserverCtor?: ResizeObserverCtor | null;
  devicePixelRatio?: number;
  now?: () => number;
} {
  if (!options) return { engine: {} };
  const bag = { ...options } as Record<string, unknown>;
  const scheduler = bag.scheduler as PaintScheduler | undefined;
  const resizeObserverCtor = bag.resizeObserverCtor as ResizeObserverCtor | null | undefined;
  const devicePixelRatio = bag.devicePixelRatio as number | undefined;
  const now = bag.now as (() => number) | undefined;
  for (const k of LOCAL_KEYS) delete bag[k];
  return { engine: bag, scheduler, resizeObserverCtor, devicePixelRatio, now };
}

function gateEngineOptions(options: EngineOptions): EngineOptions {
  const result = normalizeEngineOptions(options, CANVAS_CAPABILITIES);
  if (!result.ok) {
    throw new EngineRefusalError(result.reason, result.unsupported);
  }
  return result.options;
}

type SeriesSnap = {
  paneIndex: number;
  priceScaleId: string;
  rowCount: number;
  lastTime: number | null;
  lastClose: number | null;
  removed: boolean;
};

function snapOf(s: SeriesModel): SeriesSnap {
  const last = s.rows[s.rows.length - 1];
  return {
    paneIndex: s.paneIndex,
    priceScaleId: s.priceScaleId,
    rowCount: s.rows.length,
    lastTime: last ? timeToMs(last.time) : null,
    lastClose: last ? seriesClose(last) : null,
    removed: s.removed,
  };
}

export type CanvasChartEngine = ChartEngine & {
  readonly impl: typeof CANVAS_ENGINE_IMPL;
};

class CanvasEngine implements CanvasChartEngine {
  readonly impl = CANVAS_ENGINE_IMPL;
  private readonly model: ChartModel;
  private readonly container: HTMLElement;
  private dom: ChartDom | null;
  private lastRoot: HTMLElement | null = null;
  private readonly scheduler: PaintScheduler;
  private paintHandle: unknown = null;
  private readonly overlayListeners: Array<[string, EventListener]> = [];
  private lastPoint: { x: number; y: number } | null = null;
  private readonly primHost: PrimitiveHost;
  private readonly invalidator: Invalidator;
  private snaps = new Map<number, SeriesSnap>();
  private lastPrimGen = -1;
  private input: EngineInputBinding | null = null;
  private readonly nowFn: () => number;

  constructor(container: HTMLElement, options: CanvasEngineOptions | undefined, dpr: number) {
    const width = typeof options?.width === "number" ? options.width : container.clientWidth || 0;
    const height = typeof options?.height === "number" ? options.height : container.clientHeight || 0;
    this.scheduler = options?.scheduler ?? rafScheduler();
    this.nowFn = options?.now
      ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));

    this.primHost = createPrimitiveHost({
      onRequestUpdate: () => this.requestPaint({ level: "light", panes: "all" }),
    });

    this.invalidator = createInvalidator((flush) => {
      const handle = this.scheduler.schedule(() => {
        this.paintHandle = null;
        const report = (flush as unknown as () => FlushReport | null)();
        if (report) this.paintFrame(report.mask, report.generation);
      });
      this.paintHandle = handle;
      return () => {
        this.scheduler.cancel(handle);
        this.paintHandle = null;
      };
    });

    this.model = new ChartModel({
      onInvalidate: () => this.onModelInvalidate(),
      onStructure: () => this.syncStructure(),
    });
    this.model.dpr = dpr;
    const stored = { ...(options ?? {}) } as Record<string, unknown>;
    for (const k of LOCAL_KEYS) delete stored[k];
    this.model.options = stored;
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
    this.input = attachEngineInput({
      model: this.model,
      getTarget: () => this.dom?.overlay ?? null,
      scheduler: this.scheduler,
      now: () => this.nowFn(),
      options: this.model.options,
      onPointerPoint: (point) => {
        this.lastPoint = point;
        this.requestPaint({ level: "cursor", panes: "all" });
      },
    });
    this.syncStructure();
    this.requestPaint({ level: "full", panes: "all" });
    // Identity marker: written LAST so a thrown ctor/refusal path leaves the host clean.
    container.dataset.chartEngine = CANVAS_ENGINE_IMPL;
  }

  private requestPaint(partial: Partial<InvalidationMask> & { level: InvalidationMask["level"] }): void {
    if (!this.dom) return;
    this.invalidator.invalidate(partial);
  }

  private onModelInvalidate(): void {
    this.reconcilePrimitives();
    this.requestPaint(this.classifyModelChange());
    this.captureSnaps();
  }

  private captureSnaps(): void {
    this.snaps = new Map();
    for (const s of this.model.series.values()) this.snaps.set(s.id, snapOf(s));
  }

  private classifyModelChange(): Partial<InvalidationMask> & { level: InvalidationMask["level"] } {
    const livePanes = new Set<number>();
    let onlyLive = this.snaps.size > 0;
    let tickScale = false;
    let priceScaleId = "right";
    for (const s of this.model.series.values()) {
      const prev = this.snaps.get(s.id);
      if (!prev) {
        if (s.removed) continue;
        onlyLive = false;
        continue;
      }
      if (s.removed && !prev.removed) {
        return dataChangeMask({
          kind: "remove", paneIndex: s.paneIndex, priceScaleId: s.priceScaleId, visibleAffected: true,
        });
      }
      const next = snapOf(s);
      const inPlace = next.rowCount === prev.rowCount && next.lastTime === prev.lastTime
        && next.lastClose !== prev.lastClose;
      const appended = next.rowCount === prev.rowCount + 1 && prev.lastTime != null
        && next.lastTime != null && next.lastTime > prev.lastTime;
      if (inPlace || appended) {
        livePanes.add(s.paneIndex);
        priceScaleId = s.priceScaleId;
        const tick = liveTickMask(
          prev.lastTime != null ? { time: prev.lastTime } : null,
          { time: next.lastTime ?? prev.lastTime ?? 0 },
          this.model.time.visibleTo,
          prev.rowCount,
        );
        tickScale = tickScale || tick.timeScale;
      } else if (next.rowCount !== prev.rowCount || next.lastClose !== prev.lastClose) {
        onlyLive = false;
      }
    }
    if (onlyLive && livePanes.size > 0) {
      const paneIndex = [...livePanes][0];
      const data = dataChangeMask({
        kind: "update", paneIndex, priceScaleId, visibleAffected: true,
      });
      return { ...data, panes: livePanes, timeScale: tickScale, autoscale: livePanes };
    }
    return { level: "full", panes: "all" };
  }

  private reconcilePrimitives(): void {
    const wanted = new Map<HostPrimitive, { paneIndex: number; seriesId: string }>();
    for (const s of this.model.series.values()) {
      if (s.removed) continue;
      for (const raw of s.primitives) {
        if (!raw || typeof raw !== "object") continue;
        const p = raw as HostPrimitive;
        if (typeof p.id !== "string") continue;
        wanted.set(p, { paneIndex: s.paneIndex, seriesId: String(s.id) });
      }
    }
    for (let i = 0; i < this.model.panes.length; i++) {
      for (const p of this.primHost.forPane(i)) {
        if (!wanted.has(p)) this.primHost.detach(p);
      }
    }
    for (const [p, loc] of wanted) {
      const already = this.primHost.forPane(loc.paneIndex).includes(p)
        || this.model.panes.some((_, i) => this.primHost.forPane(i).includes(p));
      if (!already) this.primHost.attach(loc.paneIndex, loc.seriesId, p);
      else this.primHost.moveSeries(loc.seriesId, loc.paneIndex);
    }
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

  private paintFrame(mask: InvalidationMask, generation: number): void {
    const dom = this.dom;
    if (!dom) return;
    if (generation !== this.lastPrimGen && this.primHost.inventory().primitives > 0) {
      deliverPrimitiveUpdates(this.model, this.primHost, generation);
      this.lastPrimGen = generation;
    }
    const dirtyAll = mask.panes === "all";
    const skipPanes = mask.level === "cursor";
    if (!skipPanes) {
      for (let i = 0; i < this.model.panes.length; i++) {
        if (!dirtyAll && mask.panes instanceof Set && !mask.panes.has(i)) continue;
        const surface = dom.panes[i];
        if (!surface) continue;
        const ctx = surface.canvas.getContext("2d");
        if (!ctx) continue;
        paintPaneFrame({ ctx, model: this.model, paneIndex: i, primHost: this.primHost });
      }
    }
    const octx = dom.overlay.getContext("2d");
    if (octx) {
      paintOverlayFrame({
        ctx: octx,
        model: this.model,
        point: this.lastPoint ?? this.externalCrosshairPoint(),
      });
    }
  }

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
      const logical = this.model.logicalOfX(p.x);
      const snapped = snapLogicalToBar(logical);
      const primary = this.model.primarySeries();
      const series = [...this.model.series.values()]
        .filter((s) => !s.removed)
        .map((s) => ({ id: String(s.id), paneIndex: s.paneIndex, kind: s.kind, rows: s.rows }));
      const resolved = resolveCrosshair({
        x: p.x,
        y: p.y,
        paneIndex: 0,
        mode: "normal",
        proj: {
          logicalOfX: (x) => this.model.logicalOfX(x),
          xOfLogical: (i) => this.model.xOfLogical(i),
          priceOfY: (_pane, y) => y,
          yOfPrice: (_pane, price) => price,
        },
        series,
        primaryId: primary ? String(primary.id) : null,
      });
      void crosshairInvalidation(null, resolved);
      let time: EngineTime | undefined;
      if (primary) {
        const row = dataAt(
          { id: String(primary.id), paneIndex: primary.paneIndex, kind: primary.kind, rows: primary.rows },
          snapped,
          "none",
        );
        if (row) time = row.time;
      }
      return { point: p, logical, time };
    };
    const move: EventListener = (ev) => {
      this.model.emitMouse("crosshair", param(ev));
      this.requestPaint({ level: "cursor", panes: "all" });
    };
    const click: EventListener = (ev) => this.model.emitMouse("click", param(ev));
    const dbl: EventListener = (ev) => this.model.emitMouse("dblclick", param(ev));
    overlay.addEventListener("mousemove", move);
    overlay.addEventListener("click", click);
    overlay.addEventListener("dblclick", dbl);
    this.overlayListeners.push(["mousemove", move], ["click", click], ["dblclick", dbl]);
  }

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
    this.requestPaint({ level: "cursor", panes: "all" });
  }
  clearCrosshairPosition(): void {
    if (!this.dom) return;
    if (this.model.externalCrosshair == null) return;
    this.model.externalCrosshair = null;
    this.requestPaint({ level: "cursor", panes: "all" });
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
    const overlayOn = !!(this.lastPoint ?? this.externalCrosshairPoint());
    return takeDomScreenshot(this.dom, overlayOn);
  }
  applyOptions(options: EngineOptions): void {
    const gated = gateEngineOptions(options);
    this.model.applyOptions(gated);
    this.input?.applyOptions(gated);
    if (typeof gated.width === "number" || typeof gated.height === "number") {
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
      this.requestPaint({ level: "full", panes: "all" });
      const report = this.invalidator.flush();
      if (report) this.paintFrame(report.mask, report.generation);
    } else {
      this.requestPaint({ level: "full", panes: "all" });
    }
  }
  unwrap<T>(): T {
    return this.model as unknown as T;
  }
  inventory(): EngineInventory {
    return this.model.inventory();
  }
  destroy(): void {
    if (!this.dom) return;
    this.input?.dispose();
    this.input = null;
    this.invalidator.dispose();
    this.primHost.dispose();
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
    // Identity marker: only clear if it still reads THIS impl — never wipe a
    // newer engine's marker that took over the same host.
    if (this.container.dataset.chartEngine === CANVAS_ENGINE_IMPL) {
      delete this.container.dataset.chartEngine;
    }
    this.dom = null;
    this.model.externalCrosshair = null;
    this.model.destroy();
  }
}

export function createCanvasEngine(
  container: HTMLElement,
  options?: CanvasEngineOptions,
): CanvasChartEngine {
  const local = stripLocalKeys(options);
  const gated = gateEngineOptions(local.engine);
  const dpr = local.devicePixelRatio
    ?? (typeof window !== "undefined" && window.devicePixelRatio ? window.devicePixelRatio : 1);
  return new CanvasEngine(container, {
    ...gated,
    scheduler: local.scheduler,
    resizeObserverCtor: local.resizeObserverCtor,
    devicePixelRatio: local.devicePixelRatio,
    now: local.now,
  }, dpr);
}

