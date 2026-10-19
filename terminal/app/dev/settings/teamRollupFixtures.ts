// Dev-harness / test fixtures for W9T_F13_9 / MO-DELTA-007. Never imported by
// the production scorer or the /api/teams/[id]/accuracy/rollup route.
//
// The team rollup block in the dev/settings harness is fed by a fixture so
// every rollup state (ok / no_rows / empty_members) can be cropped without a
// real Supabase backend. The fixture's USER_IDS match the DEV_TEAM roster in
// page.tsx so member-counts read the same on both sides of the rail.

import { scorePersonalAccuracy, type UserClaim } from "@/lib/personalAccuracy";
import { rollupTeamAccuracy, type TeamRollupResult } from "@/lib/teamRollup";

const CHRIS = "8f2c41ba-7d19-4e6a-9c03-5b71ee0a4d22";
const ALEX = "a1b2c3d4-1111-4e6a-9c03-5b71ee0a4d22";
const JORDAN = "b2c3d4e5-2222-4e6a-9c03-5b71ee0a4d22";
const MEMBER_4 = "c3d4e5f6-3333-4e6a-9c03-5b71ee0a4d22";
const MEMBER_5 = "d4e5f6a7-4444-4e6a-9c03-5b71ee0a4d22";

const ROSTER = [CHRIS, ALEX, JORDAN, MEMBER_4, MEMBER_5] as const;

function buildClaim(
  over: Partial<UserClaim> & Pick<UserClaim, "claim_id" | "user_id" | "subject" | "claim_text" | "stated_at" | "resolves_at">,
): UserClaim {
  return {
    condition: { metric: "last_close", comparator: ">=", threshold: 100, owner: "quotes.last_close" },
    stated_probability: 0.5,
    evidence: [],
    status: "resolved",
    resolution: {
      outcome: 1,
      observed: 110,
      resolved_at: over.resolves_at,
      resolver: "quotes.last_close",
      note: "",
    },
    supersedes: null,
    ...over,
  };
}

/** The team's row set scored together. 30 calls across 3 of 5 members. */
function populatedTeamClaims(): UserClaim[] {
  const out: UserClaim[] = [];
  for (let i = 0; i < 10; i++) {
    const hit = i < 7;
    out.push(buildClaim({
      claim_id: `c${i.toString(16).padStart(15, "0")}`.slice(0, 16),
      user_id: CHRIS,
      subject: { kind: "security", id: `C${i}` },
      stated_at: `2026-01-${String(i + 1).padStart(2, "0")}T12:00:00.000Z`,
      resolves_at: `2026-04-${String(i + 1).padStart(2, "0")}T12:00:00.000Z`,
      claim_text: hit
        ? `Name ${i} finishes at or above the line I wrote down.`
        : `Name ${i} stays at or above the line I wrote down.`,
      condition: { metric: "last_close", comparator: ">=", threshold: 100 + i, owner: "quotes.last_close" },
      resolution: {
        outcome: hit ? 1 : 0,
        observed: hit ? 110 + i : 90,
        resolved_at: `2026-04-${String(i + 1).padStart(2, "0")}T12:00:00.000Z`,
        resolver: "quotes.last_close",
        note: "",
      },
    }));
  }
  for (let i = 0; i < 10; i++) {
    const hit = i < 4;
    out.push(buildClaim({
      claim_id: `a${i.toString(16).padStart(15, "0")}`.slice(0, 16),
      user_id: ALEX,
      subject: { kind: "security", id: `A${i}` },
      stated_at: `2026-01-${String(i + 1).padStart(2, "0")}T12:00:00.000Z`,
      resolves_at: `2026-04-${String(i + 1).padStart(2, "0")}T12:00:00.000Z`,
      claim_text: `Alex call ${i}.`,
      condition: { metric: "last_close", comparator: ">=", threshold: 200 + i, owner: "quotes.last_close" },
      resolution: {
        outcome: hit ? 1 : 0,
        observed: hit ? 210 + i : 190,
        resolved_at: `2026-04-${String(i + 1).padStart(2, "0")}T12:00:00.000Z`,
        resolver: "quotes.last_close",
        note: "",
      },
    }));
  }
  for (let i = 0; i < 10; i++) {
    const hit = i < 6;
    out.push(buildClaim({
      claim_id: `b${i.toString(16).padStart(15, "0")}`.slice(0, 16),
      user_id: JORDAN,
      subject: { kind: "security", id: `J${i}` },
      stated_at: `2026-01-${String(i + 1).padStart(2, "0")}T12:00:00.000Z`,
      resolves_at: `2026-04-${String(i + 1).padStart(2, "0")}T12:00:00.000Z`,
      claim_text: `Jordan call ${i}.`,
      condition: { metric: "last_close", comparator: ">=", threshold: 300 + i, owner: "quotes.last_close" },
      resolution: {
        outcome: hit ? 1 : 0,
        observed: hit ? 310 + i : 290,
        resolved_at: `2026-04-${String(i + 1).padStart(2, "0")}T12:00:00.000Z`,
        resolver: "quotes.last_close",
        note: "",
      },
    }));
  }
  return out;
}

export const ROLLUP: Record<string, TeamRollupResult | null> = {
  /** No team in view: panel passes no teamId, the team-rollup block is hidden. */
  none: null,
  /** Team has members, but none of them have written a call down yet. */
  no_rows: rollupTeamAccuracy([...ROSTER], []),
  /** Team has no members at all. */
  empty_members: rollupTeamAccuracy([], []),
  /** Team with members whose row set is scored together. */
  ok: rollupTeamAccuracy([...ROSTER], populatedTeamClaims()),
};
