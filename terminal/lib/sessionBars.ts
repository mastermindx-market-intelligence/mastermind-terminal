// The canonical daily-multiple (2D/3D) bar grid — the browser half of ONE bar identity.
//
// THE LAW
// -------
// A 3D bar is three TRADING SESSIONS, not three calendar days and not "three rows of whatever
// history happened to load". Which sessions share a bar is fixed by a GLOBAL session index
// counted from the symbol's first listed session, and each bar is keyed by its OPENING session.
// That is what TradingView draws and it is what `signal_layer/confluence.py::_3d_groups` — the
// engine every Golden Oracle signal is computed on — implements:
//
//     gi[i]    = i + barAnchor                 // global session index of feed row i
//     open(0)  = true                          // the feed's first row always starts a bar
//     open(i)  = gi[i - 1] % mult === 0        // a bar opens the session after one closes
//     close(b) = open(b + 1) - 1               // …and closes the session before the next opens
//
// so a bar CLOSES on global index ≡ 0 (mod mult) and OPENS on ≡ 1. Note what that means at
// barAnchor 0: the grid is [0], [1,2,3], [4,5,6]… — a one-session partial bar and then triples.
// It is NOT `floor(i / 3)`, which is a different grid entirely, in a different phase, keyed by a
// different session. Feeding row 0 of a truncated feed into `floor(i / 3)` re-phases every later
// bar in the chart and is exactly how the chart came to disagree with the Oracle about which
// candle a signal belongs to.
//
// BAR IDENTITY vs DATA AVAILABILITY
// ---------------------------------
// `time` is the bar's IDENTITY: its opening session, the key TradingView shows on a 3D crosshair
// and the key the engine indexes its signal frame by. `closeTime` is a different fact — the
// session on which the bar became (or will become) complete, the engine's `known_ts`. The last
// bar of a live feed is keyed by a date on which its close was not yet knowable. Consumers that
// ask "what does the user know today" must read `closeTime`; consumers that ask "which candle is
// this" must read `time`. Collapsing the two in either direction is a correctness bug: one moves
// signals backwards in knowledge time, the other misplaces them on the chart.
//
// WHERE THE PHASE COMES FROM
// --------------------------
// `barAnchor` is not derivable from a truncated feed and must never be guessed from one. The
// producer that owns the session calendar publishes it on the OHLC document as `session_anchor`
// (contract + rationale: `ingest/session_anchor.py`); `resolveBarAnchor` turns that published
// anchor POINT into this array's row-0 anchor, so the same document stays correct as the feed is
// appended to or extended backwards. With no anchor the grid falls back to `barAnchor` 0, which
// is exactly the fallback the signal engine itself takes when its deep store cannot resolve the
// symbol — still session-grouped, still open-keyed, just phased at the feed's first row.
//
// W / 2W / 1M / 3M use the unchanged calendar grouping moved here from ChartPanel,
// so price charts and completed-bar consumers share the same owner.

/** The published `session_anchor` object (see `ingest/session_anchor.py`). */
export type SessionAnchor = {
  /** Contract version. */
  v?: number;
  /** An ISO session date that appears in the document's own bars. */
  date: string;
  /** That session's global index, counted from the symbol's first listed session. */
  index: number;
  /**
   * `"ipo"` — a real global index resolved from the symbol's session calendar.
   * `"feed"` — the calendar was unavailable; `index` is 0 meaning "phase at this feed's first
   * row", which is a fallback, NOT a claim about the IPO.
   */
  basis?: "ipo" | "feed" | string;
};

/** A canonical daily-multiple bar. `time` is identity; `closeTime` is availability. */
export type SessionBar<T> = T & { time: string; closeTime: string };

/** The session multiple of a daily-multiple timeframe, or null for everything else. */
export function dailyMultipleOf(tf: string): number | null {
  if (tf === "2D") return 2;
  if (tf === "3D") return 3;
  return null;
}

/** Read a `session_anchor` off a fetched document, rejecting anything malformed. */
export function parseSessionAnchor(raw: unknown): SessionAnchor | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  if (typeof a.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(a.date)) return null;
  if (typeof a.index !== "number" || !Number.isInteger(a.index) || a.index < 0) return null;
  const basis = typeof a.basis === "string" ? a.basis : undefined;
  return { v: typeof a.v === "number" ? a.v : undefined, date: a.date, index: a.index, basis };
}

/**
 * The global session index of `times[0]`, given a published anchor point.
 *
 * The anchor names a session and its global index; this locates that session in the rows we
 * actually hold and subtracts. Appending bars cannot move it, and extending the feed backwards
 * moves it by exactly the number of sessions prepended — which is the point of publishing a
 * point rather than a bare integer.
 *
 * Returns 0 — the documented feed-phased default — when there is no anchor, when the anchored
 * session is not among these rows (the document has been re-cut since the anchor was written, so
 * the phase is no longer known and must not be invented), or when the arithmetic would imply a
 * negative global index.
 */
export function resolveBarAnchor(
  times: ReadonlyArray<string | number>,
  anchor: SessionAnchor | null | undefined,
): number {
  if (!anchor || !times.length) return 0;
  // Bar times are ascending ISO dates on every daily-derived timeframe; lexical order IS
  // chronological order for "YYYY-MM-DD", so a binary search needs no Date parsing.
  let lo = 0, hi = times.length - 1, at = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const t = String(times[mid]);
    if (t === anchor.date) { at = mid; break; }
    if (t < anchor.date) lo = mid + 1; else hi = mid - 1;
  }
  if (at < 0) return 0;
  const barAnchor = anchor.index - at;
  return barAnchor >= 0 ? barAnchor : 0;
}

/**
 * Positions in `[0, n)` at which a bar OPENS, under the canonical rule.
 *
 * Mirrors `_3d_groups` exactly, generalised from 3 to `mult`. The modulo is written positive so
 * a (defensively handled) negative anchor cannot silently invert the phase the way JS `%` would.
 */
export function sessionBarOpens(n: number, mult: number, barAnchor: number): number[] {
  if (n <= 0 || mult <= 1) return n > 0 ? Array.from({ length: n }, (_, i) => i) : [];
  const opens: number[] = [0];
  const a = Math.trunc(barAnchor);
  for (let i = 1; i < n; i++) {
    const prev = ((i - 1 + a) % mult + mult) % mult;
    if (prev === 0) opens.push(i);
  }
  return opens;
}

/**
 * Group `rows` into canonical daily-multiple bars.
 *
 * `rows` must be one entry per trading session, ascending. `aggregate(from, to)` builds the bar
 * body from the inclusive session span; this module owns only the grid and the two timestamps,
 * so a caller can aggregate OHLCV, or anything else, without the rule being restated.
 */
export function groupSessionBars<T>(
  rows: ReadonlyArray<{ time: string }>,
  mult: number,
  barAnchor: number,
  aggregate: (fromIdx: number, toIdx: number) => T,
): SessionBar<T>[] {
  const n = rows.length;
  if (n === 0) return [];
  const opens = sessionBarOpens(n, mult, barAnchor);
  const out: SessionBar<T>[] = [];
  for (let b = 0; b < opens.length; b++) {
    const from = opens[b];
    const to = (b + 1 < opens.length ? opens[b + 1] : n) - 1;
    out.push({
      ...aggregate(from, to),
      time: rows[from].time,
      closeTime: rows[to].time,
    });
  }
  return out;
}

/**
 * Map every SESSION date to the `time` (opening session) of the bar that contains it.
 *
 * This is how a signal stamped with an engine bar date resolves to a chart bar without
 * nearest-bar snapping: an engine bar date IS an opening session, so it maps to itself, and a
 * date that is not one still resolves to the bar it genuinely belongs to rather than to whatever
 * candle happens to be closest. A phase disagreement then shows up as a miss instead of hiding
 * inside a tolerance window.
 */
export function sessionToBarTime(
  rows: ReadonlyArray<{ time: string }>,
  mult: number,
  barAnchor: number,
): Map<string, string> {
  const map = new Map<string, string>();
  const n = rows.length;
  if (n === 0) return map;
  const opens = sessionBarOpens(n, mult, barAnchor);
  for (let b = 0; b < opens.length; b++) {
    const from = opens[b];
    const to = (b + 1 < opens.length ? opens[b + 1] : n) - 1;
    const key = rows[from].time;
    for (let i = from; i <= to; i++) map.set(rows[i].time, key);
  }
  return map;
}

/** OHLC bar shared by the price chart and completed-timeframe readers. */
export type SessionOhlcBar = { time: string; o: number; h: number; l: number; c: number; v: number; closeTime?: string };

export function resampleTf(rows: SessionOhlcBar[], tf: string, anchor?: SessionAnchor | null): SessionOhlcBar[] {
  if (tf === "D" || rows.length === 0) return rows;
  // ── daily multiples (2D / 3D) ─ ONE canonical grid, shared with the signal engine ──────
  // These are the only timeframes with a session-PHASE freedom, and the phase is not a
  // property of this array: it is the symbol's global session index, published on the OHLC
  // document as `session_anchor` (ingest/session_anchor.py) because a truncated feed cannot
  // tell you which sessions share a bar. Bucketing by row index from the feed's first row —
  // what this function did — re-phased every later bar and stamped each one with its CLOSING
  // session, so a Golden Oracle signal (indexed by the bar's OPEN) never matched the candle it
  // was computed on. lib/sessionBars.ts carries the rule and the rationale.
  const mult = dailyMultipleOf(tf);
  if (mult != null) {
    const barAnchor = resolveBarAnchor(rows.map((r) => r.time), anchor);
    return groupSessionBars(rows, mult, barAnchor, (from, to) => {
      const first = rows[from];
      let h = first.h, l = first.l, v = first.v;
      for (let i = from + 1; i <= to; i++) {
        const r = rows[i];
        if (r.h > h) h = r.h;
        if (r.l < l) l = r.l;
        v += r.v;
      }
      return { o: first.o, h, l, c: rows[to].c, v };
    });
  }
  // ── calendar units (W / 2W / 1M / 3M) ─ unchanged ──────────────────────────────────────
  // A calendar bucket has no phase to get wrong and its key is its LAST session; every
  // consumer (lib/barSnap, lib/pine-engine/runtime, TechnicalsPage) is written to that.
  const out: SessionOhlcBar[] = []; let cur: SessionOhlcBar | null = null; let key: any = null;
  const isoWeek = (d: string) => { const dt = new Date(d + "T00:00:00Z"); const day = (dt.getUTCDay() + 6) % 7; dt.setUTCDate(dt.getUTCDate() - day); return dt.toISOString().slice(0, 10); };
  // 2W / 3M use ABSOLUTE-calendar bucketing (anchored to a fixed epoch, not the data's first bar), so
  // buckets are stable across a month/quarter boundary regardless of where the window starts:
  //   2W → floor(days-since-epoch of the bar's ISO-week-start / 14)   (fixed fortnight blocks)
  //   3M → year + calendar quarter (Q0=Jan-Mar … Q3=Oct-Dec)
  const biWeek = (d: string) => { const dt = new Date(isoWeek(d) + "T00:00:00Z"); return Math.floor(dt.getTime() / 86400_000 / 14); };
  const quarter = (d: string) => { const y = d.slice(0, 4); const m = +d.slice(5, 7) - 1; return `${y}-Q${Math.floor(m / 3)}`; };
  // The daily-derived set is exactly {D, 2D, 3D, W, 2W, 1M, 3M} (TerminalShell.DAILY_FUNCTIONAL);
  // D and the two daily multiples returned above, so only calendar units reach here. An
  // unrecognised unit keys per row — one bar in, one bar out — rather than silently falling into
  // a 3-row bucket, which is what the old trailing `Math.floor(i / 3)` default did.
  for (let i = 0; i < rows.length; i++) { const r = rows[i]; const k = tf === "W" ? isoWeek(r.time) : tf === "2W" ? biWeek(r.time) : tf === "1M" ? r.time.slice(0, 7) : tf === "3M" ? quarter(r.time) : r.time; if (k !== key) { if (cur) out.push(cur); key = k; cur = { ...r }; } else { cur!.h = Math.max(cur!.h, r.h); cur!.l = Math.min(cur!.l, r.l); cur!.c = r.c; cur!.time = r.time; cur!.v += r.v; } }
  if (cur) out.push(cur); return out;
}
