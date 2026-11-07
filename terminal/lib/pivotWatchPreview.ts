/**
 * Reconstructed, descriptive opening-range pivot WATCH preview.
 *
 * NOT a Radar event, issued watch, forecast, trade instruction, or PIT receipt.
 * Call only with source-qualified completed, regular-session 5m bars from the
 * incumbent Terminal intraday owner. Timestamps are ET display-epoch seconds,
 * NOT UTC instants. A future bar's OHLCV is never inspected.
 *
 * Every encounter and outcome is reconstructed causally at an explicit cutoff.
 * Do not present a reconstructed first encounter as an as-issued notification.
 */
import type { Bar6 } from "./intradayShared";

export type PivotSide = "bottom" | "top";
export type PivotState = "unavailable" | "warming_up" | "watching" | "approaching" | "forming" | "confirmed" | "failed" | "expired";
export type PivotReason = "source_unqualified" | "invalid_clock" | "invalid_series" | "missing_interval"
  | "no_range" | "insufficient_completed_bars" | "level_breached" | "watch_timeout"
  | "confirmation_timeout" | "reclaim_confirmed" | "rejection_confirmed" | "level_nearby" | "approach_observed" | "no_encounter";

export const ORIGIN_BARS = 6 as const; // First complete regular-session 30 minutes.
export const ENCOUNTER_MAX_BARS = 24 as const; // Two hours after origin; descriptive, not optimized.
export const CONFIRM_MAX_BARS = 6 as const; // Thirty minutes after first encounter.
export const ZONE_RANGE_FRACTION = 0.10 as const; // Frozen opening-range width, not a volatility model.
export const APPROACH_ZONE_MULTIPLE = 3 as const; // Distance-based observation, not a forecast or empirical threshold.
const BAR_SECONDS = 300;

export type PivotPreview = {
  side: PivotSide;
  levelKind: "opening_range_30m";
  state: PivotState;
  reason: PivotReason;
  levelPrice: number | null;
  zoneHalfWidth: number | null;
  invalidationPrice: number | null;
  levelKnownAtDisplayEpoch: number | null;
  firstEncounterAtDisplayEpoch: number | null; // Close of first encounter bar; reconstructed.
  resolutionAtDisplayEpoch: number | null; // Close of confirmation/failure/expiry bar; reconstructed.
  confirmationThreshold: number | null; // Witness bar high (bottom) or low (top).
  lastClose: number | null; // Final accepted completed close at the projection cutoff.
  distanceFromLevelPct: number | null; // Signed and contemporaneous; no future bar price.
};

export type PivotPreviewReport = {
  schema: "terminal.pivot_watch_preview.v1";
  authority: "reconstructed_descriptive_only";
  timeBasis: "market_local_display_epoch";
  barSeconds: 300;
  sessionStartDisplayEpoch: number;
  levelKnownAtDisplayEpoch: number | null;
  measuredUntilDisplayEpoch: number | null;
  inputCutoffDisplayEpoch: number;
  sourceQualified: boolean;
  outcomesAreAsIssued: false;
  rows: [PivotPreview, PivotPreview];
  visibleBars: readonly Readonly<Bar6>[]; // Frozen, qualified completed prefix; never aliases mutable source response.
};

export type PivotPreviewInput = {
  history: unknown; // Existing /api/intraday per-symbol response, including source_evidence.
  symbol: string;
  sessionStartDisplayEpoch: number;
  sessionEndDisplayEpoch: number;
  cutoffDisplayEpoch: number;
};

function blank(side: PivotSide, reason: PivotReason, state: PivotState = "unavailable"): PivotPreview {
  return { side, levelKind: "opening_range_30m", state, reason, levelPrice: null, zoneHalfWidth: null,
    invalidationPrice: null, levelKnownAtDisplayEpoch: null, firstEncounterAtDisplayEpoch: null,
    resolutionAtDisplayEpoch: null, confirmationThreshold: null, lastClose: null, distanceFromLevelPct: null };
}
const safeClock = (n: number): boolean => Number.isSafeInteger(n) && n > 0;
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const record = (x: unknown): Record<string, unknown> | null =>
  x !== null && typeof x === "object" && !Array.isArray(x) ? x as Record<string, unknown> : null;

/** This is source *basis* admission, not a PIT or low-latency certification. */
function qualifiedBars(raw: unknown, symbol: string): readonly unknown[] | null {
  const input = record(raw), evidence = record(input?.source_evidence);
  if (!/^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol) || !evidence
    || evidence.schema !== "terminal.intraday_source_evidence.v1"
    || evidence.symbol !== symbol || evidence.requested_timeframe !== "5m"
    || evidence.session !== "regular" || evidence.timestamp_basis !== "market_local_display_epoch"
    || record(evidence.assembly_clock)?.cache_state === "stale_cache") return null;
  return Array.isArray(input?.bars) ? input.bars : null;
}
function goodBar(b: unknown): b is Bar6 {
  if (!Array.isArray(b) || b.length !== 6 || !b.every(finite)) return false;
  const [, open, high, low, close, volume] = b;
  return open > 0 && close > 0 && low > 0 && volume >= 0 && high >= Math.max(open, low, close) && low <= Math.min(open, high, close);
}

function stateFor(side: PivotSide, bars: readonly Bar6[], level: number, zone: number, originEnd: number): PivotPreview {
  const isBottom = side === "bottom";
  const invalidation = isBottom ? level - zone : level + zone;
  const lastClose = bars[bars.length - 1][4];
  const distancePct = 100 * (lastClose / level - 1);
  const out: PivotPreview = {
    ...blank(side, "no_encounter", "watching"), levelPrice: level, zoneHalfWidth: zone,
    invalidationPrice: invalidation, levelKnownAtDisplayEpoch: originEnd,
    lastClose, distanceFromLevelPct: Number.isFinite(distancePct) ? distancePct : null,
  };
  let touchIndex = -1, witness = 0;
  for (let i = ORIGIN_BARS; i < bars.length; i++) {
    const bar = bars[i], end = bar[0] + BAR_SECONDS;
    const violated = isBottom ? bar[3] < invalidation : bar[2] > invalidation;
    // Price-path order is unknown within OHLC: invalidation wins over a simultaneous reclaim.
    if (violated) {
      out.state = "failed"; out.reason = "level_breached"; out.resolutionAtDisplayEpoch = end;
      return out;
    }
    if (touchIndex === -1) {
      const crossesZone = bar[3] <= level + zone && bar[2] >= level - zone;
      if (crossesZone) {
        touchIndex = i;
        witness = isBottom ? bar[2] : bar[3];
        out.firstEncounterAtDisplayEpoch = end;
        out.confirmationThreshold = witness;
        out.state = "forming"; out.reason = "level_nearby";
      } else if (i - ORIGIN_BARS + 1 >= ENCOUNTER_MAX_BARS) {
        out.state = "expired"; out.reason = "watch_timeout"; out.resolutionAtDisplayEpoch = end;
        return out;
      } else {
        // Observational proximity only: require a completed close on the still-valid
        // approach side. The first intrazone encounter is a separate, later state.
        const approach = isBottom
          ? bar[4] > level + zone && bar[4] <= level + zone * APPROACH_ZONE_MULTIPLE
          : bar[4] < level - zone && bar[4] >= level - zone * APPROACH_ZONE_MULTIPLE;
        out.state = approach ? "approaching" : "watching";
        out.reason = approach ? "approach_observed" : "no_encounter";
      }
    } else {
      const confirmed = isBottom
        ? bar[4] > Math.max(witness, level + zone)
        : bar[4] < Math.min(witness, level - zone);
      // Confirmation can occur only on a LATER completed bar, never on the encounter bar.
      if (confirmed) {
        out.state = "confirmed"; out.reason = isBottom ? "reclaim_confirmed" : "rejection_confirmed";
        out.resolutionAtDisplayEpoch = end;
        return out;
      }
      if (i - touchIndex >= CONFIRM_MAX_BARS) {
        out.state = "expired"; out.reason = "confirmation_timeout";
        out.resolutionAtDisplayEpoch = end;
        return out;
      }
    }
  }
  return out;
}

export function buildPivotWatchPreview(input: PivotPreviewInput): PivotPreviewReport {
  const { sessionStartDisplayEpoch: start, sessionEndDisplayEpoch: end, cutoffDisplayEpoch: cutoff } = input;
  const sourceBars = qualifiedBars(input.history, input.symbol);
  const sourceQualified = sourceBars !== null;
  const output = (reason: PivotReason, state: PivotState = "unavailable", measured: number | null = null): PivotPreviewReport => ({
    schema: "terminal.pivot_watch_preview.v1", authority: "reconstructed_descriptive_only",
    timeBasis: "market_local_display_epoch", barSeconds: BAR_SECONDS,
    sessionStartDisplayEpoch: start, levelKnownAtDisplayEpoch: null,
    measuredUntilDisplayEpoch: measured, inputCutoffDisplayEpoch: cutoff,
    sourceQualified, outcomesAreAsIssued: false,
    visibleBars: [], rows: [blank("bottom", reason, state), blank("top", reason, state)],
  });
  if (!sourceQualified) return output("source_unqualified");
  if (![start, end, cutoff].every(safeClock) || end <= start || (end - start) % BAR_SECONDS !== 0
    || cutoff < start) return output("invalid_clock");
  const bars = sourceBars!;
  if (bars.length > 2000) return output("invalid_series");
  // The last completed interval is capped by both the exchange session and the caller's cutoff.
  const cutoffEnd = Math.min(end, start + Math.floor((cutoff - start) / BAR_SECONDS) * BAR_SECONDS);
  const accepted: Bar6[] = [];
  let prior = -Infinity;
  for (const row of bars) {
    // The time field must be checked before touching forming/future OHLCV.
    if (!Array.isArray(row) || !safeClock(row[0])) return output("invalid_series");
    const t = row[0];
    if (t < start || t >= end || t + BAR_SECONDS > cutoffEnd) continue;
    if (t <= prior || (t - start) % BAR_SECONDS !== 0 || !goodBar(row)) return output("invalid_series");
    prior = t;
    accepted.push([...row] as Bar6); // Own the snapshot; source revisions cannot mutate a returned report.
  }
  // Do not bridge missing bars, session boundaries, or source delivery gaps.
  for (let i = 0; i < accepted.length; i++) {
    if (accepted[i][0] !== start + i * BAR_SECONDS) return output("missing_interval");
  }
  const measured = accepted.length ? accepted[accepted.length - 1][0] + BAR_SECONDS : null;
  if (measured !== cutoffEnd && cutoffEnd > start) return output("missing_interval", "unavailable", measured);
  if (accepted.length < ORIGIN_BARS) return output("insufficient_completed_bars", "warming_up", measured);
  const first = accepted.slice(0, ORIGIN_BARS);
  const high = Math.max(...first.map(b => b[2]));
  const low = Math.min(...first.map(b => b[3]));
  const range = high - low;
  if (!(range > 0) || !Number.isFinite(range)) return output("no_range", "unavailable", measured);
  const zone = range * ZONE_RANGE_FRACTION;
  const originEnd = start + ORIGIN_BARS * BAR_SECONDS;
  return {
    schema: "terminal.pivot_watch_preview.v1", authority: "reconstructed_descriptive_only",
    timeBasis: "market_local_display_epoch", barSeconds: BAR_SECONDS,
    sessionStartDisplayEpoch: start, levelKnownAtDisplayEpoch: originEnd,
    measuredUntilDisplayEpoch: measured, inputCutoffDisplayEpoch: cutoff,
    sourceQualified, outcomesAreAsIssued: false,
    visibleBars: Object.freeze(accepted.map(bar => Object.freeze(bar))),
    rows: [stateFor("bottom", accepted, low, zone, originEnd), stateFor("top", accepted, high, zone, originEnd)],
  };
}
