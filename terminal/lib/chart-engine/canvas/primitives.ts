// Primitive host for the native Canvas2D renderer (chart-engine P3, lane R04).
//
// Owns the per-pane overlay registry the canvas renderer composites: attach/detach
// lifecycle, z-ordered paint passes ("bottom" under the series, "normal" over them,
// "top" over everything — the renderer interleaves its series between the bottom and
// normal passes by calling paintPane once per tier per frame), clipped axis-label
// views, top-most-first hit testing, and once-per-generation projection delivery with
// per-primitive error isolation. The host creates no DOM of its own: every
// CanvasRenderingContext2D is handed in by the renderer, which also owns the frame
// loop. This module must never import "lightweight-charts" (masterplan law 1).
//
// Host* types alias the engine-neutral primitive.ts vocabulary (F-10). EngineProjection
// is a superset of the original HostProjection (adds timeToX / xToTime); the canvas
// renderer must supply those from model.timeToCoordinate / model.coordinateToTime.

import type {
  EngineProjection,
  PrimitiveAttachContext,
  PrimitiveHit,
  PrimitiveZOrder,
} from "../primitive";

/** Fractional bar index into the primary series (shared canvas-lane vocabulary). */
export type LogicalIndex = number;

/** Z tiers, mirroring LWC's PrimitivePaneViewZOrder so an adapter maps 1:1. */
export type HostZOrder = PrimitiveZOrder;

/** Which axis strip an axis-view paint is targeting. */
export type HostAxisSide = "price" | "time";

/** A pixel rect in CSS (media) coordinates on the canvas being painted. */
export type HostRect = { x: number; y: number; width: number; height: number };

/** Per-frame projection delivered to every primitive (alias of EngineProjection). */
export type HostProjection = EngineProjection;

/** What a primitive reports when the pointer falls inside it. */
export interface HostHit {
  id: string;
  cursor?: string;
  zOrder?: string;
}

/**
 * Contract-shape primitive hit — returnable by a primitive so the host can ingest
 * a `hitTest()` from an `EnginePrimitive` (which uses `PrimitiveHit`) as well as
 * from a `HostPrimitive` (which historically used `HostHit`). PATCH3P2 F2 union
 * keeps both consumer paths compileable in one place.
 */
export type HostHitOrPrimitiveHit = HostHit | PrimitiveHit;

/**
 * Route a hit back to its primitive whichever shape answered: the host's legacy
 * `HostHit.id` or the contract's `PrimitiveHit.primitiveId` (primitive.ts:68-74).
 * Callers of `hitTest()` MUST use this instead of reading `.id`, which is undefined
 * on a contract-shaped hit (PAINT2-rev F2's routing hazard, still open at HEAD).
 */
export function hostHitId(hit: HostHitOrPrimitiveHit): string {
  return typeof (hit as HostHit).id === "string" ? (hit as HostHit).id : (hit as PrimitiveHit).primitiveId;
}

/** Context handed to attached(); `paneIndex` is read live through requestUpdate. */
export type HostAttachContext = PrimitiveAttachContext;

/** The engine-neutral primitive shape this host consumes. EnginePrimitive IS assignable:
 *  every contract member is accepted, and hitTest may answer either the host's legacy
 *  HostHit or the contract's PrimitiveHit (F2, PATCH3P2). */
export interface HostPrimitive {
  id: string;
  zOrder?: HostZOrder;
  attached?(ctx: HostAttachContext): void;
  detached?(): void;
  update?(proj: HostProjection): void;
  paint?(ctx: CanvasRenderingContext2D, proj: HostProjection): void;
  paintAxis?(ctx: CanvasRenderingContext2D, proj: HostProjection, axis: HostAxisSide): void;
  hitTest?(x: number, y: number): HostHitOrPrimitiveHit | null;
}

/** Optional renderer hooks; the only way the host reaches back outside its registry. */
export type PrimitiveHostHooks = {
  /** A primitive asked for a repaint of its (live) pane. */
  onRequestUpdate?: (paneIndex: number) => void;
};

/** Which host callback an error was isolated from. */
export type HostErrorPhase =
  | "attached"
  | "detached"
  | "update"
  | "paint"
  | "paintAxis"
  | "hitTest";

/** One isolated primitive failure. The host never throws to its caller (R04-A03). */
export interface HostError {
  primitiveId: string;
  phase: HostErrorPhase;
  /** Projection generation when the phase carries one, else null. */
  generation: number | null;
  message: string;
  error: unknown;
}

/** A hit-test match: the owning primitive plus the report its hitTest returned.
 *  Renamed from the local `PrimitiveHit` (F2, PATCH3P2) so it no longer collides
 *  with the contract's `PrimitiveHit` from `lib/chart-engine/primitive.ts`. */
export type HostHitMatch = { primitive: HostPrimitive; hit: HostHitOrPrimitiveHit };

/** Live-resource census (lifecycle law: after dispose() answers {alive:false, zeros}). */
export interface PrimitiveHostInventory {
  alive: boolean;
  primitives: number;
  /** Per-pane live counts, in ascending pane-index order. */
  byPane: number[];
}

/** The primitive host itself — see the module header for the ownership split. */
export interface PrimitiveHost {
  /** Register p as an overlay of seriesId in paneIndex. Calls p.attached once.
   *  Returns a disposer that detaches p (idempotent). Re-attaching a primitive
   *  object that is already live is ignored (one home per object). */
  attach(paneIndex: number, seriesId: string, p: HostPrimitive): () => void;
  /** Remove p and call p.detached exactly once; a second call is a no-op. */
  detach(p: HostPrimitive): void;
  /** This pane's primitives sorted bottom → normal → top, stable by attach order
   *  within a tier. A fresh array each call; mutating it cannot touch the registry. */
  forPane(paneIndex: number): readonly HostPrimitive[];
  /** Paint exactly one z tier (the renderer interleaves its series between tiers).
   *  A primitive without paint, or of another tier, is skipped. */
  paintPane(
    ctx: CanvasRenderingContext2D,
    paneIndex: number,
    proj: HostProjection,
    phase: HostZOrder,
  ): void;
  /** Paint every axis view of this pane for `axis`, clipped to `rect` via
   *  save/clip/restore so labels cannot bleed into the plot area. */
  paintAxis(
    ctx: CanvasRenderingContext2D,
    paneIndex: number,
    proj: HostProjection,
    axis: HostAxisSide,
    rect: HostRect,
  ): void;
  /** All hits at (x, y), TOP-most first: top tier before normal before bottom, and
   *  within a tier later-attached first (R04-A02). Empty when nothing hits. */
  hitTest(paneIndex: number, x: number, y: number): HostHitMatch[];
  /** Deliver one projection generation: update() runs at most once per primitive per
   *  generation (proj.generation <= that primitive's last delivered generation is a
   *  no-op — R04-A01). A throwing update is isolated and recorded (R04-A03). */
  deliver(proj: HostProjection): void;
  /** PATCH3P2 F11 — deliver one generation to exactly this pane's primitives (same
   *  once-per-generation + record-on-throw guards as `deliver`). The frame calls
   *  this once per pane instead of re-rolling a bare `try { p.update } catch {}`. */
  deliverPane(paneIndex: number, proj: HostProjection): void;
  /** Re-home every primitive attached via seriesId to toPane. */
  moveSeries(seriesId: string, toPane: number): void;
  /** Detach every primitive of seriesId, each with detached() exactly once. */
  removeSeries(seriesId: string): void;
  /** Rolling window of isolated failures (most recent kept; see MAX_RECORDED_ERRORS). */
  errors(): readonly HostError[];
  inventory(): PrimitiveHostInventory;
  /** Detach everything (detached exactly once each). Idempotent; the host is dead
   *  afterwards — attach becomes a no-op disposer and every other method is safe. */
  dispose(): void;
}

const TIER_RANK: Record<HostZOrder, number> = { bottom: 0, normal: 1, top: 2 };
const DEFAULT_Z: HostZOrder = "normal";

// Errors are diagnostics for the renderer to surface, not an unbounded log: a
// per-frame throw in a long-lived chart would otherwise grow the list forever.
// Keep the most recent window.
const MAX_RECORDED_ERRORS = 256;

interface Entry {
  primitive: HostPrimitive;
  paneIndex: number;
  seriesId: string;
  seq: number;
  /** Last generation this primitive's update() ran for; -Infinity = never. */
  lastGeneration: number;
}

/** Tier lookup that is defensive about a stray zOrder string (HostHit.zOrder is
 *  stringly, so a primitive echoing one back into zOrder must not break the sort). */
function tierOf(p: HostPrimitive): HostZOrder {
  const z = p.zOrder;
  return z === "bottom" || z === "normal" || z === "top" ? z : DEFAULT_Z;
}

export function createPrimitiveHost(hooks: PrimitiveHostHooks = {}): PrimitiveHost {
  const entries: Entry[] = [];
  const errorLog: HostError[] = [];
  let disposed = false;
  let nextSeq = 0;

  const record = (
    e: Entry,
    phase: HostErrorPhase,
    generation: number | null,
    error: unknown,
  ): void => {
    errorLog.push({
      primitiveId: e.primitive.id,
      phase,
      generation,
      message: error instanceof Error ? error.message : String(error),
      error,
    });
    if (errorLog.length > MAX_RECORDED_ERRORS) {
      errorLog.splice(0, errorLog.length - MAX_RECORDED_ERRORS);
    }
  };

  // Single place that enforces "detached() exactly once": the entry leaves the
  // registry first, so any later detach()/removeSeries()/dispose() path finds
  // nothing and cannot fire the callback a second time.
  const detachEntry = (e: Entry): void => {
    const at = entries.indexOf(e);
    if (at === -1) return;
    entries.splice(at, 1);
    if (e.primitive.detached) {
      try {
        e.primitive.detached();
      } catch (error) {
        record(e, "detached", null, error);
      }
    }
  };

  const detach = (p: HostPrimitive): void => {
    const e = entries.find((x) => x.primitive === p);
    if (e) detachEntry(e);
  };

  const sortedForPane = (paneIndex: number): Entry[] =>
    entries
      .filter((e) => e.paneIndex === paneIndex)
      .sort(
        (a, b) =>
          TIER_RANK[tierOf(a.primitive)] - TIER_RANK[tierOf(b.primitive)] || a.seq - b.seq,
      );

  // PATCH3P2 F11 — shared once-per-generation + record-on-throw delivery helper.
  // R04-A01: <= last delivered generation for THIS primitive is a no-op.
  // The negated > also makes a NaN generation a no-op instead of a retry loop.
  // Advance the guard BEFORE the call so a throw is not retried within the same generation.
  const deliverTo = (list: Entry[], proj: HostProjection): void => {
    for (const e of list) {
      if (!(proj.generation > e.lastGeneration)) continue;
      e.lastGeneration = proj.generation;
      if (!e.primitive.update) continue;
      try {
        e.primitive.update(proj);
      } catch (error) {
        record(e, "update", proj.generation, error);
      }
    }
  };

  const host: PrimitiveHost = {
    attach(paneIndex, seriesId, p) {
      if (disposed) return () => undefined;
      if (entries.some((e) => e.primitive === p)) return () => undefined;
      const entry: Entry = {
        primitive: p,
        paneIndex,
        seriesId,
        seq: nextSeq++,
        lastGeneration: -Infinity,
      };
      entries.push(entry);
      if (p.attached) {
        try {
          p.attached({
            paneIndex,
            seriesId,
            // Live pane read: after moveSeries the same closure reports the new pane.
            requestUpdate: () => hooks.onRequestUpdate?.(entry.paneIndex),
          });
        } catch (error) {
          record(entry, "attached", null, error);
        }
      }
      return () => detach(p);
    },

    detach,

    forPane(paneIndex) {
      return sortedForPane(paneIndex).map((e) => e.primitive);
    },

    paintPane(ctx, paneIndex, proj, phase) {
      for (const e of sortedForPane(paneIndex)) {
        if (tierOf(e.primitive) !== phase) continue;
        if (!e.primitive.paint) continue;
        try {
          e.primitive.paint(ctx, proj);
        } catch (error) {
          record(e, "paint", proj.generation, error);
        }
      }
    },

    paintAxis(ctx, paneIndex, proj, axis, rect) {
      ctx.save();
      try {
        ctx.beginPath();
        ctx.rect(rect.x, rect.y, rect.width, rect.height);
        ctx.clip();
        for (const e of sortedForPane(paneIndex)) {
          if (!e.primitive.paintAxis) continue;
          try {
            e.primitive.paintAxis(ctx, proj, axis);
          } catch (error) {
            record(e, "paintAxis", proj.generation, error);
          }
        }
      } finally {
        ctx.restore();
      }
    },

    hitTest(paneIndex, x, y) {
      const hits: HostHitMatch[] = [];
      const ordered = sortedForPane(paneIndex); // bottom → top
      for (let i = ordered.length - 1; i >= 0; i--) {
        const e = ordered[i]; // top-most first
        if (!e.primitive.hitTest) continue;
        let hit: HostHitOrPrimitiveHit | null = null;
        try {
          hit = e.primitive.hitTest(x, y);
        } catch (error) {
          record(e, "hitTest", null, error);
          continue;
        }
        if (hit) hits.push({ primitive: e.primitive, hit });
      }
      return hits;
    },

    deliver(proj) {
      // Slice: an update() that attaches another primitive must not also deliver
      // this same generation to it mid-iteration (it gets it on the next deliver).
      deliverTo(entries.slice(), proj);
    },

    deliverPane(paneIndex, proj) {
      // Same once-per-generation + record-on-throw guards, only this pane's entries.
      deliverTo(entries.slice().filter((e) => e.paneIndex === paneIndex), proj);
    },

    moveSeries(seriesId, toPane) {
      for (const e of entries) {
        if (e.seriesId === seriesId) e.paneIndex = toPane;
      }
    },

    removeSeries(seriesId) {
      for (const e of entries.filter((x) => x.seriesId === seriesId)) detachEntry(e);
    },

    errors() {
      return errorLog;
    },

    inventory() {
      if (disposed) return { alive: false, primitives: 0, byPane: [] };
      const panes = [...new Set(entries.map((e) => e.paneIndex))].sort((a, b) => a - b);
      const byPane = panes.map(
        (pane) => entries.filter((e) => e.paneIndex === pane).length,
      );
      return { alive: true, primitives: entries.length, byPane };
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      for (const e of entries.slice()) detachEntry(e);
    },
  };

  return host;
}
