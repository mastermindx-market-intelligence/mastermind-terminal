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
import type { ChartModel } from "./model";

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

const KINETIC_DEFAULTS = { mouse: true, touch: true } as const;

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
  layout: { widthPx: number; paneHeights: readonly number[] },
): { region: InputRegion; paneIndex: number } {
  const { widthPx, paneHeights: heights } = layout;
  const last = Math.max(0, heights.length - 1);
  const total = heights.reduce((a, h) => a + h, 0);
  if (y >= total - TIME_AXIS_HIT_HEIGHT_PX && x < widthPx - PRICE_AXIS_HIT_WIDTH_PX) {
    return { region: "timeAxis", paneIndex: last };
  }
  let top = 0;
  let paneIndex = last;
  for (let i = 0; i < heights.length; i++) {
    const bottom = top + heights[i];
    if (y < bottom || i === last) { paneIndex = i; break; }
    top = bottom;
  }
  if (x >= widthPx - PRICE_AXIS_HIT_WIDTH_PX) return { region: "priceAxis", paneIndex };
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
  layout: { widthPx: number; paneHeights: readonly number[] },
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

function layoutOf(model: ChartModel): { widthPx: number; paneHeights: number[] } {
  return {
    widthPx: model.time.widthPx,
    paneHeights: model.panes.map((p) => p.height),
  };
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
      const s = model.scale(paneIndex, "right");
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
      model.priceScaleHandle("right", paneIndex).setVisibleRange(range);
    },
    isPriceScaleAuto: (paneIndex) => model.scale(paneIndex, "right").autoScale,
    now: () => host.now(),
    schedule: (cb) => {
      const handle = host.scheduler.schedule(cb);
      return () => host.scheduler.cancel(handle);
    },
    options,
  };
}

/**
 * Attach the input controller to the overlay (or whatever getTarget returns).
 * Idempotent dispose; double dispose is a no-op.
 */
export function attachEngineInput(host: EngineInputHost): EngineInputBinding {
  const options = engineToInputOptions(host.options);
  const controller: InputController = createInputController(buildDeps(host, options));
  let disposed = false;
  const listeners: ListenerRec[] = [];
  let target: HTMLElement | null = host.getTarget();

  const toEvent = (ev: Event, type: InputEventType): InputEvent | null => {
    const surface = host.getTarget();
    if (!surface) return null;
    return domEventToInputEvent(ev, surface, type, layoutOf(host.model));
  };

  const onPointer = (type: InputEventType) => (ev: Event): void => {
    if (disposed) return;
    const input = toEvent(ev, type);
    if (!input) return;
    if (type === "pointerdown") {
      const surface = host.getTarget();
      if (surface) capturePointer(surface, input.pointerId);
    }
    host.onPointerPoint?.({ x: input.x, y: input.y });
    controller.handleEvent(input);
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
    add("pointermove", onPointer("pointermove"));
    add("pointerup", onPointer("pointerup"));
    add("pointercancel", onPointer("pointercancel"));
    add("wheel", onWheel, { passive: false });
    add("dblclick", onDblClick);
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
    dispose(): void {
      if (disposed) return;
      disposed = true;
      controller.dispose();
      if (target) {
        for (const rec of listeners) {
          target.removeEventListener(rec.type, rec.listener, rec.options);
        }
      }
      listeners.length = 0;
      target = null;
    },
  };
}
