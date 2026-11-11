// @vitest-environment jsdom
//
// B-PL-6 batch 3 round 7 (ruling R1) — the flow-layer price-only badge on the
// treemap used to paint a bare English text node `price`, so the Chinese frame
// showed that token. The badge now routes through heatmapStrings.tilePriceBadge.
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import React from "react";
import { Treemap } from "@/components/heatmap/Treemap";
import type { HeatmapTile } from "@/components/heatmap/types";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

const PRICE_ONLY: HeatmapTile = {
  ticker: "TEST",
  name: "Test Co",
  sector: "Other",
  price: 10,
  chg1d: 1.2,
  hasFlow: false,
};

let host: HTMLDivElement | null = null;
let root: Root | null = null;

function mount(lang: "en" | "zh"): HTMLElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(
      <div style={{ width: 900, height: 500 }}>
        <Treemap
          tiles={[PRICE_ONLY]}
          layer="flow"
          sizing="equal"
          selectedTicker={null}
          onSelect={() => {}}
          lang={lang}
        />
      </div>,
    );
  });
  return host;
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe("Treemap — price-only badge is bilingual (round 7 R1)", () => {
  it("the ZH frame paints 价格 and never the bare English token price", () => {
    const text = mount("zh").textContent ?? "";
    expect(text).toContain("价格");
    expect(text).not.toContain("price");
  });

  it("the EN frame still paints the house word price", () => {
    const text = mount("en").textContent ?? "";
    expect(text).toContain("price");
    expect(text).not.toContain("价格");
  });
});
