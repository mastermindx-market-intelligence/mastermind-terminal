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
import {
  applyThesisVersion,
  isUuid,
  listTheses,
  normalizeThesisSubjectFilter,
  readThesis,
  type ThesisAction,
  type ThesisDb,
  type ThesisSubjectFilter,
} from "@/lib/theses";

const MAX_REQUEST_BYTES = 64 * 1024;
const ACTIONS = new Set<ThesisAction>(["create", "revise", "archive", "invalidate", "reopen"]);
const isE2eFixture = () => process.env.TERMINAL_E2E_FIXTURE === "1";

async function resolveDb(): Promise<{ db: ThesisDb; userId: string } | null> {
  if (isE2eFixture()) {
    const jar = await cookies();
    const key = jar.get(FIXTURE_STORE_COOKIE)?.value || "default";
    return {
      db: createFixtureDb(key, fixtureFaults(jar.get(FIXTURE_FAULT_COOKIE)?.value)) as ThesisDb,
      userId: fixtureUserId(key),
    };
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  return { db: supabase as unknown as ThesisDb, userId: user.id };
}

const jsonError = (error: string, status: number, extra?: Record<string, unknown>) =>
  NextResponse.json({ error, ...extra }, { status });

export async function GET(request: Request) {
  const session = await resolveDb();
  if (!session) return jsonError("unauthenticated", 401);

  const search = new URL(request.url).searchParams;
  const ids = search.getAll("id");
  if (ids.length > 1 || (ids.length === 1 && !isUuid(ids[0]))) return jsonError("invalid_thesis_id", 400);
  if (ids.length === 1) {
    const result = await readThesis(session.db, session.userId, ids[0]);
    if (result.ok) return NextResponse.json({ thesis: result.thesis });
    if (result.status === "not_found") return jsonError("thesis_not_found", 404);
    console.error("thesis GET detail failed:", result.error);
    return jsonError("thesis_store_unavailable", 503);
  }

  const batch = search.getAll("ids");
  if (batch.length > 0) {
    // Round-2 review minor: `ids.length > 0` here was unreachable dead code — every
    // path above this point either returns (ids.length > 1, or ids.length === 1) or
    // leaves `ids` empty, so this branch is only ever reached with `ids.length === 0`.
    // The PR's own thesesRoute.test.ts already documents (and asserts) that a single
    // `id` alongside `ids` resolves through the pre-existing single-id branch above,
    // never this one.
    if (
      search.getAll("subjectOwner").length > 0 ||
      search.getAll("subjectKind").length > 0 ||
      search.getAll("subjectKey").length > 0
    ) {
      return jsonError("invalid_query", 400);
    }
    if (
      batch.length > 10 ||
      batch.some((v) => !isUuid(v)) ||
      new Set(batch.map((v) => v.toLowerCase())).size !== batch.length
    ) {
      return jsonError("invalid_thesis_ids", 400);
    }
    // Round-2 review minor: reads run concurrently (was a sequential `for`+`await`
    // loop of up to 10 store round-trips on the interactive path). Order is preserved
    // by mapping over `batch` itself; a fault on any id still returns 503 with no
    // partial array — same contract, just not serialized.
    const results = await Promise.all(batch.map((id) => readThesis(session.db, session.userId, id)));
    const batchResults: unknown[] = [];
    const missing: string[] = [];
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.ok) batchResults.push(result.thesis);
      else if (result.status === "not_found") missing.push(batch[i]);
      else {
        console.error("thesis GET batch failed:", result.error);
        return jsonError("thesis_store_unavailable", 503);
      }
    }
    // `batch` is a distinct key from the list branch's `theses` (summaries) — the two
    // responses carry different item shapes (ThesisDetail[] vs ThesisSummary[]) and a
    // shared key let a client conflate them (m4, round-2 review).
    return NextResponse.json({ batch: batchResults, missing });
  }

  const owner = search.getAll("subjectOwner");
  const kind = search.getAll("subjectKind");
  const key = search.getAll("subjectKey");
  const hasFilter = owner.length + kind.length + key.length > 0;
  let filter: ThesisSubjectFilter | undefined;
  if (hasFilter) {
    if (owner.length !== 1 || kind.length !== 1 || key.length !== 1) {
      return jsonError("invalid_subject_filter", 400);
    }
    const normalized = normalizeThesisSubjectFilter(owner[0], kind[0], key[0]);
    if (!normalized) return jsonError("invalid_subject_filter", 400);
    filter = normalized;
  }
  const result = await listTheses(session.db, session.userId, 200, filter);
  if (!result.ok) {
    console.error("thesis GET list failed:", result.error);
    return jsonError("thesis_store_unavailable", 503);
  }
  return NextResponse.json({ theses: result.theses, truncated: result.truncated });
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

export async function POST(request: Request) {
  const session = await resolveDb();
  if (!session) return jsonError("unauthenticated", 401);
  const parsed = await readBoundedJson(request);
  if (!parsed.ok) return jsonError(parsed.error, parsed.error === "request_too_large" ? 413 : 400);
  const body = parsed.body;
  if (typeof body.action !== "string" || !ACTIONS.has(body.action as ThesisAction)) {
    return jsonError("unsupported_action", 400);
  }

  const action = body.action as ThesisAction;
  const result = await applyThesisVersion(session.db, session.userId, {
    action,
    id: action === "create" ? null : typeof body.id === "string" ? body.id : null,
    expectedVersion: action === "create" ? 0 : typeof body.expectedVersion === "number" ? body.expectedVersion : -1,
    clientRequestId: typeof body.clientRequestId === "string" ? body.clientRequestId : "",
    subject: body.subject,
    content: body.content,
  });

  if (result.ok) {
    return NextResponse.json({
      thesisId: result.thesisId,
      version: result.version,
      lifecycleState: result.lifecycleState,
      replayed: result.replayed,
    }, { status: result.status === "created" ? 201 : 200 });
  }
  if (result.status === "version_conflict") {
    return jsonError("version_conflict", 409, {
      currentVersion: result.currentVersion,
      lifecycleState: result.lifecycleState,
    });
  }
  if (result.status === "idempotency_conflict") return jsonError("idempotency_conflict", 409);
  if (result.status === "not_found") return jsonError("thesis_not_found", 404);
  if (result.status === "invalid_transition") return jsonError("invalid_transition", 422);
  if (result.status === "invalid_payload") return jsonError("invalid_payload", 400);
  console.error("thesis POST failed:", result.error);
  return jsonError("thesis_store_unavailable", 503);
}
