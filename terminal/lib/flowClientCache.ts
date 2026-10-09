/**
 * flowClientCache.ts — thin stale-while-revalidate wrapper for /api/flow fetches.
 *
 * CONTRACT:
 *   - Module-level Map keyed by full URL (including f-param).
 *   - TTL = 25 s.  Stale-while-revalidate: if a cached entry is older than TTL
 *     the stale value is returned IMMEDIATELY and a background re-fetch fires.
 *   - In-flight deduplication: concurrent callers waiting on the same URL collapse
 *     onto one Promise.
 *   - Only payloads are kept: a 404 absence and a failed read both evict the key, so
 *     the next call asks again.
 *   - flowGet / flowGetFresh resolve null for every non-data outcome. flowGetResult
 *     keeps the outcome — data, a 404/410 absence, or a read that did not land — for
 *     surfaces that must not show a failure as "nothing published".
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

import type { UnavailableReason } from "@/lib/dataCache";

const TTL_MS = 25_000;

/**
 * What one /api/flow read established — dataCache's contract. Only a 404/410 is a
 * published absence; a refused fetch, any other non-2xx and an unparseable or null
 * body say nothing about whether the payload exists.
 */
export type FlowOutcome =
  | { status: "data"; data: unknown }
  | { status: "absent"; httpStatus: number }
  | { status: "unavailable"; reason: UnavailableReason; httpStatus?: number };

type CacheEntry = {
  data: unknown;
  ts: number;
  inflight: Promise<FlowOutcome> | null;
};

const store = new Map<string, CacheEntry>();

function buildUrl(f: string): string {
  return `/api/flow?f=${encodeURIComponent(f)}`;
}

async function readOutcome(requestUrl: string): Promise<FlowOutcome> {
  let r: Response;
  try {
    r = await fetch(requestUrl, { cache: "no-store" });
  } catch {
    return { status: "unavailable", reason: "network" };
  }
  if (!r.ok) {
    if (r.status === 404 || r.status === 410) return { status: "absent", httpStatus: r.status };
    return { status: "unavailable", reason: "server", httpStatus: r.status };
  }
  let data: unknown;
  try {
    data = await r.json();
  } catch {
    return { status: "unavailable", reason: "malformed", httpStatus: r.status };
  }
  if (data == null) return { status: "unavailable", reason: "malformed", httpStatus: r.status };
  return { status: "data", data };
}

function doFetch(url: string, entry: CacheEntry, requestUrl = url): Promise<FlowOutcome> {
  const inflight: Promise<FlowOutcome> = readOutcome(requestUrl)
    // Never rejects: anything the classifier did not anticipate is a read that did not land.
    .catch((): FlowOutcome => ({ status: "unavailable", reason: "network" }))
    .then((outcome) => {
      const current = store.get(url);
      if (current && current.inflight === inflight) {
        if (outcome.status === "data") {
          store.set(url, { data: outcome.data, ts: Date.now(), inflight: null });
        } else {
          store.delete(url);
        }
      }
      return outcome;
    });

  entry.inflight = inflight;
  store.set(url, entry);
  return inflight;
}

const dataOrNull = (outcome: FlowOutcome): unknown => (outcome.status === "data" ? outcome.data : null);

/**
 * flowGet — fetch /api/flow?f=<f> with stale-while-revalidate.
 * Returns null on a hard error (network failure or non-ok status) and on a 404.
 */
export async function flowGet(f: string, options: { refresh?: boolean } = {}): Promise<unknown> {
  const url = buildUrl(f);
  const now = Date.now();
  const entry = store.get(url);

  if (entry) {
    // Deduplicate in-flight
    if (entry.inflight !== null) return entry.inflight.then(dataOrNull);

    // An index refresh must await new bytes; ordinary consumers keep SWR.
    if (options.refresh) return doFetch(url, { data: entry.data, ts: entry.ts, inflight: null }).then(dataOrNull);

    const age = now - entry.ts;

    // Fresh — return immediately
    if (age < TTL_MS) return Promise.resolve(entry.data);

    // Stale — return stale immediately + kick background revalidation
    const stale = entry.data;
    doFetch(url, { data: stale, ts: entry.ts, inflight: null });
    return Promise.resolve(stale);
  }

  // Cache miss — blocking fetch
  return doFetch(url, { data: null, ts: 0, inflight: null }).then(dataOrNull);
}

/**
 * flowGetResult — flowGet's read with the outcome kept. The same store, SWR and
 * in-flight dedupe as flowGet, so mixing the two never opens a second request.
 * Never re-collapse the outcome into null at the call site.
 */
export async function flowGetResult(f: string): Promise<FlowOutcome> {
  const url = buildUrl(f);
  const entry = store.get(url);

  if (entry) {
    if (entry.inflight !== null) return entry.inflight;
    // Stale — return stale immediately + kick background revalidation
    if (Date.now() - entry.ts >= TTL_MS) doFetch(url, { data: entry.data, ts: entry.ts, inflight: null });
    return { status: "data", data: entry.data };
  }

  return doFetch(url, { data: null, ts: 0, inflight: null });
}

/**
 * flowGetFresh — use the SAME cache owner, but wait for revalidation when the
 * cached value is stale. This is for long-lived mounted consumers that must
 * actually consume a nightly artifact after it advances rather than merely
 * trigger SWR in the background and keep rendering the previous value.
 */
export async function flowGetFresh(
  f: string,
  options: { forceUpstream?: boolean } = {},
): Promise<unknown> {
  const url = buildUrl(f);
  const now = Date.now();
  const entry = store.get(url);

  // A user-explicit Leaders refresh is not just a client-cache invalidation:
  // it asks the SAME entitlement-gated API to recheck the publisher even when
  // the server's 30s TTL has not expired. Preserve this cache's single key,
  // dedup ownership and post-fetch value for the next ordinary read.
  if (f === "leaders" && options.forceUpstream) {
    if (entry?.inflight) await entry.inflight;
    const current = store.get(url);
    return doFetch(
      url,
      { data: current?.data ?? null, ts: current?.ts ?? 0, inflight: null },
      url + "&refresh=1",
    ).then(dataOrNull);
  }

  if (entry) {
    if (entry.inflight !== null) return entry.inflight.then(dataOrNull);
    if (now - entry.ts < TTL_MS) return Promise.resolve(entry.data);
    return doFetch(url, { data: entry.data, ts: entry.ts, inflight: null }).then(dataOrNull);
  }

  return doFetch(url, { data: null, ts: 0, inflight: null }).then(dataOrNull);
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
