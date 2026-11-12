/**
 * FIXTURE — breadth change by sector. Shape and column names are copied from
 * Macro #11128 head c81cdbfa8fe50e098b20b3782bc2899b7fcb39d7 and Macro #11094
 * head 52e5ad722ef7; unmerged; replace before arming.
 *
 * The two files sit on different price sources and are COMPARED, never joined
 * or spliced into one series: the live export owns the current share and the
 * meta (basis, as_of_week, counts_last_week); the archive family owns the
 * ranked 13-week like-for-like frame (engine/group_breadth_history.py at that
 * head: pct_above_<w>, fix_chg_pct_above_<w>_<k>w, rank_/n_ranked_/state_/run_
 * of the same metric, n_fixed_<w>_<k>w always present, MIN_MEMBERS = 10).
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
export interface SectorBreadthLiveWireWeekRow {
  date: string;
  group: string;
  pct_above_200: number | null;
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

/** GICS group wire names, in the order the archive emits them (sorted). */
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

const STALE_RULE =
  "label stale at two or more completed weekly closes behind the latest session";

function archiveRow(asOf: string, group: string, ranked: boolean): SectorBreadthArchiveWireRow {
  const world = FULL_WORLD[group];
  // Too-few world: Energy carries n_fixed 8 (< MIN_MEMBERS 10), so the engine
  // emits a missing change and rank — never zero — while n_fixed stays present.
  const [change, state, run, members] = world;
  const tooFew = !ranked;
  const rank = tooFew ? null : RANKS[group];
  return {
    date: asOf,
    group,
    n_members: members + 4,
    n_has_200: members + 2,
    pct_above_200: SHARES_NOW[group],
    fix_chg_pct_above_200_13w: tooFew ? null : change,
    rank_fix_chg_pct_above_200_13w: rank,
    n_ranked_fix_chg_pct_above_200_13w: tooFew ? 10 : 11,
    state_fix_chg_pct_above_200_13w: tooFew ? null : state,
    run_fix_chg_pct_above_200_13w: tooFew ? null : run,
    n_fixed_200_13w: tooFew ? 8 : members,
    lvl_diff_pct_above_200_13w: tooFew ? null : change - 0.4,
  };
}

/** Change → cross-rank (1 = largest increase), as cross_rank(method="min") emits. */
const RANKS: Record<string, number> = Object.fromEntries(
  [...SECTOR_BREADTH_FIXTURE_GROUPS]
    .map(g => [g, FULL_WORLD[g][0]] as const)
    .sort((a, b) => b[1] - a[1])
    .map((entry, i) => [entry[0], i + 1]),
);

function liveWire(asOf: string): SectorBreadthLiveWire {
  return {
    basis: "reconstructed_current_membership",
    basis_note: "fixture: today's members applied to the past",
    price_source: "fixture::daily_closes",
    price_vintage: asOf,
    as_of_week: asOf,
    stale_rule: STALE_RULE,
    counts_last_week: {
      by_sector: Object.fromEntries(SECTOR_BREADTH_FIXTURE_GROUPS.map(g => {
        const members = FULL_WORLD[g][3];
        return [g, { in_map: members + 4, n_members: members + 4, n_has_200: members + 2, n_fixed_200_13w: members }];
      })),
    },
    latest_week: SECTOR_BREADTH_FIXTURE_GROUPS.map(g => ({
      date: asOf, group: g, pct_above_200: SHARES_NOW[g],
    })),
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
  live: {
    ...liveWire("2026-11-06"),
    counts_last_week: {
      by_sector: {
        ...Object.fromEntries(SECTOR_BREADTH_FIXTURE_GROUPS.filter(g => g !== "Energy").map(g => {
          const members = FULL_WORLD[g][3];
          return [g, { in_map: members + 4, n_members: members + 4, n_has_200: members + 2, n_fixed_200_13w: members }];
        })),
        Energy: { in_map: 12, n_members: 12, n_has_200: 10, n_fixed_200_13w: 8 },
      },
    },
  },
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
 * The bridge from the two Macro files (compared, not joined) to the module
 * input the sector generation payload will carry later (L1-FO1).
 *
 * The share now comes from the LIVE export's own latest weekly row (its own
 * denominator, n_has_200); the change/rank/direction/run and the like-for-like
 * member count come from the ARCHIVE's latest row per group. Returns null —
 * the module's unavailable state — when no recognizable ranked frame exists.
 */
export function sectorBreadthChangeFromWire(
  live: SectorBreadthLiveWire | null | undefined,
  archive: SectorBreadthArchiveWire | null | undefined,
  latestSession: string,
): SectorBreadthChangeInput | null {
  if (!archive || !Array.isArray(archive.rows) || archive.rows.length === 0) return null;
  if (typeof latestSession !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(latestSession)) return null;

  const latestLiveByGroup = new Map<string, SectorBreadthLiveWireWeekRow>();
  for (const row of Array.isArray(live?.latest_week) ? live!.latest_week : []) {
    if (row && typeof row.group === "string") latestLiveByGroup.set(row.group, row);
  }
  // The latest archive row per group (rows are emitted per week; take the last).
  const lastArchiveByGroup = new Map<string, SectorBreadthArchiveWireRow>();
  for (const row of archive.rows) {
    if (row && typeof row.group === "string" && typeof row.date === "string") {
      const prev = lastArchiveByGroup.get(row.group);
      if (!prev || row.date >= prev.date) lastArchiveByGroup.set(row.group, row);
    }
  }
  if (lastArchiveByGroup.size === 0) return null;

  const asOfDate = [...lastArchiveByGroup.values()]
    .map(r => r.date).sort().pop() as string;
  const rows: SectorBreadthChangeRow[] = [...lastArchiveByGroup.keys()].map(group => {
    const a = lastArchiveByGroup.get(group)!;
    const l = latestLiveByGroup.get(group);
    const finite = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    return {
      sectorId: group,
      shareAbove200Now: finite(l?.pct_above_200),
      changePp: finite(a.fix_chg_pct_above_200_13w),
      rank: finite(a.rank_fix_chg_pct_above_200_13w),
      direction: a.state_fix_chg_pct_above_200_13w ?? null,
      runWeeks: finite(a.run_fix_chg_pct_above_200_13w),
      membersFixed13w: finite(a.n_fixed_200_13w),
    };
  });
  return {
    asOfDate,
    latestSession,
    basis: live?.basis ?? archive.basis ?? "",
    rows,
  };
}
