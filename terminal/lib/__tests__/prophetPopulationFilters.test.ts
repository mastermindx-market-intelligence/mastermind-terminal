import { describe, expect, it } from "vitest";
import {
  PROPHET_POPULATION_GROUP_KEY, PROPHET_POPULATION_Q_KEY,
  prophetPopulationHref, readProphetPopulationFilters,
} from "@/lib/prophetPopulationFilters";
import {
  DEFAULT_SECTOR_STATE, parseSectorState, writeSectorState, type SectorState,
} from "@/lib/sectorIntelligence";

const params = (query: string) => new URLSearchParams(query);

describe("readProphetPopulationFilters — grammar-gated restore", () => {
  it("reads the two admissible values back", () => {
    expect(readProphetPopulationFilters(params(
      `${PROPHET_POPULATION_GROUP_KEY}=us_sector_industrials&${PROPHET_POPULATION_Q_KEY}=carr`,
    ))).toEqual({ group: "us_sector_industrials", q: "carr" });
  });

  it("an absent key is the default — all groups, no search", () => {
    expect(readProphetPopulationFilters(params("tab=sectors&group=semiconductors")))
      .toEqual({ group: null, q: null });
  });

  it.each([
    ["an uppercase group id", `${PROPHET_POPULATION_GROUP_KEY}=Us_Sector`, { group: null, q: null }],
    ["an over-length group id", `${PROPHET_POPULATION_GROUP_KEY}=${"a".repeat(81)}`, { group: null, q: null }],
    ["an empty group id", `${PROPHET_POPULATION_GROUP_KEY}=`, { group: null, q: null }],
    ["an over-length search", `${PROPHET_POPULATION_Q_KEY}=${"a".repeat(65)}`, { group: null, q: null }],
    ["a search with an illegal character", `${PROPHET_POPULATION_Q_KEY}=car(r`, { group: null, q: null }],
  ])("ignores %s — never a partially-applied filter", (_name, query, expected) => {
    expect(readProphetPopulationFilters(params(query))).toEqual(expected);
  });

  it("one valid and one invalid value restores only the valid one", () => {
    expect(readProphetPopulationFilters(params(
      `${PROPHET_POPULATION_GROUP_KEY}=us_sector_industrials&${PROPHET_POPULATION_Q_KEY}=@@@`,
    ))).toEqual({ group: "us_sector_industrials", q: null });
  });
});

describe("prophetPopulationHref — surgical write, foreign keys untouched", () => {
  it("sets both keys and preserves every foreign parameter with its value", () => {
    const href = prophetPopulationHref("/discover", params("tab=sectors&sectorWorkspace=detail&group=semiconductors"),
      { group: "us_sector_industrials", q: "carrier & co" });
    const url = new URL(`https://terminal.test${href}`);
    expect(url.searchParams.get("tab")).toBe("sectors");
    expect(url.searchParams.get("sectorWorkspace")).toBe("detail");
    expect(url.searchParams.get("group")).toBe("semiconductors"); // the workspace's own bare key, untouched
    expect(url.searchParams.get(PROPHET_POPULATION_GROUP_KEY)).toBe("us_sector_industrials");
    expect(url.searchParams.get(PROPHET_POPULATION_Q_KEY)).toBe("carrier & co"); // '&' round-trips
  });

  it("removing a filter removes its key, not the page's other state", () => {
    const href = prophetPopulationHref("/discover", params(
      `tab=sectors&${PROPHET_POPULATION_GROUP_KEY}=us_sector_industrials&${PROPHET_POPULATION_Q_KEY}=carr`,
    ), { group: null, q: null });
    const url = new URL(`https://terminal.test${href}`);
    expect(url.searchParams.get("tab")).toBe("sectors");
    expect(url.searchParams.has(PROPHET_POPULATION_GROUP_KEY)).toBe(false);
    expect(url.searchParams.has(PROPHET_POPULATION_Q_KEY)).toBe(false);
  });

  it("is an identity when the filters already match the address", () => {
    const query = `tab=sectors&${PROPHET_POPULATION_GROUP_KEY}=us_sector_industrials&${PROPHET_POPULATION_Q_KEY}=carr`;
    expect(prophetPopulationHref("/discover", params(query), { group: "us_sector_industrials", q: "carr" }))
      .toBe(`/discover?${query}`);
  });

  it("round-trips: what it writes is what readProphetPopulationFilters restores", () => {
    const href = prophetPopulationHref("/discover", params("tab=sectors"),
      { group: "us_sector_memory_storage", q: "seagate's drive" });
    expect(readProphetPopulationFilters(new URL(`https://terminal.test${href}`).searchParams))
      .toEqual({ group: "us_sector_memory_storage", q: "seagate's drive" });
  });

  it("a default address stays clean — no empty keys minted", () => {
    expect(prophetPopulationHref("/discover", params(""), { group: null, q: null })).toBe("/discover");
  });

  it("a repeated foreign parameter survives verbatim and in order (review: set collapsed it to the last value)", () => {
    expect(prophetPopulationHref("/discover", params("tab=sectors&x=1&x=2"), { group: "us_sector_industrials", q: null }))
      .toBe("/discover?tab=sectors&x=1&x=2&prophetPopulationGroup=us_sector_industrials");
  });

  it("repeated values of OUR OWN keys all fall away — one canonical value, never a stale survivor", () => {
    const href = prophetPopulationHref("/discover", params(
      `tab=sectors&${PROPHET_POPULATION_GROUP_KEY}=a&${PROPHET_POPULATION_GROUP_KEY}=b`,
    ), { group: "housing", q: null });
    const url = new URL(`https://terminal.test${href}`);
    expect(url.searchParams.getAll(PROPHET_POPULATION_GROUP_KEY)).toEqual(["housing"]);
    expect(url.searchParams.get("tab")).toBe("sectors");
  });
});

describe("our keys survive the sector workspace's own URL rewrites", () => {
  // The workspace's writer (lib/sectorIntelligence.ts writeSectorState, called
  // from its change()) sets and deletes only ITS OWN keys on a URL built from
  // the page's current address — a prophet-prefixed key it does not know rides
  // along untouched. That is the load-bearing fact for M3's restore, so it is
  // pinned here for every workspace action that rewrites the address, not
  // assumed from a source reading.
  const withOurKeys = "tab=sectors&sectorWorkspace=detail&sectorJob=research&sectorView=companies"
    + `&group=us_sector_industrials&${PROPHET_POPULATION_GROUP_KEY}=us_sector_industrials&${PROPHET_POPULATION_Q_KEY}=carr`;

  const rewrite = (url: URL, state: SectorState): string => writeSectorState(url, state);

  it.each([
    ["switching the workspace surface", (s: SectorState) => ({ ...s, workspace: "rotation" as const })],
    ["switching the workspace view", (s: SectorState) => ({ ...s, view: "signals" as const })],
    ["selecting another sector group (the workspace's own bare group key)", (s: SectorState) => ({ ...s, group: "software" })],
    ["selecting a company dossier", (s: SectorState) => ({ ...s, company: "AAPL" })],
    ["flipping the theme", (s: SectorState) => ({ ...s, theme: "light" as const })],
    ["changing sort and query together", (s: SectorState) => ({ ...s, sort: "ticker" as const, query: "filter words" })],
    ["returning to the sector defaults", () => DEFAULT_SECTOR_STATE],
  ])("%s keeps both prophet keys byte-identical", (_name, mutate) => {
    const url = new URL(`https://terminal.test/discover?${withOurKeys}`);
    const rewritten = rewrite(url, mutate(parseSectorState(url.searchParams)));
    const out = new URL(`https://terminal.test${rewritten.startsWith("/") ? rewritten : `/${rewritten}`}`);
    expect(out.searchParams.get(PROPHET_POPULATION_GROUP_KEY)).toBe("us_sector_industrials");
    expect(out.searchParams.get(PROPHET_POPULATION_Q_KEY)).toBe("carr");
  });

  it("the round-trip through parseSectorState/writeSectorState preserves them too", () => {
    const url = new URL(`https://terminal.test/discover?${withOurKeys}`);
    const out = new URL(new URL(`https://terminal.test${writeSectorState(new URL(url.toString()), parseSectorState(url.searchParams))}`)
      .toString());
    expect(out.searchParams.get(PROPHET_POPULATION_GROUP_KEY)).toBe("us_sector_industrials");
    expect(out.searchParams.get(PROPHET_POPULATION_Q_KEY)).toBe("carr");
  });
});
