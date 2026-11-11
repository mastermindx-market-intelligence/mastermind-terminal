"use client";

import { useEffect, useMemo, useState } from "react";
import { useLang } from "@/lib/i18n";
import { useSectorT } from "@/lib/sectorIntelligenceLex";
import {
  INTRADAY_BENCHMARK, INTRADAY_METHOD, INTRADAY_REASON_LEX,
  sectorIntradayRead, type IntradayReason, type IntradayRow, type IntradayReadRow,
} from "@/lib/sectorIntradayComparison";
import type { FeedStatus } from "@/lib/sectorIntelligence";
import styles from "./SectorIntradayComparison.module.css";

/** Requalify already received observations as time passes. This changes presentation only:
 * it never fetches a feed, changes an owner clock, or creates a new observation. */
export function useSectorPresentationClock(receivedAt: number): number {
  const [tick, setTick] = useState(receivedAt);
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const sync = () => setTick(Date.now());
    const visibility = () => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
      if (document.visibilityState !== "hidden") {
        sync();
        timer = setInterval(sync, 30_000);
      }
    };
    visibility();
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      if (timer !== undefined) clearInterval(timer);
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  return Math.max(receivedAt, tick);
}

/** Owner-measured interval values, in producer order, within the existing Sector overview.
 * Qualified rows retain their validated evidence; absent/invalid comparisons retain identity
 * without inventing an owner status. Whole-day change remains separate from interval change. */
export default function SectorIntradayComparison({ data, status, nowMs }: {
  data: unknown; status: FeedStatus; asOf: string | null; nowMs: number;
}) {
  const t = useSectorT(), { lang } = useLang();
  const read = useMemo(() => (status === "ready" ? sectorIntradayRead(data, nowMs) : null), [data, status, nowMs]);
  // The legacy receipt prop is deliberately not a fallback for a missing quote-source clock.
  const rows = read?.rows || [];
  const reasonText = (key: IntradayReason) => { const pair = INTRADAY_REASON_LEX[key]; return pair[lang === "zh" ? 1 : 0]; };
  const headline = (key: string) => <p className={styles.message} role="status">{t(key)}</p>;
  const body = status === "loading" ? headline("siIntradayLoading")
    : status === "access" ? headline("siIntradayAccess")
    : status === "unavailable" || status === "error" ? headline("siIntradayUnavailable")
    : status === "invalid" || !read ? headline("siIntradayInvalid")
    : read.presentCount === 0 ? headline("siIntradayAbsent")
    : !rows.length ? headline("siIntradayInvalid")
    : rows.map(row => <Basket key={row.basketId} row={row} t={t} reasonText={reasonText} />);

  return <section className={styles.section} aria-labelledby="si-intraday-heading" data-testid="sector-intraday">
    <header className={styles.heading}>
      <div><h2 id="si-intraday-heading">{t("siIntradayTitle")}</h2><p>{t("siIntradaySubtitle")}</p></div>
      {read && <div className={styles.clocks}>
        <p><span>{t("siIntradayQuoteClock")}: </span>{read.quoteSourceAsOf
          ? <time className={styles.clock} dateTime={read.quoteSourceAsOf} data-testid="sector-intraday-clock">{read.quoteSourceAsOf}</time>
          : <span>{t("siIntradayClockUnavailable")}</span>}</p>
        {read.quoteBarDate && <p><span>{t("siIntradayQuoteBarDate")}: </span>
          <time className={styles.clock} dateTime={read.quoteBarDate} data-testid="sector-intraday-bar-date">{read.quoteBarDate}</time></p>}
        {read.asOfUtc && <p><span>{t("siIntradayEvaluationClock")}: </span>
          <time className={styles.clock} dateTime={read.asOfUtc} data-testid="sector-intraday-evaluation-clock">{read.asOfUtc}</time></p>}
      </div>}
    </header>
    {body}
    <p className={styles.footnote}>{t("siIntradayOwnerSource")}</p>
  </section>;
}

function Basket({ row, t, reasonText }: {
  row: IntradayReadRow; t: (key: string) => string; reasonText: (key: IntradayReason) => string;
}) {
  if (row.outcome !== "observed") return <details className={`${styles.basket} ${styles.unqualified}`}
    data-testid="sector-intraday-unqualified" data-basket={row.basketId}>
    <summary className={styles.unqualifiedSummary}>
      <span className={styles.basketId}>{row.basketId}</span>
      <span>{reasonText(row.reason)}</span>
    </summary>
    {"ownerStatus" in row ? <Evidence row={row} t={t} />
      : <p className={styles.message}>{t("siIntradayEvidenceUnavailable")}</p>}
  </details>;

  const sign = (value: number) => value === 0 ? undefined : value > 0 ? "up" : "down";
  return <details className={styles.basket} data-testid="sector-intraday-basket" data-basket={row.basketId}>
    <summary className={styles.summary}>
      <span className={styles.basketId}>{row.basketId}</span>
      <Metric label={t("siIntradayIntervalLabel")} value={row.absoluteChangePct} sign={sign(row.absoluteChangePct)} />
      <Metric label={t("siIntradayRelativeLabel")} value={row.relativeChangePct} sign={sign(row.relativeChangePct)} />
      <Metric label={t("siIntradayBreadthLabel")} value={row.positiveRelativeBreadthPct} />
      {row.dayChangePct === null
        ? <Metric label={t("siIntradayDayLabel")} text={t("siIntradayDayMissing")} />
        : <Metric label={t("siIntradayDayLabel")} value={row.dayChangePct} sign={sign(row.dayChangePct)} />}
    </summary>
    <Evidence row={row} t={t} />
  </details>;
}

function Evidence({ row, t }: { row: IntradayRow; t: (key: string) => string }) {
  const { clock, coverage } = row;
  return <dl className={styles.detail}>
    {clock ? <>
      <Pair term={t("siIntradayReferenceClock")} detail={clock.referenceAsOf} mono />
      <Pair term={t("siIntradaySourceClock")} detail={clock.sourceAsOf} mono />
      <Pair term={t("siIntradayElapsed")} detail={`${Math.round(clock.elapsedSeconds)} s`} />
      <Pair term={t("siIntradaySession")} detail={clock.sessionDate} />
      <Pair term={t("siIntradaySkew")} detail={`${clock.maxClockSkewSeconds.toFixed(1)} s`} />
    </> : <Pair term={t("siIntradayIntervalLabel")} detail={t("siIntradayIntervalUnavailable")} />}
    <Pair term={t("siIntradayBenchmark")} detail={INTRADAY_BENCHMARK} />
    <Pair term={t("siIntradayMethod")} detail={INTRADAY_METHOD} />
    <Pair term={t("siIntradayCoverageLabel")} detail={coverage
      ? `${coverage.matchedMembers} / ${coverage.totalMembers} (${coverage.coveragePct.toFixed(1)}%)`
      : t("siIntradayCoverageUnavailable")} />
    {coverage && <Pair term={t("siIntradayExclusions")} detail={coverage.excluded.length
      ? coverage.excluded.map(entry => `${entry.reason} ×${entry.count}`).join(", ")
      : t("siIntradayNoExclusions")} />}
    {row.deliveryState && <Pair term={t("siIntradayDeliveryLabel")} detail={row.deliveryState === "retained"
      ? t("siIntradayDeliveryRetained") : t("siIntradayDeliveryNew")} />}
    {row.observationKind === "settled_regular" && <Pair term={t("siIntradayClosing")} detail="✓" />}
    <Pair term={t("siIntradayOwnerStatus")} detail={row.ownerStatus} mono />
  </dl>;
}

function Metric({ label, value, text, sign }: { label: string; value?: number; text?: string; sign?: "up" | "down" }) {
  return <span className={styles.metric}>
    <span className={styles.metricLabel} data-intraday-label>{label}</span>
    <strong className={styles.metricValue} data-sign={sign} data-intraday-value>
      {value === undefined ? text : `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(2)}%`}
    </strong>
  </span>;
}

function Pair({ term, detail, mono }: { term: string; detail: string; mono?: boolean }) {
  return <div className={styles.pair}>
    <dt>{term}</dt>
    <dd data-mono={mono || undefined}>{detail}</dd>
  </div>;
}
