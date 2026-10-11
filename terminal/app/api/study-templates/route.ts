// E07 — account study templates. GET lists the signed-in owner's templates; PUT creates, updates
// (rename or replace studies, compare-and-swap on the revision) or deletes one.
//
// Never answers 404: an edge that caches a 404 auth-blind would show a signed-in user an empty
// library. Every answer is `private, no-store` for the same reason. A missing template on a write
// is a 409 the client resolves by reloading, never a cacheable miss.
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { GUEST_COOKIE } from "@/lib/layoutsFixtureDb";
import {
  createFixtureDb,
  fixtureFaults,
  fixtureUserId,
  FIXTURE_FAULT_COOKIE,
  FIXTURE_STORE_COOKIE,
} from "@/lib/watchlistsFixtureDb";
import type { WatchlistDb } from "@/lib/watchlists";
import {
  createStudyTemplate,
  deleteStudyTemplate,
  listStudyTemplates,
  updateStudyTemplate,
  type StudyTemplateWriteResult,
} from "@/lib/studyTemplateStore";

const MAX_REQUEST_BYTES = 64 * 1024;
const NO_STORE = { "Cache-Control": "private, no-store" };
const isE2eFixture = () => process.env.TERMINAL_E2E_FIXTURE === "1";

async function resolveDb(): Promise<{ db: WatchlistDb; userId: string } | null> {
  if (isE2eFixture()) {
    const jar = await cookies();
    // The fixture page renders a genuine guest for this cookie; the API must agree about who asks.
    if (jar.get(GUEST_COOKIE)?.value === "1") return null;
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

const json = (payload: unknown, status = 200) => NextResponse.json(payload, { status, headers: NO_STORE });
const jsonError = (error: string, status: number, extra: Record<string, unknown> = {}) => json({ error, ...extra }, status);

export async function GET() {
  const session = await resolveDb();
  if (!session) return jsonError("unauthenticated", 401);
  const result = await listStudyTemplates(session.db, session.userId);
  if (!result.ok) {
    console.error("study-templates GET failed:", result.error);
    return jsonError("study_templates_unavailable", 503);
  }
  return json({ templates: result.templates, unreadable: result.unreadable, truncated: result.truncated });
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

function writeResponse(result: StudyTemplateWriteResult, created: boolean) {
  if (result.ok) return json({ template: result.template }, created ? 201 : 200);
  switch (result.status) {
    case "name_taken":
      return jsonError("name_taken", 409, { existing: result.existing });
    case "conflict":
    case "newer_version":
      return jsonError(result.status, 409, { current: result.current });
    case "limit_reached":
    case "not_found":
      return jsonError(result.status, 409);
    case "unavailable":
      console.error("study-templates PUT failed:", result.error);
      return jsonError("study_templates_unavailable", 503);
    default:
      return jsonError(result.status, 400);
  }
}

export async function PUT(request: Request) {
  const session = await resolveDb();
  if (!session) return jsonError("unauthenticated", 401);
  const parsed = await readBoundedJson(request);
  if (!parsed.ok) return jsonError(parsed.error, parsed.error === "request_too_large" ? 413 : 400);
  const body = parsed.body;
  // Templates are personal. A team/workspace row is a different owner and is never written here.
  if ((body.scope !== undefined && body.scope !== "user") || "team_id" in body) return jsonError("invalid_scope", 400);

  if (body.action === "create") {
    return writeResponse(await createStudyTemplate(session.db, session.userId, { name: body.name, body: body.body }), true);
  }
  if (body.action === "update") {
    return writeResponse(await updateStudyTemplate(session.db, session.userId, {
      id: body.id,
      baseRevision: body.baseRevision,
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.body !== undefined ? { body: body.body } : {}),
    }), false);
  }
  if (body.action === "delete") {
    const result = await deleteStudyTemplate(session.db, session.userId, {
      id: body.id,
      ...(body.baseRevision !== undefined ? { baseRevision: body.baseRevision } : {}),
    });
    if (result.ok) return json({ ok: true });
    if (result.status === "conflict") return jsonError("conflict", 409, { current: result.current });
    if (result.status === "not_found") return jsonError("not_found", 409);
    if (result.status === "invalid_id") return jsonError("invalid_id", 400);
    console.error("study-templates PUT delete failed:", "error" in result ? result.error : result.status);
    return jsonError("study_templates_unavailable", 503);
  }
  return jsonError("unsupported_action", 400);
}
