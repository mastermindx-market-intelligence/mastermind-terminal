import { describe, expect, it } from "vitest";
import {
  PRICE_TAG_ROW_HEIGHT,
  PRICE_TAG_TIME_HEIGHT,
  PRICE_TAG_MIN_VALUE_WIDTH,
  priceTagRowTop,
  priceScaleDisplayValue,
  secondaryPriceTagTop,
  layoutPriceAxisBadges,
  readablePriceTagTextColor,
  priceAxisOffsetForObstacles,
} from "../priceTagPlacement";

const place = (
  primaryY: number,
  secondaryY: number,
  paneHeight = 556,
  primaryHeight = PRICE_TAG_ROW_HEIGHT + PRICE_TAG_TIME_HEIGHT,
) => secondaryPriceTagTop({ primaryY, secondaryY, paneHeight, primaryHeight });

describe("persistent price-tag geometry", () => {
  it("locks the compact TradingView row and numeric-lane dimensions", () => {
    expect(PRICE_TAG_ROW_HEIGHT).toBe(17);
    expect(PRICE_TAG_TIME_HEIGHT).toBe(14);
    expect(PRICE_TAG_MIN_VALUE_WIDTH).toBe(66);
  });

  it("centres the 17px price row on its real coordinate using integer pixels", () => {
    expect(priceTagRowTop(190)).toBe(182);
    expect(priceTagRowTop(190.49)).toBe(182);
    expect(priceTagRowTop(190.51)).toBe(183);
  });
});

describe("priceScaleDisplayValue", () => {
  it("matches percentage and IndexedTo100 scale units", () => {
    expect(priceScaleDisplayValue(120, 80, 2)).toBe(50);
    expect(priceScaleDisplayValue(120, 80, 3)).toBe(150);
  });

  it("keeps Normal/Logarithmic values raw and fails safely without a usable base", () => {
    expect(priceScaleDisplayValue(120, 80, 0)).toBe(120);
    expect(priceScaleDisplayValue(120, 80, 1)).toBe(120);
    expect(priceScaleDisplayValue(120, 0, 2)).toBe(120);
    expect(priceScaleDisplayValue(120, null, 3)).toBe(120);
  });
});

describe("readablePriceTagTextColor", () => {
  it("uses dark text on bright options badges and white on dark badges", () => {
    for (const background of ["#e8b339", "#9d86ff", "#4d82ff", "rgb(240, 86, 107)"]) {
      expect(readablePriceTagTextColor(background), background).toBe("#000");
    }
    expect(readablePriceTagTextColor("#172033")).toBe("#fff");
  });

  it("fails safely to white for an unparseable CSS color", () => {
    expect(readablePriceTagTextColor("var(--unknown)")).toBe("#fff");
  });
});

describe("secondaryPriceTagTop", () => {
  it("docks an equal/near extended price immediately above the pinned current row", () => {
    const primaryTop = priceTagRowTop(190);
    expect(place(190, 190)).toBe(primaryTop - PRICE_TAG_ROW_HEIGHT);
    expect(place(190, 175)).toBe(primaryTop - PRICE_TAG_ROW_HEIGHT);
    // Half-open rows: exactly touching at 17px separation is not an overlap.
    expect(place(190, 173)).toBe(priceTagRowTop(173));
  });

  it("leaves a diverged extended price on its natural projected coordinate", () => {
    expect(place(190, 150)).toBe(priceTagRowTop(150));
    expect(place(190, 240)).toBe(priceTagRowTop(240));
  });

  it("puts a lower extended price below the complete current price + time footprint", () => {
    const primaryTop = priceTagRowTop(190);
    expect(place(190, 200)).toBe(primaryTop + PRICE_TAG_ROW_HEIGHT + PRICE_TAG_TIME_HEIGHT);
  });

  it("uses only the price-row footprint when countdown display is disabled", () => {
    const primaryTop = priceTagRowTop(190);
    expect(place(190, 200, 556, PRICE_TAG_ROW_HEIGHT)).toBe(primaryTop + PRICE_TAG_ROW_HEIGHT);
  });

  it("flips the secondary row below when the primary is against the pane top", () => {
    const primaryTop = priceTagRowTop(10);
    expect(place(10, 10, 100)).toBe(primaryTop + PRICE_TAG_ROW_HEIGHT + PRICE_TAG_TIME_HEIGHT);
  });

  it("flips the secondary row above when the primary footprint reaches the pane floor", () => {
    const primaryTop = priceTagRowTop(95);
    expect(place(95, 96, 100)).toBe(primaryTop - PRICE_TAG_ROW_HEIGHT);
  });

  it("clamps a naturally off-pane secondary row without moving the primary", () => {
    expect(place(190, -50, 300)).toBe(0);
    expect(place(190, 500, 300)).toBe(300 - PRICE_TAG_ROW_HEIGHT);
  });
});


describe("priceAxisOffsetForObstacles", () => {
  it("moves a right-edge badge left of intersecting chart chrome without changing y", () => {
    expect(priceAxisOffsetForObstacles({
      onLeft: false, containerWidth: 390, top: 60, height: 17, width: 84,
      obstacles: [{ left: 294, right: 338, top: 40, bottom: 84 }],
    })).toBe(100);
  });

  it("moves a left-edge badge right of a legend only when their rectangles intersect", () => {
    const obstacle = { left: 8, right: 210, top: 40, bottom: 90 };
    expect(priceAxisOffsetForObstacles({
      onLeft: true, containerWidth: 390, top: 60, height: 17, width: 84, obstacles: [obstacle],
    })).toBe(214);
    expect(priceAxisOffsetForObstacles({
      onLeft: true, containerWidth: 390, top: 120, height: 17, width: 84, obstacles: [obstacle],
    })).toBe(1);
  });

  it("iterates across chained obstacles and remains inside the container", () => {
    expect(priceAxisOffsetForObstacles({
      onLeft: true, containerWidth: 300, top: 10, height: 17, width: 80,
      obstacles: [
        { left: 0, right: 80, top: 0, bottom: 40 },
        { left: 84, right: 170, top: 0, bottom: 40 },
      ],
    })).toBe(174);
    expect(priceAxisOffsetForObstacles({
      onLeft: true, containerWidth: 120, top: 10, height: 17, width: 80,
      obstacles: [{ left: 0, right: 110, top: 0, bottom: 40 }],
    })).toBe(40);
  });
});

describe("layoutPriceAxisBadges", () => {
  const assertNoOverlap = (
    paneHeight: number,
    activeTop: number,
    activeHeight: number,
    placements: ReturnType<typeof layoutPriceAxisBadges>,
  ) => {
    const rows = [
      { id: "active", top: activeTop, height: activeHeight },
      ...placements.map((p) => ({ id: p.id, top: p.top, height: PRICE_TAG_ROW_HEIGHT })),
    ].sort((a, b) => a.top - b.top);
    for (const row of rows) {
      expect(row.top, `${row.id} top`).toBeGreaterThanOrEqual(0);
      expect(row.top + row.height, `${row.id} bottom`).toBeLessThanOrEqual(paneHeight);
    }
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].top, `${rows[i - 1].id}/${rows[i].id} overlap`)
        .toBeGreaterThanOrEqual(rows[i - 1].top + rows[i - 1].height + 1);
    }
  };

  it("fans a dense level cluster around the active timed quote without moving any price line", () => {
    const activeTop = 92;
    const activeHeight = PRICE_TAG_ROW_HEIGHT + PRICE_TAG_TIME_HEIGHT;
    const badges = [
      { id: "close", anchorY: 101, naturalTop: 93, preferredSide: "above" as const },
      { id: "cw", anchorY: 100, naturalTop: 92 },
      { id: "flip", anchorY: 102, naturalTop: 94 },
      { id: "em_hi", anchorY: 104, naturalTop: 96 },
      { id: "pw", anchorY: 106, naturalTop: 98 },
      { id: "em_lo", anchorY: 108, naturalTop: 100 },
    ];
    const placed = layoutPriceAxisBadges({ paneHeight: 220, activeTop, activeHeight, badges });
    expect(placed.map((p) => p.id).sort()).toEqual(badges.map((b) => b.id).sort());
    expect(placed.some((p) => p.docked)).toBe(true);
    assertNoOverlap(220, activeTop, activeHeight, placed);
  });

  it("leaves naturally separated level badges at their true projected rows", () => {
    const placed = layoutPriceAxisBadges({
      paneHeight: 220,
      activeTop: 92,
      activeHeight: PRICE_TAG_ROW_HEIGHT,
      badges: [
        { id: "cw", anchorY: 28, naturalTop: 20 },
        { id: "pw", anchorY: 178, naturalTop: 170 },
      ],
    });
    expect(Object.fromEntries(placed.map((p) => [p.id, p.top]))).toEqual({ cw: 20, pw: 170 });
    expect(placed.every((p) => !p.docked)).toBe(true);
  });

  it("separates coincident PW and EM- badges while preserving their own anchor metadata", () => {
    const placed = layoutPriceAxisBadges({
      paneHeight: 180,
      activeTop: 70,
      activeHeight: PRICE_TAG_ROW_HEIGHT,
      badges: [
        { id: "pw", anchorY: 120, naturalTop: 112 },
        { id: "em_lo", anchorY: 120.4, naturalTop: 112 },
      ],
    });
    const byId = Object.fromEntries(placed.map((p) => [p.id, p]));
    expect(Math.abs(byId.pw.top - byId.em_lo.top)).toBeGreaterThanOrEqual(PRICE_TAG_ROW_HEIGHT + 1);
    expect(byId.pw.anchorY).toBe(120);
    expect(byId.em_lo.anchorY).toBe(120.4);
    assertNoOverlap(180, 70, PRICE_TAG_ROW_HEIGHT, placed);
  });

  it("moves overflow into adjacent horizontal lanes when one pane column cannot fit every badge", () => {
    const activeTop = 60;
    const activeHeight = PRICE_TAG_ROW_HEIGHT + PRICE_TAG_TIME_HEIGHT;
    const placed = layoutPriceAxisBadges({
      paneHeight: 150,
      activeTop,
      activeHeight,
      badges: Array.from({ length: 7 }, (_, index) => ({
        id: index === 0 ? "close" : `level-${index}`,
        anchorY: 68 + index * 0.2,
        naturalTop: 60 + index * 0.2,
        priority: index === 0 ? 100 : 0,
      })),
    });
    expect(placed).toHaveLength(7);
    expect(Math.max(...placed.map((badge) => badge.lane))).toBeGreaterThan(0);
    expect(placed.find((badge) => badge.id === "close")?.lane).toBe(0);

    const lanes = new Map<number, typeof placed>();
    for (const badge of placed) lanes.set(badge.lane, [...(lanes.get(badge.lane) ?? []), badge]);
    for (const [lane, badges] of lanes) {
      const rows = [
        ...(lane === 0 ? [{ id: "active", top: activeTop, height: activeHeight }] : []),
        ...badges.map((badge) => ({ id: badge.id, top: badge.top, height: PRICE_TAG_ROW_HEIGHT })),
      ].sort((a, b) => a.top - b.top);
      for (let index = 1; index < rows.length; index++) {
        expect(rows[index].top, `lane ${lane}: ${rows[index - 1].id}/${rows[index].id}`)
          .toBeGreaterThanOrEqual(rows[index - 1].top + rows[index - 1].height + 1);
      }
    }
  });

  it("spills crowded badges to the free side when the active quote is against a pane edge", () => {
    const activeTop = 1;
    const placed = layoutPriceAxisBadges({
      paneHeight: 150,
      activeTop,
      activeHeight: PRICE_TAG_ROW_HEIGHT + PRICE_TAG_TIME_HEIGHT,
      badges: Array.from({ length: 5 }, (_, i) => ({
        id: `level-${i}`,
        anchorY: 8 + i,
        naturalTop: i,
        preferredSide: "above" as const,
      })),
    });
    expect(placed.every((p) => p.top > activeTop)).toBe(true);
    assertNoOverlap(150, activeTop, PRICE_TAG_ROW_HEIGHT + PRICE_TAG_TIME_HEIGHT, placed);
  });
});
