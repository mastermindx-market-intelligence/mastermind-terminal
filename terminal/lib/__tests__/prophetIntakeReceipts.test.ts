import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import * as ProphetViewModule from "@/components/prophet/ProphetView";
import { makeProphetT } from "@/components/prophet/prophetStrings";

type ReceiptName = {
  ticker: string;
  name: string;
  score: number | null;
};

type ReceiptGroup = {
  reason: string;
  en: string;
  zh: string;
  near: boolean;
  n: number;
  names: ReceiptName[];
};

type ReceiptSummary = {
  considered: number;
  declined: number;
  openNow: number;
  groups: ReceiptGroup[];
};

type IntakeReceiptModule = {
  normalizeIntakeReceipts?: (raw: unknown) => ReceiptSummary | null;
  IntakeReceiptShelf?: ComponentType<{
    receipts: unknown;
    lang: "en" | "zh";
    t: ReturnType<typeof makeProphetT>;
  }>;
};

const intakeModule = ProphetViewModule as unknown as IntakeReceiptModule;

const RECEIPTS = {
  considered: 22,
  planned: 12,
  passed: 10,
  open_now: 3,
  declined: 7,
  unmapped: 0,
  groups: [
    {
      reason: "plan_not_built",
      en: "Passed initial screening — no validated entry plan was produced.",
      zh: "初筛已通过 — 尚未生成经核验的入场计划。",
      near: true,
      n: 7,
      names: [
        { ticker: "PG", name: "Procter + Gamble", score: 59.4, why: ["plan_not_built"] },
        { ticker: "PCRX", name: "Pacira BioSciences", score: 55.4, why: ["plan_not_built", "no_trigger"] },
      ],
    },
    {
      reason: "already_open",
      en: "Already has a plan running",
      zh: "已有在跑的计划",
      near: true,
      n: 3,
      names: [
        { ticker: "UBER", name: "Uber Technologies", score: 70, why: ["already_open"] },
      ],
    },
  ],
};

function renderShelf(receipts: unknown, lang: "en" | "zh"): string {
  const Shelf = intakeModule.IntakeReceiptShelf;
  expect(Shelf, "ProphetView must export the receipt shelf").toBeTypeOf("function");
  if (!Shelf) return "";
  return renderToStaticMarkup(
    createElement(Shelf, { receipts, lang, t: makeProphetT(lang) }),
  );
}

describe("normalizeIntakeReceipts", () => {
  it("accepts the producer's capped-name contract without recomputing true counts", () => {
    const normalize = intakeModule.normalizeIntakeReceipts;
    expect(normalize, "ProphetView must export the strict receipt reader").toBeTypeOf("function");
    if (!normalize) return;

    const result = normalize(RECEIPTS);

    expect(result).toEqual({
      considered: 22,
      declined: 7,
      openNow: 3,
      groups: [
        {
          reason: "plan_not_built",
          en: RECEIPTS.groups[0].en,
          zh: RECEIPTS.groups[0].zh,
          near: true,
          n: 7,
          names: [
            { ticker: "PG", name: "Procter + Gamble", score: 59.4 },
            { ticker: "PCRX", name: "Pacira BioSciences", score: 55.4 },
          ],
        },
        {
          reason: "already_open",
          en: RECEIPTS.groups[1].en,
          zh: RECEIPTS.groups[1].zh,
          near: true,
          n: 3,
          names: [{ ticker: "UBER", name: "Uber Technologies", score: 70 }],
        },
      ],
    });
    expect(result?.groups[0].n).toBe(7);
    expect(result?.groups[0].names).toHaveLength(2);
  });

  it("fails closed when group arithmetic cannot reproduce the producer headline", () => {
    const normalize = intakeModule.normalizeIntakeReceipts;
    expect(normalize).toBeTypeOf("function");
    if (!normalize) return;

    expect(normalize({ ...RECEIPTS, declined: 6 })).toBeNull();
    expect(normalize({ ...RECEIPTS, open_now: 2 })).toBeNull();
  });

  it("fails closed on malformed translated copy or ticker identity", () => {
    const normalize = intakeModule.normalizeIntakeReceipts;
    expect(normalize).toBeTypeOf("function");
    if (!normalize) return;

    const missingChinese = structuredClone(RECEIPTS);
    missingChinese.groups[0].zh = "";
    expect(normalize(missingChinese)).toBeNull();

    const missingTicker = structuredClone(RECEIPTS);
    missingTicker.groups[0].names[0].ticker = "";
    expect(normalize(missingTicker)).toBeNull();
  });
});

describe("IntakeReceiptShelf", () => {
  it("renders a collapsed English shelf from producer copy and never exposes machine slugs", () => {
    const html = renderShelf(RECEIPTS, "en");

    expect(html).toContain('<details class="obs-prophet-intake-receipts">');
    expect(html).not.toContain("<details open");
    expect(html).toContain("Passed on tonight");
    expect(html).toContain("7 of 22");
    expect(html).toContain(RECEIPTS.groups[0].en);
    expect(html).toContain("PG");
    expect(html).toContain("PCRX");
    expect(html).toContain("3 more already have a plan running");
    expect(html).not.toContain(RECEIPTS.groups[0].zh);
    expect(html).not.toContain("plan_not_built");
    expect(html).not.toContain("already_open");
    expect(html).not.toContain("no_trigger");
  });

  it("renders the same receipt in Chinese without leaking English chrome or producer copy", () => {
    const html = renderShelf(RECEIPTS, "zh");

    expect(html).toContain("今晚未纳入");
    expect(html).toContain("7 / 22 只");
    expect(html).toContain(RECEIPTS.groups[0].zh);
    expect(html).toContain("另有 3 只已有在跑的计划");
    expect(html).not.toContain(RECEIPTS.groups[0].en);
    expect(html).not.toContain("Passed on tonight");
  });

  it("renders nothing for absent, empty, or inconsistent receipts", () => {
    expect(renderShelf(undefined, "en")).toBe("");
    expect(renderShelf({ ...RECEIPTS, groups: [], declined: 0, open_now: 0 }, "en")).toBe("");
    expect(renderShelf({ ...RECEIPTS, considered: 2 }, "en")).toBe("");
  });
});
