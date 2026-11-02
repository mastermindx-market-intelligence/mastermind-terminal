/**
 * readingFreshness.ts — how old a published reading is, in US trading sessions.
 *
 * The Today strip shows each source's own date. A date alone does not say whether the
 * reading is the latest one available, so every reading also gets an age:
 *
 *   current  — no completed session is missing since the reading (a Friday close viewed on
 *              Sunday, or a reading dated today)
 *   behind   — one weekday session is missing
 *   stale    — two or more weekday sessions are missing. Before today's close the two-session
 *              threshold absorbs a single exchange holiday without a holiday calendar. After
 *              the close today's session is counted too, which uses up that allowance, so in a
 *              holiday week a reading can show "stale" one session early. The error is always
 *              toward "check source", never toward "current".
 *   ahead    — the reading is dated more than one day after today. That is a producer clock
 *              or data error, so the reader is told to check the source, never "latest".
 *   undated  — the source gave no date we can read. It is never treated as current.
 *
 * Sessions are counted on the New York calendar: the weekdays after the reading's date and
 * before today, plus today itself once it is a weekday at or after the 16:00 close. Before the
 * close today's session may still be open, so it is not yet missing. A reading dated one day
 * ahead (a producer writing in a later time zone) is current.
 */

export type FreshnessKind = "current" | "behind" | "stale" | "ahead" | "undated";
export type Freshness = { kind: FreshnessKind; sessions: number; days: number };

// formatToParts, not format: the joined shape of a formatted date depends on the ICU build.
const NY_CLOCK = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
const DAY_MS = 86_400_000;
const CLOSE_MINUTE = 16 * 60;

function nyClock(now: Date): { date: string; minute: number } {
  const part = (type: string) => NY_CLOCK.formatToParts(now).find(p => p.type === type)?.value ?? "";
  return { date: `${part("year")}-${part("month")}-${part("day")}`, minute: Number(part("hour")) * 60 + Number(part("minute")) };
}

/** Today's date on the New York calendar, as YYYY-MM-DD. */
export function nyMarketDate(now: Date): string {
  return nyClock(now).date;
}

function utcDay(date: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const t = Date.UTC(y, m - 1, d);
  const back = new Date(t);
  // Reject 2026-02-30 and similar: Date.UTC silently rolls them into the next month.
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) return null;
  return t / DAY_MS;
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
  const clock = nyClock(now);
  const to = utcDay(clock.date);
  if (from === null || to === null) return { kind: "undated", sessions: 0, days: 0 };
  if (from > to + 1) return { kind: "ahead", sessions: 0, days: to - from };
  if (from >= to) return { kind: "current", sessions: 0, days: 0 };
  const weekday = (day: number) => { const w = new Date(day * DAY_MS).getUTCDay(); return w !== 0 && w !== 6; };
  let sessions = 0;
  for (let day = from + 1; day < to; day++) if (weekday(day)) sessions++;
  if (weekday(to) && clock.minute >= CLOSE_MINUTE) sessions++;
  const days = to - from;
  return { kind: sessions === 0 ? "current" : sessions === 1 ? "behind" : "stale", sessions, days };
}

/** The age as a short label. Each kind has its own wording, so colour is never the only cue. */
export function freshnessLabel(freshness: Freshness, lang: "en" | "zh"): string {
  const n = freshness.sessions;
  if (lang === "zh") {
    if (freshness.kind === "current") return "最新交易日";
    if (freshness.kind === "behind") return "落后 1 个交易日";
    if (freshness.kind === "stale") return `已落后 ${n} 个交易日，请核对来源`;
    if (freshness.kind === "ahead") return "日期晚于今天，请核对来源";
    return "日期不可用";
  }
  if (freshness.kind === "current") return "Latest session";
  if (freshness.kind === "behind") return "1 session old";
  if (freshness.kind === "stale") return `${n} sessions old — check source`;
  if (freshness.kind === "ahead") return "Dated after today — check source";
  return "Date unavailable";
}

/** Calendar age, for the sentence that sits beside a date ("16 days ago"). */
export function ageLabel(freshness: Freshness, lang: "en" | "zh"): string | null {
  if (freshness.kind === "undated" || freshness.kind === "ahead") return null;
  const d = freshness.days;
  if (lang === "zh") return d === 0 ? "今天" : `${d} 天前`;
  return d === 0 ? "today" : d === 1 ? "1 day ago" : `${d} days ago`;
}
