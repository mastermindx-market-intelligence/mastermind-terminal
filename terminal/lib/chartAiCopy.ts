// Copy owned by the chart AI inventory and persistence affordance.
// Uses the existing locale context; shared drawing-tool copy remains in i18n.
export const CHART_AI_COPY = {
  aiDrawing: ["Drawing", "图形"],
  aiScenario: ["Trade scenario", "交易情景"],
  aiDrawingCount: ["{drawings} · {elements}", "{drawings} · {elements}"],
  aiElementCountOne: ["{n} element", "{n} 个元素"],
  aiElementCountMany: ["{n} elements", "{n} 个元素"],
  aiDrawingList: ["AI drawings", "AI 图形列表"],
  aiClearAll: ["Clear all", "全部清除"],
  aiLayerHidden: ["AI layer is hidden", "AI 图层已隐藏"],
  aiShowAll: ["Show layer", "显示图层"],
  aiLayerEmpty: ["Ask Mastermind to analyze this chart. Its drawings will appear here.", "请 Mastermind 分析此图表。绘制的图形将显示在这里。"],
  aiDrawingsLoading: ["Loading saved drawings…", "正在加载已保存的图形…"],
  aiDrawingsUnavailable: ["AI drawing changes are unavailable for this chart.", "此图表暂时无法更改 AI 图形。"],
  aiPersistenceUnavailable: ["AI drawings cannot be saved yet. Your local copy is retained.", "AI 图形暂时无法保存。您的本地副本已保留。"],
  aiElements: ["elements", "个元素"],
  aiPartlyHidden: ["partly hidden", "部分隐藏"],
  aiExpandElements: ["Show individual elements", "展开图形元素"],
  aiCollapseElements: ["Collapse elements", "收起图形元素"],
  aiShowDrawing: ["Show drawing", "显示图形"],
  aiHideDrawing: ["Hide drawing", "隐藏图形"],
  aiRemoveDrawing: ["Delete drawing", "删除图形"],
  aiShowElement: ["Show element", "显示元素"],
  aiHideElement: ["Hide element", "隐藏元素"],
  aiRemoveElement: ["Delete element", "删除元素"],
} as const;

export function chartAiCopy(lang: "en" | "zh") {
  return (key: keyof typeof CHART_AI_COPY): string => CHART_AI_COPY[key][lang === "zh" ? 1 : 0];
}
