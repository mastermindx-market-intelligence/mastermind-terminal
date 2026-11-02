"use client";

import { useCallback, useState, type ComponentProps } from "react";
import type InvestigationWorkspaceMount from "@/components/mounts/InvestigationWorkspaceMount";
import type { InvestigationOptionPlanEntry, InvestigationOptionPlanRevisionReader } from "@/components/workspaces/InvestigationWorkspace";
import type { OptionsPlanDraft } from "@/lib/optionsPlanDraft";
import { OptionsPlanInvestigationHost } from "./OptionsPlanInvestigationHost";
import { OptionsPlanSavedRevisionControl, usePlanRevisionBinding } from "./OptionsPlanSavedRevisionControl";
import styles from "./ContractShortlist.module.css";

type Props = {
  workspaceProps: Omit<ComponentProps<typeof InvestigationWorkspaceMount>,
    "historyMode" | "onOptionPlanAdmissionReady" | "onOptionPlanRevisionReady">;
  scopeKey: string; selectionKey: string; lang: "en" | "zh";
  candidate: OptionsPlanDraft | null;
  isScopeCurrent: () => boolean;
};

/** No Save command, journal, auth subscription or recalculation is owned here. */
export function OptionsPlanResearchBridge(props: Props) {
  return <ResearchBridgeSession key={JSON.stringify([props.workspaceProps.ownerKey, props.scopeKey, props.selectionKey])} {...props} />;
}
function ResearchBridgeSession({ workspaceProps, scopeKey, selectionKey, lang, candidate, isScopeCurrent }: Props) {
  const [admit, setAdmit] = useState<InvestigationOptionPlanEntry | null>(null);
  const { binding, bind } = usePlanRevisionBinding();
  const [notice, setNotice] = useState<{ kind: "added"; draft: InvestigationOptionPlanEntry } | { kind: "unavailable" } | null>(null);
  const onAdmissionReady = useCallback((value: InvestigationOptionPlanEntry | null) => {
    setAdmit(() => value); setNotice(null);
  }, []);
  const onRevisionReady = useCallback((value: InvestigationOptionPlanRevisionReader | null) => {
    bind(value); setNotice(null);
  }, [bind]);
  const t = (en: string, zh: string) => lang === "zh" ? zh : en;
  const add = () => {
    if (!admit || !candidate) return;
    if (!isScopeCurrent()) { setNotice({ kind: "unavailable" }); return; }
    // The native callback rechecks its owner/epoch/ticket before and after
    // validating and detaching the whole candidate. Later edits cannot replace it.
    const result = admit(candidate);
    setNotice(result.ok ? { kind: "added", draft: admit } : { kind: "unavailable" });
  };
  return <OptionsPlanInvestigationHost workspaceProps={{ ...workspaceProps, historyMode: "embedded",
    onOptionPlanAdmissionReady: onAdmissionReady, onOptionPlanRevisionReady: onRevisionReady }}
    scopeKey={scopeKey} selectionKey={selectionKey} lang={lang}>
    <OptionsPlanSavedRevisionControl key={binding.generation} lang={lang} read={binding.read} buttonPolicy="reader-present"
      isBaseScopeCurrent={isScopeCurrent} scopeParts={[scopeKey, selectionKey]}
      onUnavailable={() => setNotice({ kind: "unavailable" })} onOpened={() => setNotice(null)}
      actions={<button type="button" className={`chip ${styles.planControl}`} disabled={!admit || !candidate} onClick={add}>
        {t("Add Plan inputs to new research", "将计划输入添加到新研究")}
      </button>}>
      {notice && (notice.kind !== "added" || notice.draft === admit) && <p role="status" className={styles.hint}>{notice.kind === "added"
        ? t("Plan inputs copied into this research draft. Use Save research explicitly. Later Plan edits do not change this copy.", "计划输入已复制到此研究草稿。请主动保存研究，之后的计划编辑不会改变此副本。")
        : t("This research session is unavailable. Open the current record or start a new research draft before trying the transfer.", "此研究会话不可用。请打开当前记录或开始新的研究草稿后再主动添加。")}</p>}
    </OptionsPlanSavedRevisionControl>
  </OptionsPlanInvestigationHost>;
}
