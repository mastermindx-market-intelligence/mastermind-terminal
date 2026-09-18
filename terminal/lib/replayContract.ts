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
 */

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
