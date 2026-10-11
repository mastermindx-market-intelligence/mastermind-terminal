import type { Pt } from "./drawings";

type PaneProjection = {
  priceToCoordinate(price: number): number | null;
  coordinateToPrice(coordinate: number): number | null;
  priceScale(): { getVisibleRange(): { from: number; to: number } | null };
};

/** Convert legacy chart-root Y anchors atomically; null leaves them pending. */
export function migrateLegacyPanePoints(
  points: readonly Pt[],
  paneTop: number,
  series: PaneProjection,
): Pt[] | null {
  // LWC returns finite 0 from both projection APIs while its price scale is
  // empty. Persisting those sentinels would irreversibly mark [0, 0] migrated.
  // Keep the original document until a later layout has an actual price range.
  const range = series.priceScale().getVisibleRange();
  if (!range || !Number.isFinite(range.from) || !Number.isFinite(range.to)
    || range.to <= range.from || !Number.isFinite(paneTop)) return null;
  // Range may precede the pane's first painted height. Require a non-collapsed
  // projection as well; even a valid [0, 1] range can still project both to 0.
  const fromY = series.priceToCoordinate(range.from);
  const toY = series.priceToCoordinate(range.to);
  if (fromY == null || toY == null || !Number.isFinite(fromY)
    || !Number.isFinite(toY) || fromY === toY) return null;
  const migrated: Pt[] = [];
  for (const point of points) {
    const legacyRootY = series.priceToCoordinate(point.p);
    if (legacyRootY == null || !Number.isFinite(legacyRootY)) return null;
    const corrected = series.coordinateToPrice(legacyRootY - paneTop);
    if (corrected == null || !Number.isFinite(corrected)) return null;
    migrated.push({ ...point, p: corrected });
  }
  return migrated;
}
