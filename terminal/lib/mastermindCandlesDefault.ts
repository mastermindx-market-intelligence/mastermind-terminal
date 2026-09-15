import { setSuiteModuleEnabledParams } from "@/lib/suites/catalog";

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
  const params = Object.fromEntries(
    Object.entries(savedParams).map(([key, value]) => [key, { ...(value ?? {}) }]),
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

  return {
    indicators: nextIndicators,
    params,
    hidden: hidden.filter((id) => id !== MASTERMIND_CANDLES_MODULE_ID && id !== MASTERMIND_CANDLES_SUITE_KEY),
    changed: true,
  };
}
