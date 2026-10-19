import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  MAX_DRAWING_PAYLOAD_BYTES, MAX_DRAWINGS_PER_SYMBOL, normalizeDrawings, type Drawing,
} from "@/lib/drawings";
import { drawingToolAcceptsPersistedPointCount } from "@/lib/drawingTools";
import { aiDrawingCollectionError, drawingSourceConflict, readStoredAiDrawing } from "@/lib/drawingAiPersistence";

type StoredDrawingRow = { id: string; kind: string; data?: Record<string, unknown> | null };
type StoredIdRow = { id: string };
const COLLECTION_KIND = "__collection_v1";

async function ctx() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}
const validOwner = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 128 && value.trim() === value;
function storedCollection(rows: StoredDrawingRow[]): Drawing[] {
  const collection = [...rows].reverse().find(row => row.kind === COLLECTION_KIND);
  return collection && Array.isArray(collection.data?.drawings)
    ? normalizeDrawings(collection.data.drawings)
    : normalizeDrawings(rows.map(row => ({ id: row.data?.id || row.id, kind: row.kind, ...(row.data || {}) })));
}

export async function GET(req: Request) {
  const url = new URL(req.url), expectedOwner = url.searchParams.get("owner_id");
  if (expectedOwner !== null && !validOwner(expectedOwner))
    return NextResponse.json({ error: "Invalid drawing owner" }, { status: 400 });
  const { supabase, user } = await ctx();
  if (!user) return expectedOwner !== null
    ? NextResponse.json({ error: "Sign in to load drawings" }, { status: 401 })
    : NextResponse.json({ drawings: [] });
  if (expectedOwner !== null && expectedOwner !== user.id)
    return NextResponse.json({ error: "Drawing account changed" }, { status: 409 });
  const symbol = url.searchParams.get("symbol");
  if (!symbol) return NextResponse.json({ drawings: [], error: "A symbol is required" }, { status: 400 });
  const { data, error } = await supabase.from("drawings").select("*")
    .eq("user_id", user.id).eq("symbol", symbol).order("created_at", { ascending: true });
  if (error) {
    console.error("drawings GET failed:", error);
    return NextResponse.json({ drawings: [], error: "Could not load drawings" }, { status: 500 });
  }
  return NextResponse.json({ drawings: storedCollection((data || []) as StoredDrawingRow[]),
    schemaVersion: 1, aiSchemaVersion: 1, owner_id: user.id });
}

// The existing account collection remains the sole storage owner. Version1
// explicitly replaces the mixed snapshot; legacy requests replace humans only.
// Concurrent tabs retain the incumbent full-snapshot last-writer semantics.
export async function PUT(req: Request) {
  const { supabase, user } = await ctx();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  let payload: unknown;
  try {
    const body = await req.text();
    if (new TextEncoder().encode(body).byteLength > MAX_DRAWING_PAYLOAD_BYTES)
      return NextResponse.json({ ok: false, error: "Drawing payload is too large" }, { status: 413 });
    payload = JSON.parse(body);
  } catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
  const raw = payload as { symbol?: unknown; drawings?: unknown; owner_id?: unknown; aiSchemaVersion?: unknown };
  if (Object.hasOwn(raw, "owner_id") && (!validOwner(raw.owner_id) || raw.owner_id !== user.id))
    return NextResponse.json({ ok: false, error: "Drawing account changed" }, { status: 409 });
  if (Object.hasOwn(raw, "aiSchemaVersion") && raw.aiSchemaVersion !== 1)
    return NextResponse.json({ ok: false, error: "Unsupported AI drawing schema" }, { status: 422 });
  const mixed = raw.aiSchemaVersion === 1;
  if (mixed && !Object.hasOwn(raw, "owner_id"))
    return NextResponse.json({ ok: false, error: "A drawing owner is required" }, { status: 409 });
  const symbol = typeof raw.symbol === "string" ? raw.symbol.trim() : "";
  if (!symbol || symbol.length > 64 || !Array.isArray(raw.drawings))
    return NextResponse.json({ ok: false, error: "A symbol and drawings array are required" }, { status: 400 });
  if (raw.drawings.length > MAX_DRAWINGS_PER_SYMBOL)
    return NextResponse.json({ ok: false, error: "Drawing collection is too large" }, { status: 413 });
  if (raw.drawings.some(drawingSourceConflict))
    return NextResponse.json({ ok: false, error: "Drawing sources are invalid" }, { status: 422 });
  const normalized = normalizeDrawings(raw.drawings);
  if (normalized.length !== raw.drawings.length)
    return NextResponse.json({ ok: false, error: "One or more drawings are invalid" }, { status: 422 });
  const ids = new Set<string>();
  for (let index = 0; index < normalized.length; index++) {
    const drawing = normalized[index], original = raw.drawings[index] as Drawing;
    if (!drawingToolAcceptsPersistedPointCount(drawing.kind, drawing.points.length) || ids.has(drawing.id)
      || (mixed && drawing.source === "ai"
        && (!Array.isArray(original.points) || original.points.length !== drawing.points.length
          || !readStoredAiDrawing(drawing))))
      return NextResponse.json({ ok: false, error: "Invalid drawing geometry, provenance or duplicate IDs" }, { status: 422 });
    ids.add(drawing.id);
  }

  // Read the actual incumbent collection before constructing a legacy partition
  // replacement. Insert-before-delete retains the last good save on failure.
  const { data: existing, error: readError } = await supabase.from("drawings").select("*")
    .eq("user_id", user.id).eq("symbol", symbol).order("created_at", { ascending: true });
  if (readError) {
    console.error("drawings PUT preflight failed:", readError);
    return NextResponse.json({ ok: false, error: "Could not save drawings" }, { status: 500 });
  }
  const drawings = mixed
    ? normalized.filter(drawing => drawing.source !== "detector")
    : [...normalized.filter(drawing => drawing.source === "user"),
      ...storedCollection((existing || []) as StoredDrawingRow[]).filter(drawing => drawing.source === "ai")];
  const collectionError = aiDrawingCollectionError(drawings);
  if (collectionError)
    return NextResponse.json({ ok: false, error: collectionError }, { status: collectionError.endsWith("limit") ? 413 : 422 });
  const collectionRow = { user_id: user.id, symbol, kind: COLLECTION_KIND,
    data: { schemaVersion: 1, aiSchemaVersion: 1, revision: crypto.randomUUID(), drawings } };
  if (new TextEncoder().encode(JSON.stringify(collectionRow)).byteLength > MAX_DRAWING_PAYLOAD_BYTES)
    return NextResponse.json({ ok: false, error: "Drawing payload is too large" }, { status: 413 });
  const { data: inserted, error: insertError } = await supabase.from("drawings").insert(collectionRow).select("id");
  if (insertError) {
    console.error("drawings PUT insert failed:", insertError);
    return NextResponse.json({ ok: false, error: "Could not save drawings" }, { status: 500 });
  }
  const insertedIds = ((inserted || []) as StoredIdRow[]).map(row => row.id).filter(Boolean);
  const oldIds = ((existing || []) as StoredIdRow[]).map(row => row.id).filter(Boolean);
  if (oldIds.length) {
    const { error: deleteError } = await supabase.from("drawings").delete().in("id", oldIds).eq("user_id", user.id);
    if (deleteError) {
      if (insertedIds.length) await supabase.from("drawings").delete().in("id", insertedIds).eq("user_id", user.id);
      console.error("drawings PUT delete failed:", deleteError);
      return NextResponse.json({ ok: false, error: "Could not replace drawings" }, { status: 500 });
    }
  }
  return NextResponse.json({ ok: true, count: drawings.length, schemaVersion: 1,
    aiSchemaVersion: 1, owner_id: user.id });
}
