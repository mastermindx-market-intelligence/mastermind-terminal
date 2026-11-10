"use client";
/** Brief job (Paper R4 S01): the 3–4 second orientation — who leads at 63
 * sessions, how many sectors are ahead, what is honestly unavailable, and the
 * next investigations. Every number comes from the admitted generation's
 * measured read; nothing is extrapolated from the specimen frames. */
import { useMemo, useRef } from "react";
import { useLang } from "@/lib/i18n";
import { useSectorT } from "@/lib/sectorIntelligenceLex";
import { formatValue, sectorMeasuredRead, type SectorJob } from "@/lib/sectorIntelligence";
import { sectorDossiers } from "@/lib/sectorDossiers";
import { fmtTick, niceTicks, padDomain, thinLabels, useChartWidth } from "@/components/charts/svgChart";
import type { SectorNativeContext, SectorNativeRankedRow } from "./sectorNativeSlots";
import { nativeFill } from "./SectorNativeJobShell";
import styles from "./SectorNative.module.css";

const LABEL_COL = 76, VALUE_COL = 64, ROW_H = 34, AXIS_H = 20;

export default function SectorNativeBrief({ context, rows, onJob, onOpenDossier, onOpenRotation, onSources }: {
  context: SectorNativeContext;
  rows: SectorNativeRankedRow[];
  onJob: (job: SectorJob) => void;
  onOpenDossier: (sectorId: string) => void;
  onOpenRotation: () => void;
  onSources: () => void;
}) {
  const t = useSectorT(), { lang } = useLang();
  const chartWrap = useRef<HTMLDivElement>(null);
  const width = useChartWidth(chartWrap, 560);
  const read = useMemo(() => sectorMeasuredRead(context.generation?.core), [context.generation]);
  const dossiers = useMemo(() => sectorDossiers(context.generation?.core), [context.generation]);
  const benchmark = read.benchmark || "SPY";
  const measured = useMemo(() => rows.filter(row => row.measured), [rows]);
  const lead = measured[0] || null;
  const second = measured[1] || null;
  const localName = (row: SectorNativeRankedRow) => lang === "zh" ? row.nameZh || row.name : row.name;
  const ahead63 = measured.filter(row => (row.rs63d ?? 0) > 0).length;
  const picks = measured.length <= 5 ? measured : [...measured.slice(0, 3), ...measured.slice(-2)];
  // ≤11 measured rows — computed inline, no memo to preserve.
  const look = (() => {
    for (const row of measured) {
      if ((row.rs21d ?? 0) > 0 !== (row.rs63d ?? 0) > 0) return { row, kind: "diverge" as const };
    }
    for (const row of [...measured].reverse()) {
      if ((row.rs21d ?? 0) < 0 && (row.rs63d ?? 0) < 0) return { row, kind: "lagging" as const };
    }
    return null;
  })();
  if (!lead) return <section className={`${styles.card} ${styles.stateCard}`} data-testid="sector-native-brief-unmeasured">
    <h2 className={styles.stateTitle}>{t("siDossierMeasurementsUnavailable")}</h2>
    <button type="button" className={styles.linkRow} onClick={onSources}>{t("siNativeSources")} →</button>
  </section>;

  // Zero-anchored bars: zero is always a domain endpoint, then padDomain spaces it.
  const values = picks.map(row => row.rs63d ?? 0);
  const [lo, hi] = padDomain(Math.min(0, ...values), Math.max(0, ...values), { padFrac: 0.12 });
  const plotW = Math.max(60, width - LABEL_COL - VALUE_COL);
  const x = (v: number) => LABEL_COL + ((v - lo) / (hi - lo || 1)) * plotW;
  const zero = x(0);
  const ticks = niceTicks(lo, hi, 4);
  const shown = thinLabels(ticks.values, v => x(v), 40);
  const chartH = picks.length * ROW_H + AXIS_H;
  const sign = (v: number | null) => v === null || v === 0 ? undefined : v < 0 ? "down" as const : "up" as const;
  const investigation = (title: string, copy: string, action: string, onAction: () => void, testid: string) =>
    <div className={styles.investigation} data-testid={testid}>
      <div><h3>{title}</h3><p>{copy}</p></div>
      <button type="button" className={styles.linkRow} onClick={onAction}>{action} →</button>
    </div>;
  return <>
    <section className={styles.card} data-testid="sector-native-brief">
      <div className={styles.hero}>
        <div className={styles.heroCopy}>
          <h2 className={styles.heroHeadline}>{nativeFill(t("siBriefHeroLead"), { sector: localName(lead) })}</h2>
          {second && <p className={styles.heroSub}>
            {nativeFill(t("siBriefHeroSub"), { sector: localName(lead), second: localName(second) })}
          </p>}
          <div className={styles.heroActions}>
            <button type="button" className={styles.primaryButton} data-testid="sector-native-brief-explore"
              onClick={() => onJob("explore")}>{t("siBriefExplore")}</button>
            <button type="button" className={styles.secondaryButton} onClick={() => onOpenDossier(lead.id)}>
              {nativeFill(t("siExploreViewSector"), { sector: localName(lead) })}
            </button>
          </div>
        </div>
        <div className={styles.heroStats}>
          <div className={styles.stat}>
            <span className={styles.statLabel}>{nativeFill(t("siBriefLeadOverBenchmark"), { benchmark })}</span>
            <span className={styles.statValue} data-sign={sign(lead.rs63d)}>{formatValue(lead.rs63d, 2, "%", true)}</span>
            <span className={styles.statFoot}>{t("siBriefSectorWindowFoot")}</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statLabel}>{nativeFill(t("siBriefSectorsAhead"), { benchmark })}</span>
            <span className={styles.statValue}>{nativeFill(t("siBriefOfMeasured"),
              { ahead: String(ahead63), measured: String(measured.length) })}</span>
            <span className={styles.statFoot}>{nativeFill(t("siBriefMeasuredFoot"),
              { measured: String(measured.length), benchmark })}</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statLabel}>{t("siBriefDataStatus")}</span>
            <span className={styles.statValue}>{read.expectedN === null ? String(measured.length)
              : `${measured.length}/${read.expectedN}`}</span>
            <span className={styles.statFoot}>{t(context.qualification === "stale" ? "siStale"
              : context.qualification === "degraded" ? "siGenerationDegraded" : "siStatusReady")}</span>
          </div>
        </div>
      </div>
    </section>
    <div className={styles.briefColumns}>
      <div className={styles.briefMain}>
        <section className={styles.card} data-testid="sector-native-brief-leaders">
          <div className={styles.cardHead}>
            <h2 className={styles.cardTitle}>{t("siBriefLeaders")}</h2>
            <span className={styles.chartNote}>{nativeFill(t("siBriefLeadersFoot"), { benchmark })}</span>
          </div>
          <div className={styles.chartWrap} ref={chartWrap}>
            <svg className={styles.chartSvg} width={width} height={chartH} viewBox={`0 0 ${width} ${chartH}`}
              role="img" aria-label={`${t("siBriefLeaders")}. ${nativeFill(t("siBriefChartNote"), { benchmark })}`}>
              {shown.map(v => <g key={v}>
                <line x1={x(v)} x2={x(v)} y1={0} y2={picks.length * ROW_H}
                  stroke="var(--sn-line)" strokeWidth={v === 0 ? 1.2 : 0.5}
                  strokeDasharray={v === 0 ? undefined : "2 3"} />
                <text x={x(v)} y={chartH - 6} textAnchor="middle" fontSize="11"
                  fontFamily="var(--font-num)" fill="var(--sn-muted)">{fmtTick(v, ticks.step)}</text>
              </g>)}
              {picks.map((row, index) => {
                const value = row.rs63d ?? 0;
                const barX = Math.min(zero, x(value)), barW = Math.abs(x(value) - zero);
                return <g key={row.id}>
                  <title>{`${localName(row)} (${row.ticker}): ${formatValue(value, 2, "%", true)}`}</title>
                  <text x={LABEL_COL - 8} y={index * ROW_H + 21} textAnchor="end" fontSize="11"
                    fontFamily="var(--font-num)" fill="var(--sn-muted)">{row.ticker}</text>
                  <rect x={barX} y={index * ROW_H + 10} width={Math.max(barW, value === 0 ? 0 : 1)}
                    height={14} rx={3} fill={value > 0 ? "var(--sn-up)" : value < 0 ? "var(--sn-down)" : "var(--sn-muted)"} />
                  <text x={width - VALUE_COL + 8} y={index * ROW_H + 21} textAnchor="start" fontSize="12"
                    fontFamily="var(--font-num)" fill={value > 0 ? "var(--sn-up)" : value < 0 ? "var(--sn-down)" : "var(--sn-muted)"}>
                    {formatValue(value, 2, "%", true)}
                  </text>
                </g>;
              })}
            </svg>
          </div>
          <div className={styles.chartFoot}>
            <span className={styles.chartNote}>{nativeFill(t("siBriefLeadersShown"),
              { shown: String(picks.length), measured: String(measured.length) })}</span>
            <button type="button" className={styles.linkRow} onClick={() => onJob("explore")}>{t("siBriefAllSectors")} →</button>
          </div>
        </section>
        <section className={`${styles.card} ${styles.stateCard}`} data-testid="sector-native-brief-status">
          <h2 className={styles.stateTitle}>{t("siBriefDataStatus")}</h2>
          <div className={styles.statusStrip}>
            {dossiers.state === "ok" && dossiers.dossier && <>
              <p>{t("siDossierUnavailableWindows")}: {t("siDossierUnavailableWindowsCopy")}</p>
            </>}
            <p>{t("siNativeBreadthMissing")}</p>
            <p>{t("siNativeComparePending")}</p>
          </div>
          <button type="button" className={styles.linkRow} onClick={onSources}>{t("siNativeSources")} →</button>
        </section>
      </div>
      <div className={styles.briefSide}>
        <section className={styles.card} data-testid="sector-native-brief-look">
          <h2 className={styles.cardTitle}>{t("siBriefWorthALook")}</h2>
          {look ? <div className={styles.lookItem}>
            <h3 className={styles.lookTitle}>{look.kind === "diverge" ? t("siBriefWindowsDisagree") : localName(look.row)}</h3>
            <p className={styles.stateCopy}>{look.kind === "diverge"
              ? nativeFill(t("siBriefLookDivergeCopy"), { sector: localName(look.row) })
              : nativeFill(t("siBriefLaggingBothCopy"), { benchmark })}</p>
            <div className={styles.lookStats}>
              <div className={styles.stat}>
                <span className={styles.statLabel}>{t("siDossierWindow21")}</span>
                <span className={styles.lookValue} data-sign={sign(look.row.rs21d)}>{formatValue(look.row.rs21d, 2, "%", true)}</span>
              </div>
              <div className={styles.stat}>
                <span className={styles.statLabel}>{t("siDossierWindow63")}</span>
                <span className={styles.lookValue} data-sign={sign(look.row.rs63d)}>{formatValue(look.row.rs63d, 2, "%", true)}</span>
              </div>
            </div>
            <button type="button" className={styles.secondaryButton}
              onClick={() => onOpenDossier(look.row.id)}>{t("siBriefCompareWindows")}</button>
          </div> : <p className={styles.stateCopy}>{t("siBriefLookNone")}</p>}
        </section>
        <section className={styles.card} data-testid="sector-native-brief-next">
          <h2 className={styles.cardTitle}>{t("siBriefNext")}</h2>
          <div className={styles.investigations}>
            {investigation(t("siNativeCycles"), t("siBriefInvestigateCyclesCopy"),
              t("siBriefInvestigateCyclesAction"), onOpenRotation, "sector-native-brief-next-cycles")}
            {investigation(t("siBriefInvestigateWatches"), t("siBriefInvestigateWatchesCopy"),
              t("siBriefInvestigateWatchesAction"), () => onJob("watches"), "sector-native-brief-next-watches")}
            {investigation(t("siBriefInvestigateResearch"), t("siBriefInvestigateResearchCopy"),
              t("siBriefInvestigateResearchAction"), () => onJob("research"), "sector-native-brief-next-research")}
          </div>
        </section>
      </div>
    </div>
  </>;
}
