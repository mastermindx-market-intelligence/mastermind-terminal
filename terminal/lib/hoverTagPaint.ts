/**
 * Decide whether the pointer price label stays painted through a scale or
 * layout frame that cannot map the current pointer yet.
 *
 * ChartPanel.tsx refreshHoverTag used to set display:none whenever
 * priceToCoordinate / coordinateToPrice returned null. That left leftover
 * text on a hidden `.mm-hovertag` (hosted job 101689653547 Shape A) until
 * another pointer event succeeded. Hide only when the pointer has left the
 * price pane or the pane itself is not projecting.
 */
export type HoverTagPaint = "hide" | "keep" | "show";

export function hoverTagPaint(input: {
  hoverActive: boolean;
  priceProjectedHidden: boolean;
  hasSeries: boolean;
  y: number | null;
  value: number | null;
}): HoverTagPaint {
  if (!input.hoverActive || input.priceProjectedHidden || !input.hasSeries) return "hide";
  if (input.y == null || !Number.isFinite(input.y) || input.value == null || !Number.isFinite(input.value)) {
    return "keep";
  }
  return "show";
}
