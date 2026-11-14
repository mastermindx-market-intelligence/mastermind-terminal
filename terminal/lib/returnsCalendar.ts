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
    const returnPct = finiteReturnPercent(bar.c, previousClose);
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
  const usable = inMonth.filter((record) => finite(record.returnPct));
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
    returnPct: reference && end ? finiteReturnPercent(end.bar.c, reference.bar.c) : null,
    observedDays: inMonth.length,
    upDays: usable.filter((record) => record.returnPct! > 0).length,
    downDays: usable.filter((record) => record.returnPct! < 0).length,
    flatDays: usable.filter((record) => record.returnPct === 0).length,
    best,
    worst,
  };
}

/** Finite inputs may still overflow the ratio or its percentage conversion. */
export function finiteReturnPercent(close: number, reference: number | null): number | null {
  if (!finite(close) || !finite(reference) || close <= 0 || reference <= 0) return null;
  const value = (close / reference - 1) * 100;
  return finite(value) ? value : null;
}

/** Withheld values have no gain/loss styling; an observed zero stays valid. */
export function returnDirection(value: number | null): "up" | "down" | "" {
  return finite(value) ? (value >= 0 ? "up" : "down") : "";
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
  const instant = new Date(ms);
  return Number.isFinite(instant.valueOf()) ? realIsoDay(instant.toISOString().slice(0, 10)) : null;
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
  const calculatedReturn = open !== 0 ? ((close - open) / open) * 100 : null;
  const ret = finite(calculatedReturn) ? calculatedReturn : null;
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
  postEndMinute: number | null = null,
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
  const post = regularEnd == null || postEndMinute == null ? [] : current.filter((b) => {
    const m = minuteOfDisplayDay(b[0]);
    return m >= regularEnd && m < postEndMinute;
  });
  return [
    aggregateSession("overnight", "20:00–04:00", overnight),
    aggregateSession("pre", regularStart == null ? "04:00–—" : `04:00–${hhmm(regularStart)}`, pre),
    aggregateSession(
      "regular",
      regularStart == null || regularEnd == null ? "—" : `${hhmm(regularStart)}–${hhmm(regularEnd)}`,
      regular,
    ),
    aggregateSession("post", regularEnd == null || postEndMinute == null ? "—" : `${hhmm(regularEnd)}–${hhmm(postEndMinute)}`, post),
  ];
}


export type ReturnCalendarSlot = { date: string; record: DailyReturnRecord | null } | null;

/** Calendar geometry retains missing observations and weekends in their real slots. */
export function buildReturnCalendarSlots(
  records: readonly DailyReturnRecord[], month: string, crypto: boolean,
): ReturnCalendarSlot[] {
  if (!/^\d{4}-\d{2}$/.test(month) || !realIsoDay(month + "-01")) return [];
  const [year, monthNumber] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const byDate = new Map(records.map(record => [record.date, record]));
  const slots: ReturnCalendarSlot[] = [];
  for (let day = 1; day <= last; day++) {
    const instant = new Date(Date.UTC(year, monthNumber - 1, day));
    const weekday = instant.getUTCDay();
    if (!crypto && (weekday === 0 || weekday === 6)) continue;
    const date = instant.toISOString().slice(0, 10);
    if (!slots.length) {
      const column = crypto ? weekday : weekday - 1;
      for (let i = 0; i < column; i++) slots.push(null);
    }
    slots.push({ date, record: byDate.get(date) ?? null });
  }
  return slots;
}

export function returnCalendarFocusTarget(
  slots: readonly ReturnCalendarSlot[], from: string, key: string, columns: number,
): string | null {
  const index = slots.findIndex(slot => slot?.date === from);
  if (index < 0 || (columns !== 5 && columns !== 7)) return null;
  if (key === "Home" || key === "End") {
    const start = Math.floor(index / columns) * columns;
    const end = Math.min(start + columns, slots.length);
    const row = slots.slice(start, end).filter(slot => slot?.record);
    return (key === "Home" ? row[0] : row[row.length - 1])?.date ?? from;
  }
  const delta = key === "ArrowLeft" ? -1 : key === "ArrowRight" ? 1
    : key === "ArrowUp" ? -columns : key === "ArrowDown" ? columns : 0;
  if (!delta) return null;
  for (let at = index + delta; at >= 0 && at < slots.length; at += delta) {
    if (slots[at]?.record) return slots[at]!.date;
  }
  return from;
}

/** Short months/missing dates choose the closest observed day; an empty month has no fake date. */
export function returnCalendarMonthFocus(
  records: readonly DailyReturnRecord[], month: string, preferred: string | null, crypto = false,
): string | null {
  const inMonth = records.filter(record => record.date.slice(0, 7) === month
    && (crypto || ![0, 6].includes(new Date(record.date + "T00:00:00Z").getUTCDay())));
  if (!inMonth.length) return null;
  const day = preferred && realIsoDay(preferred) ? Number(preferred.slice(8)) : 31;
  return [...inMonth].sort((a, b) => Math.abs(Number(a.date.slice(8)) - day)
    - Math.abs(Number(b.date.slice(8)) - day) || a.date.localeCompare(b.date))[0].date;
}

export function dailyReturnQuality(record: DailyReturnRecord): string {
  if (record.previousClose === null) return "missing_prior_reference";
  if (!finite(record.returnPct)) return "unavailable_return";
  return record.gapCalendarDays > 0 ? "observed_return_with_calendar_gap" : "observed_return";
}

export function serializeReturnsMonth(records: readonly DailyReturnRecord[], month: string): string {
  const cell = (value: unknown) => {
    const text = value == null || (typeof value === "number" && !finite(value)) ? "" : String(value);
    return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  };
  const rows = [
    ["date", "open", "high", "low", "close", "previous_date", "previous_close",
      "close_to_close_return_pct", "observed_gap_calendar_days", "return_basis", "quality"],
    ...records.filter(record => record.date.slice(0, 7) === month).map(record => [
      record.date, record.bar.o, record.bar.h, record.bar.l, record.bar.c,
      record.previousDate, record.previousClose, record.returnPct, record.gapCalendarDays,
      "daily_price_return_adjustment_unverified", dailyReturnQuality(record),
    ]),
  ];
  return rows.map(row => row.map(cell).join(",")).join("\n") + "\n";
}
