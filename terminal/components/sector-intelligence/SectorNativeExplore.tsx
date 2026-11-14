"use client";
/** Explore job (Paper R4 S02): the complete ranked inventory in the producer's
 * own 63-session source order — never a conviction order — with one selection,
 * an inspector bound to the selected subject, and honest dashes wherever the
 * generation supplies no measurement. The basket comparison stays an honest
 * unavailability until its lane mounts. */
import { useMemo } from "react";
import { useLang } from "@/lib/i18n";
import { useSectorT } from "@/lib/sectorIntelligenceLex";
import { formatValue, sectorMeasuredRead, type SectorJob } from "@/lib/sectorIntelligence";
import type { SectorNativeContext, SectorNativeRankedRow } from "./sectorNativeSlots";
import { nativeFill } from "./SectorNativeJobShell";
import styles from "./SectorNative.module.css";

const sign = (v: number | null) => v === null || v === 0 ? undefined : v < 0 ? "down" as const : "up" as const;

function windowVerdict(t: ReturnType<typeof useSectorT>, row: SectorNativeRankedRow, benchmark: string): string {
  if (row.rs21d === null || row.rs63d === null) return t("siExploreUnmeasured");
  if (row.rs21d === 0 && row.rs63d === 0) return t("siExploreEvenBoth");
  if (row.rs21d === 0 || row.rs63d === 0) return t("siExploreEvenWindow");
  const ahead21 = row.rs21d > 0, ahead63 = row.rs63d > 0;
  if (ahead21 && ahead63) return nativeFill(t("siDossierAheadOf"), { benchmark });
  if (!ahead21 && !ahead63) return nativeFill(t("siDossierBehindOf"), { benchmark });
  return t("siSectorDossierWindowsDisagree");
}

export default function SectorNativeExplore({ context, rows, onSelect, onOpenDossier, onSources, onJob }: {
  context: SectorNativeContext;
  rows: SectorNativeRankedRow[];
  onSelect: (sectorId: string) => void;
  onOpenDossier: (sectorId: string, view?: "intelligence" | "signals") => void;
  onSources: () => void;
  onJob: (job: SectorJob) => void;
}) {
  const t = useSectorT(), { lang } = useLang();
  const read = useMemo(() => sectorMeasuredRead(context.generation?.core), [context.generation]);
  const benchmark = read.benchmark || "SPY";
  const measured = rows.filter(row => row.measured).length;
  const selected = context.subject;
  const selectedRow = selected ? rows.find(row => row.id === selected.id) || null : null;
  const localName = (row: SectorNativeRankedRow) => lang === "zh" ? row.nameZh || row.name : row.name;
  if (!rows.length) return <section className={`${styles.card} ${styles.stateCard}`} data-testid="sector-native-explore">
    <h2 className={styles.stateTitle}>{t("siExploreEmptyTitle")}</h2>
    <p className={styles.stateCopy}>{t("siExploreEmptyCopy")}</p>
    <div className={styles.heroActions}>
      <button type="button" className={styles.primaryButton} onClick={() => onJob("brief")}>{t("siNativeJobBrief")}</button>
      <button type="button" className={styles.secondaryButton} onClick={onSources}>{t("siNativeSources")}</button>
    </div>
  </section>;
  return <div className={styles.exploreColumns} data-testid="sector-native-explore">
    <section className={`${styles.card} ${styles.rankCard}`}>
      <div className={styles.rankTableWrap}>
      <table className={styles.rankTable} aria-label={t("siBriefExplore")}>
        <caption className={styles.rankCaption}>{read.benchmark && read.basis === "total_return"
          ? nativeFill(t("siExploreMeasurementBasis"), { benchmark: read.benchmark })
          : t("siExploreBasisUnavailable")}</caption>
        <thead><tr>
          <th scope="col">{t("siExploreColSector")}</th>
          <th scope="col">{t("siExploreCol63")}</th>
          <th scope="col">{t("siExploreCol21")}</th>
        </tr></thead>
        <tbody>{rows.map(row => <tr key={row.id} className={styles.rankRow}
          data-selected={selected && row.id === selected.id ? "true" : undefined}>
          <th scope="row">
            <button type="button" className={styles.rankName} data-sector-choice={row.id}
              aria-pressed={selected ? selected.id === row.id : undefined}
              aria-label={nativeFill(t("siExploreSelectSector"), { sector: localName(row) })}
              onClick={() => onSelect(row.id)}>
              <span>{localName(row)}</span>
              <span className={styles.rankTicker}>{row.ticker}{selected && row.id === selected.id ? ` · ${t("siExploreSelected")}` : ""}</span>
            </button>
          </th>
          <td className={styles.rankValue} data-sign={sign(row.rs63d)}>{row.measured ? formatValue(row.rs63d, 2, "%", true) : "—"}</td>
          <td className={styles.rankValue} data-sign={sign(row.rs21d)}>{row.measured ? formatValue(row.rs21d, 2, "%", true) : "—"}</td>
        </tr>)}</tbody>
      </table>
      </div>
      <div className={styles.rankFoot}>
        <div>
          <p>{nativeFill(t("siExploreFoot"), {
            measured: String(measured), expected: String(read.expectedN ?? rows.length) })}</p>
          <p>{t("siNativeBreadthMissing")}</p>
          {!selectedRow && <p>{t("siExploreNoneSelected")}</p>}
        </div>
        <button type="button" className={styles.linkRow} onClick={onSources}>{t("siNativeSources")} →</button>
      </div>
    </section>
    {selectedRow && <aside className={`${styles.card} ${styles.inspector}`} data-testid="sector-native-inspector">
        <div className={styles.inspectorChipRow}>
          <span className={styles.chip}>{selectedRow.ticker}</span>
          <span className={styles.chip}>{t("siExploreSelected")}</span>
        </div>
        <div>
          <h2 className={styles.cardTitle}>{localName(selectedRow)}</h2>
          {selectedRow.measured ? <>
            <p className={styles.assessment}>{windowVerdict(t, selectedRow, benchmark)}</p>
            <p className={styles.chartNote}>{selectedRow.rank !== null
              ? nativeFill(t("siExploreRank"), { rank: String(selectedRow.rank), measured: String(measured) })
              : ""}</p>
          </> : <p className={styles.chartNote}>{t("siExploreUnmeasured")}{selectedRow.reason ? ` · ${selectedRow.reason}` : ""}</p>}
        </div>
        {selectedRow.measured && <div className={styles.lookStats}>
          <div className={styles.stat}>
            <span className={styles.statLabel}>{t("siDossierWindow21")}</span>
            <span className={styles.lookValue} data-sign={sign(selectedRow.rs21d)}>{formatValue(selectedRow.rs21d, 2, "%", true)}</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statLabel}>{t("siDossierWindow63")}</span>
            <span className={styles.lookValue} data-sign={sign(selectedRow.rs63d)}>{formatValue(selectedRow.rs63d, 2, "%", true)}</span>
          </div>
        </div>}
        <div>
          <span className={styles.participationLabel}>{t("siSectorDossierParticipation")}</span>
          <p className={styles.chartNote}>{t("siNativeBreadthMissing")}</p>
        </div>
        <div className={styles.heroActions}>
          <button type="button" className={styles.primaryButton} data-testid="sector-native-inspector-open"
            data-sector-choice={selectedRow.id}
            onClick={() => onOpenDossier(selectedRow.id)}>{t("siExploreViewSector")}</button>
        </div>
        <div className={styles.linkStack}>
          <button type="button" className={styles.linkRow} onClick={() => onOpenDossier(selectedRow.id, "signals")}>
            {t("siNativeCycles")} →</button>
        </div>
        <p className={styles.chartNote}>{t("siNativeComparePending")}</p>
    </aside>}
  </div>;
}
