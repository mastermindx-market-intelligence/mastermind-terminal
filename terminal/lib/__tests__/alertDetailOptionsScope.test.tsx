// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import AlertDetail, { type AlertDetailData } from "@/components/alerts/AlertDetail";

const kinds = ["opt_premium_burst", "opt_0dte_spike"] as const;
const dataFor = (conditionType: string | null, holdingSymbol: string | null = "MARKET"): AlertDetailData => ({
  conditionText: "Options activity crossed its threshold.",
  holdingSymbol,
  summaryPlain: "The recorded options activity crossed its threshold.",
  conditionPlain: "Options activity crossed its threshold.",
  triggeredValue: 72.5,
  conditionType,
  firedAt: "2026-11-13T15:41:00Z",
  armedAt: "2026-11-12T12:00:00Z",
  evidenceUrl: "/options?tab=tide&receipt=aggregate-scope",
  lastAttemptAt: "2026-11-13T15:42:00Z",
  lastAttemptState: "READ_OK",
  lastSuccessAt: "2026-11-13T15:40:00Z",
  lastSuccessState: "READ_OK",
  resolution: "open",
  delivery: "failed",
  attempts: 2,
  lastError: "recorded-source-response",
  deliverAfter: null,
});

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function render(data: AlertDetailData, lang: "en" | "zh") {
  await act(async () => root.render(<AlertDetail data={data} lang={lang} onClose={() => {}} />));
  return document.body.querySelector<HTMLElement>('[role="dialog"]')!;
}
const leaf = (dialog: HTMLElement, value: string) =>
  [...dialog.querySelectorAll("span")].find(node => node.children.length === 0 && node.textContent === value);

describe("aggregate options alert detail identifies the covered tape", () => {
  for (const lang of ["en", "zh"] as const) for (const type of kinds) for (const kind of [undefined, "alert"] as const) {
    it(`${type} uses bounded scope in ${lang} with kind ${kind ?? "default"}`, async () => {
      const data = { ...dataFor(type), kind };
      const before = JSON.stringify(data);
      const dialog = await render(data, lang);
      const label = leaf(dialog, lang === "zh" ? "范围" : "Scope");
      expect(label).toBeDefined();
      expect(label?.parentElement?.textContent).toContain(lang === "zh" ? "覆盖范围内的期权交易" : "Covered options tape");
      expect(leaf(dialog, lang === "zh" ? "代码" : "Symbol")).toBeUndefined();
      expect(dialog.querySelector('a[href="/portfolio"]')).toBeNull();
      expect(dialog.textContent).not.toMatch(/MARKET|market-wide|全市场/);
      expect(dialog.querySelector('a[href="/options?tab=tide&receipt=aggregate-scope"]')).not.toBeNull();
      expect(leaf(dialog, lang === "zh" ? "时间线" : "Timeframe")).toBeDefined();
      expect(leaf(dialog, lang === "zh" ? "投递结果" : "Delivery")).toBeDefined();
      expect(dialog.querySelector("details")?.textContent).toContain("recorded-source-response");
      expect(dialog.querySelector("details")?.textContent).toContain("2");
      expect(JSON.stringify(data)).toBe(before);
    });
  }

  for (const type of kinds) for (const symbol of ["SPY", null]) {
    it(`${type} derives scope from the condition despite legacy symbol ${symbol}`, async () => {
      const dialog = await render(dataFor(type, symbol), "en");
      expect(leaf(dialog, "Scope")?.parentElement?.textContent).toContain("Covered options tape");
      expect(dialog.querySelector('a[href="/portfolio"]')).toBeNull();
      expect(leaf(dialog, "Symbol")).toBeUndefined();
      expect(dialog.textContent).not.toContain("SPY");
    });
  }

  it.each(["price", "opt_gamma_flip", null])("preserves ticker detail for %s", async type => {
    const dialog = await render(dataFor(type, "NVDA"), "en");
    expect(leaf(dialog, "Symbol")).toBeDefined();
    expect(leaf(dialog, "Scope")).toBeUndefined();
    expect(dialog.querySelector('a[href="/portfolio"]')?.textContent).toBe("NVDA");
  });

  for (const lang of ["en", "zh"] as const) {
    it(`preserves thesis detail in ${lang}`, async () => {
      const dialog = await render({ ...dataFor("opt_premium_burst"), kind: "thesis" }, lang);
      expect(leaf(dialog, lang === "zh" ? "范围" : "Scope")).toBeUndefined();
      expect(leaf(dialog, lang === "zh" ? "代码" : "Symbol")).toBeUndefined();
      expect(leaf(dialog, lang === "zh" ? "发生了什么" : "What changed")).toBeUndefined();
    });
    it(`preserves position event detail in ${lang}`, async () => {
      const dialog = await render({ ...dataFor("opt_premium_burst", "NVDA"), kind: "position" }, lang);
      expect(leaf(dialog, lang === "zh" ? "范围" : "Scope")).toBeUndefined();
      expect(leaf(dialog, lang === "zh" ? "事件" : "Event")).toBeDefined();
      expect(dialog.querySelector('a[href="/portfolio"]')?.textContent).toBe("NVDA");
      expect(dialog.textContent).toContain("The recorded options activity crossed its threshold.");
    });
  }
});
