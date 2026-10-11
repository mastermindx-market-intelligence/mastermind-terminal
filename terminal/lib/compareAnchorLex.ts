"use client";
import { useCallback } from "react";
import { useLang, useT } from "./i18n";

/** Feature-local EN/ZH copy for the comparison anchor readout (E08). Language state remains the
 *  shared LangProvider; keeping the copy here leaves the global lexicon and every screen whose
 *  evidence depends on it untouched. `{name}` placeholders are filled by `fillCopy`. */
export const COMPARE_ANCHOR_LEX: Record<string, [string, string]> = {
  cmpaTitle: ["Comparison anchor", "比较锚点"],
  cmpaDetails: ["Anchor & basis", "锚点与口径"],
  cmpaHide: ["Hide", "收起"],
  cmpaRegion: ["Comparison anchor and basis", "比较锚点与口径"],
  cmpaPolicyGroup: ["Anchor policy", "锚点规则"],
  cmpaAuto: ["Auto", "自动"],
  cmpaAutoSummary: ["Auto · each line starts at its first session in common with {host}", "自动 · 每条线从与 {host} 的首个共同交易日开始"],
  cmpaPinnedSummary: ["Pinned {date}", "已固定 {date}"],
  cmpaPinnedWindowSummary: ["Pinned {date} · window start when pinned", "已固定 {date} · 固定时的可见起点"],
  cmpaMixedSummary: ["Mixed anchors · lines are not rebased at one date", "锚点不一致 · 各线未在同一日期定基"],
  cmpaPinAll: ["Pin all to {date}", "全部固定于 {date}"],
  cmpaDateLabel: ["Anchor date", "锚定日期"],
  cmpaPin: ["Pin date", "固定日期"],
  cmpaPinWindow: ["Pin visible start", "固定为可见起点"],
  cmpaPinWindowHint: ["Pins the first visible session once. Scrolling or zooming later does not move it.", "仅记录一次当前首个可见交易日，之后滚动或缩放不会移动锚点。"],
  cmpaInvalidDate: ["Enter a valid date", "请输入有效日期"],
  cmpaNoWindow: ["The visible range is not available yet", "可见范围暂不可用"],
  cmpaHost: ["Base {host}", "基准 {host}"],
  cmpaAnchorAt: ["Anchor {date}", "锚点 {date}"],
  cmpaRuleExact: ["exact session", "精确交易日"],
  cmpaRuleNext: ["next session after {date}", "{date} 之后的下一交易日"],
  cmpaRuleFirstCommon: ["first common session (auto)", "首个共同交易日（自动）"],
  cmpaLegPrior: ["uses its {date} close · market closed on the anchor", "采用 {date} 收盘价 · 锚定日休市"],
  cmpaRawScale: ["Raw price on its own scale · not rebased", "原始价格独立坐标 · 未重新定基"],
  cmpaBasis_price: ["Price return", "价格收益"],
  cmpaBasis_adjusted: ["Adjusted close · dividend treatment not uniform", "复权收盘价 · 股息处理不统一"],
  cmpaBasis_level: ["Level, not a return", "水平值，非收益"],
  cmpaBasis_unknown: ["Return basis unknown", "收益口径未知"],
  cmpaBasisShort_price: ["Price return", "价格收益"],
  cmpaBasisShort_adjusted: ["Adj. close", "复权收盘"],
  cmpaBasisShort_level: ["Level", "水平值"],
  cmpaBasisShort_unknown: ["Basis unknown", "口径未知"],
  cmpaChipRaw: ["raw scale", "原始价格"],
  cmpaChipNotDrawn: ["not drawn", "未绘制"],
  cmpaModePrice: ["Price", "价格"],
  cmpaModePercent: ["Rebased", "定基"],
  cmpaCcyUnknown: ["currency not established", "币种未确认"],
  cmpaSrcUnknown: ["source not declared", "来源未声明"],
  cmpaSince: ["since {date}", "自 {date} 起"],
  cmpaThrough: ["through {date}", "截至 {date}"],
  cmpaSpread: ["Spread {v} pp", "差值 {v} 个百分点"],
  cmpaSpreadCaveat: ["Spread {v} pp · both adjusted closes, not like-for-like", "差值 {v} 个百分点 · 均为复权收盘价，非同口径"],
  cmpaNoSpread_currency_unknown: ["No outperformance shown · currency not established", "不显示超额表现 · 币种未确认"],
  cmpaNoSpread_currency_mismatch: ["No outperformance shown · {a} vs {b}, no converted basis", "不显示超额表现 · {a} 与 {b} 币种不同，无换算口径"],
  cmpaNoSpread_basis_unknown: ["No outperformance shown · return basis unknown", "不显示超额表现 · 收益口径未知"],
  cmpaNoSpread_basis_level: ["No outperformance shown · a level is not a return", "不显示超额表现 · 水平值不是收益"],
  cmpaNoSpread_basis_mismatch: ["No outperformance shown · return bases differ", "不显示超额表现 · 收益口径不同"],
  cmpaMark_currency_mismatch: ["not like-for-like · {ccy}", "不可直接比较 · {ccy}"],
  cmpaMark_currency_unknown: ["not like-for-like · currency unknown", "不可直接比较 · 币种未确认"],
  cmpaMark_basis_level: ["not like-for-like · a level", "不可直接比较 · 水平值"],
  cmpaMark_basis_unknown: ["not like-for-like · basis unknown", "不可直接比较 · 口径未知"],
  cmpaMark_basis_mismatch: ["not like-for-like · bases differ", "不可直接比较 · 口径不同"],
  cmpaMark_basis_adjusted: ["caveat · both adj. close", "注意 · 均为复权收盘"],
  cmpaLook_incomparable: ["Line drawn long-dashed and dimmed: not like-for-like with {host}", "线条以长虚线淡化显示：与 {host} 不可直接比较"],
  cmpaLook_caveat: ["Line drawn sparse-dotted: both adjusted closes", "线条以稀疏点线显示：均为复权收盘价"],
  cmpaUnmatched: ["{n} sessions left blank · no observation", "{n} 个交易日留空 · 无观测值"],
  cmpaInputRev: ["{n} bars through {date}", "{n} 根K线，截至 {date}"],
  cmpaW_no_overlap: ["Not drawn · no session in common", "未绘制 · 无共同交易日"],
  cmpaW_anchor_after_host_end: ["Not drawn · the anchor is after the last bar shown", "未绘制 · 锚点晚于当前最后一根K线"],
  cmpaW_anchor_before_host_history: ["Not drawn · the anchor precedes {host}'s history", "未绘制 · 锚点早于 {host} 的历史"],
  cmpaW_anchor_gap_too_wide: ["Not drawn · no {host} session near the anchor", "未绘制 · 锚点附近无 {host} 交易日"],
  cmpaW_anchor_before_leg_history: ["Not drawn · the anchor precedes this history (first bar {date})", "未绘制 · 锚点早于该品种历史（首根K线 {date}）"],
  cmpaW_anchor_no_observation: ["Not drawn · no observation at the anchor", "未绘制 · 锚点处无观测值"],
  cmpaW_bad_close: ["Not drawn · invalid close at the anchor", "未绘制 · 锚点处收盘价无效"],
  cmpaAbsent: ["Not drawn · no price history published", "未绘制 · 无已发布价格历史"],
  cmpaUnavailable: ["Not drawn · price history could not be loaded", "未绘制 · 价格历史加载失败"],
  cmpaComputing: ["Computing comparison…", "正在计算比较…"],
  cmpaDailyOnly: ["Comparison lines are drawn on daily and longer timeframes.", "比较线仅在日线及更长周期绘制。"],
  cmpaPercentAxis: ["The % axis counts from the first visible bar, not from the anchor.", "百分比坐标从首个可见K线起算，而非锚点。"],
  cmpaFootnote: ["Lines are rebased to {host}'s close at the anchor. Sessions without an observation are left blank, never filled.", "比较线按锚点处 {host} 的收盘价重新定基。无观测值的交易日留空，绝不填补。"],
};

/** Fill `{name}` placeholders. Unknown names are left visible rather than silently dropped. */
export function fillCopy(text: string, vars: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

export function useCompareT() {
  const { lang } = useLang();
  const sharedT = useT();
  return useCallback((key: string, vars?: Record<string, string | number>): string => {
    const pair = COMPARE_ANCHOR_LEX[key];
    const text = pair ? pair[lang === "zh" ? 1 : 0] : sharedT(key);
    return vars ? fillCopy(text, vars) : text;
  }, [lang, sharedT]);
}
