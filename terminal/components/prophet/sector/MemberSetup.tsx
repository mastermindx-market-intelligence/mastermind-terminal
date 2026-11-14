"use client";
/**
 * MemberSetup (SX03 → company case) — the company case behind a population
 * row, on the T2-C5 case-unpublished design: an arrival breadcrumb, the
 * company, the honest headline, ONE card for what is unavailable, the served
 * study, and "You can still study" as the exit list. Setup / Evidence /
 * Context stay as parallel destinations, but each now holds only what is
 * actually published. History has no Paper design (census G14) and is
 * deliberately absent until one exists (principal ruling, 2026-11-12).
 *
 * Laws:
 *   - No trade ticket anywhere on this surface (P0-1). The model plan is one
 *     closed row that links to Plans, which owns entry/stop/targets.
 *   - What is missing is said once, in reader words (P1-2, P1-3, P1-5).
 *   - The plan read keeps its outcome (flowGetResult): only status "data"
 *     reaches the ready phase; a read that did not land is status unknown
 *     with a retry, never a false "not in the current board read".
 *   - The return keeps the selection: the breadcrumb and the bottom button
 *     both carry prophetSymbol (P1-7).
 *   - Tab choice is local view state; a URL key belongs to the url-state
 *     owner (Lane A) and is not minted here.
 */
import { useEffect, useRef, useState } from "react";
import { flowGetResult } from "@/lib/flowClientCache";
import { useLang } from "@/lib/i18n";
import type { SectorMembersPayload } from "@/lib/prophetSectorMembers";
import { DEFAULT_PROPHET_STATE, prophetHref } from "@/lib/prophetUrlState";
import { companyHref } from "@/lib/sectorIntelligence";
import { CaseHeader, handleCaseBackClick } from "../setup/CaseHeader";
import { CaseTabs, type CaseTab } from "../setup/CaseTabs";
import { CaseUnavailable, StudyLinks } from "../setup/CaseUnavailable";
import { ContextTab } from "../setup/ContextTab";
import { EvidenceTab } from "../setup/EvidenceTab";
import { ModelPlanRail } from "../setup/ModelPlanRail";
import { SourcesSheet } from "../setup/SourcesSheet";
import { RotationRead } from "../setup/RotationRead";
import { StudyCard } from "../setup/StudyCard";
import { makeSetupT } from "../setup/setupStrings";
import caseStyles from "../setup/setup.module.css";
import { makeProphetSectorT, prophetReasonKey, prophetSectorFill } from "./prophetSectorStrings";
import styles from "./prophetSector.module.css";

interface BoardPayloadLike { plans?: { id: string }[] }

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
  const [boardPhase, setBoardPhase] = useState<"loading" | "ready" | "missing" | "unavailable" | "idle">("idle");
  const [boardAttempt, setBoardAttempt] = useState(0);
  const [backHref, setBackHref] = useState<string | null>(null);
  const sourcesRef = useRef<HTMLDivElement | null>(null);

  const membership = payload.memberOf.find(entry => entry.group.id === originGroupId)
    ?? payload.memberOf[0] ?? null;
  const group = membership?.group ?? null;
  const member = membership?.member ?? null;
  const prophet = payload.prophet;
  const planId = prophet.plan?.id ?? null;
  const chartHref = companyHref(payload.symbol);
  const groupName = group === null ? null
    : lang === "zh" ? (group.nameZh || group.name || group.id) : (group.name || group.id);
  const observedAsof = prophet.observation?.asof ?? null;
  // The Plans destination (macro lane) with this plan selected — it owns the
  // trade geometry this surface deliberately does not show. The legacy mount
  // is the SSR-safe shape; the mount effect adopts the reader's own mount.
  const [plansHref, setPlansHref] = useState<string>(
    prophetHref({ ...DEFAULT_PROPHET_STATE, lane: "plans", plan: planId }, "legacy"));

  // The plan read runs only for members whose join carries a plan id; the
  // no-plan case never touches the board. flowGetResult keeps the read's
  // outcome: an unavailable/absent outcome is a failed read, not a published
  // absence (fix order item 1). A retry increments the attempt, which re-runs
  // the read with refresh — a retry must be able to fail again.
  useEffect(() => {
    if (planId === null) return;
    let cancelled = false;
    void (async () => {
      setBoardPhase("loading");
      const outcome = await flowGetResult("prophet_idx", { refresh: boardAttempt > 0 });
      if (cancelled) return;
      if (outcome.status === "data") {
        const board = outcome.data as BoardPayloadLike | null;
        const found = board?.plans?.some(plan => plan.id === planId) ?? false;
        setBoardPhase(found ? "ready" : "missing");
      } else {
        setBoardPhase("unavailable");
      }
    })();
    return () => { cancelled = true; };
  }, [planId, boardAttempt]);

  // The return and the Plans link are real hrefs once hydrated: the
  // population URL keeps prophetSymbol (and group/plan), so the row the
  // reader came from keeps its identity; the Plans link opens on this plan.
  // Before hydration the onBack button holds the sector lane's original
  // contract; the swap happens in a frame callback so the first client render
  // still matches the server markup.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const url = new URL(window.location.href);
      url.searchParams.set("prophetView", "population");
      setBackHref(`${url.pathname}${url.search}${url.hash}`);
      const mount = url.pathname.startsWith("/prophet") ? "canonical" : "legacy";
      setPlansHref(prophetHref({ ...DEFAULT_PROPHET_STATE, lane: "plans", plan: planId }, mount));
    });
    return () => cancelAnimationFrame(frame);
  }, [planId]);

  return (
    <section className={`${styles.setup} ${caseStyles.caseSurface}`} data-testid="prophet-sector-setup">
      <CaseHeader
        symbol={payload.symbol}
        name={member?.name ?? null}
        prophet={prophet}
        groupName={groupName}
        onBack={onBack}
        backHref={backHref}
        lang={lang}
      />

      <CaseTabs tab={tab} onTab={setTab} lang={lang} />
      {tab === "setup" ? <RotationRead key={payload.symbol} symbol={payload.symbol} lang={lang} /> : null}

      <div className={`${caseStyles.caseBody} ${tab === "setup" ? "" : caseStyles.caseBodySolo}`}>
        {tab === "setup" ? (
          <div className={caseStyles.caseMain} role="tabpanel" id="case-panel-setup" aria-labelledby="case-tab-setup" data-testid="setup-tab">
            {group !== null && member !== null ? (
              // Served membership dates, said once (fix order item 15): two
              // different clocks, both labeled, never merged; plural written
              // properly and no raw group ids (P1-5).
              <p className={`${caseStyles.cardIntro} ${caseStyles.membershipLine}`} data-testid="prophet-sector-setup-membership">
                {prophetSectorFill(t("setupMemberSince"), { date: member.firstKnown ?? "—" })}
                {member.memberSince !== null ? ` · ${prophetSectorFill(t("setupRosterSince"), { date: member.memberSince })}` : ""}
                {payload.memberOf.length > 1 ? ` · ${prophetSectorFill(t("setupInGroups"), { n: payload.memberOf.length })}` : ""}
              </p>
            ) : null}

            {/* T2-C5: ONE card for everything the source has not published. */}
            <CaseUnavailable symbol={payload.symbol} observedAsof={observedAsof} lang={lang} />

            {group !== null ? <StudyCard symbol={payload.symbol} group={group} lang={lang} /> : null}

            {prophet.state === "none" ? (
              <section className={styles.setupWhy} data-testid="setup-why-none">
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

            <StudyLinks
              symbol={payload.symbol}
              chartHref={chartHref}
              onTab={setTab}
              onOpenSources={() => {
                const sheet = sourcesRef.current?.querySelector("details");
                if (sheet instanceof HTMLDetailsElement) {
                  sheet.open = true;
                  sheet.scrollIntoView?.({ block: "nearest" });
                  sheet.querySelector("summary")?.focus();
                }
              }}
              lang={lang}
            />

            <div ref={sourcesRef}>
              <SourcesSheet
                rosterDate={member?.memberSince ?? member?.firstKnown ?? null}
                planSignalDate={prophet.plan?.openedOn ?? null}
                planReadFailed={boardPhase === "unavailable"}
                observationAsof={observedAsof}
                lang={lang}
              />
            </div>
          </div>
        ) : null}

        {tab === "evidence" ? (
          <EvidenceTab symbol={payload.symbol} showObservation={prophet.state === "early_observation" || prophet.observation !== null} />
        ) : null}
        {tab === "context" ? <ContextTab payload={payload} lang={lang} /> : null}

        <ModelPlanRail
          symbol={payload.symbol}
          tab={tab}
          planId={planId}
          planOpenedOn={prophet.plan?.openedOn ?? null}
          planState={prophet.state}
          plansHref={plansHref}
          boardPhase={boardPhase}
          onRetryBoard={() => setBoardAttempt(attempt => attempt + 1)}
          lang={lang}
        />
      </div>

      {/* P1-7: the long phone page needs a return at the bottom, carrying the
          same selection as the breadcrumb. */}
      {backHref !== null ? (
        <a className={caseStyles.backBottom} data-testid="prophet-sector-setup-back-bottom" href={backHref} onClick={event => handleCaseBackClick(event, onBack)}>
          ← {setupT("backToMembers")}
        </a>
      ) : (
        <button type="button" className={caseStyles.backBottom} data-testid="prophet-sector-setup-back-bottom" onClick={onBack}>
          ← {setupT("backToMembers")}
        </button>
      )}
    </section>
  );
}
