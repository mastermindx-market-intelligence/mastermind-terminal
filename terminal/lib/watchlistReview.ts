/**
 * watchlistReview.ts — a user-started, FROZEN review itinerary over one watchlist (E16).
 *
 * A review is a reference the user creates on purpose: "walk me through this list in this order".
 * It is not a queue, a scheduler or a ranking. Nothing here runs on a timer, originates an order,
 * a notification or an alert, or writes to any other store.
 *
 * ── The frozen-order contract (the E16 falsifier) ──────────────────────────────────────────────
 * The itinerary copies the list's symbols ONCE, at start, and steps through that copy. The live
 * list can be re-sorted, re-ordered by drag, or re-ranked by quotes and the next company does not
 * move. Membership changes are reported as drift (`itineraryDrift`) and only an explicit
 * `refreshItinerary` call — a user action — rebuilds the order.
 *
 * ── Availability (never a neighbour) ──────────────────────────────────────────────────────────
 * Every frozen entry resolves to one of four states. `removed` (no longer on the list) and
 * `missing` (no market data in this Terminal) are SKIPPED by next/previous and named in the skip
 * notice; the cursor never lands on a neighbouring id in their place. `unknown` means the inputs
 * that would decide it have not loaded — it is navigable, and it is never reported as available.
 *
 * ── Markers are review-local ──────────────────────────────────────────────────────────────────
 * `reviewed` / `deferred` and a defer note live only in this record. They do not touch flags,
 * notes (`mm.symbolNotes.v2`), list membership, holdings, signals or alerts. Synced watchlist notes
 * (E05) are a different owner; a defer note stays with the review on this device until then.
 *
 * ── Storage ───────────────────────────────────────────────────────────────────────────────────
 * One active review per owner, in the same owner envelope as every other owner-scoped key
 * (`lib/ownerStorage.ts`): `{ "<owner>": <itinerary> }`. A guest's review is unreadable by an
 * account and vice versa. A write reports failure so the UI can say "not saved" honestly.
 */

import { isComposite, parseComposite } from "@/lib/composite";
import { isPlainObject, readOwnerSlot, writeOwnerSlot, type StoragePort } from "@/lib/ownerStorage";
import { orderWatchlistRowsBySections } from "@/lib/watchlistSections";

/** Owner envelope key for the active review. */
export const WL_REVIEW_KEY = "mm.wlReview.v1";
export const WL_REVIEW_VERSION = 1;
/** A defer note is a short reminder, not a journal entry. */
export const REVIEW_NOTE_MAX = 280;
/** A list longer than this is refused rather than silently truncated. */
export const REVIEW_MAX_SYMBOLS = 2000;

export type ReviewMarkState = "reviewed" | "deferred";
export type ReviewMark = { state: ReviewMarkState; note?: string; at: number };

export type ReviewItinerary = {
  v: typeof WL_REVIEW_VERSION;
  /** The list this review was frozen from. */
  listName: string;
  /** Frozen order, copied at start or at the last explicit refresh. */
  symbols: string[];
  /** Index into `symbols` of the company under review. */
  cursor: number;
  /** symbol → marker. Only symbols in `symbols`. */
  marks: Record<string, ReviewMark>;
  /** 1 at start; +1 on every explicit refresh. */
  revision: number;
  startedAt: number;
  updatedAt: number;
};

export type EntryAvailability = "available" | "unknown" | "removed" | "missing";

export type AvailabilityInputs = {
  /** Current members of the review's list; null while the saved lists have not been restored. */
  liveMembers: ReadonlySet<string> | null;
  /** The market-data manifest's symbols; null while it has not loaded (or failed to load). */
  manifestSymbols: Readonly<Record<string, unknown>> | null;
};

type Row = { symbol: string; section: string };

/** The list's symbols in the order the rail shows them, every section included (collapsed too). */
export function liveListOrder(rows: readonly Row[] | undefined, declaredSections: readonly string[] = []): string[] {
  if (!rows?.length) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of orderWatchlistRowsBySections(rows, declaredSections)) {
    if (!row.symbol || seen.has(row.symbol)) continue;
    seen.add(row.symbol);
    out.push(row.symbol);
  }
  return out;
}

export function resolveAvailability(symbol: string, inputs: AvailabilityInputs): EntryAvailability {
  if (inputs.liveMembers && !inputs.liveMembers.has(symbol)) return "removed";
  const manifest = inputs.manifestSymbols;
  if (!manifest) return "unknown";
  if (isComposite(symbol)) {
    const legs = parseComposite(symbol) ?? [];
    return legs.every((leg) => Object.prototype.hasOwnProperty.call(manifest, leg)) ? "available" : "missing";
  }
  return Object.prototype.hasOwnProperty.call(manifest, symbol) ? "available" : "missing";
}

/** Removed and missing entries are explicitly skipped; unknown stays navigable (it is not known bad). */
export const isSkipped = (availability: EntryAvailability) => availability === "removed" || availability === "missing";

export type AvailabilityOf = (symbol: string) => EntryAvailability;

/** Freeze a review. Returns null for an empty list (nothing to review). */
export function startItinerary(listName: string, liveOrder: readonly string[], availabilityOf: AvailabilityOf, now: number): ReviewItinerary | null {
  const symbols = dedupe(liveOrder);
  if (!symbols.length || symbols.length > REVIEW_MAX_SYMBOLS) return null;
  const first = symbols.findIndex((symbol) => !isSkipped(availabilityOf(symbol)));
  return {
    v: WL_REVIEW_VERSION,
    listName,
    symbols,
    cursor: first >= 0 ? first : 0,
    marks: {},
    revision: 1,
    startedAt: now,
    updatedAt: now,
  };
}

export type StepResult = {
  itinerary: ReviewItinerary;
  /** Entries passed over on the way, in walk order, with why. Never empty-substituted. */
  skipped: { symbol: string; availability: EntryAvailability }[];
};

/**
 * Move one reviewable entry forward (+1) or back (-1) in the FROZEN order. Returns null when no
 * reviewable entry exists in that direction; the cursor then stays exactly where it was.
 */
export function stepItinerary(itinerary: ReviewItinerary, direction: 1 | -1, availabilityOf: AvailabilityOf, now: number): StepResult | null {
  const skipped: StepResult["skipped"] = [];
  for (let i = itinerary.cursor + direction; i >= 0 && i < itinerary.symbols.length; i += direction) {
    const symbol = itinerary.symbols[i];
    const availability = availabilityOf(symbol);
    if (isSkipped(availability)) { skipped.push({ symbol, availability }); continue; }
    return { itinerary: { ...itinerary, cursor: i, updatedAt: now }, skipped };
  }
  return null;
}

/** The company the next press of Next would land on, or null. Pure preview — moves nothing. */
export function peekNext(itinerary: ReviewItinerary, availabilityOf: AvailabilityOf): string | null {
  const step = stepItinerary(itinerary, 1, availabilityOf, itinerary.updatedAt);
  return step ? step.itinerary.symbols[step.itinerary.cursor] : null;
}

export const currentSymbol = (itinerary: ReviewItinerary): string | null => itinerary.symbols[itinerary.cursor] ?? null;

/** Set (or clear, with `null`) the marker of one frozen entry. A symbol outside the itinerary is refused. */
export function markEntry(itinerary: ReviewItinerary, symbol: string, mark: { state: ReviewMarkState; note?: string } | null, now: number): ReviewItinerary | null {
  if (!itinerary.symbols.includes(symbol)) return null;
  const marks = { ...itinerary.marks };
  if (mark === null) delete marks[symbol];
  else {
    const note = mark.state === "deferred" ? cleanNote(mark.note) : undefined;
    marks[symbol] = note ? { state: mark.state, note, at: now } : { state: mark.state, at: now };
  }
  return { ...itinerary, marks, updatedAt: now };
}

export function itineraryDrift(itinerary: ReviewItinerary, liveOrder: readonly string[] | null): { added: string[]; removed: string[] } {
  if (!liveOrder) return { added: [], removed: [] };
  const frozen = new Set(itinerary.symbols);
  const live = new Set(liveOrder);
  return {
    added: dedupe(liveOrder).filter((symbol) => !frozen.has(symbol)),
    removed: itinerary.symbols.filter((symbol) => !live.has(symbol)),
  };
}

/**
 * The ONLY way the order changes: the user asked for the current list. Markers survive for
 * companies still on it; the cursor stays on the same company when it is still there, otherwise
 * it moves to the first unmarked reviewable entry (never to "whatever is at the old index").
 */
export function refreshItinerary(itinerary: ReviewItinerary, liveOrder: readonly string[], availabilityOf: AvailabilityOf, now: number): ReviewItinerary | null {
  const symbols = dedupe(liveOrder);
  if (!symbols.length || symbols.length > REVIEW_MAX_SYMBOLS) return null;
  const marks: Record<string, ReviewMark> = {};
  for (const symbol of symbols) if (itinerary.marks[symbol]) marks[symbol] = itinerary.marks[symbol];
  const here = currentSymbol(itinerary);
  let cursor = here ? symbols.indexOf(here) : -1;
  if (cursor < 0 || isSkipped(availabilityOf(symbols[cursor]))) {
    cursor = symbols.findIndex((symbol) => !marks[symbol] && !isSkipped(availabilityOf(symbol)));
    if (cursor < 0) cursor = Math.max(0, symbols.findIndex((symbol) => !isSkipped(availabilityOf(symbol))));
  }
  return { ...itinerary, symbols, marks, cursor, revision: itinerary.revision + 1, updatedAt: now };
}

export type ItinerarySummary = { total: number; position: number; reviewed: number; deferred: number; unavailable: number; unknown: number };

export function summarizeItinerary(itinerary: ReviewItinerary, availabilityOf: AvailabilityOf): ItinerarySummary {
  let reviewed = 0, deferred = 0, unavailable = 0, unknown = 0;
  for (const symbol of itinerary.symbols) {
    const availability = availabilityOf(symbol);
    if (isSkipped(availability)) { unavailable++; continue; }
    if (availability === "unknown") unknown++;
    const mark = itinerary.marks[symbol];
    if (mark?.state === "reviewed") reviewed++;
    else if (mark?.state === "deferred") deferred++;
  }
  return { total: itinerary.symbols.length, position: itinerary.cursor + 1, reviewed, deferred, unavailable, unknown };
}

// ── Storage ─────────────────────────────────────────────────────────────────────────────────

/** Validate a stored payload. Anything malformed reads as "no review" — it is never repaired into one. */
export function parseItinerary(raw: unknown): ReviewItinerary | null {
  if (!isPlainObject(raw) || raw.v !== WL_REVIEW_VERSION) return null;
  const { listName, symbols, cursor, marks, revision, startedAt, updatedAt } = raw;
  if (typeof listName !== "string" || !listName) return null;
  if (!Array.isArray(symbols) || !symbols.length || symbols.length > REVIEW_MAX_SYMBOLS) return null;
  if (!symbols.every((symbol) => typeof symbol === "string" && symbol.length > 0)) return null;
  if (new Set(symbols).size !== symbols.length) return null;
  if (!Number.isInteger(cursor) || (cursor as number) < 0 || (cursor as number) >= symbols.length) return null;
  if (!Number.isInteger(revision) || (revision as number) < 1) return null;
  if (!Number.isFinite(startedAt) || !Number.isFinite(updatedAt)) return null;
  const cleanMarks: Record<string, ReviewMark> = {};
  if (marks !== undefined) {
    if (!isPlainObject(marks)) return null;
    for (const [symbol, mark] of Object.entries(marks)) {
      if (!symbols.includes(symbol) || !isPlainObject(mark)) return null;
      if (mark.state !== "reviewed" && mark.state !== "deferred") return null;
      if (!Number.isFinite(mark.at)) return null;
      if (mark.note !== undefined && (typeof mark.note !== "string" || mark.note.length > REVIEW_NOTE_MAX)) return null;
      cleanMarks[symbol] = mark.note ? { state: mark.state, note: mark.note, at: mark.at as number } : { state: mark.state, at: mark.at as number };
    }
  }
  return {
    v: WL_REVIEW_VERSION,
    listName,
    symbols: [...(symbols as string[])],
    cursor: cursor as number,
    marks: cleanMarks,
    revision: revision as number,
    startedAt: startedAt as number,
    updatedAt: updatedAt as number,
  };
}

export function readReview(storage: StoragePort, owner: string): ReviewItinerary | null {
  try {
    return parseItinerary(readOwnerSlot(storage, WL_REVIEW_KEY, owner));
  } catch {
    return null;
  }
}

/** Replace (or, with null, remove) one owner's review. False = not persisted; say so in the UI. */
export function writeReview(storage: StoragePort | null, owner: string, itinerary: ReviewItinerary | null): boolean {
  if (!storage) return false;
  return writeOwnerSlot(storage, WL_REVIEW_KEY, owner, itinerary ?? undefined);
}

function dedupe(symbols: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const symbol of symbols) {
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    out.push(symbol);
  }
  return out;
}

function cleanNote(note: string | undefined): string | undefined {
  const trimmed = (note ?? "").trim().slice(0, REVIEW_NOTE_MAX);
  return trimmed || undefined;
}
