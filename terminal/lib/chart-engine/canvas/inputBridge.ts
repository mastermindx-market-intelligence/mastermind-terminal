// Mastermind Chart Engine — DOM ↔ input-controller bridge (P3 canvas).
//
// Turns pointer / wheel / dblclick events on the overlay surface into InputEvent
// records (CSS px relative to the overlay, timeStamp = event.timeStamp) and
// builds InputControllerDeps over ChartModel. Listener lifecycle and option
// pass-through live here; gesture math stays in input.ts.

import type { EngineOptions } from "../api";
import {
  createInputController,
  type InputController,
  type InputControllerOptions,
  type InputEvent,
  type InputEventType,
  type InputPointerType,
  type InputRegion,
} from "./input";
import { maxBarSpacingPx } from "./modelTime";
import { displayedPriceScaleId, type ChartModel } from "./model";

/** Matches frame.ts's minimum price-axis strip so plot pans stay off the labels. */
export const PRICE_AXIS_HIT_WIDTH_PX = 40;
/** Time-axis hit strip along the bottom of the last pane. */
export const TIME_AXIS_HIT_HEIGHT_PX = 24;

type Scheduler = {
  schedule(cb: () => void): unknown;
  cancel(handle: unknown): void;
};

export type EngineInputHost = {
  model: ChartModel;
  getTarget: () => HTMLElement | null;
  scheduler: Scheduler;
  now: () => number;
  options: EngineOptions;
  onPointerPoint?: (point: { x: number; y: number }) => void;
};

export type EngineInputBinding = {
  applyOptions(options: EngineOptions): void;
  /** Handle a wheel that landed on a surface stacked above the target (a pane separator),
   *  exactly as if it had reached the target: LWC zooms from anywhere on the chart. */
  forwardWheel(ev: Event): void;
  dispose(): void;
};

type ListenerRec = {
  type: string;
  listener: EventListener;
  options?: boolean | AddEventListenerOptions;
};

const SCROLL_DEFAULTS = {
  mouseWheel: true,
  pressedMouseMove: true,
  horzTouchDrag: true,
  vertTouchDrag: true,
} as const;

const SCALE_DEFAULTS = {
  mouseWheel: true,
  pinch: true,
  axisPressedMouseMove: true,
} as const;

/** LWC kineticScrollDefaults (dev:12417-12420): mouse inertia off, touch on. */
const KINETIC_DEFAULTS = { mouse: false, touch: true } as const;

function coerceBoolMap<T extends Record<string, boolean>>(defaults: T, raw: unknown): T {
  if (raw === true || raw === false) {
    const next = { ...defaults };
    for (const k of Object.keys(next) as Array<keyof T>) next[k] = raw as T[keyof T];
    return next;
  }
  if (raw && typeof raw === "object") return { ...defaults, ...(raw as Partial<T>) };
  return { ...defaults };
}

/** Map an EngineOptions bag onto the controller's three option groups. */
export function engineToInputOptions(engine: EngineOptions): InputControllerOptions {
  return {
    handleScroll: coerceBoolMap(SCROLL_DEFAULTS, engine.handleScroll),
    handleScale: coerceBoolMap(SCALE_DEFAULTS, engine.handleScale),
    kineticScroll: coerceBoolMap(KINETIC_DEFAULTS, engine.kineticScroll),
  };
}

export function hitTestEngineInput(
  x: number,
  y: number,
  layout: {
    widthPx: number;
    paneHeights: readonly number[];
    priceAxisWidthPx?: number | readonly number[];
  },
): { region: InputRegion; paneIndex: number } {
  const { widthPx, paneHeights: heights } = layout;
  const last = Math.max(0, heights.length - 1);
  // frame.ts measures each pane's own price labels, so the painted strip is
  // per pane and callers may publish an array. A scalar is honoured for every
  // pane; an unpublished strip falls back to the 40-px floor frame.ts paints.
  const axisPxFor = (paneIndex: number): number => {
    const raw = Array.isArray(layout.priceAxisWidthPx)
      ? layout.priceAxisWidthPx[paneIndex] ?? 0
      : layout.priceAxisWidthPx ?? 0;
    return Math.max(PRICE_AXIS_HIT_WIDTH_PX, raw);
  };
  const total = heights.reduce((a, h) => a + h, 0);
  if (y >= total - TIME_AXIS_HIT_HEIGHT_PX && x < widthPx - axisPxFor(last)) {
    return { region: "timeAxis", paneIndex: last };
  }
  let top = 0;
  let paneIndex = last;
  for (let i = 0; i < heights.length; i++) {
    const bottom = top + heights[i];
    if (y < bottom || i === last) { paneIndex = i; break; }
    top = bottom;
  }
  if (x >= widthPx - axisPxFor(paneIndex)) return { region: "priceAxis", paneIndex };
  return { region: "plot", paneIndex };
}

function cssPoint(ev: Event, target: HTMLElement): { x: number; y: number } {
  const e = ev as MouseEvent;
  const rect = target.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function pointerTypeOf(ev: Event): InputPointerType {
  const raw = (ev as { pointerType?: string }).pointerType;
  return raw === "touch" || raw === "pen" ? raw : "mouse";
}

function pointerIdOf(ev: Event): number {
  const id = (ev as { pointerId?: number }).pointerId;
  return typeof id === "number" ? id : 1;
}

export function domEventToInputEvent(
  ev: Event,
  target: HTMLElement,
  type: InputEventType,
  layout: {
    widthPx: number;
    paneHeights: readonly number[];
    priceAxisWidthPx?: number | readonly number[];
  },
): InputEvent {
  const point = cssPoint(ev, target);
  const hit = hitTestEngineInput(point.x, point.y, layout);
  const wheel = ev as WheelEvent;
  return {
    type,
    pointerId: pointerIdOf(ev),
    pointerType: pointerTypeOf(ev),
    x: point.x,
    y: point.y,
    timeStamp: ev.timeStamp,
    deltaX: typeof wheel.deltaX === "number" ? wheel.deltaX : undefined,
    deltaY: typeof wheel.deltaY === "number" ? wheel.deltaY : undefined,
    deltaMode: typeof wheel.deltaMode === "number" ? wheel.deltaMode : undefined,
    ctrlKey: Boolean((ev as MouseEvent).ctrlKey),
    region: hit.region,
    paneIndex: hit.paneIndex,
  };
}

function wheelWouldConsume(event: InputEvent, options: InputControllerOptions): boolean {
  const delta = (event.deltaY ?? 0) !== 0 ? (event.deltaY as number) : (event.deltaX ?? 0);
  if (delta === 0) return false;
  if (event.region === "priceAxis") return options.handleScale.mouseWheel;
  if (options.handleScale.mouseWheel && (event.ctrlKey || !options.handleScroll.mouseWheel)) return true;
  return options.handleScroll.mouseWheel;
}

function capturePointer(target: HTMLElement, pointerId: number): void {
  const el = target as HTMLElement & { setPointerCapture?: (id: number) => void };
  if (typeof el.setPointerCapture !== "function") return;
  try {
    el.setPointerCapture(pointerId);
  } catch {
    // jsdom / unconnected nodes throw; capture is best-effort.
  }
}

function layoutOf(model: ChartModel): {
  widthPx: number;
  paneHeights: number[];
  priceAxisWidthPx: readonly number[];
} {
  return {
    widthPx: model.time.widthPx,
    paneHeights: model.panes.map((p) => p.height),
    priceAxisWidthPx: model.priceAxisStripPx,
  };
}

/** The price scale this pane actually displays — the SAME id frame.ts paints (W4-F1). */
function displayedScaleId(model: ChartModel): string {
  return displayedPriceScaleId(model);
}

function buildDeps(
  host: EngineInputHost,
  options: InputControllerOptions,
): Parameters<typeof createInputController>[0] {
  const model = host.model;
  return {
    getTimeScale: () => model.time,
    setVisibleLogicalRange: (range) => {
      model.setVisibleLogicalRange(range);
    },
    getPriceScale: (paneIndex) => {
      if (!model.alive || paneIndex < 0 || paneIndex >= model.panes.length) return null;
      const s = model.scale(paneIndex, displayedScaleId(model));
      return {
        mode: s.mode,
        inverted: s.inverted,
        from: s.from,
        to: s.to,
        heightPx: s.heightPx,
        margins: { top: s.margins.top, bottom: s.margins.bottom },
      };
    },
    setPriceRange: (paneIndex, range) => {
      model.priceScaleHandle(displayedScaleId(model), paneIndex).setVisibleRange(range);
    },
    isPriceScaleAuto: (paneIndex) => model.scale(paneIndex, displayedScaleId(model)).autoScale ?? false,
    now: () => host.now(),
    schedule: (cb) => {
      const handle = host.scheduler.schedule(cb);
      return () => host.scheduler.cancel(handle);
    },
    options,
    zoomLimits: () => {
      const primary = model.primarySeries();
      const barCount = primary && !primary.removed ? primary.rows.length : 0;
      const minS = model.timeScaleBehaviour.minBarSpacing;
      const maxS = maxBarSpacingPx(model.timeScaleBehaviour.maxBarSpacing, model.time.widthPx, minS);
      return { minBarSpacing: minS, maxBarSpacing: maxS, barCount };
    },
  };
}

/**
 * Attach the input controller to the overlay (or whatever getTarget returns).
 * Idempotent dispose; double dispose is a no-op.
 *
 * Pointer delivery (PERF-A C3 / F3 root cause): pointerdown / wheel / dblclick
 * stay on the target surface, but pointermove / pointerup / pointercancel are
 * taken on the WINDOW for pointers that went down on this surface. Relying on
 * the target plus best-effort setPointerCapture lost the pointerup once the
 * cursor left the element, so the controller kept the pointer "down" and a
 * later stray move applied its whole opposite-sign dx — a captured drag now
 * keeps panning (and, critically, ends) with the correct sign until release
 * wherever the pointer physically travels. Window events are gated by the
 * active-pointer set so co-resident engines never react to each other's
 * pointers.
 */
export function attachEngineInput(host: EngineInputHost): EngineInputBinding {
  const options = engineToInputOptions(host.options);
  const controller: InputController = createInputController(buildDeps(host, options));
  let disposed = false;
  const listeners: ListenerRec[] = [];
  const windowListeners: ListenerRec[] = [];
  const activePointerIds = new Set<number>();
  let target: HTMLElement | null = host.getTarget();

  const toEvent = (ev: Event, type: InputEventType): InputEvent | null => {
    const surface = host.getTarget();
    if (!surface) return null;
    return domEventToInputEvent(ev, surface, type, layoutOf(host.model));
  };

  const dispatchPointer = (type: InputEventType, input: InputEvent): void => {
    if (type === "pointerdown") activePointerIds.add(input.pointerId);
    else if (type === "pointerup" || type === "pointercancel") activePointerIds.delete(input.pointerId);
    host.onPointerPoint?.({ x: input.x, y: input.y });
    controller.handleEvent(input);
  };

  const onPointer = (type: InputEventType) => (ev: Event): void => {
    if (disposed) return;
    const input = toEvent(ev, type);
    if (!input) return;
    if (type === "pointerdown") {
      const surface = host.getTarget();
      if (surface) capturePointer(surface, input.pointerId);
    }
    dispatchPointer(type, input);
  };

  // Window-level continuation of a drag that started on the target: forwards
  // only this surface's active pointers (see header).
  const onWindowPointer = (type: InputEventType) => (ev: Event): void => {
    if (disposed) return;
    if (!activePointerIds.size) return;
    const input = toEvent(ev, type);
    if (!input) return;
    if (!activePointerIds.has(input.pointerId)) return;
    dispatchPointer(type, input);
  };

  const onWheel: EventListener = (ev: Event): void => {
    if (disposed) return;
    const input = toEvent(ev, "wheel");
    if (!input) return;
    host.onPointerPoint?.({ x: input.x, y: input.y });
    controller.handleEvent(input);
    if (wheelWouldConsume(input, options) && ev.cancelable) ev.preventDefault();
  };

  const onDblClick: EventListener = (ev: Event): void => {
    if (disposed) return;
    const input = toEvent(ev, "dblclick");
    if (!input) return;
    controller.handleEvent(input);
  };

  if (target) {
    const add = (type: string, listener: EventListener, extra?: boolean | AddEventListenerOptions): void => {
      target!.addEventListener(type, listener, extra);
      listeners.push({ type, listener, options: extra });
    };
    add("pointerdown", onPointer("pointerdown"));
    add("wheel", onWheel, { passive: false });
    add("dblclick", onDblClick);
  }
  if (typeof window !== "undefined") {
    const addWindow = (type: string, listener: EventListener): void => {
      window.addEventListener(type, listener);
      windowListeners.push({ type, listener });
    };
    addWindow("pointermove", onWindowPointer("pointermove"));
    addWindow("pointerup", onWindowPointer("pointerup"));
    addWindow("pointercancel", onWindowPointer("pointercancel"));
  }

  return {
    applyOptions(next: EngineOptions): void {
      if (disposed) return;
      if (next.handleScroll !== undefined) {
        options.handleScroll = coerceBoolMap(options.handleScroll, next.handleScroll);
      }
      if (next.handleScale !== undefined) {
        options.handleScale = coerceBoolMap(options.handleScale, next.handleScale);
      }
      if (next.kineticScroll !== undefined) {
        options.kineticScroll = coerceBoolMap(options.kineticScroll, next.kineticScroll);
      }
      controller.applyOptions(options);
    },
    forwardWheel(ev: Event): void {
      onWheel(ev);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      controller.dispose();
      if (target) {
        for (const rec of listeners) {
          target.removeEventListener(rec.type, rec.listener, rec.options);
        }
      }
      for (const rec of windowListeners) {
        window.removeEventListener(rec.type, rec.listener);
      }
      listeners.length = 0;
      windowListeners.length = 0;
      activePointerIds.clear();
      target = null;
    },
  };
}
