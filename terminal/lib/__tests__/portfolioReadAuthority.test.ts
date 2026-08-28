/**
 * portfolioReadAuthority.test.ts — "you hold nothing" must be a FACT, not a fallback (B4).
 *
 * `listPositions` fed its query result through a helper that answers `[]` for any non-array
 * `data`, and never looked at `error`. So a Supabase failure, an RLS refusal or a dropped
 * connection all came back as an empty book — and `/api/portfolio` had no way to tell an outage
 * from a portfolio that is genuinely empty. The server page's own `try/catch` could not help:
 * the error was already swallowed one layer below it, which is why that catch described `[]` as
 * "the honest empty state".
 *
 * On a holdings surface that is the worst available lie, so these tests inject the failure at the
 * transport — the shape supabase-js actually returns — and assert every layer above it.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DbResult, DbRow } from "@/lib/watchlists";
import {
  PortfolioReadError,
  listPositions,
  readPositions,
  type PortfolioDb,
} from "@/lib/portfolio";

/** Minimal transport: whatever `result` says, returned from the chain the read builds. */
function db(result: DbResult | (() => DbResult | never), onCall?: (calls: Array<[string, unknown]>) => void): PortfolioDb {
  const calls: Array<[string, unknown]> = [];
  const q: Record<string, unknown> = {};
  const settle = () => (typeof result === "function" ? result() : result);
  q.select = vi.fn(() => q);
  q.eq = vi.fn((column: string, value: unknown) => { calls.push([column, value]); return q; });
  q.order = vi.fn(() => q);
  q.limit = vi.fn(() => { onCall?.(calls); return Promise.resolve(settle()); });
  return { from: vi.fn(() => q) } as unknown as PortfolioDb;
}

const ROW = (over: Partial<DbRow> = {}): DbRow => ({
  id: "p1", ticker: "NVDA", shares: 10, entry_price: 100, entry_date: "2026-01-05",
  notes: null, status: "open", created_at: "2026-01-05T00:00:00Z", ...over,
});

beforeEach(() => { vi.clearAllMocks(); });

describe("readPositions — the book, or the fact that we could not read it", () => {
  it("reports an EMPTY BOOK when the read succeeds with zero rows", async () => {
    const read = await readPositions(db({ data: [], error: null }), "user-1");
    expect(read).toEqual({ ok: true, positions: [] });
  });

  it("reports the positions when the read succeeds with rows", async () => {
    const read = await readPositions(db({ data: [ROW(), ROW({ id: "p2", ticker: "AAPL" })], error: null }), "user-1");
    expect(read.ok).toBe(true);
    expect(read.ok && read.positions.map((p) => p.ticker)).toEqual(["NVDA", "AAPL"]);
  });

  it("reports FAILURE — not an empty book — when the store errors", async () => {
    const read = await readPositions(db({ data: null, error: { message: "connection terminated unexpectedly" } }), "user-1");
    expect(read.ok).toBe(false);
    expect(read.ok === false && read.error).toContain("connection terminated");
  });

  it("reports failure on an RLS refusal", async () => {
    const read = await readPositions(db({ data: null, error: { message: "permission denied for table portfolio_positions" } }), "user-1");
    expect(read.ok).toBe(false);
  });

  it("reports failure when an error arrives ALONGSIDE an empty data array", async () => {
    // The exact shape the old `rows()` helper turned into "zero positions".
    const read = await readPositions(db({ data: [], error: { message: "statement timeout" } }), "user-1");
    expect(read.ok).toBe(false);
  });

  it("reports failure when `data` is not a row set at all", async () => {
    const read = await readPositions(db({ data: null, error: null }), "user-1");
    expect(read.ok).toBe(false);
  });

  it("reports failure when the query THROWS mid-flight", async () => {
    const read = await readPositions(db(() => { throw new Error("socket hang up"); }), "user-1");
    expect(read.ok).toBe(false);
    expect(read.ok === false && read.error).toContain("socket hang up");
  });

  it("skips one unusable row rather than blanking a book the user can otherwise see", async () => {
    // A per-row DATA judgement — categorically different from claiming the store answered.
    const read = await readPositions(db({ data: [ROW(), ROW({ id: "p2", ticker: "" })], error: null }), "user-1");
    expect(read.ok).toBe(true);
    expect(read.ok && read.positions.map((p) => p.ticker)).toEqual(["NVDA"]);
  });

  it("scopes the read to the owner", async () => {
    let seen: Array<[string, unknown]> = [];
    await readPositions(db({ data: [], error: null }, (calls) => { seen = calls; }), "user-42");
    expect(seen).toEqual([["user_id", "user-42"]]);
  });
});

describe("listPositions — throws rather than handing back [] for 'we do not know'", () => {
  it("returns the array on success", async () => {
    expect(await listPositions(db({ data: [ROW()], error: null }), "user-1")).toHaveLength(1);
  });

  it("returns an empty array for a genuinely empty book", async () => {
    expect(await listPositions(db({ data: [], error: null }), "user-1")).toEqual([]);
  });

  it("THROWS PortfolioReadError when the store fails — the [] that started this is impossible", async () => {
    await expect(listPositions(db({ data: null, error: { message: "boom" } }), "user-1"))
      .rejects.toBeInstanceOf(PortfolioReadError);
  });
});
