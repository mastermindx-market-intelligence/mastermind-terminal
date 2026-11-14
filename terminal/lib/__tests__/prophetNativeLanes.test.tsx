// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/components/prophet/today/TodayView", () => ({ TodayView: () => <div>Today fixture</div> }));
vi.mock("@/components/prophet/sector/ProphetSectorView", () => ({ ProphetSectorView: () => <div>Screener fixture</div> }));
vi.mock("@/components/prophet/ProphetView", () => ({ ProphetView: () => <div>Plan fixture</div> }));
vi.mock("@/components/prophet/OptionsAlphaView", () => ({ OptionsAlphaView: () => <div>Options fixture</div> }));
vi.mock("@/components/prophet/OptionsIssueDeskView", () => ({ OptionsIssueDeskView: () => <div>Issue fixture</div> }));
vi.mock("@/lib/flowClientCache", () => ({ flowPrefetch: vi.fn() }));
import { ProphetLanesView } from "@/components/prophet/ProphetLanesView";
import { candidateFixture } from "./prophetCandidatesFixture";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(candidateFixture()), { headers: { "Content-Type": "application/json" } })));
  Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }) });
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function mount(href: string) { window.history.replaceState({}, "", href); await act(async () => { root.render(<ProphetLanesView />); }); }
async function click(selector: string) { await act(async () => { host.querySelector<HTMLButtonElement>(selector)!.click(); }); }

describe("native Prophet lane lifetime and navigation", () => {
  it("keeps complete candidate reads out of the legacy keep-alive Options workspace", async () => {
    await mount("/options?tab=prophet&prophetLane=candidates&prophetSymbol=DEMOC&prophetQ=Technology");
    expect(fetch).not.toHaveBeenCalled();
    expect(host.querySelector('[data-testid="prophet-candidates-native-entry"]')).not.toBeNull();
    const href = host.querySelector("a")!.getAttribute("href")!;
    const next = new URL(href, "https://test.invalid");
    expect(next.pathname).toBe("/prophet"); expect(next.searchParams.get("tab")).toBe("candidates");
    expect(next.searchParams.get("symbol")).toBe("DEMOC"); expect(next.searchParams.get("prophetQ")).toBe("Technology");
  });
  it("mounts the reader at the canonical candidate entry only", async () => {
    await mount("/prophet?tab=candidates");
    expect(fetch).toHaveBeenCalledTimes(1); expect(host.querySelectorAll('[data-testid="candidate-row"]')).toHaveLength(4);
    expect(host.querySelector('[data-testid="prophet-tab-candidates"]')?.getAttribute("aria-controls")).toBe("prophet-panel-candidates");
  });
  it("focuses the phone disclosure choices and restores focus when they close", async () => {
    await mount("/prophet");
    await click('[data-testid="prophet-lane-more"]');
    expect(document.activeElement?.getAttribute("data-testid")).toBe("prophet-tab-options");
    await act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    const more = host.querySelector('[data-testid="prophet-lane-more"]')!;
    expect(document.activeElement).toBe(more); expect(more.getAttribute("aria-expanded")).toBe("false");
    await click('[data-testid="prophet-lane-more"]'); await click('[data-testid="prophet-tab-issue"]');
    expect(document.activeElement).toBe(more); expect(more.textContent).toBe("Issue");
    expect(host.querySelector('[data-testid="prophet-tab-issue"]')?.getAttribute("aria-selected")).toBe("true");
  });
});
