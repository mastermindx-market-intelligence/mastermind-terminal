// Wave B3 — copy pins for lib/newsFlowLex.ts (spec 3.2/3.3/3.4 via the B3 design
// pin P4): every key bilingual, the spec 3.5 banned vocabulary verbatim, and the
// G8 glance budget (EN at most 9 words, ZH at most 20 characters) at n = 9999 for
// every composed glance line in every state.
import { describe, expect, it } from "vitest";

import { NEWS_FLOW_LEX, newsFlowText, type NewsFlowKey } from "@/lib/newsFlowLex";

// Spec 3.5, EN list (23 terms, word-boundary, case-insensitive).
const EN_BANNED = [
  "unusual", "spike", "alert", "score", "signal", "validated", "rank", "ranking",
  "confidence", "sentiment", "buy", "sell", "bullish", "bearish", "positive",
  "negative", "beat", "miss", "upgrade", "downgrade", "hot", "momentum", "impact",
];

// Spec 3.5, ZH list (22 terms, substring).
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

const allStrings = (): { key: NewsFlowKey; lang: Lang; text: string }[] => {
  const out: { key: NewsFlowKey; lang: Lang; text: string }[] = [];
  for (const key of Object.keys(NEWS_FLOW_LEX) as NewsFlowKey[]) {
    for (const lang of ["en", "zh"] as const) {
      for (const text of expandBranches(NEWS_FLOW_LEX[key][lang === "zh" ? 1 : 0])) {
        out.push({ key, lang, text });
      }
    }
  }
  return out;
};

describe("newsFlowLex — keys", () => {
  it("every key has a non-empty EN and ZH string", () => {
    const keys = Object.keys(NEWS_FLOW_LEX) as NewsFlowKey[];
    expect(keys.length).toBeGreaterThan(20);
    for (const key of keys) {
      expect(NEWS_FLOW_LEX[key][0].trim(), `${key} EN`).not.toBe("");
      expect(NEWS_FLOW_LEX[key][1].trim(), `${key} ZH`).not.toBe("");
    }
  });

  it("substitutes {name} and picks the {name?one|many} branch by Number === 1", () => {
    expect(newsFlowText("f.week.dd", "en", { n: 1 })).toBe("1 report");
    expect(newsFlowText("f.week.dd", "en", { n: 5 })).toBe("5 reports");
    expect(newsFlowText("f.day.dd", "en", { n: 2, k: 1 })).toBe("2 reports in 1 story");
    expect(newsFlowText("f.day.dd", "zh", { n: 2, k: 1 })).toBe("2 条报道，归为 1 个新闻事件");
    expect(newsFlowText("count.many", "en", { n: 9999 })).toBe("9999 reports in 24h");
    // A missing var leaves the token untouched.
    expect(newsFlowText("count.many", "en")).toBe("{n} reports in 24h");
  });
});

describe("newsFlowLex — banned vocabulary (spec 3.5, G6)", () => {
  it("no EN string contains a banned term (word boundary, case-insensitive)", () => {
    for (const { key, text } of allStrings().filter((entry) => entry.lang === "en")) {
      for (const term of EN_BANNED) {
        expect(text, `${key}: ${text}`).not.toMatch(new RegExp(`\\b${term}\\b`, "i"));
      }
    }
  });

  it("no ZH string contains a banned term (substring)", () => {
    for (const { key, text } of allStrings().filter((entry) => entry.lang === "zh")) {
      for (const term of ZH_BANNED) {
        expect(text, `${key}: ${text}`).not.toContain(term);
      }
    }
  });
});

describe("newsFlowLex — G8 glance budget at n = 9999", () => {
  const COUNT_KEYS: NewsFlowKey[] = ["count.zero", "count.one", "count.many"];
  const COMPARE_KEYS: NewsFlowKey[] = ["cmp.busier", "cmp.typical", "cmp.quieter", "cmp.insufficient", "cmp.partial"];

  const enWords = (line: string) => line.split(/\s+/).filter((word) => word && word !== "·").length;
  const zhChars = (line: string) =>
    Array.from(line.replace(/[\s，、。：·]/g, "")).length;

  it.each(COUNT_KEYS.flatMap((count) => COMPARE_KEYS.map((compare) => [count, compare] as const)))(
    "%s + %s stays within the budget in EN and ZH",
    (countKey, compareKey) => {
      const vars = { n: 9999 };
      const en = `${newsFlowText(countKey, "en", vars)} · ${newsFlowText(compareKey, "en", vars)}`;
      const zh = `${newsFlowText(countKey, "zh", vars)} · ${newsFlowText(compareKey, "zh", vars)}`;
      expect(enWords(en), en).toBeLessThanOrEqual(9);
      expect(zhChars(zh), zh).toBeLessThanOrEqual(20);
    },
  );

  it("the unavailable sentence alone stays within the budget", () => {
    expect(enWords(newsFlowText("state.unavailable", "en"))).toBeLessThanOrEqual(9);
    expect(zhChars(newsFlowText("state.unavailable", "zh"))).toBeLessThanOrEqual(20);
  });

  it("the worst cases land exactly at the cap (9 EN words, 20 ZH characters)", () => {
    const worstEn = `${newsFlowText("count.many", "en", { n: 9999 })} · ${newsFlowText("cmp.insufficient", "en")}`;
    const worstZh = `${newsFlowText("count.many", "zh", { n: 9999 })} · ${newsFlowText("cmp.insufficient", "zh")}`;
    expect(enWords(worstEn)).toBe(9);
    expect(zhChars(worstZh)).toBe(20);
  });
});
