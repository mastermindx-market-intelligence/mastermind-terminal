// Mastermind Chart Engine — engine-neutral primitive (overlay) lifecycle (P2, lane C03).
//
// Drawings and session shading must attach to ANY engine implementation (the lwc/
// adapter today, the canvas/ renderer in P3) without knowing which one hosts them.
// This module defines that engine-neutral vocabulary:
//
//   • EngineProjection — everything an overlay needs to map data to pixels: a
//     monotonic render generation, the device pixel ratio, the pane size, the
//     logical<->x and price<->y coordinate maps, and time<->x lookups.
//   • EnginePrimitive — the overlay itself: attached/detached lifecycle hooks,
//     update() when the projection changes, optional paint() (invoked by the
//     HOST's draw loop with a real 2D context — never by this helper), and an
//     optional hitTest() for pointer interactions.
//   • createPrimitiveLifecycle — the host-side helper an engine implementation
//     embeds. It gates attached() on readiness (C03-A01), delivers update() at
//     most once per projection generation and drops stale generations (C03-A02),
//     makes detach idempotent and post-detach silent (C03-A03), and batches
//     delivery so every primitive sees the same generation in the same flush with
//     no synchronous re-entry from requestUpdate() (C03-A04).
//
// Contract law 1 applies: like api.ts, this file must NOT import
// "lightweight-charts". The LWC-facing bridge (toLwcPrimitive) therefore lives
// in lwc/index.ts — the only module allowed to name LWC types — and hosts on
// the canvas renderer wire these primitives through createPrimitiveLifecycle.

import type { EngineTime } from "./api";

// ── Projection ─────────────────────────────────────────────────────────────────

/**
 * A ready-to-use pane coordinate map for one render pass. `generation` is the
 * source's monotonic render token (masterplan "render generation" — one of the
 * six time facts, never conflated with bar keys or event times): two calls with
 * the same generation describe identical geometry, and a projection whose
 * generation is lower than one already delivered is stale.
 *
 * Coordinate convention mirrors the shared vocabulary: x = centre of logical
 * index i, y grows downward, prices map through the pane's scale margins.
 * `timeToX`/`xToTime` answer null outside the projected domain.
 */
export interface EngineProjection {
  generation: number;
  dpr: number;
  widthPx: number;
  heightPx: number;
  xOfLogical(i: number): number;
  logicalOfX(x: number): number;
  yOfPrice(p: number): number;
  priceOfY(y: number): number;
  timeToX(t: EngineTime): number | null;
  xToTime(x: number): EngineTime | null;
}

/** Paint layers, thickest first. Mirrors the LWC PrimitivePaneViewZOrder union. */
export type PrimitiveZOrder = "bottom" | "normal" | "top";

/** Cursor hints a hit test may request from the host (structural, LWC-free). */
export type PrimitiveHitCursor =
  | "default"
  | "crosshair"
  | "pointer"
  | "grab"
  | "grabbing"
  | "ew-resize"
  | "ns-resize";

/** What hitTest() returns when a primitive owns the point (x, y). */
export type PrimitiveHit = {
  /** id of the hit primitive — the host routes the hit back by this handle. */
  readonly primitiveId: string;
  cursor?: PrimitiveHitCursor;
  /** Free-form consumer payload (e.g. which anchor/handle was grabbed). */
  data?: Record<string, unknown>;
};

/** Wiring context handed to attached(); the requestUpdate handle stays valid
 *  (as a no-op) after the primitive is detached or the lifecycle is disposed. */
export interface PrimitiveAttachContext {
  requestUpdate(): void;
  seriesId: string;
  paneIndex: number;
}

/**
 * An overlay that renders through an engine projection. The host calls
 * update(proj) from the lifecycle flush; paint() and hitTest() are called by
 * the host's own draw/pointer loops with the projection it holds.
 */
export interface EnginePrimitive {
  readonly id: string;
  zOrder?: PrimitiveZOrder;
  attached(ctx: PrimitiveAttachContext): void;
  detached(): void;
  update(proj: EngineProjection): void;
  paint?(ctx: CanvasRenderingContext2D, proj: EngineProjection): void;
  hitTest?(x: number, y: number): PrimitiveHit | null;
}

// ── Readiness ──────────────────────────────────────────────────────────────────

// Fixed probe pair for the price map. Real projections are affine over all
// reals (see axisZoom.ts), so a constant map on {0,1} proves degeneracy.
const PROBE_PRICE_A = 0;
const PROBE_PRICE_B = 1;

function priceMapNonDegenerate(proj: EngineProjection): boolean {
  const yA = proj.yOfPrice(PROBE_PRICE_A);
  const yB = proj.yOfPrice(PROBE_PRICE_B);
  if (Number.isFinite(yA) && Number.isFinite(yB) && yA !== yB) return true;
  // Robustness for a map that clamps outside its priced domain: re-probe with
  // prices derived from the projection's own inverse, which lie inside it.
  const pA = proj.priceOfY(proj.heightPx * 0.25);
  const pB = proj.priceOfY(proj.heightPx * 0.75);
  if (!Number.isFinite(pA) || !Number.isFinite(pB) || pA === pB) return false;
  const yA2 = proj.yOfPrice(pA);
  const yB2 = proj.yOfPrice(pB);
  return Number.isFinite(yA2) && Number.isFinite(yB2) && yA2 !== yB2;
}

/**
 * C03-A01 readiness: a projection is usable only when the pane has real extent
 * and the price<->coordinate map is a non-degenerate (injective) round trip —
 * the same contract paneDrawingScaleReady enforces on the LWC side. NaN width,
 * height, or coordinates all fail these checks (no `> 0` on NaN).
 */
export function projectionReady(proj: EngineProjection | null | undefined): boolean {
  if (proj == null) return false;
  if (!Number.isFinite(proj.widthPx) || proj.widthPx <= 0) return false;
  if (!Number.isFinite(proj.heightPx) || proj.heightPx <= 0) return false;
  return priceMapNonDegenerate(proj);
}

// ── Lifecycle helper ───────────────────────────────────────────────────────────

export interface PrimitiveLifecycleOptions {
  /** Host gate (data loaded, scale ready, …) on top of projection readiness. */
  isReady(): boolean;
  /** The source's current projection, or null before the first render. */
  currentProjection(): EngineProjection | null;
  /** Push channel for new projections; returns the unsubscribe function. */
  subscribeProjection(cb: (p: EngineProjection) => void): () => void;
  /** Identity reported to attached(); one lifecycle serves one series/pane. */
  seriesId?: string;
  paneIndex?: number;
}

export interface PrimitiveLifecycle {
  /**
   * Registers a primitive and returns its disposer (an idempotent detach).
   * Re-attaching a registered primitive is a no-op. Attaching once readiness
   * already holds fires attached() synchronously (LWC calls it inside
   * attachPrimitive); otherwise C03-A01 queues it for the first ready flush.
   * Attachments after dispose() are silent no-ops.
   */
  attach(primitive: EnginePrimitive): () => void;
  /** Detaches. Idempotent; unknown primitives are a silent no-op. */
  detach(primitive: EnginePrimitive): void;
  /** Registered primitives in delivery/paint order (zOrder, then insertion). */
  list(): readonly EnginePrimitive[];
  /**
   * Delivers the best available projection (newest of the pushed-since-last-
   * flush and currentProjection()) to every primitive that has not seen its
   * generation — one generation, one projection object, one flush (C03-A04).
   * Also the point where queued primitives finally receive attached() (A01).
   * Re-entrant calls (a primitive calling flush() from inside update()) return
   * immediately.
   */
  flush(): void;
  /** Detaches every attached primitive exactly once and releases the
   *  projection subscription. Idempotent; everything after is a no-op. */
  dispose(): void;
}

interface LifecycleEntry {
  primitive: EnginePrimitive;
  zOrder: PrimitiveZOrder;
  insertion: number;
  attachNotified: boolean;
  lastSeenGeneration: number | null;
}

const Z_ORDER_RANK: Record<PrimitiveZOrder, number> = { bottom: 0, normal: 1, top: 2 };

export function createPrimitiveLifecycle(opts: PrimitiveLifecycleOptions): PrimitiveLifecycle {
  const entries = new Map<EnginePrimitive, LifecycleEntry>();
  let insertionCounter = 0;
  let staged: EngineProjection | null = null; // newest pushed-but-unflushed
  let deliveredGeneration = Number.NaN;       // newest generation ever delivered
  let hasDelivered = false;
  let repaintRequested = false;               // coalescing flag; consumed by flush()
  let flushing = false;
  let disposed = false;

  const attachContext: PrimitiveAttachContext = {
    seriesId: opts.seriesId ?? "",
    paneIndex: opts.paneIndex ?? 0,
    requestUpdate: () => {
      // C03-A04: record only. Never deliver or flush from here — a primitive
      // calling requestUpdate() from inside update() must not re-enter. The
      // next flush() re-reads currentProjection(), so N requests between
      // flushes coalesce into at most one delivery.
      if (!disposed) repaintRequested = true;
    },
  };

  const unsubscribe = opts.subscribeProjection((p) => {
    if (disposed || p == null || !Number.isFinite(p.generation)) return;
    // An out-of-order push never displaces a newer staged projection.
    if (staged == null || p.generation > staged.generation) staged = p;
  });

  const orderedEntries = (): LifecycleEntry[] =>
    [...entries.values()].sort(
      (a, b) => Z_ORDER_RANK[a.zOrder] - Z_ORDER_RANK[b.zOrder] || a.insertion - b.insertion,
    );

  const notifyAttached = (entry: LifecycleEntry): void => {
    entry.attachNotified = true;
    entry.primitive.attached(attachContext);
  };

  const detachImpl = (primitive: EnginePrimitive): void => {
    const entry = entries.get(primitive);
    if (entry == null) return; // unknown / already detached: no-op, never throws
    entries.delete(primitive);
    // C03-A03: exactly once — the entry is gone, so a second detach finds
    // nothing. detached() fires only if attached() did (a queued primitive
    // that was never wired has nothing to unwind).
    if (entry.attachNotified) entry.primitive.detached();
  };

  const flush = (): void => {
    if (disposed || flushing) return; // no synchronous re-entry (C03-A04)
    flushing = true;
    try {
      const pulled = opts.currentProjection();
      let candidate = staged;
      staged = null; // considered below, stale or not
      if (pulled != null && (candidate == null || pulled.generation > candidate.generation)) {
        candidate = pulled;
      }
      if (repaintRequested) repaintRequested = false;
      if (candidate == null || !Number.isFinite(candidate.generation)) return;
      if (!opts.isReady() || !projectionReady(candidate)) return; // C03-A01
      // C03-A02: stale guard. Strictly older than anything ever delivered is
      // dropped outright; equal is the late-attacher catch-up path below.
      if (hasDelivered && candidate.generation < deliveredGeneration) return;

      // Snapshot with live membership re-checks: a primitive detached by an
      // earlier callback in this same flush must not be notified (C03-A03).
      const snapshot = orderedEntries();

      // Phase 1 — finish wiring primitives queued before readiness (C03-A01).
      for (const entry of snapshot) {
        if (!entries.has(entry.primitive)) continue;
        if (!entry.attachNotified) notifyAttached(entry);
      }

      // Advance the watermark BEFORE delivering: if a primitive's update()
      // throws, this generation is never re-delivered to anyone (at-most-once
      // per generation, C03-A02).
      if (!hasDelivered || candidate.generation > deliveredGeneration) {
        deliveredGeneration = candidate.generation;
        hasDelivered = true;
      }

      // Phase 2 — one generation, one object, every eligible primitive (C03-A04).
      for (const entry of snapshot) {
        if (!entries.has(entry.primitive)) continue;
        const seen = entry.lastSeenGeneration;
        if (seen != null && candidate.generation <= seen) continue;
        entry.lastSeenGeneration = candidate.generation;
        entry.primitive.update(candidate);
      }
    } finally {
      flushing = false;
    }
  };

  const attach = (primitive: EnginePrimitive): (() => void) => {
    const disposer = () => detachImpl(primitive);
    if (disposed || primitive == null || entries.has(primitive)) return disposer;
    entries.set(primitive, {
      primitive,
      zOrder: primitive.zOrder ?? "normal",
      insertion: ++insertionCounter,
      attachNotified: false,
      lastSeenGeneration: null,
    });
    const current = opts.currentProjection();
    if (opts.isReady() && projectionReady(current)) notifyAttached(entries.get(primitive)!);
    return disposer;
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    try {
      unsubscribe();
    } catch {
      // The host's subscription is already gone; nothing left to release.
    }
    const snapshot = [...entries.values()];
    entries.clear();
    for (const entry of snapshot) {
      if (entry.attachNotified) entry.primitive.detached();
    }
  };

  return {
    attach,
    detach: detachImpl,
    list: () => orderedEntries().map((entry) => entry.primitive),
    flush,
    dispose,
  };
}

// ── LWC bridge ─────────────────────────────────────────────────────────────────
//
// toLwcPrimitive — the ISeriesPrimitive<Time> wrapper that drives an EnginePrimitive
// through lightweight-charts' plugin lifecycle — lives in lwc/index.ts, because this
// file may not name LWC types (contract law 1). Its behaviour is tested in
// lib/__tests__/chartEngineLwcPrimitive.test.ts.
