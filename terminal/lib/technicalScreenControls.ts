// ── Screener technical-screen controls → TechnicalScreen (E01) ──────────────────
// The Screener's technical controls are a small UI model; this module is the ONE mapping from it
// to the frozen `TechnicalScreen` contract (lib/technicalScan.ts), so the browser never encodes a
// predicate any other way. Every control maps to a source state field verbatim — no thresholds on
// a derived score, no blended rank, no inference from OHLC.

import { accountCoverage, type CoverageAccount } from "./screenerScan";
import {
  KNOWN_SIGNAL_TYPES,
  classifyTechnical,
  type TechnicalPredicate,
  type TechnicalScanSource,
  type TechnicalScreen,
} from "./technicalScan";

export const TECH_DEFAULT_TF = "3D";

export type TechSignalPick = "any" | "buyside" | (typeof KNOWN_SIGNAL_TYPES)[number];
export const TECH_SIGNAL_PICKS: readonly TechSignalPick[] = ["any", "buyside", ...KNOWN_SIGNAL_TYPES];
/** The buy-side signal family, as the flagship board groups it (ScreenerView `isBuy`). */
export const TECH_BUYSIDE: readonly string[] = ["BUY", "REBUY", "RECLAIM"];

export const TECH_BARS_MAX = [3, 10, 20] as const;

/** Each chip is one fixed boolean predicate on a published state field. */
export const TECH_CHIPS = {
  strongBull: { field: "tech.strongBull", value: true, key: "tsStrongBull" },
  weeklyBull: { field: "tech.weeklyBull", value: true, key: "tsWeeklyBull" },
  above200: { field: "tech.above200", value: true, key: "tsAbove200" },
  notOverbought: { field: "tech.overbought", value: false, key: "tsNotOverbought" },
  barClosed: { field: "tech.barClosed", value: true, key: "tsBarClosed" },
} as const;
export type TechChipId = keyof typeof TECH_CHIPS;
export const TECH_CHIP_IDS = Object.keys(TECH_CHIPS) as TechChipId[];

export type TechControls = {
  tf: string;
  position: "any" | "long" | "flat";
  signal: TechSignalPick;
  /** 0 = no bound. */
  barsMax: 0 | (typeof TECH_BARS_MAX)[number];
  chips: readonly TechChipId[];
  /** Let a name that was not evaluated (stale, unsupported, unavailable, value not published)
   *  pass instead of being hidden. Never turns an unknown into a pass silently: the strip
   *  discloses the count either way. */
  includeUnknown: boolean;
};

export const TECH_DEFAULT_CONTROLS: TechControls = {
  tf: TECH_DEFAULT_TF, position: "any", signal: "any", barsMax: 0, chips: [], includeUnknown: false,
};

/** True when at least one predicate is set (the tf alone screens nothing). */
export const techControlsActive = (c: TechControls): boolean =>
  c.position !== "any" || c.signal !== "any" || c.barsMax !== 0 || c.chips.length > 0;

export function technicalScreenOf(c: TechControls): TechnicalScreen {
  const inc = c.includeUnknown ? { includeUnknown: true } : {};
  const predicates: TechnicalPredicate[] = [];
  if (c.position !== "any") predicates.push({ field: "tech.position", op: "in", values: [c.position], ...inc });
  if (c.signal !== "any") {
    predicates.push({ field: "tech.lastSignal", op: "in", values: c.signal === "buyside" ? [...TECH_BUYSIDE] : [c.signal], ...inc });
  }
  if (c.barsMax !== 0) predicates.push({ field: "tech.barsSinceSignal", op: "range", lte: c.barsMax, ...inc });
  for (const id of TECH_CHIP_IDS) {
    if (!c.chips.includes(id)) continue;
    const chip = TECH_CHIPS[id];
    predicates.push({ field: chip.field, op: "is", value: chip.value, ...inc });
  }
  return { tf: c.tf, predicates };
}

export const toggleTechChip = (chips: readonly TechChipId[], id: TechChipId): TechChipId[] =>
  chips.includes(id) ? chips.filter((x) => x !== id) : [...chips, id];

/**
 * The coverage strip's numbers in one pass over the REQUESTED universe (the manifest ids the
 * Screener loaded): the four populations (sum === total, AC-E01-02) plus how many evaluated names
 * sit on a forming bar (producer-published `bar_closed === false`, never derived here).
 */
export function technicalCoverageSummary(
  requestedIds: Iterable<string>,
  source: TechnicalScanSource,
  tf: string,
  now: number,
): { account: CoverageAccount; forming: number } {
  let forming = 0;
  const account = accountCoverage(requestedIds, (id) => {
    const c = classifyTechnical(source, id, tf, now);
    if (c.coverage.status === "evaluated" && c.observation?.cutoff.bar_closed === false) forming++;
    return c.coverage;
  });
  return { account, forming };
}
