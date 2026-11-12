// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { appendPricePaneSvgScope } from "../pricePaneSvgScope";

const NS = "http://www.w3.org/2000/svg";
const chartPanel = readFileSync(
  path.resolve(__dirname, "..", "..", "components", "ChartPanel.tsx"),
  "utf8",
);

describe("price-pane SVG scope", () => {
  it("creates a translated, clipped group with inspectable pane geometry", () => {
    const svg = document.createElementNS(NS, "svg") as SVGSVGElement;
    const scope = appendPricePaneSvgScope(svg, {
      id: "price-scope-test",
      width: 800,
      top: 120,
      height: 240,
      scope: "signals",
    });

    expect(scope.group.getAttribute("transform")).toBe("translate(0 120)");
    expect(scope.scope.getAttribute("clip-path")).toBe("url(#price-scope-test)");
    expect(scope.scope.getAttribute("data-price-pane-scope")).toBe("signals");
    expect(scope.scope.getAttribute("data-pane-top")).toBe("120");
    expect(scope.scope.getAttribute("data-pane-height")).toBe("240");

    const clip = svg.querySelector("#price-scope-test rect");
    expect(clip?.getAttribute("x")).toBe("0");
    expect(clip?.getAttribute("y")).toBe("120");
    expect(clip?.getAttribute("width")).toBe("800");
    expect(clip?.getAttribute("height")).toBe("240");
  });

  it("routes signals and every price-pane overlay through the shared pane scope", () => {
    const signalStart = chartPanel.indexOf("const renderSignals = () =>");
    const signalEnd = chartPanel.indexOf("renderSignalsRef.current = renderSignals", signalStart);
    const signalBlock = chartPanel.slice(signalStart, signalEnd);

    const overlayStart = chartPanel.indexOf("const renderIndOverlays = () =>");
    const legacyStart = chartPanel.indexOf("// ── Ichimoku cloud fill", overlayStart);
    const premiumStart = chartPanel.indexOf("// ── Premium suite draw-lists", legacyStart);
    const legacyBlock = chartPanel.slice(legacyStart, premiumStart);
    const premiumEnd = chartPanel.indexOf("flushTables();", premiumStart);
    const premiumBlock = chartPanel.slice(premiumStart, premiumEnd);

    expect(chartPanel).toContain('from "@/lib/pricePaneSvgScope"');
    expect(signalBlock).toContain("appendPricePaneSvgScope");
    expect(signalBlock).toContain("signalScope.group.appendChild");
    expect(signalBlock).not.toContain("layer.appendChild(");
    expect(chartPanel).toContain(
      'layer.querySelectorAll<SVGGElement>(\'[data-price-pane-local="signals"] > g\')',
    );
    expect(chartPanel).not.toContain('querySelectorAll<SVGGElement>(":scope > g")');

    expect(chartPanel).toContain("const priceOverlayScope = appendPricePaneSvgScope");
    expect(chartPanel).toContain('scope: "price-overlays"');
    expect(legacyBlock).toContain("priceOverlayScope.group.appendChild");
    expect(legacyBlock).not.toContain("svgEl.appendChild(");

    expect(premiumBlock).toContain("priceOverlayScope.group.appendChild(group)");
    expect(premiumBlock).toContain('const suiteGroup = mk("g", { "data-price-suite-overlay": k })');
    expect(premiumBlock).toContain("priceOverlayScope.group.appendChild(suiteGroup)");
    expect(premiumBlock).toContain("renderPrims(suiteGroup, bundle, m)");
    expect(premiumBlock).toContain("y: p2y");
    expect(premiumBlock).toContain("H: priceOverlayPaneGeometry.height");
    expect(premiumBlock).not.toContain("priceClipId");
    expect(premiumBlock).not.toContain("priceSuiteY");
    expect(premiumBlock).not.toContain("svgEl.appendChild(");
  });
});
