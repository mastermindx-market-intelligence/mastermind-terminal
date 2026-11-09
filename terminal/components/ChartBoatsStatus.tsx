"use client";

import { useEffect, useState } from "react";
import type { Lang } from "@/lib/i18n";
import type { LiveQuote } from "./ChartPanel";
import { isPublicBoatsQuote } from "@/lib/extQuoteFreshness";
import { boatsChartCopy } from "@/lib/extQuoteCopy";
import { boatsChartCoverageView, type BoatsChartHistory } from "@/lib/extQuoteCopy";
import styles from "./ChartOvernight.module.css";

/** Data lineage and freshness only: no new cache, connection or chart render loop. */
export default function ChartBoatsStatus({ lang, symbol, timeframe, history, quote }: {
  lang: Lang;
  symbol: string;
  timeframe: string;
  history: BoatsChartHistory | null;
  quote?: LiveQuote;
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    // Refresh the stale-state label without waking the chart's expensive render path.
    const timer = window.setInterval(() => setNowMs(Date.now()), quote?.extSource === "tiingo_boats" ? 1000 : 30_000);
    return () => window.clearInterval(timer);
  }, [quote?.extSource]);
  const view = boatsChartCoverageView(lang, symbol, timeframe, history, nowMs);
  const liveTrade = isPublicBoatsQuote(quote, nowMs) ? quote : null;
  const price = liveTrade?.extPrice;
  const tradeText = typeof price === "number"
    ? price.toLocaleString("en-US", { minimumFractionDigits: price < 10 ? 4 : 2,
        maximumFractionDigits: price < 10 ? 4 : 2 }) : null;
  return (
    <div className={styles.coverage} role="status" aria-live="polite"
      data-testid="chart-24h-coverage" data-boats-state={view.state}>
      <span className={styles.identity}>
        <span className={styles.dot + " " + styles[view.state]} aria-hidden="true" />
        <span className={styles.title}>{view.headline}</span>
      </span>
      <span className={styles.detail} title={boatsChartCopy(lang).coverage}>{view.detail}</span>
      {tradeText && <span className={styles.trade} data-testid="chart-boats-last-trade">
        <span className={styles.tradeIdentity}>{lang === "zh" ? "BOATS最新成交 · 非NBBO" : "BOATS last trade · not NBBO"}</span>
        <strong className={styles.tradePrice}>{"$" + tradeText}</strong>
      </span>}
    </div>
  );
}
