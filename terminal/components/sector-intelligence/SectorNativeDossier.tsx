"use client";
/** Selected-sector dossier (Paper R4 S03), bound to the admitted generation:
 * leadership verdict, exact-session returns, and honest unavailability for the
 * panels the native source does not supply. Non-Overview tabs state what is not
 * connected rather than borrowing another source's rows. */
import { useMemo, useRef } from "react";
import { useLang } from "@/lib/i18n";
import { useSectorT } from "@/lib/sectorIntelligenceLex";
import { EXACT_WINDOW_KEYS, sectorWindowMeasurements,
  type ExactGroup, type SectorWindowMeasurements } from "@/lib/sectorDossiers";
import { formatValue, SECTOR_VIEWS, type SectorJob, type SectorView } from "@/lib/sectorIntelligence";
import { sectorNativeRankedRows, type SectorNativeContext } from "./sectorNativeSlots";
import { nativeFill, nativeSessionLabel, NativeUnavailable } from "./SectorNativeJobShell";
import SectorGenerationQualification from "./SectorGenerationQualification";
import styles from "./SectorNative.module.css";
import shell from "./SectorIntelligenceWorkspace.module.css";

const sign = (v: number | null) => v === null || v === 0 ? undefined : v < 0 ? "down" as const : "up" as const;
const TAB_KEYS: Record<SectorView, string> = {
  intelligence: "siOverview", companies: "siCompaniesTab", drivers: "siDrivers",
  signals: "siNativeCycles", history: "siHistory",
};

export default function SectorNativeDossier({ context, view, onView, onBack, onJob,
  onOpenRotation, onTheme, onRefresh, onSources }: {
  context: SectorNativeContext;
  view: SectorView;
  onView: (view: SectorView) => void;
  onBack: () => void;
  onJob: (job: SectorJob) => void;
  onOpenRotation: () => void;
  onTheme: () => void;
  onRefresh: () => void;
  onSources: () => void;
}) {
  const t = useSectorT(), { lang } = useLang();
  const tabs = useRef<HTMLDivElement>(null);
  const subject = context.subject;
  const exact = useMemo(() => sectorWindowMeasurements(context.generation?.core), [context.generation]);
  const exactGroup = subject && exact.state === "ok" && exact.measurements
    ? exact.measurements.groups.find(group => group.group_id.toUpperCase() === subject.ticker.toUpperCase()) || null
    : null;
  if (!subject || !context.generation) {
    return <div className={styles.root} data-sector-theme={context.theme}
      data-testid="sector-native-dossier">
      <div className={styles.backRow}>
        <button type="button" className={styles.linkRow} data-sector-return-focus="native-dossier"
          data-testid="sector-native-dossier-back" onClick={onBack}>← {t("siSectorDossierBack")}</button>
      </div>
      <NativeUnavailable context={context} onRetry={onRefresh} onSources={onSources} />
    </div>;
  }
  const session = context.generation.receipt.source_session;
  const benchmark = exact.state === "ok" && exact.measurements ? exact.measurements.benchmark : "SPY";
  const name = lang === "zh" ? subject.nameZh || subject.name : subject.name;
  return <div className={styles.root} data-sector-theme={context.theme} data-sector-language={context.language}
    data-testid="sector-native-dossier">
    <div className={styles.backRow}>
      <button type="button" className={styles.linkRow} data-sector-return-focus="native-dossier"
        data-testid="sector-native-dossier-back" onClick={onBack}>← {t("siSectorDossierBack")}</button>
    </div>
    <div className={styles.dossierHeader}>
      <div className={styles.dossierTitleWrap}>
        <div className={styles.dossierTitleRow}>
          <h1 className={styles.dossierTitle}>{name}</h1>
          <span className={styles.chip}>{subject.ticker}</span>
        </div>
        <p className={styles.dossierSub}>{nativeFill(t("siSectorDossierSub"),
          { ticker: subject.ticker, benchmark })} · {nativeSessionLabel(session, context.language, t)}</p>
      </div>
      <div className={styles.dossierTools}>
        <button type="button" className={shell.button} onClick={onTheme}
          aria-label={t(context.theme === "dark" ? "siUseLight" : "siUseDark")}>
          {t(context.theme === "dark" ? "siUseLight" : "siUseDark")}</button>
        <button type="button" className={shell.button} onClick={onRefresh}>{t("siRefresh")}</button>
        <button type="button" className={shell.button} onClick={onSources}>{t("siNativeSources")}</button>
      </div>
    </div>
    <p className={styles.chartNote}>{t("siNativeSavePending")} · {t("siNativeComparePending")}</p>
    <div className={styles.subTabs} ref={tabs} role="tablist" aria-label={t("siSectorDossierTabs")}
      onKeyDown={event => {
        const index = SECTOR_VIEWS.indexOf(view);
        const next = event.key === "ArrowRight" ? (index + 1) % SECTOR_VIEWS.length
          : event.key === "ArrowLeft" ? (index + SECTOR_VIEWS.length - 1) % SECTOR_VIEWS.length
          : event.key === "Home" ? 0 : event.key === "End" ? SECTOR_VIEWS.length - 1 : -1;
        if (next < 0) return;
        event.preventDefault(); onView(SECTOR_VIEWS[next]);
        tabs.current?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
      }}>
      {SECTOR_VIEWS.map(tab => <button key={tab} type="button" role="tab"
        id={`sn-dossier-tab-${tab}`} aria-selected={view === tab} aria-controls="sn-dossier-panel"
        tabIndex={view === tab ? 0 : -1} onClick={() => onView(tab)}
        data-testid={`sector-native-dossier-tab-${tab}`} className={styles.subTab}>{t(TAB_KEYS[tab])}</button>)}
    </div>
    <div id="sn-dossier-panel" role="tabpanel" aria-labelledby={`sn-dossier-tab-${view}`} tabIndex={0}>
      <SectorGenerationQualification qualification={context.qualification ?? undefined} />
      {view === "intelligence" ? <DossierOverview context={context} exact={exact.state === "ok" ? exact.measurements : null}
        exactGroup={exactGroup} benchmark={benchmark} onJob={onJob} /> : view === "companies" ? <section className={`${styles.card} ${styles.stateCard}`}>
        <h2 className={styles.stateTitle}>{t("siCompaniesTab")}</h2>
        <p className={styles.stateCopy}>{t("siSectorDossierCompaniesCopy")}</p>
      </section> : view === "drivers" ? <section className={`${styles.card} ${styles.stateCard}`}>
        <h2 className={styles.stateTitle}>{t("siDrivers")}</h2>
        <p className={styles.stateCopy}>{t("siBusinessCopy")}</p>
      </section> : view === "signals" ? <section className={`${styles.card} ${styles.stateCard}`} data-testid="sector-native-dossier-cycles">
        <h2 className={styles.stateTitle}>{t("siNativeCycles")}</h2>
        <p className={styles.stateCopy}>{t("siSectorDossierCyclesCopy")}</p>
        <div className={styles.heroActions}>
          <button type="button" className={styles.secondaryButton} onClick={onOpenRotation}>
            {t("siSectorDossierOpenRotation")}</button>
        </div>
      </section> : <section className={`${styles.card} ${styles.stateCard}`}>
        <h2 className={styles.stateTitle}>{t("siHistoryEmpty")}</h2>
        <p className={styles.stateCopy}>{t("siReplayCopy")}</p>
        <p className={styles.chartNote}>{t("siHistoryContext")}</p>
      </section>}
    </div>
  </div>;
}

function DossierOverview({ context, exact, exactGroup, benchmark, onJob }: {
  context: SectorNativeContext;
  exact: SectorWindowMeasurements | null;
  exactGroup: ExactGroup | null;
  benchmark: string;
  onJob: (job: SectorJob) => void;
}) {
  const t = useSectorT();
  const subject = context.subject!;
  const row = useMemo(() => context.generation
    ? sectorNativeRankedRows(context.generation).find(entry => entry.id === subject.id) || null
    : null, [context.generation, subject.id]);
  return <div className={styles.dossierColumns}>
    <div className={styles.dossierMain}>
      <section className={styles.card} data-testid="sector-native-dossier-leadership">
        <h2 className={styles.cardTitle}>{t("siDossierTitle")}</h2>
        {!row || !row.measured ? <p className={styles.stateCopy}>{t("siDossierNoMeasurement")}</p> : <>
          <p className={styles.leadershipVerdict}>
            {(row.rs21d ?? 0) > 0 && (row.rs63d ?? 0) > 0 ? nativeFill(t("siSectorDossierAheadBoth"), { benchmark })
              : (row.rs21d ?? 0) <= 0 && (row.rs63d ?? 0) <= 0 ? nativeFill(t("siSectorDossierBehindBoth"), { benchmark })
              : t("siSectorDossierWindowsDisagree")}
          </p>
          <div className={styles.leadershipStats}>
            <div className={styles.stat}>
              <span className={styles.statLabel}>{t("siDossierWindow21")}</span>
              <span className={styles.statValue} data-sign={sign(row.rs21d)}>{formatValue(row.rs21d, 2, "%", true)}</span>
              <span className={styles.statFoot}>{nativeFill(t("siDossierRelativeVsBenchmark"), { benchmark })}</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statLabel}>{t("siDossierWindow63")}</span>
              <span className={styles.statValue} data-sign={sign(row.rs63d)}>{formatValue(row.rs63d, 2, "%", true)}</span>
              <span className={styles.statFoot}>{row.rank !== null ? `No. ${row.rank}` : "—"}</span>
            </div>
          </div>
          <p className={styles.chartNote}>{nativeFill(t("siBriefChartNote"), { benchmark })} {t("siDossierCaveat")}</p>
        </>}
      </section>
      <section className={styles.card} data-testid="sector-native-dossier-exact">
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>{t("siExactTitle")}</h2>
          {exact && <span className={styles.chartNote}>{nativeFill(t("siExactRelativeWealth"), { benchmark })}</span>}
        </div>
        {exact && exactGroup ? <div className={styles.exactTableWrap}>
          <table className={styles.exactTable}>
            <thead><tr>
              <th scope="col">{t("siExactSectorColumn")}</th>
              {EXACT_WINDOW_KEYS.map(window => <th key={window} scope="col">{t(`siExactWindow${window}`)}</th>)}
            </tr></thead>
            <tbody>
              <tr>
                <th scope="row">{t("siExactAbsoluteReturn")}</th>
                {EXACT_WINDOW_KEYS.map(window => <td key={window}
                  data-sign={sign(exactGroup.windows[window].absolute_return_pct)}>
                  {formatValue(exactGroup.windows[window].absolute_return_pct, 2, "%", true)}
                </td>)}
              </tr>
              <tr>
                <th scope="row">{nativeFill(t("siExactRelativeWealth"), { benchmark })}</th>
                {EXACT_WINDOW_KEYS.map(window => <td key={window}
                  data-sign={sign(exactGroup.windows[window].relative_wealth_pct)}>
                  {formatValue(exactGroup.windows[window].relative_wealth_pct, 2, "%", true)}
                </td>)}
              </tr>
              <tr>
                <th scope="row">{t("siExactGroupCoverage")}</th>
                {EXACT_WINDOW_KEYS.map(window => <td key={window}>{nativeFill(t("siExactCoverageCompact"), {
                  observed: String(exactGroup.windows[window].coverage.observed_n),
                  expected: String(exactGroup.windows[window].coverage.expected_n) })}</td>)}
              </tr>
            </tbody>
          </table>
          <p className={styles.chartNote}>{t("siSectorDossierExactFoot")}</p>
        </div> : <p className={styles.stateCopy}>{t("siExactUnavailable")}</p>}
      </section>
    </div>
    <div className={styles.dossierSide}>
      <section className={styles.card} data-testid="sector-native-dossier-participation">
        <h2 className={styles.cardTitle}>{t("siSectorDossierParticipation")}</h2>
        <div className={styles.participationRow}>
          <span className={styles.participationValue}>—</span>
          <span className={styles.chartNote}>{subject.ticker}</span>
        </div>
        <p className={styles.stateCopy}>{t("siNativeBreadthMissing")}</p>
      </section>
      <section className={`${styles.card} ${styles.stateCard}`} data-testid="sector-native-dossier-research">
        <h2 className={styles.stateTitle}>{t("siSectorDossierResearch")}</h2>
        <p className={styles.stateCopy}>{t("siBriefInvestigateResearchCopy")}</p>
        <div className={styles.heroActions}>
          <button type="button" className={styles.secondaryButton}
            onClick={() => onJob("research")}>{t("siBriefInvestigateResearchAction")}</button>
        </div>
      </section>
    </div>
  </div>;
}
