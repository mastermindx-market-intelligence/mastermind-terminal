"use client";

import styles from "@/components/news/TickerNewsPanel.module.css";
import type { NewsCatchupLang } from "@/lib/newsCatchupLex";
import { newsFlowText } from "@/lib/newsFlowLex";

/**
 * The rail's live dot as one component, so the panel and the specimen render the
 * same bytes. Status is never direction colour: the dot rides --brand-2, which the
 * east (red-up) convention never swaps, and it exposes a localized accessible name.
 */
export default function NewsLiveDot({ lang }: { lang: NewsCatchupLang }) {
  return (
    <span
      className={styles.liveDot}
      role="img"
      aria-label={newsFlowText("live.label", lang)}
      data-news-live-dot=""
    />
  );
}
