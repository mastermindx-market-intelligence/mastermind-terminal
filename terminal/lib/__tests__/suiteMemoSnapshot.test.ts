import { afterEach, describe, expect, it } from "vitest";
import { clearSuiteMemo, computeSuite } from "@/lib/indicator-canvas/host";
import type { SuiteColors, SuiteDef } from "@/lib/indicator-canvas/types";

const colors: SuiteColors = {
  up: "var(--up)",
  down: "var(--down)",
  flowBuy: "var(--flow-buy)",
  flowSell: "var(--flow-sell)",
  warn: "var(--warn)",
  brand: "var(--brand-2)",
  text: "var(--text)",
  muted: "var(--muted)",
  neutral: "var(--text-dim)",
};

function fixture() {
  let computes = 0;
  const def: SuiteDef = {
    key: "memo-snapshot-fixture",
    label: "Memo snapshot fixture",
    tag: "MSF",
    kind: "overlay",
    modules: [{
      key: "probe",
      label: "Probe",
      tag: "P",
      tier: "free",
      defaultOn: true,
      fields: [],
      defaults: {},
      compute: () => {
        computes++;
        return { prims: [] };
      },
    }],
  };
  const bars = [{ time: "2026-09-19", o: -0, h: Number.NaN, l: 99, c: 100, v: 1_000 }];
  const input = { bars, tf: "D", symbol: "MEMO", isIntraday: false, lang: "en" as const };
  return { def, bars, input, computes: () => computes };
}

afterEach(clearSuiteMemo);

describe("suite memo primitive snapshot", () => {
  it("hits across an equal payload copy, including NaN and signed zero", () => {
    const { def, input, computes } = fixture();
    const first = computeSuite(def, undefined, input, "free", colors);
    const copied = { ...input, bars: input.bars.map((bar) => ({ ...bar })) };
    expect(computeSuite(def, undefined, copied, "free", colors)).toBe(first);
    expect(computes()).toBe(1);
  });

  it("invalidates in-place history changes with exact Object.is semantics", () => {
    const { def, bars, input, computes } = fixture();
    const first = computeSuite(def, undefined, input, "free", colors);

    // -0 and +0 are distinct source payloads under the previous exact snapshot contract.
    bars[0].o = 0;
    const zeroCorrected = computeSuite(def, undefined, input, "free", colors);
    expect(zeroCorrected).not.toBe(first);
    expect(computes()).toBe(2);

    // Reassigning NaN to NaN is not a correction: Object.is(NaN, NaN) must still hit.
    bars[0].h = Number.NaN;
    expect(computeSuite(def, undefined, input, "free", colors)).toBe(zeroCorrected);
    expect(computes()).toBe(2);

    bars[0].c = 101;
    expect(computeSuite(def, undefined, input, "free", colors)).not.toBe(zeroCorrected);
    expect(computes()).toBe(3);
  });
});
