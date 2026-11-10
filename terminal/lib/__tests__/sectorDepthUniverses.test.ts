import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CLASS_LABEL_KEYS,
  CLASS_ORDER,
  MEMBERS_PREVIEW,
  MIN_MEMBERS,
  RELIABLE_MED,
  RELIABLE_MIN,
  RELIABILITY_LABEL_KEYS,
  RIBBON_ORDER,
  UNIVERSES,
  UNIVERSE_ORDER,
  UNKNOWN_CLASS_RANK,
  buyableNow,
  classCounts,
  classRank,
  coverageModel,
  defaultSort,
  filterGroups,
  freshnessOf,
  groupReliability,
  groupsOf,
  initialUiStates,
  leagueKeys,
  membersPreview,
  patchUiState,
  reliability,
  rotationRead,
  rs60Of,
  sortByLabel,
  sortByMembersDesc,
  sortByRs60Desc,
  sortGroups,
  toggleExpanded,
  universePresence,
  universeWordMatches,
  sectorRollupOf,
  confluenceBasketsFromCarriedBlock,
  confluenceNasdaqFromCarriedBlock,
  confluenceRussellFromCarriedBlock,
  confluenceSp500FromCarriedBlock,
} from "../sectorDepthUniverses";
import type {
  FreshnessKind,
  UniverseBlockRead,
  UniverseData,
  UniverseGroup,
  UniverseId,
} from "../sectorDepthUniverses";
import { conformingChartKey } from "../sectorDepthRows";

/* Rows increment (wire v1.1 §1/§2/§4) — the REAL carried universe specimens,
 * committed unchanged under fixtures/. Byte pins (full committed file AND the
 * COO SHA256SUMS prefix) for all six rows specimens live in
 * sectorDepthThemeRows.test.ts; these tests consume the same files. */
const specimen = (name: string): unknown =>
  JSON.parse(
    readFileSync(join(__dirname, "fixtures", `${name}.json`), "utf8"),
  );

/** The readers take the served ENTRY (status/reason/value) — a bare specimen
 * file is a block VALUE, so specimen-backed reads wrap it as an available
 * entry exactly as the route would serve it. */
const carried = (value: unknown): unknown => ({ status: "available", value });

/* Synthetic contract fixture — clearly marked, never a real generation. */
const fixtureDoc = JSON.parse(
  readFileSync(
    join(__dirname, "fixtures", "sectorDepthUniversesContract.v1.json"),
    "utf8",
  ),
) as {
  note: string;
  universes: Record<string, UniverseData>;
};

const U = fixtureDoc.universes;
const sub = U.subsectors;
const ndx = U.nasdaq;

const keys = (groups: UniverseGroup[]) => groups.map((g) => g.key);

/** Real basket_confluence.json shape (owner field names and nullability
 * exactly as emitted; VALUES synthetic — this is a contract probe, never a
 * generation). Used by the S1 regression test: the payload's own `universe`
 * string is the owner word "curated_baskets", which is NOT a tab id. */
function realShapedBaskets(n: number): UniverseData {
  const classes = ["entry_now", "forming", "tailwind", "neutral", "late", "headwind"] as const;
  const tiers = ["high", "med", "low"] as const;
  const baskets: UniverseGroup[] = Array.from({ length: n }, (_, i) => ({
    key: `theme-${i + 1}`,
    kind: "basket",
    label: `Synthetic theme ${i + 1}`,
    label_zh: i % 3 === 2 ? null : `合成主题${i + 1}`,
    sector: "Thematic",
    sector_zh: "主题",
    n_members: 4,
    n_priced: 4,
    reliability: tiers[i % tiers.length],
    coverage_pct: 1,
    n_live: 4,
    start: "2019-01-02",
    as_of: "2026-11-06",
    price_level: "above_200d",
    class: classes[i % classes.length],
    entry: {
      tier: "T1",
      weight: 0.5,
      tier_sub: null,
      ticks: 0,
      bars_to_cross: null,
      fresh_bars: null,
      eligible: true,
      buyable: true,
      above200: true,
      reason: "synthetic contract probe",
    },
    regime: {
      state: "uptrend",
      side: "buy",
      label: "Tailwind",
      label_zh: "顺风",
      action: null,
      action_zh: null,
      rs_60d: 1.5,
    },
    members: [0, 1, 2, 3].map((m) => ({
      ticker: `TB${i}M${m}`,
      name_zh: null,
      price: 10 + m,
      ret_20d: 1 - m * 0.5,
      vs_basket: 0.5 - m * 0.25,
      stock_tier: m === 0 ? "T1" : null,
      stock_weight: 0.25,
      stock_ticks: null,
      stock_bars_to_cross: null,
      stock_buyable: m === 0,
      stock_state: "entry",
    })),
    basket_id: `syn-theme-${i + 1}`,
    chart_key: `theme-${i + 1}`,
    has_signals: true,
  }));
  return {
    ok: true,
    universe: "curated_baskets",
    weighting: "equal",
    benchmark: null,
    region: "US",
    as_of: "2026-11-06",
    coverage: {
      n_baskets: n,
      n_gateable: n,
      n_thin: 0,
      n_below_min_members: 0,
      n_unscored: 0,
      n_high: 33,
      n_med: 14,
      n_low_conf: 2,
    },
    entry_now: baskets.filter((g) => g.class === "entry_now").map((g) => g.key),
    forming: [],
    headwind: [],
    baskets,
    generated_utc: "2026-11-07T03:00:00Z",
  };
}

describe("fixture contract (real owner field names)", () => {
  it("declares itself synthetic", () => {
    expect(fixtureDoc.note).toBe(
      "synthetic contract-shape fixture for tests; not a real generation",
    );
  });

  it("carries all four universes with the fixed order", () => {
    expect(UNIVERSE_ORDER).toEqual(["subsectors", "nasdaq", "russell", "baskets"]);
    for (const id of UNIVERSE_ORDER) expect(U[id]).toBeDefined();
  });

  it("uses the real shapes: scored group arrays, key leagues, nullable as_of", () => {
    expect(Array.isArray(sub.subsectors)).toBe(true);
    expect(Array.isArray(ndx.subsectors)).toBe(true);
    expect(Array.isArray(U.baskets.baskets)).toBe(true);
    expect(sub.entry_now).toEqual(["semis-equip"]);
    expect(sub.forming).toEqual(["aerospace-defense", "software-infra"]);
    expect(ndx.as_of).toBeNull();
    expect(sub.as_of).toBe("2026-11-07");
    for (const g of groupsOf("subsectors", sub)) {
      expect(typeof g.key).toBe("string");
      expect(typeof g.class).toBe("string");
      expect(typeof g.entry?.tier).toBe("string");
      expect(typeof g.regime?.label).toBe("string");
      expect(["high", "med", "low"]).toContain(g.reliability);
    }
  });

  it("covers the required states: classes incl. one forming + one unknown, all four freshness kinds, 7-member group, zero groups, ok:false, n_listed-only, null label_zh", () => {
    const groups = groupsOf("subsectors", sub);
    expect(groups.length).toBeGreaterThanOrEqual(3);
    for (const cls of CLASS_ORDER) expect(groups.map((g) => g.class)).toContain(cls);
    // One scored row carries a class outside the engine order.
    const unknown = groups.find((g) => (g.class as string) === "rotated");
    expect(unknown).toBeDefined();
    expect(classRank(unknown!.class)).toBe(UNKNOWN_CLASS_RANK);
    expect(UNKNOWN_CLASS_RANK).toBe(9);

    const kinds = new Set([...groupsOf("subsectors", sub), ...groupsOf("nasdaq", ndx)].map((g) => freshnessOf(g).kind));
    for (const kind of ["just_fired", "fired_ago", "about_to_fire", "none"] as FreshnessKind[]) {
      expect(kinds.has(kind)).toBe(true);
    }

    expect(groups.find((g) => g.key === "semis-equip")!.members.length).toBe(7);
    expect(universePresence("baskets", U.baskets)).toBe("zero_groups");
    expect(U.russell.ok).toBe(false);
    expect(ndx.coverage.n_subsectors).toBeUndefined();
    expect(ndx.coverage.n_listed).toBe(62);
    expect(U.baskets.coverage.n_baskets).toBe(0);
    expect(groups.find((g) => g.key === "biotech")!.label_zh).toBeNull();
  });

  it("maps universe metadata (tabs, nouns, benchmarks, groups arrays)", () => {
    expect(UNIVERSES.subsectors.tabKey).toBe("siUniverseSp500");
    expect(UNIVERSES.nasdaq.tabKey).toBe("siUniverseNasdaq");
    expect(UNIVERSES.russell.tabKey).toBe("siUniverseRussell");
    expect(UNIVERSES.baskets.tabKey).toBe("siUniverseBaskets");
    expect(UNIVERSES.baskets.nounKey).toBe("siUniverseBasketsNoun");
    expect(UNIVERSES.baskets.groupsKey).toBe("baskets");
    expect(UNIVERSES.baskets.labelColKey).toBe("siUniverseColLabelBasket");
    expect(UNIVERSES.baskets.laneColKey).toBe("siUniverseColCategory");
    expect(UNIVERSES.baskets.filterPlaceholderKey).toBe("siUniverseFilterPlaceholderBk");
    expect(UNIVERSES.baskets.benchmarkKey).toBeNull();
    for (const id of ["subsectors", "nasdaq", "russell"] as const) {
      expect(UNIVERSES[id].groupsKey).toBe("subsectors");
      expect(UNIVERSES[id].nounKey).toBe("siUniverseSubsectors");
      expect(UNIVERSES[id].benchmarkKey).toMatch(/^siUniverseBenchmark/);
    }
    for (const cls of CLASS_ORDER) {
      expect(CLASS_LABEL_KEYS[cls]).toMatch(/^siUniverseClass/);
    }
  });
});

describe("groupsOf + league keys (scored rows only)", () => {
  it("reads the universe's own array and nothing else", () => {
    expect(keys(groupsOf("subsectors", sub))).toHaveLength(8);
    expect(keys(groupsOf("nasdaq", ndx))).toEqual(["software-infra", "semis-complex", "networking"]);
    expect(groupsOf("russell", U.russell)).toEqual([]);
    expect(groupsOf("baskets", U.baskets)).toEqual([]);
    expect(groupsOf("subsectors", undefined)).toEqual([]);
  });

  it("leagues are key sets from the same universe and never fabricate rows", () => {
    const leagues = leagueKeys(sub);
    expect(leagues.entry_now.has("semis-equip")).toBe(true);
    expect(leagues.forming.has("software-infra")).toBe(true);
    expect(leagues.headwind.has("networking-equipment")).toBe(true);
    // A league key with no scored row stays a key — it never becomes a row.
    expect(leagues.headwind.has("thin-ghost")).toBe(true);
    const scored = new Set(keys(groupsOf("subsectors", sub)));
    expect(scored.has("thin-ghost")).toBe(false);
    // Resolving league keys happens only against the SAME universe's rows.
    const ndxScored = new Map(keys(groupsOf("nasdaq", ndx)).map((k) => [k, k]));
    expect(ndxScored.has("software-infra")).toBe(true); // same key, other universe
    const ndxLeagues = leagueKeys(ndx);
    expect(ndxLeagues.entry_now.has("software-infra")).toBe(true);
    expect(ndxLeagues.entry_now.has("semis-equip")).toBe(false);
  });
});

describe("S1 — the group array follows the TAB id, never the payload's universe string", () => {
  it("the contract fixture carries the real owner universe vocabulary", () => {
    expect(sub.universe).toBe("sp500_subsectors");
    expect(ndx.universe).toBe("nasdaq_subsectors");
    expect(U.russell.universe).toBe("russell_subsectors");
    expect(U.baskets.universe).toBe("curated_baskets");
  });

  it("no owner universe word is a tab id, so the payload string can never select the array", () => {
    for (const word of [
      "sp500_subsectors",
      "nasdaq_subsectors",
      "russell_subsectors",
      "curated_baskets",
    ]) {
      expect(UNIVERSE_ORDER).not.toContain(word);
      expect((UNIVERSES as Record<string, unknown>)[word]).toBeUndefined();
    }
  });

  it("the real basket shape (baskets[49], universe 'curated_baskets') tables all 49 groups under the baskets tab", () => {
    const payload = realShapedBaskets(49);
    expect(payload.universe).toBe("curated_baskets");
    expect(payload.baskets).toHaveLength(49);
    expect(payload.coverage.n_baskets).toBe(49);
    const groups = groupsOf("baskets", payload);
    expect(groups).toHaveLength(49);
    expect(groups[48].key).toBe("theme-49");
    expect(universePresence("baskets", payload)).toBe("live");
    // The same file read under any other tab stays empty — one payload never
    // leaks into another universe's table.
    expect(groupsOf("subsectors", payload)).toEqual([]);
  });

  it("keying on the payload string would render the real baskets file empty — the exact S1 defect", () => {
    const payload = realShapedBaskets(49);
    // What the old code effectively did: look the owner word up in the tab
    // map, miss, fall back to `subsectors`, and find no such array.
    const ownerWord = payload.universe;
    const fallbackKey =
      (UNIVERSES as Record<string, { groupsKey: string } | undefined>)[ownerWord]?.groupsKey ??
      "subsectors";
    const viaOwnerWord = (
      payload as unknown as Partial<Record<string, UniverseGroup[]>>
    )[fallbackKey];
    expect(Array.isArray(viaOwnerWord) ? viaOwnerWord.length : 0).toBe(0);
  });
});

describe("classCounts + RIBBON_ORDER (B01 coverage ribbon)", () => {
  it("RIBBON_ORDER is the five reading classes, entry first; forming is not ribboned", () => {
    expect(RIBBON_ORDER).toEqual([
      "entry_now",
      "tailwind",
      "neutral",
      "late",
      "headwind",
    ]);
  });

  it("counts scored groups per class; unribboned classes report 0, never undefined", () => {
    const counts = classCounts(groupsOf("subsectors", sub));
    // The fixture carries 8 scored groups: 7 known classes + one unknown
    // "rotated" word, which the ribbon skips (its row still renders raw).
    let known = 0;
    for (const n of Object.values(counts)) known += n;
    expect(known).toBe(7);
    expect(counts.entry_now).toBe(1);
    expect(counts.forming).toBe(2);
    expect(counts.headwind).toBe(1);
    for (const cls of RIBBON_ORDER) {
      expect(Number.isInteger(counts[cls])).toBe(true);
      expect(counts[cls]).toBeGreaterThanOrEqual(0);
    }
  });

  it("an unknown class word is not ribboned (its rows stay counted nowhere here)", () => {
    // Runtime-only shape: the engine can reclassify between sessions; the
    // component already renders the raw word, the ribbon must skip it.
    const g = { ...groupsOf("subsectors", sub)[0], class: "rotated" } as unknown as UniverseGroup;
    const counts = classCounts([g]);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(0);
  });

  it("an empty universe ribbons five visible zeros", () => {
    const counts = classCounts([]);
    expect(RIBBON_ORDER.map((c) => counts[c])).toEqual([0, 0, 0, 0, 0]);
  });
});

describe("classRank / defaultSort", () => {
  it("returns engine _CLASS_ORDER positions; unknown class ranks 9, missing class too", () => {
    expect(classRank("entry_now")).toBe(0);
    expect(classRank("forming")).toBe(1);
    expect(classRank("tailwind")).toBe(2);
    expect(classRank("neutral")).toBe(3);
    expect(classRank("late")).toBe(4);
    expect(classRank("headwind")).toBe(5);
    expect(classRank("rotated")).toBe(9);
    expect(classRank(null)).toBe(9);
  });

  it("sorts tier ascending with unknown-class rows last, keeping source order within a tier", () => {
    const out = defaultSort(groupsOf("subsectors", sub));
    // Source order is deliberately scrambled: headwind, entry_now, forming(A&D),
    // forming(Software), tailwind, neutral, late, unknown("rotated").
    expect(keys(out)).toEqual([
      "semis-equip", // entry_now
      "aerospace-defense", // forming — earlier in source
      "software-infra", // forming — later in source
      "regional-banks", // tailwind
      "biotech", // neutral
      "broadline-retail", // late
      "networking-equipment", // headwind
      "oil-gas-ep", // unknown class — rank 9, last
    ]);
  });

  it("returns a copy and never mutates the source order", () => {
    const source = groupsOf("subsectors", sub);
    const before = keys(source);
    const out = defaultSort(source);
    expect(out).not.toBe(source);
    expect(keys(source)).toEqual(before);
  });
});

describe("local sorts never mutate the input array", () => {
  it("label, rs60, n_members and dispatch all leave the source untouched and return new arrays", () => {
    const source = groupsOf("subsectors", sub);
    const before = keys(source);
    for (const out of [
      sortByLabel(source),
      sortByRs60Desc(source),
      sortByMembersDesc(source),
      sortGroups(source, "label"),
      sortGroups(source, "rs60"),
      sortGroups(source, "n_members"),
      sortGroups(source, "tier"),
    ]) {
      expect(out).not.toBe(source);
      expect(keys(source)).toEqual(before);
    }
    expect(keys(source)).toEqual(before);
  });

  it("sorts labels case-insensitively ascending", () => {
    const groups = ["bBanana", "apple", "Cherry", "apple2"].map((label, i) => ({
      ...groupsOf("subsectors", sub)[0],
      key: `x-${i}`,
      label,
    }));
    expect(sortByLabel(groups).map((g) => g.label)).toEqual([
      "apple",
      "apple2",
      "bBanana",
      "Cherry",
    ]);
  });

  it("sorts RS60 (regime rs_60d) descending with nulls last, ties in source order", () => {
    const base = groupsOf("subsectors", sub)[0];
    const groups: UniverseGroup[] = [
      { ...base, key: "a", regime: { ...base.regime, rs_60d: null } },
      { ...base, key: "b", regime: { ...base.regime, rs_60d: 3.2 } },
      { ...base, key: "c", regime: { ...base.regime, rs_60d: 7.7 } },
      { ...base, key: "d", regime: { ...base.regime, rs_60d: undefined } },
      { ...base, key: "e", regime: { ...base.regime, rs_60d: -1.2 } },
    ];
    expect(keys(sortByRs60Desc(groups))).toEqual(["c", "b", "e", "a", "d"]);
  });

  it("sorts priced-name count descending, ties in source order", () => {
    const base = groupsOf("subsectors", sub)[0];
    const groups: UniverseGroup[] = [
      { ...base, key: "a", n_priced: 5 },
      { ...base, key: "b", n_priced: 9 },
      { ...base, key: "c", n_priced: 5 },
      { ...base, key: "d", n_priced: 12 },
    ];
    expect(keys(sortByMembersDesc(groups))).toEqual(["d", "b", "a", "c"]);
  });

  it("N3 — a null n_priced sorts strictly after every measured value, including a measured 0", () => {
    const base = groupsOf("subsectors", sub)[0];
    const groups: UniverseGroup[] = [
      { ...base, key: "null-a", n_priced: null },
      { ...base, key: "zero", n_priced: 0 },
      { ...base, key: "null-b", n_priced: null },
      { ...base, key: "five", n_priced: 5 },
    ];
    // Absent is not zero: the measured 0 outranks both nulls, and the two
    // nulls keep their source order (stable).
    expect(keys(sortByMembersDesc(groups))).toEqual(["five", "zero", "null-a", "null-b"]);
  });
});

describe("conformingChartKey (N9)", () => {
  it("requires the first character to be a letter or digit", () => {
    // These pass the navigable-id charset yet compose no real route segment
    // ("/subsector/.html", "/subsector/-lead.html") — refused.
    for (const bad of [".", "-", "_x", ".hidden", "-lead", "_under"]) {
      expect(conformingChartKey(bad)).toBe(false);
    }
    // Real carried key shapes still conform.
    for (const good of [
      "b-crypto-rails",
      "sec-basic-materials",
      "amalg-internet-platforms",
      "software-application",
      "a",
      "0-start",
    ]) {
      expect(conformingChartKey(good)).toBe(true);
    }
    expect(conformingChartKey("..")).toBe(false); // pre-existing no-.. law
  });
});

describe("coverageModel", () => {
  it("prefers n_subsectors, then n_baskets, then n_listed as the denominator", () => {
    const sp = coverageModel(sub.coverage);
    expect(sp.total).toBe(113);
    expect(sp.basis).toBe("n_subsectors");
    const bk = coverageModel(U.baskets.coverage);
    expect(bk.total).toBe(0);
    expect(bk.basis).toBe("n_baskets");
    const nx = coverageModel(ndx.coverage);
    expect(nx.total).toBe(62);
    expect(nx.basis).toBe("n_listed");
  });

  it("surfaces gateable, thin (counted, not timed), below-min, unscored, priced and reliability counts", () => {
    const model = coverageModel(sub.coverage);
    expect(model.gateable).toBe(65);
    expect(model.thin).toBe(48);
    expect(model.belowMin).toBe(2);
    expect(model.minMembers).toBe(MIN_MEMBERS);
    expect(MIN_MEMBERS).toBe(3);
    expect(model.unscored).toBe(1);
    expect(model.scored).toBe(65);
    expect(model.high).toBe(40);
    expect(model.med).toBe(20);
    expect(model.lowConf).toBe(5);
  });

  it("reports a missing denominator as null, not zero", () => {
    const model = coverageModel({
      n_gateable: 0,
      n_thin: 0,
      n_below_min_members: 0,
      n_unscored: 0,
    });
    expect(model.total).toBeNull();
    expect(model.basis).toBeNull();
  });

  it("N1 — absent counts stay null (not stated), never 0", () => {
    const model = coverageModel({ n_subsectors: 10 });
    expect(model.total).toBe(10);
    expect(model.gateable).toBeNull();
    expect(model.scored).toBeNull();
    expect(model.thin).toBeNull();
    expect(model.belowMin).toBeNull();
    expect(model.unscored).toBeNull();
    expect(model.high).toBeNull();
    expect(model.med).toBeNull();
    expect(model.lowConf).toBeNull();
  });

  it("N1 — a carried 0 is a measured zero, structurally distinct from absent", () => {
    const model = coverageModel({
      n_subsectors: 5,
      n_gateable: 0,
      n_thin: 0,
      n_below_min_members: 0,
      n_unscored: 0,
      n_high: 0,
      n_med: 0,
      n_low_conf: 0,
    });
    expect(model.gateable).toBe(0);
    expect(model.thin).toBe(0);
    expect(model.belowMin).toBe(0);
    expect(model.unscored).toBe(0);
    expect(model.high).toBe(0);
    expect(model.med).toBe(0);
    expect(model.lowConf).toBe(0);
  });

  it("N1 — a non-numeric count value is not stated either (null, never coerced)", () => {
    const model = coverageModel({
      n_subsectors: "49",
      n_gateable: Number.NaN,
      n_thin: null,
    } as unknown as Parameters<typeof coverageModel>[0]);
    expect(model.total).toBeNull();
    expect(model.gateable).toBeNull();
    expect(model.thin).toBeNull();
  });
});

describe("reliability", () => {
  it("per-group: the payload field is the source of truth (no fallback)", () => {
    const groups = groupsOf("subsectors", sub);
    const semis = groups.find((g) => g.key === "semis-equip")!;
    expect(groupReliability(semis)).toEqual({ tier: "high", fallback: false });
    // 18 members, 9 priced — thresholds would say med, but the payload says low.
    const biotech = groups.find((g) => g.key === "biotech")!;
    expect(biotech.n_priced).toBe(9);
    expect(groupReliability(biotech)).toEqual({ tier: "low", fallback: false });
  });

  it("threshold recompute is marked as a fallback for payloads missing the field", () => {
    const base = groupsOf("subsectors", sub)[0];
    expect(groupReliability({ ...base, reliability: undefined, n_priced: 12 })).toEqual({
      tier: "high",
      fallback: true,
    });
    expect(groupReliability({ ...base, reliability: undefined, n_priced: 11 })).toEqual({
      tier: "med",
      fallback: true,
    });
    expect(groupReliability({ ...base, reliability: undefined, n_priced: 5 })).toEqual({
      tier: "low",
      fallback: true,
    });
  });

  it("N4 — null reliability + null n_priced reads not_stated, never low", () => {
    const base = groupsOf("subsectors", sub)[0];
    // Nothing is carried and nothing is measurable: the honest tier is "not
    // stated" — not a fabricated "low" from a coerced 0.
    expect(groupReliability({ ...base, reliability: null, n_priced: null })).toEqual({
      tier: "not_stated",
      fallback: true,
    });
    expect(groupReliability({ ...base, reliability: undefined, n_priced: null })).toEqual({
      tier: "not_stated",
      fallback: true,
    });
    // Carried reliability is unchanged (the source of truth), and a null
    // reliability with a MEASURED count keeps today's derivation — including
    // the honest measured 0 → low.
    expect(groupReliability({ ...base, reliability: "high", n_priced: null })).toEqual({
      tier: "high",
      fallback: false,
    });
    expect(groupReliability({ ...base, reliability: null, n_priced: 0 })).toEqual({
      tier: "low",
      fallback: true,
    });
  });

  it("keeps the documented threshold boundaries (12 high, 6 med, 5 low)", () => {
    expect(RELIABLE_MIN).toBe(12);
    expect(RELIABLE_MED).toBe(6);
    expect(reliability(12)).toBe("high");
    expect(reliability(11)).toBe("med");
    expect(reliability(6)).toBe("med");
    expect(reliability(5)).toBe("low");
    expect(RELIABILITY_LABEL_KEYS).toEqual({
      high: "siUniverseReliabilityHigh",
      med: "siUniverseReliabilityMed",
      low: "siUniverseReliabilityLow",
      not_stated: "siUniverseNotStated",
    });
  });
});

describe("filterGroups", () => {
  it("matches on EN label, ZH label and sector", () => {
    const groups = groupsOf("subsectors", sub);
    expect(keys(filterGroups(groups, "Regional").matches)).toEqual(["regional-banks"]);
    expect(keys(filterGroups(groups, "financials").matches)).toEqual(["regional-banks"]);
    expect(keys(filterGroups(groups, "半导体设备").matches)).toEqual(["semis-equip"]);
  });

  it("is case-insensitive", () => {
    expect(keys(filterGroups(groupsOf("subsectors", sub), "SEMICONDUCTOR EQUIPMENT").matches)).toEqual([
      "semis-equip",
    ]);
    expect(keys(filterGroups(groupsOf("subsectors", sub), "hEaLtH cArE").matches)).toEqual(["biotech"]);
  });

  it("returns everything for empty text and nothing for no match", () => {
    const groups = groupsOf("subsectors", sub);
    expect(filterGroups(groups, "").count).toBe(groups.length);
    expect(filterGroups(groups, "   ").count).toBe(groups.length);
    const miss = filterGroups(groups, "zzz-no-such-group");
    expect(miss.matches).toEqual([]);
    expect(miss.count).toBe(0);
    expect(miss.total).toBe(groups.length);
  });
});

describe("freshnessOf (template logic exactly)", () => {
  const byKey = (k: string) => groupsOf("subsectors", sub).concat(groupsOf("nasdaq", ndx)).find((g) => g.key === k)!;

  it("T3/T4 tiers read about-to-fire, even with ticks present", () => {
    // SP software-infra: tier T3 with NULL ticks → about to fire.
    expect(freshnessOf(byKey("software-infra"))).toEqual({
      kind: "about_to_fire",
      key: "siUniverseFreshAboutTo",
    });
    // Nasdaq networking: tier T4 with ticks 3 — the tier still wins.
    expect(freshnessOf(byKey("networking")).kind).toBe("about_to_fire");
  });

  it("ticks 0 is just fired; ticks n is fired n bars ago", () => {
    expect(freshnessOf(byKey("semis-equip"))).toEqual({
      kind: "just_fired",
      key: "siUniverseFreshJustFired",
    });
    expect(freshnessOf(byKey("regional-banks"))).toEqual({
      kind: "fired_ago",
      key: "siUniverseFreshFiredAgo",
      params: { n: 4 },
    });
    expect(freshnessOf(byKey("semis-complex")).params).toEqual({ n: 11 });
  });

  it("no tier and no ticks reads as none", () => {
    expect(freshnessOf(byKey("biotech"))).toEqual({
      kind: "none",
      key: "siUniverseFreshNone",
    });
    // aerospace-defense: T2, ticks null, bars_to_cross set — still none.
    expect(freshnessOf(byKey("aerospace-defense")).kind).toBe("none");
  });

  it("covers all four kinds across the fixture", () => {
    const kinds = [...groupsOf("subsectors", sub), ...groupsOf("nasdaq", ndx)].map((g) => freshnessOf(g).kind);
    expect(new Set(kinds)).toEqual(
      new Set(["just_fired", "fired_ago", "about_to_fire", "none"]),
    );
  });
});

describe("rs60Of", () => {
  it("reads the regime rs_60d and keeps missing as null (never 0)", () => {
    const groups = groupsOf("subsectors", sub).concat(groupsOf("nasdaq", ndx));
    expect(rs60Of(groups.find((g) => g.key === "semis-equip")!)).toBe(7.4);
    expect(rs60Of(groups.find((g) => g.key === "oil-gas-ep")!)).toBeNull();
    expect(rs60Of(groups.find((g) => g.key === "networking")!)).toBeNull();
  });
});

describe("membersPreview", () => {
  const seven = groupsOf("subsectors", sub).find((g) => g.key === "semis-equip")!.members;

  it("shows the first five and counts the rest until expanded", () => {
    const collapsed = membersPreview(seven, false);
    expect(collapsed.shown.length).toBe(5);
    expect(collapsed.hidden).toBe(2);
    const expanded = membersPreview(seven, true);
    expect(expanded.shown.length).toBe(7);
    expect(expanded.hidden).toBe(0);
    expect(MEMBERS_PREVIEW).toBe(5);
  });

  it("preserves payload (owner) order — it never re-sorts", () => {
    expect(membersPreview(seven, false).shown.map((m) => m.ticker)).toEqual(
      seven.slice(0, 5).map((m) => m.ticker),
    );
    expect(membersPreview(seven, true).shown.map((m) => m.ticker)).toEqual(
      seven.map((m) => m.ticker),
    );
    // Owner order is -stock_weight, ties by -vs_basket (LRCX before KLAC).
    expect(seven.map((m) => m.ticker)).toEqual([
      "AMAT",
      "LRCX",
      "KLAC",
      "ASML",
      "TER",
      "UCTT",
      "CAMT",
    ]);
  });

  it("shows short member lists whole", () => {
    const two = groupsOf("subsectors", sub).find((g) => g.key === "biotech")!.members;
    const res = membersPreview(two, false);
    expect(res.shown.length).toBe(2);
    expect(res.hidden).toBe(0);
  });
});

describe("buyableNow vs rotationRead", () => {
  it("partitions the universe: buy view is entry_now + forming; rotation view is every scored row", () => {
    const groups = groupsOf("subsectors", sub);
    const buy = buyableNow(groups);
    const rot = rotationRead(groups);
    expect(keys(buy)).toEqual(["semis-equip", "aerospace-defense", "software-infra"]);
    expect(rot.length).toBe(groups.length);
    expect(rot).not.toBe(groups);
    expect(keys(rot)).toEqual(keys(groups));
    const buySet = new Set(buy);
    const rest = rot.filter((g) => !buySet.has(g));
    expect(rest.some((g) => g.class === "entry_now" || g.class === "forming")).toBe(false);
    expect([...buy, ...rest].length).toBe(groups.length);
  });

  it("keeps the nasdaq buy view to its own universe", () => {
    expect(keys(buyableNow(groupsOf("nasdaq", ndx)))).toEqual(["software-infra"]);
  });
});

describe("NEVER-MERGED: identical labels (and keys) stay two rows in two universes", () => {
  const sharedLabel = "Software — Infrastructure";

  it("the fixture carries the same label AND key in both universes as distinct groups", () => {
    const inSub = groupsOf("subsectors", sub).find((g) => g.label === sharedLabel)!;
    const inNdx = groupsOf("nasdaq", ndx).find((g) => g.label === sharedLabel)!;
    expect(inSub.key).toBe("software-infra");
    expect(inNdx.key).toBe("software-infra");
    expect(inSub).not.toBe(inNdx);
    expect(inSub.n_priced).not.toBe(inNdx.n_priced);
  });

  it("filtering one universe never returns the other's rows", () => {
    const subHit = filterGroups(groupsOf("subsectors", sub), "software");
    expect(subHit.count).toBe(1);
    expect(keys(subHit.matches)).toEqual(["software-infra"]);
    const ndxHit = filterGroups(groupsOf("nasdaq", ndx), "software");
    expect(ndxHit.count).toBe(1);
    expect(keys(ndxHit.matches)).toEqual(["software-infra"]);
    // Same key and label — each hit is its OWN universe's object.
    expect(subHit.matches[0]).not.toBe(ndxHit.matches[0]);
    expect(subHit.matches[0]?.entry?.weight).toBe(0.4);
    expect(ndxHit.matches[0]?.entry?.weight).toBe(0.88);
  });

  it("sorted, view and league models stay inside their own universe", () => {
    const subKeys = new Set([
      ...keys(defaultSort(groupsOf("subsectors", sub))),
      ...keys(buyableNow(groupsOf("subsectors", sub))),
    ]);
    const ndxKeys = new Set([
      ...keys(defaultSort(groupsOf("nasdaq", ndx))),
      ...keys(buyableNow(groupsOf("nasdaq", ndx))),
    ]);
    // Same key string exists in both — each model holds only its own OBJECT.
    expect([...subKeys].sort()).toEqual([
      "aerospace-defense",
      "biotech",
      "broadline-retail",
      "networking-equipment",
      "oil-gas-ep",
      "regional-banks",
      "semis-equip",
      "software-infra",
    ]);
    expect([...ndxKeys].sort()).toEqual(["networking", "semis-complex", "software-infra"]);
    const subObjs = new Set(groupsOf("subsectors", sub));
    const ndxObjs = new Set(groupsOf("nasdaq", ndx));
    for (const g of groupsOf("nasdaq", ndx)) expect(subObjs.has(g)).toBe(false);
    for (const g of groupsOf("subsectors", sub)) expect(ndxObjs.has(g)).toBe(false);
    // SP's forming league contains "software-infra" — it resolves to the SP
    // object, never the nasdaq object with the same key.
    const leagues = leagueKeys(sub);
    const spRow = groupsOf("subsectors", sub).find((g) => leagues.forming.has(g.key))!;
    expect(spRow.entry?.weight).toBe(0.55); // aerospace-defense, first SP forming row
  });
});

describe("absent capability vs no-access vs zero groups are three distinct states", () => {
  it("classifies each differently", () => {
    expect(universePresence("subsectors", undefined)).toBe("absent");
    expect(universePresence("subsectors", null)).toBe("absent");
    expect(universePresence("russell", U.russell)).toBe("no_access");
    expect(universePresence("baskets", U.baskets)).toBe("zero_groups");
    expect(universePresence("subsectors", sub)).toBe("live");
  });

  it("keeps the states pairwise distinct even with edge payloads", () => {
    const noAccessWithRows: UniverseData = { ...sub, ok: false };
    expect(universePresence("subsectors", noAccessWithRows)).toBe("no_access");
    const zeroWithOk: UniverseData = { ...sub, subsectors: [] };
    expect(universePresence("subsectors", zeroWithOk)).toBe("zero_groups");
    // Each payload is mounted under ITS OWN tab: since R2-S1 a payload whose
    // owner word names another universe classifies as absent (refused), so a
    // cross-mounted payload no longer demonstrates the no_access state.
    const states = new Set([
      universePresence("subsectors", undefined),
      universePresence("russell", U.russell),
      universePresence("subsectors", zeroWithOk),
      universePresence("subsectors", sub),
    ]);
    expect(states.size).toBe(4);
  });
});

describe("R2-S1 — a payload whose owner word names another universe is refused", () => {
  it("groupsOf tables ZERO rows for a cross-mounted payload — never the other universe's rows", () => {
    // The review's exact scenario: the S&P file (sp500_subsectors word, 65
    // groups) mounted under the Nasdaq tab.
    expect(sub.universe).toBe("sp500_subsectors");
    expect(groupsOf("subsectors", sub).length).toBeGreaterThan(0);
    expect(groupsOf("nasdaq", sub)).toEqual([]);
    expect(groupsOf("russell", sub)).toEqual([]);
    // A payload claiming nasdaq's word while carrying the S&P array is refused
    // under the S&P tab (its word no longer matches). KNOWN LIMIT: under the
    // nasdaq tab that lying payload is undetectable — the word matches and the
    // `subsectors` array key is nasdaq's own; only the owner can fix a payload
    // that mislabels itself. The word check catches mis-KEYED MOUNTS, which is
    // the failure mode a mount bug produces.
    const mislabeled: UniverseData = { ...sub, universe: "nasdaq_subsectors" };
    expect(groupsOf("subsectors", mislabeled)).toEqual([]);
  });

  it("universePresence classifies a cross-mounted payload as absent (honest unavailable)", () => {
    expect(universePresence("nasdaq", sub)).toBe("absent");
    expect(universePresence("russell", sub)).toBe("absent");
    expect(universePresence("subsectors", sub)).toBe("live");
    // Each tab accepts exactly its own word — the four owner words, one each.
    const WORDS: Array<[UniverseId, string]> = [
      ["subsectors", "sp500_subsectors"],
      ["nasdaq", "nasdaq_subsectors"],
      ["russell", "russell_subsectors"],
      ["baskets", "curated_baskets"],
    ];
    for (const [tab, word] of WORDS) {
      expect(universeWordMatches(tab, { ...sub, universe: word })).toBe(true);
      expect(universePresence(tab, { ...sub, universe: word })).not.toBe("absent");
    }
    // An unknown word is a mismatch on every tab.
    expect(universeWordMatches("subsectors", { ...sub, universe: "friendly_universe" })).toBe(
      false,
    );
  });
});

describe("nullable as_of renders without a date", () => {
  it("nasdaq carries null as_of while SP carries a date", () => {
    expect(ndx.as_of).toBeNull();
    expect(sub.as_of).toBe("2026-11-07");
    // The renderer contract: t("siDepthAsOf", { date }) is only used when
    // as_of != null — a null as_of produces no date text at all.
    const asOfText = (data: UniverseData) =>
      data.as_of == null ? null : ("as of {date}".replace("{date}", data.as_of) as string);
    expect(asOfText(ndx)).toBeNull();
    expect(asOfText(sub)).toBe("as of 2026-11-07");
  });
});

describe("universeStateIsolation", () => {
  it("gives every universe its own initial UI state", () => {
    const states = initialUiStates();
    for (const id of UNIVERSE_ORDER) {
      expect(states[id]).toEqual({
        view: "rotation",
        filter: "",
        sort: "tier",
        expanded: {},
      });
    }
    const first = states[UNIVERSE_ORDER[0]];
    for (const id of UNIVERSE_ORDER.slice(1)) {
      expect(states[id]).not.toBe(first);
    }
  });

  it("changing one universe's filter and sort leaves the others untouched", () => {
    const states = initialUiStates();
    const next = patchUiState(states, "subsectors", { filter: "semi", sort: "rs60" });
    expect(next.subsectors.filter).toBe("semi");
    expect(next.subsectors.sort).toBe("rs60");
    expect(next.nasdaq.filter).toBe("");
    expect(next.nasdaq.sort).toBe("tier");
    expect(next.russell).toEqual(states.russell);
    expect(next.baskets).toEqual(states.baskets);
    expect(states.subsectors.filter).toBe("");
  });

  it("tracks expanded groups per universe and per group", () => {
    const states = initialUiStates();
    const toggled = toggleExpanded(states, "subsectors", "semis-equip");
    expect(toggled.subsectors.expanded["semis-equip"]).toBe(true);
    expect(toggled.nasdaq.expanded["semis-equip"]).toBeUndefined();
    const twice = toggleExpanded(toggled, "subsectors", "semis-equip");
    expect(twice.subsectors.expanded["semis-equip"]).toBe(false);
    const other = toggleExpanded(toggled, "nasdaq", "software-infra");
    expect(other.subsectors.expanded["semis-equip"]).toBe(true);
    expect(other.nasdaq.expanded["software-infra"]).toBe(true);
  });
});

describe("rows increment — the four carried universe blocks read the real specimens", () => {
  it("sp500: 65 subsectors table rows, 11 sectors kept as a separate roll-up, envelope dated by as_of", () => {
    const read = confluenceSp500FromCarriedBlock(carried(specimen("confluence_universe_sp500")));
    expect(read.state).toBe("available");
    if (read.state !== "available") return;
    expect(read.asOf).toBe("2026-11-06");
    expect(read.asOfField).toBe("as_of");
    expect(read.data.universe).toBe("sp500_subsectors");
    expect(read.data.as_of).toBe("2026-11-06"); // data.as_of verbatim — never the envelope copy
    expect(read.data.subsectors).toHaveLength(65);
    expect(read.data.sectors).toHaveLength(11);
    expect(groupsOf("subsectors", read.data)).toHaveLength(65);
    expect(sectorRollupOf("subsectors", read.data)).toHaveLength(11);
    // Tab rows are subsectors ONLY; sector rows appear solely in the roll-up.
    expect(groupsOf("subsectors", read.data).every((g) => g.kind === "subsector")).toBe(true);
    expect(sectorRollupOf("subsectors", read.data).every((g) => g.kind === "sector")).toBe(true);
    const row = groupsOf("subsectors", read.data)[0]!;
    expect(row.key).toBe("software-application");
    expect(row.chart_key).toBe("software-application");
    expect(row.class).toBe("entry_now");
    expect(row.entry?.tier).toBe("T2");
    expect(row.entry?.weight).toBe(1);
    expect(row.regime?.label).toBe("BUY");
    expect(row.regime?.label_zh).toBe("买入");
    expect(row.price_level).toBe(10.1515); // real payload number, not a word
    expect(row.members[0]!.ticker).toBe("APP");
    expect(row.members[0]!.name_zh).toBeNull(); // null tonight — 0 of 1,020 pairs
    expect(leagueKeys(read.data).entry_now.size).toBe(3);
    expect(leagueKeys(read.data).headwind.size).toBe(22);
    expect(read.data.coverage.n_gateable).toBe(65);
  });

  it("nasdaq: 0 subsectors (honest empty tab), 6 rows only under the sector roll-up, envelope dated by generated_utc", () => {
    const read = confluenceNasdaqFromCarriedBlock(carried(specimen("confluence_universe_nasdaq")));
    expect(read.state).toBe("available");
    if (read.state !== "available") return;
    expect(read.asOf).toBe("2026-11-09 09:38 UTC");
    expect(read.asOfField).toBe("generated_utc");
    expect(read.data.universe).toBe("nasdaq_subsectors");
    expect(read.data.as_of).toBeNull(); // session not stated — envelope date never copied in
    expect(read.data.benchmark).toBe("QQQ");
    expect(read.data.region).toBe("nasdaq");
    expect(groupsOf("nasdaq", read.data)).toHaveLength(0);
    expect(sectorRollupOf("nasdaq", read.data)).toHaveLength(6);
    expect(universePresence("nasdaq", read.data)).toBe("zero_groups");
    const rollup = sectorRollupOf("nasdaq", read.data);
    expect(rollup[0]!.key).toBe("amalg-internet-platforms");
    expect(rollup[0]!.kind).toBe("sector");
    expect(rollup[0]!.label_zh).toBe("互联网与平台");
    expect(rollup[0]!.members[0]!.ticker).toBe("TTWO");
    expect(rollup[0]!.members[0]!.stock_tier).toBe("T2");
    expect(rollup[0]!.members[0]!.stock_buyable).toBe(true);
  });

  it("russell: 0 subsectors and 0 sectors — an honest zero on both, still a valid block", () => {
    const read = confluenceRussellFromCarriedBlock(carried(specimen("confluence_universe_russell")));
    expect(read.state).toBe("available");
    if (read.state !== "available") return;
    expect(read.asOfField).toBe("generated_utc");
    expect(read.data.universe).toBe("russell_subsectors");
    expect(read.data.benchmark).toBe("IWM");
    expect(groupsOf("russell", read.data)).toHaveLength(0);
    expect(sectorRollupOf("russell", read.data)).toHaveLength(0);
    expect(universePresence("russell", read.data)).toBe("zero_groups");
  });

  it("baskets: 49 rows keyed from the baskets array; chart_key carried verbatim (already b-prefixed)", () => {
    const read = confluenceBasketsFromCarriedBlock(carried(specimen("confluence_universe_baskets")));
    expect(read.state).toBe("available");
    if (read.state !== "available") return;
    expect(read.asOf).toBe("2026-11-06");
    expect(read.asOfField).toBe("as_of");
    expect(read.data.universe).toBe("curated_baskets");
    expect(read.data.benchmark).toBe("SPY");
    expect(groupsOf("baskets", read.data)).toHaveLength(49);
    expect(sectorRollupOf("baskets", read.data)).toHaveLength(0); // baskets tab has no sector roll-up
    const row = groupsOf("baskets", read.data)[0]!;
    expect(row.key).toBe("crypto-rails");
    expect(row.basket_id).toBe("crypto_rails");
    expect(row.chart_key).toBe("b-crypto-rails"); // no consumer-side prefix may be added
    expect(row.kind).toBe("basket");
    expect(row.members).toHaveLength(7);
  });

  it("the served twelve-entry object reads all four universe blocks available through the same entry contract", () => {
    const served = specimen("typed_blocks_entitled") as Record<string, unknown>;
    const reads: Array<[UniverseId, UniverseBlockRead]> = [
      ["subsectors", confluenceSp500FromCarriedBlock(served.confluence_universe_sp500)],
      ["nasdaq", confluenceNasdaqFromCarriedBlock(served.confluence_universe_nasdaq)],
      ["russell", confluenceRussellFromCarriedBlock(served.confluence_universe_russell)],
      ["baskets", confluenceBasketsFromCarriedBlock(served.confluence_universe_baskets)],
    ];
    for (const [id, read] of reads) {
      expect(read.state).toBe("available");
      if (read.state !== "available") return;
      expect(universeWordMatches(id, read.data)).toBe(true);
    }
  });
});

describe("rows increment — unavailable entries classify through the closed reason set", () => {
  const reader = confluenceSp500FromCarriedBlock;
  it.each([
    ["audience_not_entitled"],
    ["not_produced"],
    ["invalid_shape"],
    ["block_too_large"],
  ])("reason %s reads through verbatim", (reason) => {
    expect(reader({ status: "unavailable", reason, value: null })).toEqual({
      state: "unavailable",
      reason,
    });
  });

  it("an unknown reason, a missing reason, or a non-entry reads the generic unknown", () => {
    expect(reader({ status: "unavailable", reason: "solar_flare" })).toEqual({
      state: "unavailable",
      reason: "unknown",
    });
    expect(reader({ status: "unavailable" })).toEqual({ state: "unavailable", reason: "unknown" });
    expect(reader(null)).toEqual({ state: "unavailable", reason: "unknown" });
    expect(reader("nope")).toEqual({ state: "unavailable", reason: "unknown" });
  });
});

describe("rows increment — envelope failures read invalid_shape, never a partial row set", () => {
  const base = (): Record<string, unknown> =>
    structuredClone(specimen("confluence_universe_sp500")) as Record<string, unknown>;

  it.each([
    ["as_of emptied", (d: Record<string, unknown>) => void (d.as_of = "")],
    ["as_of deleted", (d: Record<string, unknown>) => void delete d.as_of],
    ["group_arrays out of order", (d: Record<string, unknown>) => void (d.group_arrays = ["sectors", "subsectors"])],
    ["group_arrays missing the sectors array", (d: Record<string, unknown>) => void (d.group_arrays = ["subsectors"])],
    ["group_arrays with an extra array", (d: Record<string, unknown>) => void (d.group_arrays = ["subsectors", "sectors", "baskets"])],
    ["data.universe is another owner's word", (d: Record<string, unknown>) => void ((d.data as Record<string, unknown>).universe = "curated_baskets")],
    ["a named array is not a list", (d: Record<string, unknown>) => void ((d.data as Record<string, unknown>).sectors = "nope")],
    ["a row is not a mapping", (d: Record<string, unknown>) => void ((d.data as Record<string, unknown>).subsectors = ["nope"])],
    ["a row lacks an own non-empty key", (d: Record<string, unknown>) => void (((d.data as { subsectors: Record<string, unknown>[] }).subsectors)[0] = { label: "x" })],
    ["members is not a list", (d: Record<string, unknown>) => void (((d.data as { subsectors: { members?: unknown }[] }).subsectors)[0]!.members = "nope")],
    ["a member lacks an own non-empty ticker", (d: Record<string, unknown>) => void (((d.data as { subsectors: { members: unknown[] }[] }).subsectors)[0]!.members[0] = { price: 1 })],
    ["entry present but not a mapping", (d: Record<string, unknown>) => void (((d.data as { subsectors: { entry?: unknown }[] }).subsectors)[0]!.entry = 5)],
    ["regime present but not a mapping", (d: Record<string, unknown>) => void (((d.data as { subsectors: { regime?: unknown }[] }).subsectors)[0]!.regime = 5)],
  ])("%s", (_label, mutate) => {
    const doc = base();
    mutate(doc);
    expect(confluenceSp500FromCarriedBlock(carried(doc))).toEqual({
      state: "unavailable",
      reason: "invalid_shape",
    });
    // One universe failing never affects another universe's block.
    const nasdaq = confluenceNasdaqFromCarriedBlock(carried(specimen("confluence_universe_nasdaq")));
    expect(nasdaq.state).toBe("available");
  });

  it("one malformed row deep in the array kills the whole block (no partial row set)", () => {
    const doc = base();
    const rows = (doc.data as Record<string, Record<string, unknown>[]>).subsectors;
    rows[40] = { key: "", label: "empty key" };
    expect(confluenceSp500FromCarriedBlock(carried(doc))).toEqual({
      state: "unavailable",
      reason: "invalid_shape",
    });
  });

  it("an available entry whose value fails the envelope also reads invalid_shape", () => {
    expect(confluenceSp500FromCarriedBlock({ status: "available", value: { as_of: "2026-11-06" } })).toEqual({
      state: "unavailable",
      reason: "invalid_shape",
    });
    expect(confluenceSp500FromCarriedBlock({ status: "available" })).toEqual({
      state: "unavailable",
      reason: "invalid_shape",
    });
  });
});

describe("rows increment — hostile rows never throw, soft cells never invalidate", () => {
  const mutateSp500 = (
    fn: (data: Record<string, unknown>) => void,
  ): Record<string, unknown> => {
    const doc = structuredClone(specimen("confluence_universe_sp500")) as Record<string, unknown>;
    fn(doc.data as Record<string, unknown>);
    return doc;
  };

  it("a row with the own key __proto__ reads (JSON own property), never resolves through the prototype", () => {
    const doc = mutateSp500((data) => {
      const rows = data.subsectors as Record<string, unknown>[];
      rows[0] = JSON.parse('{"__proto__": {"polluted": true}, "key": "__proto__", "label": "Probe"}');
    });
    const read = confluenceSp500FromCarriedBlock(carried(doc));
    expect(read.state).toBe("available");
    if (read.state !== "available") return;
    expect(read.data.subsectors![0]!.key).toBe("__proto__"); // carried verbatim; linking gates elsewhere
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined(); // Object.prototype unpolluted
  });

  it("a member whose ticker is only inherited (Object.create probe) invalidates the block", () => {
    const doc = mutateSp500((data) => {
      const rows = data.subsectors as Record<string, unknown>[];
      (rows[0]!.members as unknown[])[0] = Object.create({ ticker: "INH" });
    });
    expect(confluenceSp500FromCarriedBlock(carried(doc))).toEqual({
      state: "unavailable",
      reason: "invalid_shape",
    });
  });

  it("non-finite numbers read null per cell; an absent allow-listed key stays absent; a 300-char ticker still reads", () => {
    const doc = mutateSp500((data) => {
      const rows = data.subsectors as Record<string, unknown>[];
      const row = rows[0] as Record<string, unknown>;
      (row.members as Record<string, unknown>[])[0]!.price = Number.NaN;
      delete row.n_live; // absent stays absent — never defaulted
      (row.members as Record<string, unknown>[])[1]!.ticker = "T".repeat(300);
    });
    const read = confluenceSp500FromCarriedBlock(carried(doc));
    expect(read.state).toBe("available");
    if (read.state !== "available") return;
    const row = read.data.subsectors![0]!;
    expect(row.members[0]!.price).toBeNull(); // finite numbers only
    expect(row.n_live).toBeUndefined(); // not stated
    expect(row.members[1]!.ticker).toBe("T".repeat(300)); // carried; rendering gates elsewhere
    expect(read.data.subsectors).toHaveLength(65); // nothing else changed
  });

  it("S4 — a member arriving with emerging/emergence_href reads WITHOUT them (replaces the R6-09 carried-read test)", () => {
    const doc = mutateSp500((data) => {
      const rows = data.subsectors as Record<string, unknown>[];
      const members = (rows[0] as Record<string, unknown>).members as Record<string, unknown>[];
      members[0]!.emerging = true;
      members[0]!.emergence_href = "/company/AMAT.html";
    });
    const read = confluenceSp500FromCarriedBlock(carried(doc));
    expect(read.state).toBe("available");
    if (read.state !== "available") return;
    // The frozen wire member allow-list carries neither key and the producer
    // strips them, so the read drops both even when a stale member still
    // carries them — no emergence chip or evidence link can render from the
    // carried path. (The optional type fields stay for the old `universes`
    // payload path, untouched.)
    expect(read.data.subsectors![0]!.members[0]!.emerging).toBeUndefined();
    expect(read.data.subsectors![0]!.members[0]!.emergence_href).toBeUndefined();
  });

  it("N2 — two rows with the same key in one universe block fail the whole block (invalid_shape)", () => {
    const doc = mutateSp500((data) => {
      const rows = data.subsectors as Record<string, unknown>[];
      (rows[1] as Record<string, unknown>).key = (rows[0] as Record<string, unknown>).key;
    });
    const read = confluenceSp500FromCarriedBlock(carried(doc));
    // A duplicate key is an envelope failure: no partial row set, ever — the
    // key is the row's identity for hrefs, expansion state and leagues.
    expect(read).toEqual({ state: "unavailable", reason: "invalid_shape" });
  });
});
