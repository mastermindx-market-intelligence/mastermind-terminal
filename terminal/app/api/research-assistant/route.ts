import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { composeEvidenceToThesis } from "@/lib/evidenceToThesis";

export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 32 * 1024;
const GATEWAY = process.env.BRAIN_GATEWAY_URL || "https://mastermind-x.com";

function errorResponse(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

async function boundedBody(request: Request): Promise<Record<string, unknown> | null> {
  const stated = Number(request.headers.get("content-length"));
  if (Number.isFinite(stated) && stated > MAX_REQUEST_BYTES) return null;
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) return null;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const [{ data: { user } }, { data: { session } }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.auth.getSession(),
  ]);
  if (!user || !session?.access_token) return errorResponse("unauthenticated", 401);

  const body = await boundedBody(request);
  if (!body) return errorResponse("invalid_json_or_request_too_large", 400);

  const result = await composeEvidenceToThesis(body.symbol, body.question, {
    gatewayUrl: GATEWAY,
    gatewayFetcher: (input, init) => fetch(input, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        Authorization: `Bearer ${session.access_token}`,
      },
      signal: request.signal,
    }),
  });
  // Retrieval/model holds are typed product states, not transport failures. Returning
  // them as JSON 200 lets the client show exactly what is missing (including a Pro gate)
  // instead of replacing the evidence explanation with a generic fetch error.
  return NextResponse.json(result, { status: 200, headers: { "Cache-Control": "no-store" } });
}
