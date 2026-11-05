/**
 * idbJsonStore.ts — tiny IndexedDB persistence layer for dataCache.ts.
 *
 * PURPOSE
 *   dataCache.ts is memory-only, so every page reload refetches multi-hundred-KB
 *   OHLC JSONs and first paint is network-bound. This module gives dataCache a
 *   transparent write-through / read-back durable layer so a revisit can paint
 *   from disk instantly (see the PERSISTENCE section of dataCache.ts's header).
 *
 * SCHEMA
 *   DB   "mm-data-cache" version 1
 *   store "json", keyPath "url", records { url, data, ts }
 *   index "ts" (non-unique) on the ts field — used for oldest-first eviction.
 *
 * CONTRACT (all callers on the dataCache hot path depend on these)
 *   - EVERY export is individually try/caught and returns a safe fallback; a
 *     broken, blocked, or absent IndexedDB (SSR, private browsing) must be a
 *     silent no-op so dataCache behaviour is byte-identical to memory-only.
 *   - No export ever throws. Reads resolve `null`/`undefined` on any failure;
 *     writes/deletes resolve `void`.
 *   - `isAvailable()` is the single SSR / feature guard: `typeof indexedDB`.
 *   - The open Promise is cached and de-duped; a failed open is remembered as a
 *     hard-off flag so we never spam `indexedDB.open` on a browser that blocks it.
 *
 * TIMEOUT + LATCH (the "blocked/limbo IDB must never gate data" guarantee)
 *   Web reality: `indexedDB.open()` can stall INDEFINITELY with no success, error,
 *   OR blocked event — e.g. a pending deleteDatabase from another tab holding the
 *   DB hostage, a stuck version upgrade, or storage pressure. The event-only
 *   `dbFailed` latch below cannot catch that case (no event ever fires), so a bare
 *   `await idbGet(...)` on the read-back path would hang FOREVER and blank the
 *   terminal — no bars, no manifest, zero network fallback. That violates the
 *   build-spec rule "a broken/blocked IDB must leave behaviour byte-identical to
 *   no-IDB": an indefinite hang is not byte-identical, it is worse.
 *
 *   Therefore the read path is bounded and self-disabling:
 *   - RACE: `idbGet` races its ENTIRE async body (which transitively includes the
 *     `openDB()` it depends on) against a ~250ms timeout (IDB_READ_TIMEOUT_MS). On
 *     timeout it resolves `null` so the caller falls through to the network exactly
 *     as a cache miss. Persistence NEVER gates data delivery.
 *   - LATCH: a timeout OR an open failure/blocked event sets `idbDead = true` for
 *     the lifetime of the tab. Once latched, every read short-circuits to `null`
 *     without touching IDB (no repeated 250ms stalls, no unbounded queue of doomed
 *     opens) and every write/delete/clear/evict becomes a no-op (openDB resolves
 *     `null`). If a slow `open()` eventually DOES settle after the latch flipped,
 *     its onsuccess closes the handle and drops it — nothing is left dangling.
 *
 * This file owns ALL raw IDB plumbing. dataCache.ts contains no IDB request code.
 */

export const DB_NAME = "mm-data-cache";
export const DB_VERSION = 1;
export const STORE = "json";
export const TS_INDEX = "ts";

/** Hard cap on persisted record count. Oldest-by-ts are evicted past this. */
export const RECORD_CAP = 300;

/** Run the (relatively costly) count+evict sweep only every Nth successful put. */
export const EVICT_EVERY = 20;

/**
 * Single-record size safety cap (bytes). Values whose *estimated* serialized
 * size exceeds this are not persisted. See `estimatePersistBytes` for how the
 * estimate is produced without a second JSON.stringify pass.
 */
export const MAX_RECORD_BYTES = 8 * 1024 * 1024; // 8 MB

/**
 * Hard timeout (ms) for the read-back path. A blocked/limbo `indexedDB.open()`
 * can fire no event at all, so `idbGet` races its whole async body against this
 * and resolves `null` on expiry (see the TIMEOUT + LATCH note in the header). Kept
 * short: this delay is pure downside on a slow-but-eventually-good IDB, and the
 * caller only loses the disk fast-path, never the data (it refetches).
 */
export const IDB_READ_TIMEOUT_MS = 250;

export interface JsonRecord {
  url: string;
  data: any;
  ts: number;
  observedAtMs?: number;
}

/** True only in a browser-like context that actually exposes IndexedDB. */
export function isAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

// ── Connection management ────────────────────────────────────────────────────
// A single lazily-opened connection, cached across calls. `idbDead` latches to
// true the first time open fails, is blocked, OR a read times out (see idbGet),
// so we stop retrying for the lifetime of the tab — private-browsing /
// disabled-IDB / blocked-limbo IDB must all degrade cleanly. Once dead, openDB
// resolves null, which turns every read into a miss and every write/evict into a
// no-op.

let dbPromise: Promise<IDBDatabase | null> | null = null;
let idbDead = false;
// One-shot guard: at most one versioned self-heal reopen per session. Prevents a
// heal loop if the store still can't be created (e.g. the upgrade keeps aborting).
let healAttempted = false;

/**
 * Latch the store off for the tab's lifetime. Idempotent. Called by the open
 * error/blocked handlers AND by idbGet's timeout. Drops any cached open promise
 * so nothing keeps a half-settled handle alive.
 */
function markIdbDead(): void {
  idbDead = true;
  dbPromise = null;
}

/**
 * Create the "json" store + "ts" index on a db that is mid-upgrade. Shared by the
 * fresh-create path (first open, version 1) and the self-heal path (versioned
 * reopen when the store went missing) so both go through IDENTICAL code — the
 * healed store is byte-for-byte what a clean install produces. MUST be called
 * only from within an onupgradeneeded (versionchange) transaction; createObjectStore
 * throws otherwise. Idempotent-guarded by the contains() check.
 */
function ensureStore(db: IDBDatabase): void {
  try {
    if (!db.objectStoreNames.contains(STORE)) {
      const os = db.createObjectStore(STORE, { keyPath: "url" });
      os.createIndex(TS_INDEX, "ts", { unique: false });
    }
  } catch {
    // Swallow — the resolve path still yields a usable/failed db, and a
    // still-missing store is detected by the contains() check in onsuccess.
  }
}

/**
 * One open attempt at a specific version. Resolves the live db handle, or null on
 * error/blocked/exception (latching the store dead in those cases, exactly as
 * before). Does NOT itself inspect for a missing store — the caller (openDB) does
 * that, so the heal decision lives in one place. `onversionchange` wiring and the
 * "latched-while-in-flight → close + null" guard are preserved per attempt.
 */
function attemptOpen(version: number): Promise<IDBDatabase | null> {
  return new Promise<IDBDatabase | null>((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, version);

      req.onupgradeneeded = () => {
        // Same store-creation code path for a fresh create AND a heal reopen.
        try {
          ensureStore(req.result);
        } catch {
          /* noop */
        }
      };

      req.onsuccess = () => {
        const db = req.result;
        // If a read already timed out and latched the store off while this open
        // was still in flight, the connection is useless to us: close it and
        // resolve null so callers stay on the no-IDB path. Prevents a slow open
        // from resurrecting a store we deliberately disabled.
        if (idbDead) {
          try {
            db.close();
          } catch {
            /* noop */
          }
          resolve(null);
          return;
        }
        // If the connection is force-closed by another tab's version change,
        // drop our cached handle so the next call reopens cleanly.
        try {
          db.onversionchange = () => {
            try {
              db.close();
            } catch {
              /* noop */
            }
            dbPromise = null;
          };
        } catch {
          /* noop */
        }
        resolve(db);
      };

      req.onerror = () => {
        markIdbDead();
        resolve(null);
      };
      req.onblocked = () => {
        // Another connection holds an older version open; treat as unavailable
        // rather than hanging the hot path.
        markIdbDead();
        resolve(null);
      };
    } catch {
      markIdbDead();
      resolve(null);
    }
  });
}

function openDB(): Promise<IDBDatabase | null> {
  if (idbDead) return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  // The whole heal lives inside this one cached promise, so callers and idbGet's
  // 250ms race see a single Promise<IDBDatabase | null> exactly as before — the
  // versioned reopen is invisible outside openDB.
  dbPromise = (async () => {
    const db = await attemptOpen(DB_VERSION);
    if (!db) return null; // error/blocked/timeout-latch already handled by attemptOpen.

    // Healthy DB (store present) → done, no versioned reopen.
    if (db.objectStoreNames.contains(STORE)) return db;

    // The DB exists at the current version but WITHOUT the "json" store — e.g.
    // same-origin code opened "mm-data-cache" v1 with no upgrade handler before we
    // did, or an upgrade aborted. onupgradeneeded will never fire again at this
    // version, so every transaction("json") would throw NotFoundError forever.
    // Self-heal ONCE: reopen at version+1 (never a hardcoded 2 — the live version
    // may be anything) so onupgradeneeded fires and ensureStore() creates the
    // store via the same path as a fresh install.
    if (healAttempted) {
      // Already spent our one heal this session and the store is still missing:
      // give up rather than loop. Latch off exactly as a hard failure.
      try {
        db.close();
      } catch {
        /* noop */
      }
      markIdbDead();
      return null;
    }
    healAttempted = true;

    const healVersion = db.version + 1;
    // Close our store-less handle first so it does not block the version bump.
    try {
      db.close();
    } catch {
      /* noop */
    }

    const healed = await attemptOpen(healVersion);
    // The heal reopen may have failed, been blocked, or timed out (attemptOpen
    // already latched idbDead in those cases and returned null). If it returned a
    // handle that STILL lacks the store, treat that as a hard failure too.
    if (!healed) return null;
    if (!healed.objectStoreNames.contains(STORE)) {
      try {
        healed.close();
      } catch {
        /* noop */
      }
      markIdbDead();
      return null;
    }
    return healed;
  })();

  return dbPromise;
}

/** Promisify a single IDBRequest; resolves `null` on any error. */
function reqToPromise<T>(makeReq: (store: IDBObjectStore) => IDBRequest, mode: IDBTransactionMode): Promise<T | null> {
  return openDB().then((db) => {
    if (!db) return null;
    return new Promise<T | null>((resolve) => {
      try {
        const tx = db.transaction(STORE, mode);
        const store = tx.objectStore(STORE);
        const r = makeReq(store);
        r.onsuccess = () => resolve(r.result as T);
        r.onerror = () => resolve(null);
        tx.onerror = () => resolve(null);
        tx.onabort = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  });
}

// ── Public API (every method is failure-safe and never throws) ───────────────

/**
 * Read one record by url. Resolves the record, or null on miss / any failure.
 *
 * The entire read (including the openDB it depends on) is raced against
 * `timeoutMs` (default IDB_READ_TIMEOUT_MS ≈ 250ms). A blocked/limbo IDB whose
 * `open()` never fires an event would otherwise hang this await forever and blank
 * the terminal; instead we resolve null (a cache miss → the caller refetches) and
 * LATCH the store off so no subsequent read pays the timeout again. See the
 * TIMEOUT + LATCH note in the header.
 */
export async function idbGet(url: string, timeoutMs: number = IDB_READ_TIMEOUT_MS): Promise<JsonRecord | null> {
  if (!isAvailable()) return null;
  if (idbDead) return null; // already latched off — skip IDB entirely, no stall.

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      // The open/read stalled past the budget: disable the store for the tab so
      // the next read short-circuits, and fall through to the network as a miss.
      markIdbDead();
      resolve(null);
    }, timeoutMs);
  });

  const read = (async (): Promise<JsonRecord | null> => {
    try {
      const rec = await reqToPromise<JsonRecord>((s) => s.get(url), "readonly");
      if (rec && typeof rec === "object" && "data" in rec && typeof (rec as any).ts === "number") {
        return rec as JsonRecord;
      }
      return null;
    } catch {
      return null;
    }
  })();

  try {
    return await Promise.race([read, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

// Successful-put counter driving the lazy eviction cadence (module-local).
let putsSinceEvict = 0;

/**
 * Write-through one record. Fire-and-forget: callers must NOT await this on the
 * hot path. Skips oversized values (see estimatePersistBytes) and runs a lazy
 * eviction sweep every EVICT_EVERY successful puts.
 */
export async function idbPut(url: string, data: any, ts: number, observedAtMs?: number): Promise<void> {
  if (!isAvailable()) return;

  // Single-record safety cap. estimatePersistBytes returns null when it cannot
  // cheaply estimate — in that case we persist unconditionally and rely on the
  // record cap (documented decision; see dataCache.ts header).
  const est = estimatePersistBytes(data);
  if (est !== null && est > MAX_RECORD_BYTES) return;

  try {
    const ok = await reqToPromise<IDBValidKey>((s) => s.put({ url, data, ts, observedAtMs } satisfies JsonRecord), "readwrite");
    if (ok === null) return; // write failed silently; skip eviction bookkeeping
    putsSinceEvict++;
    if (putsSinceEvict >= EVICT_EVERY) {
      putsSinceEvict = 0;
      // Fire-and-forget; never blocks the put's caller.
      void evictIfNeeded();
    }
  } catch {
    /* swallow */
  }
}

/** Delete one record by url. Fire-and-forget-safe. */
export async function idbDelete(url: string): Promise<void> {
  if (!isAvailable()) return;
  try {
    await reqToPromise<undefined>((s) => s.delete(url), "readwrite");
  } catch {
    /* swallow */
  }
}

/** Clear the entire store. Fire-and-forget-safe (backs invalidate() with no url). */
export async function idbClear(): Promise<void> {
  if (!isAvailable()) return;
  try {
    await reqToPromise<undefined>((s) => s.clear(), "readwrite");
  } catch {
    /* swallow */
  }
}

/**
 * Evict oldest-by-ts records until the store is within RECORD_CAP. Walks the
 * "ts" index ascending and deletes the front until count <= cap. All inside one
 * readwrite transaction; any failure aborts silently.
 */
export async function evictIfNeeded(): Promise<void> {
  if (!isAvailable()) return;
  try {
    const db = await openDB();
    if (!db) return;

    const count = await new Promise<number>((resolve) => {
      try {
        const tx = db.transaction(STORE, "readonly");
        const r = tx.objectStore(STORE).count();
        r.onsuccess = () => resolve(typeof r.result === "number" ? r.result : 0);
        r.onerror = () => resolve(0);
        tx.onabort = () => resolve(0);
      } catch {
        resolve(0);
      }
    });

    let toDelete = count - RECORD_CAP;
    if (toDelete <= 0) return;

    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE, "readwrite");
        const idx = tx.objectStore(STORE).index(TS_INDEX);
        // Ascending cursor over ts → oldest first.
        const curReq = idx.openCursor();
        curReq.onsuccess = () => {
          const cursor = curReq.result;
          if (!cursor || toDelete <= 0) {
            return; // tx.oncomplete resolves
          }
          try {
            cursor.delete();
          } catch {
            /* skip this one */
          }
          toDelete--;
          cursor.continue();
        };
        curReq.onerror = () => resolve();
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch {
        resolve();
      }
    });
  } catch {
    /* swallow */
  }
}

/**
 * estimatePersistBytes — cheap, best-effort serialized-size estimate WITHOUT a
 * second JSON.stringify pass on the hot path.
 *
 * Rationale (requirement 5 decision): structuredClone stores the parsed object
 * directly into IDB, so we deliberately avoid stringifying large OHLC payloads
 * twice just to gate on size. We estimate only when it is trivially cheap:
 *
 *   - Arrays (OHLC bar/slice files are arrays of rows/objects): estimate as
 *     length × PER_ROW_BYTES. This is O(1) and catches the pathological
 *     "hundreds of thousands of bars" record that the 8 MB cap targets.
 *   - Everything else: return null → caller persists unconditionally and relies
 *     on the RECORD_CAP. We do NOT stringify to find out.
 *
 * Returns an estimated byte count, or null when no cheap estimate is available.
 * Pure and side-effect free → unit-testable without a real IDB.
 */
export const PER_ROW_BYTES = 120; // rough bytes for one OHLC row once serialized

export function estimatePersistBytes(data: any): number | null {
  if (Array.isArray(data)) {
    return data.length * PER_ROW_BYTES;
  }
  // Common bars-wrapper shape: { bars: [...] } or { data: [...] }.
  if (data && typeof data === "object") {
    const arr = (data.bars ?? data.candles ?? data.rows) as unknown;
    if (Array.isArray(arr)) return arr.length * PER_ROW_BYTES;
  }
  return null;
}

/**
 * shouldPersist — pure decision used by write-through and directly unit-tested.
 * True unless the cheap estimate says the value exceeds MAX_RECORD_BYTES.
 */
export function shouldPersist(data: any): boolean {
  const est = estimatePersistBytes(data);
  return est === null || est <= MAX_RECORD_BYTES;
}

// ── Test / HMR hooks ─────────────────────────────────────────────────────────

/** Reset module-local connection + counters + latch (test isolation only). */
export function _resetForTests(): void {
  dbPromise = null;
  idbDead = false;
  putsSinceEvict = 0;
  healAttempted = false;
}

/** Test hook — read the session latch (asserts blocked-IDB disables the store). */
export function _isIdbDead(): boolean {
  return idbDead;
}
