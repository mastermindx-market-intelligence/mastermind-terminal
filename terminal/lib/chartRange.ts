export const TERMINAL_CHART_RANGE_EVENT = "mm:chart-range";

export type TerminalChartRangeDetail = {
  sym: string;
  paneId: number;
  from: number;
  to: number;
};

export type ChartAxisRange = {
  from: string | number;
  to: string | number;
};

const SANE_MIN = 631152000; // 1990-01-01T00:00:00Z
const SANE_MAX = 4102444800; // 2100-01-01T00:00:00Z

function saneEpochSecond(value: unknown): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= SANE_MIN
    && value <= SANE_MAX;
}

export function isTerminalChartRangeDetail(value: unknown): value is TerminalChartRangeDetail {
  if (!value || typeof value !== "object") return false;
  const detail = value as Partial<TerminalChartRangeDetail>;
  return typeof detail.sym === "string"
    && detail.sym.trim().length > 0
    && Number.isInteger(detail.paneId)
    && (detail.paneId as number) >= 0
    && saneEpochSecond(detail.from)
    && saneEpochSecond(detail.to)
    && detail.from < detail.to;
}

function utcDate(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

/**
 * Translate the Chart Bus epoch-second contract to the time type owned by the
 * current chart. Intraday charts use epoch seconds; daily-derived charts use
 * Lightweight Charts' business-day strings.
 */
export function chartAxisRange(
  detail: TerminalChartRangeDetail,
  intraday: boolean,
): ChartAxisRange | null {
  if (!isTerminalChartRangeDetail(detail)) return null;
  if (intraday) return { from: detail.from, to: detail.to };
  return { from: utcDate(detail.from), to: utcDate(detail.to) };
}

export function dispatchTerminalChartRange(detail: TerminalChartRangeDetail): boolean {
  if (typeof window === "undefined" || !isTerminalChartRangeDetail(detail)) return false;
  try {
    window.dispatchEvent(new CustomEvent<TerminalChartRangeDetail>(
      TERMINAL_CHART_RANGE_EVENT,
      { detail },
    ));
    return true;
  } catch {
    return false;
  }
}
