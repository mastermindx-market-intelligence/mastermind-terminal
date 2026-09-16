// Pure, node:fs-free helpers shared between intradaySources (client-shared) and intradayStore
// (server-only, node:fs). Only immutable clock data imports — keeping it dep-free is what makes it safe
// to import from both sides of the client/server boundary.
//
// Turbopack rule: a module that client code transitively imports must not pull in node: builtins.
// intradaySources is imported by ChartPanel/TerminalShell/TechnicalsPage (all client components),
// so intradaySources must stay free of node:fs. intradayStore owns all fs access and is imported
// ONLY by the route. This shared module sits in between — no fs, no problem on either side.

import { usRegularSessionWindow } from "./usEquitySessionClock";

export type Bar6 = [number, number, number, number, number, number];

export const INTRADAY_TFS = ["1m", "2m", "3m", "5m", "10m", "15m", "30m", "45m", "1h", "2h", "3h", "4h"] as const;
const INTRADAY_SET: ReadonlySet<string> = new Set(INTRADAY_TFS);

// ── Second-resolution band (US equities only) ────────────────────────────────
// Served by Polygon/Massive `…/range/<n>/second/…`, which the Stocks Advanced plan entitles.
// Kept as its OWN list rather than folded into INTRADAY_TFS so a consumer that walks the
// minute/hour band (deep-history store bases, resample targets) keeps its existing meaning —
// there is no second-resolution deep history anywhere in this app, only a live-window fetch.
// `isIntradayTf` DOES accept them, because every "is this an intraday chart" branch
// (session filtering, live splice, chart axis) must treat a second bar as intraday.
export const SECOND_TFS = ["1s", "5s", "15s", "30s"] as const;
const SECOND_SET: ReadonlySet<string> = new Set(SECOND_TFS);
export const isSecondTf = (tf: string) => SECOND_SET.has(tf);
export const isIntradayTf = (tf: string) => INTRADAY_SET.has(tf) || SECOND_SET.has(tf);

/** Bar width in SECONDS. The only unit that expresses every band losslessly. */
export function tfSeconds(tf: string): number {
  const m = /^(\d+)(s|m|h)$/.exec(tf);
  if (!m) return 0;
  const n = parseInt(m[1], 10) || 1;
  return m[2] === "h" ? n * 3600 : m[2] === "m" ? n * 60 : n;
}

/**
 * Bar width in MINUTES — fractional below a minute (1s → 1/60).
 *
 * Fractional rather than 0 so the arithmetic consumers stay correct by construction:
 * `resample(bars, tfMinutes(tf))` computes `minutes * 60` seconds per bucket, and
 * ChartPanel's `tfMinutes(tf) * 60` interval is likewise a second count. Returning 0 for
 * "1s" would have made both a divide-by-zero / degenerate bucket instead.
 */
export function tfMinutes(tf: string): number {
  const s = tfSeconds(tf);
  return s === 0 ? 0 : s / 60;
}

export type Market = "cn" | "hk" | "crypto" | "us" | "ca";
export function classify(sym: string): Market {
  if (/\.(SS|SZ)$/i.test(sym)) return "cn";
  if (/\.HK$/i.test(sym)) return "hk";
  if (/\.TO$/i.test(sym)) return "ca";
  if (/-USD$/i.test(sym)) return "crypto";
  return "us";
}

// Aggregate base bars into coarser `minutes` buckets, keyed by absolute (display-)epoch so buckets
// align to local clock boundaries. Bar6 layout: [epoch, open, high, low, close, vol].
export function resample(bars: Bar6[], minutes: number): Bar6[] {
  if (minutes <= 0 || bars.length === 0) return bars;
  const span = minutes * 60;
  const out: Bar6[] = [];
  let cur: Bar6 | null = null;
  let key = NaN;
  for (const b of bars) {
    const k = Math.floor(b[0] / span);
    if (k !== key) { if (cur) out.push(cur); key = k; cur = [k * span, b[1], b[2], b[3], b[4], b[5]]; }
    else { cur![2] = Math.max(cur![2], b[2]); cur![3] = Math.min(cur![3], b[3]); cur![4] = b[4]; cur![5] += b[5]; }
  }
  if (cur) out.push(cur);
  return out;
}

// ── Session-segment bucketing (markets whose day is split by a midday break) ──
// `resample` keys on absolute clock boundaries, which is wrong for a session that neither opens on
// the hour nor runs continuously. On HKEX it produced a 09:00 candle holding 30 minutes of the
// 09:30 open, a one-print 12:00 stub from the lunch-boundary tick, and a separate 16:00 candle for
// the closing-auction prints — three artefacts per session, which at 4h was 3 bars where 2 belong.
// Bucketing anchors to each SEGMENT's open instead: a candle starts when trading starts, never
// spans the break, and prints outside continuous trading (a pre-open or closing-auction tick) clamp
// into the nearest real candle rather than opening a stub of their own.
// Minutes-from-midnight in the market's own wall clock, which IS the display epoch's UTC clock.
export type SessionSegment = { start: number; end: number };
export const HK_SESSION_SEGMENTS: SessionSegment[] = [
  { start: 9 * 60 + 30, end: 12 * 60 },   // morning:   09:30–12:00
  { start: 13 * 60, end: 16 * 60 },       // afternoon: 13:00–16:00 (16:01–16:08 auction folds into the last candle)
];

function segmentBucket(epoch: number, minutes: number, segments: SessionSegment[]): number {
  const dayStart = Math.floor(epoch / 86400) * 86400;
  const minute = (epoch - dayStart) / 60;
  // the last segment whose open has passed — so a lunch-break print belongs to the morning, and
  // anything before the first open belongs to the first candle of the day.
  let seg = segments[0];
  for (const s of segments) if (minute >= s.start) seg = s;
  const lastIdx = Math.max(0, Math.ceil((seg.end - seg.start) / minutes) - 1);
  const idx = Math.min(Math.max(0, Math.floor((minute - seg.start) / minutes)), lastIdx);
  return dayStart + (seg.start + idx * minutes) * 60;
}

export function resampleSessionSegments(bars: Bar6[], minutes: number, segments: SessionSegment[]): Bar6[] {
  if (minutes <= 0 || bars.length === 0) return bars;
  const out: Bar6[] = [];
  let cur: Bar6 | null = null;
  let key = Number.NaN;
  for (const b of bars) {
    const bucket = segmentBucket(b[0], minutes, segments);
    if (bucket !== key) { if (cur) out.push(cur); key = bucket; cur = [bucket, b[1], b[2], b[3], b[4], b[5]]; }
    else { cur![2] = Math.max(cur![2], b[2]); cur![3] = Math.min(cur![3], b[3]); cur![4] = b[4]; cur![5] += b[5]; }
  }
  if (cur) out.push(cur);
  return out;
}

export type UsEquitySession = "regular" | "extended";
const US_REGULAR_START = 9 * 60 + 30;
const US_EXTENDED_START = 4 * 60;
const US_EXTENDED_END = 20 * 60;

function displayMinuteOfDay(epoch: number): number {
  return ((Math.floor(epoch / 60) % 1440) + 1440) % 1440;
}

// US bars use a display epoch whose UTC clock components equal ET wall time.
// This lets the session filter stay DST-safe without converting the timestamp
// again: 09:30 in the display epoch is always the exchange's 09:30.
export function filterUsEquitySession(bars: Bar6[], session: UsEquitySession): Bar6[] {
  return bars.filter((bar) => {
    const window = session === "extended"
      ? [US_EXTENDED_START, US_EXTENDED_END]
      : usRegularSessionWindow(bar[0]);
    if (!window) return false; // A full exchange closure is not a short session.
    const minute = displayMinuteOfDay(bar[0]);
    return minute >= window[0] && minute < window[1];
  });
}

// Resample only after session filtering and anchor buckets to the selected
// session open. Absolute-hour bucketing creates a 09:00 candle and can mix
// premarket prints into a regular-session hourly candle.
export function resampleUsEquitySession(
  bars: Bar6[],
  minutes: number,
  session: UsEquitySession,
): Bar6[] {
  // Enforce regular-session boundaries even for callers supplying raw bars.
  // Extended-session policy is deliberately unchanged by this clock repair.
  const selected = session === "regular" ? filterUsEquitySession(bars, session) : bars;
  if (minutes <= 1 || selected.length === 0) return selected;
  const anchorMinute = session === "extended" ? US_EXTENDED_START : US_REGULAR_START;
  const span = minutes * 60;
  const out: Bar6[] = [];
  let current: Bar6 | null = null;
  let key = Number.NaN;
  for (const bar of selected) {
    const dayStart = Math.floor(bar[0] / 86400) * 86400;
    const offset = bar[0] - dayStart - anchorMinute * 60;
    const bucket = dayStart + anchorMinute * 60 + Math.floor(offset / span) * span;
    if (bucket !== key) {
      if (current) out.push(current);
      key = bucket;
      current = [bucket, bar[1], bar[2], bar[3], bar[4], bar[5]];
    } else {
      current![2] = Math.max(current![2], bar[2]);
      current![3] = Math.min(current![3], bar[3]);
      current![4] = bar[4];
      current![5] += bar[5];
    }
  }
  if (current) out.push(current);
  return out;
}

/**
 * "HH:MM" ET on a session date → the app's DISPLAY-EPOCH seconds.
 *
 * THE CONVENTION (see `etDisplay` in intradaySources): every provider's bars are emitted as a
 * "display epoch" — the market-local wall clock read AS IF it were UTC. A 09:31 ET bar becomes
 * 09:31Z, not 13:31Z. Lightweight-Charts renders timestamps in UTC, so this is what makes the
 * time axis read as the local session clock without any per-chart timezone plumbing.
 *
 * Anything drawn on the same axis as intraday candles MUST use this convention. Building the
 * true UTC instant instead (e.g. `new Date("<date>T09:31:00-04:00")`) silently shifts a series by
 * the market's UTC offset — 4h in EDT, 5h in EST — which is how the surface heat field ended up
 * plotted four hours to the right of its own candles and axis-labelled 13:31 for the 09:31 column.
 *
 * Deliberately arithmetic-only: no Intl, no DST lookup. The offset is not needed — and must not be
 * applied — because the wall-clock components ARE the output. Returns NaN on unparseable input so
 * callers can drop the point rather than plot it at the epoch.
 */
export function sessionEpoch(sessionDate: string, hhmm: string): number {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(sessionDate);
  const t = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!d || !t) return NaN;
  return Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2]) / 1000;
}

/**
 * Keep only bars belonging to one market session date.
 *
 * Intraday bars use the app's display-epoch convention, so a session is the simple
 * half-open UTC-shaped day [00:00, next 00:00). Keeping this helper beside
 * `sessionEpoch` prevents clients from accidentally mixing a deep history response into
 * a single-session study (the Flow Surface regression that flattened price and reduced
 * today's field to a sliver).
 */
export function filterBarsToSessionDate(bars: Bar6[], sessionDate: string): Bar6[] {
  const start = sessionEpoch(sessionDate, "00:00");
  if (!Number.isFinite(start)) return [];
  const end = start + 86_400;
  return bars.filter((bar) => Number.isFinite(bar[0]) && bar[0] >= start && bar[0] < end);
}
