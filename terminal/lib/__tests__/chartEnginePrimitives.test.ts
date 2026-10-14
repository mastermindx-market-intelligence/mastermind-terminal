import { describe, it, expect, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Tests for the canvas renderer's primitive host (lib/chart-engine/canvas/
// primitives.ts, lane R04). The host owns no DOM: the only canvas object it ever
// sees is the CanvasRenderingContext2D the renderer passes to paintPane/paintAxis,
// so a plain recording fake stands in for it (jsdom has no real canvas anyway —
// house precedent: lwcAdapter.test.ts mocks the rented layer the same way).
//
// Acceptance covered:
//   R04-A01  generation guard — deliver() updates once per primitive per generation
//   R04-A02  hitTest top-most first
//   R04-A03  throwing primitive isolated; host never throws; errors recorded
// ─────────────────────────────────────────────────────────────────────────────

import {
  createPrimitiveHost,
  type HostAttachContext,
  type HostHit,
  type HostPrimitive,
  type HostProjection,
  type HostZOrder,
} from "../chart-engine/canvas/primitives";

// ── Recording fake for CanvasRenderingContext2D ───────────────────────────────

type CtxCall = { op: string; args: unknown[] };

function makeCtx(): { ctx: CanvasRenderingContext2D; calls: CtxCall[] } {
  const calls: CtxCall[] = [];
  const ctx = {
    save: () => calls.push({ op: "save", args: [] }),
    restore: () => calls.push({ op: "restore", args: [] }),
    beginPath: () => calls.push({ op: "beginPath", args: [] }),
    rect: (x: number, y: number, w: number, h: number) =>
      calls.push({ op: "rect", args: [x, y, w, h] }),
    clip: () => calls.push({ op: "clip", args: [] }),
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

// ── Projection factory ─────────────────────────────────────────────────────────

let nextGeneration = 0;

function makeProj(overrides: Partial<HostProjection> = {}): HostProjection {
  nextGeneration += 1;
  return {
    generation: nextGeneration,
    dpr: 2,
    widthPx: 800,
    heightPx: 300,
    xOfLogical: (i: number) => i * 10,
    logicalOfX: (x: number) => x / 10,
    yOfPrice: (p: number) => 300 - p,
    priceOfY: (y: number) => 300 - y,
    timeToX: () => null,
    xToTime: () => null,
    ...overrides,
  };
}

// ── Recorder primitive factory ─────────────────────────────────────────────────

type RecorderOptions = {
  zOrder?: HostZOrder;
  hit?: HostHit | null;
  throwIn?: "update" | "paint" | "paintAxis" | "hitTest" | "attached" | "detached";
};

type Recorder = {
  primitive: HostPrimitive;
  /** Lifecycle/paint log lines: `${id}:attached`, `${id}:update:${gen}`, … */
  log: string[];
  lastAttach: HostAttachContext | null;
};

function makeRecorder(id: string, opts: RecorderOptions = {}): Recorder {
  const log: string[] = [];
  let lastAttach: HostAttachContext | null = null;
  const primitive: HostPrimitive = {
    id,
    zOrder: opts.zOrder,
    attached(ctx) {
      lastAttach = ctx;
      log.push(`${id}:attached`);
      if (opts.throwIn === "attached") throw new Error(`${id} attach boom`);
    },
    detached() {
      log.push(`${id}:detached`);
      if (opts.throwIn === "detached") throw new Error(`${id} detach boom`);
    },
    update(proj) {
      log.push(`${id}:update:${proj.generation}`);
      if (opts.throwIn === "update") throw new Error(`${id} update boom`);
    },
    paint(ctx, proj) {
      log.push(`${id}:paint:${proj.generation}`);
      void ctx;
      if (opts.throwIn === "paint") throw new Error(`${id} paint boom`);
    },
    paintAxis(ctx, proj, axis) {
      log.push(`${id}:axis:${axis}:${proj.generation}`);
      void ctx;
      if (opts.throwIn === "paintAxis") throw new Error(`${id} axis boom`);
    },
    hitTest(x, y) {
      log.push(`${id}:hitTest:${x},${y}`);
      if (opts.throwIn === "hitTest") throw new Error(`${id} hit boom`);
      return opts.hit ?? null;
    },
  };
  return { primitive, log, get lastAttach() { return lastAttach; } };
}

const HIT = (id: string, cursor = "pointer"): HostHit => ({ id, cursor, zOrder: "normal" });

describe("createPrimitiveHost", () => {
  // ── Registry order (R04 core) ───────────────────────────────────────────────

  it("forPane sorts bottom → normal → top, stable by attach order within a tier", () => {
    const host = createPrimitiveHost();
    const top1 = makeRecorder("top1", { zOrder: "top" });
    const bottom1 = makeRecorder("bottom1", { zOrder: "bottom" });
    const normal1 = makeRecorder("normal1"); // no zOrder → normal
    const bottom2 = makeRecorder("bottom2", { zOrder: "bottom" });
    const top2 = makeRecorder("top2", { zOrder: "top" });
    for (const r of [top1, bottom1, normal1, bottom2, top2]) {
      host.attach(0, "s1", r.primitive);
    }
    expect(host.forPane(0).map((p) => p.id)).toEqual([
      "bottom1",
      "bottom2",
      "normal1",
      "top1",
      "top2",
    ]);
  });

  it("forPane is pane-scoped and answers an empty array for an unknown pane", () => {
    const host = createPrimitiveHost();
    host.attach(0, "s1", makeRecorder("a").primitive);
    host.attach(2, "s2", makeRecorder("b").primitive);
    expect(host.forPane(0).map((p) => p.id)).toEqual(["a"]);
    expect(host.forPane(2).map((p) => p.id)).toEqual(["b"]);
    expect(host.forPane(1)).toEqual([]);
  });

  it("forPane returns a defensive copy — mutating it cannot touch the registry", () => {
    const host = createPrimitiveHost();
    host.attach(0, "s1", makeRecorder("a").primitive);
    (host.forPane(0) as { length: number }).length = 0;
    expect(host.forPane(0).map((p) => p.id)).toEqual(["a"]);
  });

  // ── attach / detach lifecycle ───────────────────────────────────────────────

  it("attach calls attached once with pane/series and the disposer detaches once", () => {
    const host = createPrimitiveHost();
    const r = makeRecorder("a");
    const dispose = host.attach(3, "s1", r.primitive);
    expect(r.log).toEqual(["a:attached"]);
    expect(r.lastAttach?.paneIndex).toBe(3);
    expect(r.lastAttach?.seriesId).toBe("s1");
    dispose();
    dispose(); // idempotent
    expect(r.log).toEqual(["a:attached", "a:detached"]);
  });

  it("detach is idempotent: detached() fires exactly once across detach+disposer", () => {
    const host = createPrimitiveHost();
    const r = makeRecorder("a");
    const dispose = host.attach(0, "s1", r.primitive);
    host.detach(r.primitive);
    host.detach(r.primitive);
    dispose();
    expect(r.log).toEqual(["a:attached", "a:detached"]);
    expect(host.forPane(0)).toEqual([]);
  });

  it("re-attaching an already-live primitive object is ignored (one home per object)", () => {
    const host = createPrimitiveHost();
    const r = makeRecorder("a");
    host.attach(0, "s1", r.primitive);
    const dispose2 = host.attach(1, "s2", r.primitive);
    expect(r.log).toEqual(["a:attached"]); // no second attached()
    expect(host.forPane(1)).toEqual([]);   // no second registration
    dispose2();                            // must NOT detach the live registration
    expect(r.log).toEqual(["a:attached"]);
    expect(host.forPane(0).map((p) => p.id)).toEqual(["a"]);
  });

  it("requestUpdate from the attach context forwards to the hook with the live pane", () => {
    const onRequestUpdate = vi.fn();
    const host = createPrimitiveHost({ onRequestUpdate });
    const r = makeRecorder("a");
    host.attach(0, "s1", r.primitive);
    r.lastAttach?.requestUpdate();
    expect(onRequestUpdate).toHaveBeenCalledWith(0);
    host.moveSeries("s1", 4);
    r.lastAttach?.requestUpdate(); // same closure, new pane
    expect(onRequestUpdate).toHaveBeenCalledWith(4);
  });

  // ── paintPane (tiered passes) ───────────────────────────────────────────────

  it("paintPane paints only the requested tier, in tier order", () => {
    const host = createPrimitiveHost();
    const bottom = makeRecorder("bottom", { zOrder: "bottom" });
    const normal = makeRecorder("normal");
    const top = makeRecorder("top", { zOrder: "top" });
    for (const r of [top, bottom, normal]) host.attach(0, "s1", r.primitive);

    const { ctx } = makeCtx();
    const proj = makeProj();
    host.paintPane(ctx, 0, proj, "bottom");
    expect(bottom.log).toEqual(["bottom:attached", `bottom:paint:${proj.generation}`]);
    expect(normal.log).toEqual(["normal:attached"]);
    expect(top.log).toEqual(["top:attached"]);

    host.paintPane(ctx, 0, proj, "normal");
    expect(normal.log).toEqual(["normal:attached", `normal:paint:${proj.generation}`]);
    expect(top.log).toEqual(["top:attached"]);

    host.paintPane(ctx, 0, proj, "top");
    expect(top.log).toEqual(["top:attached", `top:paint:${proj.generation}`]);
  });

  it("paintPane passes the renderer's ctx and proj through to paint", () => {
    const host = createPrimitiveHost();
    const seen: Array<{ ctx: CanvasRenderingContext2D; proj: HostProjection }> = [];
    const p: HostPrimitive = {
      id: "spy",
      paint(ctx, proj) {
        seen.push({ ctx, proj });
      },
    };
    host.attach(0, "s1", p);
    const { ctx } = makeCtx();
    const proj = makeProj();
    host.paintPane(ctx, 0, proj, "normal");
    expect(seen).toEqual([{ ctx, proj }]);
  });

  it("paintPane ignores primitives registered in another pane", () => {
    const host = createPrimitiveHost();
    const a = makeRecorder("a");
    host.attach(0, "s1", a.primitive);
    const { ctx } = makeCtx();
    host.paintPane(ctx, 1, makeProj(), "normal");
    expect(a.log).toEqual(["a:attached"]); // attached, never painted
  });

  // ── paintAxis (clipped axis views) ──────────────────────────────────────────

  it("paintAxis clips to the rect it is given (save → beginPath/rect/clip → restore)", () => {
    const host = createPrimitiveHost();
    const bottom = makeRecorder("bottom", { zOrder: "bottom" });
    const top = makeRecorder("top", { zOrder: "top" });
    for (const r of [top, bottom]) host.attach(0, "s1", r.primitive);
    // A primitive without paintAxis must simply be skipped.
    host.attach(0, "s1", { id: "bare" });

    const { ctx, calls } = makeCtx();
    const proj = makeProj();
    host.paintAxis(ctx, 0, proj, "price", { x: 740, y: 0, width: 60, height: 300 });

    expect(calls).toEqual([
      { op: "save", args: [] },
      { op: "beginPath", args: [] },
      { op: "rect", args: [740, 0, 60, 300] },
      { op: "clip", args: [] },
      { op: "restore", args: [] },
    ]);
    // Axis views paint in z order (bottom tier first) regardless of pane pass.
    expect(bottom.log).toEqual(["bottom:attached", `bottom:axis:price:${proj.generation}`]);
    expect(top.log).toEqual(["top:attached", `top:axis:price:${proj.generation}`]);
  });

  it("paintAxis forwards the axis side and still restores when a primitive throws", () => {
    const host = createPrimitiveHost();
    const bad = makeRecorder("bad", { throwIn: "paintAxis" });
    const good = makeRecorder("good");
    for (const r of [bad, good]) host.attach(0, "s1", r.primitive);

    const { ctx, calls } = makeCtx();
    expect(() =>
      host.paintAxis(ctx, 0, makeProj(), "time", { x: 0, y: 300, width: 800, height: 24 }),
    ).not.toThrow();
    expect(good.log.some((l) => l.startsWith("good:axis:time:"))).toBe(true);
    expect(calls.some((c) => c.op === "restore")).toBe(true);
    expect(host.errors().map((e) => e.phase)).toEqual(["paintAxis"]);
  });

  // ── hitTest (R04-A02) ───────────────────────────────────────────────────────

  it("hitTest is ordered top-most first across tiers and within a tier", () => {
    const host = createPrimitiveHost();
    const bottom = makeRecorder("bottom", { zOrder: "bottom", hit: HIT("bottom") });
    const normal1 = makeRecorder("normal1", { hit: HIT("normal1") });
    const normal2 = makeRecorder("normal2", { hit: HIT("normal2") });
    const top = makeRecorder("top", { zOrder: "top", hit: HIT("top") });
    for (const r of [bottom, normal1, normal2, top]) host.attach(0, "s1", r.primitive);

    const hits = host.hitTest(0, 10, 10);
    expect(hits.map((h) => h.primitive.id)).toEqual(["top", "normal2", "normal1", "bottom"]);
    expect(hits[0].hit).toEqual({ id: "top", cursor: "pointer", zOrder: "normal" });
  });

  it("hitTest is empty when nothing reports a hit", () => {
    const host = createPrimitiveHost();
    const miss = makeRecorder("miss", { hit: null });
    host.attach(0, "s1", miss.primitive);
    host.attach(0, "s1", { id: "bare" }); // no hitTest method at all
    expect(host.hitTest(0, 10, 10)).toEqual([]);
    expect(miss.log).toEqual(["miss:attached", "miss:hitTest:10,10"]); // miss WAS consulted
  });

  it("hitTest is pane-scoped", () => {
    const host = createPrimitiveHost();
    host.attach(0, "s1", makeRecorder("a", { hit: HIT("a") }).primitive);
    expect(host.hitTest(1, 10, 10)).toEqual([]);
  });

  it("hitTest isolates a throwing primitive and still returns the others (R04-A03)", () => {
    const host = createPrimitiveHost();
    const bad = makeRecorder("bad", { throwIn: "hitTest" });
    const good = makeRecorder("good", { hit: HIT("good") });
    for (const r of [bad, good]) host.attach(0, "s1", r.primitive);
    const hits = host.hitTest(0, 5, 5);
    expect(hits.map((h) => h.primitive.id)).toEqual(["good"]);
    expect(host.errors().map((e) => e.phase)).toEqual(["hitTest"]);
  });

  // ── deliver + generation guard (R04-A01) ────────────────────────────────────

  it("deliver updates each primitive exactly once per generation (R04-A01)", () => {
    const host = createPrimitiveHost();
    const a = makeRecorder("a");
    const b = makeRecorder("b", { zOrder: "bottom" });
    for (const r of [a, b]) host.attach(0, "s1", r.primitive);

    const gen5 = makeProj({ generation: 5 });
    host.deliver(gen5);
    expect(a.log).toEqual(["a:attached", "a:update:5"]);
    expect(b.log).toEqual(["b:attached", "b:update:5"]);

    host.deliver(makeProj({ generation: 5 })); // same generation again → no-op
    host.deliver(makeProj({ generation: 4 })); // older generation → no-op
    expect(a.log).toEqual(["a:attached", "a:update:5"]);
    expect(b.log).toEqual(["b:attached", "b:update:5"]);

    host.deliver(makeProj({ generation: 6 }));
    expect(a.log).toEqual(["a:attached", "a:update:5", "a:update:6"]);
    expect(b.log).toEqual(["b:attached", "b:update:5", "b:update:6"]);
  });

  it("the generation guard is per primitive: a late attachee still gets its first update", () => {
    const host = createPrimitiveHost();
    const early = makeRecorder("early");
    host.attach(0, "s1", early.primitive);
    host.deliver(makeProj({ generation: 5 }));
    expect(early.log).toEqual(["early:attached", "early:update:5"]);

    const late = makeRecorder("late");
    host.attach(0, "s2", late.primitive);
    host.deliver(makeProj({ generation: 5 }));
    expect(early.log).toEqual(["early:attached", "early:update:5"]); // guarded
    expect(late.log).toEqual(["late:attached", "late:update:5"]);    // first sight of gen 5
  });

  it("deliver passes the projection through", () => {
    const host = createPrimitiveHost();
    const seen: HostProjection[] = [];
    const p: HostPrimitive = {
      id: "spy",
      update(proj) {
        seen.push(proj);
      },
    };
    host.attach(0, "s1", p);
    const proj = makeProj();
    host.deliver(proj);
    expect(seen).toEqual([proj]);
  });

  // ── error isolation (R04-A03) ───────────────────────────────────────────────

  it("a throwing update is isolated: others still update, host never throws (R04-A03)", () => {
    const host = createPrimitiveHost();
    const before = makeRecorder("before");
    const bad = makeRecorder("bad", { throwIn: "update" });
    const after = makeRecorder("after", { zOrder: "top" });
    for (const r of [before, bad, after]) host.attach(0, "s1", r.primitive);

    const proj = makeProj({ generation: 9 });
    expect(() => host.deliver(proj)).not.toThrow();
    expect(before.log).toEqual(["before:attached", "before:update:9"]);
    expect(after.log).toEqual(["after:attached", "after:update:9"]);
    const errors = host.errors();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      primitiveId: "bad",
      phase: "update",
      generation: 9,
      message: "bad update boom",
    });
    // Not retried within the same generation (guard advanced before the call).
    host.deliver(makeProj({ generation: 9 }));
    expect(bad.log).toEqual(["bad:attached", "bad:update:9"]);
    expect(host.errors()).toHaveLength(1);
  });

  it("a throwing paint is isolated and recorded; other paints still run", () => {
    const host = createPrimitiveHost();
    const bad = makeRecorder("bad", { throwIn: "paint" });
    const good = makeRecorder("good");
    for (const r of [bad, good]) host.attach(0, "s1", r.primitive);
    const { ctx } = makeCtx();
    expect(() => host.paintPane(ctx, 0, makeProj(), "normal")).not.toThrow();
    expect(good.log.some((l) => l.startsWith("good:paint:"))).toBe(true);
    expect(host.errors().map((e) => e.primitiveId)).toEqual(["bad"]);
  });

  it("a throwing detached is isolated and the primitive still leaves the registry", () => {
    const host = createPrimitiveHost();
    const bad = makeRecorder("bad", { throwIn: "detached" });
    host.attach(0, "s1", bad.primitive);
    expect(() => host.removeSeries("s1")).not.toThrow();
    expect(host.forPane(0)).toEqual([]);
    expect(host.errors().map((e) => e.phase)).toEqual(["detached"]);
  });

  // ── moveSeries / removeSeries ───────────────────────────────────────────────

  it("moveSeries re-homes that series' primitives, keeping their tier order", () => {
    const host = createPrimitiveHost();
    const a = makeRecorder("a", { zOrder: "bottom" });
    const b = makeRecorder("b");
    const other = makeRecorder("other");
    host.attach(0, "s1", a.primitive);
    host.attach(0, "s1", b.primitive);
    host.attach(0, "s2", other.primitive);

    host.moveSeries("s1", 2);
    expect(host.forPane(0).map((p) => p.id)).toEqual(["other"]);
    expect(host.forPane(2).map((p) => p.id)).toEqual(["a", "b"]);

    const { ctx } = makeCtx();
    host.paintPane(ctx, 0, makeProj(), "normal");
    expect(a.log).toEqual(["a:attached"]); // attached only — no longer painted by pane 0
  });

  it("removeSeries detaches each of its primitives exactly once", () => {
    const host = createPrimitiveHost();
    const a = makeRecorder("a");
    const b = makeRecorder("b", { zOrder: "top" });
    const other = makeRecorder("other");
    const disposeA = host.attach(0, "s1", a.primitive);
    host.attach(0, "s1", b.primitive);
    host.attach(0, "s2", other.primitive);

    host.removeSeries("s1");
    disposeA(); // stale disposer after removeSeries → no second detached()
    expect(a.log).toEqual(["a:attached", "a:detached"]);
    expect(b.log).toEqual(["b:attached", "b:detached"]);
    expect(other.log).toEqual(["other:attached"]);
    expect(host.forPane(0).map((p) => p.id)).toEqual(["other"]); // different series stays
  });

  // ── inventory / dispose ─────────────────────────────────────────────────────

  it("inventory counts live primitives by pane", () => {
    const host = createPrimitiveHost();
    host.attach(0, "s1", makeRecorder("a").primitive);
    host.attach(0, "s1", makeRecorder("b").primitive);
    host.attach(3, "s2", makeRecorder("c").primitive);
    expect(host.inventory()).toEqual({ alive: true, primitives: 3, byPane: [2, 1] });
  });

  it("dispose releases every primitive exactly once, is idempotent, and kills the host", () => {
    const host = createPrimitiveHost();
    const a = makeRecorder("a");
    const b = makeRecorder("b", { zOrder: "bottom" });
    const disposeA = host.attach(0, "s1", a.primitive);
    host.attach(1, "s2", b.primitive);

    host.dispose();
    host.dispose(); // double dispose → no-op
    disposeA();     // stale disposer → no second detached()
    expect(a.log).toEqual(["a:attached", "a:detached"]);
    expect(b.log).toEqual(["b:attached", "b:detached"]);

    expect(host.inventory()).toEqual({ alive: false, primitives: 0, byPane: [] });

    // Dead host: attach is a no-op disposer; everything else is safe on empties.
    const c = makeRecorder("c");
    const disposeC = host.attach(0, "s3", c.primitive);
    expect(c.log).toEqual([]);
    expect(() => disposeC()).not.toThrow();
    const { ctx } = makeCtx();
    expect(() => {
      host.paintPane(ctx, 0, makeProj(), "normal");
      host.paintAxis(ctx, 0, makeProj(), "price", { x: 0, y: 0, width: 10, height: 10 });
      host.deliver(makeProj());
    }).not.toThrow();
    expect(host.hitTest(0, 1, 1)).toEqual([]);
    expect(c.log).toEqual([]);
  });
});
