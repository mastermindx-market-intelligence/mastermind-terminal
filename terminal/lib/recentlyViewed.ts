/**
 * recentlyViewed.ts — device-local history of symbols whose charts were actually viewed.
 *
 * A search result is not recorded merely because it was typed or returned. TerminalShell calls
 * pushRecentlyViewed only when the active chart symbol changes, which also covers symbols opened
 * directly from Macro Dashboard. Entries are unique, most-recent first, and capped at 100.
 *
 * This intentionally uses a new key instead of migrating `mm.searchHistory`: carrying the old
 * search-driven list forward would mislabel searched-but-never-viewed symbols as recently viewed.
 */

export const RECENTLY_VIEWED_KEY = "mm.recentlyViewed";
export const RECENTLY_VIEWED_LIMIT = 100;

function normalizeSymbol(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const symbol = value.trim().toUpperCase();
  return symbol || null;
}

/** Pure update helper: normalize, move the viewed symbol to the front, deduplicate, and cap. */
export function prependRecentlyViewed(list: readonly unknown[], symbol: string): string[] {
  const viewed = normalizeSymbol(symbol);
  const normalized: string[] = [];
  const seen = new Set<string>();

  if (viewed) {
    normalized.push(viewed);
    seen.add(viewed);
  }

  for (const value of list) {
    const item = normalizeSymbol(value);
    if (!item || seen.has(item)) continue;
    normalized.push(item);
    seen.add(item);
    if (normalized.length === RECENTLY_VIEWED_LIMIT) break;
  }

  return normalized;
}

function readRaw(): string[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const value = localStorage.getItem(RECENTLY_VIEWED_KEY);
    const parsed: unknown = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? prependRecentlyViewed(parsed, "") : [];
  } catch {
    return [];
  }
}

function writeRaw(list: string[]): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(RECENTLY_VIEWED_KEY, JSON.stringify(list));
  } catch {}
}

/** Record a chart view, most-recent first. Repeated symbols move back to the front. */
export function pushRecentlyViewed(symbol: string): void {
  const next = prependRecentlyViewed(readRaw(), symbol);
  if (!next.length) return;
  writeRaw(next);
}

/** Read up to 100 unique viewed symbols, most-recent first. */
export function getRecentlyViewed(): string[] {
  return readRaw();
}

/** Clear the recently viewed list without touching the retired search-history key. */
export function clearRecentlyViewed(): void {
  writeRaw([]);
}
