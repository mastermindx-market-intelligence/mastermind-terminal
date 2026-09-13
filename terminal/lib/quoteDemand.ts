/**
 * Bounded, COMPLETE quote demand (D2).
 *
 * `/api/quote?syms=` caps one batch at QUOTE_REQUEST_LIMIT symbols to bound a poll's upstream
 * fan-out. It used to enforce that cap with a silent `slice(0, 200)` — no 413, no truncation flag,
 * no remainder — so a caller was told, in effect, that everything it asked for came back.
 *
 * Nothing else in the product makes 200 the list-size boundary: canonical watchlist operations
 * permit batches of 500 (`lib/watchlists.ts`), and a composite row expands into SEVERAL quote
 * symbols, so "200 rows" is not even "200 quote symbols". A large watchlist therefore showed live
 * prices for its early rows while later rows sat on EOD fallback indefinitely — and nothing on
 * screen said that list POSITION, not market support, was the reason.
 *
 * The fix belongs at the demand layer, not the cap. Raising the cap to 500 would only move the
 * boundary while tripling one poll's provider fan-out (the hub chunks at 100, Tencent at 30) and
 * pushing the GET toward URL limits. Instead the client plans each poll:
 *
 *   • a PRIORITY set — the charted symbol and anything else that must be right every tick — is
 *     present in EVERY request;
 *   • the remainder ROTATES through the leftover capacity, resuming where the previous poll
 *     stopped.
 *
 * Request size, and therefore provider fan-out, is exactly what it is today: one request of at most
 * QUOTE_REQUEST_LIMIT symbols per tick. What changes is that every symbol is now refreshed within
 * `ceil(rotating / capacity)` polls instead of never. A demand set that already fits is completely
 * unaffected — one cycle covers it, so every symbol still refreshes on every poll.
 *
 * Demand is GROUPED rather than flat because a composite row is only correct when all of its legs
 * are priced. Groups are admitted whole, so rotation can never split a composite across two polls
 * and leave the row summing a fresh leg against a stale one.
 */

/** Hard per-request symbol cap. Mirrored by `app/api/quote/route.ts`, which still enforces it — and
 *  now reports it rather than truncating in silence. This is the client's copy so it plans UNDER
 *  the cap and never trips it. */
export const QUOTE_REQUEST_LIMIT = 200;

/** One row's worth of demand: the symbols that must arrive together for that row to be correct.
 *  A plain row is one symbol; a composite is its legs. */
export type QuoteDemandGroup = { key: string; symbols: string[] };

export type QuoteBatchPlan = {
  /** Symbols to request this poll — deduped, priority first, never longer than `limit`. */
  symbols: string[];
  /** Where the next poll resumes in `rotating`. */
  nextCursor: number;
  /** True when the whole demand set fit in this one request (so there is no rotation at all). */
  complete: boolean;
};

/** Build one group per symbol — the common case for a caller with no composite rows. */
export function groupsFromSymbols(symbols: readonly string[]): QuoteDemandGroup[] {
  return symbols.filter(Boolean).map((s) => ({ key: s, symbols: [s] }));
}

/**
 * Plan a single poll.
 *
 * `priority` groups are always included. `rotating` groups are admitted whole, walking forward from
 * `cursor` and wrapping, until the next group would not fit.
 *
 * Two degenerate cases are handled explicitly because both would otherwise starve a symbol forever
 * — the exact class of bug this module exists to remove:
 *   • a priority set larger than the cap is admitted in order, so the charted symbol survives;
 *   • a single rotating group larger than the whole budget is partially admitted and stepped past,
 *     rather than parking the cursor on it so nothing after it ever refreshes.
 */
export function planQuoteBatch({
  priority = [],
  rotating = [],
  cursor = 0,
  limit = QUOTE_REQUEST_LIMIT,
}: {
  priority?: readonly QuoteDemandGroup[];
  rotating?: readonly QuoteDemandGroup[];
  cursor?: number;
  limit?: number;
}): QuoteBatchPlan {
  const cap = Math.max(1, Math.floor(limit));
  const seen = new Set<string>();
  const out: string[] = [];

  /** Admit a whole group, or nothing. Symbols already present cost nothing. */
  const admitWhole = (symbols: readonly string[]): boolean => {
    const fresh = symbols.filter((s) => s && !seen.has(s));
    if (!fresh.length) return true;
    if (out.length + fresh.length > cap) return false;
    for (const s of fresh) { seen.add(s); out.push(s); }
    return true;
  };

  /** Admit as much of a group as still fits. Only for the two degenerate cases above. */
  const admitPartial = (symbols: readonly string[]): void => {
    for (const s of symbols) {
      if (out.length >= cap) return;
      if (s && !seen.has(s)) { seen.add(s); out.push(s); }
    }
  };

  // 1. Priority, in order — the active chart symbol first, so it survives even a pathological
  //    priority set.
  for (const group of priority) {
    if (!admitWhole(group.symbols)) admitPartial(group.symbols);
  }

  const n = rotating.length;
  if (!n) return { symbols: out, nextCursor: 0, complete: true };

  // 2. Rotation — at most one pass, so a demand set that fits entirely does not spin.
  const start = ((cursor % n) + n) % n;
  let admitted = 0;
  let next = start;
  for (let step = 0; step < n; step++) {
    const i = (start + step) % n;
    if (admitWhole(rotating[i].symbols)) {
      admitted++;
      next = (i + 1) % n;
      continue;
    }
    // Did not fit. If nothing has been admitted yet, this group alone exceeds the budget: take what
    // fits and step past it, or the cursor parks here and every later group starves.
    if (admitted === 0) { admitPartial(rotating[i].symbols); next = (i + 1) % n; }
    else next = i;
    break;
  }

  // Every rotating group was admitted in this single pass → the set fits, so there is no rotation
  // and the next poll should start where this one did rather than drift.
  const complete = admitted === n;
  return { symbols: out, nextCursor: complete ? start : next, complete };
}
