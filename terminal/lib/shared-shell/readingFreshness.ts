/**
 * readingFreshness.ts — how old a published reading is, in US trading sessions.
 *
 * The Today strip shows each source's own date. A date alone does not say whether the
 * reading is the latest one available, so every reading also gets an age:
 *
 *   current  — no completed session is missing since the reading (a Friday close viewed on
 *              Sunday, or a reading dated today)
 *   behind   — one session is missing
 *   stale    — two or more sessions are missing. The count comes from the exchange calendar,
 *              so an exchange holiday no longer makes a reading look one session older than
 *              it is.
 *   ahead    — the reading is dated more than one day after today. That is a producer clock
 *              or data error, so the reader is told to check the source, never "latest".
 *   undated  — the source gave no date we can read. It is never treated as current.
 *   unavailable — the source date or today sits outside the bundled session projection's
 *              coverage (2016–2028), so no honest session count exists. The calendar age is
 *              still reported when both calendar dates are knowable.
 *
 * Sessions are counted by the immutable exchange projection in usEquitySessionClock: every
 * session strictly after the reading's date and before today, plus today itself once the
 * current minute has reached its projected close (16:00, or earlier on a shortened day such
 * as the Friday after Thanksgiving). Before that close today's session may still be open, so
 * it is not yet missing. A reading dated one day ahead (a producer writing in a later time
 * zone) is current.
 */

import { usCompletedSessionsAfterDate } from "../usEquitySessionClock";

export type FreshnessKind = "current" | "behind" | "stale" | "ahead" | "undated" | "unavailable";
export type Freshness =
  | { kind: Exclude<FreshnessKind, "unavailable">; sessions: number; days: number }
  | { kind: "unavailable"; sessions: null; days: number | null };

// formatToParts, not format: the joined shape of a formatted date depends on the ICU build.
const NY_CLOCK = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
const DAY_MS = 86_400_000;
const DAY_SECONDS = 86_400;

function nyClock(now: Date): { date: string; minute: number } {
  const parts = NY_CLOCK.formatToParts(now);
  const part = (type: string) => parts.find(p => p.type === type)?.value ?? "";
  return { date: `${part("year")}-${part("month")}-${part("day")}`, minute: Number(part("hour")) * 60 + Number(part("minute")) };
}

/** Today's date on the New York calendar, as YYYY-MM-DD. */
export function nyMarketDate(now: Date): string {
  return nyClock(now).date;
}

function utcDay(date: string): number | null {
  if (!/^(\d{4})-(\d{2})-(\d{2})$/.test(date) || date.startsWith("0000-")) return null;
  const instant = new Date(`${date}T00:00:00Z`);
  // Reject 2026-02-30 and similar: Date silently rolls them into the next month. Parsing the
  // string (not Date.UTC) also keeps years below 100 literal, where Date.UTC maps 0001 to 1901.
  return Number.isFinite(instant.valueOf()) && instant.toISOString().slice(0, 10) === date
    ? instant.valueOf() / DAY_MS : null;
}

/** The reading's New York calendar date, or null when it has none we can trust. A timestamp
 *  with a zone is converted to New York; one without a zone keeps its own date. */
export function readingDate(asOf: unknown): string | null {
  if (typeof asOf !== "string") return null;
  const value = asOf.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return utcDay(value) === null ? null : value;
  const stamp = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(value);
  if (!stamp) return null;
  if (utcDay(stamp[1]) === null) return null;
  if (!stamp[3]) return stamp[1];
  const t = Date.parse(value);
  return Number.isFinite(t) ? nyMarketDate(new Date(t)) : null;
}

export function readingFreshness(asOf: unknown, now: Date): Freshness {
  const date = readingDate(asOf);
  const from = date === null ? null : utcDay(date);
  if (from === null || date === null) return { kind: "undated", sessions: 0, days: 0 };
  if (!Number.isFinite(now.valueOf())) return { kind: "unavailable", sessions: null, days: null };
  const clock = nyClock(now);
  const to = utcDay(clock.date);
  if (to === null) return { kind: "unavailable", sessions: null, days: null };
  const days = to - from;
  // A known future-date error does not require knowledge of exchange sessions.
  if (from > to + 1) return { kind: "ahead", sessions: 0, days };
  try {
    // ET wall-clock as a display epoch, not a true UTC instant. This also validates
    // same-day/one-day-ahead readings against the calendar's actual coverage.
    const sessions = usCompletedSessionsAfterDate(date, to * DAY_SECONDS + clock.minute * 60);
    return { kind: sessions === 0 ? "current" : sessions === 1 ? "behind" : "stale", sessions, days: Math.max(0, days) };
  } catch {
    // Calendar dates remain knowable outside session coverage; only session age is unknown.
    return { kind: "unavailable", sessions: null, days: Math.max(0, days) };
  }
}

/** The age as a short label. Each kind has its own wording, so colour is never the only cue. */
export function freshnessLabel(freshness: Freshness, lang: "en" | "zh"): string {
  const n = freshness.sessions;
  if (lang === "zh") {
    if (freshness.kind === "current") return "最新交易日";
    if (freshness.kind === "behind") return "落后 1 个交易日";
    if (freshness.kind === "stale") return `已落后 ${n} 个交易日，请核对来源`;
    if (freshness.kind === "ahead") return "日期晚于今天，请核对来源";
    if (freshness.kind === "unavailable") return "交易日时效不可用";
    return "日期不可用";
  }
  if (freshness.kind === "current") return "Latest session";
  if (freshness.kind === "behind") return "1 session old";
  if (freshness.kind === "stale") return `${n} sessions old — check source`;
  if (freshness.kind === "ahead") return "Dated after today — check source";
  if (freshness.kind === "unavailable") return "Session age unavailable";
  return "Date unavailable";
}

/** Calendar age, for the sentence that sits beside a date ("16 days ago"). */
export function ageLabel(freshness: Freshness, lang: "en" | "zh"): string | null {
  if (freshness.kind === "undated" || freshness.kind === "ahead" || freshness.days === null) return null;
  const d = freshness.days;
  if (lang === "zh") return d === 0 ? "今天" : `${d} 天前`;
  return d === 0 ? "today" : d === 1 ? "1 day ago" : `${d} days ago`;
}
