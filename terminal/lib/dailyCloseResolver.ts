// Last-close resolver for personal-accuracy claims.
// Reads the same per-symbol daily files AnchorCache reads; no hub import is possible.
// KEEP IN SYNC with hub/lib/anchor.js bar shape and ET calendar dates.

import { readFile } from "node:fs/promises";
import path from "node:path";

export const CLAIM_OWNER_LAST_CLOSE = {
  owner: "hub/lib/anchor.js",
  metric: "close",
} as const;

const UNAVAILABLE_NOTE = "the data this call named was not available";

const ET_DATE_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export type Bar = { date: string; open: number; high: number; low: number; close: number; vol: number };
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

function parseBars(payload: unknown): Bar[] | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const raw = (payload as { bars?: unknown }).bars;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const bars: Bar[] = [];
  for (const row of raw) {
    if (!Array.isArray(row) || row.length < 5) continue;
    const date = row[0];
    const close = Number(row[4]);
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (!Number.isFinite(close)) continue;
    const open = Number(row[1]);
    const high = Number(row[2]);
    const low = Number(row[3]);
    const vol = Number(row[5] ?? 0);
    bars.push({
      date,
      open: Number.isFinite(open) ? open : 0,
      high: Number.isFinite(high) ? high : 0,
      low: Number.isFinite(low) ? low : 0,
      close,
      vol: Number.isFinite(vol) ? vol : 0,
    });
  }
  return bars.length ? bars : null;
}

async function defaultReadDailyBars(sym: string): Promise<Bar[] | null> {
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

function compare(comparator: string, observed: number, threshold: number): 1 | 0 | null {
  switch (comparator) {
    case ">=": return observed >= threshold ? 1 : 0;
    case "<=": return observed <= threshold ? 1 : 0;
    case ">": return observed > threshold ? 1 : 0;
    case "<": return observed < threshold ? 1 : 0;
    default: return null;
  }
}

export function lastCloseOnOrBefore(bars: Bar[], dateISO: string): Bar | null {
  const day = etCalendarDate(dateISO);
  if (!day || !Array.isArray(bars) || bars.length === 0) return null;
  let found: Bar | null = null;
  for (const bar of bars) {
    if (bar && typeof bar.date === "string" && bar.date <= day) found = bar;
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

  const threshold = typeof condition.threshold === "number" ? condition.threshold : Number(condition.threshold);
  if (!Number.isFinite(threshold)) return undetermined();

  const observed = bar.close;
  const outcome = compare(condition.comparator, observed, threshold);
  if (outcome === null) return undetermined();

  return {
    outcome,
    observed,
    resolver: CLAIM_OWNER_LAST_CLOSE.owner,
    note: `close on ${bar.date}`,
  };
}
