import { expect, type Locator } from "@playwright/test";

// Shared tap-target size assertion. Not a spec file — Playwright's default testMatch only
// collects *.spec.ts, so this module is imported, never run.

/**
 * Assert a control meets its minimum tap-target size, measured in WHOLE CSS pixels.
 *
 * `boundingBox()` reports a box that has already been through fractional device-pixel
 * arithmetic, so a control the stylesheet pins at exactly 44px can come back as
 * 43.99999237060547. The Chinese Company Intelligence workspace failed on precisely that
 * value in CI — original attempt AND retry, so the retry budget bought nothing — and blocked
 * an unrelated PR whose diff could not reach the element.
 *
 * Rounding to whole pixels is what these floors actually mean: every tap-target floor in this
 * suite is an integer written in CSS, so a control that is genuinely undersized (a 43px box)
 * still rounds to 43 and still fails. Only the sub-pixel noise is absorbed — the contract is
 * unchanged, and a real regression is still caught.
 *
 * A control that is absent or unrendered has no box at all; that measures 0 and fails, as
 * a raw `?? 0` comparison did before.
 */
export async function expectTapTarget(
  target: Locator,
  min: { width?: number; height?: number },
): Promise<void> {
  const box = await target.boundingBox();
  const measured = { width: Math.round(box?.width ?? 0), height: Math.round(box?.height ?? 0) };
  const where = String(target);
  if (min.width != null) {
    expect(measured.width, `${where} tap-target width (raw ${box ? box.width : "no box"})`).toBeGreaterThanOrEqual(min.width);
  }
  if (min.height != null) {
    expect(measured.height, `${where} tap-target height (raw ${box ? box.height : "no box"})`).toBeGreaterThanOrEqual(min.height);
  }
}
