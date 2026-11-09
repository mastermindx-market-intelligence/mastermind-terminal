/**
 * Tests for the receipt-bound Tiingo BOATS REST history parser.
 *
 * Test commands (run from the package directory that owns this file):
 *   npx vitest run tiingoBoatsHistory.test.ts     # single pass
 *   npx vitest tiingoBoatsHistory.test.ts         # watch mode
 *   npx vitest run --typecheck tiingoBoatsHistory.test.ts
 */
import { describe, expect, it } from 'vitest';
import { parseTiingoBoatsHistory, type BoatsHistoryBar } from '../tiingoBoatsHistory';

const RECEIPT_A = 'aa'.repeat(32); // 64 lowercase hex chars
const RECEIPT_B = 'bb'.repeat(32);
const OBSERVED_A = '2026-10-15T20:15:00Z';
const OBSERVED_B = '2026-10-15T20:15:30Z';

/** UTC epoch seconds from calendar parts (test-side only convenience). */
function utc(
  year: number,
  monthIndex: number,
  day: number,
  hour: number,
  minute: number,
  second = 0,
): number {
  return Date.UTC(year, monthIndex, day, hour, minute, second) / 1000;
}

function receipt(
  id: string,
  overrides: Partial<{ observedAt: string; requestPath: string }> = {},
): Record<string, unknown> {
  return {
    receipt_id: id,
    raw_sha256: 'c0ffee'.padEnd(64, '0'),
    observed_at_utc: overrides.observedAt ?? OBSERVED_A,
    request_path: overrides.requestPath ?? '/boats/AAPL/prices?resampleFreq=1min',
  };
}

/** Fresh valid export; every call returns new objects so tests can mutate. */
function validInput(): Record<string, unknown> {
  return {
    schema: 'terminal.tiingo_boats_history.v1',
    symbol: 'AAPL',
    source: 'tiingo-boats-rest',
    venue: 'BOATS',
    timestamp_basis: 'utc',
    bar_seconds: 60,
    price_basis: 'vendor_reported_unqualified',
    volume_basis: 'vendor_reported_shares',
    coverage: 'captured_vendor_bars_only',
    complete: false,
    receipts: [receipt(RECEIPT_A), receipt(RECEIPT_B, { observedAt: OBSERVED_B })],
    bars: [
      [utc(2026, 6, 15, 13, 30), 251.5, 252, 251.25, 251.75, 1200],
      [utc(2026, 6, 15, 13, 31), 251.75, 251.9, 251.6, 251.8, 800],
    ],
    bar_receipt_ids: [[RECEIPT_A], [RECEIPT_B]],
  };
}

function parse(value: unknown, symbol = 'AAPL'): ReturnType<typeof parseTiingoBoatsHistory> {
  return parseTiingoBoatsHistory(value, symbol);
}

/** Assert a full refusal with an Error carrying `pattern` in its message. */
function expectRefusal(value: unknown, pattern: RegExp, symbol = 'AAPL'): void {
  let caught: unknown;
  try {
    parse(value, symbol);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(Error);
  expect((caught as Error).message).toMatch(pattern);
}

describe('valid exports', () => {
  it('parses EDT afternoon bars into America/New_York display epochs', () => {
    const result = parse(validInput());
    // 2026-07-15T13:30Z is 09:30 EDT; the ET wall clock is read as UTC.
    expect(result.bars).toEqual([
      [utc(2026, 6, 15, 9, 30), 251.5, 252, 251.25, 251.75, 1200],
      [utc(2026, 6, 15, 9, 31), 251.75, 251.9, 251.6, 251.8, 800],
    ]);
    expect(result.receiptIds).toEqual([RECEIPT_A, RECEIPT_B]);
    expect(result.observedAt).toEqual([OBSERVED_A, OBSERVED_B]);
  });

  it('parses EST winter bars five hours behind UTC', () => {
    const input = validInput();
    input.bars = [[utc(2026, 0, 15, 14, 30), 100, 101, 99.5, 100.25, 5]];
    input.receipts = [receipt(RECEIPT_A)];
    input.bar_receipt_ids = [[RECEIPT_A]];
    const result = parse(input);
    expect(result.bars).toEqual([[utc(2026, 0, 15, 9, 30), 100, 101, 99.5, 100.25, 5]]);
  });

  it('keeps exact vendor OHLCV (fractional prices, zero volume accepted)', () => {
    const input = validInput();
    input.bars = [[utc(2026, 6, 15, 13, 30), 0.0001, 12345.6789, 0.0001, 12345.6789, 0]];
    input.receipts = [receipt(RECEIPT_A)];
    input.bar_receipt_ids = [[RECEIPT_A]];
    const result = parse(input);
    const bar: BoatsHistoryBar = [utc(2026, 6, 15, 9, 30), 0.0001, 12345.6789, 0.0001, 12345.6789, 0];
    expect(result.bars).toStrictEqual([bar]);
  });

  it('accepts an empty export (no bars, no bar lineage)', () => {
    const input = validInput();
    input.receipts = [];
    input.bars = [];
    input.bar_receipt_ids = [];
    expect(parse(input)).toEqual({ bars: [], receiptIds: [], observedAt: [], requestPaths: [], barReceiptIds: [] });
  });

  it('crosses the fall-back transition when display times stay ascending', () => {
    // 2026-11-01: 05:30Z is 01:30 EDT, 07:30Z is 02:30 EST - still ascending.
    const input = validInput();
    input.bars = [
      [utc(2026, 10, 1, 5, 30), 10, 11, 9, 10.5, 1],
      [utc(2026, 10, 1, 7, 30), 10.5, 11, 10, 10.75, 2],
    ];
    input.receipts = [receipt(RECEIPT_A), receipt(RECEIPT_B, { observedAt: OBSERVED_B })];
    input.bar_receipt_ids = [[RECEIPT_A], [RECEIPT_B]];
    const result = parse(input);
    expect(result.bars.map((bar) => bar[0])).toEqual([
      utc(2026, 10, 1, 1, 30),
      utc(2026, 10, 1, 2, 30),
    ]);
  });

  it('skips the non-existent spring-forward hour without inventing bars', () => {
    // 2026-03-08: 06:30Z is 01:30 EST, 07:30Z is 03:30 EDT (02:30 never exists).
    const input = validInput();
    input.bars = [
      [utc(2026, 2, 8, 6, 30), 10, 11, 9, 10.5, 1],
      [utc(2026, 2, 8, 7, 30), 10.5, 11, 10, 10.75, 2],
    ];
    input.receipts = [receipt(RECEIPT_A), receipt(RECEIPT_B, { observedAt: OBSERVED_B })];
    input.bar_receipt_ids = [[RECEIPT_A], [RECEIPT_B]];
    const result = parse(input);
    expect(result.bars.map((bar) => bar[0])).toEqual([
      utc(2026, 2, 8, 1, 30),
      utc(2026, 2, 8, 3, 30),
    ]);
  });

  it('accepts zone-offset ISO receipts and the 2000 boundary instant', () => {
    const input = validInput();
    input.receipts = [
      receipt(RECEIPT_A, { observedAt: '2026-10-15T16:15:00-04:00' }),
      receipt(RECEIPT_B, { observedAt: '2000-01-01T00:00:00.000Z' }),
    ];
    input.bar_receipt_ids = [[RECEIPT_A], [RECEIPT_B]];
    const result = parse(input);
    expect(result.observedAt).toEqual(['2026-10-15T16:15:00-04:00', '2000-01-01T00:00:00.000Z']);
  });
});

describe('symbol and metadata contract', () => {
  it('refuses an export whose symbol mismatches the request', () => {
    const input = validInput();
    input.symbol = 'MSFT';
    expectRefusal(input, /MSFT[\s\S]*AAPL|requested symbol/);
  });

  it('refuses malformed requested symbols', () => {
    for (const bad of ['aapl', 'aapl!', '', 'BRK/B', 42, null]) {
      expectRefusal(validInput(), /symbol must be an upper-case ticker/, bad as string);
    }
    let caught: unknown;
    try {
      parseTiingoBoatsHistory(validInput(), undefined as unknown as string);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/symbol must be an upper-case ticker/);
  });

  it('refuses every wrong metadata flag', () => {
    const wrongFlags: Array<[string, unknown]> = [
      ['schema', 'terminal.tiingo_boats_history.v2'],
      ['source', 'tiingo-iex-rest'],
      ['venue', 'IEX'],
      ['timestamp_basis', 'exchange-local'],
      ['bar_seconds', 300],
      ['price_basis', 'consolidated'],
      ['volume_basis', 'rounded_lots'],
      ['coverage', 'vendor_full_history'],
      ['complete', true],
      ['complete', null],
    ];
    for (const [field, wrong] of wrongFlags) {
      const input = validInput();
      input[field] = wrong;
      expectRefusal(input, new RegExp(`${field} must be`));
    }
  });

  it('refuses unexpected top-level fields and non-object payloads', () => {
    const input = validInput();
    (input as Record<string, unknown>).hello = 'world';
    expectRefusal(input, /unexpected top-level field "hello"/);

    for (const bad of [null, undefined, 42, 'export', [], true]) {
      expectRefusal(bad, /export must be a JSON object/);
    }
  });
});

describe('bar rules', () => {
  it('refuses duplicate, descending and non-minute epochs', () => {
    const minute = utc(2026, 6, 15, 13, 30);

    const duplicate = validInput();
    duplicate.bars = [
      [minute, 1, 2, 0.5, 1.5, 10],
      [minute, 1, 2, 0.5, 1.5, 10],
    ];
    expectRefusal(duplicate, /strictly ascending/);

    const descending = validInput();
    descending.bars = [
      [minute + 60, 1, 2, 0.5, 1.5, 10],
      [minute, 1, 2, 0.5, 1.5, 10],
    ];
    expectRefusal(descending, /strictly ascending/);

    const offMinute = validInput();
    offMinute.bars = [[minute + 30, 1, 2, 0.5, 1.5, 10]];
    expectRefusal(offMinute, /60-second minute boundary/);

    const fractional = validInput();
    fractional.bars = [[minute + 0.5, 1, 2, 0.5, 1.5, 10]];
    expectRefusal(fractional, /integer number of UTC seconds/);

    for (const outside of [utc(1999, 11, 31, 23, 0), utc(2100, 0, 1, 0, 0)]) {
      const ranged = validInput();
      ranged.bars = [[outside, 1, 2, 0.5, 1.5, 10]];
      expectRefusal(ranged, /2000\.\.2100 UTC range/);
    }
  });

  it('refuses malformed OHLC shapes and non-numeric types', () => {
    const minute = utc(2026, 6, 15, 13, 30);
    const badBars: Array<[unknown[], RegExp]> = [
      [[minute, 10, 10.5, 9.9, 11, 1], /low <= min\(open, close\)/], // close above high
      [[minute, 10, 10.5, 10.1, 10.2, 1], /low <= min\(open, close\)/], // low above open
      [[minute, 0, 10.5, 9.9, 10.2, 1], /OHLC prices must be positive/],
      [[minute, 10, 10.5, -1, 10.2, 1], /OHLC prices must be positive/],
      [[minute, '10', 10.5, 9.9, 10.2, 1], /open must be a finite number/],
      [[minute, 10, 10.5, 9.9, null, 1], /close must be a finite number/],
      [[minute, 10, 10.5, 9.9, Number.NaN, 1], /close must be a finite number/],
      [[minute, 10, 10.5, 9.9, 10.2, Number.POSITIVE_INFINITY], /volume must be a finite number/],
      [[minute, 10, 10.5, 9.9, 10.2, true], /volume must be a finite number/],
      [[minute, 10, 10.5, 9.9, 10.2, -1], /volume must be non-negative/],
    ];
    for (const [bar, pattern] of badBars) {
      const input = validInput();
      input.bars = [bar];
      expectRefusal(input, pattern);
    }
  });

  it('refuses unknown volume instead of coercing it to zero', () => {
    for (const unknownVolume of [null, undefined, 'unknown', false, []]) {
      const input = validInput();
      input.bars = [[utc(2026, 6, 15, 13, 30), 10, 10.5, 9.9, 10.2, unknownVolume]];
      expectRefusal(input, /volume must be a finite number/);
    }
  });

  it('refuses rows that are not 6-element arrays', () => {
    for (const badRow of [[], [1, 2, 3, 4, 5], [1, 2, 3, 4, 5, 6, 7], 'bar', null]) {
      const input = validInput();
      input.bars = [badRow];
      expectRefusal(input, /must be \[epoch, open, high, low, close, volume\]/);
    }
  });

  it('refuses oversized exports over the 100000-bar and 512-receipt limits', () => {
    const start = utc(2026, 6, 15, 13, 30);
    const oversized = validInput();
    oversized.bars = Array.from({ length: 100_001 }, (_, index) => [
      start + index * 60,
      1,
      1,
      1,
      1,
      0,
    ]);
    expectRefusal(oversized, /bars has 100001 rows; the limit is 100000/);

    const manyReceipts = Array.from({ length: 513 }, (_, index) =>
      receipt(index.toString(16).padStart(2, '0').repeat(32)),
    );
    const receiptHeavy = validInput();
    receiptHeavy.bars = [[start, 1, 1, 1, 1, 0]];
    receiptHeavy.receipts = manyReceipts;
    receiptHeavy.bar_receipt_ids = [[RECEIPT_A]];
    expectRefusal(receiptHeavy, /receipts has 513 entries; the limit is 512/);
  });
});

describe('bar lineage', () => {
  it('refuses a bar_receipt_ids length mismatch and missing lineage', () => {
    const shortList = validInput();
    shortList.bar_receipt_ids = [[RECEIPT_A]];
    expectRefusal(shortList, /exactly one entry per bar \(2\)/);

    const emptyInner = validInput();
    emptyInner.bar_receipt_ids = [[RECEIPT_A], []];
    expectRefusal(emptyInner, /missing lineage/);

    const notAnArray = validInput();
    notAnArray.bar_receipt_ids = [RECEIPT_A, RECEIPT_B];
    expectRefusal(notAnArray, /bar_receipt_ids\[0\] must be an array/);

    const noLineageList = validInput();
    noLineageList.bar_receipt_ids = undefined;
    expectRefusal(noLineageList, /bar_receipt_ids must be an array/);
  });

  it('refuses references to unknown or malformed receipt IDs', () => {
    const unknownRef = validInput();
    unknownRef.bar_receipt_ids = [[RECEIPT_A], ['cc'.repeat(32)]];
    expectRefusal(unknownRef, /references unknown receipt/);

    // One receipt may legitimately evidence several consecutive bars.
    const sharedReceipt = validInput();
    sharedReceipt.bar_receipt_ids = [[RECEIPT_A], [RECEIPT_A]];
    expect(parse(sharedReceipt).receiptIds).toEqual([RECEIPT_A, RECEIPT_B]);

    const malformedRef = validInput();
    malformedRef.bar_receipt_ids = [['ZZ'.repeat(32)], [RECEIPT_B]];
    expectRefusal(malformedRef, /not 64 lowercase hex characters/);

    const truncatedRef = validInput();
    truncatedRef.bar_receipt_ids = [[RECEIPT_A.slice(0, 63)], [RECEIPT_B]];
    expectRefusal(truncatedRef, /not 64 lowercase hex characters/);
  });

  it('refuses duplicate, malformed or under-specified receipts', () => {
    const duplicated = validInput();
    duplicated.receipts = [receipt(RECEIPT_A), receipt(RECEIPT_A, { observedAt: OBSERVED_B })];
    expectRefusal(duplicated, /duplicate receipt_id/);

    const uppercaseId = validInput();
    uppercaseId.receipts = [receipt(RECEIPT_A.toUpperCase())];
    expectRefusal(uppercaseId, /receipt_id must be 64 lowercase hex/);

    const badDigest = validInput();
    (badDigest.receipts as Array<Record<string, unknown>>)[0].raw_sha256 = 'nothex';
    expectRefusal(badDigest, /raw_sha256 must be 64 lowercase hex/);

    const extraField = validInput();
    (extraField.receipts as Array<Record<string, unknown>>)[0].source_ip = '10.0.0.1';
    expectRefusal(extraField, /unexpected field "source_ip"/);

    const notObjects = validInput();
    notObjects.receipts = ['receipt'];
    expectRefusal(notObjects, /receipts\[0\] must be an object/);
  });

  it('validates receipt request paths against the requested symbol', () => {
    const wrongSymbol = validInput();
    wrongSymbol.receipts = [
      receipt(RECEIPT_A, { requestPath: '/boats/MSFT/prices?resampleFreq=1min' }),
    ];
    expectRefusal(wrongSymbol, /must begin \/boats\/AAPL\/prices\?/);

    const fullUrl = validInput();
    fullUrl.receipts = [
      receipt(RECEIPT_A, {
        requestPath: 'https://api.tiingo.com/boats/AAPL/prices?resampleFreq=1min',
      }),
    ];
    expectRefusal(fullUrl, /must begin \/boats\/AAPL\/prices\?/);

    for (const badPath of [
      '/boats/AAPL/prices?',
      '/boats/AAPL/prices?resampleFreq=1day',
      '/boats/AAPL/prices?other=resampleFreq=1min',
      '/boats/AAPL/history?resampleFreq=1min',
      42,
    ]) {
      const input = validInput();
      input.receipts = [receipt(RECEIPT_A, { requestPath: badPath as string })];
      expectRefusal(input, /request_path/);
    }

    const withExtraParams = validInput();
    withExtraParams.receipts = [
      receipt(RECEIPT_A, {
        requestPath: '/boats/AAPL/prices?resampleFreq=1min&columns=open,high',
      }),
    ];
    withExtraParams.bar_receipt_ids = [[RECEIPT_A], [RECEIPT_A]];
    expect(parse(withExtraParams).receiptIds).toEqual([RECEIPT_A]);
  });
});

describe('timestamps', () => {
  it('refuses non-calendar dates instead of normalizing them', () => {
    const invalidStamps = [
      '2026-02-30T00:00:00Z',
      '2026-13-01T00:00:00Z',
      '2026-00-10T00:00:00Z',
      '2025-02-29T00:00:00Z', // 2025 is not a leap year
      '2026-01-01T24:00:00Z',
      '2026-01-01T00:60:00Z',
      '2026-01-01T00:00:60Z',
    ];
    for (const stamp of invalidStamps) {
      const input = validInput();
      input.receipts = [receipt(RECEIPT_A, { observedAt: stamp })];
      expectRefusal(input, /observed_at_utc/);
    }
  });

  it('refuses stamps without an explicit zone or with a wrong shape', () => {
    const invalidStamps = [
      '2026-01-01T00:00:00', // no zone
      '2026-01-01 00:00:00Z', // space separator
      '2026-1-1T00:00:00Z', // unpadded
      '01-01-2026T00:00:00Z',
      'not-a-time',
      1_760_000_000,
      null,
    ];
    for (const stamp of invalidStamps) {
      const input = validInput();
      const first = (input.receipts as Array<Record<string, unknown>>)[0];
      first.observed_at_utc = stamp;
      expectRefusal(input, /observed_at_utc/);
    }
  });

  it('enforces the 2000..2100 UTC range on resolved instants', () => {
    const outOfRange = validInput();
    const early = (outOfRange.receipts as Array<Record<string, unknown>>)[0];
    early.observed_at_utc = '1999-12-31T23:59:59Z';
    expectRefusal(outOfRange, /2000\.\.2100/);

    const pastEnd = validInput();
    const late = (pastEnd.receipts as Array<Record<string, unknown>>)[0];
    late.observed_at_utc = '2100-01-01T00:00:00Z';
    expectRefusal(pastEnd, /2000\.\.2100/);
  });
});

describe('fall-back DST display collision', () => {
  it('refuses two UTC minutes that collapse into one ET wall clock', () => {
    // 2026-11-01: 05:30Z is 01:30 EDT and 06:30Z is 01:30 EST after the
    // fall-back - distinct source minutes, identical display minute.
    const input = validInput();
    input.bars = [
      [utc(2026, 10, 1, 5, 30), 10, 11, 9, 10.5, 1],
      [utc(2026, 10, 1, 6, 30), 10.5, 11, 10, 10.75, 2],
    ];
    expectRefusal(input, /collides with the previous bar[\s\S]*fall-back DST/);
  });
});


describe('exporter contract alignment', () => {
  it('refuses ambiguous resampling parameters and URL fragments', () => {
    for (const suffix of ['resampleFreq=1min&resampleFreq=5min', 'resampleFreq=1min#ignored', 'resampleFreq=1min&resampleFreq=1min']) {
      const value = validInput();
      value.receipts = [receipt(RECEIPT_A, {requestPath: '/boats/AAPL/prices?' + suffix}), receipt(RECEIPT_B)];
      expectRefusal(value, /resampleFreq/);
    }
  });
  it('refuses duplicate lineage within a bar', () => {
    const value = validInput();
    value.bar_receipt_ids = [[RECEIPT_A, RECEIPT_A], [RECEIPT_B]];
    expectRefusal(value, /duplicate receipt lineage/);
  });
  it('shares the exact ticker grammar of the exporter', () => {
    for (const symbol of ['1A', '^SPX', 'A/B', 'A'.repeat(33)]) {
      expect(() => parseTiingoBoatsHistory(validInput(), symbol)).toThrow(/symbol/);
    }
  });
});
