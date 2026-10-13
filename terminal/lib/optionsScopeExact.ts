import type { StrikeExpiryDoc } from "@/components/shared/StrikeExpiryMatrix";

/**
 * Exact strike and days-to-expiry scope (PP2-UI-c).
 *
 * The parser (`optionsScopeBounds.ts`) decides which strikes and expiries qualify;
 * `matrixForExactScope` then projects the chosen S × E onto the analysis document
 * without ever claiming a coverage the source did not publish.
 *
 * - Keeps only cells whose strike is in S AND expiry is in E.
 * - Filters a declared strikes/expiries array down to S/E ONLY when the doc declared
 *   those axes, so the axis-domain basis is preserved.
 * - Preserves "derived-grid" for a doc without axes; never upgrades it to "declared-grid".
 * - Does not mutate its input.
 */
export function matrixForExactScope(matrix: unknown, strikes: readonly number[], expiries: readonly string[]): StrikeExpiryDoc {
  void matrix; void strikes; void expiries;
  throw new Error("matrixForExactScope not implemented (PP2-UI-c RED)");
}

/**
 * A windowPct that excludes no strike: `matrixExactScopeStats` rejects non-finite
 * values, so this MUST be a finite positive number. `Number.MAX_SAFE_INTEGER`
 * is well above any realistic strike span and is the seat's chosen constant.
 */
export const EXACT_WINDOW_PCT = Number.MAX_SAFE_INTEGER;