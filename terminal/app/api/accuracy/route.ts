import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { scorePersonalAccuracy } from "@/lib/personalAccuracy";
import { listOwnClaims, type AccuracyDb } from "@/lib/personalAccuracyStore";
import { fixtureUserId, FIXTURE_STORE_COOKIE } from "@/lib/watchlistsFixtureDb";

const isE2eFixture = () => process.env.TERMINAL_E2E_FIXTURE === "1";

async function resolveDb(): Promise<{ db: AccuracyDb | "fixture"; userId: string } | null> {
  if (isE2eFixture()) {
    const jar = await cookies();
    const key = jar.get(FIXTURE_STORE_COOKIE)?.value || "default";
    return { db: "fixture", userId: fixtureUserId(key) };
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  return { db: supabase as unknown as AccuracyDb, userId: user.id };
}

const jsonError = (error: string, status: number) => NextResponse.json({ error }, { status });

export async function GET() {
  const session = await resolveDb();
  if (!session) return jsonError("unauthenticated", 401);

  if (session.db === "fixture") {
    return NextResponse.json(scorePersonalAccuracy([]));
  }

  const listed = await listOwnClaims(session.db, session.userId);
  if (!listed.ok) {
    console.error("accuracy GET failed:", listed.error);
    return jsonError("accuracy_store_unavailable", 503);
  }

  const own = listed.claims.filter((claim) => claim.user_id === session.userId);
  return NextResponse.json(scorePersonalAccuracy(own));
}
