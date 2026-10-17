// Mastermind Chart Engine — drawing bridge (D01).
//
// The bridge between the drawing engine (lib/drawing-engine, lib/drawings.ts) and
// the renderer-agnostic chart-engine contract (./api.ts). Drawing anchors are
// PANE-SCOPED — an anchor stores { paneIndex, time|logical, price } and resolves
// only against its own pane's price scale, because sibling panes autoscale
// independently and the same price lands on different pixels in each. Gestures
// travel in RAW pixels (no snapping unless the tool asks) and clamp in PIXELS at
// the pane rect, never in price/time. No anchor resolves before its pane's
// price<->coordinate round trip is non-degenerate (the readiness gate), and
// anchors past the last bar resolve through futureTime cadence slots instead of
// collapsing onto the live edge.
//
// No LWC here: everything goes through ChartEngine/SeriesHandle/TimeScaleHandle
// plus the local Projection shape, so the bridge works unchanged over the P3
// canvas renderer. Structural type mirrors live in INTEGRATION_NOTES (RESULT.md).

import type {
  ChartEngine,
  EngineLogicalRangeHandler,
  EngineTime,
  SeriesHandle,
} from "./api";
import { FUTURE_ANCHOR_BARS, futureSlotOf } from "./futureTime";
import type { FutureCadence } from "./futureTime";
import type { EngineProjection } from "./primitive";

/** A drawing anchor: data-space position scoped to one pane's price scale. */
export type DrawingAnchor = {
  paneIndex: number;
  // Exact bar time when the anchor sits on an addressable slot; null while it
  // holds a fractional/raw position (or one no known slot addresses). A non-null
  // time is the durable x address — it survives logical-index shifts.
  time: EngineTime | null;
  // Fractional bar index in the shared time scale (0 = first row of the primary
  // series). Carries the fraction for raw gestures; integer after a snap.
  logical: number;
  price: number;
  // Set when the anchor lives past the last real bar: slot 0 is the first bar
  // after the newest candle (futureTime cadence grid).
  future?: { slot: number };
};

export type PixelPoint = { x: number; y: number };
export type ClampedPixelPoint = PixelPoint & { clamped: boolean };

/**
 * Pane overlay projection: EngineProjection without time<->x lookups.
 * `generation` advances on every visible-logical-range change.
 */
export type DrawingProjection = Omit<EngineProjection, "timeToX" | "xToTime">;

export type DrawingBridgeOptions = {
  // The series whose price scale defines a pane's y projection (one per pane).
  primaryByPane(paneIndex: number): SeriesHandle | null;
  // The pane's future-time cadence (futureTime.futureCadence of its bars).
  cadence(): FutureCadence | null;
  // The newest real bar's time, or null when no data is loaded.
  lastBarTime(): EngineTime | null;
  // Injectable retry clock (default setTimeout). Returning a cancel function is
  // mandatory so dispose()/unsubscribe can stop pending retries. rAF-free by
  // design: no renderer frame dependency, and jsdom/tests stay deterministic.
  scheduler?(run: () => void): () => void;
};

export type DrawingBridge = {
  ready(paneIndex: number): boolean;
  anchorToPixel(anchor: DrawingAnchor): PixelPoint | null;
  // Y-only projection: pane-local y for a price, with no time-axis dependency.
  priceToY(paneIndex: number, price: number): number | null;
  pixelToAnchor(
    paneIndex: number,
    x: number,
    y: number,
    mode: "raw" | "snapBar",
  ): DrawingAnchor | null;
  clampToPane(paneIndex: number, x: number, y: number): ClampedPixelPoint;
  translateAnchor(anchor: DrawingAnchor, dxPx: number, dyPx: number): DrawingAnchor | null;
  subscribeReadiness(paneIndex: number, onReady: () => void): () => void;
  dispose(): void;
};

const DAY_MS = 86_400_000;
// A collapsed/empty scale answers the public projections with null or one
// constant; the gate rejects that long before pixel drift matters.
const ROUND_TRIP_TOLERANCE_PX = 1e-6;
const DEFAULT_RETRY_MS = 50;
const MAX_READINESS_RETRIES = 40;

/** Run a renderer call that may throw on a removed/rebuilt resource. */
function attempt<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/** futureTime's slot math speaks string|number; BusinessDay becomes an ISO key. */
function timeKey(time: EngineTime): string | number | null {
  if (typeof time === "number" || typeof time === "string") return time;
  const { year, month, day } = time;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Create the drawing bridge over a live engine. The returned object owns one
 * logical-range subscription at most (lazily, while readiness watchers exist)
 * and releases it exactly once on dispose(); dispose() is idempotent.
 */
export function createDrawingBridge(
  engine: ChartEngine,
  opts: DrawingBridgeOptions,
): DrawingBridge {
  const scheduler = opts.scheduler ?? ((run: () => void) => {
    const id = setTimeout(run, DEFAULT_RETRY_MS);
    return () => clearTimeout(id);
  });

  let generation = 0;
  let disposed = false;

  type Watcher = {
    paneIndex: number;
    onReady: () => void;
    attempts: number;
    cancelled: boolean;
    cancelRetry: (() => void) | null;
  };
  const watchers = new Set<Watcher>();
  let rangeHandler: EngineLogicalRangeHandler | null = null;

  // ── projection ──────────────────────────────────────────────────────────────

  function projectionFor(paneIndex: number): DrawingProjection | null {
    const series = opts.primaryByPane(paneIndex);
    if (!series) return null;
    const size = attempt(() => engine.paneSize(paneIndex), null);
    if (!size || !(size.width > 0) || !(size.height > 0)) return null;
    const range = attempt(() => engine.timeScale().getVisibleLogicalRange(), null);
    if (!range || !Number.isFinite(range.from) || !Number.isFinite(range.to)
      || !(range.to > range.from)) return null;
    // Mirrors the LWC convention: bar i is centred at (i - from + 0.5) * spacing.
    const barSpacing = size.width / (range.to - range.from);
    if (!(barSpacing > 0)) return null;
    return {
      generation,
      dpr: 1, // the contract speaks CSS pixels
      widthPx: size.width,
      heightPx: size.height,
      xOfLogical: (i: number) => (i - range.from + 0.5) * barSpacing,
      logicalOfX: (x: number) => x / barSpacing + range.from - 0.5,
      yOfPrice: (p: number) => {
        const y = attempt(() => series.priceToCoordinate(p), null);
        return y != null && Number.isFinite(y) ? y : Number.NaN;
      },
      priceOfY: (y: number) => {
        const price = attempt(() => series.coordinateToPrice(y), null);
        return price != null && Number.isFinite(price) ? price : Number.NaN;
      },
    };
  }

  /**
   * The readiness gate: probe the pane's price<->coordinate round trip through
   * two interior pixels and demand finite, distinct, stable results. Mirrors
   * lib/drawingPaneReadiness.ts paneDrawingScaleReady, reworked for a contract
   * whose price-scale handle exposes no visible range: the pane rect supplies
   * the probe points instead.
   */
  function priceRoundTripHealthy(projection: DrawingProjection): boolean {
    const yA = projection.heightPx * 0.25;
    const yB = projection.heightPx * 0.75;
    const priceA = projection.priceOfY(yA);
    const priceB = projection.priceOfY(yB);
    if (!Number.isFinite(priceA) || !Number.isFinite(priceB) || priceA === priceB) return false;
    const roundA = projection.yOfPrice(priceA);
    const roundB = projection.yOfPrice(priceB);
    if (!Number.isFinite(roundA) || !Number.isFinite(roundB) || roundA === roundB) return false;
    return Math.abs(roundA - yA) <= ROUND_TRIP_TOLERANCE_PX
      && Math.abs(roundB - yB) <= ROUND_TRIP_TOLERANCE_PX;
  }

  function ready(paneIndex: number): boolean {
    return attempt(() => {
      const projection = projectionFor(paneIndex);
      return projection != null && priceRoundTripHealthy(projection);
    }, false);
  }

  // ── x resolution ────────────────────────────────────────────────────────────

  function lastBarLogical(projection: DrawingProjection): number | null {
    const last = opts.lastBarTime();
    if (last == null) return null;
    const x = attempt(() => engine.timeScale().timeToCoordinate(last), null);
    if (x == null || !Number.isFinite(x)) return null;
    const logical = projection.logicalOfX(x);
    return Number.isFinite(logical) ? logical : null;
  }

  /**
   * Future slot for a stored anchor. The STORED slot wins: it is the grid
   * position recorded when the anchor was minted against this grid, so it
   * round-trips exactly. The cadence derivation (futureSlotOf) is the fallback
   * for an anchor that carries only a time — futureTime measures it in calendar
   * steps, which on a weekend-skipping daily grid is knowingly approximate
   * (its job there is keeping the anchor future, not exact).
   */
  function futureSlotOfAnchor(anchor: DrawingAnchor): number | null {
    const stored = anchor.future?.slot;
    if (typeof stored === "number" && Number.isFinite(stored)
      && stored >= 0 && stored < FUTURE_ANCHOR_BARS) {
      return Math.round(stored);
    }
    const key = anchor.time != null ? timeKey(anchor.time) : null;
    if (key != null) {
      const slot = futureSlotOf(opts.cadence(), key, FUTURE_ANCHOR_BARS);
      if (slot >= 0) return slot;
    }
    return null;
  }

  /** Does this time sit past the last real bar (inside the cadence window)? */
  function isFutureTime(time: EngineTime): boolean {
    const key = timeKey(time);
    if (key == null) return false;
    return futureSlotOf(opts.cadence(), key, FUTURE_ANCHOR_BARS) >= 0;
  }

  /**
   * Future slots continue the bar cadence contiguously, so slot k sits at
   * lastBarLogical + k + 1 on the shared time scale (exactly where the future
   * whitespace tail ChartPanel feeds would place it).
   */
  function logicalOfFutureSlot(slot: number, projection: DrawingProjection): number | null {
    const base = lastBarLogical(projection);
    return base == null ? null : base + slot + 1;
  }

  /**
   * The synthetic time a future slot stands for, mirroring futureBarTimes's grid
   * (numeric grids advance by the measured step; 1-day grids skip weekends, any
   * coarser cadence already absorbs them inside a bar) so the slot the bridge
   * mints matches the slot the caller's whitespace tail will label.
   */
  function futureSlotTime(cadence: FutureCadence, slot: number): string | number | null {
    const last = opts.lastBarTime();
    if (typeof last === "number") {
      const stepSeconds = Math.round(cadence.stepMs / 1000);
      if (stepSeconds <= 0) return null;
      return Math.round(cadence.lastMs / 1000) + stepSeconds * (slot + 1);
    }
    const stepDays = Math.max(1, Math.round(cadence.stepMs / DAY_MS));
    let cursor = cadence.lastMs;
    for (let i = 0; i <= slot; i++) {
      cursor += stepDays * DAY_MS;
      if (stepDays === 1) {
        const day = new Date(cursor).getUTCDay();
        if (day === 0) cursor += DAY_MS;          // Sunday → Monday
        else if (day === 6) cursor += 2 * DAY_MS; // Saturday → Monday
      }
    }
    return new Date(cursor).toISOString().slice(0, 10);
  }

  /** Slot for a pixel position past the live edge, or null when it is not future. */
  function futureSlotFromLogical(
    logical: number,
    projection: DrawingProjection,
  ): number | null {
    if (!opts.cadence()) return null;
    const base = lastBarLogical(projection);
    if (base == null) return null;
    const slot = Math.round(logical - base) - 1;
    return slot >= 0 && slot < FUTURE_ANCHOR_BARS ? slot : null;
  }

  function resolveX(anchor: DrawingAnchor, projection: DrawingProjection): number | null {
    // 1. An exact bar time is the durable address; it survives logical shifts.
    if (anchor.time != null) {
      const time = anchor.time; // hoisted: property narrowing does not cross closures
      const x = attempt(() => engine.timeScale().timeToCoordinate(time), null);
      if (x != null && Number.isFinite(x)) return x;
      // 2. A future time the scale cannot address: fall back to the stored slot
      //    (exact grid position at mint) and only then to a cadence derivation.
      const slot = futureSlotOfAnchor(anchor);
      if (slot != null) {
        const logical = logicalOfFutureSlot(slot, projection);
        if (logical != null) return projection.xOfLogical(logical);
      }
    }
    // 3. Raw positions (and future anchors holding only a stored slot) carry x
    //    in the fractional logical index.
    if (Number.isFinite(anchor.logical)) return projection.xOfLogical(anchor.logical);
    return null;
  }

  // ── public surface ──────────────────────────────────────────────────────────

  function anchorToPixel(anchor: DrawingAnchor): PixelPoint | null {
    const projection = projectionFor(anchor.paneIndex);
    if (!projection || !priceRoundTripHealthy(projection)) return null;
    if (!Number.isFinite(anchor.price)) return null;
    const y = projection.yOfPrice(anchor.price);
    if (!Number.isFinite(y)) return null;
    const x = resolveX(anchor, projection);
    if (x == null || !Number.isFinite(x)) return null;
    return { x, y };
  }

  /**
   * Price -> pane-local y on one pane's own price scale, and nothing else. A y
   * question (a horizontal level, the vertical leg of a shape, a preview handle)
   * depends only on the price scale, so it is NOT gated on the full anchor
   * projection: the visible logical range, the round-trip probe and x resolution
   * all belong to the time axis, and while the time scale is transiently
   * unmeasured they would drop that geometry for the pass. That gate is the
   * pre-migration contract's parity: ChartPanel asked series.priceToCoordinate
   * directly and drew whenever it answered a finite number. Null when the pane
   * has no primary series, the series throws (removed/rebuilt), or the scale
   * answers a non-finite coordinate.
   */
  function priceToY(paneIndex: number, price: number): number | null {
    if (!Number.isFinite(price)) return null;
    const series = attempt(() => opts.primaryByPane(paneIndex), null);
    if (!series) return null;
    const y = attempt(() => series.priceToCoordinate(price), null);
    return y != null && Number.isFinite(y) ? y : null;
  }

  function pixelToAnchor(
    paneIndex: number,
    x: number,
    y: number,
    mode: "raw" | "snapBar",
  ): DrawingAnchor | null {
    const projection = projectionFor(paneIndex);
    if (!projection || !priceRoundTripHealthy(projection)) return null;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const price = projection.priceOfY(y);
    if (!Number.isFinite(price)) return null;
    const rawLogical = projection.logicalOfX(x);
    if (!Number.isFinite(rawLogical)) return null;
    const logical = mode === "snapBar" ? Math.round(rawLogical) : rawLogical;

    const scaleTime = attempt(() => engine.timeScale().coordinateToTime(x), null);
    // A fed future whitespace tail makes the scale itself answer with a future
    // slot time; recognise it so the anchor keeps its future identity. The SLOT
    // number always comes from the logical geometry (exact grid position) —
    // futureSlotOf classifies, it does not locate, because its calendar-step
    // measure diverges from grid indexes on weekend-skipping daily grids.
    const scaleTimeIsFuture = scaleTime != null && isFutureTime(scaleTime);

    let time: EngineTime | null = null;
    let future: { slot: number } | undefined;
    if (scaleTimeIsFuture) {
      const slot = futureSlotFromLogical(logical, projection);
      if (slot != null) future = { slot };
      if (mode === "snapBar") time = scaleTime;
    } else if (mode === "snapBar" && scaleTime != null) {
      time = scaleTime;
    } else {
      // Raw gestures keep no bar time (a fractional x has none), and past the
      // live edge the scale answers null: derive the slot from the cadence.
      const slot = futureSlotFromLogical(logical, projection);
      if (slot != null) {
        future = { slot };
        if (mode === "snapBar") {
          const cadence = opts.cadence();
          const slotTime = cadence != null ? futureSlotTime(cadence, slot) : null;
          if (slotTime != null) time = slotTime;
        }
      }
    }
    return { paneIndex, time, logical, price, ...(future ? { future } : {}) };
  }

  function translateAnchor(
    anchor: DrawingAnchor,
    dxPx: number,
    dyPx: number,
  ): DrawingAnchor | null {
    const origin = anchorToPixel(anchor);
    if (!origin) return null;
    // Raw travel: move in pixel space, then re-resolve data space. No snap, no
    // price/time arithmetic — the pane's own projections carry the conversion.
    return pixelToAnchor(anchor.paneIndex, origin.x + dxPx, origin.y + dyPx, "raw");
  }

  function clampToPane(paneIndex: number, x: number, y: number): ClampedPixelPoint {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return { x, y, clamped: false };
    const size = attempt(() => engine.paneSize(paneIndex), null);
    if (!size || !(size.width > 0) || !(size.height > 0)) return { x, y, clamped: false };
    // The last valid pixel column/row (lib/chart-engine/axisZoom.ts precedent).
    const clampedX = Math.max(0, Math.min(size.width - 1, x));
    const clampedY = Math.max(0, Math.min(size.height - 1, y));
    return { x: clampedX, y: clampedY, clamped: clampedX !== x || clampedY !== y };
  }

  // ── readiness watching ──────────────────────────────────────────────────────

  function ensureRangeSubscription(): void {
    if (disposed || rangeHandler != null) return;
    const handler: EngineLogicalRangeHandler = () => {
      generation += 1;
      pollWatchers(true);
    };
    rangeHandler = handler;
    attempt(() => engine.timeScale().subscribeVisibleLogicalRangeChange(handler), undefined);
  }

  function releaseRangeSubscriptionIfIdle(): void {
    const handler = rangeHandler;
    if (handler == null || watchers.size > 0) return;
    attempt(() => engine.timeScale().unsubscribeVisibleLogicalRangeChange(handler), undefined);
    rangeHandler = null;
  }

  function pollWatchers(fromRangeChange: boolean): void {
    for (const watcher of [...watchers]) {
      if (watcher.cancelled) continue;
      if (fromRangeChange) watcher.attempts = 0; // fresh activity re-arms the retry budget
      if (ready(watcher.paneIndex)) {
        retireWatcher(watcher);
        watcher.onReady();
        continue;
      }
      scheduleRetry(watcher);
    }
  }

  function scheduleRetry(watcher: Watcher): void {
    if (disposed || watcher.cancelled || watcher.cancelRetry != null) return;
    if (watcher.attempts >= MAX_READINESS_RETRIES) return; // bounded: no endless polling
    watcher.attempts += 1;
    watcher.cancelRetry = scheduler(() => {
      watcher.cancelRetry = null;
      if (disposed || watcher.cancelled || !watchers.has(watcher)) return;
      if (ready(watcher.paneIndex)) {
        retireWatcher(watcher);
        watcher.onReady();
        return;
      }
      scheduleRetry(watcher);
    });
  }

  function retireWatcher(watcher: Watcher): void {
    watcher.cancelled = true;
    if (watcher.cancelRetry != null) {
      watcher.cancelRetry();
      watcher.cancelRetry = null;
    }
    watchers.delete(watcher);
    releaseRangeSubscriptionIfIdle();
  }

  function subscribeReadiness(paneIndex: number, onReady: () => void): () => void {
    if (disposed) return () => {};
    if (ready(paneIndex)) {
      onReady();
      return () => {};
    }
    const watcher: Watcher = { paneIndex, onReady, attempts: 0, cancelled: false, cancelRetry: null };
    watchers.add(watcher);
    ensureRangeSubscription();
    scheduleRetry(watcher);
    return () => retireWatcher(watcher);
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    for (const watcher of watchers) {
      watcher.cancelled = true;
      if (watcher.cancelRetry != null) {
        watcher.cancelRetry();
        watcher.cancelRetry = null;
      }
    }
    watchers.clear();
    if (rangeHandler != null) {
      const handler = rangeHandler;
      attempt(() => engine.timeScale().unsubscribeVisibleLogicalRangeChange(handler), undefined);
      rangeHandler = null;
    }
  }

  return {
    ready,
    anchorToPixel,
    priceToY,
    pixelToAnchor,
    clampToPane,
    translateAnchor,
    subscribeReadiness,
    dispose,
  };
}
