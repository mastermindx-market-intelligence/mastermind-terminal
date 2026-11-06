"use client";

import { Suspense, useEffect, useId, useRef, useState, type ComponentProps, type ReactNode } from "react";
import InvestigationWorkspaceMount from "@/components/mounts/InvestigationWorkspaceMount";
import styles from "./ContractShortlist.module.css";

type Props = {
  /** The authenticated host supplies the current native owner, never a Plan field. */
  workspaceProps: ComponentProps<typeof InvestigationWorkspaceMount>;
  scopeKey: string;
  selectionKey: string;
  lang: "en" | "zh";
  /** The admitted owner's explicit transfer control belongs beside native New research. */
  children?: ReactNode;
};

/** Keyed native research frame. It owns visibility and focus; the composed
 * bridge supplies the reviewed native admission and exact-revision interfaces.
 * New research, Save and routing remain with the existing native owner. */
export function OptionsPlanInvestigationHost(props: Props) {
  return <ResearchSession key={JSON.stringify([props.workspaceProps.ownerKey, props.scopeKey, props.selectionKey])} {...props} />;
}

function ResearchSession({ workspaceProps, lang, children }: Props) {
  const [open, setOpen] = useState(false), [started, setStarted] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null), heading = useRef<HTMLHeadingElement>(null);
  const id = useId(), t = (en: string, zh: string) => lang === "zh" ? zh : en;
  useEffect(() => { if (open) { heading.current?.focus(); heading.current?.scrollIntoView({ block: "nearest" }); } }, [open]);
  const close = () => {
    setOpen(false); trigger.current?.focus({ preventScroll: true });
    trigger.current?.scrollIntoView({ block: "nearest" });
  };
  return <section data-testid="options-plan-investigation-host">
    <button ref={trigger} type="button" className={`chip ${styles.planControl}`} disabled={!workspaceProps.ownerKey}
      aria-expanded={open} aria-controls={id} onClick={open ? close : () => { setStarted(true); setOpen(true); }}>
      {open ? t("Back to Plan", "返回计划") : t("Open saved research", "打开已保存研究")}
    </button>
    {started && <div id={id} hidden={!open}>
      <h2 ref={heading} tabIndex={-1}>{t("Plan and saved research", "计划与已保存研究")}</h2>
      <p className={styles.hint}>{t("Start a new research draft here before adding Plan inputs. A saved Plan keeps your inputs; calculate again explicitly to use newly shown dated terms.", "请先在此开始新的研究草稿，再添加计划输入。保存的计划保留输入；请主动重新计算，以使用新显示的带日期条款。")}</p>
      {children}
      <Suspense fallback={<p role="status">{t("Loading saved research…", "正在加载已保存研究…")}</p>}>
        <InvestigationWorkspaceMount {...workspaceProps} />
      </Suspense>
      <button type="button" className={`chip ${styles.planControl}`} onClick={close}>{t("Back to Plan", "返回计划")}</button>
    </div>}
  </section>;
}
