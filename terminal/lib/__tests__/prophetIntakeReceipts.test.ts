import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import * as ProphetViewModule from "@/components/prophet/ProphetView";
import { makeProphetT } from "@/components/prophet/prophetStrings";
import currentReceipts from "../../test-fixtures/prophet_intake_receipts_fixture.json";

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

// Original illustrative capped-name contract; the current 14-name cap is tested below.
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
    expect(html).toContain("Not selected in this snapshot");
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

    expect(html).toContain("本次快照未纳入");
    expect(html).toContain("7 / 22 只");
    expect(html).toContain(RECEIPTS.groups[0].zh);
    expect(html).toContain("另有 3 只已有在跑的计划");
    expect(html).not.toContain(RECEIPTS.groups[0].en);
    expect(html).not.toContain("Not selected in this snapshot");
  });

  it("renders nothing for absent, empty, or inconsistent receipts", () => {
    expect(renderShelf(undefined, "en")).toBe("");
    expect(renderShelf({ ...RECEIPTS, groups: [], declined: 0, open_now: 0 }, "en")).toBe("");
    expect(renderShelf({ ...RECEIPTS, considered: 2 }, "en")).toBe("");
  });
});

describe("current producer receipt contract", () => {
  it("retains full n=17 with the actual fourteen-name cap, copy, order and ticker punctuation", () => {
    const normalize = intakeModule.normalizeIntakeReceipts!;
    const original = structuredClone(currentReceipts);
    const result = normalize(currentReceipts);
    expect(result).not.toBeNull();
    expect(result?.declined).toBe(19);
    expect(result?.considered).toBe(30);
    expect(result?.openNow).toBe(3);
    expect(result?.groups.map(group => group.reason)).toEqual(currentReceipts.groups.map(group => group.reason));
    expect(result?.groups[0].n).toBe(17);
    expect(result?.groups[0].names).toHaveLength(14);
    expect(result?.groups[0].names.map(name => name.ticker)).toEqual(currentReceipts.groups[0].names.map(name => name.ticker));
    expect(result?.groups[0].en).toBe(currentReceipts.groups[0].en);
    expect(result?.groups[0].zh).toBe(currentReceipts.groups[0].zh);
    expect(currentReceipts).toEqual(original);
    const html = renderShelf(currentReceipts, "en");
    expect(html).toContain("19 of 30");
    expect(html).toContain("14 of 17 names shown");
    expect(html).toContain("BRK.B");
    expect(html).toContain("0700.HK");
    expect(html).not.toContain("validation_failed");
    expect(html).not.toContain("tonight");
  });

  it("keeps unmapped inside declined and preserves a new producer reason without a client vocabulary", () => {
    const raw = structuredClone(currentReceipts);
    raw.groups[1].reason = "unknown";
    raw.unmapped = 2;
    const result = intakeModule.normalizeIntakeReceipts!(raw);
    expect(result?.declined).toBe(19);
    expect(result?.groups[1].n).toBe(2);
    expect(renderShelf(raw, "en")).toContain("19 of 30");
    raw.groups[1].reason = "future_producer_reason";
    raw.unmapped = 0;
    expect(intakeModule.normalizeIntakeReceipts!(raw)?.groups[1].en).toBe(raw.groups[1].en);
  });

  it("escapes producer text and never upgrades it into markup or a trade control", () => {
    const raw = structuredClone(currentReceipts);
    raw.groups[1].en = "Producer <script>alert(1)</script> & text";
    const html = renderShelf(raw, "en");
    expect(html).toContain("Producer &lt;script&gt;alert(1)&lt;/script&gt; &amp; text");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<a ");
  });

  it.each([
    ["negative", -1], ["fraction", 1.5], ["string", "30"],
    ["boolean", true], ["not finite", Infinity], ["not a number", NaN],
    ["unsafe integer", Number.MAX_SAFE_INTEGER + 1], ["missing", undefined],
  ])("fails closed on %s headline counts", (_label, bad) => {
    expect(intakeModule.normalizeIntakeReceipts!({ ...currentReceipts, considered: bad })).toBeNull();
  });

  it.each(["planned", "passed", "open_now", "declined", "unmapped"] as const)(
    "rejects inconsistent %s instead of repairing or inferring totals", (key) => {
      expect(intakeModule.normalizeIntakeReceipts!({
        ...currentReceipts, [key]: currentReceipts[key] + 1,
      })).toBeNull();
    },
  );

  it.each([
    ["missing group", (raw: Record<string, unknown>) => { raw.groups = undefined; }],
    ["empty groups", (raw: Record<string, unknown>) => { raw.groups = []; }],
    ["zero group", (raw: Record<string, unknown>) => { (raw.groups as typeof currentReceipts.groups)[0].n = 0; }],
    ["missing copy", (raw: Record<string, unknown>) => { (raw.groups as typeof currentReceipts.groups)[0].zh = " "; }],
    ["empty identity", (raw: Record<string, unknown>) => { (raw.groups as typeof currentReceipts.groups)[0].names[0].ticker = " "; }],
    ["empty names", (raw: Record<string, unknown>) => { (raw.groups as typeof currentReceipts.groups)[0].names = []; }],
    ["excess names", (raw: Record<string, unknown>) => { (raw.groups as typeof currentReceipts.groups)[1].n = 1; }],
    ["nonfinite score", (raw: Record<string, unknown>) => { (raw.groups as typeof currentReceipts.groups)[0].names[0].score = Infinity; }],
    ["duplicate reason", (raw: Record<string, unknown>) => { (raw.groups as typeof currentReceipts.groups)[1].reason = "plan_not_built"; }],
  ] as const)("hides the entire shelf for %s", (_label, change) => {
    const raw: Record<string, unknown> = structuredClone(currentReceipts);
    change(raw);
    expect(intakeModule.normalizeIntakeReceipts!(raw)).toBeNull();
    expect(renderShelf(raw, "en")).toBe("");
  });

  it("distinguishes a valid observed zero from missing data, rendering neither as a receipt shelf", () => {
    const raw = { considered: 8, planned: 8, passed: 0, open_now: 0, declined: 0, unmapped: 0, groups: [] };
    expect(intakeModule.normalizeIntakeReceipts!(raw)).toEqual({ considered: 8, declined: 0, openNow: 0, groups: [] });
    expect(intakeModule.normalizeIntakeReceipts!(undefined)).toBeNull();
    expect(renderShelf(raw, "en")).toBe("");
    expect(renderShelf(undefined, "en")).toBe("");
  });
});
