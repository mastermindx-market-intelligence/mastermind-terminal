import type { ISeriesApi, ISeriesPrimitive, SeriesType } from "lightweight-charts";

type PaneSeries = ISeriesApi<SeriesType>;

export function paneDrawingScaleReady(series: PaneSeries): boolean {
  try {
    const range = series.priceScale().getVisibleRange();
    return range != null && Number.isFinite(range.from) && Number.isFinite(range.to)
      && range.to > range.from;
  } catch {
    return false; // A removed/rebuilt indicator cannot migrate its old document.
  }
}

/** Watch only pending legacy panes through LWC's public primitive lifecycle.
 * Scale/data paints notify the primitive; an empty pane needs no polling timer.
 * The following frame observes the finished coordinate map before retrying.
 */
export function watchPaneDrawingReadiness(generation: () => number, onReady: () => void) {
  const watched = new Map<PaneSeries, { epoch: number; primitive: ISeriesPrimitive }>();
  let disposed = false;
  let frame: number | null = null;
  let frameEpoch: number | null = null;
  const detach = (series: PaneSeries, primitive: ISeriesPrimitive) => {
    try { series.detachPrimitive(primitive); } catch { /* already removed */ }
  };
  return {
    sync(pending: ReadonlySet<PaneSeries>) {
      if (disposed) return;
      const epoch = generation();
      if (frame != null && frameEpoch !== epoch) {
        cancelAnimationFrame(frame); frame = null; frameEpoch = null;
      }
      for (const [series, entry] of watched) {
        if (!pending.has(series) || entry.epoch !== epoch) {
          watched.delete(series);
          detach(series, entry.primitive);
        }
      }
      for (const series of pending) {
        if (watched.has(series)) continue;
        const primitive: ISeriesPrimitive = {
          attached: ({ requestUpdate }) => requestUpdate(),
          updateAllViews: () => {
            if (disposed || generation() !== epoch || frame != null
              || watched.get(series)?.primitive !== primitive || !paneDrawingScaleReady(series)) return;
            frameEpoch = epoch;
            frame = requestAnimationFrame(() => {
              frame = null; frameEpoch = null;
              if (!disposed && generation() === epoch
                && [...watched].some(([pending, entry]) => entry.epoch === epoch && paneDrawingScaleReady(pending))) onReady();
            });
          },
        };
        watched.set(series, { epoch, primitive });
        try { series.attachPrimitive(primitive); } catch { watched.delete(series); }
      }
    },
    dispose() {
      disposed = true;
      if (frame != null) cancelAnimationFrame(frame);
      frame = null;
      frameEpoch = null;
      for (const [series, { primitive }] of watched) detach(series, primitive);
      watched.clear();
    },
  };
}
