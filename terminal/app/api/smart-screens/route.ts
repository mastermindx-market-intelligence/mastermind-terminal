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
import { createScreen, deleteScreen, listScreens, updateScreen, type WriteFailure } from "@/lib/smartScreen/store";

/**
 * Smart screens (E04) — the signed-in user's saved screener definitions, one versioned
 * `workspace_settings` row each. GET lists; PUT {action: create|update|delete} writes with a
 * compare-and-set on the record's `rev` (see lib/smartScreen/store.ts).
 *
 * Every answer is `Cache-Control: private, no-store`: a per-account answer must never be held by
 * the edge (edge-caches-api-404s), and GET never answers 404 — an account with no screens is
 * `{screens: []}`, an unreadable store is 503, never an empty list.
 */

const MAX_REQUEST_BYTES = 64 * 1024;
const NO_STORE = { "Cache-Control": "private, no-store" } as const;
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

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });
const jsonError = (error: string, status: number, extra?: Record<string, unknown>) => json({ error, ...extra }, status);

export async function GET(_request: Request) {
  const session = await resolveDb();
  if (!session) return jsonError("unauthenticated", 401);
  const result = await listScreens(session.db, session.userId);
  if (!result.ok) {
    console.error("smart-screens GET failed:", result.error);
    return jsonError("smart_screens_unavailable", 503);
  }
  return json({ screens: result.screens, readOnly: result.readOnly, invalid: result.invalid });
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

function failure(action: string, result: WriteFailure) {
  switch (result.error) {
    case "unavailable":
      console.error(`smart-screens PUT ${action} failed:`, result.detail);
      return jsonError("smart_screens_unavailable", 503);
    case "invalid_definition":
      return jsonError("invalid_definition", 400, { detail: result.detail, path: result.path });
    case "invalid_review":
      return jsonError("invalid_review", 400, { detail: result.detail });
    case "conflict":
      return jsonError("conflict", 409, { current: result.current, readOnly: result.readOnly });
    case "newer_schema":
      return jsonError("newer_schema", 409, { readOnly: result.readOnly });
    default:
      return jsonError(result.error, result.status);
  }
}

export async function PUT(request: Request) {
  const session = await resolveDb();
  if (!session) return jsonError("unauthenticated", 401);
  const parsed = await readBoundedJson(request);
  if (!parsed.ok) return jsonError(parsed.error, parsed.error === "request_too_large" ? 413 : 400);
  const body = parsed.body;
  // Smart screens are personal: a workspace/team scope is refused, never silently re-scoped.
  if (body.scope !== undefined && body.scope !== "user") return jsonError("invalid_scope", 400);
  if ("team_id" in body || "user_id" in body) return jsonError("invalid_scope", 400);

  const action = body.action;
  if (action === "create") {
    const result = await createScreen(session.db, session.userId, {
      id: body.id, name: body.name, def: body.def, review: body.review,
    });
    if (result.ok) return json({ record: result.record, replay: result.replay }, result.status);
    return failure(action, result);
  }
  if (action === "update") {
    const result = await updateScreen(session.db, session.userId, {
      id: body.id, expectedRev: body.expectedRev, name: body.name, def: body.def, review: body.review,
    });
    if (result.ok) return json({ record: result.record, replay: result.replay }, result.status);
    return failure(action, result);
  }
  if (action === "delete") {
    const result = await deleteScreen(session.db, session.userId, { id: body.id, expectedRev: body.expectedRev });
    if (result.ok) return json({ deleted: result.deleted, alreadyGone: result.alreadyGone });
    return failure(action, result);
  }
  return jsonError("unsupported_action", 400);
}
