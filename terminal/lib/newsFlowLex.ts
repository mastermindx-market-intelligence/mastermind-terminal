/**
 * Feature-local EN/ZH copy for the ticker news-flow strip (Wave B3), the same
 * tuple style as lib/newsCatchupLex.ts. Product law: no sentiment, impact,
 * confidence, rank or call; comparison words compare this security with its own
 * history only. ZH counts use 条, matching the rail's existing `${n} 条报道`.
 */
import type { NewsCatchupLang } from "@/lib/newsCatchupLex";

export const NEWS_FLOW_LEX = {
  // Glance strip (spec 3.2)
  "count.zero": ["No reports in 24h", "24小时内暂无报道"],
  "count.one": ["1 report in 24h", "24小时内 1 条报道"],
  "count.many": ["{n} reports in 24h", "24小时内 {n} 条报道"],
  "cmp.busier": ["Busier than a typical day", "比平日更密集"],
  "cmp.typical": ["About a typical day", "与平日相当"],
  "cmp.quieter": ["Quieter than a typical day", "比平日清淡"],
  "cmp.insufficient": ["Too little history to compare", "历史尚短，暂不比较"],
  "cmp.partial": ["Counts may be incomplete", "计数可能不完整"],
  "state.unavailable": ["Report counts unavailable right now", "报道计数暂不可用"],
  "more.label": ["How these counts work", "计数说明"],
  "live.label": ["Live", "实时"],
  // Details panel (spec 3.3, split at the colons so the facts read as dt/dd pairs)
  "d.title": ["Report count, last 28 days", "近28天报道数"],
  "f.typical.dt": ["Typical day", "平日水平"],
  "f.typical.dd": ["{m} {m?report|reports} (median of the 28 days before today)", "{m} 条（今天之前28天的中位数）"],
  "f.typical.thin.dd": ["not enough history yet ({d} of 20 days)", "历史不足（已有 {d} 天，需 20 天）"],
  "f.week.dt": ["Last 7 days", "近7天"],
  "f.week.dd": ["{n} {n?report|reports}", "{n} 条报道"],
  "f.day.dt": ["Last 24h", "近24小时"],
  "f.day.dd": ["{n} {n?report|reports} in {k} {k?story|stories}", "{n} 条报道，归为 {k} 个新闻事件"],
  "f.published.dt": ["Placed by published time", "按发布时间计"],
  "f.received.dt": ["Placed by received time", "按接收时间计"],
  "f.basis.dd": ["{n}", "{n} 条"],
  "f.sources.dt": ["Sources counted", "计入来源"],
  "f.asof.dt": ["Counted at", "统计时间"],
  // Details prose
  "d.rule": [
    "Busier means at least twice a typical day and at least 3 more reports. Quieter means half or less of a typical day of 2 or more.",
    "更密集：至少为平日的两倍，且多出至少 3 条。更清淡：不超过平日的一半，且平日至少 2 条。",
  ],
  "d.method": [
    "Withdrawn reports are left out. Each report counts once; the same news from two outlets is two reports and one story. 24h is a rolling window; the 28 days are UTC calendar days.",
    "已撤回的报道不计入。每篇报道只计一次；两家媒体报道同一消息，计为两条报道、一个新闻事件。24小时为滚动窗口，28天按UTC自然日计。",
  ],
  "d.partial": [
    "The feed is catching up, so these counts may be low. No comparison is shown until it finishes.",
    "资讯流正在补齐，计数可能偏低；补齐前不显示比较。",
  ],
  "d.disclaimer": [
    "Counts describe coverage only. They do not indicate price direction.",
    "计数仅描述报道量，不代表价格方向。",
  ],
  // Wire tally (spec 4.3)
  "t.typical": ["typical", "平日"],
  "t.today": ["24h", "24小时"],
  "t.norecord": ["no record", "无记录"],
  "t.aria": [
    "Daily report counts for the 28 days before today ({d} days on record), typical day {m}, last 24 hours {n}",
    "今天之前28天每日报道数（有记录 {d} 天），平日 {m} 条，近24小时 {n} 条",
  ],
  "t.aria.thin": [
    "Daily report counts for the 28 days before today ({d} days on record), last 24 hours {n}",
    "今天之前28天每日报道数（有记录 {d} 天），近24小时 {n} 条",
  ],
  // Row copy changes (spec 3.4)
  "row.outlets": ["{n} reports from {k} outlets", "{n} 条报道，来自 {k} 家媒体"],
  "row.groupNote": [
    "Grouped because these reports describe the same event. Reports with different figures, periods or outcomes stay separate.",
    "这些报道描述同一事件，因此归为一组；数字、期间或结果不同的报道会分开列出。",
  ],
} as const satisfies Record<string, readonly [string, string]>;

export type NewsFlowKey = keyof typeof NEWS_FLOW_LEX;

/**
 * Look up one string and fill `{name}` slots. `{name?one|many}` picks `one` when
 * Number(vars[name]) === 1, otherwise `many` (EN only; ZH has no plural branches).
 * A missing var leaves the token untouched.
 */
export function newsFlowText(
  key: NewsFlowKey,
  lang: NewsCatchupLang,
  vars?: Record<string, string | number>,
): string {
  let text: string = NEWS_FLOW_LEX[key][lang === "zh" ? 1 : 0];
  if (!vars) return text;
  const has = (name: string) => Object.prototype.hasOwnProperty.call(vars, name);
  text = text.replace(/\{(\w+)\?([^|}]*)\|([^}]*)\}/g, (match, name: string, one: string, many: string) =>
    has(name) ? (Number(vars[name]) === 1 ? one : many) : match,
  );
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (has(name) ? String(vars[name]) : match));
}
