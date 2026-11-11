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
  // R4 residue (third review, item 4): the JOURNAL is the caller-owned
  // recovery record (seeded from `previous`, reported raw to the caller so it
  // survives this component unmounting — the admission gate's principal-change
  // beat unmounts it); the VIEW is partitioned per render, so a journal owned
  // by a switched-out principal reads idle here — its Check/Retry/labels never
  // surface under the next account, and the actor's own scope returns with
  // them (partitionInvestigationSave, the module's own law).
  const [journal, setJournal] = useState<InvestigationSaveState>(previous ?? { phase: "idle" });
  const state = partitionInvestigationSave(journal, principal);
  // r4 N-7: the in-flight flag is PER ACCOUNT, keyed by the actor that raised
  // it. A's pending POST may still be riding when the surface re-binds to B —
  // B's Save is never disabled by A's flight, and A's late reply clears only
  // A's own flag, never one B raised meanwhile.
  const [inFlightFor, setInFlightFor] = useState<string | null>(null);
  const inFlight = principal !== null && inFlightFor === principal;
  const text = copy[lang];
  useEffect(() => { onStateChange?.(journal); }, [journal, onStateChange]);

  const send = async (toSend: InvestigationCommand) => {
    const actor = principal;
    setInFlightFor(actor);
    let response: unknown = null;
    try {
      const res = await fetch("/api/investigations", {
        method: "POST",
        headers: { "content-type": "application/json", ...(actor ? { "x-mm-investigation-owner": actor } : {}) },
        body: JSON.stringify(toSend),
      });
      response = await res.json().catch(() => null);
    } catch { response = null; }
    setInFlightFor(current => current === actor ? null : current);
    if (actor) setJournal(current => settleInvestigationSave(current, actor, response));
  };

  const onSave = () => {
    if (!principal) return;
    const next = beginInvestigationSave(principal, command, state);
    setJournal(next);
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
