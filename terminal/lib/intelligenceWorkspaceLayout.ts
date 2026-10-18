/**
 * Geometry for the Terminal Intelligence Workspace drawer.
 *
 * Pure layout math only: no DOM access, no imports, no state, no market
 * logic. Callers pass the visual viewport metrics plus the chart and
 * watchlist rail rectangles (in the same page coordinate space) and receive
 * the rectangle the drawer should occupy.
 *
 * All inputs are sanitized: non-finite, zero or negative viewport dimensions
 * collapse to safe fallbacks, non-finite offsets become 0, and any chart or
 * rail rectangle that is not fully finite, non-reversed and non-empty is
 * ignored. Every returned value is a finite, nonnegative number and the
 * returned rectangle stays inside the (sanitized) viewport.
 */

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface LayoutInput {
  viewport: {
    width: number;
    height: number;
    offsetLeft?: number;
    offsetTop?: number;
  };
  chart: Rect | null;
  rail: Rect | null;
  requestedWidth?: number;
  expanded?: boolean;
}

export interface Layout {
  mode: "docked" | "sheet";
  left: number;
  top: number;
  width: number;
  height: number;
  minWidth: number;
  maxWidth: number;
}

/** At or below this viewport width the drawer renders as a bottom sheet. */
const SHEET_MAX_VIEWPORT_WIDTH = 860;
/** Fraction of the viewport height the bottom sheet occupies. */
const SHEET_HEIGHT_RATIO = 0.88;
/** Hard cap on the bottom sheet height, in pixels. */
const SHEET_MAX_HEIGHT = 900;

/** Breathing room between the drawer and viewport, chart or rail edges. */
const EDGE_GAP = 8;
/** Chart pixels that must stay visible to the left of the docked drawer. */
const CHART_MIN_VISIBLE_WIDTH = 220;
/** ...or this fraction of the chart width, whichever is smaller. */
const CHART_MIN_VISIBLE_RATIO = 0.2;
/** Docked drawer width bounds and defaults, in pixels. */
const MAX_DRAWER_WIDTH = 760;
const MIN_DRAWER_WIDTH = 360;
const DEFAULT_DRAWER_WIDTH = 440;
const DEFAULT_EXPANDED_WIDTH = 640;
/**
 * Substitutes for malformed (non-finite, negative or zero) viewport
 * dimensions, so the layout stays usable instead of collapsing.
 */
const FALLBACK_VIEWPORT_WIDTH = 360;
const FALLBACK_VIEWPORT_HEIGHT = 640;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Non-finite, zero or negative dimensions collapse to the safe fallback. */
function sanitizeDimension(value: unknown, fallback: number): number {
  return isFiniteNumber(value) && value > 0 ? value : fallback;
}

/** Offsets are page scroll positions: non-finite or negative becomes 0. */
function sanitizeOffset(value: unknown): number {
  return isFiniteNumber(value) && value > 0 ? value : 0;
}

/** Usable rectangles are fully finite, non-reversed and non-empty. */
function isUsableRect(rect: unknown): rect is Rect {
  if (rect === null || typeof rect !== "object") {
    return false;
  }
  const candidate = rect as Partial<Rect>;
  return (
    isFiniteNumber(candidate.left) &&
    isFiniteNumber(candidate.top) &&
    isFiniteNumber(candidate.right) &&
    isFiniteNumber(candidate.bottom) &&
    candidate.right > candidate.left &&
    candidate.bottom > candidate.top
  );
}

/** Only a rail that actually intersects the viewport can be covered. */
function railIntersectsViewport(rail: Rect, viewport: Rect): boolean {
  return (
    rail.left < viewport.right &&
    rail.right > viewport.left &&
    rail.top < viewport.bottom &&
    rail.bottom > viewport.top
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function intelligenceWorkspaceLayout(input: LayoutInput): Layout {
  const source: Partial<LayoutInput> =
    input !== null && typeof input === "object" ? input : {};
  const rawViewport: Partial<LayoutInput["viewport"]> =
    source.viewport !== null && typeof source.viewport === "object"
      ? source.viewport
      : {};

  const viewportLeft = sanitizeOffset(rawViewport.offsetLeft);
  const viewportTop = sanitizeOffset(rawViewport.offsetTop);
  const viewportWidth = sanitizeDimension(
    rawViewport.width,
    FALLBACK_VIEWPORT_WIDTH,
  );
  const viewportHeight = sanitizeDimension(
    rawViewport.height,
    FALLBACK_VIEWPORT_HEIGHT,
  );
  const viewport: Rect = {
    left: viewportLeft,
    top: viewportTop,
    right: viewportLeft + viewportWidth,
    bottom: viewportTop + viewportHeight,
  };

  const chart = isUsableRect(source.chart) ? source.chart : null;
  const rail =
    isUsableRect(source.rail) && railIntersectsViewport(source.rail, viewport)
      ? source.rail
      : null;
  const expanded = source.expanded === true;
  const requestedWidth = isFiniteNumber(source.requestedWidth)
    ? source.requestedWidth
    : null;

  // Narrow viewports get a full-width bottom sheet pinned to the bottom.
  if (viewportWidth <= SHEET_MAX_VIEWPORT_WIDTH) {
    const sheetHeight = Math.min(
      viewportHeight * SHEET_HEIGHT_RATIO,
      SHEET_MAX_HEIGHT,
    );
    return {
      mode: "sheet",
      left: viewport.left,
      top: viewport.bottom - sheetHeight,
      width: viewportWidth,
      height: sheetHeight,
      minWidth: viewportWidth,
      maxWidth: viewportWidth,
    };
  }

  // Docked: the drawer hugs the rail's left edge and grows leftward over the
  // chart. Its right edge is the closest of rail, chart and viewport edges
  // (each kept EDGE_GAP pixels away); the chart keeps its minimum visible
  // slice to the left of the drawer.
  let right = viewport.right - EDGE_GAP;
  if (rail !== null) {
    right = Math.min(right, rail.left - EDGE_GAP);
  }
  if (chart !== null) {
    right = Math.min(right, chart.right - (rail === null ? EDGE_GAP : 0));
  }
  // A rail poking in at the viewport edge can leave no usable span; the
  // viewport wins over the rail in that degenerate case.
  right = clamp(right, viewport.left, viewport.right);

  let leftLimit = viewport.left + EDGE_GAP;
  if (chart !== null) {
    const chartWidth = chart.right - chart.left;
    leftLimit = Math.max(
      leftLimit,
      chart.left +
        Math.min(CHART_MIN_VISIBLE_WIDTH, chartWidth * CHART_MIN_VISIBLE_RATIO),
    );
  }
  leftLimit = Math.min(leftLimit, right);

  const available = right - leftLimit;
  const maxWidth = Math.min(MAX_DRAWER_WIDTH, available);
  const minWidth = Math.min(MIN_DRAWER_WIDTH, maxWidth);
  const preferredWidth =
    requestedWidth !== null
      ? requestedWidth
      : expanded
        ? DEFAULT_EXPANDED_WIDTH
        : DEFAULT_DRAWER_WIDTH;
  const fittedWidth = clamp(preferredWidth, minWidth, maxWidth);
  // No fabricated width when the rail leaves no visible chart span.
  const width = fittedWidth;
  const left = right - width;

  let top = viewport.top + EDGE_GAP;
  let bottom = viewport.bottom - EDGE_GAP;
  if (chart !== null) {
    top = Math.max(top, chart.top + EDGE_GAP);
    bottom = Math.min(bottom, chart.bottom - EDGE_GAP);
  }
  bottom = clamp(bottom, viewport.top, viewport.bottom);
  top = clamp(top, viewport.top, bottom);

  const fittedHeight = bottom - top;
  // A collapsed visual viewport must never receive an overflowing sliver.
  const height = fittedHeight;
  const resolvedTop = top;

  return {
    mode: "docked",
    left,
    top: resolvedTop,
    width,
    height,
    minWidth,
    maxWidth,
  };
}
