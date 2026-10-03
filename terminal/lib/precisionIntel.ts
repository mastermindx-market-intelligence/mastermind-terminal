type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asFinite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBounded(value: unknown, lo: number, hi: number): number | null {
  const n = asFinite(value);
  return n !== null && n >= lo && n <= hi ? n : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export interface PrecisionEntryIntel {
  headline: string | null;
  headlineZh: string | null;
  action: string | null;
  actionZh: string | null;
  grade: string | null;
  bottomConfidence: number | null;
  nextTrigger: string | null;
  buyZone: readonly [number, number] | null;
  chaseAbove: number | null;
  stop: number | null;
  spot: number | null;
  opensLo: number | null;
  opensHi: number | null;
}

export interface PrecisionConfluenceIntel {
  tier: string | null;
  sub: string | null;
  ticks: number | null;
  barsToCross: number | null;
  provisional: boolean | null;
  notTopped: boolean | null;
  htfS1: boolean | null;
  asof: string | null;
}

export interface PrecisionSniperIntel {
  w2Washout: boolean | null;
  w2StochD: number | null;
  daysSince63dLow: number | null;
  coiled: boolean | null;
  asof: string | null;
}

export interface PrecisionIntelRead {
  asof: string | null;
  entry: PrecisionEntryIntel | null;
  confluence: PrecisionConfluenceIntel | null;
  sniper: PrecisionSniperIntel | null;
}

function readBuyZone(value: unknown): readonly [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const lo = asFinite(value[0]);
  const hi = asFinite(value[1]);
  return lo !== null && hi !== null && lo <= hi ? [lo, hi] as const : null;
}

function readEntry(analysis: JsonRecord): PrecisionEntryIntel | null {
  const entry = asRecord(analysis.entry);
  if (!entry) return null;

  const out: PrecisionEntryIntel = {
    headline: asText(entry.headline),
    headlineZh: asText(entry.headline_zh),
    action: asText(entry.action),
    actionZh: asText(entry.action_zh),
    grade: asText(entry.grade),
    // Macro entry_signal.confidence is the validated Bottom Confidence durability
    // measure. Keep its declared 0..100 domain; an invalid value is unknown, never
    // coerced into a display score.
    bottomConfidence: asBounded(entry.confidence, 0, 100),
    nextTrigger: asText(entry.next_trigger),
    buyZone: readBuyZone(entry.buy_zone),
    chaseAbove: asFinite(entry.chase_above),
    stop: asFinite(entry.stop),
    spot: asFinite(entry.spot),
    opensLo: asFinite(entry.opens_lo),
    opensHi: asFinite(entry.opens_hi),
  };

  return Object.values(out).some((value) => value !== null) ? out : null;
}

function readConfluence(analysis: JsonRecord): PrecisionConfluenceIntel | null {
  const confluence = asRecord(analysis.confluence);
  if (!confluence) return null;

  const out: PrecisionConfluenceIntel = {
    tier: asText(confluence.tier),
    sub: asText(confluence.sub),
    ticks: asFinite(confluence.ticks),
    barsToCross: asFinite(confluence.bars_to_cross),
    provisional: asBoolean(confluence.provisional),
    notTopped: asBoolean(confluence.not_topped),
    htfS1: asBoolean(confluence.htf_s1),
    asof: asText(confluence.asof),
  };

  return Object.values(out).some((value) => value !== null) ? out : null;
}

function readSniper(analysis: JsonRecord): PrecisionSniperIntel | null {
  const sniper = asRecord(analysis.sniper);
  if (!sniper) return null;

  const out: PrecisionSniperIntel = {
    w2Washout: asBoolean(sniper.w2_washout),
    w2StochD: asFinite(sniper.w2_stoch_d),
    daysSince63dLow: asFinite(sniper.days_since_63d_low),
    coiled: asBoolean(sniper.coiled),
    asof: asText(sniper.asof),
  };

  return Object.values(out).some((value) => value !== null) ? out : null;
}

/**
 * Display-only adapter for the existing intel/v1 contract.
 *
 * This function does not originate, rank, combine, score, or reinterpret a setup.
 * It only narrows the already-published Macro fields used by Precision MTF.
 */
export function readPrecisionIntel(value: unknown): PrecisionIntelRead | null {
  const root = asRecord(value);
  const analysis = root ? asRecord(root.analysis) : null;
  if (!root || !analysis) return null;

  const entry = readEntry(analysis);
  const confluence = readConfluence(analysis);
  const sniper = readSniper(analysis);
  if (!entry && !confluence && !sniper) return null;

  return {
    asof: asText(root.asof),
    entry,
    confluence,
    sniper,
  };
}
