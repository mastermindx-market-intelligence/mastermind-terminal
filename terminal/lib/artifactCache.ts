import { createHash } from "node:crypto";
import type { ArtifactState } from "@/lib/portfolioRisk";

// Round-2 review MAJOR 3: restores caching on the per-ticker macro artifact fetch, WITHOUT the
// ambiguity that made the previous pass remove it. `route.ts` used to rely on Next's own fetch
// Data Cache (`next: { revalidate: 900 }`); once every fetch started carrying a per-caller
// session cookie, that cache's key was an unverified bet — either it folds request headers in
// (unbounded near-zero-hit-rate entries, one per session token) or it doesn't (one caller's
// locked/unlocked result served to a different caller for up to 15 minutes). Rather than guess,
// this module owns its OWN cache, keyed explicitly by (ticker, a digest of the caller's cookie),
// so two different callers — or the same caller signed out vs signed in — can never share an
// entry, and single-flight dedupe means N concurrent reloads for the SAME key never fire more
// than one upstream fetch while the first is still in flight.
//
// The cookie is never stored verbatim — only a fixed-length, non-reversible digest — so a cache
// entry can never leak a session token even if this process's memory were inspected.
//
// Follow-up review MAJOR (round-2 re-review): the first pass here never evicted anything but the
// exact (ticker, cookie) key a caller happened to repeat, so a process serving many distinct
// signed-in sessions grew the map for its entire lifetime, and the digest was a 32-bit
// non-cryptographic hash — with an ever-growing live key population the collision probability
// climbs toward certainty (birthday bound over a 2^32 space), and a collision serves one caller's
// artifact read/lock state to a DIFFERENT caller. Two independent fixes close that: (1) the
// digest is now a full SHA-256 hex digest (2^256 space, cryptographically non-reversible, so the
// "never store the cookie itself" property in the comment above is now literally true rather than
// approximately true); (2) the store is a bounded, access-order LRU that never holds more than
// MAX_ENTRIES live entries and opportunistically sweeps expired entries before evicting a live one.

const TTL_MS = 15 * 60 * 1000;

// Bounded so a long-lived process serving an unbounded number of distinct sessions cannot grow
// this map without limit. 5,000 keys is generous headroom over any real concurrent-session count
// for this route while keeping worst-case memory for the cache small and fixed.
const MAX_ENTRIES = 5000;

interface Entry {
  value: ArtifactState;
  expiresAt: number;
}

// Map iteration order is insertion order; `bump()` re-inserts a key on every hit so the FRONT of
// the map is always the least-recently-used entry — the standard Map-as-LRU technique.
const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<ArtifactState>>();

function cookieDigest(cookieHeader: string | null): string {
  if (!cookieHeader) return "anon";
  // Full-width cryptographic digest — a cache-partitioning key that is also, genuinely,
  // non-reversible: unlike a 32-bit rolling hash, SHA-256 collisions are not a realistic risk at
  // any live key population this process will ever hold.
  return createHash("sha256").update(cookieHeader).digest("hex");
}

function keyOf(ticker: string, cookieHeader: string | null): string {
  return `${ticker.toUpperCase()}::${cookieDigest(cookieHeader)}`;
}

/** Moves `key` to the most-recently-used position (the end of Map iteration order) by deleting
 *  and re-inserting it. No-op if `key` is not present. */
function bump(key: string, entry: Entry): void {
  store.delete(key);
  store.set(key, entry);
}

/** Runs on every `set`, unconditionally — not only once the map is over the cap. First sweeps
 *  every expired entry (an expired entry is dead weight regardless of how many live entries the
 *  map holds, and must not wait for the SAME key to be read again before it is freed), then — if
 *  still over the cap after that sweep — evicts the least-recently-used live entries until back
 *  under it. */
function evictIfNeeded(now: number): void {
  for (const [k, v] of store) {
    if (v.expiresAt <= now) store.delete(k);
  }
  while (store.size > MAX_ENTRIES) {
    const oldestKey = store.keys().next().value;
    if (oldestKey === undefined) return;
    store.delete(oldestKey);
  }
}

/**
 * Read-through, single-flight cache for one artifact read. Returns an unexpired cached value
 * when one exists; otherwise calls `fetcher` — at most once per key even when several callers
 * race for the same (ticker, cookie) while the first call is still in flight — and remembers
 * whatever it resolves to (including a `locked`/`missing`/`unreadable` state, which is itself a
 * meaningful, cacheable fact) for `TTL_MS`. The store never holds more than a bounded number of
 * live entries (see `evictIfNeeded`).
 */
export async function getCachedArtifact(
  ticker: string,
  cookieHeader: string | null,
  fetcher: () => Promise<ArtifactState>,
): Promise<ArtifactState> {
  const key = keyOf(ticker, cookieHeader);
  const now = Date.now();

  const hit = store.get(key);
  if (hit && hit.expiresAt > now) {
    bump(key, hit);
    return hit.value;
  }

  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = fetcher()
    .then((value) => {
      const entry = { value, expiresAt: Date.now() + TTL_MS };
      store.set(key, entry);
      evictIfNeeded(Date.now());
      return value;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, promise);
  return promise;
}

/** Test-only: reports how many live entries the store currently holds. */
export function cacheSize(): number {
  return store.size;
}

/** Test-only: clears every cached and in-flight entry. Without this, unit tests that reuse the
 *  same ticker across `it` blocks with different mocked upstream responses would silently read
 *  back an earlier test's cached value instead of exercising their own mock. */
export function resetArtifactCache(): void {
  store.clear();
  inflight.clear();
}
