/**
 * Feature-local EN/ZH copy for the chart command palette (E20).
 *
 * Kept out of the global LEX in lib/i18n.tsx on purpose: that file is pinned by many screen
 * evidence packets, and the palette's words are only needed once the palette opens. Language
 * state still comes from the shared LangProvider — this module only holds the string pairs and a
 * pure lookup, so the action catalog that uses it stays testable without React.
 */
import type { FinPage } from "@/components/fin/finPages";

export type PaletteLang = "en" | "zh";

export const COMMAND_PALETTE_LEX: Record<string, [string, string]> = {
  cpTitle: ["Actions", "操作"],
  cpTrigger: ["Actions", "操作"],
  cpTriggerName: ["Chart actions", "图表操作"],
  cpTriggerTip: ["Search chart actions (press >)", "搜索图表操作（按 > 键）"],
  cpSearchLabel: ["Search actions", "搜索操作"],
  cpSearchPlaceholder: ["Search actions…", "搜索操作…"],
  cpActionsList: ["Available actions", "可用操作"],
  cpClose: ["Close", "关闭"],
  cpActingOn: ["Acting on {target}", "当前对象：{target}"],
  cpKeyHint: ["↑ ↓ to move · Enter to run · Esc to close", "↑ ↓ 选择 · 回车执行 · Esc 关闭"],
  cpNoMatches: ["No actions match “{q}”", "没有与“{q}”匹配的操作"],

  // Targets — every action names what it will change before it runs.
  cpTargetChart: ["Chart {n} · {sym}", "图表 {n} · {sym}"],
  cpTargetChartOf: ["Chart {n} of {count} · {sym}", "图表 {n}/{count} · {sym}"],
  cpTargetChartTf: ["{chart} · {tf}", "{chart} · {tf}"],
  cpTargetResearch: ["{sym} research · {page}", "{sym} 研究 · {page}"],
  cpTargetFor: ["For {sym}", "针对 {sym}"],
  cpTargetForAnalysis: ["For {sym} · opens the Analysis page", "针对 {sym} · 打开分析页"],
  cpTargetAllCharts: ["All charts", "所有图表"],
  cpTargetAllChartsUndo: ["All charts · undo for 5 seconds", "所有图表 · 5 秒内可撤销"],
  cpTargetDrawings: ["Drawings on {sym}", "{sym} 的绘图"],
  cpTargetSwap: ["Chart {n}: {from} → {to}", "图表 {n}：{from} → {to}"],
  cpTargetFocus: ["Moves to Chart {n} · {sym}, already open", "切换到已打开的图表 {n} · {sym}"],

  // Groups
  cpGroupResearch: ["Research", "研究"],
  cpGroupChart: ["Chart", "图表"],
  cpGroupStudies: ["Studies", "指标"],
  cpGroupDrawings: ["Drawings", "绘图"],
  cpGroupWatchlist: ["Watchlist", "自选"],

  // Actions
  cpOpenPage: ["Open {page}", "打开{page}"],
  cpBackToChart: ["Back to chart", "返回图表"],
  cpNextSymbol: ["Next symbol in watchlist", "自选列表下一个标的"],
  cpPrevSymbol: ["Previous symbol in watchlist", "自选列表上一个标的"],
  cpTimeframe: ["Timeframe {tf}", "周期 {tf}"],
  cpApplyTemplate: ["Apply study template “{name}”", "应用指标模板“{name}”"],
  cpApplyTemplateNone: ["Apply a study template", "应用指标模板"],
  cpSaveTemplate: ["Save current studies as a template…", "将当前指标保存为模板…"],
  cpOpenIndicators: ["Add or edit studies…", "添加或编辑指标…"],
  cpRemoveIndicators: ["Remove all studies", "移除全部指标"],
  cpDrawUndo: ["Undo drawing change", "撤销绘图更改"],
  cpDrawRedo: ["Redo drawing change", "重做绘图更改"],
  cpReplayStart: ["Start Bar Replay", "开始K线回放"],
  cpReplayExit: ["Exit Bar Replay", "退出K线回放"],
  cpGotoDate: ["Go to date…", "跳转到日期…"],

  // Why an action is unavailable — shown on the row, never a silent no-op.
  cpWhyAlreadyOpen: ["Already showing", "当前已显示"],
  cpWhyChartShowing: ["The chart is already showing", "图表已在显示"],
  cpWhyNoOtherSymbol: ["Your watchlist has no other symbol", "自选列表中没有其他标的"],
  cpWhyCurrentTf: ["Already the current timeframe", "已是当前周期"],
  cpWhyNoTemplates: ["No saved study templates yet. Save your current studies first.", "尚无已保存的指标模板，请先保存当前指标。"],
  cpWhyNoStudies: ["No studies on the charts", "图表上没有指标"],
  cpWhyNothingToUndo: ["No drawing change to undo", "没有可撤销的绘图更改"],
  cpWhyNothingToRedo: ["No drawing change to redo", "没有可重做的绘图更改"],
  cpWhyReplayMulti: ["Bar Replay works on one chart. Switch the layout to a single chart first.", "K线回放仅支持单图表，请先切换为单图布局。"],
  cpWhyReplayNoData: ["This chart has no history to replay yet", "该图表尚无可回放的历史数据"],
  cpWhyGotoPhone: ["Go to date isn't on phone layouts. Swipe the chart to move through time.", "手机布局不提供跳转到日期，请滑动图表浏览历史。"],
  cpWhyGotoResearch: ["Return to the chart first", "请先返回图表"],
  cpWhyGotoTable: ["Close the table view first", "请先关闭表格视图"],

  // Feedback after an attempt that did not run
  cpStale: ["The chart changed to {target}. Press Enter or tap again to run “{action}” there.", "图表已切换为 {target}。再次按回车或点按，即在此执行“{action}”。"],
  cpStaleNoAction: ["The chart changed to {target}. Check the actions below before running one.", "图表已切换为 {target}。请先确认下方操作再执行。"],
  cpUnavailable: ["Not available: {why}", "不可用：{why}"],
  cpGone: ["That action is no longer offered for this chart", "此图表已不再提供该操作"],
  cpUnavailableTag: ["Unavailable", "不可用"],
};

/** Research page names exactly as the research navigation shows them, plus the pane-title alias
 *  (e.g. "Results" in the nav is titled "Earnings" in the pane) so either word finds the page. */
export const PALETTE_PAGE_TEXT: Record<FinPage, { label: [string, string]; alias: [string, string] }> = {
  overview: { label: ["Overview", "概览"], alias: ["Summary", "概况"] },
  intelligence: { label: ["Intelligence", "公司情报"], alias: ["Company intelligence", "情报"] },
  statements: { label: ["Statements", "报表"], alias: ["Financial statements", "财务报表"] },
  statistics: { label: ["Statistics", "统计"], alias: ["Key statistics", "关键统计"] },
  revenue: { label: ["Revenue", "营收"], alias: ["Revenue breakdown", "收入"] },
  dividends: { label: ["Dividends", "股息"], alias: ["Dividend history", "分红"] },
  earnings: { label: ["Results", "结果"], alias: ["Earnings", "盈利"] },
  forecast: { label: ["Analyst", "分析师"], alias: ["Forecast", "预测"] },
  transcripts: { label: ["Transcripts", "电话会"], alias: ["Earnings calls", "业绩会"] },
  technicals: { label: ["Technicals", "技术面"], alias: ["Technical analysis", "技术分析"] },
  seasonals: { label: ["Seasonality", "季节性"], alias: ["Seasonal", "季节"] },
  ownership: { label: ["Institutional", "机构"], alias: ["Ownership", "持仓"] },
  insider: { label: ["Insider", "内部交易"], alias: ["Insider trading", "内部人"] },
  lab: { label: ["Lab", "实验室"], alias: ["Research lab", "研究实验室"] },
};

/** Look up one pair and fill `{name}` placeholders. Unknown keys return the key itself so a
 *  missing string is visible in review rather than rendering blank. */
export function paletteText(lang: PaletteLang, key: string, vars?: Record<string, string | number>): string {
  const pair = COMMAND_PALETTE_LEX[key];
  let text = pair ? pair[lang === "zh" ? 1 : 0] : key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) text = text.split(`{${name}}`).join(String(value));
  }
  return text;
}

export function palettePageLabel(lang: PaletteLang, page: FinPage): string {
  return PALETTE_PAGE_TEXT[page].label[lang === "zh" ? 1 : 0];
}
