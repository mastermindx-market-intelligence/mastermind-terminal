// Portfolio-brief proxy — GET-only pass-through to the macro-api desk endpoint
// (GET {GATEWAY}/api/portfolio/brief), mirroring the brain-gateway proxy pattern
// (app/api/brain/[...path]/route.ts). CSP blocks the browser from calling the gateway
// cross-origin, so the "Your book today" panel calls this same-origin route; here we
// verify the Supabase session and, when it exists, inject Authorization: Bearer <token>.
//
// AUTHORITY: the macro-api endpoint is the sole authority on the Pro entitlement (it
// checks the canonical Stripe-backed tier). We do NOT gate on `profiles.is_pro` here —
// that flag is only the terminal's initial-UI hint. This route forwards to the gateway
// and relays its status verbatim: 200 (brief), 403 {error:"pro_required",tier} (teaser),
// 503 (artifact unavailable). The one thing we short-circuit is a MISSING session: with
// no bearer to send there is nothing for the desk to key a per-user brief on, so we 401
// locally and never contact the gateway (the panel treats 401 as "hidden").
//
// FRESHNESS: this proxy holds NO success cache. The producer owns freshness — macro's
// /api/portfolio/brief loads the CURRENT holdings BEFORE it consults its own
// (uid, ctx-file-mtime, holdings-fingerprint) cache, so a brief it serves is keyed to the
// book as it stands now. A token-keyed cache here sat in front of that and could hand
// back a brief composed for an EARLIER book (and replay a success after a later failure),
// which is exactly the stale-brief symptom this route must not create. Every
// authenticated read therefore reaches the producer, and the upstream read is explicit
// `cache: "no-store"` so no framework-level cache can reintroduce the same staleness.
//
// Required env: BRAIN_GATEWAY_URL (default https://mastermind-x.com).

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimit, tooMany } from "@/lib/rateLimit";

const GATEWAY = process.env.BRAIN_GATEWAY_URL || "https://mastermind-x.com";
const UPSTREAM = `${GATEWAY}/api/portfolio/brief`;

// Verify the session and return the access token, or null when there is no valid session.
// We NEVER read or forward a client-supplied Authorization header — the only Bearer this
// proxy sends is one minted here from the server-verified session.
async function sessionToken(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!session || !user) return null;
  return session.access_token;
}

export async function GET(req: Request) {
  const rl = rateLimit(req, { name: "portfolio-brief", max: 30 });
  if (!rl.ok) return tooMany(rl);

  const token = await sessionToken();
  // No session → nothing to key a per-user brief on. 401 locally; the panel hides itself.
  if (!token) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  try {
    const upstream = await fetch(UPSTREAM, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      // Explicitly uncached: the producer is the freshness authority (it keys its own
      // cache to the live holdings), so this read must always observe the remote.
      cache: "no-store",
      signal: req.signal,
    });
    const contentType =
      upstream.headers.get("content-type") || "application/json; charset=utf-8";
    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, no-store",
        // Diagnostic only. There is no proxy cache any more, so a response can never be
        // a proxy-cache hit — say "miss" truthfully rather than claim a hit.
        "X-Brief-Cache": "miss",
      },
    });
  } catch (e: any) {
    // Gateway unreachable — the panel renders one quiet "unavailable" line and the
    // Conviction Book below is never blocked. 503 keeps the panel's unavailable branch.
    return NextResponse.json(
      { error: "gateway_unreachable", detail: e?.message },
      { status: 503 },
    );
  }
}
