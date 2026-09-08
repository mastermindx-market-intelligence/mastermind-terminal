import { describe, expect, it } from "vitest";
import { hoverTagPaint } from "../hoverTagPaint";

const shown = {
  hoverActive: true,
  priceProjectedHidden: false,
  hasSeries: true,
  y: 190,
  value: 192.74,
};

describe("hoverTagPaint — keep the pointer label through a failed scale map", () => {
  it("hides when the pointer has left the price pane", () => {
    expect(hoverTagPaint({ ...shown, hoverActive: false })).toBe("hide");
  });

  it("hides when a maximized sub-pane is covering the price projection", () => {
    expect(hoverTagPaint({ ...shown, priceProjectedHidden: true })).toBe("hide");
  });

  it("hides when the price series is gone", () => {
    expect(hoverTagPaint({ ...shown, hasSeries: false })).toBe("hide");
  });

  it("keeps the last box when coordinateToPrice is null (hosted Shape A leftover 192.74)", () => {
    expect(hoverTagPaint({ ...shown, value: null })).toBe("keep");
  });

  it("keeps the last box when priceToCoordinate is null during a scale rebuild", () => {
    expect(hoverTagPaint({ ...shown, y: null })).toBe("keep");
  });

  it("shows when the pointer is on the pane and both mappings are finite", () => {
    expect(hoverTagPaint(shown)).toBe("show");
  });
});
