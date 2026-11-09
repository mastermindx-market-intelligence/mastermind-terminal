"use client";
import { useLayoutEffect, useRef, useState } from "react";
import type { Lang } from "@/lib/i18n";
import type { MastermindBrainHost } from "@/lib/mastermindBrain";
import { isAccountOwner, ownerUserId } from "@/lib/accountIdentity";
import { acquiredMatrixBytes } from "@/lib/matrixAcquisition";
import { optionsQuestionIdentity, prepareOptionsQuestion, submitOptionsQuestion,
  type OptionsQuestionReference } from "@/lib/optionsQuestionContext";
import type { OptionsSelectionMintInput } from "@/lib/investigationEvidenceOptionsSelection";
import type { ResearchRow } from "./researchLabAdapter";
import styles from "./ResearchLab.module.css";

const coordinate = (row: ResearchRow) => ({ expiry: row.expiry, side: row.side,
  // The existing mint rejects non-canonical, excessive or exponential numbers;
  // the server still verifies this coordinate against the exact retained bytes.
  strikeToken: String(row.strike) });

/** A local question selector, not a grant or a source attachment. Reuses the
 * existing Brain singleton; only that widget's explicit Send may contact it. */
export function ResearchQuestionAction({ root, matrix, session, sourceReady, lens,
  primary, comparisons, view, ownerKey, lang }: {
  root: string; matrix: unknown; session: string | null; sourceReady: boolean;
  lens: string; primary: ResearchRow | null; comparisons: readonly ResearchRow[];
  view: OptionsSelectionMintInput["view"]; ownerKey: string | null; lang: Lang;
}) {
  const prepared = prepareOptionsQuestion({ root, session,
    matrix: sourceReady && session ? acquiredMatrixBytes(matrix, root, session) : null,
    lens, primary: primary ? coordinate(primary) : null,
    comparisons: comparisons.map(coordinate), view });
  const referenceKey = prepared.state === "prepared" ? optionsQuestionIdentity(prepared.reference) : "";
  const contextKey = JSON.stringify([ownerKey, referenceKey]);
  const staged = useRef<{ host: MastermindBrainHost; reference: OptionsQuestionReference } | null>(null);
  const [feedback, setFeedback] = useState<{ key: string; accepted: boolean } | null>(null);
  // Cleanup occurs before the newly committed selection can be acted on. An
  // old scope withdraws only its exact reference, never another panel's source.
  useLayoutEffect(() => () => {
    const owned = staged.current;
    staged.current = null;
    owned?.host.MMBrain?.clearOptionsQuestion?.(owned.reference);
  }, [contextKey]);
  const ready = prepared.state === "prepared" && ownerKey !== null && isAccountOwner(ownerKey);
  const pick = (en: string, zh: string) => lang === "zh" ? zh : en;
  const stage = () => {
    if (!ready || prepared.state !== "prepared") return;
    const host = window as unknown as MastermindBrainHost;
    // A legacy widget without withdrawal cannot safely retain this context.
    const accepted = host.MM_BRAIN_CFG?.principal === ownerUserId(ownerKey!)
      && typeof host.MMBrain?.clearOptionsQuestion === "function"
      && submitOptionsQuestion(prepared, host);
    if (accepted) staged.current = { host, reference: prepared.reference };
    setFeedback({ key: contextKey, accepted });
  };
  return <div className={styles.save} data-testid="research-question-action">
    <button type="button" disabled={!ready} onClick={stage}>
      {pick("Ask about this selection", "询问此选择")}
    </button>
    <p>{ready
      ? pick("Review your question in Brain, then send explicitly. Access is checked again before any source is used.", "在 Brain 中检查问题，再主动发送。使用任何数据前会再次核验访问权限。")
      : pick("Choose a Chain coordinate with a captured source snapshot to ask a grounded question.", "选择带有原始数据快照的期权链坐标，即可提出有据可查的问题。")}</p>
    {feedback?.key === contextKey && <p role="status">{feedback.accepted
      ? pick("Selection staged in Brain. Review and send it there.", "选择已暂存至 Brain，请在那里检查并发送。")
      : pick("Brain cannot accept this selection right now. Nothing was sent.", "Brain 暂时无法接收此选择，未发送任何内容。")}</p>}
  </div>;
}
