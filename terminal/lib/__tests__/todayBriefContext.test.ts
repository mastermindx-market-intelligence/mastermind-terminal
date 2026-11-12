import { describe, expect, it } from "vitest";
import { todayBriefContext } from "@/lib/shared-shell/todayBriefContext";

const row = { ticker: "NVDA", date: "2026-11-19", days_to: 10 };
const brief = {
  schema: "portfolio_brief.v2", asof: "2026-11-09", generated_at: "2026-11-09T06:00:00Z", stale: false,
  weighting: { mode: "equal", label_en: "Equal weighted", label_zh: "等权" },
  book: { n: 1, covered: 1, uncovered: [] },
  population: { mode: "watchlist_union", label_en: "Watchlists", label_zh: "关注列表", n: 1, disclosure_en: "One watched name", disclosure_zh: "一个关注标的" },
  headline: { en: "Source headline", zh: "来源标题" },
  sections: [{ key: "regime", title_en: "Regime", title_zh: "环境", lines: [{ en: "Source risk context.", zh: "来源风险背景。" }] }],
  data: { events: { earnings_10d: [row] } },
};

describe("Today consumes the incumbent portfolio brief", () => {
  it("preserves the source dates, population and verbatim bilingual regime without a new score", () => {
    expect(todayBriefContext(brief)).toEqual({
      asof: "2026-11-09", stale: false,
      population: { mode: "watchlist_union", label_en: "Watchlists", label_zh: "关注列表" },
      regime: brief.sections[0].lines, earnings: [{ ticker: "NVDA", date: "2026-11-19" }],
    });
  });
  it("preserves stale and past source dates without turning them into upcoming claims", () => {
    const result = todayBriefContext({ ...brief, stale: true, data: { events: { earnings_10d: [{ ...row, date: "2026-11-01", days_to: -8 }] } } });
    expect(result?.stale).toBe(true); expect(result?.earnings).toEqual([{ ticker: "NVDA", date: "2026-11-01" }]);
  });
  it.each([undefined, null, {}, { events: {} }, { events: { earnings_10d: "bad" } }])("keeps missing or malformed event data unknown: %j", data => {
    expect(todayBriefContext({ ...brief, data })?.earnings).toBeNull();
  });
  it.each([
    { ...row, ticker: "NVDA<script>" }, { ...row, date: "2026-02-30" }, { ...row, date: "2026-11" },
    { ...row, days_to: "10" }, { ...row, days_to: NaN }, null,
  ])("refuses a malformed event set rather than silently dropping a bad row: %j", invalid => {
    expect(todayBriefContext({ ...brief, data: { events: { earnings_10d: [row, invalid] } } })?.earnings).toBeNull();
  });
  it("deduplicates exact source rows without re-ranking or conflating different dates", () => {
    expect(todayBriefContext({ ...brief, data: { events: { earnings_10d: [row, row, { ...row, date: "2026-11-20" }] } } })?.earnings)
      .toEqual([{ ticker: "NVDA", date: "2026-11-19" }, { ticker: "NVDA", date: "2026-11-20" }]);
  });
  it.each([null, {}, { ...brief, schema: "other" }, { ...brief, asof: "2026-02-30" }, { ...brief, sections: [{ key: "regime", lines: [{}] }] }])("uses the existing strict brief envelope: %j", value => {
    expect(todayBriefContext(value)).toBeNull();
  });
});
