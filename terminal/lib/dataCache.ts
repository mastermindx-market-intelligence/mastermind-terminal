/**
 * dataCache.ts — client-side JSON cache for Terminal data files.
 *
 * CONTRACT (§0.2, §3 of BUILD-SPEC):
 *   - SINGLE AUTHOR: frontend agent.  ChartPanel + TerminalShell are pure consumers.
 *   - Provides getJSON/prefetch/peek/invalidate/getOhlc/getSlice/getSliceAndOhlc.
 *   - Inflight-request deduplication (collapse double slice fetch).
 *   - TTL = 60 s, stale-while-revalidate by default.
 *   - Never stores null responses — on null/error the key is evicted so the next call retries.
 *   - LRU cap ~400 entries (in-memory).
 *   - SSR-safe: prefetch is a no-op on the server; getJSON works (no window APIs needed).
 *
 * PERSISTENCE (IndexedDB write-through / read-back — added D3):
 *   The in-memory Map is lost on every reload, so first paint after a reload
 *   refetches multi-hundred-KB OHLC JSONs over the network. A transparent
 *   IndexedDB layer (lib/idbJsonStore.ts, DB "mm-data-cache" v1, store "json"
 *   keyPath "url", records {url,data,ts}, index "ts") mirrors committed entries
 *   to disk so a revisit paints instantly.
 *
 *   - WRITE-THROUGH: when doFetch commits a successful response to the memory
 *     store it ALSO fires (never awaits) a put() to IDB. Errors are swallowed.
 *   - READ-BACK: getJSON/prefetch, ONLY on a full memory miss, await a short IDB
 *     get BEFORE the blocking network fetch. A hit seeds the memory store with
 *     the persisted ts, then the NORMAL freshness rules apply — fresh (within
 *     ttl) is served directly; stale is served with background swr revalidation.
 *   - EVICTION: IDB store capped at 300 records; oldest-by-ts evicted via the
 *     "ts" index, checked lazily (every Nth write). Single-record size cap 8 MB
 *     via a cheap array-length heuristic (NO double JSON.stringify — see
 *     idbJsonStore.estimatePersistBytes; non-array values persist unconditionally
 *     and rely on the record cap).
 *   - The absence cache stays SESSION-ONLY, is never persisted, and every entry expires
 *     (see the ABSENCE_TTL note below). invalidate(url?) also deletes from IDB
 *     (fire-and-forget).
 *   - SAFETY: every IDB path is behind `isAvailable()` (typeof indexedDB) and is
 *     individually try/caught; a broken/blocked/absent IDB (SSR, private
 *     browsing) leaves behaviour byte-identical to the memory-only cache. In the
 *     node/jsdom test env indexedDB is undefined, so persistence is a no-op.
 *   - NEVER GATES DATA: the read-back await (getJSON/prefetch, memory-miss only)
 *     can NOT hang the terminal. A blocked/limbo IDB whose `open()` fires no event
 *     is bounded inside idbJsonStore: idbGet races its whole body against a ~250ms
 *     timeout and resolves null (→ a plain network miss), then LATCHES the store
 *     off for the tab so subsequent reads short-circuit with no stall and writes
 *     become no-ops. See the TIMEOUT + LATCH note in lib/idbJsonStore.ts. First
 *     paint therefore falls back to the network exactly as no-IDB, never blank.
 */

import {
  idbGet,
  idbPut,
  idbDelete,
  idbClear,
  isAvailable as idbAvailable,
} from "./idbJsonStore";
import { canonicalChartSymbol } from "./terminalBoot";

type Entry = { data: any; ts: number; inflight: Promise<CacheOutcome> | null };

const store = new Map<string, Entry>();

/**
 * Negative cache — a URL that answered 404/410 is not re-fetched for a while. This is what
 * eliminates the "KRUS.intel.json fetched dozens of times" pattern, where dataCache evicts the
 * null entry on each !r.ok response so the next symbol switch or watchlist hover re-requests it.
 *
 * ABSENCE IS NOW BOUNDED, not permanent. It used to be a `Set` with a session lifetime, and
 * that turned a temporary fact into a permanent one:
 *
 *   1. the client asks for XYZ.intel.json; it does not exist yet -> 404, remembered;
 *   2. the nightly publisher writes XYZ.intel.json;
 *   3. the user revisits XYZ in the SAME TAB and the client refuses to make the request.
 *
 * The only cure was closing the tab. A finite TTL keeps 404s cheap (one request per URL per
 * window, not one per hover) while making newly published data discoverable without a reload.
 *
 * Two windows, because the two absences have different authority:
 *   ABSENCE_TTL           we personally observed one 404/410.
 *   COVERAGE_ABSENCE_TTL  the published coverage index asserts the artifact does not exist.
 *                         Stronger evidence, and re-checking it costs N requests rather than
 *                         one, so it holds longer — but it still expires.
 */
const ABSENCE_TTL = 10 * 60_000;           // 10 minutes
const COVERAGE_ABSENCE_TTL = 30 * 60_000;  // 30 minutes

/** url -> epoch ms at which the remembered absence stops being trusted. */
const absent = new Map<string, number>();

function absenceActive(url: string): boolean {
  const until = absent.get(url);
  if (until === undefined) return false;
  if (Date.now() >= until) {
    absent.delete(url);   // expired: let the next call go to the network
    return false;
  }
  return true;
}

function rememberAbsence(url: string, ttl: number = ABSENCE_TTL): void {
  absent.set(url, Date.now() + ttl);
}

export interface GetOpts {
  ttl?: number;   // milliseconds; default 60_000
  swr?: boolean;  // stale-while-revalidate; default true
  /**
   * Called with the REVALIDATED payload when a stale-while-revalidate serve is later
   * corrected by the network. Without it, `getJSON` resolves once — with the stale value —
   * and the fresh copy lands only in the cache, so a consumer that fetches on mount keeps
   * the stale snapshot for the life of the page.
   *
   * That is not theoretical: every reload is a full memory miss, and any persisted record
   * is older than the 60s TTL, so `/data/manifest.json` was served from IndexedDB on EVERY
   * load. A browser that last had the Terminal open two sessions ago painted that board —
   * prices, %, and the Screener's own "as of" date — and never corrected it (verified on
   * production 2026-08-07: the app showed the 08-05 close while the network served 08-06).
   *
   * Fires at most once per getJSON call, and only when the revalidation actually returns
   * data. Consumers must guard it with their own mounted flag.
   */
  onRevalidate?: (data: any) => void;
}

const DEFAULT_TTL = 60_000;

/**
 * CacheOutcome — the DISCRIMINATING availability contract.
 *
 * `getJSON` answers `data | null`, and that single `null` conflates three facts a product
 * surface must tell apart:
 *
 *   "data"        the authority answered and the payload is usable.
 *   "absent"      the authority answered 404/410 — the artifact intentionally does not exist.
 *   "unavailable" nobody answered: the transport failed, the server 5xx'd, or the body was
 *                 not parseable JSON. NOTHING is known about whether the artifact exists.
 *
 * A consumer that renders "loaded" or "empty" off a `null` is asserting the second fact when
 * it only ever observed the third. That is exactly how a manifest outage rendered as an
 * infinite Screener skeleton: the failure resolved as `null`, `.then` ignored the falsy value,
 * `.catch` never ran (this module never rejects), and `loaded` stayed false forever.
 *
 * `getJSON` is unchanged and remains correct for consumers that genuinely treat missing and
 * broken alike (a per-symbol intel file either paints or does not). Use `getJSONResult` where
 * the product needs different states — and never re-collapse them at the call site.
 */
export type UnavailableReason = "network" | "server" | "malformed";
export type CacheOutcome =
  | { status: "data"; data: any }
  | { status: "absent"; httpStatus?: number }
  | { status: "unavailable"; reason: UnavailableReason; httpStatus?: number };

// ── LRU eviction: delete the oldest entry when the store exceeds 400 items ──
function evictOldest(): void {
  if (store.size <= 400) return;
  // Map iteration order is insertion order; first item is oldest.
  const first = store.keys().next().value;
  if (first !== undefined) store.delete(first);
}

// ── Touch an entry (move to end = most-recently-used) ──
function touch(url: string, entry: Entry): void {
  store.delete(url);
  store.set(url, entry);
}

/**
 * fetchOutcome — one request, classified. The ONLY place a transport/HTTP/parse failure is
 * turned into a fact, so "does not exist" can never be inferred from "could not ask".
 */
async function fetchOutcome(url: string): Promise<CacheOutcome> {
  let r: Response;
  try {
    r = await fetch(url);
  } catch {
    return { status: "unavailable", reason: "network" };
  }
  if (!r.ok) {
    // Only 404/410 are authoritative absence. 5xx / 429 / 403 say nothing about existence.
    if (r.status === 404 || r.status === 410) return { status: "absent", httpStatus: r.status };
    return { status: "unavailable", reason: "server", httpStatus: r.status };
  }
  let data: any;
  try {
    data = await r.json();
  } catch {
    // 200 with a truncated/HTML body — an edge or origin failure wearing a success code.
    return { status: "unavailable", reason: "malformed", httpStatus: r.status };
  }
  // A literal `null`/`undefined` body is not usable data and was never committed to the
  // store either; it is a broken artifact, not a deliberate absence.
  if (data === null || data === undefined) return { status: "unavailable", reason: "malformed", httpStatus: r.status };
  return { status: "data", data };
}

// ── Core fetch: issues the request, writes/evicts on settle ──
// onRevalidate (optional) is invoked with the committed payload — the hook that lets a
// background SWR refresh reach the caller that was already handed the stale value.
function doFetch(url: string, entry: Entry, onRevalidate?: (data: any) => void): Promise<CacheOutcome> {
  const inflight: Promise<CacheOutcome> = fetchOutcome(url).then((outcome) => {
    // Only permanently suppress on true 404/410 (resource does not exist).
    // 5xx / 429 / network errors are transient — the entry evicts so the next call retries.
    if (outcome.status === "absent") rememberAbsence(url);
    // Only commit if this specific inflight is still the one registered.
    const current = store.get(url);
    if (current && current.inflight === inflight) {
      if (outcome.status !== "data") {
        // Never pin null — clear the key so the next call retries.
        // (the bounded absence cache prevents a 404/410 URL from being refetched for a while.)
        store.delete(url);
      } else {
        const committed: Entry = { data: outcome.data, ts: Date.now(), inflight: null };
        touch(url, committed);
        // Write-through to IndexedDB (fire-and-forget; never awaited on the
        // hot path; all errors swallowed inside idbPut). Guarded so the call
        // is a true no-op when IDB is unavailable (SSR / private browsing).
        if (idbAvailable()) {
          void idbPut(url, committed.data, committed.ts);
        }
        // Hand the corrected payload to the caller that already received the stale one.
        // Isolated: a throwing consumer must not break the cache commit above.
        if (onRevalidate) {
          try { onRevalidate(outcome.data); } catch { /* consumer's problem, not the cache's */ }
        }
      }
    }
    return outcome;
  });

  entry.inflight = inflight;
  store.delete(url);
  store.set(url, entry);
  evictOldest();
  return inflight;
}

/**
 * _seedDecision — PURE freshness classifier for a persisted IDB record.
 *
 * Given the persisted `ts`, the current time, the effective `ttl`, and whether
 * stale-while-revalidate is enabled, decide what a read-back should do once it
 * seeds the memory store with {data, ts}. Extracted (and exported as `_`-prefixed
 * like `_neg404Has`) so the "IDB result seeds memory with correct ts + applies
 * the normal freshness rules" logic is unit-testable with NO real IndexedDB.
 *
 *   "fresh"    → within ttl: seed memory, serve the persisted data, no network.
 *   "stale-swr"→ expired but swr: seed memory, serve stale, background revalidate.
 *   "refetch"  → expired and !swr: seeding does not help the caller; go to network.
 *
 * The persisted ts is ALWAYS carried through unchanged — never rewritten to now —
 * so freshness after a reload matches what it would have been without the reload.
 */
export type SeedDecision = "fresh" | "stale-swr" | "refetch";
export function _seedDecision(ts: number, now: number, ttl: number, swr: boolean): SeedDecision {
  const age = now - ts;
  if (age < ttl) return "fresh";
  if (swr) return "stale-swr";
  return "refetch";
}

/**
 * getJSONResult — the core cache primitive, answering the DISCRIMINATING contract.
 *
 * Algorithm:
 *   0. In-session 404 → "absent" immediately (never refetch).
 *   1. Inflight request present → return it (deduplication).
 *   2. Fresh (now - ts < ttl) → return cached data immediately.
 *   3. Stale + swr=true → kick off background revalidate; return stale data.
 *   3b. Full memory miss → try IndexedDB read-back before the network (see below).
 *   4. Otherwise → fetch synchronously (caller awaits).
 *
 * Every cached/stale serve is `data` — a served-stale copy is still an answer. Only a live
 * request that failed produces `unavailable`, and only a 404/410 (live or remembered)
 * produces `absent`.
 */
export async function getJSONResult(url: string, opts?: GetOpts): Promise<CacheOutcome> {
  // 0. In-session 404 negative cache — never re-request a URL that answered 404/410.
  if (absenceActive(url)) return { status: "absent" };

  const ttl = opts?.ttl ?? DEFAULT_TTL;
  const swr = opts?.swr ?? true;
  const now = Date.now();

  const entry = store.get(url);

  if (entry) {
    // 1. Deduplicate in-flight requests.
    if (entry.inflight !== null) {
      return entry.inflight;
    }

    const age = now - entry.ts;

    // 2. Fresh — serve from cache.
    if (age < ttl) {
      touch(url, entry);
      return { status: "data", data: entry.data };
    }

    // 3. Stale + swr — serve stale, revalidate in background.
    if (swr) {
      // Schedule background revalidation (microtask so the stale data is
      // returned to the caller before the fetch starts).
      const staleData = entry.data;
      const bgEntry: Entry = { data: staleData, ts: entry.ts, inflight: null };
      doFetch(url, bgEntry, opts?.onRevalidate); // fire-and-forget
      return { status: "data", data: staleData };
    }

    // 3.stale + swr=false with an existing memory entry → fall through to (4).
  } else if (idbAvailable()) {
    // 3b. FULL memory miss only: short read-back from IndexedDB before hitting
    // the network. A broken/absent IDB (guarded + try/caught in idbGet) just
    // returns null and we fall through to the network exactly as before.
    const rec = await idbGet(url);
    // Re-check the memory store: another concurrent getJSON for the same url may
    // have populated it while we awaited the IDB read. If so, defer to it.
    const raced = store.get(url);
    if (raced) {
      if (raced.inflight !== null) return raced.inflight;
      if (Date.now() - raced.ts < ttl) {
        touch(url, raced);
        return { status: "data", data: raced.data };
      }
      // raced entry is stale — fall through to the normal miss fetch below.
    } else if (rec && !absenceActive(url)) {
      // Seed memory with the PERSISTED ts (never `now`), then apply normal rules.
      const decision = _seedDecision(rec.ts, Date.now(), ttl, swr);
      if (decision === "fresh") {
        const seeded: Entry = { data: rec.data, ts: rec.ts, inflight: null };
        touch(url, seeded);
        return { status: "data", data: rec.data };
      }
      if (decision === "stale-swr") {
        const seeded: Entry = { data: rec.data, ts: rec.ts, inflight: null };
        touch(url, seeded);
        // Serve stale from disk immediately; revalidate in the background. This is THE
        // path every reload takes for the manifest, so the callback matters most here.
        const bgEntry: Entry = { data: rec.data, ts: rec.ts, inflight: null };
        doFetch(url, bgEntry, opts?.onRevalidate); // fire-and-forget
        return { status: "data", data: rec.data };
      }
      // decision === "refetch" (stale + swr=false): fall through to blocking fetch.
    }
  }

  // 4. Miss or expired (swr=false): blocking fetch. No onRevalidate here — the caller is
  // awaiting THIS request, so a callback would just re-deliver what it is about to receive.
  const fresh: Entry = { data: null, ts: 0, inflight: null };
  return doFetch(url, fresh);
}

/**
 * getJSON — data-or-null convenience over `getJSONResult`.
 *
 * Unchanged behaviour for every existing consumer: absent and unavailable both answer `null`.
 * That is the right shape ONLY where the surface treats "no artifact" and "could not reach the
 * artifact" identically. Anything that renders a loaded/empty/error distinction must call
 * `getJSONResult` — see the CacheOutcome docblock.
 */
export async function getJSON(url: string, opts?: GetOpts): Promise<any> {
  const outcome = await getJSONResult(url, opts);
  return outcome.status === "data" ? outcome.data : null;
}

/**
 * prefetch — warm the cache without blocking the caller.
 * No-op on the server (SSR-safe).
 *
 * On a FULL memory miss, short-circuits via IndexedDB the same way getJSON does:
 * a hover-prefetch that finds fresh persisted data seeds memory and skips the
 * network entirely; stale persisted data seeds memory and revalidates in the
 * background. IDB unavailable/miss → network exactly as before.
 */
export function prefetch(url: string, opts?: GetOpts): void {
  if (typeof window === "undefined") return;
  // Don't prefetch URLs that already 404'd this session.
  if (absenceActive(url)) return;

  const ttl = opts?.ttl ?? DEFAULT_TTL;
  const now = Date.now();
  const entry = store.get(url);

  // Already in-flight or fresh — nothing to do.
  if (entry) {
    if (entry.inflight !== null) return;
    if (now - entry.ts < ttl) return;
    // Stale memory entry: revalidate (existing behaviour — no IDB detour needed
    // since memory already holds data at least as fresh as disk).
    const fresh: Entry = { data: entry.data, ts: entry.ts, inflight: null };
    doFetch(url, fresh);
    return;
  }

  // Full memory miss.
  if (idbAvailable()) {
    // Async read-back; prefetch returns immediately (fire-and-forget internally).
    void (async () => {
      try {
        const rec = await idbGet(url);
        // Bail if another call populated memory or the url was marked absent meanwhile.
        if (store.get(url) || absenceActive(url)) return;
        if (rec) {
          // prefetch has no swr flag; treat as swr=true (revalidate if stale).
          const decision = _seedDecision(rec.ts, Date.now(), ttl, true);
          const seeded: Entry = { data: rec.data, ts: rec.ts, inflight: null };
          touch(url, seeded);
          if (decision === "fresh") return; // fresh on disk → skip the network
          // stale → revalidate in the background
          const bgEntry: Entry = { data: rec.data, ts: rec.ts, inflight: null };
          doFetch(url, bgEntry);
          return;
        }
        // IDB miss → network.
        const fresh: Entry = { data: null, ts: 0, inflight: null };
        doFetch(url, fresh);
      } catch {
        // Any failure → fall back to a plain network prefetch.
        if (!store.get(url) && !absenceActive(url)) {
          const fresh: Entry = { data: null, ts: 0, inflight: null };
          doFetch(url, fresh);
        }
      }
    })();
    return;
  }

  const fresh: Entry = { data: null, ts: 0, inflight: null };
  doFetch(url, fresh);
}

/**
 * peek — synchronous cache read; undefined if not cached.
 */
export function peek(url: string): any | undefined {
  const entry = store.get(url);
  return entry?.data;
}

/**
 * invalidate — remove one key (or all keys if url is omitted).
 * Also clears the 404 negative-cache entry so the URL can be re-requested, and
 * removes the corresponding IndexedDB record(s) (fire-and-forget; guarded so it
 * is a no-op when IDB is unavailable). The absence cache itself is never persisted.
 */
export function invalidate(url?: string): void {
  if (url === undefined) {
    store.clear();
    absent.clear();
    if (idbAvailable()) void idbClear();
  } else {
    store.delete(url);
    absent.delete(url);
    if (idbAvailable()) void idbDelete(url);
  }
}

/** Test/HMR hook — is a bounded absence currently held for this url? */
export function _neg404Has(url: string): boolean {
  return absenceActive(url);
}

/** Test hook — the epoch ms at which a remembered absence expires (undefined if not held). */
export function _absenceExpiry(url: string): number | undefined {
  return absent.get(url);
}

export function _clearNeg404(): void {
  absent.clear();
}

// ── Convenience helpers ──

// ── Coverage index ──────────────────────────────────────────────────────────
//
// coverage.json is written by scripts/build_data_coverage.py. When present the client uses it to
// pre-seed the absence cache, so a symbol outside the deep-coverage universe costs no request at
// all rather than one 404 per surface.
//
// Shape: { as_of, generation, intel[], fund[], opts[], ohlc[] }
//
// PRODUCER TIMING — the half of this bug that lives outside the browser. coverage.json used to be
// regenerated ONLY by the Next package's `prebuild`, i.e. during a deploy. The nightly
// `terminal-data` publisher writes and refreshes per-symbol artifacts on its own schedule and did
// NOT regenerate coverage after its writers, so between a nightly publish and the next deploy the
// index asserted absences that were no longer true — and the client believed them before it ever
// made a request. `ops/terminal-data` now regenerates coverage as its final publish step, and
// `tests/test_nightly_wiring.py` pins that (an unwired producer is invisible from inside the app).
//
// When absent (local dev before the first ingest) we degrade gracefully — the runtime absence
// cache still prevents repeat 404s within its window.
let coverageLoaded = false;

/**
 * loadCoverage — fetch coverage.json once per session and pre-seed the absence cache for any
 * symbol×suffix combination NOT listed as covered. Call from a useEffect in TerminalShell with
 * the current manifest symbol list.
 *
 * Idempotent: subsequent calls before the first resolves are no-ops; calls after it resolves are
 * also no-ops (coverageLoaded flag).
 *
 * Every absence it seeds is BOUNDED by COVERAGE_ABSENCE_TTL. That is what stops a coverage
 * document — deploy-generated or nightly-generated — from silently outliving the state it
 * describes: after the window the client asks the network again, and a newly published artifact
 * is found without a tab restart.
 */
let coverageInflight: Promise<void> | null = null;
export function loadCoverage(manifestSymbols: string[]): void {
  if (typeof window === "undefined") return;   // SSR-safe
  if (coverageLoaded || coverageInflight) return;

  const SUFFIXES: Record<string, string> = {
    intel: ".intel.json",
    fund:  ".fund.json",
    opts:  ".opts.json",
  };

  // Maximum age we trust coverage.json for pre-seeding at all. Beyond it we fall back to
  // runtime-only absence, which is always safe (it costs requests, it never hides data).
  //
  // 36h, not 24h: the nightly starts at 21:30 UTC and its marathon runs 3-4 hours, so a
  // 24h window put the daily regeneration uncomfortably close to its own expiry and a single
  // missed run disabled pre-seeding entirely. The per-entry TTL above now bounds how long any
  // individual absence can be wrong, so the document-level gate does not have to be the only
  // protection — it is the backstop for a publisher that has stopped running.
  const COVERAGE_MAX_AGE_MS = 36 * 60 * 60 * 1000;

  coverageInflight = fetch("/data/coverage.json")
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .then((cov) => {
      coverageLoaded = true;
      if (!cov || typeof cov !== "object") return;   // absent or malformed → no-op

      // Freshness gate (MAJOR-2): a stale coverage.json asserts absences for files written after
      // it was generated. Only pre-seed when the document is recent enough to be trusted.
      if (typeof cov.as_of === "string") {
        const covAge = Date.now() - new Date(cov.as_of).getTime();
        if (covAge > COVERAGE_MAX_AGE_MS) return;  // stale → skip pre-seeding; runtime absence still works
      }

      for (const [key, suffix] of Object.entries(SUFFIXES)) {
        const covered = new Set<string>(Array.isArray(cov[key]) ? cov[key] : []);
        // Pre-seed a BOUNDED absence for every manifest symbol NOT in this coverage list.
        for (const sym of manifestSymbols) {
          if (!covered.has(sym)) {
            rememberAbsence(`/data/${sym}${suffix}`, COVERAGE_ABSENCE_TTL);
          }
        }
      }
    });
}

/** Test hook — reset coverage state between tests. */
export function _resetCoverage(): void {
  coverageLoaded = false;
  coverageInflight = null;
}

/**
 * The `/data` file URL for one symbol, or `null` when the value is not a usable symbol.
 *
 * `canonicalChartSymbol` is THE boundary (lib/terminalBoot.ts) and the same one the server route's
 * preload uses. Concatenating the caller's string straight into the path — what this module did
 * before — let `?sym=nvda` fetch `/data/nvda.json` while the route had already preloaded
 * `/data/NVDA.json`: the preload missed and the fetch 404'd. It also meant a user-controlled query
 * value reached the URL space verbatim.
 */
function dataFileUrl(sym: string, suffix: ".json" | ".slice.json"): string | null {
  const symbol = canonicalChartSymbol(sym);
  return symbol ? `/data/${encodeURIComponent(symbol)}${suffix}` : null;
}

/** Fetch a symbol's OHLC file: /data/<SYM>.json */
export function getOhlc(sym: string): Promise<any> {
  const url = dataFileUrl(sym, ".json");
  return url ? getJSON(url) : Promise.resolve(null);
}

/** Fetch a symbol's slice file: /data/<SYM>.slice.json */
export function getSlice(sym: string): Promise<any> {
  const url = dataFileUrl(sym, ".slice.json");
  return url ? getJSON(url) : Promise.resolve(null);
}

/**
 * getSliceAndOhlc — parallel fetch with shared inflight deduplication.
 * ChartPanel calls this; if TerminalShell already triggered getSlice,
 * the slice request collapses onto the same inflight Promise.
 */
export async function getSliceAndOhlc(sym: string): Promise<{ ohlc: any; slice: any }> {
  const [ohlc, slice] = await Promise.all([getOhlc(sym), getSlice(sym)]);
  return { ohlc, slice };
}

/**
 * getCompositeOhlc — fetch multiple leg OHLC files in parallel.
 * Returns an array aligned with the `legs` input.
 * Legs with missing data resolve as null.
 */
export async function getCompositeOhlc(legs: string[]): Promise<(any | null)[]> {
  return Promise.all(legs.map((leg) => getOhlc(leg).catch(() => null)));
}
