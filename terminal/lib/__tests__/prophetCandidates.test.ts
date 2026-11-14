import { describe, expect, it } from "vitest";
import { decodeProphetCandidates, filterProphetCandidates } from "../prophetCandidates";
import { parseProphetState, writeProphetState } from "../prophetUrlState";
import { candidateFixture } from "./prophetCandidatesFixture";

describe("complete candidate publication boundary", () => {
  it("preserves every row in source order, including zero and genuinely absent scores", () => {
    const result = decodeProphetCandidates(candidateFixture())!;
    expect(result.projection.rows.map(row => row.ticker)).toEqual(["DEMOA", "DEMOB", "DEMOC", "DEMOD"]);
    expect(result.projection.rows.map(row => row.pool_rank)).toEqual([7, 1, 4, 12]);
    expect(result.projection.rows[1].prophet?.score).toBe(0);
    expect(result.projection.rows[2].prophet).toBeNull();
    expect(result.projection.counts).toEqual({ eligible: 4, in_buy_lane: 2, off_buy_lane: 2, scored: 2, unscored: 2 });
  });
  it.each(["7.0", "7e0", " 7 "])("accepts the producer's integral position %s without sorting by it", rank => {
    const raw = candidateFixture(); raw.projection.rows[0].pool_rank = rank;
    expect(decodeProphetCandidates(raw)?.projection.rows[0].pool_rank).toBe(7);
  });
  it("normalizes ticker case for the canonical URL and rejects case-insensitive duplicates", () => {
    const raw = candidateFixture(); raw.projection.rows[0].ticker = "demoa";
    expect(decodeProphetCandidates(raw)?.projection.rows[0].ticker).toBe("DEMOA");
    raw.projection.rows[1].ticker = "DEMOA"; expect(decodeProphetCandidates(raw)).toBeNull();
  });
  it("distinguishes a verified empty publication from an unavailable read", () => {
    const raw = candidateFixture(); raw.projection.status = "empty"; raw.projection.rows = [];
    raw.projection.counts = { eligible: 0, in_buy_lane: 0, off_buy_lane: 0, scored: 0, unscored: 0 };
    expect(decodeProphetCandidates(raw)?.projection.status).toBe("empty");
    raw.projection.status = "unavailable"; expect(decodeProphetCandidates(raw)).toBeNull();
  });
  it("fails the complete snapshot on population, membership, or scoring contradictions", () => {
    const wrongTotal = candidateFixture(); wrongTotal.projection.counts.eligible++;
    const wrongMembership = candidateFixture(); wrongMembership.projection.counts.in_buy_lane = 1;
    const offCohort = candidateFixture(); offCohort.projection.rows[2].prophet = { score: 88 };
    const wrongScored = candidateFixture(); wrongScored.projection.counts.scored = 1;
    const duplicate = candidateFixture(); duplicate.projection.rows[2].ticker = "DEMOA";
    const inventedEmpty = candidateFixture(); inventedEmpty.projection.status = "empty";
    for (const raw of [wrongTotal, wrongMembership, offCohort, wrongScored, duplicate, inventedEmpty]) expect(decodeProphetCandidates(raw)).toBeNull();
  });
  it("rejects impossible dates, nonfinite scores, malformed rank, authority and source", () => {
    const invalidDate = candidateFixture(); invalidDate.projection.as_of = "2026-02-30";
    const nonfinite = candidateFixture(); nonfinite.projection.rows[0].prophet!.score = Infinity;
    const rank = candidateFixture(); rank.projection.rows[0].pool_rank = "unknown";
    const action = candidateFixture(); action.projection.display_only = false;
    const source = candidateFixture(); source.source.path = "other.json";
    for (const raw of [invalidDate, nonfinite, rank, action, source]) expect(decodeProphetCandidates(raw)).toBeNull();
  });
  it("reconstructs only the display allowlist", () => {
    const raw = candidateFixture(); Object.assign(raw, { token: "secret" }); Object.assign(raw.projection.rows[0], { price: 123, internal_token: "secret" });
    Object.assign(raw.projection, { trade_permission: true });
    const serialized = JSON.stringify(decodeProphetCandidates(raw));
    expect(serialized).not.toMatch(/secret|price|trade_permission/);
  });
  it("searches the whole pool without altering order or source counts", () => {
    const pool = decodeProphetCandidates(candidateFixture())!;
    expect(filterProphetCandidates(pool.projection.rows, "technology").map(row => row.ticker)).toEqual(["DEMOB", "DEMOC"]);
    expect(filterProphetCandidates(pool.projection.rows, "cedar tech")[0].ticker).toBe("DEMOC");
    expect(filterProphetCandidates(pool.projection.rows, "nomatch")).toEqual([]);
    expect(pool.projection.counts.eligible).toBe(4);
  });
});

describe("candidate navigation reuses the Prophet URL owner", () => {
  it.each(["canonical", "legacy"] as const)("restores detail, search, page and unrelated market context on %s", mount => {
    const url = new URL(mount === "canonical" ? "https://app.test/prophet?tab=candidates&workspaceMarket=us" : "https://app.test/options?tab=prophet&prophetLane=candidates&workspaceMarket=us");
    const state = { ...parseProphetState(url.searchParams, mount), symbol: "DEMOC", q: "Cedar 网络", offset: 50 };
    const next = new URL(writeProphetState(url, state, mount), url.origin);
    expect(parseProphetState(next.searchParams, mount)).toMatchObject({ lane: "candidates", symbol: "DEMOC", q: "Cedar 网络", offset: 50 });
    expect(next.searchParams.get("workspaceMarket")).toBe("us");
    if (mount === "legacy") expect(next.searchParams.get("tab")).toBe("prophet");
  });
  it("keeps controls and oversized searches out of candidate state", () => {
    for (const q of ["a".repeat(65), "hello\u0000there"]) {
      expect(parseProphetState(new URLSearchParams({ tab: "candidates", prophetQ: q })).q).toBe("");
    }
  });
});
