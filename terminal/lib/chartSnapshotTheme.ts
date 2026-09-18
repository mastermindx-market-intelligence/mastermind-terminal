export type SnapshotSurface = {
  kind: "solid" | "gradient";
  topColor: string;
  bottomColor: string;
};

export type SnapshotSurfaceInput = {
  backgroundType?: "solid" | "gradient";
  backgroundTop?: string;
  backgroundBottom?: string;
  paneBackgroundImage?: string;
  paneBackgroundColor?: string;
  chartBackground?: string;
  pageBackground?: string;
};

const FALLBACK_CHART_BACKGROUND = "#131722";
const CSS_COLOR = /#[0-9a-f]{3,8}\b|(?:rgb|hsl)a?\([^)]*\)/gi;

function usableColor(value: string | null | undefined): string | null {
  const color = value?.trim();
  if (!color || color === "transparent") return null;
  const transparentRgba = color.match(/^rgba\([^/)]*(?:,|\s)\s*0(?:\.0+)?\s*\)$/i);
  return transparentRgba ? null : color;
}

function paneGradient(value: string | null | undefined): SnapshotSurface | null {
  const image = value?.trim();
  if (!image || image === "none" || !/^linear-gradient\(/i.test(image)) return null;
  const colors = image.match(CSS_COLOR) ?? [];
  if (colors.length < 2) return null;
  return {
    kind: "gradient",
    topColor: colors[0]!,
    bottomColor: colors[colors.length - 1]!,
  };
}

/**
 * Resolves the surface that is actually visible behind lightweight-charts.
 *
 * The chart renderer is transparent by default, so page chrome (`--bg`) is not the
 * visible canvas. The containing `.pane` / `--chart-bg` owns that surface. Explicit
 * chart settings win, then a pane gradient/color, then the chart token, with page
 * background only as the final compatibility fallback.
 */
export function resolveSnapshotSurface(input: SnapshotSurfaceInput): SnapshotSurface {
  const customTop = usableColor(input.backgroundTop);
  if (customTop) {
    const customBottom = usableColor(input.backgroundBottom) ?? customTop;
    return input.backgroundType === "gradient"
      ? { kind: "gradient", topColor: customTop, bottomColor: customBottom }
      : { kind: "solid", topColor: customTop, bottomColor: customTop };
  }

  const gradient = paneGradient(input.paneBackgroundImage);
  if (gradient) return gradient;

  const visible = usableColor(input.paneBackgroundColor)
    ?? usableColor(input.chartBackground)
    ?? usableColor(input.pageBackground)
    ?? FALLBACK_CHART_BACKGROUND;
  return { kind: "solid", topColor: visible, bottomColor: visible };
}
