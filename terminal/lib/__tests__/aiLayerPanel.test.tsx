// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AiLayerPanel from "@/components/AiLayerPanel";
import ChartOverlays from "@/components/ChartOverlays";
import { translate, type ChartCommandV2 } from "@/lib/chartBus";
import type { AiLayerController } from "@/lib/chartAiLayer";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
describe("AI layer disclosure and individual controls", () => {
  let node: HTMLDivElement;
  let root: Root;
  let layer: AiLayerController;
  const buttons = () => Array.from(node.querySelectorAll<HTMLButtonElement>("button"));
  const button = (label: string) => buttons().find(value => value.getAttribute("aria-label") === label || value.textContent === label)!;
  const click = (value: HTMLElement) => act(() => value.click());
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    node = document.createElement("div"); document.body.appendChild(node); root = createRoot(node);
    const result = translate({ on: true, v: 2, op: "draw.channel", id: "ai_channel", batch_id: "b", seq: 0,
      caption: "Trend boundaries", args: {
        u1: { t: 1721606400, p: 110 }, u2: { t: 1721692800, p: 120 },
        l1: { t: 1721606400, p: 100 }, l2: { t: 1721692800, p: 110 },
      } } as ChartCommandV2, { tfs: [], indicators: [] });
    if (!result.ok) throw new Error("invalid fixture");
    layer = { count: 2, objects: result.draw!, hidden: false, toggleHidden: vi.fn(), clear: vi.fn(), editObjects: vi.fn() };
  });
  afterEach(() => { act(() => root.unmount()); node.remove(); vi.unstubAllGlobals(); });
  const render = () => act(() => root.render(<AiLayerPanel layer={layer} />));

  it("opens a logical drawing list, reveals children, and deletes only the selected element", () => {
    render();
    const trigger = node.querySelector<HTMLButtonElement>("[aria-controls]")!;
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.textContent).toBe("AI layer1");
    click(trigger);
    expect(node.textContent).toContain("1 drawing · 2 elements");
    click(button("Show individual elements: Trend boundaries"));
    expect(node.querySelectorAll("[data-ai-element-id]")).toHaveLength(2);
    const deletion = buttons().find(value => value.getAttribute("aria-label")?.startsWith("Delete element: Trend boundaries, 2."))!;
    click(deletion);
    expect(layer.editObjects).toHaveBeenCalledWith(["ai_channel_l"], "remove");
    expect(document.activeElement).toBe(trigger);
  });

  it("group hide names every exact child, and global hiding does not erase individual choices", () => {
    render(); click(node.querySelector<HTMLButtonElement>("[aria-controls]")!);
    click(button("Hide drawing: Trend boundaries"));
    expect(layer.editObjects).toHaveBeenCalledWith(["ai_channel_u", "ai_channel_l"], "hide");
    layer = { ...layer, hidden: true }; render();
    expect(button("Hide drawing: Trend boundaries").disabled).toBe(true);
    click(button("Show layer")); expect(layer.toggleHidden).toHaveBeenCalledOnce();
    expect(layer.clear).not.toHaveBeenCalled();
  });

  it("stops chart keyboard shortcuts and returns focus when Escape closes the list", () => {
    const chartKey = vi.fn(); window.addEventListener("keydown", chartKey);
    render(); const trigger = node.querySelector<HTMLButtonElement>("[aria-controls]")!; click(trigger);
    act(() => button("Hide drawing: Trend boundaries").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
    expect(chartKey).not.toHaveBeenCalled();
    window.removeEventListener("keydown", chartKey);
  });

  it.each([true, false])("stays on the price pane below the existing legend, including titles=%s", showTitles => {
    const actions = { onEye: vi.fn(), onSettings: vi.fn(), onSource: vi.fn(), onRemove: vi.fn(), onMoveUp: vi.fn(), onMoveDown: vi.fn(), onCollapse: vi.fn(), onMaximize: vi.fn(), canMoveUp: () => false, canMoveDown: () => false };
    act(() => root.render(<ChartOverlays {...actions} hoveredKey={null} legendOpen={true} onToggleLegend={vi.fn()} showTitles={showTitles}
      panes={[{ key: "__price__", paneIndex: 0, isPrice: true, top: 0, height: 400, collapsed: false, maximized: false,
        entries: [{ key: "ema", label: "EMA", kind: "overlay", hidden: false, isPine: false }] }]}
      aiLayerSlot={<AiLayerPanel layer={layer} />} />));
    const legend = node.querySelector(".lg-block")!;
    expect(legend.lastElementChild?.getAttribute("data-ai-layer")).toBe("true");
    expect(node.querySelectorAll("[data-ai-layer]")).toHaveLength(1);
    expect((node.querySelector(".lg-row") as HTMLElement).style.display).toBe(showTitles ? "" : "none");
  });
});
