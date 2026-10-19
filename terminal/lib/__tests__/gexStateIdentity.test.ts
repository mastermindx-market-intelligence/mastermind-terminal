import { describe, expect, it } from "vitest";
import * as docs from "@/components/gexdesk/matrixDoc";
import type { GexStatePayload } from "@/components/gexdesk/MarketStateCard";

const state = (overrides: Record<string, unknown> = {}) => ({
  schema: "options_structure.gex_state/v1", root: "SPY",
  asof: "2026-09-14T22:00:00Z", gamma_regime: "PIN", gamma_flip: 760,
  call_wall: 775, put_wall: 750, magnet: 765, spot: 770, ...overrides,
});
const read = (value: unknown, root = "SPY") => {
  const parser = (docs as unknown as {
    readGexStateForRoot: (value: unknown, root: string) => GexStatePayload | null;
  }).readGexStateForRoot;
  expect(typeof parser, "selected-root state reader exists").toBe("function");
  return parser(value, root);
};

describe("selected-root GEX state", () => {
  it("preserves valid data and observation time without mutating its input", () => {
    const original = state({ root: " spy " });
    const value = read(original, "spy");
    expect(value?.root).toBe("SPY");
    expect(value?.asof).toBe(original.asof);
    expect(value?.gamma_flip).toBe(760);
    expect(original.root).toBe(" spy ");
  });
  it.each([null, {}, [], state({ root: "QQQ" }), state({ root: "" }),
    state({ schema: "unrelated/v1" }), state({ root: 1 })])(
    "refuses a missing or mismatched envelope %#", (input) => {
      expect(read(input)).toBeNull();
    },
  );
  it.each([0, -1, NaN, Infinity, "760", true])(
    "keeps invalid plotted prices unavailable: %s", (bad) => {
      const value = read(state({gamma_flip: bad, call_wall: bad,
        put_wall: bad, magnet: bad, spot: bad}));
      expect(value).not.toBeNull();
      for (const key of ["gamma_flip", "call_wall", "put_wall", "magnet", "spot"] as const) {
        expect(value?.[key]).toBeNull();
      }
    },
  );
});

describe("matrix level fallback retains useful data", () => {
  it("preserves a finite current-method matrix flip when state is absent", () => {
    expect(docs.mergeMatrixLevels({levels:{gamma_flip:755}}, null).gamma_flip).toBe(755);
  });
  it("prefers the accepted state flip when both sources are valid", () => {
    expect(docs.mergeMatrixLevels({levels:{gamma_flip:755}}, {gamma_flip:760}).gamma_flip).toBe(760);
  });
  it.each([0, -1, NaN, Infinity])("rejects invalid preferred prices: %s", (bad) => {
    const levels = docs.mergeMatrixLevels({levels:{gamma_flip:755,call_wall:bad}},
      {gamma_flip:bad,call_wall:775});
    expect(levels.gamma_flip).toBe(755);
    expect(levels.call_wall).toBe(775);
  });
  it("does not invent a price when neither source is usable", () => {
    const levels = docs.mergeMatrixLevels({levels:{gamma_flip:0,put_support:NaN}},
      {gamma_flip:Infinity,put_wall:-1});
    expect(levels.gamma_flip).toBeNull();
    expect(levels.put_support).toBeNull();
  });
});

it("never merges a state from a different root into a valid matrix", () => {
  const staleState = {root:"SPY",gamma_flip:760,call_wall:775};
  const levels = docs.mergeMatrixLevels({root:"QQQ",levels:{gamma_flip:690}}, staleState);
  expect(levels.gamma_flip).toBe(690);
  expect(levels.call_wall).toBeNull();
});
