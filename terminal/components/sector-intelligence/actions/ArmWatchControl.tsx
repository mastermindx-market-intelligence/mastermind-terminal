"use client";
/**
 * Arm a price watch over a saved Sector Intelligence investigation revision. The
 * condition is built by the existing pure builder (buildWatchCondition) and armed
 * through the incumbent alerts owner (POST /api/alerts) — no new alert transport, no new
 * evaluator, and only the kinds the owner can actually evaluate. New Sector alert
 * predicates stay UNAVAILABLE: this control offers price_touch only. The watch is a
 * separate effect from the save: a failed or refused watch never touches the
 * investigation revision.
 */
import { useState } from "react";
import { buildWatchCondition, WATCH_KINDS_OFFERED, type WatchLink } from "@/lib/investigationWatch";
import styles from "./actions.module.css";

export interface ArmWatchCopy {
  title: string;
  threshold: string;
  arm: string;
  arming: string;
  armed: (symbol: string, plain: string) => string;
  refused: (plain: string) => string;
  unavailable: string;
  signedOut: string;
}

export interface ArmWatchControlProps {
  principal: string | null;
  link: WatchLink;
  symbol: string;
  lang: "en" | "zh";
  copy: Record<"en" | "zh", ArmWatchCopy>;
}

export type ArmWatchPhase =
  | { phase: "idle" }
  | { phase: "busy" }
  | { phase: "armed"; symbol: string; plain: string }
  | { phase: "refused"; plain: string }
  | { phase: "unavailable" };

export async function postWatchCondition(symbol: string, condition: unknown): Promise<Response | null> {
  try {
    return await fetch("/api/alerts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ symbol, condition }) });
  } catch { return null; }
}

export function ArmWatchControl({ principal, link, symbol, lang, copy }: ArmWatchControlProps) {
  const [threshold, setThreshold] = useState("");
  const [op, setOp] = useState<"above" | "below">("above");
  const [phase, setPhase] = useState<ArmWatchPhase>({ phase: "idle" });
  const text = copy[lang];

  const onArm = async () => {
    if (!principal) return;
    const value = Number(threshold);
    const built = buildWatchCondition(link, symbol, "price_touch", { op, value });
    if (!built.ok) { setPhase({ phase: "refused", plain: built.plain[lang] }); return; }
    setPhase({ phase: "busy" });
    const res = await postWatchCondition(built.symbol, built.condition);
    if (!res || !res.ok) { setPhase({ phase: "unavailable" }); return; }
    const body = await res.json().catch(() => null);
    const alert = body && typeof body === "object" ? (body as { alert?: unknown }).alert : null;
    if (!alert || typeof alert !== "object") { setPhase({ phase: "unavailable" }); return; }
    setPhase({ phase: "armed", symbol: built.symbol, plain: built.plain[lang] });
  };

  const label = !principal ? text.signedOut
    : phase.phase === "armed" ? text.armed(phase.symbol, phase.plain)
    : phase.phase === "refused" ? text.refused(phase.plain)
    : phase.phase === "unavailable" ? text.unavailable
    : "";
  return (
    <span className={styles.row}>
      <label className={styles.field}>
        {text.threshold}
        <input
          inputMode="decimal" type="number" min="0" step="any" value={threshold}
          aria-label={text.threshold} onChange={event => setThreshold(event.target.value)}
        />
      </label>
      <label className={styles.srOnly} htmlFor={`si-watch-op-${link.investigation_id}`}>
        {text.title}
      </label>
      <select
        id={`si-watch-op-${link.investigation_id}`} className={styles.button} value={op}
        onChange={event => setOp(event.target.value === "below" ? "below" : "above")}
      >
        <option value="above">↗</option>
        <option value="below">↘</option>
      </select>
      <button type="button" className={styles.button} onClick={onArm} disabled={!principal || phase.phase === "busy"}>
        {phase.phase === "busy" ? text.arming : text.arm}
      </button>
      {label ? <p className={styles.status} role="status">{label}</p> : null}
    </span>
  );
}

/** What this surface offers: exactly the kinds the incumbent owner can evaluate today. */
export const SECTOR_WATCH_KINDS_OFFERED = WATCH_KINDS_OFFERED.filter(kind => kind === "price_touch");
