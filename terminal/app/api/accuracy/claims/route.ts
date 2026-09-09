import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fixtureUserId, FIXTURE_STORE_COOKIE } from "@/lib/watchlistsFixtureDb";
import {
  buildInsertRow,
  CLAIM_NOT_RECORDED_MESSAGE,
  CLAIM_RESPONSE_KEYS,
  type ClaimInsertRow,
} from "@/lib/claimAuthoring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 64 * 1024;
const isE2eFixture = () => process.env.TERMINAL_E2E_FIXTURE === "1";

type DbResult = { data?: unknown; error?: { message?: string } | null };
type ClaimsQuery = PromiseLike<DbResult> & {
  insert: (row: Record<string, unknown>) => ClaimsQuery;
  select: (cols: string) => ClaimsQuery;
};
type ClaimsDb = { from: (table: string) => ClaimsQuery };

const GLOBAL_KEY = Symbol.for("mm.e2e.userClaimsFixture");
type FixtureGlobal = typeof globalThis & { [GLOBAL_KEY]?: Map<string, Record<string, unknown>[]> };
const fixtureStores: Map<string, Record<string, unknown>[]> =
  ((globalThis as FixtureGlobal)[GLOBAL_KEY] ??= new Map());

function createClaimsFixtureDb(key: string): ClaimsDb {
  const rows = fixtureStores.get(key) ?? [];
  if (!fixtureStores.has(key)) fixtureStores.set(key, rows);
  return {
    from: (table: string) => {
      const q: ClaimsQuery = {
        insert(row) {
          if (table === "user_claims") {
            const stored = { ...row, created_at: new Date().toISOString() };
            rows.push(stored);
            (q as ClaimsQuery & { _row?: Record<string, unknown> })._row = stored;
          }
          return q;
        },
        select() {
          return q;
        },
        then(resolve, reject) {
          const stored = (q as ClaimsQuery & { _row?: Record<string, unknown> })._row;
          if (!stored) return Promise.resolve({ data: [], error: null }).then(resolve, reject);
          return Promise.resolve({ data: [stored], error: null }).then(resolve, reject);
        },
      };
      return q;
    },
  };
}

async function resolveDb(): Promise<{ db: ClaimsDb; userId: string } | null> {
  if (isE2eFixture()) {
    const jar = await cookies();
    const key = jar.get(FIXTURE_STORE_COOKIE)?.value || "default";
    return { db: createClaimsFixtureDb(key), userId: fixtureUserId(key) };
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  return { db: supabase as unknown as ClaimsDb, userId: user.id };
}

const jsonError = (error: string, status: number) => NextResponse.json({ error }, { status });

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

function claimResponse(row: Record<string, unknown>) {
  const claim: Record<string, unknown> = {};
  for (const key of CLAIM_RESPONSE_KEYS) claim[key] = row[key] ?? (key === "stated_probability" ? null : row[key]);
  return claim;
}

function notRecorded() {
  return NextResponse.json(
    { ok: false, error: "claim_not_recorded", message: [...CLAIM_NOT_RECORDED_MESSAGE] },
    { status: 503 },
  );
}

export async function POST(request: Request): Promise<Response> {
  let session: Awaited<ReturnType<typeof resolveDb>>;
  try {
    session = await resolveDb();
  } catch {
    return notRecorded();
  }
  if (!session) return jsonError("unauthenticated", 401);

  const parsed = await readBoundedJson(request);
  if (!parsed.ok) return jsonError(parsed.error, parsed.error === "request_too_large" ? 413 : 400);

  const statedAt = new Date().toISOString();
  const built = buildInsertRow(parsed.body, session.userId, statedAt);
  if (!built.ok) return jsonError(built.error, 400);

  const insertRow: ClaimInsertRow = built.row;
  let insertResult: DbResult;
  try {
    insertResult = await session.db
      .from("user_claims")
      .insert({ ...insertRow })
      .select("claim_id,subject,condition,resolves_at,claim_text,stated_probability,status,created_at");
  } catch {
    console.error("claim POST failed");
    return notRecorded();
  }
  if (insertResult?.error) {
    console.error("claim POST failed");
    return notRecorded();
  }
  const row = Array.isArray(insertResult?.data)
    ? (insertResult.data[0] as Record<string, unknown> | undefined)
    : undefined;
  if (!row) {
    console.error("claim POST failed");
    return notRecorded();
  }
  return NextResponse.json({ ok: true, claim: claimResponse(row) }, { status: 201 });
}
