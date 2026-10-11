"use client";

import { useCallback } from "react";
import { useLang, useT } from "./i18n";

/**
 * Copy for the watchlist review (E16), feature-local so the shared dictionary in `lib/i18n.tsx`
 * (an evidence-locked file) is not edited. Same shape as `lib/sectorIntelligenceLex.ts`.
 */
export const WATCHLIST_REVIEW_LEX: Record<string, [string, string]> = {
  wlrRegion: ["Watchlist review", "自选列表复盘"],
  wlrControls: ["Review controls", "复盘操作"],
  wlrStartThis: ["Review this list", "逐个复盘此列表"],
  wlrResumeThis: ["Resume review", "继续复盘"],
  wlrStartList: ["Review {list}", "复盘 {list}"],
  wlrStartListCount: ["{n} companies, one at a time, in the current order", "共 {n} 家公司，按当前顺序逐个查看"],
  wlrReplaces: ["Ends the review of {list}", "将结束 {list} 的复盘"],
  wlrTitle: ["Reviewing {list}", "正在复盘 {list}"],
  wlrPosition: ["{n} of {total}", "第 {n} / {total} 个"],
  wlrSummary: ["{r} reviewed · {d} deferred · {u} unavailable", "已复盘 {r} · 已推迟 {d} · 不可用 {u}"],
  wlrPrev: ["Previous company", "上一家公司"],
  wlrNext: ["Next company", "下一家公司"],
  wlrNextIs: ["Next: {symbol}", "下一家：{symbol}"],
  wlrNoNext: ["Last company in this review", "已是本次复盘的最后一家"],
  wlrMarkReviewed: ["Mark reviewed", "标记已复盘"],
  wlrReviewed: ["Reviewed", "已复盘"],
  wlrDefer: ["Defer", "推迟"],
  wlrDeferred: ["Deferred", "已推迟"],
  wlrClearMark: ["Clear marker", "清除标记"],
  wlrDeferNote: ["Defer note (optional)", "推迟备注（可选）"],
  wlrDeferSave: ["Save defer", "确认推迟"],
  wlrCancel: ["Cancel", "取消"],
  wlrNoteLocal: ["Kept with this review on this device only. It is not added to your list notes.", "仅随本次复盘保存在本设备，不会写入列表备注。"],
  wlrMarkersOnly: ["Markers belong to this review only. Flags, notes, alerts and list membership are unchanged.", "标记只属于本次复盘，不会改变旗标、备注、提醒或列表成员。"],
  wlrEnd: ["End review", "结束复盘"],
  wlrGoTo: ["Show {symbol} on the chart", "在图表中显示 {symbol}"],
  wlrChartElsewhere: ["The chart is on {active}.", "图表当前为 {active}。"],
  wlrAvailUnknown: ["The market data list has not loaded yet, so availability is unknown.", "行情列表尚未加载，暂时无法确认是否可用。"],
  wlrAvailMissing: ["Unavailable: no market data for this company in the Terminal.", "不可用：终端中没有该公司的行情数据。"],
  wlrAvailRemoved: ["Removed from the list after this review started.", "复盘开始后已从列表中移除。"],
  wlrListMissing: ["The list {list} no longer exists.", "列表 {list} 已不存在。"],
  wlrSkipped: ["Skipped {entries}.", "已跳过 {entries}。"],
  wlrSkipEntry: ["{symbol} ({reason})", "{symbol}（{reason}）"],
  wlrSkipJoin: [", ", "、"],
  wlrReasonMissing: ["no market data", "无行情数据"],
  wlrReasonRemoved: ["removed from list", "已移出列表"],
  wlrAtEnd: ["No available company after this one.", "之后没有可复盘的公司。"],
  wlrAtStart: ["No available company before this one.", "之前没有可复盘的公司。"],
  wlrEmpty: ["{list} has no companies to review.", "{list} 中没有可复盘的公司。"],
  wlrDrift: ["The list changed after this review started: {a} added, {r} removed. The review keeps its order until you update it.", "复盘开始后列表有变动：新增 {a}，移除 {r}。在你更新之前，复盘顺序保持不变。"],
  wlrUpdate: ["Update review to the current list", "按当前列表更新复盘"],
  wlrSaved: ["Progress saved on this device.", "进度已保存在本设备。"],
  wlrUnsaved: ["Not saved: this progress will be lost when the page reloads.", "未保存：页面刷新后进度将丢失。"],
  wlrRetry: ["Retry save", "重试保存"],
  wlrEndUnsaved: ["Review ended, but this device could not forget it, so it may come back after a reload.", "复盘已结束，但本设备未能清除记录，刷新后可能重新出现。"],
  wlrDismiss: ["Dismiss", "关闭"],
  wlrUnknownCount: ["{n} not yet confirmed", "{n} 家尚未确认"],
};

export function useWatchlistReviewT() {
  const { lang } = useLang();
  const sharedT = useT();
  return useCallback((key: string, fallback?: string): string => {
    const pair = WATCHLIST_REVIEW_LEX[key];
    return pair ? pair[lang === "zh" ? 1 : 0] : sharedT(key, fallback);
  }, [lang, sharedT]);
}
