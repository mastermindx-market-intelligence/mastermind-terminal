"use client";
import { useCallback } from "react";
import { useLang, useT } from "./i18n";

/**
 * E18 feature-local EN/ZH copy for the alert management panel. Language state stays the shared
 * LangProvider; keys not found here fall through to the shared dictionary (the existing condition
 * phrases). Kept out of lib/i18n.tsx, which evidence packets pin byte-for-byte.
 *
 * `{n}`, `{row}`, `{from}`, `{to}` and `{state}` are filled by the caller with already-translated
 * text or numbers — never with a raw state or type value.
 */
export const ALERT_BULK_LEX: Record<string, [string, string]> = {
  bkTitle: ["Manage several alerts", "批量管理提醒"],
  bkIntro: [
    "Filter your alerts, tick the ones you mean, then pause or resume them. Every alert reports its own result.",
    "筛选提醒，勾选要处理的项目，然后暂停或恢复。每条提醒单独报告结果。",
  ],
  bkOpen: ["Select alerts", "选择提醒"],
  bkClose: ["Close", "关闭"],
  bkRefresh: ["Refresh", "刷新"],
  bkUnsupported: [
    "Expiry dates and groups are not available: alerts have no saved field for them yet.",
    "到期日和分组暂不可用：提醒尚无可保存这些信息的字段。",
  ],

  bkFilterState: ["State", "状态"],
  bkAllStates: ["All states", "全部状态"],
  bkStateArmed: ["Armed", "已启用"],
  bkStatePaused: ["Paused", "已暂停"],
  bkStateFired: ["Triggered", "已触发"],
  bkFilterType: ["Type", "类型"],
  bkAllTypes: ["All types", "全部类型"],
  bkTypeSignal: ["Signal", "信号"],
  bkTypePrice: ["Price", "价格"],
  bkTypeRsi: ["RSI", "RSI"],
  bkTypeRegime: ["Trend", "趋势"],
  bkTypeOptions: ["Options", "期权"],
  bkTypeSuite: ["Indicator suite", "指标套件"],
  bkTypeOther: ["Other", "其他"],
  bkFilterSymbol: ["Symbol", "代码"],
  bkClearFilters: ["Clear filters", "清除筛选"],

  bkLoading: ["Loading your alerts…", "正在加载你的提醒…"],
  bkSignedOut: ["Sign in to manage your alerts.", "登录后管理你的提醒。"],
  bkUnavailable: ["Could not load your alerts. Nothing was changed.", "无法加载你的提醒。未做任何更改。"],
  bkStale: ["Could not refresh — showing your alerts as last loaded.", "刷新失败——以下为上次加载的提醒。"],
  bkRetry: ["Try again", "重试"],
  bkNoAlerts: ["There are no alerts to manage.", "暂无可管理的提醒。"],
  bkNoMatches: ["No alerts match these filters.", "没有符合筛选条件的提醒。"],
  bkShown: ["{n} shown", "显示 {n} 条"],

  bkSelected: ["{n} selected", "已选 {n} 条"],
  bkHidden: ["{n} hidden by the filters", "其中 {n} 条被筛选隐藏"],
  bkSelectShown: ["Select shown", "选择当前显示"],
  bkClearSelection: ["Clear selection", "清除选择"],
  bkPauseSelected: ["Pause selected…", "暂停所选…"],
  bkResumeSelected: ["Resume selected…", "恢复所选…"],

  bkSinceSelected: ["Since you selected", "自你选择以来"],
  bkDeletedRow: ["{row} was deleted and left your selection.", "{row} 已被删除，已移出选择。"],
  bkChangedState: ["{row} changed from {from} to {to}. It is still selected.", "{row} 已从{from}变为{to}，仍保持选择。"],
  bkChangedOther: ["{row} changed since you selected it. It is still selected.", "{row} 在你选择后已更改，仍保持选择。"],
  bkDismiss: ["Dismiss", "知道了"],

  bkReviewPause: ["Review: pause the {n} selected alerts", "确认：暂停所选的 {n} 条提醒"],
  bkReviewResume: ["Review: resume the {n} selected alerts", "确认：恢复所选的 {n} 条提醒"],
  bkPauseNote: ["A paused alert is not checked until you resume it.", "暂停的提醒在恢复前不会被检查。"],
  bkWillPause: ["Will be paused", "将暂停"],
  bkWillResume: ["Will be resumed", "将恢复"],
  bkWillRearm: ["Triggered — will be re-armed and its trigger record cleared", "已触发——将重新启用，并清除触发记录"],
  bkSkipPaused: ["Skipped — already paused", "跳过——已暂停"],
  bkSkipFired: ["Skipped — already triggered and not being watched", "跳过——已触发，未在监控"],
  bkSkipArmed: ["Skipped — already armed", "跳过——已启用"],
  bkNothingToDo: ["None of the selected alerts would change.", "所选提醒均不会发生变化。"],
  bkConfirmPause: ["Pause {n}", "暂停 {n} 条"],
  bkConfirmResume: ["Resume {n}", "恢复 {n} 条"],
  bkCancel: ["Cancel", "取消"],
  bkReviewStale: [
    "These alerts changed while you were reviewing. Nothing was sent — review again.",
    "确认期间这些提醒已发生变化。尚未发送任何更改——请重新确认。",
  ],
  bkReviewAgain: ["Review again", "重新确认"],

  bkResultsPause: ["Pause results", "暂停结果"],
  bkResultsResume: ["Resume results", "恢复结果"],
  bkSending: ["Sending…", "正在发送…"],
  bkWaiting: ["Waiting to send", "等待发送"],
  bkResultPaused: ["Paused", "已暂停"],
  bkResultResumed: ["Resumed", "已恢复"],
  bkResultRearmed: ["Re-armed", "已重新启用"],
  bkResultFiredFirst: ["Triggered before the pause arrived — not being watched", "暂停送达前已触发——未在监控"],
  bkRefusedSignedOut: ["Refused — you are signed out", "被拒绝——你已退出登录"],
  bkRefusedNotFound: ["Refused — not found in your alerts", "被拒绝——在你的提醒中未找到"],
  bkRefusedNotAllowed: ["Refused — not included with your plan", "被拒绝——你的方案不包含此提醒"],
  bkUnknownChecking: ["Not confirmed — checking its current state…", "未获确认——正在核对其当前状态…"],
  bkUnknownObserved: ["Not confirmed — latest saved state: {state}", "未获确认——最新保存的状态：{state}"],
  bkUnknownMissing: ["Not confirmed — no longer in your alerts", "未获确认——已不在你的提醒中"],
  bkUnknownUnreadable: ["Not confirmed, and its current state could not be checked", "未获确认，且无法核对其当前状态"],
  bkUnknownNote: [
    "A change that was not confirmed is never sent again automatically, and it may still take effect.",
    "未获确认的更改不会自动重发，它仍可能生效。",
  ],
  bkCheckStatus: ["Check current state", "核对当前状态"],
  bkNotSentSignedOut: ["Not sent — you are signed out", "未发送——你已退出登录"],
  bkNotSentAccount: ["Not sent — the account changed", "未发送——账户已切换"],
  bkCountPaused: ["{n} paused", "已暂停 {n} 条"],
  bkCountResumed: ["{n} resumed", "已恢复 {n} 条"],
  bkCountFiredFirst: ["{n} had already triggered", "{n} 条此前已触发"],
  bkCountRefused: ["{n} refused", "被拒绝 {n} 条"],
  bkCountUnknown: ["{n} not confirmed", "未获确认 {n} 条"],
  bkCountNotSent: ["{n} not sent", "未发送 {n} 条"],
  bkCountSkipped: ["{n} skipped", "跳过 {n} 条"],
  bkCountPending: ["{n} waiting", "等待中 {n} 条"],
  bkOfSelected: ["of {n} selected", "共选 {n} 条"],
  bkDone: ["Done", "完成"],
};

export function useAlertBulkT() {
  const { lang } = useLang();
  const sharedT = useT();
  return useCallback((key: string, vars?: Record<string, string | number>): string => {
    const pair = ALERT_BULK_LEX[key];
    let s = pair ? pair[lang === "zh" ? 1 : 0] : sharedT(key);
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
    return s;
  }, [lang, sharedT]);
}
