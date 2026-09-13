// RED-first (round-2 review MAJOR 3): restore caching on the artifact fetch, keyed by
// (ticker, cookie), 15-minute window, single-flight dedupe for concurrent reads.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { getCachedArtifact, resetArtifactCache, cacheSize } from "@/lib/artifactCache";
import type { ArtifactState } from "@/lib/portfolioRisk";

beforeEach(() => {
  resetArtifactCache();
  vi.useRealTimers();
});

const READ = (n: number): ArtifactState => ({
  kind: "read",
  facts: { ticker: "AAPL", sector: "Energy", marketCap: n, thinlyTraded: null },
});

describe("getCachedArtifact", () => {
  it("N reloads for the same (ticker, cookie) inside the window produce ONE upstream fetch", async () => {
    const fetcher = vi.fn(async () => READ(1));
    for (let i = 0; i < 5; i++) {
      const v = await getCachedArtifact("AAPL", "sb-x=1", fetcher);
      expect(v).toEqual(READ(1));
    }
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("single-flight: N concurrent reloads for the same key while the first fetch is in flight also produce ONE upstream fetch", async () => {
    let resolveFetch: (v: ArtifactState) => void = () => {};
    const fetcher = vi.fn(
      () => new Promise<ArtifactState>((resolve) => { resolveFetch = resolve; }),
    );
    const calls = Array.from({ length: 8 }, () => getCachedArtifact("AAPL", "sb-x=1", fetcher));
    // Give the microtask queue a turn so every call has had a chance to check the cache/inflight
    // map before the upstream fetch resolves.
    await Promise.resolve();
    resolveFetch(READ(2));
    const results = await Promise.all(calls);
    expect(fetcher).toHaveBeenCalledTimes(1);
    for (const r of results) expect(r).toEqual(READ(2));
  });

  it("a different cookie for the SAME ticker is a different cache entry — never cross-caller leakage", async () => {
    const fetcher = vi.fn(async () => READ(1));
    await getCachedArtifact("AAPL", "sb-caller-a=1", fetcher);
    await getCachedArtifact("AAPL", "sb-caller-b=2", fetcher);
    await getCachedArtifact(
      "AAPL",
      null, // anonymous — also its own partition, distinct from either signed-in caller
      fetcher,
    );
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("expires after the TTL window — a stale entry is refetched", async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn(async () => READ(1));
      await getCachedArtifact("AAPL", "sb-x=1", fetcher);
      vi.advanceTimersByTime(15 * 60 * 1000 + 1);
      await getCachedArtifact("AAPL", "sb-x=1", fetcher);
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not cache forever within the window boundary — well inside 15 minutes it still hits cache", async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn(async () => READ(1));
      await getCachedArtifact("AAPL", "sb-x=1", fetcher);
      vi.advanceTimersByTime(14 * 60 * 1000);
      await getCachedArtifact("AAPL", "sb-x=1", fetcher);
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  // Round-2 re-review MAJOR 1: the previous pass only freed an expired entry when the SAME
  // (ticker, cookie) key was requested again — for a signed-out-then-never-returning session that
  // is never, so a long-lived process grows the map for its entire lifetime. RED before the fix:
  // a completely unrelated set() (a different ticker, a different cookie) must sweep the already-
  // expired entry even though nobody ever re-reads it.
  it("an expired entry is swept by an UNRELATED set(), without any read of that same key", async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn(async () => READ(1));
      await getCachedArtifact("AAPL", "sb-expires-soon=1", fetcher);
      expect(cacheSize()).toBe(1);
      vi.advanceTimersByTime(15 * 60 * 1000 + 1);
      // A totally different key — we never read "AAPL"/"sb-expires-soon=1" again.
      await getCachedArtifact("MSFT", "sb-other-caller=1", fetcher);
      // The expired AAPL entry must be gone; only the fresh MSFT entry remains.
      expect(cacheSize()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  // Round-2 re-review MAJOR 1: the cache key used to be a 32-bit non-cryptographic rolling hash
  // over an unbounded map, so the live key population could grow without limit and collision
  // probability climbed toward certainty — a collision serves one caller's artifact state to a
  // DIFFERENT caller. The fix bounds the map (LRU-evicting past MAX_ENTRIES) and switches to a
  // full-width SHA-256 digest. This test drives the store past its cap with many distinct
  // (ticker, cookie) pairs and confirms (a) the map never exceeds the cap and (b) a still-live,
  // recently-used entry still resolves to exactly its OWN caller's value — never a neighbor's.
  it("stays bounded under many distinct cookies, and a live entry never serves a different caller's value", async () => {
    const N = 5010; // > MAX_ENTRIES (5000)
    for (let i = 0; i < N; i++) {
      const value = READ(i);
      // eslint-disable-next-line no-await-in-loop -- intentionally sequential to fill the map
      await getCachedArtifact("AAPL", `sb-caller-${i}=1`, async () => value);
    }
    expect(cacheSize()).toBeLessThanOrEqual(5000);

    // The most-recently-inserted caller's entry must still be live and correct.
    const lastFetcher = vi.fn(async () => READ(-1));
    const lastValue = await getCachedArtifact("AAPL", `sb-caller-${N - 1}=1`, lastFetcher);
    expect(lastValue).toEqual(READ(N - 1));
    expect(lastFetcher).not.toHaveBeenCalled(); // still cached — not a refetch

    // A DIFFERENT caller's cookie must never read back the last caller's value.
    const otherFetcher = vi.fn(async () => READ(-2));
    const otherValue = await getCachedArtifact("AAPL", "sb-caller-nonexistent=1", otherFetcher);
    expect(otherValue).toEqual(READ(-2));
    expect(otherFetcher).toHaveBeenCalledTimes(1); // its own miss, its own fetch
  });
});
