import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FD } from "@/lib/flowdeskStrings";
import { getHeatmapStr } from "@/lib/heatmapStrings";
import { LEX } from "@/lib/i18n";
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
  SUBJECT_KIND_LABEL,
  SOURCE_KIND_LABEL,
  SOURCE_STATUS_LABEL,
  TOPIC_STATUS_LABEL,
  FLOW_SIDE_LABEL,
  deltaOiPutCallLabel,
  entryStatusLabel,
  flowSideLabel,
  sourceKindLabel,
  sourceStatusLabel,
  statTokenLabel,
  subjectKindLabel,
  topicStatusLabel,
  trustTierLabel,
  verdictLabel,
  volAboveOiLabel,
  widgetTypeLabel,
} from "@/lib/plainLabels";

function assertBilingual(pair: readonly [string, string], key: string) {
  expect(pair[0].trim(), `${key} EN`).not.toBe("");
  expect(pair[1].trim(), `${key} ZH`).not.toBe("");
}

const PUBLIC_DATA = join(__dirname, "../../public/data");

function walkStrings(node: unknown, visit: (key: string, value: string) => void): void {
  if (Array.isArray(node)) {
    for (const item of node) walkStrings(item, visit);
    return;
  }
  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (typeof value === "string") visit(key, value);
      else walkStrings(value, visit);
    }
  }
}

function liveManifestVerdicts(): string[] {
  const raw = JSON.parse(readFileSync(join(PUBLIC_DATA, "manifest.json"), "utf8"));
  const found = new Set<string>();
  walkStrings(raw, (key, value) => {
    if (key === "verdict" && value.trim()) found.add(value);
  });
  return [...found].sort();
}

function liveIntelUrgencyAndStatus(): string[] {
  const found = new Set<string>();
  for (const name of readdirSync(PUBLIC_DATA)) {
    if (!name.endsWith(".intel.json")) continue;
    const raw = JSON.parse(readFileSync(join(PUBLIC_DATA, name), "utf8"));
    walkStrings(raw, (key, value) => {
      if ((key === "urgency" || key === "status") && value.trim()) found.add(value);
    });
  }
  return [...found].sort();
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

  it("CUT is an exit word, never the fallback", () => {
    expect(verdictLabel("CUT", "en")).toBe("Cut");
    expect(verdictLabel("CUT", "zh")).toBe("减持");
    expect(verdictLabel("CUT", "zh")).not.toBe(notClassified("zh"));
    expect(verdictLabel("CUT", "en")).not.toBe("CUT");
  });

  it("every verdict in the live manifest has a pair in EN and ZH", () => {
    const verdicts = liveManifestVerdicts();
    expect(verdicts.length, "manifest must carry at least one verdict").toBeGreaterThan(0);
    for (const verdict of verdicts) {
      const en = verdictLabel(verdict, "en");
      const zh = verdictLabel(verdict, "zh");
      expect(en, `${verdict} EN`).not.toBe(notClassified("en"));
      expect(zh, `${verdict} ZH`).not.toBe(notClassified("zh"));
      expect(en, `${verdict} EN must not echo the enum`).not.toBe(verdict);
      expect(zh, `${verdict} ZH must not echo the enum`).not.toBe(verdict);
    }
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

  it("maps live intel urgency and wait_pullback, never the fallback", () => {
    expect(entryStatusLabel("avoid", "en")).toBe("Stand aside");
    expect(entryStatusLabel("avoid", "zh")).toBe("回避");
    expect(entryStatusLabel("later", "en")).toBe("Wait");
    expect(entryStatusLabel("later", "zh")).toBe("再等");
    expect(entryStatusLabel("wait_pullback", "en")).toBe("Wait for a dip");
    expect(entryStatusLabel("wait_pullback", "zh")).toBe("等待回撤");
  });

  it("an unmapped urgency falls through to the mapped status before the fallback", () => {
    expect(entryStatusLabel("no-such-urgency", "en", "blocked")).toBe("Blocked");
    expect(entryStatusLabel("no-such-urgency", "zh", "blocked")).toBe("受阻");
    expect(entryStatusLabel("avoid", "en", "blocked")).toBe("Stand aside");
    expect(entryStatusLabel("later", "zh", "wait_pullback")).toBe("再等");
  });

  it("every urgency and status in live intel files has a pair in EN and ZH", () => {
    const values = liveIntelUrgencyAndStatus();
    expect(values.length, "intel fixtures must carry urgency or status").toBeGreaterThan(0);
    for (const value of values) {
      const en = entryStatusLabel(value, "en");
      const zh = entryStatusLabel(value, "zh");
      expect(en, `${value} EN`).not.toBe(notClassified("en"));
      expect(zh, `${value} ZH`).not.toBe(notClassified("zh"));
      expect(en, `${value} EN must not echo the slug`).not.toBe(value);
      expect(zh, `${value} ZH must not echo the slug`).not.toBe(value);
    }
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

  it("spells out implied volatility and never returns the IV token", () => {
    expect(statTokenLabel("iv", "en")).toBe("Implied volatility");
    expect(statTokenLabel("iv", "zh")).toBe("隐含波动率");
    expect(statTokenLabel("iv", "en")).not.toBe("IV");
    expect(statTokenLabel("IV", "en")).not.toBe("IV");
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

function liveSubjectKinds(): string[] {
  const found = new Set<string>();
  function walkDir(dir: string) {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      try {
        const st = JSON.parse(readFileSync(full, "utf8"));
        walkStrings(st, (key, value) => {
          if (key === "kind" && (value === "issuer" || value === "theme")) found.add(value);
        });
      } catch {
        /* not a JSON file */
      }
    }
  }
  walkDir(PUBLIC_DATA);
  return [...found].sort();
}

describe("subjectKindLabel", () => {
  it("every mapped kind has a non-empty EN and ZH label", () => {
    for (const [key, pair] of Object.entries(SUBJECT_KIND_LABEL)) {
      assertBilingual(pair, key);
    }
  });

  it("known kinds are retail words, never the slug", () => {
    expect(subjectKindLabel("issuer", "en")).toBe("Company listing");
    expect(subjectKindLabel("issuer", "zh")).toBe("上市公司");
    expect(subjectKindLabel("theme", "en")).toBe("Theme");
    expect(subjectKindLabel("theme", "zh")).toBe("主题");
    expect(subjectKindLabel("issuer", "en")).not.toBe("issuer");
    expect(subjectKindLabel("theme", "zh")).not.toBe("theme");
  });

  it("unknown kind never returns the raw value", () => {
    expect(subjectKindLabel("basket", "en")).toBe(notClassified("en"));
    expect(subjectKindLabel("basket", "zh")).toBe(notClassified("zh"));
    expect(subjectKindLabel("basket", "en")).not.toBe("basket");
    expect(subjectKindLabel("", "zh")).toBe(notClassified("zh"));
  });

  it("every issuer/theme kind in live fixture data has a pair in EN and ZH", () => {
    const kinds = new Set(["issuer", "theme", ...liveSubjectKinds()]);
    for (const kind of kinds) {
      const en = subjectKindLabel(kind, "en");
      const zh = subjectKindLabel(kind, "zh");
      expect(en, `${kind} EN`).not.toBe(notClassified("en"));
      expect(zh, `${kind} ZH`).not.toBe(notClassified("zh"));
      expect(en, `${kind} EN must not echo the slug`).not.toBe(kind);
      expect(zh, `${kind} ZH must not echo the slug`).not.toBe(kind);
    }
  });
});

function liveFlowSides(): string[] {
  const found = new Set<string>();
  function walkDir(dir: string) {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      let st: unknown;
      try {
        st = JSON.parse(readFileSync(full, "utf8"));
      } catch {
        continue;
      }
      walkStrings(st, (key, value) => {
        if (key === "side" && value.trim()) found.add(value);
      });
    }
  }
  walkDir(PUBLIC_DATA);
  return [...found].sort();
}

describe("flowSideLabel", () => {
  it("every mapped side has a non-empty EN and ZH label", () => {
    for (const [key, pair] of Object.entries(FLOW_SIDE_LABEL)) {
      assertBilingual(pair, key);
    }
  });

  it("spells out inferred lean and never echoes the token", () => {
    expect(flowSideLabel("~buy", "en")).toBe("Likely buying");
    expect(flowSideLabel("~buy", "zh")).toBe("偏买入");
    expect(flowSideLabel("~sell", "en")).toBe("Likely selling");
    expect(flowSideLabel("~sell", "zh")).toBe("偏卖出");
    expect(flowSideLabel("mixed", "en")).toBe("Mixed");
    expect(flowSideLabel("mixed", "zh")).toBe("混合");
    expect(flowSideLabel("~buy", "en")).not.toBe("~buy");
  });

  it("every side in live flow fixture data has a pair in EN and ZH", () => {
    const sides = liveFlowSides();
    expect(sides.length, "flow fixtures must carry side").toBeGreaterThan(0);
    for (const side of sides) {
      const en = flowSideLabel(side, "en");
      const zh = flowSideLabel(side, "zh");
      expect(en, `${side} EN`).not.toBe(notClassified("en"));
      expect(zh, `${side} ZH`).not.toBe(notClassified("zh"));
      expect(en, `${side} EN must not echo the token`).not.toBe(side);
      expect(zh, `${side} ZH must not echo the token`).not.toBe(side);
    }
  });
});

describe("sourceKindLabel", () => {
  it("every mapped kind has a non-empty EN and ZH label", () => {
    for (const [key, pair] of Object.entries(SOURCE_KIND_LABEL)) {
      assertBilingual(pair, key);
    }
  });

  it("known kinds are retail words, never the slug", () => {
    expect(sourceKindLabel("transcript", "en")).toBe("Earnings call transcript");
    expect(sourceKindLabel("transcript", "zh")).toBe("电话会记录");
    expect(sourceKindLabel("issuer_release", "en")).toBe("Company filing");
    expect(sourceKindLabel("score_overlay", "zh")).toBe("结构化事件分析");
    expect(sourceKindLabel("edgar_collector", "en")).toBe("SEC filing feed");
    expect(sourceKindLabel("edgar_collector", "zh")).toBe("监管申报来源");
    expect(sourceKindLabel("transcript", "en")).not.toBe("transcript");
  });

  it("unknown kind never returns the raw value", () => {
    expect(sourceKindLabel("mystery_kind", "en")).toBe(notClassified("en"));
    expect(sourceKindLabel("mystery_kind", "zh")).toBe(notClassified("zh"));
    expect(sourceKindLabel("mystery_kind", "en")).not.toBe("mystery_kind");
  });
});

describe("sourceStatusLabel", () => {
  it("every mapped status has a non-empty EN and ZH label", () => {
    for (const [key, pair] of Object.entries(SOURCE_STATUS_LABEL)) {
      assertBilingual(pair, key);
    }
  });

  it("known statuses are retail words, never the slug", () => {
    expect(sourceStatusLabel("present", "en")).toBe("Present");
    expect(sourceStatusLabel("present", "zh")).toBe("可用");
    expect(sourceStatusLabel("metadata_only", "en")).toBe("Recorded, file missing");
    expect(sourceStatusLabel("metadata_only", "zh")).toBe("有记录，无正文");
    expect(sourceStatusLabel("address_only", "en")).toBe("Address only");
    expect(sourceStatusLabel("address_only", "zh")).toBe("仅有地址");
    expect(sourceStatusLabel("present", "en")).not.toBe("present");
    expect(sourceStatusLabel("metadata_only", "zh")).not.toContain("元数据");
  });

  it("unknown status never returns the raw value", () => {
    expect(sourceStatusLabel("weird_status", "en")).toBe(notClassified("en"));
    expect(sourceStatusLabel("weird_status", "zh")).toBe(notClassified("zh"));
  });
});

describe("topicStatusLabel", () => {
  it("every mapped status has a non-empty EN and ZH label", () => {
    for (const [key, pair] of Object.entries(TOPIC_STATUS_LABEL)) {
      assertBilingual(pair, key);
    }
  });

  it("known statuses are retail words, never the slug", () => {
    expect(topicStatusLabel("added", "en")).toBe("Added");
    expect(topicStatusLabel("added", "zh")).toBe("新增");
    expect(topicStatusLabel("persistent", "en")).toBe("Persistent");
    expect(topicStatusLabel("persistent", "zh")).toBe("延续");
    expect(topicStatusLabel("dropped", "en")).toBe("Dropped");
    expect(topicStatusLabel("dropped", "zh")).toBe("退出");
    expect(topicStatusLabel("added", "en")).not.toBe("added");
  });
});

describe("deltaOiPutCallLabel", () => {
  it("spells out the open-interest change and never contains a raw OI token", () => {
    expect(deltaOiPutCallLabel("en")).toBe("Open-interest change, puts vs calls");
    expect(deltaOiPutCallLabel("zh")).toBe("未平仓量变化（认沽/认购）");
    expect(deltaOiPutCallLabel("en").toLowerCase()).not.toMatch(/\boi\b/);
    expect(deltaOiPutCallLabel("zh")).not.toMatch(/OI/i);
  });
});

describe("batch 3 retail register", () => {
  it("carried copy lines from #541 are in place", () => {
    expect(subjectKindLabel("issuer", "zh")).toBe("上市公司");
    expect(LEX.gpGuardrail[0]).toBe("When not to trust it");
    expect(LEX.gpGuardrail[1]).toBe("使用边界");
  });

  it("flow-desk caveats never mention NBBO, v1, tick-rule, or enrich artifact", () => {
    const joined = [
      FD.leanHeuristic.en, FD.leanHeuristic.zh,
      FD.sweepHeuristic.en, FD.sweepHeuristic.zh,
      FD.detectionsCaveat.en, FD.detectionsCaveat.zh,
    ].join("\n");
    expect(joined).not.toMatch(/\bNBBO\b/);
    expect(joined).not.toMatch(/tick-rule/i);
    expect(joined).not.toContain("v1");
    expect(joined).not.toContain("enrich artifact");
    expect(joined).not.toContain("启发式");
  });

  it("heatmap legend words are spelled out, never the old lowercase tokens", () => {
    expect(getHeatmapStr("en", "netPut")).toBe("Net puts");
    expect(getHeatmapStr("zh", "netPut")).toBe("净认沽");
    expect(getHeatmapStr("en", "netCall")).toBe("Net calls");
    expect(getHeatmapStr("en", "magnitudeOnly")).toBe("Size only");
    expect(getHeatmapStr("en", "directionIsSoft")).toBe("Direction is a soft read");
    expect(getHeatmapStr("en", "netPut")).not.toBe("net put");
  });

  it("pine status and company Q&A copy are sentences, not machine fragments", () => {
    expect(LEX.peUnsavedChanges[0]).toBe("Unsaved changes");
    expect(LEX.peReadyToAdd[0]).toBe("Ready to add to the chart");
    expect(LEX.peError[0]).toBe("Couldn’t save");
    expect(LEX.ciQaStructure[0]).not.toContain("enrichment");
    expect(LEX.ciOpenInTranscript[0]).toBe("Open in the earnings call");
    expect(LEX.ciOpenInTranscript[1]).toBe("在电话会中查看");
  });

  it("peReadOnly is a retail sentence, not heading-only machine chrome", () => {
    expect(LEX.peReadOnly[0]).toBe("Protected source — view only");
    expect(LEX.peReadOnly[1]).toBe("受保护的源码，仅可查看。");
    expect(LEX.peReadOnly[0].toLowerCase()).not.toContain("proprietary");
    expect(LEX.peReadOnly[0].toLowerCase()).not.toContain("read-only");
    expect(LEX.peReadOnly[1]).not.toContain("自研 · 只读");
  });

  it("pine library-row copy names the language and the last-edited date", () => {
    expect(LEX.peLangPine[0]).toBe("Pine");
    expect(LEX.peLangPine[1]).toBe("Pine 脚本");
    expect(LEX.peLangScript[0]).toBe("Script");
    expect(LEX.peLangScript[1]).toBe("脚本");
    expect(LEX.peLastEdited[0]).toContain("Last edited");
    expect(LEX.peLastEdited[1]).toContain("上次修改");
  });
});
