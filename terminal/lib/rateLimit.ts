// In-memory per-IP fixed-window rate limiter shared by the public read APIs.
//
// This is defence-in-depth at the ORIGIN: `next start` is a single node process, so a
// module-level Map persists across requests (same pattern the snapshot upload route uses).
// It raises the cost of symbol-by-symbol scraping without needing a datastore. The durable
// layer is per-IP rate limiting at the CDN/edge and firewalling the origin so the edge can't
// be bypassed — see SECURITY.md. Treat this as a brake, not a wall.

type Bucket = { count: number; reset: number };

// One bucket-map per limiter name so routes don't share a budget.
const buckets = new Map<string, Map<string, Bucket>>();
// Last opportunistic sweep per limiter name — see the throttle in `rateLimit`.
const lastSweep = new Map<string, number>();

function mapFor(name: string): Map<string, Bucket> {
  let m = buckets.get(name);
  if (!m) {
    m = new Map();
    buckets.set(name, m);
  }
  return m;
}

// Real VISITOR IP, not the CDN edge. app.mastermind-x.com is behind Cloudflare, which carries the
// client IP in CF-Connecting-IP; Caddy's trusted_proxies=private_ranges does NOT trust the public CDN,
// so X-Forwarded-For is the CDN EDGE IP, not the person. Prefer the CDN real-client header (CF- for
// Cloudflare, EO-Connecting-IP for the EdgeOne case too), then fall back to XFF/x-real-ip — a proxy
// that hides the IP just shares one "unknown" rate-limit bucket, which is acceptable.
export function clientIp(req: Request): string {
  for (const k of ["cf-connecting-ip", "eo-connecting-ip", "true-client-ip"]) {
    const v = req.headers.get(k)?.trim();
    if (v) return v;
  }
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

export interface RateOptions {
  /** Distinct budget name (usually the route). */
  name: string;
  windowMs?: number;
  max?: number;
}

export interface RateResult {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
}

const DEFAULT_WINDOW = 60_000;
// Generous for a human session (the batched watchlist poll is one request every ~6s, ~10/min),
// punishing for a scraper looping the ~8,700-symbol universe one request at a time. Tune per
// deployment with RATE_LIMIT_MAX without a code change.
const DEFAULT_MAX = Number(process.env.RATE_LIMIT_MAX) || 300;

// ── Cardinality bound ───────────────────────────────────────────────────────────────────────────
// The sweep below only removes EXPIRED buckets, so it does nothing about buckets that are all
// still live. Inside a single 60s window a spoofed-header or botnet flood presents an unbounded
// number of distinct source IPs, every one of them unexpired, and the map grew for every one:
// the brake was itself a memory sink, which is the resource the flood was after.
//
// MAX_BUCKETS is the ceiling on LIVE buckets per limiter name. At the ceiling a request from an
// IP we are not already tracking is refused (429) rather than allocated.
//
// It is deliberately NOT an LRU. Evicting a live bucket to make room for a new IP is precisely
// what an attacker rotating IPs wants: each new address would push out a tracked one, and the
// quota it had accumulated would be forgotten. Tracked buckets therefore keep their slot for the
// remainder of their window, and the newcomer is the one turned away.
const MAX_BUCKETS = Number(process.env.RATE_LIMIT_MAX_BUCKETS) || 20_000;
// Start reclaiming well before the ceiling so ordinary IP churn never reaches it.
const SWEEP_AT = Math.min(10_000, Math.floor(MAX_BUCKETS / 2));
// The sweep is O(size). Running it on every request once the map is large turns a flood into
// quadratic work — the same denial it exists to blunt. Once per second per limiter is plenty:
// buckets live for a whole window (60s by default).
const SWEEP_MIN_INTERVAL_MS = 1_000;

function sweep(name: string, m: Map<string, Bucket>, now: number): void {
  for (const [k, v] of m) if (now > v.reset) m.delete(k);
  lastSweep.set(name, now);
}

export function rateLimit(req: Request, opts: RateOptions): RateResult {
  const windowMs = opts.windowMs ?? DEFAULT_WINDOW;
  const max = opts.max ?? DEFAULT_MAX;
  const ip = clientIp(req);
  const m = mapFor(opts.name);
  const now = Date.now();

  if (m.size >= SWEEP_AT && now - (lastSweep.get(opts.name) ?? 0) >= SWEEP_MIN_INTERVAL_MS) {
    sweep(opts.name, m, now);
  }

  let b = m.get(ip);
  const expired = b != null && now > b.reset;
  if (!b || expired) {
    // Admitting this IP means allocating a slot. An IP whose bucket EXPIRED already owns one, so
    // it is not a newcomer and is never refused for cardinality — it just gets a fresh window.
    if (!b && m.size >= MAX_BUCKETS) {
      // Force a sweep even if throttled: this is the decision point, and reclaiming here is what
      // lets the ceiling breathe as windows expire.
      sweep(opts.name, m, now);
      if (m.size >= MAX_BUCKETS) {
        // Fail CLOSED. Under a cardinality flood an unknown IP is refused rather than admitted at
        // the cost of unbounded memory. Legitimate new visitors are collateral for the duration of
        // the flood — the alternative is the process dying, which refuses them anyway.
        return { ok: false, remaining: 0, retryAfterSec: Math.max(1, Math.ceil(windowMs / 1000)) };
      }
    }
    b = { count: 0, reset: now + windowMs };
    m.set(ip, b);
  }
  if (b.count >= max) {
    return { ok: false, remaining: 0, retryAfterSec: Math.max(1, Math.ceil((b.reset - now) / 1000)) };
  }
  b.count++;
  return { ok: true, remaining: max - b.count, retryAfterSec: 0 };
}

/** Live bucket count for a limiter name. Test seam for the cardinality bound. */
export function __bucketCount(name: string): number {
  return buckets.get(name)?.size ?? 0;
}

/** Standard 429 response for a tripped limiter. */
export function tooMany(result: RateResult): Response {
  return new Response(JSON.stringify({ error: "rate_limited" }), {
    status: 429,
    headers: {
      "content-type": "application/json",
      "retry-after": String(result.retryAfterSec),
      "cache-control": "no-store",
    },
  });
}
