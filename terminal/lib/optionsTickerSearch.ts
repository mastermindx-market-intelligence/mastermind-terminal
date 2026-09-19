/**
 * Ticker lookup semantics for Options Hub > Flow > Tickers.
 *
 * The session-leader rail is discovery, not the universe boundary. A syntactically
 * valid exact query must remain directly selectable even when that root is absent
 * from today's leader payload; the downstream ticker endpoint is the authority on
 * whether a drill was actually published.
 */
export const OPTIONS_TICKER_QUERY_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/;

export function normalizeOptionsTickerQuery(raw: string): string {
  return raw.trim().toUpperCase();
}

export function isOptionsTickerQuery(raw: string): boolean {
  return OPTIONS_TICKER_QUERY_RE.test(normalizeOptionsTickerQuery(raw));
}

export function buildOptionsTickerCandidates(
  sessionRoots: string[],
  rawQuery: string,
  defaultLimit = 20,
): string[] {
  const roots = Array.from(new Set(sessionRoots.map((r) => r.toUpperCase())));
  const query = normalizeOptionsTickerQuery(rawQuery);

  if (!query) return roots.slice(0, Math.max(0, defaultLimit));

  const matches = roots.filter((root) => root.includes(query));
  if (!OPTIONS_TICKER_QUERY_RE.test(query)) return matches;

  // Exact typed lookup first. Do not confuse leader membership with source coverage:
  // a missing endpoint will render the honest "not published" state in the consumer.
  return [query, ...matches.filter((root) => root !== query)];
}
