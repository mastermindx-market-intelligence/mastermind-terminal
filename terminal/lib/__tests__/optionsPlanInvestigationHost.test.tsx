// @vitest-environment jsdom
import React, { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ mount: vi.fn(), cleanup: vi.fn(), pending: null as Promise<void> | null }));
vi.mock("@/components/mounts/InvestigationWorkspaceMount", () => ({ default: function Native({ ownerKey }: { ownerKey: string }) {
  const [newDraft, setNewDraft] = useState(false);
  useEffect(() => { native.mount(ownerKey); return () => native.cleanup(ownerKey); }, [ownerKey]);
  if (native.pending) throw native.pending;
  return <div data-native-owner={ownerKey}><button onClick={() => setNewDraft(true)}>Native New research</button>{newDraft && <input aria-label="Native title" />}</div>;
} }));
import { OptionsPlanInvestigationHost } from "@/components/options/OptionsPlanInvestigationHost";
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); native.mount.mockClear(); native.cleanup.mockClear(); native.pending=null;
  Element.prototype.scrollIntoView = vi.fn();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const render = async (ownerKey = "owner-a", scopeKey = "a/1", selectionKey = "selection-a", lang: "en" | "zh" = "en") => {
  await act(async () => root.render(<OptionsPlanInvestigationHost workspaceProps={{ ownerKey }} scopeKey={scopeKey} selectionKey={selectionKey} lang={lang} />));
};
const click = async (el: Element) => act(async () => (el as HTMLButtonElement).click());
describe("isolated native Investigation host preparation", () => {
  it.each(["en", "zh"] as const)("opens on explicit gesture, leaves New to native owner, preserves draft on back and returns focus in %s", async lang => {
    await render("owner-a", "a/1", "selection-a", lang);
    expect(native.mount).not.toHaveBeenCalled();
    const trigger = host.querySelector("button")!;
    await click(trigger); expect(native.mount).toHaveBeenCalledOnce(); expect(native.mount).toHaveBeenCalledWith("owner-a");
    expect(document.activeElement?.tagName).toBe("H2");
    expect(host.querySelector("input")).toBeNull(); // host never invokes native New
    await click(host.querySelector("[data-native-owner] button")!);
    const title = host.querySelector<HTMLInputElement>("input")!; title.value = "Authored native draft";
    await click(trigger); expect(document.activeElement).toBe(trigger);
    expect(title.closest("[hidden]")).not.toBeNull();
    expect(native.cleanup).not.toHaveBeenCalled();
    await click(trigger); expect(host.querySelector("input")).toBe(title); expect(title.value).toBe("Authored native draft");
    expect(host.textContent).toContain(lang === "en" ? "calculate again explicitly" : "主动重新计算");
  });
  it("destroys the native host on account/epoch or exact-selection replacement; A→B→A cannot revive it", async () => {
    await render(); await click(host.querySelector("button")!);
    await render("owner-b", "b/2"); expect(native.cleanup).toHaveBeenCalledWith("owner-a");
    expect(host.querySelector("[data-native-owner]")).toBeNull();
    await render("owner-a", "a/3"); expect(host.querySelector("[data-native-owner]")).toBeNull();
    await click(host.querySelector("button")!);
    await render("owner-a", "a/3", "selection-b");
    expect(host.querySelector("[data-native-owner]")).toBeNull();
  });
  it("never mounts a workspace for an absent owner", async () => {
    await render(""); expect(host.querySelector("button")?.disabled).toBe(true);
    await click(host.querySelector("button")!); expect(native.mount).not.toHaveBeenCalled();
  });
  it("contains a delayed native chunk without suspending the surrounding authored Plan", async () => {
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release=resolve; });
    await act(async () => root.render(<React.Suspense fallback={<p data-outer-fallback>Page loading</p>}>
      <OptionsPlanInvestigationHost workspaceProps={{ownerKey:"owner-a"}} scopeKey="a/1" selectionKey="selection-a" lang="en">
        <input data-candidate defaultValue="Authored Plan inputs" />
      </OptionsPlanInvestigationHost></React.Suspense>));
    native.pending=pending;
    await click(host.querySelector("button")!);
    expect(host.querySelector("[data-outer-fallback]")).toBeNull();
    expect(host.textContent).toContain("Loading saved research");
    const candidate=host.querySelector<HTMLInputElement>("[data-candidate]")!;
    expect(candidate.value).toBe("Authored Plan inputs");expect(native.mount).not.toHaveBeenCalled();
    await act(async()=>{native.pending=null;release();});
    expect(native.mount).toHaveBeenCalledOnce();expect(host.querySelector("[data-candidate]")).toBe(candidate);
  });

});
