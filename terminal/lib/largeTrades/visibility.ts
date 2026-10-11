/** The chart owns panes and coordinates; this module only admits its measured price pane. */
export type LargeTradesPricePane = {
  key: string;
  paneIndex: number;
  top: number;
  height: number;
  collapsed?: boolean;
};
export type LargeTradesPaneControls = {
  maximized: string | null;
  collapsed: ReadonlySet<string>;
};
export type LargeTradesPlot = { x: number; y: number; width: number; height: number };

function usablePane(pane: LargeTradesPricePane | null): pane is LargeTradesPricePane {
  return !!pane && !pane.collapsed && Number.isFinite(pane.top) && pane.top >= 0
    && Number.isFinite(pane.height) && pane.height > 0
    && Number.isInteger(pane.paneIndex) && pane.paneIndex >= 0;
}

/** paneCtl is synchronous; the measured layout can still describe the previous frame. */
export function resolveLargeTradesPricePane(
  pane: LargeTradesPricePane | null,
  controls: LargeTradesPaneControls,
  nativePaneIndex: number | null,
): LargeTradesPricePane | null {
  if (!usablePane(pane) || nativePaneIndex !== pane.paneIndex) return null;
  if (controls.collapsed.has(pane.key)) return null;
  if (controls.maximized && controls.maximized !== pane.key) return null;
  return pane;
}

/** LWC time coordinates start at the plot, after the chart's visible left price scale. */
export function largeTradesPlotBounds(
  pane: LargeTradesPricePane | null,
  leftScaleWidth: number,
  plotWidth: number,
): LargeTradesPlot | null {
  if (!usablePane(pane) || !Number.isFinite(leftScaleWidth) || leftScaleWidth < 0
    || !Number.isFinite(plotWidth) || plotWidth <= 0) return null;
  return { x: leftScaleWidth, y: pane.top, width: plotWidth, height: pane.height };
}

/**
 * Control targets and mandatory provenance belong inside the visible price plot. Reserve
 * the native pane header's 44px target plus its 4px top spacing, and the actual
 * chart-owned status header when it extends farther down. The control width
 * budgets 16px outer gaps + 2px border + 32px header padding + 80px copy + 8px gap +
 * 44px action + 16px scrollbar allowance. Height budgets 16 + 2 + 14px top padding +
 * 44px action + 10px bottom padding + 1px separator, rounded to 88px. Compact headers
 * keep the action at the top inset and scroll their text, rather than centering it
 * against wrapping copy. If this footprint cannot fit, the entire study co-hides.
 */
export function largeTradesControlBounds(
  plot: LargeTradesPlot | null,
  rootWidth: number,
  rootHeight: number,
  viewport: LargeTradesPlot = { x: 0, y: 0, width: rootWidth, height: rootHeight },
  statusHeaderBottom = 0,
): LargeTradesPlot | null {
  if (!plot || ![plot.x, plot.y, plot.width, plot.height, rootWidth, rootHeight,
    viewport.x, viewport.y, viewport.width, viewport.height, statusHeaderBottom].every(Number.isFinite)
    || plot.width <= 0 || plot.height <= 0 || rootWidth <= 0 || rootHeight <= 0
    || viewport.width <= 0 || viewport.height <= 0) return null;
  const x = Math.max(0, plot.x, viewport.x);
  const y = Math.max(0, plot.y + 48, statusHeaderBottom, viewport.y);
  const right = Math.min(rootWidth, plot.x + plot.width, viewport.x + viewport.width);
  const bottom = Math.min(rootHeight, plot.y + plot.height, viewport.y + viewport.height);
  return right - x >= 198 && bottom - y >= 88
    ? { x, y, width: right - x, height: bottom - y } : null;
}

export function largeTradesPoint(
  plot: LargeTradesPlot,
  plotX: number | null,
  paneY: number | null,
): { x: number; y: number } | null {
  if (plotX == null || paneY == null || !Number.isFinite(plotX) || !Number.isFinite(paneY)
    || plotX < 0 || plotX > plot.width || paneY < 0 || paneY > plot.height) return null;
  return { x: plot.x + plotX, y: plot.y + paneY };
}

/** Clip complete bubbles and labels to their price plot, including at the pane/axis edges. */
export function largeTradesClip(
  plot: LargeTradesPlot | null,
  rootWidth: number,
  rootHeight: number,
): string {
  if (!plot || !Number.isFinite(rootWidth) || rootWidth <= 0
    || !Number.isFinite(rootHeight) || rootHeight <= 0) return "inset(100%)";
  const top = Math.max(0, plot.y);
  const left = Math.max(0, plot.x);
  const right = Math.max(0, rootWidth - plot.x - plot.width);
  const bottom = Math.max(0, rootHeight - plot.y - plot.height);
  return `inset(${top}px ${right}px ${bottom}px ${left}px)`;
}
