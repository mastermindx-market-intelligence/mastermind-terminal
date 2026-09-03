// Server-side intraday OHLC sources for the Terminal chart.
//   US / crypto      → Polygon aggregates (intraday + full extended hours, on the current plan)
//   China .SS/.SZ    → Tencent mkline (free, no auth)
//   Hong Kong .HK    → Tencent 1-min tick feeds, OHLC synthesized (free, no auth; see fetchTencentHK)
//
// Bars are returned as [epochSec, o, h, l, c, v] to match the daily /data/<SYM>.json contract.
// Intraday uses epoch SECONDS; the daily files use "YYYY-MM-DD" strings — never mix the two on one
// render (see ingest/README). lightweight-charts renders timestamps in UTC, so to keep each market's
// intraday axis in its OWN local trading time we emit a "display epoch" built from the market-local
// wall-clock components (ET for US, UTC+8 for CN/HK), not the true UTC instant. Cross-market compare
// is disabled on intraday in the chart, so this local-time shift has no alignment cost.

// Pure helpers (Bar6, tfMinutes, classify, resample, isIntradayTf) live in intradayShared so they
// can be imported by both this module (client-shared) and intradayStore (server-only, node:fs).
export type { Bar6, Market } from "./intradayShared";
export {
  INTRADAY_TFS, SECOND_TFS, isIntradayTf, isSecondTf, tfMinutes, tfSeconds, classify, resample,
  filterUsEquitySession, resampleUsEquitySession,
  resampleSessionSegments, HK_SESSION_SEGMENTS,
} from "./intradayShared";
import type { Bar6, Market } from "./intradayShared";
import {
  isIntradayTf, isSecondTf, tfMinutes, tfSeconds, classify, resample,
  filterUsEquitySession, resampleUsEquitySession,
  resampleSessionSegments, HK_SESSION_SEGMENTS,
} from "./intradayShared";
import { isMacroSymbol, isDailyOnlySymbol, fetchMacroQuotes, macroDisplayTz } from "./macroSymbols";

// ── US / crypto → Polygon ──
// One Intl formatter per display timezone — construction is expensive, formatToParts is not.
const TZ_FMT = new Map<string, Intl.DateTimeFormat>();
function tzFmt(tz: string): Intl.DateTimeFormat {
  let f = TZ_FMT.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    });
    TZ_FMT.set(tz, f);
  }
  return f;
}

/**
 * Epoch-ms → the app's DISPLAY EPOCH (the `tz` wall clock read AS IF it were UTC) plus that
 * clock's minute-of-day. See the file header and `sessionEpoch` in intradayShared for why
 * every provider must emit this and not the true UTC instant.
 *
 * ONE implementation for every leg — a second, subtly different copy is how a series ends up
 * plotted hours away from its own candles.
 */
export function localDisplay(ms: number, tz: string): { epoch: number; minOfDay: number } {
  const p: Record<string, string> = {};
  for (const part of tzFmt(tz).formatToParts(ms)) p[part.type] = part.value;
  const hh = +p.hour % 24;
  const epoch = Date.UTC(+p.year, +p.month - 1, +p.day, hh, +p.minute) / 1000;
  return { epoch, minOfDay: hh * 60 + +p.minute };
}

/** The ET specialization — what the US-axis providers (Polygon, US macro rows) emit. */
export function etDisplay(ms: number): { epoch: number; minOfDay: number } {
  return localDisplay(ms, "America/New_York");
}

// ── Second-precision display epoch ───────────────────────────────────────────
// `localDisplay` above deliberately truncates to the MINUTE — every caller in the
// minute/hour band wants the bar's opening minute. Second bars cannot use it: all 60 bars
// inside a minute would collapse onto one epoch and `fetchIntraday`'s ascending-unique pass
// would keep exactly ONE of them. Its own formatter (with `second`) rather than a parameter
// on the shared one, so the hot minute path keeps formatting exactly the fields it needs.
const TZ_FMT_SEC = new Map<string, Intl.DateTimeFormat>();
function tzFmtSec(tz: string): Intl.DateTimeFormat {
  let f = TZ_FMT_SEC.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    TZ_FMT_SEC.set(tz, f);
  }
  return f;
}

/** Display epoch at SECOND precision — the same convention, one order of magnitude finer. */
export function etDisplaySec(ms: number): { epoch: number; minOfDay: number } {
  const p: Record<string, string> = {};
  for (const part of tzFmtSec("America/New_York").formatToParts(ms)) p[part.type] = part.value;
  const hh = +p.hour % 24;
  return {
    epoch: Date.UTC(+p.year, +p.month - 1, +p.day, hh, +p.minute, +p.second) / 1000,
    minOfDay: hh * 60 + +p.minute,
  };
}

/** ET calendar date ("YYYY-MM-DD") for an instant — the session-date key for US bars. */
export function etDateOf(ms: number): string {
  const p: Record<string, string> = {};
  for (const part of tzFmt("America/New_York").formatToParts(ms)) p[part.type] = part.value;
  return `${p.year}-${p.month}-${p.day}`;
}

/**
 * Keep Polygon aggregate requests below its 50,000-result cap.
 *
 * Polygon truncates oversized aggregate queries from the recent end. A 120-day 4h request for a
 * US equity can therefore stop weeks before today, making the chart's "last" price look stale
 * even though the live quote is current. Hourly US bars fit inside 60 days; 24/7 crypto needs the
 * smaller 30-day window. The minute windows preserve the existing chart depth.
 */
export function polygonLookbackDays(minutes: number, market: Market): number {
  if (minutes <= 5) return 10;
  if (minutes <= 30) return 25;
  return market === "crypto" ? 30 : 60;
}

// Choose the largest Polygon minute aggregate that divides the requested
// interval and still lands exactly on the 09:30 ET regular-session boundary.
// This keeps long lookbacks well below Polygon's 50,000 base-aggregate cap
// without accepting provider-built hourly candles that begin at 09:00.
export function polygonUsSessionBaseMinutes(minutes: number): number {
  for (const candidate of [30, 15, 5]) {
    if (minutes >= candidate && minutes % candidate === 0) return candidate;
  }
  return 1;
}

async function fetchPolygon(sym: string, market: Market, tf: string, ext: boolean): Promise<Bar6[]> {
  const key = process.env.POLYGON_API_KEY || process.env.MASSIVE_API_KEY;
  if (!key) throw new Error("POLYGON_API_KEY not set");
  const minutes = tfMinutes(tf);
  const days = polygonLookbackDays(minutes, market);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const to = new Date();
  const from = new Date(to.getTime() - days * 86400000);
  const ticker = market === "crypto" ? "X:" + sym.replace(/-/g, "").toUpperCase() : sym.toUpperCase();
  const parsed = /^(\d+)(m|h)$/.exec(tf)!;
  const requestedMult = parseInt(parsed[1], 10) || 1;
  const requestedUnit = parsed[2] === "h" ? "hour" : "minute";
  const sourceMinutes = market === "us" ? polygonUsSessionBaseMinutes(minutes) : minutes;
  // US session-safe source bars always align to 09:30. Provider-built hourly
  // bars can straddle that boundary and irreversibly mix premarket prints into
  // the first regular candle. Crypto has no session boundary, so keep its
  // native requested aggregate.
  const rangeMult = market === "us" ? sourceMinutes : requestedMult;
  const rangeUnit = market === "us" ? "minute" : requestedUnit;
  const url = `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/${rangeMult}/${rangeUnit}/${iso(from)}/${iso(to)}?adjusted=true&sort=asc&limit=50000&apiKey=${key}`;
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) {
    if (r.status === 429) throw new Error("polygon rate-limited");
    throw new Error("polygon " + r.status);
  }
  const j: any = await r.json();
  const res: any[] = j?.results || [];
  const out: Bar6[] = [];
  for (const b of res) {
    if (market === "crypto") { out.push([Math.floor(b.t / 1000), b.o, b.h, b.l, b.c, b.v]); continue; }
    const { epoch } = etDisplay(b.t);
    out.push([epoch, b.o, b.h, b.l, b.c, b.v]);
  }
  if (market === "us") {
    const session = ext ? "extended" : "regular";
    const selected = filterUsEquitySession(out, session);
    return minutes === sourceMinutes
      ? selected
      : resampleUsEquitySession(selected, minutes, session);
  }
  return out;
}

// ── Second-resolution aggregates (US equities only) ──────────────────────────
//
// ENTITLEMENT. `…/range/<n>/second/…` is a Stocks-Advanced feature and the plan covers US
// STOCKS ONLY. Crypto, index, futures and FX are NOT entitled on this key, so this leg refuses
// anything that is not a US equity rather than emitting a request that would 403 or, worse,
// return an empty set the chart would render as "no data" for a market that simply is not sold
// to us. `SECOND_TFS` is likewise offered in the picker only for US symbols (TerminalShell).
//
// WINDOW BOUND (measured, 2026-08-08 — this is the whole reason the leg is shaped this way):
//   A naive `sort=desc` request over a 4-day span returned 96,642 bars / 9.7 MB for AAPL and
//   IGNORED `limit=50000` outright. One session alone is 23,297 bars (~2.3 MB from the vendor).
//   Neither is an acceptable chart payload, so the window is bounded TWICE:
//     1. to a SINGLE ET session date, and
//     2. to the most recent SECOND_MAX_BARS bars within it.
//   The upstream request is cut to the same window, so we never pull bars we intend to discard.
//   At 1s that is the last 2 hours of the session; at 5s the whole extended session; at
//   15s/30s the whole session with room to spare.
const SECOND_MAX_BARS = 7200;
// How far back to look for the most recent session when none is named. Covers a Friday close
// seen from Monday plus a long holiday weekend. Each miss is an empty 200 (~80 ms measured).
const SECOND_SESSION_WALK_DAYS = 5;
// ET session bounds, minutes from midnight. Regular unless the caller opted into extended.
const US_RTH = { start: 9 * 60 + 30, end: 16 * 60 };
const US_EXT = { start: 4 * 60, end: 20 * 60 };

/**
 * An ET wall-clock time on a calendar date → the true UTC instant (ms).
 *
 * DST-safe without a timezone table: read the ET clock at the naive instant, and the difference
 * IS that date's UTC offset. All four session boundaries (04:00/09:30/16:00/20:00) sit far from
 * the 02:00 DST switch, so there is no ambiguous-hour case to resolve.
 */
export function etWallToUtcMs(dateStr: string, minuteOfDay: number): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return NaN;
  const naive = Date.UTC(+m[1], +m[2] - 1, +m[3], Math.floor(minuteOfDay / 60), minuteOfDay % 60);
  const offset = localDisplay(naive, "America/New_York").epoch * 1000 - naive;
  return naive - offset;
}

/** Second-resolution bars for ONE session date, or [] when that date did not trade. */
async function fetchPolygonSecondsForDate(
  sym: string, tf: string, ext: boolean, dateStr: string, nowMs: number,
): Promise<Bar6[]> {
  const key = process.env.POLYGON_API_KEY || process.env.MASSIVE_API_KEY;
  if (!key) throw new Error("POLYGON_API_KEY not set");
  const step = tfSeconds(tf);
  if (step <= 0) return [];
  const bounds = ext ? US_EXT : US_RTH;
  const sessionStart = etWallToUtcMs(dateStr, bounds.start);
  const sessionEnd = etWallToUtcMs(dateStr, bounds.end);
  if (!Number.isFinite(sessionStart) || !Number.isFinite(sessionEnd)) return [];
  // A live session is bounded by NOW, not by the closing bell that has not rung yet.
  const to = Math.min(sessionEnd, nowMs);
  if (to <= sessionStart) return []; // session has not opened yet on this date
  const from = Math.max(sessionStart, to - SECOND_MAX_BARS * step * 1000);

  const mult = Math.max(1, Math.round(step));
  const url =
    `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(sym.toUpperCase())}` +
    `/range/${mult}/second/${from}/${to}?adjusted=true&sort=asc&limit=50000&apiKey=${key}`;
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) {
    if (r.status === 429) throw new Error("polygon rate-limited");
    throw new Error("polygon " + r.status);
  }
  const j: { results?: Array<{ t: number; o: number; h: number; l: number; c: number; v: number }> } =
    await r.json();
  const res = j?.results || [];
  const out: Bar6[] = [];
  for (const b of res) {
    // Second precision — etDisplay would truncate every bar in a minute onto one epoch.
    const { epoch } = etDisplaySec(b.t);
    out.push([epoch, b.o, b.h, b.l, b.c, b.v]);
  }
  // The session filter is minute-granular and the request window is already inside the session,
  // so this only trims a boundary bar the vendor stamps at the closing minute.
  return filterUsEquitySession(out, ext ? "extended" : "regular");
}

/**
 * Second-resolution bars for `sym`, for the named session date or the most recent one that traded.
 *
 * With no `date` this walks BACK from today — the honest answer on a Saturday is Friday's session,
 * and there is no holiday calendar in this app to consult instead. The walk stops at the first
 * date that returns bars, so it costs exactly one upstream call during a live session.
 */
export async function fetchPolygonSeconds(
  sym: string, tf: string, ext: boolean, date?: string, nowMs: number = Date.now(),
): Promise<Bar6[]> {
  if (classify(sym) !== "us" || isMacroSymbol(sym) || isDailyOnlySymbol(sym)) return [];
  if (date) return fetchPolygonSecondsForDate(sym, tf, ext, date, nowMs);
  for (let back = 0; back < SECOND_SESSION_WALK_DAYS; back++) {
    const probe = etDateOf(nowMs - back * 86400000);
    const bars = await fetchPolygonSecondsForDate(sym, tf, ext, probe, nowMs);
    if (bars.length) return bars;
  }
  return [];
}

// ── Macro (indices / rates / FX / futures) → Yahoo v8 chart ──
// Polygon's stocks aggregates have no ticker for "CL=F", "^GSPC" or "EURUSD=X". Before this leg
// every macro symbol fell through classify()'s `us` default into fetchPolygon under its literal
// Yahoo-shaped ticker, which returns an empty result set — that is the chart's long-standing
// "No intraday data for CL=F on 1h". Yahoo's v8 chart endpoint serves all four macro shapes with
// one response shape, keyless, from a server-side fetch.
//
// Native intervals are 1m 2m 5m 15m 30m 60m. The app's INTRADAY_TFS also include 3m/10m/45m/2h/
// 3h/4h, which are built by resampling the LARGEST native interval that divides the requested tf
// (3m←1m, 10m←5m, 45m←15m, 2h/3h/4h←60m); an exactly-native tf is fetched natively and not
// resampled. Depth is capped per base interval by the upstream — the short-history 1m/2m scales
// only carry a few days.
//
// NO RTH filter here. Futures and FX trade nearly 24h and index futures print overnight, so
// dropping everything outside 09:30–16:00 ET would delete most of a crude or gold session. The
// caller's `ext` flag is therefore accepted and ignored for macro symbols.
//
// Bars are stamped with the symbol's HOME-market wall clock via macroDisplayTz — ET for the US
// rows (^GSPC, ^TNX, CL=F, EURUSD=X, DX-Y.NYB), Tokyo for ^N225, London for ^FTSE, and so on —
// mirroring how the Tencent CN/HK legs emit market-local epochs. Stamping every macro symbol
// with the ET reading plots the Tokyo session as 20:00–02:00 on its own axis.
const YAHOO_NATIVE_MIN = [60, 30, 15, 5, 2, 1];

/** Upstream history window for a base interval — Yahoo rejects/thins ranges beyond these. */
function yahooRange(baseMin: number): string {
  return baseMin <= 2 ? "5d" : baseMin <= 30 ? "1mo" : "3mo";
}

// null/absent → null (NOT 0). `Number(null) === 0` and Number.isFinite(0) is true, so a bare
// finite check would turn Yahoo's gap padding into a $0 print.
function _num(x: unknown): number | null {
  if (x == null) return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

// The slice of the v8 chart body we read. Typed rather than `any` so a field rename upstream
// surfaces as a compile error here instead of silently yielding an empty chart.
type YahooChartQuote = { open?: unknown; high?: unknown; low?: unknown; close?: unknown; volume?: unknown };
type YahooChartResult = { timestamp?: unknown; indicators?: { quote?: YahooChartQuote[] } };
type YahooChartBody = { chart?: { result?: YahooChartResult[] | null } };
const _arr = (a: unknown): unknown[] => (Array.isArray(a) ? a : []);

export async function fetchYahooMacroIntraday(sym: string, tf: string): Promise<Bar6[]> {
  const minutes = tfMinutes(tf);
  if (minutes <= 0) return [];
  const tz = macroDisplayTz(sym);
  const base = YAHOO_NATIVE_MIN.find((b) => b <= minutes && minutes % b === 0) ?? 1;
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}`
    + `?interval=${base}m&range=${yahooRange(base)}&includePrePost=true`;
  const r = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  // Thrown, not swallowed: the route turns an upstream error into "Intraday feed unavailable"
  // (a live-feed problem), which is a different message from the honest empty below.
  if (!r.ok) throw new Error("yahoo " + r.status);
  const j = (await r.json()) as YahooChartBody;
  const res = j?.chart?.result?.[0];
  const ts = _arr(res?.timestamp);
  const q: YahooChartQuote = res?.indicators?.quote?.[0] ?? {};
  const [O, H, L, C, V] = [q.open, q.high, q.low, q.close, q.volume].map(_arr);
  const baseBars: Bar6[] = [];
  for (let i = 0; i < ts.length; i++) {
    const close = _num(C[i]);
    const t = _num(ts[i]);
    if (close == null || t == null) continue;   // Yahoo pads non-trading minutes with nulls
    const open = _num(O[i]) ?? close;
    const high = _num(H[i]) ?? Math.max(open, close);
    const low = _num(L[i]) ?? Math.min(open, close);
    baseBars.push([localDisplay(t * 1000, tz).epoch, open, high, low, close, _num(V[i]) ?? 0]);
  }
  return base === minutes ? baseBars : resample(baseBars, minutes);
}

// ── China / Hong Kong → Tencent (free) ──
// CN minute OHLC comes from mkline (native scales m1/m5/m15/m30/m60; non-native tfs resample from
// the largest native divisor). HK lost mkline upstream (~2026-07: "param error" for every hk code
// while CN codes still work, and Tencent's own HK web chart no longer requests it) — see
// fetchTencentHK for the tick-feed replacement. tencentCode itself is shared with the quote leg.
function tencentCode(sym: string, market: Market): string | null {
  if (market === "cn") { const m = /^(\d+)\.(SS|SZ)$/i.exec(sym); return m ? (m[2].toUpperCase() === "SS" ? "sh" : "sz") + m[1] : null; }
  if (market === "hk") { const m = /^(\d+)\.HK$/i.exec(sym); return m ? "hk" + m[1].padStart(5, "0") : null; }
  return null;
}

async function fetchTencent(sym: string, market: Market, tf: string): Promise<Bar6[]> {
  const code = tencentCode(sym, market);
  if (!code) return [];
  const minutes = tfMinutes(tf);
  const base = [60, 30, 15, 5, 1].find((b) => b <= minutes && minutes % b === 0) || 1;
  const scale = "m" + base;
  const url = `https://ifzq.gtimg.cn/appstock/app/kline/mkline?param=${code},${scale},,640`;
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error("tencent " + r.status);
  const j: any = await r.json();
  const node = j?.data?.[code] || {};
  const rows: any[] = Array.isArray(node[scale]) ? node[scale] : [];
  const baseBars: Bar6[] = [];
  for (const row of rows) {
    const dt = String(row[0]); // "YYYYmmddHHMM" in market-local time (UTC+8, no DST)
    if (dt.length < 12) continue;
    const epoch = Date.UTC(+dt.slice(0, 4), +dt.slice(4, 6) - 1, +dt.slice(6, 8), +dt.slice(8, 10), +dt.slice(10, 12)) / 1000;
    const o = +row[1], c = +row[2], h = +row[3], l = +row[4], v = +row[5]; // Tencent order: open, close, high, low, vol
    if (!Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c)) continue;
    baseBars.push([epoch, o, h, l, c, v]);
  }
  return base === minutes ? baseBars : resample(baseBars, minutes);
}

// ── Hong Kong → Tencent 1-min tick feeds ──
// What Tencent's own HK web chart (gu.qq.com, bundle zxgweb-chart) ships since mkline dropped hk:
//   day/query?code=hk00700&days=5  → up to 5 sessions of 1-min rows (upstream-capped at 5)
//   hkMinute/query?code=hk00700    → the live current session (overlaid when it has fresher rows)
// Rows are "HHMM price cumVol cumAmount" in HK wall-clock (UTC+8) — a last-price series, not OHLC.
// 1m bars are synthesized (open = previous minute's close within the session, h/l = max/min(o, c),
// volume = cumulative-counter diff) and coarser tfs resample from that base on SESSION segments.
// Depth is ~5 sessions and the `days` param cannot buy more (days=10/20/30 all return 5, verified
// 2026-08-05) — thinner than mkline's 640-per-scale, but it is all the free feed carries now:
// ≈1,660 1m bars → 30 hourly candles (6 per session) or 10 four-hour candles (2 per session).
// Closing-auction prints (16:01–16:08) come through as ordinary rows and fold into the 15:00 candle.
function hkSessionBars(date: string, rows: unknown[]): Bar6[] {
  if (!/^\d{8}$/.test(date)) return [];
  const y = +date.slice(0, 4), mo = +date.slice(4, 6) - 1, d = +date.slice(6, 8);
  const out: Bar6[] = [];
  let prevClose = NaN, prevCum = 0;
  for (const raw of rows) {
    const f = String(raw).trim().split(/\s+/);
    if (f.length < 3 || f[0].length !== 4) continue;
    const c = +f[1], cum = +f[2];
    if (!Number.isFinite(c) || c <= 0) continue;
    const epoch = Date.UTC(y, mo, d, +f[0].slice(0, 2), +f[0].slice(2, 4)) / 1000;
    const o = Number.isFinite(prevClose) ? prevClose : c;
    const v = Number.isFinite(cum) ? Math.max(0, cum - prevCum) : 0;
    out.push([epoch, o, Math.max(o, c), Math.min(o, c), c, v]);
    prevClose = c;
    if (Number.isFinite(cum)) prevCum = cum;
  }
  return out;
}

async function fetchTencentHK(sym: string, tf: string): Promise<Bar6[]> {
  const code = tencentCode(sym, "hk");
  if (!code) return [];
  const get = (path: string) =>
    fetch(`https://web.ifzq.gtimg.cn/appstock/app/${path}`, {
      headers: { "User-Agent": "Mozilla/5.0", Referer: "https://gu.qq.com/" },
      cache: "no-store", signal: AbortSignal.timeout(8000),
    }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const [multi, live] = await Promise.all([
    get(`day/query?code=${code}&days=5`),
    get(`hkMinute/query?code=${code}`),
  ]);
  if (!multi && !live) throw new Error("tencent hk unreachable"); // let the route serve its stale copy
  const byDate = new Map<string, unknown[]>();
  for (const day of (multi?.data?.[code]?.data ?? []) as any[])
    if (day?.date && Array.isArray(day.data)) byDate.set(String(day.date), day.data);
  const ln: any = live?.data?.[code]?.data;
  const liveDate = String(ln?.date ?? "");
  if (/^\d{8}$/.test(liveDate) && Array.isArray(ln?.data) && ln.data.length >= (byDate.get(liveDate)?.length ?? 0))
    byDate.set(liveDate, ln.data);
  const base: Bar6[] = [];
  for (const date of [...byDate.keys()].sort()) base.push(...hkSessionBars(date, byDate.get(date)!));
  const minutes = tfMinutes(tf);
  // Session-anchored, NOT absolute-clock: HKEX opens at 09:30, breaks for lunch, and prints its
  // closing auction after 16:00, so plain resample() emitted a half-empty 09:00 candle, a one-print
  // 12:00 lunch stub and a separate 16:00 auction stub every session (see resampleSessionSegments).
  return minutes <= 1 ? base : resampleSessionSegments(base, minutes, HK_SESSION_SEGMENTS);
}

export async function fetchIntraday(
  sym: string, tf: string, ext: boolean, date?: string,
): Promise<Bar6[]> {
  if (!isIntradayTf(tf)) return [];
  // Second band: its own single-session leg, its own cap. Returned BEFORE the 1200-bar tail
  // slice below — that cap is a minute-band depth limit and at 1s it would leave 20 minutes.
  if (isSecondTf(tf)) {
    const secs = await fetchPolygonSeconds(sym, tf, ext, date);
    secs.sort((a, b) => a[0] - b[0]);
    const uniq: Bar6[] = [];
    let prev = -1;
    for (const b of secs) { if (b[0] !== prev) { uniq.push(b); prev = b[0]; } }
    return uniq;
  }
  // FRED daily series (DFII10, T10YIE, …) print once a day and have no intraday leg anywhere.
  // Returned empty BEFORE any fetch: the honest "No intraday data" is the correct answer, and
  // there is no upstream to ask — a bare series id would otherwise fall through classify()'s
  // "us" default into Polygon's stocks aggregates under a ticker that market does not carry.
  if (isDailyOnlySymbol(sym)) return [];
  let bars: Bar6[];
  // Macro instruments are checked BEFORE classify(): ^GSPC / CL=F / EURUSD=X / DX-Y.NYB all fall
  // through classify()'s default to "us", so without this branch they went to Polygon's stocks
  // aggregates under a ticker that market has never heard of.
  if (isMacroSymbol(sym)) {
    bars = await fetchYahooMacroIntraday(sym, tf);
  } else {
    const market = classify(sym);
    if (market === "ca") return []; // .TO has no Polygon intraday leg on this plan — avoid garbage
    bars = (market === "us" || market === "crypto")
      ? await fetchPolygon(sym, market, tf, ext)
      : market === "hk"
        ? await fetchTencentHK(sym, tf)
        : await fetchTencent(sym, market, tf);
  }
  bars.sort((a, b) => a[0] - b[0]);
  const out: Bar6[] = [];
  let last = -1;
  for (const b of bars) { if (b[0] !== last) { out.push(b); last = b[0]; } } // ascending + unique
  return out.slice(-1200);
}

// ── Live top-of-book quote (panel header) ──
// China A-share + Hong Kong: Tencent qt.gtimg.cn snapshot — a COMPLETE real-time quote
// (last / prev-close / open / day high-low / cumulative volume / turnover / change%), ~3-6s
// cadence, keyless, same trusted host family as the kline leg. A-share is genuinely live; HK
// is typically ~15-min delayed at source. Both markets share the same field layout.
// US + crypto + macro: served by the localhost Quote Hub (OKX UTC-0 crypto, Coinbase rolling-24h
// fallback, delayed-15m
// Polygon US, near-live Sina macro with a Yahoo-spark leg of its own); a macro symbol the hub
// misses falls back here to one batched Yahoo spark call, and a total miss → null → manifest
// EOD fallback (see fetchQuote).
export type Quote = {
  sym: string; last: number; prevClose: number | null; chg: number | null;
  open: number | null; high: number | null; low: number | null;
  vol: number | null; amount: number | null; ts: number | null;
  live: boolean; source: string; market: Market;
  // REALTIME is claimed ONLY by a leg that MEASURED the print's age against the wall clock on
  // this very poll (hub/lib/snapshot.js). It is never set from configuration — an env flag can
  // enable the real-time leg, but only the measurement can label its output real-time.
  basis: "REALTIME" | "LIVE" | "DELAYED_15M" | "EOD";
  /** Measured age of the underlying print at serve time, in ms. Present only when measured. */
  lagMs?: number | null;
  /** Epoch-ms of the print itself — the stable half of the pair (see lib/feedFreshness). */
  asOfMs?: number | null;
  /** Latest completed/updated one-second aggregate from the U.S. live WebSocket lane. */
  tickOpen?: number | null; tickHigh?: number | null; tickLow?: number | null; tickClose?: number | null;
  tickVol?: number | null; tickStartMs?: number | null; tickEndMs?: number | null;
  // Extended/overnight fields (item-25/26). Populated by the ext-quote route.
  // extPrice: the most recent ext print; extChg: % vs close; extTs: epoch-sec of that print.
  // Absent (undefined) when no ext data is available (keyless or no print).
  extPrice?: number | null; extChg?: number | null; extTs?: number | null;
  extSession?: "pre" | "post" | "overnight";
  extSource?: string;
  extBasis?: "LIVE" | "DELAYED_15M" | "UNOFFICIAL";
  marketSession?: "pre" | "rth" | "post" | "overnight";
  /** A-share opening call-auction price (09:15–09:29 Asia/Shanghai), kept out of OHLC. */
  auctionPrice?: number | null;
  /** Opening-auction move versus the prior close, in percent. */
  auctionChg?: number | null;
  /** Tencent's explicit A-share suspension marker (field 40 == "S"). */
  suspended?: true;
  regularSessionDate?: string;
  regularSession?: "rth" | "closed";
  close?: number | null;
  prevSessionChg?: number | null;
  // Canonical public display lane added by /api/quote. Native/mobile clients use these
  // instead of interpreting the feed's raw last/chg during pre/post/overnight windows.
  regularPrice?: number | null;
  regularChg?: number | null;
  /** Basis used for the displayed day-change calculation. */
  changeBasis?: "UTC_0" | "ROLLING_24H";
  /** OKX perpetual companion for a canonical -USD spot row. */
  perpLast?: number | null;
  perpPrevClose?: number | null;
  perpChg?: number | null;
  perpOpen?: number | null;
  perpHigh?: number | null;
  perpLow?: number | null;
  perpVol?: number | null;
  perpTs?: number | null;
  perpChangeBasis?: "UTC_0" | "ROLLING_24H";
  perpSource?: string;
};

function _n(s: string | undefined): number | null {
  if (s == null) return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

// Like _n, but treats a non-positive value as ABSENT. CN/HK premarket call-auction snapshots report
// open/high/low = 0 before the session resolves; a real equity price is always > 0, so a 0 here is a
// placeholder, not a print. Passing it through would let the live-bar splice anchor a bar at $0.
function _pos(s: string | undefined): number | null {
  const n = _n(s);
  return n != null && n > 0 ? n : null;
}

// Tencent quote time is "YYYYmmddHHMMSS" (A-share) or "YYYY/MM/DD HH:MM:SS" (HK); both UTC+8.
function _tencentParts(s: string | undefined): RegExpExecArray | null {
  if (!s) return null;
  return /(\d{4})\D?(\d{2})\D?(\d{2})\D?(\d{2}):?(\d{2}):?(\d{2})/.exec(s);
}

function _tencentTs(s: string | undefined): number | null {
  const m = _tencentParts(s);
  if (!m) return null;
  const [, y, mo, d, h, mi, se] = m;
  return Math.floor(Date.UTC(+y, +mo - 1, +d, +h - 8, +mi, +se) / 1000);
}

// A-share opening call auction runs before continuous trading. Tencent timestamps are exchange
// local, so classify the raw wall clock directly: no host timezone and no DST can distort it.
// Only the pre-open state is emitted. Leaving the ordinary CN session undefined preserves the
// existing live-candle path after 09:30, while `pre` explicitly keeps the auction quote out of
// daily/intraday OHLC and lets the primary price lane opt into it.
function _cnTencentSession(s: string | undefined): "pre" | undefined {
  const m = _tencentParts(s);
  if (!m) return undefined;
  const hhmm = Number(m[4]) * 100 + Number(m[5]);
  return hhmm >= 915 && hhmm < 930 ? "pre" : undefined;
}

// Parse one Tencent qt.gtimg.cn "~"-delimited field record into a Quote (shared by the single and
// batch fetchers). Field offsets: 3=last 4=prevClose 5=open 6=vol(手, A-share) 30=ts 32=change%
// 33=high 34=low 37=amount. Tencent responds in GBK, but every field we read is ASCII, so the
// caller decodes as latin1 (the Chinese name bytes we ignore decode to garbage, which is fine).
export function parseTencentFields(sym: string, market: Market, f: string[]): Quote | null {
  if (f.length < 35) return null;
  const last = _n(f[3]);
  if (last == null || last === 0) return null;
  const prevClose = _n(f[4]);
  const open = _pos(f[5]);
  const ts = _tencentTs(f[30]);
  const marketSession = market === "cn" ? _cnTencentSession(f[30]) : undefined;
  // Before the match resolves, Tencent publishes a valid indicative `last` while O/H/L remain
  // zero placeholders. Once the 09:25 match resolves, `open` is the authoritative auction print.
  // Give both phases one explicit field so clients never have to infer auction semantics from raw
  // OHLC, and never let this price create a candle before continuous trading begins.
  const auctionPrice = marketSession === "pre" ? (open ?? last) : null;
  const auctionChg = auctionPrice != null && prevClose != null && prevClose > 0
    ? ((auctionPrice - prevClose) / prevClose) * 100
    : null;
  const volRaw = _n(f[6]); // A-share volume is in 手 (lots, ×100 shares); HK is already in shares
  return {
    sym, last, prevClose, chg: _n(f[32]),
    open, high: _pos(f[33]), low: _pos(f[34]),
    vol: volRaw == null ? null : (market === "cn" ? volRaw * 100 : volRaw),
    amount: _n(f[37]), ts,
    live: true, source: "tencent", market,
    // A-share is genuinely real-time (LIVE); HK is ~15-min delayed at source (DELAYED_15M).
    basis: market === "cn" ? "LIVE" : "DELAYED_15M",
    ...(f[40]?.trim().toUpperCase() === "S" ? { suspended: true as const } : {}),
    ...(marketSession ? { marketSession, auctionPrice, auctionChg } : {}),
  };
}

// Batch China/HK quotes in ONE request. qt.gtimg.cn/q= accepts many comma-joined codes and echoes
// each back as `v_<code>="..."`; we reverse-map <code>→sym. Throws on a non-200 (caller catches).
async function fetchTencentQuotes(syms: string[]): Promise<Record<string, Quote>> {
  const codeToSym = new Map<string, string>();
  const marketOf = new Map<string, Market>();
  const codes: string[] = [];
  for (const s of syms) {
    const mk = classify(s);
    const code = tencentCode(s, mk);
    if (code) { codeToSym.set(code, s); marketOf.set(s, mk); codes.push(code); }
  }
  if (!codes.length) return {};
  // One quick retry on network failure/abort: typical latency is ~1-1.3s against the 2.5s cap, so
  // a single slow response aborts and would otherwise blank the whole chunk for this poll. The
  // timeout signal also governs body streaming, so the body read lives INSIDE the attempt (a
  // mid-body stall must retry too); each try needs a fresh signal. A non-200 is thrown as-is and
  // NOT retried — no point hammering an upstream that answered with an error.
  const attempt = async (): Promise<ArrayBuffer> => {
    const r = await fetch(`https://qt.gtimg.cn/q=${codes.join(",")}`, {
      headers: { "User-Agent": "Mozilla/5.0", Referer: "https://gu.qq.com/" },
      cache: "no-store", signal: AbortSignal.timeout(2500),
    });
    if (!r.ok) throw new Error("tencent-quote " + r.status);
    return r.arrayBuffer();
  };
  let buf: ArrayBuffer;
  try { buf = await attempt(); }
  catch (e) {
    if (e instanceof Error && e.message.startsWith("tencent-quote")) throw e;
    buf = await attempt();
  }
  const text = new TextDecoder("latin1").decode(buf);
  const out: Record<string, Quote> = {};
  const re = /v_(\w+)="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const sym = codeToSym.get(m[1]);
    if (!sym) continue;
    const q = parseTencentFields(sym, marketOf.get(sym)!, m[2].split("~"));
    if (q) out[sym] = q;
  }
  return out;
}

// Batch US/crypto quotes from the localhost Quote Hub — /quotes?syms=CSV is already contract-shaped
// ({SYM:{...}}). Hub down / non-200 / timeout → {} (→ those symbols fall back to manifest EOD).
async function fetchHubQuotes(syms: string[]): Promise<Record<string, Quote>> {
  if (!syms.length) return {};
  try {
    const port = process.env.HUB_PORT ?? "3100";
    const r = await fetch(
      "http://127.0.0.1:" + port + "/quotes?syms=" + encodeURIComponent(syms.join(",")),
      { cache: "no-store", signal: AbortSignal.timeout(1500) }
    );
    if (!r.ok) return {};
    const j: any = await r.json();
    const out: Record<string, Quote> = {};
    for (const s of syms) if (j && j[s]) out[s] = j[s];
    return out;
  } catch {
    return {};
  }
}

function chunk<T>(a: T[], n: number): T[][] {
  const o: T[][] = [];
  for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n));
  return o;
}

// Batch live quotes for many symbols with the fewest upstream calls: one Quote-Hub call for all
// US+crypto+macro, chunked Tencent calls for all CN+HK, then ONE Yahoo spark call for whichever
// macro symbols the hub did not answer. Symbol-keyed map (failed/missing symbols simply absent →
// the caller falls back to manifest EOD). This is the single source of truth behind BOTH the live
// header and the live watchlist, so a symbol can never show two prices (see TerminalShell).
export async function fetchQuotes(syms: string[]): Promise<Record<string, Quote>> {
  const uniq = Array.from(new Set(syms.map((s) => s.trim()).filter(Boolean)));
  const hub: string[] = [];
  const tencent: string[] = [];
  const macro: string[] = [];
  for (const s of uniq) {
    // FRED daily series are routed NOWHERE — not the hub, not spark. They print once a day, so
    // every live leg would either miss them (spark has no DFII10) or invent freshness for them
    // (the hub's store placeholder stamps ts:now / DELAYED_15M). Staying absent is what makes
    // the caller fall back to the manifest's honest daily close.
    if (isDailyOnlySymbol(s)) continue;
    // Macro instruments (^GSPC, GC=F, EURUSD=X, DX-Y.NYB) are checked FIRST — their shapes fall
    // through classify()'s default and must not be mistaken for US equities. They go to the hub
    // TOO (it now carries a near-live Sina macro leg), and are tracked separately so the ones the
    // hub does not answer can fall back to the delayed Yahoo spark below.
    if (isMacroSymbol(s)) { macro.push(s); hub.push(s); continue; }
    const mk = classify(s);
    // CN/HK index codes (000001.SS, 000300.SS, 399001.SZ, 399006.SZ) need no special case: they
    // match the A-share pattern and Tencent serves indices under the same sh######/sz###### codes.
    if (mk === "cn" || mk === "hk") tencent.push(s);
    else if (mk === "us" || mk === "crypto") hub.push(s); // ca → no live leg → manifest EOD
  }
  const out: Record<string, Quote> = {};
  await Promise.all([
    ...chunk(hub, 100).map((c) => fetchHubQuotes(c).then((mp) => { Object.assign(out, mp); }).catch(() => {})),
    // 30/chunk (not 60): one slow/aborted Tencent response blanks its whole chunk, so smaller
    // chunks halve the blast radius of a single bad request (chunks run in parallel anyway).
    ...chunk(tencent, 30).map((c) => fetchTencentQuotes(c).then((mp) => { Object.assign(out, mp); }).catch(() => {})),
  ]);
  // Hub-first, spark-fallback. A hub-served macro quote passes through UNCHANGED (it is already
  // Quote-shaped and carries its own source/basis — near-live Sina prints must keep saying LIVE).
  // Only the macro symbols the hub did NOT answer go to the delayed Yahoo spark, in ONE batched
  // call. This is what keeps local dev (no hub on :3100) working and what covers the hub's macro
  // leg being down in production; a symbol both legs miss stays absent → manifest EOD upstream.
  const macroMissing = macro.filter((s) => !out[s]);
  if (macroMissing.length) {
    try {
      const mp = await fetchMacroQuotes(macroMissing);
      for (const [sym, q] of Object.entries(mp)) {
        out[sym] = {
          sym, last: q.last, prevClose: q.prevClose, chg: q.chg,
          open: null, high: null, low: null, vol: null, amount: null, ts: q.ts,
          // DELAYED, not live: this source runs behind the exchange, and real-time
          // index/CME/ICE data requires a licensed feed we do not hold. Marking these LIVE
          // would print a claim we cannot back.
          live: false, source: "yahoo-spark", market: "us", basis: "DELAYED_15M",
        };
      }
    } catch { /* spark down → those symbols stay absent → manifest EOD */ }
  }
  return out;
}

// Single-symbol live quote (China/HK via Tencent, US/crypto via the Quote Hub; null for .TO and any
// miss → manifest EOD backs the header). Delegates to the batch path so both share one code path.
export async function fetchQuote(sym: string): Promise<Quote | null> {
  return (await fetchQuotes([sym]))[sym] ?? null;
}
