"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { FinPage } from "./finPages";
import { pick } from "../../lib/finFormat";
import {
  defaultPageForFamily,
  familyForPage,
  FIN_FAMILY_ORDER,
  FIN_FAMILY_PAGES,
  type FinFamily,
} from "./finPageFamilies";

const FAMILY_LABELS: Record<FinFamily, [string, string]> = {
  overview: ["Overview", "概览"],
  intelligence: ["Intelligence", "公司情报"],
  financials: ["Financials", "财务"],
  earnings: ["Earnings", "盈利"],
  market: ["Market", "市场"],
  ownership: ["Ownership", "持仓"],
  lab: ["Lab", "实验室"],
};

const LOCAL_LABELS: Record<FinPage, [string, string]> = {
  overview: ["Overview", "概览"],
  intelligence: ["Intelligence", "公司情报"],
  statements: ["Statements", "报表"],
  statistics: ["Statistics", "统计"],
  revenue: ["Revenue", "营收"],
  dividends: ["Dividends", "股息"],
  compare: ["Compare", "对比"],
  earnings: ["Results", "结果"],
  forecast: ["Analyst", "分析师"],
  transcripts: ["Transcripts", "电话会"],
  technicals: ["Technicals", "技术面"],
  seasonals: ["Seasonality", "季节性"],
  ownership: ["Institutional", "机构"],
  insider: ["Insider", "内部交易"],
  lab: ["Lab", "实验室"],
};

export interface ResearchWorkspaceNavProps {
  page: FinPage;
  zh: boolean;
  onPage: (page: FinPage) => void;
  context?: ReactNode;
  actions?: ReactNode;
}

function pickLabel(labels: [string, string], zh: boolean) {
  return labels[zh ? 1 : 0];
}

export default function ResearchWorkspaceNav({ page, zh, onPage, context, actions }: ResearchWorkspaceNavProps) {
  const currentFamily = familyForPage(page);
  const localPages = FIN_FAMILY_PAGES[currentFamily];
  const [familySheetOpen, setFamilySheetOpen] = useState(false);
  const sheetRef = useRef<HTMLDialogElement | null>(null);
  const familyTriggerRef = useRef<HTMLButtonElement | null>(null);

  const familyLabel = useMemo(
    () => pickLabel(FAMILY_LABELS[currentFamily], zh),
    [currentFamily, zh],
  );

  const chooseFamily = useCallback((family: FinFamily) => {
    onPage(defaultPageForFamily(family));
    setFamilySheetOpen(false);
    if (familySheetOpen) window.requestAnimationFrame(() => familyTriggerRef.current?.focus());
  }, [onPage, familySheetOpen]);

  const chooseLocal = useCallback((next: FinPage) => {
    onPage(next);
  }, [onPage]);

  const moveFamilyFocus = useCallback((family: FinFamily, key: string) => {
    const index = FIN_FAMILY_ORDER.indexOf(family);
    const next = key === "ArrowRight" ? (index + 1) % FIN_FAMILY_ORDER.length
      : key === "ArrowLeft" ? (index - 1 + FIN_FAMILY_ORDER.length) % FIN_FAMILY_ORDER.length
        : key === "Home" ? 0 : key === "End" ? FIN_FAMILY_ORDER.length - 1 : -1;
    if (next < 0) return false;
    const target = FIN_FAMILY_ORDER[next];
    chooseFamily(target);
    window.requestAnimationFrame(() => document.getElementById(`fin-family-${target}`)?.focus());
    return true;
  }, [chooseFamily]);

  const moveLocalFocus = useCallback((current: FinPage, key: string) => {
    const index = localPages.indexOf(current);
    const next = key === "ArrowRight" ? (index + 1) % localPages.length
      : key === "ArrowLeft" ? (index - 1 + localPages.length) % localPages.length
        : key === "Home" ? 0 : key === "End" ? localPages.length - 1 : -1;
    if (next < 0) return false;
    const target = localPages[next];
    chooseLocal(target);
    window.requestAnimationFrame(() => document.getElementById(`fin-local-${target}`)?.focus());
    return true;
  }, [chooseLocal, localPages]);

  useEffect(() => {
    if (familySheetOpen) sheetRef.current?.showModal();
  }, [familySheetOpen]);

  const closeSheet = () => {
    setFamilySheetOpen(false);
    window.requestAnimationFrame(() => familyTriggerRef.current?.focus());
  };

  return (
    <>
      <nav className={`fin-research-nav${context ? " fin-research-nav--company" : ""}`} aria-label={pick(zh, "Company research navigation", "公司研究导航")}>
        {context && <div className="fin-company-control">{context}</div>}
        <div className="fin-family-tabs" role="tablist" aria-label={pick(zh, "Company pages", "公司页面")}>
          {FIN_FAMILY_ORDER.map((family) => {
            const active = family === currentFamily;
            return (
              <button
                key={family}
                id={`fin-family-${family}`}
                type="button"
                className={`fin-family-tab${active ? " on" : ""}`}
                role="tab"
                aria-selected={active}
                aria-controls="fin-active-panel"
                tabIndex={active ? 0 : -1}
                data-fin-family={family}
                onClick={() => chooseFamily(family)}
                onKeyDown={(event) => {
                  if (moveFamilyFocus(family, event.key)) event.preventDefault();
                }}
              >
                {pickLabel(FAMILY_LABELS[family], zh)}
              </button>
            );
          })}
        </div>


        <div className="fin-family-mobile-tablist" role="tablist" aria-label={pick(zh, "Company pages", "公司页面")}>
          <button
            ref={familyTriggerRef}
            type="button"
            className="fin-family-mobile-trigger"
            role="tab"
            aria-selected="true"
            aria-controls="fin-active-panel"
            aria-haspopup="dialog"
            aria-expanded={familySheetOpen}
            onClick={() => setFamilySheetOpen(true)}
          >
            <span>{familyLabel}</span>
            <span aria-hidden>⌄</span>
          </button>
        </div>
        {actions && <div className="fin-workspace-actions">{actions}</div>}
      </nav>

        {localPages.length > 1 && (
          <div className="fin-view-toolbar">
            <div className="fin-local-tabs" role="tablist" aria-label={`${familyLabel} ${pick(zh, "views", "视图")}`}>
              {localPages.map((local) => (
                <button
                  key={local}
                  id={`fin-local-${local}`}
                  type="button"
                  className={`fin-local-tab${page === local ? " on" : ""}`}
                  role="tab"
                  aria-selected={page === local}
                  aria-controls="fin-active-panel"
                  tabIndex={page === local ? 0 : -1}
                  data-fin-local={local}
                  onClick={() => chooseLocal(local)}
                  onKeyDown={(event) => {
                    if (moveLocalFocus(local, event.key)) event.preventDefault();
                  }}
                >
                  {pickLabel(LOCAL_LABELS[local], zh)}
                </button>
              ))}
            </div>
          </div>
        )}


      {familySheetOpen && (
        <dialog ref={sheetRef} onKeyDownCapture={event => {
          if (event.key === "Escape") {
            event.stopPropagation();
            event.nativeEvent.stopImmediatePropagation();
          }
        }} className="fin-family-sheet-layer" aria-label={pick(zh, "Company pages", "公司页面")} onCancel={(event) => { event.preventDefault(); closeSheet(); }}>
          <button
            type="button"
            className="fin-family-sheet-scrim"
            tabIndex={-1}
            aria-label={pick(zh, "Close company page menu", "关闭公司页面菜单")}
            onClick={() => {
              setFamilySheetOpen(false);
              window.requestAnimationFrame(() => familyTriggerRef.current?.focus());
            }}
          />
          <section className="fin-family-sheet">
            <div className="fin-family-sheet-handle" aria-hidden />
            <header>
              <div>
                <strong>{pick(zh, "Company pages", "公司页面")}</strong>
                <span>{pick(zh, "Explore this company", "探索这家公司")}</span>
              </div>
              <button
                type="button"
                className="fin-family-sheet-close"
                aria-label={pick(zh, "Close", "关闭")}
                onClick={() => {
                  setFamilySheetOpen(false);
                  window.requestAnimationFrame(() => familyTriggerRef.current?.focus());
                }}
              >
                ×
              </button>
            </header>
            <div className="fin-family-sheet-grid">
              {FIN_FAMILY_ORDER.map((family) => (
                <button
                  key={family}
                  type="button"
                  className={family === currentFamily ? "on" : ""}
                  data-fin-family-sheet={family}
                  onClick={() => chooseFamily(family)}
                >
                  <strong>{pickLabel(FAMILY_LABELS[family], zh)}</strong>
                  <span>{FIN_FAMILY_PAGES[family].map((local) => pickLabel(LOCAL_LABELS[local], zh)).join(" · ")}</span>
                </button>
              ))}
            </div>
          </section>
        </dialog>
      )}
    </>
  );
}
