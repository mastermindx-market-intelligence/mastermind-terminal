import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import {
  createFixtureDb,
  fixtureFaults,
  fixtureUserId,
  FIXTURE_FAULT_COOKIE,
  FIXTURE_STORE_COOKIE,
} from "@/lib/watchlistsFixtureDb";
import { readPositions, type PortfolioDb } from "@/lib/portfolio";
import { listWatchlists, type ServerWatchlist } from "@/lib/watchlists";
import { rateLimit, tooMany } from "@/lib/rateLimit";
import { isPaidTier } from "@/lib/entitlement";
import {
  displayFor,
  fixtureCookieName,
  freshness,
  knowableAtMax,
  readSource,
  resolveSourcePath,
  sortNewestFirst,
} from "@/lib/dislocations/source";
import {
  EPISODE_STATES,
  type DislocationEpisode,
  type EpisodeState,
  type LiveEntryEpisode,
} from "@/lib/dislocations/types";

export const runtime = "nodejs";
export const MAX_EPISODES = 200;

const CACHE_CONTROL = "private, no-store";
const SYM_RE = /^[A-Z][A-Z0-9.\-]{0,11}$/;

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
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return { db: supabase as unknown as PortfolioDb, userId: user.id };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "Cache-Control": CACHE_CONTROL,
    },
  });
}

function isValidRow(row: unknown): row is LiveEntryEpisode {
  if (!row || typeof row !== "object") return false;
  const r = row as Record<string, unknown>;
  if (typeof r.episode_id !== "string") return false;
  if (typeof r.ticker !== "string") return false;
  if (typeof r.state !== "string") return false;
  if (!EPISODE_STATES.includes(r.state as EpisodeState)) return false;
  for (const f of ["last_observed_at", "candidate_at", "first_armed_at"] as const) {
    const v = r[f];
    if (v !== null && v !== undefined && typeof v !== "string") return false;
  }
  return true;
}

async function readWatchlistsForJoin(
  db: PortfolioDb,
  userId: string
): Promise<{ ok: true; lists: ServerWatchlist[] } | { ok: false }> {
  let probe: { data?: unknown; error?: { message?: string } | null };
  try {
    probe = await db.from("watchlists").select("id").eq("user_id", userId).limit(1);
  } catch {
    return { ok: false };
  }
  if (probe?.error) return { ok: false };
  try {
    const lists = await listWatchlists(db, userId);
    return { ok: true, lists };
  } catch {
    return { ok: false };
  }
}

export async function GET(req: Request): Promise<Response> {
  const rl = rateLimit(req, { name: "dislocations" });
  if (!rl.ok) {
    const limited = tooMany(rl);
    const headers = new Headers(limited.headers);
    headers.set("Cache-Control", CACHE_CONTROL);
    return new Response(limited.body, { status: limited.status, headers });
  }

  try {
    const session = await resolveDb();
    if (!session) {
      return json({ state: "unauthenticated" }, 401);
    }

    const url = new URL(req.url);
    const viewParam = url.searchParams.get("view") ?? "my";
    if (viewParam !== "my" && viewParam !== "market") {
      return json({ state: "bad_request", error: "view must be my|market" }, 400);
    }
    const view = viewParam;

    let symFilter: string | undefined;
    const symRaw = url.searchParams.get("sym");
    if (symRaw != null && symRaw.trim() !== "") {
      const sym = symRaw.trim().toUpperCase();
      if (!SYM_RE.test(sym)) {
        return json({ state: "bad_request", error: "bad sym" }, 400);
      }
      symFilter = sym;
    }

    if (view === "market") {
      const paid = await isPaidTier();
      if (!paid) {
        return json({ state: "forbidden", reason: "paid_tier_required" }, 403);
      }
    }

    const now = Date.now();
    const cookieValue = isE2eFixture()
      ? (await cookies()).get(fixtureCookieName)?.value
      : undefined;
    const src = await readSource(resolveSourcePath(cookieValue), now);

    if (src.kind === "unavailable") {
      console.warn(`dislocations source_unavailable: ${src.reason}`);
      return json({
        state: "source_unavailable",
        reason: src.reason,
        generated_at: new Date(now).toISOString(),
        knowable_at_max: null,
        source: {
          asof: src.lastGood?.asof ?? null,
          pack_as_of: null,
          pack_fresh: null,
          quote_age_s: null,
          delayed: true,
          health_state: null,
        },
        episodes: [],
        count: 0,
        view,
      });
    }

    const file = src.file;
    if (!Object.prototype.hasOwnProperty.call(file, "episodes")) {
      const fv = freshness(file, now);
      return json({
        state: "source_unavailable",
        reason: "episodes_not_published",
        generated_at: new Date(now).toISOString(),
        knowable_at_max: null,
        source: {
          asof: file.asof,
          pack_as_of: file.pack.as_of,
          pack_fresh: fv.pack_fresh,
          quote_age_s: fv.age_s,
          delayed: true,
          health_state: file.health?.state ?? null,
        },
        episodes: [],
        count: 0,
        view,
      });
    }

    const rawEpisodes = file.episodes ?? [];
    let droppedRows = 0;
    for (const row of rawEpisodes) {
      if (!isValidRow(row)) droppedRows += 1;
    }
    let rows = rawEpisodes.filter(isValidRow);
    let joinDegraded = false;

    if (view === "my") {
      const symbols = new Set<string>();
      const wl = await readWatchlistsForJoin(session.db, session.userId);
      if (!wl.ok) {
        joinDegraded = true;
      } else {
        for (const list of wl.lists) {
          for (const sym of list.symbols) {
            if (sym.symbol) symbols.add(sym.symbol.toUpperCase());
          }
        }
      }
      try {
        const holdings = await readPositions(session.db, session.userId);
        if (!holdings.ok) {
          joinDegraded = true;
        } else {
          for (const p of holdings.positions) {
            if (p.status === "open") symbols.add(p.ticker.toUpperCase());
          }
        }
      } catch {
        joinDegraded = true;
      }
      rows = rows.filter((row) => symbols.has(row.ticker.toUpperCase()));
    }

    if (symFilter) {
      rows = rows.filter((row) => row.ticker.toUpperCase() === symFilter);
    }

    const sorted = sortNewestFirst(rows).slice(0, MAX_EPISODES);
    const episodes: DislocationEpisode[] = sorted.map((row) => ({
      ...row,
      display: displayFor(row),
    }));

    const fv = freshness(file, now);
    const fromFallback = src.fallback_reason != null;
    let state: string;
    if (fromFallback || fv.stale) {
      state = "stale";
    } else if (joinDegraded || episodes.length) {
      state = "ok";
    } else {
      state = "ok_empty";
    }

    const freshnessReason = fromFallback
      ? `fallback:${src.fallback_reason}`
      : fv.reason;

    const source: Record<string, unknown> = {
      asof: file.asof,
      pack_as_of: file.pack.as_of,
      pack_fresh: fv.pack_fresh,
      quote_age_s: fv.age_s,
      delayed: true,
      health_state: file.health?.state ?? null,
      freshness_reason: freshnessReason,
      served_from_cache: src.servedFromCache,
      dropped_rows: droppedRows,
    };
    if (joinDegraded) {
      source.join_degraded = true;
    }

    return json({
      state,
      generated_at: new Date(now).toISOString(),
      knowable_at_max: knowableAtMax(episodes),
      source,
      episodes,
      count: episodes.length,
      view,
    });
  } catch {
    return json({
      state: "source_unavailable",
      reason: "handler_error",
      generated_at: new Date().toISOString(),
      knowable_at_max: null,
      source: {
        asof: null,
        pack_as_of: null,
        pack_fresh: null,
        quote_age_s: null,
        delayed: true,
        health_state: null,
      },
      episodes: [],
      count: 0,
      view: "my",
    });
  }
}
