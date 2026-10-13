// Native chart-engine pointer / wheel / pinch / inertia controller (P3 canvas).
//
// Renderer-neutral: callers feed plain event records (not DOM events) so the
// math is testable in Node. Camera writes go through injectable
// setVisibleLogicalRange / setPriceRange; the clock and frame scheduler are
// injectable so tests drive inertia without requestAnimationFrame.
//
// Coordinate law (mirrors LWC, I02 pointer-anchor / PERF-RR2 ruling 3): a bar
// at logical index i is centred at x = (i - visibleFrom + 0.5) * barSpacing,
// with barSpacing = widthPx / (visibleTo - visibleFrom). Zoom/pinch keep the
// CONTINUOUS time coordinate — the float index under the pointer (or pinch
// midpoint) — fixed across the gesture (LWC _internal_zoom dev:6277-6288;
// pointer-anchor drift <= 1 CSS px). Bar-centre anchoring breaks that law
// once barSpacing exceeds ~13 px, so this controller anchors the float index
// at every wheel and pinch-start site.
//
// Gesture classification uses the event's own timeStamp deltas, never now()
// (handler-clock delay on a busy thread is not a long-press — see
// lib/markerTooltip.ts). now() is reserved for inertia frame timing.
//
// Kinetic decay: v(t) = v0 * INERTIA_DECAY_PER_MS^dt. 0.997 / ms is the same
// order as Lightweight Charts' KineticScrollConstants.DumpingCoeff. Motion
// stops when |v| < 0.05 px/ms or after 1.5 s, whichever comes first.

import {
  axisLogFormulaForRange,
  axisLogToPrice,
  axisPriceToLog,
  axisRangeFromLog,
  axisRangeToLog,
  axisValueAtCoordinate,
  wheelDeltaToZoomFactor,
  zoomAxisRange,
  type AxisRange,
} from "../axisZoom";
import { clampBarSpacingValue } from "./modelTime";

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

export type InputControllerOptions = {
  handleScroll: { mouseWheel: boolean; pressedMouseMove: boolean; horzTouchDrag: boolean; vertTouchDrag: boolean };
  handleScale: { mouseWheel: boolean; pinch: boolean; axisPressedMouseMove: boolean };
  kineticScroll: { mouse: boolean; touch: boolean };
};

export type InputEventType = "pointerdown" | "pointermove" | "pointerup" | "pointercancel" | "wheel" | "dblclick";
export type InputPointerType = "mouse" | "touch" | "pen";
export type InputRegion = "plot" | "priceAxis" | "timeAxis";

export type InputEvent = {
  type: InputEventType;
  pointerId: number;
  pointerType: InputPointerType;
  x: number;
  y: number;
  timeStamp: number;
  deltaX?: number;
  deltaY?: number;
  deltaMode?: number;
  ctrlKey?: boolean;
  region: InputRegion;
  paneIndex: number;
};

export type InputGestureKind =
  | "tap" | "longpress" | "dragstart" | "drag" | "dragend"
  | "pinchstart" | "pinch" | "pinchend" | "inertiastart" | "inertiaend";

export type InputGesture = { kind: InputGestureKind };

export type InputControllerDeps = {
  getTimeScale(): TimeScaleState;
  setVisibleLogicalRange(range: { from: number; to: number }): void;
  getPriceScale(paneIndex: number): PriceScaleState | null;
  setPriceRange(paneIndex: number, range: { from: number; to: number }): void;
  isPriceScaleAuto(paneIndex: number): boolean;
  now(): number;
  schedule(cb: () => void): () => void;
  options: InputControllerOptions;
  onGesture?: (gesture: InputGesture) => void;
  /** Spacing bounds + data length for clamp-before-anchor zooms (C2). */
  zoomLimits?: () => ZoomLimits;
};

export type InputOptionsPatch = {
  handleScroll?: Partial<InputControllerOptions["handleScroll"]>;
  handleScale?: Partial<InputControllerOptions["handleScale"]>;
  kineticScroll?: Partial<InputControllerOptions["kineticScroll"]>;
};

export type InputController = {
  handleEvent(event: InputEvent): void;
  /** Additive: merge flags into the live controller (applyOptions pass-through). */
  applyOptions(patch: InputOptionsPatch): void;
  dispose(): void;
};

/** Tap: timeStamp delta <= 300 ms and travel < 8 CSS px. */
export const TAP_MAX_MS = 300;
export const TAP_MAX_TRAVEL_PX = 8;
/** Long-press: timeStamp delta >= 500 ms with travel still under the tap slop. */
export const LONG_PRESS_MS = 500;

/** Sample pointer velocity over this trailing window (event timeStamp). */
export const INERTIA_SAMPLE_MS = 100;
/** v(t) = v0 * 0.997^dt_ms — exponential dump per millisecond. */
export const INERTIA_DECAY_PER_MS = 0.997;
export const INERTIA_STOP_PX_PER_MS = 0.05;
export const INERTIA_MAX_MS = 1500;

const AXIS_ZOOM_EXPONENT_PER_PX = 0.0012;

const DEFAULT_OPTIONS: InputControllerOptions = {
  handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
  handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
  // LWC kineticScrollDefaults (dev:12417-12420): mouse inertia is OFF, touch
  // stays on. Callers that pass an explicit kineticScroll bag still win.
  kineticScroll: { mouse: false, touch: true },
};

export function logicalOfX(x: number, ts: TimeScaleState): LogicalIndex {
  return ts.visibleFrom + x / ts.barSpacing - 0.5;
}

export function zoomTimeAround(
  ts: TimeScaleState,
  anchorLogical: LogicalIndex,
  anchorX: number,
  factor: number,
): { from: number; to: number } {
  const span = ts.visibleTo - ts.visibleFrom;
  if (!(factor > 0) || !Number.isFinite(factor) || !(span > 0) || !(ts.barSpacing > 0)) {
    return { from: ts.visibleFrom, to: ts.visibleTo };
  }
  const nextSpan = span * factor;
  const nextSpacing = ts.barSpacing / factor;
  if (!(nextSpan > 0) || !(nextSpacing > 0) || !Number.isFinite(nextSpan) || !Number.isFinite(nextSpacing)) {
    return { from: ts.visibleFrom, to: ts.visibleTo };
  }
  const nextFrom = anchorLogical - anchorX / nextSpacing + 0.5;
  if (!Number.isFinite(nextFrom)) return { from: ts.visibleFrom, to: ts.visibleTo };
  return { from: nextFrom, to: nextFrom + nextSpan };
}

// ── PERF-A C2: pointer-anchored zoom with LWC spacing bounds ───────────────────

/** Spacing bounds + data length for clamp-before-anchor zooms. */
export type ZoomLimits = { minBarSpacing: number; maxBarSpacing: number; barCount: number };

/**
 * Zoom anchor: the logical point plus the CSS px it must stay at. The anchor
 * is the float index under the pointer (PERF-RR2 ruling 3, LWC
 * _internal_zoom dev:6277-6288): the continuous time coordinate must be
 * invariant across a zoom, not the bar under the pointer's centre. Bar-centre
 * anchoring breaks the <= 1 CSS px law once barSpacing exceeds ~13 px.
 */
export type ZoomAnchor = { anchorLogical: LogicalIndex; anchorX: number };

/**
 * zoomTimeAround with the new spacing CLAMPED BEFORE the anchor is placed
 * (PERF-A F4): the clamped spacing is the one the model will accept, so the
 * model's own clamp never re-quantises the anchored range. Without limits the
 * legacy float-anchor law (zoomTimeAround) applies unchanged.
 *
 * Pair this with the float-index anchor (anchorLogical = logicalOfX(x, ts),
 * anchorX = x): placing the anchor at the pointer x under the clamped
 * spacing keeps logicalOfX(x) exactly invariant across the gesture.
 */
export function zoomTimeAroundAt(
  ts: TimeScaleState,
  anchor: ZoomAnchor,
  factor: number,
  limits?: ZoomLimits,
): { from: number; to: number } {
  const span = ts.visibleTo - ts.visibleFrom;
  if (!(factor > 0) || !Number.isFinite(factor) || !(span > 0) || !(ts.barSpacing > 0)) {
    return { from: ts.visibleFrom, to: ts.visibleTo };
  }
  let nextSpacing = ts.barSpacing / factor;
  if (limits) {
    const min = Number.isFinite(limits.minBarSpacing) && limits.minBarSpacing > 0 ? limits.minBarSpacing : 0.5;
    const max = Math.max(min, Number.isFinite(limits.maxBarSpacing) && limits.maxBarSpacing > 0
      ? limits.maxBarSpacing
      : min);
    nextSpacing = clampBarSpacingValue(nextSpacing, min, max);
  }
  const nextSpan = ts.widthPx > 0 ? ts.widthPx / nextSpacing : span * factor;
  if (!(nextSpan > 0) || !(nextSpacing > 0) || !Number.isFinite(nextSpan) || !Number.isFinite(nextSpacing)) {
    return { from: ts.visibleFrom, to: ts.visibleTo };
  }
  const nextFrom = anchor.anchorLogical - anchor.anchorX / nextSpacing + 0.5;
  if (!Number.isFinite(nextFrom)) return { from: ts.visibleFrom, to: ts.visibleTo };
  return { from: nextFrom, to: nextFrom + nextSpan };
}

type Pointer = {
  id: number; pointerType: InputPointerType; x: number; y: number;
  downX: number; downY: number; downTs: number; region: InputRegion; paneIndex: number;
  dragging: boolean; longPress: boolean;
  originFrom: number; originTo: number; originBarSpacing: number; originWidthPx: number;
  originPriceFrom: number; originPriceTo: number; originPriceAnchor: number;
};
type Pinch = { ids: [number, number]; startDist: number; startSpan: number; startBarSpacing: number; anchorLogical: LogicalIndex };
type Sample = { t: number; x: number };
type Inertia = { v: number; startT: number; lastT: number };

function mergeOptions(raw: InputControllerOptions): InputControllerOptions {
  return {
    handleScroll: { ...DEFAULT_OPTIONS.handleScroll, ...raw.handleScroll },
    handleScale: { ...DEFAULT_OPTIONS.handleScale, ...raw.handleScale },
    kineticScroll: { ...DEFAULT_OPTIONS.kineticScroll, ...raw.kineticScroll },
  };
}

function priceDomain(ps: PriceScaleState): AxisRange {
  return { from: ps.from, to: ps.to };
}

function zoomPrice(ps: PriceScaleState, anchor: number, factor: number): AxisRange {
  if (ps.mode === "log") {
    const formula = axisLogFormulaForRange(priceDomain(ps));
    const logRange = axisRangeToLog(priceDomain(ps), formula);
    const logAnchor = axisPriceToLog(anchor, formula);
    return axisRangeFromLog(zoomAxisRange(logRange, logAnchor, factor), formula);
  }
  return zoomAxisRange(priceDomain(ps), anchor, factor);
}

function priceAtY(ps: PriceScaleState, y: number): number {
  if (ps.mode === "log") {
    const formula = axisLogFormulaForRange(priceDomain(ps));
    const logRange = axisRangeToLog(priceDomain(ps), formula);
    const logVal = axisValueAtCoordinate(logRange, y, ps.heightPx, ps.margins, ps.inverted);
    return axisLogToPrice(logVal, formula);
  }
  return axisValueAtCoordinate(priceDomain(ps), y, ps.heightPx, ps.margins, ps.inverted);
}

function shiftPriceRange(ps: PriceScaleState, y0: number, y1: number): AxisRange {
  if (ps.mode === "log") {
    const formula = axisLogFormulaForRange(priceDomain(ps));
    const logRange = axisRangeToLog(priceDomain(ps), formula);
    const p0 = axisValueAtCoordinate(logRange, y0, ps.heightPx, ps.margins, ps.inverted);
    const p1 = axisValueAtCoordinate(logRange, y1, ps.heightPx, ps.margins, ps.inverted);
    return axisRangeFromLog(
      { from: logRange.from + (p0 - p1), to: logRange.to + (p0 - p1) },
      formula,
    );
  }
  const p0 = axisValueAtCoordinate(priceDomain(ps), y0, ps.heightPx, ps.margins, ps.inverted);
  const p1 = axisValueAtCoordinate(priceDomain(ps), y1, ps.heightPx, ps.margins, ps.inverted);
  return { from: ps.from + (p0 - p1), to: ps.to + (p0 - p1) };
}

export function createInputController(deps: InputControllerDeps): InputController {
  const options = mergeOptions(deps.options);
  const pointers = new Map<number, Pointer>();
  const samples: Sample[] = [];
  let pinch: Pinch | null = null;
  let inertia: Inertia | null = null;
  let cancelFrame: (() => void) | null = null;
  let disposed = false;

  const emit = (kind: InputGestureKind): void => {
    deps.onGesture?.({ kind });
  };

  const stopInertia = (announce: boolean): void => {
    if (cancelFrame) {
      cancelFrame();
      cancelFrame = null;
    }
    if (inertia) {
      inertia = null;
      if (announce) emit("inertiaend");
    }
  };

  const shiftTime = (logicalShift: number): void => {
    const ts = deps.getTimeScale();
    if (!Number.isFinite(logicalShift) || logicalShift === 0) return;
    deps.setVisibleLogicalRange({
      from: ts.visibleFrom + logicalShift,
      to: ts.visibleTo + logicalShift,
    });
  };

  const applyPlotPan = (dxPx: number, dyPx: number, pointer: Pointer, y0: number, y1: number): void => {
    const ts = deps.getTimeScale();
    const touch = pointer.pointerType === "touch";
    const horz = touch ? options.handleScroll.horzTouchDrag : options.handleScroll.pressedMouseMove;
    const vert = touch ? options.handleScroll.vertTouchDrag : options.handleScroll.pressedMouseMove;
    if (horz && ts.barSpacing > 0 && dxPx !== 0) {
      shiftTime(-dxPx / ts.barSpacing);
    }
    if (vert && dyPx !== 0 && !deps.isPriceScaleAuto(pointer.paneIndex)) {
      const ps = deps.getPriceScale(pointer.paneIndex);
      if (ps) deps.setPriceRange(pointer.paneIndex, shiftPriceRange(ps, y0, y1));
    }
  };

  const applyTimeAxisZoom = (pointer: Pointer): void => {
    if (!options.handleScale.axisPressedMouseMove) return;
    // LWC TimeScale._internal_scaleTo (dev:6305-6317): the RIGHT edge is the
    // anchor — barSpacing scales by (width - x) / (width - startPoint), both
    // distances clamped to [0, width]; a zero start distance is a no-op. The
    // requested spacing is clamped to the LWC bounds before the window is
    // derived, and visibleTo (the right edge) stays pinned (§5.5, PERF-A C2).
    const width = pointer.originWidthPx;
    if (!(width > 0)) return;
    const startFromRight = Math.min(width, Math.max(0, width - pointer.downX));
    const currentFromRight = Math.min(width, Math.max(0, width - pointer.x));
    if (!(startFromRight > 0) || !(currentFromRight > 0)) return;
    const limits = deps.zoomLimits?.();
    const min = limits && limits.minBarSpacing > 0 ? limits.minBarSpacing : 0.5;
    const max = limits && limits.maxBarSpacing > 0
      ? limits.maxBarSpacing
      : Math.max(min, width * 0.5);
    const nextSpacing = clampBarSpacingValue(
      pointer.originBarSpacing * (currentFromRight / startFromRight),
      min,
      max,
    );
    if (!(nextSpacing > 0) || !Number.isFinite(nextSpacing)) return;
    deps.setVisibleLogicalRange({
      from: pointer.originTo - width / nextSpacing,
      to: pointer.originTo,
    });
  };

  const applyPriceAxisZoom = (pointer: Pointer): void => {
    if (!options.handleScale.axisPressedMouseMove) return;
    const ps = deps.getPriceScale(pointer.paneIndex);
    if (!ps) return;
    const factor = Math.exp((pointer.y - pointer.downY) * AXIS_ZOOM_EXPONENT_PER_PX);
    const origin: PriceScaleState = {
      ...ps,
      from: pointer.originPriceFrom,
      to: pointer.originPriceTo,
    };
    deps.setPriceRange(pointer.paneIndex, zoomPrice(origin, pointer.originPriceAnchor, factor));
  };

  const applyPinch = (): void => {
    if (!pinch) return;
    const a = pointers.get(pinch.ids[0]);
    const b = pointers.get(pinch.ids[1]);
    if (!a || !b) return;
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    if (!(dist > 0) || !(pinch.startDist > 0)) return;
    const midX = (a.x + b.x) / 2;
    const factor = pinch.startDist / dist;
    const ts: TimeScaleState = {
      ...deps.getTimeScale(),
      visibleFrom: 0,
      visibleTo: pinch.startSpan,
      barSpacing: pinch.startBarSpacing,
    };
    // Pinch move re-anchors the float index captured at pinch-start under the
    // current midpoint; spacing is clamped BEFORE the anchor is placed so the
    // model's own clamp never re-quantises the anchored range.
    deps.setVisibleLogicalRange(
      zoomTimeAroundAt(ts, { anchorLogical: pinch.anchorLogical, anchorX: midX }, factor, deps.zoomLimits?.()),
    );
  };

  const velocityPxPerMs = (): number => {
    if (samples.length < 2) return 0;
    const last = samples[samples.length - 1];
    let i = 0;
    while (i < samples.length - 1 && last.t - samples[i].t > INERTIA_SAMPLE_MS) i += 1;
    const first = samples[i];
    const dt = last.t - first.t;
    if (!(dt > 0)) return 0;
    return (last.x - first.x) / dt;
  };

  const inertiaTick = (): void => {
    cancelFrame = null;
    if (!inertia) return;
    const t = deps.now();
    const elapsed = t - inertia.startT;
    if (elapsed >= INERTIA_MAX_MS || Math.abs(inertia.v) < INERTIA_STOP_PX_PER_MS) {
      stopInertia(true);
      return;
    }
    const dt = Math.max(0, t - inertia.lastT);
    inertia.lastT = t;
    if (dt > 0) {
      const decayed = Math.pow(INERTIA_DECAY_PER_MS, dt);
      const dx = inertia.v * (decayed - 1) / Math.log(INERTIA_DECAY_PER_MS);
      inertia.v *= decayed;
      const ts = deps.getTimeScale();
      if (ts.barSpacing > 0) shiftTime(-dx / ts.barSpacing);
    }
    if (t - inertia.startT >= INERTIA_MAX_MS || Math.abs(inertia.v) < INERTIA_STOP_PX_PER_MS) {
      stopInertia(true);
      return;
    }
    cancelFrame = deps.schedule(inertiaTick);
  };

  const startInertia = (pointerType: InputPointerType): void => {
    const enabled = pointerType === "touch" ? options.kineticScroll.touch : options.kineticScroll.mouse;
    if (!enabled) return;
    const v = velocityPxPerMs();
    if (!Number.isFinite(v) || Math.abs(v) < INERTIA_STOP_PX_PER_MS) return;
    const t = deps.now();
    inertia = { v, startT: t, lastT: t };
    emit("inertiastart");
    cancelFrame = deps.schedule(inertiaTick);
  };

  const maybeBeginPinch = (): void => {
    if (!options.handleScale.pinch || pinch) return;
    const touches = [...pointers.values()].filter((p) => p.pointerType === "touch");
    if (touches.length !== 2) return;
    const a = touches[0];
    const b = touches[1];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    if (!(dist > 0)) return;
    for (const p of touches) {
      if (p.dragging) {
        p.dragging = false;
        emit("dragend");
      }
    }
    const ts = deps.getTimeScale();
    const midX = (a.x + b.x) / 2;
    // Float-index anchor (PERF-RR2 ruling 3, LWC _internal_zoom dev:6277-6288):
    // capture the continuous time coordinate under the pinch-start midpoint
    // and keep it fixed across every spread step. Bar-centre anchoring
    // re-quantises the anchor on each step and breaks the <= 1 CSS px law
    // once barSpacing grows past ~13 px.
    const anchorLogical = logicalOfX(midX, ts);
    pinch = {
      ids: [a.id, b.id],
      startDist: dist,
      startSpan: ts.visibleTo - ts.visibleFrom,
      startBarSpacing: ts.barSpacing,
      anchorLogical,
    };
    samples.length = 0;
    emit("pinchstart");
  };

  const onDown = (e: InputEvent): void => {
    stopInertia(true);
    const ts = deps.getTimeScale();
    const ps = deps.getPriceScale(e.paneIndex);
    const pointer: Pointer = {
      id: e.pointerId,
      pointerType: e.pointerType,
      x: e.x,
      y: e.y,
      downX: e.x,
      downY: e.y,
      downTs: e.timeStamp,
      region: e.region,
      paneIndex: e.paneIndex,
      dragging: false,
      longPress: false,
      originFrom: ts.visibleFrom,
      originTo: ts.visibleTo,
      originBarSpacing: ts.barSpacing,
      originWidthPx: ts.widthPx,
      originPriceFrom: ps?.from ?? 0,
      originPriceTo: ps?.to ?? 0,
      originPriceAnchor: ps ? priceAtY(ps, e.y) : 0,
    };
    pointers.set(e.pointerId, pointer);
    samples.length = 0;
    samples.push({ t: e.timeStamp, x: e.x });
    maybeBeginPinch();
  };

  const onMove = (e: InputEvent): void => {
    const pointer = pointers.get(e.pointerId);
    if (!pointer) return;
    const prevY = pointer.y;
    const dx = e.x - pointer.x;
    pointer.x = e.x;
    pointer.y = e.y;

    if (pinch && (e.pointerId === pinch.ids[0] || e.pointerId === pinch.ids[1])) {
      applyPinch();
      emit("pinch");
      return;
    }

    const travel = Math.hypot(pointer.x - pointer.downX, pointer.y - pointer.downY);
    if (
      !pointer.dragging
      && !pointer.longPress
      && e.timeStamp - pointer.downTs >= LONG_PRESS_MS
      && travel < TAP_MAX_TRAVEL_PX
    ) {
      pointer.longPress = true;
      emit("longpress");
      return;
    }
    if (!pointer.dragging && !pointer.longPress && travel >= TAP_MAX_TRAVEL_PX) {
      pointer.dragging = true;
      emit("dragstart");
    }
    if (!pointer.dragging) return;
    emit("drag");
    if (pointer.region === "timeAxis") {
      applyTimeAxisZoom(pointer);
      return;
    }
    if (pointer.region === "priceAxis") {
      applyPriceAxisZoom(pointer);
      return;
    }
    applyPlotPan(dx, e.y - prevY, pointer, prevY, e.y);
    samples.push({ t: e.timeStamp, x: e.x });
    const cutoff = e.timeStamp - INERTIA_SAMPLE_MS;
    while (samples.length > 2 && samples[0].t < cutoff) samples.shift();
  };

  const endPinchFinger = (e: InputEvent, pointer: Pointer): void => {
    if (!pinch) return;
    const remainingId = pinch.ids[0] === pointer.id ? pinch.ids[1] : pinch.ids[0];
    pinch = null;
    emit("pinchend");
    pointers.delete(pointer.id);
    const remaining = pointers.get(remainingId);
    if (!remaining) return;
    remaining.dragging = true;
    remaining.downX = remaining.x;
    remaining.downY = remaining.y;
    remaining.downTs = e.timeStamp;
    remaining.region = "plot";
    samples.length = 0;
    samples.push({ t: e.timeStamp, x: remaining.x });
  };

  const onUp = (e: InputEvent, cancelled: boolean): void => {
    const pointer = pointers.get(e.pointerId);
    if (!pointer) return;
    pointer.x = e.x;
    pointer.y = e.y;

    if (pinch && (pointer.id === pinch.ids[0] || pointer.id === pinch.ids[1])) {
      endPinchFinger(e, pointer);
      return;
    }

    const travel = Math.hypot(pointer.x - pointer.downX, pointer.y - pointer.downY);
    const dt = e.timeStamp - pointer.downTs;
    if (pointer.dragging) {
      emit("dragend");
      if (!cancelled) startInertia(pointer.pointerType);
    } else if (!cancelled && !pointer.longPress) {
      if (dt <= TAP_MAX_MS && travel < TAP_MAX_TRAVEL_PX) emit("tap");
      else if (dt >= LONG_PRESS_MS && travel < TAP_MAX_TRAVEL_PX) emit("longpress");
    }
    pointers.delete(e.pointerId);
    samples.length = 0;
  };

  const onWheel = (e: InputEvent): void => {
    const ts = deps.getTimeScale();
    const delta = e.deltaY !== 0 && e.deltaY != null
      ? e.deltaY
      : (e.deltaX ?? 0);
    if (delta === 0) return;
    const deltaMode = e.deltaMode ?? 0;

    if (e.region === "priceAxis" && options.handleScale.mouseWheel) {
      const ps = deps.getPriceScale(e.paneIndex);
      if (!ps) return;
      stopInertia(true);
      const factor = wheelDeltaToZoomFactor(delta, deltaMode, ps.heightPx);
      deps.setPriceRange(e.paneIndex, zoomPrice(ps, priceAtY(ps, e.y), factor));
      return;
    }

    const zoom = options.handleScale.mouseWheel && (Boolean(e.ctrlKey) || !options.handleScroll.mouseWheel);
    if (zoom && ts.barSpacing > 0) {
      // LWC stops a running kinetic scroll when a new scale gesture starts
      // (dev:6319-6328); a wheel notch is a scale start (PERF-A C3 / F5).
      stopInertia(true);
      const factor = wheelDeltaToZoomFactor(delta, deltaMode, ts.widthPx);
      const limits = deps.zoomLimits?.();
      // Float-index anchor (PERF-RR2 ruling 3, LWC _internal_zoom dev:6277-6288):
      // the continuous time coordinate under the pointer is the invariant,
      // not the bar under the pointer's centre. The clamped spacing is
      // applied BEFORE the anchor so the model clamp never re-quantises the
      // anchored range.
      const anchor: ZoomAnchor = { anchorLogical: logicalOfX(e.x, ts), anchorX: e.x };
      deps.setVisibleLogicalRange(zoomTimeAroundAt(ts, anchor, factor, limits));
      return;
    }
    if (options.handleScroll.mouseWheel && ts.barSpacing > 0) {
      stopInertia(true);
      const panDelta = (e.deltaX ?? 0) !== 0 ? (e.deltaX as number) : delta;
      shiftTime(panDelta / ts.barSpacing);
    }
  };

  return {
    handleEvent(event: InputEvent): void {
      if (disposed) return;
      switch (event.type) {
        case "pointerdown": onDown(event); return;
        case "pointermove": onMove(event); return;
        case "pointerup": onUp(event, false); return;
        case "pointercancel": onUp(event, true); return;
        case "wheel": onWheel(event); return;
        case "dblclick": return;
      }
    },
    applyOptions(patch: InputOptionsPatch): void {
      if (disposed) return;
      if (patch.handleScroll) Object.assign(options.handleScroll, patch.handleScroll);
      if (patch.handleScale) Object.assign(options.handleScale, patch.handleScale);
      if (patch.kineticScroll) Object.assign(options.kineticScroll, patch.kineticScroll);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      stopInertia(true);
      pointers.clear();
      samples.length = 0;
      pinch = null;
    },
  };
}
