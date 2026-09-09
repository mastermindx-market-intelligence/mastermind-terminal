import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createFixtureDb, fixtureUserId, FIXTURE_STORE_COOKIE } from "@/lib/watchlistsFixtureDb";
import { readPositions, type PortfolioDb } from "@/lib/portfolio";
import {
  assertNoSecrets,
  buildAccountExport,
  exportFilename,
  readWatchlistsForExport,
  serializeCsv,
  serializeJson,
  type ExportFormat,
} from "@/lib/accountExport";

// Owner-scoped account-data export (B-F12-4 / MO-PAID-086).
//
// Terminal-owned tables ONLY (watchlists, portfolio_positions) — reusing the same anon-key,
// cookie-session, RLS-scoped server client `portfolio/route.ts` and `watchlist/route.ts` already
// use. No service-role key, no second auth plane (F12 do_not_redo). A whole-account export and
// deletion itself stay with macro's owner surface; this route ships at most a link there.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const isE2eFixture = () => process.env.TERMINAL_E2E_FIXTURE === "1";

async function resolveSession(): Promise<{ db: PortfolioDb; userId: string; email: string } | null> {
  if (isE2eFixture()) {
    const jar = await cookies();
    const key = jar.get(FIXTURE_STORE_COOKIE)?.value || "default";
    return { db: createFixtureDb(key), userId: fixtureUserId(key), email: `${fixtureUserId(key)}@fixture.test` };
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  return { db: supabase as unknown as PortfolioDb, userId: user.id, email: user.email || "" };
}

const unauthenticated = () => NextResponse.json({ error: "unauthenticated" }, { status: 401 });

// Per-user, in-process throttle: at most one export per 60s. This is process memory, not a
// shared store — on a multi-instance deployment each instance enforces its own 60s independently,
// so the guarantee is "at most one per 60s per instance you happen to hit", not truly global
// (review MINOR round 2: the prior "per-session" wording overstated it; UNVERIFIED here whether
// the Terminal deploy is single-instance). Deliberately shorter than macro's 15-minute
// whole-account export (#515 §2.2) — proportionate for a two-table read; a stated divergence.
const THROTTLE_MS = 60_000;
// Keyed by user+format (not just user): the obvious first action is downloading BOTH JSON and
// CSV back to back, and co-throttling them across formats broke that happy path (review
// MAJOR happy-path). Repeating the SAME format is still throttled.
const lastExportAt = new Map<string, number>();
const throttleKey = (userId: string, format: ExportFormat) => `${userId}:${format}`;

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const format = (url.searchParams.get("format") || "json") as ExportFormat;
  if (format !== "json" && format !== "csv") {
    return NextResponse.json({ error: "unsupported format" }, { status: 400 });
  }

  const session = await resolveSession();
  if (!session) return unauthenticated();

  const now = Date.now();
  const tKey = throttleKey(session.userId, format);
  const last = lastExportAt.get(tKey);
  if (last && now - last < THROTTLE_MS) {
    return NextResponse.json(
      { error: "too_soon", retry_after_s: Math.ceil((THROTTLE_MS - (now - last)) / 1000) },
      { status: 429 },
    );
  }

  const [watchlists, positionsRead] = await Promise.all([
    readWatchlistsForExport(session.db, session.userId),
    readPositions(session.db, session.userId),
  ]);
  const positions = positionsRead.ok
    ? ({ ok: true, positions: positionsRead.positions } as const)
    : ({ ok: false, error: positionsRead.error } as const);

  if (!watchlists.ok && !positions.ok) {
    return NextResponse.json({ error: "export unavailable" }, { status: 503 });
  }

  lastExportAt.set(tKey, now);

  const doc = buildAccountExport({
    userId: session.userId,
    email: session.email,
    generatedAt: new Date(now).toISOString(),
    watchlists,
    positions,
  });

  const body = format === "csv" ? serializeCsv(doc) : serializeJson(doc);
  const secretCheck = assertNoSecrets(body);
  if (!secretCheck.ok) {
    console.error("account export withheld: secret-shaped content detected", secretCheck.hit);
    return NextResponse.json({ error: "export_withheld" }, { status: 500 });
  }

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFilename(doc, format)}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
