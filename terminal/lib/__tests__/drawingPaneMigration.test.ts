import { describe, expect, it } from "vitest";
import { migrateLegacyPanePoints } from "../drawingPaneMigration";

const points = [{ t: "2026-06-12", p: 0 }, { t: "2026-06-18", p: 1 }];
const ready = {
  priceScale: () => ({ getVisibleRange: () => ({ from: -10, to: 10 }) }),
  priceToCoordinate: (price: number) => 100 - price * 10,
  coordinateToPrice: (y: number) => (100 - y) / 10,
};

describe("legacy pane drawing migration", () => {
  it.each([null, { from: 0, to: 0 }, { from: 0, to: 1 }])("defers the unready-scale zero sentinel (%j) without losing saved anchors", (range) => {
    // LWC's empty price scale returns finite zero from BOTH coordinate APIs.
    // The CI trace persisted [0, 0] + the completed marker from original [0, 1].
    // A real LWC browser canary also exposes a valid range BEFORE scale height
    // is initialized; range existence alone does not make projection usable.
    const before = structuredClone(points);
    const empty = {
      priceScale: () => ({ getVisibleRange: () => range }),
      priceToCoordinate: () => 0,
      coordinateToPrice: () => 0,
    };
    expect(migrateLegacyPanePoints(points, 200, empty)).toBeNull();
    expect(points).toEqual(before);
    // The same original document remains migratable once autoscale is ready.
    expect(migrateLegacyPanePoints(points, 200, ready)).toEqual([
      { t: "2026-06-12", p: 20 }, { t: "2026-06-18", p: 21 },
    ]);
  });

  it("preserves valid zero anchors when a ready pane is reordered to the top", () => {
    expect(migrateLegacyPanePoints(points, 0, ready)).toEqual(points);
  });

  it("defers the entire document if one anchor cannot be projected", () => {
    expect(migrateLegacyPanePoints(points, 200, {
      ...ready,
      priceToCoordinate: (p) => p === 1 ? null : ready.priceToCoordinate(p),
    })).toBeNull();
    expect(points[0].p).toBe(0);
  });
});
