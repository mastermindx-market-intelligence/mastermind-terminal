"use client";
/**
 * ModelPlanRail — the case's action rail: Save / Follow, then the model plan
 * as ONE CLOSED, LINKED ROW (P0-1 of the design-critic order).
 *
 * What stood here was a full trade ticket: entry, stop, two targets, a green
 * "T1 away …R" reward multiple, a conviction score, position-management
 * bullets and a thesis that said "size down". The reader arrived from a
 * descriptive sector screen and met an order ticket — the exact thing
 * DESIGN_DOCTRINE §8 forbids. Paper never draws it: T2-03 and T2-C1 show the
 * plan as a relationship, T2-C5 shows one collapsed "Original model plan" row
 * with the plain not-permission-to-trade line, and SX03 shows no plan terms at
 * all.
 *
 * So this rail carries no price, no R multiple, no conviction, no thesis. The
 * row names the plan and its open date and links to the Plans destination,
 * which owns trade geometry. A plan read that does not land is a LOADING
 * failure with a retry — never "this plan is not in the current board read"
 * (a published-absence claim; fix order item 1). Only status "data" reaches
 * the ready phase.
 *
 * Evidence and Context carry no rail: those destinations are about what is
 * published and how the name relates, not about acting on it.
 */
import type { Lang } from "@/lib/i18n";
import { makeProphetSectorT } from "../sector/prophetSectorStrings";
import type { CaseTab } from "./CaseTabs";
import { makeSetupT, setupFill } from "./setupStrings";
import { SaveFollow } from "./SaveFollow";
import styles from "./setup.module.css";

export function ModelPlanRail({ symbol, tab, planId, planOpenedOn, plansHref, boardPhase, onRetryBoard, lang }: {
  symbol: string;
  /** Which destination owns the rail (only Setup does). */
  tab: CaseTab;
  /** The join's exact plan id from the sector contract, or null. */
  planId: string | null;
  /** The plan's own open / signal date — labeled as what it is, never
   * "Assessment" (P1-4). */
  planOpenedOn: string | null;
  /** The Plans destination (macro lane), carrying this plan for selection;
   * null before the mount is resolved. */
  plansHref: string;
  boardPhase: "loading" | "ready" | "unavailable" | "idle";
  /** Retry the plan read with a cache-bypassing refresh. */
  onRetryBoard: () => void;
  lang: Lang;
}) {
  const t = makeSetupT(lang);
  const sectorT = makeProphetSectorT(lang);

  if (tab !== "setup") return null;

  return (
    <div className={styles.caseRail} data-testid="case-rail">
      <SaveFollow symbol={symbol} />

      <section className={`${styles.card} ${styles.modelPlan}`} data-testid="model-plan-rail">
        {planId === null ? (
          <>
            <h4 className={styles.cardTitle}>{t("planRowTitle")}</h4>
            <p className={styles.unavailableBody}>{t("planRowNone")}</p>
            <a className={styles.planRowLink} data-testid="prophet-sector-plan-link" href={plansHref}>
              {t("planRowBrowse")} →
            </a>
          </>
        ) : boardPhase === "idle" || boardPhase === "loading" ? (
          <div>
            <span className={styles.a11yLabel}>{t("caseLoading")}</span>
            <div className={styles.skeleton} aria-hidden="true">
              <div className={styles.skeletonBar} />
              <div className={styles.skeletonBar} />
            </div>
          </div>
        ) : boardPhase === "unavailable" ? (
          /* A read that did not land is status unknown with a retry — never a
             claim that the plan is absent (fix order item 1). */
          <div data-testid="prophet-sector-plan-unavailable">
            <span className={`${styles.badge} ${styles.badgeWarn}`}>{t("planUnavailable")}</span>
            <p className={styles.unavailableBody}>{t("stateUnknown")}</p>
            <p className={styles.unavailableNote}>{t("planUnavailableBody")}</p>
            <button
              type="button"
              className={styles.ghostButton}
              data-testid="prophet-sector-plan-retry"
              onClick={onRetryBoard}
            >
              {sectorT("retryAction")}
            </button>
          </div>
        ) : (
          <>
            <a className={styles.planRow} data-testid="prophet-sector-plan-link" href={plansHref}>
              <span className={styles.planRowName} data-testid="prophet-sector-plan-id">
                {t("planRowTitle")} · {planId}
              </span>
              <span className={styles.planRowArrow} aria-hidden="true">→</span>
            </a>
            <p className={styles.unavailableNote}>
              {planOpenedOn !== null ? `${setupFill(t("planRowOpened"), { date: planOpenedOn })} ` : ""}
              {t("planRowLine")}
            </p>
          </>
        )}
      </section>
    </div>
  );
}
