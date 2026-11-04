/**
 * Pure row selectors for the six Options Screener views.
 *
 * OptionsHubView and CSV export both consume these arrays so the downloaded
 * artifact cannot silently diverge from the filtered/sorted table on screen.
 * These are descriptive, display-only transforms over already-published rows;
 * they do not create a score, direction, rank, or execution instruction.
 */

export type ScreenerPreset = "top_prem" | "unusual_z" | "fresh" | "doi" | "zerodte" | "hot";
export type ScreenerHotView = "by_premium" | "by_volume";
export type ScreenerSortDirection = 1 | -1;

export interface ScreenerFilter {
  root: string;
  group: string;
}

export interface ScreenerNameSource {
  root: string;
  group: string;
  group_zh: string;
  gross_premium_today: number;
  prem_z: number | null;
  baseline_source: string;
  n_obs: number;
  call_prem_share: number;
}

export interface ScreenerEventSource {
  root: string;
  group: string;
  group_zh: string;
  premium: number;
  vol_gt_oi: boolean | null;
  zerodte: boolean;
}

export interface ScreenerOiSource {
  root: string;
  right: "C" | "P";
  exp: string;
  strike: number;
  oi: number;
  oi_prev: number;
  d_oi: number;
  mid: number | null;
}

export interface ScreenerHotSource {
  root: string;
  right: "C" | "P";
  exp: string;
  strike: number;
  premium: number;
  vol: number;
  oi_prev: number | null;
  vol_gt_oi: boolean | null;
  close: number;
}

export interface ScreenerNameRow extends ScreenerNameSource {
  preset: "top_prem" | "unusual_z";
}

export interface ScreenerFreshRow {
  preset: "fresh";
  root: string;
  group: string;
  group_zh: string;
  n: number;
  prem: number;
}

export interface ScreenerOiRow extends ScreenerOiSource {
  preset: "doi";
}

export interface ScreenerZeroDteRow {
  preset: "zerodte";
  root: string;
  group: string;
  group_zh: string;
  zd_prem: number;
  total_prem: number;
  zd_share: number | null;
}

export interface ScreenerHotRow extends ScreenerHotSource {
  preset: "hot";
}

export type OptionsScreenerCsvRow =
  | ScreenerNameRow
  | ScreenerFreshRow
  | ScreenerOiRow
  | ScreenerZeroDteRow
  | ScreenerHotRow;

function matchesFilter(
  row: { root: string; group?: string },
  filter: ScreenerFilter,
): boolean {
  return (!filter.root || row.root === filter.root)
    && (!filter.group || row.group === filter.group);
}

/** Missing and non-finite values sort last in both directions; a real zero remains a value. */
function compareFiniteLast(a: number | null, b: number | null, direction: ScreenerSortDirection): number {
  const hasA = a !== null && Number.isFinite(a);
  const hasB = b !== null && Number.isFinite(b);
  if (hasA !== hasB) return hasA ? -1 : 1;
  if (!hasA || !hasB) return 0;
  return ((a as number) - (b as number)) * direction;
}

export function selectTopPremiumRows(
  names: readonly ScreenerNameSource[],
  filter: ScreenerFilter,
  sortKey: string,
  sortDir: ScreenerSortDirection,
): ScreenerNameRow[] {
  return names
    .filter((row) => matchesFilter(row, filter))
    .map((row) => ({ ...row, preset: "top_prem" as const }))
    .sort((a, b) => {
      if (sortKey === "gross") return (a.gross_premium_today - b.gross_premium_today) * sortDir;
      if (sortKey === "z") return ((a.prem_z ?? -999) - (b.prem_z ?? -999)) * sortDir;
      if (sortKey === "call_share") return (a.call_prem_share - b.call_prem_share) * sortDir;
      return b.gross_premium_today - a.gross_premium_today;
    });
}

export function selectUnusualRows(
  names: readonly ScreenerNameSource[],
  filter: ScreenerFilter,
  sortKey: string,
  sortDir: ScreenerSortDirection,
): ScreenerNameRow[] {
  return names
    .filter((row) => row.prem_z != null && matchesFilter(row, filter))
    .map((row) => ({ ...row, preset: "unusual_z" as const }))
    .sort((a, b) => {
      if (sortKey === "gross") return (a.gross_premium_today - b.gross_premium_today) * sortDir;
      if (sortKey === "call_share") return (a.call_prem_share - b.call_prem_share) * sortDir;
      if (sortKey === "z") return (Math.abs(a.prem_z ?? 0) - Math.abs(b.prem_z ?? 0)) * sortDir;
      return Math.abs(b.prem_z ?? 0) - Math.abs(a.prem_z ?? 0);
    });
}

export function selectFreshRows(
  events: readonly ScreenerEventSource[],
  names: readonly Pick<ScreenerNameSource, "root" | "group" | "group_zh">[],
  filter: ScreenerFilter,
  sortKey: string,
  sortDir: ScreenerSortDirection,
): ScreenerFreshRow[] {
  const freshCounts: Record<string, number> = {};
  const freshPrem: Record<string, number> = {};
  for (const event of events) {
    if (!matchesFilter(event, filter) || !event.vol_gt_oi) continue;
    freshCounts[event.root] = (freshCounts[event.root] ?? 0) + 1;
    freshPrem[event.root] = (freshPrem[event.root] ?? 0) + event.premium;
  }

  const nameMap: Record<string, { group: string; group_zh: string }> = {};
  for (const name of names) nameMap[name.root] = { group: name.group, group_zh: name.group_zh };

  return Object.entries(freshCounts)
    .map(([root, n]): ScreenerFreshRow => ({
      preset: "fresh",
      root,
      n,
      prem: freshPrem[root] ?? 0,
      group: nameMap[root]?.group ?? "",
      group_zh: nameMap[root]?.group_zh ?? "",
    }))
    .sort((a, b) => {
      if (sortKey === "n") return (a.n - b.n) * sortDir;
      if (sortKey === "prem") return (a.prem - b.prem) * sortDir;
      return b.prem - a.prem;
    });
}

export function selectOiRows(
  movers: readonly ScreenerOiSource[],
  filter: ScreenerFilter,
  sortKey: string,
  sortDir: ScreenerSortDirection,
): ScreenerOiRow[] {
  return movers
    .filter((row) => matchesFilter(row, { root: filter.root, group: "" }))
    .map((row) => ({ ...row, preset: "doi" as const }))
    .sort((a, b) => {
      if (sortKey === "doi") return (Math.abs(a.d_oi) - Math.abs(b.d_oi)) * sortDir;
      if (sortKey === "oi") return (a.oi - b.oi) * sortDir;
      if (sortKey === "mid") return compareFiniteLast(a.mid, b.mid, sortDir);
      return Math.abs(b.d_oi) - Math.abs(a.d_oi);
    });
}

export function selectZeroDteRows(
  events: readonly ScreenerEventSource[],
  filter: ScreenerFilter,
  sortKey: string,
  sortDir: ScreenerSortDirection,
): ScreenerZeroDteRow[] {
  const zeroDtePremium: Record<string, number> = {};
  const totalPremium: Record<string, number> = {};
  const nameMap: Record<string, { group: string; group_zh: string }> = {};

  for (const event of events) {
    if (!matchesFilter(event, filter)) continue;
    totalPremium[event.root] = (totalPremium[event.root] ?? 0) + event.premium;
    if (event.zerodte) zeroDtePremium[event.root] = (zeroDtePremium[event.root] ?? 0) + event.premium;
    nameMap[event.root] = { group: event.group, group_zh: event.group_zh };
  }

  return Object.keys(zeroDtePremium)
    .map((root): ScreenerZeroDteRow => ({
      preset: "zerodte",
      root,
      zd_prem: zeroDtePremium[root],
      total_prem: totalPremium[root] ?? 0,
      zd_share: (totalPremium[root] ?? 0) > 0 ? zeroDtePremium[root] / totalPremium[root] : null,
      group: nameMap[root]?.group ?? "",
      group_zh: nameMap[root]?.group_zh ?? "",
    }))
    .sort((a, b) => {
      if (sortKey === "share") return compareFiniteLast(a.zd_share, b.zd_share, sortDir);
      if (sortKey === "prem") return (a.zd_prem - b.zd_prem) * sortDir;
      return b.zd_prem - a.zd_prem;
    });
}

export function selectHotRows(
  contracts: readonly ScreenerHotSource[],
  filter: ScreenerFilter,
): ScreenerHotRow[] {
  return contracts
    .filter((row) => matchesFilter(row, { root: filter.root, group: "" }))
    .map((row) => ({ ...row, preset: "hot" as const }));
}

export interface ResolvedScreenerSort {
  key: string;
  direction: "asc" | "desc" | "source";
}

/** Describe the exact ordering represented by the selected row array. */
export function resolveScreenerSort(
  preset: ScreenerPreset,
  sortKey: string,
  sortDir: ScreenerSortDirection,
  hotView: ScreenerHotView,
): ResolvedScreenerSort {
  if (preset === "hot") {
    return { key: hotView === "by_premium" ? "premium" : "volume", direction: "source" };
  }
  if (sortKey) {
    const key = preset === "unusual_z" && sortKey === "z"
      ? "abs_premium_z"
      : preset === "doi" && sortKey === "doi"
        ? "abs_d_oi"
        : sortKey;
    return { key, direction: sortDir === -1 ? "desc" : "asc" };
  }
  const defaults: Record<Exclude<ScreenerPreset, "hot">, string> = {
    top_prem: "gross_premium_today",
    unusual_z: "abs_premium_z",
    fresh: "premium",
    doi: "abs_d_oi",
    zerodte: "zerodte_premium",
  };
  return { key: defaults[preset], direction: "desc" };
}
