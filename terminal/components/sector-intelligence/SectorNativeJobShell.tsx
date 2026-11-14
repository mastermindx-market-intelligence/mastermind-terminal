"use client";
/** Native Sector Intelligence job shell (Paper R4, S01/L01 header law): one
 * breadcrumb line, one region chip, the source session date, the job tablist,
 * and the job body. The body never renders a static fallback: without an
 * admitted generation it states the real transport cause and stops.
 */
import Link from "next/link";
import { useMemo, useRef, type ReactNode } from "react";
import { useSectorT } from "@/lib/sectorIntelligenceLex";
import { SECTOR_JOBS, type SectorJob, type SectorView } from "@/lib/sectorIntelligence";
import { sectorNativeRankedRows, type SectorNativeContext } from "./sectorNativeSlots";
import SectorNativeBrief from "./SectorNativeBrief";
import SectorNativeExplore from "./SectorNativeExplore";
import SectorGenerationQualification from "./SectorGenerationQualification";
import styles from "./SectorNative.module.css";
import shell from "./SectorIntelligenceWorkspace.module.css";

const JOB_KEYS: Record<SectorJob, string> = {
  brief: "siNativeJobBrief", explore: "siNativeJobExplore",
  research: "siNativeJobResearch", watches: "siNativeJobWatches",
};

/** "November 6, 2026 · Close" / "2026年11月6日 · 收盘" from the receipt's own
 * session date — never the fetch clock. */
export function nativeSessionLabel(session: string, lang: "en" | "zh", t: ReturnType<typeof useSectorT>): string {
  const date = new Date(`${session}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return session;
  const formatted = date.toLocaleDateString(lang === "zh" ? "zh-CN" : "en-US",
    { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  return `${formatted} ${t("siNativeCloseSuffix")}`;
}

/** Template filler for the few lexicon strings that name a sector or benchmark. */
export function nativeFill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => Object.hasOwn(values, name) ? values[name] : whole);
}

/** The real transport cause for a surface without an admitted generation — the
 * same honest naming everywhere, never a generic fallback title. The R2
 * subscription denial precedes the generic access state: it is its own cause,
 * and signing in is not its remedy. */
export function nativeCause(t: ReturnType<typeof useSectorT>, transport: SectorNativeContext["transport"],
  accessCause?: "entitlement_required"): { title: string; copy: string } {
  return transport === "loading" ? { title: t("siDossierLoading"), copy: t("siSourceRecordCopy") }
    : transport === "access" && accessCause === "entitlement_required"
      ? { title: t("siDossierEntitlement"), copy: t("siDossierEntitlementCopy") }
      : transport === "access" ? { title: t("siDossierAccess"), copy: t("siDossierAccessCopy") }
      : transport === "invalid" ? { title: t("siDossierInvalid"), copy: t("siDossierInvalidCopy") }
      : transport === "error" ? { title: t("siDossierError"), copy: t("siDossierErrorCopy") }
      : { title: t("siDossierUnavailable"), copy: t("siDossierUnavailableCopy") };
}

/** The honest body for a native surface without an admitted generation: the
 * real transport cause, a retry when the connection failed, no values. */
export function NativeUnavailable({ context, onRetry, onSources, onOpenExplorer }: {
  context: SectorNativeContext; onRetry: () => void; onSources: () => void;
  onOpenExplorer?: () => void;
}) {
  const t = useSectorT();
  const transport = context.transport;
  const { title, copy } = nativeCause(t, transport, context.accessCause);
  return <section className={`${styles.card} ${styles.stateCard}`} data-testid="sector-native-unavailable">
    <h2 className={styles.stateTitle}>{title}</h2>
    <p className={styles.stateCopy}>{copy}</p>
    <div className={styles.heroActions}>
      {/* R2: the subscription denial offers no sign-in remedy — signing in
          does not restore a declined entitlement, and no button or link here
          may imply that it does. Other access states keep the sign-in path. */}
      {transport === "access" && context.accessCause !== "entitlement_required"
        && <Link className={styles.primaryButton} href="/login">{t("siSignIn")}</Link>}
      {(transport === "error" || transport === "unavailable") &&
        <button type="button" className={styles.secondaryButton} onClick={onRetry}>{t("siRetry")}</button>}
      <button type="button" className={styles.secondaryButton} onClick={onSources}>{t("siNativeSources")}</button>
      {onOpenExplorer && (transport === "error" || transport === "unavailable") &&
        <button type="button" className={styles.linkRow} onClick={onOpenExplorer}>{t("siNativeOpenExplorer")} →</button>}
    </div>
  </section>;
}

export default function SectorNativeJobShell({ context, job, onJob, onSelect, onOpenDossier,
  onTheme, onRefresh, onSources, onOpenExplorer, onOpenCycles }: {
  context: SectorNativeContext;
  job: SectorJob;
  onJob: (job: SectorJob) => void;
  onSelect: (sectorId: string) => void;
  onOpenDossier: (sectorId: string, view?: SectorView) => void;
  onTheme?: () => void;
  onRefresh: () => void;
  onSources: () => void;
  onOpenExplorer?: () => void;
  onOpenCycles?: () => void;
}) {
  const t = useSectorT();
  const tabs = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => sectorNativeRankedRows(context.generation), [context.generation]);
  const session = context.generation?.receipt.source_session || null;
  const body: ReactNode = job === "research" || job === "watches"
    ? !context.generation
      ? <NativeUnavailable context={context} onRetry={onRefresh} onSources={onSources} onOpenExplorer={onOpenExplorer} />
      : <section className={`${styles.card} ${styles.stateCard}`} data-testid={`sector-native-${job}-shell`}>
          <h2 className={styles.stateTitle}>{t(job === "research" ? "siBriefInvestigateResearch" : "siBriefInvestigateWatches")}</h2>
          <p className={styles.stateCopy}>{t(job === "research" ? "siBriefInvestigateResearchCopy" : "siBriefInvestigateWatchesCopy")}</p>
          <div className={styles.heroActions}>
            <button type="button" className={styles.primaryButton}
              onClick={() => onJob("brief")}>{t("siNativeJobBrief")}</button>
          </div>
        </section>
    : !context.generation
      ? <NativeUnavailable context={context} onRetry={onRefresh} onSources={onSources} onOpenExplorer={onOpenExplorer} />
      : job === "brief"
        ? <SectorNativeBrief context={context} rows={rows} onJob={onJob}
            onOpenDossier={onOpenDossier} onSources={onSources} />
        : <SectorNativeExplore context={context} rows={rows} onSelect={onSelect} onJob={onJob}
            onOpenDossier={onOpenDossier} onSources={onSources} />;
  return <div className={styles.root} data-sector-theme={context.theme} data-sector-language={context.language}>
    <header className={styles.headerTop}>
      <p className={styles.breadcrumb}>{t("siNativeBreadcrumb")}</p>
      <div className={styles.headerMeta}>
        {session && <p className={styles.sessionDate}>{nativeSessionLabel(session, context.language, t)}</p>}
      </div>
    </header>
    <div className={styles.titleRow}>
      <h1 className={styles.title}>{t("siNativeTitle")}</h1>
      <div className={styles.headerTools}>
        <span className={styles.regionChip}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none">
            <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.2" />
            <path d="M1.5 8h13M8 1.5c2 2 2 11 0 13M8 1.5c-2 2-2 11 0 13" stroke="currentColor" strokeWidth="1.2" />
          </svg>
          {t("siNativeRegionUs")}
        </span>
        <button type="button" className={shell.button} onClick={onSources}>{t("siNativeSources")}</button>
        {onOpenCycles && (context.generation || context.transport === "error" || context.transport === "unavailable") &&
          <button type="button" className={shell.button} onClick={onOpenCycles}>{t("siCycleHistory")}</button>}
        {onTheme && <button type="button" className={shell.button} onClick={onTheme}
          aria-label={t(context.theme === "dark" ? "siUseLight" : "siUseDark")}>
          {t(context.theme === "dark" ? "siUseLight" : "siUseDark")}
        </button>}
        <button type="button" className={shell.button} onClick={onRefresh}>{t("siRefresh")}</button>
      </div>
    </div>
    <div className={styles.jobTabs} ref={tabs} role="tablist" aria-label={t("siNativeJobTabs")}
      onKeyDown={event => {
        const index = SECTOR_JOBS.indexOf(job);
        const next = event.key === "ArrowRight" ? (index + 1) % SECTOR_JOBS.length
          : event.key === "ArrowLeft" ? (index + SECTOR_JOBS.length - 1) % SECTOR_JOBS.length
          : event.key === "Home" ? 0 : event.key === "End" ? SECTOR_JOBS.length - 1 : -1;
        if (next < 0) return;
        event.preventDefault(); onJob(SECTOR_JOBS[next]);
        tabs.current?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
      }}>
      {SECTOR_JOBS.map(entry => <button key={entry} type="button" role="tab"
        id={`sn-job-${entry}`} aria-selected={job === entry} aria-controls="sn-job-panel"
        tabIndex={job === entry ? 0 : -1} data-testid={`sector-native-job-${entry}`}
        onClick={() => onJob(entry)} className={styles.jobTab}>{t(JOB_KEYS[entry])}</button>)}
    </div>
    <div id="sn-job-panel" role="tabpanel" aria-labelledby={`sn-job-${job}`} tabIndex={0}>
      <SectorGenerationQualification qualification={context.qualification ?? undefined} />
      {body}
    </div>
  </div>;
}
