/**
 * dte.ts — the ONE days-to-expiry helper for the options desks (OEU T-A, bug B7).
 *
 * Before this module the GEX desk ran TWO conventions side by side:
 *   - StrikeLadder / ExpiryBars: `new Date(exp + "T20:00:00Z")` measured against the
 *     WALL CLOCK (`Date.now()`), so an EOD payload rendered a different DTE every time
 *     you looked at it, and any expiry already in the past clamped to 0 and rendered
 *     "0DTE" — a lie the 0DTE chip then acted on.
 *   - lib/expiryTermStructure.ts: UTC-midnight anchored to the SNAPSHOT's as-of day.
 *
 * The as-of-anchored convention wins (T-A ruling): the GEX payload is an EOD snapshot,
 * so its DTE must be measured from the day the snapshot describes, not from now. Same
 * payload → same label, forever, and deterministic in tests.
 *
 * Two accessors, deliberately different:
 *   - `dteFrom`  clamps at 0 (display: nothing is "-3 days to expiry").
 *   - `dteRaw`   keeps the sign, so callers can tell "expires today" (0) apart from
 *                "already expired" (< 0). `isZeroDte` needs that distinction — the old
 *                clamped form is exactly why a stale payload grew a phantom 0DTE chip.
 *
 * Pure + DOM-free: unit-tested in lib/__tests__/dte.test.ts.
 */

const MS_PER_DAY = 86_400_000;

/**
 * Date part of an expiry key. Tolerates "YYYY-MM-DD",
 * "YYYY-MM-DD HH:MM:SS" (options_structure.matrix form) and ISO stamps.
 */
export function expDatePart(exp: string | null | undefined): string {
  return (exp ?? "").slice(0, 10);
}

/** UTC-midnight epoch for a date part, or NaN when unparseable. */
function midnightUtcMs(datePart: string): number {
  if (datePart.length < 10) return NaN;
  return new Date(`${datePart}T00:00:00Z`).getTime();
}

/**
 * SIGNED whole-day distance from the snapshot's as-of day to the expiry day.
 * Negative = the expiry is already in the past relative to the snapshot.
 * `asOf` is any ISO-ish stamp; only its date part is used. NaN inputs → 0.
 */
export function dteRaw(exp: string, asOf: string | null | undefined): number {
  try {
    const base = expDatePart(asOf) || new Date().toISOString().slice(0, 10);
    const baseMs = midnightUtcMs(base);
    const expMs = midnightUtcMs(expDatePart(exp));
    if (!Number.isFinite(baseMs) || !Number.isFinite(expMs)) return 0;
    return Math.round((expMs - baseMs) / MS_PER_DAY);
  } catch {
    return 0;
  }
}

/**
 * Whole-day DTE relative to the snapshot's as-of day, clamped at 0 for display.
 * (Unchanged behaviour from lib/expiryTermStructure.ts — that convention is the ruling.)
 */
export function dteFrom(exp: string, asOf: string | null | undefined): number {
  return Math.max(0, dteRaw(exp, asOf));
}

/** "0DTE" | "3d" — language-neutral, shared by every DTE caption on the desk. */
export function dteLabel(dte: number): string {
  return dte <= 0 ? "0DTE" : `${dte}d`;
}

/** Convenience: label straight from an expiry key + the snapshot's as-of. */
export function dteLabelFor(exp: string, asOf: string | null | undefined): string {
  return dteLabel(dteFrom(exp, asOf));
}

/**
 * TRUE only when the expiry lands on the snapshot's own session day. An expiry BEFORE
 * the as-of is expired, not 0DTE — the clamped `dteFrom` cannot tell those apart, which
 * is why the 0DTE chip used to light up on stale payloads.
 */
export function isZeroDte(exp: string, asOf: string | null | undefined): boolean {
  return dteRaw(exp, asOf) === 0;
}

/** MM-DD display label — language-neutral, shared by the ladder + term-structure drawer. */
export function expLabel(exp: string): string {
  const d = expDatePart(exp);
  return d.length >= 10 ? d.slice(5) : exp;
}

/**
 * Strict session-date admission: a real calendar date in exact `YYYY-MM-DD` form, else null.
 * Not a trading calendar. Shared by the options companion and the GEX ladder so both admit
 * the same dates.
 */
export function isoSession(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value ? value : null;
}
