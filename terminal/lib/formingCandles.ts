import { liveDisplayEpoch } from "./liveCandle";
import { isIntradayTf, isSecondTf, resample, filterUsEquitySession, resampleUsEquitySession, tfMinutes, tfSeconds, type Bar6, type UsEquitySession } from "./intradayShared";
import { usRegularSessionWindow } from "./usEquitySessionClock";

export type FormingBar = {
  time: number; o: number; h: number; l: number; c: number; v: number; complete: boolean;
};
export type FormingSnapshot = {
  version: 1; source: "polygon-live-second"; generation: string; generationStartedMs: number;
  revision: number; asOfMs: number; timeframes: string; series: Record<string, FormingBar[]>;
  day?: FormingBar;
};
type HubSnapshot = {
  version: 1; source: string; generation: string; generationStartedMs: number;
  revision: number; sessionDate: string; asOfMs: number; prefixThroughMs: number;
  streamFromMs: number; dirtyPrefix: boolean; minutes: Bar6[]; seconds: Bar6[];
};
const MINUTE = 60_000;
const sessions: UsEquitySession[] = ["regular", "extended", "24h"];
const stamp = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;

export function formingKey(session: UsEquitySession, tf: string): string { return session + ":" + tf; }

/** A closed vocabulary keeps the public chart request and its cache identity bounded. */
export function parseFormingTimeframes(raw: string | null): string[] | null {
  if (raw == null || raw === "") return [];
  const input = raw.split(",");
  if (input.length > 4 || input.some(tf => !isIntradayTf(tf))) return null;
  return [...new Set(input)].sort();
}

function rows(value: unknown, max: number, resolution: number): value is Bar6[] {
  if (!Array.isArray(value) || value.length > max) return false;
  let prev = -Infinity;
  for (const b of value) {
    if (!Array.isArray(b) || b.length !== 6 || !stamp(b[0]) || b[0] <= prev || b[0] % resolution ||
        !b.slice(1, 5).every(n => typeof n === "number" && Number.isFinite(n) && n > 0) ||
        !Number.isFinite(b[5]) || b[5] < 0 || b[2] < Math.max(b[1], b[4]) ||
        b[3] > Math.min(b[1], b[4]) || b[2] < b[3]) return false;
    prev = b[0];
  }
  return true;
}

function projectRows(input: Bar6[]): Bar6[] {
  return input.map(b => [liveDisplayEpoch(b[0], "us")!, b[1], b[2], b[3], b[4], b[5]]);
}

/**
 * The Hub keeps UTC components on localhost. Only the selected, resampled series
 * cross the public boundary. History and live snapshots use the SAME resampler.
 */
export function projectFormingSnapshot(value: unknown, timeframes: string[], nowMs: number): FormingSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const s = value as HubSnapshot;
  if (s.version !== 1 || s.source !== "polygon-live-second" || typeof s.generation !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(s.generation) || !stamp(s.generationStartedMs) ||
      !stamp(s.revision) || !stamp(s.asOfMs) || !stamp(s.prefixThroughMs) ||
      !stamp(s.streamFromMs) || s.asOfMs > nowMs + 5_000 || nowMs - s.asOfMs > 120_000 ||
      typeof s.dirtyPrefix !== "boolean" || !/^\d{4}-\d{2}-\d{2}$/.test(s.sessionDate) ||
      !rows(s.minutes, 1440, MINUTE) || !rows(s.seconds, 360, 1000)) return null;
  const minuteRows = projectRows(s.minutes);
  const secondRows = projectRows(s.seconds);
  if ([...minuteRows, ...secondRows].some(b => !Number.isFinite(b[0]) ||
      new Date(b[0] * 1000).toISOString().slice(0, 10) !== s.sessionDate)) return null;
  const streamMinute = Math.ceil(s.streamFromMs / MINUTE) * MINUTE;
  const joined = s.prefixThroughMs >= streamMinute && !s.dirtyPrefix;
  const liveStart = liveDisplayEpoch(streamMinute, "us")!;
  const secondStart = Math.max(liveDisplayEpoch(s.streamFromMs, "us")!, secondRows[0]?.[0] ?? Infinity);
  const series: Record<string, FormingBar[]> = {};
  try {
    for (const tf of timeframes) {
      if (!isIntradayTf(tf)) return null;
      const second = isSecondTf(tf);
      for (const session of sessions) {
        const input = second ? secondRows : minuteRows;
        const bars = second
          ? resample(filterUsEquitySession(input, session), tfMinutes(tf))
          : resampleUsEquitySession(input, tfMinutes(tf), session);
        series[formingKey(session, tf)] = bars.map(b => ({
          time: b[0], o: b[1], h: b[2], l: b[3], c: b[4], v: b[5],
          complete: second ? (tfSeconds(tf) === 1 || b[0] >= secondStart)
            : (joined || b[0] >= liveStart),
        }));
      }
    }
    // Daily and calendar-unit charts keep their established splice/fold path,
    // but may now take complete same-session OHLCV from this disjoint prefix.
    const regular = resampleUsEquitySession(minuteRows, 1, "regular");
    const first = regular[0], last = regular[regular.length - 1];
    const window = first ? usRegularSessionWindow(first[0]) : null;
    const day = first && last && window ? {
      time: Math.floor(first[0] / 86400) * 86400,
      o: first[1], h: Math.max(...regular.map(b => b[2])), l: Math.min(...regular.map(b => b[3])),
      c: last[4], v: regular.reduce((n, b) => n + b[5], 0), complete: joined,
    } : undefined;
    return { version: 1, source: "polygon-live-second", generation: s.generation,
      generationStartedMs: s.generationStartedMs, revision: s.revision, asOfMs: s.asOfMs,
      timeframes: timeframes.join(","), series, ...(day ? { day } : {}) };
  } catch (e) {
    if (e instanceof Error && e.message === "US_SESSION_CLOCK_UNAVAILABLE") return null;
    throw e;
  }
}

/** Quote lanes cannot erase a newer chart snapshot with an older/wide response. */
export function mergeFormingQuote(previous: Record<string, any> | undefined, incoming: Record<string, any>): Record<string, any> {
  if (!previous) return incoming;
  const old = previous.formingCandles as FormingSnapshot | undefined;
  const next = incoming.formingCandles as FormingSnapshot | undefined;
  if (!old || incoming.basis !== "REALTIME" || incoming.source !== old.source) return incoming;
  if (!next || next.generationStartedMs < old.generationStartedMs ||
      (next.generation === old.generation && next.revision < old.revision)) {
    const oldStamp = previous.asOfMs ?? (previous.ts ?? 0) * 1000;
    const newStamp = incoming.asOfMs ?? (incoming.ts ?? 0) * 1000;
    if (newStamp < oldStamp) return previous;
    return { ...incoming, formingCandles: old };
  }
  return incoming;
}
