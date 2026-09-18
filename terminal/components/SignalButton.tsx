import styles from "./fin/StockIntelligence.module.css"
import { useLang } from "@/lib/i18n"

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
}

export default function SignalButton({ oracle, desk, oracleLabel, deskLabel, viewLabel, onView }: Props) {
  const { lang } = useLang();
  const workspaceLabel = lang === "zh" ? "个股情报" : "Stock Intelligence";
  const title =
    workspaceLabel + " · " +
    oracleLabel + (oracle.note ? ` — ${oracle.note}` : "") +
    " · " +
    deskLabel + (desk.note ? ` — ${desk.note}` : "");
  const oracleCls =
    "sig-btn-half sig-btn-go" +
    (oracle.stance ? " sig-btn-stance" : oracle.soft ? " sig-btn-soft" : oracle.dim ? " sig-btn-stale" : "") +
    (oracle.blocked ? " sig-btn-blocked" : "");
  return (
    <button type="button" className={`sig-btn ${styles.launcher}`} onClick={onView} title={title} aria-haspopup="dialog" aria-label={`${workspaceLabel}. ${oracleLabel}: ${oracle.label}. ${deskLabel}: ${desk.label}. ${viewLabel}`}>
      <span className={styles.launcherHeader}>
        <span className={styles.launcherTitle} data-stock-intelligence-launcher-title>{workspaceLabel}</span>
        <span className={styles.launcherAction}>{viewLabel}<span aria-hidden="true">↗</span></span>
      </span>
      <span className={styles.launcherSources}>
        <span className={oracleCls} style={{ ["--vc" as any]: oracle.color }}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 2l2.2 5.8L20 10l-5.8 2.2L12 18l-2.2-5.8L4 10l5.8-2.2z" fill="var(--vc)" />
          </svg>
          <span className="sig-btn-lbl">{oracleLabel}</span>
          <span className="sig-btn-vwrap">
            <span className="sig-btn-vd">{oracle.label}</span>
            <span className="sig-btn-sub">{oracle.sub || " "}</span>
          </span>
        </span>
        <span className={"sig-btn-half sig-btn-rd" + (desk.dim ? " sig-btn-stale" : "")} style={{ ["--vc" as any]: desk.color }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="var(--vc)" strokeWidth={2} aria-hidden="true">
            <path d="M4 19V5M4 19h16M8 15l3-4 3 2 4-6" />
          </svg>
          <span className="sig-btn-lbl">{deskLabel}</span>
          <span className="sig-btn-vwrap">
            <span className="sig-btn-vd">{desk.label}</span>
            <span className="sig-btn-sub">{desk.sub || " "}</span>
          </span>
        </span>
      </span>
    </button>
  );
}
