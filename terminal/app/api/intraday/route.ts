import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchIntraday, isIntradayTf, isSecondTf, classify } from "@/lib/intradaySources";
import { isMacroSymbol } from "@/lib/macroSymbols";
import { withStoredHistory } from "@/lib/intradayStore";
import { buildIntradaySourceEvidence, type IntradayAssemblyTrace } from "@/lib/intradayEvidence";
import { filterBarsToSessionDate, type Bar6 } from "@/lib/intradayShared";
import { intradayFixture } from "@/lib/flowSource";
import { rateLimit, tooMany } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 15-min-delayed intraday OHLC for the chart. `fetchIntraday` returns the LIVE tail (Polygon for
// US/crypto incl. extended hours, Tencent for China/HK) — a short recent window. `withStoredHistory`
// (server-only; keeps node:fs out of the client-shared intradaySources) prepends the pre-stored deep
// history (public/data/intraday/<SYM>.<base>.json, Polygon 2021→now, 1h all US + 5m top-500).
// Bars: { t, tf, bars: [[epochSec, o, h, l, c, v], ...] } — same shape as /data/<SYM>.json.

type IntradayResponse = {
  t: string;
  tf: string;
  bars: Bar6[];
  source?: string;
  note?: string;
  error?: string;
  session_date?: string;
  source_evidence?: ReturnType<typeof buildIntradaySourceEvidence>;
};
type EvidenceState = {
  trace: IntradayAssemblyTrace;
  assembledAtMs: number;
  symbol: string;
  timeframe: string;
  extended: boolean;
};
type Entry = { at: number; data: IntradayResponse; evidence: EvidenceState | null };
const CACHE = new Map<string, Entry>();
const TTL = 45_000; // delayed data doesn't move faster than this; also bounds upstream call volume
// The second band is the live-zoom lane: a 45s cache would make a 1s chart visibly stale while
// still claiming second resolution. 10s keeps it honest and still collapses a burst of zooms
// (and every other viewer of the same symbol) into one upstream call.
const SECOND_TTL = 10_000;
const SESSION_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidSessionDate(date: string): boolean {
  if (!SESSION_DATE_RE.test(date)) return false;
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) === date;
}

/**
 * Slice a cached deep-history response to one display-epoch session without mutating the
 * cache entry. The cache intentionally stays date-agnostic: one provider/store read can
 * serve the full chart and any single-session study during the same TTL.
 */
function responseForSession(
  data: IntradayResponse,
  date: string,
  evidence: EvidenceState | null = null,
  cacheState: "new_assembly" | "cache" | "stale_cache" = "new_assembly",
): IntradayResponse {
  const bars = date && Array.isArray(data.bars)
    ? filterBarsToSessionDate(data.bars as Bar6[], date)
    : data.bars;
  const response: IntradayResponse = date
    ? { ...data, bars, session_date: date }
    : { ...data, bars };
  if (!evidence) return response;
  return {
    ...response,
    source_evidence: buildIntradaySourceEvidence(bars, evidence.trace, {
      symbol: evidence.symbol,
      timeframe: evidence.timeframe,
      extended: evidence.extended,
      sessionDate: date,
      assembledAtMs: evidence.assembledAtMs,
      servedAtMs: Date.now(),
      cacheState,
    }),
  };
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export async function GET(req: Request) {
  const rl = rateLimit(req, { name: "intraday" });
  if (!rl.ok) return tooMany(rl);
  const { searchParams } = new URL(req.url);
  const sym = (searchParams.get("sym") || "").trim();
  const tf = (searchParams.get("tf") || "").trim();
  const date = (searchParams.get("date") || "").trim();
  const ext = searchParams.get("ext") === "1"; // regular session by default; extended is explicit opt-in
  if (!sym || !isIntradayTf(tf) || (date && !isValidSessionDate(date))) {
    return NextResponse.json({ error: "bad params" }, { status: 400 });
  }

  // Dev fixture branch (FLOW_FIXTURE=1 only, never production): with no market-data key and an empty
  // history store the Surface pane paints its heat field over an empty price axis. intradayFixture
  // derives candles from the surface fixture's own spot_path — same synthetic price scale, same
  // ET-anchored epochs as the heat columns. Roots without a surface fixture return null and fall
  // through to the normal path unchanged. Placed ahead of the cache + the key-spending upstream
  // fetch so the fixture never warms (or reads) the shared cross-provider cache.
  if (process.env.FLOW_FIXTURE === "1") {
    const fx = await intradayFixture(sym, tf);
    if (fx?.length) {
      return NextResponse.json(responseForSession({ t: sym, tf, bars: fx, source: "fixture" }, date));
    }
  }

  // Resolve the provider basis (source + epoch convention) that WILL serve this symbol, and fold it
  // into the cache key. Today every provider emits the same market-local "display epoch"
  // (intradaySources.ts), but when a licensed UTC feed (DataBento) plugs in per-market, its bars are
  // basis:'utc' — a bare `sym|tf|ext` key would then serve a warm cross-provider / cross-basis entry
  // after an entitlement flip (databento-readiness audit, finding #6). Keying on source|basis makes
  // a provider cutover a cache MISS rather than a silent stale-bar hazard.
  // isMacroSymbol FIRST: a macro symbol falls through classify()'s "us" default, so a bare
  // classify() computed "polygon" for the ^/=F/=X symbols fetchIntraday actually serves from
  // Yahoo — the one thing this key exists to prevent. A cutover between those two providers
  // must be a cache MISS, and it only is if the key names the provider that will really serve.
  const market = classify(sym);
  const source = isMacroSymbol(sym)
    ? "yahoo-macro"
    : market === "ca" ? "none" : (market === "us" || market === "crypto") ? "polygon" : "tencent";
  const basis = "display"; // all current providers emit the display-epoch convention; UTC feeds bump this
  const seconds = isSecondTf(tf);

  // ── Real-time kill switch: ONE operator lever for the whole real-time question ────────────
  // The second band is a real-time-DERIVED product — at 1s its window runs to the current
  // second of a live session — so it rides the SAME lever as the real-time quote leg
  // (`HUB_REALTIME_QUOTES`, read in hub/hub.js) rather than a second switch of its own.
  // Default OFF: the operator's anonymous-vs-sign-in ruling is pending, and until it lands
  // nothing real-time-derived may serve. Refused in the route's ENTITLEMENT shape (200 +
  // empty bars + a note), never a 5xx — the chart draws its honest "no data" with a reason
  // instead of an error toast. Placed AHEAD of the cache read so flipping the lever off takes
  // effect on the next request rather than after a warm entry expires.
  if (seconds && process.env.HUB_REALTIME_QUOTES !== "1") {
    return NextResponse.json({ t: sym, tf, bars: [], note: "second-resolution bars are not enabled" });
  }

  // AUTH BEFORE THE CACHE. A warm entry is still a served payload: returning one ahead of the
  // gate let an unauthenticated caller read whatever a signed-in caller had just warmed, which
  // for the second band is paid, real-time-derived data. The cache keeps doing its real job
  // (bounding upstream call volume) — it just no longer decides who is allowed to read it.
  if (process.env.TERMINAL_REQUIRE_AUTH === "1") {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  // `date` joins the key for the SECOND band only. Minute-band entries are deliberately
  // date-agnostic — one deep-history read serves the full chart and any single-session study —
  // but a second-band fetch is itself scoped to one session, so two dates are two entries.
  const ckey = `${sym}|${tf}|${ext ? 1 : 0}|${source}|${basis}${seconds ? `|${date || "latest"}` : ""}`;
  const hit = CACHE.get(ckey);
  if (hit && Date.now() - hit.at < (seconds ? SECOND_TTL : TTL)) {
    return NextResponse.json(seconds ? hit.data : responseForSession(hit.data, date, hit.evidence, "cache"));
  }

  // ── Second band: single-session live window, no store ────────────────────────────────────
  // There is no second-resolution deep history anywhere in this app — `withStoredHistory` reads
  // 1h/5m base files and would resample them into a fake second series. The fetcher owns the
  // window bound (one ET session, most recent SECOND_MAX_BARS bars) and reports which session it
  // actually served, which is the only honest answer when the market is closed: on a Saturday
  // `session_date` comes back as Friday's date, and the client labels it as such rather than
  // presenting a stale window as "now".
  if (seconds) {
    let secBars: Bar6[];
    try {
      secBars = await fetchIntraday(sym, tf, ext, date);
    } catch (error: unknown) {
      const message = errorMessage(error, "fetch failed");
      if (hit) return NextResponse.json(hit.data);
      return NextResponse.json({ t: sym, tf, bars: [], error: message });
    }
    const served: IntradayResponse = { t: sym, tf, bars: secBars, source: "polygon-second" };
    // Session identity comes from the bars themselves (display epoch → ET calendar day), so it
    // is right whether the caller named a date, got the most recent session, or got nothing.
    if (secBars.length) {
      served.session_date = new Date(secBars[0][0] * 1000).toISOString().slice(0, 10);
    } else if (date) {
      served.session_date = date;
    }
    if (!secBars.length) {
      served.note = classify(sym) === "us"
        ? "no second-resolution bars for this window"
        : "second resolution is entitled for US equities only";
    }
    CACHE.set(ckey, { at: Date.now(), data: served, evidence: null });
    return NextResponse.json(served, { headers: { "Cache-Control": "no-store" } });
  }

  // Always consult the on-disk store even when the live leg fails (missing key, 429, network).
  // The store holds up to 20 000 bars (2021→now) so 4h/1h can serve fully from it with no key.
  let live: Bar6[] = [];
  let liveErr: string | undefined;
  try {
    live = await fetchIntraday(sym, tf, ext);
  } catch (error: unknown) {
    liveErr = errorMessage(error, "fetch failed");
  }

  let bars: Bar6[];
  let trace: IntradayAssemblyTrace | null = null;
  const sourceEvidenceEligible = market === "us" && !isMacroSymbol(sym);
  try {
    bars = await withStoredHistory(sym, tf, ext, live, sourceEvidenceEligible
      ? (captured) => { trace = captured; }
      : undefined);
  } catch (error: unknown) {
    // store read failed entirely (unlikely; readStore swallows its own errors)
    if (hit) return NextResponse.json(responseForSession(hit.data, date, hit.evidence, "stale_cache"));
    return NextResponse.json({ t: sym, tf, bars: [], error: errorMessage(error, "store error") });
  }

  if (bars.length === 0 && liveErr) {
    // nothing at all — propagate the live error; stale cache wins if present
    if (hit) return NextResponse.json(responseForSession(hit.data, date, hit.evidence, "stale_cache"));
    return NextResponse.json({ t: sym, tf, bars: [], error: liveErr });
  }

  // bars available (store-backed or live); build response — include a note when live leg failed
  // so the client can label freshness without treating it as a hard error.
  const data: IntradayResponse = { t: sym, tf, bars };
  if (liveErr) data.note = "store-only: " + liveErr;
  const assembledAtMs = Date.now();
  const evidence: EvidenceState | null = trace ? {
    trace, assembledAtMs, symbol: sym, timeframe: tf, extended: ext,
  } : null;
  CACHE.set(ckey, { at: assembledAtMs, data, evidence });
  return NextResponse.json(responseForSession(data, date, evidence, "new_assembly"), { headers: { "Cache-Control": "no-store" } });
}
