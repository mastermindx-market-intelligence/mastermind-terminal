// Mastermind Chart Engine — level-of-detail & exact-lookup index (P3, canvas/).
//
// Pure data structures for the Canvas2D renderer's three density problems:
//   1. mapping EngineTime ⇄ logical row indexes EXACTLY (LOD-A01) — a sorted-key
//      binary-search index, validated once at build, O(log n) per lookup;
//   2. reducing thousands of rows to screen columns WITHOUT losing extrema
//      (LOD-A02) — per-column TRUE max/min aggregation whose output is branded
//      visual-only so it can never be fed back where source rows are expected;
//   3. thinning line series to one point per pixel extremum (LOD-A03) —
//      first/min/max/last per device-pixel bucket, never Douglas-Peucker
//      (whose epsilon can smooth away a one-pixel spike that IS the story).
//
// No DOM, no LWC: this module must stay importable from plain Node tests and
// from any renderer. Keys below are IDENTITY keys for lookup only — epoch
// seconds for intraday rows, business-day ordinals for daily rows — never the
// legacy display-epoch coordinate and never a render generation.

import type { EngineTime } from "../api";

// ── Typed errors ───────────────────────────────────────────────────────────────

/** Why a LOD structure refused to build. Machine-readable in `code`. */
export type LodErrorCode = "lod/disorder" | "lod/bad-time";

/**
 * Typed construction failure. LOD-A01: an exact lookup is only exact if the key
 * space is validated up front, so disorder and malformed times throw here
 * instead of being silently absorbed into a mis-sorted index.
 */
export class LodIndexError extends Error {
  readonly code: LodErrorCode;
  /** Row position the disorder was detected at; -1 when not position-bound. */
  readonly at: number;

  constructor(code: LodErrorCode, message: string, at = -1) {
    super(message);
    this.name = "LodIndexError";
    this.code = code;
    this.at = at;
  }
}

// ── Time keys ──────────────────────────────────────────────────────────────────

const MS_PER_DAY = 86_400_000;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EPOCH_STRING_RE = /^\d+$/;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/**
 * Business-day ordinal for a daily bar. ORDINAL RULE: whole days since
 * 1970-01-01 UTC — "1970-01-01" → 0, "1970-01-02" → 1, "2024-01-02" → 19724
 * (Date.UTC(year, month - 1, day) / 86_400_000). One unit is one calendar day,
 * so ordinals are monotone in calendar order, leap days included, and agree
 * with epoch-second ordering at day granularity — but they are NOT epoch
 * values: an index built over ordinals answers only ordinal queries.
 * Calendar-validated: a month outside 1..12, or a day beyond the month's real
 * length (Feb 30; Feb 29 on a non-leap year), throws instead of silently
 * rolling into the next month via Date.UTC.
 */
function businessDayOrdinal(year: number, month: number, day: number): number {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)
    || month < 1 || month > 12 || day < 1
    || day > (month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1])) {
    throw new LodIndexError(
      "lod/bad-time",
      `lod: invalid business day {year: ${year}, month: ${month}, day: ${day}}`,
    );
  }
  // Date.UTC maps years 0..99 onto 1900..1999; rebase those through
  // setUTCFullYear so "0024-05-01" keeps its own century.
  if (year >= 0 && year < 100) {
    const rebased = new Date(0);
    rebased.setUTCFullYear(year, month - 1, day);
    return Math.round(rebased.getTime() / MS_PER_DAY);
  }
  // A validated month/day lands Date.UTC on a UTC midnight: an exact multiple
  // of one day, so the division below is exact.
  return Date.UTC(year, month - 1, day) / MS_PER_DAY;
}

/**
 * Map an EngineTime onto the comparable key an index is built from:
 *   • number           → epoch seconds, used as-is (must be finite)
 *   • "1711234567"     → epoch seconds (digit-only string; futureTime.ts idiom)
 *   • "YYYY-MM-DD"     → business-day ordinal (rule above)
 *   • {year,month,day} → business-day ordinal
 * Anything else throws `lod/bad-time`. One index must be homogeneous (all
 * epoch or all ordinal): keys are only comparable within a representation.
 */
export function timeToKey(time: EngineTime): number {
  if (typeof time === "number") {
    if (!Number.isFinite(time)) {
      throw new LodIndexError("lod/bad-time", `lod: non-finite epoch time ${time}`);
    }
    return time;
  }
  if (typeof time === "string") {
    if (EPOCH_STRING_RE.test(time)) {
      const seconds = Number(time);
      if (Number.isFinite(seconds)) return seconds;
    }
    if (ISO_DATE_RE.test(time)) {
      return businessDayOrdinal(
        Number(time.slice(0, 4)),
        Number(time.slice(5, 7)),
        Number(time.slice(8, 10)),
      );
    }
    throw new LodIndexError("lod/bad-time", `lod: malformed time string ${JSON.stringify(time)}`);
  }
  return businessDayOrdinal(time.year, time.month, time.day);
}

// ── Bar index ──────────────────────────────────────────────────────────────────

/** Any row shape carrying an EngineTime; every EngineSeriesRow satisfies it. */
export type LodRow = { time: EngineTime };

export type LookupMode = "exact" | "nearest-left" | "nearest-right" | "nearest";

export type BarIndex<Row extends LodRow> = {
  readonly size: number;
  /** Precondition: 0 <= i < size (an out-of-range read answers NaN). */
  keyAt(i: number): number;
  /** Precondition: 0 <= i < size. */
  rowAt(i: number): Row;
  /**
   * Binary-search (O(log n)) the row index for `time`:
   *   exact         → the index whose key equals the time's key, null when absent
   *   nearest-left  → greatest key ≤ time (null before the first row)
   *   nearest-right → smallest key ≥ time (null past the last row)
   *   nearest       → closest key; a tie resolves to the earlier row
   * `time` must use the same representation the index was built from.
   */
  indexOfTime(time: EngineTime, mode: LookupMode): number | null;
  /**
   * Inclusive [i0, i1] window of rows whose keys fall in [fromKey, toKey].
   * An empty intersection answers i1 = i0 - 1 (i0 is the insertion point);
   * an inverted span (fromKey > toKey) is empty by construction.
   */
  range(fromKey: number, toKey: number): [number, number];
};

/** First index with keys[i] >= target (keys.length when there is none). */
function lowerBound(keys: Float64Array, target: number): number {
  let lo = 0;
  let hi = keys.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (keys[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** First index with keys[i] > target (keys.length when there is none). */
function upperBound(keys: Float64Array, target: number): number {
  let lo = 0;
  let hi = keys.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (keys[mid] <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function createBarIndex<Row extends LodRow>(rows: readonly Row[]): BarIndex<Row> {
  const keys = new Float64Array(rows.length);
  for (let i = 0; i < rows.length; i++) {
    keys[i] = timeToKey(rows[i].time); // bad-time throws before any search runs
  }
  // Validate ONCE, up front: strictly ascending, matching LWC setData semantics
  // (bar times are unique). A decrease OR a repeat is disorder — LOD-A01
  // refuses to run exact lookups over keys that were never really sorted,
  // rather than silently re-sorting them into a plausible-but-wrong order.
  for (let i = 1; i < keys.length; i++) {
    if (!(keys[i] > keys[i - 1])) {
      throw new LodIndexError(
        "lod/disorder",
        `lod: rows not strictly ascending at index ${i} `
          + `(key ${keys[i]} follows ${keys[i - 1]}; a duplicate time is disorder too)`,
        i,
      );
    }
  }
  return {
    size: rows.length,
    keyAt: (i: number) => keys[i],
    rowAt: (i: number) => rows[i],
    indexOfTime: (time: EngineTime, mode: LookupMode): number | null => {
      const target = timeToKey(time);
      if (mode === "exact") {
        const i = lowerBound(keys, target);
        return i < keys.length && keys[i] === target ? i : null;
      }
      if (mode === "nearest-left") {
        const i = upperBound(keys, target) - 1;
        return i >= 0 ? i : null;
      }
      if (mode === "nearest-right") {
        const i = lowerBound(keys, target);
        return i < keys.length ? i : null;
      }
      const left = upperBound(keys, target) - 1;
      const right = lowerBound(keys, target);
      if (left < 0) return right < keys.length ? right : null;
      if (right >= keys.length) return left;
      return target - keys[left] <= keys[right] - target ? left : right;
    },
    range: (fromKey: number, toKey: number): [number, number] => [
      lowerBound(keys, fromKey),
      upperBound(keys, toKey) - 1,
    ],
  };
}

// ── Column aggregation ─────────────────────────────────────────────────────────

/**
 * Visual-only aggregate of one screen column. The `__visualOnly` brand keeps
 * this shape out of every data-path type: a VisualColumn[] can never be passed
 * where EngineSeriesRow[] is expected (a compile-time error), so aggregated
 * extrema cannot leak back into setData and masquerade as source bars.
 */
export type VisualColumn = {
  readonly __visualOnly: true;
  /** Inclusive row window this column summarizes. */
  readonly i0: number;
  readonly i1: number;
  /** TRUE max of the column's finite highs; null when the column has no valued row. */
  readonly high: number | null;
  /** TRUE min of the column's finite lows; null when the column has no valued row. */
  readonly low: number | null;
  /** First finite open in the window; null when there is none. */
  readonly open: number | null;
  /** Last finite close in the window; null when there is none. */
  readonly close: number | null;
  /** Sum of finite volumes across every row in the window, gaps included. */
  readonly volume: number;
  /** True when at least one row in the window carried no OHLC value at all. */
  readonly hasGap: boolean;
};

export type ColumnAccessor<Row> = {
  high(row: Row): number | null;
  low(row: Row): number | null;
  open(row: Row): number | null;
  close(row: Row): number | null;
  volume?(row: Row): number | null;
};

/** null for null/NaN/±Infinity; the value itself otherwise. */
function toFinite(value: number | null): number | null {
  return value !== null && Number.isFinite(value) ? value : null;
}

/**
 * Aggregate rows[from..to] (inclusive, clamped to the array) into `columns`
 * screen columns by LOGICAL row count — the renderer places bars at uniform
 * logical spacing, so column membership is index-proportional, not
 * time-proportional. LOD-A02: `high`/`low` are the TRUE max/min over the
 * column's finite values (never the last value), so zoomed-out extremes cannot
 * disappear. A row whose open/high/low/close are ALL missing (null or
 * non-finite) is whitespace: it sets hasGap and contributes nothing to
 * extrema/open/close. Volume sums finite values from every row, valued or not.
 * A window smaller than the requested column count shortens the result to one
 * row per column (there is nothing left to aggregate); `columns` below 1 or an
 * inverted window yields [].
 */
export function columnAggregate<Row>(
  rows: readonly Row[],
  from: number,
  to: number,
  columns: number,
  accessor: ColumnAccessor<Row>,
): VisualColumn[] {
  const last = rows.length - 1;
  if (last < 0 || !Number.isFinite(columns) || Math.floor(columns) < 1) return [];
  const start = Math.min(last, Math.max(0, Math.trunc(from)));
  const end = Math.max(0, Math.min(last, Math.trunc(to)));
  if (end < start) return [];
  const rowCount = end - start + 1;
  const colCount = Math.max(1, Math.min(Math.floor(columns), rowCount));
  const volumeAt = accessor.volume;
  const out: VisualColumn[] = [];
  for (let k = 0; k < colCount; k++) {
    // Proportional integer split: column k owns [i0, i1]; every column gets at
    // least one row and the columns tile [start, end] with no overlap/remainder.
    const i0 = start + Math.floor((k * rowCount) / colCount);
    const i1 = start + Math.floor(((k + 1) * rowCount) / colCount) - 1;
    let high = -Infinity;
    let low = Infinity;
    let open: number | null = null;
    let close: number | null = null;
    let volume = 0;
    let hasGap = false;
    for (let i = i0; i <= i1; i++) {
      const row = rows[i];
      if (volumeAt) {
        const v = toFinite(volumeAt(row));
        if (v !== null) volume += v;
      }
      const o = toFinite(accessor.open(row));
      const h = toFinite(accessor.high(row));
      const l = toFinite(accessor.low(row));
      const c = toFinite(accessor.close(row));
      if (o === null && h === null && l === null && c === null) {
        hasGap = true; // whitespace slot: rendered as a gap, never as a value
        continue;
      }
      if (o !== null && open === null) open = o;
      if (c !== null) close = c;
      if (h !== null && h > high) high = h;
      if (l !== null && l < low) low = l;
    }
    out.push({
      __visualOnly: true,
      i0,
      i1,
      high: high === -Infinity ? null : high,
      low: low === Infinity ? null : low,
      open,
      close,
      volume,
      hasGap,
    });
  }
  return out;
}

// ── Line decimation ────────────────────────────────────────────────────────────

export type DecimatePoint = { x: number; y: number };

/**
 * Thin a polyline to what the screen can show: per device-pixel bucket (width
 * `tolerancePx`) keep the FIRST, MIN, MAX and LAST point, emitted in original
 * order. LOD-A03: every bucket emits its extremes, so a one-sample spike
 * survives any zoom — Douglas-Peucker is deliberately NOT used, because its
 * distance epsilon can smooth exactly such a spike away. Interior points with
 * non-finite y carry no envelope information and are dropped; bucket endpoints
 * are kept verbatim so gap edges survive at bucket boundaries. A non-positive
 * or non-finite tolerance disables decimation (the input is copied). Points
 * are assumed sorted by x (a renderer projection is monotone); the output
 * preserves input order and only ever references input points.
 */
export function lineDecimate(points: readonly DecimatePoint[], tolerancePx: number): DecimatePoint[] {
  if (points.length === 0 || !Number.isFinite(tolerancePx) || tolerancePx <= 0) {
    return points.slice();
  }
  const out: DecimatePoint[] = [];
  let groupStart = 0;
  let bucket = Math.floor(points[0].x / tolerancePx);
  for (let i = 1; i <= points.length; i++) {
    if (i < points.length && Math.floor(points[i].x / tolerancePx) === bucket) continue;
    // Close the run [groupStart, i - 1]: first, the extremes in occurrence
    // order, then the last point. Ties on the extremes keep the earliest
    // occurrence, so the output is deterministic for a deterministic input.
    const end = i - 1;
    out.push(points[groupStart]);
    let minIdx = -1;
    let maxIdx = -1;
    for (let j = groupStart; j <= end; j++) {
      const y = points[j].y;
      if (!Number.isFinite(y)) continue;
      if (minIdx < 0 || y < points[minIdx].y) minIdx = j;
      if (maxIdx < 0 || y > points[maxIdx].y) maxIdx = j;
    }
    const extremes = minIdx === maxIdx
      ? minIdx >= 0 ? [minIdx] : []
      : minIdx < maxIdx ? [minIdx, maxIdx] : [maxIdx, minIdx];
    for (const j of extremes) {
      if (j !== groupStart && j !== end) out.push(points[j]);
    }
    if (end !== groupStart) out.push(points[end]); // a 1-point bucket emits once
    if (i < points.length) {
      bucket = Math.floor(points[i].x / tolerancePx);
      groupStart = i;
    }
  }
  return out;
}

/**
 * PERF-C: lineDecimate as a stream. A fitted LOD window feeds every visible
 * row (40k on the bench corpus) per line series per frame; building the full
 * polyline first allocated one point per row only to keep ~4 per pixel. Push
 * the projected points in order and `finish()` returns exactly what
 * `lineDecimate(allPushedPoints, tolerancePx)` returns (same runs, extremes,
 * tie-breaks and non-finite handling, as fresh point objects), allocating only
 * the emitted points. Single use: `finish()` ends the stream.
 */
export class LineDecimator {
  private readonly out: DecimatePoint[] = [];
  private readonly passthrough: boolean;
  private n = 0; // points pushed so far; ordinals below index the pushed sequence
  private bucket = Number.NaN;
  private startK = 0; private startX = 0; private startY = 0;
  private endK = 0; private endX = 0; private endY = 0;
  private minK = -1; private minX = 0; private minY = 0;
  private maxK = -1; private maxX = 0; private maxY = 0;

  constructor(private readonly tolerancePx: number) {
    this.passthrough = !Number.isFinite(tolerancePx) || tolerancePx <= 0;
  }

  push(x: number, y: number): void {
    const k = this.n;
    this.n += 1;
    if (this.passthrough) {
      this.out.push({ x, y });
      return;
    }
    const bucket = Math.floor(x / this.tolerancePx);
    if (k > 0 && bucket !== this.bucket) this.flush();
    if (k === 0 || bucket !== this.bucket) {
      this.bucket = bucket;
      this.startK = k; this.startX = x; this.startY = y;
      this.minK = -1; this.maxK = -1;
    }
    this.endK = k; this.endX = x; this.endY = y;
    if (Number.isFinite(y)) {
      if (this.minK < 0 || y < this.minY) { this.minK = k; this.minX = x; this.minY = y; }
      if (this.maxK < 0 || y > this.maxY) { this.maxK = k; this.maxX = x; this.maxY = y; }
    }
  }

  finish(): DecimatePoint[] {
    if (!this.passthrough && this.n > 0) this.flush();
    return this.out;
  }

  private flush(): void {
    const out = this.out;
    out.push({ x: this.startX, y: this.startY });
    const extreme = (k: number, x: number, y: number) => {
      if (k !== this.startK && k !== this.endK) out.push({ x, y });
    };
    if (this.minK >= 0) {
      if (this.minK === this.maxK) extreme(this.minK, this.minX, this.minY);
      else if (this.minK < this.maxK) { extreme(this.minK, this.minX, this.minY); extreme(this.maxK, this.maxX, this.maxY); }
      else { extreme(this.maxK, this.maxX, this.maxY); extreme(this.minK, this.minX, this.minY); }
    }
    if (this.endK !== this.startK) out.push({ x: this.endX, y: this.endY });
  }
}
