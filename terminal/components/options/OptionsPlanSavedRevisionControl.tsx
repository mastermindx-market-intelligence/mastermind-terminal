"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { InvestigationOptionPlanRevisionReader } from "@/components/workspaces/InvestigationWorkspace";
import { OptionsPlanPayoffPanel } from "./OptionsPlanPayoffPanel";
import styles from "./ContractShortlist.module.css";

type SavedPlan = NonNullable<ReturnType<InvestigationOptionPlanRevisionReader>>;
type OpenedPlan = { value: SavedPlan; serial: number };

/** A revoked reader must retire the working copy, even when the next reader
 * selects the same investigation and revision. The workspace owns its validity. */
export function usePlanRevisionBinding() {
  const [binding, setBinding] = useState<{ read: InvestigationOptionPlanRevisionReader | null; generation: number }>({ read: null, generation: 0 });
  const bind = useCallback((read: InvestigationOptionPlanRevisionReader | null) => {
    setBinding(previous => previous.read === read ? previous : { read, generation: previous.generation + 1 });
  }, []);
  return { binding, bind };
}

export function savedPlanUnavailableNotice(lang: "en" | "zh"): string {
  return lang === "zh" ? "此保存版本的计划输入暂不可用。" : "Plan inputs are unavailable for this saved revision.";
}

type Props = {
  lang: "en" | "zh";
  /** The workspace's own onOptionPlanRevisionReady guard: {id,revision,plan} or null. */
  read: InvestigationOptionPlanRevisionReader | null;
  /** Outer scope currency (embedded selection scope or canonical route session). */
  isBaseScopeCurrent?: () => boolean;
  scopeParts: readonly (string | number | null)[];
  /** "reader-present" keeps the embedded affordance; "valid-plan-only" renders
   * the canonical button only while the reader reports an actual valid saved plan. */
  buttonPolicy: "reader-present" | "valid-plan-only";
  onUnavailable: () => void;
  onOpened: () => void;
  /** The embedded transfer control shares the same action tray. */
  actions?: ReactNode;
  children?: ReactNode;
};

/** The one saved-Plan revision reopen definition, shared by the embedded Options
 * bridge and the canonical /analysis Investigation route. No Save command, journal,
 * auth subscription or recalculation is owned here: reopening only reads the
 * workspace's own exact-revision guard, opened inputs are working copies, and the
 * payoff panel calculates only when asked. */
export function OptionsPlanSavedRevisionControl({ lang, read, isBaseScopeCurrent, scopeParts, buttonPolicy, onUnavailable, onOpened, actions, children }: Props) {
  const [opened, setOpened] = useState<OpenedPlan | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (opened) heading.current?.focus(); }, [opened]);
  const close = () => { setOpened(null); trigger.current?.focus(); };
  const t = (en: string, zh: string) => lang === "zh" ? zh : en;
  const reopen = () => {
    if (isBaseScopeCurrent && !isBaseScopeCurrent()) { setOpened(null); onUnavailable(); return; }
    const value = read?.();
    if (!value) { setOpened(null); onUnavailable(); return; }
    setOpened(previous => ({ value, serial: (previous?.serial ?? 0) + 1 }));
    onOpened();
  };
  // Canonical policy: the button exists only on an actual valid saved plan —
  // never a head fallback or a fabricated revision.
  const availablePlan = buttonPolicy === "valid-plan-only" && read ? read() : null;
  const showButton = buttonPolicy === "reader-present" || (!!read && !!availablePlan);
  return <>
    {(actions || showButton) && <div className={styles.trayActions}>
      {actions}
      {showButton && <button ref={trigger} type="button" className={`chip ${styles.planControl}`} disabled={!read} aria-expanded={opened !== null} onClick={reopen}>
        {t("Open saved Plan inputs", "打开已保存计划输入")}
      </button>}
    </div>}
    {children}
    {opened && <section data-testid="saved-plan-inputs" data-investigation-id={opened.value.id} data-investigation-revision={opened.value.revision}>
      <h3 ref={heading} tabIndex={-1}>{t("Plan inputs from saved research revision", "来自已保存研究版本的计划输入")} {opened.value.revision}</h3>
      <p className={styles.hint}>{t("Editing these working inputs or calculating again does not change the saved research. Calculation uses newly shown dated terms only when you request it.", "编辑这些临时输入或重新计算不会改变已保存研究，只有主动请求计算时才使用新显示的带日期条款。")}</p>
      <OptionsPlanPayoffPanel key={JSON.stringify([opened.value.id, opened.value.revision, opened.serial])}
        draft={opened.value.plan} lang={lang} isScopeCurrent={() => {
          if (isBaseScopeCurrent && !isBaseScopeCurrent()) return false;
          const value = read?.();
          return !!value && value.id === opened.value.id && value.revision === opened.value.revision;
        }} scopeKey={JSON.stringify([...scopeParts, opened.value.id, opened.value.revision, opened.serial])}
        onDraftChange={() => {}} onClose={close} />
    </section>}
  </>;
}
