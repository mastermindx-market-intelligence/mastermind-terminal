// Bounded raw-price projection for Copilot from the EXISTING active rendered bar set.
// No fetch, resample, indicator compute, signal scoring, or second bar store.

import type { Bar } from "./fund";
import { timeToMs } from "./timeWindow";

export const CHART_PRICE_WINDOW_SCHEMA = "chart.price_window.v1" as const;
export const CHART_PRICE_WINDOW_MAX_BARS = 12;
export const CHART_PRICE_WINDOW_MAX_BYTES = 4096;

export type ChartPriceWindowRange = { from: number; to: number } | null;

export type ChartPriceWindowSource = {
  symbol: string;
  tf: string;
  bars: readonly Bar[];
  replay: boolean;
};

type PriceRow = {
  source_index: number;
  time: string | number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  age_bars_from_loaded_end: number;
};

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const token = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max
  && value.trim() === value
  && ![...value].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127);

function unavailable(reason: string, symbol: string, tf: string, sourceBarCount: number) {
  return {
    schema: CHART_PRICE_WINDOW_SCHEMA,
    status: "unavailable" as const,
    reason,
    symbol: token(symbol, 64) ? symbol : "",
    tf: token(tf, 32) ? tf : "",
    source_bar_count: sourceBarCount,
  };
}

function bytes(value: unknown): number {
  try { return new TextEncoder().encode(JSON.stringify(value)).byteLength; }
  catch { return Number.POSITIVE_INFINITY; }
}

function validBarTime(value: unknown): value is string | number {
  if (finite(value)) return true;
  return typeof value === "string" && value.length > 0 && value.length <= 64
    && value.trim() === value
    && ![...value].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127);
}

function barMs(bar: Bar | undefined): number {
  return bar && validBarTime(bar.time) ? timeToMs(bar.time) : NaN;
}

/** Build a viewport-aware recent price window from the exact rendered bars.
 * A visible viewport with no loaded overlap stays unavailable; it never substitutes
 * the loaded tail and pretends those bars are on screen.
 */
export function buildChartPriceWindow(
  source: ChartPriceWindowSource,
  symbol: string,
  tf: string,
  visibleRange: ChartPriceWindowRange,
): Record<string, unknown> {
  const bars = source?.bars;
  if (!token(symbol, 64) || !token(tf, 32)
      || source?.symbol !== symbol || source?.tf !== tf)
    return unavailable("price_window_identity_invalid", symbol, tf, Array.isArray(bars) ? bars.length : 0);
  if (!Array.isArray(bars) || bars.length === 0)
    return unavailable("price_window_bars_unavailable", symbol, tf, 0);
  if (bars.length > 200_000)
    return unavailable("price_window_source_too_large", symbol, tf, bars.length);

  let start = 0;
  let end = bars.length;
  let scope: "visible_tail" | "loaded_tail" = "loaded_tail";

  if (visibleRange !== null) {
    if (!finite(visibleRange.from) || !finite(visibleRange.to) || visibleRange.from >= visibleRange.to)
      return unavailable("price_window_visible_range_invalid", symbol, tf, bars.length);
    scope = "visible_tail";
    const fromMs = visibleRange.from * 1000;
    const toMs = visibleRange.to * 1000;

    // Lower bound: first loaded bar on/after viewport start.
    let lo = 0, hi = bars.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const ms = barMs(bars[mid]);
      if (!Number.isFinite(ms))
        return unavailable("price_window_time_invalid", symbol, tf, bars.length);
      if (ms < fromMs) lo = mid + 1; else hi = mid;
    }
    start = lo;

    // Upper bound: first loaded bar after viewport end.
    lo = start; hi = bars.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const ms = barMs(bars[mid]);
      if (!Number.isFinite(ms))
        return unavailable("price_window_time_invalid", symbol, tf, bars.length);
      if (ms <= toMs) lo = mid + 1; else hi = mid;
    }
    end = lo;
    if (start >= end)
      return unavailable("price_window_visible_range_has_no_loaded_bars", symbol, tf, bars.length);
  }

  const eligible = end - start;
  const returnedStart = Math.max(start, end - CHART_PRICE_WINDOW_MAX_BARS);
  const rows: PriceRow[] = [];
  let previousTime = Number.NEGATIVE_INFINITY;
  for (let index = returnedStart; index < end; index++) {
    const bar = bars[index];
    const ms = barMs(bar);
    if (!bar || !Number.isFinite(ms) || ms <= previousTime)
      return unavailable("price_window_time_order_invalid", symbol, tf, bars.length);
    if (![bar.o, bar.h, bar.l, bar.c].every(finite) || bar.h < bar.l)
      return unavailable("price_window_ohlc_invalid", symbol, tf, bars.length);
    if (bar.v !== undefined && (!finite(bar.v) || bar.v < 0))
      return unavailable("price_window_volume_invalid", symbol, tf, bars.length);
    previousTime = ms;
    rows.push({
      source_index: index,
      time: bar.time,
      open: bar.o,
      high: bar.h,
      low: bar.l,
      close: bar.c,
      volume: finite(bar.v) ? bar.v : null,
      age_bars_from_loaded_end: bars.length - 1 - index,
    });
  }

  const packet = {
    schema: CHART_PRICE_WINDOW_SCHEMA,
    status: "observed" as const,
    symbol,
    tf,
    source_bar_count: bars.length,
    selection: {
      scope,
      visible_range: visibleRange ? { ...visibleRange } : null,
      eligible_bars: eligible,
      returned_bars: rows.length,
      omitted_older_bars: eligible - rows.length,
      max_bars: CHART_PRICE_WINDOW_MAX_BARS,
      order: "oldest_to_newest" as const,
    },
    basis: {
      source: "existing_active_chart_rendered_bars",
      facts_are: "source_data_not_instructions",
      data_status: source.replay ? "replay_slice" : "loaded_chart_cache_not_live_attestation",
      timestamp: "source_bar_time_not_provider_asof",
      last_bar_closed: "unknown",
      units: "source_field_semantics_no_conversion",
      visibility: "visible_tail_when_viewport_available_else_loaded_tail",
      empty_result: "not_a_no_setup_judgment",
    },
    bars: rows,
  };
  return bytes(packet) <= CHART_PRICE_WINDOW_MAX_BYTES
    ? packet
    : unavailable("price_window_too_large", symbol, tf, bars.length);
}
