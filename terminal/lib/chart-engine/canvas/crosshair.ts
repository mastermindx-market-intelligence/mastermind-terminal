// Crosshair resolution for the native Canvas2D renderer (P3).
//
// Pure geometry/data math for the chart crosshair: pointer → snapped bar slot,
// magnet price snapping, the data row(s) under the crosshair, construction of the
// public EngineMouseEventParams payload, and a repaint-cost classifier for state
// transitions. No DOM, no renderer imports — the caller supplies a projection
// (shared Projection vocabulary) and plain series rows, exactly like axisZoom.ts
// and futureTime.ts do for their slice of renderer math.
//
// LWC 5.2 semantics mirrored here (verified against the installed bundle):
//   • CrosshairMode: Normal=0 / Magnet=1 / Hidden=2 / MagnetOHLC=3 (string union).
//   • Magnet sticks to close; MagnetOHLC to open/high/low/close (PlotRowValueIndex
//     order O,H,L,C); ties resolve to the FIRST candidate in that order.
//   • MismatchDirection: NearestLeft=-1 / None=0 / NearestRight=1 (string union).
//     NearestLeft starts at the largest bar index < logical; NearestRight at the
//     smallest index > logical — fractional logicals never match exactly.
//   • x→bar snapping is LWC's `Math.ceil(floatIndex)` where its floatIndex is the
//     centered logical minus 0.5, i.e. `ceil(logical - 0.5)`: an x exactly on the
//     boundary between two bars resolves to the LEFT bar. Beyond-data x keeps its
//     virtual slot (LWC does not clamp the crosshair index to loaded rows).
//   • seriesData entries are ABSENT for series with no valued row at the logical
//     (a whitespace slot is not a bar). This intentionally narrows LWC, whose
//     dataByIndex can return a bare `{time}` whitespace item: the contract's
//     consumers (ChartPanel magnet/hover code) read `close`/`value` and treat a
//     value-less datum as absent anyway, and the slot's time rides on the state.
//
// Deliberate deviations from LWC, per the crosshair spec:
//   • Magnet candidates come from the PRIMARY series only (LWC sweeps every
//     visible non-overlay series in the pane), and only when the pointer's pane is
//     the primary's pane (an overlay/volume pane has its own scale).
//   • The event's `point` is the resolved (snapped) position, not the raw pointer;
//     the raw pointer stays available on `sourceEvent`.

import type { EngineMouseEventParams, EngineSeriesKind, EngineTime } from "../api";

// ── Modes & directions ─────────────────────────────────────────────────────────

/** String-union mirror of LWC's CrosshairMode enum (Normal/Magnet/Hidden/MagnetOHLC). */
export type CrosshairMode = "normal" | "magnet" | "hidden" | "magnetOHLC";

/** String-union mirror of LWC's MismatchDirection enum (NearestLeft/None/NearestRight). */
export type DataAtDirection = "none" | "nearest-left" | "nearest-right";

// ── Local structural vocabulary ────────────────────────────────────────────────
// Sibling canvas/ lanes own the real row stores; these are the minimal structural
// shapes this module needs. EngineBar | EnginePoint | EngineWhitespace all satisfy
// CrosshairRow, and so do the sibling renderer's internal row types.

/** One row of a series: a bar, a single-value point, or a bare whitespace slot. */
export type CrosshairRow = {
  time: EngineTime;
  // candles/bars rows
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  // line/area/histogram/baseline rows
  value?: number;
};

/** A series as the crosshair sees it. `rows` is dense/positional: rows[i] is logical i. */
export type CrosshairSeries = {
  id: string;
  paneIndex: number;
  kind: EngineSeriesKind;
  rows: readonly CrosshairRow[];
};

/**
 * Series extended with the one callback hover resolution needs: value → pane y
 * through THIS series' own price scale (overlay series do not share the pane's
 * default scale, exactly like LWC's per-series priceToCoordinate).
 */
export type HoverableSeries = CrosshairSeries & {
  yOfValue?: (value: number) => number;
};

/** The per-pane coordinate projection the caller already owns (shared vocabulary). */
export type CrosshairProjection = {
  logicalOfX: (x: number) => number;
  xOfLogical: (i: number) => number;
  priceOfY: (paneIndex: number, y: number) => number;
  yOfPrice: (paneIndex: number, p: number) => number;
};

/** The magnet snap the crosshair locked onto, if any. */
export type MagnetTarget = { seriesId: string; value: number; y: number };

/** Fully resolved crosshair position. `x`/`y` are the drawn (snapped) coordinates. */
export type CrosshairState = {
  // Integer bar slot; beyond-data pointers keep their virtual slot index.
  logical: number;
  // The slot's time key; null for virtual future slots without one.
  time: EngineTime | null;
  // x of the bar centre (snapped), y after any magnet snap.
  x: number;
  y: number;
  paneIndex: number;
  // Price at the resolved y; the magnet target's value when snapped.
  price: number | null;
  magnetTarget?: MagnetTarget;
};

export type ResolveCrosshairInput = {
  x: number;
  y: number;
  paneIndex: number;
  mode: CrosshairMode;
  proj: CrosshairProjection;
  series: readonly CrosshairSeries[];
  primaryId: string | null;
};

/** How much repaint work a crosshair transition requires. */
export type CrosshairInvalidation = "none" | "cursor" | "light";

/** Max distance (CSS px) between the pointer y and a series value for hovering. */
export const HOVER_TOLERANCE_PX = 8;

// ── Row helpers ────────────────────────────────────────────────────────────────

function isBarKind(kind: EngineSeriesKind): boolean {
  return kind === "candles" || kind === "bars";
}

/** `Number.isFinite` plus the typeof guard TS needs to narrow `number | undefined`. */
function finiteOrNull(v: number | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** The series' canonical single value at a row: close for OHLC kinds, value otherwise. */
function rowValue(row: CrosshairRow, kind: EngineSeriesKind): number | null {
  return finiteOrNull(isBarKind(kind) ? row.close : row.value);
}

/** A row is a bar (not whitespace/broken) when its kind's values are all finite. */
function isValuedRow(row: CrosshairRow | undefined, kind: EngineSeriesKind): row is CrosshairRow {
  if (row === undefined) return false;
  if (isBarKind(kind)) {
    return [row.open, row.high, row.low, row.close].every((v) => finiteOrNull(v) !== null);
  }
  return finiteOrNull(row.value) !== null;
}

// ── dataAt ─────────────────────────────────────────────────────────────────────

/**
 * The valued row at `logical` for one series, or null.
 *
 * "none" matches only an exact integer slot with a bar there. "nearest-left" /
 * "nearest-right" walk from the boundary LWC's MismatchDirection picks (largest
 * index < logical, smallest index > logical — fractional logicals never match
 * exactly) to the nearest FINITE row in that direction, skipping whitespace and
 * non-finite rows. `rows` is positional, so dense series walk O(1) per step.
 */
export function dataAt(
  series: CrosshairSeries,
  logical: number,
  direction: DataAtDirection,
): CrosshairRow | null {
  if (!Number.isFinite(logical)) return null;
  const { rows, kind } = series;
  if (direction === "none") {
    if (!Number.isInteger(logical)) return null;
    return isValuedRow(rows[logical], kind) ? rows[logical] : null;
  }
  const left = direction === "nearest-left";
  // Largest integer < logical / smallest integer > logical, clamped so a logical
  // outside the array still walks INTO the data from its own side.
  const start = left
    ? Math.min(Math.ceil(logical) - 1, rows.length - 1)
    : Math.max(Math.floor(logical) + 1, 0);
  for (let i = start; i >= 0 && i < rows.length; i += left ? -1 : 1) {
    if (isValuedRow(rows[i], kind)) return rows[i];
  }
  return null;
}

// ── resolveCrosshair ───────────────────────────────────────────────────────────

/**
 * LWC's coordinateToIndex: the float logical is pre-rounded to 1e-6 (killing
 * affine-map float noise) and an x exactly between two bars goes to the LEFT bar.
 */
export function snapLogicalToBar(floatLogical: number): number {
  const l = Math.round(floatLogical * 1e6) / 1e6;
  const snapped = Math.ceil(l - 0.5);
  // Math.ceil(-0.5) is -0; normalize so the slot index compares and keys cleanly.
  return snapped === 0 ? 0 : snapped;
}

function timeKeyOf(time: EngineTime | null): string {
  if (time === null) return "null";
  if (typeof time === "number" || typeof time === "string") return `${typeof time}:${time}`;
  return `bd:${time.year}-${time.month}-${time.day}`;
}

/**
 * Resolve a pointer position into the crosshair state.
 *
 * - mode "hidden" → null (no crosshair is drawn; the caller still emits the
 *   mouse-left params shape).
 * - Non-finite x/y/pane or an unusable projection → null.
 * - `logical` snaps to the integer bar slot (LWC ceil rule) including virtual
 *   slots past the data; `x` is that bar's centre.
 * - `time` is the slot's key from the primary series' rows (falling back to the
 *   first series that has one, mirroring LWC's merged time scale); null when the
 *   slot is virtual/before the data.
 * - "magnet"/"magnetOHLC" snap `y` (and `price`) to the nearest close / O-H-L-C
 *   of the PRIMARY series' bar in the pointer's pane, reporting `magnetTarget`.
 */
export function resolveCrosshair(input: ResolveCrosshairInput): CrosshairState | null {
  const { x, y, paneIndex, mode, proj, series, primaryId } = input;
  if (mode === "hidden") return null;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(paneIndex)) return null;

  const floatLogical = proj.logicalOfX(x);
  if (!Number.isFinite(floatLogical)) return null;
  const logical = snapLogicalToBar(floatLogical);

  const primary = primaryId !== null ? series.find((s) => s.id === primaryId) ?? null : null;

  // Time base: the primary's grid (LogicalIndex: 0 = first row of the primary
  // series), widening to any series that holds the slot when it does not.
  let time: EngineTime | null = null;
  const timeBaseRow = primary !== null ? primary.rows[logical] : undefined;
  if (timeBaseRow !== undefined) {
    time = timeBaseRow.time;
  } else {
    for (const s of series) {
      const row = s.rows[logical];
      if (row !== undefined) {
        time = row.time;
        break;
      }
    }
  }

  let resolvedY = y;
  let price: number | null = null;
  const rawPrice = proj.priceOfY(paneIndex, y);
  if (Number.isFinite(rawPrice)) price = rawPrice;
  let magnetTarget: MagnetTarget | undefined;

  if ((mode === "magnet" || mode === "magnetOHLC") && primary !== null && primary.paneIndex === paneIndex) {
    const row = primary.rows[logical];
    if (row !== undefined) {
      // LWC magnetPlotRowKeys / magnetOHLCPlotRowKeys order: O, H, L, C (close
      // only for plain magnet); single-value series contribute their value.
      const candidates = isBarKind(primary.kind)
        ? mode === "magnetOHLC"
          ? [row.open, row.high, row.low, row.close]
          : [row.close]
        : [row.value];
      let bestDist = Infinity;
      let bestY: number | null = null;
      let bestValue: number | null = null;
      for (const candidate of candidates) {
        const v = finiteOrNull(candidate);
        if (v === null) continue;
        const cy = proj.yOfPrice(paneIndex, v);
        if (!Number.isFinite(cy)) continue;
        const dist = Math.abs(cy - y);
        if (dist < bestDist) {
          bestDist = dist;
          bestY = cy;
          bestValue = v;
        }
      }
      if (bestY !== null && bestValue !== null) {
        resolvedY = bestY;
        price = bestValue;
        magnetTarget = { seriesId: primary.id, value: bestValue, y: bestY };
      }
    }
  }

  const state: CrosshairState = {
    logical,
    time,
    x: proj.xOfLogical(logical),
    y: resolvedY,
    paneIndex,
    price,
  };
  if (magnetTarget !== undefined) state.magnetTarget = magnetTarget;
  return state;
}

// ── buildMouseParams ───────────────────────────────────────────────────────────

/**
 * Build the public crosshair-move payload from a resolved state.
 *
 * `seriesData` is keyed by series id and holds each series' valued row at the
 * state's logical (bar rows for candles/bars, value rows for the single-value
 * kinds); a series without a bar there is ABSENT from the map, never present
 * with an undefined value. `hoveredSeries` is the id of the series whose value
 * (through its own scale) is within HOVER_TOLERANCE_PX of the pointer y in the
 * event's pane — nearest wins — or null. A null state produces the LWC
 * mouse-left shape: time/point absent and an empty seriesData.
 */
export function buildMouseParams(
  state: CrosshairState | null,
  series: readonly HoverableSeries[],
  sourceEvent?: unknown,
): EngineMouseEventParams {
  if (state === null) {
    return {
      time: undefined,
      logical: undefined,
      point: undefined,
      paneIndex: undefined,
      hoveredSeries: null,
      seriesData: new Map<string, CrosshairRow>(),
      sourceEvent,
    };
  }

  const seriesData = new Map<string, CrosshairRow>();
  for (const s of series) {
    const row = dataAt(s, state.logical, "none");
    if (row !== null) seriesData.set(s.id, row);
  }

  let hoveredId: string | null = null;
  let hoveredDist = Infinity;
  for (const s of series) {
    if (s.paneIndex !== state.paneIndex) continue;
    const row = seriesData.get(s.id);
    if (row === undefined || s.yOfValue === undefined) continue;
    const value = rowValue(row, s.kind);
    if (value === null) continue;
    const vy = s.yOfValue(value);
    if (!Number.isFinite(vy)) continue;
    const dist = Math.abs(vy - state.y);
    if (dist <= HOVER_TOLERANCE_PX && dist < hoveredDist) {
      hoveredDist = dist;
      hoveredId = s.id;
    }
  }

  return {
    time: state.time ?? undefined,
    logical: state.logical,
    point: { x: state.x, y: state.y },
    paneIndex: state.paneIndex,
    hoveredSeries: hoveredId,
    seriesData,
    sourceEvent,
  };
}

// ── crosshairInvalidation ──────────────────────────────────────────────────────

function sameMagnet(a: MagnetTarget | undefined, b: MagnetTarget | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.seriesId === b.seriesId && a.value === b.value && a.y === b.y;
}

/**
 * Classify a crosshair transition for repaint cost.
 *
 * "light" — the snapped bar, its time key, or the pane changed: the time label
 * and every series' resolved datum (legend/labels) must redraw. Show/hide of the
 * crosshair is also "light". "cursor" — the pointer stayed within the same bar
 * and pane and only the pixel position/price moved: a cursor-level repaint of
 * the lines suffices. "none" — nothing observable changed.
 */
export function crosshairInvalidation(
  prev: CrosshairState | null,
  next: CrosshairState | null,
): CrosshairInvalidation {
  if (prev === null || next === null) {
    return prev === next ? "none" : "light";
  }
  if (
    prev.logical !== next.logical ||
    prev.paneIndex !== next.paneIndex ||
    timeKeyOf(prev.time) !== timeKeyOf(next.time)
  ) {
    return "light";
  }
  if (prev.x !== next.x || prev.y !== next.y || prev.price !== next.price) return "cursor";
  if (!sameMagnet(prev.magnetTarget, next.magnetTarget)) return "cursor";
  return "none";
}
