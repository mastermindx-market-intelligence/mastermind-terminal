import { describe, expect, it } from 'vitest';
import { expiryPnl, expiryReference, shockedSpot, shiftedIv, syntheticPlan } from '../optionsPlanReference';

describe('synthetic call-debit expiry reference', () => {
  it('preserves midpoint versus natural, with unknown fees', () => {
    const p = syntheticPlan();
    expect(expiryReference(p)).toEqual({ debitPerShare: '2', totalDebit: '200', grossMaxLoss: '200',
      grossMaxGain: '300', breakEven: '187', fees: null, netMaxLoss: null, netMaxGain: null, netBreakEven: null });
    expect(expiryReference({ ...p, basis: 'natural' })).toMatchObject({ totalDebit: '210', grossMaxGain: '290', breakEven: '187.1' });
  });
  it.each([
    [-5, '173.28', '-200', '-210'], [-2, '178.752', '-200', '-210'], [0, '182.4', '-200', '-210'],
    [2, '186.048', '-95.2', '-105.2'], [5, '191.52', '300', '290'],
  ])('keeps shock %s and its expiry payoff exact', (shock, spot, mid, natural) => {
    const p = syntheticPlan();
    expect(shockedSpot('182.40', shock)).toBe(spot);
    expect(expiryPnl(p, spot)).toEqual({ gross: mid, net: null });
    expect(expiryPnl({ ...p, basis: 'natural' }, spot).gross).toBe(natural);
  });
  it.each([['0','-200'], ['185','-200'], ['187','0'], ['190','300'], ['1000','300']])('pins strike/tail %s', (spot, value) => {
    expect(expiryPnl(syntheticPlan(), spot).gross).toBe(value);
  });
  it('scales signed quantity and charges explicitly supplied total fees exactly once', () => {
    const p = syntheticPlan(); p.legs[0].quantity = 3; p.legs[1].quantity = -3; p.fees = '6';
    expect(expiryReference(p)).toMatchObject({ totalDebit:'600', grossMaxGain:'900', netMaxLoss:'606', netMaxGain:'894', netBreakEven:'187.02' });
    expect(expiryPnl(p, '186.048')).toEqual({ gross:'-285.6', net:'-291.6' });
  });
  it('distinguishes known zero fees from missing fees', () => {
    expect(expiryReference({ ...syntheticPlan(), fees:'0' }).netMaxLoss).toBe('200');
  });
  it('does not invent a break-even when fees consume all positive payoff', () => {
    expect(expiryReference({ ...syntheticPlan(), fees:'301' }).netBreakEven).toBeNull();
  });
  it('does not round a nonrepresentable break-even to an exact claim', () => {
    const p = syntheticPlan(); p.legs[0].quantity = 3; p.legs[1].quantity = -3; p.fees = '1';
    expect(expiryReference(p).netBreakEven).toBeNull();
  });
  it('accepts a separately declared custom debit', () => {
    expect(expiryReference({ ...syntheticPlan(), basis:'custom', customDebit:'2.05' }).totalDebit).toBe('205');
  });
  it.each(['NaN','Infinity','-1','1e2','', ' 2', '02', '2.00001', '1000001'])('rejects invalid custom %s', (customDebit) => {
    expect(() => expiryReference({ ...syntheticPlan(), basis:'custom', customDebit })).toThrow();
  });
  it.each(['0', '5', '5.1'])('rejects debit beyond this spread %s', (customDebit) => {
    expect(() => expiryReference({ ...syntheticPlan(), basis:'custom', customDebit })).toThrow('debit_outside_spread');
  });
  it('rejects missing/crossed quotes, mismatched identity and adjusted contracts', () => {
    const p = syntheticPlan(); p.legs[0].bid = null;
    expect(() => expiryReference(p)).toThrow('quote_unavailable');
    p.legs[0].bid = '6'; expect(() => expiryReference(p)).toThrow('crossed_quote');
    p.legs[0].bid = '5.2'; p.legs[1].expiry = '2026-11-20';
    expect(() => expiryReference(p)).toThrow('identity_mismatch');
    p.legs[1].expiry = p.legs[0].expiry;
    Object.assign(p.legs[0], { multiplier: 10 }); expect(() => expiryReference(p)).toThrow('unsupported_contract');
  });
  it('rejects unbalanced/fractional quantities and reversed strikes', () => {
    const p = syntheticPlan(); p.legs[0].quantity = 0.5;
    expect(() => expiryReference(p)).toThrow('invalid_quantity');
    p.legs[0].quantity = 2; expect(() => expiryReference(p)).toThrow('invalid_quantity');
    p.legs[0].quantity = 1; p.legs[0].strike = '190';
    expect(() => expiryReference(p)).toThrow('invalid_strikes');
  });
  it('adds IV percentage points without claiming valuation', () => {
    expect(shiftedIv('35.8',5)).toBe('40.8'); expect(shiftedIv('34.8',5)).toBe('39.8');
    expect(() => shiftedIv('4',-5)).toThrow('nonpositive_iv');
  });
});
