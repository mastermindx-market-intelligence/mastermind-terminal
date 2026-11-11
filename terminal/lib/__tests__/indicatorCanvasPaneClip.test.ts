import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const chartPanel = readFileSync(
  path.resolve(__dirname, "..", "..", "components", "ChartPanel.tsx"),
  "utf8",
);

describe("IndicatorCanvas price-pane clipping", () => {
  it("clips overlay-suite primitives to the live price pane", () => {
    expect(chartPanel).toContain("priceS.pane().getHTMLElement()");
    expect(chartPanel).toContain("pricePaneTop = paneRect.top - wrapRect.top");
    expect(chartPanel).toContain("pricePaneH = paneRect.height");
    expect(chartPanel).toContain("const priceSuiteY");
    expect(chartPanel).toContain("const priceClipId = `ic-price-clip-");
    expect(chartPanel).toContain(
      'priceClip.appendChild(mk("rect", { x: 0, y: pricePaneTop, width: W, height: pricePaneH }))',
    );
    expect(chartPanel).toContain("renderPrims(priceSuiteGroup, bundle, m)");
    expect(chartPanel).not.toContain("renderPrims(svgEl, bundle, m)");
  });
});
