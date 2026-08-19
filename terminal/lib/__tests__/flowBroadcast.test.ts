/**
 * The /api/flow/stream fan-out contract.
 *
 * The defect these lock down: the watch loop used to live inside each connection, so N
 * EventSources on one feed key meant N upstream reads and N serializations of a ~2 MB frame
 * every 15s — cost scaling with CLIENTS rather than with feed keys. And the change signature
 * was `${asof}:${JSON.stringify(data).length}`, which cannot tell two same-length payloads
 * apart, so a real update could be dropped.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { loadFlowFresh } = vi.hoisted(() => ({ loadFlowFresh: vi.fn() }));
vi.mock("@/lib/flowSource", () => ({
  loadFlowFresh,
  isValidF: () => true,
}));

import { subscribe, activeProducerCount } from "@/lib/flowBroadcast";

/**
 * Counts serializations exactly: JSON.stringify calls toJSON() once per serialization of the
 * object, and serializes what it returns. Counting `loadFlowFresh` calls measures upstream
 * reads; this measures the CPU half the old code also multiplied by subscriber count.
 */
let serializations = 0;
function payload(content: Record<string, unknown>): Record<string, unknown> {
  return { ...content, toJSON() { serializations++; return content; } };
}

/** Let the producer's in-flight read settle without moving the cadence clock. */
const settle = () => vi.advanceTimersByTimeAsync(0);

/** Collects one subscriber's frames, ignoring `:` comment heartbeats. */
function collector() {
  const frames: string[] = [];
  const beats: string[] = [];
  const sink = (c: string) => { (c.startsWith("data:") ? frames : beats).push(c); };
  return { frames, beats, sink };
}

beforeEach(() => {
  vi.useFakeTimers();
  serializations = 0;
  loadFlowFresh.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  // Every test must leave the module with no live producer — a leak here would silently
  // corrupt the next test's counts.
  expect(activeProducerCount()).toBe(0);
});

describe("flow broadcaster — one producer per feed key", () => {
  it("serves 20 subscribers from ONE upstream read and ONE serialization per cadence", async () => {
    loadFlowFresh.mockImplementation(async () => payload({ asof: "T1", v: 1 }));

    const cs = Array.from({ length: 20 }, () => collector());
    const unsubs = cs.map((c) => subscribe("feed", c.sink));
    await settle();

    // The whole point: 20 attached clients, one read, one serialization.
    expect(loadFlowFresh).toHaveBeenCalledTimes(1);
    expect(serializations).toBe(1);
    for (const c of cs) expect(c.frames).toHaveLength(1);

    // A second cadence with changed content: still one read and one serialization total.
    loadFlowFresh.mockImplementation(async () => payload({ asof: "T2", v: 2 }));
    await vi.advanceTimersByTimeAsync(15_000);

    expect(loadFlowFresh).toHaveBeenCalledTimes(2);
    expect(serializations).toBe(2);
    for (const c of cs) expect(c.frames).toHaveLength(2);

    unsubs.forEach((u) => u());
  });

  it("does not re-read upstream for a late subscriber — it replays the frame it holds", async () => {
    loadFlowFresh.mockImplementation(async () => payload({ asof: "T1", v: 1 }));

    const first = collector();
    const u1 = subscribe("feed", first.sink);
    await settle();
    expect(loadFlowFresh).toHaveBeenCalledTimes(1);

    // Joining a warm producer must render at once, with no upstream read and no re-serialize.
    const late = collector();
    const u2 = subscribe("feed", late.sink);

    expect(late.frames).toHaveLength(1);
    expect(late.frames[0]).toBe(first.frames[0]);
    expect(loadFlowFresh).toHaveBeenCalledTimes(1);
    expect(serializations).toBe(1);

    u1(); u2();
  });

  it("keys producers by feed key, so distinct keys still read independently", async () => {
    loadFlowFresh.mockImplementation(async (f: string) => payload({ asof: "T1", f }));

    const a = collector();
    const b = collector();
    const ua = subscribe("feed", a.sink);
    const ub = subscribe("tide", b.sink);
    await settle();

    expect(activeProducerCount()).toBe(2);
    expect(loadFlowFresh).toHaveBeenCalledTimes(2);
    expect(loadFlowFresh.mock.calls.map((c) => c[0]).sort()).toEqual(["feed", "tide"]);
    // Each key's subscriber sees only its own feed.
    expect(a.frames[0]).toContain('"f":"feed"');
    expect(b.frames[0]).toContain('"f":"tide"');

    ua(); ub();
  });
});

describe("flow broadcaster — change detection", () => {
  it("delivers a changed frame the old asof+byte-length signature could not distinguish", async () => {
    const before = { asof: "T1", v: "AB" };
    const after = { asof: "T1", v: "BA" };

    // Prove the premise: under the previous identity these two are the SAME frame, so the
    // update was suppressed. Same asof, same serialized length, different content.
    expect(JSON.stringify(before).length).toBe(JSON.stringify(after).length);
    expect(before.asof).toBe(after.asof);

    loadFlowFresh.mockImplementation(async () => payload(before));
    const c = collector();
    const u = subscribe("feed", c.sink);
    await settle();
    expect(c.frames).toHaveLength(1);

    loadFlowFresh.mockImplementation(async () => payload(after));
    await vi.advanceTimersByTimeAsync(15_000);

    expect(c.frames).toHaveLength(2);
    expect(c.frames[1]).toBe(`data: ${JSON.stringify(after)}\n\n`);

    u();
  });

  it("holds the frame when content is unchanged, and when upstream errors or returns null", async () => {
    loadFlowFresh.mockImplementation(async () => payload({ asof: "T1", v: 1 }));
    const c = collector();
    const u = subscribe("feed", c.sink);
    await settle();
    expect(c.frames).toHaveLength(1);

    // Identical content → no push.
    await vi.advanceTimersByTimeAsync(15_000);
    expect(c.frames).toHaveLength(1);

    // Upstream throwing must not close the connection or emit a frame.
    loadFlowFresh.mockImplementation(async () => { throw new Error("upstream down"); });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(c.frames).toHaveLength(1);

    // A null resolve is a miss, not a payload — hold the last good frame.
    loadFlowFresh.mockImplementation(async () => null);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(c.frames).toHaveLength(1);

    // Recovery still pushes.
    loadFlowFresh.mockImplementation(async () => payload({ asof: "T2", v: 2 }));
    await vi.advanceTimersByTimeAsync(15_000);
    expect(c.frames).toHaveLength(2);

    u();
  });

  it("does not stack a second upstream read when one is slower than the cadence", async () => {
    let release: (v: unknown) => void = () => {};
    loadFlowFresh.mockImplementation(() => new Promise((r) => { release = r; }));

    const c = collector();
    const u = subscribe("feed", c.sink);
    await settle();
    expect(loadFlowFresh).toHaveBeenCalledTimes(1);

    // Three cadences pass while the first read is still outstanding.
    await vi.advanceTimersByTimeAsync(45_000);
    expect(loadFlowFresh).toHaveBeenCalledTimes(1);

    release(payload({ asof: "T1", v: 1 }));
    await settle();
    expect(c.frames).toHaveLength(1);

    u();
  });
});

describe("flow broadcaster — lifecycle", () => {
  it("keeps the producer alive until the LAST subscriber leaves, then removes every trace", async () => {
    loadFlowFresh.mockImplementation(async () => payload({ asof: "T1", v: 1 }));

    const a = collector();
    const b = collector();
    const ua = subscribe("feed", a.sink);
    const ub = subscribe("feed", b.sink);
    await settle();
    expect(activeProducerCount()).toBe(1);

    ua();
    expect(activeProducerCount()).toBe(1); // b is still watching

    ub();
    expect(activeProducerCount()).toBe(0);
    // No interval left behind — this is the leak the per-connection design could not have.
    expect(vi.getTimerCount()).toBe(0);

    // And no upstream work continues for a feed nobody is watching.
    const callsAtTeardown = loadFlowFresh.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(loadFlowFresh).toHaveBeenCalledTimes(callsAtTeardown);
  });

  it("starts a fresh producer when a key is re-subscribed after teardown", async () => {
    loadFlowFresh.mockImplementation(async () => payload({ asof: "T1", v: 1 }));

    const first = collector();
    const u1 = subscribe("feed", first.sink);
    await settle();
    u1();
    expect(activeProducerCount()).toBe(0);

    const second = collector();
    const u2 = subscribe("feed", second.sink);
    await settle();

    expect(activeProducerCount()).toBe(1);
    expect(loadFlowFresh).toHaveBeenCalledTimes(2); // genuinely fresh, not a resurrected frame
    expect(second.frames).toHaveLength(1);

    u2();
  });

  it("heartbeats once per interval for the whole key, and only while subscribed", async () => {
    loadFlowFresh.mockImplementation(async () => payload({ asof: "T1", v: 1 }));

    const a = collector();
    const b = collector();
    const ua = subscribe("feed", a.sink);
    const ub = subscribe("feed", b.sink);
    await settle();

    await vi.advanceTimersByTimeAsync(20_000);
    // Every attached connection still gets its keepalive — proxies idle out per connection.
    expect(a.beats).toEqual([": keepalive\n\n"]);
    expect(b.beats).toEqual([": keepalive\n\n"]);

    ua(); ub();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(a.beats).toHaveLength(1);
  });

  it("keeps delivering to healthy subscribers when one throws", async () => {
    loadFlowFresh.mockImplementation(async () => payload({ asof: "T1", v: 1 }));

    const good = collector();
    const uBad = subscribe("feed", () => { throw new Error("stream torn down"); });
    const uGood = subscribe("feed", good.sink);
    await settle();

    expect(good.frames).toHaveLength(1);

    uBad(); uGood();
  });
});
