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
export function matrixForExactScope(
  matrix: StrikeExpiryDoc,
  strikes: readonly number[],
  expiries: readonly string[],
): StrikeExpiryDoc {
  const strikeSet = new Set(strikes);
  const expirySet = new Set(expiries);
  const declaredStrikes = Array.isArray(matrix.strikes);
  const declaredExpiries = Array.isArray(matrix.expiries);
  const filteredStrikes = declaredStrikes
    ? (matrix.strikes as readonly number[]).filter((k) => strikeSet.has(k))
    : undefined;
  const filteredExpiries = declaredExpiries
    ? (matrix.expiries as readonly string[]).filter((e) => expirySet.has(e))
    : undefined;
  const cells = Array.isArray(matrix.cells)
    ? matrix.cells.filter((cell) => strikeSet.has(cell.strike) && expirySet.has(cell.expiry))
    : matrix.cells;
  const out: StrikeExpiryDoc = { ...matrix, cells };
  if (filteredStrikes) (out as { strikes?: number[] }).strikes = [...filteredStrikes];
  if (filteredExpiries) (out as { expiries?: string[] }).expiries = [...filteredExpiries];
  return out;
}

/**
 * A windowPct that excludes no strike: `matrixExactScopeStats` rejects non-finite
 * values, so this MUST be a finite positive number. `Number.MAX_SAFE_INTEGER`
 * is well above any realistic strike span and is the seat's chosen constant.
 */
export const EXACT_WINDOW_PCT = Number.MAX_SAFE_INTEGER;