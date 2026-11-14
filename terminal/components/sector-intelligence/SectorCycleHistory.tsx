"use client";
import { useLang } from "@/lib/i18n";
import { useSectorT } from "@/lib/sectorIntelligenceLex";
import type { FeedPayload } from "@/lib/sectorIntelligence";
import type { AcceptedCycleHistory } from "@/lib/sectorCycleSnapshot";
import SectorCycleLens from "./SectorCycleLens";
import type { SectorCycleFeed } from "./cycles/cycleProps";
import styles from "./SectorNative.module.css";
import shell from "./SectorIntelligenceWorkspace.module.css";

/** Presentation only. The incumbent workspace owns URL, identity and reads. */
export default function SectorCycleHistory({ binding, feed, events, sector, theme, onSelect,
  onOpenDossier, onSources, onRetry }: {
  binding: AcceptedCycleHistory | null; feed?: FeedPayload; events?: SectorCycleFeed;
  theme: "dark" | "light";
  sector: string; onSelect: (id: string) => void; onOpenDossier: (id: string) => void;
  onSources: () => void; onRetry: () => void;
}) {
  const t = useSectorT(), { lang } = useLang();
  const status = feed?.receipt.status || "loading";
  if (!binding) return <section className={`${styles.root} ${styles.card} ${styles.stateCard}`} data-sector-theme={theme} data-testid="cycle-history-unavailable">
    <h2 className={styles.stateTitle}>{t(status === "loading" ? "siStatusLoading"
      : status === "access" ? "siStatusAccess" : "siCycleHistoryUnavailable")}</h2>
    <p className={styles.stateCopy}>{t(status === "access" ? "siCycleHistoryAccess"
      : status === "loading" ? "siCycleHistoryLoading" : "siCycleHistoryUnavailableCopy")}</p>
    <div className={styles.heroActions}>
      {(status === "error" || status === "unavailable") && <button type="button" className={styles.secondaryButton} onClick={onRetry}>{t("siRetry")}</button>}
      <button type="button" className={styles.secondaryButton} onClick={onSources}>{t("siNativeSources")}</button>
    </div>
  </section>;
  if (!binding.sectors.some(row => row.id === sector)) return <section className={`${styles.root} ${styles.card} ${styles.stateCard}`} data-sector-theme={theme} data-testid="cycle-history-unknown-sector">
    <h2 className={styles.stateTitle}>{t("siCycleHistoryUnknown")}</h2>
    <label>{t("siCycleHistoryChoose")} <select className={shell.button} value="" onChange={event => onSelect(event.target.value)}>
      <option value="" disabled>{sector.toUpperCase()}</option>
      {binding.sectors.map(row => <option key={row.id} value={row.id}>{(lang === "zh" ? row.nameZh : row.name) || row.name} · {row.ticker}</option>)}
    </select></label>
    <button type="button" className={styles.secondaryButton} onClick={onSources}>{t("siNativeSources")}</button>
  </section>;
  return <SectorCycleLens key={`${binding.generation.accessGeneration}|sectors|${sector}`}
    generation={binding.generation} accessGeneration={binding.generation.accessGeneration}
    subject={{ family: "sectors", id: sector }} region="us" historyOnly returnBinding="host"
    historyFeed={{ state: binding.stale ? "stale" : "ready", data: feed?.data }}
    eventsFeed={events} cyclesFeed={{ state: "unavailable" }}
    onSelectSubject={subject => {
      if (subject.family === "sectors" && binding.sectors.some(row => row.id === subject.id)) onSelect(subject.id);
    }}
    onNavigate={destination => { if (destination.family === "sectors") onOpenDossier(destination.id); }} />;
}
