import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  createFixtureDb,
  fixtureFaults,
  fixtureUserId,
  FIXTURE_FAULT_COOKIE,
  FIXTURE_STORE_COOKIE,
} from "@/lib/watchlistsFixtureDb";
import type { WatchlistDb } from "@/lib/watchlists";
import {
  createSavedView,
  deleteSavedView,
  listSavedViews,
  renameSavedView,
} from "@/lib/savedViews";

const MAX_REQUEST_BYTES = 64 * 1024;
const isE2eFixture = () => process.env.TERMINAL_E2E_FIXTURE === "1";

async function resolveDb(): Promise<{ db: WatchlistDb; userId: string } | null> {
  if (isE2eFixture()) {
    const jar = await cookies();
    const key = jar.get(FIXTURE_STORE_COOKIE)?.value || "default";
    return {
      db: createFixtureDb(key, fixtureFaults(jar.get(FIXTURE_FAULT_COOKIE)?.value)),
      userId: fixtureUserId(key),
    };
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  return { db: supabase as unknown as WatchlistDb, userId: user.id };
}

const jsonError = (error: string, status: number) => NextResponse.json({ error }, { status });

export async function GET(_request: Request) {
  const session = await resolveDb();
  if (!session) return jsonError("unauthenticated", 401);
  const result = await listSavedViews(session.db, session.userId);
  if (!result.ok) {
    console.error("thesis-saved-views GET failed:", result.error);
    return jsonError("saved_views_unavailable", 503);
  }
  // `truncated` lets the workspace say, in words, that more saved views exist than
  // this answer carries (round-2 review, Opus minor 3) instead of dropping them silently.
  return NextResponse.json({ views: result.views, truncated: result.truncated });
}

async function readBoundedJson(request: Request): Promise<
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; error: "request_too_large" | "invalid_json" }
> {
  const stated = Number(request.headers.get("content-length"));
  if (Number.isFinite(stated) && stated > MAX_REQUEST_BYTES) return { ok: false, error: "request_too_large" };
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) return { ok: false, error: "request_too_large" };
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, error: "invalid_json" };
    return { ok: true, body: value as Record<string, unknown> };
  } catch {
    return { ok: false, error: "invalid_json" };
  }
}

export async function PUT(request: Request) {
  const session = await resolveDb();
  if (!session) return jsonError("unauthenticated", 401);
  const parsed = await readBoundedJson(request);
  if (!parsed.ok) return jsonError(parsed.error, parsed.error === "request_too_large" ? 413 : 400);
  const body = parsed.body;
  if (body.scope === "workspace" || (body.scope !== undefined && body.scope !== "user")) {
    return jsonError("invalid_scope", 400);
  }
  if ("team_id" in body) return jsonError("invalid_scope", 400);

  const action = body.action;
  if (action === "create") {
    const result = await createSavedView(session.db, session.userId, {
      id: typeof body.id === "string" ? body.id : undefined,
      name: body.name,
      filter: body.filter,
    });
    if (result.ok) return NextResponse.json({ view: result.view }, { status: 201 });
    if (result.status === "limit_reached") return jsonError("limit_reached", 409);
    if (result.status === "invalid_name" || result.status === "invalid_filter" || result.status === "invalid_id") {
      return jsonError(result.status, 400);
    }
    console.error("thesis-saved-views PUT create failed:", result.error);
    return jsonError("saved_views_unavailable", 503);
  }
  if (action === "rename") {
    const result = await renameSavedView(
      session.db,
      session.userId,
      typeof body.id === "string" ? body.id : "",
      body.name,
    );
    if (result.ok) return NextResponse.json({ view: result.view });
    if (result.status === "not_found") return jsonError("saved_view_not_found", 404);
    if (result.status === "invalid_name" || result.status === "invalid_id") return jsonError(result.status, 400);
    console.error("thesis-saved-views PUT rename failed:", result.error);
    return jsonError("saved_views_unavailable", 503);
  }
  if (action === "delete") {
    const result = await deleteSavedView(session.db, session.userId, typeof body.id === "string" ? body.id : "");
    if (result.ok) return NextResponse.json({ ok: true });
    if (result.status === "not_found") return jsonError("saved_view_not_found", 404);
    if (result.status === "invalid_id") return jsonError(result.status, 400);
    console.error("thesis-saved-views PUT delete failed:", result.error);
    return jsonError("saved_views_unavailable", 503);
  }
  return jsonError("unsupported_action", 400);
}
