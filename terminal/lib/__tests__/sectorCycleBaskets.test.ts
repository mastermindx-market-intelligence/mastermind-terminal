import { describe, expect, it } from "vitest";
import { cycleBaskets } from "../sectorCycleBaskets";
const day = "2026-10-30",
  row = {
    id: "b-energy",
    name: "Energy equipment",
    kind: "basket",
    basis: "tr",
    etf_proxy: "XLE",
    coverage: 1,
    n_members: 12,
    n_stale_members: 0,
    now: { phase: "Recovery", basis: "tr", rs_21d: 4, rs_63d: 0 },
  };
const doc = (rows: unknown[], more: object = {}) => ({
  meta: { asOf: day, benchmark: "SPY", n_baskets: rows.length, ...more },
  baskets: rows,
});
describe("Macro theme comparisons", () => {
  it("keeps baskets with the same proxy separate and retains zero", () => {
    expect(
      cycleBaskets(doc([row, { ...row, id: "b-solar", name: "Solar" }]), day),
    ).toMatchObject([
      { id: "b-energy", rs63: 0, coverage: 1, phase: "Recovery" },
      { id: "b-solar" },
    ]);
  });
  it("refuses duplicate basket ids, wrong day, basis or benchmark, and incomplete roster", () => {
    expect(cycleBaskets(doc([row, row]), day)).toBeNull();
    expect(cycleBaskets(doc([row]), "2026-11-02")).toBeNull();
    expect(cycleBaskets(doc([row], { benchmark: "QQQ" }), day)).toBeNull();
    expect(cycleBaskets(doc([row], { n_baskets: 2 }), day)).toBeNull();
    expect(
      cycleBaskets(doc([{ ...row, basis: "price" }]), day)?.[0].rs21,
    ).toBeNull();
  });
  it("retains the source identity while withholding unpriced, invalid or thin returns", () => {
    for (const extra of [
      { coverage: 0 },
      { coverage: 2 },
      { n_members: 0 },
      { n_stale_members: 15 },
      { now: { ...row.now, thin_history: true } },
    ])
      expect(
        cycleBaskets(doc([{ ...row, ...extra }]), day)?.[0].rs21,
      ).toBeNull();
    expect(
      cycleBaskets(
        doc([{ ...row, now: { ...row.now, rs_21d: null, rs_63d: -3 } }]),
        day,
      )?.[0],
    ).toMatchObject({ rs21: null, rs63: -3 });
  });
});
