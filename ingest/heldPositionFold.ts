// Pure duplicate folding for canonical portfolio_positions rows.

import { normalizeTicker } from '../terminal/lib/portfolio';

export type HeldPositionStatus = 'open' | 'closed';

export interface FoldedHeldPosition {
  userId: string;
  ticker: string;
  status: HeldPositionStatus;
  rowCount: number;
  firstHeldAt: string;
}

export interface HeldPositionFoldResult {
  positions: FoldedHeldPosition[];
  totalRows: number;
  excludedRows: number;
  duplicateRows: number;
}

interface FoldAccumulator {
  userId: string;
  ticker: string;
  status: HeldPositionStatus;
  rowCount: number;
  firstHeldAt: string;
  firstHeldAtMs: number;
}

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const OFFSET_AWARE_TAIL = /(?:Z|[+-][0-9]{2}:[0-9]{2})$/;

function canonicalUserId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  return CANONICAL_UUID.test(trimmed) ? trimmed : null;
}

function exactStatus(value: unknown): HeldPositionStatus | null {
  return value === 'open' || value === 'closed' ? value : null;
}

function isoUtcCreatedAt(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!OFFSET_AWARE_TAIL.test(trimmed)) return null;
  const parsed = new Date(trimmed);
  const heldAtMs = parsed.getTime();
  return Number.isFinite(heldAtMs) ? parsed.toISOString() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function foldHeldPositions(rows: readonly unknown[]): HeldPositionFoldResult {
  const folds = new Map<string, FoldAccumulator>();
  let excludedRows = 0;

  for (const row of rows) {
    if (!isRecord(row)) {
      excludedRows += 1;
      continue;
    }

    let ticker: string | null = null;
    if (typeof row.ticker === 'string') {
      try {
        ticker = normalizeTicker(row.ticker);
      } catch {
        ticker = null;
      }
    }

    const userId = canonicalUserId(row.user_id);
    const status = exactStatus(row.status);
    const firstHeldAt = isoUtcCreatedAt(row.created_at);

    if (ticker === null || userId === null || status === null || firstHeldAt === null) {
      excludedRows += 1;
      continue;
    }

    const key = `${userId}|${ticker}|${status}`;
    const existing = folds.get(key);

    if (existing === undefined) {
      folds.set(key, {
        userId,
        ticker,
        status,
        rowCount: 1,
        firstHeldAt,
        firstHeldAtMs: Date.parse(firstHeldAt),
      });
      continue;
    }

    existing.rowCount += 1;
    const heldAtMs = Date.parse(firstHeldAt);
    if (heldAtMs < existing.firstHeldAtMs) {
      existing.firstHeldAt = firstHeldAt;
      existing.firstHeldAtMs = heldAtMs;
    }
  }

  const positions: FoldedHeldPosition[] = [];
  let duplicateRows = 0;

  for (const fold of folds.values()) {
    duplicateRows += fold.rowCount - 1;
    positions.push({
      userId: fold.userId,
      ticker: fold.ticker,
      status: fold.status,
      rowCount: fold.rowCount,
      firstHeldAt: fold.firstHeldAt,
    });
  }

  positions.sort(
    (a, b) =>
      compareStrings(a.userId, b.userId) || compareStrings(a.ticker, b.ticker) || compareStrings(a.status, b.status),
  );

  return { positions, totalRows: rows.length, excludedRows, duplicateRows };
}
