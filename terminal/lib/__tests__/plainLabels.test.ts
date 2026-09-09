import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CLASSIC_CATEGORY_TKEY,
  CLASSIC_INDICATOR_CATEGORIES,
  MACRO_DURATION_ZH,
  MACRO_INFLATION_ZH,
  MACRO_REGIME_ZH,
  PLAN_TIER_TKEY,
  TRUST_TIER_LABEL,
  classicCategoryLabel,
  macroChipLabel,
  mappedOrNeutral,
  notClassified,
  planTierLabel,
  regimeLabel,
  SIGNAL_VERDICT_LABEL,
  STAT_TOKEN_LABEL,
  WIDGET_TYPE_LABEL,
  entryStatusLabel,
  statTokenLabel,
  trustTierLabel,
  verdictLabel,
  volAboveOiLabel,
  widgetTypeLabel,
} from "@/lib/plainLabels";

function assertBilingual(pair: readonly [string, string], key: string) {
  expect(pair[0].trim(), `${key} EN`).not.toBe("");
  expect(pair[1].trim(), `${key} ZH`).not.toBe("");
}

describe("notClassified", () => {
  it("returns the bilingual neutral label and never the input key", () => {
    expect(notClassified("en")).toBe("Not classified");
    expect(notClassified("zh")).toBe("未分类");
    expect(notClassified("en")).not.toBe("event-edge");
    expect(notClassified("zh")).not.toBe("event-edge");
  });
});

describe("regimeLabel", () => {
  it("uses the lex hit when the translator returns a label", () => {
    const t = (key: string) => (key === "regimePIN" ? "Pin" : "");
    expect(regimeLabel(t, "PIN", "en")).toBe("Pin");
  });

  it("unknown regime never returns the raw value", () => {
    const miss = () => "";
    expect(regimeLabel(miss, "NOTAREGIME", "en")).toBe(notClassified("en"));
    expect(regimeLabel(miss, "NOTAREGIME", "zh")).toBe(notClassified("zh"));
    expect(regimeLabel(miss, "NOTAREGIME", "en")).not.toBe("NOTAREGIME");
    expect(regimeLabel(miss, "NOTAREGIME", "zh")).not.toBe("NOTAREGIME");
  });
});

describe("TRUST_TIER_LABEL", () => {
  it("every mapped tier has a non-empty EN and ZH label", () => {
    for (const [key, pair] of Object.entries(TRUST_TIER_LABEL)) {
      assertBilingual(pair, key);
    }
  });

  it("unknown trust tier never returns the raw value", () => {
    expect(trustTierLabel("not-a-tier", "en")).toBe(notClassified("en"));
    expect(trustTierLabel("not-a-tier", "zh")).toBe(notClassified("zh"));
    expect(trustTierLabel("not-a-tier", "en")).not.toBe("not-a-tier");
  });

  it("validated is a statistical gate, not a human review; context is 背景因素", () => {
    expect(trustTierLabel("validated", "en")).toBe("Passed checks");
    expect(trustTierLabel("validated", "zh")).toBe("已通过检验");
    expect(trustTierLabel("context", "en")).toBe("Context");
    expect(trustTierLabel("context", "zh")).toBe("背景因素");
  });
});

describe("macro EN→ZH maps", () => {
  it("every duration / regime / inflation EN value has a non-empty ZH label", () => {
    for (const [key, zh] of Object.entries(MACRO_DURATION_ZH)) {
      expect(key.trim(), "duration EN").not.toBe("");
      expect(zh.trim(), `${key} ZH`).not.toBe("");
    }
    for (const [key, zh] of Object.entries(MACRO_REGIME_ZH)) {
      expect(key.trim(), "regime EN").not.toBe("");
      expect(zh.trim(), `${key} ZH`).not.toBe("");
    }
    for (const [key, zh] of Object.entries(MACRO_INFLATION_ZH)) {
      expect(key.trim(), "inflation EN").not.toBe("");
      expect(zh.trim(), `${key} ZH`).not.toBe("");
    }
  });

  it("zh uses the map and falls back to the EN prose, never a key", () => {
    expect(macroChipLabel("Duration-neutral", MACRO_DURATION_ZH, "en")).toBe("Duration-neutral");
    expect(macroChipLabel("Duration-neutral", MACRO_DURATION_ZH, "zh")).toBe(MACRO_DURATION_ZH["Duration-neutral"]);
    expect(macroChipLabel("Unmapped prose", MACRO_DURATION_ZH, "zh")).toBe("Unmapped prose");
    expect(macroChipLabel("Unmapped prose", MACRO_DURATION_ZH, "zh")).not.toBe("duration_en");
  });

  it("keeps only EN strings observed in-repo — no guessed duration/regime/inflation keys", () => {
    expect(Object.keys(MACRO_DURATION_ZH)).toEqual(["Duration-neutral"]);
    expect(Object.keys(MACRO_REGIME_ZH)).toEqual(["rate-neutral"]);
    expect(Object.keys(MACRO_INFLATION_ZH)).toEqual(["Inflation-neutral"]);
  });
});

describe("PLAN_TIER_TKEY", () => {
  it("maps each plan slug to the onboarding i18n key", () => {
    expect(PLAN_TIER_TKEY.free).toBe("obPlanFree");
    expect(PLAN_TIER_TKEY.essential).toBe("obPlanInsider");
    expect(PLAN_TIER_TKEY.pro).toBe("obPlanPro");
  });

  it("unknown plan tier never returns the raw value", () => {
    const echo = (key: string, fallback?: string) => fallback ?? key;
    expect(planTierLabel("enterprise", echo, "en")).toBe(notClassified("en"));
    expect(planTierLabel("enterprise", echo, "zh")).toBe(notClassified("zh"));
    expect(planTierLabel("enterprise", echo, "en")).not.toBe("enterprise");
  });

  it("known tiers use the translator, never the raw slug", () => {
    const t = (key: string) =>
      ({ obPlanFree: "Free", obPlanInsider: "Essential", obPlanPro: "Pro" }[key] ?? "");
    expect(planTierLabel("free", t, "en")).toBe("Free");
    expect(planTierLabel("essential", t, "en")).toBe("Essential");
    expect(planTierLabel("pro", t, "en")).toBe("Pro");
    expect(planTierLabel("free", t, "en")).not.toBe("free");
  });
});

describe("classic indicator categories", () => {
  it("every category that can reach the library has a tkey", () => {
    for (const category of CLASSIC_INDICATOR_CATEGORIES) {
      expect(CLASSIC_CATEGORY_TKEY[category].trim(), category).not.toBe("");
    }
  });

  it("covers every CATS key in IndicatorsModal", () => {
    const src = readFileSync(join(__dirname, "../../components/IndicatorsModal.tsx"), "utf8");
    const block = src.match(/const CATS: Record<string, ClassicIndicator\[\]> = \{([\s\S]*?)\n\};/);
    expect(block).not.toBeNull();
    const keys = [...block![1].matchAll(/^\s+(?:(\w+)|"([^"]+)"):/gm)].map((m) => m[1] ?? m[2]);
    expect(keys.sort()).toEqual([...CLASSIC_INDICATOR_CATEGORIES].sort());
  });

  it("unmapped category never returns the raw key", () => {
    const echo = (key: string, fallback?: string) => fallback ?? key;
    expect(classicCategoryLabel("not-a-category", echo, "en")).toBe(notClassified("en"));
    expect(classicCategoryLabel("not-a-category", echo, "zh")).toBe(notClassified("zh"));
    expect(classicCategoryLabel("not-a-category", echo, "en")).not.toBe("not-a-category");
  });
});

describe("mappedOrNeutral", () => {
  it("missing map entries use the neutral label, never the raw slug", () => {
    expect(mappedOrNeutral(undefined, "en")).toBe(notClassified("en"));
    expect(mappedOrNeutral(undefined, "zh")).toBe(notClassified("zh"));
    expect(mappedOrNeutral("TECH", "en")).toBe("TECH");
  });
});

describe("verdictLabel", () => {
  it("every mapped verdict has a non-empty EN and ZH label", () => {
    for (const [key, pair] of Object.entries(SIGNAL_VERDICT_LABEL)) {
      assertBilingual(pair, key);
    }
  });

  it("unknown verdict never returns the raw value", () => {
    expect(verdictLabel("HOLD", "en")).toBe(notClassified("en"));
    expect(verdictLabel("HOLD", "zh")).toBe(notClassified("zh"));
    expect(verdictLabel("HOLD", "en")).not.toBe("HOLD");
  });

  it("known verdicts are retail words, never the enum", () => {
    expect(verdictLabel("BUY", "en")).toBe("Buy");
    expect(verdictLabel("BUY", "zh")).toBe("买入");
    expect(verdictLabel("REBUY", "en")).toBe("Buy again");
    expect(verdictLabel("REBUY", "zh")).toBe("再次买入");
    expect(verdictLabel("STOP", "en")).toBe("Stop");
    expect(verdictLabel("STOP", "zh")).toBe("止损");
    expect(verdictLabel("EARLY", "en")).toBe("Early watch");
    expect(verdictLabel("EARLY", "zh")).toBe("提前关注");
    expect(verdictLabel("RECLAIM", "en")).toBe("Take back");
    expect(verdictLabel("RECLAIM", "zh")).toBe("重新站上");
    expect(verdictLabel("RECLAIM", "en")).not.toBe("RECLAIM");
    expect(verdictLabel("RECLAIM", "zh")).not.toBe("Reclaim");
  });
});

describe("entryStatusLabel", () => {
  it("maps open and blocked and never echoes the slug", () => {
    expect(entryStatusLabel("open", "en")).toBe("Window open");
    expect(entryStatusLabel("open", "zh")).toBe("窗口已开");
    expect(entryStatusLabel("blocked", "en")).toBe("Blocked");
    expect(entryStatusLabel("blocked", "zh")).toBe("受阻");
    expect(entryStatusLabel("open", "en")).not.toBe("open");
  });

  it("keeps a spaced phrase in English and translates Act now in Chinese", () => {
    expect(entryStatusLabel("Act now", "en")).toBe("Act now");
    expect(entryStatusLabel("Act now", "zh")).toBe("现在行动");
    expect(entryStatusLabel("Act now", "zh")).not.toBe("Act now");
    expect(entryStatusLabel("urgent", "en")).toBe(notClassified("en"));
    expect(entryStatusLabel("urgent", "en")).not.toBe("urgent");
  });
});

describe("statTokenLabel", () => {
  it("every mapped token has a non-empty EN and ZH label", () => {
    for (const [key, pair] of Object.entries(STAT_TOKEN_LABEL)) {
      assertBilingual(pair, key);
    }
  });

  it("spells out open interest and never returns oi", () => {
    expect(statTokenLabel("oi", "en")).toBe("Open interest");
    expect(statTokenLabel("oi", "zh")).toBe("未平仓合约");
    expect(statTokenLabel("OI", "en")).not.toBe("OI");
    expect(statTokenLabel("iv_rank", "en")).toBe("IV rank");
    expect(statTokenLabel("iv_rank", "zh")).toBe("隐含波动率百分位");
  });
});

describe("volAboveOiLabel", () => {
  it("never contains the raw OI token", () => {
    expect(volAboveOiLabel("en")).toBe("Volume above open interest");
    expect(volAboveOiLabel("zh")).toBe("成交量高于未平仓量");
    expect(volAboveOiLabel("en").toLowerCase()).not.toMatch(/\boi\b/);
    expect(volAboveOiLabel("zh")).not.toMatch(/OI/i);
  });
});

describe("widgetTypeLabel", () => {
  it("every mapped type has a non-empty EN and ZH label", () => {
    for (const [key, pair] of Object.entries(WIDGET_TYPE_LABEL)) {
      assertBilingual(pair, key);
    }
  });

  it("unknown widget type never returns the raw slug", () => {
    expect(widgetTypeLabel("screener", "en")).toBe("Screener");
    expect(widgetTypeLabel("screener", "zh")).toBe("选股");
    expect(widgetTypeLabel("pane", "en")).toBe("Panel");
    expect(widgetTypeLabel("pane", "zh")).toBe("面板");
    expect(widgetTypeLabel("pane", "en")).not.toBe("Pane");
    expect(widgetTypeLabel("mystery-pane", "en")).toBe(notClassified("en"));
    expect(widgetTypeLabel("mystery-pane", "en")).not.toBe("mystery-pane");
  });
});
