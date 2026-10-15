import { optionsReadAccess } from "./optionsAccess";
import { cache } from "react";
import { createHash } from "node:crypto";
import { billingAuth, BILLING_BASE } from "@/app/api/billing/gateway";
import { verifyAccessToken } from "@/lib/supabase/accessToken";
import { isPaidSubscriptionTier, normalizeSubscriptionTier } from "@/lib/subscriptionTier";

/**
 * Server-side entitlement checks against the AUTHORITY — macro-api
 * `user_entitlements` (written by app/billing.py from Stripe), surfaced via
 * `GET {BILLING_BASE}/api/me` → `{ tier, features }`.
 *
 * NOT `profiles.is_pro`: terminal/AGENTS.md flags that as a UI hint that can
 * drift from the real subscription (a paid user with a stale hint gets wrongly
 * blocked; an expired one wrongly allowed).
 *
 * All checks FAIL-CLOSED: no session / non-2xx / error → the restrictive answer,
 * so a paid surface is never served on uncertainty.
 */
type Entitlement = { tier: string; features: string[] };
type EntitlementLookup =
  | { status: "ok"; ent: Entitlement }
  | { status: "denied" }
  | { status: "unavailable" };
export type LiveOptionsAccess = "allowed" | "denied" | "unavailable";

/**
 * Short-TTL, POSITIVE-ONLY entitlement cache.
 *
 * WHY: one cold /options load resolves entitlement SEVEN times — the page render
 * (app/(shell)/options/page.tsx), five /api/flow GETs and the /api/flow/stream
 * open. Each resolution is a cross-origin `GET {BILLING_BASE}/api/me` measured at
 * ~0.5 s TTFB, and because the client's fetch waves are serial those six
 * duplicates land directly on the critical path.
 *
 * THE AUTHORITY DOES NOT MOVE. macro-api still decides; this only stops us asking
 * it the same question about the same access token six more times inside one page
 * load. The contract that keeps that safe:
 *
 *   - keyed by SHA-256 of the caller's access token, so one user's answer can
 *     never satisfy another user's gate — and no raw JWT is retained in the map;
 *   - only a POSITIVE answer is stored. A null (unauthed / non-2xx / network
 *     error) and an answer that fails the calling gate are never cached, so a
 *     fail-closed "no" is always re-derived from the authority and a freshly
 *     upgraded user is never stuck behind the paywall;
 *   - TTL 45 s (inside the specced 30–60 s band): a revocation can lag by at most
 *     one TTL, the same bound the /api/flow payload cache already runs on;
 *   - in-flight dedup collapses the concurrent gates of one page load onto a
 *     single upstream call;
 *   - `isPaidTier()` — the Pine-script SAVE gate — deliberately does NOT use it.
 *     Write paths keep resolving fresh.
 */
const ENT_TTL_MS = 45_000;
/** Live read connections revalidate on this same owner's positive-cache bound. */
export const LIVE_OPTIONS_CACHE_TTL_MS = ENT_TTL_MS;
/** Bound the map so a long-lived process with many signed-in users cannot grow it forever. */
const ENT_MAX_KEYS = 512;

type CacheEntry = { ent: Entitlement; ts: number };
const CACHE = new Map<string, CacheEntry>();
const INFLIGHT = new Map<string, Promise<EntitlementLookup>>();

function tokenKey(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

/** Drop expired keys once oversized; hard-reset if that was not enough. */
function sweep(now: number): void {
  if (CACHE.size <= ENT_MAX_KEYS) return;
  for (const [k, v] of CACHE) {
    if (now - v.ts >= ENT_TTL_MS) CACHE.delete(k);
  }
  if (CACHE.size > ENT_MAX_KEYS) CACHE.clear();
}

/** A failed authority read is NOT evidence that a paid subscriber lost access.
 * Always fail closed; return a retryable outage separately from an explicit denial.
 * A bounded abort keeps a hung billing gateway from reaching the edge 524 deadline.
 */
async function fetchEntitlementFor(token: string): Promise<EntitlementLookup> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4_000);
  try {
    const r = await fetch(`${BILLING_BASE}/api/me`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (r.status === 401 || r.status === 403) return { status: "denied" };
    if (!r.ok) return { status: "unavailable" };
    const d = await r.json();
    if (typeof d?.tier !== "string" || !Array.isArray(d?.features) ||
      !d.features.every((feature: unknown) => typeof feature === "string")) {
      return { status: "unavailable" };
    }
    return { status: "ok", ent: { tier: d.tier, features: d.features } };
  } catch {
    return { status: "unavailable" };
  } finally {
    clearTimeout(timer);
  }
}

/** Bound the Supabase auth read as well as the billing read. A stalled auth provider
 * must not keep an Options page or data request pending until the CDN emits 524.
 * The underlying auth promise is read-only and may settle after the deadline;
 * its result is never used to grant the timed-out request. */
type OptionsAuthResult =
  | { status: "ok"; token: string }
  | { status: "denied" | "unavailable" };
async function readOptionsAuth(): Promise<OptionsAuthResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race<OptionsAuthResult>([
      billingAuth().then(
        (auth): OptionsAuthResult => auth ? { status: "ok", token: auth.token } : { status: "denied" },
        (): OptionsAuthResult => ({ status: "unavailable" }),
      ),
      new Promise<OptionsAuthResult>((resolve) => {
        timer = setTimeout(() => resolve({ status: "unavailable" }), 5_000);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Uncached resolution: one auth pair (itself memoized per request by
 * `billingAuth`) plus one live `/api/me`. React `cache()` dedupes repeat gates
 * inside a single render; outside a React request scope it degrades to a plain
 * call, so this is exactly the pre-existing behaviour.
 */
const fetchEntitlement = cache(async (): Promise<Entitlement | null> => {
  try {
    const auth = await billingAuth();
    if (!auth) return null;
    const lookup = await fetchEntitlementFor(auth.token);
    return lookup.status === "ok" ? lookup.ent : null;
  } catch {
    return null; // auth-network exceptions also fail closed on all write gates
  }
});

/**
 * Cached resolution for ONE gate. `gate.ok` is that gate's own predicate: only an
 * entitlement that SATISFIES it is worth remembering, so every "no" is re-asked.
 *
 * The key carries the gate id as well as the token so the positive-only rule can
 * never be subverted by a second gate: if gate A cached an entitlement that gate
 * B reads as "no", B would be serving a cached negative. Separate lanes keep the
 * invariant local. Only `hasLiveOptions` uses this path today, so the extra lane
 * costs nothing.
 */
async function fetchEntitlementCached(
  gate: { id: string; ok: (e: Entitlement) => boolean },
): Promise<EntitlementLookup> {
  const auth = await readOptionsAuth();
  if (auth.status !== "ok") return auth;

  const key = `${gate.id}:${tokenKey(auth.token)}`;
  const now = Date.now();
  const hit = CACHE.get(key);
  if (hit) {
    if (now - hit.ts < ENT_TTL_MS) return { status: "ok", ent: hit.ent };
    CACHE.delete(key);
  }

  const pending = INFLIGHT.get(key);
  if (pending) return pending;

  const p: Promise<EntitlementLookup> = fetchEntitlementFor(auth.token).then(
    (result) => {
      INFLIGHT.delete(key);
      if (result.status === "ok" && gate.ok(result.ent)) {
        CACHE.set(key, { ent: result.ent, ts: Date.now() });
        sweep(Date.now());
      } else {
        CACHE.delete(key); // denied, unentitled and offline states never cached
      }
      return result;
    },
    (): EntitlementLookup => {
      INFLIGHT.delete(key);
      CACHE.delete(key);
      return { status: "unavailable" };
    },
  );
  INFLIGHT.set(key, p);
  return p;
}

/** Live-options read gate: catalog feature for customers + the private operator/unlimited overlay. */
const LIVE_OPTIONS = {
  id: "live_options",
  // Macro /api/me applies the private operator/comp allowlist by overriding the
  // effective tier to `unlimited` after reading the billing row; it deliberately
  // does not synthesize customer feature keys into that row. `unlimited` is
  // already the Terminal's Pro-equivalent operator tier (see isProTier below),
  // so it must carry read access here too. Keep the exception exact: ordinary
  // free/essential/pro callers still require the explicit feature authority.
  ok: (e: Entitlement) => optionsReadAccess(e),
};

/** Live-options surface — customer feature entitlement plus the private unlimited operator tier. */
/** Tri-state boundary for the page and polling API. Never grants on uncertainty. */
export async function getLiveOptionsAccess(): Promise<LiveOptionsAccess> {
  const result = await fetchEntitlementCached(LIVE_OPTIONS);
  if (result.status !== "ok") return result.status;
  return LIVE_OPTIONS.ok(result.ent) ? "allowed" : "denied";
}

/** Boolean compatibility for existing security-sensitive call sites. */
export async function hasLiveOptions(): Promise<boolean> {
  return (await getLiveOptionsAccess()) === "allowed";
}

/** Authority held by one long-lived live-options connection. */
export type LiveOptionsGrant = { renew: () => Promise<boolean> };

/**
 * Open a live-options connection grant from a fresh authority read.
 *
 * The open never reads the positive cache or joins another gate's in-flight
 * read, so a nearly expired page answer cannot start a new connection lifetime.
 *
 * `renew` re-checks the SAME access token the connection opened with: Supabase
 * Auth verifies it through a client with no stored session, and `/api/me`
 * re-reads the feature authority for it. It deliberately does not go back
 * through the cookie session: inside a response that is already streaming,
 * loading a near-expiry cookie session would spend the browser's refresh token
 * on the server, and the rotated cookie could never reach the browser. When the
 * opening token stops verifying, renewal fails closed and the client reconnects
 * with its own current session.
 */
/** A fresh stream authority check; unlike a page-cache hit, a stream must
 * authenticate its opening token and distinguish outage from actual denial. */
export async function openLiveOptionsGrantResult(): Promise<
  | { status: "allowed"; grant: LiveOptionsGrant }
  | { status: "denied" | "unavailable" }
> {
  const auth = await readOptionsAuth();
  if (auth.status !== "ok") return auth;
  const opened = await fetchEntitlementFor(auth.token);
  if (opened.status !== "ok") return { status: opened.status };
  if (!LIVE_OPTIONS.ok(opened.ent)) return { status: "denied" };
  const token = auth.token;
  return {
    status: "allowed",
    grant: {
      renew: async () => {
        try {
          const [owner, next] = await Promise.all([
            verifyAccessToken(token),
            fetchEntitlementFor(token),
          ]);
          return !!owner && next.status === "ok" && LIVE_OPTIONS.ok(next.ent);
        } catch {
          return false;
        }
      },
    },
  };
}

/** Compatibility for existing callers that use only a boolean stream grant. */
export async function openLiveOptionsGrant(): Promise<LiveOptionsGrant | null> {
  const result = await openLiveOptionsGrantResult();
  return result.status === "allowed" ? result.grant : null;
}

/**
 * Human research issuance is deliberately narrower than the paid options read
 * surface.  A paid account may read options evidence; it may never turn a
 * proposal into a research position unless the billing authority supplies this
 * explicit operator capability (or its operator-only unlimited tier).
 *
 * This is a server-side convenience gate only.  The Macro operator endpoint
 * rechecks the same authority before appending a review event.
 */
export async function hasIssueDeskOperator(): Promise<boolean> {
  const e = await fetchEntitlement();
  return !!e && (
    e.tier.trim().toLowerCase() === "unlimited"
    || e.features.includes("options_issue_desk_operator")
  );
}

/**
 * Any PAID account (essential or pro, incl. 7-day trial). Used where the surface
 * isn't broken out as its own feature in config/plans.yml — e.g. Pine-script
 * save — matching the legacy `is_pro` boolean's "any paid" semantics. If a
 * surface should be pro-ONLY, gate on `tier === "pro"` instead.
 *
 * Deliberately UNCACHED beyond the per-request memo: its callers include a write
 * path (app/api/scripts/save), and a write gate resolves fresh every time.
 */
export async function isPaidTier(): Promise<boolean> {
  const e = await fetchEntitlement();
  return !!e && isPaidSubscriptionTier(e.tier);
}

/** Pro-equivalent account, including the billing authority's operator/comp `unlimited` tier. */
export async function isProTier(): Promise<boolean> {
  const e = await fetchEntitlement();
  return !!e && normalizeSubscriptionTier(e.tier) === "pro";
}
