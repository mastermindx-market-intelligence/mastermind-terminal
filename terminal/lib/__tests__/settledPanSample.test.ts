import { describe, expect, it } from "vitest";
import {
  panSampleOk,
  panSampleSame,
  panTravelError,
  panTravelOk,
} from "../../e2e/helpers/panTravel";

// RED on the previous PLAT-9 head (b706144): the drag specs polled
// `moved > dx * 0.5` then one-shot `|moved - dx| < dx * 0.35`. Playwright's
// Received is that absolute error, not pan distance. Those one-shot readings
// fail this predicate; a settled pair at the requested dx passes.

const DX = 180;

describe("panTravelError — Received is |moved - dx|", () => {
  it("is the hosted marker-tooltip reading from job 101657271576", () => {
    expect(panTravelError(180 + 115.8504638671875, DX)).toBeCloseTo(115.8504638671875);
    expect(panTravelError(180 - 115.8504638671875, DX)).toBeCloseTo(115.8504638671875);
  });

  it("is the local indicator-prim flake (repeat4 on b706144)", () => {
    expect(panTravelError(180 - 89.2061767578125, DX)).toBeCloseTo(89.2061767578125);
  });
});

describe("panTravelOk — rejects the one-shot mid-pan samples", () => {
  it("rejects the local flake (~90.8px of a 180px drag, just past the 0.5 poll)", () => {
    expect(panTravelOk(180 - 89.2061767578125, DX)).toBe(false);
  });

  it("rejects the hosted overshoot reading (job 101657271576 Received 115.85)", () => {
    expect(panTravelOk(180 + 115.8504638671875, DX)).toBe(false);
  });

  it("rejects both hosted indicator-prim retries (job 101553532995)", () => {
    expect(panTravelOk(180 + 122.10804748535156, DX)).toBe(false);
    expect(panTravelOk(180 + 125.15272521972656, DX)).toBe(false);
  });

  it("accepts a finished 180px pan", () => {
    expect(panTravelOk(180, DX)).toBe(true);
    expect(panTravelOk(170, DX)).toBe(true);
  });
});

describe("panSampleOk / panSampleSame — one observation, not poll-then-reread", () => {
  it("rejects a lockstep split even when travel is exact", () => {
    expect(panSampleOk({ moved: 180, lockstep: 190 }, DX)).toBe(false);
  });

  it("requires the repeated reading to match", () => {
    expect(panSampleSame({ moved: 100, lockstep: 100 }, { moved: 180, lockstep: 180 })).toBe(false);
    expect(panSampleSame({ moved: 180.2, lockstep: 179.6 }, { moved: 180.4, lockstep: 179.8 })).toBe(true);
  });
});
