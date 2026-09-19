// Team-accuracy rollup contract (packet W9T_F13_9 / MO-DELTA-007).
//
// Seat ruling: "Team sees its own scores; never a cross-team rank (hard gate, test pinned)."
// Every test below pins a different face of that hard gate.

import { describe, expect, it } from "vitest";
import { rollupTeamAccuracy } from "@/lib/teamRollup";
import type { UserClaim } from "@/lib/personalAccuracy";

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const CAROL = "33333333-3333-4333-8333-333333333333";
const DAVE = "44444444-4444-4444-8444-444444444444";
const OUTSIDER = "99999999-9999-4999-8999-999999999999";

function claim(over: Partial<UserClaim> & Pick<UserClaim, "claim_id" | "user_id" | "stated_at" | "resolves_at" | "subject" | "claim_text">): UserClaim {
  return {
    condition: { metric: "last_close", comparator: ">=", threshold: 6000, owner: "quotes.last_close" },
    stated_probability: 0.5,
    evidence: [],
    status: "resolved",
    resolution: {
      outcome: 1,
      observed: 6100,
      resolved_at: over.resolves_at,
      resolver: "quotes.last_close",
      note: "",
    },
    supersedes: null,
    ...over,
  };
}

describe("rollupTeamAccuracy — the hard gate (never a cross-team rank)", () => {
  it("drops a row whose user_id is not in the team-member list, even if it was passed in", () => {
    // The caller (the route) is supposed to filter claims by team membership, but the
    // aggregator is the LAST line of defence: a misrouted read cannot leak a row from
    // outside the team through here.
    const claims: UserClaim[] = [
      claim({ claim_id: "aaaaaaaaaaaaaaaa", user_id: ALICE, subject: { kind: "security", id: "AAA" }, claim_text: "team row", stated_at: "2026-01-01T00:00:00.000Z", resolves_at: "2026-02-01T00:00:00.000Z" }),
      claim({ claim_id: "bbbbbbbbbbbbbbbb", user_id: OUTSIDER, subject: { kind: "security", id: "BBB" }, claim_text: "outsider row", stated_at: "2026-01-01T00:00:00.000Z", resolves_at: "2026-02-01T00:00:00.000Z" }),
    ];
    const result = rollupTeamAccuracy([ALICE, BOB], claims);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    // The outsider row is gone. The "team's row set" Zustand is the team's row set.
    expect(result.readout.claimCount).toBe(1);
    expect(result.readout.claims.map((r) => r.claimId)).toEqual(["aaaaaaaaaaaaaaaa"]);
    // The "members with at least one call" count only counts members of THIS team — never the
    // outsider's account, even though the row was passed in.
    expect(result.membersWithClaims).toBe(1);
  });

  it("rolls up two team members' rows together as one shared readout, never a per-member ranking", () => {
    // Alice: one hit. Bob: one miss. Both are team members. The rollup returns ONE readout
    // with both rows; nothing in the response names Alice or Bob, ranks them, or compares
    // them — because that is exactly the cross-team / cross-member ranking the ruling forbids.
    const claims: UserClaim[] = [
      claim({ claim_id: "cacacacacacacaca1", user_id: ALICE, subject: { kind: "security", id: "AAA" }, claim_text: "alice hit", stated_at: "2026-01-01T00:00:00.000Z", resolves_at: "2026-02-01T00:00:00.000Z", resolution: { outcome: 1, observed: 6100, resolved_at: "2026-02-01T00:00:00.000Z", resolver: "quotes.last_close", note: "" } }),
      claim({ claim_id: "cbcbcbcbcbcbcbcb1", user_id: BOB, subject: { kind: "security", id: "BBB" }, claim_text: "bob miss", stated_at: "2026-01-01T00:00:00.000Z", resolves_at: "2026-02-01T00:00:00.000Z", resolution: { outcome: 0, observed: 5900, resolved_at: "2026-02-01T00:00:00.000Z", resolver: "quotes.last_close", note: "" } }),
    ];
    const result = rollupTeamAccuracy([ALICE, BOB], claims);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.memberCount).toBe(2);
    expect(result.membersWithClaims).toBe(2);
    // The team's shared readout: 2 claims, 2 episodes (different thresholds via subject id), 1 hit.
    expect(result.readout.claimCount).toBe(2);
    expect(result.readout.episodeCount).toBe(2);
    expect(result.readout.resolvedHits).toBe(1);
    expect(result.readout.resolvedEpisodes).toBe(2);
    // No row identifies its author. The response carries user_id nowhere — only the
    // claim text the author chose to write.
    for (const row of result.readout.claims) {
      expect(Object.prototype.hasOwnProperty.call(row, "userId")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(row, "user_id")).toBe(false);
    }
  });

  it("returns no_rows when the team has members but none of them have written anything", () => {
    const result = rollupTeamAccuracy([ALICE, BOB, CAROL], []);
    expect(result.kind).toBe("no_rows");
    if (result.kind !== "no_rows") return;
    expect(result.memberCount).toBe(3);
    expect(result.membersWithClaims).toBe(0);
  });

  it("returns empty_members when the team has no members at all", () => {
    const result = rollupTeamAccuracy([], []);
    expect(result.kind).toBe("empty_members");
    if (result.kind !== "empty_members") return;
    expect(result.memberCount).toBe(0);
  });

  it("counts a member once even when duplicate ids appear in the team list", () => {
    const claims: UserClaim[] = [
      claim({ claim_id: "cdcdcdcdcdcdcdcd", user_id: ALICE, subject: { kind: "security", id: "AAA" }, claim_text: "alice", stated_at: "2026-01-01T00:00:00.000Z", resolves_at: "2026-02-01T00:00:00.000Z" }),
    ];
    const result = rollupTeamAccuracy([ALICE, ALICE, BOB], claims);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.memberCount).toBe(2);
    expect(result.membersWithClaims).toBe(1);
  });

  it("ignores rows whose user_id field is missing or empty", () => {
    const claims = [
      claim({ claim_id: "cececececececece", user_id: ALICE, subject: { kind: "security", id: "AAA" }, claim_text: "alice", stated_at: "2026-01-01T00:00:00.000Z", resolves_at: "2026-02-01T00:00:00.000Z" }),
      { ...claim({ claim_id: "cfcfcfcfcfcfcfcf", user_id: BOB, subject: { kind: "security", id: "BBB" }, claim_text: "no id", stated_at: "2026-01-01T00:00:00.000Z", resolves_at: "2026-02-01T00:00:00.000Z" }), user_id: "" },
    ] as UserClaim[];
    const result = rollupTeamAccuracy([ALICE, BOB], claims);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.readout.claimCount).toBe(1);
    expect(result.membersWithClaims).toBe(1);
  });

  it("never returns rows from a second team's row set, even when both sets are passed in", () => {
    // Simulate a SQL bug: the read returned Alice (this team) AND Carol (another team),
    // because the route forgot its `.eq("team_id", ...)` clause. The aggregator catches it.
    const claims: UserClaim[] = [
      claim({ claim_id: "aaaaaaaaaaaaaaaa", user_id: ALICE, subject: { kind: "security", id: "AAA" }, claim_text: "this team", stated_at: "2026-01-01T00:00:00.000Z", resolves_at: "2026-02-01T00:00:00.000Z" }),
      claim({ claim_id: "cccccccccccccccc", user_id: CAROL, subject: { kind: "security", id: "CCC" }, claim_text: "other team", stated_at: "2026-01-01T00:00:00.000Z", resolves_at: "2026-02-01T00:00:00.000Z" }),
    ];
    const result = rollupTeamAccuracy([ALICE, BOB], claims);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    // Carol's row is filtered out. The "members with claims" count is 1, not 2.
    expect(result.membersWithClaims).toBe(1);
    expect(result.readout.claims.map((r) => r.claimId)).toEqual(["aaaaaaaaaaaaaaaa"]);
  });

  it("treats the resolved-outcome hit rate as a team-wide figure, not as a per-member split", () => {
    // 30 episodes, evenly split across Alice and Bob, mixed outcomes. The rollup returns a
    // single hit-rate figure (here: 0.5), not two per-member figures.
    const claims: UserClaim[] = [];
    for (let i = 0; i < 15; i++) {
      claims.push(claim({
        claim_id: `aa${i.toString(16).padStart(2, "0")}0000000000`.slice(0, 16),
        user_id: ALICE,
        subject: { kind: "security", id: `A${i}` },
        claim_text: "alice hit",
        stated_at: "2026-01-01T00:00:00.000Z",
        resolves_at: "2026-03-01T00:00:00.000Z",
        stated_probability: 0.5,
        resolution: { outcome: 1, observed: 6100, resolved_at: "2026-03-01T00:00:00.000Z", resolver: "quotes.last_close", note: "" },
      }));
      claims.push(claim({
        claim_id: `bb${i.toString(16).padStart(2, "0")}0000000000`.slice(0, 16),
        user_id: BOB,
        subject: { kind: "security", id: `B${i}` },
        claim_text: "bob miss",
        stated_at: "2026-01-01T00:00:00.000Z",
        resolves_at: "2026-03-01T00:00:00.000Z",
        stated_probability: 0.5,
        resolution: { outcome: 0, observed: 5900, resolved_at: "2026-03-01T00:00:00.000Z", resolver: "quotes.last_close", note: "" },
      }));
    }
    const result = rollupTeamAccuracy([ALICE, BOB, CAROL, DAVE], claims);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.memberCount).toBe(4);
    expect(result.membersWithClaims).toBe(2);
    expect(result.readout.resolvedEpisodes).toBe(30);
    expect(result.readout.resolvedHits).toBe(15);
    expect(result.readout.hitRate).toBeCloseTo(0.5, 10);
  });

  it("an empty members list is not silently coerced into a 'no rows' answer", () => {
    // A zero-member team is its own state, not a missing-rows state. The two states imply
    // different copy and different next steps.
    const result = rollupTeamAccuracy([], [
      claim({ claim_id: "aaaaaaaaaaaaaaaa", user_id: ALICE, subject: { kind: "security", id: "AAA" }, claim_text: "stale", stated_at: "2026-01-01T00:00:00.000Z", resolves_at: "2026-02-01T00:00:00.000Z" }),
    ]);
    expect(result.kind).toBe("empty_members");
  });
});
