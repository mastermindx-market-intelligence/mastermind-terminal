"use client";
/**
 * Save a Sector Intelligence reading as a durable Investigation v2 revision — the SAME
 * store, journal, evidence-diff and immutable history every other investigation uses
 * (packet SI-P16-LANE6). Props-only: the workspace owns every string, the manifest
 * command and the actor header; this component owns only the save state machine and
 * the fetch call. A lost reply never reads as failure — the surface keeps the exact
 * sent operation, offers Check save status + Retry, and retires its visible scope when
 * the principal changes (partitionInvestigationSave).
 */
import { useEffect, useState } from "react";
import {
  beginInvestigationSave, partitionInvestigationSave, retryInvestigationSave, settleInvestigationSave,
  type InvestigationSaveState,
} from "@/lib/investigationSave";
import type { InvestigationCommand } from "@/lib/investigations";
import styles from "./actions.module.css";

export interface SaveInvestigationCopy {
  save: string;
  saving: string;
  unconfirmed: string;
  retry: string;
  saved: (revision: number) => string;
  rejected: (reason: string) => string;
  signedOut: string;
}

export interface SaveInvestigationButtonProps {
  principal: string | null;
  command: InvestigationCommand;
  previous?: InvestigationSaveState;
  lang: "en" | "zh";
  copy: Record<"en" | "zh", SaveInvestigationCopy>;
  /** Persisted by the caller (its journal owns cross-render recovery); called on every state change. */
  onStateChange?: (state: InvestigationSaveState) => void;
}

export function SaveInvestigationButton({ principal, command, previous, lang, copy, onStateChange }: SaveInvestigationButtonProps) {
  const [state, setState] = useState<InvestigationSaveState>(() => partitionInvestigationSave(previous ?? { phase: "idle" }, principal));
  const [inFlight, setInFlight] = useState(false);
  const text = copy[lang];
  useEffect(() => { onStateChange?.(state); }, [state, onStateChange]);

  const send = async (toSend: InvestigationCommand) => {
    setInFlight(true);
    let response: unknown = null;
    try {
      const res = await fetch("/api/investigations", {
        method: "POST",
        headers: { "content-type": "application/json", ...(principal ? { "x-mm-investigation-owner": principal } : {}) },
        body: JSON.stringify(toSend),
      });
      response = await res.json().catch(() => null);
    } catch { response = null; }
    setInFlight(false);
    if (principal) setState(current => settleInvestigationSave(current, principal, response));
  };

  const onSave = () => {
    if (!principal) return;
    const next = beginInvestigationSave(principal, command, state);
    setState(next);
    const toSend = retryInvestigationSave(next, principal);
    if (toSend) void send(toSend);
  };
  const onRetry = () => {
    if (!principal) return;
    const toSend = retryInvestigationSave(state, principal);
    if (toSend && state.phase !== "pending") void send(toSend);
  };

  const label = !principal ? text.signedOut
    : state.phase === "committed" ? text.saved(state.result.revision)
    : state.phase === "rejected" ? text.rejected(state.reason)
    : state.phase === "pending" || state.phase === "uncertain" ? text.unconfirmed
    : text.save;
  const canSave = !!principal && state.phase !== "pending" && state.phase !== "uncertain" && state.phase !== "committed";
  const canRetry = !!principal && state.phase === "uncertain" && !inFlight;

  return (
    <span className={styles.row}>
      <button type="button" className={styles.button} onClick={onSave} disabled={!canSave || inFlight}>{state.phase === "idle" ? text.save : text.saving}</button>
      {canRetry ? <button type="button" className={`${styles.button} ${styles.ghost}`} onClick={onRetry}>{text.retry}</button> : null}
      <p className={styles.status} role="status">{label}</p>
    </span>
  );
}
