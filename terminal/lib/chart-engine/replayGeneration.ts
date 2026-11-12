// Bar-replay and live-return reducer for the chart engine (L02).
//
// Replay rewinds ONE chart to a knowability instant and plays it forward bar by
// bar. Everything here is pure data reduction — no DOM, no renderer, no import
// beyond the contract's EngineTime — so the same reducer drives the LWC adapter
// today and the canvas renderer tomorrow. Every function returns a new object;
// inputs (rows, states, commits) are treated as frozen values, never mutated.
//
// ── Law 1: knowability (the six-time-facts law) ─────────────────────────────
// A bar's `time` is its OPENING time and its identity; its `closeTime` is when
// its complete values became available. Replay truncates by closeTime, never by
// time: a bar that has opened but not yet closed is not knowable, so it is never
// shown as a complete bar. With `showPartial` the developing bar may appear as a
// PARTIAL projection whose only knowable value is its open — an intra-bar path
// cannot be reconstructed from the close alone, so high/low/close are pinned to
// the open rather than invented. The projection is display-only: base rows are
// never rewritten, and the bar's true values reach the exit fold only through
// the live commits that carried them.
//
// ── Law 2: one generation per exit (the live-bar law) ───────────────────────
// One accepted live bar is one generation of in-place updates. Live commits that
// arrive while replay is active are QUEUED — coalesced to at most one entry per
// bar key, bounded, each stamped with the live generation it was received under
// — and never touch visibleRows. exitReplay folds the queue into the base rows
// and hands the caller a `flush` of per-bar commits whose application is exactly
// ONE generation (the parent calls its live-commit boundary once), never a
// setData rebuild. The ExitReplayResult discriminates this: `apply` is always
// "generation" and `flush` covers only the queued bar keys — a wholesale row
// replacement would instead carry every row.
//
// ── Law 3: replay is single-chart only (lib/replayContract.ts) ──────────────
// A pane-sync group makes one bar index name different instants in different
// panes, so enterReplay refuses while a pane-sync group is active. The refusal
// is typed, precedes every other check, and is not a transition: mode and
// generation are unchanged.
//
// ── Future anchors ───────────────────────────────────────────────────────────
// futureTime.ts addresses the blank right gutter with synthetic coordinates past
// the newest real candle. Those slots carry no knowable values, so they are
// excluded from replay rows and from the live queue. BASE_SHA exports no
// isFutureTime(); the marker is the `synthetic: true` flag the grid stamps on
// its generated rows (see isSyntheticFuture).

import type { EngineTime } from "./api";

// ── Rows ──────────────────────────────────────────────────────────────────────

/** One bar as replay sees it: `time` is identity (the opening instant), `closeTime` is knowability. */
export type ReplayRow = {
  time: EngineTime;
  closeTime: EngineTime;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  /** Producer's flag, carried for display. Truncation reads `closeTime` only. */
  complete: boolean;
  /** Present only on synthetic future coordinates (futureTime.ts); never enters replay space. */
  synthetic?: true;
};

/**
 * One accepted live-tick mutation of the bar store. Structural twin of sibling
 * module lib/chart-engine/liveGeneration.ts (L01, not imported here): a commit
 * either replaces the developing bar ("update") or starts a new one ("append"),
 * and `generation` is the live render generation it was accepted under.
 */
export type LiveCommit = { generation: number; op: "update" | "append"; row: ReplayRow };

/** True for rows the futureTime grid generated. Such a row has no knowable values. */
export function isSyntheticFuture(row: ReplayRow): boolean {
  return row.synthetic === true;
}

// ── State ─────────────────────────────────────────────────────────────────────

export type ReplayRefusalCode = "pane_sync_active" | "no_rows" | "cursor_before_first";

/** Why enterReplay refused. Codes are stable API; `detail` explains the check that fired. */
export type ReplayRefusal = { code: ReplayRefusalCode; detail: string };

export type ReplayState = {
  mode: "live" | "replay";
  /** Bumps exactly once per accepted transition CALL (enter-success / step / seek / exit-from-replay). */
  generation: number;
  /** Sanitized truth: real bars only, deduped by bar key, sorted by opening time. */
  rows: ReplayRow[];
  /** What the chart renders. Live mode: `rows` (same reference). Replay: knowability-truncated view. */
  visibleRows: ReplayRow[];
  /** The knowability instant (epoch ms) the cursor sits at; null in live mode. */
  cursorMs: number | null;
  /** True when nothing is hidden: cursor >= the last bar's closeTime. */
  atLiveEdge: boolean;
  /** Live commits received during replay (coalesced per bar key, bounded). Empty in live mode. */
  queue: LiveCommit[];
  /** Partial-bar rule chosen at enter; steps recompute the view with the same rule. */
  showPartial: boolean;
  /** Last refusal, informational only. A refusal is not a transition. */
  refusal: ReplayRefusal | null;
};

export type EnterReplayOptions = { paneSyncActive: boolean; showPartial?: boolean };

export type EnterReplayResult =
  | { ok: true; state: ReplayState }
  | { ok: false; refusal: ReplayRefusal; state: ReplayState };

/**
 * exitReplay's handoff to the parent. `rows` is the folded store for the
 * caller's own bookkeeping; `flush` is the RENDERER application: per-bar
 * in-place commits whose application is exactly one generation (one call to the
 * caller's live-commit boundary). `apply` is the literal proof this is a
 * generation and never a wholesale setData — a rebuild would have to carry
 * every row, and `flush` only ever carries the queued bar keys.
 */
export type ExitReplayResult = {
  state: ReplayState;
  rows: ReplayRow[];
  flush: LiveCommit[];
  apply: "generation";
};

/** Queue bound. Guards a replay left on indefinitely; beyond it the OLDEST entries are evicted. */
export const MAX_QUEUED_COMMITS = 1024;

// ── Time helpers (mirror lib/timeWindow.ts timeToMs; kept local so the reducer
// stays dependency-free like its chart-engine siblings axisZoom/viewReset) ────

/** Any EngineTime to epoch ms. Numeric strings are not epoch forms here (matches timeToMs). */
function timeMs(time: EngineTime): number {
  if (typeof time === "number") return Number.isFinite(time) ? time * 1000 : NaN;
  if (typeof time === "string") return Date.parse(`${time.slice(0, 10)}T00:00:00Z`);
  const { year, month, day } = time;
  if (typeof year === "number" && typeof month === "number" && typeof day === "number") {
    return Date.UTC(year, month - 1, day);
  }
  return NaN;
}

/** Canonical bar identity: the normalized opening instant. Two spellings of one instant coalesce. */
function barKey(row: Pick<ReplayRow, "time">): string {
  return String(timeMs(row.time));
}

// ── Creation ──────────────────────────────────────────────────────────────────

/**
 * Build the live-mode state from a bar store. Synthetic future rows and rows
 * without finite time/closeTime are dropped (they cannot be ordered or gated by
 * knowability); duplicate bar keys keep the LAST occurrence; the result is
 * sorted by opening time so stepping is a stable walk over bar keys.
 */
export function createReplayState(rows: readonly ReplayRow[]): ReplayState {
  const byKey = new Map<string, ReplayRow>();
  for (const row of rows) {
    if (isSyntheticFuture(row)) continue;
    if (!Number.isFinite(timeMs(row.time)) || !Number.isFinite(timeMs(row.closeTime))) continue;
    byKey.set(barKey(row), row);
  }
  const clean = [...byKey.values()].sort((a, b) => timeMs(a.time) - timeMs(b.time));
  return {
    mode: "live",
    generation: 0,
    rows: clean,
    visibleRows: clean,
    cursorMs: null,
    atLiveEdge: false,
    queue: [],
    showPartial: false,
    refusal: null,
  };
}

// ── View derivation ───────────────────────────────────────────────────────────

/**
 * The partial-bar projection: everything except the open is unknowable before
 * closeTime. high/low/close are pinned to the open (an intra-bar path cannot be
 * reconstructed) and volume is omitted (it accumulates through the bar). The
 * input row is never rewritten — this returns a display-only copy.
 */
function partialProjection(row: ReplayRow): ReplayRow {
  return {
    time: row.time,
    closeTime: row.closeTime,
    open: row.open,
    high: row.open,
    low: row.open,
    close: row.open,
    complete: false,
  };
}

/** Rows knowable at `cursorMs`: closed bars first; then, only if allowed, opened-but-unclosed bars as partials. */
function visibleByKnowability(rows: readonly ReplayRow[], cursorMs: number, showPartial: boolean): ReplayRow[] {
  const out: ReplayRow[] = [];
  for (const row of rows) {
    if (timeMs(row.closeTime) <= cursorMs) out.push(row);
    else if (showPartial && timeMs(row.time) <= cursorMs) out.push(partialProjection(row));
  }
  return out;
}

/** Recompute the replay view at a new cursor; the one shared body of every cursor move. */
function replayTransition(state: ReplayState, cursorMs: number): ReplayState {
  const lastCloseMs = timeMs(state.rows[state.rows.length - 1].closeTime);
  return {
    ...state,
    generation: state.generation + 1,
    cursorMs,
    atLiveEdge: cursorMs >= lastCloseMs,
    visibleRows: visibleByKnowability(state.rows, cursorMs, state.showPartial),
  };
}

// ── Enter ─────────────────────────────────────────────────────────────────────

function refuse(state: ReplayState, code: ReplayRefusalCode, detail: string): EnterReplayResult {
  const refusal = { code, detail };
  return { ok: false, refusal, state: { ...state, refusal } };
}

/**
 * Enter replay at a knowability instant. Refusal precedence: the single-chart
 * law first (pane_sync_active), then no_rows, then cursor_before_first (the
 * cursor must sit at or after the first bar's closeTime, so at least one bar is
 * knowable). A refusal is not a transition — mode and generation are unchanged.
 *
 * Entering while already in replay re-anchors the cursor and keeps the queue:
 * the queue's job (folding live ticks on exit) does not depend on cursor
 * position, and dropping it would lose live truth.
 */
export function enterReplay(
  state: ReplayState,
  cursorTime: EngineTime,
  options: EnterReplayOptions,
): EnterReplayResult {
  const { paneSyncActive, showPartial = false } = options;
  if (paneSyncActive) {
    return refuse(state, "pane_sync_active", "replay is single-chart only; a pane-sync group is active");
  }
  if (!state.rows.length) {
    return refuse(state, "no_rows", "no real bars to replay");
  }
  const firstCloseMs = timeMs(state.rows[0].closeTime);
  const askedMs = timeMs(cursorTime);
  if (!Number.isFinite(askedMs) || askedMs < firstCloseMs) {
    return refuse(state, "cursor_before_first", "cursor precedes the first knowable bar's closeTime");
  }
  const lastCloseMs = timeMs(state.rows[state.rows.length - 1].closeTime);
  return {
    ok: true,
    state: {
      ...state,
      mode: "replay",
      generation: state.generation + 1,
      cursorMs: askedMs,
      atLiveEdge: askedMs >= lastCloseMs,
      visibleRows: visibleByKnowability(state.rows, askedMs, showPartial),
      showPartial,
      refusal: null,
    },
  };
}

// ── Cursor moves (replay mode only; wrong-mode calls return the input state
// unchanged — the one intentional reference equality) ─────────────────────────

/**
 * Step forward one bar key: the cursor jumps to the closeTime of the next bar
 * that is not yet knowable, making exactly that bar visible. Already at the
 * live edge, the cursor clamps (deterministic no-op position) — the step still
 * bumps the generation because consumers key freshness on transition calls.
 */
export function stepForward(state: ReplayState): ReplayState {
  if (state.mode !== "replay" || !state.rows.length) return state;
  const cursor = state.cursorMs;
  if (cursor == null) return state;
  const next = state.rows.find((r) => timeMs(r.closeTime) > cursor);
  return replayTransition(state, next ? timeMs(next.closeTime) : cursor);
}

/**
 * Step back one bar key: the cursor retreats to the closeTime that made the
 * previous bar knowable, hiding exactly one bar. It never moves before the
 * first bar's closeTime (the same floor enterReplay enforces) — a step at the
 * floor clamps in place and still bumps the generation.
 */
export function stepBack(state: ReplayState): ReplayState {
  if (state.mode !== "replay" || !state.rows.length) return state;
  const cursor = state.cursorMs;
  if (cursor == null) return state;
  const completeCount = state.rows.reduce((n, r) => (timeMs(r.closeTime) <= cursor ? n + 1 : n), 0);
  const backIdx = Math.max(0, completeCount - 2);
  return replayTransition(state, timeMs(state.rows[backIdx].closeTime));
}

/**
 * Jump the cursor to an instant. Seeking below the first knowable bar clamps to
 * that floor; seeking past the last closeTime is allowed (atLiveEdge becomes
 * true — everything is knowable again). Non-finite times clamp to the floor.
 */
export function seek(state: ReplayState, cursorTime: EngineTime): ReplayState {
  if (state.mode !== "replay" || !state.rows.length) return state;
  const floorMs = timeMs(state.rows[0].closeTime);
  const askedMs = timeMs(cursorTime);
  return replayTransition(state, Number.isFinite(askedMs) && askedMs > floorMs ? askedMs : floorMs);
}

// ── Live commits during replay ────────────────────────────────────────────────

/**
 * Receive one live commit while replaying. The commit is QUEUED, never applied:
 * visibleRows is untouched (the replayed chart must not repaint ahead of its
 * cursor). Coalescing keeps at most ONE entry per bar key — a newer commit for
 * a key replaces the older entry in place, so arrival order among distinct bars
 * is preserved and the queue never grows with tick count. Synthetic future
 * rows never enter the queue. Beyond MAX_QUEUED_COMMITS the OLDEST entries are
 * evicted (newest knowable state wins; a caller needing lossless behavior must
 * exit before the bound). In live mode this returns the input state unchanged:
 * the caller applies live commits through its normal live path.
 *
 * Queueing is not a transition — the state generation does NOT bump; each entry
 * carries the live generation it was received under.
 */
export function applyLiveCommit(state: ReplayState, commit: LiveCommit): ReplayState {
  if (state.mode !== "replay") return state;
  if (isSyntheticFuture(commit.row)) return state;
  if (!Number.isFinite(timeMs(commit.row.time))) return state;
  const key = barKey(commit.row);
  const idx = state.queue.findIndex((e) => barKey(e.row) === key);
  const queue =
    idx === -1 ? [...state.queue, commit] : state.queue.map((e, i) => (i === idx ? commit : e));
  const bounded =
    queue.length > MAX_QUEUED_COMMITS ? queue.slice(queue.length - MAX_QUEUED_COMMITS) : queue;
  return { ...state, queue: bounded };
}

// ── Exit ──────────────────────────────────────────────────────────────────────

/**
 * Fold queued commits over base rows: an entry replaces its bar's row in place,
 * or is inserted at its time-sorted position when the bar does not exist yet
 * (a bar born during replay). Row objects are shared, never copied or mutated.
 */
function foldCommits(base: readonly ReplayRow[], queue: readonly LiveCommit[]): ReplayRow[] {
  const rows = [...base];
  for (const { row } of queue) {
    const key = barKey(row);
    const idx = rows.findIndex((r) => barKey(r) === key);
    if (idx !== -1) {
      rows[idx] = row;
      continue;
    }
    const ms = timeMs(row.time);
    const at = rows.findIndex((r) => timeMs(r.time) > ms);
    if (at === -1) rows.push(row);
    else rows.splice(at, 0, row);
  }
  return rows;
}

/**
 * Leave replay. The returned state is live-mode with the queue folded into the
 * base rows and exactly ONE generation bump. `flush` re-stamps every queued
 * commit with that exit generation: applying the flush (each op an in-place
 * series update / append) is that single generation — the parent calls its
 * live-commit boundary ONCE, never setData. Calling exitReplay from live mode
 * is a no-op: the input state is returned unchanged with an empty flush.
 */
export function exitReplay(state: ReplayState): ExitReplayResult {
  if (state.mode !== "replay") {
    return { state, rows: state.rows, flush: [], apply: "generation" };
  }
  const folded = foldCommits(state.rows, state.queue);
  const generation = state.generation + 1;
  const flush = state.queue.map((c) => ({ ...c, generation }));
  const next: ReplayState = {
    mode: "live",
    generation,
    rows: folded,
    visibleRows: folded,
    cursorMs: null,
    atLiveEdge: false,
    queue: [],
    showPartial: false,
    refusal: null,
  };
  return { state: next, rows: folded, flush, apply: "generation" };
}
