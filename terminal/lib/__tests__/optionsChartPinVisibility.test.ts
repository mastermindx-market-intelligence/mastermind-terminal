import { describe, expect, it } from "vitest";
import { optionsPinRevealRange, optionsPinVisibility } from "@/lib/optionsChartPin";
import {
  axisLogFormulaForRange,
  axisPriceToLog,
  axisRangeFromLog,
  axisRangeToLog,
  axisValueAtCoordinate,
  type AxisMargins,
  type AxisRange,
} from "@/lib/chart-engine/axisZoom";

// The 2026-11-05 Exposure defect: the qualified reference card reports the 103
// strike ready/pinned while the renderer's price range (98.3–101.29156) leaves
// the 103 line outside the visible chart, and nothing in the sync contract says
// whether the drawn pin actually renders on screen.
const DEFECT_RANGE: AxisRange = { from: 98.3, to: 101.29156 };
const PANE_HEIGHT = 360;
const MARGINS: AxisMargins = { top: 0.2, bottom: 0.1 };

// chart-engine's coordinate mapping is linear (see axisValueAtCoordinate), so the
// value under any pixel — including one outside the pane — lies on the line
// through the two in-pane samples that function already provides. That function
// only accepts ascending ranges, so an inverted range is observed through its
// ascending mirror image reflected about the centre. These helpers observe where
// a target lands through that published contract; the options-pin helpers'
// internals (factors, landing insets) are deliberately not mirrored here.
function valueOnAxisLine(range: AxisRange, coordinate: number, height: number, margins: AxisMargins): number {
  const low = Math.min(range.from, range.to);
  const high = Math.max(range.from, range.to);
  const atTop = axisValueAtCoordinate({ from: low, to: high }, 0, height, margins);
  const atBottom = axisValueAtCoordinate({ from: low, to: high }, height - 1, height, margins);
  const sortedValue = atTop + (atBottom - atTop) * (coordinate / (height - 1));
  return range.from <= range.to ? sortedValue : low + high - sortedValue;
}

function coordinateOfValue(range: AxisRange, value: number, height: number, margins: AxisMargins): number {
  const low = Math.min(range.from, range.to);
  const high = Math.max(range.from, range.to);
  const target = range.from <= range.to ? value : low + high - value;
  const atTop = axisValueAtCoordinate({ from: low, to: high }, 0, height, margins);
  const atBottom = axisValueAtCoordinate({ from: low, to: high }, height - 1, height, margins);
  return ((target - atTop) / (atBottom - atTop)) * (height - 1);
}

function innerBand(height: number, margins: AxisMargins): { top: number; bottom: number } {
  return { top: margins.top * height, bottom: height - 1 - margins.bottom * height };
}

function revealedRange(range: AxisRange | null): AxisRange {
  expect(range).not.toBeNull();
  if (range === null) throw new Error("reveal unexpectedly returned null");
  return range;
}

describe("optionsPinVisibility", () => {
  it("reports a finite coordinate inside the pane extent as visible, edges included", () => {
    expect(optionsPinVisibility(150, PANE_HEIGHT)).toBe("visible");
    expect(optionsPinVisibility(0, PANE_HEIGHT)).toBe("visible");
    expect(optionsPinVisibility(PANE_HEIGHT, PANE_HEIGHT)).toBe("visible");
    expect(optionsPinVisibility(0, 1)).toBe("visible");
  });

  it("reports coordinates beyond either pane edge as offscreen", () => {
    expect(optionsPinVisibility(-40, PANE_HEIGHT)).toBe("offscreen");
    expect(optionsPinVisibility(PANE_HEIGHT + 0.5, PANE_HEIGHT)).toBe("offscreen");
  });

  it("cannot classify a missing or non-finite coordinate", () => {
    expect(optionsPinVisibility(null, PANE_HEIGHT)).toBe("unavailable");
    expect(optionsPinVisibility(Number.NaN, PANE_HEIGHT)).toBe("unavailable");
    expect(optionsPinVisibility(Number.POSITIVE_INFINITY, PANE_HEIGHT)).toBe("unavailable");
  });

  it("cannot classify unusable pane geometry", () => {
    expect(optionsPinVisibility(150, 0)).toBe("unavailable");
    expect(optionsPinVisibility(150, -10)).toBe("unavailable");
    expect(optionsPinVisibility(150, Number.NaN)).toBe("unavailable");
  });

  it("stays visible inside a clipped viewport band, whichever order its ends arrive in", () => {
    expect(optionsPinVisibility(150, PANE_HEIGHT, { from: 100, to: 200 })).toBe("visible");
    expect(optionsPinVisibility(150, PANE_HEIGHT, { from: 200, to: 100 })).toBe("visible");
  });

  it("reports pane coordinates clipped out of the viewport band as offscreen", () => {
    expect(optionsPinVisibility(50, PANE_HEIGHT, { from: 100, to: 200 })).toBe("offscreen");
    expect(optionsPinVisibility(300, PANE_HEIGHT, { from: 200, to: 100 })).toBe("offscreen");
  });

  it("reports an empty viewport intersection as offscreen, never visible", () => {
    // Coordinate inside a band lying entirely outside the pane.
    expect(optionsPinVisibility(250, PANE_HEIGHT, { from: 500, to: 600 })).toBe("offscreen");
    // A zero-height band cannot show anything, even at its own coordinate.
    expect(optionsPinVisibility(150, PANE_HEIGHT, { from: 150, to: 150 })).toBe("offscreen");
  });

  it("does not call a band touching only a pane boundary visible", () => {
    expect(optionsPinVisibility(0, PANE_HEIGHT, { from: -100, to: 0 })).toBe("offscreen");
    expect(optionsPinVisibility(PANE_HEIGHT, PANE_HEIGHT, { from: PANE_HEIGHT, to: 1000 })).toBe("offscreen");
  });
  it("treats a non-finite viewport as unusable geometry", () => {
    expect(optionsPinVisibility(150, PANE_HEIGHT, { from: Number.NaN, to: 200 })).toBe("unavailable");
  });
});

describe("optionsPinRevealRange", () => {
  it("reproduces the Exposure defect and expands the range until the pinned line renders inside the inner pane", () => {
    const offscreenY = coordinateOfValue(DEFECT_RANGE, 103, PANE_HEIGHT, MARGINS);
    expect(offscreenY).toBeLessThan(0); // the defect: 103 renders above the pane
    expect(optionsPinVisibility(offscreenY, PANE_HEIGHT)).toBe("offscreen");

    const revealed = revealedRange(optionsPinRevealRange(DEFECT_RANGE, offscreenY, PANE_HEIGHT, MARGINS));
    const band = innerBand(PANE_HEIGHT, MARGINS);
    const revealedY = coordinateOfValue(revealed, 103, PANE_HEIGHT, MARGINS);
    expect(optionsPinVisibility(revealedY, PANE_HEIGHT)).toBe("visible");
    expect(revealedY).toBeGreaterThan(band.top);
    expect(revealedY).toBeLessThan(band.bottom);
    // The existing visible range is retained, not replaced or shrunk.
    expect(revealed.from).toBeLessThan(DEFECT_RANGE.from);
    expect(revealed.to).toBeGreaterThan(DEFECT_RANGE.to);
  });

  it("supports an actual invertScale axis by reflecting its measured coordinate at the caller boundary", () => {
    const normalY = coordinateOfValue(DEFECT_RANGE, 103, PANE_HEIGHT, MARGINS);
    const nativeY = PANE_HEIGHT - 1 - normalY;
    expect(nativeY).toBeGreaterThan(PANE_HEIGHT);
    const next = revealedRange(optionsPinRevealRange(DEFECT_RANGE, PANE_HEIGHT - 1 - nativeY, PANE_HEIGHT, MARGINS));
    const revealedNativeY = PANE_HEIGHT - 1 - coordinateOfValue(next, 103, PANE_HEIGHT, MARGINS);
    expect(revealedNativeY).toBeGreaterThan(0);
    expect(revealedNativeY).toBeLessThan(PANE_HEIGHT);
  });
  it("returns the identical input range while the pin already renders inside the pane", () => {
    const range: AxisRange = { ...DEFECT_RANGE };
    expect(optionsPinRevealRange(range, 150, PANE_HEIGHT, MARGINS)).toBe(range);
    expect(optionsPinRevealRange(range, 0, PANE_HEIGHT, MARGINS)).toBe(range);
    expect(optionsPinRevealRange(range, PANE_HEIGHT, PANE_HEIGHT, MARGINS)).toBe(range);
    // Inside the margin bands is still inside the pane: a scroll-only reveal must not rescale.
    expect(optionsPinRevealRange(range, 8, PANE_HEIGHT, MARGINS)).toBe(range);
    expect(optionsPinRevealRange(range, 356, PANE_HEIGHT, MARGINS)).toBe(range);
  });

  it("reveals a target below the pane just as it reveals one above", () => {
    const offscreenY = coordinateOfValue(DEFECT_RANGE, 97, PANE_HEIGHT, MARGINS);
    expect(offscreenY).toBeGreaterThan(PANE_HEIGHT);
    const revealed = revealedRange(optionsPinRevealRange(DEFECT_RANGE, offscreenY, PANE_HEIGHT, MARGINS));
    const band = innerBand(PANE_HEIGHT, MARGINS);
    const revealedY = coordinateOfValue(revealed, 97, PANE_HEIGHT, MARGINS);
    expect(revealedY).toBeGreaterThan(band.top);
    expect(revealedY).toBeLessThan(band.bottom);
    expect(revealed.from).toBeLessThan(DEFECT_RANGE.from);
    expect(revealed.to).toBeGreaterThan(DEFECT_RANGE.to);
  });

  it("keeps an inverted axis inverted and lands its target inside the inner pane", () => {
    const inverted: AxisRange = { from: 101.29156, to: 98.3 };
    const offscreenY = coordinateOfValue(inverted, 103, PANE_HEIGHT, MARGINS);
    expect(offscreenY).toBeGreaterThan(PANE_HEIGHT); // inversion moves 103 below the pane
    const revealed = revealedRange(optionsPinRevealRange(inverted, offscreenY, PANE_HEIGHT, MARGINS));
    expect(revealed.from).toBeGreaterThan(revealed.to);
    const revealedY = coordinateOfValue(revealed, 103, PANE_HEIGHT, MARGINS);
    const band = innerBand(PANE_HEIGHT, MARGINS);
    expect(revealedY).toBeGreaterThan(band.top);
    expect(revealedY).toBeLessThan(band.bottom);
    expect(Math.min(revealed.from, revealed.to)).toBeLessThan(98.3);
    expect(Math.max(revealed.from, revealed.to)).toBeGreaterThan(101.29156);
  });

  it("returns the same inverted range untouched while its pin renders in the pane", () => {
    const inverted: AxisRange = { from: 101.29156, to: 98.3 };
    const inPaneY = coordinateOfValue(inverted, 99, PANE_HEIGHT, MARGINS);
    expect(inPaneY).toBeGreaterThan(0);
    expect(inPaneY).toBeLessThan(PANE_HEIGHT);
    expect(optionsPinRevealRange(inverted, inPaneY, PANE_HEIGHT, MARGINS)).toBe(inverted);
  });

  it("reveals prepared percent-mode domains as plain numbers, with no mode conversion", () => {
    const percent: AxisRange = { from: -2.5, to: 3.75 };
    const offscreenY = coordinateOfValue(percent, 9.5, PANE_HEIGHT, MARGINS);
    expect(offscreenY).toBeLessThan(0);
    const revealed = revealedRange(optionsPinRevealRange(percent, offscreenY, PANE_HEIGHT, MARGINS));
    expect(revealed.from).toBeLessThan(9.5);
    expect(revealed.to).toBeGreaterThan(9.5);
    expect(revealed.from).toBeLessThan(3.75); // still a percent-style linear domain, unconverted
  });

  it("reveals a log-mode domain linearized through axisZoom's own bridge", () => {
    const priceRange: AxisRange = { from: 90, to: 110 };
    const formula = axisLogFormulaForRange(priceRange);
    const logRange = axisRangeToLog(priceRange, formula);
    const targetLog = axisPriceToLog(130, formula);
    const offscreenY = coordinateOfValue(logRange, targetLog, PANE_HEIGHT, MARGINS);
    expect(offscreenY).toBeLessThan(0);
    const revealedLog = revealedRange(optionsPinRevealRange(logRange, offscreenY, PANE_HEIGHT, MARGINS));
    const revealedPrice = axisRangeFromLog(revealedLog, formula);
    expect(revealedPrice.from).toBeLessThan(90);
    expect(revealedPrice.to).toBeGreaterThan(130);
  });

  it("is idempotent: after a reveal the coordinate is visible and a second reveal keeps the scale", () => {
    const offscreenY = coordinateOfValue(DEFECT_RANGE, 103, PANE_HEIGHT, MARGINS);
    const revealed = revealedRange(optionsPinRevealRange(DEFECT_RANGE, offscreenY, PANE_HEIGHT, MARGINS));
    const revealedY = coordinateOfValue(revealed, 103, PANE_HEIGHT, MARGINS);
    expect(optionsPinVisibility(revealedY, PANE_HEIGHT)).toBe("visible");
    expect(optionsPinRevealRange(revealed, revealedY, PANE_HEIGHT, MARGINS)).toBe(revealed);
  });

  it("never mutates the caller's range, even when frozen", () => {
    const frozen: AxisRange = Object.freeze({ ...DEFECT_RANGE });
    const revealed = optionsPinRevealRange(frozen, -200, PANE_HEIGHT, MARGINS);
    expect(revealed).not.toBeNull();
    expect(revealed).not.toBe(frozen);
    expect(frozen).toEqual(DEFECT_RANGE);
  });

  it("still reveals on small usable panes", () => {
    const small = 12;
    const revealed = revealedRange(optionsPinRevealRange(DEFECT_RANGE, -5, small, { top: 0.1, bottom: 0.1 }));
    const band = innerBand(small, { top: 0.1, bottom: 0.1 });
    const revealedY = coordinateOfValue(revealed, 103, small, { top: 0.1, bottom: 0.1 });
    expect(revealedY).toBeGreaterThan(band.top);
    expect(revealedY).toBeLessThan(band.bottom);
  });

  it("returns null for unusable ranges, targets or geometry instead of a guess", () => {
    expect(optionsPinRevealRange(null, 50, PANE_HEIGHT, MARGINS)).toBeNull();
    expect(optionsPinRevealRange({ from: Number.NaN, to: 101 }, -50, PANE_HEIGHT, MARGINS)).toBeNull();
    expect(optionsPinRevealRange({ from: 98.3, to: Number.POSITIVE_INFINITY }, -50, PANE_HEIGHT, MARGINS)).toBeNull();
    expect(optionsPinRevealRange({ from: 101.29156, to: 101.29156 }, -50, PANE_HEIGHT, MARGINS)).toBeNull();
    expect(optionsPinRevealRange(DEFECT_RANGE, null, PANE_HEIGHT, MARGINS)).toBeNull();
    expect(optionsPinRevealRange(DEFECT_RANGE, Number.NaN, PANE_HEIGHT, MARGINS)).toBeNull();
    expect(optionsPinRevealRange(DEFECT_RANGE, -50, 1, MARGINS)).toBeNull();
    expect(optionsPinRevealRange(DEFECT_RANGE, -50, 0, MARGINS)).toBeNull();
    expect(optionsPinRevealRange(DEFECT_RANGE, -50, Number.NaN, MARGINS)).toBeNull();
    expect(optionsPinRevealRange(DEFECT_RANGE, -50, PANE_HEIGHT, { top: Number.NaN, bottom: 0.1 })).toBeNull();
    expect(optionsPinRevealRange(DEFECT_RANGE, -50, PANE_HEIGHT, { top: -0.1, bottom: 0.1 })).toBeNull();
    expect(optionsPinRevealRange(DEFECT_RANGE, -50, PANE_HEIGHT, { top: 0.55, bottom: 0.55 })).toBeNull();
    expect(optionsPinRevealRange(DEFECT_RANGE, -50, PANE_HEIGHT, { top: 0.5, bottom: 0.4975 })).toBeNull();
    // At numeric limits the uniform expansion would overflow, so no range is fabricated.
    expect(optionsPinRevealRange({ from: -1e308, to: 1e308 }, -1.5e308, PANE_HEIGHT, MARGINS)).toBeNull();
    // Sanity: the ordinary cases above really did produce geometry to observe.
    expect(valueOnAxisLine(DEFECT_RANGE, 0, PANE_HEIGHT, MARGINS)).toBeCloseTo(102.1497, 3);
  });
});
