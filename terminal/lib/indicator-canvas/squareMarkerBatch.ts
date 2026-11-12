import type { CoordMapper, MarkerPrim } from "./types";

const CULL_PAD = 40;
const SQUARE_STROKE_WIDTH = 1;

export interface SquareMarkerBatchPlan {
  paths: string[];
  fill: string;
  stroke: string | null;
  alpha: number | null;
  visibleCount: number;
}

const finite = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value);

const clamp01 = (value: number): number => value < 0 ? 0 : value > 1 ? 1 : value;
const effectiveSize = (marker: MarkerPrim, barW: number): number =>
  barW < 4 ? Math.min(marker.size ?? 5, 3) : (marker.size ?? 5);
const effectiveAlpha = (marker: MarkerPrim): number | null =>
  marker.alpha == null ? null : clamp01(marker.alpha);

/** True when two adjacent markers can share one batch plan without any style or z-order drift. */
export function sameSquareMarkerBatchStyle(
  a: MarkerPrim,
  b: MarkerPrim,
  barW: number,
): boolean {
  return (
    a.shape === "square" &&
    b.shape === "square" &&
    !a.tooltipId &&
    !b.tooltipId &&
    effectiveSize(a, barW) === effectiveSize(b, barW) &&
    a.fill === b.fill &&
    (a.stroke ?? null) === (b.stroke ?? null) &&
    effectiveAlpha(a) === effectiveAlpha(b) &&
    (a.z ?? 0) === (b.z ?? 0)
  );
}

/**
 * Project one contiguous, already z-ordered run of square markers into exact compound paths.
 *
 * Returning `null` means the caller must retain the ordinary one-marker/one-node renderer. The
 * planner rejects tooltip/style/z changes, then partitions projected rectangles into the minimum
 * first-fit set of x-non-overlapping layers. Overlapping squares therefore remain in DIFFERENT SVG
 * elements, preserving separate-node opacity compounding, while each layer collapses to one path.
 * A plan is returned only when it actually reduces node count.
 */
export function planSquareMarkerBatch(
  markers: readonly MarkerPrim[],
  mapper: Pick<CoordMapper, "xi" | "y" | "W" | "barW">,
): SquareMarkerBatchPlan | null {
  if (markers.length < 2) return null;

  const first = markers[0];
  if (first.shape !== "square" || first.tooltipId) return null;
  const size = effectiveSize(first, mapper.barW);
  const alpha = effectiveAlpha(first);
  const stroke = first.stroke ?? null;
  const strokeGap = stroke ? SQUARE_STROKE_WIDTH : 0;

  const layers: Array<{ right: number; parts: string[] }> = [];
  let visibleCount = 0;
  let previousX = -Infinity;

  for (const marker of markers) {
    if (marker.shape !== "square" || marker.tooltipId) return null;
    if (!sameSquareMarkerBatchStyle(first, marker, mapper.barW)) return null;

    if (marker.minPxPerBar != null && mapper.barW < marker.minPxPerBar) continue;
    const x = mapper.xi(marker.i);
    const y = mapper.y(marker.p);
    if (!finite(x) || !finite(y) || x < -CULL_PAD || x > mapper.W + CULL_PAD) continue;
    // The renderer's stable input is normally chronological. Refuse a non-monotonic run rather than
    // moving its nodes ahead of one another under a future module with unusual marker ordering.
    if (x < previousX) return null;
    previousX = x;

    const left = x - size;
    const right = x + size;
    const part = `M${left} ${y - size}H${right}V${y + size}H${left}Z`;
    let layer = layers.find((candidate) => left >= candidate.right + strokeGap);
    if (!layer) {
      layer = { right: -Infinity, parts: [] };
      layers.push(layer);
    }
    layer.parts.push(part);
    layer.right = right;
    visibleCount++;
  }

  if (visibleCount < 2 || layers.length >= visibleCount) return null;
  return {
    paths: layers.map((layer) => layer.parts.join("")),
    fill: first.fill,
    stroke,
    alpha,
    visibleCount,
  };
}
