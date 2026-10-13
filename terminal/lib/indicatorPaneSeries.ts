import type { SeriesHandle } from "./chart-engine/api";

type IndicatorPaneSeries = {
  applyOptions: (options: { priceLineVisible: boolean }) => void;
};

/**
 * Keep each series' existing right-axis label setting, but remove the native
 * horizontal line that Lightweight Charts draws from its latest value.
 *
 * Deliberate createPriceLine() guides (for example 80/50/20 or zero) are
 * separate primitives and remain visible.
 */
export function keepIndicatorPaneAxisLabelsOnly<T extends IndicatorPaneSeries>(series: T[]): T[] {
  for (const item of series) item.applyOptions({ priceLineVisible: false });
  return series;
}

/**
 * Engine-handle entry point for the labels-only contract (M02). Same body as
 * {@link keepIndicatorPaneAxisLabelsOnly}; typed on SeriesHandle so ChartPanel's
 * study/compare/volume cluster can drop ISeriesApi without changing the raw
 * helper's signature.
 */
export function keepIndicatorPaneAxisLabelsOnlyHandles(series: SeriesHandle[]): SeriesHandle[] {
  return keepIndicatorPaneAxisLabelsOnly(series);
}
