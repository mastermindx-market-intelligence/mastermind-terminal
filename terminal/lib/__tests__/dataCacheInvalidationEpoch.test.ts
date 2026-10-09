// @vitest-environment jsdom
/**
 * dataCacheInvalidationEpoch.test.ts — an invalidation is a boundary no older completion crosses.
 *
 * `invalidate(url?)` cleared memory and deleted the IndexedDB record, but a read-back that was
 * already awaiting `idbGet` kept its own copy of the record. When it resolved it SEEDED memory with
 * the record the caller had just thrown away and answered it — so a Retry, a same-symbol
 * correction or a whole-cache clear could be undone by a disk read that started a moment earlier.
 * Real IndexedDB behaves exactly this way: a readonly transaction created before the delete's
 * readwrite transaction reads the old value (see e2e/cache-invalidation-epoch.spec.ts for the
 * native-browser witness). The mock below models that with a snapshot taken at call time.
 *
 * The network side already had request identity (a registered `inflight`), which this suite keeps
 * pinned as regression guards. The new requirement is a generation fence shared by every disk and
 * network completion: per key and for the whole cache.
 *
 * Existing contract kept on purpose: a caller still receives ITS OWN network request's outcome
 * (dataCacheRequestOwnership.test.ts). What an outdated completion may not do is reach memory,
 * disk, the absence cache or an `onRevalidate` subscriber.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Rec = { url: string; data: unknown; ts: number };

const disk = vi.hoisted(() => {
  const records = new Map<string, { url: string; data: unknown; ts: number }>();
  const pending: Array<() => void> = [];
  const puts: Array<{ url: string; data: unknown }> = [];
  return { records, pending, puts, hold: false, gets: 0 };
});

vi.mock("../idbJsonStore", () => ({
  isAvailable: () => true,
  // A held read keeps the snapshot it took when it was issued — a real readonly transaction that
  // was created before the delete reads the record the delete is about to remove.
  idbGet: (url: string) => {
    disk.gets += 1;
    const snapshot = disk.records.get(url) ?? null;
    if (!disk.hold) return Promise.resolve(snapshot);
    return new Promise<Rec | null>((resolve) => { disk.pending.push(() => resolve(snapshot)); });
  },
  idbPut: async (url: string, data: unknown, ts: number) => {
    disk.puts.push({ url, data });
    disk.records.set(url, { url, data, ts });
  },
  idbDelete: async (url: string) => { disk.records.delete(url); },
  idbClear: async () => { disk.records.clear(); },
}));

import {
  _neg404Has,
  _resetCoverage,
  getJSONResult,
  invalidate,
  loadCoverage,
  peek,
  prefetch,
} from "../dataCache";

const U = "/data/NVDA.json";
const OLD = [{ time: "2026-10-07", close: 100 }];
const NEW = [{ time: "2026-10-07", close: 104 }];

const okJson = (data: unknown) => ({ ok: true, status: 200, json: async () => data }) as unknown as Response;
const status = (code: number) => ({ ok: false, status: code, json: async () => ({}) }) as unknown as Response;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
/** Let fire-and-forget continuations (prefetch IIFE, write-through) settle. */
const settle = async () => { for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0)); };
/** Release every held disk read, in issue order, and stop holding new ones. */
const releaseDisk = () => { disk.hold = false; disk.pending.splice(0).forEach((go) => go()); };
const persist = (url: string, data: unknown, ts = Date.now()) => disk.records.set(url, { url, data, ts });

beforeEach(() => {
  invalidate();
  _resetCoverage();
  disk.records.clear(); disk.pending.length = 0; disk.puts.length = 0; disk.hold = false; disk.gets = 0;
});
afterEach(() => {
  releaseDisk();
  invalidate();
  _resetCoverage();
  vi.unstubAllGlobals();
});

describe("an old disk completion cannot cross a per-key invalidation", () => {
  it("a read-back pending across invalidate(url) neither answers nor seeds the invalidated record", async () => {
    persist(U, OLD);                                   // fresh on disk: would skip the network
    const fetcher = vi.fn(async () => okJson(NEW)); vi.stubGlobal("fetch", fetcher);
    disk.hold = true;
    const outcome = getJSONResult(U);
    invalidate(U);
    releaseDisk();
    expect(await outcome).toEqual({ status: "data", data: NEW });
    expect(peek(U)).toEqual(NEW);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("a prefetch pending across invalidate(url) does not repopulate memory", async () => {
    persist(U, OLD);
    const fetcher = vi.fn(async () => okJson(NEW)); vi.stubGlobal("fetch", fetcher);
    disk.hold = true;
    prefetch(U);
    invalidate(U);
    releaseDisk(); await settle();
    expect(peek(U)).toBeUndefined();
    expect(await getJSONResult(U)).toEqual({ status: "data", data: NEW });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("a stale-while-revalidate read-back does not serve the invalidated copy or publish to onRevalidate", async () => {
    persist(U, OLD, Date.now() - 5 * 60_000);          // stale on disk: would serve + revalidate
    const fetcher = vi.fn(async () => okJson(NEW)); vi.stubGlobal("fetch", fetcher);
    const onRevalidate = vi.fn();
    disk.hold = true;
    const outcome = getJSONResult(U, { onRevalidate });
    invalidate(U);
    releaseDisk(); await settle();
    expect(await outcome).toEqual({ status: "data", data: NEW });
    expect(onRevalidate).not.toHaveBeenCalled();       // the caller already holds NEW
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("a strict (swr:false) read-back pending across invalidate(url) goes to the network", async () => {
    persist(U, OLD);
    const fetcher = vi.fn(async () => okJson(NEW)); vi.stubGlobal("fetch", fetcher);
    disk.hold = true;
    const outcome = getJSONResult(U, { swr: false });
    invalidate(U);
    releaseDisk();
    expect(await outcome).toEqual({ status: "data", data: NEW });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("invalidating a DIFFERENT key leaves a pending read-back's own record usable", async () => {
    persist(U, OLD);
    const fetcher = vi.fn(async () => okJson(NEW)); vi.stubGlobal("fetch", fetcher);
    disk.hold = true;
    const outcome = getJSONResult(U);
    invalidate("/data/AAPL.json");
    releaseDisk();
    expect(await outcome).toEqual({ status: "data", data: OLD });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("a whole-cache clear fences every pending read and prefetch", () => {
  it("no pending read-back or prefetch repopulates memory after invalidate()", async () => {
    const urls = ["/data/A.json", "/data/B.json", "/data/C.json", "/data/D.json"];
    for (const url of urls) persist(url, OLD);
    const fetcher = vi.fn(async () => okJson(NEW)); vi.stubGlobal("fetch", fetcher);
    disk.hold = true;
    const reads = [getJSONResult(urls[0]), getJSONResult(urls[1])];
    prefetch(urls[2]); prefetch(urls[3]);
    invalidate();
    releaseDisk(); await settle();
    expect(await Promise.all(reads)).toEqual([{ status: "data", data: NEW }, { status: "data", data: NEW }]);
    expect(peek(urls[2])).toBeUndefined();
    expect(peek(urls[3])).toBeUndefined();
    expect(fetcher.mock.calls.map((c) => String((c as unknown[])[0])).sort()).toEqual([urls[0], urls[1]]);
    expect(disk.puts.every((p) => p.data === NEW)).toBe(true);
  });

  it("a coverage index that was in flight across invalidate() seeds no absence", async () => {
    const cov = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn(() => cov.promise));
    loadCoverage(["ZZZ"]);
    invalidate();
    cov.resolve(okJson({ as_of: new Date().toISOString(), intel: [], fund: [], opts: [] }));
    await settle();
    expect(_neg404Has("/data/ZZZ.intel.json")).toBe(false);
  });

  it("a per-key invalidate during the coverage read keeps that key discoverable and seeds the rest", async () => {
    const cov = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn(() => cov.promise));
    loadCoverage(["ZZZ"]);
    invalidate("/data/ZZZ.intel.json");
    cov.resolve(okJson({ as_of: new Date().toISOString(), intel: [], fund: [], opts: [] }));
    await settle();
    expect(_neg404Has("/data/ZZZ.intel.json")).toBe(false);
    expect(_neg404Has("/data/ZZZ.fund.json")).toBe(true);
  });
});

describe("a post-invalidation network success beats every older completion", () => {
  it("an outdated network success reaches neither memory nor disk", async () => {
    const old = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue(okJson(NEW)));
    const fetcher = vi.mocked(fetch);
    const outdated = getJSONResult(U);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));   // really on the network
    invalidate(U);
    expect(await getJSONResult(U)).toEqual({ status: "data", data: NEW });
    old.resolve(okJson(OLD));
    expect(await outdated).toEqual({ status: "data", data: OLD });   // its own request's answer
    await settle();
    expect(peek(U)).toEqual(NEW);
    expect(disk.records.get(U)?.data).toEqual(NEW);
    expect(disk.puts.map((p) => p.data)).toEqual([NEW]);
  });

  it("an outdated background revalidation never publishes to its onRevalidate subscriber", async () => {
    const old = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(okJson(OLD))      // initial commit
      .mockReturnValueOnce(old.promise)        // background revalidation, held
      .mockResolvedValue(okJson(NEW)));        // post-invalidation read
    await getJSONResult(U);
    const onRevalidate = vi.fn();
    expect(await getJSONResult(U, { ttl: 0, onRevalidate })).toEqual({ status: "data", data: OLD });
    invalidate(U);
    expect(await getJSONResult(U)).toEqual({ status: "data", data: NEW });
    old.resolve(okJson([{ close: 1 }])); await settle();
    expect(onRevalidate).not.toHaveBeenCalled();
    expect(peek(U)).toEqual(NEW);
  });

  it("a registered request fenced by the bounded per-key map is released, not pinned", async () => {
    const old = deferred<Response>();
    const fetcher = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue(okJson(NEW));
    vi.stubGlobal("fetch", fetcher);
    const pending = getJSONResult(U);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    // Many unrelated corrections overflow the per-key map into a whole-cache stamp.
    for (let i = 0; i <= 1_000; i += 1) invalidate(`/data/K${i}.json`);
    old.resolve(okJson(OLD));
    expect(await pending).toEqual({ status: "data", data: OLD });   // its own request's answer
    expect(peek(U)).toBeUndefined();                                // but not committed
    expect(disk.puts).toEqual([]);
    expect(await getJSONResult(U)).toEqual({ status: "data", data: NEW });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("an old disk read resolving after the new network commit cannot replace it", async () => {
    persist(U, OLD);
    vi.stubGlobal("fetch", vi.fn(async () => okJson(NEW)));
    disk.hold = true;
    const outdated = getJSONResult(U);
    const heldRead = disk.pending.splice(0);           // keep only the outdated read held
    invalidate(U);
    disk.hold = false;
    expect(await getJSONResult(U)).toEqual({ status: "data", data: NEW });
    heldRead.forEach((go) => go());
    expect(await outdated).toEqual({ status: "data", data: NEW });
    expect(peek(U)).toEqual(NEW);
  });
});

describe("absence, transient failure and the IDB timeout keep their meaning across the fence", () => {
  it("a post-invalidation 404 is absent and remembered — never answered with the invalidated disk copy", async () => {
    persist(U, OLD);
    const fetcher = vi.fn(async () => status(404)); vi.stubGlobal("fetch", fetcher);
    disk.hold = true;
    const outcome = getJSONResult(U);
    invalidate(U);
    releaseDisk();
    expect(await outcome).toEqual({ status: "absent", httpStatus: 404 });
    expect(_neg404Has(U)).toBe(true);
    expect(await getJSONResult(U)).toEqual({ status: "absent" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("a post-invalidation 503 is unavailable, not absent, and not hidden behind the disk copy", async () => {
    persist(U, OLD);
    vi.stubGlobal("fetch", vi.fn(async () => status(503)));
    disk.hold = true;
    const outcome = getJSONResult(U);
    invalidate(U);
    releaseDisk();
    expect(await outcome).toEqual({ status: "unavailable", reason: "server", httpStatus: 503 });
    expect(_neg404Has(U)).toBe(false);
    expect(peek(U)).toBeUndefined();
  });

  it("a timed-out read-back (resolved null) across invalidation costs exactly one network request", async () => {
    const fetcher = vi.fn(async () => okJson(NEW)); vi.stubGlobal("fetch", fetcher);
    disk.hold = true;                                  // no record: the held read answers null
    const outcome = getJSONResult(U);
    invalidate(U);
    releaseDisk();
    expect(await outcome).toEqual({ status: "data", data: NEW });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("repeated navigation and same-symbol correction converge on one request", () => {
  it("many readers and prefetches pending across invalidation share ONE post-invalidation fetch", async () => {
    persist(U, OLD);
    const fetcher = vi.fn(async () => okJson(NEW)); vi.stubGlobal("fetch", fetcher);
    disk.hold = true;
    const readers = [getJSONResult(U), getJSONResult(U), getJSONResult(U)];
    prefetch(U); prefetch(U);
    invalidate(U);
    invalidate(U);                                     // a second correction while still pending
    releaseDisk(); await settle();
    expect(await Promise.all(readers)).toEqual(Array(3).fill({ status: "data", data: NEW }));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(peek(U)).toEqual(NEW);
    expect(await getJSONResult(U)).toEqual({ status: "data", data: NEW });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
