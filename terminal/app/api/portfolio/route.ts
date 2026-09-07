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
  type Position,
} from "@/lib/portfolio";
import { computePortfolioRisk, type ArtifactState, type PortfolioRisk } from "@/lib/portfolioRisk";
import { getCachedArtifact } from "@/lib/artifactCache";

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
// ── Artifact fan-out (W B-F08-4) — additive `risk` field on GET only ──
//
// Forwards the CALLER's own credential (Meta-CEO B ruling, 2026-09-06 — BLOCKER-1 DECIDED).
// macro's regwall (macro-main app/regwall.py `_deny` / app/main.py `_mm_supabase_access_token`)
// answers an anonymous fan-out with a real 401 `{locked:true,reason:"authentication_required"}`
// for EVERY ticker in production — an anonymous read can never satisfy the sector/liquidity
// acceptance clause. Two facts make forwarding possible without new plumbing: (1) macro's gate
// reads ONLY a Supabase session cookie (`sb-<project-ref>-auth-token`, chunked `.0`/`.1`/… —
// there is no Authorization-bearer path in app/regwall.py at all), and (2) Terminal and macro
// point at the SAME Supabase project and share that exact cookie, scoped `Domain=.mastermind-x.com`
// (research/MASTERMIND_WATCHLIST_PORTFOLIO_W0_COMMISSIONING_PACKET_2026-08-12.md §"same Supabase
// project… same GoTrue issuer… shared .mastermind-x.com SSO cookie"; terminal/lib/supabase/
// cookies.ts AUTH_COOKIE_DOMAIN=".mastermind-x.com"). So a signed-in Terminal request already
// carries the one credential macro's gate accepts — `callerAuthCookieHeader()` below reads it
// off the incoming request and forwards ONLY that cookie (never the whole jar, never a bearer
// header macro would ignore anyway) to each artifact fetch. A `{locked:true}` envelope stays a
// possible, handled state (a signed-out caller, a stale/expired token, or a real macro-side
// outage all still degrade to it) — never an error — and a total outage here must never
// degrade the `positions` response, which is why every failure is caught locally rather than
// allowed to reject GET. Whether this actually clears the wall in production cannot be proven
// from a build pass (a live curl with a real session is not an available proof method here);
// see the PR body for the unit + e2e fixture proof and the live-verification gap.
const STOCKDATA_BASE = process.env.STOCKDATA_BASE || "https://www.mastermind-x.com";
// MINOR (round-2 review): allow-list the credential forward origin to the configured
// STOCKDATA_BASE host ONLY. The URL every artifact fetch hits is always built from this same
// constant, so a same-origin request is already structural — but a plain `fetch()` with the
// default `redirect: "follow"` would re-attach the SAME `Cookie` header to wherever a 3xx
// response's `Location` points, including a host neither this route nor its operator chose.
// `fetchArtifactUncached` below sets `redirect: "manual"` and treats any redirect as
// `unreadable` rather than following it, so the caller's session cookie can never leave this
// one configured host no matter what an artifact response claims.
const STOCKDATA_HOST = (() => {
  try {
    return new URL(STOCKDATA_BASE).host;
  } catch {
    return null;
  }
})();
const ARTIFACT_FANOUT_CAP = 60;
const ARTIFACT_CONCURRENCY = 8;
const ARTIFACT_TIMEOUT_MS = 2500;

// Same predicate as lib/supabase/middleware.ts's hasAuthCookie: Supabase writes its session as
// `sb-<project-ref>-auth-token`, chunked into `.0`/`.1`/… suffixes when large. Matching by name
// (rather than deriving the exact project ref) keeps this route working across environments
// without a second copy of macro's ref-derivation logic.
function isSupabaseAuthCookie(name: string): boolean {
  return name.startsWith("sb-") && name.includes("-auth-token");
}

/** The caller's Supabase session cookie(s), reassembled as one `Cookie` header value — or
 *  `null` when no such cookie is present (signed-out caller, or a transport that never raises
 *  is required to answer without one). Never forwards any other cookie in the jar. */
async function callerAuthCookieHeader(): Promise<string | null> {
  try {
    const jar = await cookies();
    const getAll = (jar as { getAll?: () => { name: string; value: string }[] }).getAll;
    const all = typeof getAll === "function" ? getAll.call(jar) : [];
    const pairs = all
      .filter((c) => isSupabaseAuthCookie(c.name))
      .map((c) => `${c.name}=${c.value}`);
    return pairs.length ? pairs.join("; ") : null;
  } catch {
    return null;
  }
}

async function fetchArtifactUncached(ticker: string, cookieHeader: string | null): Promise<ArtifactState> {
  try {
    const url = `${STOCKDATA_BASE}/stockdata/${encodeURIComponent(ticker.toUpperCase())}.json`;
    // MINOR (round-2 review): never forward the caller's session cookie anywhere but the
    // configured STOCKDATA_HOST. Two layers, since either one alone is not quite enough: the
    // explicit host comparison catches a malformed/misconfigured STOCKDATA_BASE at the source,
    // and `redirect: "manual"` (never auto-following, so the default `redirect: "follow"` can
    // never re-send this same Cookie header to whatever host a 3xx `Location` names) catches a
    // same-host artifact response that tries to redirect elsewhere after the fact.
    const forwardCookie = cookieHeader && STOCKDATA_HOST && new URL(url).host === STOCKDATA_HOST
      ? cookieHeader
      : null;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(ARTIFACT_TIMEOUT_MS),
      cache: "no-store",
      redirect: "manual",
      ...(forwardCookie ? { headers: { Cookie: forwardCookie } } : {}),
    } as RequestInit);
    if (res.status === 404) return { kind: "missing" };
    if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) {
      return { kind: "unreadable" };
    }
    // The regwall answers an anonymous fan-out with a REAL HTTP 401 (measured live,
    // 2026-09-06: `x-regwall: deny` + a `{"locked":true,...}` body) — never a 200. `res.ok`
    // is therefore false for the locked case, so the locked check must run BEFORE the
    // `!res.ok` short-circuit and must recognize 401 itself, not only a body flag a 401
    // response happens to carry.
    const body = await res.json().catch(() => null);
    const bodyLocked = !!body && typeof body === "object" && (body as { locked?: unknown }).locked === true;
    if (res.status === 401 || res.headers.get("x-regwall") === "deny" || bodyLocked) {
      return { kind: "locked" };
    }
    if (!res.ok) return { kind: "unreadable" };
    if (!body || typeof body !== "object") return { kind: "unreadable" };
    const personality = (body as { personality?: { market_cap?: unknown } }).personality;
    const sector = typeof (body as { sector?: unknown }).sector === "string" ? (body as { sector: string }).sector : null;
    const marketCap = typeof personality?.market_cap === "number" && Number.isFinite(personality.market_cap)
      ? personality.market_cap : null;
    // Liquidity: NO field named `thinly_traded` (or any liquidity flag) exists on the macro
    // per-ticker artifact today (verified: zero hits for thinly_traded/thin_liquidity/
    // liquidity_flag/is_thin across scripts/, engine/, site/ on origin/main, and the
    // fixture stockdata sample carries no such key). Reading a fabricated field name would
    // silently pass review while never being true in production, so this stays an honest,
    // permanent null until a real macro artifact field exists to read — printed as the
    // `no_thickness` gap on every sized position (see portfolioRisk.ts), never hidden.
    const thinlyTraded: boolean | null = null;
    return { kind: "read", facts: { ticker, sector, marketCap, thinlyTraded } };
  } catch {
    return { kind: "unreadable" };
  }
}

// MAJOR 3 (round-2 review): restores a per-(ticker, caller-cookie) cache in front of the real
// fetch — see lib/artifactCache.ts for why it is keyed the way it is and why it replaces the
// `next: { revalidate }` this route used before the per-caller cookie made that ambiguous. The
// mount-time GET stays (still the only thing that populates `risk`); it now simply hits this
// memo instead of always paying a fresh upstream fetch.
async function fetchArtifact(ticker: string, cookieHeader: string | null): Promise<ArtifactState> {
  return getCachedArtifact(ticker, cookieHeader, () => fetchArtifactUncached(ticker, cookieHeader));
}

async function fetchArtifactsFor(
  tickers: readonly string[],
  cookieHeader: string | null,
): Promise<Record<string, ArtifactState>> {
  const unique = [...new Set(tickers)];
  const attempted = unique.slice(0, ARTIFACT_FANOUT_CAP);
  const overflow = unique.slice(ARTIFACT_FANOUT_CAP);
  const out: Record<string, ArtifactState> = {};
  for (const t of overflow) out[t] = { kind: "not_attempted" };

  let i = 0;
  async function worker() {
    while (i < attempted.length) {
      const idx = i++;
      const ticker = attempted[idx];
      out[ticker] = await fetchArtifact(ticker, cookieHeader);
    }
  }
  await Promise.all(Array.from({ length: Math.min(ARTIFACT_CONCURRENCY, attempted.length || 1) }, worker));
  return out;
}

async function buildRisk(positions: readonly Position[], cookieHeader: string | null): Promise<PortfolioRisk> {
  const open = positions.filter((p) => p.status === "open");
  const tickers = open.map((p) => p.ticker);
  let artifacts: Record<string, ArtifactState> = {};
  try {
    artifacts = await fetchArtifactsFor(tickers, cookieHeader);
  } catch {
    artifacts = {};
  }
  return computePortfolioRisk(
    positions.map((p) => ({ ticker: p.ticker, shares: p.shares, entryPrice: p.entryPrice, status: p.status })),
    artifacts,
    // MAJOR 2: `coverageSource` reports whether the caller's OWN session cookie was present for
    // this fan-out, never whether any individual read happened to succeed — an anonymous caller
    // stays "anonymous" even if every ticker is (implausibly) readable, and a signed-in caller
    // stays "credentialed" even when every artifact locks or times out.
    !!cookieHeader,
  );
}

// MAJOR 5 (review repair): buildRisk can fan out up to ARTIFACT_FANOUT_CAP tickers across
// several concurrency waves — in the worst case, tens of seconds. That must never become
// latency (or an outright function-timeout kill) on the primary holdings read: a good,
// SSR-seeded book must never be able to flip into "we could not read your book" just
// because the NEW risk readout was slow. So the readout is capped to a hard time budget and
// degrades to `risk: null` (rendered as the normal per-card "not covered yet" states) rather
// than ever blocking — or endangering — the `positions` response.
const RISK_BUDGET_MS = 4000;

async function buildRiskBounded(
  positions: readonly Position[],
  cookieHeader: string | null,
): Promise<PortfolioRisk | null> {
  // MINOR (review repair): a bare `setTimeout` inside `Promise.race` is never cleared on the
  // fast path — every GET used to leave a live 4s timer handle behind even when `buildRisk`
  // resolved in milliseconds. `clearTimeout` in `finally` releases it on every exit.
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      buildRisk(positions, cookieHeader),
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), RISK_BUDGET_MS); }),
    ]);
  } catch {
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function GET() {
  const session = await resolveDb();
  if (!session) return unauthenticated();
  const read = await readPositions(session.db, session.userId);
  if (!read.ok) {
    console.error("portfolio GET failed:", read.error);
    return fail("portfolio unavailable", 503);
  }
  const cookieHeader = await callerAuthCookieHeader();
  const risk = await buildRiskBounded(read.positions, cookieHeader);
  return NextResponse.json({ positions: read.positions, risk });
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
