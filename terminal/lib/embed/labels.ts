/**
 * labels.ts — the embed widget's own tiny bilingual label map.
 *
 * The Terminal's lib/i18n.tsx is a full React context provider (LangProvider reads localStorage +
 * the <html data-lang> attribute and re-renders on a window event). The embed sets its language
 * from a query param and never toggles it at runtime, so pulling in that context would add weight
 * and behaviour we don't want. A frozen local map keeps the widget lean — the brief sanctions this.
 */

import type { Lang } from "./chartData";

type Pair = readonly [en: string, zh: string];

const LABELS = {
  sma: ["SMA", "SMA"],
  volume: ["Vol", "成交量"],
  // Crosshair OHLC readout letters — universal single-letter chart vocabulary.
  o: ["O", "开"],
  h: ["H", "高"],
  l: ["L", "低"],
  c: ["C", "收"],
  attribution: ["Mastermind Terminal", "Mastermind Terminal"],
  // Empty state: no bars for a validly-formed symbol.
  emptyTitle: ["No chart data yet", "暂无图表数据"],
  emptyBody: ["We don’t have daily price history for {sym} yet.", "我们暂时没有 {sym} 的日线价格数据。"],
  // Loading and unavailable data are separate from confirmed absence and symbol validation.
  loading: ["Loading daily chart for {sym}.", "正在加载 {sym} 的日线图表。"],
  loaded: ["Daily chart loaded for {sym}. Latest daily bar: {date}.", "{sym} 的日线图表已加载。最新日线：{date}。"],
  unavailableTitle: ["Daily chart unavailable", "日线图表暂不可用"],
  unavailableBody: ["Daily price history for {sym} could not be loaded. Please try again later.", "暂时无法加载 {sym} 的日线价格数据，请稍后再试。"],
  latestDailyBar: ["Latest daily bar: ", "最新日线："],
  dailyBar: ["Daily bar: ", "日线日期："],
  // Error state: the symbol param was missing or malformed.
  errorTitle: ["Enter a valid symbol", "请输入有效代码"],
  errorBody: ["Add ?symbol=AAPL to load a chart.", "在网址后加上 ?symbol=AAPL 以加载图表。"],
  openTerminal: ["Open in Terminal", "在终端打开"],
  toggleSma50: ["Toggle the 50-day moving average", "切换50日移动平均线"],
  toggleSma200: ["Toggle the 200-day moving average", "切换200日移动平均线"],
  rangePrefix: ["Show range", "显示区间"],
  // ?fs=1 — the native host's "open the full chart" affordance at the end of the range row.
  fullscreen: ["Open full chart", "打开完整图表"],
} satisfies Record<string, Pair>;

export type LabelKey = keyof typeof LABELS;

/** t — resolve a label for the active language, with optional {sym}-style interpolation. */
export function makeT(lang: Lang) {
  const idx = lang === "zh" ? 1 : 0;
  return (key: LabelKey, vars?: Record<string, string>): string => {
    let s = LABELS[key][idx];
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, v);
    return s;
  };
}
