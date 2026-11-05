import { describe, it, expect } from "vitest";
import {
  axisWidthForLabels,
  layoutPriceLabels,
  layoutTimeLabels,
  type AxisWidthState,
  type Measure,
  type PlacedLabel,
} from "../chart-engine/canvas/axes";

// ─────────────────────────────────────────────────────────────────────────────
// AXES — axis label layout for the native (canvas) chart renderer.
//
// The module is pure geometry with an injected text measurer, so these tests run
// in plain Node with a monospace fake: 7px per character, 12px tall. That makes
// every expected pixel position computable by hand — which is the point: each
// test pins one rule (AXES-A01 pinned-wins, AXES-A02 containment, A03 width
// hysteresis, pixel-gap thinning, weight precedence, DPR snapping, determinism)
// with numbers a mutant cannot satisfy by accident.
// ─────────────────────────────────────────────────────────────────────────────

const mono: Measure = (text) => ({ width: 7 * text.length, height: 12 });
const FONT = "12px Menlo, monospace";

const priceAxis = { heightPx: 300, widthPx: 60, paddingPx: 6, font: FONT, dpr: 1 };
const timeAxis = { widthPx: 400, paddingPx: 8, font: FONT, dpr: 1, minGapPx: 60 };

const visible = (labels: PlacedLabel[]) => labels.filter((l) => !l.hidden);
const boxesOf = (labels: PlacedLabel[]) =>
  labels.map((l) => ({ text: l.text, kind: l.kind, x: l.x, y: l.y, hidden: l.hidden }));

describe("layoutPriceLabels", () => {
  it("keeps an unopposed tick at its mapped y, left-edged at paddingPx", () => {
    const out = layoutPriceLabels([{ value: 150, y: 150, label: "150.00" }], priceAxis, mono);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      text: "150.00",
      x: 6,
      y: 150,
      width: 42,
      height: 12,
      kind: "tick",
      hidden: false,
    });
  });

  it("AXES-A01: a pinned label always wins over a colliding tick", () => {
    const out = layoutPriceLabels(
      [
        { value: 150, y: 150, label: "150.00" },
        { value: 160, y: 155, label: "160.00" },
      ],
      priceAxis,
      mono,
      [{ value: 150, y: 150, label: "150.00", priority: 5 }],
    );
    // The tick at exactly the pinned y, and the tick whose box still overlaps it
    // (|155 - 150| = 5 < (12 + 12) / 2), both give way.
    expect(visible(out).map((l) => l.kind)).toEqual(["pinned"]);
    expect(out.filter((l) => l.kind === "tick").every((l) => l.hidden)).toBe(true);
    expect(visible(out)[0].y).toBe(150);
  });

  it("AXES-A02: edge ticks shift inward and every visible box stays inside [0, heightPx]", () => {
    const ticks = [-40, -0.5, 0.5, 150, 299.5, 340].map((y, i) => ({
      value: i,
      y,
      label: "100.00",
    }));
    const out = layoutPriceLabels(ticks, { ...priceAxis, minGapPx: 1 }, mono);
    for (const l of visible(out)) {
      expect(l.y - l.height / 2).toBeGreaterThanOrEqual(0);
      expect(l.y + l.height / 2).toBeLessThanOrEqual(priceAxis.heightPx);
    }
    const ys = visible(out).map((l) => l.y);
    expect(ys).toContain(6); // -40 clamped to the top inset
    expect(ys).toContain(294); // 340 clamped to the bottom inset
  });

  it("AXES-A02: a pinned label at an edge is shifted inward, not clipped", () => {
    const out = layoutPriceLabels([], priceAxis, mono, [
      { value: 1, y: -40, label: "4321.00", priority: 9 },
    ]);
    expect(out[0].hidden).toBe(false);
    expect(out[0].y).toBe(6);
  });

  it("thins by pixel gap at mapped positions, never by index", () => {
    // Gaps between mapped y: 30, 5, 25, 30 with minGapPx 20 → the 45 is dropped
    // and the 70 survives. `i % 2` would keep [10, 45, 100] instead.
    const ticks = [10, 40, 45, 70, 100].map((y) => ({ value: y, y, label: "80.00" }));
    const out = layoutPriceLabels(ticks, { ...priceAxis, minGapPx: 20 }, mono);
    expect(visible(out).map((l) => l.y)).toEqual([10, 40, 70, 100]);
  });

  it("defaults the vertical gap to the tallest tick label height", () => {
    // No minGapPx: gap = 12 (label height) → 28 is 8px from 20 and hides; 40 clears.
    const ticks = [20, 28, 40].map((y) => ({ value: y, y, label: "80.00" }));
    const out = layoutPriceLabels(ticks, priceAxis, mono);
    expect(visible(out).map((l) => l.y)).toEqual([20, 40]);
  });

  it("nudges a colliding lower-priority pinned label by one label height", () => {
    const out = layoutPriceLabels([], priceAxis, mono, [
      { value: 150, y: 150, label: "150.00", priority: 9 },
      { value: 150, y: 150, label: "149.75", priority: 5 },
    ]);
    expect(out).toHaveLength(2);
    expect(out.find((l) => l.text === "150.00")).toMatchObject({ hidden: false, y: 150 });
    expect(out.find((l) => l.text === "149.75")).toMatchObject({ hidden: false, y: 138 });
  });

  it("hides a pinned label only after two label heights fail to free a slot", () => {
    const pinned = [9, 8, 7, 6, 5, 4].map((priority) => ({
      value: 150,
      y: 150,
      label: `${priority}.00`,
      priority,
    }));
    const out = layoutPriceLabels([], priceAxis, mono, pinned);
    const byText = new Map(out.map((l) => [l.text, l]));
    // Winners fan out over the five on-grid slots within ±2 heights of 150.
    expect(byText.get("9.00")).toMatchObject({ hidden: false, y: 150 });
    expect(byText.get("8.00")).toMatchObject({ hidden: false, y: 138 });
    expect(byText.get("7.00")).toMatchObject({ hidden: false, y: 162 });
    expect(byText.get("6.00")).toMatchObject({ hidden: false, y: 126 });
    expect(byText.get("5.00")).toMatchObject({ hidden: false, y: 174 });
    expect(byText.get("4.00")?.hidden).toBe(true);
    expect(visible(out)).toHaveLength(5);
  });

  it("snaps placed y to multiples of 1/dpr", () => {
    const atDpr = (dpr: number) =>
      layoutPriceLabels(
        [100.3, 200.6].map((y) => ({ value: y, y, label: "80.00" })),
        { ...priceAxis, dpr },
        mono,
      );
    // dpr 1.25: round(100.3 * 1.25) = 125 → 100; round(200.6 * 1.25) = 251 → 200.8.
    const q125 = visible(atDpr(1.25)).map((l) => l.y);
    expect(q125).toEqual([100, 200.8]);
    // dpr 2: round(100.3 * 2) = 201 → 100.5; round(200.6 * 2) = 401 → 200.5.
    const q2 = visible(atDpr(2)).map((l) => l.y);
    expect(q2).toEqual([100.5, 200.5]);
    for (const dpr of [1, 1.25, 2]) {
      for (const l of visible(atDpr(dpr))) {
        expect(Math.abs(l.y * dpr - Math.round(l.y * dpr))).toBeLessThan(1e-9);
      }
    }
  });

  it("is deterministic, including under permuted pinned input", () => {
    const ticks = [30, 90, 150, 210, 270].map((y) => ({ value: y, y, label: "80.00" }));
    const pinned = [
      { value: 150, y: 150, label: "150.00", priority: 9 },
      { value: 90, y: 92, label: "90.00", priority: 5 },
    ];
    const a = boxesOf(layoutPriceLabels(ticks, priceAxis, mono, pinned));
    const b = boxesOf(layoutPriceLabels(ticks, priceAxis, mono, pinned));
    expect(a).toEqual(b);
    // Same pinned set, reversed input order: priorities decide, so the placed
    // outcome (compared order-independently) is identical.
    const permuted = boxesOf(layoutPriceLabels(ticks, priceAxis, mono, [...pinned].reverse()));
    expect([...permuted].sort((p, q) => p.text.localeCompare(q.text)))
      .toEqual([...a].sort((p, q) => p.text.localeCompare(q.text)));
  });
});

describe("layoutTimeLabels", () => {
  it("keeps an unopposed tick centered on its mapped x", () => {
    const out = layoutTimeLabels([{ x: 100, label: "10:30", weight: 0 }], timeAxis, mono);
    expect(out[0]).toEqual({
      text: "10:30",
      x: 100,
      y: 0,
      width: 35,
      height: 12,
      kind: "tick",
      hidden: false,
    });
  });

  it("centers the pinned crosshair label on x but shifts it inward at the edges", () => {
    const out = layoutTimeLabels([], timeAxis, mono, [
      { x: 10, label: "AAAA", priority: 9 },
      { x: 395, label: "BBBB", priority: 9 },
    ]);
    // Label width 28 → centers must stay within [8 + 14, 400 - 8 - 14] = [22, 378].
    expect(out[0]).toMatchObject({ hidden: false, x: 22 });
    expect(out[1]).toMatchObject({ hidden: false, x: 378 });
    for (const l of visible(out)) {
      expect(l.x - l.width / 2).toBeGreaterThanOrEqual(timeAxis.paddingPx);
      expect(l.x + l.width / 2).toBeLessThanOrEqual(timeAxis.widthPx - timeAxis.paddingPx);
    }
  });

  it("AXES-A01: the pinned crosshair time label beats a colliding tick", () => {
    const out = layoutTimeLabels([{ x: 100, label: "10:30", weight: 0 }], timeAxis, mono, [
      { x: 100, label: "10:31", priority: 9 },
    ]);
    expect(visible(out).map((l) => l.kind)).toEqual(["pinned"]);
    expect(out[0].hidden).toBe(true);
  });

  it("thins by pixel gap at mapped positions, never by index", () => {
    // Gaps: 30, 5, 25, 30 with minGapPx 60 → only 100 and 160 survive;
    // `i % 2` would keep [100, 135, 190].
    const ticks = [100, 130, 135, 160, 190].map((x) => ({ x, label: "AAAA", weight: 0 }));
    const out = layoutTimeLabels(ticks, timeAxis, mono);
    expect(visible(out).map((l) => l.x)).toEqual([100, 160]);
  });

  it("lets a higher-weight tick displace a colliding lighter tick", () => {
    const out = layoutTimeLabels(
      [
        { x: 100, label: "AAAA", weight: 1 },
        { x: 130, label: "BBBB", weight: 5 },
      ],
      timeAxis,
      mono,
    );
    expect(out.find((l) => l.text === "AAAA")?.hidden).toBe(true);
    expect(out.find((l) => l.text === "BBBB")).toMatchObject({ hidden: false, x: 130 });
  });

  it("keeps the earlier tick when weights are equal", () => {
    const out = layoutTimeLabels(
      [
        { x: 100, label: "AAAA", weight: 3 },
        { x: 130, label: "BBBB", weight: 3 },
      ],
      timeAxis,
      mono,
    );
    expect(out.find((l) => l.text === "AAAA")).toMatchObject({ hidden: false, x: 100 });
    expect(out.find((l) => l.text === "BBBB")?.hidden).toBe(true);
  });

  it("is deterministic across runs", () => {
    const ticks = [60, 140, 220, 300, 380].map((x, i) => ({ x, label: "10:30", weight: i }));
    const a = boxesOf(layoutTimeLabels(ticks, timeAxis, mono));
    const b = boxesOf(layoutTimeLabels(ticks, timeAxis, mono));
    expect(a).toEqual(b);
  });
});

describe("axisWidthForLabels", () => {
  it("returns the widest label plus 2*padding, rounded up to whole CSS px", () => {
    // 7px/char: "1234.56" → 49; 2 * 4 padding → ceil(57) = 57.
    expect(axisWidthForLabels(["1.1", "1234.56"], mono, FONT, 4)).toBe(57);
    // Fractional widths round UP: 3 chars * 7.3 = 21.9 + 8 → 30.
    const fractional: Measure = (text) => ({ width: 7.3 * text.length, height: 12 });
    expect(axisWidthForLabels(["abc"], fractional, FONT, 4)).toBe(30);
    expect(axisWidthForLabels([], mono, FONT, 4)).toBe(8);
  });

  it("grows immediately when a longer label appears", () => {
    const state: AxisWidthState = { width: 0, shrinkStreak: 0 };
    expect(axisWidthForLabels(["12.34"], mono, FONT, 4, 3, state)).toBe(43);
    expect(axisWidthForLabels(["1234.5678"], mono, FONT, 4, 3, state)).toBe(71);
    expect(state).toEqual({ width: 71, shrinkStreak: 0 });
  });

  it("AXES-A03: shrinks only after the smaller width persists N frames", () => {
    const state: AxisWidthState = { width: 0, shrinkStreak: 0 };
    axisWidthForLabels(["1234.56"], mono, FONT, 4, 3, state); // commit 57
    // "1.1" wants 29. Frames 1 and 2 hold; frame 3 commits.
    expect(axisWidthForLabels(["1.1"], mono, FONT, 4, 3, state)).toBe(57);
    expect(state.shrinkStreak).toBe(1);
    expect(axisWidthForLabels(["1.1"], mono, FONT, 4, 3, state)).toBe(57);
    expect(state.shrinkStreak).toBe(2);
    expect(axisWidthForLabels(["1.1"], mono, FONT, 4, 3, state)).toBe(29);
    expect(state).toEqual({ width: 29, shrinkStreak: 0 });
  });

  it("resets when the caller supplies a fresh state", () => {
    expect(axisWidthForLabels(["1.1"], mono, FONT, 4, 3, { width: 0, shrinkStreak: 0 })).toBe(29);
  });

  it("without state there is no hysteresis: the natural width is returned", () => {
    expect(axisWidthForLabels(["1234.56"], mono, FONT, 4)).toBe(57);
    expect(axisWidthForLabels(["1.1"], mono, FONT, 4)).toBe(29);
  });
});
