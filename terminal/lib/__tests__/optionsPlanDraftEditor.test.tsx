// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OptionsPlanDraftEditor } from "@/components/options/OptionsPlanDraftEditor";
import { buildPin } from "../optionsContractShortlist";
import { createOptionsPlanDraft, type OptionsPlanDraft } from "../optionsPlanDraft";

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
function source() {
  const row = { root: "NVDA1", right: "C", exp: "2026-11-20", strike: 180, mid: 4.5, oi: 10 };
  const p = buildPin(row, { family: "doi", asof: "2026-10-23T20:00:00Z", schema: null, stale: true, hotView: null }, [row]);
  if (!p.ok) throw new Error(p.reason);
  const d = createOptionsPlanDraft([p.pin]); if (!d.ok) throw new Error(d.reason); return d.value;
}
async function change(label: string, value: string) {
  const l = [...host.querySelectorAll("label")].find(x => x.textContent?.startsWith(label));
  const control = l?.querySelector("input,textarea,select") as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  if (!control) throw new Error(`Missing field: ${label}`);
  const prototype = control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(control, value); control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? "change" : "input", { bubbles: true })); });
}
async function submit() { await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); }
describe("prepared Plan editor integration seam", () => {
  it.each(["en", "zh"] as const)("keeps source evidence and unknown quote/terms visible in %s with no fake save", async lang => {
    const applied = vi.fn(), close = vi.fn(), d = source();
    await act(async () => root.render(<OptionsPlanDraftEditor draft={d} lang={lang} onApply={applied} onClose={close} />));
    expect(host.textContent).toContain("NVDA1");
    expect(host.textContent).toContain("2026-10-23T20:00:00Z");
    expect(host.textContent).toContain(lang === "en" ? "not saved to your account" : "尚未保存到账户");
    expect(host.querySelector('[data-plan-field="mid"]')?.textContent).toContain("4.5");
    expect(host.querySelector('[data-plan-field="bid_ask"] [data-cell-state]')?.getAttribute("data-cell-state")).toBe("not_supplied");
    expect(host.querySelector('[data-plan-field="multiplier"] [data-cell-state]')?.getAttribute("data-cell-state")).toBe("not_supplied");
    const entry = [...host.querySelectorAll("input")].find(x => x.id.includes("entry"))!;
    expect(entry.value).toBe("");
    expect(host.querySelector("button[type=submit]")?.textContent).toBe(lang === "en" ? "Apply draft" : "应用草稿");
    await submit();
    expect(applied).toHaveBeenCalledOnce();
    expect(applied.mock.calls[0][0].legs[0].assumptions.entry).toBeNull();
    expect(host.textContent).not.toContain("Save investigation");
    await act(async () => host.querySelector<HTMLButtonElement>("button[type=button]")!.click());
    expect(close).toHaveBeenCalledOnce();
  });
  it("requires an explicit entry denomination and preserves source while applying authored assumptions", async () => {
    const applied = vi.fn(), d = source();
    await act(async () => root.render(<OptionsPlanDraftEditor draft={d} lang="en" onApply={applied} onClose={() => undefined} />));
    await change("Research thesis", "观点 👨‍👩‍👧‍👦");
    await change("What would invalidate", "证据改变");
    await change("Research horizon", "3–10 sessions");
    await change("Your assumed side", "sell");
    await change("Your assumed quantity", "2");
    await change("Your entry assumption", "0");
    await submit();
    expect(applied).not.toHaveBeenCalled();
    expect(host.querySelector("[role=alert]")).not.toBeNull();
    await change("Assumed premium denomination", "USD");
    await submit();
    const result = applied.mock.calls[0][0] as OptionsPlanDraft;
    expect(result.research).toEqual({ thesis: "观点 👨‍👩‍👧‍👦", invalidation: "证据改变", horizon: "3–10 sessions" });
    expect(result.legs[0].assumptions).toEqual({ side: "sell", quantity: 2, entry: { kind: "user_assumption", premium_per_unit: 0, currency: "USD" } });
    expect(result.legs[0].snapshot).toEqual(d.legs[0].snapshot);
    expect(d.legs[0].assumptions.entry).toBeNull();
    expect(Object.isFrozen(result.legs[0].snapshot.row)).toBe(true);
    await change("Your assumed quantity", "1.5");
    await submit();
    expect(applied).toHaveBeenCalledOnce();
    expect(host.querySelector("[role=alert]")).not.toBeNull();
  });
  it.each(["en", "zh"] as const)("planning layout keeps trade controls first and retains disclosed source/research in %s", async lang => {
    const applied = vi.fn(), original = source();
    const d = { ...original, research: { thesis: "Dated thesis", invalidation: "Evidence changes", horizon: "3 sessions" } };
    await act(async () => root.render(<OptionsPlanDraftEditor layout="planning" draft={d} lang={lang} onApply={applied} onClose={() => undefined} />));
    const evidence = host.querySelector<HTMLDetailsElement>('[data-testid="plan-original-source"]')!;
    const notes = host.querySelector<HTMLDetailsElement>('[data-testid="plan-research-notes"]')!;
    expect(evidence.open).toBe(false); expect(notes.open).toBe(false);
    expect(evidence.querySelector('[data-plan-field="mid"]')?.textContent).toContain("4.5");
    expect(host.querySelector('input[id*="entry"]')?.closest("details")).toBeNull();
    expect(host.querySelector('input[id*="entry"]')!.compareDocumentPosition(evidence) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const visibleDate = [...host.querySelectorAll("p")].find(el => el.textContent?.includes("2026-10-23T20:00:00Z") && !el.closest("details"));
    expect(visibleDate).toBeDefined();
    await act(async () => notes.querySelector("summary")!.click()); expect(notes.open).toBe(true);
    await change(lang === "en" ? "Research thesis" : "研究观点", "Revised retained thesis");
    await act(async () => notes.querySelector("summary")!.click()); expect(notes.open).toBe(false);
    await submit();
    expect(applied.mock.calls[0][0].research).toEqual({ thesis: "Revised retained thesis", invalidation: "Evidence changes", horizon: "3 sessions" });
    expect(applied.mock.calls[0][0].legs[0].snapshot).toEqual(original.legs[0].snapshot);
    expect(applied.mock.calls[0][0].legs[0].assumptions).toEqual({ side: null, quantity: null, entry: null });
    await act(async () => notes.querySelector("summary")!.click());
    expect(notes.querySelector("textarea")).toHaveProperty("value", "Revised retained thesis");
  });

});
