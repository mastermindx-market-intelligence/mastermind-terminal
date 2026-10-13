import { describe, expect, it, vi } from "vitest";
import {
  createPrimitiveLifecycle,
  projectionReady,
  toLwcPrimitive,
  type EnginePrimitive,
  type EngineProjection,
  type PrimitiveAttachContext,
  type PrimitiveZOrder,
} from "../chart-engine/primitive";

// ─────────────────────────────────────────────────────────────────────────────
// Contract tests for the engine-neutral primitive lifecycle (C03): readiness
// (A01), generation guard (A02), idempotent detach (A03), single-generation
// flush with no re-entrancy (A04), zOrder-ordered list(), and dispose().
//
// No DOM is needed: the lifecycle is pure host-side state machine logic. The
// projection source is a fake with manual generation bumps; the primitives are
// spies. Falsifiers (one deliberate mutant per law, RED then restored GREEN)
// are recorded in this lane's RESULT.md EVIDENCE section.
// ─────────────────────────────────────────────────────────────────────────────

// ── Fakes ─────────────────────────────────────────────────────────────────────

type Degenerate = "width" | "height" | "flatY";

function makeProjection(generation: number, degenerate?: Degenerate): EngineProjection {
  const flat = degenerate === "flatY";
  return {
    generation,
    dpr: 2,
    widthPx: degenerate === "width" ? 0 : 600,
    heightPx: degenerate === "height" ? 0 : 400,
    xOfLogical: (i: number) => (i + 0.5) * 10,
    logicalOfX: (x: number) => x / 10 - 0.5,
    yOfPrice: flat ? () => 123 : (p: number) => 200 - p * 5,
    priceOfY: flat ? () => 42 : (y: number) => (200 - y) / 5,
    timeToX: (t) => (typeof t === "number" ? (t + 0.5) * 10 : null),
    xToTime: (x: number) => {
      const i = x / 10 - 0.5;
      return i >= 0 ? i : null;
    },
  };
}

interface EmitOptions {
  generation?: number;
  degenerate?: Degenerate;
}

/** Fake projection source: manual generation bumps, push subscribers, readiness flag. */
function fakeProjectionSource(initiallyReady = false) {
  let counter = 0;
  let current: EngineProjection | null = null;
  let ready = initiallyReady;
  const subscribers = new Set<(p: EngineProjection) => void>();
  return {
    isReady: () => ready,
    currentProjection: () => current,
    subscribeProjection: (cb: (p: EngineProjection) => void) => {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },
    setReady: (value: boolean) => {
      ready = value;
    },
    emit: (options: EmitOptions = {}) => {
      const gen = options.generation ?? (counter += 1);
      current = makeProjection(gen, options.degenerate);
      for (const cb of [...subscribers]) cb(current);
      return current;
    },
    subscriberCount: () => subscribers.size,
  };
}

interface SpyPrimitive {
  primitive: EnginePrimitive;
  contexts: PrimitiveAttachContext[];
  updates: EngineProjection[];
  detached: ReturnType<typeof vi.fn>;
}

function spyPrimitive(
  id: string,
  zOrder?: PrimitiveZOrder,
  onUpdate?: (proj: EngineProjection) => void,
): SpyPrimitive {
  const contexts: PrimitiveAttachContext[] = [];
  const updates: EngineProjection[] = [];
  const detached = vi.fn();
  const primitive: EnginePrimitive = {
    id,
    ...(zOrder == null ? {} : { zOrder }),
    attached: (ctx: PrimitiveAttachContext) => {
      contexts.push(ctx);
    },
    detached,
    update: (proj: EngineProjection) => {
      updates.push(proj);
      onUpdate?.(proj);
    },
  };
  return { primitive, contexts, updates, detached };
}

// ── C03-A01 readiness ─────────────────────────────────────────────────────────

describe("C03-A01 readiness: attached() fires only on a ready projection", () => {
  it("queues a primitive attached before readiness and fires on the first ready projection", () => {
    const source = fakeProjectionSource(false);
    const lifecycle = createPrimitiveLifecycle(source);
    const spy = spyPrimitive("shade");
    lifecycle.attach(spy.primitive);

    expect(spy.contexts).toHaveLength(0);
    source.emit({ degenerate: "flatY" }); // a projection arrived, but degenerate
    lifecycle.flush();
    expect(spy.contexts).toHaveLength(0);
    expect(spy.updates).toHaveLength(0);

    source.setReady(true);
    source.emit();
    lifecycle.flush();
    expect(spy.contexts).toHaveLength(1);
    expect(spy.updates.map((p) => p.generation)).toEqual([2]);
    lifecycle.dispose();
  });

  it("keeps a host-gated source queued even with a non-degenerate projection", () => {
    const source = fakeProjectionSource(false);
    const lifecycle = createPrimitiveLifecycle(source);
    const spy = spyPrimitive("draw");
    lifecycle.attach(spy.primitive);

    source.emit(); // geometry is fine, isReady() is not
    lifecycle.flush();
    expect(spy.contexts).toHaveLength(0);
    expect(spy.updates).toHaveLength(0);

    source.setReady(true);
    lifecycle.flush(); // the still-current generation becomes deliverable
    expect(spy.contexts).toHaveLength(1);
    expect(spy.updates.map((p) => p.generation)).toEqual([1]);
    lifecycle.dispose();
  });

  it("fires attached() synchronously when attaching after readiness, delivering the projection on the next flush", () => {
    const source = fakeProjectionSource(true);
    source.emit();
    const lifecycle = createPrimitiveLifecycle(source);
    const spy = spyPrimitive("late");
    lifecycle.attach(spy.primitive);
    expect(spy.contexts).toHaveLength(1); // immediate, like LWC's attachPrimitive
    expect(spy.updates).toHaveLength(0);
    lifecycle.flush();
    expect(spy.updates.map((p) => p.generation)).toEqual([1]);
    lifecycle.dispose();
  });

  it.each(["width", "height", "flatY"] as const)(
    "never attaches or updates on a degenerate projection (%s)",
    (degenerate) => {
      const source = fakeProjectionSource(true);
      const lifecycle = createPrimitiveLifecycle(source);
      const spy = spyPrimitive("degenerate");
      lifecycle.attach(spy.primitive);
      source.emit({ degenerate });
      lifecycle.flush();
      expect(spy.contexts).toHaveLength(0);
      expect(spy.updates).toHaveLength(0);
      lifecycle.dispose();
    },
  );

  it("calls attached() exactly once across many ready projections", () => {
    const source = fakeProjectionSource(true);
    const lifecycle = createPrimitiveLifecycle(source);
    const spy = spyPrimitive("once");
    lifecycle.attach(spy.primitive);
    for (let i = 0; i < 3; i += 1) {
      source.emit();
      lifecycle.flush();
    }
    expect(spy.contexts).toHaveLength(1);
    expect(spy.updates.map((p) => p.generation)).toEqual([1, 2, 3]);
    lifecycle.dispose();
  });

  it("projectionReady() rejects null and non-finite geometry directly", () => {
    expect(projectionReady(null)).toBe(false);
    expect(projectionReady({ ...makeProjection(1), widthPx: Number.NaN })).toBe(false);
    expect(projectionReady({ ...makeProjection(1), heightPx: Number.POSITIVE_INFINITY })).toBe(false);
    expect(projectionReady(makeProjection(1, "width"))).toBe(false);
    expect(projectionReady(makeProjection(1, "height"))).toBe(false);
    expect(projectionReady(makeProjection(1, "flatY"))).toBe(false);
    expect(projectionReady(makeProjection(1))).toBe(true);
  });
});

// ── C03-A02 generation guard ──────────────────────────────────────────────────

describe("C03-A02 generation guard: at most one update per generation, stale dropped", () => {
  it("delivers each generation at most once — repeat flushes without a new projection are inert", () => {
    const source = fakeProjectionSource(true);
    const lifecycle = createPrimitiveLifecycle(source);
    const spy = spyPrimitive("guard");
    lifecycle.attach(spy.primitive);
    source.emit();
    lifecycle.flush();
    lifecycle.flush();
    lifecycle.flush();
    expect(spy.updates.map((p) => p.generation)).toEqual([1]);
    lifecycle.dispose();
  });

  it("drops a stale (lower-generation) projection and keeps generations monotonic", () => {
    const source = fakeProjectionSource(true);
    const lifecycle = createPrimitiveLifecycle(source);
    const spy = spyPrimitive("guard");
    lifecycle.attach(spy.primitive);
    source.emit({ generation: 1 });
    lifecycle.flush();
    source.emit({ generation: 3 });
    lifecycle.flush();
    // A late attacher is caught up on the CURRENT generation, never on a stale
    // one: the global watermark must drop gen 2 for everyone, not just for
    // primitives that already saw gen 3.
    const late = spyPrimitive("late");
    lifecycle.attach(late.primitive);
    source.emit({ generation: 2 }); // arrives late, must be dropped for all
    lifecycle.flush();
    source.emit({ generation: 4 });
    lifecycle.flush();
    expect(spy.updates.map((p) => p.generation)).toEqual([1, 3, 4]);
    expect(late.updates.map((p) => p.generation)).toEqual([4]);
    lifecycle.dispose();
  });

  it("coalesces several projections arriving before one flush into the newest generation", () => {
    const source = fakeProjectionSource(true);
    const lifecycle = createPrimitiveLifecycle(source);
    const spy = spyPrimitive("coalesce");
    lifecycle.attach(spy.primitive);
    source.emit();
    source.emit();
    source.emit();
    lifecycle.flush();
    expect(spy.updates.map((p) => p.generation)).toEqual([3]);
    lifecycle.dispose();
  });

  it("an out-of-order push never displaces a newer staged projection", () => {
    const source = fakeProjectionSource(true);
    const lifecycle = createPrimitiveLifecycle(source);
    const spy = spyPrimitive("order");
    lifecycle.attach(spy.primitive);
    source.emit({ generation: 5 });
    source.emit({ generation: 4 }); // late push, older generation
    lifecycle.flush();
    source.emit({ generation: 6 });
    lifecycle.flush();
    expect(spy.updates.map((p) => p.generation)).toEqual([5, 6]);
    lifecycle.dispose();
  });
});

// ── C03-A03 idempotent detach ─────────────────────────────────────────────────

describe("C03-A03 idempotent detach: detached() exactly once, never throws", () => {
  it("detach() twice calls detached() exactly once", () => {
    const source = fakeProjectionSource(true);
    const lifecycle = createPrimitiveLifecycle(source);
    const spy = spyPrimitive("twice");
    lifecycle.attach(spy.primitive);
    source.emit();
    lifecycle.flush();
    lifecycle.detach(spy.primitive);
    expect(() => lifecycle.detach(spy.primitive)).not.toThrow();
    expect(spy.detached).toHaveBeenCalledTimes(1);
    lifecycle.dispose();
  });

  it("the attach() disposer is idempotent", () => {
    const source = fakeProjectionSource(true);
    const lifecycle = createPrimitiveLifecycle(source);
    const spy = spyPrimitive("disposer");
    const dispose = lifecycle.attach(spy.primitive);
    source.emit();
    lifecycle.flush();
    expect(() => {
      dispose();
      dispose();
    }).not.toThrow();
    expect(spy.detached).toHaveBeenCalledTimes(1);
    lifecycle.dispose();
  });

  it("detach() after dispose() is a silent no-op", () => {
    const source = fakeProjectionSource(true);
    const lifecycle = createPrimitiveLifecycle(source);
    const spy = spyPrimitive("postdispose");
    lifecycle.attach(spy.primitive);
    source.emit();
    lifecycle.flush();
    lifecycle.dispose();
    expect(spy.detached).toHaveBeenCalledTimes(1);
    expect(() => lifecycle.detach(spy.primitive)).not.toThrow();
    expect(spy.detached).toHaveBeenCalledTimes(1);
  });

  it("detaching an unknown primitive never throws", () => {
    const source = fakeProjectionSource(true);
    const lifecycle = createPrimitiveLifecycle(source);
    const stranger = spyPrimitive("stranger");
    expect(() => lifecycle.detach(stranger.primitive)).not.toThrow();
    lifecycle.dispose();
  });

  it("a detached primitive receives no further update()", () => {
    const source = fakeProjectionSource(true);
    const lifecycle = createPrimitiveLifecycle(source);
    const spy = spyPrimitive("silent");
    lifecycle.attach(spy.primitive);
    source.emit();
    lifecycle.flush();
    lifecycle.detach(spy.primitive);
    source.emit();
    source.emit();
    lifecycle.flush();
    expect(spy.updates.map((p) => p.generation)).toEqual([1]);
    lifecycle.dispose();
  });

  it("a queued (never attached) primitive detaches without a detached() call", () => {
    const source = fakeProjectionSource(false);
    const lifecycle = createPrimitiveLifecycle(source);
    const spy = spyPrimitive("queued");
    lifecycle.attach(spy.primitive);
    lifecycle.detach(spy.primitive);
    expect(spy.contexts).toHaveLength(0);
    expect(spy.detached).not.toHaveBeenCalled();
    expect(lifecycle.list().map((p) => p.id)).toEqual([]);
    lifecycle.dispose();
  });
});

// ── C03-A04 single generation per flush ───────────────────────────────────────

describe("C03-A04 one generation per flush, no synchronous re-entry", () => {
  it("delivers the same projection object and generation to every primitive in one flush, in zOrder order", () => {
    const source = fakeProjectionSource(true);
    const lifecycle = createPrimitiveLifecycle(source);
    const log: string[] = [];
    const top = spyPrimitive("top", "top", () => log.push("top"));
    const bottom = spyPrimitive("bottom", "bottom", () => log.push("bottom"));
    const mid = spyPrimitive("mid", undefined, () => log.push("mid"));
    lifecycle.attach(top.primitive);
    lifecycle.attach(bottom.primitive);
    lifecycle.attach(mid.primitive);

    source.emit();
    lifecycle.flush();
    expect(log).toEqual(["bottom", "mid", "top"]);
    expect(new Set([bottom.updates[0], mid.updates[0], top.updates[0]].map((p) => p.generation)).size).toBe(1);
    expect(new Set([bottom.updates[0], mid.updates[0], top.updates[0]]).size).toBe(1); // same object

    // A late attacher catches up on the current generation without any
    // redelivery to primitives that already saw it.
    const late = spyPrimitive("late", "normal", () => log.push("late"));
    lifecycle.attach(late.primitive); // ready now: attached fires synchronously
    lifecycle.flush();
    expect(log).toEqual(["bottom", "mid", "top", "late"]);
    expect(late.updates.map((p) => p.generation)).toEqual([1]);
    expect(bottom.updates).toHaveLength(1);
    expect(mid.updates).toHaveLength(1);
    expect(top.updates).toHaveLength(1);
    lifecycle.dispose();
  });

  it("requestUpdate() from inside update() never re-enters synchronously", () => {
    const source = fakeProjectionSource(true);
    const lifecycle = createPrimitiveLifecycle(source);
    let context: PrimitiveAttachContext | null = null;
    let depth = 0;
    let maxDepth = 0;
    let deliveries = 0;
    const rogue: EnginePrimitive = {
      id: "rogue",
      attached: (ctx) => {
        context = ctx;
      },
      detached: () => {},
      update: () => {
        deliveries += 1;
        depth += 1;
        maxDepth = Math.max(maxDepth, depth);
        context?.requestUpdate(); // the legal path — record only
        source.emit(); // stage a newer generation, so a re-entry WOULD deliver
        lifecycle.flush(); // a hostile direct re-entry attempt
        depth -= 1;
      },
    };
    lifecycle.attach(rogue);
    source.emit();
    expect(() => lifecycle.flush()).not.toThrow();
    expect(deliveries).toBe(1);
    expect(maxDepth).toBe(1); // update() was never called from inside update()

    // The rogue stages a newer generation from inside EVERY update(), so each
    // following flush delivers exactly one more generation — held for the NEXT
    // flush, never re-entered, never doubled.
    for (let expected = 2; expected <= 4; expected += 1) {
      lifecycle.flush();
      expect(deliveries).toBe(expected);
    }
    lifecycle.dispose();
  });

  it("coalesces repeated requestUpdate() calls into a single next-flush delivery", () => {
    const source = fakeProjectionSource(true);
    const lifecycle = createPrimitiveLifecycle(source);
    let context: PrimitiveAttachContext | null = null;
    let deliveries = 0;
    const needy: EnginePrimitive = {
      id: "needy",
      attached: (ctx) => {
        context = ctx;
      },
      detached: () => {},
      update: () => {
        deliveries += 1;
        context?.requestUpdate();
        context?.requestUpdate();
        context?.requestUpdate();
      },
    };
    lifecycle.attach(needy);
    source.emit();
    lifecycle.flush();
    expect(deliveries).toBe(1);
    source.emit(); // one fresh generation for three queued requests
    lifecycle.flush();
    expect(deliveries).toBe(2);
    lifecycle.dispose();
  });

  it("a requestUpdate() captured before dispose stays inert afterwards", () => {
    const source = fakeProjectionSource(true);
    const lifecycle = createPrimitiveLifecycle(source);
    const spy = spyPrimitive("stale-ctx");
    lifecycle.attach(spy.primitive);
    source.emit();
    lifecycle.flush();
    const context = spy.contexts[0];
    lifecycle.dispose();
    expect(() => context.requestUpdate()).not.toThrow();
    source.emit();
    lifecycle.flush();
    expect(spy.updates).toHaveLength(1);
  });
});

// ── list() ordering & dispose() ───────────────────────────────────────────────

describe("list() ordering", () => {
  it("orders bottom → normal → top, insertion order within a tier, queued primitives included", () => {
    const source = fakeProjectionSource(false); // nothing ready: all queued
    const lifecycle = createPrimitiveLifecycle(source);
    const top = spyPrimitive("t", "top");
    const bottom = spyPrimitive("b", "bottom");
    const first = spyPrimitive("n1");
    const second = spyPrimitive("n2", "normal");
    lifecycle.attach(top.primitive);
    lifecycle.attach(bottom.primitive);
    lifecycle.attach(first.primitive);
    lifecycle.attach(second.primitive);
    expect(lifecycle.list().map((p) => p.id)).toEqual(["b", "n1", "n2", "t"]);
    lifecycle.dispose();
  });

  it("re-attaching a registered primitive is a no-op", () => {
    const source = fakeProjectionSource(true);
    const lifecycle = createPrimitiveLifecycle(source);
    const spy = spyPrimitive("again");
    lifecycle.attach(spy.primitive);
    source.emit();
    lifecycle.attach(spy.primitive);
    lifecycle.flush();
    expect(lifecycle.list()).toHaveLength(1);
    expect(spy.contexts).toHaveLength(1);
    lifecycle.dispose();
  });

  it("is empty after dispose()", () => {
    const source = fakeProjectionSource(true);
    const lifecycle = createPrimitiveLifecycle(source);
    lifecycle.attach(spyPrimitive("gone").primitive);
    lifecycle.dispose();
    expect(lifecycle.list()).toEqual([]);
  });
});

describe("dispose()", () => {
  it("detaches every attached primitive exactly once and releases the subscription", () => {
    const source = fakeProjectionSource(true);
    const lifecycle = createPrimitiveLifecycle(source);
    const a = spyPrimitive("a");
    const b = spyPrimitive("b", "top");
    lifecycle.attach(a.primitive);
    lifecycle.attach(b.primitive);
    source.emit();
    lifecycle.flush();
    expect(source.subscriberCount()).toBe(1);

    lifecycle.dispose();
    expect(a.detached).toHaveBeenCalledTimes(1);
    expect(b.detached).toHaveBeenCalledTimes(1);
    expect(source.subscriberCount()).toBe(0);
    expect(lifecycle.list()).toEqual([]);

    lifecycle.dispose(); // double dispose is a no-op
    expect(a.detached).toHaveBeenCalledTimes(1);
    expect(b.detached).toHaveBeenCalledTimes(1);
  });

  it("leaves nothing live: post-dispose flush and attach are silent", () => {
    const source = fakeProjectionSource(true);
    const lifecycle = createPrimitiveLifecycle(source);
    const attached = spyPrimitive("attached");
    lifecycle.attach(attached.primitive);
    source.emit();
    lifecycle.flush();
    lifecycle.dispose();

    const newcomer = spyPrimitive("newcomer");
    const disposer = lifecycle.attach(newcomer.primitive);
    expect(newcomer.contexts).toHaveLength(0);
    expect(lifecycle.list()).toEqual([]);
    source.emit();
    lifecycle.flush();
    expect(attached.updates).toHaveLength(1);
    expect(newcomer.updates).toHaveLength(0);
    expect(() => disposer()).not.toThrow();
    expect(newcomer.detached).not.toHaveBeenCalled();
  });
});

// ── LWC bridge stub ───────────────────────────────────────────────────────────

describe("toLwcPrimitive stub", () => {
  it("throws: the lwc/ adapter implements the real bridge (contract stays LWC-free)", () => {
    const spy = spyPrimitive("bridge");
    expect(() => toLwcPrimitive(spy.primitive, () => null)).toThrow(/stub/);
  });
});
