import type { ServerWatchlist } from "./watchlists";

const label = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const position = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** Read the existing API's OWNED inventory. Shared grants never become writable lists.
 * No case folding, local migration, persistence, or ownership inference belongs here.
 */
export function paperOwnedWatchlists(value: unknown): ServerWatchlist[] | null {
  if (!record(value) || !Array.isArray(value.lists) || value.lists.length > 1000) return null;
  const lists: ServerWatchlist[] = [], ids = new Set<string>();
  for (const row of value.lists) {
    if (!record(row) || !label(row.id, 128) || ids.has(row.id) || !label(row.name, 80)
      || !position(row.position) || !Array.isArray(row.symbols) || row.symbols.length > 10000) return null;
    const symbols: ServerWatchlist["symbols"] = [], seen = new Set<string>();
    for (const item of row.symbols) {
      if (!record(item) || !label(item.symbol, 128) || seen.has(item.symbol)
        || typeof item.section !== "string" || item.section.length > 80 || !position(item.position)) return null;
      seen.add(item.symbol);
      symbols.push({ symbol:item.symbol, section:item.section, position:item.position });
    }
    ids.add(row.id);
    lists.push({ id:row.id, name:row.name, position:row.position, symbols });
  }
  return lists;
}
