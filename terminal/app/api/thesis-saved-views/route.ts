import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createFixtureDb, fixtureFaults, fixtureUserId, FIXTURE_FAULT_COOKIE, FIXTURE_STORE_COOKIE } from "@/lib/watchlistsFixtureDb";
import type { WatchlistDb } from "@/lib/watchlists";
import { createSavedView, deleteSavedView, listSavedViews, renameSavedView,
  createWorkspaceSavedView, deleteWorkspaceSavedView, listWorkspaceSavedViews,
  lookupWorkspaceSavedView, renameWorkspaceSavedView } from "@/lib/savedViews";
import type { SavedViewDefinition } from "@/lib/savedViewContract";
import type { SavedViewError } from "@/lib/savedViews";
import { SAVED_VIEW_CONTRACT, exactKeys, normalizeSavedId, objectRecord } from "@/lib/savedViewContract";

const MAX_REQUEST_BYTES = 64 * 1024;
const PRIVATE_HEADERS = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
const jsonError = (error: string, status: number) => json({ error }, status);
async function resolveDb(): Promise<{ db: WatchlistDb; userId: string } | null> {
  if (process.env.TERMINAL_E2E_FIXTURE === "1") {
    const jar = await cookies();
    const key = jar.get(FIXTURE_STORE_COOKIE)?.value || "default";
    return { db: createFixtureDb(key, fixtureFaults(jar.get(FIXTURE_FAULT_COOKIE)?.value)), userId: fixtureUserId(key) };
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user ? { db: supabase as unknown as WatchlistDb, userId: user.id } : null;
}
function failure(status: SavedViewError) {
  if (status === "not_found") return jsonError("saved_view_not_found", 404);
  if (status === "limit_reached" || status === "request_conflict" || status === "view_changed") return jsonError(status, 409);
  if (status === "request_retired") return jsonError(status, 410);
  if (status.startsWith("invalid_")) return jsonError(status, 400);
  return jsonError("saved_views_unavailable", 503);
}
export async function GET(request: Request) {
  try {
    const session = await resolveDb();
    if (!session) return jsonError("unauthenticated", 401);
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some(key => !["id", "contract", "kind"].includes(key))
        || params.getAll("id").length > 1 || params.getAll("contract").length > 1 || params.getAll("kind").length > 1) return jsonError("invalid_query", 400);
    if (params.has("contract") && params.get("contract") !== SAVED_VIEW_CONTRACT) return jsonError("invalid_contract", 400);
    if (params.has("kind") && (params.get("contract") !== SAVED_VIEW_CONTRACT || params.has("id")
        || !["thesis_filter", "heatmap_fixed", "heatmap_live"].includes(params.get("kind")!))) return jsonError("invalid_query", 400);
    if (params.has("id")) {
      const result = await lookupWorkspaceSavedView(session.db, session.userId, params.get("id"));
      return result.ok ? json(result.result) : failure(result.status);
    }
    if (params.get("contract") === SAVED_VIEW_CONTRACT) {
      const result = await listWorkspaceSavedViews(session.db, session.userId, params.get("kind") as SavedViewDefinition["kind"] | undefined ?? undefined);
      return result.ok ? json({ contract: SAVED_VIEW_CONTRACT, ownerId: session.userId, views: result.views, truncated: result.truncated }) : failure(result.status);
    }
    const result = await listSavedViews(session.db, session.userId);
    // Existing thesis consumers keep their exact list shape and never receive non-thesis definitions.
    return result.ok ? json({ views: result.views, truncated: result.truncated }) : failure(result.status);
  } catch { return jsonError("saved_views_unavailable", 503); }
}
async function readBoundedJson(request: Request): Promise<
  { ok: true; body: Record<string, unknown> } | { ok: false; error: "request_too_large" | "invalid_json" }
> {
  const stated = Number(request.headers.get("content-length"));
  if (Number.isFinite(stated) && stated > MAX_REQUEST_BYTES) return { ok: false, error: "request_too_large" };
  if (!request.body) return { ok: false, error: "invalid_json" };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, error: "request_too_large" };
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const body = objectRecord(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    return body ? { ok: true, body } : { ok: false, error: "invalid_json" };
  } catch { return { ok: false, error: "invalid_json" }; }
  finally { reader.releaseLock(); }
}
export async function PUT(request: Request) {
  try {
    const session = await resolveDb();
    if (!session) return jsonError("unauthenticated", 401);
    const parsed = await readBoundedJson(request);
    if (!parsed.ok) return jsonError(parsed.error, parsed.error === "request_too_large" ? 413 : 400);
    const body = parsed.body;
    if ((body.scope !== undefined && body.scope !== "user") || "team_id" in body) return jsonError("invalid_scope", 400);
    if (body.contract !== undefined && body.contract !== SAVED_VIEW_CONTRACT) return jsonError("invalid_contract", 400);
    const versioned = body.contract === SAVED_VIEW_CONTRACT;
    // A supplied malformed ID is an error, not permission to manufacture a different operation.
    if ("id" in body && !normalizeSavedId(body.id)) return jsonError("invalid_id", 400);
    if (body.action === "create") {
      const allowed = versioned ? ["action", "contract", "scope", "id", "name", "definition"] : ["action", "scope", "id", "name", "filter"];
      if (!exactKeys(body, allowed)) return jsonError("invalid_fields", 400);
      if (versioned) {
        const result = await createWorkspaceSavedView(session.db, session.userId, { id: body.id, name: body.name, definition: body.definition });
        return result.ok ? json({ contract: SAVED_VIEW_CONTRACT, ownerId: session.userId, state: "present", view: result.view, receipt: result.receipt, replayed: result.replayed }, result.replayed ? 200 : 201) : failure(result.status);
      }
      const result = await createSavedView(session.db, session.userId, { ...(body.id === undefined ? {} : { id: body.id }), name: body.name, filter: body.filter });
      return result.ok ? json({ view: result.view, receipt: result.receipt, ownerId: session.userId, replayed: result.replayed }, result.replayed ? 200 : 201) : failure(result.status);
    }
    if (body.action === "rename") {
      if (!exactKeys(body, ["action", "contract", "scope", "id", "name"])) return jsonError("invalid_fields", 400);
      const result = versioned
        ? await renameWorkspaceSavedView(session.db, session.userId, typeof body.id === "string" ? body.id : "", body.name)
        : await renameSavedView(session.db, session.userId, typeof body.id === "string" ? body.id : "", body.name);
      return result.ok ? json({ view: result.view }) : failure(result.status);
    }
    if (body.action === "delete") {
      if (!exactKeys(body, ["action", "contract", "scope", "id"])) return jsonError("invalid_fields", 400);
      const result = versioned
        ? await deleteWorkspaceSavedView(session.db, session.userId, typeof body.id === "string" ? body.id : "")
        : await deleteSavedView(session.db, session.userId, typeof body.id === "string" ? body.id : "");
      return result.ok ? json({ ok: true }) : failure(result.status);
    }
    return jsonError("unsupported_action", 400);
  } catch { return jsonError("saved_views_unavailable", 503); }
}
