import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  briefLanguageNotice,
  marketReadSentences,
  requiresExplicitBriefLanguage,
  fillTargetNames,
  monitorsSummary,
  pinLastReady,
  validateBriefBody,
  type BriefDelivery,
} from "@/lib/briefs";

const valid = {
  target: { kind: "thesis" as const, id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "NVDA cycle", version_or_asof: "v3" },
  market_read: [
    { section: "tape", sentence_en: "The close held above last week's range.", sentence_zh: "收盘守住了上周的区间。", asof: "2026-09-11" },
    { section: "flow", sentence_en: "Call buying stayed in the front week.", sentence_zh: "买权仍集中在近月。", asof: "2026-09-11" },
  ],
  monitors: [{ name: "range hold", state_en: "Holding", state_zh: "仍成立" }],
  artifact: { name: "US session digest", asof: "2026-09-11T20:05:00.000Z" },
};

describe("brief body schema guard", () => {
  it("accepts the frozen body shape", () => {
    expect(validateBriefBody(valid)).toEqual(valid);
  });

  it("rejects numeric judgement keys", () => {
    expect(validateBriefBody({ ...valid, score: 0.81 })).toBeNull();
    expect(validateBriefBody({ ...valid, target: { ...valid.target, confidence: 12 } })).toBeNull();
  });

  it("rejects LLM fields", () => {
    expect(validateBriefBody({ ...valid, prompt: "summarise" })).toBeNull();
    expect(validateBriefBody({ ...valid, llm: { model: "x" } })).toBeNull();
    expect(validateBriefBody({ ...valid, artifact: { ...valid.artifact, tokens: 12 } })).toBeNull();
  });

  it("rejects a missing sentence pair", () => {
    expect(validateBriefBody({
      ...valid,
      market_read: [{ section: "tape", sentence_en: "The close held.", asof: "2026-09-11" }],
    })).toBeNull();
  });
});


describe("explicit brief-language availability", () => {
  const mixed = {
    ...valid,
    market_read: [
      { ...valid.market_read[0], translation_status: "available" as const },
      { ...valid.market_read[1], sentence_zh: null, translation_status: "unavailable" as const },
    ],
  };

  it("preserves admitted null/status, target, monitors and source clocks", () => {
    expect(validateBriefBody(mixed)).toEqual(mixed);
    expect(requiresExplicitBriefLanguage(mixed)).toBe(true);
    expect(requiresExplicitBriefLanguage(valid)).toBe(false);
    expect(marketReadSentences(mixed, "en")).toEqual(valid.market_read.map((row) => row.sentence_en));
    expect(marketReadSentences(mixed, "zh")).toEqual([
      valid.market_read[0].sentence_zh,
      `英文原文：${valid.market_read[1].sentence_en}`,
    ]);
  });

  it.each([
    { sentence_zh: null },
    { sentence_zh: "", translation_status: "unavailable" },
    { sentence_zh: " ", translation_status: "available" },
    { sentence_zh: null, translation_status: "available" },
    { sentence_zh: "有中文。", translation_status: "unavailable" },
    { sentence_zh: "有中文。", translation_status: "pending" },
    { sentence_zh: null, translation_status: null },
    { sentence_zh: undefined, translation_status: "unavailable" },
  ])("rejects missing, unknown or contradictory language fields: %j", (fields) => {
    expect(validateBriefBody({
      ...valid, market_read: [{ ...valid.market_read[0], ...fields }],
    })).toBeNull();
  });

  it("keeps recursive forbidden fields excluded from admitted partial-language bodies", () => {
    expect(validateBriefBody({
      ...mixed,
      market_read: [{ ...mixed.market_read[1], translation_model: "test" }],
    })).toBeNull();
  });

  it("reports missing Chinese beyond the first two preview passages", () => {
    const body = { ...valid, market_read: [...valid.market_read, mixed.market_read[1]] };
    expect(marketReadSentences(body, "zh")).toEqual(valid.market_read.map((row) => row.sentence_zh));
    expect(briefLanguageNotice(body, "en")).toContain("2 of 3");
    expect(briefLanguageNotice(body, "zh")).toContain("2/3");
    expect(briefLanguageNotice(valid, "zh")).toBeNull();
    expect(briefLanguageNotice({ ...valid, market_read: [mixed.market_read[1]] }, "en")).toContain("0 of 1");
  });

  it("labels the exact historical pending-marker fallback without rewriting stored Chinese", () => {
    const row = valid.market_read[0];
    const stored = { ...valid, market_read: [{ ...row, sentence_zh: `${row.sentence_en} （翻译待补）` }] };
    expect(validateBriefBody(stored)).toEqual(stored);
    expect(marketReadSentences(stored, "zh")).toEqual([`英文原文：${row.sentence_en}`]);
    expect(briefLanguageNotice(stored, "en")).toContain("0 of 1");
    expect(requiresExplicitBriefLanguage(stored)).toBe(false);
  });
});

describe("pinLastReady", () => {
  const ready: BriefDelivery = {
    deliveryId: "d-ready",
    subscriptionId: "s1",
    slotAsof: "2026-09-10",
    state: "ready",
    degradedReason: null,
    artifactAsof: "2026-09-10T20:00:00.000Z",
    body: valid,
    createdAt: "2026-09-10T20:10:00.000Z",
    subscription: { targetKind: "thesis", targetId: "t1", cadence: "daily_after_us_close", state: "active" },
  };
  const degraded: BriefDelivery = {
    ...ready,
    deliveryId: "d-deg",
    slotAsof: "2026-09-11",
    state: "degraded",
    createdAt: "2026-09-11T20:10:00.000Z",
  };

  it("pins the last ready row when the newest is degraded", () => {
    const rows = pinLastReady([ready, degraded]);
    expect(rows[0].deliveryId).toBe("d-deg");
    expect(rows.find((r) => r.deliveryId === "d-ready")?.pinned).toBe(true);
  });

  it("does not synthesize a ready row when none exists", () => {
    const rows = pinLastReady([degraded]);
    expect(rows).toHaveLength(1);
    expect(rows[0].pinned).toBeUndefined();
  });
});

describe("no forbidden words in briefs copy", () => {
  it("never prints falsifier, refuted, or 证伪", () => {
    const src = readFileSync(join(__dirname, "../briefs.ts"), "utf8");
    expect(src).not.toMatch(/falsifier|refuted|证伪/i);
  });
});

describe("monitorsSummary", () => {
  it("uses the singular English word when there is one monitor", () => {
    expect(monitorsSummary(valid, "en")).toBe("1 monitor · Holding");
    expect(monitorsSummary(valid, "zh")).toBe("1 项监控 · 仍成立");
    expect(monitorsSummary(valid, "en")).not.toBe("1 monitors · Holding");
  });
});

describe("fillTargetNames", () => {
  it("copies a ready sibling's target name onto a degraded empty body", () => {
    const ready: BriefDelivery = {
      deliveryId: "d-ready",
      subscriptionId: "s1",
      slotAsof: "2026-09-10",
      state: "ready",
      degradedReason: null,
      artifactAsof: "2026-09-10T20:00:00.000Z",
      body: valid,
      createdAt: "2026-09-10T20:10:00.000Z",
      subscription: { targetKind: "thesis", targetId: valid.target.id, cadence: "daily_after_us_close", state: "active" },
    };
    const degraded: BriefDelivery = {
      ...ready,
      deliveryId: "d-deg",
      slotAsof: "2026-09-11",
      state: "degraded",
      body: {},
      createdAt: "2026-09-11T20:10:00.000Z",
    };
    const rows = fillTargetNames([degraded, ready], new Map());
    expect(rows.find((r) => r.deliveryId === "d-deg")?.subscription.targetName).toBe("NVDA cycle");
  });

  it("uses a joined theses/watchlists name when no sibling body has one", () => {
    const degraded: BriefDelivery = {
      deliveryId: "d-deg",
      subscriptionId: "s1",
      slotAsof: "2026-09-11",
      state: "degraded",
      degradedReason: null,
      artifactAsof: null,
      body: {},
      createdAt: "2026-09-11T20:10:00.000Z",
      subscription: { targetKind: "thesis", targetId: valid.target.id, cadence: "daily_after_us_close", state: "active" },
    };
    const joined = new Map([[`thesis:${valid.target.id}`, "NVDA cycle"]]);
    const rows = fillTargetNames([degraded], joined);
    expect(rows[0].subscription.targetName).toBe("NVDA cycle");
  });
});

describe("390 list layout is a full-width sentence, not a squeezed flex remainder", () => {
  it("gives .sentence flex-basis 100% and dates nowrap, never the 52px alerts .time", () => {
    const css = readFileSync(join(__dirname, "../../components/briefs/briefs.module.css"), "utf8");
    expect(css).toMatch(/\.sentence\s*\{[^}]*flex:\s*1 1 100%/);
    expect(css).toMatch(/\.briefDate\s*\{[^}]*white-space:\s*nowrap/);
    expect(css).not.toMatch(/width:\s*52px/);
    expect(css).not.toMatch(/\.sentence\s*\{[^}]*flex:\s*1\s*;/);
  });
});
