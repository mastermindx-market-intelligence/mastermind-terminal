// Native-engine axis gestures, resize re-anchoring, and crosshair suppression.
//
// Pure and injectable: the controller never touches the DOM or "lightweight-charts".
// The parent feeds pointer records (same vocabulary as canvas/input.ts — type, pointerId,
// pointerType, x, y, timeStamp, region, paneIndex) and applies the returned `handled`
// flag so an axis drag cannot leak into the plot pan controller.
//
// Price-axis drag reuses axisZoom.ts (`axisValueAtCoordinate`, `zoomAxisRange`, log
// helpers) so wheel zoom and pressed-mouse scale share one mapping. Time-axis
// double-click calls the injected `resetView()` (viewReset.ts semantics: the recent
// 240-bar window, not fitContent).

import {
  axisLogFormulaForRange,
  axisRangeFromLog,
  axisRangeToLog,
  axisValueAtCoordinate,
  zoomAxisRange,
  type AxisLogFormula,
  type AxisRange,
} from "../axisZoom";
import { clampBarSpacingValue, maxBarSpacingPx } from "./modelTime";

// ── Documented constants ──────────────────────────────────────────────────────

/** Floor on a manual price-axis span. Prevents a drag from collapsing the domain. */
export const MIN_PRICE_SPAN = 1e-8;

/**
 * Time-axis drag gain: `barSpacing' = startBarSpacing * exp(dx / TIME_AXIS_DRAG_K)`.
 * k = 150 CSS px per e-fold (~104 px per doubling). Dragging right (dx > 0) zooms in.
 * The last visible logical (`visibleTo`) stays pinned; `rightOffset` is never written.
 */
export const TIME_AXIS_DRAG_K = 150;

/** Price-axis drag gain: `factor = exp(dy / PRICE_AXIS_DRAG_K)`. Dragging down zooms out. */
export const PRICE_AXIS_DRAG_K = 150;

/** LWC default `minBarSpacing`. */
export const MIN_BAR_SPACING = 0.5;

/**
 * LWC default max bar spacing when `maxBarSpacing` is 0: half the time-scale width,
 * so at least two bars remain visible (`MinVisibleBarsCount = 2`).
 */
export const MAX_BAR_SPACING_WIDTH_FRACTION = 0.5;

// ── Shared structural types (sibling lanes; see INTEGRATION_NOTES) ────────────

export type LogicalIndex = number;

export type TimeScaleState = {
  visibleFrom: number;
  visibleTo: number;
  barSpacing: number;
  rightOffset: number;
  widthPx: number;
};

export type PriceScaleState = {
  mode: "normal" | "log" | "percent" | "indexed100";
  inverted: boolean;
  from: number;
  to: number;
  heightPx: number;
  margins: { top: number; bottom: number };
};

export type CssRect = { x: number; y: number; width: number; height: number };

export type PaneHitLayout = {
  index: number;
  plotRect: CssRect;
  priceAxisRect: CssRect;
};

export type AxisLayout = {
  panes: PaneHitLayout[];
  timeAxisRect: CssRect;
};

export type HitRegion = "plot" | "priceAxis" | "timeAxis" | "corner" | "outside";

export type AxisPointerEventType =
  | "pointerdown"
  | "pointermove"
  | "pointerup"
  | "pointercancel"
  | "dblclick";

export type AxisPointerType = "mouse" | "touch" | "pen";

/** Event-record vocabulary shared with canvas/input.ts (I01). */
export type AxisPointerEvent = {
  type: AxisPointerEventType;
  pointerId: number;
  pointerType: AxisPointerType;
  x: number;
  y: number;
  timeStamp: number;
  region: HitRegion;
  paneIndex: number;
};

export type AxisCursor = "ns-resize" | "ew-resize" | "crosshair" | "default";

export type ChartCssSize = { widthPx: number; heightPx: number };

export type AxisHandleScaleOptions = {
  axisPressedMouseMove: { time: boolean; price: boolean };
  axisDoubleClickReset: { time: boolean; price: boolean };
};

export type AxisGestureDeps = {
  getTimeScale(): TimeScaleState;
  setTimeScale(partial: Partial<TimeScaleState>): void;
  getPriceScale(paneIndex: number): PriceScaleState | null;
  setPriceRange(paneIndex: number, from: number, to: number): void;
  setPriceScaleAuto(paneIndex: number, auto: boolean): void;
  resetView(): void;
  now(): number;
  options: { handleScale: AxisHandleScaleOptions };
};

export type AxisHandleResult = { handled: boolean };

export type AxisGestureController = {
  setLayout(layout: AxisLayout): void;
  handle(event: AxisPointerEvent): AxisHandleResult;
  onResize(next: ChartCssSize, prev: ChartCssSize): void;
  isGestureActive(): boolean;
  readonly suppressCrosshair: boolean;
  cursorFor(region: HitRegion, active?: boolean): AxisCursor;
  dispose(): void;
};

// ── Hit testing ───────────────────────────────────────────────────────────────

function contains(rect: CssRect, x: number, y: number): boolean {
  return rect.width > 0
    && rect.height > 0
    && x >= rect.x && x < rect.x + rect.width
    && y >= rect.y && y < rect.y + rect.height;
}

/**
 * Classify a CSS-pixel point against pane plot/axis rects. The price-axis side
 * (left or right) is taken from `layout`, never assumed.
 */
export function classifyRegion(x: number, y: number, layout: AxisLayout): HitRegion {
  const inTime = contains(layout.timeAxisRect, x, y);
  for (const pane of layout.panes) {
    if (inTime && contains(pane.priceAxisRect, x, y)) return "corner";
  }
  for (const pane of layout.panes) {
    if (contains(pane.priceAxisRect, x, y)) return "priceAxis";
  }
  if (inTime) return "timeAxis";
  for (const pane of layout.panes) {
    if (contains(pane.plotRect, x, y)) return "plot";
  }
  return "outside";
}

function cursorForKind(region: HitRegion, active: boolean, activeKind?: "price" | "time"): AxisCursor {
  if (active && activeKind === "price") return "ns-resize";
  if (active && activeKind === "time") return "ew-resize";
  if (region === "priceAxis") return "ns-resize";
  if (region === "timeAxis") return "ew-resize";
  if (region === "plot") return "crosshair";
  return "default";
}

export function cursorFor(region: HitRegion, active: boolean, activeKind?: "price" | "time"): AxisCursor {
  return cursorForKind(region, active, activeKind);
}

// ── Price mapping ─────────────────────────────────────────────────────────────

function workingRange(scale: PriceScaleState): { range: AxisRange; formula: AxisLogFormula | null } {
  const raw: AxisRange = { from: scale.from, to: scale.to };
  if (scale.mode !== "log") return { range: raw, formula: null };
  const formula = axisLogFormulaForRange(raw);
  return { range: axisRangeToLog(raw, formula), formula };
}

function publicRange(range: AxisRange, formula: AxisLogFormula | null): AxisRange {
  return formula ? axisRangeFromLog(range, formula) : range;
}

function clampPriceSpan(range: AxisRange, anchor: number): AxisRange {
  const span = range.to - range.from;
  if (Number.isFinite(span) && span >= MIN_PRICE_SPAN) return range;
  const startSpan = span > 0 && Number.isFinite(span) ? span : MIN_PRICE_SPAN;
  const t = startSpan > 0 ? (anchor - range.from) / startSpan : 0.5;
  const ratio = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0.5;
  return {
    from: anchor - ratio * MIN_PRICE_SPAN,
    to: anchor + (1 - ratio) * MIN_PRICE_SPAN,
  };
}

function clampBarSpacing(spacing: number, widthPx: number): number {
  // PERF-A F6: one clamp source — modelTime's LWC helpers (option 0 means
  // width * 0.5, exactly the MAX_BAR_SPACING_WIDTH_FRACTION law above).
  return clampBarSpacingValue(
    spacing,
    MIN_BAR_SPACING,
    maxBarSpacingPx(0, widthPx, MIN_BAR_SPACING),
  );
}

function paneLayout(layout: AxisLayout | null, paneIndex: number): PaneHitLayout | null {
  if (!layout) return null;
  return layout.panes.find((p) => p.index === paneIndex) ?? null;
}

type PriceDrag = {
  kind: "price";
  pointerId: number;
  paneIndex: number;
  originY: number;
  originPrice: number;
  start: AxisRange;
  formula: AxisLogFormula | null;
  autoArmed: boolean;
};

type TimeDrag = {
  kind: "time";
  pointerId: number;
  originX: number;
  startBarSpacing: number;
  startVisibleTo: number;
  widthPx: number;
};

type DragState = PriceDrag | TimeDrag;

export function createAxisGestureController(deps: AxisGestureDeps): AxisGestureController {
  let layout: AxisLayout | null = null;
  let drag: DragState | null = null;
  let disposed = false;

  const endDrag = (): void => {
    drag = null;
  };

  const applyPriceDrag = (state: PriceDrag, y: number): void => {
    if (!state.autoArmed) {
      deps.setPriceScaleAuto(state.paneIndex, false);
      state.autoArmed = true;
    }
    const dy = y - state.originY;
    const startSpan = state.start.to - state.start.from;
    if (!(startSpan > 0) || !Number.isFinite(startSpan)) return;
    const minFactor = MIN_PRICE_SPAN / startSpan;
    const factor = Math.max(minFactor, Math.exp(dy / PRICE_AXIS_DRAG_K));
    const zoomed = zoomAxisRange(state.start, state.originPrice, factor);
    const clamped = clampPriceSpan(zoomed, state.originPrice);
    const published = publicRange(clamped, state.formula);
    if (!Number.isFinite(published.from) || !Number.isFinite(published.to) || published.to <= published.from) {
      return;
    }
    deps.setPriceRange(state.paneIndex, published.from, published.to);
  };

  const applyTimeDrag = (state: TimeDrag, x: number): void => {
    const dx = x - state.originX;
    const nextSpacing = clampBarSpacing(
      state.startBarSpacing * Math.exp(dx / TIME_AXIS_DRAG_K),
      state.widthPx,
    );
    if (!(nextSpacing > 0) || !Number.isFinite(nextSpacing)) return;
    const visibleFrom = state.startVisibleTo - state.widthPx / nextSpacing;
    if (!Number.isFinite(visibleFrom)) return;
    // visibleTo stays; rightOffset is intentionally omitted.
    deps.setTimeScale({ visibleFrom, barSpacing: nextSpacing });
  };

  const startPriceDrag = (event: AxisPointerEvent): boolean => {
    if (!deps.options.handleScale.axisPressedMouseMove.price) return false;
    const scale = deps.getPriceScale(event.paneIndex);
    if (!scale) return false;
    const pane = paneLayout(layout, event.paneIndex);
    const height = scale.heightPx > 0 ? scale.heightPx : pane?.priceAxisRect.height ?? 0;
    if (!(height > 1) || !(scale.to > scale.from)) return false;
    const localY = pane ? event.y - pane.priceAxisRect.y : event.y;
    const { range, formula } = workingRange(scale);
    const originPrice = axisValueAtCoordinate(
      range,
      localY,
      height,
      scale.margins,
      scale.inverted,
    );
    if (!Number.isFinite(originPrice)) return false;
    drag = {
      kind: "price",
      pointerId: event.pointerId,
      paneIndex: event.paneIndex,
      originY: event.y,
      originPrice,
      start: range,
      formula,
      autoArmed: false,
    };
    return true;
  };

  const startTimeDrag = (event: AxisPointerEvent): boolean => {
    if (!deps.options.handleScale.axisPressedMouseMove.time) return false;
    const ts = deps.getTimeScale();
    if (!(ts.barSpacing > 0) || !(ts.widthPx > 0) || !Number.isFinite(ts.visibleTo)) return false;
    drag = {
      kind: "time",
      pointerId: event.pointerId,
      originX: event.x,
      startBarSpacing: ts.barSpacing,
      startVisibleTo: ts.visibleTo,
      widthPx: ts.widthPx,
    };
    return true;
  };

  const handleDown = (event: AxisPointerEvent): boolean => {
    if (drag) endDrag();
    deps.now();
    if (event.region === "priceAxis") {
      startPriceDrag(event);
      return true;
    }
    if (event.region === "timeAxis") {
      startTimeDrag(event);
      return true;
    }
    if (event.region === "corner") return true;
    return false;
  };

  const handleMove = (event: AxisPointerEvent): boolean => {
    if (!drag || drag.pointerId !== event.pointerId) return false;
    if (drag.kind === "price") applyPriceDrag(drag, event.y);
    else applyTimeDrag(drag, event.x);
    return true;
  };

  const handleUp = (event: AxisPointerEvent): boolean => {
    if (!drag || drag.pointerId !== event.pointerId) return false;
    endDrag();
    return true;
  };

  const handleDblClick = (event: AxisPointerEvent): boolean => {
    if (event.region === "priceAxis") {
      if (deps.options.handleScale.axisDoubleClickReset.price) {
        deps.setPriceScaleAuto(event.paneIndex, true);
      }
      return true;
    }
    if (event.region === "timeAxis") {
      if (deps.options.handleScale.axisDoubleClickReset.time) {
        deps.resetView();
      }
      return true;
    }
    if (event.region === "corner") return true;
    return false;
  };

  const controller: AxisGestureController = {
    setLayout(next: AxisLayout): void {
      if (disposed) return;
      layout = next;
    },
    handle(event: AxisPointerEvent): AxisHandleResult {
      if (disposed) return { handled: false };
      switch (event.type) {
        case "pointerdown":
          return { handled: handleDown(event) };
        case "pointermove":
          return { handled: handleMove(event) };
        case "pointerup":
        case "pointercancel":
          return { handled: handleUp(event) };
        case "dblclick":
          return { handled: handleDblClick(event) };
        default:
          return { handled: false };
      }
    },
    onResize(next: ChartCssSize, prev: ChartCssSize): void {
      if (disposed) return;
      // A live drag would interpret the layout jump as pointer motion. Drop it
      // so the last applied range stays put.
      if (drag) endDrag();
      const widthChanged = next.widthPx !== prev.widthPx && next.widthPx > 0 && Number.isFinite(next.widthPx);
      if (widthChanged) {
        const ts = deps.getTimeScale();
        const spacing = ts.barSpacing;
        if (spacing > 0 && Number.isFinite(spacing) && Number.isFinite(ts.visibleTo)) {
          const visibleFrom = ts.visibleTo - next.widthPx / spacing;
          if (Number.isFinite(visibleFrom)) {
            deps.setTimeScale({ visibleFrom, widthPx: next.widthPx });
          }
        }
      }
      // Height change remaps y; the numeric price range is left untouched.
    },
    isGestureActive(): boolean {
      return drag !== null;
    },
    get suppressCrosshair(): boolean {
      return drag !== null;
    },
    cursorFor(region: HitRegion, active = drag !== null): AxisCursor {
      return cursorForKind(region, active, drag?.kind);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      endDrag();
      layout = null;
    },
  };

  return controller;
}
