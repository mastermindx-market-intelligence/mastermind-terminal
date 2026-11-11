/**
 * News Intelligence rail R2 — the evidence ladder, topic families and NEXT CHECK
 * copy (seat-frozen spec NEWS_INTELLIGENCE_RAIL_R2_SPEC.md, 2026-10-22). Same
 * tuple style as lib/newsFlowLex.ts. Product law is unchanged: no sentiment,
 * impact, confidence, rank, score or call anywhere in this file. The ladder
 * only counts and compares the reports the engine already grouped; it never
 * says what a story means.
 *
 * Pure module: no React, no DOM, no fetch. Every function here is table-tested
 * in lib/__tests__/newsLadderLex.test.ts.
 */
import type { NewsCatchupLang } from "@/lib/newsCatchupLex";
import type { TickerNewsReportingState, TickerNewsState, TickerNewsStoryRow } from "@/lib/newsTypes";

export const NEWS_LADDER_LEX = {
  // Ladder step 1 — what kind of document the representative report is
  "kind.press_release": ["Company announcement", "公司公告"],
  "kind.reporting": ["Reporting", "媒体报道"],
  // Ladder step 2 — distinct outlets (source_count)
  "outlets.one": ["1 outlet", "1 家媒体"],
  "outlets.many": ["{k} outlets", "{k} 家媒体"],
  // Ladder step 3 — grouped reports (item_count)
  "reports.one": ["1 report", "1 条报道"],
  "reports.many": ["{n} reports", "{n} 条报道"],
  // Ladder step 4 — agreement between the grouped reports (reporting_state).
  // The glyph is never shown without its label.
  "agree.no_material_difference": ["Reports agree", "报道一致"],
  "agree.reports_differ": ["Reports differ", "报道有出入"],
  "agree.comparison_limited": ["Comparison limited", "比对受限"],
  "agree.not_compared": ["Not compared", "未比对"],
  // Ladder chip accessible name (the visible steps are the chip's text)
  "ladder.open": ["Show the reports behind this story", "查看这条新闻背后的报道"],
  "ladder.close": ["Hide the reports", "收起报道"],
  // Evidence view
  "clock.published": ["Published", "发布"],
  "clock.updated": ["Updated", "更新"],
  "clock.received": ["Received", "接收"],
  "more.reports": ["Show {n} more {n?report|reports}", "再显示 {n} 条报道"],
  // NEXT CHECK (never on a 1-report row; first matching rule wins)
  "next.label": ["Next check", "下一步核对"],
  "next.differ": ["Compare outlets before relying on one report", "依赖单一报道前先比对各媒体"],
  "next.limited": ["Some sources can't be compared", "部分来源无法比对"],
  "next.announcement": ["Read the company announcement first", "先读公司公告"],
  "next.catchup": ["Recheck after catch-up", "补齐后再核对"],
} as const satisfies Record<string, readonly [string, string]>;

export type NewsLadderKey = keyof typeof NEWS_LADDER_LEX;

/**
 * Look up one string and fill `{name}` slots. `{name?one|many}` picks `one` when
 * Number(vars[name]) === 1, otherwise `many` (EN only; ZH has no plural branches).
 * A missing var leaves the token untouched. Same contract as newsFlowText.
 */
export function newsLadderText(
  key: NewsLadderKey,
  lang: NewsCatchupLang,
  vars?: Record<string, string | number>,
): string {
  let text: string = NEWS_LADDER_LEX[key][lang === "zh" ? 1 : 0];
  if (!vars) return text;
  const has = (name: string) => Object.prototype.hasOwnProperty.call(vars, name);
  text = text.replace(/\{(\w+)\?([^|}]*)\|([^}]*)\}/g, (match, name: string, one: string, many: string) =>
    has(name) ? (Number(vars[name]) === 1 ? one : many) : match,
  );
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (has(name) ? String(vars[name]) : match));
}

/**
 * Topic families: the engine's 23 annotation event classes
 * (engine/news_events.py _EVENT_CLASSES, mirrored by engine/news_common.py
 * EVENT_WEIGHT) fold into 20 reader-facing families. The family is a label for
 * what the headline is about, never a judgement of it. An unknown, null or
 * missing event type is an EMPTY slot: the row still renders.
 */
export const NEWS_TOPIC_FAMILY = {
  guidance_cut: ["Guidance", "业绩指引"],
  guidance_raise: ["Guidance", "业绩指引"],
  preannouncement: ["Preliminary results", "业绩预告"],
  earnings_result: ["Earnings", "财报"],
  analyst_estimate_revision: ["Estimates", "分析师预估"],
  rating_change: ["Analyst rating", "分析师评级"],
  contract_award: ["Contract", "合同"],
  customer_win: ["Customer", "客户"],
  customer_loss: ["Customer", "客户"],
  product_launch: ["Product", "产品"],
  product_delay: ["Product", "产品"],
  management_change: ["Management", "管理层"],
  regulatory_probe: ["Regulatory", "监管"],
  litigation: ["Litigation", "诉讼"],
  equity_offering: ["Capital raise", "融资"],
  buyback: ["Buyback", "回购"],
  dividend_change: ["Dividend", "股息"],
  mna_confirmed: ["M&A", "并购"],
  mna_rumor: ["M&A · unconfirmed report", "并购 · 未经证实的报道"],
  activist_campaign: ["Activist", "激进投资者"],
  macro_release: ["Macro release", "宏观数据"],
  policy_trade_control: ["Trade policy", "贸易政策"],
  bankruptcy_restructuring: ["Restructuring", "重组"],
} as const satisfies Record<string, readonly [string, string]>;

export type NewsEventType = keyof typeof NEWS_TOPIC_FAMILY;

export function topicFamily(eventType: string | null | undefined, lang: NewsCatchupLang): string {
  if (!eventType || !Object.prototype.hasOwnProperty.call(NEWS_TOPIC_FAMILY, eventType)) return "";
  return NEWS_TOPIC_FAMILY[eventType as NewsEventType][lang === "zh" ? 1 : 0];
}

/** Agreement glyphs. Always rendered together with the matching `agree.*` label. */
export const AGREEMENT_GLYPH: Record<TickerNewsReportingState, string> = {
  no_material_difference: "=",
  reports_differ: "≠",
  comparison_limited: "~",
  not_compared: "–",
};

export type LadderStep = { key: "kind" | "outlets" | "reports" | "agreement"; text: string; glyph?: string };

/**
 * The ladder steps for one row, in display order: kind › outlets › reports › agreement.
 * A 1-report row has no agreement step (there is nothing to compare). The
 * outlets step never claims more outlets than reports, and never fewer than one.
 */
export function ladderSteps(row: TickerNewsStoryRow, lang: NewsCatchupLang): LadderStep[] {
  const n = row.item_count;
  const k = Math.min(Math.max(row.source_count, 1), n);
  const steps: LadderStep[] = [
    { key: "kind", text: newsLadderText(row.content_kind === "press_release" ? "kind.press_release" : "kind.reporting", lang) },
    { key: "outlets", text: newsLadderText(k === 1 ? "outlets.one" : "outlets.many", lang, { k }) },
    { key: "reports", text: newsLadderText(n === 1 ? "reports.one" : "reports.many", lang, { n }) },
  ];
  if (n > 1) {
    const state: TickerNewsReportingState = row.reporting_state ?? "not_compared";
    steps.push({ key: "agreement", text: newsLadderText(`agree.${state}` as NewsLadderKey, lang), glyph: AGREEMENT_GLYPH[state] });
  }
  return steps;
}

export type NextCheckKey = "next.differ" | "next.limited" | "next.announcement" | "next.catchup";

/**
 * NEXT CHECK: one line that tells the reader what to do before relying on the
 * story. Rules in order, first match wins; a 1-report row never gets one.
 *  1. reports_differ                                        → next.differ
 *  2. comparison_limited                                    → next.limited
 *  3. a company announcement is among the grouped reports   → next.announcement
 *     (the representative row's content_kind, or any loaded member's)
 *  4. snapshot catching_up | degraded and the row is not_compared → next.catchup
 *  else null (no line, no label).
 */
export function nextCheck(
  row: TickerNewsStoryRow,
  snapshotState: TickerNewsState | null | undefined,
  members: readonly TickerNewsStoryRow[] | null = null,
): NextCheckKey | null {
  if (row.item_count <= 1) return null;
  const state: TickerNewsReportingState = row.reporting_state ?? "not_compared";
  if (state === "reports_differ") return "next.differ";
  if (state === "comparison_limited") return "next.limited";
  const announcement = row.content_kind === "press_release" || (members ?? []).some((m) => m.content_kind === "press_release");
  if (announcement) return "next.announcement";
  if ((snapshotState === "catching_up" || snapshotState === "degraded") && state === "not_compared") return "next.catchup";
  return null;
}
