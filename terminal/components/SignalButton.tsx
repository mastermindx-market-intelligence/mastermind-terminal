import type { CSSProperties } from "react";
import styles from "./SignalButton.module.css";

interface Half {
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
}

export default function SignalButton({ oracle, desk, oracleLabel, deskLabel, onView, expanded = false, zh = false }: Props) {
  const title = oracleLabel + (oracle.note ? ` — ${oracle.note}` : "") + " · " + deskLabel + (desk.note ? ` — ${desk.note}` : "");
  return <button className={`sig-btn ${styles.launcher}`} onClick={onView} title={title}
    data-testid="intelligence-launcher" aria-expanded={expanded} aria-controls="intelligence-workspace"
    aria-label={zh ? "打开情报工作区" : "Open Intelligence workspace"}>
    <span className={styles.heading}>
      <span className={styles.identity}><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.35" aria-hidden="true"><path d="M3 13V7l7-4 7 4v6l-7 4-7-4Z" /><path d="m3 7 7 4 7-4M10 11v6" /></svg>{zh ? "情报" : "Intelligence"}</span>
      <svg className={styles.chevron} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m12 5-5 5 5 5" /></svg>
    </span>
    <span className={styles.sources}>
      {([{ source: oracle, name: zh ? "神谕" : "Oracle", cls: "sig-btn-go" }, { source: desk, name: zh ? "研究" : "Research", cls: "sig-btn-rd" }]).map(({ source, name, cls }) =>
        <span key={cls} className={`${styles.source} ${cls}${source.blocked ? " sig-btn-blocked" : ""}`} style={{ "--vc": source.color } as CSSProperties}>
          <span className={styles.label}>{name}</span>
          <span className={`${styles.verdict} sig-btn-vd`} data-dim={source.dim || source.stance || undefined}>{source.label}</span>
          <span className={`${styles.date} sig-btn-sub`}>{source.sub || (zh ? "查看详情" : "View details")}</span>
        </span>)}
    </span>
  </button>;
}
