"use client";
/**
 * MemberSetup (SX03) — the real company setup behind a population row.
 *
 * Laws:
 *   - A member WITH a plan renders the REAL existing plan analysis (the board's
 *     own AnalysisPanel), selected by the contract's exact plan id — never a
 *     recomposed or manufactured one.
 *   - A member WITHOUT a plan renders an honest setup: what the group is doing,
 *     why no plan exists (the contract's reason, translated), any early
 *     observation, and the existing chart destination. Never a manufactured
 *     signal, never a stance.
 *   - The Prophet state is reported; the reported-not-recommended line stays on
 *     the surface.
 */
import { useEffect, useState } from "react";
import { flowGet } from "@/lib/flowClientCache";
import { useLang } from "@/lib/i18n";
import type { SectorMembersPayload } from "@/lib/prophetSectorMembers";
import { AnalysisPanel } from "../ProphetView";
import { makeProphetT } from "../prophetStrings";
import { companyHref } from "@/lib/sectorIntelligence";
import {
  makeProphetSectorT, prophetReasonKey, prophetSectorFill,
} from "./prophetSectorStrings";
import styles from "./prophetSector.module.css";

interface BoardPlanLike { id: string; [key: string]: unknown }
interface BoardPayloadLike { plans?: BoardPlanLike[] }

export function MemberSetup({ payload, onBack }: {
  payload: Extract<SectorMembersPayload, { mode: "symbol" }>;
  onBack: () => void;
}) {
  const { lang } = useLang();
  const t = makeProphetSectorT(lang);
  const prophetT = makeProphetT(lang);
  const [boardPlan, setBoardPlan] = useState<BoardPlanLike | null>(null);
  const [boardPhase, setBoardPhase] = useState<"loading" | "ready" | "unavailable">("loading");

  const membership = payload.memberOf[0] ?? null;
  const group = membership?.group ?? null;
  const member = membership?.member ?? null;
  const prophet = payload.prophet;
  const planId = prophet.plan?.id ?? null;
  const localGroupName = group !== null
    ? (lang === "zh" ? (group.nameZh || group.name || group.id) : (group.name || group.id))
    : "";
  const chartHref = companyHref(payload.symbol);

  // The board read runs only for members whose join carries a plan id; the
  // no-plan setup never touches the board (boardPhase is never read there).
  useEffect(() => {
    if (planId === null) return;
    let cancelled = false;
    void (async () => {
      setBoardPhase("loading");
      try {
        const data = await flowGet("prophet_idx") as BoardPayloadLike | null;
        if (cancelled) return;
        const match = data?.plans?.find(plan => plan.id === planId) ?? null;
        setBoardPlan(match);
        setBoardPhase("ready");
      } catch {
        if (!cancelled) setBoardPhase("unavailable");
      }
    })();
    return () => { cancelled = true; };
  }, [planId]);

  return (
    <section className={styles.setup} data-testid="prophet-sector-setup">
      <header className={styles.setupHead}>
        <button type="button" className={styles.backButton} data-testid="prophet-sector-setup-back" onClick={onBack}>
          ← {t("setupBack")}
        </button>
        <h3 className={styles.setupTitle}>{prophetSectorFill(t("setupTitle"), { symbol: payload.symbol })}</h3>
        {member?.name ? <span className={styles.setupName}>{member.name}</span> : null}
      </header>

      {group !== null && member !== null ? (
        <p className={styles.setupMembership} data-testid="prophet-sector-setup-membership">
          {prophetSectorFill(t("setupMemberSince"), { group: localGroupName, date: member.memberSince ?? "—" })}
          {payload.memberOf.length > 1 ? ` · ${prophetSectorFill(t("setupInGroups"), { n: payload.memberOf.length })}` : ""}
        </p>
      ) : null}

      {prophet.state === "open_plan" || prophet.state === "resolved_plan" ? (
        <div className={styles.setupPlan}>
          <h4 className={styles.setupSectionTitle}>{t("setupPlanHeading")}</h4>
          <p className={styles.reportedLine}>{t("setupReported")}</p>
          {boardPhase === "loading" ? <p className={styles.emptyCopy}>{t("loading")}</p>
            : boardPhase === "unavailable" ? <p className={styles.emptyCopy}>{t("retry")}</p>
            : boardPlan !== null ? (
              // The board's own panel, selected by the contract's exact plan id.
              <AnalysisPanel plan={boardPlan as never} lang={lang} t={prophetT} />
            ) : (
              <p className={styles.emptyCopy} data-testid="prophet-sector-plan-missing">{t("setupPlanMissing")}</p>
            )}
        </div>
      ) : (
        <div className={styles.setupNoPlan}>
          <h4 className={styles.setupSectionTitle}>
            {prophetSectorFill(t("setupNoPlanHeading"), { symbol: payload.symbol })}
          </h4>
          {group !== null ? (
            <div className={styles.setupGroupBlock}>
              <h5 className={styles.setupSubTitle}>{prophetSectorFill(t("setupGroupDoing"), { group: localGroupName })}</h5>
              <p className={styles.setupGroupStats}>
                {group.context.groupReturnPct !== null
                  ? `${group.context.groupReturnPct > 0 ? "+" : ""}${group.context.groupReturnPct.toFixed(1)}%`
                  : "—"}
                {" · "}
                {group.context.marketReturnPct !== null
                  ? `${group.context.marketReturnPct > 0 ? "+" : ""}${group.context.marketReturnPct.toFixed(1)}%`
                  : "—"}
              </p>
            </div>
          ) : null}
          <div className={styles.setupWhy}>
            <h5 className={styles.setupSubTitle}>{t("setupWhyNoPlan")}</h5>
            <p>{t(prophetReasonKey(prophet.reason))}</p>
          </div>
          {prophet.observation !== null ? (
            <p className={styles.setupObservation} data-testid="prophet-sector-setup-observation">
              {prophetSectorFill(t("setupObservation"), { asof: prophet.observation.asof })}
            </p>
          ) : null}
          {chartHref !== null ? (
            <a className={styles.chartLink} data-testid="prophet-sector-chart-link" href={chartHref}>
              {prophetSectorFill(t("setupChartLink"), { symbol: payload.symbol })} ↗
            </a>
          ) : null}
          <p className={styles.reportedLine}>{t("setupReported")}</p>
        </div>
      )}
    </section>
  );
}
