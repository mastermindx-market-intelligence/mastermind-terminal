"use client";
/**
 * CaseUnavailable / StudyLinks — the T2-C5 case-unpublished state, at every
 * width (the design was drawn at 390; the COO order makes it the case state).
 *
 * ONE card says what is unavailable — verdict headline, research family,
 * supports and challenges, next check, entry assessment — each in plain
 * reader words ("Not available" / "Unavailable"), with the one date that is
 * real (the latest observation) on its own labeled line. This replaces the
 * ~12 separate "not produced / not served" blocks the design critic counted
 * across the tabs (P1-2), and it deletes the developer placeholder copy that
 * described a slot instead of the state (P1-3).
 *
 * "You can still study" is the honest exit list: the served evidence, the
 * membership context, and the source clocks the page actually has. Rows that
 * switch destinations are buttons (they act on this page); the chart is an
 * anchor (it leaves for the company page).
 */
import type { Lang } from "@/lib/i18n";
import { makeProphetSectorT, prophetSectorFill } from "../sector/prophetSectorStrings";
import type { CaseTab } from "./CaseTabs";
import { makeSetupT, setupFill, type SetupKey } from "./setupStrings";
import styles from "./setup.module.css";

export function CaseUnavailable({ symbol, observedAsof, lang }: {
  symbol: string;
  /** The served observation date, when the join carries one — the only date
   * this state can honestly show. The plan's own date lives on the plan row. */
  observedAsof: string | null;
  lang: Lang;
}) {
  const t = makeSetupT(lang);
  const rows: ReadonlyArray<{ key: SetupKey; warn?: boolean }> = [
    { key: "rowVerdict" },
    { key: "rowFamily" },
    { key: "rowSupports" },
    { key: "rowNext" },
    { key: "rowEntry", warn: true },
  ];

  return (
    <section className={styles.card} data-testid="case-unavailable">
      <div className={styles.unavailableHead}>
        <span className={styles.warnMark} aria-hidden="true">!</span>
        <h4 className={styles.cardTitle}>{t("caseUnavailable")}</h4>
      </div>
      <p className={styles.unavailableBody}>
        {setupFill(t("caseUnavailableBody"), { symbol })}
      </p>
      <ul className={styles.railList}>
        {rows.map(({ key, warn }) => (
          <li key={key} className={styles.railItem}>
            <span className={styles.railItemLabel}>{t(key)}</span>
            <span className={`${styles.railItemValue} ${warn ? styles.railItemValueWarn : styles.railItemValueMissing}`}>
              {t(warn ? "valueUnavailable" : "valueNotAvailable")}
            </span>
          </li>
        ))}
      </ul>
      {observedAsof !== null ? (
        <p className={styles.unavailableNote} data-testid="case-unavailable-dates">
          {setupFill(t("cardObserved"), { date: observedAsof })}
        </p>
      ) : null}
    </section>
  );
}

export function StudyLinks({ symbol, chartHref, onTab, onOpenSources, lang }: {
  symbol: string;
  chartHref: string | null;
  onTab: (tab: CaseTab) => void;
  /** Open the Sources & method disclosure — it stays the one owner of the
   * per-source clocks on this page. */
  onOpenSources: () => void;
  lang: Lang;
}) {
  const t = makeSetupT(lang);
  const sectorT = makeProphetSectorT(lang);

  return (
    <section className={styles.card} data-testid="study-links">
      <h4 className={styles.cardTitle}>{t("studyLinksTitle")}</h4>
      <ul className={styles.studyLinkList}>
        <li>
          <button type="button" className={styles.studyLinkRow} data-testid="study-link-evidence" onClick={() => onTab("evidence")}>
            <span>{t("linkEvidence")}</span>
            <span className={styles.studyLinkArrow} aria-hidden="true">→</span>
          </button>
        </li>
        <li>
          <button type="button" className={styles.studyLinkRow} data-testid="study-link-context" onClick={() => onTab("context")}>
            <span>{t("linkContext")}</span>
            <span className={styles.studyLinkArrow} aria-hidden="true">→</span>
          </button>
        </li>
        <li>
          <button type="button" className={styles.studyLinkRow} data-testid="study-link-sources" onClick={onOpenSources}>
            <span>{t("sourcesTitle")}</span>
            <span className={styles.studyLinkArrow} aria-hidden="true">→</span>
          </button>
        </li>
      </ul>
      {chartHref !== null ? (
        <a className={styles.studyChartLink} data-testid="prophet-sector-chart-link" href={chartHref}>
          {prophetSectorFill(sectorT("setupChartLink"), { symbol })} ↗
        </a>
      ) : null}
    </section>
  );
}
