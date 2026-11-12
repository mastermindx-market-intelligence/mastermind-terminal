"use client";
/**
 * SourcesSheet (T2-16) — the Sources & method disclosure behind a "Sources &
 * method" link (T2-12 vocabulary). Every source keeps its own clock, stated
 * per row and never merged into one "as of"; rows this surface does not carry
 * say so in plain words. No source here is a live quote feed.
 */
import type { Lang } from "@/lib/i18n";
import { makeSetupT, setupFill } from "./setupStrings";
import styles from "./setup.module.css";

export function SourcesSheet({ rosterDate, planSignalDate, planReadFailed, observationAsof, lang }: {
  /** Roster's own effective date for this member (memberSince), else the
   * stored-snapshot lower bound (firstKnown). */
  rosterDate: string | null;
  /** The plan's signal date — the board read's own value when it landed, else
   * the join's reported open date. */
  planSignalDate: string | null;
  /** The board read failed: its clock is "not readable", never a fake date. */
  planReadFailed: boolean;
  observationAsof: string | null;
  lang: Lang;
}) {
  const t = makeSetupT(lang);
  const plansClock = planReadFailed
    ? t("srcNotReadable")
    : planSignalDate !== null
      ? setupFill(t("srcPlansClock"), { date: planSignalDate })
      : t("valueNotAvailable");

  return (
    <details className={styles.sourcesSheet} data-testid="sources-sheet">
      <summary className={`${styles.disclosureSummary} ${styles.sourcesSummary}`}>{t("sourcesTitle")}</summary>
      <p className={styles.cardIntro}>{t("sourcesIntro")}</p>
      <div className={styles.sourceRow}>
        <span className={styles.sourceName}>{t("srcRoster")}</span>
        <span className={styles.sourceClock}>{rosterDate ?? t("valueNotAvailable")}</span>
      </div>
      <div className={styles.sourceRow}>
        <span className={styles.sourceName}>{t("srcPlans")}</span>
        <span className={styles.sourceClock}>{plansClock}</span>
      </div>
      <div className={styles.sourceRow}>
        <span className={styles.sourceName}>{t("srcObs")}</span>
        <span className={styles.sourceClock}>
          {observationAsof !== null
            ? setupFill(t("srcObsClock"), { date: observationAsof })
            : t("valueNotAvailable")}
        </span>
      </div>
      <div className={styles.sourceRow}>
        <span className={styles.sourceName}>{t("srcQuotes")}</span>
        <span className={styles.sourceClock}>{t("valueNotAvailable")}</span>
      </div>
      <div className={styles.sourceRow}>
        <span className={styles.sourceName}>{t("srcFundamentals")}</span>
        <span className={styles.sourceClock}>{t("valueNotAvailable")}</span>
      </div>
      <div className={styles.sourceRow}>
        <span className={styles.sourceName}>{t("srcPeers")}</span>
        <span className={styles.sourceClock}>{t("valueNotAvailable")}</span>
      </div>
    </details>
  );
}
