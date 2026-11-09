"use client";

import { useEffect, useState } from "react";
import { getFund } from "./fund";
import { tradingCurrencyFor } from "./companySearchContext";
import { normalizeAnalysisSymbol } from "./analysisSymbol";

/** The one stored answer: which symbol it was read for, and what the mapping said. */
interface CurrencyRead {
  symbol: string;
  currency: string | null;
}

/**
 * B1 — the chart frame bar's trading currency, read through the INCUMBENT fund
 * document. This hook adds no loader, store, registry, URL or currency map: getFund's
 * existing dataCache dedupe (the same cache the chart's in-flight fetch uses) is the
 * only acquisition path, and tradingCurrencyFor is the only mapping — exact ticker,
 * explicit 3-letter `quote_currency`. The statement currency (`stmt_currency`) is
 * unreachable: a CN filer's CNY reporting currency says nothing about what its
 * US-listed shares trade in.
 *
 * Gates, in order:
 *   - A non-canonical symbol (lowercase, composite, path-like, padded, …) never starts
 *     a read: `normalizeAnalysisSymbol(symbol) === symbol` is checked before any fetch.
 *   - A read starts only when the pane is ready (`dataReady`), mirroring the chart's
 *     own gating, so a hidden or deferred pane asks for nothing.
 *   - The effect's cleanup cancels ownership before a late promise can store, so an
 *     unmount can never repaint; and the render gate below makes a stored answer
 *     visible ONLY while it names this exact symbol AND the pane is still ready — a
 *     promise that settles after a symbol swap becomes invisible without waiting for
 *     any effect timing.
 *   - Missing document, wrong-ticker row, malformed quote_currency and read errors all
 *     answer null: the chip shows "unavailable", never a suffix or statement guess.
 */
export function useChartTradingCurrency(symbol: string, dataReady: boolean): string | null {
  const [read, setRead] = useState<CurrencyRead | null>(null);

  useEffect(() => {
    // The render gate below already hides anything stored for another symbol or a
    // not-ready pane; this effect only decides whether a read starts.
    if (!dataReady) return;
    if (normalizeAnalysisSymbol(symbol) !== symbol) return;
    let mine = true;
    getFund(symbol).then(
      (fund) => {
        if (!mine) return;
        setRead({ symbol, currency: tradingCurrencyFor(fund, symbol) });
      },
      () => {
        if (!mine) return;
        setRead({ symbol, currency: null });
      },
    );
    return () => {
      mine = false;
    };
  }, [symbol, dataReady]);

  // Synchronous render gate: a stored value is surfaced only while it belongs to THIS
  // exact symbol and the pane is ready. A stale read goes dark the moment its owning
  // (symbol, dataReady) pair stops being the current one — no effect needed.
  return read !== null && read.symbol === symbol && dataReady ? read.currency : null;
}
