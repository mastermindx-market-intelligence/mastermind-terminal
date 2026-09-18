import { enabledModulesForSuite, setSuiteModuleEnabledParams } from "@/lib/suites/catalog";

export const MASTERMIND_CANDLES_MIGRATION_KEY = "mm.mastermindCandles.v1";
export const MASTERMIND_CANDLES_SUITE_KEY = "trend";
export const MASTERMIND_CANDLES_MODULE_ID = "suite:trend/cp";

type SavedParams = Record<string, Record<string, unknown>>;

export interface MastermindCandlesMigration {
  indicators: string[];
  params: SavedParams;
  hidden: string[];
  changed: boolean;
}

/**
 * One-time rollout for Mastermind Candles.
 *
 * The parent Trend Waves suite is the existing runtime carrier; this does not create a second
 * indicator/persistence plane. For a user who did not already have Trend Waves active, enable only
 * the candle surface so the rollout does not silently add Trend Engine/Flow Band/etc. For an
 * existing Trend Waves user, preserve every sibling choice and simply switch Mastermind Candles on.
 *
 * Once the migration marker is present, state is returned untouched so a later user removal stays
 * removed permanently.
 */
export function migrateMastermindCandlesDefault(
  indicators: readonly string[],
  savedParams: Readonly<Record<string, Readonly<Record<string, unknown>> | undefined>>,
  hidden: readonly string[],
  alreadyMigrated: boolean,
): MastermindCandlesMigration {
  // Browser storage is an untrusted JSON boundary, even when TypeScript callers are typed.
  const object = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);
  indicators = Array.isArray(indicators) ? indicators.filter((id) => typeof id === "string") : [];
  hidden = Array.isArray(hidden) ? hidden.filter((id) => typeof id === "string") : [];
  const params = Object.fromEntries(
    Object.entries(object(savedParams) ? savedParams : {}).map(([key, value]) => [key, object(value) ? { ...value } : {}]),
  ) as SavedParams;

  if (alreadyMigrated) {
    return { indicators: [...indicators], params, hidden: [...hidden], changed: false };
  }

  const parentActive = indicators.includes(MASTERMIND_CANDLES_SUITE_KEY);
  const nextIndicators = parentActive
    ? [...indicators]
    : [...indicators, MASTERMIND_CANDLES_SUITE_KEY];

  params[MASTERMIND_CANDLES_SUITE_KEY] = setSuiteModuleEnabledParams(
    MASTERMIND_CANDLES_MODULE_ID,
    params[MASTERMIND_CANDLES_SUITE_KEY],
    true,
    parentActive,
  );

  const nextHidden = new Set(hidden.filter((id) => id !== MASTERMIND_CANDLES_MODULE_ID && id !== MASTERMIND_CANDLES_SUITE_KEY));
  // Preserve the effective visibility of every sibling when translating the legacy suite-wide eye.
  if (parentActive && hidden.includes(MASTERMIND_CANDLES_SUITE_KEY)) {
    for (const entry of enabledModulesForSuite(MASTERMIND_CANDLES_SUITE_KEY, indicators, params)) {
      if (entry.id !== MASTERMIND_CANDLES_MODULE_ID) nextHidden.add(entry.id);
    }
  }
  return {
    indicators: nextIndicators,
    params,
    hidden: [...nextHidden],
    changed: true,
  };
}

/** Preserve the existing suite-based anonymous cap, exempting only a candle-only carrier. */
export function isAmbientCandleSuite(indicators: Iterable<string>, params: SavedParams): boolean {
  const active = enabledModulesForSuite(MASTERMIND_CANDLES_SUITE_KEY, indicators, params);
  return active.length === 1 && active[0].id === MASTERMIND_CANDLES_MODULE_ID;
}
