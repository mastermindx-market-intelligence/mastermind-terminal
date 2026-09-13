import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  pinLastReady,
  validateBriefBody,
  type BriefDelivery,
} from "@/lib/briefs";

const valid = {
  target: { kind: "thesis", id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "NVDA cycle", version_or_asof: "v3" },
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
