import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { MAX_DRAWING_PAYLOAD_BYTES, MAX_DRAWINGS_PER_SYMBOL } from "@/lib/drawings";
import { parseDrawingSnapshot, parsePersistedDrawings, validDrawingOperationId, validDrawingRevision } from "@/lib/drawingPersistence";
import { GUEST_COOKIE } from "@/lib/layoutsFixtureDb";

const isE2eFixture = () => process.env.TERMINAL_E2E_FIXTURE === "1";
type DrawingSession = { supabase: Awaited<ReturnType<typeof createClient>> | null; user: { email?: string } | null };

/**
 * The Playwright dev server signs the page in as TERMINAL_E2E_EMAIL without a
 * Supabase session. Give that same identity a stateless empty account so the
 * page's readiness gate opens exactly as it does for a real account. This is
 * never reachable in production (the variable is unset there); specs that test
 * cloud saves, conflicts or load failures mock this route in the browser.
 */
async function ctx(): Promise<DrawingSession> {
  if (isE2eFixture()) {
    const guest = (await cookies()).get(GUEST_COOKIE)?.value === "1";
    const email = process.env.TERMINAL_E2E_EMAIL;
    return { supabase: null, user: !guest && email ? { email } : null };
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function GET(req: Request) {
  const { supabase, user } = await ctx();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const query = new URL(req.url).searchParams;
  const expectedOwner = query.get("ownerKey");
  if (expectedOwner && expectedOwner.toLowerCase() !== `account:${user.email ?? ""}`.toLowerCase()) {
    return NextResponse.json({ error: "Account changed" }, { status: 409 });
  }
  const symbol = query.get("symbol")?.trim();
  if (!symbol || symbol.length > 64) return NextResponse.json({ error: "A symbol is required" }, { status: 400 });
  if (!supabase) return NextResponse.json({ drawings: [], revision: null, schemaVersion: 1 }, { headers: { "Cache-Control": "private, no-store" } });
  // SECURITY INVOKER RPC uses auth.uid(), explicit owner/symbol filters, and existing RLS.
  // One aggregate reads one snapshot; GET creates no legacy operation receipt.
  const { data, error } = await supabase.rpc("read_drawings_collection", { p_symbol: symbol });
  const snapshot = !error ? parseDrawingSnapshot(data) : null;
  if (!snapshot) return NextResponse.json({ error: "Could not load drawings" }, { status: 503 });
  return NextResponse.json(snapshot, { headers: { "Cache-Control": "private, no-store" } });
}

export async function PUT(req: Request) {
  const { supabase, user } = await ctx();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  let payload: unknown;
  try {
    const body = await req.text();
    if (new TextEncoder().encode(body).byteLength > MAX_DRAWING_PAYLOAD_BYTES) {
      return NextResponse.json({ ok: false, error: "Drawing payload is too large" }, { status: 413 });
    }
    payload = JSON.parse(body);
  } catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return NextResponse.json({ ok: false }, { status: 400 });
  const raw = payload as Record<string, unknown>;
  if (typeof raw.ownerKey !== "string" || raw.ownerKey.toLowerCase() !== `account:${user.email ?? ""}`.toLowerCase()) {
    return NextResponse.json({ ok: false, code: "owner_conflict" }, { status: 409 });
  }
  const symbol = typeof raw.symbol === "string" ? raw.symbol.trim() : "";
  if (!symbol || symbol.length > 64 || !Array.isArray(raw.drawings)) return NextResponse.json({ ok: false }, { status: 400 });
  if (!Object.hasOwn(raw, "expectedRevision") || !validDrawingRevision(raw.expectedRevision)
    || !validDrawingOperationId(raw.operationId)) {
    return NextResponse.json({ ok: false, error: "Reload before saving drawings" }, { status: 400 });
  }
  if (raw.drawings.length > MAX_DRAWINGS_PER_SYMBOL) return NextResponse.json({ ok: false }, { status: 413 });
  const drawings = parsePersistedDrawings(raw.drawings);
  if (!drawings) return NextResponse.json({ ok: false, error: "Invalid user drawing geometry" }, { status: 422 });
  if (!supabase) {
    return NextResponse.json({ ok: true, operationId: raw.operationId, revision: crypto.randomUUID(),
      idempotentReplay: false, superseded: false, count: drawings.length, schemaVersion: 1 });
  }
  // One transaction performs CAS, delete+insert, and bounded operation replay.
  // Missing RPC/migration is unavailable; there is no destructive legacy fallback.
  const { data, error } = await supabase.rpc("replace_drawings_collection", {
    p_symbol: symbol, p_drawings: drawings, p_expected_revision: raw.expectedRevision, p_operation_id: raw.operationId,
  });
  if (error) return NextResponse.json({ ok: false, error: "Could not save drawings" }, { status: 503 });
  if (data?.ok === false && ["revision_conflict", "operation_payload_mismatch"].includes(data.code)) {
    return NextResponse.json({ ok: false, code: data.code }, { status: 409 });
  }
  if (data?.ok !== true || !validDrawingOperationId(data.revision)
    || typeof data.idempotentReplay !== "boolean" || typeof data.superseded !== "boolean"
    || (data.superseded && !data.idempotentReplay)) {
    return NextResponse.json({ ok: false, error: "Invalid drawing receipt" }, { status: 503 });
  }
  return NextResponse.json({ ok: true, operationId: raw.operationId, revision: data.revision,
    idempotentReplay: data.idempotentReplay, superseded: data.superseded, count: drawings.length, schemaVersion: 1 });
}
