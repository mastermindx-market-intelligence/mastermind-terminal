// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OptionsPlanPayoffPanel } from "@/components/options/OptionsPlanPayoffPanel";
import { draft, response } from "./fixtures/optionsPlanPayoff";
import type { PlanExpiryRequest } from "../optionsPlanPayoff";

let host: HTMLDivElement, root: Root;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function submit() { await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }); }
async function changeEntry(value: string) {
  const el = host.querySelector<HTMLInputElement>('input[id*="entry"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); });
}
describe("Plan editor to conditional curve", () => {
  it.each(["en", "zh"] as const)("renders exact assumptions and bounded result in %s then clears on edit", async lang => {
    const saved = vi.fn(), fetcher = vi.fn(async (_url, init) => new Response(JSON.stringify(response(JSON.parse(init.body) as PlanExpiryRequest)), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    await act(async () => root.render(<OptionsPlanPayoffPanel scopeKey="fixture-account-selection" draft={draft()} lang={lang} onDraftChange={saved} onClose={() => undefined} />));
    expect(host.textContent).not.toContain("no payoff or profit is calculated");
    await submit();
    expect(fetcher).toHaveBeenCalledOnce(); expect(saved).toHaveBeenCalledOnce();
    expect(saved.mock.calls[0][0].legs[0].snapshot.row.mid).toBe(3);
    expect(host.textContent).toContain(lang === "en" ? "Worst expiry outcome" : "最差到期结果");
    expect(host.textContent).toContain("200.00");
    expect(host.textContent).toContain(lang === "en" ? "Unbounded gain" : "收益无上限");
    expect(host.querySelector('svg[role="img"]')).not.toBeNull();
    await changeEntry("4");
    expect(host.textContent).not.toContain(lang === "en" ? "Worst expiry outcome" : "最差到期结果");
    expect(host.querySelector('svg[role="img"]')).toBeNull();
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("keeps assumptions and exposes plain unavailable after a source failure without retry", async () => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 503 })); vi.stubGlobal("fetch", fetcher);
    await act(async () => root.render(<OptionsPlanPayoffPanel scopeKey="fixture-account-selection" draft={draft()} lang="en" onDraftChange={() => undefined} onClose={() => undefined} />));
    await submit();
    expect(host.textContent).toContain("Contract terms unavailable");
    expect(host.querySelector('input[id*="entry"]')).toHaveProperty("value", "2");
    expect(host.querySelector('svg[role="img"]')).toBeNull(); expect(fetcher).toHaveBeenCalledOnce();
  });
  it("never fetches with absent authored entry and never presents a late result for edited inputs", async () => {
    let finish: (v: Response) => void = () => undefined;
    let requested: PlanExpiryRequest;
    const fetcher = vi.fn((_url, init) => { requested = JSON.parse(init.body); return new Promise<Response>(resolve => { finish = resolve; }); });
    vi.stubGlobal("fetch", fetcher);
    const d = draft(); d.legs[0].assumptions.entry = null;
    await act(async () => root.render(<OptionsPlanPayoffPanel scopeKey="fixture-account-selection" draft={d} lang="en" onDraftChange={() => undefined} onClose={() => undefined} />));
    await submit(); expect(fetcher).not.toHaveBeenCalled();
    await changeEntry("2");
    const currency = host.querySelector<HTMLSelectElement>('select[id*="usd"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(currency, "USD"); currency.dispatchEvent(new Event("change", { bubbles: true })); });
    await submit(); expect(fetcher).toHaveBeenCalledOnce();
    await changeEntry("8");
    await act(async () => finish(new Response(JSON.stringify(response(requested!)), { status: 200 })));
    expect(host.querySelector('svg[role="img"]')).toBeNull();
  });
  it("remounts result state and ignores the old account request when scope changes", async () => {
    let finish: (v: Response) => void = () => undefined;
    let requested: PlanExpiryRequest;
    vi.stubGlobal("fetch", vi.fn((_url, init) => { requested = JSON.parse(init.body); return new Promise<Response>(resolve => { finish = resolve; }); }));
    await act(async () => root.render(<OptionsPlanPayoffPanel scopeKey="account-a/selection" draft={draft()} lang="en" onDraftChange={() => undefined} onClose={() => undefined} />));
    await submit();
    await act(async () => root.render(<OptionsPlanPayoffPanel scopeKey="account-b/selection" draft={draft()} lang="en" onDraftChange={() => undefined} onClose={() => undefined} />));
    await act(async () => finish(new Response(JSON.stringify(response(requested!)), { status: 200 })));
    expect(host.querySelector('svg[role="img"]')).toBeNull();
    expect(host.textContent).not.toContain("Worst expiry outcome");
  });

});
