import { describe, expect, it } from 'vitest';

import { describeExposure, isObservedSession } from '../exposureWorkspace';
import type { ExposureNode } from '../marketStructure';

const node = (strike: number, netMn: number | null): ExposureNode => ({
  strike,
  netMn,
  grossMn: null,
  grossShare: null,
});

describe('describeExposure ranking', () => {
  it('ranks by descending absolute net and preserves signed values', () => {
    const rows = [node(100, 50), node(105, -900), node(110, -400), node(115, 900)];
    const { ranked } = describeExposure(rows, null, null);
    expect(ranked.map((row) => [row.strike, row.netMn])).toEqual([
      [105, -900],
      [115, 900],
      [110, -400],
      [100, 50],
    ]);
  });

  it('breaks magnitude ties by distance to spot, then by lower strike', () => {
    const rows = [node(108, 250), node(92, -250), node(70, 250)];
    const { ranked } = describeExposure(rows, 100, null);
    expect(ranked.map((row) => row.strike)).toEqual([92, 108, 70]);
  });

  it('breaks magnitude ties by lower strike when spot is absent', () => {
    const rows = [node(115, 100), node(90, -100)];
    expect(describeExposure(rows, null, null).ranked.map((row) => row.strike)).toEqual([90, 115]);
  });

  it('excludes zero nets from ranking while keeping known-row ratios', () => {
    const rows = [node(100, 0), node(105, -400), node(110, -100)];
    const result = describeExposure(rows, 100, null);
    expect(result.ranked.map((row) => row.strike)).toEqual([105, 110]);
    expect(result.absoluteNetShare).toBeCloseTo(0.8, 12);
    expect(result.runnerUpRatio).toBeCloseTo(0.25, 12);
    expect(result.contested).toBe(false);
  });
});

describe('describeExposure unknown rows', () => {
  it('withholds unknown nets from measured rows while preserving known ranked rows', () => {
    const rows = [node(105, -600), node(110, null), node(115, 300)];
    const result = describeExposure(rows, 100, null);
    expect(result.ranked.map((row) => row.strike)).toEqual([105, 115]);
    expect(result.above?.strike).toBe(105);
    expect(result.runnerUpRatio).toBeNull();
    expect(result.contested).toBeNull();
    expect(result.absoluteNetShare).toBeNull();
  });

  it('treats NaN and infinite nets as unknown, never as zero', () => {
    const rows = [node(100, Number.NaN), node(101, Number.POSITIVE_INFINITY), node(102, 0)];
    const result = describeExposure(rows, 100, null);
    expect(result.ranked).toEqual([]);
    expect(result.above).toBeNull();
    expect(result.below).toBeNull();
    expect(result.runnerUpRatio).toBeNull();
    expect(result.contested).toBeNull();
    expect(result.absoluteNetShare).toBeNull();
  });

  it('returns null ratios for zero-only rows', () => {
    const rows = [node(100, 0), node(105, 0)];
    const result = describeExposure(rows, 100, 110);
    expect(result.ranked).toEqual([]);
    expect(result.above).toBeNull();
    expect(result.below).toBeNull();
    expect(result.runnerUpRatio).toBeNull();
    expect(result.contested).toBeNull();
    expect(result.absoluteNetShare).toBeNull();
    expect(result.intervening.map((row) => row.strike)).toEqual([105]);
  });

  it('handles empty input with null ratios and empty geometry', () => {
    const result = describeExposure([], 100, 110);
    expect(result.ranked).toEqual([]);
    expect(result.above).toBeNull();
    expect(result.below).toBeNull();
    expect(result.intervening).toEqual([]);
    expect(result.distancePoints).toBe(10);
    expect(result.runnerUpRatio).toBeNull();
    expect(result.contested).toBeNull();
    expect(result.absoluteNetShare).toBeNull();
  });
});

describe('describeExposure spot geometry', () => {
  it('finds the nearest known rows strictly above and below spot', () => {
    const rows = [node(90, 100), node(102, -100), node(104, -50), node(110, 100), node(88, 20)];
    const { above, below } = describeExposure(rows, 100, null);
    expect(above?.strike).toBe(102);
    expect(below?.strike).toBe(90);
  });

  it('withholds nearest rows, distance, and route for an invalid spot', () => {
    const rows = [node(105, -100), node(95, 100)];
    const result = describeExposure(rows, Number.NaN, 120);
    expect(result.above).toBeNull();
    expect(result.below).toBeNull();
    expect(result.distancePoints).toBeNull();
    expect(result.distancePercent).toBeNull();
    expect(result.intervening).toEqual([]);
  });

  it('measures distance only for finite positive spot and target', () => {
    const rows = [node(110, 100)];
    expect(describeExposure(rows, 100, 125).distancePoints).toBe(25);
    expect(describeExposure(rows, 100, 75).distancePercent).toBe(-25);
    expect(describeExposure(rows, 0, 120).above).toBeNull();
    expect(describeExposure(rows, 100, 125).distancePercent).toBeCloseTo(25, 10);
    expect(describeExposure(rows, 100, null).distancePoints).toBeNull();
    expect(describeExposure(rows, 100, Number.POSITIVE_INFINITY).distancePoints).toBeNull();
    expect(describeExposure(rows, 0, 120).distancePoints).toBeNull();
    expect(describeExposure(rows, 100, 0).distancePoints).toBeNull();
  });

  it('lists the route along upward travel, excluding endpoints', () => {
    const rows = [node(90, 100), node(105, 100), node(110, 100), node(115, 100), node(120, 100)];
    const { intervening } = describeExposure(rows, 100, 120);
    expect(intervening.map((row) => row.strike)).toEqual([105, 110, 115]);
  });

  it('lists the route along downward travel, excluding endpoints', () => {
    const rows = [node(90, 100), node(105, 100), node(110, 100), node(115, 100)];
    const { intervening } = describeExposure(rows, 115, 90);
    expect(intervening.map((row) => row.strike)).toEqual([110, 105]);
  });

  it('returns an empty route when target equals spot', () => {
    expect(describeExposure([node(105, 100)], 105, 105).intervening).toEqual([]);
  });
});

describe('describeExposure ratios', () => {
  it('computes runner-up ratio and the contested threshold on fully known rows', () => {
    const rows = [node(100, -1000), node(110, -900), node(120, 100)];
    const { runnerUpRatio, contested } = describeExposure(rows, 100, null);
    expect(runnerUpRatio).toBeCloseTo(0.9, 12);
    expect(contested).toBe(true);
  });

  it('marks a clear leader as not contested', () => {
    const rows = [node(100, -1000), node(110, 500)];
    const { runnerUpRatio, contested } = describeExposure(rows, null, null);
    expect(runnerUpRatio).toBeCloseTo(0.5, 12);
    expect(contested).toBe(false);
  });

  it('reports covered absolute NET share, not gross or whole-market share', () => {
    const rows = [node(100, -600), node(110, 200), node(120, 200)];
    expect(describeExposure(rows, null, null).absoluteNetShare).toBeCloseTo(0.6, 12);
  });

  it('withholds ratios when strikes repeat or are not positive and finite', () => {
    const duplicateStrikes = [node(105, -600), node(105, 300)];
    expect(describeExposure(duplicateStrikes, null, null).runnerUpRatio).toBeNull();

    const nonPositiveStrike = [node(-105, -600), node(105, 300)];
    expect(describeExposure(nonPositiveStrike, null, null).runnerUpRatio).toBeNull();
    expect(describeExposure(nonPositiveStrike, null, null).contested).toBeNull();
  });
});

describe('describeExposure input safety', () => {
  it('never mutates the supplied array or its rows', () => {
    const rows = [node(110, -400), node(100, 50), node(105, -900)];
    const snapshot = JSON.stringify(rows);
    const frozen = Object.freeze(rows.map((row) => Object.freeze({ ...row })));
    const result = describeExposure(frozen, 100, 120);
    expect(result.ranked.map((row) => row.strike)).toEqual([105, 110, 100]);
    expect(JSON.stringify(rows)).toBe(snapshot);
    expect(result.ranked).not.toBe(rows);
    expect(result.intervening).not.toBe(rows);
    expect(result.ranked[0]).toBe(frozen[2]);
  });
});

describe('observed source session', () => {
  it('fences matching future books and ranks, malformed dates, and absent dates', () => {
    for (const date of ['2027-01-04', '2026-02-30', '2026-1-4', null, undefined]) {
      expect(isObservedSession(date, '2026-10-20')).toBe(false);
    }
    expect(isObservedSession('2026-10-19', '2026-10-20')).toBe(true);
    expect(isObservedSession('2026-10-20', '2026-10-20')).toBe(true);
  });
});
