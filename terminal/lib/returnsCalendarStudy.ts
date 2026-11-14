import type { Bar6 } from "./intradayShared";
import { buildReturnsCalendarSessions, previousCalendarDate, type SessionRange } from "./returnsCalendar";

export type ReturnsStudy = {
  ok: boolean;
  sessions: SessionRange[];
  overnightStatus: "partial" | "empty" | "not_configured" | "unavailable" | "closed";
  daytimeStatus: "available" | "empty" | "partial" | "unavailable" | "pending" | "closed";
  regularWindowAvailable: boolean;
};
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export function unavailableReturnsStudy(): ReturnsStudy {
  return { ok: false, sessions: buildReturnsCalendarSessions([], [], null, null),
    overnightStatus: "unavailable", daytimeStatus: "unavailable", regularWindowAvailable: false };
}

function validBar(value: unknown): value is Bar6 {
  if (!Array.isArray(value) || value.length !== 6 || !value.every(finite)) return false;
  const [time, open, high, low, close, volume] = value;
  return Number.isSafeInteger(time) && time > 0 && time % 1800 === 0
    && open > 0 && high > 0 && low > 0 && close > 0 && volume >= 0
    && high >= Math.max(open, close) && low <= Math.min(open, close) && high >= low;
}

/** Consume the existing 24H owner. Transport success is not identity or coverage success. */
export function parseReturnsStudy(value: unknown, symbol: string, date: string): ReturnsStudy {
  if (!object(value) || value.t !== symbol || value.tf !== "30m" || value.session_date !== date
      || !Array.isArray(value.bars) || !object(value.source_evidence)) return unavailableReturnsStudy();
  const evidence = value.source_evidence;
  const scope = evidence.response_scope;
  if (evidence.schema !== "terminal.intraday_source_evidence.v1"
      || evidence.authority !== "descriptive_only" || evidence.symbol !== symbol
      || evidence.requested_timeframe !== "30m" || evidence.session !== "24h"
      || evidence.timestamp_basis !== "market_local_display_epoch" || !object(scope)
      || scope.requested_date !== date || scope.returned_bars !== value.bars.length) {
    return unavailableReturnsStudy();
  }
  const day = Date.parse(date + "T00:00:00Z") / 1000;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(day)
      || new Date(day * 1000).toISOString().slice(0, 10) !== date) return unavailableReturnsStudy();
  const study = object(value.session_study_evidence) ? value.session_study_evidence : null;
  const knownStudy = study?.source === "canonical-daytime";
  if (value.regular_session_window === null && knownStudy && study?.status === "closed" && !value.bars.length) {
    return { ok: true, sessions: buildReturnsCalendarSessions([], [], null, null),
      overnightStatus: "closed", daytimeStatus: "closed", regularWindowAvailable: true };
  }
  const window = object(value.regular_session_window) ? value.regular_session_window : null;
  const start = window?.start_minute, end = window?.end_minute, postEnd = window?.post_end_minute;
  const validWindow = finite(start) && finite(end) && finite(postEnd)
    && Number.isInteger(start) && Number.isInteger(end) && Number.isInteger(postEnd)
    && start >= 240 && end > start && postEnd > end && postEnd <= 1200
    && start % 30 === 0 && end % 30 === 0 && postEnd % 30 === 0;
  const prior = previousCalendarDate(date);
  const observations = new Map<number, Bar6>(), conflicts = new Set<number>();
  let daytimeInvalid = false;
  const reject = (raw: unknown) => {
    const epoch = Array.isArray(raw) ? raw[0] : null;
    // A clearly overnight failure belongs to that leg. Unplaceable rows remain
    // conservative because they could be missing daytime observations.
    if (!finite(epoch) || epoch < day - 4 * 3600 || epoch >= day + 4 * 3600) daytimeInvalid = true;
  };
  for (const raw of value.bars) {
    if (!validBar(raw)) { reject(raw); continue; }
    const stamp = new Date(raw[0] * 1000);
    if (!Number.isFinite(stamp.valueOf())) { reject(raw); continue; }
    const wall = stamp.toISOString().slice(0, 10), minute = stamp.getUTCHours() * 60 + stamp.getUTCMinutes();
    if (!((wall === prior && minute >= 1200) || (wall === date && minute < (validWindow ? postEnd : 240)))) {
      reject(raw); continue;
    }
    const seen = observations.get(raw[0]);
    if (seen && seen.some((n, i) => n !== raw[i])) { conflicts.add(raw[0]); reject(raw); }
    else observations.set(raw[0], raw);
  }
  const bars = [...observations.values()].filter(bar => !conflicts.has(bar[0])).sort((a, b) => a[0] - b[0]);
  const current = bars.filter(bar => bar[0] >= day);
  const previous = bars.filter(bar => bar[0] < day);
  const sessions = buildReturnsCalendarSessions(current, previous,
    validWindow ? [start, end] : null, validWindow ? postEnd : null);
  const overnight = sessions.find(session => session.key === "overnight")!;
  const boats = object(value.boats_history) ? value.boats_history : null;
  const knownBoats = boats?.schema === "terminal.tiingo_boats_history_evidence.v1"
    && boats.source === "tiingo-boats-rest" && boats.venue === "BOATS"
    && boats.requested_symbol === symbol.toUpperCase()
    && boats.complete === false && boats.coverage === "captured_vendor_bars_only"
    && boats.price_basis === "vendor_reported_unqualified";
  // The current owner never certifies a full night or compatible price adjustment.
  // Keep observed O/H/L/C/count, including zero movement; never relabel it a full-night return.
  overnight.ret = null;
  const overnightStatus: ReturnsStudy["overnightStatus"] = overnight.barCount ? "partial"
    : knownBoats && boats?.status === "empty" ? "empty"
      : knownBoats && boats?.status === "disabled" ? "not_configured" : "unavailable";
  const daytimeCount = sessions.filter(session => session.key !== "overnight").reduce((n, session) => n + session.barCount, 0);
  const consistentDaytime = knownStudy && study?.bars === daytimeCount
    && (study?.status === "available" ? daytimeCount > 0 : study?.status === "empty" && daytimeCount === 0);
  const daytimeStatus: ReturnsStudy["daytimeStatus"] = !validWindow ? "unavailable"
    : knownStudy && study?.status === "pending" ? "pending"
      : daytimeInvalid || !consistentDaytime
        ? daytimeCount ? "partial" : "unavailable"
        : daytimeCount ? "available" : "empty";
  if (daytimeStatus !== "available") {
    for (const session of sessions) if (session.key !== "overnight") session.ret = null;
  }
  return { ok: true, sessions, overnightStatus, daytimeStatus, regularWindowAvailable: validWindow };
}
