/**
 * The serialized preference delivery pump (E2).
 *
 * Each case names a way `updateUser({data}).catch(() => {})` lost a write or lied about one:
 *
 *   • a REJECTED request vanished, and — the shape that actually matters with Supabase — one
 *     that RESOLVED with `{ error }` never reached a `.catch()` at all, so the pane reported
 *     "Saved" for a write that had not succeeded;
 *   • two edits in flight at once reorder, and the OLDER, smaller nested blob can land last:
 *
 *         desired v1 = { start_tf }
 *         desired v2 = { start_tf, updown }
 *         v2 acks first, v1 acks second → `updown` is gone
 *
 *   • a failed write had no retry, so the intent evaporated.
 */
import { describe, it, expect, vi } from "vitest";
import { PreferencePump, type SendResult } from "@/lib/prefDelivery";

/** A fake authority whose every request is released by hand. */
function authority() {
  const sent: Record<string, unknown>[] = [];
  const pendings: { resolve: (v: SendResult) => void; reject: (e: unknown) => void }[] = [];
  const send = (data: Record<string, unknown>) => {
    sent.push(data);
    return new Promise<SendResult>((resolve, reject) => { pendings.push({ resolve, reject }); });
  };
  const last = () => pendings.length - 1;
  return {
    sent,
    send,
    ok: (i = -1) => pendings[i < 0 ? last() : i].resolve(undefined),
    /** The Supabase shape: RESOLVED, error inside. */
    softFail: (i = -1) => pendings[i < 0 ? last() : i].resolve({ error: { message: "nope" } }),
    hardFail: (i = -1) => pendings[i < 0 ? last() : i].reject(new Error("offline")),
  };
}

/** A controllable clock for the retry backoff. */
function clock() {
  let queued: { fn: () => void; at: number }[] = [];
  let seq = 0;
  return {
    setTimer: (fn: () => void, ms: number) => { const id = ++seq; queued.push({ fn, at: ms }); return id; },
    clearTimer: () => { queued = []; },
    pending: () => queued.length,
    fire: () => { const q = queued; queued = []; for (const t of q) t.fn(); },
    waits: () => queued.map((q) => q.at),
  };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe("one write in flight at a time", () => {
  it("coalesces edits made while a request is out, and sends the NEWEST complete state after", async () => {
    const a = authority();
    const pump = new PreferencePump({ send: a.send });

    pump.queue({ terminal: { start_tf: "W" } });
    expect(a.sent).toHaveLength(1);

    // Three more edits land while the first is still out. None of them opens a second request.
    pump.queue({ terminal: { start_tf: "W", updown: "east" } });
    pump.queue({ terminal: { start_tf: "D", updown: "east" } });
    pump.queue({ market_focus: ["cn"] });
    expect(a.sent).toHaveLength(1);

    a.ok(0);
    await tick();

    // ONE follow-up, carrying the current value of every key — not three replayed patches.
    expect(a.sent).toHaveLength(2);
    expect(a.sent[1]).toEqual({ terminal: { start_tf: "D", updown: "east" }, market_focus: ["cn"] });

    a.ok(1);
    await tick();
    expect(a.sent).toHaveLength(2);
    expect(pump.getStatus().phase).toBe("saved");
    expect(pump.hasUndelivered()).toBe(false);
  });

  it("never lets an older blob land last — the stale-write race, driven directly", async () => {
    const a = authority();
    const pump = new PreferencePump({ send: a.send });

    pump.queue({ terminal: { start_tf: "W" } });                    // v1
    pump.queue({ terminal: { start_tf: "W", updown: "east" } });    // v2 — coalesced, not sent yet
    expect(a.sent).toHaveLength(1);
    a.ok(0);
    await tick();

    // The second request is the LAST thing the authority sees, and it is the complete state.
    expect(a.sent).toHaveLength(2);
    expect(a.sent.at(-1)).toEqual({ terminal: { start_tf: "W", updown: "east" } });
  });
});

describe("acknowledgement is the authority's, not the caller's optimism", () => {
  it("reports `syncing` until the ack, then `saved`", async () => {
    const a = authority();
    const seen: string[] = [];
    const pump = new PreferencePump({ send: a.send, onStatus: (s) => seen.push(s.phase) });

    pump.queue({ market_focus: ["us"] });
    expect(pump.getStatus().phase).toBe("syncing");
    a.ok();
    await tick();
    expect(seen).toEqual(["syncing", "saved"]);
  });

  it("treats a RESOLVED `{ error }` as a failure — the shape a .catch() cannot see", async () => {
    const a = authority();
    const c = clock();
    const pump = new PreferencePump({ send: a.send, setTimer: c.setTimer, clearTimer: c.clearTimer });

    pump.queue({ market_focus: ["us"] });
    a.softFail();
    await tick();

    expect(pump.getStatus().phase).toBe("failed");
    expect(pump.hasUndelivered()).toBe(true);
  });

  it("treats a rejected request as a failure too", async () => {
    const a = authority();
    const c = clock();
    const pump = new PreferencePump({ send: a.send, setTimer: c.setTimer, clearTimer: c.clearTimer });

    pump.queue({ market_focus: ["us"] });
    a.hardFail();
    await tick();
    expect(pump.getStatus().phase).toBe("failed");
  });

  it("treats a `send` that throws synchronously as a failure, not a crash", async () => {
    const c = clock();
    const pump = new PreferencePump({
      send: () => { throw new Error("boom"); },
      setTimer: c.setTimer, clearTimer: c.clearTimer,
    });
    pump.queue({ market_focus: ["us"] });
    await tick();
    expect(pump.getStatus().phase).toBe("failed");
  });
});

describe("a failed write is retried, and the intent survives", () => {
  it("backs off, then delivers the newest state when the authority returns", async () => {
    const a = authority();
    const c = clock();
    const pump = new PreferencePump({
      send: a.send, setTimer: c.setTimer, clearTimer: c.clearTimer, backoffMs: [10, 20],
    });

    pump.queue({ terminal: { start_tf: "W" } });
    a.softFail();
    await tick();
    expect(c.waits()).toEqual([10]);

    // The user keeps editing while the lane is down. Nothing is lost and nothing is duplicated.
    pump.queue({ terminal: { start_tf: "D" } });
    c.fire();
    await tick();
    expect(a.sent).toHaveLength(2);
    expect(a.sent[1]).toEqual({ terminal: { start_tf: "D" } });

    a.ok(1);
    await tick();
    expect(pump.getStatus().phase).toBe("saved");
  });

  it("lengthens the wait on consecutive failures and repeats the last step", async () => {
    const a = authority();
    const c = clock();
    const pump = new PreferencePump({
      send: a.send, setTimer: c.setTimer, clearTimer: c.clearTimer, backoffMs: [10, 20],
    });
    pump.queue({ market_focus: ["us"] });
    for (const expected of [[10], [20], [20]]) {
      a.softFail();
      await tick();
      expect(c.waits()).toEqual(expected);
      c.fire();
      await tick();
    }
  });

  it("retryNow() jumps the backoff instead of waiting it out", async () => {
    const a = authority();
    const c = clock();
    const pump = new PreferencePump({
      send: a.send, setTimer: c.setTimer, clearTimer: c.clearTimer, backoffMs: [60_000],
    });
    pump.queue({ market_focus: ["us"] });
    a.softFail();
    await tick();
    expect(a.sent).toHaveLength(1);

    pump.retryNow();
    expect(a.sent).toHaveLength(2);
  });
});

describe("dispose() is the owner boundary", () => {
  it("ignores an ack that arrives after the owner changed", async () => {
    const a = authority();
    const status = vi.fn();
    const pump = new PreferencePump({ send: a.send, onStatus: status });
    pump.queue({ market_focus: ["us"] });
    status.mockClear();

    pump.dispose();
    a.ok();
    await tick();

    expect(status).not.toHaveBeenCalled();
    expect(pump.getStatus().phase).toBe("syncing");   // frozen where it was; never claims "saved"
  });

  it("cancels a scheduled retry, so a disposed pump never writes again", async () => {
    const a = authority();
    const c = clock();
    const pump = new PreferencePump({
      send: a.send, setTimer: c.setTimer, clearTimer: c.clearTimer, backoffMs: [10],
    });
    pump.queue({ market_focus: ["us"] });
    a.softFail();
    await tick();
    expect(c.pending()).toBe(1);

    pump.dispose();
    expect(c.pending()).toBe(0);
    c.fire();
    await tick();
    expect(a.sent).toHaveLength(1);
  });

  it("refuses new work once disposed", () => {
    const a = authority();
    const pump = new PreferencePump({ send: a.send });
    pump.dispose();
    pump.queue({ market_focus: ["us"] });
    expect(a.sent).toEqual([]);
  });
});
