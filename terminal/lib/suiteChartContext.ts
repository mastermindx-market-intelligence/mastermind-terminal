/** Pure chart-to-suite context helpers. Kept outside ChartPanel so finality is unit-testable. */

export interface SuiteFinalityInput {
  barCount: number;
  replayActive: boolean;
  acceptedLiveTick: boolean;
}

/** Only an accepted live tail is forming. Replay and untouched source tails are never guessed open. */
export function suiteFormingBarIndex(input: SuiteFinalityInput): number | null {
  const count = Number.isFinite(input.barCount) ? Math.max(0, Math.trunc(input.barCount)) : 0;
  if (!count || input.replayActive || !input.acceptedLiveTick) return null;
  return count - 1;
}

/** Stable market/session identity for event IDs and memo separation. */
export function suiteSessionIdentity(market: string, extendedHours: boolean, isIntraday = true): string {
  if (!isIntraday) return "daily";
  const normalized = String(market || "unknown").toLowerCase();
  if (normalized === "crypto") return "crypto-24h";
  return `${normalized}-${extendedHours ? "extended" : "regular"}`;
}
