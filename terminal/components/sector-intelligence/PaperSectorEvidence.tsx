"use client";

import { LEX } from "@/lib/i18n";
import { sectorPaperText } from "@/lib/sectorPaperCopy";

import Link from "next/link";
import { companyHref, formatValue, groupRows, members, number, object, readableOwnerEnvelope, text,
  themeEntryReady, themeRows, themeStaleLegs, type FeedMap, type FeedPayload, type Row } from "@/lib/sectorIntelligence";
import type { PaperSectorLens } from "@/lib/sectorPaper";
import styles from "./PaperSectorWorkspace.module.css";

type Lang = "en" | "zh";
const count = (v: unknown) => { const n = number(v); return n !== null && Number.isInteger(n) && n >= 0 ? n : null; };
function SourceState({ feed, valid, lang, children, onSources }: {
  feed?: FeedPayload; valid: boolean; lang: Lang; children: React.ReactNode; onSources: (opener: HTMLButtonElement) => void;
}) {
  const zh = lang === "zh", status = feed?.receipt.status || "loading";
  if (status === "ready" && valid) return <>{children}</>;
  const messages = {
    loading: LEX.siPaperLoadingThisSource,
    access: LEX.siPaperThisSourceIsNotAvailableToThisAccount,
    unavailable: LEX.siPaperThisSourceIsCurrentlyUnavailable,
    error: LEX.siPaperThisSourceDidNotRespondRefreshToRetry,
    invalid: LEX.siPaperThisSourceDoesNotProvideAConsistentRecord,
    ready: LEX.siPaperThisSourceDoesNotProvideAConsistentRecord,
  };
  return <section className={styles.emptyState} role="status"><p>{messages[status][zh ? 1 : 0]}</p>
    <button type="button" className={styles.textButton} onClick={event => onSources(event.currentTarget)}>{sectorPaperText(lang, "siPaperReviewSources")} →</button></section>;
}

export function PaperSectorConfluence({ feeds, selected, onSelect, onSources, stateLabel, lang }: {
  feeds: FeedMap; selected: string; onSelect: (key: string) => void; onSources: (opener: HTMLButtonElement) => void; stateLabel: (value: unknown) => string; lang: Lang;
}) {
  const zh = lang === "zh", feed = feeds.confluence, root = object(feed?.data), rows = groupRows(feed?.data);
  const expected = Array.isArray(root.sectors) && Array.isArray(root.subsectors) ? root.sectors.length + root.subsectors.length : null;
  const valid = readableOwnerEnvelope("confluence", feed?.data) && expected === rows.length;
  const chosen = rows.find(row => row.key === selected) || rows[0], roster = chosen ? members(chosen) : [];
  const name = (row: Row) => text(zh ? row.label_zh : row.label) || text(row.label);
  return <SourceState feed={feed} valid={valid} lang={lang} onSources={onSources}>
    <div className={styles.instrumentGrid}>
      <section className={styles.instrument}><div className={styles.sectionHeading}><h3>{sectorPaperText(lang, "siPaperConfluenceGroups")}</h3><span className={styles.label}>{feed?.receipt.asOf || "—"}</span></div>
        {feed?.receipt.stale && <p className={styles.chartNote} role="status">{sectorPaperText(lang, "siPaperThisConfluenceSourceIsDelayedTheReadingsBelowRetain")}</p>}
        <p className={styles.chartNote}>{sectorPaperText(lang, "siPaperEntryTierAndRegimeRetainSeparateMeaningsOrderIs")}</p>
        <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th scope="col">{sectorPaperText(lang, "siPaperGroup")}</th><th scope="col">{sectorPaperText(lang, "siPaperEntry")}</th><th scope="col">{sectorPaperText(lang, "siPaperRegime")}</th><th scope="col">{sectorPaperText(lang, "siPaperPricedMembers")}</th></tr></thead>
          <tbody>{rows.map(row => <tr key={text(row.key)} aria-selected={chosen?.key === row.key}><th scope="row"><button type="button" data-sector-choice={text(row.key)} onClick={() => onSelect(text(row.key))}>{name(row)}</button></th>
            <td>{["T1","T2","T3"].includes(text(object(row.entry).tier)) ? text(object(row.entry).tier) : "—"}</td>
            <td>{stateLabel(object(row.regime).state)}</td><td>{formatValue(count(row.n_priced),0)} / {formatValue(count(row.n_members),0)}</td></tr>)}</tbody></table></div>
        {rows.length === 0 && <p className={styles.emptyState}>{sectorPaperText(lang, "siPaperThisSourceReportsNoGroups")}</p>}
      </section>
      <aside className={styles.inspector}><p className={styles.label}>{sectorPaperText(lang, "siPaperSelectedGroup")}</p><h3>{chosen ? name(chosen) : sectorPaperText(lang, "siPaperNoGroupSelected")}</h3>
        <p className={styles.distinctionNote}>{sectorPaperText(lang, "siPaperContinueFromGroupEvidenceToEachCompanySOwn")}</p>
        <ul className={styles.companyList}>{roster.slice(0,12).map(row => { const href=companyHref(row.ticker);return <li key={row.ticker}>{href ? <Link href={href}>{row.ticker} ↗</Link> : row.ticker}<span>{row.tier || "—"}</span></li>; })}</ul>
        {roster.length > 12 && <p className={styles.chartNote}>{sectorPaperText(lang, "siPaperFirst12SourceMembersShownTheGroupTableRetains")}</p>}
        {!roster.length && <p className={styles.emptyState}>{sectorPaperText(lang, "siPaperNoQualifiedMemberRecordsAreAvailable")}</p>}
        <button type="button" className={styles.textButton} onClick={event => onSources(event.currentTarget)}>{sectorPaperText(lang, "siPaperReviewSourceAndCoverage")} →</button>
      </aside>
    </div>
  </SourceState>;
}

export function PaperSectorThemes({ feeds, onSources, stateLabel, lang }: {
  feeds: FeedMap; onSources: (opener: HTMLButtonElement) => void; stateLabel: (value: unknown) => string; lang: Lang;
}) {
  const zh = lang === "zh", feed=feeds.themes, rows=themeRows(feed?.data), raw=object(feed?.data).themes;
  const valid=readableOwnerEnvelope("themes",feed?.data) && Array.isArray(raw) && raw.length===rows.length;
  return <SourceState feed={feed} valid={valid} lang={lang} onSources={onSources}>
    <div className={styles.instrumentGrid}><section className={styles.instrument}>
      <div className={styles.sectionHeading}><h3>{sectorPaperText(lang, "siPaperThemeEvidence")}</h3><span className={styles.label}>{feed?.receipt.asOf || "—"}</span></div>
      {(feed?.receipt.stale || themeStaleLegs(feed?.data).length>0) && <p className={styles.chartNote} role="status">{sectorPaperText(lang, "siPaperSomeThemeEvidenceIsDelayed")}</p>}
      <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th scope="col">{sectorPaperText(lang, "obTheme")}</th><th scope="col">{sectorPaperText(lang, "siPaperStage")}</th><th scope="col">{sectorPaperText(lang, "siPaperSourceEntryReady")}</th></tr></thead>
        <tbody>{rows.map(row=><tr key={text(row.theme_id)}><th scope="row">{text(zh ? row.name_zh : row.name_en)||text(row.name_en)}</th><td>{stateLabel(object(row.foresight).stage)}</td>
          <td>{themeEntryReady(row)===null ? "—" : themeEntryReady(row) ? sectorPaperText(lang, "siPaperYes") : sectorPaperText(lang, "siPaperNo")}</td></tr>)}</tbody></table></div>
      {!rows.length && <p className={styles.emptyState}>{sectorPaperText(lang, "siPaperThisSourceReportsNoThemes")}</p>}
    </section><aside className={styles.inspector}><p className={styles.label}>{sectorPaperText(lang, "siPaperThemesOverlap")}</p>
      <h3>{sectorPaperText(lang, "siPaperSharedMembershipIsNotIndependentEvidence")}</h3>
      <p className={styles.distinctionNote}>{sectorPaperText(lang, "siPaperThemeStateDoesNotEstablishCapitalInflowsOrAn")}</p>
      <p className={styles.distinctionNote}>{sectorPaperText(lang, "siPaperTheCurrentSnapshotDoesNotProvideAFullOverlap")}</p>
      <button type="button" className={styles.textButton} onClick={event=>onSources(event.currentTarget)}>{sectorPaperText(lang, "siPaperReviewThemeSources")} →</button>
    </aside></div>
  </SourceState>;
}

export function PaperSectorResearch({ sector, feeds, lang, onLens, onInspect, onSources }: {
  sector: Row; feeds: FeedMap; lang: Lang; onLens: (lens: PaperSectorLens)=>void; onInspect: ()=>void; onSources:(opener:HTMLButtonElement)=>void;
}) {
  const zh=lang==="zh", ticker=text(sector.ticker), href=companyHref(ticker);
  const name=text(zh?sector.name_zh:sector.name)||text(sector.name)||ticker;
  return <section className={styles.research}>
    <div className={styles.exploreHeading}><div><h2>{sectorPaperText(lang, "siPaperConnectEvidenceToAQuestion")}</h2><p>{name || (sectorPaperText(lang, "siPaperSelectASectorToBegin"))}</p></div></div>
    <div className={styles.instrumentGrid}><div><p className={styles.label}>{sectorPaperText(lang, "siPaperInvestigationPath")}</p>
      <ol className={styles.researchQuestions}>
        <li><h3>{sectorPaperText(lang, "siPaperIsStrengthSupportedByParticipation")}</h3><p>{sectorPaperText(lang, "siPaperComparePriceLeadershipWithBreadthKeepingEachPopulationCount")}</p><button type="button" className={styles.textButton} onClick={()=>onLens("breadth")}>{sectorPaperText(lang, "siPaperInspectBreadth")} →</button></li>
        <li><h3>{sectorPaperText(lang, "siPaperWhatSupportsOrChallengesTheCurrentRead")}</h3><p>{sectorPaperText(lang, "siPaperInspectAgreementAndDisagreementAmongCycleTurnsAndCompany")}</p><button type="button" className={styles.textButton} data-sector-return-focus="paper-research-dossier" onClick={event => { event.currentTarget.focus({ preventScroll: true }); onInspect(); }}>{sectorPaperText(lang, "siPaperOpenTheSelectedDossier")} →</button></li>
        <li><h3>{sectorPaperText(lang, "siPaperAreTheSameMembersCountedMoreThanOnce")}</h3><p>{sectorPaperText(lang, "siPaperSeparateStructuralMembershipFromIndependentMarketObservations")}</p><button type="button" className={styles.textButton} onClick={()=>onLens("themes")}>{sectorPaperText(lang, "siPaperInspectThemesOverlap")} →</button></li>
      </ol>
    </div><aside className={styles.inspector}><p className={styles.label}>{sectorPaperText(lang, "siPaperResearchContext")}</p><h3>{name || "—"}</h3>
      <dl className={styles.facts}><div><dt>{sectorPaperText(lang, "siPaperSectorSnapshot")}</dt><dd>{feeds.sector?.receipt.asOf || "—"}</dd></div><div><dt>{sectorPaperText(lang, "siPaperConfluenceSnapshot")}</dt><dd>{feeds.confluence?.receipt.asOf || "—"}</dd></div></dl>
      {href && <><Link className={styles.primaryButton} href={`/analysis?view=investigations&symbol=${encodeURIComponent(ticker)}`}>{sectorPaperText(lang, "siPaperOpenSavedResearch")} ↗</Link>
        <p className={styles.chartNote}>{sectorPaperText(lang, "siPaperTheSelectedSymbolCarriesForwardThisSectorSnapshotIs")}</p></>}
      <button type="button" className={styles.textButton} onClick={event=>onSources(event.currentTarget)}>{sectorPaperText(lang, "siPaperInspectOriginalEvidence")} →</button>
    </aside></div>
  </section>;
}
