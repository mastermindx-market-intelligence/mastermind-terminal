"use client";

import { useMemo } from "react";
import { useLang } from "@/lib/i18n";
import { useSectorT } from "@/lib/sectorIntelligenceLex";
import {
  INTRADAY_BENCHMARK, INTRADAY_METHOD, INTRADAY_REASON_LEX,
  sectorIntradayRead, type IntradayReason, type IntradayRow,
} from "@/lib/sectorIntradayComparison";
import type { FeedStatus } from "@/lib/sectorIntelligence";
import styles from "./SectorIntradayComparison.module.css";

/** Catalyst intraday comparison, mounted inside the existing Sector overview.
 *
 * This is presentation of the owner's already-measured numbers and nothing else. It renders no
 * value the owner did not emit, computes no comparative metric of its own, and keeps the observed
 * interval visibly distinct from the owner's separate whole-day change. A basket that cannot be
 * qualified shows why — never a zero, a blank or an implied positive. */
export default function SectorIntradayComparison({ data, status, asOf, nowMs }: {
  data: unknown; status: FeedStatus; asOf: string | null; nowMs: number;
}) {
  const t = useSectorT(), { lang } = useLang();
  const read = useMemo(() => (status === "ready" ? sectorIntradayRead(data, nowMs) : null), [data, status, nowMs]);

  // One clock per feed, in the owner's own precision. Never truncated to a date and never
  // replaced by the transport receipt.
  const sourceClock = read?.asOfUtc || asOf;
  const rows = useMemo(() => {
    const list = [...(read?.rows || [])];
    list.sort((a, b) => {
      if ((a.outcome === "observed") !== (b.outcome === "observed")) return a.outcome === "observed" ? -1 : 1;
      if (a.outcome === "observed" && b.outcome === "observed") {
        const weight = Math.abs(b.relativeChangePct) - Math.abs(a.relativeChangePct);
        if (weight) return weight;
      }
      return a.basketId.localeCompare(b.basketId);
    });
    return list;
  }, [read]);

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
      {sourceClock && <time className={styles.clock} dateTime={sourceClock} data-testid="sector-intraday-clock">{sourceClock}</time>}
    </header>
    {body}
    <p className={styles.footnote}>{t("siIntradayOwnerSource")}</p>
  </section>;
}

function Basket({ row, t, reasonText }: {
  row: IntradayRow; t: (key: string) => string; reasonText: (key: IntradayReason) => string;
}) {
  if (row.outcome !== "observed") return <p className={styles.unqualified} data-testid="sector-intraday-unqualified">
    <span className={styles.basketId}>{row.basketId}</span>
    <span>{reasonText(row.reason)}</span>
  </p>;

  const { clock, coverage } = row;
  const observed = row;
  const sign = (value: number) => value === 0 ? undefined : value > 0 ? "up" : "down";
  return <details className={styles.basket} data-testid="sector-intraday-basket" data-basket={observed.basketId}>
    <summary className={styles.summary}>
      <span className={styles.basketId}>{observed.basketId}</span>
      <Metric label={t("siIntradayIntervalLabel")} value={observed.absoluteChangePct} sign={sign(observed.absoluteChangePct)} />
      <Metric label={t("siIntradayRelativeLabel")} value={observed.relativeChangePct} sign={sign(observed.relativeChangePct)} />
      <Metric label={t("siIntradayBreadthLabel")} value={observed.positiveRelativeBreadthPct} sign={undefined} />
      {/* The owner's whole-day change sits on its own clock and is never folded into the interval. */}
      {observed.dayChangePct === null
        ? <Metric label={t("siIntradayDayLabel")} text={t("siIntradayDayMissing")} />
        : <Metric label={t("siIntradayDayLabel")} value={observed.dayChangePct} sign={sign(observed.dayChangePct)} />}
    </summary>
    <dl className={styles.detail}>
      <Pair term={t("siIntradayReferenceClock")} detail={clock ? clock.referenceAsOf : null} mono />
      <Pair term={t("siIntradaySourceClock")} detail={clock ? clock.sourceAsOf : null} mono />
      <Pair term={t("siIntradayElapsed")} detail={clock ? `${Math.round(clock.elapsedSeconds)} s` : null} />
      <Pair term={t("siIntradaySession")} detail={clock ? clock.sessionDate : null} />
      <Pair term={t("siIntradayBenchmark")} detail={INTRADAY_BENCHMARK} />
      <Pair term={t("siIntradayMethod")} detail={INTRADAY_METHOD} />
      <Pair term={t("siIntradayCoverageLabel")} detail={coverage ? `${coverage.matchedMembers} / ${coverage.totalMembers} (${coverage.coveragePct.toFixed(1)}%)` : null} />
      <Pair term={t("siIntradaySkew")} detail={clock ? `${clock.maxClockSkewSeconds.toFixed(1)} s` : null} />
      <Pair term={t("siIntradayExclusions")} detail={coverage && coverage.excluded.length
        ? coverage.excluded.map(entry => `${entry.reason} ×${entry.count}`).join(", ")
        : coverage ? t("siIntradayNoExclusions") : null} />
      <Pair term={t("siIntradayDeliveryNew")} detail={observed.deliveryState === "retained" ? t("siIntradayDeliveryRetained") : null} muted={observed.deliveryState !== "retained"} />
      {observed.observationKind === "settled_regular" && <Pair term={t("siIntradayClosing")} detail="✓" />}
      <Pair term={t("siIntradayOwnerStatus")} detail={observed.ownerStatus} mono />
    </dl>
  </details>;
}

function Metric({ label, value, text, sign }: { label: string; value?: number; text?: string; sign?: "up" | "down" }) {
  return <span className={styles.metric}>
    <span className={styles.metricLabel} data-intraday-label>{label}</span>
    <strong className={styles.metricValue} data-sign={sign} data-intraday-value>
      {value === undefined ? text : `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(2)}%`}
    </strong>
  </span>;
}

function Pair({ term, detail, mono, muted }: { term: string; detail: string | null; mono?: boolean; muted?: boolean }) {
  return <div className={styles.pair}>
    <dt>{term}</dt>
    <dd data-mono={mono || undefined} data-muted={muted || undefined}>{detail || "—"}</dd>
  </div>;
}
