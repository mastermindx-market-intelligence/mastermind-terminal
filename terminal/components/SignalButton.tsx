import type { CSSProperties } from "react";
import { oracleEntryAvailability, oraclePresentation, type Verdict } from "../lib/signalVerdict";
import { pick } from "../lib/finFormat"
import styles from "./SignalButton.module.css";
import { prophetObservationSummary, type ProphetObservationRead } from "../lib/prophetObservations";

interface Half {
  raw?: Verdict["raw"];
  historicalSignal?: Verdict["historicalSignal"];
  refusedSignalKnownTs?: Verdict["refusedSignalKnownTs"];
  entryAvailability?: Verdict["entryAvailability"];
  label: string;
  color: string;
  sub?: string | null;
  dim?: boolean;
  note?: string | null;
  /** primary line is a stance (posture), not a signal event — renders in the stance style */
  stance?: boolean;
  /** a real dated event outside the scored lane (RECLAIM) — hollow, no full authority */
  soft?: boolean;
  /** the engine refused a still-live entry trigger. When that refusal is the primary read the
   *  label already says so; when it rides under a fresher sell anchor this is the only marker,
   *  so the same engine state can't render as two different-looking cards. */
  blocked?: boolean;
  /** the refusal is a washout-override candidate. The compact rail keeps its two-line
   *  geometry — the disclosure LINE renders on the Golden Oracle card (OracleDash), and the
   *  numbers behind it are already in `note`, which is this button's tooltip. */
  overrideCandidate?: boolean;
  /** the verdict IS a washout-override entry. Same geometry as any entry — the disclosure
   *  LINE renders on the Golden Oracle card (OracleDash) and the numbers ride `note`. */
  overrideTake?: boolean;
  line2?: string | null;
}

interface Props {
  oracle: Half;
  desk: Half;
  oracleLabel: string;
  deskLabel: string;
  viewLabel: string;
  onView: () => void;
  expanded?: boolean;
  zh?: boolean;
  prophet?: ProphetObservationRead;
}

export default function SignalButton({ oracle, desk, oracleLabel, deskLabel, onView, expanded = false, zh = false, prophet }: Props) {
  const title = oracleLabel + (oracle.note ? ` — ${oracle.note}` : "") + " · " + deskLabel + (desk.note ? ` — ${desk.note}` : "");
  const oracleRead = oraclePresentation(oracle, zh);
  const entry = oracle.entryAvailability ?? oracleEntryAvailability(zh);
  const early = prophet ? prophetObservationSummary(prophet, zh) : null;
  return <button className={`sig-btn ${styles.launcher}`} onClick={onView} title={title}
    data-testid="intelligence-launcher" data-prophet={early ? true : undefined} aria-expanded={expanded} aria-controls="intelligence-workspace"
    aria-label={pick(zh, "Open Intelligence workspace", "打开情报工作区")}>
    <span className={styles.heading}>
      <span className={styles.identity}><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.35" aria-hidden="true"><path d="M3 13V7l7-4 7 4v6l-7 4-7-4Z" /><path d="m3 7 7 4 7-4M10 11v6" /></svg>{pick(zh, "Intelligence", "情报")}</span>
      <svg className={styles.chevron} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m12 5-5 5 5 5" /></svg>
    </span>
    <span className={styles.sources}>
      {([{ source: oracle, name: pick(zh, "Oracle", "神谕"), cls: "sig-btn-go" }, { source: desk, name: pick(zh, "Research", "研究"), cls: "sig-btn-rd" }]).map(({ source, name, cls }) =>
        <span key={cls} className={`${styles.source} ${cls}${source.blocked ? " sig-btn-blocked" : ""}`} style={{ "--vc": source.color } as CSSProperties}>
          <span className={styles.label}>{name}</span>
          <span className={`${styles.reading} sig-btn-vd`} data-dim={source.dim || source.stance || undefined}>{(source === oracle ? oracleRead.label : source.label)}</span>
          <span className={`${styles.date} sig-btn-sub`}>{(source === oracle ? (oracle.stance && oracle.historicalSignal ? `${pick(zh, "Historical signal", "历史信号")}: ${oracle.historicalSignal.label} · ${oracle.historicalSignal.date}` : oracleRead.sub) : source.sub) || (pick(zh, "View details", "查看详情"))}</span>
        </span>)}
    </span>
    <span className={styles.entry} data-testid="oracle-entry-availability" data-status={entry.status}>
      <span className={styles.entryLabel}>{pick(zh, "Entry status now", "当前入场状态")}</span>
      <span className={styles.entryValue}>{entry.label}</span>
      <span className={styles.entryReason}>{entry.reason}</span>
    </span>
    {early && <span className={styles.prophet} data-testid="prophet-observation-launcher">
      <span className={styles.prophetLabel}>Prophet</span>
      <span className={styles.prophetReading} data-current={early.current || undefined}>{early.label}</span>
      {early.detail && <span className={styles.prophetDate}>
        <span className={styles.fullDetail}>{early.detail}</span>
        <span className={styles.sourceDate}>{prophet?.data?.clocks.source_session}</span>
      </span>}
    </span>}
  </button>;
}
