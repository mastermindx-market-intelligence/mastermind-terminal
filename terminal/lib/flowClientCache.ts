/**
 * flowClientCache.ts — thin stale-while-revalidate wrapper for /api/flow fetches.
 *
 * CONTRACT:
 *   - Module-level Map keyed by full URL (including f-param).
 *   - TTL = 25 s.  Stale-while-revalidate: if a cached entry is older than TTL
 *     the stale value is returned IMMEDIATELY and a background re-fetch fires.
 *   - In-flight deduplication: concurrent callers waiting on the same URL collapse
 *     onto one Promise.
 *   - Never pins null — on error the key is evicted so the next call retries.
 *   - SSR-safe: works server-side (no window APIs).
 *
 * Usage (one-line swap in any component):
 *   - Before:  const r = await fetch("/api/flow?f=feed", { cache: "no-store" });
 *              if (r.ok) setFeed(await r.json());
 *   - After:   const data = await flowGet("feed");
 *              if (data) setFeed(data);
 *
 * For parameterized keys (ticker, gex, vol, matrix …) pass the full f-value:
 *   const data = await flowGet("gex:NVDA");
 */

const TTL_MS = 25_000;

type CacheEntry = {
  data: unknown;
  ts: number;
  inflight: Promise<unknown> | null;
};

const store = new Map<string, CacheEntry>();

function buildUrl(f: string): string {
  return `/api/flow?f=${encodeURIComponent(f)}`;
}

function doFetch(url: string, entry: CacheEntry): Promise<unknown> {
  const inflight: Promise<unknown> = fetch(url, { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .then((data: unknown) => {
      const current = store.get(url);
      if (current && current.inflight === inflight) {
        if (data == null) {
          store.delete(url);
        } else {
          store.set(url, { data, ts: Date.now(), inflight: null });
        }
      }
      return data;
    });

  entry.inflight = inflight;
  store.set(url, entry);
  return inflight;
}

/**
 * flowGet — fetch /api/flow?f=<f> with stale-while-revalidate.
 * Returns null on a hard error (network failure or non-ok status).
 */
export async function flowGet(f: string, options: { refresh?: boolean } = {}): Promise<unknown> {
  const url = buildUrl(f);
  const now = Date.now();
  const entry = store.get(url);

  if (entry) {
    // Deduplicate in-flight
    if (entry.inflight !== null) return entry.inflight;

    // An index refresh must await new bytes; ordinary consumers keep SWR.
    if (options.refresh) return doFetch(url, { data: entry.data, ts: entry.ts, inflight: null });

    const age = now - entry.ts;

    // Fresh — return immediately
    if (age < TTL_MS) return Promise.resolve(entry.data);

    // Stale — return stale immediately + kick background revalidation
    const stale = entry.data;
    doFetch(url, { data: stale, ts: entry.ts, inflight: null });
    return Promise.resolve(stale);
  }

  // Cache miss — blocking fetch
  return doFetch(url, { data: null, ts: 0, inflight: null });
}

/**
 * flowGetFresh — use the SAME cache owner, but wait for revalidation when the
 * cached value is stale. This is for long-lived mounted consumers that must
 * actually consume a nightly artifact after it advances rather than merely
 * trigger SWR in the background and keep rendering the previous value.
 */
export async function flowGetFresh(f: string): Promise<unknown> {
  const url = buildUrl(f);
  const now = Date.now();
  const entry = store.get(url);

  if (entry) {
    if (entry.inflight !== null) return entry.inflight;
    if (now - entry.ts < TTL_MS) return Promise.resolve(entry.data);
    return doFetch(url, { data: entry.data, ts: entry.ts, inflight: null });
  }

  return doFetch(url, { data: null, ts: 0, inflight: null });
}

/**
 * flowPrefetch — warm the cache without blocking the caller.
 * No-op on server.
 */
export function flowPrefetch(f: string): void {
  if (typeof window === "undefined") return;
  const url = buildUrl(f);
  const now = Date.now();
  const entry = store.get(url);
  if (entry) {
    if (entry.inflight !== null) return;
    if (now - entry.ts < TTL_MS) return;
  }
  doFetch(url, { data: entry?.data ?? null, ts: entry?.ts ?? 0, inflight: null });
}

/**
 * flowInvalidate — remove one key (or all if omitted).
 */
export function flowInvalidate(f?: string): void {
  if (f === undefined) {
    store.clear();
  } else {
    store.delete(buildUrl(f));
  }
}
