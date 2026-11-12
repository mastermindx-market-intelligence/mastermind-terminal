/**
 * FIXTURE — breadth change by sector. Shape and column names are copied from
 * Macro #11128 head 0103db6e296bacbd97ab339b6fc41637add667f6 and Macro #11094
 * head 52e5ad722ef7; unmerged; replace before arming.
 *
 * The two files sit on different price sources (the live meta's own
 * separate_sources line: "They are compared, not joined"). The LIVE export
 * owns the ENTIRE displayed current frame — its weekly rows carry the full
 * block (pct_above_200, fix_chg_pct_above_200_13w, rank_/n_ranked_/state_/run_
 * of the same metric, n_fixed_200_13w; columns verified at the head above) —
 * plus the meta (basis, as_of_week, counts_last_week). The ARCHIVE family is
 * the long history on its own price source (engine/group_breadth_history.py at
 * that head: same column logic, MIN_MEMBERS = 10). Nothing displayed is taken
 * from the archive, and no value ever mixes the two sources.
 *
 * Member count ruling (duty officer 2026-11-12): the count the Brief shows is
 * n_fixed_200_13w, the like-for-like set — Financials 76 in the live file —
 * read from the live meta's counts_last_week.by_sector, never the archive's
 * own n_fixed and never n_members.
 *
 * Every VALUE below is synthetic example data for layout and state tests — it
 * is not a specimen of real market output. The adapter at the bottom is the
 * only bridge from these wire shapes to the module input the sector generation
 * payload will carry later (L1-FO1). No network path reads anything here.
 */
import type {
  SectorBreadthChangeInput,
  SectorBreadthChangeRow,
} from "@/components/sector-intelligence/SectorBreadthChange";

// ---------------------------------------------------------------- wire shapes

/** Live export: meta keys of group_breadth_weekly_current_live.meta.json. */
export interface SectorBreadthLiveWireSectorCounts {
  in_map: number;
  n_members: number;
  n_has_200: number;
  n_fixed_200_13w: number;
}
/** Live export: one weekly row of group_breadth_weekly_current_live.parquet.
 * The latest week of this frame is everything the module displays. */
export interface SectorBreadthLiveWireWeekRow {
  date: string;
  group: string;
  pct_above_200: number | null;
  fix_chg_pct_above_200_13w: number | null;
  rank_fix_chg_pct_above_200_13w: number | null;
  state_fix_chg_pct_above_200_13w: "improving" | "deteriorating" | "flat" | null;
  run_fix_chg_pct_above_200_13w: number | null;
  n_fixed_200_13w: number;
}
export interface SectorBreadthLiveWire {
  basis: string;
  basis_note: string;
  price_source: string;
  price_vintage: string;
  as_of_week: string;
  stale_rule: string;
  counts_last_week: { by_sector: Record<string, SectorBreadthLiveWireSectorCounts> };
  /** Latest weekly row per group (the live file's own long frame). */
  latest_week: SectorBreadthLiveWireWeekRow[];
}

/** Archive family: long weekly frame of group_breadth_weekly_current.parquet. */
export interface SectorBreadthArchiveWireRow {
  date: string;
  group: string;
  n_members: number;
  n_has_200: number;
  pct_above_200: number | null;
  fix_chg_pct_above_200_13w: number | null;
  rank_fix_chg_pct_above_200_13w: number | null;
  n_ranked_fix_chg_pct_above_200_13w: number | null;
  state_fix_chg_pct_above_200_13w: "improving" | "deteriorating" | "flat" | null;
  run_fix_chg_pct_above_200_13w: number | null;
  n_fixed_200_13w: number;
  lvl_diff_pct_above_200_13w: number | null;
}
export interface SectorBreadthArchiveWire {
  as_of: string;
  basis: string;
  stale_rule: string;
  rows: SectorBreadthArchiveWireRow[];
}

// ------------------------------------------------------------------ the worlds

/** GICS group wire names, in the order the frames emit them (sorted). */
export const SECTOR_BREADTH_FIXTURE_GROUPS = [
  "Communication Services", "Consumer Discretionary", "Consumer Staples", "Energy",
  "Financials", "Health Care", "Industrials", "Materials", "Real Estate",
  "Technology", "Utilities",
] as const;

/** Board R7 example rows: sector → [change pp, direction, run weeks, n_fixed]. */
const FULL_WORLD: Record<string, [number, "improving" | "deteriorating", number, number]> = {
  Utilities: [21.4, "improving", 6, 69],
  "Consumer Staples": [14.2, "improving", 9, 33],
  "Health Care": [9.8, "improving", 4, 47],
  "Real Estate": [6.1, "improving", 3, 12],
  Energy: [3.7, "improving", 2, 21],
  Financials: [1.2, "improving", 1, 55],
  Materials: [-2.8, "deteriorating", 2, 28],
  Industrials: [-5.9, "deteriorating", 5, 44],
  "Consumer Discretionary": [-9.4, "deteriorating", 7, 76],
  "Communication Services": [-14.5, "deteriorating", 4, 38],
  Technology: [-19.6, "deteriorating", 8, 82],
};

/** Board R7 example: share above the 200-session average now, 0–100 (NOT pp). */
const SHARES_NOW: Record<string, number> = {
  Utilities: 78.6,
  "Consumer Staples": 71.1,
  "Health Care": 62.7,
  "Real Estate": 58.1,
  Energy: 45.5,
  Financials: 66.7,
  Materials: 46.2,
  Industrials: 57.1,
  "Consumer Discretionary": 38.0,
  "Communication Services": 40.9,
  Technology: 34.8,
};

/** The live file's like-for-like count for Financials is 76 while the archive
 * history prices a smaller set — the two frames genuinely differ, and the
 * member count shown is the live one (duty officer 2026-11-12). */
const LIVE_COUNTS_OVERRIDE: Record<string, SectorBreadthLiveWireSectorCounts> = {
  Financials: { in_map: 80, n_members: 79, n_has_200: 78, n_fixed_200_13w: 76 },
};

const STALE_RULE =
  "label stale at two or more completed weekly closes behind the latest session";

/** Change → cross-rank (1 = largest increase), as cross_rank(method="min") emits. */
const RANKS: Record<string, number> = Object.fromEntries(
  [...SECTOR_BREADTH_FIXTURE_GROUPS]
    .map(g => [g, FULL_WORLD[g][0]] as const)
    .sort((a, b) => b[1] - a[1])
    .map((entry, i) => [entry[0], i + 1]),
);

function liveRow(asOf: string, group: string, ranked: boolean): SectorBreadthLiveWireWeekRow {
  const [change, state, run] = FULL_WORLD[group];
  const tooFew = !ranked;
  return {
    date: asOf,
    group,
    pct_above_200: SHARES_NOW[group],
    fix_chg_pct_above_200_13w: tooFew ? null : change,
    rank_fix_chg_pct_above_200_13w: tooFew ? null : RANKS[group],
    state_fix_chg_pct_above_200_13w: tooFew ? null : state,
    run_fix_chg_pct_above_200_13w: tooFew ? null : run,
    n_fixed_200_13w: tooFew ? 8 : LIVE_COUNTS_OVERRIDE[group]?.n_fixed_200_13w ?? FULL_WORLD[group][3],
  };
}

function liveCounts(group: string, ranked: boolean): SectorBreadthLiveWireSectorCounts {
  if (!ranked) return { in_map: 12, n_members: 12, n_has_200: 10, n_fixed_200_13w: 8 };
  const members = FULL_WORLD[group][3];
  const override = LIVE_COUNTS_OVERRIDE[group];
  return override ?? { in_map: members + 4, n_members: members + 4, n_has_200: members + 2, n_fixed_200_13w: members };
}

function liveWire(asOf: string, rankedGroups: (g: string) => boolean = () => true): SectorBreadthLiveWire {
  return {
    basis: "reconstructed_current_membership",
    basis_note: "fixture: today's members applied to the past",
    price_source: "fixture::daily_closes",
    price_vintage: asOf,
    as_of_week: asOf,
    stale_rule: STALE_RULE,
    counts_last_week: {
      by_sector: Object.fromEntries(
        SECTOR_BREADTH_FIXTURE_GROUPS.map(g => [g, liveCounts(g, rankedGroups(g))] as const)),
    },
    latest_week: SECTOR_BREADTH_FIXTURE_GROUPS.map(g => liveRow(asOf, g, rankedGroups(g))),
  };
}

function archiveRow(asOf: string, group: string, ranked: boolean): SectorBreadthArchiveWireRow {
  const [change, state, run, members] = FULL_WORLD[group];
  const tooFew = !ranked;
  return {
    date: asOf,
    group,
    n_members: members + 4,
    n_has_200: members + 2,
    pct_above_200: SHARES_NOW[group],
    fix_chg_pct_above_200_13w: tooFew ? null : change,
    rank_fix_chg_pct_above_200_13w: tooFew ? null : RANKS[group],
    n_ranked_fix_chg_pct_above_200_13w: tooFew ? 10 : 11,
    state_fix_chg_pct_above_200_13w: tooFew ? null : state,
    run_fix_chg_pct_above_200_13w: tooFew ? null : run,
    n_fixed_200_13w: tooFew ? 8 : members,
    lvl_diff_pct_above_200_13w: tooFew ? null : change - 0.4,
  };
}

export interface SectorBreadthFixtureWorld {
  live: SectorBreadthLiveWire;
  archive: SectorBreadthArchiveWire;
  latestSession: string;
}

/** Fresh, full: as-of 6 Nov 2026, eleven sectors ranked. */
export const sectorBreadthFixtureFreshFull: SectorBreadthFixtureWorld = {
  live: liveWire("2026-11-06"),
  archive: {
    as_of: "2026-11-06",
    basis: "reconstructed_current_membership",
    stale_rule: STALE_RULE,
    rows: SECTOR_BREADTH_FIXTURE_GROUPS.map(g => archiveRow("2026-11-06", g, true)),
  },
  latestSession: "2026-11-06",
};

/** Fresh, too few: Energy at 8 like-for-like members — change and rank missing,
 * share 45.5 and the member count stay (deltas 2, 6, 7). */
export const sectorBreadthFixtureFreshTooFew: SectorBreadthFixtureWorld = {
  live: liveWire("2026-11-06", g => g !== "Energy"),
  archive: {
    as_of: "2026-11-06",
    basis: "reconstructed_current_membership",
    stale_rule: STALE_RULE,
    rows: SECTOR_BREADTH_FIXTURE_GROUPS.map(g => archiveRow("2026-11-06", g, g !== "Energy")),
  },
  latestSession: "2026-11-06",
};

/** Stale: data through 18 Sep 2026 against a 6 Nov 2026 latest session —
 * exactly 7 completed weekly closes behind (board S19 scenario). */
export const sectorBreadthFixtureStale: SectorBreadthFixtureWorld = {
  live: liveWire("2026-09-18"),
  archive: {
    as_of: "2026-09-18",
    basis: "reconstructed_current_membership",
    stale_rule: STALE_RULE,
    rows: SECTOR_BREADTH_FIXTURE_GROUPS.map(g => archiveRow("2026-09-18", g, true)),
  },
  latestSession: "2026-11-06",
};

// -------------------------------------------------------------------- adapter

/**
 * The bridge from the two Macro files (compared, never joined) to the module
 * input the sector generation payload will carry later (L1-FO1).
 *
 * Provenance (duty officer 2026-11-12, columns verified at the live head):
 * the ENTIRE current frame — share now, change, rank, direction, run — comes
 * from the LIVE export's latest weekly row; the member count shown is the live
 * meta's counts_last_week.by_sector.n_fixed_200_13w (the like-for-like set;
 * Financials 76), falling back to the live row's own n_fixed; as-of is the
 * live meta's as_of_week. The ARCHIVE is the long history on a different
 * price source: no displayed value is taken from it and nothing is ever
 * spliced across the two sources. Returns null — the module's unavailable
 * state — when the live wire carries no recognizable current frame.
 */
export function sectorBreadthChangeFromWire(
  live: SectorBreadthLiveWire | null | undefined,
  archive: SectorBreadthArchiveWire | null | undefined,
  latestSession: string,
): SectorBreadthChangeInput | null {
  if (!live || !Array.isArray(live.latest_week) || live.latest_week.length === 0) return null;
  if (typeof latestSession !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(latestSession)) return null;

  // The latest live row per group (rows are emitted per week; take the last).
  const lastLiveByGroup = new Map<string, SectorBreadthLiveWireWeekRow>();
  for (const row of live.latest_week) {
    if (row && typeof row.group === "string" && typeof row.date === "string") {
      const prev = lastLiveByGroup.get(row.group);
      if (!prev || row.date >= prev.date) lastLiveByGroup.set(row.group, row);
    }
  }
  if (lastLiveByGroup.size === 0) return null;

  const counts = live.counts_last_week?.by_sector ?? {};
  const asOfDate = /^\d{4}-\d{2}-\d{2}$/.test(live.as_of_week ?? "")
    ? live.as_of_week
    : [...lastLiveByGroup.values()].map(r => r.date).sort().pop() as string;
  const finite = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const rows: SectorBreadthChangeRow[] = [...lastLiveByGroup.keys()].map(group => {
    const r = lastLiveByGroup.get(group)!;
    return {
      sectorId: group,
      shareAbove200Now: finite(r.pct_above_200),
      changePp: finite(r.fix_chg_pct_above_200_13w),
      rank: finite(r.rank_fix_chg_pct_above_200_13w),
      direction: r.state_fix_chg_pct_above_200_13w ?? null,
      runWeeks: finite(r.run_fix_chg_pct_above_200_13w),
      membersFixed13w: finite(counts[group]?.n_fixed_200_13w) ?? finite(r.n_fixed_200_13w),
    };
  });
  return {
    asOfDate,
    latestSession,
    basis: live.basis ?? archive?.basis ?? "",
    rows,
  };
}
