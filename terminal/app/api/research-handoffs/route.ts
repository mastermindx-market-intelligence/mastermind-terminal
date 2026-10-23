import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimit, tooMany } from "@/lib/rateLimit";
import {
  handleHandoffDelete,
  handleHandoffGet,
  handleHandoffPost,
  type HandoffHandlerDeps,
  type HandoffRpcDb,
} from "@/lib/researchHandoffsServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Every answer — success, 401, 400, 409, 413, 429, 503 — is per-owner private state.
const headers = { "Cache-Control": "private, no-store", "Vary": "Cookie" };

const respond = (handler: { status: number; body: Record<string, unknown> }) =>
  NextResponse.json(handler.body, { status: handler.status, headers });

const deps = (): HandoffHandlerDeps => ({
  // Same session client the investigations route uses; cast to the narrow RPC surface.
  db: async () => (await createClient()) as unknown as HandoffRpcDb,
});

// Mutations share one limiter budget (same pattern as the investigations save route). `tooMany`
// supplies the status/body/retry-after; the private caching headers are layered on because a
// handoff answer is per-owner even when it refuses.
function mutated(request: Request): Response | null {
  const limit = rateLimit(request, { name: "research-handoffs-mutate", max: 30 });
  if (limit.ok) return null;
  const base = tooMany(limit);
  return new Response(base.body, {
    status: base.status,
    headers: { ...Object.fromEntries(base.headers), ...headers },
  });
}

export async function GET(request: Request) {
  return respond(await handleHandoffGet(request, deps()));
}

export async function POST(request: Request) {
  const gate = mutated(request);
  if (gate) return gate;
  return respond(await handleHandoffPost(request, deps()));
}

export async function DELETE(request: Request) {
  const gate = mutated(request);
  if (gate) return gate;
  return respond(await handleHandoffDelete(request, deps()));
}
