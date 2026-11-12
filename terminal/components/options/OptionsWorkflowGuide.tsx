"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLang, useT } from "@/lib/i18n";
import type { OptionsWorkspaceViewKey } from "@/lib/optionsIa";

const STORAGE_KEY = "mm.optionsWorkflow.v1";
const STAGE_IDS = ["tape", "structure", "plan", "alert"] as const;

type StageId = (typeof STAGE_IDS)[number];

interface WorkflowStage {
  id: StageId;
  titleKey: string;
  bodyKey: string;
  contextKey: string;
  ctaKey: string;
  view?: OptionsWorkspaceViewKey;
  href?: string;
}

interface OptionsWorkflowGuideProps {
  activeView: OptionsWorkspaceViewKey;
  onOpenView: (view: OptionsWorkspaceViewKey) => void;
}

const STAGES: readonly WorkflowStage[] = [
  {
    id: "tape",
    titleKey: "optionsWorkflowTapeTitle",
    bodyKey: "optionsWorkflowTapeBody",
    contextKey: "optionsWorkflowTapeReceipt",
    ctaKey: "optionsWorkflowTapeCta",
    view: "tape",
  },
  {
    id: "structure",
    titleKey: "optionsWorkflowStructureTitle",
    bodyKey: "optionsWorkflowStructureBody",
    contextKey: "optionsWorkflowStructureReceipt",
    ctaKey: "optionsWorkflowStructureCta",
    view: "gex",
  },
  {
    id: "plan",
    titleKey: "optionsWorkflowPlanTitle",
    bodyKey: "optionsWorkflowPlanBody",
    contextKey: "optionsWorkflowPlanReceipt",
    ctaKey: "optionsWorkflowPlanCta",
    view: "payoff",
  },
  {
    id: "alert",
    titleKey: "optionsWorkflowAlertTitle",
    bodyKey: "optionsWorkflowAlertBody",
    contextKey: "optionsWorkflowAlertReceipt",
    ctaKey: "optionsWorkflowAlertCta",
    href: "/alerts?cat=options&root=SPY&kind=opt_gamma_flip",
  },
];

const PLAN_COPY = {
  en: {
    title: "Shape the payoff",
    body: "Enter the option legs and premiums you want to examine. Payoff Lab calculates expiration-only cashflow, break-even, and bounded or unlimited risk without inferring a quote, probability, or trade recommendation.",
    receipt: "Payoff Lab · manual legs · expiration-only math",
    cta: "Open Payoff Lab",
  },
  zh: {
    title: "构建到期收益",
    body: "输入你要检查的期权腿和权利金。到期收益实验室只计算到期现金流、盈亏平衡和有限或无限风险，不推断报价、概率或交易建议。",
    receipt: "到期收益实验室 · 手动期权腿 · 仅到期计算",
    cta: "打开到期收益",
  },
} as const;

const STAGE_FOR_VIEW: Partial<Record<OptionsWorkspaceViewKey, StageId>> = {
  tape: "tape",
  tide: "tape",
  zero_dte: "tape",
  largest: "tape",
  screener: "tape",
  tickers: "tape",
  surface: "tape",
  gex: "structure",
  positioning: "structure",
  levels: "structure",
  structure: "structure",
  volatility: "structure",
  payoff: "plan",
};

function loadVisited(): StageId[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") as unknown;
    if (!parsed || typeof parsed !== "object") return [];
    const raw = (parsed as { visited?: unknown }).visited;
    if (!Array.isArray(raw)) return [];
    return STAGE_IDS.filter((id) => raw.includes(id));
  } catch {
    return [];
  }
}

function saveVisited(visited: readonly StageId[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, visited }));
  } catch {}
}

export default function OptionsWorkflowGuide({ activeView, onOpenView }: OptionsWorkflowGuideProps) {
  const t = useT();
  const { lang } = useLang();
  const [open, setOpen] = useState(false);
  const [visited, setVisited] = useState<StageId[]>([]);
  const launcherRef = useRef<HTMLButtonElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  const activeStage = STAGE_FOR_VIEW[activeView];
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const stored = loadVisited();
      const next = activeStage
        ? STAGE_IDS.filter((id) => stored.includes(id) || id === activeStage)
        : stored;
      saveVisited(next);
      setVisited(next);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeStage]);

  useEffect(() => {
    if (!open) return;
    const restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus());
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = closeRef.current?.closest<HTMLElement>('[role="dialog"]');
      const focusable = dialog
        ? [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')]
        : [];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKey);
      if (restoreFocus?.isConnected) restoreFocus.focus();
    };
  }, [open]);

  const nextStage = useMemo(
    () => STAGES.find((stage) => !visited.includes(stage.id))?.id ?? null,
    [visited],
  );
  const viewedProgress = lang === "zh"
    ? `${t("optionsWorkflowViewedShort")} ${visited.length}/4`
    : `${visited.length}/4 ${t("optionsWorkflowViewedShort")}`;

  const visit = (id: StageId) => {
    setVisited((current) => {
      if (current.includes(id)) return current;
      const next = STAGE_IDS.filter((stageId) => current.includes(stageId) || stageId === id);
      saveVisited(next);
      return next;
    });
  };

  const openStage = (stage: WorkflowStage) => {
    visit(stage.id);
    setOpen(false);
    if (stage.href) {
      window.location.assign(stage.href);
      return;
    }
    if (stage.view) onOpenView(stage.view);
  };

  return (
    <>
      <button
        ref={launcherRef}
        type="button"
        className="options-workflow-launch"
        data-options-workflow-guide="launcher"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${t("optionsWorkflowOpenAria")} · ${viewedProgress}`}
        onClick={() => setOpen(true)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 6h10M5 12h8M5 18h6" />
          <path d="m16 16 2 2 3-4" />
        </svg>
        <span className="options-workflow-launch-label">{t("optionsWorkflowOpen")}</span>
        <span className="options-workflow-progress" aria-hidden="true">{viewedProgress}</span>
      </button>

      {open && (
        <div
          className="options-workflow-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <section
            className="options-workflow-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="options-workflow-title"
            data-options-workflow-guide="dialog"
          >
            <header className="options-workflow-head">
              <div>
                <span>{t("optionsWorkflowEyebrow")}</span>
                <h2 id="options-workflow-title">{t("optionsWorkflowTitle")}</h2>
                <p>{t("optionsWorkflowSubtitle")}</p>
              </div>
              <button
                ref={closeRef}
                type="button"
                className="options-workflow-close"
                aria-label={t("optionsWorkflowClose")}
                onClick={() => setOpen(false)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
              </button>
            </header>

            <div className="options-workflow-rail" aria-label={t("optionsWorkflowStepsAria")}>
              {STAGES.map((stage, index) => {
                const viewed = visited.includes(stage.id);
                const current = activeStage === stage.id;
                const next = nextStage === stage.id;
                return (
                  <article
                    key={stage.id}
                    className={`options-workflow-step${viewed ? " is-viewed" : ""}${current ? " is-current" : ""}${next ? " is-next" : ""}`}
                    data-options-workflow-stage={stage.id}
                  >
                    <div className="options-workflow-step-index" aria-hidden="true">
                      {String(index + 1).padStart(2, "0")}
                    </div>
                    <div className="options-workflow-step-copy">
                      <div className="options-workflow-step-title">
                        <h3>{stage.id === "plan" ? PLAN_COPY[lang].title : t(stage.titleKey)}</h3>
                        {current && <span>{t("optionsWorkflowCurrent")}</span>}
                        {viewed && <span className="is-viewed-label">{t("optionsWorkflowViewedHere")}</span>}
                      </div>
                      <p>{stage.id === "plan" ? PLAN_COPY[lang].body : t(stage.bodyKey)}</p>
                      <small>{stage.id === "plan" ? PLAN_COPY[lang].receipt : t(stage.contextKey)}</small>
                    </div>
                    <button
                      type="button"
                      className="options-workflow-step-cta"
                      onClick={() => openStage(stage)}
                    >
                      {current && stage.id !== "alert"
                        ? t("optionsWorkflowReopenCta")
                        : stage.id === "plan" ? PLAN_COPY[lang].cta : t(stage.ctaKey)}
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
                    </button>
                  </article>
                );
              })}
            </div>

            <footer className="options-workflow-foot">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
              <span>{t("optionsWorkflowAuthority")}</span>
              <code>{lang === "zh" ? "仅供展示" : "display_only"}</code>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}
