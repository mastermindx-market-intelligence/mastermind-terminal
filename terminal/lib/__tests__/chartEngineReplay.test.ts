import { describe, expect, it } from "vitest";
import {
  MAX_QUEUED_COMMITS,
  applyLiveCommit,
  createReplayState,
  enterReplay,
  exitReplay,
  isSyntheticFuture,
  seek,
  stepBack,
  stepForward,
  type LiveCommit,
  type ReplayRow,
  type ReplayState,
} from "@/lib/chart-engine/replayGeneration";

// ─────────────────────────────────────────────────────────────────────────────
// Reducer tests for lib/chart-engine/replayGeneration.ts (L02): bar replay that
// truncates by KNOWABILITY (closeTime, never time), deterministic stepping, a
// bounded coalescing queue for live ticks that arrive during replay, and an exit
// whose application is exactly ONE live generation — never a setData rebuild.
// The two binding laws under test: replay is single-chart only (a pane-sync
// group refuses entry), and one exit = one generation.
// ─────────────────────────────────────────────────────────────────────────────

// Intraday-style fixtures: bar i opens at 1_000_000 + i*300 (epoch seconds) and
// closes 300s later, so `time` and `closeTime` are always distinct — any rule
// that truncates by `time` instead of `closeTime` changes what is visible.
const STEP = 300;
const T0 = 1_000_000;

function bar(i: number, open: number, close: number, extra: Partial<ReplayRow> = {}): ReplayRow {
  const time = T0 + i * STEP;
  return {
    time,
    closeTime: time + STEP,
    open,
    high: Math.max(open, close) + 1,
    low: Math.min(open, close) - 1,
    close,
    volume: 100 + i,
    complete: true,
    ...extra,
  };
}

const ROWS: ReplayRow[] = [bar(0, 10, 11), bar(1, 11, 12), bar(2, 12, 9), bar(3, 9, 13), bar(4, 13, 14)];
const FIRST_CLOSE = T0 + STEP;      // 1_000_300 — bar 0's closeTime, the cursor floor
const LAST_CLOSE = T0 + 5 * STEP;   // 1_001_500 — bar 4's closeTime, the live edge

// Row `time`s are epoch SECONDS (LWC convention); the state's cursorMs is epoch MS.
const ms = (sec: number): number => sec * 1000;

function times(rows: readonly ReplayRow[]): number[] {
  return rows.map((r) => r.time as number);
}

/** Freeze a value graph so any reducer mutation throws (ESM runs strict). */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function enterLive(cursorTime: number, options: { paneSyncActive?: boolean; showPartial?: boolean } = {}) {
  const created = createReplayState(ROWS);
  return enterReplay(created, cursorTime, { paneSyncActive: false, ...options });
}

const commit = (gen: number, op: "update" | "append", row: ReplayRow): LiveCommit => ({ generation: gen, op, row });

/** Replay at bar 0 with a representative live session queued: two coalescing
 *  updates (bar 4), one correction (bar 3) and one bar born during replay. */
function replayWithQueue(): ReplayState {
  const res = enterLive(FIRST_CLOSE);
  if (!res.ok) throw new Error("enter failed");
  let s = res.state;
  s = applyLiveCommit(s, commit(10, "update", { ...ROWS[4], close: 99 }));
  s = applyLiveCommit(s, commit(11, "update", { ...ROWS[4], close: 98 })); // coalesces onto bar 4
  s = applyLiveCommit(s, commit(12, "update", { ...ROWS[3], close: 97 }));
  s = applyLiveCommit(s, commit(13, "append", bar(5, 98, 100)));
  return s;
}

describe("replayGeneration — knowability truncation", () => {
  it("createReplayState starts live at generation 0 with rows sorted and visible", () => {
    const state = createReplayState(ROWS);
    expect(state.mode).toBe("live");
    expect(state.generation).toBe(0);
    expect(times(state.rows)).toEqual(times(ROWS));
    expect(state.visibleRows).toBe(state.rows);
    expect(state.queue).toEqual([]);
    expect(state.cursorMs).toBeNull();
  });

  it("truncates by closeTime, not time: a bar whose closeTime is past the cursor is hidden", () => {
    // Cursor = bar 1's closeTime exactly. Bar 2 OPENS at this instant (time ===
    // cursor) but closes later, so a time-based rule would show it. It must stay
    // hidden: its values are not knowable yet.
    const res = enterLive(T0 + 2 * STEP);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(times(res.state.visibleRows)).toEqual([T0, T0 + STEP]);
    expect(res.state.atLiveEdge).toBe(false);
    expect(res.state.mode).toBe("replay");
    expect(res.state.generation).toBe(1);
  });

  it("a bar is knowable AT its closeTime instant (boundary is inclusive)", () => {
    const res = enterLive(FIRST_CLOSE);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(times(res.state.visibleRows)).toEqual([T0]);
  });

  it("the truncated view never rewrites the base rows (display-only projection)", () => {
    const frozen = deepFreeze(ROWS.map((r) => ({ ...r })));
    const res = enterReplay(createReplayState(frozen), T0 + 2 * STEP, { paneSyncActive: false, showPartial: true });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // bar 2 appears as a partial; the stored row keeps its real (unknowable) values
    const stored = res.state.rows[2];
    expect(stored.high).toBe(13); // max(12,9)+1 from the fixture
    expect(stored.low).toBe(8);   // min(12,9)-1
    expect(stored.close).toBe(9);
    expect(stored.complete).toBe(true);
  });
});

describe("replayGeneration — partial-bar rule", () => {
  const PARTIAL_CURSOR = T0 + 2 * STEP + 150; // inside bar 2's life: opened, not closed

  it("hides the opened-but-unclosed bar by default", () => {
    const res = enterLive(PARTIAL_CURSOR);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(times(res.state.visibleRows)).toEqual([T0, T0 + STEP]);
  });

  it("showPartial projects the developing bar as its OPEN only — no invented path", () => {
    const res = enterLive(PARTIAL_CURSOR, { showPartial: true });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(times(res.state.visibleRows)).toEqual([T0, T0 + STEP, T0 + 2 * STEP]);
    const partial = res.state.visibleRows[2];
    expect(partial.complete).toBe(false);
    expect(partial.open).toBe(12);
    // intra-bar high/low/close cannot be reconstructed: pinned to the open
    expect(partial.high).toBe(12);
    expect(partial.low).toBe(12);
    expect(partial.close).toBe(12);
    // volume accumulates through the bar — nothing knowable to show
    expect("volume" in partial).toBe(false);
  });

  it("a bar that has not even opened stays hidden even with showPartial", () => {
    const res = enterLive(PARTIAL_CURSOR, { showPartial: true });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // bars 3 and 4 open after the cursor
    expect(res.state.visibleRows.some((r) => r.time === T0 + 3 * STEP)).toBe(false);
    expect(res.state.visibleRows.some((r) => r.time === T0 + 4 * STEP)).toBe(false);
  });
});

describe("replayGeneration — refusal codes (single-chart law)", () => {
  it("refuses while a pane-sync group is active, without transitioning", () => {
    const created = createReplayState(ROWS);
    const res = enterReplay(created, T0, { paneSyncActive: true });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.refusal.code).toBe("pane_sync_active");
    expect(res.state.mode).toBe("live");
    expect(res.state.generation).toBe(0); // a refusal is not a transition
    expect(res.state.refusal?.code).toBe("pane_sync_active");
  });

  it("refuses with no_rows when there is nothing real to replay", () => {
    const empty = enterReplay(createReplayState([]), T0, { paneSyncActive: false });
    expect(empty.ok).toBe(false);
    if (empty.ok) return;
    expect(empty.refusal.code).toBe("no_rows");

    const syntheticOnly = enterReplay(createReplayState([bar(9, 99, 99, { synthetic: true })]), T0, {
      paneSyncActive: false,
    });
    expect(syntheticOnly.ok).toBe(false);
    if (syntheticOnly.ok) return;
    expect(syntheticOnly.refusal.code).toBe("no_rows");
  });

  it("refuses cursor_before_first when the cursor precedes the first knowable bar", () => {
    const res = enterLive(FIRST_CLOSE - 1);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.refusal.code).toBe("cursor_before_first");
    expect(res.state.mode).toBe("live");
  });

  it("the single-chart law outranks every other check", () => {
    const res = enterReplay(createReplayState([]), T0, { paneSyncActive: true });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.refusal.code).toBe("pane_sync_active");
  });
});

describe("replayGeneration — deterministic stepping and the live edge", () => {
  it("steps forward one bar key per call and reaches the live edge exactly at the last closeTime", () => {
    const res = enterLive(FIRST_CLOSE); // bar 0 knowable
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    let s = res.state;
    expect(times(s.visibleRows)).toEqual([T0]);
    expect(s.generation).toBe(1);

    s = stepForward(s);
    expect(s.cursorMs).toBe(ms(T0 + 2 * STEP));
    expect(times(s.visibleRows)).toEqual([T0, T0 + STEP]);
    expect(s.atLiveEdge).toBe(false);

    s = stepForward(s); // bar 2 knowable
    s = stepForward(s); // bar 3 knowable
    expect(s.atLiveEdge).toBe(false);

    s = stepForward(s); // bar 4's closeTime: everything is knowable now
    expect(s.cursorMs).toBe(ms(LAST_CLOSE));
    expect(s.atLiveEdge).toBe(true);
    expect(s.visibleRows).toHaveLength(5);
    expect(s.generation).toBe(5); // enter + 4 steps, one bump each
  });

  it("stepping past the last complete bar clamps in place and keeps the generation moving", () => {
    const res = enterLive(LAST_CLOSE);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const s = stepForward(res.state);
    expect(s.atLiveEdge).toBe(true);
    expect(s.cursorMs).toBe(ms(LAST_CLOSE));
    expect(s.generation).toBe(res.state.generation + 1);
  });

  it("steps back one bar key and never before the first knowable bar", () => {
    const res = enterLive(T0 + 4 * STEP); // bars 0..3 knowable (bar 3 closes exactly at the cursor)
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    let s = res.state;
    s = stepBack(s); // hide bar 3
    expect(s.cursorMs).toBe(ms(T0 + 3 * STEP));
    expect(times(s.visibleRows)).toEqual([T0, T0 + STEP, T0 + 2 * STEP]);
    s = stepBack(s); // hide bar 2
    expect(s.cursorMs).toBe(ms(T0 + 2 * STEP));
    expect(times(s.visibleRows)).toEqual([T0, T0 + STEP]);
    const floored = stepBack(s); // reach the floor: only bar 0 knowable
    expect(floored.cursorMs).toBe(ms(FIRST_CLOSE));
    expect(times(floored.visibleRows)).toEqual([T0]);
    const clamped = stepBack(floored); // at the floor: clamps in place, still one bump
    expect(clamped.cursorMs).toBe(ms(FIRST_CLOSE));
    expect(clamped.generation).toBe(floored.generation + 1);
    expect(times(clamped.visibleRows)).toEqual([T0]);
  });

  it("stepBack undoes stepForward exactly (round trip on the visible view)", () => {
    const res = enterLive(FIRST_CLOSE);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const back = stepBack(stepForward(res.state));
    expect(times(back.visibleRows)).toEqual(times(res.state.visibleRows));
  });

  it("is deterministic: the same call on the same state yields the same state", () => {
    const res = enterLive(FIRST_CLOSE);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(stepForward(res.state)).toEqual(stepForward(res.state));
    expect(stepBack(res.state)).toEqual(stepBack(res.state));
    expect(seek(res.state, T0 + 3 * STEP)).toEqual(seek(res.state, T0 + 3 * STEP));
  });

  it("seek jumps by instant, clamps below the floor, and allows the live edge", () => {
    const res = enterLive(FIRST_CLOSE);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const jumped = seek(res.state, T0 + 4 * STEP);
    expect(jumped.cursorMs).toBe(ms(T0 + 4 * STEP));
    expect(times(jumped.visibleRows)).toEqual([T0, T0 + STEP, T0 + 2 * STEP, T0 + 3 * STEP]);

    const clamped = seek(res.state, 0);
    expect(clamped.cursorMs).toBe(ms(FIRST_CLOSE));

    const edge = seek(res.state, LAST_CLOSE + 10_000);
    expect(edge.atLiveEdge).toBe(true);
    expect(edge.visibleRows).toHaveLength(5);
  });

  it("cursor moves are replay-only: in live mode every move returns the input state unchanged", () => {
    const created = createReplayState(ROWS);
    expect(stepForward(created)).toBe(created);
    expect(stepBack(created)).toBe(created);
    expect(seek(created, T0)).toBe(created);
  });
});

describe("replayGeneration — live commits queue during replay", () => {
  it("queues commits without touching visibleRows or bumping the generation", () => {
    const res = enterLive(FIRST_CLOSE);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const viewBefore = res.state.visibleRows;
    const s = applyLiveCommit(res.state, commit(10, "update", { ...ROWS[4], close: 99 }));
    expect(s.visibleRows).toBe(viewBefore); // identity: the replayed chart did not repaint
    expect(s.generation).toBe(res.state.generation); // queueing is not a transition
    expect(s.queue).toHaveLength(1);
    expect(s.queue[0].generation).toBe(10); // carries the generation it was received under
  });

  it("coalesces to at most one entry per bar key, appends in arrival order", () => {
    const s = replayWithQueue();
    expect(s.queue).toHaveLength(3);
    expect(s.queue.map((c) => c.row.time)).toEqual([T0 + 4 * STEP, T0 + 3 * STEP, T0 + 5 * STEP]);
    expect(s.queue[0].generation).toBe(11); // the NEWER update for bar 4 won
    expect(s.queue[0].row.close).toBe(98);
    expect(s.queue.map((c) => c.op)).toEqual(["update", "update", "append"]);
  });

  it("live mode passes commits straight through (nothing to queue)", () => {
    const created = createReplayState(ROWS);
    expect(applyLiveCommit(created, commit(1, "update", ROWS[4]))).toBe(created);
  });

  it("bounds the queue by evicting the OLDEST entries", () => {
    const res = enterLive(FIRST_CLOSE);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    let s = res.state;
    const total = MAX_QUEUED_COMMITS + 5;
    for (let i = 0; i < total; i++) {
      s = applyLiveCommit(s, commit(100 + i, "append", bar(10 + i, 1, 2)));
    }
    expect(s.queue).toHaveLength(MAX_QUEUED_COMMITS);
    // the five oldest (times T0+10*STEP .. T0+14*STEP) were evicted
    expect((s.queue[0].row.time as number) - T0).toBe((10 + 5) * STEP);
    expect((s.queue[s.queue.length - 1].row.time as number) - T0).toBe((10 + total - 1) * STEP);
  });
});

describe("replayGeneration — exit folds exactly ONE live generation", () => {
  it("exitReplay returns live rows with the queue folded and ONE flush generation", () => {
    const s = replayWithQueue();
    const out = exitReplay(s);
    expect(out.apply).toBe("generation");
    expect(out.state.mode).toBe("live");
    expect(out.state.generation).toBe(s.generation + 1); // exactly one bump
    expect(out.state.queue).toEqual([]);
    expect(out.state.cursorMs).toBeNull();

    // rows = base + folded queue: bars 3/4 carry the queued values, the new bar sits after bar 4
    expect(out.rows).toHaveLength(6);
    expect(out.rows[3].close).toBe(97);
    expect(out.rows[4].close).toBe(98);
    expect(out.rows[5].time).toBe(T0 + 5 * STEP);
    expect(out.rows).toBe(out.state.rows);

    // ONE generation applied, not a wholesale replace: the flush covers only the
    // queued bar keys (3), re-stamped with the single exit generation.
    expect(out.flush).toHaveLength(3);
    expect(new Set(out.flush.map((c) => c.generation))).toEqual(new Set([s.generation + 1]));
    expect(out.flush.map((c) => c.op)).toEqual(["update", "update", "append"]);
    expect(out.flush.length).not.toBe(out.rows.length); // a setData rebuild would carry every row
  });

  it("exit from live mode is a no-op with an empty flush and no generation bump", () => {
    const created = createReplayState(ROWS);
    const out = exitReplay(created);
    expect(out.state).toBe(created);
    expect(out.flush).toEqual([]);
    expect(out.apply).toBe("generation");
  });

  it("re-entering replay keeps the queued live truth for the eventual exit", () => {
    const res = enterLive(FIRST_CLOSE);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const queued = applyLiveCommit(res.state, commit(10, "update", { ...ROWS[4], close: 99 }));
    const re = enterReplay(queued, T0 + 3 * STEP, { paneSyncActive: false });
    expect(re.ok).toBe(true);
    if (!re.ok) return;
    expect(re.state.queue).toHaveLength(1); // not dropped by the re-anchor
    expect(re.state.generation).toBe(queued.generation + 1);
  });
});

describe("replayGeneration — synthetic future anchors never leak", () => {
  it("excludes synthetic rows from the store and from every replay view", () => {
    const withFuture = deepFreeze([...ROWS.map((r) => ({ ...r })), bar(9, 99, 99, { synthetic: true })]);
    const created = createReplayState(withFuture);
    expect(created.rows).toHaveLength(5); // the synthetic slot never entered

    const res = enterReplay(created, FIRST_CLOSE, { paneSyncActive: false });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const s = stepForward(stepForward(stepForward(stepForward(res.state)))); // walk to the live edge
    expect(s.atLiveEdge).toBe(true);
    expect(s.visibleRows.every((r) => !isSyntheticFuture(r))).toBe(true);
    expect(times(s.visibleRows)).not.toContain(T0 + 9 * STEP);
  });

  it("drops synthetic live commits from the queue", () => {
    const res = enterLive(FIRST_CLOSE);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const queued = applyLiveCommit(res.state, { generation: 10, op: "append", row: bar(9, 99, 99, { synthetic: true }) });
    expect(queued.queue).toHaveLength(0);
    expect(queued).toBe(res.state); // nothing changed at all
  });

  it("isSyntheticFuture keys on the synthetic flag alone", () => {
    expect(isSyntheticFuture(bar(0, 1, 2))).toBe(false);
    expect(isSyntheticFuture(bar(0, 1, 2, { synthetic: true }))).toBe(true);
  });
});

describe("replayGeneration — purity", () => {
  it("never mutates its inputs across a full replay session (deep-frozen fixtures)", () => {
    const input = deepFreeze(ROWS.map((r) => ({ ...r })));
    const snapshot = JSON.stringify(input);
    const created = createReplayState(input);
    const entered = enterReplay(created, FIRST_CLOSE, { paneSyncActive: false, showPartial: true });
    expect(entered.ok).toBe(true);
    if (!entered.ok) return;

    // freeze every intermediate state too: any in-place edit below would throw
    let s = deepFreeze(entered.state);
    s = stepForward(s);
    s = seek(s, T0 + 4 * STEP);
    s = stepBack(s);
    s = applyLiveCommit(s, { generation: 50, op: "update", row: { ...ROWS[4], close: 42 } });
    s = applyLiveCommit(s, { generation: 51, op: "append", row: bar(5, 42, 43) });
    const out = exitReplay(s);
    deepFreeze(out);

    expect(out.state.mode).toBe("live");
    expect(JSON.stringify(input)).toBe(snapshot); // the fixture survived untouched
  });

  it("returns fresh objects: no result aliases its input state", () => {
    const res = enterLive(FIRST_CLOSE);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(stepForward(res.state)).not.toBe(res.state);
    expect(stepBack(res.state)).not.toBe(res.state);
    expect(seek(res.state, T0 + 2 * STEP)).not.toBe(res.state);
    const queued = applyLiveCommit(res.state, { generation: 1, op: "update", row: ROWS[4] });
    expect(queued).not.toBe(res.state);
    expect(exitReplay(queued).state).not.toBe(queued);
  });
});
