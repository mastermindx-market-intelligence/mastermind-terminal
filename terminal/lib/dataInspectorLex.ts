"use client";
import { useCallback } from "react";
import { useLang, useT, type Lang } from "./i18n";
import { TIME_ZONE_CITY } from "./plainLabels";

/** Feature-local EN/ZH copy for the chart Data Inspector (E10). Language state stays the shared
 * LangProvider; keeping this copy out of the global LEX keeps it off every other route. */
export const DATA_INSPECTOR_LEX: Record<string, [string, string]> = {
  diTitle: ["Data inspector", "数据检查器"],
  diTime: ["Time", "时间"],
  diSelect: ["Select", "选择"],
  diZone: ["Exchange clock: {zone}", "交易所时钟：{zone}"],
  diSessionDates: ["Session dates · no time of day", "交易日日期 · 无具体时刻"],
  diJumpTime: ["Go to time", "跳转到时间"],
  diJumpDate: ["Go to date", "跳转到日期"],
  diJumpGo: ["Go", "前往"],
  diJumpInvalid: ["Enter a complete date and time.", "请输入完整的日期和时间。"],
  diJumpMissing: ["No bar at {time}. Nothing was substituted.", "{time} 没有K线，未替换为其他K线。"],
  diJumpBefore: ["Earlier bar: {time}", "前一根：{time}"],
  diJumpAfter: ["Later bar: {time}", "后一根：{time}"],
  diJumpNone: ["No plotted bar on that side", "该方向没有已绘制的K线"],
  diSortNewest: ["Newest first", "最新在前"],
  diSortOldest: ["Oldest first", "最早在前"],
  diRangeMode: ["Range", "区间"],
  diRangeHint: ["Tap the first bar, then the last bar of the range.", "先点区间第一根K线，再点最后一根。"],
  diRangeTooMany: ["That range has {n} bars. The limit is {max}; nothing was selected.", "该区间有 {n} 根K线，上限为 {max}，未做选择。"],
  diSelectedCount: ["{n} selected", "已选 {n}"],
  diNoneSelected: ["None selected", "未选择"],
  diCompare: ["Compare", "比较"],
  diShowOnChart: ["Show on chart", "在图表中显示"],
  diClear: ["Clear", "清除"],
  diScopeSelected: ["Exports {n} selected rows", "导出已选 {n} 行"],
  diScopeAll: ["Exports all {n} rows", "导出全部 {n} 行"],
  diExportTooMany: ["{n} rows is over the {max}-row export limit. Select a smaller range.", "{n} 行超过 {max} 行的导出上限，请选择更小的区间。"],
  diEmpty: ["The chart has not published bars for {symbol} · {tf}. Return to the chart to load them.", "图表尚未提供 {symbol} · {tf} 的K线，请返回图表加载。"],
  diReplayNote: ["Bar Replay is on: rows end at the replay cursor.", "K线回放已开启：数据截止于回放位置。"],
  diReplayMoved: ["Replay moved after these rows were read. Return to the chart to refresh them; export is paused.", "读取这些行之后回放位置已改变。请返回图表刷新；导出已暂停。"],
  diNullLegend: ["∅ = no value at this bar", "∅ = 该K线无数值"],
  diNoValues: ["no values", "无数值"],
  diKeyboardHint: ["Arrows move · Space selects · Shift+Arrow extends · Enter shows on chart", "方向键移动 · 空格选择 · Shift+方向键扩展 · 回车在图表中显示"],
  diGridLabel: ["Bars for {symbol} · {tf}", "{symbol} · {tf} 的K线"],
  diDiffTitle: ["Difference", "差值"],
  diDiffField: ["Field", "字段"],
  diDiffEarlier: ["Earlier", "较早"],
  diDiffLater: ["Later", "较晚"],
  diDiffChange: ["Change", "变化"],
  diDiffPct: ["Change %", "变化 %"],
  diDiffBarApart: ["1 bar apart · later minus earlier", "相隔 1 根K线 · 较晚减较早"],
  diDiffBarsApart: ["{n} bars apart · later minus earlier", "相隔 {n} 根K线 · 较晚减较早"],
  diDiffStudyUnits: ["Study changes are in the study's own units.", "指标变化以指标自身单位表示。"],
  diHideDiff: ["Close comparison", "关闭比较"],
  diFocusExact: ["Chart moved to {time}.", "图表已移动到 {time}。"],
  diFocusMissing: ["The chart has no bar at {time}; the view was not moved.", "图表在 {time} 没有K线，视图未移动。"],
  diFocusExpired: ["The chart did not load in time; the view was not moved to {time}.", "图表未能及时加载，视图未移动到 {time}。"],
  diFocusUnavailable: ["The chart could not move to {time}.", "图表无法移动到 {time}。"],
};

/** "{name}" placeholder fill — values are plain text and never re-parsed. */
export function fillCopy(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

export function dataInspectorCopy(key: string, lang: Lang, vars?: Record<string, string | number>): string {
  const pair = DATA_INSPECTOR_LEX[key];
  const text = pair ? pair[lang === "zh" ? 1 : 0] : key;
  return vars ? fillCopy(text, vars) : text;
}

/** City name for an exchange zone in the current language (no offset: DST differs across rows). */
export function zoneCity(zone: string, lang: Lang): string {
  const pair: readonly [string, string] | undefined = TIME_ZONE_CITY[zone];
  return pair ? pair[lang === "zh" ? 1 : 0] : zone;
}

export type FocusStatus = "exact" | "missing" | "expired" | "replaced" | "unavailable";

/** Toast copy for a Show-on-chart outcome; null when a newer request superseded this one. */
export function dataInspectorFocusMessage(status: FocusStatus, timeLabel: string, lang: Lang): string | null {
  const key = status === "exact" ? "diFocusExact"
    : status === "missing" ? "diFocusMissing"
    : status === "expired" ? "diFocusExpired"
    : status === "unavailable" ? "diFocusUnavailable"
    : null;
  return key ? dataInspectorCopy(key, lang, { time: timeLabel }) : null;
}

export function useDataInspectorT() {
  const { lang } = useLang();
  const sharedT = useT();
  return useCallback((key: string, vars?: Record<string, string | number>): string => {
    const pair = DATA_INSPECTOR_LEX[key];
    const text = pair ? pair[lang === "zh" ? 1 : 0] : sharedT(key);
    return vars ? fillCopy(text, vars) : text;
  }, [lang, sharedT]);
}
