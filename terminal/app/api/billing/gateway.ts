// Shared helpers for the terminal → macro-api billing proxy routes.
//
// These routes are thin: validate the caller's Supabase session (except /config,
// which needs none), forward to the billing gateway with the user's access token,
// and pipe the upstream status + JSON straight back. All Stripe secret-key logic
// lives in the gateway (separate repo) — the terminal never sees a secret key.
//
// Contract (gateway, code against verbatim):
//   GET  {BASE}/api/billing/config           → { publishable_key } · 503 unconfigured
//   POST {BASE}/api/billing/subscribe/init    → { client_secret, customer_id }
//   POST {BASE}/api/billing/subscribe/complete→ { status, subscription_id, trial_end }
//   GET  {BASE}/api/me                         → { tier, features, status, current_period_end }
//
// BASE env = BILLING_GATEWAY_BASE (default https://www.mastermind-x.com).

import { cache } from "react";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const BILLING_BASE =
  process.env.BILLING_GATEWAY_BASE || "https://www.mastermind-x.com";

// Tiers the terminal is allowed to forward. The gateway re-validates, but bounding
// here keeps garbage off the wire and returns a crisp 400 to the UI.
//
// `essential` is now the canonical name for this entitlement and is what the
// Terminal EMITS. `insider` is the pre-rename name and stays accepted (not
// translated) because the gateway takes BOTH names — a cached page or an old
// bookmark can still post it, and bouncing it here would 400 a real checkout.
// Order matters only for readability; canonical first.
export const VALID_TIERS = ["essential", "insider", "pro"] as const;
export const VALID_INTERVALS = ["monthly", "annual"] as const;
export type ValidTier = (typeof VALID_TIERS)[number];
export type ValidInterval = (typeof VALID_INTERVALS)[number];

export function isTier(v: unknown): v is ValidTier {
  return typeof v === "string" && (VALID_TIERS as readonly string[]).includes(v);
}
export function isInterval(v: unknown): v is ValidInterval {
  return typeof v === "string" && (VALID_INTERVALS as readonly string[]).includes(v);
}

/**
 * Resolve the verified user + access token, or null when unauthed.
 *
 * Memoized PER REQUEST with React `cache()`: several gates in one render (page
 * gate + billing read + entitlement check) collapse onto a single
 * getSession()+getUser() pair instead of repeating the Supabase round trip for
 * each. The memo never spans requests, so the verification below still runs on
 * every inbound request and a revoked session is caught immediately. Outside a
 * React request scope (e.g. a plain route handler) `cache()` degrades to a
 * direct call, so behaviour there is byte-for-byte what it was before.
 */
/** A typed observation from the existing Supabase verifier, not a second auth owner.
 * Invalid/absent sessions are denied. A retryable provider error remains distinct
 * so read-only Options can show an outage without claiming a subscription downgrade.
 */
export type BillingAuthResult =
  | { status: "ok"; token: string }
  | { status: "denied" | "unavailable" };

function isRetryableAuthError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { name?: unknown; status?: unknown };
  return e.name === "AuthRetryableFetchError"
    || (typeof e.status === "number" &&
      (e.status === 0 || e.status === 429 || e.status >= 500));
}

export const billingAuthResult = cache(async (): Promise<BillingAuthResult> => {
  try {
    const supabase = await createClient();
    // getSession() may refresh an expiring token. Verify precisely the token
    // it returns: independent concurrent getSession()/getUser() calls can read
    // different session generations during a refresh or account transition.
    const sessionRead = await supabase.auth.getSession();
    if (sessionRead.error) {
      return { status: isRetryableAuthError(sessionRead.error) ? "unavailable" : "denied" };
    }
    const token = sessionRead.data.session?.access_token;
    if (!token) return { status: "denied" };

    // getUser(jwt) makes Supabase Auth verify THIS bearer token, not whatever
    // a second read of mutable cookie storage happens to return. No success
    // from a cookie-only session; no second authentication authority.
    const userRead = await supabase.auth.getUser(token);
    if (userRead.error) {
      return { status: isRetryableAuthError(userRead.error) ? "unavailable" : "denied" };
    }
    if (!userRead.data.user) return { status: "denied" };
    return { status: "ok", token };
  } catch {
    return { status: "unavailable" };
  }
});

/** Existing auth consumers retain their null-on-refusal contract, including writes. */
export const billingAuth = cache(async (): Promise<{ token: string } | null> => {
  const result = await billingAuthResult();
  return result.status === "ok" ? { token: result.token } : null;
});

/** Forward to the gateway and pipe its status + JSON back verbatim. */
export async function forward(
  path: string,
  init: { method: "GET" | "POST"; token?: string; body?: unknown; signal?: AbortSignal },
): Promise<Response> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.body !== undefined) headers["Content-Type"] = "application/json";

  let upstream: Response;
  try {
    upstream = await fetch(`${BILLING_BASE}${path}`, {
      method: init.method,
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: init.signal,
      cache: "no-store",
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: "Billing service unreachable", detail: e instanceof Error ? e.message : undefined },
      { status: 502 },
    );
  }

  // Pipe upstream status + JSON through unchanged. Non-JSON bodies (rare — a proxy
  // error page) degrade to a generic shape so the UI still gets valid JSON.
  const text = await upstream.text().catch(() => "");
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: `Billing service error (${upstream.status})`, detail: text.slice(0, 200) };
  }
  return NextResponse.json(data as Record<string, unknown>, { status: upstream.status });
}
