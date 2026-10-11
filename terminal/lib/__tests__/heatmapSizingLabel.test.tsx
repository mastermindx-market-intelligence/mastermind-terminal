// @vitest-environment jsdom
// The legacy `cap` mode is price * reported volume. Its active control must not
// advertise market capitalization until an actual cap contract is consumed.
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const locale = vi.hoisted(() => ({ value: "en" as "en" | "zh" }));
vi.mock("@/lib/i18n", () => ({
  useLang: () => ({ lang: locale.value }),
}));

import { HeatmapView } from "@/components/heatmap/HeatmapView";
import { getHeatmapStr, makeHeatmapT } from "@/lib/heatmapStrings";

describe("heatmap sizing names the implemented measurement", () => {
  it.each([
    ["en", "Price × volume", "CAP"],
    ["zh", "价格 × 成交量", "市值"],
  ] as const)("%s labels the actual default control, not an unused string", (lang, expected, wrong) => {
    locale.value = lang;
    expect(getHeatmapStr(lang, "sizeCap")).toBe(expected);
    expect(makeHeatmapT(lang)("sizeCap")).toBe(expected);

    // Render the real consumer. SSR intentionally avoids polling/network effects;
    // the default sizing controls are already part of its initial markup.
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(<HeatmapView />);
    const buttons = Array.from(host.querySelectorAll("button"));
    const sizing = buttons.filter(button => button.textContent?.trim() === expected);
    expect(sizing).toHaveLength(1);
    expect(sizing[0].classList.contains("on")).toBe(true);
    expect(buttons.some(button => button.textContent?.trim() === wrong)).toBe(false);
  });

  it("preserves the other measurements and keeps genuine cap sizing separate", () => {
    expect(getHeatmapStr("en", "sizeEqual")).toBe("EQUAL");
    expect(getHeatmapStr("zh", "sizeEqual")).toBe("等面积");
    expect(getHeatmapStr("en", "sizePremium")).toBe("PREMIUM");
    expect(getHeatmapStr("zh", "sizePremium")).toBe("权利金");
    expect(getHeatmapStr("en", "sizeCapDeferred")).toBe("CAP (soon)");
    expect(getHeatmapStr("zh", "sizeCapDeferred")).toBe("市值（即将上线）");
  });
});
