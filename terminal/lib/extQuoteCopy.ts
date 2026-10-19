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
    label: pick(lang, "24-hour US sessions", "美股24小时交易时段"),
    coverageShort: pick(lang, "BOATS overnight · Observed live trades only; history and volume unavailable", "BOATS夜盘 · 仅当前观察的实时成交；历史及成交量暂不可用"),
    coverage: pick(lang, "BOATS overnight: observed live trades only; overnight history and volume are unavailable. Gaps stay empty. Available on intraday intervals up to 12 hours.", "BOATS夜盘仅显示当前观察到的实时成交；夜盘历史及成交量暂不可用，缺口保持空白。仅适用于不超过12小时的日内周期。"),
  };
}
