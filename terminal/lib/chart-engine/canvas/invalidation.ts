// Mastermind Chart Engine — invalidation, generation & autoscale scheduling (P3 · R03).
//
// The canvas renderer's dirty-tracking brain. This module is PURE: no DOM, no
// renderer imports, no lightweight-charts — it only answers, for everything that
// changed since the last painted frame, three questions:
//
//   1. What is the cheapest single paint that covers the accumulated changes?
//      (createInvalidator coalesces any burst of invalidations into ONE paint per
//      frame, stamped with a monotonically increasing generation number.)
//   2. Which panes must re-run autoscale for that paint? (autoscaleTargets.)
//   3. What does a data change or a live tick cost? (dataChangeMask / liveTickMask
//      translate feed events into masks BEFORE anything is scheduled, so a tick
//      outside the visible window costs literally zero — no schedule, no flush,
//      no generation bump: R03-A02.)
//
// Level ladder (ordered, merge takes the MAX):
//   none   — nothing to paint; an invalidation at this level is a complete no-op.
//   cursor — crosshair overlay only; geometry, series and scales are untouched,
//            and it can never contribute autoscale work.
//   light  — repaint series from cached geometry (screen-space shapes are still
//            valid; only pixels are stale).
//   full   — recompute geometry + autoscale + layout from source data.
//
// The schedule contract mirrors requestAnimationFrame: the invalidator hands its
// flush callback to `schedule`, which returns a cancel. A flush with nothing
// pending returns null and consumes no generation. Everything here is
// synchronous and side-effect-free apart from the schedule/cancel calls, so the
// sibling renderer lanes can drive it from rAF, a test double, or a worker tick.

// ── Levels & masks ─────────────────────────────────────────────────────────────

/** Ordered repaint cost. Merging invalidations always keeps the MAX level. */
export type InvalidationLevel = "none" | "cursor" | "light" | "full";

const LEVEL_ORDER: Record<InvalidationLevel, number> = { none: 0, cursor: 1, light: 2, full: 3 };

/**
 * What is stale. Scopes are unions while merging; the literal "all" absorbs any
 * set (once every pane is dirty, per-pane bookkeeping is pure overhead).
 */
export interface InvalidationMask {
  level: InvalidationLevel;
  /** Pane indexes whose content must repaint, or "all". */
  panes: Set<number> | "all";
  /** The time axis / horizontal layout changed (a bar slot was added or removed). */
  timeScale: boolean;
  /** Price-scale ids whose axis must repaint, or "all". */
  priceScales: Set<string> | "all";
  /** Pane indexes whose autoscale must re-run (on top of what `level` implies). */
  autoscale: Set<number>;
}

/** The result of one flush: the generation it stamped and the mask it painted. */
export interface FlushReport {
  generation: number;
  mask: InvalidationMask;
}

/** Consumer-facing invalidator handle (see createInvalidator). */
export interface Invalidator {
  /** Merge `partial` into the pending frame. Cheap; never paints. */
  invalidate(partial: Partial<InvalidationMask> & { level: InvalidationLevel }): void;
  /**
   * Paint the pending frame now: stamp the next generation and return its report.
   * Returns null (and consumes no generation) when nothing is pending. Disarms any
   * still-armed schedule — the frame's work is happening now, so the host's cancel
   * must tolerate being called after its callback already fired (as
   * cancelAnimationFrame does).
   */
  flush(): FlushReport | null;
  /** The last PAINTED generation. Starts at 0; strictly increasing per flush. */
  generation(): number;
  /** Snapshot of the coalesced pending mask, or null when nothing is pending. */
  pending(): InvalidationMask | null;
  /** Cancel any armed schedule and drop pending work. Idempotent; final. */
  dispose(): void;
}

// ── Mask helpers ───────────────────────────────────────────────────────────────

function emptyMask(): InvalidationMask {
  return { level: "none", panes: new Set(), timeScale: false, priceScales: new Set(), autoscale: new Set() };
}

/**
 * Normalize a partial into a self-owned mask: every set is copied (callers keep
 * theirs), missing scopes default to empty, and a "cursor" level contributes NO
 * autoscale work however it was filled in — the crosshair cannot move a price
 * domain, so the law ("cursor never triggers autoscale") is structural.
 */
function maskFromPartial(partial: Partial<InvalidationMask> & { level: InvalidationLevel }): InvalidationMask {
  return {
    level: partial.level,
    panes: copyScope(partial.panes),
    timeScale: partial.timeScale ?? false,
    priceScales: copyScope(partial.priceScales),
    autoscale: partial.level === "cursor" || !partial.autoscale ? new Set<number>() : new Set<number>(partial.autoscale),
  };
}

/** "all" stays "all"; a set is copied; absent is an empty set. */
function copyScope<T>(scope: Set<T> | "all" | undefined): Set<T> | "all" {
  if (scope === undefined) return new Set<T>();
  if (scope === "all") return "all";
  return new Set<T>(scope);
}

/** Fresh snapshot of a mask (same values, no shared mutable state). */
function copyMask(mask: InvalidationMask): InvalidationMask {
  return maskFromPartial(mask);
}

/** MAX level, "all"-absorbing scope unions, OR-ed timeScale, unioned autoscale. */
function mergeMasks(a: InvalidationMask, b: InvalidationMask): InvalidationMask {
  return {
    level: LEVEL_ORDER[a.level] >= LEVEL_ORDER[b.level] ? a.level : b.level,
    panes: mergeScopes(a.panes, b.panes),
    timeScale: a.timeScale || b.timeScale,
    priceScales: mergeScopes(a.priceScales, b.priceScales),
    autoscale: new Set([...a.autoscale, ...b.autoscale]),
  };
}

function mergeScopes<T>(a: Set<T> | "all", b: Set<T> | "all"): Set<T> | "all" {
  if (a === "all" || b === "all") return "all";
  return new Set([...a, ...b]);
}

// ── Invalidator ────────────────────────────────────────────────────────────────

/**
 * Create the coalescing scheduler.
 *
 * `schedule` receives the invalidator's flush callback and returns a cancel
 * (rAF shape). Rules, each pinned by a test:
 *   • N invalidations before a flush produce exactly ONE schedule call and ONE
 *     flush with ONE generation increment (R03-A01).
 *   • A flush with nothing pending returns null and does not bump the generation.
 *   • Generations are strictly increasing integers (0 before any paint, then 1, 2, …).
 *   • invalidate() while a flush holds the frame is queued for the NEXT frame —
 *     never merged into the generation that is already painting, never lost.
 *   • dispose() cancels an armed schedule; later invalidate/flush are no-ops.
 */
export function createInvalidator(schedule: (flush: () => void) => () => void): Invalidator {
  let generation = 0;
  let pendingMask: InvalidationMask | null = null;
  let scheduled = false;
  let cancel: (() => void) | null = null;
  let flushing = false;
  let deferredSchedule = false;
  let disposed = false;

  const disarm = (): void => {
    if (cancel) cancel();
    cancel = null;
    scheduled = false;
  };

  const arm = (): void => {
    if (scheduled || flushing || disposed) return;
    scheduled = true;
    cancel = schedule(flush);
  };

  const flush = (): FlushReport | null => {
    if (disposed || flushing) return null; // no re-entrant flush of one frame
    const mask = pendingMask;
    if (!mask) return null; // nothing pending: null, and the generation stands
    pendingMask = null;
    flushing = true;
    try {
      // Disarm INSIDE the frame window: the host's cancel is user code, and an
      // invalidation arriving from it (or from any paint hook a host runs around
      // this call) must land on the NEXT frame, never on this one.
      disarm(); // the armed frame is being consumed right now
      generation += 1;
      return { generation, mask };
    } finally {
      flushing = false;
      // An invalidate() that landed while this flush held the frame is armed for
      // the NEXT frame here — one paint per frame, no lost update.
      if (deferredSchedule) {
        deferredSchedule = false;
        arm();
      }
    }
  };

  const invalidate = (partial: Partial<InvalidationMask> & { level: InvalidationLevel }): void => {
    if (disposed) return;
    // "none" carries no render work at all (R03-A02: a live tick outside the
    // visible window must not even reach the scheduler).
    if (partial.level === "none") return;
    const next = maskFromPartial(partial);
    pendingMask = pendingMask ? mergeMasks(pendingMask, next) : next;
    if (flushing) {
      deferredSchedule = true; // next frame, never this one
      return;
    }
    arm();
  };

  return {
    invalidate,
    flush,
    generation: () => generation,
    pending: () => (pendingMask ? copyMask(pendingMask) : null),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      disarm();
      pendingMask = null;
    },
  };
}

// ── Autoscale targets ──────────────────────────────────────────────────────────

/** The pane topology autoscale actually consults (a local structural type — no
 *  sibling-lane import; the renderer fills it from its own model). */
export interface AutoscaleModel {
  panes: { index: number; autoscale: boolean }[];
}

/**
 * Pane indexes whose autoscale must re-run for `mask`:
 * (mask.autoscale ∪ (level === "full" ? every autoscale-enabled pane : ∅)),
 * filtered to panes the model actually reports as autoscale-enabled, deduped,
 * ascending. A "cursor" or "light" mask therefore only re-runs the panes someone
 * explicitly dirtied; "full" re-runs them all.
 */
export function autoscaleTargets(mask: InvalidationMask, model: AutoscaleModel): number[] {
  const autoPanes = new Set(model.panes.filter((p) => p.autoscale).map((p) => p.index));
  const targets = new Set<number>(mask.autoscale);
  if (mask.level === "full") {
    for (const index of autoPanes) targets.add(index);
  }
  return [...targets].filter((index) => autoPanes.has(index)).sort((a, b) => a - b);
}

// ── Feed-event → mask translation ──────────────────────────────────────────────

/** One data mutation as the data layer reports it. */
export interface DataChange {
  kind: "setData" | "update" | "whitespace" | "remove";
  paneIndex: number;
  priceScaleId: string;
  visibleAffected: boolean;
}

/**
 * The mask a data change costs, decided BEFORE scheduling:
 *   • setData            → full for that pane + the time scale (the whole slot
 *                          grid may have moved; geometry and layout recompute).
 *   • update, visible    → light + autoscale for the pane (cached geometry is
 *                          still valid; the last bar may have moved the domain).
 *   • update, off-screen → level "none" — nothing is scheduled at all, which is
 *                          what makes cheap live ticks cheap (R03-A02).
 *   • whitespace         → light for the pane when visible: a gap slot changes
 *                          pixels but no value, so neither autoscale nor the
 *                          price axis has work. Off-screen → "none".
 *   • remove             → full across every pane and scale: pane topology can
 *                          collapse, so nothing may be assumed cached.
 */
export function dataChangeMask(change: DataChange): InvalidationMask {
  switch (change.kind) {
    case "setData":
      return {
        level: "full",
        panes: new Set([change.paneIndex]),
        timeScale: true,
        priceScales: new Set([change.priceScaleId]),
        autoscale: new Set(),
      };
    case "update":
      if (!change.visibleAffected) return emptyMask();
      return {
        level: "light",
        panes: new Set([change.paneIndex]),
        timeScale: false,
        priceScales: new Set([change.priceScaleId]),
        autoscale: new Set([change.paneIndex]),
      };
    case "whitespace":
      if (!change.visibleAffected) return emptyMask();
      return {
        level: "light",
        panes: new Set([change.paneIndex]),
        timeScale: false,
        priceScales: new Set(),
        autoscale: new Set(),
      };
    case "remove":
      return { level: "full", panes: "all", timeScale: true, priceScales: "all", autoscale: new Set() };
  }
}

// ── Live-bar law ───────────────────────────────────────────────────────────────

/**
 * The mask for one live tick on the newest bar (R03-A03: one live bar → one
 * generation, never a series rebuild — this function structurally cannot emit
 * "full").
 *
 *   • In-place tick (same `time` as `prev`) → light: repaint cached geometry.
 *   • New bar appended (later `time`) while the right edge is visible →
 *     light + timeScale (the window shifts one slot; geometry stays cached).
 *     Appending while the right edge is OFF-screen is just light — the new bar
 *     lands outside the window, so nothing on screen moves.
 *   • `prev === null` is treated as a new bar (there is nothing to update in
 *     place). A backwards tick (earlier `time`) is a historical revision, never
 *     an append: light, no scale work.
 *
 * The right edge is visible when `visibleTo` (upper bound of the visible
 * logical range, shared TimeScaleState vocabulary) covers the current last bar
 * at index `rowCount - 1`. This function has no pane context, so `panes` is
 * "all" at light cost — one cached-geometry composite pass; the value-domain
 * half of a live tick (autoscale for a specific pane) is the caller's union of
 * dataChangeMask({kind: "update", visibleAffected: true, …}), which the
 * invalidator merges into the same single generation.
 */
export function liveTickMask(
  prev: { time: number } | null,
  next: { time: number },
  visibleTo: number,
  rowCount: number,
): InvalidationMask {
  const inPlace = prev !== null && next.time === prev.time;
  const appended = !inPlace && (prev === null || next.time > prev.time);
  const base: InvalidationMask = {
    level: "light",
    panes: "all",
    timeScale: false,
    priceScales: new Set(),
    autoscale: new Set(),
  };
  if (!appended) return base;
  // The appended bar will live at logical index `rowCount`; the window shifts
  // only when the CURRENT last bar (rowCount - 1) is at or inside the right edge.
  const rightEdgeVisible = visibleTo >= rowCount - 1;
  return { ...base, timeScale: rightEdgeVisible };
}
