// Time-domain window primitive — the range authority for cross-chart view synchronisation.
//
// ── Why this module exists ───────────────────────────────────────────────────────────────────
// Two charts of the SAME timeframe do not share a logical index space. Lightweight Charts
// numbers bars 0..N-1 inside each chart's own array, so index 700 on a ticker listed in 2010
// and index 700 on one listed in 2020 are different calendar dates — and the gap also opens on
// history depth, halted/missing sessions, provider coverage and composite construction. Mirroring
// a viewport as `{from,to}` logical indexes therefore aligns arrays, not calendars: the panes
// agree on bar NUMBER and disagree on the DATE the user is looking at.
//
// So a mirrored viewport travels as a CALENDAR WINDOW (epoch ms) and each destination converts it
// back through its OWN axis — exactly the rule paneSync's crosshair already follows by
// broadcasting a `Time` and letting every peer resolve its own value at that timestamp.
//
// Deliberately free of any chart-library import: it takes an `AxisClock` (index ↔ epoch ms for
// one chart) and does arithmetic. `lib/paneSync.ts` builds the clock from a Lightweight Charts
// series; any future consumer (Replay) can build its own from whatever it has.

/** A calendar window in epoch ms. Fractional and possibly outside any chart's data. */
export type TimeWindow = { from: number; to: number };

/** A Lightweight Charts visible logical range: fractional bar indexes, `from <= to`. */
export type LogicalRange = { from: number; to: number };

/** Index ↔ time for ONE chart's bars. Indexes are that chart's logical indexes. */
export interface AxisClock {
  /** logical index of the chart's FIRST bar */
  first: number;
  /** logical index of the chart's LAST bar (must be > `first`) */
  last: number;
  /** epoch ms at an INTEGER index in `[first,last]`; NaN anywhere else */
  msAt(index: number): number;
  /** representative ms per bar — used ONLY to extrapolate outside `[first,last]` */
  step: number;
}

/**
 * Epoch ms for a Lightweight Charts horizontal-scale value: a UTCTimestamp (epoch SECONDS),
 * a "YYYY-MM-DD" business-day string, or a `{year,month,day}` business day. NaN when unparseable.
 *
 * Intraday bar sets in this app carry numeric epoch seconds and daily/resampled sets carry
 * date strings, so both shapes are live on the same code path.
 */
export function timeToMs(time: unknown): number {
  if (typeof time === "number") return Number.isFinite(time) ? time * 1000 : NaN;
  if (typeof time === "string") return Date.parse(`${time.slice(0, 10)}T00:00:00Z`);
  if (time && typeof time === "object") {
    const { year, month, day } = time as { year?: number; month?: number; day?: number };
    if (typeof year === "number" && typeof month === "number" && typeof day === "number") {
      return Date.UTC(year, month - 1, day);
    }
  }
  return NaN;
}

/** Lightweight Charts needs at least two bars of width (`count = to - from + 1 >= 2`). */
export const MIN_LOGICAL_SPAN = 1;

/** Guard: a clock we can actually interpolate through. */
function usable(clock: AxisClock): boolean {
  return Number.isFinite(clock.first) && Number.isFinite(clock.last)
    && clock.last > clock.first && Number.isFinite(clock.step) && clock.step > 0;
}

/**
 * Epoch ms at a FRACTIONAL logical index.
 *
 * Inside the data the mapping interpolates between the two adjacent bars, so a half-bar offset
 * lands halfway between their timestamps — over a weekend gap that is Saturday noon, which is
 * exactly where the peer's own interpolation puts it back. Outside the data there is nothing to
 * interpolate, so whitespace is projected at the axis's representative bar step.
 */
export function timeAtLogical(clock: AxisClock, logical: number): number {
  if (!usable(clock) || !Number.isFinite(logical)) return NaN;
  if (logical <= clock.first) return clock.msAt(clock.first) + (logical - clock.first) * clock.step;
  if (logical >= clock.last) return clock.msAt(clock.last) + (logical - clock.last) * clock.step;
  const i = Math.floor(logical);
  const a = clock.msAt(i);
  const b = clock.msAt(i + 1);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
  return b > a ? a + (b - a) * (logical - i) : a;
}

/** Fractional logical index at an epoch-ms instant — the exact inverse of `timeAtLogical`. */
export function logicalAtTime(clock: AxisClock, ms: number): number {
  if (!usable(clock) || !Number.isFinite(ms)) return NaN;
  const msFirst = clock.msAt(clock.first);
  const msLast = clock.msAt(clock.last);
  if (!Number.isFinite(msFirst) || !Number.isFinite(msLast)) return NaN;
  if (ms <= msFirst) return clock.first + (ms - msFirst) / clock.step;
  if (ms >= msLast) return clock.last + (ms - msLast) / clock.step;
  // bracket the instant: invariant msAt(lo) <= ms <= msAt(hi)
  let lo = clock.first;
  let hi = clock.last;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    const m = clock.msAt(mid);
    if (!Number.isFinite(m)) return NaN;
    if (m <= ms) lo = mid; else hi = mid;
  }
  const a = clock.msAt(lo);
  const b = clock.msAt(hi);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
  return b > a ? lo + (ms - a) / (b - a) : lo;
}

/** The calendar window a chart is currently showing, from its live logical range. */
export function toTimeWindow(clock: AxisClock, range: LogicalRange): TimeWindow | null {
  const from = timeAtLogical(clock, range.from);
  const to = timeAtLogical(clock, range.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return null;
  return { from, to };
}

/** The logical range a chart must adopt to show `win`. UNCLAMPED — see `clampLogicalRange`. */
export function toLogicalRange(clock: AxisClock, win: TimeWindow): LogicalRange | null {
  const from = logicalAtTime(clock, win.from);
  const to = logicalAtTime(clock, win.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return null;
  return { from, to };
}

/**
 * Edge policy for a window a chart cannot fully show.
 *
 * Partial overlap needs no policy: the honest answer is the requested calendar window with
 * whitespace where that symbol has no bars, which `toLogicalRange` already produces — the
 * overlapping bars stay at their true calendar position, which is the maximum truthful overlap.
 *
 * NO overlap is the case that needs a rule, because Lightweight Charts will not let a chart be
 * scrolled entirely off its own data: v5.2 `_correctOffset` clamps rightOffset so the window's
 * right border stays >= firstIndex + 1 and its left border stays <= baseIndex - 1
 * (`MinVisibleBarsCount` = 2). We apply the SAME bound here, preserving the window's width, so the
 * pane parks at the nearest truthful position ("this symbol's history begins after the window you
 * are looking at").
 *
 * Doing it here rather than letting the library do it is what makes the bus terminate: a target
 * the library would silently rewrite is a target whose echo never matches, so the bus would
 * re-issue it on every frame forever.
 */
export function clampLogicalRange(clock: AxisClock, range: LogicalRange): LogicalRange | null {
  if (!usable(clock)) return null;
  let { from, to } = range;
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  let span = to - from;
  if (!(span >= MIN_LOGICAL_SPAN)) { span = MIN_LOGICAL_SPAN; to = from + span; }
  // right border must keep the second bar reachable…
  const minTo = clock.first + 1;
  if (to < minTo) { to = minTo; from = to - span; }
  // …and the left border must not pass the last bar. Order matters: this can only move the
  // window right, so it can never re-break the bound above.
  if (from > clock.last - 1) { from = clock.last - 1; to = from + span; }
  return { from, to };
}

/** True when two logical ranges are the same viewport for practical purposes (sub-pixel). */
export function sameLogicalRange(a: LogicalRange | null, b: LogicalRange | null, epsilon = 1e-4): boolean {
  return !!a && !!b && Math.abs(a.from - b.from) < epsilon && Math.abs(a.to - b.to) < epsilon;
}

/**
 * Representative ms per bar, as the MEDIAN of up to `samples` adjacent-bar gaps.
 *
 * Median, not mean: a daily equity axis averages ~1.4 days per bar once weekends are counted
 * while a 7-day crypto axis averages 1.0, so the mean would scale one pane's whitespace against
 * the other's by 40%. The median is 1 day on both, so same-timeframe panes agree.
 */
export function sampleStep(msAt: (i: number) => number, first: number, last: number, samples = 32): number {
  const span = last - first;
  if (!(span > 0)) return NaN;
  const gaps: number[] = [];
  const stride = Math.max(1, Math.floor(span / samples));
  for (let i = first; i < last && gaps.length < samples; i += stride) {
    const a = msAt(i);
    const b = msAt(i + 1);
    if (Number.isFinite(a) && Number.isFinite(b) && b > a) gaps.push(b - a);
  }
  if (!gaps.length) {
    const a = msAt(first);
    const b = msAt(last);
    return Number.isFinite(a) && Number.isFinite(b) && b > a ? (b - a) / span : NaN;
  }
  gaps.sort((x, y) => x - y);
  return gaps[gaps.length >> 1];
}
