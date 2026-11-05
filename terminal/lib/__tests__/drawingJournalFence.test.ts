import { afterEach, describe, expect, it, vi } from "vitest";
import { readDrawingJournal, writeDrawingJournal, browserDrawingJournalFence, DRAWING_JOURNAL_KEY, DRAWING_JOURNAL_GENERATION_KEY, DRAWING_JOURNAL_CONVERGENCE_MS, type DrawingJournalFence, type DrawingJournalLocks } from "@/lib/drawingOutbox";

let lockTail = Promise.resolve();
const locks = { request: (_name: string, fn: () => unknown) => { const task = lockTail.then(fn); lockTail = task.then(() => {}, () => {}); return task; } } as DrawingJournalLocks;
const line = (id: string) => ({ id, kind: "hline" as const, schemaVersion: 1, source: "user" as const, points: [{ t: "2026-01-01", p: 100 }] });

// Chromium serves localStorage reads from a per-renderer cache. Another tab's
// write lands in the shared store at once but reaches this cache later, in
// order, on a channel the Web Lock grant does not wait for.
class Backing { values = new Map<string, string>(); views: View[] = []; }
class View {
  cache: Map<string, string>;
  pending: Array<[string, string | null]> = [];
  constructor(private backing: Backing) { this.cache = new Map(backing.values); backing.views.push(this); }
  getItem(k: string) { return this.cache.get(k) ?? null; }
  setItem(k: string, v: string) { this.cache.set(k, v); this.backing.values.set(k, v); this.publish(k, v); }
  removeItem(k: string) { this.cache.delete(k); this.backing.values.delete(k); this.publish(k, null); }
  deliver() { for (const [k, v] of this.pending.splice(0)) { if (v === null) this.cache.delete(k); else this.cache.set(k, v); } }
  private publish(k: string, v: string | null) { for (const view of this.backing.views) if (view !== this) view.pending.push([k, v]); }
}
// IndexedDB is coherent across tabs: a committed value is what the next lock
// holder reads. Each call settles on a later task, as the real one does.
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const fakeFence = (view: View, committed: { generation: number }, propagates = true) => {
  const calls = { converge: 0, waited: 0 };
  let highest = 0;
  const fence: DrawingJournalFence = {
    read: async () => { await tick(); highest = Math.max(highest, committed.generation); return committed.generation; },
    converge: async (seen) => {
      calls.converge += 1;
      if (seen()) return;
      calls.waited += 1;
      await tick();
      if (propagates) view.deliver();
    },
    write: async (generation) => { highest = Math.max(highest, generation); await tick(); committed.generation = Math.max(committed.generation, generation); },
    highest: () => highest,
  };
  return { fence, calls };
};
// Records the committed generation each time the lock is released.
const releasing = (committed: { generation: number }) => {
  const released: number[] = [];
  const recording = { request: (name: string, fn: () => Promise<unknown>) => locks.request(name, async () => {
    try { return await fn(); } finally { released.push(committed.generation); }
  }) } as DrawingJournalLocks;
  return { recording, released };
};
const copyIds = (backing: Backing) => {
  const view = new View(backing);
  const recovered = readDrawingJournal(view, "account:a").NVDA;
  return recovered ? [recovered, ...(recovered.alternatives ?? [])].map((copy) => copy.drawings.map((d) => d.id)) : [];
};
const race = (backing: Backing, fences: [DrawingJournalFence | null, DrawingJournalFence | null], first: View, second: View) => Promise.all([
  writeDrawingJournal(first, "account:a", { NVDA: { drawings: [line("A")], revision: null } }, locks, fences[0]),
  writeDrawingJournal(second, "account:a", { NVDA: { drawings: [], revision: null } }, locks, fences[1]),
]);

describe("journal writes across incoherent tab storage views", () => {
  it("without the fence, a lock holder whose view is stale drops the other tab's copy", async () => {
    const backing = new Backing(), first = new View(backing), second = new View(backing);
    expect(await race(backing, [null, null], first, second)).toEqual([true, true]);
    expect(copyIds(backing)).toEqual([[]]);
  });
  it("keeps both tabs' copies when the next holder waits for the committed generation", async () => {
    const backing = new Backing(), first = new View(backing), second = new View(backing), committed = { generation: 0 };
    expect(await race(backing, [fakeFence(first, committed).fence, fakeFence(second, committed).fence], first, second)).toEqual([true, true]);
    expect(copyIds(backing)).toEqual(expect.arrayContaining([["A"], []]));
    expect(copyIds(backing)).toHaveLength(2);
  });
  it("records each write's generation after the journal and commits it to the fence before the lock is released", async () => {
    const backing = new Backing(), first = new View(backing), second = new View(backing), committed = { generation: 0 };
    const { recording, released } = releasing(committed);
    const order: string[] = [];
    const setItem = first.setItem.bind(first);
    first.setItem = (k, v) => { order.push(k); setItem(k, v); };
    expect(await writeDrawingJournal(first, "account:a", { NVDA: { drawings: [line("A")], revision: null } }, recording, fakeFence(first, committed).fence)).toBe(true);
    expect(order).toEqual([DRAWING_JOURNAL_KEY, DRAWING_JOURNAL_GENERATION_KEY]);
    expect(backing.values.get(DRAWING_JOURNAL_GENERATION_KEY)).toBe("1");
    expect(await writeDrawingJournal(second, "account:a", { NVDA: { drawings: [], revision: null } }, recording, fakeFence(second, committed).fence)).toBe(true);
    await lockTail;
    expect([backing.values.get(DRAWING_JOURNAL_GENERATION_KEY), committed.generation]).toEqual(["2", 2]);
    expect(released).toEqual([1, 2]);
  });
  it("returns once the journal is stored and holds the lock until the fence commits", async () => {
    const backing = new Backing(), view = new View(backing);
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let committed = 0;
    const reads: number[] = [];
    const fence: DrawingJournalFence = {
      read: async () => { reads.push(committed); return committed; },
      converge: async () => {},
      write: async (generation) => { await held; committed = generation; },
      highest: () => committed,
    };
    expect(await writeDrawingJournal(view, "account:a", { NVDA: { drawings: [line("A")], revision: null } }, locks, fence)).toBe(true);
    expect([view.getItem(DRAWING_JOURNAL_GENERATION_KEY), committed]).toEqual(["1", 0]);
    const next = writeDrawingJournal(view, "account:a", { AAPL: { drawings: [line("B")], revision: null } }, locks, fence);
    await tick();
    // The next holder has not read the fence while the previous commit is held.
    expect(reads).toEqual([0]);
    release();
    expect(await next).toBe(true);
    expect(reads).toEqual([0, 1]);
    expect(view.getItem(DRAWING_JOURNAL_GENERATION_KEY)).toBe("2");
  });
  it("proceeds after the convergence window when the view never catches up, above every generation seen", async () => {
    const backing = new Backing(), view = new View(backing), committed = { generation: 5 };
    const { fence, calls } = fakeFence(view, committed, false);
    expect(await writeDrawingJournal(view, "account:a", { NVDA: { drawings: [line("A")], revision: null } }, locks, fence)).toBe(true);
    expect(calls.converge).toBe(1);
    await lockTail;
    expect([view.getItem(DRAWING_JOURNAL_GENERATION_KEY), committed.generation]).toEqual(["6", 6]);
  });
  it("writes without waiting when the fence cannot answer", async () => {
    const backing = new Backing(), view = new View(backing);
    view.setItem(DRAWING_JOURNAL_GENERATION_KEY, "3");
    const converge = vi.fn(async () => {}), write = vi.fn(async () => {});
    expect(await writeDrawingJournal(view, "account:a", { NVDA: { drawings: [line("A")], revision: null } }, locks, { read: async () => null, converge, write, highest: () => 0 })).toBe(true);
    expect(converge).not.toHaveBeenCalled();
    expect(view.getItem(DRAWING_JOURNAL_GENERATION_KEY)).toBe("4");
    await lockTail;
    expect(write).toHaveBeenCalledWith(4);
  });
  it("stays above every generation this tab has seen while the fence cannot answer", async () => {
    const backing = new Backing(), view = new View(backing);
    view.setItem(DRAWING_JOURNAL_GENERATION_KEY, "3");
    const write = vi.fn(async () => {});
    expect(await writeDrawingJournal(view, "account:a", { NVDA: { drawings: [line("A")], revision: null } }, locks, { read: async () => null, converge: async () => {}, write, highest: () => 7 })).toBe(true);
    expect(view.getItem(DRAWING_JOURNAL_GENERATION_KEY)).toBe("8");
    await lockTail;
    expect(write).toHaveBeenCalledWith(8);
  });
  it("does not commit a generation when the journal write fails", async () => {
    const backing = new Backing(), view = new View(backing), committed = { generation: 2 };
    view.setItem = () => { throw new Error("quota"); };
    expect(await writeDrawingJournal(view, "account:a", { NVDA: { drawings: [line("A")], revision: null } }, locks, fakeFence(view, committed).fence)).toBe(false);
    expect(committed.generation).toBe(2);
  });
  it("keeps the journal write durable but unfenced when only the generation marker cannot be stored", async () => {
    const backing = new Backing(), view = new View(backing), committed = { generation: 0 };
    const setItem = view.setItem.bind(view);
    view.setItem = (k, v) => { if (k === DRAWING_JOURNAL_GENERATION_KEY) throw new Error("quota"); setItem(k, v); };
    const { fence, calls } = fakeFence(view, committed);
    const journal = readDrawingJournal(view, "account:a");
    journal.NVDA = { drawings: [line("A")], revision: null };
    expect(await writeDrawingJournal(view, "account:a", journal, locks, fence)).toBe(true);
    expect(journal.NVDA.recoveryId).toBeTruthy();
    journal.AAPL = { drawings: [line("B")], revision: null };
    expect(await writeDrawingJournal(view, "account:a", journal, locks, fence)).toBe(true);
    await lockTail;
    // A generation no view can show is never committed, so no write waits for it.
    expect([committed.generation, calls.waited]).toEqual([0, 0]);
    expect(Object.keys(readDrawingJournal(view, "account:a")).sort()).toEqual(["AAPL", "NVDA"]);
  });
});

// A minimal IndexedDB: one object store with out-of-line keys, requests
// settling on a later task like the real API.
function fakeIndexedDB(options: { stallOpen?: boolean; failOpen?: boolean } = {}) {
  const data = new Map<string, unknown>();
  let opens = 0;
  let stalled: (() => void) | null = null;
  const later = (fn: () => void) => setTimeout(fn, 0);
  const database = {
    onversionchange: null as (() => void) | null, onclose: null as (() => void) | null,
    objectStoreNames: { contains: () => true },
    createObjectStore: () => ({}),
    close: () => {},
    transaction: () => {
      let outstanding = 0;
      const tx = { oncomplete: null as (() => void) | null, onerror: null as (() => void) | null, onabort: null as (() => void) | null, objectStore: () => store };
      const track = <T>(run: () => T) => {
        outstanding += 1;
        const req: { result?: T; onsuccess: (() => void) | null } = { onsuccess: null };
        // The handler may queue another request first, so the transaction completes after the last one.
        later(() => { req.result = run(); req.onsuccess?.(); outstanding -= 1; if (!outstanding) later(() => tx.oncomplete?.()); });
        return req;
      };
      const store = { get: (key: string) => track(() => data.get(key)), put: (value: unknown, key: string) => track(() => { data.set(key, value); return key; }) };
      return tx;
    },
  };
  const factory = {
    open: () => {
      opens += 1;
      const req: { result?: unknown; onsuccess: (() => void) | null; onerror: (() => void) | null; onblocked: (() => void) | null; onupgradeneeded: (() => void) | null } = { onsuccess: null, onerror: null, onblocked: null, onupgradeneeded: null };
      const succeed = () => later(() => { req.result = database; req.onupgradeneeded?.(); req.onsuccess?.(); });
      if (options.failOpen) later(() => req.onerror?.());
      else if (options.stallOpen) stalled = succeed;
      else succeed();
      return req;
    },
  };
  return { factory: factory as unknown as IDBFactory, data, opens: () => opens, release: () => stalled?.() };
}

describe("browser journal fence", () => {
  afterEach(() => { vi.useRealTimers(); });
  it("commits a generation that never decreases and reads it back", async () => {
    const idb = fakeIndexedDB();
    const fence = browserDrawingJournalFence(idb.factory, new EventTarget());
    expect(await fence.read()).toBe(0);
    await fence.write(4);
    await fence.write(2);
    expect(await fence.read()).toBe(4);
    expect(idb.data.get(DRAWING_JOURNAL_KEY)).toBe(4);
    expect(fence.highest()).toBe(4);
  });
  it("keeps answering after a commit outlasts the open timeout", async () => {
    vi.useFakeTimers();
    const idb = fakeIndexedDB();
    const fence = browserDrawingJournalFence(idb.factory, new EventTarget(), 2_000);
    const written = fence.write(4);
    await vi.advanceTimersByTimeAsync(10);
    await written;
    await vi.advanceTimersByTimeAsync(2_500);
    const read = fence.read();
    await vi.advanceTimersByTimeAsync(10);
    expect(await read).toBe(4);
  });
  it("backs off a stalled open without giving it up, and commits writes made meanwhile once it opens", async () => {
    vi.useFakeTimers();
    const idb = fakeIndexedDB({ stallOpen: true });
    const fence = browserDrawingJournalFence(idb.factory, new EventTarget(), 2_000, 30_000);
    const pending = fence.read();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await pending).toBeNull();
    // Backed off: answers at once, and a write is not waited on.
    expect(await fence.read()).toBeNull();
    await fence.write(3);
    expect(fence.highest()).toBe(3);
    await vi.advanceTimersByTimeAsync(30_000);
    const retried = fence.read();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await retried).toBeNull();
    idb.release();
    await vi.advanceTimersByTimeAsync(10);
    expect(idb.data.get(DRAWING_JOURNAL_KEY)).toBe(3);
    await vi.advanceTimersByTimeAsync(30_000);
    const late = fence.read();
    await vi.advanceTimersByTimeAsync(10);
    expect(await late).toBe(3);
    // Every call reused the one pending open.
    expect(idb.opens()).toBe(1);
  });
  it("stops backing off once the stalled open completes", async () => {
    vi.useFakeTimers();
    const idb = fakeIndexedDB({ stallOpen: true });
    const fence = browserDrawingJournalFence(idb.factory, new EventTarget(), 2_000, 30_000);
    const pending = fence.read();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await pending).toBeNull();
    await fence.write(5);
    idb.release();
    await vi.advanceTimersByTimeAsync(10);
    expect(idb.data.get(DRAWING_JOURNAL_KEY)).toBe(5);
    // Well inside the backoff window, the opened database answers again.
    const read = fence.read();
    await vi.advanceTimersByTimeAsync(10);
    expect(await read).toBe(5);
  });
  it("answers null for the tab's lifetime after the open fails", async () => {
    vi.useFakeTimers();
    const idb = fakeIndexedDB({ failOpen: true });
    const fence = browserDrawingJournalFence(idb.factory, new EventTarget(), 2_000, 30_000);
    const pending = fence.read();
    await vi.advanceTimersByTimeAsync(10);
    expect(await pending).toBeNull();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await fence.read()).toBeNull();
    await fence.write(2);
    await vi.advanceTimersByTimeAsync(10);
    expect([idb.opens(), idb.data.size]).toEqual([1, 0]);
  });
  it("resolves on the storage event that shows the committed generation", async () => {
    vi.useFakeTimers();
    const target = new EventTarget();
    const fence = browserDrawingJournalFence(fakeIndexedDB().factory, target);
    let generation = 1;
    let settled = false;
    const done = fence.converge(() => generation >= 2, DRAWING_JOURNAL_CONVERGENCE_MS).then(() => { settled = true; });
    target.dispatchEvent(new Event("storage"));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    generation = 2;
    target.dispatchEvent(new Event("storage"));
    await done;
    expect(settled).toBe(true);
    // The listener is gone: a later event does not re-run the check.
    const seen = vi.fn(() => false);
    const late = fence.converge(seen, 10);
    await vi.advanceTimersByTimeAsync(10);
    await late;
    seen.mockClear();
    target.dispatchEvent(new Event("storage"));
    expect(seen).not.toHaveBeenCalled();
  });
  it("gives up at the deadline when the view never catches up", async () => {
    vi.useFakeTimers();
    const fence = browserDrawingJournalFence(fakeIndexedDB().factory, new EventTarget());
    let settled = false;
    const done = fence.converge(() => false, DRAWING_JOURNAL_CONVERGENCE_MS).then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(DRAWING_JOURNAL_CONVERGENCE_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(settled).toBe(true);
  });
  it("returns at once when the view already shows the committed generation", async () => {
    const fence = browserDrawingJournalFence(fakeIndexedDB().factory, new EventTarget());
    await expect(fence.converge(() => true, DRAWING_JOURNAL_CONVERGENCE_MS)).resolves.toBeUndefined();
  });
});

describe("journal writes through the IndexedDB fence", () => {
  it("does not wait between one tab's own writes", async () => {
    const idb = fakeIndexedDB(), view = new View(new Backing()), target = new EventTarget();
    const listen = vi.spyOn(target, "addEventListener");
    const fence = browserDrawingJournalFence(idb.factory, target);
    expect(await writeDrawingJournal(view, "account:a", { NVDA: { drawings: [line("A")], revision: null } }, locks, fence)).toBe(true);
    expect(await writeDrawingJournal(view, "account:a", { AAPL: { drawings: [line("B")], revision: null } }, locks, fence)).toBe(true);
    await lockTail;
    expect(listen).not.toHaveBeenCalled();
    expect([view.getItem(DRAWING_JOURNAL_GENERATION_KEY), idb.data.get(DRAWING_JOURNAL_KEY)]).toEqual(["2", 2]);
  });
  it("makes the next tab wait for its view to show the committed write", async () => {
    const idb = fakeIndexedDB(), backing = new Backing(), first = new View(backing), second = new View(backing);
    const secondTarget = new EventTarget();
    const waiting = new Promise<void>((resolve) => { vi.spyOn(secondTarget, "addEventListener").mockImplementation(function (this: EventTarget, ...args) { EventTarget.prototype.addEventListener.apply(this, args); resolve(); }); });
    const written = race(backing, [browserDrawingJournalFence(idb.factory, new EventTarget()), browserDrawingJournalFence(idb.factory, secondTarget)], first, second);
    await waiting;
    second.deliver();
    secondTarget.dispatchEvent(new Event("storage"));
    expect(await written).toEqual([true, true]);
    expect(copyIds(backing)).toEqual(expect.arrayContaining([["A"], []]));
    expect(copyIds(backing)).toHaveLength(2);
    await lockTail;
    expect(idb.data.get(DRAWING_JOURNAL_KEY)).toBe(2);
  });
});
