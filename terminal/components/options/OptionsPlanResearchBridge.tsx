"use client";

import { useCallback, useState, type ComponentProps } from "react";
import type InvestigationWorkspaceMount from "@/components/mounts/InvestigationWorkspaceMount";
import type { InvestigationOptionPlanEntry, InvestigationOptionPlanRevisionReader } from "@/components/workspaces/InvestigationWorkspace";
import type { OptionsPlanDraft } from "@/lib/optionsPlanDraft";
import { OptionsPlanInvestigationHost } from "./OptionsPlanInvestigationHost";
import { OptionsPlanPayoffPanel } from "./OptionsPlanPayoffPanel";
import styles from "./ContractShortlist.module.css";

type SavedPlan = NonNullable<ReturnType<InvestigationOptionPlanRevisionReader>>;
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
  const [read, setRead] = useState<InvestigationOptionPlanRevisionReader | null>(null);
  const [opened, setOpened] = useState<{ value: SavedPlan; serial: number } | null>(null);
  const [notice, setNotice] = useState<{ kind: "added"; draft: InvestigationOptionPlanEntry } | { kind: "unavailable" } | null>(null);
  const onAdmissionReady = useCallback((value: InvestigationOptionPlanEntry | null) => {
    setAdmit(() => value); setNotice(null);
  }, []);
  const onRevisionReady = useCallback((value: InvestigationOptionPlanRevisionReader | null) => {
    setRead(() => value); setOpened(null); setNotice(null);
  }, []);
  const t = (en: string, zh: string) => lang === "zh" ? zh : en;
  const add = () => {
    if (!admit || !candidate) return;
    if (!isScopeCurrent()) { setNotice({ kind: "unavailable" }); return; }
    // The native callback rechecks its owner/epoch/ticket before and after
    // validating and detaching the whole candidate. Later edits cannot replace it.
    const result = admit(candidate);
    setNotice(result.ok ? { kind: "added", draft: admit } : { kind: "unavailable" });
  };
  const reopen = () => {
    const value = isScopeCurrent() ? read?.() : null;
    if (!value) { setOpened(null); setNotice({ kind: "unavailable" }); return; }
    setOpened(previous => ({ value, serial: (previous?.serial ?? 0) + 1 }));
    setNotice(null);
  };
  return <OptionsPlanInvestigationHost workspaceProps={{ ...workspaceProps, historyMode: "embedded",
    onOptionPlanAdmissionReady: onAdmissionReady, onOptionPlanRevisionReady: onRevisionReady }}
    scopeKey={scopeKey} selectionKey={selectionKey} lang={lang}>
    <div className={styles.trayActions}>
      <button type="button" className={`chip ${styles.planControl}`} disabled={!admit || !candidate} onClick={add}>
        {t("Add Plan inputs to new research", "将计划输入添加到新研究")}
      </button>
      <button type="button" className={`chip ${styles.planControl}`} disabled={!read} onClick={reopen}>
        {t("Open saved Plan inputs", "打开已保存计划输入")}
      </button>
    </div>
    {notice && (notice.kind !== "added" || notice.draft === admit) && <p role="status" className={styles.hint}>{notice.kind === "added"
      ? t("Plan inputs copied into this research draft. Use Save research explicitly. Later Plan edits do not change this copy.", "计划输入已复制到此研究草稿。请主动保存研究，之后的计划编辑不会改变此副本。")
      : t("This research session is unavailable. Open the current record or start a new research draft before trying the transfer.", "此研究会话不可用。请打开当前记录或开始新的研究草稿后再主动添加。")}</p>}
    {opened && <section data-testid="saved-plan-inputs" data-investigation-id={opened.value.id} data-investigation-revision={opened.value.revision}>
      <h3>{t("Plan inputs from saved research revision", "来自已保存研究版本的计划输入")} {opened.value.revision}</h3>
      <p className={styles.hint}>{t("Editing these working inputs or calculating again does not change the saved research. Calculation uses newly shown dated terms only when you request it.", "编辑这些临时输入或重新计算不会改变已保存研究，只有主动请求计算时才使用新显示的带日期条款。")}</p>
      <OptionsPlanPayoffPanel key={JSON.stringify([opened.value.id, opened.value.revision, opened.serial])}
        draft={opened.value.plan} lang={lang} isScopeCurrent={() => {
          if (!isScopeCurrent()) return false;
          const current = read?.();
          return !!current && current.id === opened.value.id && current.revision === opened.value.revision;
        }} scopeKey={JSON.stringify([scopeKey, selectionKey, opened.value.id, opened.value.revision, opened.serial])}
        onDraftChange={() => {}} onClose={() => setOpened(null)} />
    </section>}
  </OptionsPlanInvestigationHost>;
}
