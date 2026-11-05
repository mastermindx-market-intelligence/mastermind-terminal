// Native canvas renderer — pane and axis layout math (P3 / R02).
//
// Pure functions: given a total height and pane stretch/fixed specs, produce
// stacked {top, height} rects (LWC default stretch is 1, separators default to
// 1px). Axis helpers split a chart width into plot / price-axis / time-axis
// rects. Removing an empty pane is the caller's job; laying out the remaining
// panes re-distributes leftover height and keeps order (R02-A03).

export type PaneSpec = {
  stretch: number;
  fixedHeightPx?: number;
};

export type PaneRect = {
  top: number;
  height: number;
};

export type AxisRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type AxisLayout = {
  plot: AxisRect;
  priceAxis: AxisRect;
  timeAxis: AxisRect;
};

/**
 * Distribute `totalHeightPx` across panes. Fixed panes take `fixedHeightPx`
 * first; leftover height (after separators) is split by stretch factors.
 * The last stretch pane absorbs rounding remainder so the stack fills exactly.
 */
export function layoutPanes(
  totalHeightPx: number,
  panes: readonly PaneSpec[],
  separatorPx = 1,
): PaneRect[] {
  const n = panes.length;
  if (n === 0) return [];
  const sep = Number.isFinite(separatorPx) ? Math.max(0, separatorPx) : 1;
  const sepTotal = Math.max(0, n - 1) * sep;
  const fixed: (number | null)[] = new Array(n);
  let fixedSum = 0;
  let stretchSum = 0;
  let lastStretch = -1;
  for (let i = 0; i < n; i++) {
    const raw = panes[i].fixedHeightPx;
    if (typeof raw === "number" && Number.isFinite(raw)) {
      const h = Math.max(0, raw);
      fixed[i] = h;
      fixedSum += h;
    } else {
      fixed[i] = null;
      stretchSum += Math.max(0, panes[i].stretch);
      lastStretch = i;
    }
  }
  const leftover = Math.max(0, totalHeightPx - sepTotal - fixedSum);
  const heights = new Array<number>(n);
  let usedStretch = 0;
  for (let i = 0; i < n; i++) {
    const locked = fixed[i];
    if (locked != null) {
      heights[i] = Math.round(locked);
      continue;
    }
    if (stretchSum <= 0) {
      heights[i] = 0;
      continue;
    }
    if (i === lastStretch) {
      heights[i] = Math.max(0, Math.round(leftover - usedStretch));
    } else {
      const h = Math.round((Math.max(0, panes[i].stretch) / stretchSum) * leftover);
      heights[i] = h;
      usedStretch += h;
    }
  }
  const out: PaneRect[] = new Array(n);
  let top = 0;
  for (let i = 0; i < n; i++) {
    out[i] = { top, height: heights[i] };
    top += heights[i];
    if (i < n - 1) top += sep;
  }
  return out;
}

/**
 * Horizontal split of a chart into plot, price axis and time axis.
 * The time axis sits under the plot and shares the plot's width. Pane stack
 * height is owned by `layoutPanes`; plot/price `height` here is 0 so a caller
 * can stamp the stacked pane height onto both.
 */
export function axisLayout(
  widthPx: number,
  priceAxisWidthPx: number,
  timeAxisHeightPx: number,
  side: "right" | "left",
): AxisLayout {
  const width = Number.isFinite(widthPx) ? Math.max(0, widthPx) : 0;
  const paw = Number.isFinite(priceAxisWidthPx) ? Math.max(0, priceAxisWidthPx) : 0;
  const tah = Number.isFinite(timeAxisHeightPx) ? Math.max(0, timeAxisHeightPx) : 0;
  const plotW = Math.max(0, width - paw);
  const plotX = side === "left" ? paw : 0;
  const priceX = side === "left" ? 0 : plotW;
  return {
    plot: { x: plotX, y: 0, width: plotW, height: 0 },
    priceAxis: { x: priceX, y: 0, width: paw, height: 0 },
    timeAxis: { x: plotX, y: 0, width: plotW, height: tah },
  };
}

/** Price-axis CSS width from measured label widths plus end padding. Even like LWC. */
export function priceAxisWidthFor(labelWidths: readonly number[], paddingPx: number): number {
  let maxW = 0;
  for (const w of labelWidths) {
    if (typeof w === "number" && Number.isFinite(w) && w > maxW) maxW = w;
  }
  const pad = Number.isFinite(paddingPx) ? Math.max(0, paddingPx) : 0;
  const raw = Math.ceil(maxW + pad);
  return raw + (raw % 2);
}
