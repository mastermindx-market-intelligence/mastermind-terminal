import type { CandleMode, CandleState } from "@/lib/suites/trend/candlePainter";
import type { VisualBar } from "@/lib/visualIntelligence";
export type VisualLang = "en" | "zh";
const COPY = {
  empty: ["No chart data is available for this selection", "此选择没有可用的图表数据"],
  title: ["Chart context", "图表解读"],
  close: ["Close chart context", "关闭图表解读"],
  latest: ["Latest", "最新"],
  latestBar: ["Latest plotted bar", "最新已绘制K线"],
  selectedBar: ["Selected historical bar", "所选历史K线"],
  previous: ["Previous bar", "上一根K线"],
  next: ["Next bar", "下一根K线"],
  replay: ["Replay boundary", "回放边界"],
  loading: ["Waiting for chart data", "等待图表数据"],
  price: ["Underlying price bar", "原始价格K线"],
  priceBasis: ["Raw close versus open, not the candle's state color. Other chart styles may transform the display.", "比较原始收盘与开盘价，与K线状态配色不同。其他图表样式可能转换显示值。"],
  candles: ["Mastermind Candles", "Mastermind Candles"],
  classic: ["State coloring is off", "状态着色已关闭"],
  settings: ["Candle settings", "K线设置"],
  momentumBasis: ["RSI (14): up at 60+, down at 40 or below; 40-60 and falling is weakening.", "RSI (14)：60及以上为向上，40及以下为向下；40至60之间且下降表示动能走弱。"],
  trend: ["Trend context", "趋势背景"],
  trendBasis: ["EMA (20/50), with price above or below both. This is the chart timeframe, not a macro regime.", "EMA (20/50)与价格相对两条均线的位置。仅描述当前图表周期，不代表宏观环境。"],
  volume: ["Participation", "成交参与度"],
  volumeBasis: ["Share of up to 100 earlier usable bars with volume no greater than this bar (ties included). Not time-of-day relative volume.", "最多100根更早的有效K线中，成交量不高于当前K线的比例（含相等值）。非同时段相对成交量。"],
  volumeMissing: ["Volume unavailable or fewer than 20 usable prior bars", "成交量不可用，或前期有效样本少于20根"],
  samples: ["prior observations", "个前期样本"],
  range: ["Reference range", "参考区间"],
  rangeBasis: ["High and low of the 20 bars before the selected bar. A reference, not a support/resistance forecast.", "所选K线之前20根的最高价与最低价。仅供参考，非支撑阻力预测。"],
  rangeMissing: ["Needs 20 usable prior price bars", "需要前20根有效价格K线"],
  events: ["Company calendar", "公司日历"],
  eventsLoading: ["Loading event dates", "正在加载事件日期"],
  eventsMissing: ["Calendar unavailable", "日历不可用"],
  eventsEmpty: ["This artifact provides no event dates", "当前数据未提供事件日期"],
  eventsWithheld: ["Calendar withheld for historical inspection: no point-in-time event archive is supplied.", "历史查看中隐藏日历：未提供当时已知的事件存档。"],
  eventsBasis: ["Calendar from the available fundamentals artifact. Check its source date; historical and scheduled dates may change. E = earnings, D = ex-dividend, S = split.", "来自现有基本面数据的日历，请查看来源日期；历史与计划日期均可能变更。E＝财报，D＝除息，S＝拆股。"],
  earnings: ["Earnings", "财报"], dividend: ["Ex-dividend", "除息"], split: ["Stock split", "拆股"],
  scheduled: ["Scheduled; subject to change", "计划日期，可能变更"],
  asof: ["Source as of", "来源日期"], unknown: ["Not stated", "未提供"],
  layers: ["Optional chart layers", "可选图表图层"],
  regimeToggle: ["Recent trend tint", "近期趋势底色"],
  volumeToggle: ["Volume intensity", "成交量浓淡"],
  levelsToggle: ["Prior-range levels", "前期区间价位"],
  eventsToggle: ["Event marks", "事件标记"],
  layerHint: ["Overlays favor recent visible history. Volume intensity needs the existing Volume study.", "图层优先显示近期可见历史。成交量浓淡需要启用现有成交量指标。"],
  hide: ["Hide chart context", "隐藏图表解读"],
  restore: ["Show chart context", "显示图表解读"],
  disclaimer: ["Descriptive context, not a forecast or trade instruction. The newest bar may still be forming; data corrections can change history.", "仅描述市场背景，非预测或交易指令。最新K线可能尚未完成，数据修正可改变历史。"],
  movementHint: ["Move the crosshair or use the bar controls to inspect history.", "移动十字光标或使用K线控件查看历史。"],
  quoteSource: ["Quote source", "报价来源"],
  liveQuote: ["Live quote, not a final-bar guarantee", "实时报价，不代表K线已完成"],
  delayedQuote: ["15-minute delayed quote", "延迟15分钟报价"],
  eodQuote: ["End-of-day quote", "日终报价"],
  useful: ["This explanation helped", "这份解读有帮助"],
  unclear: ["This is unclear", "这份解读不清晰"],
  thanks: ["Thank you for the feedback", "感谢你的反馈"],
} as const;
export type VisualCopyKey = keyof typeof COPY;
export function visualText(key: VisualCopyKey, lang: VisualLang): string { return COPY[key][lang === "zh" ? 1 : 0]; }
const STATES: Record<CandleState, readonly [string, string]> = {
  up: ["Upward", "向上"], down: ["Downward", "向下"], weakening: ["Momentum weakening", "动能走弱"],
  neutral: ["Mixed / transitional", "混合或过渡"], warming: ["Not enough history", "历史不足"], missing: ["Price unavailable", "价格不可用"],
};
export function candleStateText(state: CandleState, lang: VisualLang) { return STATES[state][lang === "zh" ? 1 : 0]; }
const MODES: Record<CandleMode, readonly [string, string]> = {
  momentum: ["Momentum", "动能"], trend: ["Trend", "趋势"],
  momentumVolume: ["Momentum + Volume", "动能 + 成交量"], trendVolume: ["Trend + Volume", "趋势 + 成交量"],
};
export function candleModeText(mode: CandleMode, lang: VisualLang) { return MODES[mode][lang === "zh" ? 1 : 0]; }
export function visualSynthesis(fact: VisualBar, lang: VisualLang): string {
  const l = (en: string, zh: string) => lang === "zh" ? zh : en;
  if (fact.state === "missing" || fact.state === "warming") return candleStateText(fact.state, lang);
  if (fact.trend === "warming") return l("Momentum is available; trend still needs more history.", "动能可用；趋势仍需更多历史。");
  if (fact.trend === "up" && fact.momentum === "up") return l("Trend and momentum align upward.", "趋势与动能一致向上。");
  if (fact.trend === "down" && fact.momentum === "down") return l("Trend and momentum align downward.", "趋势与动能一致向下。");
  if (fact.trend === "up" && (fact.momentum === "weakening" || fact.momentum === "down")) return l("Trend is upward, but momentum is weakening or downward.", "趋势向上，但动能走弱或向下。");
  if (fact.trend === "down" && fact.momentum === "up") return l("Momentum is upward inside a downward trend.", "下行趋势中的动能向上。");
  return l("Trend and momentum are mixed or transitional.", "趋势与动能处于混合或过渡状态。");
}
