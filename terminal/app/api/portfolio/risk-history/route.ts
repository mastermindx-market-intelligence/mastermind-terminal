import { NextResponse } from "next/server";
import { portfolioBookKey } from "@/lib/portfolioSnapshot.server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createFixtureDb, fixtureFaults, fixtureUserId, FIXTURE_FAULT_COOKIE, FIXTURE_STORE_COOKIE } from "@/lib/watchlistsFixtureDb";
import { readPositions, type PortfolioDb } from "@/lib/portfolio";
import {
  computePortfolioRiskHistory,
  parseOhlcBars,
  RF_FRESHNESS_DAYS,
  type CloseSeries,
  type OhlcBookValue,
  type RiskFreeSeries,
} from "@/lib/portfolioRiskHistory";
import { fetchTreasuryHistory, validateTreasuryHistoryWindow } from "@/lib/portfolioTreasuryHistory.server";
import { tickerKey } from "@/lib/portfolioRisk";
import { getCachedOhlc, type OhlcFetch } from "@/lib/ohlcSeriesCache";

// Lazy secondary projection for B-F08-9 (MO-DELTA-014).
//
// Mirrors `app/api/portfolio/route.ts` for session resolution, the credential allow-list,
// `redirect: "manual"`, and the per-(ticker, caller-cookie) cache boundary. The primary
// holdings GET is untouched: this route is a separate GET the Portfolio surface loads
// after paint. TWO-ORGANISMS LAW: nothing here writes a signal, rank, alert, or public
// artifact. User holdings are never POSTed or sent as a ticker-list query — only
// per-ticker OHLC GETs (plus SPY). Treasury receives only a dated window
// and the same verified access token over strict local sidecar transport.

const isE2eFixture = () => process.env.TERMINAL_E2E_FIXTURE === "1";

async function resolveDb(): Promise<{ db: PortfolioDb; userId: string; accessToken: string | null } | null> {
  if (isE2eFixture()) {
    const jar = await cookies();
    const key = jar.get(FIXTURE_STORE_COOKIE)?.value || "default";
    return {
      db: createFixtureDb(key, fixtureFaults(jar.get(FIXTURE_FAULT_COOKIE)?.value)),
      userId: fixtureUserId(key),
      accessToken: null, // Fixture identities never supply a bearer to a real sidecar.
    };
  }
  const supabase = await createClient();
  // Capture once, then verify that exact bearer and its owner. A later cookie read
  // must never select a different token for Treasury than the positions owner.
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  const accessToken = session?.access_token;
  if (sessionError || !accessToken || !session?.user?.id) return null;
  const { data: { user }, error: userError } = await supabase.auth.getUser(accessToken);
  if (userError || !user || user.id !== session.user.id) return null;
  return { db: supabase as unknown as PortfolioDb, userId: user.id, accessToken };
}

const unauthenticated = () => NextResponse.json({ error: "unauthenticated" }, { status: 401 });
const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

// Same origin the holdings GET uses for macro artifacts (`app/api/portfolio/route.ts`).
// Read at request time (not module load) so tests can point STOCKDATA_BASE at a loopback
// fixture without racing ESM import-hoist.
function stockdataBase(): string {
  return process.env.STOCKDATA_BASE || "https://www.mastermind-x.com";
}
// Independent fixed credential destination; a configured host cannot approve itself.
const APPROVED_MACRO_ORIGIN = "https://www.mastermind-x.com";
function mayForwardPriceCookie(url: string): boolean {
  try {
    const target = new URL(url);
    return target.origin === APPROVED_MACRO_ORIGIN && !target.username && !target.password;
  } catch {
    return false;
  }
}
const ARTIFACT_FANOUT_CAP = 60;
const ARTIFACT_CONCURRENCY = 8;
const ARTIFACT_TIMEOUT_MS = 2500;
const BENCHMARK = "SPY";

/** E2E fixture worlds must not fan out to production macro. Crops set STOCKDATA_BASE to the
 *  loopback fixture server; that path still fetches. Default `www.mastermind-x.com` is skipped. */
function isLoopbackStockdata(): boolean {
  try {
    const host = new URL(stockdataBase()).hostname;
    return host === "127.0.0.1" || host === "localhost";
  } catch {
    return false;
  }
}

function isSupabaseAuthCookie(name: string): boolean {
  return name.startsWith("sb-") && name.includes("-auth-token");
}

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

function ohlcUrl(ticker: string): string {
  return `${stockdataBase()}/ohlc/${encodeURIComponent(ticker)}.json`;
}

async function fetchOhlcUncached(
  ticker: string,
  cookieHeader: string | null,
  allowNonPositive = false,
): Promise<OhlcFetch> {
  try {
    const url = ohlcUrl(ticker);
    const forwardCookie = cookieHeader && mayForwardPriceCookie(url)
      ? cookieHeader
      : null;
    const res = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(ARTIFACT_TIMEOUT_MS),
      cache: "no-store",
      redirect: "manual",
      ...(forwardCookie ? { headers: { Cookie: forwardCookie } } : {}),
    } as RequestInit);
    if (res.status === 404) return { kind: "missing" };
    if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) {
      return { kind: "unreadable" };
    }
    const body = await res.json().catch(() => null);
    const bodyLocked = !!body && typeof body === "object" && (body as { locked?: unknown }).locked === true;
    if (res.status === 401 || res.headers.get("x-regwall") === "deny" || bodyLocked) {
      return { kind: "locked" };
    }
    if (!res.ok) return { kind: "unreadable" };
    const series = parseOhlcBars(body, { allowNonPositive });
    if (!series) return { kind: "unreadable" };
    return { kind: "read", series };
  } catch {
    return { kind: "unreadable" };
  }
}

async function fetchOhlc(
  ticker: string,
  cookieHeader: string | null,
  allowNonPositive = false,
): Promise<OhlcFetch> {
  return getCachedOhlc(
    `${allowNonPositive ? "rf:" : "px:"}${ticker.toUpperCase()}`,
    cookieHeader,
    () => fetchOhlcUncached(ticker, cookieHeader, allowNonPositive),
  );
}

function bookValueOf(got: OhlcFetch): OhlcBookValue {
  if (got.kind === "read") return got.series;
  if (got.kind === "missing") return null;
  return "unreadable";
}

async function fetchMany(
  tickers: readonly string[],
  cookieHeader: string | null,
): Promise<Record<string, OhlcBookValue>> {
  const unique = [...new Set(tickers.map((t) => t.toUpperCase()))];
  const attempted = unique.slice(0, ARTIFACT_FANOUT_CAP);
  const out: Record<string, OhlcBookValue> = {};
  // A name the fan-out cap never requested was never read, so it is not an absent
  // artifact: `null` would type it `missing_price_history` and print "no daily price
  // history to read" about a GET this route never made. `unreadable` is the truthful
  // type, and `missing_price_history` stays reserved for a proven 404.
  for (const t of unique.slice(ARTIFACT_FANOUT_CAP)) out[t] = "unreadable";

  let i = 0;
  async function worker() {
    while (i < attempted.length) {
      const idx = i++;
      const ticker = attempted[idx];
      const got = await fetchOhlc(ticker, cookieHeader);
      out[ticker] = bookValueOf(got);
    }
  }
  await Promise.all(Array.from({ length: Math.min(ARTIFACT_CONCURRENCY, attempted.length || 1) }, worker));
  return out;
}

/** Use the qualified price compiler's actual window and its backward RF law. */
function treasuryWindow(history: ReturnType<typeof computePortfolioRiskHistory>) {
  const { firstSession, lastSession } = history.window;
  if (!firstSession || !lastSession) return null;
  // The price parser retains date-shaped strings. Validate their real calendar
  // dates before arithmetic so malformed upstream boundaries cannot throw.
  if (!validateTreasuryHistoryWindow({
    start: firstSession, end: lastSession, expected_through: lastSession,
  })) return null;
  const back = (date: string): string =>
    new Date(Date.parse(`${date}T00:00:00Z`) - RF_FRESHNESS_DAYS * 86400000).toISOString().slice(0, 10);
  const start = back(firstSession);
  return validateTreasuryHistoryWindow({
    start,
    end: lastSession,
    expected_through: [start, back(lastSession)].sort()[1],
  });
}

export async function GET() {
  const session = await resolveDb();
  if (!session) return unauthenticated();
  const read = await readPositions(session.db, session.userId);
  if (!read.ok) {
    console.error("portfolio risk-history GET failed:", read.error);
    return fail("portfolio unavailable", 503);
  }

  const cookieHeader = await callerAuthCookieHeader();
  const positions = read.positions.map((p) => ({
    ticker: p.ticker,
    shares: p.shares,
    entryPrice: p.entryPrice,
    entryCurrency: p.entryCurrency,
    status: p.status,
  }));

  const wanted = new Set<string>();
  for (const p of positions) {
    if (p.status !== "open") continue;
    if (typeof p.shares !== "number" || !Number.isFinite(p.shares) || p.shares <= 0) continue;
    if (typeof p.entryPrice !== "number" || !Number.isFinite(p.entryPrice)) continue;
    if (!(p.shares * p.entryPrice > 0)) continue;
    wanted.add(tickerKey(p.ticker));
  }

  let ohlcByTicker: Record<string, OhlcBookValue> = {};
  let spy: CloseSeries | null = null;
  let rf: RiskFreeSeries | null = null;
  let riskFreeStatus: "published" | "unreadable" = "unreadable";
  const skipLiveMacro = isE2eFixture() && !isLoopbackStockdata();
  if (!skipLiveMacro) {
    try {
      const [book, bench] = await Promise.all([
        fetchMany([...wanted], cookieHeader),
        fetchOhlc(BENCHMARK, cookieHeader),
      ]);
      ohlcByTicker = book;
      spy = bench.kind === "read" ? bench.series : null;
    } catch {
      ohlcByTicker = {};
      spy = null;
      rf = null;
      riskFreeStatus = "unreadable";
    }
  }

  const options = { credentialed: !!cookieHeader, riskFreeStatus };
  const priceHistory = computePortfolioRiskHistory(positions, ohlcByTicker, spy, null, options);
  const window = treasuryWindow(priceHistory);
  // Fixtures never export synthetic credentials or real cookies to the sidecar.
  // Missing retained input is unreadable, never proof of unpublished Treasury data.
  if (!isE2eFixture() && session.accessToken && window) {
    const treasury = await fetchTreasuryHistory(window, session.accessToken);
    if (treasury.status === "read" || treasury.status === "stale") {
      // Keep the actual dated observations. The compiler aligns backward <=7 days;
      // read_at is never a source/release date, and stale points are never refreshed.
      rf = { source: "DGS3MO", points: [...treasury.points] };
      riskFreeStatus = "published";
    }
  }
  const history = rf ? computePortfolioRiskHistory(positions, ohlcByTicker, spy, rf, {
    credentialed: !!cookieHeader,
    riskFreeStatus,
  }) : priceHistory;
  return NextResponse.json({ history, bookKey: portfolioBookKey(read.positions) }, { headers: { "Cache-Control": "private, no-store" } });
}
