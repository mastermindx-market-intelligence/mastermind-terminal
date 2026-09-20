type GradPoint = { i: number; p: number };

export type IndexedSeriesSlice = {
  start: number;
  end: number;
  optimized: boolean;
};

/**
 * Long premium-suite lines are immutable inside computeSuite memoized render bundles. Cache the
 * one-time monotonicity proof by array identity so pan/zoom frames can use binary search without
 * rescanning 1k+ historical points. Any non-finite or out-of-order index falls back to the full
 * array, preserving the renderer existing behavior for non-canonical callers.
 */
const MONOTONIC = new WeakMap<object, boolean>();

function monotonicByIndex(points: readonly GradPoint[]): boolean {
  const key = points as object;
  const cached = MONOTONIC.get(key);
  if (cached != null) return cached;
  let prev = -Infinity;
  let ok = true;
  for (const pt of points) {
    if (!Number.isFinite(pt.i) || pt.i < prev) { ok = false; break; }
    prev = pt.i;
  }
  MONOTONIC.set(key, ok);
  return ok;
}

function lowerBound(points: readonly GradPoint[], value: number): number {
  let lo = 0, hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (points[mid].i < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function upperBound(points: readonly GradPoint[], value: number): number {
  let lo = 0, hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (points[mid].i <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Plan the smallest safe point window for a gradline.
 *
 * padPx mirrors the renderer horizontal cull slack. Converting it to logical bars keeps the same
 * visible contract at every zoom level. One extra point on both sides is retained so a segment
 * whose endpoints straddle the padded viewport still renders even when neither endpoint is inside.
 */
export function planIndexedSeriesSlice(
  points: readonly GradPoint[],
  i0: number,
  i1: number,
  barW: number,
  padPx = 40,
): IndexedSeriesSlice {
  const n = points.length;
  const full = { start: 0, end: n, optimized: false };
  if (n < 2) return full;
  if (!Number.isFinite(i0) || !Number.isFinite(i1) || !Number.isFinite(barW) || !(barW > 0)) return full;
  if (!Number.isFinite(padPx) || padPx < 0) return full;
  if (!monotonicByIndex(points)) return full;

  const left = Math.min(i0, i1);
  const right = Math.max(i0, i1);
  const logicalPad = padPx / barW;
  const firstInside = lowerBound(points, left - logicalPad);
  const firstAfter = upperBound(points, right + logicalPad);

  const start = Math.max(0, firstInside - 1);
  const end = Math.min(n, firstAfter + 1);
  return { start, end, optimized: start > 0 || end < n };
}
