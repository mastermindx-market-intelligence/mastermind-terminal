import { describe, expect, it } from "vitest";

import { intelligenceWorkspaceLayout } from "../intelligenceWorkspaceLayout";
import type { Layout, LayoutInput, Rect } from "../intelligenceWorkspaceLayout";

const DESKTOP_VIEWPORT = { width: 1440, height: 900 };
const CHART: Rect = { left: 0, top: 0, right: 1100, bottom: 900 };

const railAt = (left: number): Rect => ({ left, top: 0, right: 1440, bottom: 900 });

const base = (overrides: Partial<LayoutInput> = {}): LayoutInput => ({
  viewport: { ...DESKTOP_VIEWPORT },
  chart: { ...CHART },
  rail: railAt(1100),
  ...overrides,
});

const rightEdge = (layout: Layout): number => layout.left + layout.width;
const bottomEdge = (layout: Layout): number => layout.top + layout.height;

const expectFiniteNonnegative = (layout: Layout): void => {
  for (const key of ["left", "top", "width", "height", "minWidth", "maxWidth"] as const) {
    expect(Number.isFinite(layout[key])).toBe(true);
    expect(layout[key]).toBeGreaterThanOrEqual(0);
  }
};

const expectInside = (
  layout: Layout,
  viewport: { width: number; height: number; offsetLeft?: number; offsetTop?: number },
): void => {
  const offsetLeft = viewport.offsetLeft ?? 0;
  const offsetTop = viewport.offsetTop ?? 0;
  expect(layout.left).toBeGreaterThanOrEqual(offsetLeft);
  expect(rightEdge(layout)).toBeLessThanOrEqual(offsetLeft + viewport.width);
  expect(layout.top).toBeGreaterThanOrEqual(offsetTop);
  expect(bottomEdge(layout)).toBeLessThanOrEqual(offsetTop + viewport.height);
};

describe("intelligenceWorkspaceLayout", () => {
  describe("docked desktop layout", () => {
    it("docks beside the rail on a 1440x900 viewport", () => {
      const layout = intelligenceWorkspaceLayout(base());

      expect(layout.mode).toBe("docked");
      expect(rightEdge(layout)).toBe(1092); // rail.left - 8
      expect(layout.width).toBe(440); // default docked width
      expect(layout.left).toBe(652);
      expect(layout.top).toBe(8);
      expect(layout.height).toBe(884); // 900 - 2 * 8
      expect(layout.minWidth).toBe(360);
      expect(layout.maxWidth).toBe(760);
      expectFiniteNonnegative(layout);
      expectInside(layout, DESKTOP_VIEWPORT);
    });

    it("keeps the chart's protected slice visible left of the drawer", () => {
      const layout = intelligenceWorkspaceLayout(base());
      // leftLimit = chart.left + min(220, 1100 * 0.2) = 220
      expect(layout.left).toBeGreaterThanOrEqual(CHART.left + 220);
      expect(layout.left).toBeGreaterThanOrEqual(220);
    });

    it("tracks the rail when it is moved or resized", () => {
      const movedLeft = intelligenceWorkspaceLayout(base({ rail: railAt(900) }));
      expect(movedLeft.mode).toBe("docked");
      expect(rightEdge(movedLeft)).toBe(892); // 900 - 8
      expect(movedLeft.left).toBe(452);
      expectInside(movedLeft, DESKTOP_VIEWPORT);

      const narrowed = intelligenceWorkspaceLayout(
        base({ rail: { left: 1000, top: 0, right: 1040, bottom: 900 } }),
      );
      expect(rightEdge(narrowed)).toBe(992); // still rail.left - 8
      expectInside(narrowed, DESKTOP_VIEWPORT);

      const pushedRight = intelligenceWorkspaceLayout(base({ rail: railAt(1300) }));
      expect(rightEdge(pushedRight)).toBe(1100); // chart.right caps the drawer
      expect(rightEdge(pushedRight)).toBeLessThanOrEqual(1300 - 8);
      expectInside(pushedRight, DESKTOP_VIEWPORT);
    });

    it("respects a chart that is shorter than the viewport", () => {
      const chart: Rect = { left: 0, top: 100, right: 1100, bottom: 700 };
      const layout = intelligenceWorkspaceLayout(base({ chart }));
      expect(layout.top).toBe(108); // chart.top + 8
      expect(layout.height).toBe(584); // (700 - 8) - 108
      expect(bottomEdge(layout)).toBe(692); // chart.bottom - 8
    });

    it("honours a scrolled visual viewport", () => {
      const viewport = { width: 1440, height: 900, offsetLeft: 12, offsetTop: 340 };
      const layout = intelligenceWorkspaceLayout({
        viewport,
        chart: { left: 12, top: 340, right: 1112, bottom: 1240 },
        rail: { left: 1112, top: 340, right: 1452, bottom: 1240 },
      });

      expect(layout.mode).toBe("docked");
      expect(layout.top).toBe(348); // offsetTop + 8
      expect(bottomEdge(layout)).toBe(1232); // offsetTop + height - 8
      expect(rightEdge(layout)).toBe(1104); // rail.left - 8
      expectInside(layout, viewport);
    });

    it("docks to the chart's right edge when the rail is absent", () => {
      const layout = intelligenceWorkspaceLayout(base({ rail: null }));
      expect(layout.mode).toBe("docked");
      expect(rightEdge(layout)).toBe(1092); // chart.right - 8
      expectInside(layout, DESKTOP_VIEWPORT);
    });

    it("falls back to the viewport edge when neither chart nor rail is present", () => {
      const layout = intelligenceWorkspaceLayout(base({ chart: null, rail: null }));
      expect(layout.mode).toBe("docked");
      expect(rightEdge(layout)).toBe(1432); // viewportRight - 8
      expect(layout.left).toBe(992); // right edge - default 440 width
      expect(layout.top).toBe(8);
      expect(layout.height).toBe(884);
      expectInside(layout, DESKTOP_VIEWPORT);
    });
  });

  describe("width resolution", () => {
    it("clamps a requested width into [minWidth, maxWidth]", () => {
      const tooWide = intelligenceWorkspaceLayout(base({ requestedWidth: 5000 }));
      expect(tooWide.width).toBe(760); // maxWidth
      expect(tooWide.left).toBe(332); // 1092 - 760
      expect(rightEdge(tooWide)).toBe(1092);

      const tooNarrow = intelligenceWorkspaceLayout(base({ requestedWidth: 100 }));
      expect(tooNarrow.width).toBe(360); // minWidth
      expect(tooNarrow.left).toBe(732); // 1092 - 360
    });

    it("ignores a non-finite requestedWidth", () => {
      const layout = intelligenceWorkspaceLayout(base({ requestedWidth: Number.NaN }));
      expect(layout.width).toBe(440);
    });

    it("expands to the wider default when expanded is set", () => {
      const layout = intelligenceWorkspaceLayout(base({ expanded: true }));
      expect(layout.width).toBe(640);
      expect(layout.left).toBe(452); // 1092 - 640
      expect(rightEdge(layout)).toBe(1092);
    });

    it("caps width at the span the crowded rail leaves open", () => {
      // span = (900 - 8) - (0 + min(220, 1100 * 0.2)) = 672
      const layout = intelligenceWorkspaceLayout(
        base({ rail: railAt(900), requestedWidth: 2000 }),
      );
      expect(layout.maxWidth).toBe(672);
      expect(layout.width).toBe(672);
      expect(layout.minWidth).toBe(360);
      expect(layout.left).toBe(220); // drawer grows left to the chart limit
      expect(rightEdge(layout)).toBe(892); // rail.left - 8
    });
  });

  describe("bottom sheet", () => {
    it("fills the viewport width on a 390x844 phone", () => {
      const viewport = { width: 390, height: 844 };
      const layout = intelligenceWorkspaceLayout(base({ viewport, chart: null, rail: null }));

      expect(layout.mode).toBe("sheet");
      expect(layout.left).toBe(0);
      expect(layout.width).toBe(390);
      expect(layout.minWidth).toBe(390);
      expect(layout.maxWidth).toBe(390);
      expect(layout.height).toBeCloseTo(742.72); // min(844 * 0.88, 900)
      expect(layout.top).toBeCloseTo(101.28); // 844 - 742.72
      expect(bottomEdge(layout)).toBeCloseTo(844);
      expectFiniteNonnegative(layout);
      expectInside(layout, viewport);
    });

    it("pins the sheet to the bottom of a scrolled viewport", () => {
      const viewport = { width: 390, height: 844, offsetLeft: 5, offsetTop: 120 };
      const layout = intelligenceWorkspaceLayout(base({ viewport, chart: null, rail: null }));
      expect(layout.mode).toBe("sheet");
      expect(layout.left).toBe(5); // offsetLeft
      expect(layout.top).toBeCloseTo(120 + 844 - 742.72);
      expect(bottomEdge(layout)).toBeCloseTo(964); // offsetTop + height
      expectInside(layout, viewport);
    });

    it("switches modes exactly at the 860px breakpoint", () => {
      const atBreakpoint = intelligenceWorkspaceLayout(
        base({ viewport: { width: 860, height: 900 } }),
      );
      expect(atBreakpoint.mode).toBe("sheet");
      expect(atBreakpoint.width).toBe(860);

      const pastBreakpoint = intelligenceWorkspaceLayout(
        base({ viewport: { width: 861, height: 900 } }),
      );
      expect(pastBreakpoint.mode).toBe("docked");
      expectInside(pastBreakpoint, { width: 861, height: 900 });
    });
  });

  describe("malformed input", () => {
    it("ignores charts and rails that are NaN, Infinite or reversed", () => {
      const nanChart = intelligenceWorkspaceLayout(
        base({ chart: { left: Number.NaN, top: 0, right: 1100, bottom: 900 } }),
      );
      expect(rightEdge(nanChart)).toBe(1092); // rail still constrains
      expect(nanChart.top).toBe(8); // unusable chart ignored for vertical span

      const infiniteChart = intelligenceWorkspaceLayout(
        base({ chart: { left: 0, top: 0, right: Number.POSITIVE_INFINITY, bottom: 900 } }),
      );
      expect(rightEdge(infiniteChart)).toBe(1092);

      const reversedRail = intelligenceWorkspaceLayout(
        base({ rail: { left: 1200, top: 0, right: 1000, bottom: 900 } }),
      );
      expect(rightEdge(reversedRail)).toBe(1092); // chart.right - 8

      const reversedChart = intelligenceWorkspaceLayout(
        base({ chart: { left: 1100, top: 0, right: 0, bottom: 900 }, rail: null }),
      );
      expect(rightEdge(reversedChart)).toBe(1432); // viewportRight - 8
    });

    it("sanitizes non-finite, negative and missing viewport dimensions", () => {
      const layout = intelligenceWorkspaceLayout({
        viewport: { width: Number.NaN, height: -50, offsetLeft: Number.NaN, offsetTop: -12 },
        chart: CHART,
        rail: railAt(1100),
      });

      expect(layout.mode).toBe("sheet"); // sanitized to the 360x640 fallback
      expect(layout.width).toBe(360);
      expect(layout.left).toBe(0); // non-finite / negative offsets become 0
      expect(layout.height).toBeCloseTo(563.2); // 640 * 0.88
      expect(layout.top).toBeCloseTo(76.8); // 640 - 563.2
      expectFiniteNonnegative(layout);
    });

    it("stays finite and positive on a tiny viewport", () => {
      const viewport = { width: 10, height: 10 };
      const layout = intelligenceWorkspaceLayout({ viewport, chart: null, rail: null });

      expect(layout.mode).toBe("sheet");
      expect(layout.width).toBe(10);
      expect(layout.height).toBeCloseTo(8.8);
      expect(layout.top).toBeCloseTo(1.2);
      expectFiniteNonnegative(layout);
      expectInside(layout, viewport);
    });

    it("never covers the rail and never overflows the viewport", () => {
      for (const railLeft of [870, 900, 1000, 1100, 1300, 1439]) {
        const layout = intelligenceWorkspaceLayout(base({ rail: railAt(railLeft) }));
        expect(rightEdge(layout)).toBeLessThanOrEqual(railLeft - 8 + 1e-9);
        expect(layout.left).toBeGreaterThanOrEqual(CHART.left + 220 - 1e-9);
        expectInside(layout, DESKTOP_VIEWPORT);
        expectFiniteNonnegative(layout);
      }
    });
  });
});



describe("parent integration edge cases", () => {
  it("uses the chart edge without a second gap when the rail is present", () => {
    const layout = intelligenceWorkspaceLayout({ viewport: { width: 1440, height: 900 }, chart: { left: 0, top: 0, right: 1050, bottom: 900 }, rail: { left: 1100, top: 0, right: 1440, bottom: 900 } });
    expect(layout.left + layout.width).toBe(1050);
  });
  it("keeps even a one-pixel-high desktop viewport bounded", () => {
    const layout = intelligenceWorkspaceLayout({ viewport: { width: 1000, height: 1 }, chart: null, rail: null });
    expect(layout.top).toBeGreaterThanOrEqual(0);
    expect(layout.height).toBeGreaterThanOrEqual(0);
    expect(layout.top + layout.height).toBeLessThanOrEqual(1);
  });
});
