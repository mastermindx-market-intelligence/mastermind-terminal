// Engine time facts — the six separable meanings of "a bar's time" (T01) plus the
// future-anchor grid derived from them (T03).
//
// The masterplan's time law is that these facts are NEVER conflated:
//   key              the bar's identity, the x key handed to the renderer
//   openUtcMs        the true UTC instant the bar opened at
//   closeUtcMs       when the bar's complete values became (or become) available
//   displayEpochSec  the legacy display-epoch coordinate the time axis shows
//   sessionId        the trading session the bar belongs to
//   cadenceSec       bar duration (0 for business-day keys)
//   isSynthetic      future/whitespace slot vs a real bar
// `time` is the OPENING bar and `closeTime` is availability — the canonical-3d-bar
// identity law from lib/sessionBars.ts, restated here so no consumer has to reach
// two modules deep to check it.
//
// Pure module: no fs, no network, no renderer imports. The display conversion is
// applied exactly once, by the existing owner (liveDisplayEpoch in lib/liveCandle.ts);
// this module never re-derives a display shift of its own.

import type { EngineBusinessDay, EngineTime } from "@/lib/chart-engine/api";
import { FUTURE_ANCHOR_BARS, futureBarTimes, type FutureCadence } from "@/lib/chart-engine/futureTime";
import type { Market } from "@/lib/intradayShared";
import { liveDisplayEpoch } from "@/lib/liveCandle";

/** A normalized, validated bar identity. Number = unix SECONDS; string = "YYYY-MM-DD". */
export type BarKey = EngineTime & { readonly __brand: "BarKey" };

/** The six time facts of one bar, as a frozen record (T01-A04). */
export interface BarTimeFacts {
  /** Opening-bar identity used as the x key (never a close/availability stamp). */
  readonly key: BarKey;
  /** True UTC epoch ms of the bar's opening instant. */
  readonly openUtcMs: number;
  /**
   * Availability: the earliest instant at which the bar's complete values are
   * knowable. For epoch keys this is open + cadence; for canonical daily-multiple
   * bars only the caller knows the closing session, so `closeTime` on the input
   * row wins when present (sessionBars.ts: `time` is identity, `closeTime` is
   * availability — collapsing the two is a correctness bug in either direction).
   */
  readonly closeUtcMs: number;
  /**
   * What the axis shows: the exchange-local wall clock of `openUtcMs` read as UTC
   * (the app's display-epoch convention), via liveDisplayEpoch — applied once,
   * here. Business-day keys have no intraday instant, so their canonical instant
   * (UTC noon, the same convention futureTime.ts uses for date strings) is shifted
   * through the same single conversion rather than a second rule.
   */
  readonly displayEpochSec: number;
  /** Trading session the bar belongs to: the market-local calendar date of the open ("2026-10-09"). Crypto sessions are UTC days. */
  readonly sessionId: string;
  /** Bar duration in seconds. 0 for business-day keys. */
  readonly cadenceSec: number;
  /** True for future/whitespace slots, false for real bars. */
  readonly isSynthetic: boolean;
}

/** A row as fact-extraction sees it: a validated key plus the optional availability stamp. */
export type BarTimeRow = {
  time: EngineTime;
  /** Canonical daily-multiple producers stamp the closing session here. */
  closeTime?: EngineTime;
  /** Whitespace rows may flag themselves; real bars default to false. */
  isSynthetic?: boolean;
};

/** The two kinds a key list may uniformly have. */
export type TimeKeyKind = "epochSec" | "businessDay";

/** Result of validateTimeKeys: either a uniform, increasing list or the FIRST offender. */
export type TimeKeyValidation =
  | { ok: true; kind: TimeKeyKind }
  | { ok: false; reason: string; index: number };

/** One way a refresh tried to re-anchor a session it had already published (T01-A02). */
export interface AnchorViolation {
  readonly key: BarKey;
  readonly field: "sessionId" | "openUtcMs" | "closeUtcMs";
  readonly previous: number | string;
  readonly next: number | string;
}

/**
 * Inclusive ceiling for numeric bar keys in unix seconds (year ~5138).
 * Values above this are millisecond leaks, not seconds. Shared with
 * canvas/model.ts `timeToMs` so both sides use one epoch-basis constant.
 */
export const EPOCH_SECONDS_MAX = 1e11;

function isoDateUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Calendar-real check: rejects 2026-02-30, month 13, day 0, … via a Date round-trip. */
function isRealDate(year: number, month: number, day: number): boolean {
  const utc = Date.UTC(year, month - 1, day);
  const dt = new Date(utc);
  return dt.getUTCFullYear() === year && dt.getUTCMonth() === month - 1 && dt.getUTCDate() === day;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function businessDayString(b: EngineBusinessDay): string | null {
  if (typeof b !== "object" || b === null) return null;
  const { year, month, day } = b;
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (!isRealDate(year, month, day)) return null;
  return `${String(year).padStart(4, "0")}-${pad2(month)}-${pad2(day)}`;
}

/**
 * Normalize any EngineTime to a BarKey, or null when the value is ambiguous:
 * fractional seconds, NaN/±Infinity, millisecond epochs (> 1e11), malformed or
 * calendar-impossible dates, digit-only strings, objects missing fields. A
 * {year,month,day} business day collapses to its "YYYY-MM-DD" string so equal
 * keys of both spellings compare equal downstream.
 */
export function toBarKey(time: EngineTime): BarKey | null {
  if (typeof time === "number") {
    if (!Number.isFinite(time)) return null;
    if (!Number.isInteger(time)) return null;
    if (time > EPOCH_SECONDS_MAX) return null;
    return time as BarKey;
  }
  if (typeof time === "string") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(time)) return null;
    if (!isRealDate(+time.slice(0, 4), +time.slice(5, 7), +time.slice(8, 10))) return null;
    return time as BarKey;
  }
  const iso = businessDayString(time as EngineBusinessDay);
  return iso === null ? null : (iso as BarKey);
}

/** The canonical true-UTC instant of a key: seconds for epoch keys, UTC noon for dates. */
function keyOpenUtcMs(key: BarKey): number {
  if (typeof key === "number") return key * 1000;
  return Date.parse(`${key}T12:00:00Z`);
}

/** Lexical order IS chronological order for "YYYY-MM-DD"; numbers compare numerically. */
function compareKeys(a: BarKey, b: BarKey): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function describeKind(key: BarKey): TimeKeyKind {
  return typeof key === "number" ? "epochSec" : "businessDay";
}

/**
 * Reject ambiguous key lists up front (T01-A01). Every defect below is reported at
 * the FIRST offending index: unparsable values (ms-epoch leaks, fractional
 * seconds, NaN, bad strings/objects), mixed epoch/business-day kinds, and
 * non-increasing keys — both duplicates and reversals. An empty list has nothing
 * to disagree about and validates as the vacuous epochSec default.
 */
export function validateTimeKeys(
  rows: readonly { time: EngineTime }[],
): TimeKeyValidation {
  let kind: TimeKeyKind | null = null;
  let prev: BarKey | null = null;
  for (let i = 0; i < rows.length; i++) {
    const time = rows[i]?.time;
    if (time == null) {
      return { ok: false, reason: `time is missing (${String(time)})`, index: i };
    }
    if (typeof time === "number") {
      if (!Number.isFinite(time)) {
        return { ok: false, reason: `time is not a finite number (${String(time)})`, index: i };
      }
      if (!Number.isInteger(time)) {
        return { ok: false, reason: `fractional seconds (${time}); engine epoch keys are integer unix seconds`, index: i };
      }
      if (time > EPOCH_SECONDS_MAX) {
        return { ok: false, reason: `millisecond epoch leak (${time}); engine epoch keys are unix seconds`, index: i };
      }
    } else if (typeof time === "string") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(time) || !isRealDate(+time.slice(0, 4), +time.slice(5, 7), +time.slice(8, 10))) {
        return { ok: false, reason: `malformed business-day string (${JSON.stringify(time)})`, index: i };
      }
    } else if (businessDayString(time as EngineBusinessDay) === null) {
      return { ok: false, reason: "malformed business-day object", index: i };
    }

    const key = toBarKey(time);
    if (key === null) return { ok: false, reason: "unparsable time", index: i };

    const rowKind = describeKind(key);
    if (kind === null) kind = rowKind;
    else if (rowKind !== kind) {
      return { ok: false, reason: `mixed time kinds (row 0 is ${kind}, row ${i} is ${rowKind})`, index: i };
    }

    if (prev !== null) {
      const cmp = compareKeys(key, prev);
      if (cmp === 0) return { ok: false, reason: "duplicate time key", index: i };
      if (cmp < 0) return { ok: false, reason: "time key decreases (non-increasing order)", index: i };
    }
    prev = key;
  }
  return { ok: true, kind: kind ?? "epochSec" };
}

/** Build the frozen facts record; the one place display shifting is applied. */
function freezeFacts(
  key: BarKey,
  openUtcMs: number,
  closeUtcMs: number,
  market: Market,
  cadenceSec: number,
  isSynthetic: boolean,
): BarTimeFacts {
  const displayEpochSec = liveDisplayEpoch(openUtcMs, market) ?? Math.floor(openUtcMs / 1000);
  const sessionId = typeof key === "number" ? isoDateUtc(displayEpochSec * 1000) : (key as string);
  return Object.freeze({
    key,
    openUtcMs,
    closeUtcMs,
    displayEpochSec,
    sessionId,
    cadenceSec,
    isSynthetic,
  });
}

/**
 * Extract the six time facts of one row (T01-A03: displayEpochSec IS
 * liveDisplayEpoch(openUtcMs, market) for every market). Numeric keys are read as
 * true UTC epoch seconds; business-day keys canonicalize to UTC noon of the
 * session date, and their sessionId is the key itself. Returns null for a key
 * toBarKey rejects — validate first, then extract.
 */
export function barTimeFacts(row: BarTimeRow, market: Market, cadenceSec: number): BarTimeFacts | null {
  const key = toBarKey(row.time);
  if (key === null) return null;
  const openUtcMs = keyOpenUtcMs(key);
  const span = Number.isFinite(cadenceSec) ? Math.max(0, cadenceSec) : 0;

  // Availability: an explicit closeTime wins (canonical daily-multiple law);
  // otherwise a bar is knowable one cadence after it opens. A business-day key
  // with no closeTime closes on its own session (span 0); daily-multiple
  // consumers MUST pass closeTime — that is the whole point of the law.
  const closeKey = row.closeTime === undefined ? null : toBarKey(row.closeTime);
  const closeUtcMs = closeKey !== null ? keyOpenUtcMs(closeKey) : openUtcMs + span * 1000;

  return freezeFacts(key, openUtcMs, closeUtcMs, market, span, row.isSynthetic === true);
}

/**
 * T01-A02: a refresh must never silently re-anchor a session. For every key
 * present in both lists, sessionId, openUtcMs and closeUtcMs must be identical;
 * anything else is returned as a violation. Keys only in `previous` were dropped
 * and keys only in `next` are new — normal refresh behaviour, not violations.
 */
export function preserveSessionAnchors(
  previous: readonly BarTimeFacts[],
  next: readonly BarTimeFacts[],
): readonly AnchorViolation[] {
  const nextByKey = new Map<BarKey, BarTimeFacts>();
  for (const facts of next) nextByKey.set(facts.key, facts);

  const violations: AnchorViolation[] = [];
  for (const before of previous) {
    const after = nextByKey.get(before.key);
    if (!after) continue;
    if (before.sessionId !== after.sessionId) {
      violations.push({ key: before.key, field: "sessionId", previous: before.sessionId, next: after.sessionId });
    }
    if (before.openUtcMs !== after.openUtcMs) {
      violations.push({ key: before.key, field: "openUtcMs", previous: before.openUtcMs, next: after.openUtcMs });
    }
    if (before.closeUtcMs !== after.closeUtcMs) {
      violations.push({ key: before.key, field: "closeUtcMs", previous: before.closeUtcMs, next: after.closeUtcMs });
    }
  }
  return Object.freeze(violations);
}

/**
 * T03: continue the grid past the newest bar. Keys come from futureBarTimes()
 * over a synthesized two-sample tail (origin − step, origin), so the generated
 * slots are exactly what futureBarTimes itself would produce for the series:
 * intraday keys continue in epoch seconds, business-day keys advance trading
 * dates and skip weekends on a true daily cadence (T03-A03).
 *
 * Laws:
 *   T03-A01 slot stability — slot i's key depends only on the anchor and the
 *     cadence, never on `count`; the same wall-clock future instant resolves to
 *     the same slot index however many anchors are generated.
 *   T03-A02 cadence determinism — slots re-derive from the anchor's own key/
 *     openUtcMs on every call. `cadence.lastMs` is informational and deliberately
 *     unused: a cadence measured against a different tail cannot re-anchor the
 *     grid, and repeated/chained generation never accumulates drift.
 *
 * Synthetic facts carry the same six fields as real ones (display shift applied
 * once, session ids per market), flagged isSynthetic so consumers can tell a
 * drawing-coordinate slot from a bar that exists.
 */
export function futureAnchors(
  lastFacts: BarTimeFacts,
  market: Market,
  cadence: FutureCadence | null,
  count: number = FUTURE_ANCHOR_BARS,
): readonly BarTimeFacts[] {
  const stepMs = cadence?.stepMs ?? Number.NaN; // Number.isFinite is not a type guard; NaN routes to the reject below
  if (!Number.isFinite(stepMs) || stepMs <= 0) return [];
  const slots = Math.max(0, Math.floor(count));
  if (slots === 0) return [];

  const numeric = typeof lastFacts.key === "number";
  const originMs = keyOpenUtcMs(lastFacts.key); // the anchor of record, not cadence.lastMs
  const tail: (string | number)[] = numeric
    ? [Math.round((originMs - stepMs) / 1000), Math.round(originMs / 1000)]
    : [isoDateUtc(originMs - stepMs), isoDateUtc(originMs)];

  const out: BarTimeFacts[] = [];
  for (const key of futureBarTimes(tail, slots)) {
    const barKey = toBarKey(key);
    if (barKey === null) break; // futureBarTimes only emits values toBarKey accepts; guard anyway
    const openUtcMs = keyOpenUtcMs(barKey);
    // Same availability rule as barTimeFacts: an epoch slot is knowable one cadence
    // after it opens; a business-day slot has no producer closeTime and closes on
    // its own session.
    const spanSec = numeric ? stepMs / 1000 : 0;
    const closeUtcMs = numeric ? openUtcMs + stepMs : openUtcMs;
    out.push(freezeFacts(barKey, openUtcMs, closeUtcMs, market, spanSec, true));
  }
  return Object.freeze(out);
}
