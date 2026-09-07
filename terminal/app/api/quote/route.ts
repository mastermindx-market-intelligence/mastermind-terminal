import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchQuotes } from "@/lib/intradaySources";
import { rateLimit, tooMany } from "@/lib/rateLimit";
import {
  withRegularSessionDisplay,
  type QuoteDisplayInput,
  type RegularSessionDisplay,
} from "@/lib/quoteDisplay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Live top-of-book quotes for the panel header AND the watchlist.
//   ?sym=SYM      → { sym, quote }                (single — the detail/header pane)
//   ?syms=A,B,C   → { quotes: { SYM: quote|null } } (batch — the whole watchlist, ONE source)
//   China A-share + Hong Kong → free Tencent snapshot (real-time A-share; ~15-min-delayed HK).
//   US + crypto               → localhost Quote Hub (live crypto via OKX UTC-0, Coinbase rolling-24h
//                               fallback; delayed-15m US via
//                               Polygon). Hub/Tencent down/timeout → quote:null → manifest EOD,
//                               but a transient miss serves the last good quote (≤ KEEP_GOOD_MS).
// `quote.basis` (LIVE | DELAYED_15M | EOD) flows through transparently for the frontend badge.

type Entry = { at: number; goodAt?: number; quote: any }; // goodAt: when quote was last genuinely fresh
const CACHE = new Map<string, Entry>(); // per-symbol, shared by the single + batch paths
const TTL = 5_000; // real-time snapshot cadence; also bounds upstream call volume per symbol
const CHART_TTL = 750; // visible-pane cadence; the hub's A.* lane publishes one aggregate per second
const KEEP_GOOD_MS = 30_000; // ride out a transient upstream miss on a recently-good symbol
const MAX_BATCH = 200; // a watchlist is normally < 50; cap to bound one poll's upstream fan-out
const MAX_CHART_BATCH = 8; // at most four panes today; leave headroom without enabling bulk scraping

// D2: the cap stays (it is what bounds one poll's provider fan-out), but it may not be enforced in
// SILENCE. It used to be a bare `slice(0, MAX_BATCH)`: no 413, no flag, no remainder — so a caller
// asking for 300 symbols got 200 back in a response shaped exactly like a complete one, and the
// symbols past the boundary sat on EOD fallback with nothing to say why. Watchlist operations
// permit 500 (lib/watchlists.ts) and composites expand into several symbols each, so overshooting
// this cap is a reachable state, not a theoretical one.
//
// `truncated` names precisely what was dropped so a consumer can schedule the remainder instead of
// believing it was served. lib/quoteDemand.ts is the in-product consumer: it plans every poll under
// the cap, so a correct client never sees this field — it is the fail-loud backstop for one that
// gets it wrong, and the contract any future consumer can rely on.
type Truncation = { requested: number; served: number; omitted: string[] };

// Every client receives an explicit regular-session display lane. This keeps native/mobile
// consumers from interpreting the feed's raw last/chg as an overnight percentage, while the
// existing ext* namespace remains the sole source for pre/post/overnight presentation.
type PublicQuote = QuoteDisplayInput & Record<string, unknown>;

function expose(quote: unknown): (PublicQuote & RegularSessionDisplay) | null {
  if (!quote || typeof quote !== "object") return null;
  return withRegularSessionDisplay(quote as PublicQuote);
}

function exposeMap(quotes: Record<string, unknown>): Record<string, (PublicQuote & RegularSessionDisplay) | null> {
  return Object.fromEntries(Object.entries(quotes).map(([sym, quote]) => [sym, expose(quote)]));
}

// Split requested symbols into fresh cache hits vs misses (the misses are fetched in one batch).
function readCache(syms: string[], ttlMs: number = TTL): { hits: Record<string, any>; miss: string[] } {
  const now = Date.now();
  const hits: Record<string, any> = {};
  const miss: string[] = [];
  for (const s of syms) {
    const c = CACHE.get(s);
    if (c && now - c.at < ttlMs) hits[s] = c.quote;
    else miss.push(s);
  }
  return { hits, miss };
}

// Fetch the cache misses in one batched upstream call and write them back (null included, so a
// symbol with no live leg is cached as a miss too and doesn't get re-fetched every poll).
// Keep-last-good: one slow Tencent response aborts its whole chunk, which used to cache null for
// every CN/HK symbol in it and flip the board to Historical for a full TTL. A miss for a symbol
// whose last GOOD quote is < KEEP_GOOD_MS old re-serves that quote, re-stamped at `at` so it is a
// normal cache hit for the next TTL — preserving the once-per-TTL upstream bound + cross-client
// coalescing (retrying every request during a brownout would hammer Tencent hardest exactly while
// it is struggling). goodAt is carried through unchanged by a stale re-serve, so it keeps the hard
// window clock: a symbol that stays missing degrades to a genuine null (→ manifest EOD).
async function fillMisses(miss: string[]): Promise<Record<string, any>> {
  if (!miss.length) return {};
  const fresh = await fetchQuotes(miss);
  const at = Date.now();
  const out: Record<string, any> = {};
  for (const s of miss) {
    const q = fresh[s] ?? null;
    if (q) { CACHE.set(s, { at, quote: q }); out[s] = q; continue; }
    const prior = CACHE.get(s);
    const goodAt = prior?.quote ? prior.goodAt ?? prior.at : null;
    if (goodAt != null && at - goodAt < KEEP_GOOD_MS) {
      CACHE.set(s, { at, goodAt, quote: prior!.quote });
      out[s] = prior!.quote;
      continue;
    }
    CACHE.set(s, { at, quote: null });
    out[s] = null;
  }
  return out;
}

// Same auth switch as the rest of the app (TERMINAL_REQUIRE_AUTH=1). Only runs when we have a cache
// miss, so a fully-warm poll never pays the auth round-trip (bounds cost while login is disabled).
async function gate(): Promise<NextResponse | null> {
  if (process.env.TERMINAL_REQUIRE_AUTH === "1") {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  return null;
}

export async function GET(req: Request) {
  const rl = rateLimit(req, { name: "quote" });
  if (!rl.ok) return tooMany(rl);
  const { searchParams } = new URL(req.url);
  const symsParam = (searchParams.get("syms") || "").trim();
  const sym = (searchParams.get("sym") || "").trim();
  const chartCadence = searchParams.get("cadence") === "chart";
  const ttlMs = chartCadence ? CHART_TTL : TTL;

  // ── batch: the live watchlist (one poll for the header + every row) ──
  if (symsParam) {
    const asked = Array.from(new Set(symsParam.split(",").map((s) => s.trim()).filter(Boolean)));
    const cap = chartCadence ? MAX_CHART_BATCH : MAX_BATCH;
    const want = asked.slice(0, cap);
    // Say so when the cap bites, rather than returning a short map shaped like a complete one.
    const truncated: Truncation | null = asked.length > want.length
      ? { requested: asked.length, served: want.length, omitted: asked.slice(cap) }
      : null;
    if (!want.length) return NextResponse.json({ quotes: {} });
    const { hits, miss } = readCache(want, ttlMs);
    if (miss.length) { const denied = await gate(); if (denied) return denied; }
    try {
      const filled = await fillMisses(miss);
      return NextResponse.json(
        { quotes: exposeMap({ ...hits, ...filled }), ...(truncated ? { truncated } : {}) },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch {
      // Serve what we have — but a partial serve still has to admit the cap dropped symbols.
      return NextResponse.json(
        { quotes: exposeMap(hits), ...(truncated ? { truncated } : {}) },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
  }

  // ── single: the detail/header pane (unchanged {sym, quote} contract) ──
  if (!sym) return NextResponse.json({ error: "bad params" }, { status: 400 });
  const { hits, miss } = readCache([sym], ttlMs);
  if (!miss.length) return NextResponse.json({ sym, quote: expose(hits[sym] ?? null) });
  const denied = await gate(); if (denied) return denied;
  try {
    const filled = await fillMisses([sym]);
    return NextResponse.json({ sym, quote: expose(filled[sym] ?? null) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json({ sym, quote: null, error: e?.message || "fetch failed" });
  }
}
