// Unit coverage for the held-position duplicate fold.

import { describe, expect, it } from 'vitest';
import { foldHeldPositions } from '../../../ingest/heldPositionFold';

const USER_A = '11111111-1111-4111-8111-aaaa11111111';
const USER_B = '22222222-2222-4222-8222-bbbb22222222';

type SourceRow = Record<string, unknown>;

function makeRow(overrides: SourceRow = {}): SourceRow {
  return {
    id: 7,
    user_id: USER_A,
    ticker: 'aapl',
    status: 'open',
    created_at: '2026-01-05T10:00:00.000Z',
    shares: 12.5,
    price: 204.25,
    notes: 'internal note',
    ...overrides,
  };
}

describe('foldHeldPositions', () => {
  it('returns an empty fold for empty input', () => {
    expect(foldHeldPositions([])).toEqual({
      positions: [],
      totalRows: 0,
      excludedRows: 0,
      duplicateRows: 0,
    });
  });

  it('isolates two users holding the same ticker', () => {
    const result = foldHeldPositions([
      makeRow({ user_id: USER_A, ticker: 'aapl', created_at: '2026-02-01T09:00:00Z' }),
      makeRow({
        user_id: `  ${USER_B.toUpperCase()}  `,
        ticker: 'AAPL',
        created_at: '2026-02-02T09:00:00Z',
      }),
    ]);

    expect(result.totalRows).toBe(2);
    expect(result.excludedRows).toBe(0);
    expect(result.duplicateRows).toBe(0);
    expect(result.positions).toEqual([
      { userId: USER_A, ticker: 'AAPL', status: 'open', rowCount: 1, firstHeldAt: '2026-02-01T09:00:00.000Z' },
      { userId: USER_B, ticker: 'AAPL', status: 'open', rowCount: 1, firstHeldAt: '2026-02-02T09:00:00.000Z' },
    ]);
  });

  it('folds user and ticker case variants and keeps the earliest normalized time and counts', () => {
    const result = foldHeldPositions([
      makeRow({ user_id: USER_A.toUpperCase(), created_at: '2026-03-03T12:00:00Z' }),
      makeRow({ ticker: '  AAPL  ', created_at: '2026-03-01T08:30:00+02:00' }),
      makeRow({ created_at: '2026-03-02T09:15:00.000Z' }),
    ]);

    expect(result.totalRows).toBe(3);
    expect(result.excludedRows).toBe(0);
    expect(result.duplicateRows).toBe(2);
    expect(result.positions).toEqual([
      { userId: USER_A, ticker: 'AAPL', status: 'open', rowCount: 3, firstHeldAt: '2026-03-01T06:30:00.000Z' },
    ]);
  });

  it('keeps open and closed positions separate for the same user and ticker', () => {
    const result = foldHeldPositions([
      makeRow({ status: 'open', created_at: '2026-04-03T10:00:00Z' }),
      makeRow({ status: 'closed', created_at: '2026-04-02T10:00:00Z' }),
      makeRow({ status: 'open', created_at: '2026-04-01T10:00:00Z' }),
    ]);

    expect(result.totalRows).toBe(3);
    expect(result.excludedRows).toBe(0);
    expect(result.duplicateRows).toBe(1);
    expect(result.positions).toEqual([
      { userId: USER_A, ticker: 'AAPL', status: 'closed', rowCount: 1, firstHeldAt: '2026-04-02T10:00:00.000Z' },
      { userId: USER_A, ticker: 'AAPL', status: 'open', rowCount: 2, firstHeldAt: '2026-04-01T10:00:00.000Z' },
    ]);
  });

  it('excludes malformed rows once each without throwing', () => {
    const result = foldHeldPositions([
      makeRow(),
      makeRow({ user_id: 'not-a-uuid' }),
      makeRow({ user_id: 12345 }),
      makeRow({ ticker: '' }),
      makeRow({ ticker: 'X'.repeat(129) }),
      makeRow({ status: 'Open' }),
      makeRow({ status: 1 }),
      makeRow({ created_at: '2026-01-02T03:04:05' }),
      makeRow({ created_at: 'not-a-timestamp' }),
      makeRow({ created_at: 'garbageZ' }),
      makeRow({ created_at: 1767225600000 }),
      'row-as-string',
      null,
      ['nope'],
    ]);

    expect(result.totalRows).toBe(14);
    expect(result.excludedRows).toBe(13);
    expect(result.duplicateRows).toBe(0);
    expect(result.positions).toEqual([
      { userId: USER_A, ticker: 'AAPL', status: 'open', rowCount: 1, firstHeldAt: '2026-01-05T10:00:00.000Z' },
    ]);
  });

  it('omits ignored source fields from the serialized output', () => {
    const result = foldHeldPositions([
      makeRow({ id: 42, shares: 7.5, price: 999.99, notes: 'secret-note', extra: { deep: true } }),
    ]);

    expect(result.positions).toHaveLength(1);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('shares');
    expect(serialized).not.toContain('price');
    expect(serialized).not.toContain('notes');
    expect(serialized).not.toContain('secret-note');
    expect(serialized).not.toContain('deep');
    expect(JSON.parse(serialized)).toEqual(result);
  });

  it('produces identical sorted results for reversed input order', () => {
    const input = [
      makeRow({ id: 1, ticker: 'msft', created_at: '2026-05-01T10:00:00Z' }),
      makeRow({ id: 2, ticker: 'MSFT', created_at: '2026-05-02T10:00:00Z' }),
      makeRow({ id: 3, user_id: USER_B, ticker: 'tsla', created_at: '2026-05-03T10:00:00Z' }),
      makeRow({ id: 4, user_id: USER_B, ticker: 'TSLA', created_at: '2026-05-04T10:00:00Z' }),
    ];

    const forward = foldHeldPositions(input);
    const reversed = foldHeldPositions([...input].reverse());

    expect(reversed).toEqual(forward);
    expect(forward.totalRows).toBe(4);
    expect(forward.excludedRows).toBe(0);
    expect(forward.duplicateRows).toBe(2);
    expect(forward.positions.map((position) => [position.userId, position.ticker, position.rowCount])).toEqual([
      [USER_A, 'MSFT', 2],
      [USER_B, 'TSLA', 2],
    ]);
  });
});
