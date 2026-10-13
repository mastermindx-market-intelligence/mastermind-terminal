// Time-scale behaviour options for the Canvas2D ChartModel (F-11).
//
// Defaults and clamp rules follow LWC 5.2 timeScaleOptionsDefaults
// (dev:12345-12370) and TimeScale._internal_applyOptions / _private__correctOffset
// (dev:5998-6028, 6574-6603). Pure functions: ChartModel owns the mutable state.

import type { TimeScaleState } from "./scales";

/** LWC timeScaleOptionsDefaults (dev:12345-12370). maxBarSpacing 0 → width * 0.5. */
export const TIME_SCALE_DEFAULTS = {
  rightOffset: 0,
  barSpacing: 6,
  minBarSpacing: 0.5,
  maxBarSpacing: 0,
  fixLeftEdge: false,
  fixRightEdge: false,
  lockVisibleTimeRangeOnResize: false,
  rightBarStaysOnScroll: false,
  shiftVisibleRangeOnNewBar: true,
} as const;

const DISPLAY_KEYS = [
  "timeVisible",
  "secondsVisible",
  "visible",
  "borderVisible",
  "borderColor",
  "tickMarkFormatter",
] as const;

export type TimeScaleBehaviour = {
  rightOffset: number;
  barSpacing: number;
  minBarSpacing: number;
  maxBarSpacing: number;
  fixLeftEdge: boolean;
  fixRightEdge: boolean;
  lockVisibleTimeRangeOnResize: boolean;
  rightBarStaysOnScroll: boolean;
  shiftVisibleRangeOnNewBar: boolean;
} & Record<string, unknown>;

export function defaultTimeScaleBehaviour(): TimeScaleBehaviour {
  return { ...TIME_SCALE_DEFAULTS };
}

export function maxBarSpacingPx(maxBarSpacing: number, widthPx: number, minBarSpacing: number): number {
  if (maxBarSpacing > 0 && Number.isFinite(maxBarSpacing)) return maxBarSpacing;
  const half = widthPx > 0 ? widthPx * 0.5 : 50;
  return Math.max(half, minBarSpacing);
}

export function clampBarSpacingValue(
  spacing: number,
  minSpacing: number,
  maxSpacing: number,
): number {
  let next = spacing;
  if (!Number.isFinite(next) || next <= 0) next = minSpacing;
  if (next < minSpacing) next = minSpacing;
  if (next > maxSpacing) next = maxSpacing;
  return next;
}

/**
 * Clamp rightOffset when fixLeftEdge / fixRightEdge are on.
 * LWC always clamps (dev:6574-6603); C02 pins an unclamped rightOffset: 4, so
 * we only apply a side when its fix* flag is true.
 */
export function correctRightOffset(
  rightOffset: number,
  rowCount: number,
  widthPx: number,
  barSpacing: number,
  fixLeftEdge: boolean,
  fixRightEdge: boolean,
): number {
  if (!Number.isFinite(rightOffset)) return 0;
  let next = rightOffset;
  const n = Math.max(0, rowCount);
  const span = barSpacing > 0 && widthPx > 0 ? widthPx / barSpacing : 0;
  if (fixLeftEdge) {
    const barsEstimation = span;
    const minRight = -n + barsEstimation;
    if (next < minRight) next = minRight;
  }
  if (fixRightEdge && next > 0) next = 0;
  return next;
}

export function mergeTimeScaleBag(current: TimeScaleBehaviour, opts: Record<string, unknown>): TimeScaleBehaviour {
  const next: TimeScaleBehaviour = { ...current };
  if (typeof opts.rightOffset === "number" && Number.isFinite(opts.rightOffset)) next.rightOffset = opts.rightOffset;
  if (typeof opts.barSpacing === "number" && Number.isFinite(opts.barSpacing)) next.barSpacing = opts.barSpacing;
  if (typeof opts.minBarSpacing === "number" && Number.isFinite(opts.minBarSpacing)) next.minBarSpacing = opts.minBarSpacing;
  if (typeof opts.maxBarSpacing === "number" && Number.isFinite(opts.maxBarSpacing)) next.maxBarSpacing = opts.maxBarSpacing;
  if (typeof opts.fixLeftEdge === "boolean") next.fixLeftEdge = opts.fixLeftEdge;
  if (typeof opts.fixRightEdge === "boolean") next.fixRightEdge = opts.fixRightEdge;
  if (typeof opts.lockVisibleTimeRangeOnResize === "boolean") {
    next.lockVisibleTimeRangeOnResize = opts.lockVisibleTimeRangeOnResize;
  }
  if (typeof opts.rightBarStaysOnScroll === "boolean") next.rightBarStaysOnScroll = opts.rightBarStaysOnScroll;
  if (typeof opts.shiftVisibleRangeOnNewBar === "boolean") {
    next.shiftVisibleRangeOnNewBar = opts.shiftVisibleRangeOnNewBar;
  }
  for (const key of DISPLAY_KEYS) {
    if (key in opts) next[key] = opts[key];
  }
  return next;
}

export function applyBarSpacingToWindow(
  time: TimeScaleState,
  spacing: number,
  rightBarStaysOnScroll: boolean,
): void {
  if (!(time.widthPx > 0) || !(spacing > 0)) {
    time.barSpacing = spacing;
    return;
  }
  const span = time.widthPx / spacing;
  if (rightBarStaysOnScroll) {
    time.visibleFrom = time.visibleTo - span;
  } else {
    time.visibleTo = time.visibleFrom + span;
  }
  time.barSpacing = spacing;
}

export function applyRightOffsetToWindow(time: TimeScaleState, rightOffset: number, rowCount: number): void {
  const span = time.visibleTo - time.visibleFrom;
  const width = span > 0 ? span : Math.max(1, rowCount);
  time.rightOffset = rightOffset;
  time.visibleTo = rowCount + rightOffset;
  time.visibleFrom = time.visibleTo - width;
  const nextSpan = time.visibleTo - time.visibleFrom;
  if (time.widthPx > 0 && nextSpan !== 0) time.barSpacing = time.widthPx / nextSpan;
}

export function resizeTimeScaleWidth(
  time: TimeScaleState,
  nextWidth: number,
  lockVisibleTimeRangeOnResize: boolean,
): void {
  const oldWidth = time.widthPx;
  const width = Math.max(0, nextWidth);
  if (lockVisibleTimeRangeOnResize && oldWidth > 0 && width > 0) {
    time.widthPx = width;
    const span = time.visibleTo - time.visibleFrom;
    time.barSpacing = span !== 0 ? width / span : time.barSpacing;
    return;
  }
  time.widthPx = width;
  if (time.barSpacing > 0 && width > 0) {
    const span = width / time.barSpacing;
    time.visibleFrom = time.visibleTo - span;
  }
}

export function lastBarIsVisible(visibleFrom: number, visibleTo: number, rowCount: number): boolean {
  if (rowCount <= 0) return false;
  const last = rowCount - 1;
  return last >= visibleFrom && last <= visibleTo;
}

/** LWC TimeScale.scrollToPosition animated duration (dev:12862-12868). */
export const SCROLL_TO_POSITION_MS = 1000;

/** LWC TimeScale.scrollToRealTime animated duration (dev:6347-6350). */
export const SCROLL_TO_REALTIME_MS = 400;

/** Injectable clock so scroll animation can be driven without real timers. */
export type ModelClock = {
  now(): number;
  schedule(cb: () => void, delayMs?: number): unknown;
  cancel(handle: unknown): void;
};

export function defaultModelClock(): ModelClock {
  return {
    now() {
      // Date.now() is faked by vi.useFakeTimers(); performance.now() is not
      // in vitest 2.1's default toFake set, so a rAF/performance clock would
      // stall the 1000 ms animation under fake timers.
      return Date.now();
    },
    schedule(cb, delayMs = 16) {
      return setTimeout(cb, delayMs);
    },
    cancel(handle) {
      clearTimeout(handle as ReturnType<typeof setTimeout>);
    },
  };
}

/** Linear interpolation of rightOffset; snaps to `to` at/after duration. */
export function linearScrollOffset(from: number, to: number, elapsedMs: number, durationMs: number): number {
  if (!(durationMs > 0) || elapsedMs >= durationMs) return to;
  if (elapsedMs <= 0) return from;
  return from + (to - from) * (elapsedMs / durationMs);
}

/** Next frame delay, or null when the animation has finished. */
export function nextScrollFrameDelayMs(elapsedMs: number, durationMs: number, frameMs = 16): number | null {
  const remaining = durationMs - elapsedMs;
  if (remaining <= 0) return null;
  return Math.min(frameMs, remaining);
}
