"use client";
import { useCallback } from "react";
import { useLang, useT } from "./i18n";
/** Feature-local EN/ZH tuples for the watchlist event planner (E14). Language state remains the
 * shared LangProvider; keeping this copy out of the global LEX leaves every other screen's
 * evidence untouched. `{n}`-style placeholders are filled with numbers, symbols or dates only.
 */
export const WATCHLIST_EVENT_PLANNER_LEX: Record<string, [string, string]> = {
  wepOpen: ["Upcoming events for this list", "查看此列表的即将发生事件"],
  wepTitle: ["Watchlist events", "自选列表事件"],
  wepSubtitle: [
    "Known company report dates for one list, as the source data states them. Nothing here is guessed or scheduled.",
    "按数据源原样列出所选列表中公司的已知财报日期。不推测，也不设提醒。",
  ],
  wepList: ["List", "列表"],
  wepClose: ["Close", "关闭"],
  wepReadAgain: ["Read again", "重新读取"],
  wepReadMore: ["Read next {n}", "继续读取 {n} 家"],
  wepReadOf: ["Read {read} of {total} companies", "已读取 {total} 家公司中的 {read} 家"],
  wepReading: ["Reading companies… {done} of {total}", "正在读取公司… {done}/{total}"],
  wepReadingAgain: [
    "Reading again… {done} of {total}. Each row keeps its last answer until the new one arrives.",
    "正在重新读取… {done}/{total}。新结果到达前，每一行保留上一次的结果。",
  ],
  wepIncomplete: [
    "Coverage is incomplete. Some companies have no current answer (not read, an older copy, or a date that has passed), so they may still have events. The dates below are not the full picture for this list.",
    "覆盖不完整。部分公司没有最新结果（未读取、较早的副本或日期已过），仍可能有事件。以下日期并不是此列表的全部情况。",
  ],
  wepCatPending: ["{n} still reading", "{n} 家读取中"],
  wepCatUnavailable: ["{n} could not be read", "{n} 家无法读取"],
  wepCatAbsent: ["{n} not covered by the source", "{n} 家不在数据源覆盖范围内"],
  wepCatUnreadable: ["{n} with a date the planner cannot interpret", "{n} 家的日期无法解析"],
  wepCatNotRead: ["{n} not read yet", "{n} 家尚未读取"],
  wepCatRefreshFailed: ["{n} shown from an earlier copy", "{n} 家显示的是较早的副本"],
  wepCatStale: ["{n} shown from a saved copy not yet confirmed", "{n} 家显示的是尚未确认的已保存副本"],
  wepCatOutdated: ["{n} with an outdated date", "{n} 家的日期已过期"],
  wepCatNotCompany: ["{n} not companies (index, crypto or basket)", "{n} 个不是公司（指数、加密货币或组合）"],
  wepEarnings: ["Earnings reports", "财报发布"],
  wepDateOnly: ["Date only · time not stated", "仅有日期 · 未注明时间"],
  wepConfUnstated: ["Confirmation not stated", "未注明是否已确认"],
  wepExchangeTime: ["Exchange time", "交易所时间"],
  wepYourTime: ["Your time", "您的时间"],
  wepExchangeTzUnknown: ["Exchange time zone unknown", "交易所时区未知"],
  wepMovedFrom: ["Moved from {day}", "原定 {day}，已改期"],
  wepEarlierCopy: ["Earlier copy · latest read failed", "较早副本 · 最新读取失败"],
  wepSavedCopy: ["Saved copy · not yet confirmed", "已保存副本 · 尚未确认"],
  wepSourceAsOf: ["Source file dated {day}", "数据文件日期 {day}"],
  wepPeriod: ["Period {p}", "报告期 {p}"],
  wepToday: ["Today", "今天"],
  wepTomorrow: ["Tomorrow", "明天"],
  wepInDays: ["In {n} days", "{n} 天后"],
  wepNotOnAgenda: ["Not on the agenda", "未列入日程"],
  wepWhyNone: ["No upcoming date in the source", "数据源中没有即将到来的日期"],
  wepWhyPast: ["Last known date has passed; no new date yet", "上一个已知日期已过，尚无新日期"],
  wepWhyUnreadable: ["Date in a format the planner cannot interpret", "日期格式无法解析"],
  wepWhyAbsent: ["Not covered by the source", "不在数据源覆盖范围内"],
  wepWhyUnavailable: ["Could not be read", "无法读取"],
  wepWhyNotRead: ["Not read yet", "尚未读取"],
  wepWhyPending: ["Reading…", "读取中…"],
  wepWhyNotCompany: ["Not a company · no report dates", "不是公司 · 没有财报日期"],
  wepRetry: ["Retry", "重试"],
  wepEmptyComplete: [
    "None of the {n} companies in this list has an upcoming report date in the source data.",
    "此列表中的 {n} 家公司在数据源中都没有即将到来的财报日期。",
  ],
  wepEmptyPartial: [
    "No upcoming report dates among the {read} companies with a current answer. {unread} more have no current answer, so this is not a complete picture.",
    "在 {read} 家有最新结果的公司中没有即将到来的财报日期。另有 {unread} 家没有最新结果，因此这不是完整情况。",
  ],
  wepEmptyList: ["This list has no symbols.", "此列表中没有代码。"],
  wepNoCompanies: ["This list has no companies to read, only indexes, crypto or baskets.", "此列表中没有可读取的公司，只有指数、加密货币或组合。"],
  wepOpenCompany: ["Open {sym} earnings", "打开 {sym} 财报"],
  wepFootnote: [
    "Dates come from each company's fundamentals file. A date without a time is shown as a date only. This view sends no reminders.",
    "日期来自各公司的基本面数据文件。没有时间的日期只显示日期。此视图不会发送提醒。",
  ],
};

export function useEventPlannerT() {
  const { lang } = useLang();
  const sharedT = useT();
  return useCallback((key: string, fallback?: string): string => {
    const pair = WATCHLIST_EVENT_PLANNER_LEX[key];
    return pair ? pair[lang === "zh" ? 1 : 0] : sharedT(key, fallback);
  }, [lang, sharedT]);
}
