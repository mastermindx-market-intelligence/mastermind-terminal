"use client";
import { useEffect, useRef, useState } from "react";
import { createOptionsPlanDraft, type OptionsPlanDraft } from "@/lib/optionsPlanDraft";
import type { ShortlistPin } from "@/lib/optionsContractShortlist";
import { OptionsPlanPayoffPanel } from "./OptionsPlanPayoffPanel";
import styles from "./ContractShortlist.module.css";

type Props = { pins: readonly ShortlistPin[]; scopeKey: string; lang: "en" | "zh"; onDraftChange?: (draft: OptionsPlanDraft) => void; onDraftInputChange?: (draft: OptionsPlanDraft | null) => void };

/** Changing the account or retained selection destroys the complete draft and
 * outstanding request controller. Compare and Show-in-list stay outside this key. */
export function OptionsShortlistPlan(props: Props) {
  return <ShortlistPlanSession key={JSON.stringify([props.scopeKey, props.pins])} {...props} />;
}
function ShortlistPlanSession({ pins, scopeKey, lang, onDraftChange, onDraftInputChange }: Props) {
  const [draft, setDraft] = useState<OptionsPlanDraft | null>(null), [invalid, setInvalid] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const t = (en: string, zh: string) => lang === "zh" ? zh : en;
  useEffect(() => () => onDraftInputChange?.(null), [onDraftInputChange]);
  useEffect(() => { if (draft) { panel.current?.focus(); panel.current?.scrollIntoView({ block: "nearest" }); } }, [draft]);
  const open = () => {
    const prepared = createOptionsPlanDraft(pins);
    if (!prepared.ok) { setInvalid(true); return; }
    setInvalid(false); setDraft(prepared.value); onDraftChange?.(prepared.value); onDraftInputChange?.(prepared.value);
  };
  const close = () => { onDraftInputChange?.(null); setDraft(null); trigger.current?.focus({ preventScroll: true }); trigger.current?.scrollIntoView({ block: "nearest" }); };
  return <div data-testid="shortlist-plan-path">
    <button ref={trigger} type="button" className={`chip ${styles.planControl}`} disabled={!pins.length}
      aria-expanded={draft !== null} onClick={draft ? close : open}>{draft ? t("Back to shortlist", "返回候选列表") : t("Plan from pinned contracts", "用固定合约创建计划")}</button>
    <p className={styles.hint}>{t("Draft only. Choose your own side, quantity and entry; no assumption is taken from a reference mark. Changing the account or pinned selection clears this draft.", "仅为草稿。请自行填写方向、数量及入场价，不会从参考价格推断假设。切换账户或固定合约范围会清除此草稿。")}</p>
    {invalid && <p role="alert" className={styles.status}>{t("Choose distinct exact contracts for one underlying to prepare a Plan. Your shortlist is unchanged.", "请选择同一标的的不同精确合约创建计划，候选列表保持不变。")}</p>}
    {draft && <div ref={panel} tabIndex={-1} role="region" aria-label={t("Plan from shortlist", "候选合约计划")}>
      <OptionsPlanPayoffPanel draft={draft} lang={lang} scopeKey={scopeKey}
        onDraftChange={value => onDraftChange?.(value)} onDraftInputChange={onDraftInputChange} onClose={close} />
    </div>}
  </div>;
}
