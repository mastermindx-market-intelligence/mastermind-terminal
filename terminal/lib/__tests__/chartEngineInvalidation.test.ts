import { describe, it, expect, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// R03 — invalidation + generation + autoscale scheduling (pure model).
//
// The module under test has no DOM and no renderer dependency, so this suite
// runs in the default Node environment. The scheduler is faked with a
// recording stand-in: it captures the flush callback instead of registering a
// rAF, so every test drives frames deterministically and can count schedule
// calls, cancels, and generations exactly (house precedent: lwcAdapter.test.ts
// mocks the environment rather than the module).
// ─────────────────────────────────────────────────────────────────────────────

import {
  createInvalidator,
  autoscaleTargets,
  dataChangeMask,
  liveTickMask,
  type InvalidationMask,
  type Invalidator,
} from "../chart-engine/canvas/invalidation";

/** rAF-shaped fake: captures the flush callback, counts schedule calls/cancels. */
function fakeSchedule() {
  let cancelCount = 0;
  const callbacks: (() => void)[] = [];
  const schedule = vi.fn((flush: () => void) => {
    callbacks.push(flush);
    return () => {
      cancelCount += 1;
      callbacks.pop();
    };
  });
  return {
    schedule,
    scheduleCalls: () => schedule.mock.calls.length,
    /** Fire the oldest captured frame callback (the host's rAF tick). */
    tick: (): void => {
      const cb = callbacks.shift();
      if (cb) cb();
    },
    hasFrame: () => callbacks.length > 0,
    cancelCount: () => cancelCount,
  };
}

const MODEL = { panes: [
  { index: 0, autoscale: true },
  { index: 1, autoscale: false },
  { index: 2, autoscale: true },
] };

function maskOf(level: InvalidationMask["level"], extra?: Partial<InvalidationMask>): InvalidationMask {
  return {
    level,
    panes: new Set<number>(),
    timeScale: false,
    priceScales: new Set<string>(),
    autoscale: new Set<number>(),
    ...extra,
  };
}

// ── Merging ───────────────────────────────────────────────────────────────────

describe("invalidation merging", () => {
  it("keeps the MAX level across a burst", () => {
    const s = fakeSchedule();
    const inv = createInvalidator(s.schedule);
    inv.invalidate({ level: "cursor" });
    inv.invalidate({ level: "light" });
    expect(inv.pending()?.level).toBe("light");
    inv.invalidate({ level: "cursor" });
    expect(inv.pending()?.level).toBe("light");
    inv.invalidate({ level: "full" });
    expect(inv.pending()?.level).toBe("full");
    inv.invalidate({ level: "light" });
    expect(inv.pending()?.level).toBe("full");
  });

  it("unions pane sets, price-scale sets and autoscale sets; ORs timeScale", () => {
    const s = fakeSchedule();
    const inv = createInvalidator(s.schedule);
    inv.invalidate({ level: "light", panes: new Set([0, 1]), priceScales: new Set(["right"]) });
    inv.invalidate({ level: "light", panes: new Set([2]), priceScales: new Set(["volume"]), autoscale: new Set([2]) });
    inv.invalidate({ level: "light", timeScale: true, autoscale: new Set([0]) });
    const m = inv.pending();
    expect(m?.panes).toEqual(new Set([0, 1, 2]));
    expect(m?.priceScales).toEqual(new Set(["right", "volume"]));
    expect(m?.autoscale).toEqual(new Set([0, 2]));
    expect(m?.timeScale).toBe(true);
  });

  it("\"all\" absorbs set scopes in either position", () => {
    const s = fakeSchedule();
    const inv = createInvalidator(s.schedule);
    inv.invalidate({ level: "light", panes: new Set([0]) });
    inv.invalidate({ level: "light", panes: "all" });
    expect(inv.pending()?.panes).toBe("all");

    const s2 = fakeSchedule();
    const inv2 = createInvalidator(s2.schedule);
    inv2.invalidate({ level: "light", priceScales: "all" });
    inv2.invalidate({ level: "light", priceScales: new Set(["right"]) });
    expect(inv2.pending()?.priceScales).toBe("all");
    expect(inv2.pending()?.panes).toEqual(new Set());
  });

  it("copies caller sets — later mutation of the argument cannot corrupt the mask", () => {
    const s = fakeSchedule();
    const inv = createInvalidator(s.schedule);
    const panes = new Set([0]);
    inv.invalidate({ level: "light", panes });
    panes.add(9);
    expect(inv.pending()?.panes).toEqual(new Set([0]));
  });

  it("a cursor invalidation never contributes autoscale, but erases nothing", () => {
    const s = fakeSchedule();
    const inv = createInvalidator(s.schedule);
    // Even if a caller fills the autoscale set on a cursor invalidation, the
    // law is structural: cursor contributes zero autoscale work.
    inv.invalidate({ level: "cursor", autoscale: new Set([0]) });
    expect(inv.pending()?.autoscale).toEqual(new Set());
    // ...and a later cursor does not drop autoscale a light level already earned.
    inv.invalidate({ level: "light", autoscale: new Set([2]) });
    inv.invalidate({ level: "cursor" });
    expect(inv.pending()?.autoscale).toEqual(new Set([2]));
  });
});

// ── R03-A01: one paint per frame ──────────────────────────────────────────────

describe("R03-A01 — one schedule call, one flush, one generation per burst", () => {
  it("five invalidations before a flush produce exactly one schedule and one generation bump", () => {
    const s = fakeSchedule();
    const inv = createInvalidator(s.schedule);
    inv.invalidate({ level: "cursor" });
    inv.invalidate({ level: "light", panes: new Set([0]) });
    inv.invalidate({ level: "light", panes: new Set([1]), autoscale: new Set([1]) });
    inv.invalidate({ level: "full" });
    inv.invalidate({ level: "cursor" });
    expect(s.scheduleCalls()).toBe(1);
    expect(inv.generation()).toBe(0);

    const report = inv.flush();
    expect(report).not.toBeNull();
    expect(report?.generation).toBe(1);
    expect(report?.mask.level).toBe("full");
    expect(inv.generation()).toBe(1);
    expect(inv.pending()).toBeNull();
    // The flush consumed the armed frame: no second frame, no second schedule.
    expect(s.scheduleCalls()).toBe(1);
    expect(s.hasFrame()).toBe(false);
  });

  it("a flush with nothing pending returns null and does not bump the generation", () => {
    const s = fakeSchedule();
    const inv = createInvalidator(s.schedule);
    expect(inv.flush()).toBeNull();
    expect(inv.generation()).toBe(0);
    inv.invalidate({ level: "light" });
    inv.flush();
    expect(inv.generation()).toBe(1);
    expect(inv.flush()).toBeNull();
    expect(inv.generation()).toBe(1);
  });

  it("generations are strictly increasing integers across many frames", () => {
    const s = fakeSchedule();
    const inv = createInvalidator(s.schedule);
    expect(inv.generation()).toBe(0);
    let prev = 0;
    for (let i = 0; i < 5; i++) {
      inv.invalidate({ level: "cursor" });
      const r = inv.flush();
      expect(r).not.toBeNull();
      expect(Number.isInteger(r?.generation)).toBe(true);
      expect(r!.generation).toBeGreaterThan(prev);
      prev = r!.generation;
    }
    expect(inv.generation()).toBe(5);
  });

  it("the host's scheduled callback performs the flush (the rAF path)", () => {
    const s = fakeSchedule();
    const inv = createInvalidator(s.schedule);
    inv.invalidate({ level: "light", panes: new Set([1]) });
    s.tick(); // the frame fires
    expect(inv.generation()).toBe(1);
    expect(inv.pending()).toBeNull();
    expect(s.scheduleCalls()).toBe(1);
  });
});

// ── Re-entrancy ───────────────────────────────────────────────────────────────

describe("re-entrancy — invalidate during a flush queues for the NEXT frame", () => {
  it("an invalidate landing inside the flush window is not merged into the painted generation", () => {
    const s = fakeSchedule();
    const inv = createInvalidator(s.schedule);
    inv.invalidate({ level: "full", panes: new Set([0]) });
    // Frame 1 paints. A paint hook (still inside the host's frame callback)
    // then invalidates — after the report was taken, before the frame returns.
    const frame1 = inv.flush();
    expect(frame1?.generation).toBe(1);
    inv.invalidate({ level: "cursor" });
    // The already-painted generation is a frozen snapshot: the cursor work is
    // NOT merged into it, and nothing was lost.
    expect(frame1?.mask.level).toBe("full");
    expect(frame1?.mask.panes).toEqual(new Set([0]));
    expect(inv.pending()?.level).toBe("cursor");
    expect(inv.generation()).toBe(1);
    // Exactly one further frame is scheduled for the queued work.
    expect(s.scheduleCalls()).toBe(2);
    const frame2 = inv.flush();
    expect(frame2?.generation).toBe(2);
    expect(frame2?.mask.level).toBe("cursor");
  });

  it("a schedule that fires synchronously inside invalidate() flushes exactly once (no nesting)", () => {
    // Adversarial host: the schedule fires the flush callback IMMEDIATELY, so
    // the flush runs inside invalidate()'s call frame.
    const immediate = vi.fn((flush: () => void) => {
      flush();
      return () => undefined;
    });
    const inv = createInvalidator(immediate);
    inv.invalidate({ level: "light", panes: new Set([3]) });
    expect(immediate).toHaveBeenCalledTimes(1);
    expect(inv.generation()).toBe(1); // flushed once, not nested twice
    expect(inv.pending()).toBeNull();
  });

  it("an invalidate arriving from INSIDE the flush window (a host cancel hook) is deferred to the next frame", () => {
    // The one seam where user code really runs mid-flush is the host's cancel,
    // invoked by disarm() while the frame window is open. Whatever invalidation
    // arrives there must be queued for the NEXT frame — never merged into the
    // generation that is already painting, never lost.
    let inv: Invalidator | null = null;
    const schedule = vi.fn(() => () => {
      inv?.invalidate({ level: "cursor" }); // "paint hook" firing mid-flush
    });
    inv = createInvalidator(schedule);
    inv.invalidate({ level: "light", panes: new Set([0]) });
    expect(schedule).toHaveBeenCalledTimes(1);

    const frame1 = inv.flush(); // disarm → cancel → invalidate(cursor) mid-flush
    expect(frame1?.generation).toBe(1);
    expect(frame1?.mask.level).toBe("light"); // the painted frame is unaffected
    expect(inv.pending()?.level).toBe("cursor"); // ...and nothing was lost
    expect(schedule).toHaveBeenCalledTimes(2); // armed for the NEXT frame

    const frame2 = inv.flush();
    expect(frame2?.generation).toBe(2);
    expect(frame2?.mask.level).toBe("cursor");
  });

  it("a re-entrant flush() from inside the flush window returns null (one flush per frame)", () => {
    let inv: Invalidator | null = null;
    let reentrant: { generation: number } | null = { generation: -1 }; // sentinel
    const schedule = vi.fn(() => () => {
      reentrant = inv ? inv.flush() : null; // hostile cancel re-enters flush()
    });
    inv = createInvalidator(schedule);
    inv.invalidate({ level: "full" });
    const outer = inv.flush(); // disarm → cancel → nested flush() attempt
    expect(outer?.generation).toBe(1);
    expect(reentrant).toBeNull(); // refused: the frame is already being painted
    expect(inv.generation()).toBe(1);
  });
});

// ── dispose ───────────────────────────────────────────────────────────────────

describe("dispose", () => {
  it("cancels a pending schedule and drops pending work", () => {
    const s = fakeSchedule();
    const inv = createInvalidator(s.schedule);
    inv.invalidate({ level: "full" });
    expect(s.hasFrame()).toBe(true);
    inv.dispose();
    expect(s.cancelCount()).toBe(1);
    expect(inv.pending()).toBeNull();
    expect(inv.flush()).toBeNull();
    expect(inv.generation()).toBe(0); // never painted
  });

  it("is idempotent — a second dispose cancels nothing more", () => {
    const s = fakeSchedule();
    const inv = createInvalidator(s.schedule);
    inv.invalidate({ level: "light" });
    inv.dispose();
    inv.dispose();
    expect(s.cancelCount()).toBe(1);
  });

  it("post-dispose invalidate is a no-op (no schedule, no pending)", () => {
    const s = fakeSchedule();
    const inv = createInvalidator(s.schedule);
    inv.dispose();
    inv.invalidate({ level: "full" });
    expect(s.scheduleCalls()).toBe(0);
    expect(inv.pending()).toBeNull();
    expect(inv.generation()).toBe(0);
  });
});

// ── autoscaleTargets ──────────────────────────────────────────────────────────

describe("autoscaleTargets", () => {
  it("returns only explicitly-dirtied panes for a light mask, filtered to autoscale-enabled panes", () => {
    const mask = maskOf("light", { autoscale: new Set([0, 1, 7]) });
    // pane 1 is autoscale:false in the model, pane 7 does not exist — both drop.
    expect(autoscaleTargets(mask, MODEL)).toEqual([0]);
  });

  it("a full mask re-runs autoscale on every autoscale-enabled pane", () => {
    const mask = maskOf("full", { autoscale: new Set([0]) });
    expect(autoscaleTargets(mask, MODEL)).toEqual([0, 2]);
  });

  it("a cursor mask never triggers autoscale", () => {
    expect(autoscaleTargets(maskOf("cursor"), MODEL)).toEqual([]);
    const s = fakeSchedule();
    const inv = createInvalidator(s.schedule);
    inv.invalidate({ level: "cursor" });
    inv.invalidate({ level: "cursor" });
    const r = inv.flush();
    expect(autoscaleTargets(r!.mask, MODEL)).toEqual([]);
  });

  it("dedupes and returns ascending indexes", () => {
    const model = { panes: [
      { index: 2, autoscale: true },
      { index: 0, autoscale: true },
      { index: 2, autoscale: true }, // duplicate model row must not duplicate output
    ] };
    const mask = maskOf("light", { autoscale: new Set([2, 0]) });
    expect(autoscaleTargets(mask, model)).toEqual([0, 2]);
  });

  it("an empty model yields nothing", () => {
    expect(autoscaleTargets(maskOf("full"), { panes: [] })).toEqual([]);
  });
});

// ── dataChangeMask ────────────────────────────────────────────────────────────

describe("dataChangeMask — one mask per feed event kind", () => {
  it("setData → full for that pane + timeScale + its price scale", () => {
    const m = dataChangeMask({ kind: "setData", paneIndex: 1, priceScaleId: "right", visibleAffected: true });
    expect(m.level).toBe("full");
    expect(m.panes).toEqual(new Set([1]));
    expect(m.timeScale).toBe(true);
    expect(m.priceScales).toEqual(new Set(["right"]));
    expect(m.autoscale).toEqual(new Set()); // full implies autoscale via autoscaleTargets
    expect(autoscaleTargets(m, MODEL)).toEqual([0, 2]);
  });

  it("update visible → light + autoscale for the pane, no timeScale", () => {
    const m = dataChangeMask({ kind: "update", paneIndex: 2, priceScaleId: "volume", visibleAffected: true });
    expect(m.level).toBe("light");
    expect(m.panes).toEqual(new Set([2]));
    expect(m.timeScale).toBe(false);
    expect(m.priceScales).toEqual(new Set(["volume"]));
    expect(m.autoscale).toEqual(new Set([2]));
  });

  it("update off-screen → level none, and NOTHING is scheduled (R03-A02 cheap live ticks)", () => {
    const m = dataChangeMask({ kind: "update", paneIndex: 0, priceScaleId: "right", visibleAffected: false });
    expect(m.level).toBe("none");
    expect(m.timeScale).toBe(false);
    expect(m.panes).toEqual(new Set());
    expect(m.autoscale).toEqual(new Set());
    // Feeding it to the invalidator costs zero: no schedule, no pending, no flush.
    const s = fakeSchedule();
    const inv = createInvalidator(s.schedule);
    inv.invalidate(m);
    expect(s.scheduleCalls()).toBe(0);
    expect(inv.pending()).toBeNull();
    expect(inv.flush()).toBeNull();
    expect(inv.generation()).toBe(0);
  });

  it("whitespace visible → light for the pane, no autoscale, no price-scale work", () => {
    const m = dataChangeMask({ kind: "whitespace", paneIndex: 0, priceScaleId: "right", visibleAffected: true });
    expect(m.level).toBe("light");
    expect(m.panes).toEqual(new Set([0]));
    expect(m.autoscale).toEqual(new Set());
    expect(m.priceScales).toEqual(new Set());
  });

  it("whitespace off-screen → none", () => {
    expect(dataChangeMask({ kind: "whitespace", paneIndex: 0, priceScaleId: "right", visibleAffected: false }).level).toBe("none");
  });

  it("remove → full everywhere: all panes, all scales, timeScale", () => {
    const m = dataChangeMask({ kind: "remove", paneIndex: 0, priceScaleId: "right", visibleAffected: true });
    expect(m.level).toBe("full");
    expect(m.panes).toBe("all");
    expect(m.priceScales).toBe("all");
    expect(m.timeScale).toBe(true);
    expect(autoscaleTargets(m, MODEL)).toEqual([0, 2]);
  });
});

// ── R03-A03: the live-bar law ─────────────────────────────────────────────────

describe("R03-A03 — liveTickMask: one live bar, one generation, never full", () => {
  it("an in-place tick (same time) → light, no timeScale", () => {
    const m = liveTickMask({ time: 1_700_000_100 }, { time: 1_700_000_100 }, 99, 500);
    expect(m.level).toBe("light");
    expect(m.timeScale).toBe(false);
  });

  it("a new bar appended while the right edge is visible → light + timeScale (shift)", () => {
    // 500 rows → last bar index 499; visibleTo 520 covers it.
    const m = liveTickMask({ time: 1_700_000_100 }, { time: 1_700_000_200 }, 520, 500);
    expect(m.level).toBe("light"); // never full — no geometry recompute, no rebuild
    expect(m.timeScale).toBe(true);
  });

  it("a new bar appended while the right edge is OFF-screen → light only (nothing shifts)", () => {
    // Last bar 499 is not visible (visibleTo 300): the append lands off-screen.
    const m = liveTickMask({ time: 1_700_000_100 }, { time: 1_700_000_200 }, 300, 500);
    expect(m.level).toBe("light");
    expect(m.timeScale).toBe(false);
  });

  it("the boundary is exact: visibleTo at the last bar shifts; one below does not", () => {
    expect(liveTickMask({ time: 1 }, { time: 2 }, 499, 500).timeScale).toBe(true);
    expect(liveTickMask({ time: 1 }, { time: 2 }, 498.999, 500).timeScale).toBe(false);
  });

  it("prev === null is a new bar (nothing to update in place)", () => {
    const first = liveTickMask(null, { time: 100 }, 40, 0);
    expect(first.level).toBe("light");
    expect(first.timeScale).toBe(true); // rowCount 0: edge trivially visible
  });

  it("a backwards tick is a historical revision, never an append", () => {
    const m = liveTickMask({ time: 200 }, { time: 100 }, 520, 500);
    expect(m.level).toBe("light");
    expect(m.timeScale).toBe(false);
  });

  it("one live bar → exactly one schedule call, one flush, one generation (no rebuild)", () => {
    const s = fakeSchedule();
    const inv = createInvalidator(s.schedule);
    // The renderer unions the scale half and the value half of a tick —
    // both land in ONE generation.
    inv.invalidate(liveTickMask({ time: 1 }, { time: 2 }, 520, 500));
    inv.invalidate(dataChangeMask({ kind: "update", paneIndex: 0, priceScaleId: "right", visibleAffected: true }));
    expect(s.scheduleCalls()).toBe(1);
    const r = inv.flush();
    expect(r?.generation).toBe(1);
    expect(r?.mask.level).toBe("light");
    expect(r?.mask.timeScale).toBe(true);
    expect(r?.mask.autoscale).toEqual(new Set([0]));
  });
});

// ── Snapshot integrity ────────────────────────────────────────────────────────

describe("snapshot integrity", () => {
  it("pending() returns a copy — mutating it cannot corrupt the invalidator", () => {
    const s = fakeSchedule();
    const inv = createInvalidator(s.schedule);
    inv.invalidate({ level: "light", panes: new Set([0]) });
    const snapshot = inv.pending();
    (snapshot!.panes as Set<number>).add(9);
    expect(inv.pending()?.panes).toEqual(new Set([0]));
  });

  it("a flushed report's mask is not affected by later invalidations", () => {
    const s = fakeSchedule();
    const inv = createInvalidator(s.schedule);
    inv.invalidate({ level: "light", panes: new Set([0]) });
    const r = inv.flush();
    inv.invalidate({ level: "full", panes: "all", timeScale: true });
    expect(r?.mask.level).toBe("light");
    expect(r?.mask.panes).toEqual(new Set([0]));
    expect(r?.mask.timeScale).toBe(false);
  });
});
