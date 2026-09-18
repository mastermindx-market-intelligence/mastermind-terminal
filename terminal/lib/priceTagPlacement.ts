// Shared geometry for the persistent price-scale badges.
//
// The primary (regular-session/current) price row is immutable: it is always centred on its real
// price coordinate. A secondary extended-hours row may move only when its projected pixel box would
// cover that primary badge. The price lines themselves never move.

export const PRICE_TAG_ROW_HEIGHT = 17;
export const PRICE_TAG_TIME_HEIGHT = 14;
export const PRICE_TAG_MIN_VALUE_WIDTH = 66;

/**
 * Convert a raw series price into the value painted by Lightweight Charts' public price-scale
 * modes. Percentage/IndexedTo100 use the first visible series value as their base; Normal and
 * Logarithmic continue to display the raw price.
 */
export function priceScaleDisplayValue(price: number, basePrice: number | null, mode: number): number {
  if ((mode !== 2 && mode !== 3) || basePrice == null || !Number.isFinite(basePrice) || basePrice === 0) {
    return price;
  }
  const percentage = 100 * (price - basePrice) / basePrice;
  if (mode === 2) return basePrice < 0 ? -percentage : percentage;
  const indexed = percentage + 100;
  return basePrice < 0 ? -indexed : indexed;
}

/** Integer top edge for a 17px price row centred on a projected price coordinate. */
export function priceTagRowTop(
  anchorY: number,
  rowHeight: number = PRICE_TAG_ROW_HEIGHT,
): number {
  return Math.round(anchorY - (rowHeight - 1) / 2);
}

export type SecondaryTagPlacement = {
  primaryY: number;
  secondaryY: number;
  paneHeight: number;
  primaryHeight?: number;
  rowHeight?: number;
};

/**
 * Place an extended-hours badge around the pinned primary badge.
 *
 * - A secondary price above/equal to the primary docks immediately above its 17px price row.
 * - A secondary price below the primary docks below the primary's complete footprint (including
 *   the countdown row when present).
 * - A naturally separated badge remains at its own projected coordinate.
 * - Near a pane edge, the secondary badge flips to the free side rather than moving the primary.
 */
export function secondaryPriceTagTop({
  primaryY,
  secondaryY,
  paneHeight,
  primaryHeight = PRICE_TAG_ROW_HEIGHT + PRICE_TAG_TIME_HEIGHT,
  rowHeight = PRICE_TAG_ROW_HEIGHT,
}: SecondaryTagPlacement): number {
  const primaryTop = priceTagRowTop(primaryY, rowHeight);
  const naturalTop = priceTagRowTop(secondaryY, rowHeight);
  const maxTop = paneHeight > 0 ? Math.max(0, Math.floor(paneHeight) - rowHeight) : Infinity;
  const clamp = (top: number) => Math.min(maxTop, Math.max(0, top));
  const primaryBottom = primaryTop + primaryHeight;
  const naturalBottom = naturalTop + rowHeight;

  const collides = naturalTop < primaryBottom && naturalBottom > primaryTop;
  if (!collides) return clamp(naturalTop);

  if (secondaryY <= primaryY) {
    const above = primaryTop - rowHeight;
    if (above >= 0) return above;
    const below = primaryBottom;
    return below <= maxTop ? below : clamp(above);
  }

  const below = primaryBottom;
  if (below <= maxTop) return below;
  const above = primaryTop - rowHeight;
  return above >= 0 ? above : clamp(below);
}

export type PriceAxisBadgeSide = "above" | "below";

export type PriceAxisBadgeInput = {
  id: string;
  /** True projected price coordinate, retained for diagnostics and connector lines. */
  anchorY: number;
  /** Natural row top derived from anchorY before collision resolution. */
  naturalTop: number;
  /** Tie-breaker for a badge whose anchor sits on the active quote. */
  preferredSide?: PriceAxisBadgeSide;
  /** Higher-priority badges stay in the axis-adjacent lane when vertical capacity is tight. */
  priority?: number;
};

export type PriceAxisBadgePlacement = PriceAxisBadgeInput & {
  top: number;
  docked: boolean;
  /** 0 is axis-adjacent; overflow lanes fan inward without hiding any level. */
  lane: number;
};

export type PriceAxisBadgeLayout = {
  paneHeight: number;
  /** The active quote row remains pinned; only the supplied badges may move. */
  activeTop: number;
  /** Includes the active quote's countdown row when one is visible. */
  activeHeight: number;
  badges: PriceAxisBadgeInput[];
  rowHeight?: number;
  gap?: number;
};

type IndexedBadge = PriceAxisBadgeInput & { inputIndex: number };

/**
 * Collision-resolve persistent price-axis badges around one pinned active quote.
 *
 * Horizontal price lines and `anchorY` never move. Only the DOM badge row is fanned out, in
 * price order, into the free space above/below the active quote. Naturally separated rows stay
 * at their projected position. If one vertical axis column cannot hold every row, overflow moves
 * into adjacent horizontal lanes rather than overlapping or hiding data.
 */
export function layoutPriceAxisBadges({
  paneHeight,
  activeTop,
  activeHeight,
  badges,
  rowHeight = PRICE_TAG_ROW_HEIGHT,
  gap = 1,
}: PriceAxisBadgeLayout): PriceAxisBadgePlacement[] {
  if (!badges.length) return [];
  const pane = Math.max(0, Math.floor(paneHeight));
  const row = Math.max(1, Math.floor(rowHeight));
  const space = Math.max(0, Math.floor(gap));
  const step = row + space;
  const maxRowTop = Math.max(0, pane - row);
  const clampTop = (top: number) => Math.max(0, Math.min(maxRowTop, top));

  const sorted: IndexedBadge[] = badges
    .map((badge, inputIndex) => ({ ...badge, inputIndex }))
    .sort((a, b) => a.naturalTop - b.naturalTop || a.anchorY - b.anchorY || a.id.localeCompare(b.id));

  const capacity = (from: number, to: number): number => {
    const length = Math.max(0, to - from);
    return length < row ? 0 : Math.floor((length + space) / step);
  };

  const placeSegment = (
    segment: IndexedBadge[],
    minTop: number,
    maxBottom: number,
    lane: number,
  ): Array<IndexedBadge & { top: number; lane: number }> => {
    if (!segment.length) return [];
    const maxTop = Math.max(minTop, maxBottom - row);
    const tops: number[] = [];
    for (let index = 0; index < segment.length; index++) {
      const natural = Math.max(minTop, Math.min(maxTop, segment[index].naturalTop));
      tops[index] = index === 0 ? natural : Math.max(natural, tops[index - 1] + step);
    }
    if (tops[tops.length - 1] > maxTop) {
      tops[tops.length - 1] = maxTop;
      for (let index = tops.length - 2; index >= 0; index--) {
        tops[index] = Math.min(tops[index], tops[index + 1] - step);
      }
    }
    return segment.map((badge, index) => ({ ...badge, top: clampTop(tops[index]), lane }));
  };

  const hasActive = activeHeight > 0 && activeTop < pane && activeTop + activeHeight > 0;
  const activeBottom = activeTop + Math.max(0, activeHeight);
  const activePriceCenter = activeTop + row / 2;
  const aboveEnd = hasActive ? Math.max(0, Math.min(pane, activeTop - space)) : pane;
  const belowStart = hasActive ? Math.max(0, Math.min(pane, activeBottom + space)) : pane;
  const aboveCapacity = hasActive ? capacity(0, aboveEnd) : capacity(0, pane);
  const belowCapacity = hasActive ? capacity(belowStart, pane) : 0;
  const primaryCapacity = aboveCapacity + belowCapacity;

  // Keep the most important/closest badges in the axis-adjacent lane. Every other badge remains
  // visible in an inward lane. Input order is restored in the return value.
  const ranked = [...sorted].sort((a, b) =>
    (b.priority ?? 0) - (a.priority ?? 0)
    || Math.abs(a.anchorY - activePriceCenter) - Math.abs(b.anchorY - activePriceCenter)
    || a.inputIndex - b.inputIndex,
  );
  const primaryIds = new Set(ranked.slice(0, primaryCapacity).map((badge) => badge.inputIndex));
  const primary = sorted.filter((badge) => primaryIds.has(badge.inputIndex));
  const overflow = sorted.filter((badge) => !primaryIds.has(badge.inputIndex));

  const placed: Array<IndexedBadge & { top: number; lane: number }> = [];
  if (!hasActive) {
    placed.push(...placeSegment(primary, 0, pane, 0));
  } else if (primary.length) {
    const desiredAbove = primary.filter((badge) => {
      if (Math.abs(badge.anchorY - activePriceCenter) <= 0.5 && badge.preferredSide) {
        return badge.preferredSide === "above";
      }
      return badge.anchorY <= activePriceCenter;
    }).length;
    const minAbove = Math.max(0, primary.length - belowCapacity);
    const maxAbove = Math.min(primary.length, aboveCapacity);
    const split = Math.max(minAbove, Math.min(maxAbove, desiredAbove));
    placed.push(
      ...placeSegment(primary.slice(0, split), 0, aboveEnd, 0),
      ...placeSegment(primary.slice(split), belowStart, pane, 0),
    );
  }

  const fullLaneCapacity = capacity(0, pane);
  if (overflow.length) {
    if (fullLaneCapacity <= 0) {
      // A pane shorter than one row is already visually collapsed. Preserve every badge in its own
      // horizontal lane at the only bounded y coordinate instead of dropping data.
      overflow.forEach((badge, index) => placed.push({ ...badge, top: 0, lane: index + 1 }));
    } else {
      for (let start = 0, lane = 1; start < overflow.length; start += fullLaneCapacity, lane++) {
        placed.push(...placeSegment(overflow.slice(start, start + fullLaneCapacity), 0, pane, lane));
      }
    }
  }

  const byInput = new Map(placed.map((badge) => [badge.inputIndex, badge]));
  return badges.map((badge, inputIndex) => {
    const placement = byInput.get(inputIndex);
    const top = placement?.top ?? clampTop(badge.naturalTop);
    return {
      ...badge,
      top,
      lane: placement?.lane ?? 0,
      docked: Math.abs(top - badge.naturalTop) > 0.5 || (placement?.lane ?? 0) > 0,
    };
  });
}

function parseCssRgb(value: string): [number, number, number] | null {
  const text = value.trim().toLowerCase();
  const hex = text.match(/^#([0-9a-f]{3}|[0-9a-f]{6})(?:[0-9a-f]{2})?$/i);
  if (hex) {
    const raw = hex[1].length === 3
      ? [...hex[1]].map((part) => part + part).join("")
      : hex[1];
    return [0, 2, 4].map((offset) => Number.parseInt(raw.slice(offset, offset + 2), 16)) as [number, number, number];
  }
  const rgb = text.match(/^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)/);
  if (!rgb) return null;
  return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
    .map((channel) => Math.max(0, Math.min(255, channel))) as [number, number, number];
}

/** Choose whichever of pure black/white has the stronger WCAG contrast against a badge. */
export function readablePriceTagTextColor(background: string): "#000" | "#fff" {
  const rgb = parseCssRgb(background);
  if (!rgb) return "#fff";
  const luminance = rgb
    .map((channel) => channel / 255)
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
  const whiteContrast = 1.05 / (luminance + 0.05);
  const blackContrast = (luminance + 0.05) / 0.05;
  return blackContrast >= whiteContrast ? "#000" : "#fff";
}


export type PriceAxisObstacle = { left: number; right: number; top: number; bottom: number };

export type PriceAxisObstacleOffsetInput = {
  onLeft: boolean;
  containerWidth: number;
  top: number;
  height: number;
  width: number;
  baseOffset?: number;
  gap?: number;
  obstacles: PriceAxisObstacle[];
};

/**
 * Move one persistent badge inward only when its projected rectangle intersects fixed chart chrome.
 * The y coordinate and underlying price line stay untouched. Coordinates are container-relative.
 */
export function priceAxisOffsetForObstacles({
  onLeft,
  containerWidth,
  top,
  height,
  width,
  baseOffset = 1,
  gap = 4,
  obstacles,
}: PriceAxisObstacleOffsetInput): number {
  const container = Math.max(0, containerWidth);
  const badgeWidth = Math.max(0, width);
  const badgeHeight = Math.max(0, height);
  const maxOffset = Math.max(0, container - badgeWidth);
  let offset = Math.max(0, Math.min(maxOffset, baseOffset));
  const bottom = top + badgeHeight;

  // An inward move can expose a second obstacle, so iterate to a stable offset. Monotonic offset
  // growth and the bounded pass count make this deterministic even with malformed overlapping chrome.
  for (let pass = 0; pass <= obstacles.length; pass++) {
    let changed = false;
    for (const obstacle of obstacles) {
      const vertical = top < obstacle.bottom && bottom > obstacle.top;
      if (!vertical) continue;
      const left = onLeft ? offset : container - offset - badgeWidth;
      const right = left + badgeWidth;
      const horizontal = left < obstacle.right && right > obstacle.left;
      if (!horizontal) continue;
      const required = onLeft
        ? obstacle.right + gap
        : container - obstacle.left + gap;
      const next = Math.max(offset, Math.min(maxOffset, required));
      if (next > offset) { offset = next; changed = true; }
    }
    if (!changed) break;
  }
  return offset;
}
