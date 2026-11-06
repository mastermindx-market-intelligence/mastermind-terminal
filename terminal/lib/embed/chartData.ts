/**
 * chartData.ts — pure, framework-free helpers for the embeddable chart widget
 * (app/embed/chart). Kept side-effect-free and DOM-free so they are unit-testable
 * under vitest and so the embed's client bundle stays lean (no chart/Supabase imports
 * leak in here).
 *
 * SINGLE AUTHOR: embed widget. Not shared with ChartPanel/TerminalShell — the embed is a
 * self-contained companion widget (daily bars only, no live quotes, no indicators engine).
 */

// ── Types ────────────────────────────────────────────────────────────────────

/** One daily OHLCV bar as stored in /data/<SYM>.json: [time, open, high, low, close, volume]. */
export type RawBar = [string, number, number, number, number, number];

/** Normalised bar the widget draws. `time` is a "YYYY-MM-DD" business-day string (LWC-native). */
export interface Bar {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** The shape of /data/<SYM>.json we consume (extra keys like t/o/src/bar_quality are ignored). */
export interface OhlcFile {
  bars?: RawBar[];
}

export type ThemeName = "dark" | "light";
export type Lang = "en" | "zh";
export type RangeKey = "1M" | "3M" | "6M" | "1Y" | "2Y" | "5Y" | "MAX";

export const RANGE_KEYS: readonly RangeKey[] = ["1M", "3M", "6M", "1Y", "2Y", "5Y", "MAX"] as const;

/** Approximate trading days per range window (used to seed the initial visible range). */
const RANGE_BARS: Record<RangeKey, number> = {
  "1M": 22,
  "3M": 66,
  "6M": 126,
  "1Y": 252,
  "2Y": 504,
  "5Y": 1260,
  MAX: Number.POSITIVE_INFINITY,
};

// ── Param parsing / validation ─────────────────────────────────────────────────

// US ticker grammar per the brief: leading letter, then up to 9 of letter/digit/./-.
const SYMBOL_RE = /^[A-Za-z][A-Za-z0-9.\-]{0,9}$/;

/**
 * parseSymbol — validate + uppercase a raw `symbol` query value.
 * Returns the uppercased ticker, or null when missing/invalid (page shows a clean error state).
 */
export function parseSymbol(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!SYMBOL_RE.test(s)) return null;
  return s.toUpperCase();
}

/** parseTheme — "light" only when explicitly requested; everything else defaults to dark. */
export function parseTheme(raw: string | null | undefined): ThemeName {
  return raw === "light" ? "light" : "dark";
}

/** parseLang — "zh" only when explicitly requested; everything else defaults to en. */
export function parseLang(raw: string | null | undefined): Lang {
  return raw === "zh" ? "zh" : "en";
}

/** parseTransparent — the parent frames us in glass and passes transparent=1. Default opaque. */
export function parseTransparent(raw: string | null | undefined): boolean {
  return raw === "1" || raw === "true";
}

/** parseRange — validate the initial visible-range key; default 1Y. Case-insensitive. */
export function parseRange(raw: string | null | undefined): RangeKey {
  if (typeof raw === "string") {
    const up = raw.trim().toUpperCase();
    if ((RANGE_KEYS as readonly string[]).includes(up)) return up as RangeKey;
  }
  return "1Y";
}

// ── Bar normalisation ──────────────────────────────────────────────────────────

/** Canonical calendar day only. UTC is used for validation, never for display conversion. */
function isDailyDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

/**
 * toBars — normalise the raw /data JSON into typed, sorted, finite Bars.
 * Drops rows without a canonical calendar day or finite OHLC. Invalid volume retains the
 * existing zero fallback. A single unusable row need not blank an otherwise usable series.
 */
export function toBars(file: OhlcFile | null | undefined): Bar[] {
  const raw = file?.bars;
  if (!Array.isArray(raw)) return [];
  const out: Bar[] = [];
  for (const r of raw) {
    if (!Array.isArray(r) || r.length < 6) continue;
    const [time, o, h, l, c, v] = r;
    if (!isDailyDate(time)) continue;
    if (![o, h, l, c].every((n) => typeof n === "number" && Number.isFinite(n))) continue;
    out.push({
      time,
      open: o,
      high: h,
      low: l,
      close: c,
      volume: typeof v === "number" && Number.isFinite(v) ? v : 0,
    });
  }
  // Stable sort by date so the last element is always the most recent close.
  out.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
  return out;
}

// ── Quote (last close + change vs previous close) ──────────────────────────────

export interface Quote {
  last: number;
  prev: number | null;
  change: number | null;
  changePct: number | null;
  asOf: string;
  dir: "up" | "down" | "flat";
}

/**
 * computeQuote — last close and change vs the PREVIOUS close (the brief's contract).
 * Returns null only when there are zero bars.
 */
export function computeQuote(bars: Bar[]): Quote | null {
  if (bars.length === 0) return null;
  const lastBar = bars[bars.length - 1];
  const last = lastBar.close;
  const prevBar = bars.length > 1 ? bars[bars.length - 2] : null;
  const prev = prevBar ? prevBar.close : null;
  const change = prev != null ? last - prev : null;
  const changePct = prev != null && prev !== 0 ? (change! / prev) * 100 : null;
  const dir: Quote["dir"] = change == null || change === 0 ? "flat" : change > 0 ? "up" : "down";
  return { last, prev, change, changePct, asOf: lastBar.time, dir };
}

/** Settled outcomes owned by this daily widget, independent of transport and live quotes. */
export type DailyHistoryState =
  | { kind: "empty" }
  | { kind: "unavailable" }
  | { kind: "ready"; bars: Bar[]; quote: Quote };

/**
 * Interpret a successful JSON response without treating malformed data as confirmed absence.
 * Duplicate usable dates are ambiguous and unsafe for the chart; do not invent a winner.
 */
export function parseDailyHistory(file: unknown): DailyHistoryState {
  if (!file || typeof file !== "object") return { kind: "unavailable" };
  const source = file as OhlcFile;
  if (!Array.isArray(source.bars)) return { kind: "unavailable" };
  if (source.bars.length === 0) return { kind: "empty" };
  const bars = toBars(source);
  const quote = computeQuote(bars);
  if (!quote || bars.some((bar, index) => index > 0 && bar.time === bars[index - 1].time)) {
    return { kind: "unavailable" };
  }
  return { kind: "ready", bars, quote };
}

// ── SMA (simple moving average of closes) ──────────────────────────────────────

export interface LinePoint {
  time: string;
  value: number;
}

/**
 * sma — simple moving average over closes, aligned to bar times. Points before the window is
 * full are omitted (LWC line series skips gaps), so SMA-200 simply starts 200 bars in.
 */
export function sma(bars: Bar[], length: number): LinePoint[] {
  if (length <= 0 || bars.length < length) return [];
  const out: LinePoint[] = [];
  let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    sum += bars[i].close;
    if (i >= length) sum -= bars[i - length].close;
    if (i >= length - 1) out.push({ time: bars[i].time, value: sum / length });
  }
  return out;
}

// ── Initial visible range → [fromTime, toTime] ─────────────────────────────────

/**
 * visibleRange — the [from, to] time window (inclusive, "YYYY-MM-DD" strings) for an initial
 * range key. MAX (or a window longer than history) returns the full span. Returns null when
 * there are no bars.
 */
export function visibleRange(bars: Bar[], range: RangeKey): { from: string; to: string } | null {
  if (bars.length === 0) return null;
  const to = bars[bars.length - 1].time;
  const want = RANGE_BARS[range];
  if (!Number.isFinite(want) || want >= bars.length) {
    return { from: bars[0].time, to };
  }
  const fromIdx = Math.max(0, bars.length - Math.round(want));
  return { from: bars[fromIdx].time, to };
}

// ── Number formatting (display) ────────────────────────────────────────────────

/** fmtPrice — 2 decimals with thousands separators (e.g. 1,283.78). */
export function fmtPrice(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** fmtChange — signed absolute change, 2 decimals (e.g. +9.57 / −2.10). Uses a real minus glyph. */
export function fmtChange(n: number): string {
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return sign + fmtPrice(Math.abs(n));
}

/** fmtPct — signed percent, 2 decimals, in parens (e.g. +3.49% / −0.74%). */
export function fmtPct(n: number): string {
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return sign + Math.abs(n).toFixed(2) + "%";
}

/** fmtVolume — compact volume (e.g. 261.77M, 4.21B, 950.0K). */
export function fmtVolume(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(Math.round(n));
}
