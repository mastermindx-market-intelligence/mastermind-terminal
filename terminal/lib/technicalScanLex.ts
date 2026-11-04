"use client";
import { useCallback } from "react";
import { useLang, useT } from "./i18n";
import { verdictLabel } from "./plainLabels";

/** Feature-local EN/ZH tuples for the Screener's technical screen (E01). Language state stays the
 * shared LangProvider; keeping this copy out of the global LEX leaves every other route's bundle
 * and screen evidence unchanged (the lib/sectorIntelligenceLex.ts pattern). */
export const TECHNICAL_SCAN_LEX: Record<string, [string, string]> = {
  tsToggle: ["Technical screen", "技术筛选"],
  tsTimeframe: ["Scan timeframe", "扫描周期"],
  tsNotScanned: ["not scanned", "未扫描"],
  tsAny: ["Any", "不限"],
  tsPosition: ["Position", "持仓状态"],
  tsLong: ["Long", "做多"],
  tsFlat: ["Flat", "空仓"],
  tsLastSignal: ["Last signal", "最近信号"],
  tsBuySide: ["Any buy", "任一买入"],
  tsBottomWatch: ["Bottom watch", "底部观察"],
  tsBarsSince: ["Bars since signal", "信号后K线数"],
  tsBarsMax: ["≤ {n} bars", "≤ {n} 根K线"],
  tsStrongBull: ["Strong bull", "强势多头"],
  tsWeeklyBull: ["Weekly bull", "周线多头"],
  tsAbove200: ["Above 200-day", "位于200日线上方"],
  tsNotOverbought: ["Not overbought", "未超买"],
  tsBarClosed: ["Completed bar only", "仅已完成K线"],
  tsIncludeUnknown: ["Include not evaluated", "包含未评估"],
  tsClear: ["Clear technical", "清除技术条件"],
  tsLoading: ["Reading the technical scan…", "正在读取技术扫描…"],
  tsAbsent: ["No technical scan is published yet. Technical filters are unavailable; nothing is inferred in the browser.", "尚未发布技术扫描，技术筛选不可用；浏览器不做任何推算。"],
  tsError: ["The technical scan could not be read. Technical filters are unavailable; nothing is inferred in the browser.", "无法读取技术扫描，技术筛选不可用；浏览器不做任何推算。"],
  tsRetry: ["Retry", "重试"],
  tsCoverage: ["Technical coverage at {tf}", "{tf} 技术覆盖"],
  tsRequested: ["{n} requested", "请求 {n} 个"],
  tsEvaluated: ["evaluated", "已评估"],
  tsStale: ["stale", "过期"],
  tsUnsupported: ["unsupported", "不支持"],
  tsUnavailable: ["unavailable", "不可用"],
  tsReasons: ["Why names were not evaluated", "未评估原因"],
  tsNoReasons: ["Every requested name was evaluated.", "所有请求的标的均已评估。"],
  tsGeneration: ["Scan generated {d}", "扫描生成于 {d}"],
  tsComplete: ["complete generation", "完整批次"],
  tsIncomplete: ["incomplete generation · not full coverage", "批次不完整 · 非全量覆盖"],
  tsHeldComplete: ["A newer incomplete scan was not adopted; showing the last complete generation.", "较新的不完整扫描未被采用；显示上一完整批次。"],
  tsRefreshFailed: ["Refresh failed · showing the last scan read", "刷新失败 · 显示上次读取的扫描"],
  tsForming: ["{n} on a forming bar", "{n} 个处于未完成K线"],
  tsTfNotProduced: ["This scan has no {tf} results, so every name is unsupported at {tf}. Nothing is inferred in the browser.", "本次扫描未生成 {tf} 结果，所有标的在 {tf} 下均不支持。浏览器不做任何推算。"],
  tsHandoverExact: ["Rows open the chart at {tf}", "点击行将以 {tf} 打开图表"],
  tsHandoverUnsupported: ["The chart cannot promise {tf} for every market; rows open without a timeframe", "图表无法保证所有市场支持 {tf}；点击行将不带周期打开"],
  tsPresetNote: ["Saved presets keep the filters above, not the technical screen", "已保存的预设仅包含上方筛选，不含技术筛选"],
  tsHiddenUnknown: ["{n} hidden · not evaluated at {tf}", "{n} 个已隐藏 · 未在 {tf} 评估"],
  tsColumn: ["Technical · {tf}", "技术 · {tf}"],
  tsBars: ["{n} bars", "{n} 根"],
  tsFormingCell: ["forming", "未完成"],
  tsStaleTitle: ["Stale: {reason} · bar of {d}", "过期：{reason} · K线 {d}"],
  tsBarTitle: ["Bar of {d}", "K线 {d}"],
  tsEmptyWhy: ["No name evaluated at {tf} passes the technical screen. {u} of the requested names were not evaluated at {tf}.", "在 {tf} 已评估的标的中，没有满足技术筛选的标的；请求的标的中有 {u} 个未在 {tf} 评估。"],
  // coverage reasons — producer and consumer codes (lib/technicalScan.ts)
  tsR_engine_mismatch: ["older engine version", "旧版引擎"],
  tsR_generation_stale: ["scan older than 4 days", "扫描已超过4天"],
  tsR_cutoff_aged: ["last bar older than 10 days", "最近K线已超过10天"],
  tsR_cutoff_behind_market: ["behind its market's latest bar", "落后于所属市场最新K线"],
  tsR_timeframe_not_produced: ["timeframe not scanned", "该周期未扫描"],
  tsR_rate_series: ["rate series", "利率序列"],
  tsR_single_value_series: ["single-value series", "单值序列"],
  tsR_cutoff_unqualified: ["no qualified bar cutoff", "无合格K线截止"],
  tsR_not_leakfree: ["not proven free of future bars", "未证明不含未来K线"],
  tsR_no_ohlc: ["no price history", "无价格历史"],
  tsR_insufficient_history: ["insufficient history", "历史数据不足"],
  tsR_no_slice: ["no engine output", "无引擎输出"],
  tsR_slice_unreadable: ["engine output unreadable", "引擎输出不可读"],
  tsR_not_processed: ["not processed in this generation", "本批次未处理"],
  tsR_scan_absent: ["no scan published", "未发布扫描"],
  tsR_scan_unavailable: ["scan could not be read", "扫描无法读取"],
  tsR_not_in_scan: ["not in the scan", "不在扫描中"],
  tsR_malformed_row: ["malformed scan row", "扫描行异常"],
  tsR_field_null: ["value not published", "数值未发布"],
  tsR_invalid_coverage: ["coverage unreadable", "覆盖信息不可读"],
};

const pick = (lang: string, key: string): string | null => {
  const pair = TECHNICAL_SCAN_LEX[key];
  return pair ? pair[lang === "zh" ? 1 : 0] : null;
};

/** A coverage reason in words; an unrecognised code is shown verbatim (never re-labelled). */
export function technicalReasonLabel(reason: string, lang: string): string {
  return pick(lang, `tsR_${reason}`) ?? reason;
}

/** A source signal token in words. The flagship verdict words are shared (plainLabels); a token
 *  this build does not know is shown verbatim rather than as a guessed word. */
export function technicalSignalLabel(signal: string, lang: string): string {
  if (signal === "BOTTOM_WATCH") return pick(lang, "tsBottomWatch")!;
  if (signal === "BUY" || signal === "SELL" || signal === "REBUY" || signal === "RECLAIM") return verdictLabel(signal, lang === "zh" ? "zh" : "en");
  return signal;
}

export function useTechnicalT() {
  const { lang } = useLang();
  const sharedT = useT();
  return useCallback((key: string, vars?: Record<string, string | number>): string => {
    let s = pick(lang, key) ?? sharedT(key);
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
    return s;
  }, [lang, sharedT]);
}
