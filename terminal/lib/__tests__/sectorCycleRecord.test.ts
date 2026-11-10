import { describe, expect, it } from "vitest";
import {
  CYCLE_FAMILIES,
  cycleFamiliesPresent,
  cycleGrader,
  cycleRead,
  cycleRecordFor,
  cycleRoster,
  cycleStory,
  episodesForGeneration,
  ontologyReading,
  oscHistory,
  publicationGate,
} from "../sectorCycleRecord";
import type { SectorRotationEpisodes } from "../sectorIntelligence";

const publicationId = "cycp1-" + "ef".repeat(32);
const evidence = {
  schema: "sector_cycles.evidence.v1",
  status: "verified",
  publicationId,
  asOf: "2026-10-30",
  region: "us",
  parts: { core: "verified", series: "verified" },
};

describe("publication gate", () => {
  const expected = { publicationId, region: "us" };
  it("passes a verified, bound, us receipt with a verified core part", () => {
    expect(publicationGate(evidence, expected)).toEqual({ state: "ready" });
  });
  it("pending is loading; superseded and incompatible are generation breaks", () => {
    expect(
      publicationGate({ ...evidence, status: "pending" }, expected),
    ).toEqual({ state: "loading", reason: "verification_pending" });
    expect(
      publicationGate({ ...evidence, status: "superseded" }, expected).state,
    ).toBe("incompatible_generation");
    expect(
      publicationGate({ ...evidence, status: "incompatible_publication" }, expected)
        .state,
    ).toBe("incompatible_generation");
  });
  it("refuses unbound, mismatched or partial receipts", () => {
    expect(publicationGate({}, expected).state).toBe("unavailable");
    expect(publicationGate({ ...evidence, parts: {} }, expected).state).toBe(
      "unavailable",
    );
    expect(
      publicationGate({ ...evidence, publicationId: "cycp1-x" }, expected).state,
    ).toBe("unavailable");
    expect(
      publicationGate(evidence, { publicationId: "cycp1-" + "11".repeat(32), region: "us" })
        .state,
    ).toBe("incompatible_generation");
    expect(publicationGate({ ...evidence, region: "eu" }, expected).state).toBe(
      "incompatible_generation",
    );
  });
});

describe("roster and records", () => {
  const payload = {
    meta: { asOf: "2026-10-30", region: "us" },
    sectors: [
      {
        id: "xle",
        ticker: "XLE",
        kind: "sector",
        name: "Energy",
        name_zh: "能源",
        basis: "price",
        now: {
          phase: "Expansion",
          phase_v2: "Expansion",
          phase_v2_source: "ontology",
          pos: 71.5,
          pos_v2: 64,
          phase_v2_position_input: "pos_v2",
        },
      },
      {
        id: "xlk",
        ticker: "XLK",
        kind: "sector",
        name: "Technology",
        name_zh: "科技",
        basis: "price",
        now: { phase: "Downturn", phase_v2: "Downturn", phase_v2_source: "ontology", pos_v2: 0, phase_v2_position_input: "pos_v2" },
      },
    ],
    baskets: [],
    nasdaq: [],
    russell: [],
  };
  it("keeps all registered families with their benchmark; none substitutes for US sectors", () => {
    expect(CYCLE_FAMILIES.map((f) => f.key)).toEqual([
      "sectors",
      "baskets",
      "nasdaq",
      "russell",
    ]);
    expect(CYCLE_FAMILIES.map((f) => f.benchmark)).toEqual(["SPY", "SPY", "QQQ", "IWM"]);
    expect(cycleFamiliesPresent(payload)).toEqual(["sectors"]);
  });
  it("roster keeps zero positions, ontology gating and legacy phases distinguishable", () => {
    const roster = cycleRoster(payload, "sectors");
    expect(roster).toHaveLength(2);
    expect(roster[0]).toMatchObject({
      id: "xle",
      ticker: "XLE",
      phase: "Expansion",
      position: 64,
      legacyPhase: "Expansion",
    });
    expect(roster[1]).toMatchObject({ position: 0, phase: "Downturn" });
  });
  it("ontology readings refuse wrong sources and wrong position inputs; zero survives", () => {
    expect(
      ontologyReading({ now: { phase_v2: "Peak", phase_v2_source: "legacy", pos_v2: 50 } }),
    ).toEqual({ phase: null, position: null });
    expect(
      ontologyReading({
        now: {
          phase_v2: "Peak",
          phase_v2_source: "ontology",
          pos_v2: 50,
          phase_v2_position_input: "pos",
        },
      }),
    ).toEqual({ phase: "Peak", position: null });
    expect(
      ontologyReading({
        now: {
          phase_v2: "Peak",
          phase_v2_source: "ontology",
          pos_v2: 101,
          phase_v2_position_input: "pos_v2",
        },
      }).position,
    ).toBeNull();
  });
  it("resolves exactly one record per id and kind; duplicates and foreign kinds refuse", () => {
    expect(cycleRecordFor(payload, "sectors", "xle")).toMatchObject({ id: "xle" });
    expect(cycleRecordFor(payload, "sectors", "nope")).toBeNull();
    expect(cycleRecordFor(payload, "baskets", "xle")).toBeNull();
    expect(
      cycleRecordFor(
        { sectors: [payload.sectors[0], payload.sectors[0]] },
        "sectors",
        "xle",
      ),
    ).toBeNull();
  });
});

describe("osc exact-values history", () => {
  const osc = (rows: [number, number][]) => rows.map(([x, v]) => ({ x, v }));
  it("accepts strictly ascending coordinates with values in 0–100", () => {
    const history = oscHistory({ osc: osc([[2024.5, 12], [2025.1, 44], [2026.2, 71]]) }, "sectors", null);
    expect(history.state).toBe("ready");
    expect(history.rows).toHaveLength(3);
    expect(history.sourcePart).toBe("core");
  });
  it("invalid: non-finite, out-of-range, or out-of-order observations", () => {
    for (const rows of [
      [[2025.1, 44], [2024.9, 71]],
      [[2025.1, 101], [2026.1, 50]],
      [[2025.1, -1], [2026.1, 50]],
      [[2025.1, 44], ["x", 50]],
    ])
      expect(
        oscHistory({ osc: osc(rows as unknown as [number, number][]) }, "sectors", null).state,
      ).toBe("invalid");
    expect(oscHistory({ osc: [{}] }, "sectors", null).state).toBe("unavailable");
  });
  it("baskets need the series part verified; sectors are core-verified", () => {
    const record = { osc: osc([[2025.1, 44], [2026.1, 50]]) };
    expect(oscHistory(record, "baskets", null).state).toBe("unverified");
    expect(oscHistory(record, "baskets", { series: "verified" }).state).toBe("ready");
    expect(oscHistory(record, "sectors", null).sourcePart).toBe("core");
  });
});

describe("engine read gate", () => {
  const read = {
    phase: "Expansion",
    phase_v2: "Expansion",
    read: "Energy is Trending above its 200-day average (cycle position 64/100).",
    read_zh: "能源处于扩张阶段，位于200日均线上方（周期位置 64/100）。",
  };
  it("valid when the read names the phase clock's own family, bilingual", () => {
    expect(cycleRead({ now: read })).toMatchObject({ state: "valid" });
  });
  it("withheld when the legacy family disagrees or the zh copy is missing", () => {
    expect(cycleRead({ now: { ...read, phase: "Peak" } }).state).toBe("withheld");
    expect(cycleRead({ now: { ...read, read_zh: undefined } }).state).toBe("withheld");
    expect(cycleRead({ now: {} }).state).toBe("absent");
  });
});

describe("leg story quarantine", () => {
  const generation = {
    accessGeneration: "g1",
    region: "us" as const,
    asOf: "2026-10-30",
    publicationId,
  };
  const story = { en: "Leadership narrowed into energy.", zh: "领涨收窄至能源。", epoch: "2026-10-30" };
  it("valid in its own epoch, quarantined outside it or after its TTL", () => {
    expect(cycleStory({ story }, generation)).toMatchObject({ state: "valid" });
    expect(
      cycleStory({ story: { ...story, epoch: "2026-10-24" } }, generation).state,
    ).toBe("wrong_epoch");
    expect(
      cycleStory(
        { story: { ...story, expires_asof: "2026-10-29" } },
        generation,
      ),
    ).toMatchObject({ state: "expired", reason: "ttl" });
    expect(
      cycleStory({ story: { ...story, stale: true } }, generation),
    ).toMatchObject({ state: "expired", reason: "stale" });
    expect(cycleStory({}, generation).state).toBe("absent");
  });
});

describe("conviction grader", () => {
  it("reads resolved horizons with conditional hit rate and abstention denominators", () => {
    const grader = cycleGrader({
      grader: {
        available: true,
        by_horizon: {
          "21d": {
            n: 40,
            n_directional: 31,
            n_correct_directional: 21,
            n_neutral: 9,
            conditional_directional_hit_rate: 0.677,
            rank_ic: 0.11,
            mean_excess_vs_bench: 0.004,
          },
          "63d": { n: 12, note: "accruing" },
        },
      },
    });
    expect(grader.available).toBe(true);
    expect(grader.horizons.map((h) => h.horizon)).toEqual(["21d", "63d", "126d"]);
    expect(grader.horizons[0]).toMatchObject({
      n: 40,
      nDirectional: 31,
      nCorrectDirectional: 21,
      nNeutral: 9,
      hitRate: 0.677,
      accruing: false,
    });
    expect(grader.horizons[1]).toMatchObject({ n: 12, hitRate: null, accruing: true });
    expect(grader.horizons[2].hitRate).toBeNull();
  });
  it("unavailable grader is stated, not zeroed", () => {
    expect(cycleGrader({ grader: { available: false, note: "cold" } })).toMatchObject({
      available: false,
      note: "cold",
    });
    expect(cycleGrader({})).toMatchObject({ available: false, horizons: [] });
  });
});

describe("rotation events binding", () => {
  const episodes: SectorRotationEpisodes = {
    sourceAsOf: "2026-10-30",
    generatedUtc: "2026-10-31 02:14 UTC",
    coldstart: false,
    closedRecent: [],
    closedRecentTotal: 0,
    closedRecentExcluded: { crossPair: 0, invalid: 0 },
  };
  const generation = {
    accessGeneration: "g1",
    region: "us" as const,
    asOf: "2026-10-30",
    publicationId,
  };
  it("events from the same or an earlier generation bind; later stamps are withheld", () => {
    expect(episodesForGeneration(episodes, generation)).toMatchObject({
      state: "ready",
    });
    expect(
      episodesForGeneration(
        { ...episodes, sourceAsOf: "2026-10-31" },
        generation,
      ),
    ).toMatchObject({ state: "wrong_epoch", episodes: null });
    expect(episodesForGeneration(null, generation).state).toBe("absent");
  });
});
