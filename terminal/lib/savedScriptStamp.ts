/**
 * CAS timestamp helper for owner-bound `saved_scripts` updates.
 *
 * Live schema (pg_catalog, 2026-10-06T06:38Z): `updated_at` is NOT NULL timestamptz
 * default now(), with no overriding trigger. The save route therefore writes the next
 * stamp itself. The expected token is the exact DB value (string equality on `.eq("updated_at")`);
 * the next stamp is monotonic in milliseconds:
 *   max(nowMs, floor(Date.parse(expected)) + 1) as ISO-8601 with milliseconds.
 *
 * Input is a timestamptz token, not an arbitrary Date.parse-able string. Date-only
 * values, locale dates, and timezone-less datetimes are rejected so the writer never
 * invents a next stamp from a non-token.
 */

const TS_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/;

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function parseExpectedUpdatedAtMs(expected: unknown): number | null {
  if (typeof expected !== "string" || expected.length === 0) return null;
  const m = TS_RE.exec(expected);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  if (m[8] !== "Z") {
    const offH = Number(m[8].slice(1, 3));
    const offM = Number(m[8].slice(4, 6));
    if (offH > 23 || offM > 59) return null;
  }
  const ms = Date.parse(expected);
  if (!Number.isFinite(ms)) return null;
  return ms;
}

/** Fractional digits after the millisecond. Date.parse truncates these. */
function subMillisecondDigits(token: string): string {
  const m = TS_RE.exec(token);
  return (m?.[7] ?? "").padEnd(9, "0").slice(3);
}

/**
 * Order two timestamptz tokens as real instants. Timezone offsets that name the
 * same instant compare equal. Sub-millisecond digits Date.parse drops are part
 * of the order. Original strings are not compared lexicographically.
 * Negative if `a` is earlier, 0 if the same instant, positive if `a` is later.
 * Null if either token fails parseExpectedUpdatedAtMs.
 */
export function compareExpectedUpdatedAt(a: unknown, b: unknown): number | null {
  const aMs = parseExpectedUpdatedAtMs(a);
  const bMs = parseExpectedUpdatedAtMs(b);
  if (aMs == null || bMs == null) return null;
  if (aMs !== bMs) return aMs < bMs ? -1 : 1;
  const aSub = subMillisecondDigits(a as string);
  const bSub = subMillisecondDigits(b as string);
  if (aSub === bSub) return 0;
  return aSub < bSub ? -1 : 1;
}

/** Next `updated_at` ISO string, or null when `expected` is malformed. */
export function nextSavedAtIso(expected: unknown, nowMs: number = Date.now()): string | null {
  const parsed = parseExpectedUpdatedAtMs(expected);
  if (parsed == null) return null;
  const nextMs = Math.max(nowMs, Math.floor(parsed) + 1);
  return new Date(nextMs).toISOString();
}
