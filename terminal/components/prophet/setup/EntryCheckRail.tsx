"use client";
/**
 * EntryCheckRail — the case's rail (T2-03), one shape per destination:
 *
 *   - Setup: the entry check's honest amber state, then Save/Follow, then the
 *     read-only "Model plan" rail. DOM order is entry check → action → plan
 *     (phones keep T2-12's reading order); on the two-column layout the CSS
 *     lifts the action to the top of the rail, because the round-3 fold rule
 *     requires the BUTTON to sit fully above the fixed disclaimer bar at
 *     1440×900 even when the stance heading wraps to two lines. Two owners,
 *     two states (T2-20 #10 law): the ENTRY ASSESSMENT (a gate product) is
 *     not served by any wire; the MODEL PLAN's own terms ARE served by the
 *     board read and render through Lane D's GeometryRail, imported read-only
 *     and labeled reported. A board read that does not land is NEVER "this
 *     plan is not in the current board read" (a published-absence claim): it
 *     renders the T2-21 assessment-unavailable / status-unknown state with a
 *     retry (fix order item 1 — flowGetResult keeps the outcome; only status
 *     "data" reaches the ready phase). The rail never mints an entry decision.
 *
 *   - Evidence (fix order item 7): "What can we conclude?" as per-field rows
 *     — reported growth, consensus surprise, matched revisions, entry
 *     decision — each in its unavailable state, plus the Next checks list.
 *     No repeated entry check or model plan here.
 *
 *   - Context: no rail at all (fix order item 8 — the repeated rail is
 *     dropped; the context destinations carry their own blocks).
 */
import type { Lang } from "@/lib/i18n";
import { makeProphetSectorT } from "../sector/prophetSectorStrings";
import { GeometryRail, type GeometryPayload } from "../GeometryRail";
import type { CaseTab } from "./CaseTabs";
import { makeSetupT, type SetupKey } from "./setupStrings";
import { SaveFollow } from "./SaveFollow";
import styles from "./setup.module.css";

export interface BoardPlanRow { id: string; [key: string]: unknown }

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function EntryCheckRail({ symbol, tab, planId, boardPhase, boardPlan, onRetryBoard, lang }: {
  symbol: string;
  /** Which destination's rail shape to render. */
  tab: CaseTab;
  /** The join's exact plan id from the sector contract, or null. */
  planId: string | null;
  boardPhase: "loading" | "ready" | "unavailable" | "idle";
  boardPlan: BoardPlanRow | null;
  /** Retry the board read with a cache-bypassing refresh. */
  onRetryBoard: () => void;
  lang: Lang;
}) {
  const t = makeSetupT(lang);
  const sectorT = makeProphetSectorT(lang);

  // Context drops the repeated rail entirely (fix order item 8).
  if (tab === "context") return null;

  // Evidence: the conclusion rail — per-field unavailable rows + next checks
  // (fix order item 7). No entry check, no model plan, no save.
  if (tab === "evidence") {
    const conclusionRows: ReadonlyArray<SetupKey> = ["rowGrowth", "rowSurprise", "rowRevisions", "rowEntry"];
    return (
      <div className={styles.caseRail} data-testid="evidence-conclusion-rail">
        <section className={styles.card} data-testid="evidence-conclusion">
          <h4 className={styles.cardTitle}>{t("concludeTitle")}</h4>
          <p className={styles.cardIntro}>{t("concludeBody")}</p>
          <ul className={styles.railList}>
            {conclusionRows.map((key) => (
              <li key={key} className={styles.railItem}>
                <span className={styles.railItemLabel}>{t(key)}</span>
                <span className={`${styles.railItemValue} ${styles.railItemValueMissing}`}>{t("rowNotPublished")}</span>
              </li>
            ))}
          </ul>
          <div>
            <p className={styles.railItemLabel}>{t("nextChecksTitle")}</p>
            <p className={styles.unavailableNote}>{t("nextCheckUnavailable")}</p>
          </div>
        </section>
      </div>
    );
  }

  const direction: "BULL" | "BEAR" =
    boardPlan?.direction === "BEAR" || boardPlan?.direction === "short" ? "BEAR" : "BULL";
  const targets = Array.isArray(boardPlan?.targets)
    ? (boardPlan!.targets as unknown[]).map(asNumber)
    : [];
  const state = (boardPlan?.state ?? null) as { geometry?: GeometryPayload } | null;
  const noteBullets = Array.isArray(boardPlan?.what_to_do_now)
    ? (boardPlan!.what_to_do_now as unknown[]).filter((item): item is string => typeof item === "string")
    : [];
  const strategy = asString(boardPlan?.strategy);
  const asof = asString(boardPlan?._signal_date);
  const conviction = asNumber(boardPlan?._conviction_score);
  const thesis = asString(boardPlan?.thesis);

  return (
    <div className={styles.caseRail} data-testid="entry-check-rail">
      <section className={styles.card} data-testid="entry-check">
        <h4 className={styles.cardTitle}>{t("entryTitle")}</h4>
        <span className={`${styles.badge} ${styles.badgeWarn}`}>{t("entryUnavailable")}</span>
        <p className={styles.unavailableBody}>{t("entryUnavailableBody")}</p>
        {noteBullets.length > 0 ? (
          <div>
            <p className={styles.railItemLabel}>{t("planNoteLabel")}</p>
            <ul className={styles.noteList}>
              {noteBullets.map((bullet, index) => <li key={index}>{bullet}</li>)}
            </ul>
          </div>
        ) : null}
        {planId === null ? <p className={styles.unavailableNote}>{t("entryTermsMissing")}</p> : null}
        <p className={styles.cardFootnote}>{t("entryPriceNote")}</p>
      </section>

      {/* The case's natural next action. It follows the entry state in the
          DOM and leads the rail visually on desktop (round-3 fold rule). */}
      <SaveFollow symbol={symbol} />

      <section className={`${styles.card} ${styles.modelPlan}`} data-testid="model-plan-rail">
        <h4 className={styles.cardTitle}>{t("modelPlanTitle")}</h4>
        <p className={styles.unavailableNote}>{t("modelPlanReported")}</p>
        {planId === null ? (
          <p className={styles.unavailableBody}>{t("modelPlanNone")}</p>
        ) : boardPhase === "idle" || boardPhase === "loading" ? (
          <div>
            <span className={styles.a11yLabel}>{t("caseLoading")}</span>
            <div className={styles.skeleton} aria-hidden="true">
              <div className={styles.skeletonBar} />
              <div className={styles.skeletonBar} />
              <div className={styles.skeletonBar} />
            </div>
          </div>
        ) : boardPhase === "unavailable" ? (
          /* Fix order item 1: a read that did not land is status unknown with
             a retry — never a claim that the plan is absent from the board. */
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
        ) : boardPlan === null ? (
          <p className={styles.emptyCopy} data-testid="prophet-sector-plan-missing">{t("modelPlanMissing")}</p>
        ) : (
          <>
            <GeometryRail
              direction={direction}
              entry={asNumber(boardPlan.entry)}
              stop={asNumber(boardPlan.invalidation)}
              t1={targets[0] ?? null}
              t2={targets[1] ?? null}
              last={asNumber(boardPlan.last_price)}
              geometry={state?.geometry ?? null}
              lang={lang}
            />
            <ul className={styles.railList}>
              <li className={styles.railItem}>
                <span className={styles.railItemLabel}>{t("planIdLabel")}</span>
                <span className={styles.railItemValue}>{boardPlan.id}</span>
              </li>
              {strategy !== null ? (
                <li className={styles.railItem}>
                  <span className={styles.railItemLabel}>{t("planStrategyLabel")}</span>
                  <span className={styles.railItemValue}>{strategy}</span>
                </li>
              ) : null}
              {asof !== null ? (
                <li className={styles.railItem}>
                  <span className={styles.railItemLabel}>{t("planAsOfLabel")}</span>
                  <span className={styles.railItemValue}>{asof}</span>
                </li>
              ) : null}
              {conviction !== null ? (
                <li className={styles.railItem}>
                  <span className={styles.railItemLabel}>{t("planConvictionLabel")}</span>
                  <span className={styles.railItemValue}>{conviction}/100</span>
                </li>
              ) : null}
            </ul>
            {thesis !== null ? (
              <details data-testid="plan-thesis">
                {/* The same disclosure grammar and ≤640px 44px touch contract
                    as the Sources & method control (fix r2 B1). */}
                <summary className={`${styles.disclosureSummary} ${styles.railItemLabel} ${styles.thesisSummary}`}>
                  {t("planThesisLabel")}
                </summary>
                <p className={styles.unavailableBody} style={{ overflowWrap: "anywhere" }}>{thesis}</p>
              </details>
            ) : null}
          </>
        )}
      </section>

      <p className={styles.cardFootnote} style={{ padding: "0 2px" }}>{t("researchNote")}</p>
    </div>
  );
}
