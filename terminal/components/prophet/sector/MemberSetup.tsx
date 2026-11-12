"use client";
/**
 * MemberSetup (SX03 → company case) — the company case behind a population
 * row, restructured per Lane C: a verdict-first header with Setup / Evidence /
 * Context tabs, never an entry/stop/target lead. History has no Paper design
 * (census G14) and is deliberately absent until one exists (principal ruling,
 * 2026-11-12: no build work before design).
 *
 * Laws:
 *   - The header orients in 3–4 seconds: company, served Prophet state in
 *     plain words, two labeled clocks, and the honest not-produced verdict.
 *   - Entry/stop/targets render only inside the read-only "Model plan" rail
 *     (Lane D's GeometryRail, imported unedited), labeled reported.
 *   - Unserved fields (verdict, supports/challenges, next check, name leg of
 *     the decomposition, peer snapshot, fundamentals) render their designed
 *     unavailable states — nothing is invented.
 *   - The board read keeps its outcome (flowGetResult): only status "data"
 *     reaches the ready phase; a read that did not land is status unknown
 *     with a retry, never a false "not in the current board read" (fix order
 *     item 1).
 *   - The member's group/market returns stay labeled (G10); the reason a plan
 *     is absent stays translated through the sector lane's closed map.
 *   - Tab choice is local view state; a URL key belongs to the url-state
 *     owner (Lane A) and is not minted here.
 */
import { useEffect, useState } from "react";
import { flowGetResult } from "@/lib/flowClientCache";
import { useLang } from "@/lib/i18n";
import type { SectorMembersPayload } from "@/lib/prophetSectorMembers";
import { companyHref } from "@/lib/sectorIntelligence";
import { CaseHeader } from "../setup/CaseHeader";
import { CaseTabs, type CaseTab } from "../setup/CaseTabs";
import { ContextTab } from "../setup/ContextTab";
import { EntryCheckRail, type BoardPlanRow } from "../setup/EntryCheckRail";
import { EvidenceTab } from "../setup/EvidenceTab";
import { ObservationCard } from "../setup/ObservationCard";
import { SourcesSheet } from "../setup/SourcesSheet";
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
  const [boardAttempt, setBoardAttempt] = useState(0);
  const [backHref, setBackHref] = useState<string | null>(null);

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
  // flowGetResult keeps the read's outcome: an unavailable/absent outcome is
  // a failed read, not a published absence (fix order item 1). A retry
  // increments the attempt, which re-runs the read with refresh — a retry
  // must be able to fail again.
  useEffect(() => {
    if (planId === null) return;
    let cancelled = false;
    void (async () => {
      setBoardPhase("loading");
      const outcome = await flowGetResult("prophet_idx", { refresh: boardAttempt > 0 });
      if (cancelled) return;
      if (outcome.status === "data") {
        const board = outcome.data as BoardPayloadLike | null;
        setBoardPlan(board?.plans?.find(plan => plan.id === planId) ?? null);
        setBoardPhase("ready");
      } else {
        setBoardPlan(null);
        setBoardPhase("unavailable");
      }
    })();
    return () => { cancelled = true; };
  }, [planId, boardAttempt]);

  // "Back to population" is a real link once hydrated: the population URL
  // keeps prophetSymbol (and group/plan), so the row the reader came from
  // keeps its identity (fix order item 10 — what the population does with it
  // is that surface's own order). Before hydration the onBack button holds
  // the sector lane's original contract; the swap happens in a frame callback
  // so the first client render still matches the server markup.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const url = new URL(window.location.href);
      url.searchParams.set("prophetView", "population");
      setBackHref(`${url.pathname}${url.search}${url.hash}`);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const signalFromBoard = boardPlan !== null && typeof boardPlan._signal_date === "string" && boardPlan._signal_date.length > 0
    ? boardPlan._signal_date
    : null;
  const planSignalDate = signalFromBoard ?? prophet.plan?.openedOn ?? null;

  return (
    <section className={`${styles.setup} ${caseStyles.caseSurface}`} data-testid="prophet-sector-setup">
      <CaseHeader
        symbol={payload.symbol}
        name={member?.name ?? null}
        prophet={prophet}
        assessmentAsof={assessmentAsof}
        windowSessions={group?.context.windowSessions ?? null}
        groupCount={payload.memberOf.length}
        onBack={onBack}
        backHref={backHref}
        backLabel={t("setupBack")}
        lang={lang}
      />

      {/* T2-12 order (fix order item 6): at phone widths the entry state is
          met immediately under the header, before the deep content. */}
      <p className={caseStyles.entryBanner} data-testid="case-entry-banner">
        {setupT(planId !== null ? "entryBannerReported" : "entryBannerNone")}
      </p>

      <CaseTabs tab={tab} onTab={setTab} lang={lang} />

      <div className={caseStyles.caseBody}>
        {tab === "setup" ? (
          <div className={caseStyles.caseMain} role="tabpanel" id="case-panel-setup" aria-labelledby="case-tab-setup" data-testid="setup-tab">
            {group !== null && member !== null ? (
              <p className={styles.setupMembership} data-testid="prophet-sector-setup-membership">
                {/* Two different clocks, both labeled (A2-1): first_known is a
                    lower bound from stored snapshots; member_since is the
                    roster's own effective date — never merged. This dated line
                    lives HERE only (fix order item 15). */}
                {prophetSectorFill(t("setupMemberSince"), { date: member.firstKnown ?? "—" })}
                {member.memberSince !== null ? ` · ${prophetSectorFill(t("setupRosterSince"), { date: member.memberSince })}` : ""}
                {payload.memberOf.length > 1 ? ` · ${prophetSectorFill(t("setupInGroups"), { n: payload.memberOf.length })}` : ""}
              </p>
            ) : null}

            {group !== null ? <StudyCard symbol={payload.symbol} group={group} lang={lang} /> : null}

            {prophet.state === "early_observation" || prophet.observation !== null ? (
              <ObservationCard symbol={payload.symbol} observationAsof={prophet.observation?.asof ?? null} />
            ) : null}

            <SupportsChallenges symbol={payload.symbol} chartHref={chartHref} lang={lang} />

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

            <SourcesSheet
              rosterDate={member?.memberSince ?? member?.firstKnown ?? null}
              planSignalDate={planSignalDate}
              planReadFailed={boardPhase === "unavailable"}
              observationAsof={prophet.observation?.asof ?? null}
              lang={lang}
            />
          </div>
        ) : null}

        {tab === "evidence" ? (
          <EvidenceTab symbol={payload.symbol} showObservation={prophet.state === "early_observation" || prophet.observation !== null} />
        ) : null}
        {tab === "context" ? <ContextTab payload={payload} lang={lang} /> : null}

        {/* The rail takes one shape per destination (items 5/7/8); Context
            drops it entirely. */}
        <EntryCheckRail
          symbol={payload.symbol}
          tab={tab}
          planId={planId}
          boardPhase={boardPhase}
          boardPlan={boardPlan}
          onRetryBoard={() => setBoardAttempt(attempt => attempt + 1)}
          lang={lang}
        />
      </div>
    </section>
  );
}
