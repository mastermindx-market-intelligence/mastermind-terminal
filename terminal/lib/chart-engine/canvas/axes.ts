// Mastermind Chart Engine — axis label layout (P3 canvas renderer, pure geometry).
//
// Decides WHICH price-axis / time-axis labels a frame paints and WHERE:
//   - collision resolution: pinned labels (crosshair price, last price, price
//     lines, crosshair time) always beat grid ticks (AXES-A01); among pinned,
//     higher priority keeps its own spot and losers are nudged, then hidden;
//   - containment: an edge label shifts inside the axis instead of being clipped
//     — every VISIBLE label box lies fully inside the axis bounds (AXES-A02);
//   - DPR snapping: every placed coordinate lands on the device-pixel grid
//     (Math.round(v * dpr) / dpr) so text stays crisp at 1.25x / 2x;
//   - pixel-gap thinning for grid ticks (house rule R6 in
//     components/charts/svgChart.ts: thin by pixel gap at mapped positions,
//     never `i % n` on a value-mapped axis);
//   - price-axis width hysteresis (AXES-A03): the axis grows the moment a longer
//     label appears, but shrinks only after the shorter label has persisted for
//     N consecutive frames, so a ticking last price cannot pump the layout.
//
// The module is renderer-free and DOM-free by law (nothing here may import
// "lightweight-charts"): text metrics arrive through an injected Measure — the
// canvas renderer passes a ctx.measureText-backed closure, tests pass a
// monospace fake. Tick label TEXT is not produced here; callers reuse
// lib/chartTimeAxis.ts (formatChartTimeTick) so formatting rules stay in exactly
// one place. This module only places the strings it is handed.

// ── Injected text metrics ─────────────────────────────────────────────────────

/**
 * Measures a label in the axis font. The canvas renderer backs this with
 * CanvasRenderingContext2D.measureText after setting ctx.font; tests inject a
 * deterministic monospace fake. Both numbers are in CSS px.
 */
export type Measure = (text: string, font: string) => { width: number; height: number };

// ── Output shape ──────────────────────────────────────────────────────────────

/** One laid-out axis label, visible or hidden (hidden entries keep their would-be
 *  box so callers can debug / animate; only !hidden entries are painted). */
export type PlacedLabel = {
  /** Label text, already formatted by the caller. */
  text: string;
  /**
   * Price axis: left edge of the label box, `paddingPx` in from the strip's left
   * edge. Time axis: CENTER of the label box (the box spans [x - width/2,
   * x + width/2]). Always on the dpr grid.
   */
  x: number;
  /**
   * Price axis: vertical center of the label box (on the dpr grid). Time axis:
   * always 0 — vertical placement inside the time-axis strip belongs to the
   * renderer, this module only resolves the horizontal axis line.
   */
  y: number;
  /** Measured label box size (CSS px). */
  width: number;
  height: number;
  kind: "tick" | "pinned";
  hidden: boolean;
};

// ── Price-axis inputs ─────────────────────────────────────────────────────────

/** One price-axis grid tick: an already-formatted label at its already-mapped y. */
export type PriceTick = { value: number; y: number; label: string };

/** A pinned price label: crosshair price, last price, a series price line. */
export type PinnedPriceLabel = { value: number; y: number; label: string; priority: number };

export type PriceAxisGeometry = {
  /** Height of the price-axis strip in CSS px; visible boxes stay inside [0, heightPx]. */
  heightPx: number;
  /** Width of the strip in CSS px (size it with axisWidthForLabels). */
  widthPx: number;
  /** Inset of each label's left edge from the strip's left edge. */
  paddingPx: number;
  /** Font string, forwarded verbatim to the injected measure. */
  font: string;
  /** Device pixel ratio used for coordinate snapping. */
  dpr: number;
  /**
   * Minimum center-to-center pixel gap between kept ticks. Defaults to the
   * tallest tick label's height (one label of clearance). Whatever the caller
   * passes, the effective gap is never allowed below the overlap-free distance.
   */
  minGapPx?: number;
};

// ── Time-axis inputs ──────────────────────────────────────────────────────────

/** One time-axis grid tick: an already-formatted label at its mapped x. `weight`
 *  breaks ties when ticks collide (higher survives; equal keeps the earlier). */
export type TimeTick = { x: number; label: string; weight?: number };

/** A pinned time label: the crosshair time. */
export type PinnedTimeLabel = { x: number; label: string; priority: number };

export type TimeAxisGeometry = {
  /** Width of the time-axis strip in CSS px. */
  widthPx: number;
  /** Horizontal inset: visible label boxes stay inside [paddingPx, widthPx - paddingPx]. */
  paddingPx: number;
  /** Font string, forwarded verbatim to the injected measure. */
  font: string;
  /** Device pixel ratio used for coordinate snapping. */
  dpr: number;
  /** Minimum center-to-center pixel gap between kept ticks. */
  minGapPx: number;
};

// ── Price-axis width hysteresis (AXES-A03) ────────────────────────────────────

/** Caller-owned hysteresis state for axisWidthForLabels. Persist one object per
 *  axis across frames; reset (drop in a fresh `{ width: 0, shrinkStreak: 0 }`)
 *  to force an immediate re-fit, e.g. after a font or symbol change. */
export type AxisWidthState = {
  /** Width currently committed by the axis (CSS px). */
  width: number;
  /** Consecutive calls whose natural width was smaller than `width`. */
  shrinkStreak: number;
};

// ── Internal 1-D machinery (both axes are one collision line) ─────────────────

/** Boxes closer than this are treated as touching, not colliding, so exact
 *  abutment (a nudge of exactly one extent) still counts as resolved. */
const OVERLAP_EPS = 1e-6;

function finiteOr(v: number | null | undefined, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function safeDpr(dpr: number): number {
  return finiteOr(dpr, 1) > 0 ? finiteOr(dpr, 1) : 1;
}

/** Snap a CSS-px coordinate onto the device pixel grid. */
function snapPx(v: number, dpr: number): number {
  return Math.round(v * safeDpr(dpr)) / safeDpr(dpr);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * The range of CENTER positions for a centered box of `extent` fully inside
 * [lo, hi], with both endpoints on the dpr grid. Null when the label cannot fit
 * in the axis at all — callers then hide it rather than clip it (AXES-A02).
 */
function containedCenterRange(extent: number, lo: number, hi: number, dpr: number): [number, number] | null {
  const grid = safeDpr(dpr);
  const min = Math.ceil((lo + extent / 2) * grid) / grid;
  const max = Math.floor((hi - extent / 2) * grid) / grid;
  return max >= min ? [min, max] : null;
}

/** Do two centered boxes collide? Exactly abutting edges do not. */
function boxesCollide(aPos: number, aExtent: number, bPos: number, bExtent: number): boolean {
  return Math.abs(aPos - bPos) * 2 < aExtent + bExtent - OVERLAP_EPS;
}

/**
 * The center-to-center distance that must separate two labels before BOTH the
 * caller's minimum gap and the masterplan's no-overlap gate ("axis label
 * collision never overlaps") are satisfied, whatever minGapPx was passed in.
 */
function requiredGap(minGapPx: number, aExtent: number, bExtent: number): number {
  return Math.max(minGapPx, (aExtent + bExtent) / 2);
}

/** Best-effort center for a label that cannot fit the axis: still snapped, but
 *  only informational — the label is hidden (AXES-A02 forbids clipping). */
function fallbackCenter(pos: number | null, extent: number, lo: number, hi: number, dpr: number): number {
  const want = finiteOr(pos, (lo + hi) / 2);
  const l = lo + extent / 2;
  return snapPx(clamp(want, l, Math.max(l, hi - extent / 2)), dpr);
}

type PlacedPinned<T> = { item: T; pos: number; extent: number; hidden: boolean };

/**
 * Place pinned labels along one axis line, in priority order (AXES-A01 among
 * pinned): the highest priority claims its own contained, snapped position;
 * each lower-priority label is nudged off the already-placed winners by its own
 * extent — toward the smaller coordinate first, then the other way, then twice
 * as far — and is hidden only when no slot within two extents is free.
 */
function placePinned<T>(
  items: readonly T[],
  posOf: (item: T) => number,
  priorityOf: (item: T) => number,
  extentOf: (item: T) => number,
  lo: number,
  hi: number,
  dpr: number,
): PlacedPinned<T>[] {
  const results: PlacedPinned<T>[] = new Array(items.length);
  // Priority DESC with an input-order tiebreak (equal priorities: first listed
  // keeps its own spot), so placement order — and therefore the outcome — is
  // total and deterministic.
  const order = items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => priorityOf(b.item) - priorityOf(a.item) || a.i - b.i);

  const winners: PlacedPinned<T>[] = [];
  for (const { item, i } of order) {
    const extent = Math.max(0, finiteOr(extentOf(item), 0));
    const range = containedCenterRange(extent, lo, hi, dpr);
    let placed: PlacedPinned<T> | null = null;
    if (range) {
      const want = finiteOr(posOf(item), (lo + hi) / 2);
      for (const offset of [0, -extent, extent, -2 * extent, 2 * extent]) {
        const pos = clamp(snapPx(want + offset, dpr), range[0], range[1]);
        if (winners.every((w) => !boxesCollide(pos, extent, w.pos, w.extent))) {
          placed = { item, pos, extent, hidden: false };
          break;
        }
      }
    }
    const result: PlacedPinned<T> = placed ?? {
      item,
      pos: fallbackCenter(posOf(item), extent, lo, hi, dpr),
      extent,
      hidden: true,
    };
    results[i] = result;
    if (placed) winners.push(placed);
  }
  return results;
}

/** Sanitized measure wrapper: never returns NaN/negative sizes. */
function measurerFor(measure: Measure, font: string): (text: string) => { width: number; height: number } {
  return (text: string) => {
    const m = measure(text, font);
    return { width: Math.max(0, finiteOr(m.width, 0)), height: Math.max(0, finiteOr(m.height, 0)) };
  };
}

/** Sort key: ticks with a non-finite mapped position go last and are hidden. */
const POSITIVE_SORT_MAX = Number.MAX_SAFE_INTEGER;
function sortKey(pos: number | null): number {
  return pos == null ? POSITIVE_SORT_MAX : pos;
}

// ── Price axis ────────────────────────────────────────────────────────────────

/**
 * Lay out one frame of price-axis labels (vertical collision line).
 *
 * Rules, in order:
 *   1. Pinned labels are placed first and ALWAYS beat ticks: any tick whose box
 *      would collide with a visible pinned label is hidden (AXES-A01).
 *   2. Among pinned, higher `priority` wins its own spot; losers are nudged by
 *      whole label heights (up to 2) before being hidden.
 *   3. Remaining ticks are thinned top-to-bottom by pixel gap at their MAPPED y
 *      positions (never by array index); a tick is kept when it clears both
 *      `axis.minGapPx` (default: tallest tick label height) and the
 *      overlap-free distance from the last kept tick.
 *   4. Every visible box is fully inside [0, heightPx]: edge labels shift
 *      inward (AXES-A02), labels that cannot fit at all are hidden.
 *   5. All coordinates are snapped to the dpr grid.
 *
 * Returns ticks in input order followed by pinned labels in input order.
 * Deterministic: same inputs → same outputs.
 */
export function layoutPriceLabels(
  ticks: readonly PriceTick[],
  axis: PriceAxisGeometry,
  measure: Measure,
  pinned: readonly PinnedPriceLabel[] = [],
): PlacedLabel[] {
  const dpr = axis.dpr;
  const heightPx = finiteOr(axis.heightPx, 0);
  const xEdge = snapPx(Math.max(0, finiteOr(axis.paddingPx, 0)), dpr);
  const size = measurerFor(measure, axis.font);

  // 1–2. Pinned labels claim space first.
  const pinnedPlaced = placePinned(
    pinned,
    (p) => p.y,
    (p) => p.priority,
    (p) => size(p.label).height,
    0,
    heightPx,
    dpr,
  );
  const winners = pinnedPlaced.filter((p) => !p.hidden);

  // 3. Default vertical clearance is one tallest tick label.
  let tallest = 0;
  for (const t of ticks) tallest = Math.max(tallest, size(t.label).height);
  const minGap = axis.minGapPx != null && Number.isFinite(axis.minGapPx) ? axis.minGapPx : tallest;

  const order = ticks
    .map((t, i) => ({ label: t.label, pos: Number.isFinite(t.y) ? t.y : null, i }))
    .sort((a, b) => sortKey(a.pos) - sortKey(b.pos) || a.i - b.i);

  const tickOut: PlacedLabel[] = new Array(ticks.length);
  let lastKeptPos = Number.NEGATIVE_INFINITY;
  let lastKeptExtent = 0;
  for (const { label, pos, i } of order) {
    const { width, height } = size(label);
    const range = containedCenterRange(height, 0, heightPx, dpr);
    const y = range
      ? clamp(snapPx(finiteOr(pos, heightPx / 2), dpr), range[0], range[1])
      : fallbackCenter(pos, height, 0, heightPx, dpr);
    let hidden = true;
    if (range && pos != null) {
      if (winners.some((w) => boxesCollide(y, height, w.pos, w.extent))) {
        hidden = true; // AXES-A01: pinned always win over ticks.
      } else if (y - lastKeptPos >= requiredGap(minGap, height, lastKeptExtent)) {
        hidden = false;
        lastKeptPos = y;
        lastKeptExtent = height;
      }
    }
    tickOut[i] = { text: label, x: xEdge, y, width, height, kind: "tick", hidden };
  }

  const pinnedOut = pinnedPlaced.map((p) => {
    const s = size(p.item.label);
    return {
      text: p.item.label,
      x: xEdge,
      y: p.pos,
      width: s.width,
      height: p.extent,
      kind: "pinned" as const,
      hidden: p.hidden,
    };
  });
  return [...tickOut, ...pinnedOut];
}

// ── Time axis ─────────────────────────────────────────────────────────────────

/**
 * Lay out one frame of time-axis labels (horizontal collision line).
 *
 * Same rules as the price axis, mirrored horizontally:
 *   1. The pinned crosshair time label is centered on its x and ALWAYS beats
 *      ticks (AXES-A01); it is shifted inward (never clipped) at the edges.
 *   2. Lower-priority pinned labels nudge horizontally by whole label widths,
 *      up to 2, then hide.
 *   3. Ticks are thinned left-to-right by pixel gap at their MAPPED x positions
 *      (house rule R6: never `i % n`). On collision the higher `weight`
 *      survives; equal weights keep the EARLIER (leftmost processed) tick.
 *   4. Every visible box is fully inside [paddingPx, widthPx - paddingPx].
 *   5. x coordinates are snapped to the dpr grid.
 *
 * Returns ticks in input order followed by pinned labels in input order.
 * Deterministic: same inputs → same outputs.
 */
export function layoutTimeLabels(
  ticks: readonly TimeTick[],
  axis: TimeAxisGeometry,
  measure: Measure,
  pinned: readonly PinnedTimeLabel[] = [],
): PlacedLabel[] {
  const dpr = axis.dpr;
  const pad = Math.max(0, finiteOr(axis.paddingPx, 0));
  const lo = pad;
  const hi = Math.max(0, finiteOr(axis.widthPx, 0)) - pad;
  const size = measurerFor(measure, axis.font);

  const pinnedPlaced = placePinned(
    pinned,
    (p) => p.x,
    (p) => p.priority,
    (p) => size(p.label).width,
    lo,
    hi,
    dpr,
  );
  const winners = pinnedPlaced.filter((p) => !p.hidden);

  const minGap = Number.isFinite(axis.minGapPx) ? axis.minGapPx : 0;

  const order = ticks
    .map((t, i) => ({ label: t.label, weight: finiteOr(t.weight, 0), pos: Number.isFinite(t.x) ? t.x : null, i }))
    .sort((a, b) => sortKey(a.pos) - sortKey(b.pos) || a.i - b.i);

  type Slot = { label: string; width: number; height: number; pos: number; weight: number; hidden: boolean };
  const slots: Slot[] = new Array(ticks.length);
  const kept: Slot[] = [];
  for (const { label, weight, pos, i } of order) {
    const { width, height } = size(label);
    const range = containedCenterRange(width, lo, hi, dpr);
    const x = range
      ? clamp(snapPx(finiteOr(pos, (lo + hi) / 2), dpr), range[0], range[1])
      : fallbackCenter(pos, width, lo, hi, dpr);
    const slot: Slot = { label, width, height, pos: x, weight, hidden: true };
    slots[i] = slot;
    if (!range || pos == null) continue; // cannot fit / unmapped: hidden (AXES-A02)
    if (winners.some((w) => boxesCollide(x, width, w.pos, w.extent))) continue; // AXES-A01
    // Weighted greedy thinning: a colliding candidate either outweighs the
    // previously kept tick — which then gives way and is hidden — or is dropped.
    let dropped = false;
    while (
      kept.length > 0 &&
      x - kept[kept.length - 1].pos < requiredGap(minGap, width, kept[kept.length - 1].width)
    ) {
      const last = kept[kept.length - 1];
      if (weight > last.weight) {
        last.hidden = true;
        kept.pop();
      } else {
        dropped = true; // equal weight keeps the earlier tick
        break;
      }
    }
    if (!dropped) {
      slot.hidden = false;
      kept.push(slot);
    }
  }

  const tickOut: PlacedLabel[] = slots.map((s) => ({
    text: s.label,
    x: s.pos,
    y: 0,
    width: s.width,
    height: s.height,
    kind: "tick" as const,
    hidden: s.hidden,
  }));
  const pinnedOut: PlacedLabel[] = pinnedPlaced.map((p) => {
    const s = size(p.item.label);
    return {
      text: p.item.label,
      x: p.pos,
      y: 0,
      width: p.extent,
      height: s.height,
      kind: "pinned" as const,
      hidden: p.hidden,
    };
  });
  return [...tickOut, ...pinnedOut];
}

// ── Price-axis width (AXES-A03) ───────────────────────────────────────────────

/**
 * The price-axis strip width needed by `labels`: the widest measured label plus
 * `2 * paddingPx`, rounded UP to a whole CSS px.
 *
 * Hysteresis (AXES-A03, no axis jitter): pass a persistent `state` and a
 * `shrinkAfterFrames` patience to stop a ticking last price from pumping the
 * layout sideways every frame. The committed width grows the moment a longer
 * label appears, but follows a smaller natural width down only once that
 * smaller width has been observed on `shrinkAfterFrames` consecutive calls.
 * With no `state` (or `shrinkAfterFrames` 0) the natural width is returned as
 * is. `state` is updated in place — that in-place update is the feature: the
 * caller keeps one object per axis across frames and resets by substituting
 * `{ width: 0, shrinkStreak: 0 }`.
 */
export function axisWidthForLabels(
  labels: readonly string[],
  measure: Measure,
  font: string,
  paddingPx: number,
  shrinkAfterFrames = 0,
  state?: AxisWidthState,
): number {
  let widest = 0;
  for (const label of labels) {
    const w = measure(label, font).width;
    if (Number.isFinite(w) && w > widest) widest = w;
  }
  const natural = Math.max(0, Math.ceil(widest + 2 * finiteOr(paddingPx, 0)));

  if (!state) return natural;
  const patience = Math.max(0, Math.floor(finiteOr(shrinkAfterFrames, 0)));
  if (natural >= state.width) {
    // Grow (or confirm) immediately; a satisfied width resets the patience.
    state.width = natural;
    state.shrinkStreak = 0;
    return natural;
  }
  state.shrinkStreak += 1;
  if (state.shrinkStreak >= patience) {
    // The smaller width has now persisted `patience` frames — commit it.
    state.width = natural;
    state.shrinkStreak = 0;
    return natural;
  }
  return state.width;
}
