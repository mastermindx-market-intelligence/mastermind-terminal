"use client";

import { LEX } from "@/lib/i18n";
import { sectorPaperText } from "@/lib/sectorPaperCopy";

import { useMemo, type ReactNode } from "react";
import { formatValue, type FeedMap, type MeasuredGroup } from "@/lib/sectorIntelligence";
import { PAPER_SECTOR_LENSES, PAPER_SECTOR_ROUTES, paperSectorBrief, paperLeadershipHistory, qualifyPaperReturnSeries,
  type BriefState, type PaperSectorLens, type PaperSectorRoute } from "@/lib/sectorPaper";
import PaperSectorReturnChart, { PaperSectorLeadershipChart } from "./PaperSectorReturnChart";
import styles from "./PaperSectorWorkspace.module.css";

type Lang = "en" | "zh";
export interface PaperSectorWorkspaceProps {
  lang: Lang;
  theme: "dark" | "light";
  feeds: FeedMap;
  route: PaperSectorRoute;
  lens: PaperSectorLens;
  onRoute: (route: PaperSectorRoute, lens?: PaperSectorLens) => void;
  onLens: (lens: PaperSectorLens) => void;
  onInspect: (groupId: string) => void;
  onSources: (opener: HTMLButtonElement) => void;
  onRefresh: () => void;
  onTurns: () => void;
  /** A separately qualified common-start total-return series; never native rotation history. */
  returnSeries?: unknown;
  controls?: ReactNode;
  filters?: ReactNode;
  explore?: ReactNode;
  inspector?: ReactNode;
  dossier?: ReactNode;
  research?: ReactNode;
  watches?: ReactNode;
  savedViews?: ReactNode;
  entryAction?: ReactNode;
  children?: ReactNode;
}
const names: Record<PaperSectorRoute, [string, string]> = {
  brief: LEX.siPaperBrief, explore: LEX.siPaperExplore,
  research: LEX.research, watches: LEX.siPaperMyWatches,
};
const lensNames: Record<PaperSectorLens, [string, string]> = {
  rotation: LEX.siPaperRotation, "market-map": LEX.siPaperMarketMap,
  breadth: LEX.siPaperBreadth, confluence: LEX.siPaperConfluence,
  themes: LEX.siPaperThemesOverlap,
};
const groupName = (row: MeasuredGroup, lang: Lang) => (lang === "zh" ? row.nameZh : row.nameEn) || row.nameEn || row.groupId;
const unmeasuredReason = (row: MeasuredGroup, lang: Lang): string => {
  const reasons: Record<string, [string,string]> = {
    missing_input: LEX.siPaperMissingSourceInput,
    thin_history: LEX.siPaperInsufficientHistory,
  };
  return row.reasonCode && reasons[row.reasonCode] ? reasons[row.reasonCode][lang === "zh" ? 1 : 0]
    : row.reasonCode ? (sectorPaperText(lang, "siPaperOtherSourceReason")) + row.reasonCode
    : sectorPaperText(lang, "siPaperNoReasonSuppliedByTheSource");
};
const statusCopy: Record<Exclude<BriefState, "ready">, [string, string, string, string]> = {
  loading: [LEX.siPaperPreparingTheSectorRead[0], LEX.siPaperTheCurrentSourceSnapshotIsLoading[0], LEX.siPaperPreparingTheSectorRead[1], LEX.siPaperTheCurrentSourceSnapshotIsLoading[1]],
  access: [LEX.siPaperSectorEvidenceNeedsAccess[0], LEX.siPaperTheSourceIsNotAvailableToThisAccountReview[0], LEX.siPaperSectorEvidenceNeedsAccess[1], LEX.siPaperTheSourceIsNotAvailableToThisAccountReview[1]],
  error: [LEX.siPaperTheSectorSourceDidNotRespond[0], LEX.siPaperRefreshToRetryAFailedRequestIsNotAn[0], LEX.siPaperTheSectorSourceDidNotRespond[1], LEX.siPaperRefreshToRetryAFailedRequestIsNotAn[1]],
  unavailable: [LEX.siPaperTheMeasuredReadIsUnavailable[0], LEX.siPaperExploreTheOtherAvailableSourcesWhileThisMeasurementIs[0], LEX.siPaperTheMeasuredReadIsUnavailable[1], LEX.siPaperExploreTheOtherAvailableSourcesWhileThisMeasurementIs[1]],
  invalid: [LEX.siPaperTheSectorReadNeedsASourceCheck[0], LEX.siPaperTheSnapshotDoesNotProvideAConsistentMeasurementAnd[0], LEX.siPaperTheSectorReadNeedsASourceCheck[1], LEX.siPaperTheSnapshotDoesNotProvideAConsistentMeasurementAnd[1]],
};

/** Controlled native presentation. The existing workspace owns access, fetching, URLs and actions. */
export default function PaperSectorWorkspace(props: PaperSectorWorkspaceProps) {
  const { lang, theme, feeds, route, lens, onRoute, onLens, onInspect, onSources, onRefresh, onTurns } = props;
  const zh = lang === "zh";
  const say = (key: string, ...values: Array<string | number>) => sectorPaperText(lang, key, ...values);
  const model = useMemo(() => paperSectorBrief(feeds), [feeds]);
  const history = useMemo(() => qualifyPaperReturnSeries(props.returnSeries), [props.returnSeries]);
  const leader = model.leader;
  const leadershipHistory = useMemo(() => model.leader && model.asOf && model.benchmark
    ? paperLeadershipHistory(feeds, model.leader.groupId, model.asOf, model.benchmark) : null, [feeds, model]);
  const compatibleHistory = history && leader && history.groupId === leader.groupId
    && history.benchmark === model.benchmark && history.endSession === model.asOf ? history : null;
  const sourceButton = (label = say("siPaperReviewSources")) =>
    <button type="button" className={styles.textButton} onClick={event => onSources(event.currentTarget)}>{label} →</button>;
  const coverage = model.expected === null || model.measured === null ? null :
    <div className={styles.coverage} data-testid="paper-sector-coverage">
      <div><p>{say("siPaperMeasuredSectors")} <strong>{model.measured} / {model.expected}</strong></p>
        <small>{model.partial
          ? say("siPaperUnmeasuredGroupsStayVisibleAndAreExcludedFromThe")
          : say("siPaperCoverageAppliesToThisSectorMeasurementOnly")}</small>
        {model.unmeasured.length > 0 && <ul className={styles.unmeasured} aria-label={say("siPaperUnmeasuredSectors")}>{model.unmeasured.map(row => <li key={row.groupId}><strong>{groupName(row, lang)}</strong><span>{unmeasuredReason(row, lang)}</span></li>)}</ul>}</div>
      {sourceButton()}
    </div>;

  return <div className={styles.root} data-theme={theme} data-testid="sector-paper-workspace" data-paper-route={route} data-paper-lens={lens}>
    <div className={styles.page}>
      <header className={styles.heading}>
        <div className={styles.identity}><h1>{say("siPaperSectorIntelligence")}</h1><span className={styles.market}>{say("siPaperUSEquities")}</span></div>
        <div className={styles.utilities}>
          <span className={styles.snapshot}>{model.asOf ? say("siPaperSectorSnapshot") + " · " + model.asOf : say("siPaperSnapshotPending")}</span>
          {props.controls}
          <button type="button" className={styles.neutralButton} onClick={onRefresh} aria-label={say("admRefresh")} title={say("admRefresh")}><span className={styles.refreshText}>{say("admRefresh")}</span><svg className={styles.refreshIcon} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.3 6.3A8 8 0 0 1 20 12M4 12a8 8 0 0 0 13.7 5.7"/></svg></button>
        </div>
      </header>
      <nav className={styles.navigation} aria-label={say("siPaperSectorIntelligence")}>
        <div className={styles.navItems}>{PAPER_SECTOR_ROUTES.map(item => <button key={item} type="button"
          aria-current={route === item ? "page" : undefined} onClick={() => onRoute(item)}>{names[item][zh ? 1 : 0]}</button>)}</div>
        <span className={styles.navigationNote}>{say("siPaperFromTheMarketReadToTheCompanyEvidence")}</span>
      </nav>

      {route === "brief" && <>
        {model.stale && <div className={styles.stale} role="status"><p>{say("siPaperThisSectorSnapshotIsDelayedOtherMeasuresKeepTheir")}</p>{sourceButton()}</div>}
        {model.state !== "ready" ? <section className={styles.emptyState} aria-live="polite">
          <h2>{statusCopy[model.state][zh ? 2 : 0]}</h2><p>{statusCopy[model.state][zh ? 3 : 1]}</p>
          <div className={styles.statusActions}>{sourceButton()}<button type="button" className={styles.textButton} onClick={() => onRoute("explore")}>{say("siPaperOpenExplore")} →</button></div>
        </section> : <div className={styles.brief}>
          <section className={styles.hero} aria-labelledby="sector-brief-heading">
            <div className={styles.heroCopy}>
              <p className={styles.kicker}>{say("siPaperTheSectorRead")}</p>
              <h2 id="sector-brief-heading">{leader
                ? say("siPaperLeadsTheMeasuredSectorRanking", groupName(leader, lang))
                : say("siPaperNoSectorsHaveAQualifiedMeasurement")}</h2>
              <p className={styles.summary}>{leader
                ? say("siPaperStartWithTheSourceSStrongestMeasuredGroupThen")
                : say("siPaperTheSourceReportsItsPopulationButNoGroupCan")}</p>
              <div className={styles.heroActions}>
                {leader && <button type="button" className={styles.primaryButton} data-sector-return-focus="paper-brief-inspect" onClick={event => { event.currentTarget.focus({ preventScroll: true }); onInspect(leader.groupId); }}>{say("siPaperInspect")}{groupName(leader, lang)} →</button>}
                <button type="button" className={styles.textButton} onClick={onTurns}>{say("siPaperWhatChanged")} →</button>
              </div>
            </div>
            <aside className={styles.distinction}>
              <p className={styles.label}>{say("siPaperKeepThisDistinction")}</p>
              <h3>{say("siPaperGroupStrengthASeparateStockDecision")}</h3>
              <dl className={styles.facts}>
                <div><dt>{say("siPaperLeadership")}</dt><dd>{leader ? groupName(leader, lang) + " · #" + leader.rank + " / " + model.measured + say("siPaperMeasured") : "—"}</dd></div>
                <div><dt>{say("siPaperStockEntry")}</dt><dd>{props.entryAction || say("siPaperCheckEntrySignals")}</dd></div>
              </dl>
              <p className={styles.distinctionNote}>{say("siPaperInspectTheCompanySOwnSetupRiskAndEvidence")}</p>
            </aside>
          </section>

          <div className={styles.evidenceRow}>
            <section className={styles.evidence} aria-labelledby="sector-brief-evidence">
              <div className={styles.sectionHeading}><h3 id="sector-brief-evidence">{compatibleHistory
                ? say("siPaperHowTheLeaderReachedThisPoint") : leadershipHistory ? say("siPaperTheLeadershipBehindTheRead") : say("siPaperTheMeasuredLeadership")}</h3>
                <button type="button" className={styles.textButton} onClick={() => onRoute("explore", "rotation")}>{say("siPaperExploreRotation")} →</button></div>
              {compatibleHistory && leader ? <PaperSectorReturnChart series={compatibleHistory} groupName={groupName(leader, lang)} lang={lang} /> : leadershipHistory && leader ? <PaperSectorLeadershipChart series={leadershipHistory} groupName={groupName(leader, lang)} lang={lang} /> :
                <><div className={styles.tableWrap}><table className={styles.table}>
                  <caption className={styles.label}>{say("siPaperChangeInSectorBenchmarkRelativeWealth")}</caption>
                  <thead><tr><th scope="col">{say("siPaperSectorSourceRank")}</th><th scope="col">{say("siPaper21Sessions")}</th><th scope="col">{say("siPaper63Sessions")}</th></tr></thead>
                  <tbody>{model.priorities.map(row => <tr key={row.groupId}><th scope="row"><button type="button" data-sector-return-focus={"paper-measured-" + row.groupId} onClick={event => { event.currentTarget.focus({ preventScroll: true }); onInspect(row.groupId); }}>{row.rank}. {groupName(row, lang)}</button></th>
                    <td>{formatValue(row.rs21d, 2, "%", true)}</td><td>{formatValue(row.rs63d, 2, "%", true)}</td></tr>)}</tbody>
                </table></div>
                <p className={styles.chartNote}>{say("siPaperCommonStartTotalReturnHistoryIsNotAvailableFor")}</p></>}
              {coverage}
            </section>
            <section className={styles.priorities} aria-labelledby="sector-brief-priorities">
              <div className={styles.sectionHeading}><h3 id="sector-brief-priorities">{say("siPaperThreePlacesToInvestigate")}</h3></div>
              <ol>{model.priorities.map((row, index) => <li key={row.groupId} className={styles.priority}>
                <span className={styles.priorityNumber}>{String(index + 1).padStart(2, "0")}</span><div className={styles.priorityCopy}>
                  <p className={styles.label}>{say("siPaperSourceRank")} {row.rank}</p>
                  <button type="button" className={styles.priorityTitle} data-sector-return-focus={"paper-priority-" + row.groupId} onClick={event => { event.currentTarget.focus({ preventScroll: true }); onInspect(row.groupId); }}>{groupName(row, lang)} ↗</button>
                  <p>{say("siPaperInspectParticipationCycleStateAndTheUnderlyingCompanies")}</p>
                </div></li>)}</ol>
              {model.priorities.length === 0 && <p className={styles.emptyState}>{say("siPaperNoMeasuredPriorityIsAvailable")}</p>}
            </section>
          </div>
          <div className={styles.deeper}><strong>{say("siPaperGoDeeper")}</strong>
            <button type="button" className={styles.textButton} onClick={() => onRoute("explore", "market-map")}>{say("siPaperExploreTheMarketMap")} →</button>
            <button type="button" className={styles.textButton} onClick={() => onRoute("research")}>{say("siPaperConnectTheEvidenceInResearch")} →</button>
            {sourceButton()}
          </div>
        </div>}
      </>}

      {route === "explore" && (props.dossier || <>
        <div className={styles.exploreHeading}><div><h2>{lens === "rotation" ? say("siPaperFollowTheMeasuredRotation") : say("siPaperFollowTheEvidence")}</h2><p>{lens === "rotation" ? say("siPaperInspectRelativePerformanceParticipationAndTheSourceSRecorded") : say("siPaperKeepTheSelectedGroupInViewAsYouMove")}</p></div><div className={styles.filters}><span className={styles.scope}>{say("siPaperUSEquities")}</span>{model.state === "ready" && <span className={styles.scope}>{model.measured} / {model.expected} {say("siPaperMeasured2")}</span>}{lens === "rotation" && <span className={styles.scope}>{say("siPaperNative63D21D")}</span>}{props.filters}</div></div>
        <nav className={styles.lensNav} aria-label={say("siPaperExploreViews")}><div className={styles.lensItems}>{PAPER_SECTOR_LENSES.map(item =>
          <button type="button" key={item} aria-current={lens === item ? "page" : undefined} onClick={() => onLens(item)}>{lensNames[item][zh ? 1 : 0]}</button>)}</div>{props.savedViews || (lens === "rotation" && <span className={styles.lensBasis}>{say("siPaperSPYTotalReturnBasisRelativeWealth")}</span>)}</nav>
        {props.inspector ? <div className={styles.instrumentGrid}><div className={styles.instrument}>{props.explore}</div><aside className={styles.inspector}>{props.inspector}</aside></div>
          : <div className={styles.instrument}>{props.explore || <section className={styles.emptyState}><h3>{say("siPaperThisViewIsNotConnected")}</h3><p>{say("siPaperTheSelectedSourceAndItsAvailabilityWillAppearHere")}</p>{sourceButton()}</section>}</div>}
      </>)}
      {route === "research" && (props.research || <section className={styles.emptyState}><h2>{say("siPaperConnectedResearch")}</h2><p>{say("siPaperCarryTheSelectedGroupAndItsSourceEvidenceInto")}</p>{sourceButton()}</section>)}
      {route === "watches" && (props.watches || <section className={styles.emptyState}><h2>{say("siPaperMyWatches")}</h2><p>{say("siPaperYourSharedWatchesWillAppearHereWhenThatCapability")}</p></section>)}
      {props.children}
      <footer className={styles.footer}><span>{say("siPaperSectorStrengthParticipationAndStockEntryRetainSeparateEvidence")}</span>{sourceButton()}</footer>
    </div>
  </div>;
}
