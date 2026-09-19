import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createFixtureDb, fixtureFaults, fixtureUserId, FIXTURE_FAULT_COOKIE, FIXTURE_STORE_COOKIE } from "@/lib/watchlistsFixtureDb";
import { readPositions, type PortfolioDb } from "@/lib/portfolio";
import {
  computePortfolioRiskHistory,
  parseOhlcBars,
  type CloseSeries,
  type OhlcBookValue,
  type RiskFreeSeries,
} from "@/lib/portfolioRiskHistory";
import { tickerKey } from "@/lib/portfolioRisk";
import { getCachedOhlc, type OhlcFetch } from "@/lib/ohlcSeriesCache";

// Lazy secondary projection for B-F08-9 (MO-DELTA-014).
//
// Mirrors `app/api/portfolio/route.ts` for session resolution, the credential allow-list,
// `redirect: "manual"`, and the per-(ticker, caller-cookie) cache boundary. The primary
// holdings GET is untouched: this route is a separate GET the Portfolio surface loads
// after paint. TWO-ORGANISMS LAW: nothing here writes a signal, rank, alert, or public
// artifact. User holdings are never POSTed or sent as a ticker-list query — only
// per-ticker OHLC GETs (plus SPY and the risk-free series).

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

// Same origin the holdings GET uses for macro artifacts (`app/api/portfolio/route.ts`).
// Read at request time (not module load) so tests can point STOCKDATA_BASE at a loopback
// fixture without racing ESM import-hoist.
function stockdataBase(): string {
  return process.env.STOCKDATA_BASE || "https://www.mastermind-x.com";
}
function stockdataHost(): string | null {
  try {
    return new URL(stockdataBase()).host;
  } catch {
    return null;
  }
}
const ARTIFACT_FANOUT_CAP = 60;
const ARTIFACT_CONCURRENCY = 8;
const ARTIFACT_TIMEOUT_MS = 2500;
const RF_CANDIDATES = ["DGS3MO", "us3m"] as const;
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
    const host = stockdataHost();
    const forwardCookie = cookieHeader && host && new URL(url).host === host
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

type RiskFreeFetch =
  | { kind: "read"; series: RiskFreeSeries }
  | { kind: "missing" }
  | { kind: "locked" }
  | { kind: "unreadable" };

async function fetchRiskFree(cookieHeader: string | null): Promise<RiskFreeFetch> {
  let locked = false;
  let unreadable = false;
  for (const name of RF_CANDIDATES) {
    const got = await fetchOhlc(name, cookieHeader, true);
    if (got.kind === "read") return { kind: "read", series: { source: name, points: got.series } };
    if (got.kind === "locked") locked = true;
    else if (got.kind === "unreadable") unreadable = true;
  }
  // A 401/locked response is the same shape SPY returns; it does not prove the
  // series is unpublished. Only a clean miss on every candidate is unpublished.
  if (locked) return { kind: "locked" };
  if (unreadable) return { kind: "unreadable" };
  return { kind: "missing" };
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
  let riskFreeStatus: "published" | "unpublished" | "unreadable" = "unpublished";
  const skipLiveMacro = isE2eFixture() && !isLoopbackStockdata();
  if (!skipLiveMacro) {
    try {
      const [book, bench, riskFree] = await Promise.all([
        fetchMany([...wanted], cookieHeader),
        fetchOhlc(BENCHMARK, cookieHeader),
        fetchRiskFree(cookieHeader),
      ]);
      ohlcByTicker = book;
      spy = bench.kind === "read" ? bench.series : null;
      if (riskFree.kind === "read") {
        rf = riskFree.series;
        riskFreeStatus = "published";
      } else if (riskFree.kind === "missing") {
        riskFreeStatus = "unpublished";
      } else {
        riskFreeStatus = "unreadable";
      }
    } catch {
      ohlcByTicker = {};
      spy = null;
      rf = null;
      riskFreeStatus = "unreadable";
    }
  }

  const history = computePortfolioRiskHistory(positions, ohlcByTicker, spy, rf, {
    credentialed: !!cookieHeader,
    riskFreeStatus,
  });
  return NextResponse.json({ history });
}
