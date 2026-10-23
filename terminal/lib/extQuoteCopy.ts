/** BOATS display copy uses the shared language state and the existing feature-copy pattern. */
import type { Lang } from "@/lib/i18n";

const pick = (lang: Lang, en: string, zh: string): string =>
  lang === "zh" ? zh : en;

export function boatsLatestTradeLabel(lang: Lang): string {
  return pick(lang, "Latest qualifying BOATS trade · single venue", "BOATS 最新合格成交 · 单一场所");
}


/** Chart-only copy shares the feature module without changing unrelated settings copy. */
export function boatsChartCopy(lang: Lang) {
  return {
    label: pick(lang, "24-hour US", "美股24小时"),
    coverageShort: pick(lang, "BOATS overnight · Observed live trades only; history and volume unavailable", "BOATS夜盘 · 仅当前观察的实时成交；历史及成交量暂不可用"),
    coverage: pick(lang, "Include BOATS overnight trades and available historical bars. BOATS volume covers this venue only; live trade observations have no volume. Gaps stay empty. Available on intraday intervals up to 12 hours.", "显示BOATS夜盘成交及可用的历史K线。历史成交量仅涵盖该场所，实时观察成交无成交量数据。缺口保持空白。仅适用于不超过12小时的日内周期。"),
  };
}

export type BoatsChartHistory = { symbol: string; timeframe: string; bars: number };

/** Only the current accepted response can describe this pane's overnight history. */
export function boatsChartHistoryBars(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  const v = value as Record<string, unknown>;
  return v.schema === "terminal.tiingo_boats_history_evidence.v1" && v.status === "available"
    && v.source === "tiingo-boats-rest" && v.venue === "BOATS" && v.complete === false
    && v.volume_basis === "vendor_reported_shares" && Number.isInteger(v.returned_bars)
    && (v.returned_bars as number) > 0 && (v.returned_bars as number) <= 20000
    ? v.returned_bars as number : 0;
}

export function boatsChartCoverage(lang: Lang, symbol: string, timeframe: string, history: BoatsChartHistory | null): string {
  if (history?.symbol === symbol && history.timeframe === timeframe && history.bars > 0) {
    return pick(lang, "BOATS overnight · Captured history available; venue-only volume. Gaps remain.",
      "BOATS夜盘 · 已载入历史K线；成交量仅限该场所，缺口保留。");
  }
  return boatsChartCopy(lang).coverageShort;
}
