// Pure team-accuracy rollup (packet W9T_F13_9 / MO-DELTA-007).
//
// A team can see its own calls scored together — never a ranking against other teams.
// The shape is the SAME AccuracyReadout the personal section renders, with three
// load-bearing differences that the seat ruling pins down:
//
//   1. The rows are a UNION of `user_claims` over the team's member user ids, NOT
//      another person's read of one user's claims, and NOT a cross-team aggregate.
//   2. There is no per-member leaderboard, no per-member hit-rate ordering, no
//      "member A is doing better than member B" line. The output's `stance`,
//      `hitRate`, `brierMean` and the claim list are computed from the TEAM'S rows
//      taken together, identical to the personal scorer but over the team's row set.
//   3. A team with zero member claims, or a row set the scorer cannot reduce, reads
//      as the empty readout — never as a misleading zero.
//
// This module is pure (no I/O). The route is responsible for sourcing the rows.
// Authority: packet `orch/w9/packets/w9t_f13_9.md` §SCOPE / §FROZEN SPEC.

import {
  scorePersonalAccuracy,
  type AccuracyClaimRow,
  type AccuracyReadout,
  type UserClaim,
} from "@/lib/personalAccuracy";

export const TEAM_ROLLUP_KEY = "teamRollup" as const;

export type TeamRollupResult =
  | {
      /** Always exactly one of these so callers never render an ambiguous state. */
      kind: "ok";
      /** The team's row set, scored together using the same scorer as personal. */
      readout: AccuracyReadout;
      /** The number of distinct member user ids whose rows were aggregated. */
      memberCount: number;
      /** How many of those members actually had at least one row in the ledger. */
      membersWithClaims: number;
    }
  | {
      kind: "empty_members";
      memberCount: number;
    }
  | {
      kind: "no_rows";
      memberCount: number;
      membersWithClaims: number;
    };

function uniqIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (typeof id !== "string" || !id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Score the team's own calls together. Pure.
 *
 * - `memberUserIds`: every account that belongs to this team right now. The route
 *   sources this from `team_members` (RLS-scope: caller must be a member of the team).
 * - `claims`: the ledger rows already filtered to those members. The route sources
 *   this from `user_claims WHERE user_id IN (...)`. We DO NOT trust the caller to
 *   have filtered correctly; we re-filter here so a misrouted read never leaks a
 *   row from outside the team.
 *
 * The scorer returns the same `AccuracyReadout` shape as the personal one, so the
 * UI can reuse every glance / detail helper SectionAccuracy already ships. The
 * "rollup" intent lives in the copy that wraps the section, not in a new scorer.
 */
export function rollupTeamAccuracy(
  memberUserIds: readonly string[],
  claims: readonly UserClaim[],
): TeamRollupResult {
  const ids = uniqIds(memberUserIds);
  if (ids.length === 0) {
    return { kind: "empty_members", memberCount: 0 };
  }
  const allowed = new Set(ids);
  const owned = claims.filter((c) => c && typeof c.user_id === "string" && allowed.has(c.user_id));

  const memberIdsWithClaims = new Set<string>();
  for (const c of owned) memberIdsWithClaims.add(c.user_id);

  if (owned.length === 0) {
    return { kind: "no_rows", memberCount: ids.length, membersWithClaims: 0 };
  }

  const readout = scorePersonalAccuracy(owned);
  return {
    kind: "ok",
    readout,
    memberCount: ids.length,
    membersWithClaims: memberIdsWithClaims.size,
  };
}

/** True iff this row would be visible in the personal section. The rollup reuses that same filter. */
export function rowLooksVisible(row: AccuracyClaimRow): boolean {
  return Boolean(row && row.claimId);
}
