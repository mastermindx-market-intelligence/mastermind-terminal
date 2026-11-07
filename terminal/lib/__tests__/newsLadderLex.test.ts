// News rail R2 — pins for the frozen lib/newsLadderLex.ts (seat spec
// NEWS_INTELLIGENCE_RAIL_R2_SPEC.md §2/§6 lane L1). The module itself is
// frozen byte-for-byte; these tests pin its tuple structure, the topic-family
// table, the ladder geometry, the NEXT CHECK rule order, and the product-law
// banned vocabulary. The topic-family and NEXT CHECK expectations below are
// literals copied from the frozen tables — never computed from the imports
// they pin.
import { describe, expect, it } from "vitest";

import {
  NEWS_LADDER_LEX,
  NEWS_TOPIC_FAMILY,
  ladderSteps,
  newsLadderText,
  nextCheck,
  topicFamily,
  type NewsEventType,
  type NewsLadderKey,
  type NextCheckKey,
} from "@/lib/newsLadderLex";
import type {
  TickerNewsReportingState,
  TickerNewsState,
  TickerNewsStoryRow,
} from "@/lib/newsTypes";

/** Minimal valid row; the ladder only reads item_count, source_count, reporting_state and content_kind. */
const row = (overrides: Partial<TickerNewsStoryRow> = {}): TickerNewsStoryRow => ({
  sequence: 1,
  source: "benzinga",
  source_item_id: "ev2_r2-item",
  story_id: "ev2_r2",
  source_count: 2,
  item_count: 2,
  title: "Story ev2_r2",
  url: "https://www.benzinga.com/news/ev2_r2",
  teaser: "",
  published_at: "2026-10-21T14:00:00+00:00",
  updated_at: null,
  received_at: "2026-10-21T14:01:01+00:00",
  universe_revision: "sp500-r1",
  ...overrides,
});

const member = (overrides: Partial<TickerNewsStoryRow> = {}): TickerNewsStoryRow =>
  row({ story_id: "ev2_m", source_item_id: "ev2_m-item", ...overrides });

describe("tuples", () => {
  it("every NEWS_LADDER_LEX entry is a bilingual tuple of non-empty strings", () => {
    for (const key of Object.keys(NEWS_LADDER_LEX) as NewsLadderKey[]) {
      expect(NEWS_LADDER_LEX[key][0].trim(), `${key} EN`).not.toBe("");
      expect(NEWS_LADDER_LEX[key][1].trim(), `${key} ZH`).not.toBe("");
    }
  });

  it("every NEWS_TOPIC_FAMILY entry is a bilingual tuple of non-empty strings", () => {
    for (const key of Object.keys(NEWS_TOPIC_FAMILY) as NewsEventType[]) {
      expect(NEWS_TOPIC_FAMILY[key][0].trim(), `${key} EN`).not.toBe("");
      expect(NEWS_TOPIC_FAMILY[key][1].trim(), `${key} ZH`).not.toBe("");
    }
  });

  it("fills the {n?one|many} branch of more.reports through newsLadderText", () => {
    expect(newsLadderText("more.reports", "en", { n: 1 })).toBe("Show 1 more report");
    expect(newsLadderText("more.reports", "en", { n: 5 })).toBe("Show 5 more reports");
    expect(newsLadderText("more.reports", "zh", { n: 5 })).toBe("再显示 5 条报道");
  });
});

// The engine's 23 annotation event classes and their reader-facing families,
// copied ONCE from the frozen NEWS_TOPIC_FAMILY as literals.
const TOPIC_ROWS: ReadonlyArray<[NewsEventType, string, string]> = [
  ["guidance_cut", "Guidance", "业绩指引"],
  ["guidance_raise", "Guidance", "业绩指引"],
  ["preannouncement", "Preliminary results", "业绩预告"],
  ["earnings_result", "Earnings", "财报"],
  ["analyst_estimate_revision", "Estimates", "分析师预估"],
  ["rating_change", "Analyst rating", "分析师评级"],
  ["contract_award", "Contract", "合同"],
  ["customer_win", "Customer", "客户"],
  ["customer_loss", "Customer", "客户"],
  ["product_launch", "Product", "产品"],
  ["product_delay", "Product", "产品"],
  ["management_change", "Management", "管理层"],
  ["regulatory_probe", "Regulatory", "监管"],
  ["litigation", "Litigation", "诉讼"],
  ["equity_offering", "Capital raise", "融资"],
  ["buyback", "Buyback", "回购"],
  ["dividend_change", "Dividend", "股息"],
  ["mna_confirmed", "M&A", "并购"],
  ["mna_rumor", "M&A · unconfirmed report", "并购 · 未经证实的报道"],
  ["activist_campaign", "Activist", "激进投资者"],
  ["macro_release", "Macro release", "宏观数据"],
  ["policy_trade_control", "Trade policy", "贸易政策"],
  ["bankruptcy_restructuring", "Restructuring", "重组"],
];

describe("topicFamily", () => {
  it.each(TOPIC_ROWS)("%s pins the exact EN and ZH family strings", (eventType, en, zh) => {
    expect(topicFamily(eventType, "en")).toBe(en);
    expect(topicFamily(eventType, "zh")).toBe(zh);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["the empty string", ""],
    ["an unknown class", "not_a_class"],
  ])("%s is an empty slot, never an error", (_name, eventType) => {
    expect(topicFamily(eventType, "en")).toBe("");
    expect(topicFamily(eventType, "zh")).toBe("");
  });

  it("the 23 event classes fold into exactly 20 distinct EN families", () => {
    expect(TOPIC_ROWS).toHaveLength(23);
    expect(new Set(TOPIC_ROWS.map((entry) => entry[1])).size).toBe(20);
  });
});

describe("ladderSteps", () => {
  it("a 1-report row is three steps with no agreement step", () => {
    const steps = ladderSteps(row({ item_count: 1, source_count: 1 }), "en");
    expect(steps.map((step) => step.key)).toEqual(["kind", "outlets", "reports"]);
    expect(steps.map((step) => step.text)).toEqual(["Reporting", "1 outlet", "1 report"]);
    expect(steps.every((step) => step.glyph === undefined)).toBe(true);
  });

  it("a 2-report row from 1 outlet reads 1 outlet / 2 reports plus the agreement step", () => {
    const steps = ladderSteps(
      row({ item_count: 2, source_count: 1, reporting_state: "no_material_difference" }),
      "en",
    );
    expect(steps.map((step) => step.text)).toEqual(["Reporting", "1 outlet", "2 reports", "Reports agree"]);
    expect(steps[3].key).toBe("agreement");
    expect(steps[3].glyph).toBe("=");
  });

  it.each([
    ["k below n counts the outlets", 5, 3, "3 outlets"],
    ["k above n clamps to the report count", 3, 9, "3 outlets"],
    ["k=0 floors at one outlet", 2, 0, "1 outlet"],
  ])("%s", (_name, n, k, outlets) => {
    const steps = ladderSteps(
      row({ item_count: n as number, source_count: k as number, reporting_state: "not_compared" }),
      "en",
    );
    expect(steps[1].text).toBe(outlets);
    expect(steps[2].text).toBe(`${n as number} reports`);
  });

  it.each([
    ["no_material_difference", "=", "Reports agree"],
    ["reports_differ", "≠", "Reports differ"],
    ["comparison_limited", "~", "Comparison limited"],
    ["not_compared", "–", "Not compared"],
  ] as ReadonlyArray<[TickerNewsReportingState, string, string]>)(
    "agreement %s renders the glyph %s only together with the label %s",
    (state, glyph, label) => {
      const steps = ladderSteps(row({ item_count: 2, source_count: 2, reporting_state: state }), "en");
      const agreement = steps[steps.length - 1];
      expect(agreement.key).toBe("agreement");
      expect(agreement.glyph).toBe(glyph);
      expect(agreement.text).toBe(label);
    },
  );

  it("a missing reporting_state reads as not_compared", () => {
    const steps = ladderSteps(row({ item_count: 2, source_count: 2 }), "en");
    expect(steps[3].text).toBe("Not compared");
    expect(steps[3].glyph).toBe("–");
  });

  it("a press-release row opens with Company announcement", () => {
    const steps = ladderSteps(row({ item_count: 1, source_count: 1, content_kind: "press_release" }), "en");
    expect(steps[0].text).toBe("Company announcement");
  });

  it("ZH mirrors the EN ladder", () => {
    expect(
      ladderSteps(row({ item_count: 2, source_count: 1, reporting_state: "reports_differ" }), "zh").map(
        (step) => step.text,
      ),
    ).toEqual(["媒体报道", "1 家媒体", "2 条报道", "报道有出入"]);
    expect(
      ladderSteps(row({ item_count: 5, source_count: 3, reporting_state: "no_material_difference" }), "zh").map(
        (step) => step.text,
      ),
    ).toEqual(["媒体报道", "3 家媒体", "5 条报道", "报道一致"]);
    expect(
      ladderSteps(row({ item_count: 1, source_count: 1, content_kind: "press_release" }), "zh")[0].text,
    ).toBe("公司公告");
  });
});

const NEXT_CHECK_ROWS: ReadonlyArray<
  [string, TickerNewsStoryRow, TickerNewsState | null | undefined, readonly TickerNewsStoryRow[] | null, NextCheckKey | null]
> = [
  [
    "a 1-report row never gets a line, even when reports differ",
    row({ item_count: 1, source_count: 1, reporting_state: "reports_differ" }),
    "live",
    null,
    null,
  ],
  [
    "reports_differ sends the reader to compare outlets",
    row({ item_count: 2, source_count: 2, reporting_state: "reports_differ" }),
    "live",
    null,
    "next.differ",
  ],
  [
    "comparison_limited says which comparison is limited",
    row({ item_count: 2, source_count: 2, reporting_state: "comparison_limited" }),
    "live",
    null,
    "next.limited",
  ],
  [
    "a not_compared press-release row says to read the announcement",
    row({ item_count: 2, source_count: 2, reporting_state: "not_compared", content_kind: "press_release" }),
    "live",
    null,
    "next.announcement",
  ],
  [
    "a not_compared reporting row with a press-release member says to read the announcement",
    row({ item_count: 2, source_count: 2, reporting_state: "not_compared" }),
    "live",
    [member({ content_kind: "press_release" })],
    "next.announcement",
  ],
  [
    "not_compared while catching_up says to recheck after catch-up",
    row({ item_count: 2, source_count: 2, reporting_state: "not_compared" }),
    "catching_up",
    null,
    "next.catchup",
  ],
  [
    "not_compared while degraded says to recheck after catch-up",
    row({ item_count: 2, source_count: 2, reporting_state: "not_compared" }),
    "degraded",
    null,
    "next.catchup",
  ],
  [
    "not_compared while live gets no line",
    row({ item_count: 2, source_count: 2, reporting_state: "not_compared" }),
    "live",
    null,
    null,
  ],
  [
    "a missing reporting_state behaves as not_compared",
    row({ item_count: 2, source_count: 2 }),
    "catching_up",
    null,
    "next.catchup",
  ],
  [
    "precedence: a differing press-release row stays next.differ",
    row({ item_count: 2, source_count: 2, reporting_state: "reports_differ", content_kind: "press_release" }),
    "live",
    null,
    "next.differ",
  ],
];

describe("nextCheck", () => {
  it.each(NEXT_CHECK_ROWS)("%s", (name, row, snapshotState, members, expected) => {
    expect(nextCheck(row, snapshotState, members), name).toBe(expected);
  });
});

// Product law, verbatim from newsFlowLex.test.ts (spec 3.5).
const EN_BANNED = [
  "unusual", "spike", "alert", "score", "signal", "validated", "rank", "ranking",
  "confidence", "sentiment", "buy", "sell", "bullish", "bearish", "positive",
  "negative", "beat", "miss", "upgrade", "downgrade", "hot", "momentum", "impact",
];

const ZH_BANNED = [
  "异常", "激增", "飙升", "警报", "预警", "评分", "分数", "信号", "验证", "排名",
  "置信", "情绪", "买", "卖", "利好", "利空", "看涨", "看跌", "超预期", "不及预期",
  "热度", "影响",
];

type Lang = "en" | "zh";

/** Expand every `{n?one|many}` plural branch (both sides), leaving plain tokens. */
function expandBranches(text: string): string[] {
  if (!text.includes("?")) return [text];
  const one = text.replace(/\{(\w+)\?([^|}]*)\|([^}]*)\}/g, "$2");
  const many = text.replace(/\{(\w+)\?([^|}]*)\|([^}]*)\}/g, "$3");
  return [one, many];
}

const lexStrings = (): { table: string; key: string; lang: Lang; text: string }[] => {
  const out: { table: string; key: string; lang: Lang; text: string }[] = [];
  for (const key of Object.keys(NEWS_LADDER_LEX) as NewsLadderKey[]) {
    for (const lang of ["en", "zh"] as const) {
      for (const text of expandBranches(NEWS_LADDER_LEX[key][lang === "zh" ? 1 : 0])) {
        out.push({ table: "NEWS_LADDER_LEX", key, lang, text });
      }
    }
  }
  for (const key of Object.keys(NEWS_TOPIC_FAMILY) as NewsEventType[]) {
    for (const lang of ["en", "zh"] as const) {
      out.push({ table: "NEWS_TOPIC_FAMILY", key, lang, text: NEWS_TOPIC_FAMILY[key][lang === "zh" ? 1 : 0] });
    }
  }
  return out;
};

describe("vocabulary", () => {
  it("no EN string of either table contains a banned term (word boundary, case-insensitive)", () => {
    for (const { table, key, text } of lexStrings().filter((entry) => entry.lang === "en")) {
      for (const term of EN_BANNED) {
        expect(text, `${table}.${key}: ${text}`).not.toMatch(new RegExp(`\\b${term}\\b`, "i"));
      }
    }
  });

  it("no ZH string of either table contains a banned term (substring)", () => {
    for (const { table, key, text } of lexStrings().filter((entry) => entry.lang === "zh")) {
      for (const term of ZH_BANNED) {
        expect(text, `${table}.${key}: ${text}`).not.toContain(term);
      }
    }
  });
});
