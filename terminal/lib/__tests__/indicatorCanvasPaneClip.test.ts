import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const chartPanel = readFileSync(
  path.resolve(__dirname, "..", "..", "components", "ChartPanel.tsx"),
  "utf8",
);

describe("IndicatorCanvas price-pane clipping", () => {
  it("renders every overlay suite through the shared live price-pane scope", () => {
    const premiumStart = chartPanel.indexOf("// ── Premium suite draw-lists");
    const premiumEnd = chartPanel.indexOf("flushTables();", premiumStart);
    const premiumBlock = chartPanel.slice(premiumStart, premiumEnd);

    expect(chartPanel).toContain("const priceOverlayPaneGeometry = pricePaneGeometry()");
    expect(chartPanel).toContain("const priceOverlayScope = appendPricePaneSvgScope");
    expect(chartPanel).toContain('scope: "price-overlays"');
    expect(premiumBlock).toContain("xi, y: p2y, W, H: priceOverlayPaneGeometry.height");
    expect(premiumBlock).toContain('const suiteGroup = mk("g", { "data-price-suite-overlay": k })');
    expect(premiumBlock).toContain("priceOverlayScope.group.appendChild(suiteGroup)");
    expect(premiumBlock).toContain("renderPrims(suiteGroup, bundle, m)");
    expect(premiumBlock).not.toContain("priceSuiteY");
    expect(premiumBlock).not.toContain("priceClipId");
    expect(premiumBlock).not.toContain("renderPrims(svgEl, bundle, m)");
  });
});
