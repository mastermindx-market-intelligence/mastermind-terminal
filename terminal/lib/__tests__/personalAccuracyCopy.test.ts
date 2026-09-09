import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LEX } from "@/lib/i18n";

const GLANCE_KEYS = [
  "accTitle",
  "accSub",
  "accStanceEarly",
  "accStanceMostly",
  "accStanceMixed",
  "accStanceNot",
  "accEmpty",
  "accEarlyN",
  "accCheckedN",
  "accCalibWithheld",
  "accUnscorableN",
  "accCeiling",
] as const;

const FROZEN_EN = [
  "Your calls, checked.",
  "We only check what you wrote down first: the call, the day it settles, and what would prove it wrong.",
  "Too early to say",
  "Mostly landing so far",
  "Mixed so far",
  "Not landing yet",
  "Nothing has settled yet. Your first call gets checked on the day you set.",
  "Too early to say — checked {n} of your calls so far.",
  "Checked so far: {n} of your calls.",
  "Not enough settled calls yet to check how well your odds match reality.",
  "{n} calls could not be checked — the data they named wasn't there.",
  "This is a learning record. It never changes what we show you, what we rank, or what you can do here.",
];

const FROZEN_ZH = [
  "你的判断，逐条核对。",
  "只核对你事先写下的：判断本身、结算日期，以及什么情况算判断错了。",
  "还看不出来",
  "目前多数落在正确一边",
  "目前好坏参半",
  "目前还没落在正确一边",
  "还没有到期的判断。第一条会在你设定的那天核对。",
  "还看不出来——目前核对了你的 {n} 条判断。",
  "已核对：你的 {n} 条判断。",
  "还没有足够的已结算判断来核对你的把握是否准确。",
  "有 {n} 条判断无法核对——所引用的数据不存在。",
  "这只是学习记录。它不会改变我们展示什么、如何排序，也不会改变你能做什么。",
];

const BANNED = [
  "Brier",
  "hit-rate",
  "hit rate",
  "p-value",
  "pvalue",
  "explanation_memory",
  "trial_ledger",
  "Calibration Lab",
  "right-for-right-reason",
  "validated",
  "已验证",
];

const ACCURACY_KEY = /^acc[A-Z]/;

describe("B-F13-5 glance copy", () => {
  it("glance LEX values match the frozen EN copy block verbatim", () => {
    GLANCE_KEYS.forEach((key, i) => {
      expect(LEX[key]?.[0], key).toBe(FROZEN_EN[i]);
    });
  });

  it("glance LEX values match the frozen ZH copy block verbatim", () => {
    GLANCE_KEYS.forEach((key, i) => {
      expect(LEX[key]?.[1], key).toBe(FROZEN_ZH[i]);
    });
  });

  it("every accuracy key carries both an EN and a ZH value", () => {
    const keys = Object.keys(LEX).filter((k) => ACCURACY_KEY.test(k));
    expect(keys.length).toBeGreaterThanOrEqual(GLANCE_KEYS.length);
    for (const key of keys) {
      const pair = LEX[key];
      expect(pair, key).toBeTruthy();
      expect(pair[0].trim().length, `${key} EN`).toBeGreaterThan(0);
      expect(pair[1].trim().length, `${key} ZH`).toBeGreaterThan(0);
    }
  });

  it("glance tier contains no banned vocabulary", () => {
    for (const key of GLANCE_KEYS) {
      const [en, zh] = LEX[key];
      const hay = `${en}\n${zh}`;
      for (const token of BANNED) {
        expect(hay.toLowerCase(), `${key} contains ${token}`).not.toContain(token.toLowerCase());
      }
    }
  });

  it("the {n} placeholder appears in exactly the three frozen sentences that carry it", () => {
    const withN = GLANCE_KEYS.filter((key) => LEX[key][0].includes("{n}"));
    expect(withN).toEqual(["accEarlyN", "accCheckedN", "accUnscorableN"]);
    for (const key of withN) {
      expect(LEX[key][1]).toContain("{n}");
    }
    for (const key of GLANCE_KEYS.filter((k) => !withN.includes(k))) {
      expect(LEX[key][0]).not.toContain("{n}");
      expect(LEX[key][1]).not.toContain("{n}");
    }
  });

  it("no glance string contains a percent sign or a decimal number", () => {
    for (const key of GLANCE_KEYS) {
      const [en, zh] = LEX[key];
      expect(en, key).not.toContain("%");
      expect(zh, key).not.toContain("%");
      expect(en, key).not.toMatch(/\d+\.\d+/);
      expect(zh, key).not.toMatch(/\d+\.\d+/);
    }
  });
});

describe("B-F13-5 authored extras stay sentences and stay out of the glance body", () => {
  it("accDetHitsOf is a sentence in both languages, not a slash fraction", () => {
    const [en, zh] = LEX.accDetHitsOf;
    expect(en).toContain("{hits}");
    expect(en).toContain("{n}");
    expect(zh).toContain("{hits}");
    expect(zh).toContain("{n}");
    expect(en.trim()).not.toMatch(/^\{hits\}\s+of\s+\{n\}$/);
    expect(zh.trim()).not.toMatch(/^\{hits\}\s*\/\s*\{n\}$/);
    expect(en).toMatch(/[.!?]$/);
    expect(zh).toMatch(/[。！？]$/);
    expect(en.replace(/\{hits\}|\{n\}/g, "").replace(/[\s.,]/g, "").length).toBeGreaterThan(6);
    expect(zh.replace(/\{hits\}|\{n\}/g, "").replace(/[\s，。、]/g, "").length).toBeGreaterThan(4);
  });

  it("accDetLoadErr is only rendered behind the detail control", () => {
    const src = readFileSync(
      join(__dirname, "../../components/settings/SectionAccuracy.tsx"),
      "utf8",
    );
    const loadAt = src.indexOf('t("accDetLoadErr")');
    const detailAt = src.indexOf("acs-acc-detail");
    const toggleAt = src.indexOf("accDetailOpen");
    expect(loadAt, "accDetLoadErr must be rendered").toBeGreaterThan(0);
    expect(detailAt, "detail pane must exist").toBeGreaterThan(0);
    expect(toggleAt, "detail toggle must exist").toBeGreaterThan(0);
    expect(loadAt).toBeGreaterThan(detailAt);
    expect(loadAt).toBeGreaterThan(toggleAt);
    const glance = src.slice(src.indexOf("acs-body"), detailAt);
    expect(glance).not.toContain('t("accDetLoadErr")');
  });
});
