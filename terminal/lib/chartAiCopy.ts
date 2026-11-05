// Copy owned by the chart AI inventory and persistence affordance.
// Uses the existing locale context; shared drawing-tool copy remains in i18n.
import { pick } from "./finFormat";

export const CHART_AI_COPY = (zh: boolean) => ({
  aiDrawing: pick(zh, "Drawing", "图形"),
  aiScenario: pick(zh, "Trade scenario", "交易情景"),
  aiDrawingCount: pick(zh, "{drawings} · {elements}", "{drawings} · {elements}"),
  aiElementCountOne: pick(zh, "{n} element", "{n} 个元素"),
  aiElementCountMany: pick(zh, "{n} elements", "{n} 个元素"),
  aiDrawingList: pick(zh, "AI drawings", "AI 图形列表"),
  aiClearAll: pick(zh, "Clear all", "全部清除"),
  aiLayerHidden: pick(zh, "AI layer is hidden", "AI 图层已隐藏"),
  aiShowAll: pick(zh, "Show layer", "显示图层"),
  aiLayerEmpty: pick(zh, "Ask Mastermind to analyze this chart. Its drawings will appear here.", "请 Mastermind 分析此图表。绘制的图形将显示在这里。"),
  aiDrawingsLoading: pick(zh, "Loading saved drawings…", "正在加载已保存的图形…"),
  aiDrawingsUnavailable: pick(zh, "AI drawing changes are unavailable for this chart.", "此图表暂时无法更改 AI 图形。"),
  aiPersistenceUnavailable: pick(zh, "AI drawings cannot be saved yet. Your local copy is retained.", "AI 图形暂时无法保存。您的本地副本已保留。"),
  aiElements: pick(zh, "elements", "个元素"),
  aiPartlyHidden: pick(zh, "partly hidden", "部分隐藏"),
  aiExpandElements: pick(zh, "Show individual elements", "展开图形元素"),
  aiCollapseElements: pick(zh, "Collapse elements", "收起图形元素"),
  aiShowDrawing: pick(zh, "Show drawing", "显示图形"),
  aiHideDrawing: pick(zh, "Hide drawing", "隐藏图形"),
  aiRemoveDrawing: pick(zh, "Delete drawing", "删除图形"),
  aiShowElement: pick(zh, "Show element", "显示元素"),
  aiHideElement: pick(zh, "Hide element", "隐藏元素"),
  aiRemoveElement: pick(zh, "Delete element", "删除元素"),
} as const);

export function chartAiCopy(lang: "en" | "zh") {
  const copy = CHART_AI_COPY(lang === "zh");
  return (key: keyof typeof copy): string => copy[key];
}
