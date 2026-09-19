export const OPTIONS_ALPHA_MEASURED_FEED_SCHEMA = "live_flow.feed/v1";
export const OPTIONS_ALPHA_MICROSTRUCTURE_SCHEMA = "options.trade_nbbo_microstructure/v1";

type JsonRecord = Record<string, unknown>;

export interface OptionsAlphaMeasuredMicrostructure {
  schema: typeof OPTIONS_ALPHA_MICROSTRUCTURE_SCHEMA;
  source_print_count: number;
  nbbo_valid_print_count: number;
  source_premium_usd: number;
  nbbo_covered_premium_usd: number;
  nbbo_print_coverage: number;
  nbbo_premium_coverage: number;
  at_ask_share: number | null;
  at_bid_share: number | null;
  inside_share: number | null;
  outside_share: number | null;
  aggression_share: number | null;
  aggression_balance: number | null;
  spread_median_usd: number | null;
  spread_median_pct: number | null;
  quote_age_median_ms: number | null;
  quote_age_max_ms: number | null;
  bid_size_median: number | null;
  ask_size_median: number | null;
}

export interface OptionsAlphaMeasuredEvent {
  id: string;
  root: string;
  right: "C" | "P";
  expiration: string;
  strike: number;
  observed_at: string;
  decision_at: string;
  available_at: string;
  vol_gt_oi_ratio: number | null;
  microstructure: OptionsAlphaMeasuredMicrostructure;
}

export interface OptionsAlphaMeasuredFeed {
  schema: typeof OPTIONS_ALPHA_MEASURED_FEED_SCHEMA;
  asof: string | null;
  source_asof: string | null;
  session_date: string | null;
  events: OptionsAlphaMeasuredEvent[];
}

function isRecord(value: unknown): value is JsonRecord {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nonnegative(value: unknown): number | null {
  const parsed = finite(value);
  return parsed != null && parsed >= 0 ? parsed : null;
}

function positive(value: unknown): number | null {
  const parsed = finite(value);
  return parsed != null && parsed > 0 ? parsed : null;
}

function nonnegativeInteger(value: unknown): number | null {
  const parsed = finite(value);
  return parsed != null && Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function ratio(value: unknown): number | null {
  const parsed = finite(value);
  return parsed != null && parsed >= 0 && parsed <= 1 ? parsed : null;
}

function signedRatio(value: unknown): number | null {
  const parsed = finite(value);
  return parsed != null && parsed >= -1 && parsed <= 1 ? parsed : null;
}

function nullable<T>(value: unknown, parser: (raw: unknown) => T | null): T | null {
  return value == null ? null : parser(value);
}

function timestamp(value: unknown): string | null {
  const candidate = text(value);
  if (!candidate) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(candidate)) {
    return null;
  }
  return Number.isFinite(Date.parse(candidate)) ? candidate : null;
}

function dateText(value: unknown): string | null {
  const candidate = text(value);
  if (!candidate || !/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return null;
  const parsed = new Date(candidate + "T12:00:00Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === candidate
    ? candidate
    : null;
}

function approximately(left: number, right: number, tolerance = 0.000003): boolean {
  return Math.abs(left - right) <= tolerance;
}

function normalizeMicrostructure(value: unknown): OptionsAlphaMeasuredMicrostructure | null {
  if (!isRecord(value) || value.schema !== OPTIONS_ALPHA_MICROSTRUCTURE_SCHEMA) return null;

  const sourcePrintCount = nonnegativeInteger(value.source_print_count);
  const validPrintCount = nonnegativeInteger(value.nbbo_valid_print_count);
  const sourcePremium = positive(value.source_premium_usd);
  const coveredPremium = nonnegative(value.nbbo_covered_premium_usd);
  const printCoverage = ratio(value.nbbo_print_coverage);
  const premiumCoverage = ratio(value.nbbo_premium_coverage);

  if (
    sourcePrintCount == null
    || sourcePrintCount < 1
    || validPrintCount == null
    || validPrintCount > sourcePrintCount
    || sourcePremium == null
    || coveredPremium == null
    || coveredPremium > sourcePremium + 0.011
    || printCoverage == null
    || premiumCoverage == null
    || !approximately(printCoverage, validPrintCount / sourcePrintCount, 0.0000015)
    || !approximately(premiumCoverage, coveredPremium / sourcePremium, 0.0000015)
  ) return null;

  const atAsk = nullable(value.at_ask_share, ratio);
  const atBid = nullable(value.at_bid_share, ratio);
  const inside = nullable(value.inside_share, ratio);
  const outside = nullable(value.outside_share, ratio);
  const aggression = nullable(value.aggression_share, ratio);
  const balance = nullable(value.aggression_balance, signedRatio);

  if (coveredPremium > 0) {
    if (
      atAsk == null || atBid == null || inside == null || outside == null
      || aggression == null || balance == null
      || !approximately(atAsk + atBid + inside + outside, 1, 0.000006)
      || !approximately(aggression, atAsk + atBid, 0.0000015)
      || !approximately(balance, atAsk - atBid, 0.0000015)
    ) return null;
  } else if ([atAsk, atBid, inside, outside, aggression, balance].some((item) => item != null)) {
    return null;
  }

  const spreadUsd = nullable(value.spread_median_usd, nonnegative);
  const spreadPct = nullable(value.spread_median_pct, nonnegative);
  const quoteAgeMedian = nullable(value.quote_age_median_ms, nonnegative);
  const quoteAgeMax = nullable(value.quote_age_max_ms, nonnegative);
  const bidSizeMedian = nullable(value.bid_size_median, nonnegative);
  const askSizeMedian = nullable(value.ask_size_median, nonnegative);
  if (quoteAgeMedian != null && quoteAgeMax != null && quoteAgeMedian > quoteAgeMax) return null;

  return {
    schema: OPTIONS_ALPHA_MICROSTRUCTURE_SCHEMA,
    source_print_count: sourcePrintCount,
    nbbo_valid_print_count: validPrintCount,
    source_premium_usd: sourcePremium,
    nbbo_covered_premium_usd: coveredPremium,
    nbbo_print_coverage: printCoverage,
    nbbo_premium_coverage: premiumCoverage,
    at_ask_share: atAsk,
    at_bid_share: atBid,
    inside_share: inside,
    outside_share: outside,
    aggression_share: aggression,
    aggression_balance: balance,
    spread_median_usd: spreadUsd,
    spread_median_pct: spreadPct,
    quote_age_median_ms: quoteAgeMedian,
    quote_age_max_ms: quoteAgeMax,
    bid_size_median: bidSizeMedian,
    ask_size_median: askSizeMedian,
  };
}

function normalizeMeasuredEvent(value: unknown): OptionsAlphaMeasuredEvent | null {
  if (!isRecord(value)) return null;

  const id = text(value.id);
  const root = text(value.root)?.toUpperCase() ?? null;
  const rightText = text(value.right)?.toUpperCase() ?? null;
  const expiration = dateText(value.exp);
  const strike = positive(value.strike);
  const observedAt = timestamp(value.observed_at);
  const decisionAt = timestamp(value.decision_at);
  const availableAt = timestamp(value.available_at);
  const microstructure = normalizeMicrostructure(value.microstructure);

  if (
    !id
    || !root
    || !/^[A-Z0-9.^=-]{1,16}$/.test(root)
    || (rightText !== "C" && rightText !== "P")
    || !expiration
    || strike == null
    || !observedAt
    || !decisionAt
    || !availableAt
    || !microstructure
  ) return null;

  const observedMs = Date.parse(observedAt);
  const decisionMs = Date.parse(decisionAt);
  const availableMs = Date.parse(availableAt);
  if (observedMs > decisionMs || decisionMs > availableMs) return null;

  return {
    id,
    root,
    right: rightText,
    expiration,
    strike,
    observed_at: observedAt,
    decision_at: decisionAt,
    available_at: availableAt,
    vol_gt_oi_ratio: nullable(value.vol_gt_oi_ratio, nonnegative),
    microstructure,
  };
}

/**
 * Normalize only the zero-authority measured block already carried by live_flow.feed/v1.
 *
 * This parser deliberately does not join events to Options Alpha candidates, infer direction,
 * or widen options.prophet_shadow/v1. Invalid measured rows are omitted from this evidence-only
 * view while the source feed remains independently usable elsewhere.
 */
export function normalizeOptionsAlphaMeasuredFeed(value: unknown): OptionsAlphaMeasuredFeed | null {
  if (!isRecord(value) || value.schema !== OPTIONS_ALPHA_MEASURED_FEED_SCHEMA || !Array.isArray(value.events)) {
    return null;
  }

  const sessionDate = value.session_date == null ? null : dateText(value.session_date);
  if (value.session_date != null && sessionDate == null) return null;

  const asof = value.asof == null ? null : timestamp(value.asof);
  if (value.asof != null && asof == null) return null;

  const sourceAsof = value.source_asof == null ? null : timestamp(value.source_asof);
  if (value.source_asof != null && sourceAsof == null) return null;

  const events = value.events
    .map(normalizeMeasuredEvent)
    .filter((event): event is OptionsAlphaMeasuredEvent => event != null)
    .sort((left, right) => (
      Date.parse(right.available_at) - Date.parse(left.available_at)
      || right.id.localeCompare(left.id)
    ));

  return {
    schema: OPTIONS_ALPHA_MEASURED_FEED_SCHEMA,
    asof,
    source_asof: sourceAsof,
    session_date: sessionDate,
    events,
  };
}
