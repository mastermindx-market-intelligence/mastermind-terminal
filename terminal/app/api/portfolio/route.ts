import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createFixtureDb, fixtureFaults, fixtureUserId, FIXTURE_FAULT_COOKIE, FIXTURE_STORE_COOKIE } from "@/lib/watchlistsFixtureDb";
import {
  createPosition,
  deletePosition,
  readPositions,
  updatePosition,
  type PortfolioDb,
} from "@/lib/portfolio";

// Owner-scoped portfolio-position API (W5).
//
// Deliberately the SAME shape as `app/api/watchlist/route.ts`: one GET for the whole owner-scoped
// inventory, one POST switching on `action`, the fixture transport behind `TERMINAL_E2E_FIXTURE`,
// and RLS as the authority with an explicit `user_id` filter underneath it. The packet allowed
// either a route or direct server-client writes; the route is what the codebase already proves,
// and it is the only shape a client component can call without shipping a service-role key.
//
// `user_id` is NEVER read from the request body. It comes from the session on every path, so a
// caller cannot file, edit or delete a position in somebody else's book — and `updatePosition` /
// `deletePosition` re-resolve ownership before issuing any statement, so a foreign id is a 404
// rather than a write that RLS silently drops.
//
// TWO-ORGANISMS LAW (UWP-R2): nothing here feeds a signal, score, ranker or alert. These rows are
// the user's own record of what they hold, read back to them.

const isE2eFixture = () => process.env.TERMINAL_E2E_FIXTURE === "1";

/** Fixture transport for the Playwright dev server; the real RLS'd client everywhere else. The
 *  fixture key is the SAME cookie the watchlist route uses, so one spec's account-shaped world
 *  holds both tables and the watchlist/portfolio isolation invariants are actually testable. */
async function resolveDb(): Promise<{ db: PortfolioDb; userId: string } | null> {
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
  return { db: supabase as unknown as PortfolioDb, userId: user.id };
}

const unauthenticated = () => NextResponse.json({ error: "unauthenticated" }, { status: 401 });
const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

/**
 * Every position the signed-in user holds, open and closed, oldest first.
 *
 * FOUR facts, four responses — 401 signed out · 200 with zero positions · 200 with positions ·
 * 503 store unreadable. The last one used to be indistinguishable from the second: the read
 * collapsed a Supabase error into `[]` one layer down, so this route answered "you hold nothing"
 * for an outage. On a holdings surface that is the worst available lie.
 */
export async function GET() {
  const session = await resolveDb();
  if (!session) return unauthenticated();
  const read = await readPositions(session.db, session.userId);
  if (!read.ok) {
    console.error("portfolio GET failed:", read.error);
    return fail("portfolio unavailable", 503);
  }
  return NextResponse.json({ positions: read.positions });
}

export async function POST(req: Request) {
  const session = await resolveDb();
  if (!session) return unauthenticated();
  const { db, userId } = session;

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return fail("invalid JSON", 400);
  const action = body.action;

  if (action === "create") {
    const result = await createPosition(db, userId, {
      ticker: body.ticker,
      shares: body.shares,
      entryPrice: body.entryPrice,
      entryDate: body.entryDate,
      notes: body.notes,
      status: body.status,
    });
    if (!result.ok) return fail(result.error || "position create failed", result.status || 500);
    return NextResponse.json({ ok: true, position: result.position });
  }

  // Every remaining action names ONE position. A missing id is a 400 (the caller is broken); an id
  // that is not this user's is a 404 — never a fallback to "their first position", which is the
  // portfolio-side version of the first-list soloism W1b retired.
  const positionId = typeof body.id === "string" ? body.id.trim() : "";
  if (!positionId) return fail("id required", 400);

  if (action === "update" || action === "close" || action === "reopen") {
    // `close`/`reopen` are status-only patches with their own names because they are distinct user
    // intents, not a generic edit — and because a close must provably leave shares, entry price and
    // notes alone (gate D: closing a position never touches anything else, including the watchlist).
    const patch = action === "update"
      ? {
        ticker: body.ticker,
        shares: body.shares,
        entryPrice: body.entryPrice,
        entryDate: body.entryDate,
        notes: body.notes,
        status: body.status,
      }
      : { status: action === "close" ? "closed" : "open" };
    const result = await updatePosition(db, userId, positionId, patch);
    if (!result.ok) return fail(result.error || "position update failed", result.status || 500);
    return NextResponse.json({ ok: true, position: result.position });
  }

  if (action === "delete") {
    const result = await deletePosition(db, userId, positionId);
    if (!result.ok) return fail(result.error || "position delete failed", result.status || 500);
    return NextResponse.json({ ok: true, deletedId: result.deletedId });
  }

  return fail("unsupported action", 400);
}
