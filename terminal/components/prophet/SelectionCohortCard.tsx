"use client";

/**
 * SelectionCohortCard — read-only theme context for the latest finalized U.S. picks.
 *
 * Gate #8 (Chairman, 2026-10-06; macro WS:GMI-THEME-GRAPH): a thin consumer of the macro
 * projection `mastermind.selection_cohort_projection.v1`, served same-origin through
 * /api/nw?f=selection_cohort_us. It adds NO authority: it never ranks, sorts, sizes, gates,
 * or re-orders anything, and it shows counts only — theme names are withheld until the
 * producer publishes plain-language labels and display rights resolve.
 *
 * Honesty: every state says WHICH empty it is (unavailable / no picks / shared / none /
 * unknown), withheld themes are disclosed by count, and a document that claims any
 * authority is refused by the reader (lib/selectionCohort.ts) and shown as unavailable.
 *
 * NOTE: translated strings MUST NOT appear in HTML title= attributes (CI-guarded).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Lang } from "@/lib/i18n";
import { parseSelectionCohort, type SelectionCohortView } from "@/lib/selectionCohort";
import { makeProphetT, type ProphetKey } from "./prophetStrings";
import styles from "./SelectionCohortCard.module.css";

const POLL_MS = 300_000; // producer republishes at most nightly; the route caches 5 min

const UNAVAILABLE_WHY: Record<"feed" | "source" | "checks", ProphetKey> = {
  feed: "cohortWhyFeed",
  source: "cohortWhySource",
  checks: "cohortWhyChecks",
};

const OVERLAP_LEAD: Record<"shared" | "none" | "unknown", ProphetKey> = {
  shared: "cohortOverlapShared",
  none: "cohortOverlapNone",
  unknown: "cohortOverlapUnknown",
};

export function SelectionCohortCard({ lang }: { lang: Lang }) {
  const t = makeProphetT(lang);
  const [view, setView] = useState<SelectionCohortView | null>(null);
  const aliveRef = useRef(false);

  const poll = useCallback(() => {
    fetch("/api/nw?f=selection_cohort_us")
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((raw: unknown) => {
        if (aliveRef.current) setView(parseSelectionCohort(raw));
      });
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      aliveRef.current = false;
      clearInterval(id);
    };
  }, [poll]);

  // First paint waits for the first answer so the desk never flashes a wrong state.
  if (!view) return null;

  return (
    <section
      className={`obs-card ${styles.card}`}
      data-testid="selection-cohort-card"
      data-state={view.kind}
      aria-labelledby="selection-cohort-title"
    >
      <header className={styles.head}>
        <h3 id="selection-cohort-title" className={`obs-lbl ${styles.title}`}>
          {t("cohortTitle")}
        </h3>
        <span className={styles.chip}>{t("cohortAuthority")}</span>
        {view.asOf ? (
          <span className={styles.asof}>
            {t("asOf")} {view.asOf}
          </span>
        ) : null}
      </header>

      {view.kind === "unavailable" ? (
        <>
          <p className={styles.lead}>{t("cohortUnavailable")}</p>
          <p className={styles.why}>{t(UNAVAILABLE_WHY[view.reason])}</p>
        </>
      ) : null}

      {view.kind === "empty" ? (
        <>
          <p className={styles.lead}>{t("cohortEmpty")}</p>
          <p className={styles.why}>{t("cohortEmptyWhy")}</p>
          {view.stale ? <p className={styles.why}>{t("cohortStale")}</p> : null}
        </>
      ) : null}

      {view.kind === "ready" ? (
        <>
          <p className={styles.lead}>{t(OVERLAP_LEAD[view.overlap])}</p>
          {view.partial ? <p className={styles.why}>{t("cohortPartialWhy")}</p> : null}
          {view.stale ? <p className={styles.why}>{t("cohortStale")}</p> : null}
          <dl className={styles.stats}>
            <div className={styles.stat}>
              <dt>{t("cohortStatPicks")}</dt>
              <dd>{view.nSelected}</dd>
            </div>
            <div className={styles.stat}>
              <dt>{t("cohortStatThemes")}</dt>
              <dd>{view.nConcepts}</dd>
            </div>
            <div className={styles.stat}>
              <dt>{t("cohortStatShared")}</dt>
              <dd>{view.nShared === null ? "—" : view.nShared}</dd>
            </div>
            <div className={styles.stat}>
              <dt>{t("cohortStatShown")}</dt>
              <dd>{view.nShown}</dd>
            </div>
          </dl>
          {view.nWithheld > 0 ? (
            <p className={styles.withheld} data-testid="selection-cohort-withheld">
              <b>{view.nWithheld}</b> {t("cohortWithheld")}
              {view.withheldInternal > 0 ? (
                <span className={styles.reason}>
                  {" · "}
                  <b>{view.withheldInternal}</b> {t("cohortWithheldInternal")}
                </span>
              ) : null}
              {view.withheldUnresolved > 0 ? (
                <span className={styles.reason}>
                  {" · "}
                  <b>{view.withheldUnresolved}</b> {t("cohortWithheldUnresolved")}
                </span>
              ) : null}
            </p>
          ) : null}
          {view.nShown > 0 ? <p className={styles.why}>{t("cohortNamesPending")}</p> : null}
        </>
      ) : null}
    </section>
  );
}
