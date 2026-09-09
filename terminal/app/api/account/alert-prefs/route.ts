// Alert-prefs BFF — GET+POST pass-through to macro GET/POST /api/account/prefs.
// Mirrors the portfolio-brief proxy (session-minted Bearer only, status+body
// relayed verbatim, fetch-throw → local 503) plus the brain proxy's 4 KB POST
// body cap. No response cache: a save must never be followed by a stale GET.
//
// We NEVER read or forward a client-supplied Authorization header. The only
// Bearer this route sends is minted from the server-verified session.
//
// Required env: BRAIN_GATEWAY_URL (default https://mastermind-x.com). One
// upstream URL, both verbs — no second MACRO_*_URL.

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimit, tooMany } from "@/lib/rateLimit";

const GATEWAY = process.env.BRAIN_GATEWAY_URL || "https://mastermind-x.com";
const UPSTREAM = `${GATEWAY}/api/account/prefs`;
const MAX_BODY = 4_000;

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

function relay(upstream: Response): Response {
  const contentType =
    upstream.headers.get("content-type") || "application/json; charset=utf-8";
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, no-store",
    },
  });
}

export async function GET(req: Request) {
  const rl = rateLimit(req, { name: "account-alert-prefs", max: 30 });
  if (!rl.ok) return tooMany(rl);

  const token = await sessionToken();
  if (!token) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  try {
    const upstream = await fetch(UPSTREAM, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: req.signal,
    });
    return relay(upstream);
  } catch (e: unknown) {
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: "gateway_unreachable", detail },
      { status: 503 },
    );
  }
}

export async function POST(req: Request) {
  const rl = rateLimit(req, { name: "account-alert-prefs", max: 30 });
  if (!rl.ok) return tooMany(rl);

  const token = await sessionToken();
  if (!token) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const contentType = req.headers.get("content-type") || "application/json";
  const cl = req.headers.get("content-length");
  if (cl && /^\d+$/.test(cl) && parseInt(cl, 10) > MAX_BODY) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }
  const body = await req.text();
  if (body.length > MAX_BODY) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }

  try {
    const upstream = await fetch(UPSTREAM, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": contentType,
        Accept: "application/json",
      },
      body,
      signal: req.signal,
    });
    return relay(upstream);
  } catch (e: unknown) {
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: "gateway_unreachable", detail },
      { status: 503 },
    );
  }
}
