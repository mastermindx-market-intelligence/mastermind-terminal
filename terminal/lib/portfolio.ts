// Canonical portfolio-position service (W5).
//
// `portfolio_positions` has been live in the shared Supabase project since <= 2026-07-18 and had
// ZERO Terminal references until this wave: `/portfolio` rendered watchlist symbols under the name
// "Conviction Book", which is a different population entirely (packet section 1d). This module is
// the Terminal's only path to that table.
//
// Shape authority is `supabase/migrations/0007_portfolio_positions.sql` (W1b's recorded DDL,
// verified against live PostgREST introspection): id, user_id, ticker, shares, entry_price,
// entry_date, notes, status, created_at, updated_at. `shares`/`entry_price` are numeric-or-null,
// `entry_date` is a date-or-null, `status` is text the WRITER constrains to 'open' | 'closed'
// (no live CHECK is asserted, so this module coerces rather than trusting). NO new columns and no
// `portfolio_id` — a `portfolios` schema is explicitly out of scope (packet section 3).
//
// OWNER SCOPING: RLS is the authority — `portfolio_select_own` / `_insert_own` / `_update_own` /
// `_delete_own`, all `auth.uid() = user_id`. Every query here ALSO carries an explicit
// `.eq("user_id", userId)`, the same belt-and-braces `lib/watchlists.ts` uses: a policy regression
// must not silently become a cross-tenant read or write.
//
// TWO-ORGANISMS LAW (UWP-R2): user holdings never feed the signal path, boards, rankers, the Neural
// Web or alerts authority. Everything this module produces is display tier, joined client-side.

import type { DbResult, DbRow, WatchlistDb, WatchlistQuery } from "@/lib/watchlists";

/** Structural view of the Supabase client — the same subset `lib/watchlists.ts` narrows, so the
 *  e2e fixture transport and the unit tests satisfy one shape for both tables. */
export type PortfolioDb = WatchlistDb;
export type { WatchlistQuery as PortfolioQuery };

export const POSITIONS_TABLE = "portfolio_positions";
const POSITION_FIELDS = "id,ticker,shares,entry_price,entry_date,notes,status,created_at";

export type PositionStatus = "open" | "closed";

/** A position as the UI holds it. Every optional field is genuinely nullable in the DDL — an
 *  unsized position (ticker only) is a legal, deliberate state, not a broken row. */
export type Position = {
  id: string;
  ticker: string;
  shares: number | null;
  entryPrice: number | null;
  entryDate: string | null;
  notes: string | null;
  status: PositionStatus;
  createdAt: string | null;
};

export const MAX_TICKER_LEN = 128;
export const MAX_NOTES_LEN = 1000;
/** Refuse a page-sized read that could only come from a broken caller; the UI never asks for more. */
export const MAX_POSITIONS = 2000;

// Same guard `lib/watchlists.ts` carries: C0 control characters and DEL in any user-supplied text.
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
// Notes are the one free-text field where a newline or tab is legitimate content.
const CONTROL_CHARS_EXCEPT_BREAKS = /[\u0000-\u0008\u000b-\u001f\u007f]/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const one = (result: DbResult): DbRow | null => {
  const data = result?.data;
  if (Array.isArray(data)) return data[0] ?? null;
  return data && typeof data === "object" ? data : null;
};
const text = (value: unknown): string | null => (typeof value === "string" && value ? value : null);

// ───────────────────────────── normalizers (pure) ─────────────────────────────

/** Ticker, upper-cased. `null` means unusable — the one field a position cannot exist without. */
export function normalizeTicker(value: unknown): string | null {
  const ticker = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!ticker || ticker.length > MAX_TICKER_LEN || CONTROL_CHARS.test(ticker)) return null;
  return ticker;
}

/**
 * `shares` / `entry_price`: numeric-or-null, exactly the macro writer contract.
 *
 * Three outcomes, deliberately distinct: ABSENT (the key was not sent — leave the column alone on
 * an update), NULL (explicitly cleared, or an empty string from a blank form field), or a finite
 * number. Anything else is `invalid` and the caller returns 400 rather than writing a silent NULL —
 * "3O" typed for "30" must not become an unsized position that reads as deliberate.
 *
 * No sign or range constraint is invented here: the DDL asserts none, and a negative `shares` is a
 * legitimate short. Only non-finite values are refused, because they cannot round-trip as numeric.
 */
export type NumericField =
  | { kind: "absent" }
  | { kind: "value"; value: number | null }
  | { kind: "invalid" };

export function normalizeNumeric(value: unknown): NumericField {
  if (value === undefined) return { kind: "absent" };
  if (value === null) return { kind: "value", value: null };
  if (typeof value === "number") {
    return Number.isFinite(value) ? { kind: "value", value } : { kind: "invalid" };
  }
  if (typeof value === "string") {
    const raw = value.trim();
    if (!raw) return { kind: "value", value: null };
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? { kind: "value", value: parsed } : { kind: "invalid" };
  }
  return { kind: "invalid" };
}

export type TextField =
  | { kind: "absent" }
  | { kind: "value"; value: string | null }
  | { kind: "invalid" };

/** `entry_date`: a `date` column, so only `YYYY-MM-DD` — and only a real calendar day. A blank
 *  field clears it. `2026-02-31` parses as a string but is not a date; it is refused rather than
 *  handed to Postgres to reject with a 500. */
export function normalizeEntryDate(value: unknown): TextField {
  if (value === undefined) return { kind: "absent" };
  if (value === null) return { kind: "value", value: null };
  if (typeof value !== "string") return { kind: "invalid" };
  const raw = value.trim();
  if (!raw) return { kind: "value", value: null };
  if (!ISO_DATE.test(raw)) return { kind: "invalid" };
  const [year, month, day] = raw.split("-").map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  const realDay = probe.getUTCFullYear() === year
    && probe.getUTCMonth() === month - 1
    && probe.getUTCDate() === day;
  return realDay ? { kind: "value", value: raw } : { kind: "invalid" };
}

/** `notes`: free text, bounded, newlines allowed. Over-length is REFUSED, never truncated — a
 *  silently shortened note is a lie about what was saved. */
export function normalizeNotes(value: unknown): TextField {
  if (value === undefined) return { kind: "absent" };
  if (value === null) return { kind: "value", value: null };
  if (typeof value !== "string") return { kind: "invalid" };
  const raw = value.replace(/\r\n?/g, "\n").trim();
  if (!raw) return { kind: "value", value: null };
  if (raw.length > MAX_NOTES_LEN || CONTROL_CHARS_EXCEPT_BREAKS.test(raw)) return { kind: "invalid" };
  return { kind: "value", value: raw };
}

/** `status`: COERCED, never refused. The column is bare `text` with a writer-enforced pair and no
 *  asserted CHECK, so the service is what keeps the estate's two values true. Anything that is not
 *  exactly 'closed' reads as 'open' — the same rule macro's writer follows. */
export function normalizeStatus(value: unknown): PositionStatus {
  return typeof value === "string" && value.trim().toLowerCase() === "closed" ? "closed" : "open";
}

/** Narrow a PostgREST row. Rows missing an id or ticker are dropped rather than rendered as a
 *  half-position; `shares`/`entry_price` arrive as numbers or numeric strings depending on the
 *  driver, so both are accepted here and nowhere else. */
export function rowToPosition(row: DbRow): Position | null {
  const id = text(row.id);
  const ticker = normalizeTicker(row.ticker);
  if (!id || !ticker) return null;
  const numeric = (value: unknown): number | null => {
    const field = normalizeNumeric(value);
    return field.kind === "value" ? field.value : null;
  };
  return {
    id,
    ticker,
    shares: numeric(row.shares),
    entryPrice: numeric(row.entry_price),
    entryDate: text(row.entry_date),
    notes: text(row.notes),
    status: normalizeStatus(row.status),
    createdAt: text(row.created_at),
  };
}

// ───────────────────────────── reads ─────────────────────────────

/** The owner's whole book, oldest first — the order every read in the estate already uses
 *  (`order by created_at`, migration 0007's header). Open and closed both; the UI separates them. */
/**
 * The book, or the fact that it could not be read. These are DIFFERENT, and on a holdings
 * surface the difference is the whole point: "you hold nothing" and "we could not read what you
 * hold" must never render as each other.
 *
 * The bug this replaces: `listPositions` fed the query result through `rows()`, which answers
 * `[]` for any non-array `data` — so a Supabase error, an RLS refusal or a dropped connection
 * came back as an empty book with the error dropped on the floor. `/api/portfolio` then had no
 * way to tell an outage from a genuinely empty portfolio, and the page's own try/catch could not
 * help: the error was already swallowed one layer below it.
 */
export type PositionsRead =
  | { ok: true; positions: Position[] }
  | { ok: false; error: string };

/** Thrown by `listPositions` when the store did not answer. Never caught-and-emptied. */
export class PortfolioReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PortfolioReadError";
  }
}

/**
 * readPositions — the CANONICAL owner-scoped read. Both `/api/portfolio` and the server page
 * consume this one contract, so the two surfaces cannot disagree about what happened.
 *
 * Three ways this reports failure, all of them explicit:
 *   - the driver returned an `error` (the normal supabase-js failure shape);
 *   - the query threw (transport died mid-flight);
 *   - `data` is not an array, i.e. the result is not a row set at all — the exact case the old
 *     `rows()` helper silently turned into zero positions.
 *
 * A row that fails `rowToPosition` is still skipped rather than failing the whole read: a single
 * corrupt row must not blank a book the user can otherwise see. That is a per-row judgement about
 * DATA, not a claim that the store answered when it did not.
 */
export async function readPositions(db: PortfolioDb, userId: string): Promise<PositionsRead> {
  let result: DbResult;
  try {
    result = await db.from(POSITIONS_TABLE)
      .select(POSITION_FIELDS)
      .eq("user_id", userId)
      .order("created_at")
      .limit(MAX_POSITIONS);
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : "portfolio read failed" };
  }
  if (result?.error) return { ok: false, error: result.error.message || "portfolio read failed" };
  if (!Array.isArray(result?.data)) return { ok: false, error: "portfolio read returned no row set" };
  const positions: Position[] = [];
  for (const row of result.data) {
    const position = rowToPosition(row);
    if (position) positions.push(position);
  }
  return { ok: true, positions };
}

/**
 * listPositions — `readPositions` for callers that want the array. It THROWS on failure by
 * design: the one thing this module must never do again is hand back `[]` for "we don't know".
 */
export async function listPositions(db: PortfolioDb, userId: string): Promise<Position[]> {
  const read = await readPositions(db, userId);
  if (!read.ok) throw new PortfolioReadError(read.error);
  return read.positions;
}

/** Resolve one owned position. `null` when it does not exist or is not this user's — the check
 *  every mutation runs first, so a cross-user id is a 404 and never a write. */
export async function getOwnedPosition(
  db: PortfolioDb,
  userId: string,
  positionId: string,
): Promise<Position | null> {
  const id = typeof positionId === "string" ? positionId.trim() : "";
  if (!id) return null;
  const row = one(await db.from(POSITIONS_TABLE)
    .select(POSITION_FIELDS)
    .eq("user_id", userId).eq("id", id).maybeSingle());
  return row ? rowToPosition(row) : null;
}

// ───────────────────────────── writes ─────────────────────────────

export type PositionInput = {
  ticker?: unknown;
  shares?: unknown;
  entryPrice?: unknown;
  entryDate?: unknown;
  notes?: unknown;
  status?: unknown;
};

export type WriteResult = {
  ok: boolean;
  error?: string;
  status?: number;
  position?: Position;
  deletedId?: string;
};

/**
 * Create one position. Only `ticker` is required — an unsized position (a name you hold but have
 * not filled in yet) is a first-class state the UI labels rather than a broken row.
 *
 * `user_id` is taken from the SESSION, never from the request body, so a caller cannot file a
 * position into somebody else's book even if RLS were misconfigured.
 */
export async function createPosition(
  db: PortfolioDb,
  userId: string,
  input: PositionInput,
): Promise<WriteResult> {
  const ticker = normalizeTicker(input.ticker);
  if (!ticker) return { ok: false, error: "invalid ticker", status: 400 };

  const shares = normalizeNumeric(input.shares);
  if (shares.kind === "invalid") return { ok: false, error: "invalid shares", status: 400 };
  const entryPrice = normalizeNumeric(input.entryPrice);
  if (entryPrice.kind === "invalid") return { ok: false, error: "invalid entry price", status: 400 };
  const entryDate = normalizeEntryDate(input.entryDate);
  if (entryDate.kind === "invalid") return { ok: false, error: "invalid entry date", status: 400 };
  const notes = normalizeNotes(input.notes);
  if (notes.kind === "invalid") return { ok: false, error: "invalid notes", status: 400 };

  const now = new Date().toISOString();
  const inserted = await db.from(POSITIONS_TABLE).insert({
    user_id: userId,
    ticker,
    shares: shares.kind === "value" ? shares.value : null,
    entry_price: entryPrice.kind === "value" ? entryPrice.value : null,
    entry_date: entryDate.kind === "value" ? entryDate.value : null,
    notes: notes.kind === "value" ? notes.value : null,
    status: normalizeStatus(input.status),
    updated_at: now,
  }).select(POSITION_FIELDS).maybeSingle();

  const row = one(inserted);
  const position = row ? rowToPosition(row) : null;
  if (inserted.error || !position) return { ok: false, error: "position create failed", status: 500 };
  return { ok: true, position };
}

/**
 * Patch one owned position. ABSENT keys are left alone — the modal sends only what it edited, and
 * a "close" is a status-only patch that must not blank the shares.
 *
 * Ownership is re-read first (`getOwnedPosition`) so a foreign or missing id is a 404 BEFORE any
 * update statement is issued. The update itself still carries `.eq("user_id", userId)`.
 */
export async function updatePosition(
  db: PortfolioDb,
  userId: string,
  positionId: string,
  patch: PositionInput,
): Promise<WriteResult> {
  const owned = await getOwnedPosition(db, userId, positionId);
  if (!owned) return { ok: false, error: "position not found", status: 404 };

  const values: DbRow = {};
  if (patch.ticker !== undefined) {
    const ticker = normalizeTicker(patch.ticker);
    if (!ticker) return { ok: false, error: "invalid ticker", status: 400 };
    values.ticker = ticker;
  }
  const shares = normalizeNumeric(patch.shares);
  if (shares.kind === "invalid") return { ok: false, error: "invalid shares", status: 400 };
  if (shares.kind === "value") values.shares = shares.value;

  const entryPrice = normalizeNumeric(patch.entryPrice);
  if (entryPrice.kind === "invalid") return { ok: false, error: "invalid entry price", status: 400 };
  if (entryPrice.kind === "value") values.entry_price = entryPrice.value;

  const entryDate = normalizeEntryDate(patch.entryDate);
  if (entryDate.kind === "invalid") return { ok: false, error: "invalid entry date", status: 400 };
  if (entryDate.kind === "value") values.entry_date = entryDate.value;

  const notes = normalizeNotes(patch.notes);
  if (notes.kind === "invalid") return { ok: false, error: "invalid notes", status: 400 };
  if (notes.kind === "value") values.notes = notes.value;

  if (patch.status !== undefined) values.status = normalizeStatus(patch.status);

  // A patch that names no editable field is a successful no-op, not a bare `updated_at` bump.
  if (!Object.keys(values).length) return { ok: true, position: owned };
  values.updated_at = new Date().toISOString();

  // PostgREST can legitimately answer `{ error: null, data: null }` when an owner pre-read
  // succeeded but the write affected zero rows (for example, an RLS/policy race). Absence of an
  // exception is not mutation authority. Require the database to return the exact owner-scoped
  // row it changed; anything else is an invariant failure and must never become a 2xx response.
  const updated = await db.from(POSITIONS_TABLE)
    .update(values)
    .eq("user_id", userId)
    .eq("id", owned.id)
    .select(POSITION_FIELDS)
    .maybeSingle();
  if (updated.error) return { ok: false, error: "position update failed", status: 500 };
  const row = one(updated);
  const position = row ? rowToPosition(row) : null;
  if (!position || position.id !== owned.id) {
    return { ok: false, error: "position mutation not confirmed", status: 500 };
  }
  return { ok: true, position };
}

export async function deletePosition(
  db: PortfolioDb,
  userId: string,
  positionId: string,
): Promise<WriteResult> {
  const owned = await getOwnedPosition(db, userId, positionId);
  if (!owned) return { ok: false, error: "position not found", status: 404 };
  // DELETE follows the same receipt law as UPDATE: the database must return the exact id it
  // deleted. A success-shaped zero-row result is not success and is never retried silently.
  const deleted = await db.from(POSITIONS_TABLE)
    .delete()
    .eq("user_id", userId)
    .eq("id", owned.id)
    .select("id")
    .maybeSingle();
  if (deleted.error) return { ok: false, error: "position delete failed", status: 500 };
  const deletedId = text(one(deleted)?.id);
  if (!deletedId || deletedId !== owned.id) {
    return { ok: false, error: "position mutation not confirmed", status: 500 };
  }
  return { ok: true, deletedId };
}

// ───────────────────────────── display math (pure) ─────────────────────────────
//
// Every function below returns `null` rather than a placeholder when an input is missing. An
// unsized position has no market value; a symbol the quote hub cannot resolve has no price. The
// table renders those as a dash. Nothing here ever substitutes cost basis for a live price, or
// treats a missing quote as zero — a fabricated total is worse than an honest gap.

/** Live price for a ticker, or `null`. The caller merges the batched `/api/quote` response over the
 *  nightly manifest; both are optional and either may be missing for a given name. */
export function resolveLast(
  ticker: string,
  quotes: Readonly<Record<string, { last?: unknown } | null | undefined>>,
  manifest: Readonly<Record<string, { last?: unknown } | null | undefined>>,
): number | null {
  const pick = (value: unknown): number | null =>
    (typeof value === "number" && Number.isFinite(value) ? value : null);
  return pick(quotes[ticker]?.last) ?? pick(manifest[ticker]?.last);
}

export function marketValue(position: Position, last: number | null): number | null {
  if (position.shares == null || last == null) return null;
  return position.shares * last;
}

export function costBasis(position: Position): number | null {
  if (position.shares == null || position.entryPrice == null) return null;
  return position.shares * position.entryPrice;
}

/** Since-entry move in percent. Needs an entry price and a live price; a zero entry price has no
 *  defined percentage and returns `null` rather than Infinity. */
export function sinceEntryPct(position: Position, last: number | null): number | null {
  if (position.entryPrice == null || !position.entryPrice || last == null) return null;
  return ((last - position.entryPrice) / position.entryPrice) * 100;
}

/** Since-entry money. Needs shares AND an entry price AND a live price. */
export function sinceEntryValue(position: Position, last: number | null): number | null {
  const basis = costBasis(position);
  const value = marketValue(position, last);
  if (basis == null || value == null) return null;
  return value - basis;
}

export type BookTotals = {
  /** Open positions counted, and how many of them could actually be valued. */
  openCount: number;
  closedCount: number;
  valued: number;
  /** Market value over every VALUED position; `null` when nothing could be valued. */
  marketValue: number | null;
  /** Cost basis, and the P&L derived from it, over the NARROWER priced-AND-based subset. */
  costBasis: number | null;
  sinceEntry: number | null;
  sinceEntryPct: number | null;
  /** How many valued positions carry a cost basis — the population `sinceEntry` describes. */
  based: number;
  dayChange: number | null;
  /** Open tickers with no resolvable price — surfaced, never silently dropped from the count. */
  unpriced: string[];
  /** Priced tickers with no ENTRY PRICE — excluded from P&L, and named for the same reason. */
  noBasis: string[];
};

/**
 * Book-level totals over OPEN positions.
 *
 * The `valued` / `unpriced` split is the honesty contract: a total is reported for the subset that
 * could be valued and the rest are NAMED, so a book whose HK names have no store never shows a
 * confident number that quietly excludes them. When nothing can be valued every total is `null` —
 * not `0`, which reads as "your book is worth nothing".
 *
 * TWO POPULATIONS, NEVER MIXED (round-2 review). `marketValue` answers "what is this worth" and
 * covers every valued position. `sinceEntry` answers "what has it made" and can only cover
 * positions that carry BOTH a live value and a cost basis. The first version of this function summed
 * `value` over the wide population and `basis` over the narrow one and then subtracted them, which
 * booked an entry-price-less position's ENTIRE market value as profit:
 *
 *   100 AAA @ entry 200, last 220   ->  value 22,000   basis 20,000
 *   100 BBB, no entry price, last 500 -> value 50,000   basis      0
 *   reported: +52,000 / +260%        truth: +2,000 / +10%
 *
 * Nothing disclosed it either — `unpriced` names missing PRICES, and BBB had a price. So the fix is
 * both halves: restrict the subset, and name what the restriction excluded (`noBasis`), the same
 * way a missing price is named.
 */
export function bookTotals(
  positions: readonly Position[],
  quotes: Readonly<Record<string, { last?: unknown; chg?: unknown } | null | undefined>>,
  manifest: Readonly<Record<string, { last?: unknown; chg?: unknown } | null | undefined>>,
): BookTotals {
  const open = positions.filter((position) => position.status === "open");
  let value = 0;
  let day = 0;
  let valued = 0;
  let dayValued = 0;
  // The P&L accumulators are deliberately SEPARATE from `value`: both sides of the subtraction must
  // come from the same population, or the difference is not a profit.
  let basedValue = 0;
  let basis = 0;
  let based = 0;
  const unpriced: string[] = [];
  const noBasis: string[] = [];

  for (const position of open) {
    const last = resolveLast(position.ticker, quotes, manifest);
    const positionValue = marketValue(position, last);
    if (positionValue == null) {
      if (last == null && !unpriced.includes(position.ticker)) unpriced.push(position.ticker);
      continue;
    }
    valued += 1;
    value += positionValue;
    const positionBasis = costBasis(position);
    if (positionBasis == null) {
      // Priced and sized, but no entry price — it has a value and no knowable P&L.
      if (!noBasis.includes(position.ticker)) noBasis.push(position.ticker);
    } else {
      based += 1;
      basis += positionBasis;
      basedValue += positionValue;
    }
    // Day move is a percent on the CURRENT value; a name without one contributes nothing rather
    // than dragging the book toward zero.
    const chg = quotes[position.ticker]?.chg ?? manifest[position.ticker]?.chg;
    if (typeof chg === "number" && Number.isFinite(chg)) {
      const previous = positionValue / (1 + chg / 100);
      if (Number.isFinite(previous)) { day += positionValue - previous; dayValued += 1; }
    }
  }

  // A zero total basis has no defined percentage, so the pair reports nothing rather than Infinity.
  const hasBasis = based > 0 && basis !== 0;
  return {
    openCount: open.length,
    closedCount: positions.length - open.length,
    valued,
    marketValue: valued ? value : null,
    costBasis: hasBasis ? basis : null,
    sinceEntry: hasBasis ? basedValue - basis : null,
    sinceEntryPct: hasBasis ? ((basedValue - basis) / basis) * 100 : null,
    based,
    dayChange: dayValued ? day : null,
    unpriced,
    noBasis,
  };
}

/** Distinct tickers to ask the quote hub for — one batched call, deduped, open AND closed (a closed
 *  row still shows a last price so the user can see what they left). */
export function quoteSymbols(positions: readonly Position[]): string[] {
  return [...new Set(positions.map((position) => position.ticker))];
}
