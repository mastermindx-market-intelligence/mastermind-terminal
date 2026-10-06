// DEPRECATED: the Terminal UI now uses the Mastermind Brain widget via /api/brain/* — this route
// is retained for rollback and is no longer called by the shipped UI.
//
// Brain-gateway proxy — all AI logic lives in the gateway (FastAPI, VPS).
// This route validates the user session then forwards the request to the gateway,
// piping the SSE body straight back to the browser.
//
// Required env vars:
//   BRAIN_GATEWAY_URL  — gateway base URL (default https://mastermind-x.com)
//                        On the VPS the terminal runs co-located: http://127.0.0.1:8000
//   NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY — standard Supabase SSR auth
//
// The gateway expects:  Authorization: Bearer <supabase access token>
// It performs its own tier/quota checks and returns HTTP 402 on exhaustion.

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimit, tooMany } from "@/lib/rateLimit";

const GATEWAY = process.env.BRAIN_GATEWAY_URL || "https://mastermind-x.com";

// Maximum message length accepted by the gateway contract.
const MAX_MSG_LEN = 2000;

export async function POST(req: Request) {
  // Rate-limit at the edge before we do any work — tight per-IP ceiling for a paid-LLM route.
  const rl = rateLimit(req, { name: "copilot", max: 20 });
  if (!rl.ok) return tooMany(rl);

  // Auth gate: obtain the user's access token to forward to the gateway.
  // getSession() alone is unverified (relies on the cookie value); getUser() verifies
  // the JWT with Supabase Auth so we catch expired/revoked sessions before proxying.
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!session || !user) {
    return NextResponse.json(
      { error: "Please sign in to use the copilot.", code: "unauthenticated" },
      { status: 401 },
    );
  }

  // Parse and sanitize client body — only forward the contract fields.
  let body: any;
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const message =
    typeof body?.message === "string"
      ? body.message.slice(0, MAX_MSG_LEN)
      : "";
  if (!message) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  const lane: "fast" | "pro" =
    body?.lane === "pro" ? "pro" : "fast";

  const mode: "chat" | "research" =
    body?.mode === "research" ? "research" : "chat";

  const thread_id =
    typeof body?.thread_id === "string" ? body.thread_id : undefined;

  // Stateless-fallback history: [{role, content}], max 12, trusted shapes only.
  const history = Array.isArray(body?.history)
    ? body.history
        .filter(
          (m: any) =>
            m &&
            (m.role === "user" || m.role === "assistant") &&
            typeof m.content === "string",
        )
        .slice(-12)
        .map((m: any) => ({ role: m.role, content: m.content.slice(0, 8000) }))
    : undefined;

  const context: { symbol?: string; page?: string } = {};
  if (typeof body?.context?.symbol === "string")
    context.symbol = body.context.symbol.slice(0, 24);
  if (typeof body?.context?.page === "string")
    context.page = body.context.page.slice(0, 64);

  const payload: Record<string, unknown> = { message, lane, mode };
  if (thread_id) payload.thread_id = thread_id;
  if (history && history.length > 0) payload.history = history;
  if (Object.keys(context).length > 0) payload.context = context;

  // Forward to gateway stream endpoint.
  let upstream: Response;
  try {
    upstream = await fetch(`${GATEWAY}/api/brain/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(payload),
      signal: req.signal,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Gateway unreachable", detail: e?.message },
      { status: 502 },
    );
  }

  // Relay known error status codes as JSON so the panel can render them.
  if (upstream.status === 401) {
    return NextResponse.json(
      { error: "Session expired. Please sign in again.", code: "unauthenticated" },
      { status: 401 },
    );
  }
  if (upstream.status === 402) {
    // Quota exhausted — relay the gateway payload unchanged.
    const data = await upstream.json().catch(() => ({
      quota_exhausted: true,
      upgrade: "https://mastermind-x.com/plans.html",
    }));
    return NextResponse.json(data, { status: 402 });
  }
  if (upstream.status === 429) {
    return NextResponse.json(
      { error: "Rate limit reached. Try again shortly." },
      { status: 429 },
    );
  }
  if (!upstream.ok || !upstream.body) {
    const txt = await upstream.text().catch(() => "");
    return NextResponse.json(
      { error: `Gateway error (${upstream.status})`, detail: txt.slice(0, 200) },
      { status: 502 },
    );
  }

  // Pipe the SSE body straight through.
  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
