export type PrecisionLocation =
  | "inside_buy_zone"
  | "below_buy_zone"
  | "above_buy_zone"
  | "above_chase"
  | "unknown";

export type PrecisionEntryReadout = {
  availability: "ready" | "partial" | "unavailable";
  freshness: "current" | "stale" | "unknown";
  asof: {
    intel: string | null;
    confluence: string | null;
    sniper: string | null;
  };
  posture: {
    status: string | null;
    urgency: string | null;
    headline: string | null;
    headlineZh: string | null;
    action: string | null;
    actionZh: string | null;
  };
  bottomConfidence: number | null;
  trigger: {
    next: string | null;
    tier: string | null;
    sub: string | null;
    ticks: number | null;
    barsToCross: number | null;
    provisional: boolean | null;
    notTopped: boolean | null;
    htfS1: boolean | null;
  };
  structure: {
    w2Washout: boolean | null;
    w2StochD: number | null;
    daysSince63dLow: number | null;
    coiled: boolean | null;
  };
  geometry: {
    spot: number | null;
    buyZone: { low: number; high: number } | null;
    chaseAbove: number | null;
    stop: number | null;
    location: PrecisionLocation;
  };
};

type Obj = Record<string, unknown>;

function obj(value: unknown): Obj | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Obj
    : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function int(value: unknown): number | null {
  const n = num(value);
  return n !== null && Number.isInteger(n) ? n : null;
}

function buyZone(value: unknown): { low: number; high: number } | null {
  if (Array.isArray(value)) {
    const low = num(value[0]);
    const high = num(value[1]);
    if (low === null || high === null) return null;
    return low <= high ? { low, high } : { low: high, high: low };
  }
  const band = obj(value);
  if (!band) return null;
  const low = num(band.low);
  const high = num(band.high);
  if (low === null || high === null) return null;
  return low <= high ? { low, high } : { low: high, high: low };
}

function location(args: {
  spot: number | null;
  zone: { low: number; high: number } | null;
  chaseAbove: number | null;
}): PrecisionLocation {
  const { spot, zone, chaseAbove } = args;
  if (spot === null) return "unknown";
  if (chaseAbove !== null && spot > chaseAbove) return "above_chase";
  if (!zone) return "unknown";
  if (spot < zone.low) return "below_buy_zone";
  if (spot > zone.high) return "above_buy_zone";
  return "inside_buy_zone";
}

/**
 * Builds the display-only Precision Entry readout from Terminal's existing intel/v1 payload.
 *
 * This adapter never computes a signal, rank, score, phase, recommendation, or timeframe.
 * It preserves canonical entry/confluence/sniper facts and derives only literal price
 * location against already-published buy-zone/chase thresholds.
 */
export function buildPrecisionEntryReadout(intel: unknown): PrecisionEntryReadout {
  const root = obj(intel);
  const tape = obj(root?.tape);
  const analysis = obj(root?.analysis);
  const entry = obj(analysis?.entry);
  const confluence = obj(analysis?.confluence);
  const sniper = obj(analysis?.sniper);

  const spot = num(entry?.spot);
  const zone = buyZone(entry?.buy_zone);
  const chaseAbove = num(entry?.chase_above);

  const present = [entry, confluence, sniper].filter(Boolean).length;
  const stale = bool(tape?.stale);

  return {
    availability: present === 0 ? "unavailable" : present === 3 ? "ready" : "partial",
    freshness: stale === true ? "stale" : stale === false ? "current" : "unknown",
    asof: {
      intel: str(root?.asof),
      confluence: str(confluence?.asof),
      sniper: str(sniper?.asof),
    },
    posture: {
      status: str(entry?.status),
      urgency: str(entry?.urgency),
      headline: str(entry?.headline),
      headlineZh: str(entry?.headline_zh),
      action: str(entry?.action),
      actionZh: str(entry?.action_zh),
    },
    bottomConfidence: num(entry?.confidence),
    trigger: {
      next: str(entry?.next_trigger),
      tier: str(confluence?.tier),
      sub: str(confluence?.sub),
      ticks: int(confluence?.ticks),
      barsToCross: num(confluence?.bars_to_cross),
      provisional: bool(confluence?.provisional),
      notTopped: bool(confluence?.not_topped),
      htfS1: bool(confluence?.htf_s1),
    },
    structure: {
      w2Washout: bool(sniper?.w2_washout),
      w2StochD: num(sniper?.w2_stoch_d),
      daysSince63dLow: int(sniper?.days_since_63d_low),
      coiled: bool(sniper?.coiled),
    },
    geometry: {
      spot,
      buyZone: zone,
      chaseAbove,
      stop: num(entry?.stop),
      location: location({ spot, zone, chaseAbove }),
    },
  };
}
