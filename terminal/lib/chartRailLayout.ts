/** Presentation-only geometry. The chart engine remains the plot/data owner. */
export const MIN_PRICE_PLOT_WIDTH = 640;
export const MIN_RAIL_WIDTH = 300;
export const MAX_RAIL_WIDTH = 520;
export const DEFAULT_RAIL_WIDTH = 360;

export interface ChartPlotGeometry {
  paneWidth: number;
  plotWidth: number;
  /** Stable occupied width plus the engine's one-pixel even-size allowance. */
  plotInset: number;
}
export interface ChartRailBudget {
  availableWidth: number;
  columns: number;
  gap: number;
  plotInset: number;
}
export function clampRailWidth(width: number, maximum = MAX_RAIL_WIDTH): number {
  return Math.min(maximum, Math.max(MIN_RAIL_WIDTH, Math.round(width)));
}
export function chartRailLayout(budget: ChartRailBudget, requestedWidth: number) {
  const { availableWidth, columns, gap, plotInset } = budget;
  // Unknown/hidden geometry must not be sold as a qualified dock.
  if (![availableWidth, columns, gap, plotInset].every(Number.isFinite)
    || availableWidth <= 0 || columns < 1 || gap < 0 || plotInset < 0) {
    return { placement: "below" as const, width: clampRailWidth(requestedWidth), maximum: MIN_RAIL_WIDTH };
  }
  const maximum = Math.min(MAX_RAIL_WIDTH, Math.floor(
    availableWidth - gap * (columns - 1) - columns * (MIN_PRICE_PLOT_WIDTH + plotInset),
  ));
  if (maximum < MIN_RAIL_WIDTH) {
    return { placement: "below" as const, width: clampRailWidth(requestedWidth), maximum: MIN_RAIL_WIDTH };
  }
  return { placement: "rail" as const, width: clampRailWidth(requestedWidth, maximum), maximum };
}

export function railWidthForKey(key: string, width: number, maximum: number, largeStep = false): number | null {
  const step = largeStep ? 40 : 10;
  if (key === "ArrowLeft") return clampRailWidth(width + step, maximum);
  if (key === "ArrowRight") return clampRailWidth(width - step, maximum);
  if (key === "Home") return MIN_RAIL_WIDTH;
  if (key === "End") return maximum;
  return null;
}
