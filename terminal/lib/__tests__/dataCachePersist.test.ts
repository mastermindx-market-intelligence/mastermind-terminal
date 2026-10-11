/**
 * dataCachePersist.test.ts — unit tests for the IndexedDB persistence layer added
 * to lib/dataCache.ts (write-through / read-back) and lib/idbJsonStore.ts.
 *
 * Two tiers of coverage:
 *   A. PURE logic, no IDB at all — the size-estimation / eviction decision
 *      (estimatePersistBytes / shouldPersist) and the seed-freshness classifier
 *      (_seedDecision: "IDB result seeds memory with correct ts + normal rules").
 *   B. END-TO-END through a minimal in-memory fake `indexedDB` installed on
 *      globalThis, exercising the REAL getJSON / prefetch / idbGet / idbPut code
 *      paths — verifying a persisted record seeds memory with the PERSISTED ts.
 *
 * In the default vitest node env indexedDB is undefined (verified separately), so
 * these tests must install the fake themselves. Tier B is skipped structurally if
 * structuredClone is somehow unavailable.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  estimatePersistBytes,
  shouldPersist,
  PER_ROW_BYTES,
  MAX_RECORD_BYTES,
  isAvailable,
} from "../idbJsonStore";
import { _seedDecision, type SeedDecision } from "../dataCache";
import { makeFakeIndexedDB, type Rec } from "./helpers/fakeIndexedDB";

// ───────────────────────────────────────────────────────────────────────────
// Tier A — pure decision logic (no IndexedDB required)
// ───────────────────────────────────────────────────────────────────────────

describe("idbJsonStore.estimatePersistBytes — cheap size estimate (no double stringify)", () => {
  it("estimates an array as length × PER_ROW_BYTES", () => {
    expect(estimatePersistBytes([])).toBe(0);
    expect(estimatePersistBytes(new Array(10).fill(0))).toBe(10 * PER_ROW_BYTES);
    expect(estimatePersistBytes(new Array(1000).fill({ o: 1, h: 2, l: 3, c: 4 }))).toBe(
      1000 * PER_ROW_BYTES,
    );
  });

  it("estimates a bars-wrapper object via its inner array", () => {
    expect(estimatePersistBytes({ bars: new Array(5).fill(0) })).toBe(5 * PER_ROW_BYTES);
    expect(estimatePersistBytes({ candles: new Array(7).fill(0) })).toBe(7 * PER_ROW_BYTES);
    expect(estimatePersistBytes({ rows: new Array(3).fill(0) })).toBe(3 * PER_ROW_BYTES);
  });

  it("returns null (no cheap estimate → persist unconditionally) for other shapes", () => {
    expect(estimatePersistBytes(null)).toBeNull();
    expect(estimatePersistBytes(undefined)).toBeNull();
    expect(estimatePersistBytes("a string")).toBeNull();
    expect(estimatePersistBytes(42)).toBeNull();
    expect(estimatePersistBytes({ intel: "x", score: 1 })).toBeNull(); // plain object, no inner array
  });
});

describe("idbJsonStore.shouldPersist — single-record 8MB safety cap decision", () => {
  it("rejects an array whose estimate exceeds MAX_RECORD_BYTES", () => {
    const overRows = Math.ceil(MAX_RECORD_BYTES / PER_ROW_BYTES) + 100;
    expect(shouldPersist(new Array(overRows).fill(0))).toBe(false);
  });

  it("accepts an array right at/under the cap", () => {
    const atRows = Math.floor(MAX_RECORD_BYTES / PER_ROW_BYTES); // estimate <= cap
    expect(shouldPersist(new Array(atRows).fill(0))).toBe(true);
    expect(shouldPersist([1, 2, 3])).toBe(true);
  });

  it("persists unconditionally when the value cannot be cheaply estimated (null estimate)", () => {
    expect(shouldPersist({ any: "object" })).toBe(true);
    expect(shouldPersist("string")).toBe(true);
    expect(shouldPersist(null)).toBe(true);
  });

  it("rejects a large bars-wrapper object via its inner array length", () => {
    const overRows = Math.ceil(MAX_RECORD_BYTES / PER_ROW_BYTES) + 1;
    expect(shouldPersist({ bars: new Array(overRows).fill(0) })).toBe(false);
  });
});

describe("dataCache._seedDecision — seed-with-persisted-ts freshness classifier", () => {
  const TTL = 60_000;

  it("classifies a within-ttl record as fresh (serve from disk, no network)", () => {
    expect(_seedDecision(1_000, 1_000 + 30_000, TTL, true)).toBe<SeedDecision>("fresh");
    expect(_seedDecision(1_000, 1_000 + 30_000, TTL, false)).toBe<SeedDecision>("fresh");
    // Freshness uses the PERSISTED ts, not now: a record persisted 1ms ago is fresh.
    expect(_seedDecision(1_000, 1_001, TTL, true)).toBe<SeedDecision>("fresh");
  });

  it("classifies an expired record as stale-swr when swr is on", () => {
    expect(_seedDecision(1_000, 1_000 + 90_000, TTL, true)).toBe<SeedDecision>("stale-swr");
  });

  it("classifies an expired record as refetch when swr is off", () => {
    expect(_seedDecision(1_000, 1_000 + 90_000, TTL, false)).toBe<SeedDecision>("refetch");
  });

  it("treats age === ttl as stale (strict age < ttl freshness boundary)", () => {
    expect(_seedDecision(0, TTL, TTL, true)).toBe<SeedDecision>("stale-swr");
    expect(_seedDecision(0, TTL, TTL, false)).toBe<SeedDecision>("refetch");
    // one ms under the boundary is fresh
    expect(_seedDecision(0, TTL - 1, TTL, true)).toBe<SeedDecision>("fresh");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Tier B — end-to-end through a minimal in-memory fake IndexedDB
// (./helpers/fakeIndexedDB — shared with the Heatmap's persisted-copy suite).
//
// The fake is intentionally small; it validates the WIRING (seed memory with the
// persisted ts and apply freshness) against real code, not IDB spec conformance.
// ───────────────────────────────────────────────────────────────────────────

// Load dataCache/idbJsonStore FRESH per test with the fake installed, so the
// module-level open-promise cache starts clean each time.
async function freshModules() {
  vi.resetModules();
  const idb = await import("../idbJsonStore");
  const dc = await import("../dataCache");
  return { idb, dc };
}

describe("dataCache × idbJsonStore — end-to-end read-back through a fake IndexedDB", () => {
  let fake: ReturnType<typeof makeFakeIndexedDB>;
  const realIDB = (globalThis as any).indexedDB;
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    fake = makeFakeIndexedDB();
    (globalThis as any).indexedDB = fake;
  });

  afterEach(() => {
    if (realIDB === undefined) delete (globalThis as any).indexedDB;
    else (globalThis as any).indexedDB = realIDB;
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("isAvailable() reflects the injected indexedDB", async () => {
    const { idb } = await freshModules();
    expect(idb.isAvailable()).toBe(true);
  });

  it("getJSON serves FRESH persisted data from IDB on a full memory miss WITHOUT a network fetch", async () => {
    const { idb, dc } = await freshModules();
    const url = "/data/FRESHSYM.json";
    // Seed IDB directly with a fresh (just-now) record.
    await idb.idbPut(url, [{ o: 1, h: 2, l: 3, c: 4 }], Date.now());

    const fetchSpy = vi.fn(() => Promise.reject(new Error("network must not be called")));
    globalThis.fetch = fetchSpy as any;

    const out = await dc.getJSON(url);
    expect(out).toEqual([{ o: 1, h: 2, l: 3, c: 4 }]);
    expect(fetchSpy).not.toHaveBeenCalled();
    // Memory is now seeded → a second read is a pure memory hit.
    expect(dc.peek(url)).toEqual([{ o: 1, h: 2, l: 3, c: 4 }]);
  });

  it("seeds memory with the PERSISTED ts (not now): a stale IDB record serves stale + revalidates", async () => {
    const { idb, dc } = await freshModules();
    const url = "/data/STALESYM.json";
    const staleTs = Date.now() - 5 * 60_000; // 5 min old → beyond 60s ttl
    await idb.idbPut(url, [{ stale: true }], staleTs);

    // Background revalidation should fire exactly one network fetch returning new data.
    const fresh = [{ stale: false, fresh: true }];
    const fetchSpy = vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(fresh) } as any),
    );
    globalThis.fetch = fetchSpy as any;

    // First call: served STALE from disk immediately (proves ts carried through:
    // had ts been rewritten to now, this would have been classified fresh and we
    // could not distinguish — so we assert the background fetch DID run).
    const out = await dc.getJSON(url);
    expect(out).toEqual([{ stale: true }]);

    // Let the fire-and-forget background revalidation settle.
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // Memory now holds the revalidated data.
    expect(dc.peek(url)).toEqual(fresh);
  });

  it("write-through: a successful getJSON network fetch persists to IDB for the next reader", async () => {
    const { idb, dc } = await freshModules();
    const url = "/data/WRITETHRU.json";
    const payload = [{ a: 1 }, { a: 2 }];
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(payload) } as any),
    ) as any;

    const out = await dc.getJSON(url);
    expect(out).toEqual(payload);

    // Write-through is fire-and-forget; give it a tick, then read straight from IDB.
    await new Promise((r) => setTimeout(r, 20));
    const rec = await idb.idbGet(url);
    expect(rec).not.toBeNull();
    expect(rec!.data).toEqual(payload);
    expect(typeof rec!.ts).toBe("number");
  });

  it("oversized values are NOT written through (8MB single-record cap)", async () => {
    const { idb, dc } = await freshModules();
    const url = "/data/HUGE.json";
    const overRows = Math.ceil(MAX_RECORD_BYTES / PER_ROW_BYTES) + 10;
    const huge = new Array(overRows).fill({ o: 1 });
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(huge) } as any),
    ) as any;

    const out = await dc.getJSON(url);
    expect(Array.isArray(out)).toBe(true); // caller still gets the data
    await new Promise((r) => setTimeout(r, 20));
    // ...but nothing landed in IDB.
    expect(await idb.idbGet(url)).toBeNull();
  });

  it("invalidate(url) removes the IDB record (fire-and-forget)", async () => {
    const { idb, dc } = await freshModules();
    const url = "/data/DROPME.json";
    await idb.idbPut(url, [1, 2, 3], Date.now());
    expect(await idb.idbGet(url)).not.toBeNull();

    dc.invalidate(url);
    await new Promise((r) => setTimeout(r, 20));
    expect(await idb.idbGet(url)).toBeNull();
  });

  it("eviction sweep trims the store to RECORD_CAP oldest-first", async () => {
    const { idb } = await freshModules();
    // Put cap + a handful, with strictly increasing ts so 'oldest' is unambiguous.
    const total = idb.RECORD_CAP + 5;
    for (let i = 0; i < total; i++) {
      await idb.idbPut(`/data/E${i}.json`, [i], 1_000 + i);
    }
    // idbPut runs eviction only every EVICT_EVERY puts; force a deterministic sweep.
    await idb.evictIfNeeded();
    await new Promise((r) => setTimeout(r, 20));

    // The 5 oldest (E0..E4) should be gone; the newest should remain.
    expect(await idb.idbGet("/data/E0.json")).toBeNull();
    expect(await idb.idbGet(`/data/E${total - 1}.json`)).not.toBeNull();
    // Count is back at the cap.
    expect(fake._data.size).toBe(idb.RECORD_CAP);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Tier C — blocked / limbo IndexedDB whose open() NEVER settles.
//
// Regression guard for the live Chrome hang: a pending deleteDatabase from
// another tab, a stuck version upgrade, or storage pressure can leave
// indexedDB.open() hanging with NO success, error, or blocked event. The
// read-back await on getJSON/prefetch used to hang forever and blank the
// terminal. The fix (idbGet races its whole body against ~250ms, then LATCHES
// the store off) must make the terminal fall through to the network exactly as a
// cache miss — and never pay the timeout twice.
//
// Uses vitest fake timers so the ~250ms budget elapses instantly and
// deterministically (no real wall-clock wait).
// ───────────────────────────────────────────────────────────────────────────

function makeNeverSettlingIndexedDB() {
  // open() hands back a request object and then does NOTHING — no onsuccess,
  // no onerror, no onblocked is ever fired, mirroring a blocked/limbo IDB.
  let openCalls = 0;
  return {
    get openCalls() {
      return openCalls;
    },
    open: (_name: string, _version?: number) => {
      openCalls++;
      return { onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null, result: undefined };
    },
  };
}

describe("dataCache × idbJsonStore — blocked IDB whose open() never settles (timeout + latch)", () => {
  let neverDb: ReturnType<typeof makeNeverSettlingIndexedDB>;
  const realIDB = (globalThis as any).indexedDB;
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
    neverDb = makeNeverSettlingIndexedDB();
    (globalThis as any).indexedDB = neverDb;
  });

  afterEach(() => {
    vi.useRealTimers();
    if (realIDB === undefined) delete (globalThis as any).indexedDB;
    else (globalThis as any).indexedDB = realIDB;
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("(a) getJSON still resolves via the network when open() never settles — bounded, not hung", async () => {
    const { idb, dc } = await freshModules();
    (globalThis as any).indexedDB = neverDb; // re-install after resetModules
    const url = "/data/BLOCKED.json";
    const payload = [{ o: 1, h: 2, l: 3, c: 4 }];
    const fetchSpy = vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(payload) } as any),
    );
    globalThis.fetch = fetchSpy as any;

    // Kick off the read-back. It will await idbGet, which parks on the ~250ms race.
    const p = dc.getJSON(url);

    // Drive fake time PAST the read timeout. With real IDB this open() never
    // fires, so only the timeout can unblock the race. advanceTimersByTimeAsync
    // also flushes the microtasks that carry the subsequent network fetch.
    await vi.advanceTimersByTimeAsync(idb.IDB_READ_TIMEOUT_MS + 5);

    const out = await p;
    expect(out).toEqual(payload); // data delivered via network, terminal not blank
    expect(fetchSpy).toHaveBeenCalledTimes(1); // fell through to network exactly as a miss
    expect(idb._isIdbDead()).toBe(true); // the store latched off on timeout
  });

  it("(b) the latch prevents a SECOND timeout stall: second call short-circuits, open() not re-invoked", async () => {
    const { idb, dc } = await freshModules();
    (globalThis as any).indexedDB = neverDb;
    const payload = [{ a: 1 }];
    const fetchSpy = vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(payload) } as any),
    );
    globalThis.fetch = fetchSpy as any;

    // First call pays the timeout once and latches the store dead.
    const p1 = dc.getJSON("/data/FIRST.json");
    await vi.advanceTimersByTimeAsync(idb.IDB_READ_TIMEOUT_MS + 5);
    await p1;
    expect(idb._isIdbDead()).toBe(true);
    const opensAfterFirst = neverDb.openCalls;
    expect(opensAfterFirst).toBeGreaterThanOrEqual(1);

    // Second call, DIFFERENT url (full memory miss again). If the latch works it
    // must NOT open IDB and must NOT wait for a timeout — it resolves purely from
    // the network. Prove "no wait" two ways: (1) open() count is unchanged, and
    // (2) the promise resolves WITHOUT advancing the fake clock at all.
    const p2 = dc.getJSON("/data/SECOND.json");
    // Only flush microtasks (no timer advance) — a stalled call would still be
    // pending here because its 250ms timer hasn't been driven.
    await vi.advanceTimersByTimeAsync(0);
    const out2 = await p2;

    expect(out2).toEqual(payload);
    expect(neverDb.openCalls).toBe(opensAfterFirst); // latch skipped IDB entirely — no new open()
    expect(fetchSpy).toHaveBeenCalledTimes(2); // both served from network
  });

  it("(c) idbGet resolves null under the timeout and latches; a subsequent idbGet returns instantly", async () => {
    // Direct unit-level assertion on the store itself (no dataCache), pinning the
    // idbGet contract the read-back relies on.
    const { idb } = await freshModules();
    (globalThis as any).indexedDB = neverDb;

    const first = idb.idbGet("/data/X.json");
    await vi.advanceTimersByTimeAsync(idb.IDB_READ_TIMEOUT_MS + 5);
    expect(await first).toBeNull();
    expect(idb._isIdbDead()).toBe(true);
    const opensAfterFirst = neverDb.openCalls;

    // Latched: returns null immediately, opens nothing, needs no timer advance.
    const second = idb.idbGet("/data/Y.json");
    await vi.advanceTimersByTimeAsync(0);
    expect(await second).toBeNull();
    expect(neverDb.openCalls).toBe(opensAfterFirst);
  });

  it("(d) write-through put() is a no-op once the store is latched off", async () => {
    const { idb } = await freshModules();
    (globalThis as any).indexedDB = neverDb;

    // Latch it off via a timed-out read.
    const r = idb.idbGet("/data/Z.json");
    await vi.advanceTimersByTimeAsync(idb.IDB_READ_TIMEOUT_MS + 5);
    await r;
    expect(idb._isIdbDead()).toBe(true);
    const opensAfterRead = neverDb.openCalls;

    // A put must now short-circuit: it must not open IDB and must resolve (no-op).
    await idb.idbPut("/data/Z.json", [1, 2, 3], Date.now());
    await vi.advanceTimersByTimeAsync(0);
    expect(neverDb.openCalls).toBe(opensAfterRead); // put opened nothing
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Tier D — self-heal of a store-less DB (missing "json" object store).
//
// Regression guard: if "mm-data-cache" already exists at the current version but
// WITHOUT the "json" store — real causes: same-origin code called
// indexedDB.open("mm-data-cache", 1) with no upgrade handler before the app did,
// or a crashed/aborted upgrade — then onupgradeneeded never fires again at that
// version and every transaction("json") throws NotFoundError FOREVER, killing
// persistence for the lifetime of the profile with no self-heal.
//
// The fix: after a successful open, openDB checks db.objectStoreNames.contains
// (STORE); if missing it reopens ONCE at db.version+1 (never a hardcoded 2), whose
// onupgradeneeded creates the store + ts index via the SAME helper as a fresh
// install. A failed/blocked/timed-out heal (or a heal that still lacks the store)
// latches idbDead exactly as a hard failure. The whole heal lives inside openDB's
// promise, so idbGet's 250ms race and every caller are untouched.
//
// This fake models a store set as LIVE state: objectStoreNames.contains reads it,
// createObjectStore (invoked by the real ensureStore inside onupgradeneeded) adds
// to it — so the healed store is created through the production code path, and the
// post-heal contains() check reflects reality. It records every version passed to
// open() so tests can prove the reopen happened at version+1.
// ───────────────────────────────────────────────────────────────────────────

type HealFakeOpts = {
  // Store names present BEFORE the app opens (empty → store-less DB to be healed).
  initialStores?: string[];
  // Starting on-disk version the DB reports.
  initialVersion?: number;
  // If set, the Nth open() call (1-based) never settles (no success/error/blocked)
  // — models a heal reopen that hangs, so the read-timeout+latch path is exercised.
  neverSettleOnCall?: number;
};

function makeHealFakeIndexedDB(opts: HealFakeOpts = {}) {
  const storeNames = new Set<string>(opts.initialStores ?? []);
  const data = new Map<string, Rec>();
  let version = opts.initialVersion ?? 1;
  const openVersions: number[] = [];

  function fire<T>(makeResult: () => T) {
    const req: any = { onsuccess: null, onerror: null, result: undefined };
    queueMicrotask(() => {
      try {
        req.result = makeResult();
        req.onsuccess && req.onsuccess({ target: req });
      } catch (e) {
        req.onerror && req.onerror({ target: req });
      }
    });
    return req;
  }

  function makeStore() {
    return {
      get: (url: string) => fire(() => data.get(url)),
      put: (rec: Rec) =>
        fire(() => {
          data.set(rec.url, rec);
          return rec.url;
        }),
      delete: (url: string) =>
        fire(() => {
          data.delete(url);
          return undefined;
        }),
      clear: () =>
        fire(() => {
          data.clear();
          return undefined;
        }),
      count: () => fire(() => data.size),
      index: (_name: string) => ({ openCursor: () => fire(() => null) }),
      createIndex: () => {},
    };
  }

  const db: any = {
    // Reads LIVE store state so a heal's createObjectStore flips contains() to true.
    get objectStoreNames() {
      return { contains: (n: string) => storeNames.has(n) };
    },
    get version() {
      return version;
    },
    // Invoked by the real ensureStore() from within onupgradeneeded.
    createObjectStore: (name: string) => {
      storeNames.add(name);
      return makeStore();
    },
    transaction: (store: string, _mode?: string) => {
      // Mirror real IDB: a transaction naming an absent store throws NotFoundError.
      if (!storeNames.has(store)) {
        throw new DOMException(`store ${store} not found`, "NotFoundError");
      }
      const tx: any = { oncomplete: null, onerror: null, onabort: null, objectStore: () => makeStore() };
      queueMicrotask(() => queueMicrotask(() => tx.oncomplete && tx.oncomplete({ target: tx })));
      return tx;
    },
    close: () => {},
    onversionchange: null,
  };

  return {
    _data: data,
    _storeNames: storeNames,
    get openVersions() {
      return openVersions;
    },
    get openCalls() {
      return openVersions.length;
    },
    open: (_name: string, v?: number) => {
      const callNo = openVersions.length + 1;
      openVersions.push(v ?? 1);
      const req: any = {
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
        onblocked: null,
        result: db,
      };
      // Model a hung reopen: hand back the request and never fire anything.
      if (opts.neverSettleOnCall === callNo) return req;
      queueMicrotask(() => {
        // Fire upgrade only when the requested version exceeds the on-disk one,
        // exactly as real IDB — this is what lets the heal (version+1) create the
        // store while a same-version open would NOT.
        if ((v ?? 1) > version) {
          version = v ?? 1;
          req.onupgradeneeded && req.onupgradeneeded({ target: req });
        }
        req.onsuccess && req.onsuccess({ target: req });
      });
      return req;
    },
  };
}

describe("idbJsonStore — self-heal when the DB exists without the 'json' store", () => {
  const realIDB = (globalThis as any).indexedDB;
  const realFetch = globalThis.fetch;

  afterEach(() => {
    if (realIDB === undefined) delete (globalThis as any).indexedDB;
    else (globalThis as any).indexedDB = realIDB;
    globalThis.fetch = realFetch;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("(a) a pre-created store-less DB heals: reopen at version+1 creates the store and put+get round-trips", async () => {
    const { idb } = await freshModules();
    // DB already exists at v1 with NO "json" store (the reproduced bug).
    const heal = makeHealFakeIndexedDB({ initialStores: [], initialVersion: 1 });
    (globalThis as any).indexedDB = heal;

    // A round-trip that can only succeed if the store was created by the heal.
    const url = "/data/HEALME.json";
    await idb.idbPut(url, [{ o: 1, h: 2, l: 3, c: 4 }], 5_000);
    const rec = await idb.idbGet(url);

    expect(rec).not.toBeNull();
    expect(rec!.data).toEqual([{ o: 1, h: 2, l: 3, c: 4 }]);
    expect(rec!.ts).toBe(5_000);

    // The store now exists...
    expect(heal._storeNames.has("json")).toBe(true);
    // ...and it was created by a reopen at exactly (opened version + 1), computed
    // from the live handle — NOT a hardcoded 2. The relational assertion holds
    // whatever DB_VERSION is: the heal open is always one past the first open.
    expect(heal.openVersions).toHaveLength(2);
    expect(heal.openVersions[0]).toBe(idb.DB_VERSION); // first open at DB_VERSION
    expect(heal.openVersions[1]).toBe(heal.openVersions[0] + 1); // heal at version+1
    expect(idb._isIdbDead()).toBe(false); // healed cleanly, store NOT latched off
  });

  it("(b) heal failure (second open never settles) latches idbDead and getJSON still resolves via network", async () => {
    vi.useFakeTimers();
    const { idb, dc } = await freshModules();
    // First open succeeds but is store-less → triggers a heal; the SECOND open
    // (the heal reopen) never settles, so only idbGet's 250ms timeout can unblock.
    const heal = makeHealFakeIndexedDB({ initialStores: [], initialVersion: 1, neverSettleOnCall: 2 });
    (globalThis as any).indexedDB = heal;

    const url = "/data/HEALFAIL.json";
    const payload = [{ o: 9, h: 9, l: 9, c: 9 }];
    const fetchSpy = vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(payload) } as any),
    );
    globalThis.fetch = fetchSpy as any;

    // Read-back parks on the ~250ms race because the heal reopen hangs.
    const p = dc.getJSON(url);
    await vi.advanceTimersByTimeAsync(idb.IDB_READ_TIMEOUT_MS + 5);

    const out = await p;
    expect(out).toEqual(payload); // data delivered via network, terminal not blank
    expect(fetchSpy).toHaveBeenCalledTimes(1); // fell through to network as a miss
    expect(idb._isIdbDead()).toBe(true); // hung heal latched the store off
    // Both opens were attempted (initial + the heal reopen that then hung).
    expect(heal.openVersions).toEqual([1, 2]);
  });

  it("(c) a healthy DB (store present) does NOT trigger a versioned reopen — exactly one open()", async () => {
    const { idb } = await freshModules();
    // Store already present → no heal needed.
    const heal = makeHealFakeIndexedDB({ initialStores: ["json"], initialVersion: 1 });
    (globalThis as any).indexedDB = heal;

    await idb.idbPut("/data/HEALTHY.json", [1, 2, 3], 2_000);
    const rec = await idb.idbGet("/data/HEALTHY.json");

    expect(rec).not.toBeNull();
    expect(rec!.data).toEqual([1, 2, 3]);
    // The whole point: no version+1 reopen. Exactly one open(), at DB_VERSION.
    expect(heal.openCalls).toBe(1);
    expect(heal.openVersions).toEqual([idb.DB_VERSION]);
    expect(idb._isIdbDead()).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// onRevalidate — the SWR result must reach the CALLER, not just the cache
//
// REGRESSION (production, 2026-08-07): every reload is a full memory miss and any
// persisted record is past the 60s TTL, so `/data/manifest.json` was ALWAYS served
// from IndexedDB via the "stale-swr" branch. `getJSON` resolved once — with the stale
// board — and the revalidated copy landed only in the cache. Consumers fetch on mount,
// so the Terminal painted whatever this browser cached on its LAST visit and never
// corrected it: the app showed the 2026-08-05 session while the network served 08-06.
// ───────────────────────────────────────────────────────────────────────────
describe("dataCache.onRevalidate — a stale-while-revalidate serve corrects itself", () => {
  let fake: ReturnType<typeof makeFakeIndexedDB>;
  const realIDB = (globalThis as any).indexedDB;
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    fake = makeFakeIndexedDB();
    (globalThis as any).indexedDB = fake;
  });

  afterEach(() => {
    if (realIDB === undefined) delete (globalThis as any).indexedDB;
    else (globalThis as any).indexedDB = realIDB;
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("delivers the revalidated manifest after serving the stale one from IDB", async () => {
    const { idb, dc } = await freshModules();
    const url = "/data/manifest.json";
    const staleBoard = { as_of: "2026-08-05", symbols: { NVDA: { last: 219.22, chg: 3.43 } } };
    const freshBoard = { as_of: "2026-08-06", symbols: { NVDA: { last: 222.985, chg: 1.82 } } };
    // Persisted two days ago — exactly the state of a browser revisiting the Terminal.
    await idb.idbPut(url, staleBoard, Date.now() - 2 * 24 * 60 * 60 * 1000);

    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(freshBoard) } as any),
    ) as any;

    const seen: any[] = [];
    const first = await dc.getJSON(url, { onRevalidate: (m) => seen.push(m) });

    // Instant paint is preserved: the caller still gets the persisted board immediately.
    expect(first).toEqual(staleBoard);

    await new Promise((r) => setTimeout(r, 20));
    // ...and is then handed the corrected one. Before the fix `seen` stayed empty and
    // the 08-05 board was pinned for the life of the page.
    expect(seen).toEqual([freshBoard]);
  });

  it("does not fire when the persisted copy is still fresh (no network, no callback)", async () => {
    const { idb, dc } = await freshModules();
    const url = "/data/manifest.json";
    const board = { as_of: "2026-08-06", symbols: {} };
    await idb.idbPut(url, board, Date.now()); // within the 60s TTL

    const fetchSpy = vi.fn(() => Promise.reject(new Error("network must not be called")));
    globalThis.fetch = fetchSpy as any;

    const seen: any[] = [];
    expect(await dc.getJSON(url, { onRevalidate: (m) => seen.push(m) })).toEqual(board);
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(seen).toEqual([]);
  });

  it("a throwing consumer cannot break the cache commit", async () => {
    const { idb, dc } = await freshModules();
    const url = "/data/manifest.json";
    await idb.idbPut(url, { as_of: "old" }, Date.now() - 10 * 60_000);
    const freshBoard = { as_of: "new" };
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(freshBoard) } as any),
    ) as any;

    await dc.getJSON(url, { onRevalidate: () => { throw new Error("consumer blew up"); } });
    await new Promise((r) => setTimeout(r, 20));
    expect(dc.peek(url)).toEqual(freshBoard);
  });
});
