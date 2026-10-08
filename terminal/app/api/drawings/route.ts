import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { MAX_DRAWING_PAYLOAD_BYTES, MAX_DRAWINGS_PER_SYMBOL } from "@/lib/drawings";
import { parseDrawingSnapshot, parsePersistedDrawings, validDrawingOperationId, validDrawingRevision } from "@/lib/drawingPersistence";

async function ctx() {
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
