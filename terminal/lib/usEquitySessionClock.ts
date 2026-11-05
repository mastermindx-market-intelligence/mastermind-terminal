// Immutable projection of Macro's existing NYSE/session-window owners.
// No calendar arithmetic, filesystem, network, or second session authority.
import bundledProjection from "./usEquitySessionProjection.json";

type Window = readonly [number, number];
type Projection = {
  coverage: { start: string; end: string };
  sessions: Record<string, Window>;
};
const ERROR = "US_SESSION_CLOCK_UNAVAILABLE";
const DAY_MS = 86_400_000;
const DAY_SECONDS = 86_400;
const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const validDate = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-")) return false;
  const instant = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(instant.valueOf()) && instant.toISOString().slice(0, 10) === value;
};

function validate(value: unknown): Projection | null {
  if (!record(value) || value.schema !== "mastermind.us_equity_session_projection.v1" ||
      value.timezone !== "America/New_York" || !record(value.source) ||
      value.source.repository !== "mastermindx-market-intelligence/macro" ||
      typeof value.source.revision !== "string" || !/^[0-9a-f]{40}$/.test(value.source.revision) ||
      !record(value.coverage) || !validDate(value.coverage.start) ||
      !validDate(value.coverage.end) || value.coverage.start > value.coverage.end ||
      !record(value.sessions)) return null;
  const sessions: Record<string, Window> = Object.create(null);
  const expectedFiles = ["lib/__init__.py", "lib/nyse_calendar.py", "engine/__init__.py", "engine/session_digest.py"];
  const files = value.source.files;
  if (!record(files) || expectedFiles.some(name =>
    typeof files[name] !== "string" || !/^[0-9a-f]{64}$/.test(files[name]))) return null;
  const rows = Object.entries(value.sessions);
  if (!rows.length || rows.length > 6000) return null;
  for (const [day, window] of rows) {
    if (!validDate(day) || day < value.coverage.start || day > value.coverage.end ||
        !Array.isArray(window) || window.length !== 2 ||
        !window.every(n => Number.isSafeInteger(n)) ||
        window[0] < 0 || window[0] >= window[1] || window[1] > 1440) return null;
    sessions[day] = Object.freeze([window[0], window[1]]) as Window;
  }
  return { coverage: { start: value.coverage.start, end: value.coverage.end },
    sessions: Object.freeze(sessions) };
}
const projection = validate(bundledProjection);

/** Input is ET wall-clock expressed as a display epoch, NOT a true UTC instant. */
export function usRegularSessionWindow(displayEpochSeconds: number): Window | null {
  if (!projection || !Number.isFinite(displayEpochSeconds)) throw new Error(ERROR);
  const instant = new Date(displayEpochSeconds * 1000);
  if (!Number.isFinite(instant.valueOf())) throw new Error(ERROR);
  const day = instant.toISOString().slice(0, 10);
  if (day < projection.coverage.start || day > projection.coverage.end) throw new Error(ERROR);
  return projection.sessions[day] ?? null;
}

/** Session days as UTC day numbers, ascending; built once from the validated projection. */
const SESSION_DAYS: readonly number[] = projection
  ? Object.keys(projection.sessions).sort().map(day => new Date(`${day}T00:00:00Z`).valueOf() / DAY_MS)
  : [];

/** First index in SESSION_DAYS whose day is at or after the given UTC day number. */
function firstSessionIndex(day: number): number {
  let low = 0;
  let high = SESSION_DAYS.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if ((SESSION_DAYS[mid] ?? Number.NEGATIVE_INFINITY) < day) low = mid + 1; else high = mid;
  }
  return low;
}

/** How many projected sessions completed strictly after the reading's date and at or before
 *  the current ET wall-clock moment. Today's session counts only once the current minute has
 *  reached its projected close (16:00, or 13:00 on a shortened day). Invalid or uncovered
 *  dates throw US_SESSION_CLOCK_UNAVAILABLE; a covered reading dated today or later simply
 *  has no completed session yet and returns 0. Input is ET wall-clock as a display epoch,
 *  NOT a true UTC instant. */
export function usCompletedSessionsAfterDate(readingDate: string, nowDisplayEpochSeconds: number): number {
  if (!projection || !validDate(readingDate) || !Number.isFinite(nowDisplayEpochSeconds)) throw new Error(ERROR);
  const now = new Date(nowDisplayEpochSeconds * 1000);
  if (!Number.isFinite(now.valueOf())) throw new Error(ERROR);
  const currentDay = now.toISOString().slice(0, 10);
  const { start, end } = projection.coverage;
  if (readingDate < start || readingDate > end || currentDay < start || currentDay > end) throw new Error(ERROR);
  if (readingDate >= currentDay) return 0;
  const dayNumber = (value: string) => new Date(`${value}T00:00:00Z`).valueOf() / DAY_MS;
  // Sessions strictly between the two dates, plus today once its projected close has passed.
  const between = firstSessionIndex(dayNumber(currentDay)) - firstSessionIndex(dayNumber(readingDate) + 1);
  const today = projection.sessions[currentDay];
  const minute = Math.floor((nowDisplayEpochSeconds - dayNumber(currentDay) * DAY_SECONDS) / 60);
  return today && minute >= today[1] ? between + 1 : between;
}
