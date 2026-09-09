import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createFixtureDb, fixtureFaults, fixtureUserId, FIXTURE_FAULT_COOKIE, FIXTURE_STORE_COOKIE } from "@/lib/watchlistsFixtureDb";
import { normalizeTicker, readPositions, type PortfolioDb } from "@/lib/portfolio";
import type { DbRow } from "@/lib/watchlists";
import {
  computePortfolioTargets,
  DEFAULT_BAND_PCT,
  normalizeBandPct,
  normalizeWeightPct,
  type PortfolioTarget,
} from "@/lib/portfolioTargets";

// Owner-scoped portfolio target weights (B-F08-B5-1).
//
// Session resolution is a deliberate copy of `app/api/portfolio/route.ts`'s `resolveDb()` —
// duplicated, not imported, because that file is read-only for this packet (census: F08 issues
// no holdings writes; open #545 collision avoidance). `user_id` is NEVER read from the body.
//
// TWO-ORGANISMS LAW (UWP-R2): this route never writes `portfolio_positions`. It reads that table
// and reads/writes only `portfolio_targets`. Output is a drift fact, never a trade.

const TARGETS_TABLE = "portfolio_targets";
const TARGET_FIELDS = "ticker,target_weight_pct,band_pct,updated_at";

const isE2eFixture = () => process.env.TERMINAL_E2E_FIXTURE === "1";

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

function rowToTarget(row: DbRow): PortfolioTarget | null {
  const ticker = normalizeTicker(row.ticker);
  const weight = normalizeWeightPct(row.target_weight_pct);
  const band = normalizeBandPct(row.band_pct);
  if (!ticker || weight.kind !== "value" || band.kind !== "value") return null;
  const updatedAt = typeof row.updated_at === "string" ? row.updated_at : null;
  return { ticker, targetWeightPct: weight.value, bandPct: band.value, updatedAt };
}

async function readTargets(db: PortfolioDb, userId: string): Promise<
  | { ok: true; targets: PortfolioTarget[] }
  | { ok: false; error: string }
> {
  let result: { data?: DbRow[] | DbRow | null; error?: { message?: string } | null };
  try {
    result = await db.from(TARGETS_TABLE)
      .select(TARGET_FIELDS)
      .eq("user_id", userId);
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : "targets unavailable" };
  }
  if (result?.error) return { ok: false, error: result.error.message || "targets unavailable" };
  if (!Array.isArray(result?.data)) return { ok: false, error: "targets unavailable" };
  return {
    ok: true,
    targets: result.data.map(rowToTarget).filter((row): row is PortfolioTarget => !!row),
  };
}

function isOpenSized(shares: number | null, entryPrice: number | null, status: string): boolean {
  return status === "open"
    && typeof shares === "number" && Number.isFinite(shares)
    && typeof entryPrice === "number" && Number.isFinite(entryPrice);
}

export async function GET() {
  const session = await resolveDb();
  if (!session) return unauthenticated();
  const positions = await readPositions(session.db, session.userId);
  if (!positions.ok) {
    console.error("portfolio targets GET positions failed:", positions.error);
    return fail("portfolio unavailable", 503);
  }
  const targets = await readTargets(session.db, session.userId);
  if (!targets.ok) {
    console.error("portfolio targets GET failed:", targets.error);
    return fail("targets unavailable", 503);
  }
  const summary = computePortfolioTargets(
    positions.positions.map((p) => ({
      ticker: p.ticker, shares: p.shares, entryPrice: p.entryPrice, status: p.status,
    })),
    targets.targets,
  );
  return NextResponse.json({ summary });
}

export async function POST(req: Request) {
  const session = await resolveDb();
  if (!session) return unauthenticated();
  const { db, userId } = session;

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return fail("invalid JSON", 400);
  // R6 (i): dispatch on the action FIRST. Validating the ticker ahead of it answered a POST of
  // `{"action":"bogus"}` with "invalid ticker" — a true statement about the wrong thing.
  const action = body.action;
  if (action !== "set" && action !== "clear") return fail("unsupported action", 400);
  const ticker = normalizeTicker(body.ticker);
  if (!ticker) return fail("invalid ticker", 400);

  if (action === "set") {
    const positions = await readPositions(db, userId);
    if (!positions.ok) return fail("portfolio unavailable", 503);
    const holding = positions.positions.find((p) => p.ticker === ticker && isOpenSized(p.shares, p.entryPrice, p.status));
    if (!holding) return fail("not a current holding", 400);

    const weight = normalizeWeightPct(body.targetWeightPct);
    if (weight.kind !== "value") return fail("invalid target", 400);

    let bandValue: number | undefined;
    if (body.bandPct !== undefined) {
      const band = normalizeBandPct(body.bandPct);
      if (band.kind !== "value") return fail("invalid band", 400);
      bandValue = band.value;
    }

    // R6 (i): wrapped exactly like `readTargets` above. A driver that RETURNS an error already
    // produced the right 503; a driver that THROWS escaped as a 500, where the GET path on the
    // very same table guarantees a 503.
    let existing: { data?: DbRow | DbRow[] | null; error?: { message?: string } | null };
    try {
      existing = await db.from(TARGETS_TABLE)
        .select("ticker,target_weight_pct,band_pct,updated_at")
        .eq("user_id", userId)
        .eq("ticker", ticker)
        .maybeSingle();
    } catch (cause) {
      console.error("portfolio targets POST read failed:", cause);
      return fail("targets unavailable", 503);
    }
    if (existing?.error) return fail("targets unavailable", 503);
    const now = new Date().toISOString();
    const existingRow = existing.data && typeof existing.data === "object" && !Array.isArray(existing.data)
      ? existing.data
      : null;

    if (existingRow) {
      const patch: DbRow = {
        target_weight_pct: weight.value,
        updated_at: now,
      };
      if (bandValue !== undefined) patch.band_pct = bandValue;
      const updated = await db.from(TARGETS_TABLE)
        .update(patch)
        .eq("user_id", userId)
        .eq("ticker", ticker)
        .select(TARGET_FIELDS);
      if (updated.error || !Array.isArray(updated.data) || !updated.data[0]) {
        return fail("targets unavailable", 503);
      }
      const target = rowToTarget(updated.data[0]);
      if (!target) return fail("targets unavailable", 503);
      return NextResponse.json({ ok: true, target });
    }

    const inserted = await db.from(TARGETS_TABLE)
      .insert({
        user_id: userId,
        ticker,
        target_weight_pct: weight.value,
        band_pct: bandValue ?? DEFAULT_BAND_PCT,
        updated_at: now,
      })
      .select(TARGET_FIELDS);
    if (inserted.error || !Array.isArray(inserted.data) || !inserted.data[0]) {
      return fail("targets unavailable", 503);
    }
    const target = rowToTarget(inserted.data[0]);
    if (!target) return fail("targets unavailable", 503);
    return NextResponse.json({ ok: true, target });
  }

  {
    // action === "clear" — the only remaining case, pinned by the dispatch guard above.
    const deleted = await db.from(TARGETS_TABLE)
      .delete()
      .eq("user_id", userId)
      .eq("ticker", ticker)
      .select("ticker");
    if (deleted.error) return fail("targets unavailable", 503);
    const rows = Array.isArray(deleted.data) ? deleted.data : [];
    if (!rows.length) return fail("target not found", 404);
    return NextResponse.json({ ok: true, clearedTicker: ticker });
  }
}
