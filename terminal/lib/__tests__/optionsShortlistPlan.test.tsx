// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OptionsShortlistPlan } from "@/components/options/OptionsShortlistPlan";
import { draft } from "./fixtures/optionsPlanPayoff";
import { buildPin } from "../optionsContractShortlist";

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Element.prototype.scrollIntoView = vi.fn();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const click = async (button: Element) => act(async () => (button as HTMLButtonElement).click());
const pins = () => draft().legs.map(l => l.snapshot);
const render = async (scopeKey: string, selected = pins(), onDraftChange = vi.fn()) => {
  await act(async () => root.render(<OptionsShortlistPlan pins={selected} scopeKey={scopeKey} lang="en" onDraftChange={onDraftChange} />));
  return onDraftChange;
};
describe("shortlist → exact Plan", () => {
  it("keeps current inputs across a changed callback identity and invalidates only the latest callback on unmount", async () => {
    const first = vi.fn(), latest = vi.fn();
    const mount = async (onDraftInputChange: typeof first) => act(async () => root.render(<OptionsShortlistPlan pins={pins()} scopeKey="a/1" lang="en" onDraftInputChange={onDraftInputChange} />));
    await mount(first); await click(host.querySelector("button")!);
    expect(first).toHaveBeenCalledOnce(); expect(first.mock.lastCall?.[0]).not.toBeNull();
    const form = host.querySelector("form");
    await mount(latest);
    expect(host.querySelector("form")).toBe(form);
    expect(first).toHaveBeenCalledOnce(); expect(latest).not.toHaveBeenCalled();
    await act(async () => root.unmount());
    expect(first).toHaveBeenCalledOnce(); expect(latest).toHaveBeenCalledOnce();
    expect(latest.mock.lastCall?.[0]).toBeNull();
    root = createRoot(host);
  });
  it("exposes current inputs on open and invalidates the handoff on close or source replacement", async () => {
    const current = vi.fn();
    const mount = async (scopeKey: string) => act(async () => root.render(<OptionsShortlistPlan pins={pins()} scopeKey={scopeKey} lang="en" onDraftInputChange={current} />));
    await mount("a/1"); await click(host.querySelector("button")!);
    expect(current.mock.lastCall?.[0].legs[0].assumptions.entry).toBeNull();
    await click([...host.querySelectorAll("button")].find(b => b.textContent === "Close draft")!);
    expect(current.mock.lastCall?.[0]).toBeNull();
    await click(host.querySelector("button")!); expect(current.mock.lastCall?.[0]).not.toBeNull();
    await mount("a/2"); expect(current.mock.lastCall?.[0]).toBeNull();
  });
  it("copies the exact retained selection with all assumptions null; close restores context/focus", async () => {
    const changed = await render("account-a/0");
    await click(host.querySelector("button")!);
    expect(changed.mock.calls[0][0].legs[0]).toEqual({ snapshot: pins()[0], assumptions: { side: null, quantity: null, entry: null } });
    expect(host.querySelector('input[id*="entry"]')).toHaveProperty("value", "");
    expect(host.querySelector('input[id*="quantity"]')).toHaveProperty("value", "");
    expect(host.textContent).toContain("Draft only");
    await click([...host.querySelectorAll("button")].find(b => b.textContent === "Close draft")!);
    expect(host.querySelector('[data-testid="options-plan-payoff-panel"]')).toBeNull();
    expect(document.activeElement).toBe(host.querySelector("button"));
  });
  it("destroys drafts on selection or account departure, including A→B→A", async () => {
    await render("account-a/0"); await click(host.querySelector("button")!);
    await render("account-b/1"); expect(host.querySelector("form")).toBeNull();
    await render("account-a/2"); expect(host.querySelector("form")).toBeNull();
    await click(host.querySelector("button")!);
    const row = { ...pins()[0].row, strike: 766 };
    const pin = buildPin(row, { family: "doi", asof: pins()[0].asofRaw, schema: null, stale: false, hotView: null }, [row]);
    if (!pin.ok) throw Error(pin.reason);
    await render("account-a/2", [pin.pin]); expect(host.querySelector("form")).toBeNull();
    await render("account-a/2"); expect(host.querySelector("form")).toBeNull();
  });
  it("refuses a mixed underlying without mutating the shortlist", async () => {
    const selected = pins(); const row = { ...selected[0].row, root: "QQQ" };
    const pin = buildPin(row, { family: "doi", asof: selected[0].asofRaw, schema: null, stale: false, hotView: null }, [row]);
    if (!pin.ok) throw Error(pin.reason);
    const changed = await render("account", [...selected, pin.pin]);
    await click(host.querySelector("button")!);
    expect(host.textContent).toContain("Choose distinct exact contracts for one underlying");
    expect(host.querySelector("form")).toBeNull(); expect(changed).not.toHaveBeenCalled();
    expect(selected).toHaveLength(1);
  });
});
