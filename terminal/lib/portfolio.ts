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
// (no live CHECK is asserted, so this module coerces rather than trusting). Migration0032 adds
// nullable entry_currency plus its entry_currency_basis receipt, preserving legacy unknown units. No
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
import { commonMoney, finite, finiteProduct, nativePrice, priceCurrency, type MoneyPart, type PriceObservation } from "@/lib/portfolioMoney";

/** Structural view of the Supabase client — the same subset `lib/watchlists.ts` narrows, so the
 *  e2e fixture transport and the unit tests satisfy one shape for both tables. */
export type PortfolioDb = WatchlistDb;
export type { WatchlistQuery as PortfolioQuery };

export const POSITIONS_TABLE = "portfolio_positions";
const POSITION_FIELDS = "id,ticker,shares,entry_price,entry_currency,entry_currency_basis,entry_date,notes,status,created_at";

export type PositionStatus = "open" | "closed";

/** A position as the UI holds it. Every optional field is genuinely nullable in the DDL — an
 *  unsized position (ticker only) is a legal, deliberate state, not a broken row. */
export type Position = {
  id: string;
  ticker: string;
  shares: number | null;
  entryPrice: number | null;
  /** Legacy/older HTTP rows remain unknown; this is not the current quote currency. */
  entryCurrency?: string | null;
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

/** An absent unit leaves it alone; explicit blank clears it; codes stay case-sensitive. */
export function normalizeEntryCurrency(value: unknown): TextField {
  if (value === undefined) return { kind: "absent" };
  if (value === null || typeof value === "string" && !value.trim()) return { kind: "value", value: null };
  const currency = typeof value === "string" ? priceCurrency(value.trim()) : null;
  return currency ? { kind: "value", value: currency } : { kind: "invalid" };
}

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
  const rawBasis = row.entry_currency_basis;
  const basis = rawBasis && typeof rawBasis === "object" && !Array.isArray(rawBasis)
    ? rawBasis as Record<string, unknown> : null;
  return {
    id,
    ticker,
    shares: numeric(row.shares),
    entryPrice: numeric(row.entry_price),
    // The receipt is tied to the price that the user actually denominated.
    // An older writer changing only the price cannot silently retag that number.
    entryCurrency: basis && Object.keys(basis).length === 2
      && basis.ticker === row.ticker
      && (basis.price === null || finite(basis.price))
      && basis.price === numeric(row.entry_price) ? priceCurrency(row.entry_currency) : null,
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
  entryCurrency?: unknown;
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
  const entryCurrency = normalizeEntryCurrency(input.entryCurrency);
  if (entryCurrency.kind === "invalid") return { ok: false, error: "invalid entry currency", status: 400 };
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
    entry_currency: entryCurrency.kind === "value" ? entryCurrency.value : null,
    entry_currency_basis: entryCurrency.kind === "value" && entryCurrency.value ? { ticker, price: entryPrice.kind === "value" ? entryPrice.value : null } : null,
    entry_date: entryDate.kind === "value" ? entryDate.value : null,
    notes: notes.kind === "value" ? notes.value : null,
    status: normalizeStatus(input.status),
    updated_at: now,
  }).select(POSITION_FIELDS).maybeSingle();

  const row = one(inserted);
  const position = row ? rowToPosition(row) : null;
  if (inserted.error || !position) return { ok: false, error: "position create failed", status: 500 };
  if (entryCurrency.kind === "value" && (position.entryCurrency ?? null) !== entryCurrency.value) {
    return { ok: false, error: "entry price or identity changed; currency not recorded", status: 409 };
  }
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
  const entryCurrency = normalizeEntryCurrency(patch.entryCurrency);
  if (entryCurrency.kind === "invalid") return { ok: false, error: "invalid entry currency", status: 400 };
  if (entryCurrency.kind === "value") {
    values.entry_currency = entryCurrency.value;
    values.entry_currency_basis = entryCurrency.value ? { ticker: values.ticker ?? owned.ticker, price: entryPrice.kind === "value" ? entryPrice.value : owned.entryPrice } : null;
  } else if (entryPrice.kind === "value" && entryPrice.value !== owned.entryPrice || values.ticker !== undefined && values.ticker !== owned.ticker) {
    values.entry_currency = null; values.entry_currency_basis = null;
  }

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
  if (entryCurrency.kind === "value" && (position.entryCurrency ?? null) !== entryCurrency.value) {
    return { ok: false, error: "entry price or identity changed; currency not recorded", status: 409 };
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

export function marketValue(position: Position, last: number | null, quoteCurrency?: unknown): number | null {
  return priceCurrency(quoteCurrency) ? finiteProduct(position.shares, last) : null;
}

export function costBasis(position: Position): number | null {
  return priceCurrency(position.entryCurrency) ? finiteProduct(position.shares, position.entryPrice) : null;
}

/** A native price ratio needs compatible entry/quote units, independently of shares/report settings. */
export function sinceEntryPct(position: Position, last: number | null, quoteCurrency?: unknown): number | null {
  const unit = priceCurrency(position.entryCurrency);
  if (!unit || unit !== priceCurrency(quoteCurrency) || !finite(position.entryPrice) || !position.entryPrice || !finite(last)) return null;
  const result = ((last - position.entryPrice) / position.entryPrice) * 100;
  return finite(result) ? result : null;
}

export function sinceEntryValue(position: Position, last: number | null, quoteCurrency?: unknown): number | null {
  if (priceCurrency(position.entryCurrency) !== priceCurrency(quoteCurrency)) return null;
  const basis = costBasis(position), value = marketValue(position, last, quoteCurrency);
  if (basis == null || value == null) return null;
  const result = value - basis;
  return finite(result) ? result : null;
}

export type BookTotals = {
  openCount: number; closedCount: number; valued: number; based: number;
  marketValue: number | null; marketValueCurrency: string | null;
  /** All sized historical costs; does not require a current price. P&L has its own paired cohort. */
  costBasis: number | null; costBasisCurrency: string | null;
  sinceEntry: number | null; sinceEntryPct: number | null; sinceEntryCurrency: string | null;
  dayChange: number | null; dayChangeCurrency: string | null;
  unpriced: string[]; noBasis: string[]; monetaryGaps: string[];
};

/** Common totals require the whole eligible cohort to share an explicit unit. No FX is guessed. */
export function bookTotals(
  positions: readonly Position[],
  quotes: Readonly<Record<string, PriceObservation>>,
  manifest: Readonly<Record<string, PriceObservation>>,
): BookTotals {
  const open = positions.filter(position => position.status === "open");
  const values: MoneyPart[] = [], costs: MoneyPart[] = [], pnlValues: MoneyPart[] = [], pnlCosts: MoneyPart[] = [], days: MoneyPart[] = [];
  const unpriced: string[] = [], noBasis: string[] = [], monetaryGaps: string[] = [];
  const gap = (list: string[], ticker: string) => { if (!list.includes(ticker)) list.push(ticker); };
  let based = 0;
  for (const position of open) {
    const historicalCost = finiteProduct(position.shares, position.entryPrice);
    const historicalEligible = finite(position.shares) && finite(position.entryPrice);
    const entryUnit = priceCurrency(position.entryCurrency);
    if (historicalEligible) {
      costs.push({ amount: historicalCost ?? NaN, currency: entryUnit });
      if (!entryUnit || historicalCost === null) gap(monetaryGaps, position.ticker);
    }
    const quote = nativePrice(quotes[position.ticker], manifest[position.ticker]);
    const value = quote ? finiteProduct(position.shares, quote.last) : null;
    if (!quote || !finite(position.shares)) { if (!quote) gap(unpriced, position.ticker); continue; }
    values.push({ amount: value ?? NaN, currency: quote.currency });
    if (!quote.currency || value === null) gap(monetaryGaps, position.ticker);
    if (!historicalEligible) gap(noBasis, position.ticker);
    else {
      // Retain every priced/based lot in the cohort, even when its units are unknown.
      // Dropping it and renormalizing the known subset would manufacture a common P&L.
      const unit = entryUnit && entryUnit === quote.currency ? entryUnit : null;
      if (!unit || historicalCost === null || value === null) gap(monetaryGaps, position.ticker); else based += 1;
      pnlCosts.push({ amount: historicalCost ?? NaN, currency: unit });
      pnlValues.push({ amount: value ?? NaN, currency: unit });
    }
    if (quote.chg !== null && value !== null) {
      const previous = value / (1 + quote.chg / 100), day = value - previous;
      days.push({ amount: finite(previous) && finite(day) ? day : NaN, currency: quote.currency });
    } else days.push({ amount: NaN, currency: quote.currency });
  }
  const value = commonMoney(values), cost = commonMoney(costs), pv = commonMoney(pnlValues), pc = commonMoney(pnlCosts), day = commonMoney(days);
  const pnl = pv && pc ? pv.amount - pc.amount : null;
  const pct = pnl !== null && pc && pc.amount !== 0 ? pnl / pc.amount * 100 : null;
  if (values.length && !value || costs.length && !cost || pnlCosts.length && (!pv || !pc) || days.length && !day) {
    for (const position of open) gap(monetaryGaps, position.ticker);
  }
  return {
    openCount: open.length, closedCount: positions.length - open.length,
    // Priced/sized coverage is separate from common-unit availability.
    valued: values.filter(part => finite(part.amount)).length, based,
    marketValue: value?.amount ?? null, marketValueCurrency: value?.currency ?? null,
    costBasis: cost?.amount ?? null, costBasisCurrency: cost?.currency ?? null,
    sinceEntry: finite(pnl) ? pnl : null, sinceEntryPct: finite(pct) ? pct : null,
    sinceEntryCurrency: finite(pnl) ? pc?.currency ?? null : null,
    dayChange: day?.amount ?? null, dayChangeCurrency: day?.currency ?? null,
    unpriced, noBasis, monetaryGaps,
  };
}

/** Distinct tickers to ask the quote hub for — one batched call, deduped, open AND closed (a closed
 *  row still shows a last price so the user can see what they left). */
export function quoteSymbols(positions: readonly Position[]): string[] {
  return [...new Set(positions.map((position) => position.ticker))];
}
