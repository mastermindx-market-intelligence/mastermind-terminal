"use client";
/**
 * The wire tally (Wave B3 design pin P10): the wire-desk tally sheet — one mark per
 * day of copy, plus one outlined mark for the rolling 24 hours, set apart by a wider
 * gap. Its geometry carries the one distinction the feature depends on: a rolling
 * 24 hours is not a calendar day, and a day with no record is not a day with zero
 * reports. AXIS-FREE by design (the exact numbers live in the facts list right
 * below it); built on components/charts/svgChart.ts per the terminal chart law.
 */
import { useRef } from "react";

import { MIN_CHART_H, padDomain, useChartWidth } from "@/components/charts/svgChart";
import styles from "@/components/news/NewsFlowStrip.module.css";
import type { NewsCatchupLang } from "@/lib/newsCatchupLex";
import { newsFlowText, type NewsFlowKey } from "@/lib/newsFlowLex";
import type { TickerNewsFlow } from "@/lib/newsTypes";

const H = MIN_CHART_H.spark; // 120
const BASE_Y = 100;
const PLOT_H = 90;
const LABEL_Y = 114;
const PLOT_L = 4;
const GAP = 2;
const MAX_W = 420;
// 72 = PLOT_L 4 + right pad 4 + 27 gaps of 2 + the today gap 10.

export default function NewsFlowTally({ flow, lang }: { flow: TickerNewsFlow; lang: NewsCatchupLang }) {
  const t = (key: NewsFlowKey, vars?: Record<string, string | number>) => newsFlowText(key, lang, vars);
  const wrapRef = useRef<HTMLDivElement>(null);
  const w = useChartWidth(wrapRef, 296); // the wrapper div is ALWAYS rendered
  const daily = flow.daily_counts_28d;
  const r24 = flow.reports_24h;
  const median = flow.median_daily_28d;
  const history = flow.history_days_observed;

  const we = Math.min(w, MAX_W);
  const bw = Math.max(2, Math.min(12, Math.floor((we - 72) / 29)));
  const x0 = PLOT_L + Math.floor((we - 72 - 29 * bw) / 2);
  const xi = (i: number) => x0 + i * (bw + GAP); // i = 0..27, oldest on the left
  const xToday = x0 + 28 * bw + 64; // = xi(27) + bw + 10

  if (daily === null || r24 === null) {
    return <div ref={wrapRef} className={styles.tally} />;
  }

  const maxDaily = daily.reduce((max, v) => Math.max(max, v), 0);
  const hi = padDomain(0, Math.max(maxDaily, r24, median ?? 0, 1), { clampMin: 0 })[1];
  const barH = (v: number) => (v <= 0 ? 0 : Math.max(2, Math.round((v / hi) * PLOT_H)));
  const firstObserved = 28 - Math.min(28, history ?? 28);

  // At most one decimal: 2.5 renders "2.5", never "3" (D-W2).
  const medianDisplay = median === null ? null : String(Math.round(median * 10) / 10);
  const baseAria =
    flow.state === "ok" && medianDisplay !== null
      ? t("t.aria", { d: history ?? 0, m: medianDisplay, n: r24 })
      : t("t.aria.thin", { d: history ?? 0, n: r24 });
  const ariaLabel = flow.coverage === "partial" ? `${baseAria}. ${t("cmp.partial")}` : baseAria;

  const noRecordWidth = firstObserved > 0 ? xi(firstObserved - 1) + bw - x0 : 0;
  const yM = median === null ? null : Math.round(BASE_Y - (median / hi) * PLOT_H) + 0.5;
  const hT = r24 > 0 ? barH(r24) : 2;

  return (
    <div ref={wrapRef} className={styles.tally}>
      <svg
        className={styles.tallySvg}
        width={we}
        height={H}
        viewBox={`0 0 ${we} ${H}`}
        role="img"
        aria-label={ariaLabel}
      >
        {firstObserved > 0 ? (
          <line className={styles.noRecord} x1={x0} x2={xi(firstObserved - 1) + bw} y1={BASE_Y - 0.5} y2={BASE_Y - 0.5} />
        ) : null}
        {daily.map((v, i) =>
          i < firstObserved ? null : v > 0 ? (
            <rect key={i} className={styles.bar} x={xi(i)} y={BASE_Y - barH(v)} width={bw} height={barH(v)} />
          ) : (
            <rect key={i} className={styles.zeroDot} x={xi(i) + Math.floor((bw - 2) / 2)} y={98} width={2} height={2} />
          ),
        )}
        {flow.state === "ok" && yM !== null ? (
          <>
            <line className={styles.median} x1={x0} x2={xi(27) + bw} y1={yM} y2={yM} />
            <text className={styles.tallyLabel} x={x0} y={yM - 3} textAnchor="start">{t("t.typical")}</text>
          </>
        ) : null}
        <rect
          className={flow.coverage === "partial" ? `${styles.today} ${styles.todayPartial}` : styles.today}
          x={xToday + 0.625}
          y={BASE_Y - hT + 0.625}
          width={bw - 1.25}
          height={hT - 1.25}
        />
        <text className={styles.tallyLabel} x={xToday + bw} y={LABEL_Y} textAnchor="end">{t("t.today")}</text>
        {noRecordWidth >= 48 ? (
          <text className={styles.tallyLabel} x={x0} y={LABEL_Y} textAnchor="start">{t("t.norecord")}</text>
        ) : null}
      </svg>
    </div>
  );
}
