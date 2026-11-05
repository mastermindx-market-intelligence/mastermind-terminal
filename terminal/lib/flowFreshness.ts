/**
 * Pure timing-contract helpers for the Macro live-flow producer.
 *
 * Timing is provenance for display only. Nothing in this module scores, ranks,
 * alerts, gates, or changes authority. In particular, the v1 fields named
 * `cadence_sec_target` / `cadence_sec_measured` are deliberately ignored: the
 * former is only a poll-floor configuration and the latter measured cycle work,
 * not observed start-to-start publication cadence.
 */

import { usRegularSessionWindow } from "./usEquitySessionClock";

export const LIVE_FLOW_META_V2 = "live_flow.meta/v2" as const;

export interface LiveFlowMetaTiming {
  schema: typeof LIVE_FLOW_META_V2;
  snapshotAt: string;
  cycleStartedAt: string;
  sourceResponseAtFirst: string;
  sourceResponseAtLast: string;
  observedCycleSec: number | null;
}

export interface LiveFlowFreshness {
  timing: LiveFlowMetaTiming;
  snapshotAgeMs: number;
  /** Youngest source receipt in the sweep (`source_response_at_last`). */
  sourceResponseAgeMinMs: number;
  /** Oldest source receipt in the sweep (`source_response_at_first`). */
  sourceResponseAgeMaxMs: number;
}

export type UsOptionsSessionState = "regular" | "last_session";

const SESSION_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function timestampMs(value: unknown): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Parse only the measured v2 timing contract. v1 and malformed/partial v2
 * payloads return null so consumers render "age unavailable" instead of
 * guessing from target cadence or a build clock.
 */
export function parseLiveFlowMetaTiming(value: unknown): LiveFlowMetaTiming | null {
  const raw = record(value);
  if (!raw || raw.schema !== LIVE_FLOW_META_V2) return null;

  const snapshotMs = timestampMs(raw.asof);
  const cycleStartedMs = timestampMs(raw.cycle_started_at);
  const sourceFirstMs = timestampMs(raw.source_response_at_first);
  const sourceLastMs = timestampMs(raw.source_response_at_last);
  if (
    snapshotMs === null ||
    cycleStartedMs === null ||
    sourceFirstMs === null ||
    sourceLastMs === null
  ) return null;

  // A clock receipt that runs backwards is not freshness evidence.
  if (!(cycleStartedMs <= sourceFirstMs && sourceFirstMs <= sourceLastMs && sourceLastMs <= snapshotMs)) {
    return null;
  }

  // Null is the honest first-cycle value. Missing, zero, negative, or non-finite
  // values are malformed rather than a reason to fall back to the poll floor.
  if (!("observed_start_to_start_sec" in raw)) return null;
  const observed = raw.observed_start_to_start_sec;
  if (observed !== null && (typeof observed !== "number" || !Number.isFinite(observed) || observed <= 0)) {
    return null;
  }

  return {
    schema: LIVE_FLOW_META_V2,
    snapshotAt: raw.asof as string,
    cycleStartedAt: raw.cycle_started_at as string,
    sourceResponseAtFirst: raw.source_response_at_first as string,
    sourceResponseAtLast: raw.source_response_at_last as string,
    observedCycleSec: observed as number | null,
  };
}

/** Compute clock ages at render time. Future-dated clocks fail closed. */
export function deriveLiveFlowFreshness(value: unknown, nowMs: number): LiveFlowFreshness | null {
  const timing = parseLiveFlowMetaTiming(value);
  if (!timing || !Number.isFinite(nowMs)) return null;

  const snapshotAgeMs = nowMs - Date.parse(timing.snapshotAt);
  const sourceResponseAgeMinMs = nowMs - Date.parse(timing.sourceResponseAtLast);
  const sourceResponseAgeMaxMs = nowMs - Date.parse(timing.sourceResponseAtFirst);
  if (snapshotAgeMs < 0 || sourceResponseAgeMinMs < 0 || sourceResponseAgeMaxMs < 0) return null;

  return {
    timing,
    snapshotAgeMs,
    sourceResponseAgeMinMs,
    sourceResponseAgeMaxMs,
  };
}

/**
 * The only source-freshness clock accepted for derived artifacts. `asof` may be
 * a recompute clock on old v1 enrich/chain publishers and `built_at` is expressly
 * build time, so neither is a fallback.
 */
export function artifactSourceAsof(value: unknown): string | null {
  const raw = record(value);
  if (!raw || timestampMs(raw.source_asof) === null) return null;
  return raw.source_asof as string;
}

export function artifactSourceAgeMs(value: unknown, nowMs: number): number | null {
  const sourceAsof = artifactSourceAsof(value);
  if (!sourceAsof || !Number.isFinite(nowMs)) return null;
  const age = nowMs - Date.parse(sourceAsof);
  return age >= 0 ? age : null;
}

/** Compact, whole-minute age display; no fixed producer-cadence claim. */
export function formatFlowAge(ageMs: number): string | null {
  if (!Number.isFinite(ageMs) || ageMs < 0) return null;
  if (ageMs < 60_000) return "<1m";
  const totalMinutes = Math.floor(ageMs / 60_000);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const totalHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (totalHours < 24) return minutes ? `${totalHours}h ${minutes}m` : `${totalHours}h`;
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return hours ? `${days}d ${hours}h` : `${days}d`;
}

/** Format a measured cycle duration, never the configured poll floor. */
export function formatObservedCycle(observedSec: number | null): string | null {
  if (observedSec === null || !Number.isFinite(observedSec) || observedSec <= 0) return null;
  if (observedSec < 60) return `${Math.round(observedSec)}s`;
  const totalMinutes = Math.round(observedSec / 60);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

/**
 * Conservative session tone for an intraday payload. The regular-hours window
 * is necessary but not sufficient: the payload's ET `session_date` must also be
 * today. That makes weekends, pre-open/after-hours, and exchange holidays with a
 * last-session payload read as `last_session`, never as a stalled current feed.
 * The window is the Macro session projection's, so a 13:00 early close or a full
 * closure ends it, and a date outside the projection's coverage fails closed.
 */
export function usOptionsSessionState(
  sessionDate: unknown,
  now: Date,
): UsOptionsSessionState {
  if (typeof sessionDate !== "string" || !SESSION_DATE_RE.test(sessionDate) || !Number.isFinite(now.getTime())) {
    return "last_session";
  }
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(now);
    const get = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value ?? "";
    const etDate = `${get("year")}-${get("month")}-${get("day")}`;
    const weekday = get("weekday");
    const hour = Number(get("hour")) % 24;
    const minute = Number(get("minute"));
    if (etDate !== sessionDate || weekday === "Sat" || weekday === "Sun") return "last_session";
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return "last_session";
    const minutes = hour * 60 + minute;
    const window = usRegularSessionWindow(Date.parse(`${etDate}T00:00:00Z`) / 1000 + minutes * 60);
    return window !== null && minutes >= window[0] && minutes < window[1] ? "regular" : "last_session";
  } catch {
    return "last_session";
  }
}
