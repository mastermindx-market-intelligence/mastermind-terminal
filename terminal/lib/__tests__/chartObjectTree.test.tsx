// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ChartObjectTree, { type OTEntry } from "@/components/ChartObjectTree";
vi.mock("@/lib/i18n", () => ({ useT: () => (key: string) => ({
  objectTree: "Object tree", drawSearch: "Search", smIndicators: "Indicators", smClose: "Close",
  lgShow: "Show", lgHide: "Hide", remove: "Remove", clearFilter: "Clear filter", scr2EmptyTitle: "No matches",
  ctvMainSeries: "Main series", ctvOverlays: "Overlays", ctvSubPanes: "Sub-pane indicators",
  ctvNoIndicators: "No indicators active.", isTabVisibility: "Visibility",
} as Record<string, string>)[key] ?? key }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const seed: OTEntry[] = [
  { key: "ema", label: "Moving Averages", tag: "EMA", kind: "overlay", hidden: false },
  { key: "rsi", label: "Relative Strength", tag: "RSI", kind: "pane", hidden: true },
  { key: "locked", label: "Protected study", kind: "overlay", hidden: false, noRemove: true },
];
describe("chart object-tree management", () => {
  let root: Root, host: HTMLDivElement;
  const eye = vi.fn(), remove = vi.fn(), close = vi.fn();
  const render = async (entries = seed) => { await act(async () => root.render(<ChartObjectTree symbol="NVDA" entries={entries} onEye={eye} onRemove={remove} onClose={close} />)); };
  const input = () => host.querySelector<HTMLInputElement>('input[type="search"]')!;
  const button = (name: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;
  const search = async (value: string) => { await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  }); };
  beforeEach(() => { vi.clearAllMocks(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
  it("focuses search and names each action for its study", async () => {
    await render(); expect(document.activeElement).toBe(input());
    expect(button("Hide Moving Averages")).not.toBeNull(); expect(button("Show Relative Strength")).not.toBeNull();
    expect(button("Remove Moving Averages")).not.toBeNull(); expect(button("Close")).not.toBeNull();
    expect(host.querySelector('[data-layer-key="locked"] .ot-remove')).toBeNull();
  });
  it("searches visible labels and tags without mutating indicator state", async () => {
    await render(); await search(" rSi ");
    expect(host.querySelectorAll("[data-layer-key]").length).toBe(1);
    expect(host.querySelector("[data-layer-key]")?.getAttribute("data-layer-key")).toBe("rsi");
    expect(eye).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
  });
  it("keeps hidden studies actionable and routes only the selected key", async () => {
    await render(); await act(async () => button("Show Relative Strength").click());
    expect(eye).toHaveBeenCalledTimes(1); expect(eye).toHaveBeenCalledWith("rsi");
  });
  it("keeps focus in the panel after the focused study is removed", async () => {
    await render(); button("Remove Moving Averages").focus();
    await act(async () => button("Remove Moving Averages").click()); expect(remove).toHaveBeenCalledTimes(1); expect(remove).toHaveBeenCalledWith("ema");
    await render(seed.filter((row) => row.key !== "ema")); expect(document.activeElement).toBe(button("Show Relative Strength"));
  });
  it("distinguishes no matches from a chart with no studies", async () => {
    await render(); await search("zzzz"); expect(host.textContent).toContain("No matches");
    await act(async () => button("Clear filter").click()); expect(input().value).toBe("");
    await render([]); expect(host.textContent).toContain("No indicators active.");
  });
  it("Escape clears a filter first and only then closes the panel", async () => {
    await render(); await search("EMA");
    const escape = () => input().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await act(async () => { escape(); }); expect(input().value).toBe(""); expect(close).not.toHaveBeenCalled();
    await act(async () => { escape(); }); expect(close).toHaveBeenCalledTimes(1);
  });
  it("returns focus to search when removal empties the filtered result", async () => {
    await render(); await search("EMA"); await act(async () => button("Remove Moving Averages").click());
    await render(seed.slice(1)); expect(document.activeElement).toBe(input());
  });
});
