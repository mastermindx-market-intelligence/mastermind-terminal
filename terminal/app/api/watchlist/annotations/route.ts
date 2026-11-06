import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { rateLimit, tooMany } from "@/lib/rateLimit";
import { createClient } from "@/lib/supabase/server";
import { fixtureFaults, fixtureUserId, FIXTURE_FAULT_COOKIE, FIXTURE_STORE_COOKIE } from "@/lib/watchlistsFixtureDb";
import { createFixtureAnnotationDb } from "@/lib/watchlistAnnotationsFixtureDb";
import { GUEST_COOKIE } from "@/lib/layoutsFixtureDb";
import { ANNOTATION_OWNER_HEADER, ANNOTATION_SCHEMA_VERSION, normalizeWriteBatch } from "@/lib/watchlistAnnotations";
import { applyAnnotationWrites, supabaseAnnotationStore, type AnnotationDb, type AnnotationStore } from "@/lib/watchlistAnnotationsStore";

// E05 — the signed-in user's watchlist notes and flags, per symbol, across devices.
//
// It lives beside `/api/watchlist` because it is the same ownership: the caller's own rows, read
// through the RLS'd server client AND filtered on the caller's id in every query. There is no
// share, no admin read and no guest path — a guest's notes stay in that browser until the user
// explicitly imports them after signing in (the client previews that import first).
//
// Failure is never reported as content:
//   401 unauthenticated            — no session; nothing was read
//   409 owner_mismatch             — the session is not the account the page was rendered for
//                                    (signed in as someone else in another tab); nothing is read
//                                    or written, so one account's rows never land in another's
//                                    browser ledger
//   503 annotations_unavailable    — the 0033 table is not there yet; the client says "not syncing"
//   500 annotations_read_failed / annotations_write_failed — the store failed; nothing is implied
//                                    about the user's annotations, and pending edits stay pending.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 100 writes × a 500-character CJK note is ≈ 160 KB of JSON; anything past this is not a client. */
const MAX_REQUEST_BYTES = 256 * 1024;
const isE2eFixture = () => process.env.TERMINAL_E2E_FIXTURE === "1";

async function resolveStore(): Promise<{ store: AnnotationStore; userId: string } | null> {
  if (isE2eFixture()) {
    const jar = await cookies();
    // The fixture page renders a signed-OUT shell under this cookie; the API must agree.
    if (jar.get(GUEST_COOKIE)?.value === "1") return null;
    const key = jar.get(FIXTURE_STORE_COOKIE)?.value || "default";
    return {
      store: supabaseAnnotationStore(createFixtureAnnotationDb(key, fixtureFaults(jar.get(FIXTURE_FAULT_COOKIE)?.value))),
      userId: fixtureUserId(key),
    };
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  return { store: supabaseAnnotationStore(supabase as unknown as AnnotationDb), userId: user.id };
}

const jsonError = (error: string, status: number) =>
  NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

// The account id the client believes it is syncing for; it must be the session's.
const ownerMatches = (request: Request, userId: string) => request.headers.get(ANNOTATION_OWNER_HEADER) === userId;

export async function GET(request: Request) {
  const session = await resolveStore();
  if (!session) return jsonError("unauthenticated", 401);
  if (!ownerMatches(request, session.userId)) return jsonError("owner_mismatch", 409);
  const result = await session.store.list(session.userId);
  if (!result.ok) {
    if (result.reason === "unavailable") return jsonError("annotations_unavailable", 503);
    console.error("watchlist annotations GET failed:", result.error);
    return jsonError("annotations_read_failed", 500);
  }
  return NextResponse.json(
    { schemaVersion: ANNOTATION_SCHEMA_VERSION, annotations: result.records, complete: result.complete },
    { headers: { "Cache-Control": "no-store" } },
  );
}

async function readBoundedJson(request: Request): Promise<{ ok: true; body: unknown } | { ok: false; error: "request_too_large" | "invalid_json" }> {
  const stated = Number(request.headers.get("content-length"));
  if (Number.isFinite(stated) && stated > MAX_REQUEST_BYTES) return { ok: false, error: "request_too_large" };
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) return { ok: false, error: "request_too_large" };
  try {
    return { ok: true, body: JSON.parse(raw) };
  } catch {
    return { ok: false, error: "invalid_json" };
  }
}

export async function POST(request: Request) {
  // The client debounces and batches (≤ 100 writes per request), so a minute of ordinary editing
  // is a handful of requests; this only bounds a runaway or hostile caller.
  const limit = rateLimit(request, { name: "watchlist-annotations-write", max: 120 });
  if (!limit.ok) return tooMany(limit);
  const session = await resolveStore();
  if (!session) return jsonError("unauthenticated", 401);
  if (!ownerMatches(request, session.userId)) return jsonError("owner_mismatch", 409);
  const parsed = await readBoundedJson(request);
  if (!parsed.ok) return jsonError(parsed.error, parsed.error === "request_too_large" ? 413 : 400);
  const batch = normalizeWriteBatch(parsed.body);
  if (!batch.ok) return jsonError(batch.error, 400);
  const outcome = await applyAnnotationWrites(session.store, session.userId, batch.writes, batch.invalid, new Date().toISOString());
  if (outcome.kind === "unavailable") return jsonError("annotations_unavailable", 503);
  if (outcome.kind === "failed") {
    console.error("watchlist annotations POST failed for every write");
    return NextResponse.json({ error: "annotations_write_failed", results: outcome.results }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json({ results: outcome.results }, { headers: { "Cache-Control": "no-store" } });
}
