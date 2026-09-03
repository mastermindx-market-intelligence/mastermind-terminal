export type QuoteDisplayInput = {
  last?: number | null;
  chg?: number | null;
  close?: number | null;
  prevClose?: number | null;
  prevSessionChg?: number | null;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  vol?: number | null;
  amount?: number | null;
  live?: boolean | null;
  source?: string | null;
  basis?: string | null;
  market?: string | null;
  marketSession?: string | null;
  auctionPrice?: number | null;
  auctionChg?: number | null;
  suspended?: boolean | null;
};

export type RegularSessionDisplay = {
  regularPrice: number | null;
  regularChg: number | null;
};

/**
 * Exposure may deliberately normalize base quote fields (for example, clearing a Tencent
 * no-trade placeholder). Preserve provider-specific extra fields while widening the shared quote
 * fields to their public nullable contract rather than pretending the caller's literal values are
 * immutable through normalization.
 */
export type RegularSessionQuote<T extends QuoteDisplayInput> =
  Omit<T, keyof QuoteDisplayInput> & QuoteDisplayInput & RegularSessionDisplay;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Tencent keeps returning a syntactically valid A-share snapshot when a name did not trade:
 * last == prevClose, chg == 0, O/H/L are zero placeholders (already normalized to null by the
 * parser), and cumulative volume/turnover are zero. A suspended stock is the common case.
 * Treating that shape as a current quote invents a flat session and lets the chart splice a
 * fake candle.
 *
 * Pre-open is deliberately excluded. The 09:15-09:29 call auction uses the same zero-O/H/L shape,
 * but `marketSession === "pre"` and its indicative/auction price is real information.
 */
function isTencentCnNoTrade(quote: QuoteDisplayInput): boolean {
  if (quote.market !== "cn" || quote.source !== "tencent" || quote.marketSession === "pre") return false;
  if (!finite(quote.last) || quote.last <= 0 || !finite(quote.prevClose) || quote.prevClose <= 0) return false;
  if (!finite(quote.chg) || Math.abs(quote.chg) > 1e-12) return false;

  const sameClose = Math.abs(quote.last - quote.prevClose)
    <= Math.max(1e-8, Math.abs(quote.prevClose) * 1e-10);
  const noOpen = !finite(quote.open) || quote.open <= 0;
  const noHigh = !finite(quote.high) || quote.high <= 0;
  const noLow = !finite(quote.low) || quote.low <= 0;
  const noVolume = !finite(quote.vol) || quote.vol <= 0;
  const noTurnover = !finite(quote.amount) || quote.amount <= 0;

  return sameClose && noOpen && noHigh && noLow && noVolume && noTurnover;
}

/**
 * Resolve the primary quote lane shown by every Terminal client.
 *
 * During an A-share opening auction, the explicit auction lane replaces the primary price,
 * matching Chinese brokerage convention without turning the pre-open print into OHLC. During
 * RTH, `last/chg` are the live regular-session values. After the close,
 * the official `close` wins and its move is measured against `prevClose`.
 * Before the next RTH begins, `prevSessionChg` preserves the completed session's
 * performance instead of letting an overnight print turn the primary percentage
 * into an extended-hours move.
 *
 * Tencent A-share no-trade placeholders are absent from the primary lane. They are not a
 * 0.00% live session; callers fall back to the last real EOD row instead.
 *
 * Extended prints deliberately do not appear in this function; they live only in
 * the `extPrice/extChg` namespace.
 */
export function resolveRegularSessionDisplay(
  quote: QuoteDisplayInput | null | undefined,
): RegularSessionDisplay {
  if (!quote || isTencentCnNoTrade(quote)) return { regularPrice: null, regularChg: null };

  const cnAuction = quote.market === "cn" && quote.marketSession === "pre";
  const auctionPrice = cnAuction && finite(quote.auctionPrice) && quote.auctionPrice > 0
    ? quote.auctionPrice
    : null;
  const officialClose = finite(quote.close) && quote.close > 0 ? quote.close : null;
  const liveLast = finite(quote.last) && quote.last > 0 ? quote.last : null;
  const regularPrice = auctionPrice ?? officialClose ?? liveLast;

  let regularChg: number | null = null;
  if (auctionPrice != null && finite(quote.auctionChg)) {
    regularChg = quote.auctionChg;
  } else if (auctionPrice != null && finite(quote.prevClose) && quote.prevClose > 0) {
    regularChg = ((auctionPrice - quote.prevClose) / quote.prevClose) * 100;
  } else if (officialClose != null && finite(quote.prevClose) && quote.prevClose !== 0) {
    regularChg = ((officialClose - quote.prevClose) / quote.prevClose) * 100;
  } else if (finite(quote.prevSessionChg)) {
    regularChg = quote.prevSessionChg;
  } else if (finite(quote.chg)) {
    regularChg = quote.chg;
  }

  return { regularPrice, regularChg };
}

/** Add explicit display lanes to the public quote contract without mutating the cache. */
export function withRegularSessionDisplay<T extends QuoteDisplayInput>(
  quote: T,
): RegularSessionQuote<T> {
  if (isTencentCnNoTrade(quote)) {
    // Keep provenance/prevClose, but clear every field that could be interpreted as a current
    // tradable print. Existing clients then take their normal manifest-EOD fallback, and
    // ChartPanel has no `last` from which to synthesize a candle for a suspended day.
    return {
      ...quote,
      last: null,
      chg: null,
      open: null,
      high: null,
      low: null,
      vol: null,
      amount: null,
      live: false,
      basis: "EOD",
      regularPrice: null,
      regularChg: null,
    } as RegularSessionQuote<T>;
  }
  return { ...quote, ...resolveRegularSessionDisplay(quote) } as RegularSessionQuote<T>;
}
