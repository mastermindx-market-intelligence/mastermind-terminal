import type { Bar6 } from "./intradayShared";


import type { Bar } from "./fund";

export type DailyReturnRecord = {
  date: string;
  bar: Bar;
  previousDate: string | null;
  previousClose: number | null;
  returnPct: number | null;
  gapCalendarDays: number;
};

export type MonthlyReturnSummary = {
  month: string;
  firstDate: string | null;
  endDate: string | null;
  referenceDate: string | null;
  referenceClose: number | null;
  endClose: number | null;
  returnPct: number | null;
  observedDays: number;
  upDays: number;
  downDays: number;
  flatDays: number;
  best: DailyReturnRecord | null;
  worst: DailyReturnRecord | null;
};

function realIsoDay(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const ms = Date.parse(value + "T00:00:00Z");
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10) === value ? value : null;
}

function sameDailyBar(a: Bar, b: Bar): boolean {
  return a.o === b.o && a.h === b.h && a.l === b.l && a.c === b.c && a.v === b.v;
}

function validDailyBar(bar: Bar): boolean {
  if (![bar.o, bar.h, bar.l, bar.c, bar.v].every(finite)) return false;
  if (bar.o <= 0 || bar.h <= 0 || bar.l <= 0 || bar.c <= 0 || bar.v < 0) return false;
  if (bar.h < Math.max(bar.o, bar.c) || bar.l > Math.min(bar.o, bar.c) || bar.h < bar.l) return false;
  return true;
}

export function buildDailyReturnRecords(bars: readonly Bar[]): DailyReturnRecord[] {
  const byDate = new Map<string, Bar>();
  const conflicts = new Set<string>();
  for (const bar of bars) {
    const date = returnsCalendarDayKey(bar.time);
    if (!date || !validDailyBar(bar)) continue;
    const existing = byDate.get(date);
    if (!existing) {
      byDate.set(date, bar);
    } else if (!sameDailyBar(existing, bar)) {
      conflicts.add(date);
    }
  }

  const ordered = Array.from(byDate.entries())
    .filter(([date]) => !conflicts.has(date))
    .sort((a, b) => a[0].localeCompare(b[0]));

  return ordered.map(([date, bar], index) => {
    const prev = index > 0 ? ordered[index - 1] : null;
    const previousDate = prev ? prev[0] : null;
    const previousClose = prev ? prev[1].c : null;
    const returnPct = previousClose && previousClose > 0
      ? (bar.c / previousClose - 1) * 100
      : null;
    const gapCalendarDays = previousDate
      ? Math.max(0, Math.round((Date.parse(date + "T00:00:00Z") - Date.parse(previousDate + "T00:00:00Z")) / 86400000) - 1)
      : 0;
    return { date, bar, previousDate, previousClose, returnPct, gapCalendarDays };
  });
}

export function summarizeReturnMonth(records: readonly DailyReturnRecord[], month: string): MonthlyReturnSummary {
  const inMonth = records.filter((record) => record.date.slice(0, 7) === month);
  const first = inMonth[0] ?? null;
  const end = inMonth[inMonth.length - 1] ?? null;
  const firstIndex = first ? records.findIndex((record) => record.date === first.date) : -1;
  const reference = firstIndex > 0 ? records[firstIndex - 1] : null;
  const usable = inMonth.filter((record) => record.returnPct !== null);
  const best = usable.length
    ? usable.reduce((winner, record) => (record.returnPct! > winner.returnPct! ? record : winner))
    : null;
  const worst = usable.length
    ? usable.reduce((winner, record) => (record.returnPct! < winner.returnPct! ? record : winner))
    : null;

  return {
    month,
    firstDate: first?.date ?? null,
    endDate: end?.date ?? null,
    referenceDate: reference?.date ?? null,
    referenceClose: reference?.bar.c ?? null,
    endClose: end?.bar.c ?? null,
    returnPct: reference && end ? (end.bar.c / reference.bar.c - 1) * 100 : null,
    observedDays: inMonth.length,
    upDays: usable.filter((record) => record.returnPct! > 0).length,
    downDays: usable.filter((record) => record.returnPct! < 0).length,
    flatDays: usable.filter((record) => record.returnPct === 0).length,
    best,
    worst,
  };
}

export function returnHeatBand(value: number | null): "flat" | "soft" | "mid" | "strong" {
  if (value === null || !finite(value) || value === 0) return "flat";
  const magnitude = Math.abs(value);
  if (magnitude >= 3) return "strong";
  if (magnitude >= 1.5) return "mid";
  return "soft";
}

export function rangePercent(value: number | null, low: number, high: number): number | null {
  if (value === null || !finite(value) || !finite(low) || !finite(high) || high <= low) return null;
  return Math.max(0, Math.min(100, ((value - low) / (high - low)) * 100));
}

export function isCryptoLike(symbol: string): boolean {
  return /-USD$/i.test(symbol.trim());
}

export const RETURNS_CALENDAR_SESSION_TF = "30m" as const;
export const RETURNS_CALENDAR_SESSION_MINUTES = 30;

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

function hhmm(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

export function returnsCalendarDayKey(time: string | number): string | null {
  if (typeof time === "string") return realIsoDay(time.slice(0, 10));
  if (!finite(time)) return null;
  const ms = Math.abs(time) < 1e12 ? time * 1000 : time;
  if (!Number.isFinite(ms)) return null;
  return realIsoDay(new Date(ms).toISOString().slice(0, 10));
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
  hours: string,
  bars: Bar6[],
): SessionRange {
  const clean = bars
    .filter((b) => b.length >= 6 && b.slice(0, 6).every(finite))
    .sort((a, b) => a[0] - b[0]);
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
export function buildReturnsCalendarSessions(
  current: Bar6[],
  previous: Bar6[],
  rth: readonly [number, number] | null,
): SessionRange[] {
  const regularStart = rth?.[0] ?? null;
  const regularEnd = rth?.[1] ?? null;
  const overnight = [
    ...previous.filter((b) => minuteOfDisplayDay(b[0]) >= 20 * 60),
    ...current.filter((b) => minuteOfDisplayDay(b[0]) < 4 * 60),
  ];
  const pre = regularStart == null ? [] : current.filter((b) => {
    const m = minuteOfDisplayDay(b[0]);
    return m >= 4 * 60 && m < regularStart;
  });
  const regular = regularStart == null || regularEnd == null ? [] : current.filter((b) => {
    const m = minuteOfDisplayDay(b[0]);
    return m >= regularStart && m < regularEnd;
  });
  const post = regularEnd == null ? [] : current.filter((b) => {
    const m = minuteOfDisplayDay(b[0]);
    return m >= regularEnd && m < 20 * 60;
  });
  return [
    aggregateSession("overnight", "20:00–04:00", overnight),
    aggregateSession("pre", regularStart == null ? "04:00–—" : `04:00–${hhmm(regularStart)}`, pre),
    aggregateSession(
      "regular",
      regularStart == null || regularEnd == null ? "—" : `${hhmm(regularStart)}–${hhmm(regularEnd)}`,
      regular,
    ),
    aggregateSession("post", regularEnd == null ? "—–20:00" : `${hhmm(regularEnd)}–20:00`, post),
  ];
}
