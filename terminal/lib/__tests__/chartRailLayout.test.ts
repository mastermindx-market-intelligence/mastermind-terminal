import { describe, expect, it } from "vitest";
import { chartRailLayout, clampRailWidth, railWidthForKey } from "../chartRailLayout";

describe("chart-first rail geometry", () => {
  it("docks at exactly 640 actual plot pixels and moves below at 639", () => {
    const geometry = { availableWidth: 1018, columns: 1, gap: 1, plotInset: 78 };
    expect(chartRailLayout(geometry, 520)).toEqual({ placement: "rail", width: 300, maximum: 300 });
    expect(chartRailLayout({ ...geometry, availableWidth: 1017 }, 520).placement).toBe("below");
  });
  it("accounts for every plot and the gaps when a user keeps multiple columns", () => {
    const geometry = { availableWidth: 1737, columns: 2, gap: 1, plotInset: 78 };
    expect(chartRailLayout(geometry, 360)).toEqual({ placement: "rail", width: 300, maximum: 300 });
    expect(chartRailLayout({ ...geometry, availableWidth: 1736 }, 360).placement).toBe("below");
  });
  it("temporarily fits a saved preference and restores it when room returns", () => {
    const geometry = { availableWidth: 1200, columns: 1, gap: 1, plotInset: 78 };
    const requested = 520;
    expect(chartRailLayout(geometry, requested).width).toBe(482);
    expect(chartRailLayout({ ...geometry, availableWidth: 900 }, requested).placement).toBe("below");
    expect(chartRailLayout({ ...geometry, availableWidth: 1440 }, requested).width).toBe(requested);
  });
  it.each([
    { availableWidth: 0, columns: 1, gap: 1, plotInset: 78 },
    { availableWidth: NaN, columns: 1, gap: 1, plotInset: 78 },
    { availableWidth: 1200, columns: 0, gap: 1, plotInset: 78 },
    { availableWidth: 1200, columns: 1, gap: 1, plotInset: -1 },
  ])("does not qualify unknown or hidden geometry: %j", (geometry) => {
    expect(chartRailLayout(geometry, 360).placement).toBe("below");
  });
});

describe("a right-hand keyboard separator", () => {
  it("grows left, shrinks right and obeys the current fitted limit", () => {
    expect(railWidthForKey("ArrowLeft", 360, 420)).toBe(370);
    expect(railWidthForKey("ArrowRight", 360, 420)).toBe(350);
    expect(railWidthForKey("ArrowLeft", 400, 420, true)).toBe(420);
    expect(railWidthForKey("ArrowRight", 310, 420, true)).toBe(300);
    expect(railWidthForKey("Home", 360, 420)).toBe(300);
    expect(railWidthForKey("End", 360, 420)).toBe(420);
  });
  it("leaves Enter and unrelated chart commands to their existing owners", () => {
    expect(railWidthForKey("Enter", 360, 420)).toBeNull();
    expect(railWidthForKey("Delete", 360, 420)).toBeNull();
    expect(clampRailWidth(600)).toBe(520);
    expect(clampRailWidth(200)).toBe(300);
  });
});
