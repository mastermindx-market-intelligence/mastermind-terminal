"use client";
/**
 * MemberSetup (SX03 → company case) — the company case behind a population
 * row, restructured per Lane C: a verdict-first header with Setup / Evidence /
 * Context / History tabs, never an entry/stop/target lead.
 *
 * Laws:
 *   - The header orients in 3–4 seconds: company, served Prophet state in
 *     plain words, two labeled clocks, and the honest not-produced verdict.
 *   - Entry/stop/targets render only inside the read-only "Model plan" rail
 *     (Lane D's GeometryRail, imported unedited), labeled reported.
 *   - Unserved fields (verdict, supports/challenges, next check, name leg of
 *     the decomposition, peer snapshot, fundamentals, history) render their
 *     designed unavailable states — nothing is invented.
 *   - The member's group/market returns stay labeled (G10); the reason a plan
 *     is absent stays translated through the sector lane's closed map.
 *   - Tab choice is local view state; a URL key belongs to the url-state
 *     owner (Lane A) and is not minted here.
 */
import { useEffect, useState } from "react";
import { flowGet } from "@/lib/flowClientCache";
import { useLang } from "@/lib/i18n";
import type { SectorMembersPayload } from "@/lib/prophetSectorMembers";
import { companyHref } from "@/lib/sectorIntelligence";
import { CaseHeader } from "../setup/CaseHeader";
import { CaseTabs, type CaseTab } from "../setup/CaseTabs";
import { ContextTab } from "../setup/ContextTab";
import { EntryCheckRail, type BoardPlanRow } from "../setup/EntryCheckRail";
import { EvidenceTab } from "../setup/EvidenceTab";
import { HistoryTab } from "../setup/HistoryTab";
import { ObservationCard } from "../setup/ObservationCard";
import { StudyCard } from "../setup/StudyCard";
import { SupportsChallenges } from "../setup/SupportsChallenges";
import { makeSetupT } from "../setup/setupStrings";
import caseStyles from "../setup/setup.module.css";
import {
  makeProphetSectorT, prophetReasonKey, prophetSectorFill,
} from "./prophetSectorStrings";
import styles from "./prophetSector.module.css";

interface BoardPayloadLike { plans?: BoardPlanRow[] }

export function MemberSetup({ payload, onBack, originGroupId }: {
  payload: Extract<SectorMembersPayload, { mode: "symbol" }>;
  onBack: () => void;
  /** The population group the reader arrived from: a multi-group symbol
   * (CARR sits in Housing AND Industrials) shows THIS group's membership,
   * falling back to the first only when the origin is not among them. */
  originGroupId: string | null;
}) {
  const { lang } = useLang();
  const t = makeProphetSectorT(lang);
  const setupT = makeSetupT(lang);
  const [tab, setTab] = useState<CaseTab>("setup");
  const [boardPlan, setBoardPlan] = useState<BoardPlanRow | null>(null);
  const [boardPhase, setBoardPhase] = useState<"loading" | "ready" | "unavailable" | "idle">("idle");

  const membership = payload.memberOf.find(entry => entry.group.id === originGroupId)
    ?? payload.memberOf[0] ?? null;
  const group = membership?.group ?? null;
  const member = membership?.member ?? null;
  const prophet = payload.prophet;
  const planId = prophet.plan?.id ?? null;
  const chartHref = companyHref(payload.symbol);
  const assessmentAsof = prophet.observation?.asof ?? prophet.plan?.openedOn ?? null;

  // The board read runs only for members whose join carries a plan id; the
  // no-plan case never touches the board (the rail shows its none state).
  useEffect(() => {
    if (planId === null) return;
    let cancelled = false;
    void (async () => {
      setBoardPhase("loading");
      try {
        const data = await flowGet("prophet_idx") as BoardPayloadLike | null;
        if (cancelled) return;
        setBoardPlan(data?.plans?.find(plan => plan.id === planId) ?? null);
        setBoardPhase("ready");
      } catch {
        if (!cancelled) setBoardPhase("unavailable");
      }
    })();
    return () => { cancelled = true; };
  }, [planId]);

  return (
    <section className={styles.setup} data-testid="prophet-sector-setup">
      <CaseHeader
        symbol={payload.symbol}
        name={member?.name ?? null}
        prophet={prophet}
        assessmentAsof={assessmentAsof}
        windowSessions={group?.context.windowSessions ?? null}
        groupCount={payload.memberOf.length}
        onBack={onBack}
        backLabel={t("setupBack")}
        lang={lang}
      />

      <CaseTabs tab={tab} onTab={setTab} lang={lang} />

      <div className={caseStyles.caseBody}>
        {tab === "setup" ? (
          <div className={caseStyles.caseMain} role="tabpanel" id="case-panel-setup" aria-labelledby="case-tab-setup" data-testid="setup-tab">
            {group !== null && member !== null ? (
              <p className={styles.setupMembership} data-testid="prophet-sector-setup-membership">
                {/* Two different clocks, both labeled (A2-1): first_known is a
                    lower bound from stored snapshots; member_since is the
                    roster's own effective date — never merged. */}
                {prophetSectorFill(t("setupMemberSince"), { date: member.firstKnown ?? "—" })}
                {member.memberSince !== null ? ` · ${prophetSectorFill(t("setupRosterSince"), { date: member.memberSince })}` : ""}
                {payload.memberOf.length > 1 ? ` · ${prophetSectorFill(t("setupInGroups"), { n: payload.memberOf.length })}` : ""}
              </p>
            ) : null}

            {group !== null ? <StudyCard symbol={payload.symbol} group={group} lang={lang} /> : null}

            {prophet.state === "early_observation" || prophet.observation !== null ? (
              <ObservationCard symbol={payload.symbol} observationAsof={prophet.observation?.asof ?? null} />
            ) : null}

            <SupportsChallenges lang={lang} />

            {prophet.state === "none" ? (
              <section className={styles.setupWhy}>
                <h5 className={styles.setupSubTitle}>{t("setupWhyNoPlan")}</h5>
                <p>{t(prophetReasonKey(prophet.reason))}</p>
              </section>
            ) : null}
            {prophet.state === "unavailable" ? (
              <section className={styles.setupWhy} data-testid="state-unknown">
                <h5 className={styles.setupSubTitle}>{setupT("stateUnknown")}</h5>
                <p>{setupT("stateUnknownBody")}</p>
              </section>
            ) : null}

            {chartHref !== null ? (
              <a className={styles.chartLink} data-testid="prophet-sector-chart-link" href={chartHref}>
                {prophetSectorFill(t("setupChartLink"), { symbol: payload.symbol })} ↗
              </a>
            ) : null}
            <p className={styles.reportedLine}>{t("setupReported")}</p>
          </div>
        ) : null}

        {tab === "evidence" ? (
          <EvidenceTab symbol={payload.symbol} showObservation={prophet.state === "early_observation" || prophet.observation !== null} />
        ) : null}
        {tab === "context" ? <ContextTab payload={payload} lang={lang} /> : null}
        {tab === "history" ? <HistoryTab /> : null}

        <EntryCheckRail
          symbol={payload.symbol}
          planId={planId}
          boardPhase={boardPhase}
          boardPlan={boardPlan}
          lang={lang}
        />
      </div>
    </section>
  );
}
