import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  scorePersonalAccuracy,
  type UserClaim,
} from "@/lib/personalAccuracy";

const USER = "11111111-1111-4111-8111-111111111111";

function claim(partial: Partial<UserClaim> & Pick<UserClaim, "claim_id" | "stated_at" | "resolves_at">): UserClaim {
  return {
    user_id: USER,
    subject: { kind: "security", id: "SPX" },
    claim_text: "SPX finishes at or above 6000",
    condition: { metric: "last_close", comparator: ">=", threshold: 6000, owner: "quotes.last_close" },
    stated_probability: 0.7,
    evidence: [],
    status: "resolved",
    resolution: {
      outcome: 1,
      observed: 6100,
      resolved_at: partial.resolves_at,
      resolver: "quotes.last_close",
      note: "",
    },
    supersedes: null,
    ...partial,
  };
}

describe("scorePersonalAccuracy", () => {
  it("collapses a chain of pairwise-overlapping claims into one episode by transitive closure", () => {
    const readout = scorePersonalAccuracy([
      claim({ claim_id: "aaaaaaaaaaaaaaa1", stated_at: "2026-01-01T00:00:00.000Z", resolves_at: "2026-01-03T00:00:00.000Z" }),
      claim({ claim_id: "aaaaaaaaaaaaaaa2", stated_at: "2026-01-02T00:00:00.000Z", resolves_at: "2026-01-05T00:00:00.000Z" }),
      claim({ claim_id: "aaaaaaaaaaaaaaa3", stated_at: "2026-01-04T00:00:00.000Z", resolves_at: "2026-01-06T00:00:00.000Z" }),
    ]);
    expect(readout.episodeCount).toBe(1);
    expect(readout.claimCount).toBe(3);
  });

  it("keeps two claims at materially different thresholds in separate episodes", () => {
    const readout = scorePersonalAccuracy([
      claim({
        claim_id: "bbbbbbbbbbbbbbb1",
        stated_at: "2026-01-01T00:00:00.000Z",
        resolves_at: "2026-02-01T00:00:00.000Z",
        condition: { metric: "last_close", comparator: ">=", threshold: 6000, owner: "quotes.last_close" },
      }),
      claim({
        claim_id: "bbbbbbbbbbbbbbb2",
        stated_at: "2026-01-01T00:00:00.000Z",
        resolves_at: "2026-02-01T00:00:00.000Z",
        condition: { metric: "last_close", comparator: ">=", threshold: 7000, owner: "quotes.last_close" },
      }),
    ]);
    expect(readout.episodeCount).toBe(2);
  });

  it("takes the outcome and the stated probability from the same earliest still-live member", () => {
    const readout = scorePersonalAccuracy([
      claim({
        claim_id: "cccccccccccccccc",
        stated_at: "2026-01-01T00:00:00.000Z",
        resolves_at: "2026-03-01T00:00:00.000Z",
        stated_probability: 0.2,
        resolution: { outcome: 0, observed: 5900, resolved_at: "2026-03-01T00:00:00.000Z", resolver: "quotes.last_close", note: "" },
      }),
      claim({
        claim_id: "dddddddddddddddd",
        stated_at: "2026-01-15T00:00:00.000Z",
        resolves_at: "2026-03-01T00:00:00.000Z",
        stated_probability: 0.9,
        resolution: { outcome: 1, observed: 6100, resolved_at: "2026-03-01T00:00:00.000Z", resolver: "quotes.last_close", note: "" },
      }),
    ]);
    expect(readout.episodeCount).toBe(1);
    expect(readout.resolvedHits).toBe(0);
    expect(readout.brierPairs).toBe(1);
    // (0.2 - 0)^2 = 0.04 — would be (0.9-1)^2 = 0.01 if it took the later member's probability
    expect(readout.brierMean).toBeNull();
    const rows = readout.claims.filter((row) => row.claimId === "cccccccccccccccc");
    expect(rows).toHaveLength(1);
  });

  it("skips a withdrawn earliest member and carries from the next still-live one", () => {
    const readout = scorePersonalAccuracy([
      claim({
        claim_id: "eeeeeeeeeeeeeee1",
        stated_at: "2026-01-01T00:00:00.000Z",
        resolves_at: "2026-03-01T00:00:00.000Z",
        status: "withdrawn",
        stated_probability: 0.1,
        resolution: null,
      }),
      claim({
        claim_id: "eeeeeeeeeeeeeee2",
        stated_at: "2026-01-10T00:00:00.000Z",
        resolves_at: "2026-03-01T00:00:00.000Z",
        stated_probability: 0.8,
        resolution: { outcome: 1, observed: 6100, resolved_at: "2026-03-01T00:00:00.000Z", resolver: "quotes.last_close", note: "" },
      }),
    ]);
    expect(readout.episodeCount).toBe(1);
    expect(readout.resolvedHits).toBe(1);
    expect(readout.resolvedEpisodes).toBe(1);
  });

  it("counts an all-withdrawn episode only in the unscorable tally", () => {
    const readout = scorePersonalAccuracy([
      claim({
        claim_id: "ffffffffffffffff",
        stated_at: "2026-01-01T00:00:00.000Z",
        resolves_at: "2026-02-01T00:00:00.000Z",
        status: "withdrawn",
        resolution: null,
      }),
    ]);
    expect(readout.episodeCount).toBe(1);
    expect(readout.unscorableCount).toBe(1);
    expect(readout.resolvedEpisodes).toBe(0);
    expect(readout.brierPairs).toBe(0);
  });

  it("excludes an undetermined outcome from both scores and counts it as not scorable", () => {
    const readout = scorePersonalAccuracy([
      claim({
        claim_id: "1111111111111111",
        stated_at: "2026-01-01T00:00:00.000Z",
        resolves_at: "2026-02-01T00:00:00.000Z",
        status: "resolved",
        resolution: {
          outcome: null,
          observed: null,
          resolved_at: "2026-02-01T00:00:00.000Z",
          resolver: "personalAccuracyStore.RESOLVER_REGISTRY",
          note: "the data this call named was not available",
        },
      }),
    ]);
    expect(readout.resolvedEpisodes).toBe(0);
    expect(readout.brierPairs).toBe(0);
    expect(readout.unscorableCount).toBe(1);
  });

  it("buys exactly one Brier pair for ten restatements of the same call", () => {
    const claims = Array.from({ length: 10 }, (_, i) => claim({
      claim_id: `22222222222222${i.toString(16)}`,
      stated_at: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
      resolves_at: `2026-01-${String(i + 12).padStart(2, "0")}T00:00:00.000Z`,
    }));
    const readout = scorePersonalAccuracy(claims);
    expect(readout.episodeCount).toBe(1);
    expect(readout.claimCount).toBe(10);
    expect(readout.brierPairs).toBe(1);
  });

  it("withholds the calibration reading below thirty probability pairs", () => {
    const claims = Array.from({ length: 29 }, (_, i) => claim({
      claim_id: `3333333333333${i.toString(16).padStart(3, "0")}`,
      subject: { kind: "security", id: `S${i}` },
      stated_at: "2026-01-01T00:00:00.000Z",
      resolves_at: "2026-02-01T00:00:00.000Z",
    }));
    const readout = scorePersonalAccuracy(claims);
    expect(readout.brierPairs).toBe(29);
    expect(readout.brierMean).toBeNull();
  });

  it("returns the calibration reading at exactly thirty probability pairs", () => {
    const claims = Array.from({ length: 30 }, (_, i) => claim({
      claim_id: `4444444444444${i.toString(16).padStart(3, "0")}`,
      subject: { kind: "security", id: `T${i}` },
      stated_at: "2026-01-01T00:00:00.000Z",
      resolves_at: "2026-02-01T00:00:00.000Z",
      stated_probability: 1,
      resolution: { outcome: 1, observed: 1, resolved_at: "2026-02-01T00:00:00.000Z", resolver: "quotes.last_close", note: "" },
    }));
    const readout = scorePersonalAccuracy(claims);
    expect(readout.brierPairs).toBe(30);
    expect(readout.brierMean).toBe(0);
  });

  it("withholds the hit-rate stance below ten resolved episodes", () => {
    const claims = Array.from({ length: 9 }, (_, i) => claim({
      claim_id: `5555555555555${i.toString(16).padStart(3, "0")}`,
      subject: { kind: "security", id: `U${i}` },
      stated_at: "2026-01-01T00:00:00.000Z",
      resolves_at: "2026-02-01T00:00:00.000Z",
    }));
    const readout = scorePersonalAccuracy(claims);
    expect(readout.resolvedEpisodes).toBe(9);
    expect(readout.hitRate).toBeNull();
    expect(readout.stance).toBe("Too early to say");
  });

  it("maps hit-rate bands to the four frozen stance strings at 0.60 and 0.40", () => {
    const band = (hits: number, n = 10) => scorePersonalAccuracy(
      Array.from({ length: n }, (_, i) => claim({
        claim_id: `${hits}${n}${i.toString(16).padStart(14, "0")}`.slice(0, 16),
        subject: { kind: "security", id: `B${hits}-${i}` },
        stated_at: "2026-01-01T00:00:00.000Z",
        resolves_at: "2026-02-01T00:00:00.000Z",
        resolution: {
          outcome: i < hits ? 1 : 0,
          observed: i < hits ? 6100 : 5900,
          resolved_at: "2026-02-01T00:00:00.000Z",
          resolver: "quotes.last_close",
          note: "",
        },
      })),
    );
    expect(band(6).stance).toBe("Mostly landing so far");
    expect(band(6).hitRate).toBe(0.6);
    expect(band(5).stance).toBe("Mixed so far");
    expect(band(4).stance).toBe("Mixed so far");
    expect(band(3).stance).toBe("Not landing yet");
  });

  it("marks a claim with an incomplete condition void_unscorable", () => {
    const readout = scorePersonalAccuracy([
      claim({
        claim_id: "6666666666666666",
        stated_at: "2026-01-01T00:00:00.000Z",
        resolves_at: "2026-02-01T00:00:00.000Z",
        condition: { metric: "last_close", comparator: ">=", threshold: 6000 },
        status: "open",
        resolution: null,
      }),
    ]);
    expect(readout.unscorableCount).toBe(1);
    expect(readout.resolvedEpisodes).toBe(0);
    expect(readout.openEpisodes).toBe(0);
  });

  it("returns no composite, score, rating, grade or index field", () => {
    const readout = scorePersonalAccuracy([]);
    const keys = Object.keys(readout);
    for (const banned of ["score", "index", "grade", "rating", "health", "composite"]) {
      expect(keys).not.toContain(banned);
    }
    expect(keys.some((k) => /score|index|grade|rating|health|composite/i.test(k))).toBe(false);
  });

  it("reports episode count and raw claim count as distinct fields", () => {
    const readout = scorePersonalAccuracy([
      claim({ claim_id: "7777777777777771", stated_at: "2026-01-01T00:00:00.000Z", resolves_at: "2026-01-10T00:00:00.000Z" }),
      claim({ claim_id: "7777777777777772", stated_at: "2026-01-05T00:00:00.000Z", resolves_at: "2026-01-12T00:00:00.000Z" }),
    ]);
    expect(readout.episodeCount).toBe(1);
    expect(readout.claimCount).toBe(2);
    expect(readout.episodeCount).not.toBe(readout.claimCount);
  });

  it("treats a shared endpoint as an overlap", () => {
    const readout = scorePersonalAccuracy([
      claim({ claim_id: "8888888888888881", stated_at: "2026-01-01T00:00:00.000Z", resolves_at: "2026-01-10T00:00:00.000Z" }),
      claim({ claim_id: "8888888888888882", stated_at: "2026-01-10T00:00:00.000Z", resolves_at: "2026-01-20T00:00:00.000Z" }),
    ]);
    expect(readout.episodeCount).toBe(1);
  });

  it("breaks a same-millisecond carrier tie on the lowest claim id", () => {
    const readout = scorePersonalAccuracy([
      claim({
        claim_id: "ffffffffffffffff",
        stated_at: "2026-01-01T00:00:00.000Z",
        resolves_at: "2026-02-01T00:00:00.000Z",
        stated_probability: 0.9,
        resolution: { outcome: 1, observed: 1, resolved_at: "2026-02-01T00:00:00.000Z", resolver: "quotes.last_close", note: "" },
      }),
      claim({
        claim_id: "0000000000000001",
        stated_at: "2026-01-01T00:00:00.000Z",
        resolves_at: "2026-02-01T00:00:00.000Z",
        stated_probability: 0.1,
        resolution: { outcome: 0, observed: 0, resolved_at: "2026-02-01T00:00:00.000Z", resolver: "quotes.last_close", note: "" },
      }),
    ]);
    expect(readout.episodeCount).toBe(1);
    expect(readout.resolvedHits).toBe(0);
    expect(readout.claims.find((row) => row.claimId === "0000000000000001")).toBeTruthy();
  });
});

describe("score_personal_accuracy worker registry source", () => {
  it("reads RESOLVER_REGISTRY from personalAccuracyStore.ts instead of freezing its own empty map", () => {
    const src = readFileSync(
      join(__dirname, "../../scripts/score_personal_accuracy.mjs"),
      "utf8",
    );
    expect(src).toMatch(/personalAccuracyStore\.ts/);
    expect(src).not.toMatch(/const RESOLVER_REGISTRY = Object\.freeze\(\{\}\)/);
  });
});
