import { describe, expect, it } from "vitest";
import { cycleSnapshot } from "../sectorCycleSnapshot";
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
