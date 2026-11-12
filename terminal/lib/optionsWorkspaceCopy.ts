import type { Lang } from "./i18n";

export function optionsWorkspaceCopy(lang: Lang) {
  const pick = (en: string, zh: string) => lang === "zh" ? zh : en;
  return {
    browseCategories: pick("Swipe to browse more categories", "左右滑动查看更多类别"),
    statisticsEyebrow: pick("Options statistics", "期权统计"),
    statisticsTitle: pick("Trading composition", "交易构成"),
    statisticsDescription: pick("Observed prints. Explicit coverage.", "逐笔观测 · 覆盖范围明确"),
    statisticsLoading: pick("Reading observed snapshot…", "正在读取观测快照…"),
    statisticsUnavailable: pick("The latest snapshot is currently unavailable.", "最新快照暂时无法获取。"),
    statisticsSummary: pick("Observed trading · partial coverage · no synthetic values", "已观测交易 · 部分覆盖 · 不使用合成数值"),
  };
}
