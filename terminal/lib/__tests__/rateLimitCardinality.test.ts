/**
 * rateLimitCardinality.test.ts — the brake must not itself be the memory sink (F-3).
 *
 * The limiter swept EXPIRED buckets once the map passed 10,000. Inside one 60-second window a
 * spoofed-header or botnet flood presents an unbounded number of distinct source IPs and none of
 * them are expired, so the sweep reclaimed nothing and the map grew per request. SECURITY.md is
 * right that this limiter is a brake rather than the durable WAF wall — but a brake that allocates
 * without limit hands the attacker the resource they came for.
 *
 * These tests drive real Requests through the real limiter with distinct CDN client-IP headers.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { __bucketCount, rateLimit, tooMany } from "@/lib/rateLimit";

// Each test uses its own limiter name: bucket maps are module state keyed by name, so a fresh
// name is a fresh limiter without needing to reset module registry internals.
let seq = 0;
const freshName = () => `test-${++seq}-${Math.random().toString(36).slice(2)}`;

const req = (ip: string) =>
  new Request("https://x.test/api/thing", { headers: { "cf-connecting-ip": ip } });

const CAP = Number(process.env.RATE_LIMIT_MAX_BUCKETS) || 20_000;

beforeEach(() => {
  vi.useRealTimers();
});

describe("cardinality is bounded", () => {
  it("stays under the ceiling across 30,000 distinct source IPs in one window", () => {
    const name = freshName();
    let admitted = 0;
    let refused = 0;
    for (let i = 0; i < 30_000; i++) {
      const r = rateLimit(req(`10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`), { name, max: 300 });
      if (r.ok) admitted++; else refused++;
    }
    // The bound is the point: memory cannot exceed the ceiling no matter how many IPs arrive.
    expect(__bucketCount(name)).toBeLessThanOrEqual(CAP);
    // And the excess was actually turned away rather than quietly allocated.
    expect(admitted).toBeLessThanOrEqual(CAP);
    expect(refused).toBeGreaterThan(0);
    expect(admitted + refused).toBe(30_000);
  });

  it("refuses the newcomer with a retry-after, not a silent drop", () => {
    const name = freshName();
    for (let i = 0; i < CAP + 10; i++) rateLimit(req(`10.1.${(i >> 8) & 255}.${i & 255}`), { name });
    const r = rateLimit(req("203.0.113.254"), { name });
    expect(r.ok).toBe(false);
    const res = tooMany(r);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
  });
});

describe("the ceiling does not punish IPs already being tracked", () => {
  it("keeps serving a tracked IP its normal quota while the map is full", () => {
    const name = freshName();
    const regular = "198.51.100.7";
    // Establish the regular visitor BEFORE the flood so it owns a slot.
    expect(rateLimit(req(regular), { name, max: 5 }).ok).toBe(true);
    for (let i = 0; i < CAP + 500; i++) rateLimit(req(`10.2.${(i >> 8) & 255}.${i & 255}`), { name, max: 5 });

    // Its remaining quota is unaffected by the flood: requests 2..5 succeed, the 6th trips the
    // ordinary per-IP limit (not the cardinality bound).
    for (let i = 2; i <= 5; i++) expect(rateLimit(req(regular), { name, max: 5 }).ok).toBe(true);
    const sixth = rateLimit(req(regular), { name, max: 5 });
    expect(sixth.ok).toBe(false);
    expect(sixth.retryAfterSec).toBeLessThanOrEqual(60);
  });

  it("does NOT evict a live bucket to admit a new IP — rotation must not reset a quota", () => {
    // This is the property that makes the bound safe rather than exploitable. An LRU would let an
    // attacker push a tracked bucket out with fresh addresses and come back with a clean quota.
    const name = freshName();
    const target = "198.51.100.9";
    for (let i = 0; i < 3; i++) rateLimit(req(target), { name, max: 3 });
    expect(rateLimit(req(target), { name, max: 3 }).ok).toBe(false); // quota spent

    for (let i = 0; i < CAP + 1_000; i++) rateLimit(req(`10.3.${(i >> 8) & 255}.${i & 255}`), { name, max: 3 });

    // Still refused: the flood did not displace its bucket.
    expect(rateLimit(req(target), { name, max: 3 }).ok).toBe(false);
  });
});

describe("expiry still reclaims", () => {
  it("lets a full map admit new IPs again once the window rolls over", () => {
    const name = freshName();
    const t0 = 1_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(t0);
    for (let i = 0; i < CAP + 100; i++) rateLimit(req(`10.4.${(i >> 8) & 255}.${i & 255}`), { name, windowMs: 60_000 });
    expect(rateLimit(req("203.0.113.1"), { name, windowMs: 60_000 }).ok).toBe(false);

    // Past every bucket's reset: the decision-point sweep reclaims and the newcomer is admitted.
    vi.setSystemTime(t0 + 61_000);
    expect(rateLimit(req("203.0.113.2"), { name, windowMs: 60_000 }).ok).toBe(true);
    expect(__bucketCount(name)).toBeLessThan(CAP);
    vi.useRealTimers();
  });

  it("an IP whose own window expired is never treated as a cardinality newcomer", () => {
    const name = freshName();
    const t0 = 2_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(t0);
    const known = "198.51.100.11";
    rateLimit(req(known), { name, windowMs: 60_000, max: 2 });
    // Fill with buckets that expire LATER, so a sweep at t0+61s would not clear them.
    vi.setSystemTime(t0 + 30_000);
    for (let i = 0; i < CAP + 100; i++) rateLimit(req(`10.5.${(i >> 8) & 255}.${i & 255}`), { name, windowMs: 600_000 });

    vi.setSystemTime(t0 + 61_000); // `known` has expired; the flood buckets have not
    const again = rateLimit(req(known), { name, windowMs: 60_000, max: 2 });
    expect(again.ok).toBe(true); // it already owns a slot — refreshing it allocates nothing new
    vi.useRealTimers();
  });
});
