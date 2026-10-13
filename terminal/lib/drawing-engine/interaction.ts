// Screen-space drawing gestures: angle constraints, anchor translation, handle hit-tests.
// Hit tolerance is expressed in CSS pixels (not device pixels) so high-DPR viewports
// match the same finger targets as desktop.

import type { DrawingAnchor } from "@/lib/chart-engine/drawingBridge";
import type { EngineTime } from "@/lib/chart-engine/api";
import type { Drawing, Pt } from "@/lib/drawings";

export type ScreenPoint = { x: number; y: number };

/** Handle hit radius in CSS pixels (matches ChartPanel grip r=5 + slack). */
export const DRAWING_HANDLE_HIT_RADIUS_CSS = 12;

export type DrawingHandleHit = {
  drawingId: string;
  handleIndex: number;
  distanceCss: number;
};

export type DrawingHandleTarget = {
  drawingId: string;
  handleIndex: number;
  /** Chart-root SVG user-space centre (CSS px). */
  cx: number;
  cy: number;
};

/**
 * Pick the nearest handle within tolerance. Coordinates are chart-root CSS pixels;
 * `devicePixelRatio` is accepted only to prove the tolerance is NOT multiplied by DPR
 * (mutant tests invert that).
 */
export function hitTestDrawingHandles(
  px: number,
  py: number,
  handles: readonly DrawingHandleTarget[],
  toleranceCss = DRAWING_HANDLE_HIT_RADIUS_CSS,
  _devicePixelRatio = 1,
): DrawingHandleHit | null {
  if (!Number.isFinite(px) || !Number.isFinite(py) || !handles.length) return null;
  void _devicePixelRatio;
  const slack = toleranceCss;
  let best: DrawingHandleHit | null = null;
  for (const handle of handles) {
    const dx = px - handle.cx;
    const dy = py - handle.cy;
    const distance = Math.hypot(dx, dy);
    if (distance > slack) continue;
    if (!best || distance < best.distanceCss) {
      best = { drawingId: handle.drawingId, handleIndex: handle.handleIndex, distanceCss: distance };
    }
  }
  return best;
}

/** Build a pane-scoped bridge anchor from a persisted drawing point. */
export function drawingPointToAnchor(
  paneIndex: number,
  point: Pt,
  logical: number,
  time: EngineTime | null,
  futureSlot?: number,
): DrawingAnchor {
  return {
    paneIndex,
    time,
    logical,
    price: point.p,
    ...(futureSlot != null && futureSlot >= 0 ? { future: { slot: futureSlot } } : {}),
  };
}

/**
 * Constrain an endpoint to the nearest angular increment in screen space.
 * Screen space is deliberate: a visually horizontal/vertical/diagonal line
 * stays exact even when the price scale is logarithmic or the chart is resized.
 */
export function constrainScreenAngle(
  origin: ScreenPoint,
  candidate: ScreenPoint,
  incrementDegrees = 45,
): ScreenPoint {
  const dx = candidate.x - origin.x;
  const dy = candidate.y - origin.y;
  const radius = Math.hypot(dx, dy);
  if (!Number.isFinite(radius) || radius === 0) return { ...candidate };
  const increment = Math.max(1, Math.min(180, incrementDegrees)) * Math.PI / 180;
  const angle = Math.round(Math.atan2(dy, dx) / increment) * increment;
  return {
    x: origin.x + Math.cos(angle) * radius,
    y: origin.y + Math.sin(angle) * radius,
  };
}

function rounded(value: number, precision: number): number {
  return +value.toFixed(Math.max(0, Math.min(12, precision)));
}

/**
 * Translate every anchor by one shared, boundary-clamped bar delta. Keeping a
 * common delta prevents multi-point patterns from collapsing at either edge.
 */
export function translateDrawingAnchors(
  drawing: Drawing,
  orderedTimes: readonly string[],
  requestedBars: number,
  deltaPrice: number,
  precision: number,
): Pt[] {
  if (!orderedTimes.length || !drawing.points.length) return drawing.points.map((point) => ({ ...point }));
  const indexByTime = new Map(orderedTimes.map((time, index) => [String(time), index] as const));
  const indices = drawing.points.map((point) => indexByTime.get(String(point.t)) ?? -1);
  if (indices.some((index) => index < 0)) {
    return drawing.points.map((point) => ({ ...point, p: rounded(point.p + deltaPrice, precision) }));
  }
  const minimum = Math.min(...indices);
  const maximum = Math.max(...indices);
  const integerDelta = Math.trunc(requestedBars);
  const barDelta = Math.max(-minimum, Math.min(orderedTimes.length - 1 - maximum, integerDelta));
  return drawing.points.map((point, pointIndex) => ({
    t: String(orderedTimes[indices[pointIndex] + barDelta]),
    p: rounded(point.p + deltaPrice, precision),
  }));
}

/** A detached copy suitable for paste/command-drag without shared nested state. */
export function cloneDrawing(
  drawing: Drawing,
  id: string,
  points: readonly Pt[] = drawing.points,
): Drawing {
  return {
    ...drawing,
    id,
    locked: false,
    points: points.map((point) => ({ ...point })),
    ...(drawing.meta ? { meta: structuredCloneSafe(drawing.meta) } : {}),
  };
}

function structuredCloneSafe<T>(value: T): T {
  try {
    if (typeof structuredClone === "function") return structuredClone(value);
  } catch {}
  return JSON.parse(JSON.stringify(value)) as T;
}
