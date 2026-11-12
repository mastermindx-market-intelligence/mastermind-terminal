"use client";
import { useCallback } from "react";
import { useLang, useT } from "./i18n";

/** Feature-local EN/ZH tuples for chart link groups (E09). Language state stays in the shared
 * LangProvider; keeping this copy out of the global LEX keeps it off every other route and leaves
 * unrelated screen evidence untouched. `{g}` = group letter, `{n}` = chart number, `{list}` /
 * `{tfs}` = a joined list. No mutable registration or store.
 */
export const CHART_LINK_LEX: Record<string, [string, string]> = {
  clChipOff: ["Chart {n}: not linked. Open link settings", "图表 {n}：未联动。打开联动设置"],
  clChipGroup: ["Chart {n}: link group {g}. Open link settings", "图表 {n}：联动组 {g}。打开联动设置"],
  clChipRefused: ["Chart {n}: link group {g}, not synchronising. Open link settings", "图表 {n}：联动组 {g}，未同步。打开联动设置"],
  clTitle: ["Link chart {n}", "联动图表 {n}"],
  clGroupLegend: ["Link group", "联动分组"],
  clOff: ["Off", "不联动"],
  clGroupName: ["Group {g}", "{g} 组"],
  clShareLegend: ["Group {g} shares", "{g} 组同步内容"],
  clShareCrosshair: ["Crosshair", "十字光标"],
  clShareWindow: ["Visible dates", "可见日期范围"],
  clStatusIndependent: ["Not linked — this chart moves on its own.", "未联动——此图表独立移动。"],
  clStatusActive: ["Linked with {list}.", "已与 {list} 联动。"],
  clStatusWaiting: ["Waiting for chart data before linking.", "等待图表数据加载后再联动。"],
  clStatusAlone: ["No other chart is in group {g} yet.", "{g} 组暂无其他图表。"],
  clStatusNothingShared: ["Group {g} shares nothing — turn on crosshair or visible dates.", "{g} 组未同步任何内容——请开启十字光标或可见日期范围。"],
  clStatusMixed: ["Not linked: group {g} mixes timeframes ({tfs}). Linking needs one timeframe.", "未联动：{g} 组包含不同周期（{tfs}），联动要求同一周期。"],
  clStatusTfUnknown: ["Not linked: a chart in group {g} has no known timeframe.", "未联动：{g} 组中有图表的周期未知。"],
  clFootnote: [
    "Links move only the crosshair and visible dates. Symbols and timeframes stay per chart. Saved layouts keep linking as on/off; custom groups stay on this device.",
    "联动只同步十字光标与可见日期。各图表的代码和周期保持独立。已保存布局只记录联动开/关；自定义分组仅保存在本设备。",
  ],
  clClose: ["Close", "关闭"],
  clListJoin: [", ", "、"],
};

export type ChartLinkT = (key: string, vars?: Record<string, string | number>) => string;

export function useChartLinkT(): ChartLinkT {
  const { lang } = useLang();
  const sharedT = useT();
  return useCallback((key: string, vars?: Record<string, string | number>): string => {
    const pair = CHART_LINK_LEX[key];
    let text = pair ? pair[lang === "zh" ? 1 : 0] : sharedT(key);
    if (vars) for (const [k, v] of Object.entries(vars)) text = text.split(`{${k}}`).join(String(v));
    return text;
  }, [lang, sharedT]);
}
