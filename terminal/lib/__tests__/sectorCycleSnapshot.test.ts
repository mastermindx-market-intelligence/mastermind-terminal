import { describe, expect, it } from "vitest";
import {
  cycleSnapshot,
  cycleGenerationKey,
  cycleHistoryForGeneration,
  isSectorCycleGeneration,
  type SectorCycleGeneration,
} from "../sectorCycleSnapshot";
import { sectorRotationHistory, type SectorRotationHistory } from "../sectorIntelligence";
const asOf = "2026-10-30";
const row = {
  id: "xle",
  ticker: "XLE",
  kind: "sector",
  basis: "price",
  now: { phase: "Expansion", pos: 71.5, above200d: true, basis: "price" },
  rs_history: [{ date: asOf, rs_21d: 12.9, rs_63d: 19.8 }],
  turns: [],
};
const data = {
  meta: {
    asOf,
    rs_history: {
      benchmark: "SPY",
      basis: "tr",
      mode: "reconstructed_price_history",
      naturally_observed: false,
      max_points_per_sector: 252,
      horizons_sessions: [21, 63],
      schema: "sector_cycles.rs_history.v1",
      as_of: asOf,
    },
  },
  sectors: [row],
};
const read = (
  body: unknown,
  day: string | null = asOf,
  id = "xle",
  symbol = "XLE",
) => cycleSnapshot(body, day, id, symbol);
describe("sector cycle history: existing Macro owner", () => {
  it("keeps the phase/price basis distinct from benchmark-relative total returns", () => {
    expect(read(data)).toMatchObject({
      asOf,
      phase: "Expansion",
      position: 71.5,
      above200: true,
      basis: "price",
      series: {
        ticker: "XLE",
        points: [{ date: asOf, rs21: 12.9, rs63: 19.8 }],
      },
    });
  });
  it("preserves real zero, false and independently unavailable model fields", () => {
    expect(
      read({
        ...data,
        sectors: [
          {
            ...row,
            now: { ...row.now, phase: "not-a-phase", pos: 0, above200d: false },
          },
        ],
      }),
    ).toMatchObject({ phase: null, position: 0, above200: false });
    expect(
      read({ ...data, sectors: [{ ...row, now: { ...row.now, pos: 101 } }] })
        ?.position,
    ).toBeNull();
  });
  it("keeps negative relative values — negative is measured, not missing", () => {
    expect(
      read({
        ...data,
        sectors: [
          {
            ...row,
            rs_history: [{ date: asOf, rs_21d: -6.4, rs_63d: -0.0 }],
          },
        ],
      })?.series.points[0],
    ).toMatchObject({ rs21: -6.4, rs63: -0 });
  });
  it("never substitutes the first sector or a mismatching fund ticker", () => {
    expect(read(data, asOf, "xlk", "XLK")).toBeNull();
    expect(read(data, asOf, "xle", "XLF")).toBeNull();
  });
  it("requires the receipt and declared history dates to match the document", () => {
    expect(read(data, null)).toBeNull();
    expect(read(data, "2026-10-29")).toBeNull();
    expect(
      read({
        ...data,
        meta: {
          ...data.meta,
          rs_history: { ...data.meta.rs_history, as_of: "2026-11-01" },
        },
      }),
    ).toBeNull();
  });
  it("refuses duplicate identity and future history", () => {
    expect(read({ ...data, sectors: [row, row] })).toBeNull();
    expect(
      read({ ...data, sectors: [row, { ...row, id: "other" }] }),
    ).toBeNull();
    expect(
      read({
        ...data,
        sectors: [
          {
            ...row,
            rs_history: [{ date: "2027-01-01", rs_21d: 4, rs_63d: 2 }],
          },
        ],
      }),
    ).toBeNull();
  });
  it("does not turn unknown basis into price or publish a numeric phase position for it", () => {
    expect(
      read({
        ...data,
        sectors: [
          { ...row, basis: "other", now: { ...row.now, basis: "other" } },
        ],
      }),
    ).toMatchObject({
      basis: null,
      position: null,
      phase: null,
      above200: null,
    });
  });
});

describe("generation binding (Round 3 §2.3)", () => {
  const generation: SectorCycleGeneration = {
    accessGeneration: "gen-2026-11-07T09:00Z",
    region: "us",
    asOf,
    publicationId: "cycp1-" + "a".repeat(64),
  };
  const history: SectorRotationHistory | null = sectorRotationHistory(data);
  it("accepts a well-formed generation", () => {
    expect(isSectorCycleGeneration(generation)).toBe(true);
    expect(
      isSectorCycleGeneration({ ...generation, asOf: "2026-13-40" }),
    ).toBe(false);
  });
  it("binds history to the exact generation day: wrong epoch never renders", () => {
    expect(history).not.toBeNull();
    expect(cycleHistoryForGeneration(history, generation)).toBe(history);
    expect(
      cycleHistoryForGeneration(history, {
        ...generation,
        asOf: "2026-10-29",
      }),
    ).toBeNull();
    expect(cycleHistoryForGeneration(history, null)).toBeNull();
  });
  it("retires a replaced generation: any key component change mints a new key", () => {
    const subject = { family: "sectors", id: "xle" };
    const before = cycleGenerationKey(generation, subject);
    expect(cycleGenerationKey(generation, subject)).toBe(before);
    expect(
      cycleGenerationKey(
        { ...generation, accessGeneration: "gen-2026-11-08T09:00Z" },
        subject,
      ),
    ).not.toBe(before);
    expect(
      cycleGenerationKey({ ...generation, publicationId: null }, subject),
    ).not.toBe(before);
    expect(
      cycleGenerationKey(generation, { family: "sectors", id: "xlk" }),
    ).not.toBe(before);
    expect(
      cycleGenerationKey(generation, { family: "baskets", id: "xle" }),
    ).not.toBe(before);
  });
});
