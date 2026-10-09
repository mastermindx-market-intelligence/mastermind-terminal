/**
 * Bar Replay — the temporal authority contract.
 *
 * ── WHY REPLAY IS SINGLE-CHART ONLY ─────────────────────────────────────────
 * Replay rewinds a chart by slicing its bar array at an integer index. That index
 * is only a position in ONE array. Two symbols do not share an array: they have
 * different first bars, different missing sessions and different source depths, so
 * the same integer names different instants. Measured on the shipped fixtures:
 *
 *     index 300  →  AAPL 2022-09-06        (1255 daily bars from 2021-06-28)
 *     index 300  →  ARM  2024-11-21        ( 698 daily bars from 2023-09-14)
 *
 * Matching timeframes do not repair this — the gap above is on identical daily
 * bars. A workspace-wide Replay would therefore need a canonical TIMESTAMP cursor
 * that every pane projects itself onto, which is a synchronization system no
 * product requirement asks for (`docs/FEATURE_GAP_AUDIT.md` specifies Replay as a
 * single-chart "visible bars cutoff index"; multi-chart grid is a separate item).
 *
 * So the contract is the smaller truthful one: Replay is offered only when the
 * workspace IS a single chart. This matches how the drawing system already treats
 * grids (creation is retired at `panes.length > 1`).
 *
 * ── THE INVARIANT THIS FILE EXISTS TO HOLD ──────────────────────────────────
 * A workspace must never present Replay while one of its charts silently stays at
 * present time. `replayIsAvailable` is therefore consulted as a DERIVATION of the
 * effective state, not as a reset hook in each layout transition — so there is no
 * render, transient ones included, in which Replay is claimed over a grid.
 *
 * ── THE REPLAY POSITION IS AN INSTANT, NOT A BAR NUMBER ─────────────────────
 * The single-chart rule fixed the index meaning different things in two PANES; the
 * same flaw sat inside one pane across a TIMEFRAME change. The index is a position
 * in the daily array, and switching to weekly carried it onto a 5×-shorter array:
 * measured on the NVDA fixture, daily bar 1175 (2026-03-04) became "bar 1175 of
 * 260 weekly bars", i.e. the whole weekly history up to 2026-06-26 under a REPLAY
 * badge. So the transport now holds a `ReplayCutoff` — the instant the replay has
 * reached — and every timeframe shows exactly the bars KNOWABLE at that instant,
 * read through the canonical bar identity (lib/sessionBars.ts): `time` names the
 * bar, `closeTime` (daily multiples) or the bar's end (intraday) is when it became
 * knowable. The integer the rail displays is derived from the cutoff per chart.
 * A timeframe that cannot honour the cutoff ends Replay explicitly; nothing is
 * re-slid to a nearby date.
 */

import { timeToMs } from "@/lib/timeWindow";
import { isIntradayTf, tfSeconds } from "@/lib/intradayShared";

/** Replay never rewinds past this bar — the indicator stack needs a warmup window. */
export const REPLAY_MIN_IDX = 20;

/** A bar count below this cannot be scrubbed: there is no span between floor and end. */
export const REPLAY_MIN_TOTAL = REPLAY_MIN_IDX + 1;

/**
 * The contract, stated once. Replay belongs to a workspace of exactly one chart.
 * Note this is about PANE COUNT alone: same-symbol and same-timeframe grids are
 * still grids, and the index still means different things in each of their panes.
 */
export function replayIsAvailable(paneCount: number): boolean {
  return paneCount === 1;
}

/**
 * Identity of a chart's bar array. A bar count is only meaningful about the
 * (symbol, timeframe) it was measured on — the same symbol resampled to 3D has a
 * different length than its daily series — so totals are stored under this key
 * rather than as one "last pane to report wins" number.
 */
export function replayChartKey(symbol: string | undefined, timeframe: string | undefined): string {
  return `${symbol ?? ""}|${timeframe ?? ""}`;
}

/**
 * The authoritative span for the transport: the bar count of the ONE chart that may
 * replay, or 0 when that is unknown or the workspace is a grid. Returning 0 rather
 * than a stale number is the point — a transport that cannot name its span must say
 * so instead of scrubbing one symbol against another symbol's length.
 */
export function resolveReplayTotal(
  paneTotals: Record<string, number>,
  panes: readonly string[],
  paneTfs: readonly string[],
): number {
  if (!replayIsAvailable(panes.length)) return 0;
  const total = paneTotals[replayChartKey(panes[0], paneTfs[0])];
  return Number.isFinite(total) && total! > 0 ? total! : 0;
}

/** True when the resolved span is actually scrubbable. */
export function replayHasSpan(total: number): boolean {
  return total >= REPLAY_MIN_TOTAL;
}

/**
 * Clamp a position into the span. Every transport control — reset, step, scrub,
 * autoplay — routes through this, so they cannot disagree about where the ends are.
 */
export function clampReplayIdx(idx: number, total: number): number {
  if (!replayHasSpan(total)) return REPLAY_MIN_IDX;
  return Math.min(total - 1, Math.max(REPLAY_MIN_IDX, Math.trunc(idx)));
}

/** Where Replay opens: a run-up of recent history, never past the warmup floor. */
export function initialReplayIdx(total: number): number {
  return clampReplayIdx(total - 80, total);
}

// ── The replay position as an instant ───────────────────────────────────────

/**
 * Two clocks that never mix. Daily-derived bars (D, 2D, 3D, W, 2W, 1M, 3M) are keyed
 * by SESSION DATE; intraday bars by a market-local clock in seconds. A session date has
 * no exact counterpart on the intraday clock (when on that day?), so a cutoff carries
 * its clock and is only ever compared against bars of the same one.
 */
export type ReplayClock = "session" | "intraday";

/** Where Replay has reached: everything knowable at `at` (epoch ms on `clock`) is shown. */
export type ReplayCutoff = { readonly clock: ReplayClock; readonly at: number };

/** When each bar of one chart became knowable, ascending, on that chart's clock. */
export type ReplayAxis = { readonly clock: ReplayClock; readonly at: readonly number[] };

/** Why Replay had to end on a timeframe change, or null when the cutoff still holds. */
export type ReplayExit = "clock" | "range" | null;

type ReplayBar = { time: unknown; closeTime?: unknown };

export function replayClockOf(tf: string): ReplayClock {
  return isIntradayTf(tf) ? "intraday" : "session";
}

/**
 * When a bar became knowable — the canonical availability fact, never its identity.
 * A 3D bar is keyed by its OPENING session but is only complete at `closeTime`; a
 * calendar W/1M bar is keyed by its last session; a daily bar by its own session; an
 * intraday bar is complete when its interval ends.
 */
export function barAvailableAt(bar: ReplayBar, tf: string): number {
  if (replayClockOf(tf) === "intraday") return timeToMs(bar.time) + tfSeconds(tf) * 1000;
  return timeToMs(bar.closeTime ?? bar.time);
}

export function replayAxisOf(rows: readonly ReplayBar[], tf: string): ReplayAxis {
  return { clock: replayClockOf(tf), at: rows.map((r) => barAvailableAt(r, tf)) };
}

/** Bars [0, n) are knowable at `cutoff`; binary search over an ascending availability. */
function knowableCount(n: number, availableAt: (i: number) => number, cutoff: number): number {
  let lo = 0, hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (availableAt(mid) <= cutoff) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/**
 * How many leading bars of `rows` (one chart at `tf`) are knowable at the cutoff. This is
 * the replay slice — never padded: a chart with fewer bars than the warmup floor before
 * the cutoff shows those bars, not later ones. A cutoff on another clock shows nothing,
 * because no bar of this chart can be placed against it.
 */
export function replayVisibleCount(rows: readonly ReplayBar[], tf: string, cutoff: ReplayCutoff | null | undefined): number {
  if (!cutoff || cutoff.clock !== replayClockOf(tf)) return 0;
  return knowableCount(rows.length, (i) => barAvailableAt(rows[i], tf), cutoff.at);
}

/** The bar a cutoff lands on in one chart: its last knowable bar, or -1 for none / another clock. */
export function replayIdxAt(axis: ReplayAxis | null | undefined, cutoff: ReplayCutoff | null | undefined): number {
  if (!axis || !cutoff || axis.clock !== cutoff.clock) return -1;
  return knowableCount(axis.at.length, (i) => axis.at[i], cutoff.at) - 1;
}

/**
 * The cutoff that puts one chart's last visible bar at `idx` (clamped into the span the
 * same way every transport control is). Null when the chart has no scrubbable span.
 */
export function replayCutoffAt(axis: ReplayAxis | null | undefined, idx: number): ReplayCutoff | null {
  if (!axis || !replayHasSpan(axis.at.length)) return null;
  const at = axis.at[clampReplayIdx(idx, axis.at.length)];
  return Number.isFinite(at) ? { clock: axis.clock, at } : null;
}

/** One bar forward or back from wherever the cutoff sits on this chart. */
export function stepReplayCutoff(axis: ReplayAxis | null | undefined, cutoff: ReplayCutoff | null | undefined, by: number): ReplayCutoff | null {
  const at = replayIdxAt(axis, cutoff);
  return replayCutoffAt(axis, (at < 0 ? (axis?.at.length ?? 0) - 1 : at) + by);
}

/**
 * Can the chart now on screen (at `tf`, measured as `axis`) still honour the cutoff?
 * "clock"  — the timeframe is on the other clock; there is no exact instant to keep.
 * "range"  — fewer than the warmup floor of bars are knowable at the cutoff, so the
 *            transport would have to invent later bars to scrub.
 * An axis that has not been measured yet (or measured empty while reloading) decides
 * nothing — the chart cannot yet say what it holds.
 */
export function replayExitFor(cutoff: ReplayCutoff | null | undefined, tf: string, axis: ReplayAxis | null | undefined): ReplayExit {
  if (!cutoff) return null;
  if (cutoff.clock !== replayClockOf(tf)) return "clock";
  if (!axis || axis.at.length === 0 || axis.clock !== cutoff.clock) return null;
  return replayIdxAt(axis, cutoff) < REPLAY_MIN_IDX ? "range" : null;
}

/** Equal axes — lets the shell keep one object per chart instead of re-rendering per load. */
export function sameReplayAxis(a: ReplayAxis | undefined, b: ReplayAxis): boolean {
  if (!a || a.clock !== b.clock || a.at.length !== b.at.length) return false;
  for (let i = 0; i < a.at.length; i++) if (a.at[i] !== b.at[i]) return false;
  return true;
}
