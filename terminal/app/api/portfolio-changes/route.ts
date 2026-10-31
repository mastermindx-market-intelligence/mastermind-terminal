// Same-origin proxy for the macro-api "what changed since your last visit" desk read
// (POST {GATEWAY}/api/portfolio/changes, portfolio_changes.v1), the retention half of the
// portfolio brief. It mirrors app/api/portfolio-brief/route.ts: with a valid Supabase
// session it injects Authorization: Bearer <token> and relays the upstream status + body
// VERBATIM (200 changes / 403 pro_required / 503 ctx or holdings unavailable). With NO
// session it 401s locally and never contacts the gateway.
//
// Two deliberate differences from the brief proxy:
//   * NO server cache. Every call is a per-request diff against the digest the client
//     holds, so a cached answer would be a lie about a different "previous".
//   * NO logging of either body. The request names the user's holdings (the digest is
//     their ticker set) and the response names what moved in them — TWO-ORGANISMS law.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimit, tooMany } from "@/lib/rateLimit";

const GATEWAY = process.env.BRAIN_GATEWAY_URL || "https://mastermind-x.com";
const UPSTREAM = `${GATEWAY}/api/portfolio/changes`;
const NO_STORE = "private, no-store";
/** The desk reads at most 500 names of a few short fields each (engine/portfolio_changes.py
 *  MAX_PREVIOUS_NAMES); a well-formed digest is tens of KB. Anything larger is refused before
 *  it is parsed, so a hostile body cannot buy a JSON.parse or an upstream round trip. */
const MAX_BODY_BYTES = 256 * 1024;

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

/** The client's stored digest, or null. Anything that is not a plain object is sent as null
 *  so the desk answers "first visit" rather than diffing against garbage. */
function previousFrom(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const previous = (body as { previous?: unknown }).previous;
  if (!previous || typeof previous !== "object" || Array.isArray(previous)) return null;
  return previous as Record<string, unknown>;
}

function tooLarge() {
  return NextResponse.json(
    { error: "previous_too_large" },
    { status: 413, headers: { "Cache-Control": NO_STORE } },
  );
}

export async function POST(req: Request) {
  const rl = rateLimit(req, { name: "portfolio-changes", max: 30 });
  if (!rl.ok) return tooMany(rl);

  const token = await sessionToken();
  if (!token) {
    return NextResponse.json(
      { error: "unauthenticated" },
      { status: 401, headers: { "Cache-Control": NO_STORE } },
    );
  }

  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return tooLarge();
  let body: unknown = null;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return tooLarge();
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = null;
  }
  const previous = previousFrom(body);

  try {
    const upstream = await fetch(UPSTREAM, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ previous }),
      signal: req.signal,
    });
    const contentType =
      upstream.headers.get("content-type") || "application/json; charset=utf-8";
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { "Content-Type": contentType, "Cache-Control": NO_STORE },
    });
  } catch {
    // Gateway unreachable — the section renders one quiet "unavailable" line and keeps
    // the digest it already holds; nothing is diffed from unknown state.
    return NextResponse.json(
      { error: "changes_unavailable" },
      { status: 503, headers: { "Cache-Control": NO_STORE } },
    );
  }
}
