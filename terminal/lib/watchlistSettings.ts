export type WatchlistSettings = {
  tableView: boolean;
  cols: {
    last: boolean;
    changePct: boolean;
    change: boolean;
    volume: boolean;
    ext: boolean;
    extPct: boolean;
  };
  disp: string;
  logo: boolean;
  colW: Record<string, number>;
};

export const WATCHLIST_SETTINGS_KEY = "mm.set";
export const WATCHLIST_SETTINGS_VERSION_KEY = "mm.setVersion";
export const WATCHLIST_SETTINGS_VERSION = 1;

export const DEFAULT_WATCHLIST_SETTINGS: WatchlistSettings = {
  tableView: true,
  cols: {
    last: true,
    changePct: true,
    change: false,
    volume: false,
    ext: true,
    extPct: true,
  },
  disp: "symbol",
  logo: true,
  colW: {},
};

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

/**
 * Resolves the persisted watchlist presentation and applies one-time migrations.
 *
 * Version 1 rolls the ticker-logo launch out to workspaces whose old `logo:false`
 * value came from the former default. Once the marker is written, a user can turn
 * logos off again and that explicit choice remains authoritative.
 */
export function resolveWatchlistSettings(
  saved: unknown,
  storedVersion: number,
): {
  settings: WatchlistSettings;
  migrated: boolean;
  version: number;
} {
  const persisted = record(saved);
  const cols = record(persisted.cols);
  const colW = Object.fromEntries(
    Object.entries(record(persisted.colW)).filter(([, width]) =>
      typeof width === "number" && Number.isFinite(width) && width >= 44),
  ) as Record<string, number>;
  const migrated = !Number.isFinite(storedVersion) || storedVersion < WATCHLIST_SETTINGS_VERSION;

  const settings: WatchlistSettings = {
    ...DEFAULT_WATCHLIST_SETTINGS,
    ...persisted,
    cols: {
      ...DEFAULT_WATCHLIST_SETTINGS.cols,
      ...cols,
    },
    colW: { ...colW },
    logo: migrated ? true : persisted.logo !== false,
  } as WatchlistSettings;

  return {
    settings,
    migrated,
    version: WATCHLIST_SETTINGS_VERSION,
  };
}
