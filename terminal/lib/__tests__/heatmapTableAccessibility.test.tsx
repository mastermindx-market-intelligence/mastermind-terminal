// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HeatmapTable } from "@/components/heatmap/HeatmapTable";
import type { HeatmapTile, Layer } from "@/components/heatmap/types";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const tiles: HeatmapTile[] = [
  { ticker: "AAA", name: "Alpha", sector: "Other", price: 10, chg1d: 1, hasFlow: true, netPremiumMn: 2 },
  { ticker: "ZZZ", name: "Zeta", sector: "Other", price: 20, chg1d: 2, hasFlow: true, netPremiumMn: 1 },
];
let host: HTMLDivElement;
let root: Root;
function mount(layer: Layer, lang: "en" | "zh" = "en") {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const onSelect = vi.fn();
  act(() => root.render(<HeatmapTable tiles={tiles} layer={layer}
    selectedTicker={null} onSelect={onSelect} lang={lang} />));
  return onSelect;
}
afterEach(() => { if (root) act(() => root.unmount()); host?.remove(); });
const rowTickers = () => [...host.querySelectorAll("tbody tr td:first-child button")].map(x => x.textContent?.trim());

describe.each(["price", "flow"] as const)("Heatmap %s table controls", layer => {
  it("keeps the same focused native sort button through repeated activations", () => {
    mount(layer);
    const header = host.querySelector("thead th")!;
    const button = header.querySelector<HTMLButtonElement>("button")!;
    expect(button).not.toBeNull();
    expect(button.type).toBe("button");
    expect(button.tabIndex).toBe(0);
    expect(header.getAttribute("aria-sort")).toBeNull();
    button.focus();
    // jsdom does not synthesize native Enter/Space click defaults. This proves
    // mounted click/focus/state behavior; the browser spec proves actual keys.
    act(() => button.click());
    expect(header.getAttribute("aria-sort")).toBe("descending");
    expect(rowTickers()).toEqual(["ZZZ", "AAA"]);
    expect(document.activeElement).toBe(button);
    act(() => button.click());
    expect(header.getAttribute("aria-sort")).toBe("ascending");
    expect(rowTickers()).toEqual(["AAA", "ZZZ"]);
    expect(document.activeElement).toBe(button);
    expect(host.querySelectorAll("th[aria-sort]")).toHaveLength(1);
    // Existing header-background pointer behavior also remains a single toggle.
    act(() => (header as HTMLElement).click());
    expect(header.getAttribute("aria-sort")).toBe("descending");
    expect(host.querySelector("thead th button")).toBe(button);
  });

  it.each(["en", "zh"] as const)("inspects once per button or row click in %s", lang => {
    const onSelect = mount(layer, lang);
    const button = host.querySelector<HTMLButtonElement>('button[aria-label="' +
      (lang === "zh" ? "查看 AAA 详情" : "Inspect AAA") + '"]')!;
    expect(button).not.toBeNull();
    expect(button.type).toBe("button");
    expect(button.tabIndex).toBe(0);
    button.focus();
    act(() => button.click());
    expect(onSelect).toHaveBeenCalledTimes(1); // no bubble into the row
    expect(onSelect).toHaveBeenLastCalledWith(tiles[0]);
    act(() => button.click());
    expect(onSelect).toHaveBeenCalledTimes(2);
    act(() => (button.closest("tr")!.children[1] as HTMLElement).click());
    expect(onSelect).toHaveBeenCalledTimes(3);
    expect(onSelect).toHaveBeenLastCalledWith(tiles[0]);
  });
});

