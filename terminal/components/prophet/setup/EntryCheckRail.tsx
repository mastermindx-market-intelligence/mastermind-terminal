"use client";
/**
 * EntryCheckRail — the case's rail (T2-03). Two owners, two states (T2-20 #10
 * law): the ENTRY ASSESSMENT (a gate product) is not served by any wire — it
 * renders as the amber designed-unavailable state with the served plan
 * management note; the MODEL PLAN's own terms (entry / stop / targets) ARE
 * served by the board read and render through Lane D's GeometryRail, imported
 * read-only and labeled reported. The rail never mints an entry decision.
 */
import type { Lang } from "@/lib/i18n";
import { makeProphetSectorT } from "../sector/prophetSectorStrings";
import { GeometryRail, type GeometryPayload } from "../GeometryRail";
import { makeSetupT } from "./setupStrings";
import { SaveFollow } from "./SaveFollow";
import styles from "./setup.module.css";

export interface BoardPlanRow { id: string; [key: string]: unknown }

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function EntryCheckRail({ symbol, planId, boardPhase, boardPlan, lang }: {
  symbol: string;
  /** The join's exact plan id from the sector contract, or null. */
  planId: string | null;
  boardPhase: "loading" | "ready" | "unavailable" | "idle";
  boardPlan: BoardPlanRow | null;
  lang: Lang;
}) {
  const t = makeSetupT(lang);
  const sectorT = makeProphetSectorT(lang);

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
            <ul className={styles.obsTriggerList}>
              {noteBullets.map((bullet, index) => <li key={index}>{bullet}</li>)}
            </ul>
          </div>
        ) : null}
        {planId === null ? <p className={styles.unavailableNote}>{t("entryTermsMissing")}</p> : null}
        <p className={styles.cardFootnote}>{t("entryPriceNote")}</p>
      </section>

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
          <p className={styles.emptyCopy}>{sectorT("retry")}</p>
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
                <summary className={styles.railItemLabel}>{t("planThesisLabel")}</summary>
                <p className={styles.unavailableBody} style={{ overflowWrap: "anywhere" }}>{thesis}</p>
              </details>
            ) : null}
          </>
        )}
      </section>

      <SaveFollow symbol={symbol} />

      <p className={styles.cardFootnote} style={{ padding: "0 2px" }}>{t("researchNote")}</p>
    </div>
  );
}
