import { createHash } from "node:crypto";
import type { CloseSeries } from "@/lib/portfolioRiskHistory";

// Mirrors lib/artifactCache.ts (the holdings GET cache boundary): per-(key, caller-cookie)
// read-through LRU so a signed-in session never shares a locked/unlocked OHLC read with
// another caller, and N concurrent reloads for the same ticker fire one upstream GET.

export type OhlcFetch =
  | { kind: "read"; series: CloseSeries }
  | { kind: "missing" }
  | { kind: "locked" }
  | { kind: "unreadable" };

const TTL_MS = 15 * 60 * 1000;
const MAX_ENTRIES = 5000;

interface Entry {
  value: OhlcFetch;
  expiresAt: number;
}

const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<OhlcFetch>>();

function cookieDigest(cookieHeader: string | null): string {
  if (!cookieHeader) return "anon";
  return createHash("sha256").update(cookieHeader).digest("hex");
}

function keyOf(path: string, cookieHeader: string | null): string {
  return `${path}::${cookieDigest(cookieHeader)}`;
}

function bump(key: string, entry: Entry): void {
  store.delete(key);
  store.set(key, entry);
}

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

export async function getCachedOhlc(
  path: string,
  cookieHeader: string | null,
  fetcher: () => Promise<OhlcFetch>,
): Promise<OhlcFetch> {
  const key = keyOf(path, cookieHeader);
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

export function resetOhlcSeriesCache(): void {
  store.clear();
  inflight.clear();
}
