import { describe, expect, it } from "vitest";
import type { SuiteBar } from "@/lib/indicator-canvas/types";
import {
  computePulseWave,
  PROFILE_PERIODS,
  type PulseProfile,
} from "@/lib/suites/pulse/pulseWave";

function bars(n: number): SuiteBar[] {
  return Array.from({ length: n }, (_, i) => {
    const p = 100 + i;
    return {
      t: 1_700_000_000 + i * 60,
      o: p,
      h: p + 1,
      l: p - 1,
      c: p,
      v: 1_000,
    };
  });
}

const firstFinite = (values: Float64Array) =>
  Array.from(values).findIndex((value) => Number.isFinite(value));

describe("Pulse Wave warmup", () => {
  it("waits for real close-to-close differences before both EMA stages seed", () => {
    for (const profile of ["scalper", "day", "swing"] as PulseProfile[]) {
      const p = PROFILE_PERIODS[profile];
      const input = bars(p.long + p.short + p.signal * 2 + 12);
      const { wave, gapped } = computePulseWave(input, profile);

      // diff[0] is undefined because bar 0 has no predecessor. The long EMA therefore
      // gets its len-th real difference at index long; the short EMA then needs
      // short real long-EMA values, so the first wave is long + short - 1.
      const expectedWave = p.long + p.short - 1;
      expect(firstFinite(wave), profile).toBe(expectedWave);

      // The companion EMA must likewise wait for signal*2 real wave observations.
      const expectedGapped = expectedWave + p.signal * 2 - 1;
      expect(firstFinite(gapped), `${profile} gapped`).toBe(expectedGapped);
    }
  });
});
