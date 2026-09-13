// Last-close resolver for personal-accuracy claims.
// Reads the same per-symbol daily files AnchorCache reads; no hub import is possible.
// KEEP IN SYNC with hub/lib/anchor.js bar shape and ET calendar dates.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { CLAIM_OWNER_LAST_CLOSE } from "./claimOwners";
import { compareObserved, thresholdNumber } from "./personalAccuracy";

export { CLAIM_OWNER_LAST_CLOSE };

export const UNAVAILABLE_NOTE = "the data this call named was not available";
export const UNREADABLE_NOTE = "what this call had to beat was not available";

export function settledNote(date: string): string {
  return `close on ${date}`;
}

const ET_DATE_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export type Bar = {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  vol: number | null;
};
export type ResolverInput = {
  subject: { kind: "security" | "macro_series" | "basket"; id: string };
  condition: { metric: string; comparator: ">=" | "<=" | ">" | "<"; threshold: number; owner: string };
  resolves_at: string; // RFC-3339
};
export type ResolverResult = {
  outcome: 1 | 0 | null;
  observed: number | null;
  resolver: string;   // always "hub/lib/anchor.js" for this resolver, win or miss
  note: string;
};
export type ReadDailyBars = (sym: string) => Promise<Bar[] | null>;

function undetermined(): ResolverResult {
  return {
    outcome: null,
    observed: null,
    resolver: CLAIM_OWNER_LAST_CLOSE.owner,
    note: UNAVAILABLE_NOTE,
  };
}

function unreadable(): ResolverResult {
  return {
    outcome: null,
    observed: null,
    resolver: CLAIM_OWNER_LAST_CLOSE.owner,
    note: UNREADABLE_NOTE,
  };
}

function etDate(ms: number): string {
  const parts: Record<string, string> = {};
  for (const part of ET_DATE_FMT.formatToParts(ms)) {
    if (part.type !== "literal") parts[part.type] = part.value;
  }
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function etCalendarDate(dateISO: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) return dateISO;
  const ms = Date.parse(dateISO);
  if (!Number.isFinite(ms)) return null;
  return etDate(ms);
}

function finiteOrNull(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function parseBars(payload: unknown): Bar[] | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const raw = (payload as { bars?: unknown }).bars;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const bars: Bar[] = [];
  for (const row of raw) {
    if (!Array.isArray(row) || row.length < 5) continue;
    const date = row[0];
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const close = finiteOrNull(row[4]);
    bars.push({
      date,
      open: finiteOrNull(row[1]),
      high: finiteOrNull(row[2]),
      low: finiteOrNull(row[3]),
      close: close === null ? Number.NaN : close,
      vol: finiteOrNull(row[5]),
    });
  }
  return bars.length ? bars : null;
}

export async function defaultReadDailyBars(sym: string): Promise<Bar[] | null> {
  const upper = String(sym).toUpperCase();
  if (upper.includes("/") || upper.includes("\\") || upper.includes("..")) return null;
  try {
    const file = path.join(process.cwd(), "public", "data", `${upper}.json`);
    const raw = await readFile(file, "utf8");
    return parseBars(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function lastCloseOnOrBefore(bars: Bar[], dateISO: string): Bar | null {
  const day = etCalendarDate(dateISO);
  if (!day || !Array.isArray(bars) || bars.length === 0) return null;
  let found: Bar | null = null;
  for (const bar of bars) {
    if (!bar || typeof bar.date !== "string") continue;
    if (bar.date <= day && (!found || bar.date > found.date)) found = bar;
  }
  return found;
}

export async function resolveLastClose(
  input: ResolverInput,
  deps?: { readDailyBars: ReadDailyBars },
): Promise<ResolverResult> {
  const subject = input && input.subject;
  const condition = input && input.condition;
  if (!subject || subject.kind !== "security") return undetermined();
  if (!condition || condition.metric !== CLAIM_OWNER_LAST_CLOSE.metric) return undetermined();

  const reader = deps?.readDailyBars ?? defaultReadDailyBars;
  const bars = await reader(subject.id);
  if (!bars) return undetermined();

  const bar = lastCloseOnOrBefore(bars, input.resolves_at);
  if (!bar || !Number.isFinite(bar.close)) return undetermined();

  const threshold = thresholdNumber(condition.threshold);
  if (threshold === null) return unreadable();

  const observed = bar.close;
  const outcome = compareObserved(condition.comparator, observed, threshold);
  if (outcome === null) return unreadable();

  return {
    outcome,
    observed,
    resolver: CLAIM_OWNER_LAST_CLOSE.owner,
    note: settledNote(bar.date),
  };
}
