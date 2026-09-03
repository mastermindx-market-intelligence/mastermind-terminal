export const DEFAULT_CHART_VIEW_BARS = 240;
export const DEFAULT_CHART_RIGHT_OFFSET = 24;
export const DEFAULT_CHART_RIGHT_BUFFER_PX = 80;

export type ChartLogicalRange = { from: number; to: number };

/**
 * Extend an explicit range past its last data point. Lightweight Charts'
 * explicit range setters do not use timeScale.rightOffset as a visual buffer,
 * so range presets have to add that gutter to the logical end themselves.
 */
export function withChartFutureOffset(
  range: ChartLogicalRange | null,
  rightOffset = DEFAULT_CHART_RIGHT_OFFSET,
): ChartLogicalRange | null {
  if (!range) return null;
  const offset = Number.isFinite(rightOffset) ? Math.max(0, rightOffset) : DEFAULT_CHART_RIGHT_OFFSET;
  return { from: range.from, to: range.to + offset };
}

/**
 * How many whitespace bars to hang off the end of the time scale.
 *
 * Bounded by the anchor grid, and kept proportionate to the loaded history so a
 * thinly traded name with sixty bars does not render as mostly blank canvas.
 */
export function futureAxisBarCount(rowCount: number, maxBars: number): number {
  const count = Math.max(0, Math.floor(rowCount));
  if (count < 2) return 0;
  return Math.max(0, Math.min(maxBars, Math.max(DEFAULT_CHART_RIGHT_OFFSET, Math.round(count * 0.2))));
}

/**
 * Convert the desired visual clearance into logical bars. Narrow charts need
 * more future bars because the normalized 240-bar window compresses each bar.
 * Cap the blank region at 30% so an exceptionally narrow pane stays useful.
 */
export function defaultChartRightOffset(plotWidth?: number): number {
  if (plotWidth == null || !Number.isFinite(plotWidth) || plotWidth <= 0) {
    return DEFAULT_CHART_RIGHT_OFFSET;
  }
  const width = Math.max(1, plotWidth);
  const bufferPx = Math.min(DEFAULT_CHART_RIGHT_BUFFER_PX, width * 0.3);
  const plottedBars = DEFAULT_CHART_VIEW_BARS - 1;
  return Math.max(
    DEFAULT_CHART_RIGHT_OFFSET,
    Math.ceil((bufferPx * plottedBars) / Math.max(1, width - bufferPx)),
  );
}

/**
 * Return the Terminal's normal recent-bar viewport. A null range means the
 * available slice is already small enough (or replay is active), so fitting
 * that slice is the least surprising view.
 */
export function normalizedChartLogicalRange(
  rowCount: number,
  replayActive: boolean,
  plotWidth?: number,
): ChartLogicalRange | null {
  const count = Math.max(0, Math.floor(rowCount));
  if (replayActive || count <= DEFAULT_CHART_VIEW_BARS) return null;

  return {
    from: count - DEFAULT_CHART_VIEW_BARS,
    to: count - 1 + defaultChartRightOffset(plotWidth),
  };
}

/**
 * The "show everything" viewport: all real bars plus the future gutter.
 *
 * The time scale is deliberately longer than the data — a whitespace tail gives
 * the blank right-hand region real future dates and addressable drawing anchors.
 * fitContent() would fit THAT tail too and leave the candles squeezed against
 * the left edge, so a full-history view states its own bounds instead.
 */
export function fullHistoryLogicalRange(
  rowCount: number,
  plotWidth?: number,
): ChartLogicalRange | null {
  const count = Math.max(0, Math.floor(rowCount));
  if (count < 2) return null;
  return { from: 0, to: count - 1 + defaultChartRightOffset(plotWidth) };
}
