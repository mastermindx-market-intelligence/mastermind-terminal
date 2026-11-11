import { describe, expect, it } from 'vitest';

import {
  createDefaultTapeView,
  decodeTapeView,
  encodeTapeView,
  type TapeDteBucket,
  type TapeMnyBucket,
  type TapeViewState,
} from '@/lib/optionsTapeView';

function buildState(overrides: Partial<TapeViewState> = {}): TapeViewState {
  return {
    ...createDefaultTapeView(),
    ...overrides,
  };
}

/** Encodes a normalized state and asserts it survives the roundtrip. */
function wire(state: TapeViewState): string {
  const encoded = encodeTapeView(state);
  expect(decodeTapeView(encoded)).toEqual(state);
  return encoded;
}

/** Canonical encoded default payload with one field overridden. */
function mutated(overrides: Record<string, unknown>): string {
  const base = JSON.parse(wire(buildState())) as Record<string, unknown>;
  return JSON.stringify({ ...base, ...overrides });
}

describe('optionsTapeView codec', () => {
  it('roundtrips a state exercising every whitelist control', () => {
    const state = buildState({
      minPrem: 250000,
      dteBuckets: ['0d', '31_90d', '90p'],
      mnyBuckets: ['itm', 'atm', 'far_otm'],
      groupFilter: 'Alpha Leaks',
      drillTicker: null,
      tapeTickerSearch: '',
      sideFilter: '~buy',
      flagFilter: 'repeated',
      sortKey: 'premium',
      sortDir: -1,
    });
    const encoded = encodeTapeView(state);
    expect(decodeTapeView(encoded)).toEqual(state);
    expect(encodeTapeView(decodeTapeView(encoded) as TapeViewState)).toBe(encoded);
  });

  it('roundtrips the drill scope and the combined group+search scope', () => {
    const drill = buildState({ drillTicker: 'NVDA' });
    const groupAndSearch = buildState({ groupFilter: 'Flow Watch', tapeTickerSearch: 'NV' });
    for (const state of [drill, groupAndSearch]) {
      const encoded = encodeTapeView(state);
      expect(decodeTapeView(encoded)).toEqual(state);
      expect(encodeTapeView(decodeTapeView(encoded) as TapeViewState)).toBe(encoded);
    }
  });

  it('exposes isolated defaults', () => {
    const a = createDefaultTapeView();
    const b = createDefaultTapeView();
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(a.dteBuckets).not.toBe(b.dteBuckets);
    expect(a.mnyBuckets).not.toBe(b.mnyBuckets);
    a.dteBuckets.push('0d');
    a.minPrem = 1000000;
    expect(b).toEqual(createDefaultTapeView());
    expect(decodeTapeView(encodeTapeView(createDefaultTapeView()))).toEqual(
      createDefaultTapeView(),
    );
  });

  it('normalizes bucket sets to whitelist order and deduplicates', () => {
    const state = buildState({
      dteBuckets: ['90p', '0d', '90p', '8_30d', '0d'] as TapeDteBucket[],
      mnyBuckets: ['far_otm', 'atm', 'itm', 'far_otm'] as TapeMnyBucket[],
    });
    const decoded = decodeTapeView(encodeTapeView(state));
    expect(decoded).not.toBeNull();
    expect(decoded?.dteBuckets).toEqual(['0d', '8_30d', '90p']);
    expect(decoded?.mnyBuckets).toEqual(['itm', 'atm', 'far_otm']);
  });

  it('decodes crafted out-of-order duplicated sets into canonical order', () => {
    const encoded =
      '{"v":1,"minPrem":0,"dteBuckets":["90p","31_90d","0d","0d"],"mnyBuckets":[],' +
      '"groupFilter":"","drillTicker":null,"tapeTickerSearch":"","sideFilter":"",' +
      '"flagFilter":"","sortKey":"ts","sortDir":1}';
    const decoded = decodeTapeView(encoded);
    expect(decoded?.dteBuckets).toEqual(['0d', '31_90d', '90p']);
  });

  it('returns fresh arrays and objects per decode call', () => {
    const encoded = encodeTapeView(buildState({ dteBuckets: ['0d'] }));
    const first = decodeTapeView(encoded);
    const second = decodeTapeView(encoded);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first?.dteBuckets).not.toBe(second?.dteBuckets);
    first?.dteBuckets.push('90p');
    expect(decodeTapeView(encoded)?.dteBuckets).toEqual(['0d']);
  });

  it('returns null for malformed JSON, non-objects and null', () => {
    expect(decodeTapeView(null)).toBeNull();
    expect(decodeTapeView('')).toBeNull();
    expect(decodeTapeView('{')).toBeNull();
    expect(decodeTapeView('not json')).toBeNull();
    expect(decodeTapeView('42')).toBeNull();
    expect(decodeTapeView('"v1"')).toBeNull();
    expect(decodeTapeView('[]')).toBeNull();
    expect(decodeTapeView('null')).toBeNull();
  });

  it('rejects unsupported versions', () => {
    expect(decodeTapeView(mutated({ v: 2 }))).toBeNull();
    expect(decodeTapeView(mutated({ v: '1' }))).toBeNull();
    expect(decodeTapeView(mutated({ v: null }))).toBeNull();
    const base = JSON.parse(wire(buildState())) as Record<string, unknown>;
    const withoutV = { ...base };
    delete withoutV.v;
    expect(decodeTapeView(JSON.stringify(withoutV))).toBeNull();
  });

  it('rejects wrong-typed and off-whitelist numerics', () => {
    expect(decodeTapeView(mutated({ minPrem: '50000' }))).toBeNull();
    expect(decodeTapeView(mutated({ minPrem: null }))).toBeNull();
    expect(decodeTapeView(mutated({ minPrem: 49999 }))).toBeNull();
    expect(decodeTapeView(mutated({ minPrem: 50000.5 }))).toBeNull();
    expect(decodeTapeView(mutated({ minPrem: 2000000 }))).toBeNull();
    expect(decodeTapeView(mutated({ minPrem: true }))).toBeNull();
    expect(decodeTapeView(mutated({ sortDir: '1' }))).toBeNull();
    expect(decodeTapeView(mutated({ sortDir: 0 }))).toBeNull();
    expect(decodeTapeView(mutated({ sortDir: 2 }))).toBeNull();
    expect(decodeTapeView(mutated({ sortDir: null }))).toBeNull();
    expect(() => encodeTapeView(buildState({ minPrem: Number.NaN }))).toThrow(Error);
    expect(() =>
      encodeTapeView(buildState({ minPrem: Number.POSITIVE_INFINITY })),
    ).toThrow(Error);
    expect(() => encodeTapeView(buildState({ minPrem: 123456 }))).toThrow(Error);
    expect(() =>
      encodeTapeView(buildState({ minPrem: '0' as unknown as number })),
    ).toThrow(Error);
  });

  it('rejects nonfinite numerics smuggled through raw JSON', () => {
    const raw =
      '{"v":1,"minPrem":1e999,"dteBuckets":[],"mnyBuckets":[],"groupFilter":"",' +
      '"drillTicker":null,"tapeTickerSearch":"","sideFilter":"","flagFilter":"",' +
      '"sortKey":"ts","sortDir":1}';
    expect(decodeTapeView(raw)).toBeNull();
  });

  it('rejects unsupported buckets, sides, flags and sort keys', () => {
    expect(decodeTapeView(mutated({ dteBuckets: ['8_40d'] }))).toBeNull();
    expect(decodeTapeView(mutated({ dteBuckets: '0d' }))).toBeNull();
    expect(decodeTapeView(mutated({ dteBuckets: [0] }))).toBeNull();
    expect(decodeTapeView(mutated({ mnyBuckets: ['otm'] }))).toBeNull();
    expect(decodeTapeView(mutated({ sideFilter: 'BUY' }))).toBeNull();
    expect(decodeTapeView(mutated({ sideFilter: '~write' }))).toBeNull();
    expect(decodeTapeView(mutated({ flagFilter: 'swept ' }))).toBeNull();
    expect(decodeTapeView(mutated({ flagFilter: 3 }))).toBeNull();
    expect(decodeTapeView(mutated({ sortKey: 'premium ' }))).toBeNull();
    expect(() => encodeTapeView(buildState({ sideFilter: 'BUY' }))).toThrow(Error);
    expect(() => encodeTapeView(buildState({ flagFilter: 'weird' }))).toThrow(Error);
    expect(() =>
      encodeTapeView(buildState({ dteBuckets: ['nope'] as unknown as TapeDteBucket[] })),
    ).toThrow(Error);
    expect(() =>
      encodeTapeView(buildState({ sortKey: 'strike' as unknown as TapeViewState['sortKey'] })),
    ).toThrow(Error);
  });

  it('rejects control characters in free-text filters', () => {
    const newline = mutated({ groupFilter: 'alpha\nbeta' });
    expect(newline).toContain('\\n');
    expect(decodeTapeView(newline)).toBeNull();
    expect(decodeTapeView(mutated({ groupFilter: 'tab\there' }))).toBeNull();
    expect(decodeTapeView(mutated({ groupFilter: 'zero\u0000byte' }))).toBeNull();
    expect(decodeTapeView(mutated({ groupFilter: 'rtl‮override' }))).toBeNull();
    expect(() => encodeTapeView(buildState({ groupFilter: 'line\nbreak' }))).toThrow(
      Error,
    );
  });

  it('roundtrips printable unicode group filters but rejects invisibles', () => {
    const state = buildState({ groupFilter: '希腊流量 αβγ ✅' });
    expect(decodeTapeView(encodeTapeView(state))).toEqual(state);
    expect(decodeTapeView(mutated({ groupFilter: 'zero​width' }))).toBeNull();
  });

  it('rejects oversized encoded state and oversized group filters', () => {
    expect(decodeTapeView(mutated({ groupFilter: 'a'.repeat(81) }))).toBeNull();
    expect(() =>
      encodeTapeView(buildState({ groupFilter: 'a'.repeat(81) })),
    ).toThrow(Error);
    expect(decodeTapeView(mutated({ groupFilter: 'a'.repeat(80) }))).not.toBeNull();
    const oversized = mutated({ groupFilter: 'a'.repeat(2100) });
    expect(oversized.length > 2048).toBe(true);
    expect(decodeTapeView(oversized)).toBeNull();
    expect(decodeTapeView('x'.repeat(2049))).toBeNull();
  });

  it('rejects missing and unknown keys', () => {
    const base = JSON.parse(wire(buildState())) as Record<string, unknown>;
    const withoutFlag = { ...base };
    delete withoutFlag.flagFilter;
    expect(decodeTapeView(JSON.stringify(withoutFlag))).toBeNull();
    const withoutSortDir = { ...base };
    delete withoutSortDir.sortDir;
    expect(decodeTapeView(JSON.stringify(withoutSortDir))).toBeNull();
    expect(decodeTapeView(mutated({ surprise: 1 }))).toBeNull();
    expect(decodeTapeView(mutated({ minPrem2: 0 }))).toBeNull();
    const polluted = mutated({});
    expect(polluted.endsWith('}')).toBe(true);
    expect(
      decodeTapeView(polluted.slice(0, -1) + ',"__proto__":{}}'),
    ).toBeNull();
  });

  it('rejects invalid ticker roots', () => {
    expect(decodeTapeView(mutated({ drillTicker: 'nvda' }))).toBeNull();
    expect(decodeTapeView(mutated({ drillTicker: '1234' }))).toBeNull();
    expect(decodeTapeView(mutated({ drillTicker: 'TOOLONGTICKER' }))).toBeNull();
    expect(decodeTapeView(mutated({ drillTicker: '' }))).toBeNull();
    expect(decodeTapeView(mutated({ drillTicker: 'NV DA' }))).toBeNull();
    expect(decodeTapeView(mutated({ drillTicker: 5 }))).toBeNull();
    expect(decodeTapeView(mutated({ drillTicker: 'BRK.B' }))).not.toBeNull();
    expect(decodeTapeView(mutated({ drillTicker: 'NVDA-X' }))).not.toBeNull();
  });

  it('normalizes search while rejecting non-printable or oversized input', () => {
    expect(decodeTapeView(mutated({ tapeTickerSearch: ' nvda ' }))?.tapeTickerSearch).toBe('NVDA');
    expect(decodeTapeView(mutated({ tapeTickerSearch: 'Nvda' }))?.tapeTickerSearch).toBe('NVDA');
    expect(decodeTapeView(mutated({ tapeTickerSearch: 'NV\nDA' }))).toBeNull();
    expect(decodeTapeView(mutated({ tapeTickerSearch: 'N'.repeat(81) }))).toBeNull();
    expect(decodeTapeView(mutated({ tapeTickerSearch: '.B' }))?.tapeTickerSearch).toBe('.B');
  });
  it('rejects unknown fields on encode as well as decode', () => {
    expect(() => encodeTapeView({ ...buildState(), unexpected: true } as TapeViewState)).toThrow();
  });
});


describe('existing Tape interaction contract', () => {
  it('keeps the existing newest-first default', () => {
    expect(createDefaultTapeView().sortDir).toBe(-1);
  });
  it('normalizes user-typed search using the same trim and uppercase as the Tape', () => {
    expect(decodeTapeView(encodeTapeView(buildState({ tapeTickerSearch: ' nvda ' })))?.tapeTickerSearch).toBe('NVDA');
    expect(decodeTapeView(encodeTapeView(buildState({ tapeTickerSearch: '.b' })))?.tapeTickerSearch).toBe('.B');
  });
  it('retains dormant group and applied search when drilling existing rows', () => {
    const state = buildState({ groupFilter: 'Technology', drillTicker: 'NVDA', tapeTickerSearch: 'NV' });
    expect(decodeTapeView(encodeTapeView(state))).toEqual(state);
  });
  it('rejects a premium threshold that has no corresponding existing control', () => {
    expect(decodeTapeView(mutated({ minPrem: 50_000 }))).toBeNull();
    expect(() => encodeTapeView(buildState({ minPrem: 50_000 }))).toThrow();
  });
});
