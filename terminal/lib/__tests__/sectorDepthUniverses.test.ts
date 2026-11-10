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
} from "../sectorDepthUniverses";
import type {
  FreshnessKind,
  UniverseData,
  UniverseGroup,
  UniverseId,
} from "../sectorDepthUniverses";

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
      expect(typeof g.entry.tier).toBe("string");
      expect(typeof g.regime.label).toBe("string");
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
    expect(subHit.matches[0].entry.weight).toBe(0.4);
    expect(ndxHit.matches[0].entry.weight).toBe(0.88);
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
    expect(spRow.entry.weight).toBe(0.55); // aerospace-defense, first SP forming row
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
