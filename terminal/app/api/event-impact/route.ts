import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { promises as fs } from "fs";
import path from "path";
import { createClient } from "@/lib/supabase/server";
import {
  createFixtureDb,
  fixtureFaults,
  fixtureUserId,
  FIXTURE_FAULT_COOKIE,
  FIXTURE_STORE_COOKIE,
} from "@/lib/watchlistsFixtureDb";
import { readPositions, type PortfolioDb } from "@/lib/portfolio";
import { rateLimit, tooMany } from "@/lib/rateLimit";
import { joinEventImpact, type TouchedPosition } from "@/lib/eventImpact";

// Additive, GET-only, read-only route (B-F08-5, MO-PAID-028 / MO-DELTA-042). Joins the caller's
// OPEN holdings against the macro nightly's per-ticker event artifact and carries
// direction/mechanism/timeframe verbatim, printing "not stated" rather than inventing them (A7).
//
// `MACRO_DATA_BASE` lives here rather than in `lib/upstreams.ts` only because upstreams.ts is
// outside this packet's owned paths — fold it in as a follow-up.
const MACRO_DATA_BASE = process.env.MACRO_DATA_BASE || "https://www.mastermind-x.com";
const CTX_URL = `${MACRO_DATA_BASE}/data/portfolio_ctx.json`;
const TTL_MS = 900_000; // the artifact is a once-a-night bake
const FETCH_TIMEOUT_MS = 4_000;
// A stale cache has no business being served forever: `daysUntil` is carried verbatim from the
// cached copy, so an outage that outlives this window would render a numerically false countdown
// as if it were current, with only a prose "stale" chip disclosing it (minor, review r3). Past
// this age the cache is treated the same as no cache at all — the caller sees the honest
// unreadable/locked state instead of an ever-more-wrong "In N days".
const MAX_STALE_MS = 6 * 60 * 60_000; // 6h — well past one failed nightly bake, short of "days old"

// The live artifact is registration-walled at the edge (app/regwall.py in the macro repo): every
// `/data/*` path 401s an unauthenticated server-to-server fetch with `x-regwall: deny` (verified
// live probe, B-F08-5 review r2 BLOCKER 1). Both products share one Supabase project, so a
// same-domain `sb-` session cookie does exist on the caller's side — but this packet did not
// measure whether forwarding it through the fetch would pass the wall, so that is left unstated
// rather than claimed either way (review r3, minor). Both products are deployed on the SAME
// VPS (macro at REPO=/opt/macro, this app at /opt/terminal), and macro's own
// `/api/portfolio/brief` handler reads this exact artifact off local disk
// (`REPO / "site/data/portfolio_ctx.json"`, app/main.py:1752/1875/1955 in the macro repo) rather
// than fetching itself over HTTP. This route does the same: a same-box file read is the PRIMARY
// path (RULING B1(b)), the regwalled HTTP fetch is kept only as a FALLBACK for boxes where the
// file is not mounted (local dev, CI, a future split deploy). Documented in ops/README.md.
const MACRO_DATA_DIR = process.env.MACRO_DATA_DIR || "/opt/macro/site/data";
const CTX_FILE = path.join(MACRO_DATA_DIR, "portfolio_ctx.json");

export const runtime = "nodejs";

const isE2eFixture = () => process.env.TERMINAL_E2E_FIXTURE === "1";

// Duplicated from app/api/portfolio/route.ts:34-47 rather than imported — that file is not in
// this packet's owned paths, so its `resolveDb` shape is copied verbatim instead of refactored.
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

type CacheEntry = { data: unknown; ts: number };
let CTX_CACHE: CacheEntry | null = null;

type CtxResult = { data: unknown | null; error?: string; locked?: boolean };

// Primary path (production): read the artifact straight off the shared box's disk. `null` data
// with no `error` means "not present here" (e.g. local dev, CI) — that is a routine reason to
// fall through to the HTTP path below, never itself a reported error.
async function readCtxFromDisk(): Promise<CtxResult> {
  try {
    const raw = await fs.readFile(CTX_FILE, "utf8");
    try {
      return { data: JSON.parse(raw) };
    } catch {
      return { data: null, error: "unparseable" };
    }
  } catch {
    return { data: null };
  }
}

// Fallback path: the regwalled HTTP fetch. `locked: true` marks the specific outcomes the
// registration wall itself produces (401/403) or that look like it from here (a timeout, which is
// how a wall that silently drops rather than 401s would present) — distinct from a genuine 5xx or
// an unparseable body, which stay `calendar_unreadable` (BLOCKER 1).
async function fetchCtx(): Promise<CtxResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(CTX_URL, {
      signal: ctrl.signal,
      headers: { "User-Agent": "mastermind-terminal/1.0" },
      cache: "no-store",
    });
    if (!res.ok) {
      const locked = res.status === 401 || res.status === 403;
      return { data: null, error: `HTTP ${res.status}`, locked };
    }
    try {
      return { data: await res.json() };
    } catch {
      return { data: null, error: "unparseable" };
    }
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return { data: null, error: aborted ? "timeout" : "unparseable", locked: aborted };
  } finally {
    clearTimeout(timer);
  }
}

// File read first, HTTP fallback second (RULING B1). Only the HTTP outcome can mark `locked` —
// a missing/unreadable local file is not itself evidence of a regwall, it just means this box has
// no local copy, so the fallback runs and its own outcome (not the file's) decides `locked`.
async function readCtx(): Promise<CtxResult> {
  const fromDisk = await readCtxFromDisk();
  if (fromDisk.data !== null) return fromDisk;
  if (fromDisk.error) {
    // The on-disk artifact EXISTS but failed to parse — a disk-side defect, not an access
    // problem. Never let the HTTP fallback's own outcome (even a genuine regwall 401/403)
    // relabel this as `upstream_locked`: the caller must see `calendar_unreadable` with the
    // disk's own detail (RULING r3, item 1). The fallthrough tie-break below only distinguishes
    // "disk had nothing to say" from "disk had something to say" and cannot itself tell a
    // corrupt local file apart from a routine "not on this box" miss — this early return is
    // what makes that distinction, before the HTTP outcome ever gets a vote.
    return fromDisk;
  }
  const fromHttp = await fetchCtx();
  if (fromHttp.data !== null) return fromHttp;
  // Prefer whichever attempt actually has something to say; the disk miss's `error` is empty in
  // the routine "not on this box" case, so the HTTP outcome (which always has one) wins ties.
  return fromHttp.error ? fromHttp : fromDisk;
}

export async function GET(req: Request): Promise<Response> {
  const rl = rateLimit(req, { name: "event-impact" });
  if (!rl.ok) return tooMany(rl);

  const session = await resolveDb();
  if (!session) {
    return NextResponse.json({ state: "unauthenticated" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  const read = await readPositions(session.db, session.userId);
  const positions: readonly TouchedPosition[] | null = read.ok
    ? read.positions.map((p) => ({ id: p.id, ticker: p.ticker, shares: p.shares, status: p.status }))
    : null;

  const now = Date.now();
  let ctx: unknown | null = null;
  let ctxError: string | undefined;
  let ctxLocked = false;
  let stale = false;

  if (CTX_CACHE && now - CTX_CACHE.ts < TTL_MS) {
    ctx = CTX_CACHE.data;
  } else {
    const fetched = await readCtx();
    if (fetched.data !== null) {
      ctx = fetched.data;
      CTX_CACHE = { data: fetched.data, ts: now };
    } else if (CTX_CACHE && now - CTX_CACHE.ts <= MAX_STALE_MS) {
      // Upstream hiccup with a cached copy on hand, within the max-staleness window: serve it,
      // flagged stale — never served silently as fresh.
      ctx = CTX_CACHE.data;
      stale = true;
    } else {
      // Either no cache at all, or a cache too old to trust (MAX_STALE_MS exceeded) — the outage
      // has gone on long enough that the cached `daysUntil` values are no longer honest to show.
      ctxError = fetched.error;
      ctxLocked = Boolean(fetched.locked);
    }
  }

  const body = joinEventImpact({ positions, ctx, ctxError, ctxLocked });
  const status =
    body.state === "holdings_unreadable" ||
    body.state === "calendar_unreadable" ||
    body.state === "upstream_locked"
      ? 503
      : 200;
  // `stale` is only a field of the `ok`/`no_events` shapes (the only ones the source contract
  // declares it on) — spreading it onto any other state's body would attach a field the type
  // never claims and that the panel never reads (m3, review r2).
  const payload = stale && (body.state === "ok" || body.state === "no_events") ? { ...body, stale: true } : body;
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}
