import { describe, expect, it } from 'vitest';
import { expectedMoveFromIv, tradingDaysBetween } from '../volTenorComparison';

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
// Independent deliberately linear reference: valid UTC dates, start exclusive/end inclusive.
function reference(from: string, to: string) {
  let count = 0;
  for (let ms = Date.parse(`${from}T00:00:00Z`) + DAY; ms <= Date.parse(`${to}T00:00:00Z`); ms += DAY) {
    if (![0, 6].includes(new Date(ms).getUTCDay())) count++;
  }
  return count;
}

describe('complete weekday-only expected-move horizons', () => {
  for (let weekday = 0; weekday < 7; weekday++) for (const days of [1, 2, 6, 7, 8, 799, 800, 801, 802, 1095]) {
    const startMs = Date.parse('2026-11-01T00:00:00Z') + weekday * DAY;
    const from = iso(startMs), to = iso(startMs + days * DAY);
    it(`${from} +${days} calendar days counts every eligible weekday`, () => {
      expect(tradingDaysBetween(from, to)).toBe(reference(from, to));
    });
  }
  for (const [from, to] of [['1999-12-31', '2004-03-01'], ['2099-12-31', '2104-03-01'], ['0000-01-01', '9999-12-31']]) {
    it(`preserves Gregorian weekday arithmetic ${from} to ${to}`, () => {
      expect(tradingDaysBetween(from, to)).toBe(reference(from, to));
    });
  }
  for (const [from, to] of [['2026-02-30','2026-03-03'], ['2026-02-27','2026-02-30'], ['2100-02-29','2100-03-02'], ['2026-13-01','2027-01-01'], ['not-a-date','2026-11-03'], ['2026-11-03','2026-11-03'], ['2026-11-04','2026-11-03']]) {
    it(`rejects invalid or nonpositive interval ${from} to ${to}`, () => {
      expect(tradingDaysBetween(from, to)).toBeNull();
    });
  }
  it('keeps the weekday-only approximation and source clocks in the actual expected-move calculation', () => {
    const horizonDays = tradingDaysBetween('2026-11-03', '2029-11-02');
    expect(horizonDays).toBe(783);
    const result = expectedMoveFromIv({ ivPct:40, horizonDays:horizonDays!, ivAsOf:'2026-11-02' });
    expect(result).toMatchObject({horizonDays:783, estimator:'iv_sqrt_t', annualisation:'trading_days_252', ivAsOf:'2026-11-02', spotAsOf:null, lo:null, hi:null, spot:null});
    expect(result!.pct).toBeCloseTo(40 * Math.sqrt(783/252), 12);
  });
  it('retains zero on valid weekend-only ranges and suppresses the zero-horizon estimate', () => {
    const horizonDays = tradingDaysBetween('2026-11-06', '2026-11-08');
    expect(horizonDays).toBe(0);
    expect(expectedMoveFromIv({ivPct:40,horizonDays:horizonDays!,ivAsOf:'2026-11-02'})).toBeNull();
  });
});
