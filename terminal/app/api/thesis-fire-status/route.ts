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
import type { DbResult, DbRow, WatchlistDb } from "@/lib/watchlists";
import { isUuid } from "@/lib/theses";
import { mapOutboxToConditionStates, type OutboxRow } from "@/lib/rmsViews";

const MAX_IDS = 50;
const FIRE_STATUSES = ["pending", "deferred", "sent"] as const;
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
const rowsOf = (result: DbResult): DbRow[] => (Array.isArray(result?.data) ? result.data : []);

export async function GET(request: Request) {
  const session = await resolveDb();
  if (!session) return jsonError("unauthenticated", 401);

  const ids = new URL(request.url).searchParams.getAll("id");
  if (ids.length > MAX_IDS || ids.some((id) => !isUuid(id)) || new Set(ids.map((id) => id.toLowerCase())).size !== ids.length) {
    return jsonError("invalid_thesis_ids", 400);
  }

  if (ids.length === 0) return NextResponse.json({ states: {} });

  const result = await session.db.from("alert_outbox")
    .select("payload,status,created_at")
    .eq("user_id", session.userId)
    .in("status", FIRE_STATUSES)
    .in("payload->>thesis_id", ids);
  if (result.error) {
    console.error("thesis-fire-status GET failed:", result.error);
    return jsonError("fire_status_unavailable", 503);
  }

  const outbox: OutboxRow[] = rowsOf(result).map((row) => ({
    payload: row.payload,
    status: row.status,
    created_at: row.created_at,
  }));
  const mapped = mapOutboxToConditionStates(ids, outbox);
  const states = Object.fromEntries(ids.map((id) => [id, mapped.get(id) ?? { source: "unavailable" as const }]));
  return NextResponse.json({ states });
}
