/**
 * Feature-local EN/ZH copy for the News catch-up (review state) controls.
 *
 * The News panel receives `lang` as a prop, so this is a plain lookup rather than a hook; keeping
 * the strings out of the global LEX avoids loading them on every route and leaves unrelated
 * screen evidence untouched.
 */

export type NewsCatchupLang = "en" | "zh";

export const NEWS_CATCHUP_LEX = {
  ncNew: ["New", "新"],
  ncUpdated: ["Updated", "更新"],
  ncReviewed: ["Reviewed", "已读"],
  ncAll: ["All", "全部"],
  ncRevised: ["Revised since your review", "阅读后已修订"],
  ncMoreReports: ["{n} more reports since your review", "阅读后新增 {n} 条报道"],
  ncMoreReport: ["1 more report since your review", "阅读后新增 1 条报道"],
  ncMarkOne: ["Mark reviewed", "标为已读"],
  // Wave B3 (U5): per-story accessible name — visible text stays ncMarkOne.
  ncMarkOneFor: ["Mark reviewed: {title}", "标为已读：{title}"],
  ncMarkShown: ["Mark shown as reviewed", "将显示的标为已读"],
  ncSummary: ["{new} new · {updated} updated", "{new} 条新 · {updated} 条更新"],
  ncCaughtUp: ["All shown stories reviewed", "显示的新闻已全部读完"],
  ncThrough: ["Last full read: the newest story shown then was from {time}", "上次全部读完时，最新一条新闻为 {time}"],
  ncFilterLabel: ["Filter by review state", "按阅读状态筛选"],
  ncSourceLabel: ["Filter by source", "按来源筛选"],
  ncAllSources: ["All sources", "全部来源"],
  ncNoMatch: ["No stories match this filter.", "没有符合此筛选的新闻。"],
  ncSessionOnly: [
    "Review marks can't be saved on this device. They last for this session only.",
    "无法在此设备保存已读标记，仅在本次会话有效。",
  ],
  ncNeedsAccount: ["Review marks need a signed-in account.", "已读标记需要登录账户。"],
} as const satisfies Record<string, readonly [string, string]>;

export type NewsCatchupKey = keyof typeof NEWS_CATCHUP_LEX;

/** Look up one string and fill `{name}` slots. */
export function newsCatchupText(
  key: NewsCatchupKey,
  lang: NewsCatchupLang,
  vars?: Record<string, string | number>,
): string {
  const text: string = NEWS_CATCHUP_LEX[key][lang === "zh" ? 1 : 0];
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
  );
}
