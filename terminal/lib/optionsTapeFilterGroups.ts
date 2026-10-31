/** Display-only AND-within / OR-between screens. No market or account storage. */
import { decodeTapeView, encodeTapeView, type TapeViewState } from "./optionsTapeView";

export const MAX_TAPE_FILTER_GROUPS = 4;
const MAX_LENGTH = 10_000;
export type TapeFilterEvent = {
  premium: number; dte_bucket: string; mny_bucket: string; group: string;
  root: string; side: string; right: string; repeated?: boolean; swept?: boolean; ts: string;
};

function normalizeGroups(views: readonly TapeViewState[]): TapeViewState[] {
  if (!Array.isArray(views) || views.length < 2 || views.length > MAX_TAPE_FILTER_GROUPS) throw new Error("invalid groups");
  // Do not discard a malformed member: that would silently alter the population.
  return Array.from(views, (view) => decodeTapeView(encodeTapeView(view))!);
}

export function encodeTapeFilterGroups(views: readonly TapeViewState[]): string {
  const encoded = JSON.stringify({ v: 1, groups: normalizeGroups(views).map(encodeTapeView) });
  if (encoded.length > MAX_LENGTH) throw new Error("groups too long");
  return encoded;
}

export function decodeTapeFilterGroups(encoded: string | null): TapeViewState[] | null {
  if (typeof encoded !== "string" || !encoded || encoded.length > MAX_LENGTH) return null;
  try {
    const raw: unknown = JSON.parse(encoded);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const value = raw as Record<string, unknown>;
    if (Object.keys(value).length !== 2 || !Object.hasOwn(value, "v") || !Object.hasOwn(value, "groups")
      || value.v !== 1 || !Array.isArray(value.groups)) return null;
    const decoded = value.groups.map((group: unknown) => typeof group === "string" ? decodeTapeView(group) : null);
    if (decoded.some((group) => group === null)) return null;
    return normalizeGroups(decoded as TapeViewState[]);
  } catch { return null; }
}

/** V1 links stay byte-compatible. Old clients reject a composed v2 link rather than broaden it. */
export function encodeTapeScreen(view: TapeViewState, groups?: readonly TapeViewState[]): string {
  if (groups === undefined) return encodeTapeView(view);
  return JSON.stringify({ v: 2, view: encodeTapeView(view), groups: encodeTapeFilterGroups(groups) });
}

export function decodeTapeScreen(encoded: string | null): { view: TapeViewState; groups?: TapeViewState[] } | null {
  const legacy = decodeTapeView(encoded);
  if (legacy) return { view: legacy };
  if (typeof encoded !== "string" || encoded.length > 14_000) return null;
  try {
    const raw: unknown = JSON.parse(encoded);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const value = raw as Record<string, unknown>;
    if (Object.keys(value).length !== 3 || value.v !== 2 || !Object.hasOwn(value, "view") || !Object.hasOwn(value, "groups")) return null;
    const view = decodeTapeView(typeof value.view === "string" ? value.view : null);
    const groups = decodeTapeFilterGroups(typeof value.groups === "string" ? value.groups : null);
    return view && groups ? { view, groups } : null;
  } catch { return null; }
}

function predicate(view: TapeViewState): (event: TapeFilterEvent) => boolean {
  const dte = new Set<string>(view.dteBuckets);
  const mny = new Set<string>(view.mnyBuckets);
  const group = view.drillTicker ? "" : view.groupFilter;
  const query = view.tapeTickerSearch.trim().toUpperCase();
  return (event) => {
    if (view.minPrem > 0 && event.premium < view.minPrem) return false;
    if (dte.size > 0 && !dte.has(event.dte_bucket)) return false;
    if (mny.size > 0 && !mny.has(event.mny_bucket)) return false;
    if (group && event.group !== group) return false;
    if (view.drillTicker && event.root !== view.drillTicker) return false;
    if (query && !event.root.includes(query)) return false;
    if (view.sideFilter && event.side !== view.sideFilter) return false;
    if (view.flagFilter === "repeated" && !event.repeated) return false;
    if (view.flagFilter === "put_buy" && !(event.right === "P" && event.side === "~buy")) return false;
    if (view.flagFilter === "swept" && !event.swept) return false;
    return true;
  };
}

/** Current controls refine the union. Sort once; never coalesce distinct feed rows. */
export function filterTapeEvents<T extends TapeFilterEvent>(
  events: readonly T[], view: TapeViewState, groups?: readonly TapeViewState[],
): T[] {
  try {
    const normalized = decodeTapeView(encodeTapeView(view))!;
    const matches = predicate(normalized);
    const alternatives = groups === undefined ? undefined : normalizeGroups(groups).map(predicate);
    return events.filter((event) => matches(event) && (!alternatives || alternatives.some((match) => match(event))))
      .sort((a, b) => {
        const va = normalized.sortKey === "ts" ? new Date(a.ts).getTime() : a.premium;
        const vb = normalized.sortKey === "ts" ? new Date(b.ts).getTime() : b.premium;
        return (va > vb ? 1 : va < vb ? -1 : 0) * normalized.sortDir;
      });
  } catch { return []; }
}
