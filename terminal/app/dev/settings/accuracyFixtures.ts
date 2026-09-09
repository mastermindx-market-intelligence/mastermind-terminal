// Dev-harness / test fixtures for B-F13-5. Never imported by the production
// scorer or the /api/accuracy route.
import { scorePersonalAccuracy, type AccuracyReadout, type UserClaim } from "@/lib/personalAccuracy";

export function populatedAccuracyFixture(): AccuracyReadout {
  const claims: UserClaim[] = [];
  for (let i = 0; i < 10; i++) {
    const hit = i < 7;
    const id = `c${i.toString(16).padStart(15, "0")}`;
    claims.push({
      claim_id: id.slice(0, 16),
      user_id: "8f2c41ba-7d19-4e6a-9c03-5b71ee0a4d22",
      subject: { kind: "security", id: `N${i}` },
      stated_at: `2026-01-${String(i + 1).padStart(2, "0")}T12:00:00.000Z`,
      resolves_at: `2026-04-${String(i + 1).padStart(2, "0")}T12:00:00.000Z`,
      claim_text: hit
        ? `Name ${i} finishes at or above the line I wrote down.`
        : `Name ${i} stays at or above the line I wrote down.`,
      condition: { metric: "last_close", comparator: ">=", threshold: 100 + i, owner: "quotes.last_close" },
      stated_probability: 0.65,
      evidence: [],
      status: "resolved",
      resolution: {
        outcome: hit ? 1 : 0,
        observed: hit ? 110 + i : 90,
        resolved_at: `2026-04-${String(i + 1).padStart(2, "0")}T12:00:00.000Z`,
        resolver: "quotes.last_close",
        note: "",
      },
      supersedes: null,
    });
  }
  return scorePersonalAccuracy(claims);
}

export function unscorableAccuracyFixture(): AccuracyReadout {
  const claim: UserClaim = {
    claim_id: "aaaaaaaaaaaaaaaa",
    user_id: "8f2c41ba-7d19-4e6a-9c03-5b71ee0a4d22",
    subject: { kind: "security", id: "N0" },
    stated_at: "2026-01-01T12:00:00.000Z",
    resolves_at: "2026-04-01T12:00:00.000Z",
    claim_text: "Name 0 finishes at or above the line I wrote down.",
    condition: { metric: "last_close", comparator: ">=", threshold: 100, owner: "quotes.last_close" },
    stated_probability: 0.65,
    evidence: [],
    status: "resolved",
    resolution: {
      outcome: null,
      observed: null,
      resolved_at: "2026-04-01T12:00:00.000Z",
      resolver: "personalAccuracyStore.RESOLVER_REGISTRY",
      note: "the data this call named was not available",
    },
    supersedes: null,
  };
  return scorePersonalAccuracy([claim]);
}
