import type { Bar6 } from "./intradayShared";

export type SessionRange = {
  key: "overnight" | "pre" | "regular" | "post";
  hours: string;
  low: number | null;
  high: number | null;
  open: number | null;
  close: number | null;
  ret: number | null;
  barCount: number;
};

const SESSION_HOURS: Record<SessionRange["key"], string> = {
  overnight: "20:00–04:00",
  pre: "04:00–09:30",
  regular: "09:30–16:00",
  post: "16:00–20:00",
};

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

export function returnsCalendarDayKey(time: string | number): string | null {
  if (typeof time === "string") {
    const key = time.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : null;
  }
  if (!finite(time)) return null;
  const ms = Math.abs(time) < 1e12 ? time * 1000 : time;
  return new Date(ms).toISOString().slice(0, 10);
}

export function previousCalendarDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function minuteOfDisplayDay(epochSec: number): number {
  const d = new Date(epochSec * 1000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

function aggregateSession(
  key: SessionRange["key"],
  bars: Bar6[],
): SessionRange {
  const clean = bars
    .filter((b) => b.length >= 6 && b.slice(0, 6).every(finite))
    .sort((a, b) => a[0] - b[0]);
  const hours = SESSION_HOURS[key];
  if (!clean.length) {
    return { key, hours, low: null, high: null, open: null, close: null, ret: null, barCount: 0 };
  }
  const open = clean[0][1];
  const close = clean[clean.length - 1][4];
  const low = Math.min(...clean.map((b) => b[3]));
  const high = Math.max(...clean.map((b) => b[2]));
  const ret = open !== 0 ? ((close - open) / open) * 100 : null;
  return { key, hours, low, high, open, close, ret, barCount: clean.length };
}

/**
 * Partition bars already expressed in the app's ET display-epoch convention.
 * Overnight for trading date D = prior wall-date >=20:00 plus D <04:00.
 */
export function buildReturnsCalendarSessions(current: Bar6[], previous: Bar6[]): SessionRange[] {
  const overnight = [
    ...previous.filter((b) => minuteOfDisplayDay(b[0]) >= 20 * 60),
    ...current.filter((b) => minuteOfDisplayDay(b[0]) < 4 * 60),
  ];
  const pre = current.filter((b) => {
    const m = minuteOfDisplayDay(b[0]);
    return m >= 4 * 60 && m < 9 * 60 + 30;
  });
  const regular = current.filter((b) => {
    const m = minuteOfDisplayDay(b[0]);
    return m >= 9 * 60 + 30 && m < 16 * 60;
  });
  const post = current.filter((b) => {
    const m = minuteOfDisplayDay(b[0]);
    return m >= 16 * 60 && m < 20 * 60;
  });
  return [
    aggregateSession("overnight", overnight),
    aggregateSession("pre", pre),
    aggregateSession("regular", regular),
    aggregateSession("post", post),
  ];
}
