"use client";
/**
 * Check save status — the §3.3 receipt read for a sent investigation save. A committed
 * receipt settles the operation; `not_found` after a lost response stays uncertain
 * ("unconfirmed", never "failed"); every transport error stays uncertain too. There is
 * deliberately no Replay button: the receipt is the sole retry authority.
 */
import { useState } from "react";
import { settleInvestigationSave, type InvestigationSaveState } from "@/lib/investigationSave";
import type { InvestigationCommand } from "@/lib/investigations";
import styles from "./actions.module.css";

export interface CheckSaveStatusCopy {
  check: string;
  checking: string;
  committed: (revision: number) => string;
  unconfirmed: string;
  rejected: (reason: string) => string;
  signedOut: string;
}

export interface CheckSaveStatusButtonProps {
  principal: string | null;
  /** The sent command whose receipt is being read. */
  command: InvestigationCommand;
  state: InvestigationSaveState;
  lang: "en" | "zh";
  copy: Record<"en" | "zh", CheckSaveStatusCopy>;
  onStateChange?: (state: InvestigationSaveState) => void;
}

export async function readInvestigationReceipt(principal: string, command: InvestigationCommand): Promise<unknown> {
  try {
    const res = await fetch(`/api/investigations?operation_id=${encodeURIComponent(command.operation_id)}`, {
      headers: { "x-mm-investigation-owner": principal },
    });
    return await res.json().catch(() => null);
  } catch { return null; }
}

export function CheckSaveStatusButton({ principal, command, state, lang, copy, onStateChange }: CheckSaveStatusButtonProps) {
  const [checking, setChecking] = useState(false);
  const [answer, setAnswer] = useState<InvestigationSaveState | null>(null);
  const text = copy[lang];
  const active = state.phase === "pending" || state.phase === "uncertain";

  const onCheck = async () => {
    if (!principal || !active) return;
    setChecking(true);
    const response = await readInvestigationReceipt(principal, command);
    const settled = settleInvestigationSave(state, principal, response);
    setChecking(false);
    setAnswer(settled);
    onStateChange?.(settled);
  };

  const label = !principal ? text.signedOut
    : answer ? answer.phase === "committed" ? text.committed(answer.result.revision)
      : answer.phase === "rejected" ? text.rejected(answer.reason)
      : text.unconfirmed
    : "";
  return (
    <span className={styles.row}>
      <button type="button" className={`${styles.button} ${styles.ghost}`} onClick={onCheck} disabled={!principal || !active || checking}>
        {checking ? text.checking : text.check}
      </button>
      {label ? <p className={styles.status} role="status">{label}</p> : null}
    </span>
  );
}
