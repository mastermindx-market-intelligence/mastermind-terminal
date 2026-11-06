"use client";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import Link from "next/link";
import { useFuturesText } from "@/lib/futuresUiCopy";
import { useSearchParams } from "next/navigation";
import WorkspaceTabs, { type WorkspaceTab } from "@/components/chrome/WorkspaceTabs";
import OptionsHubView, { type TabKey } from "@/components/OptionsHubView";
import OptionsStatisticsView from "@/components/options/OptionsStatisticsView";
import OptionsWorkflowGuide from "@/components/options/OptionsWorkflowGuide";
import { useLang, useT } from "@/lib/i18n";
import { optionsWorkspaceCopy } from "@/lib/optionsWorkspaceCopy";
import s from "./OptionsWorkspace.module.css";
import {
  OPTIONS_HUB_WORKSPACE_VIEWS,
  OPTIONS_IA_BY_CATEGORY,
  OPTIONS_IA_CATEGORIES,
  OPTIONS_IA_VIEW_BY_KEY,
  optionsCategoryForView,
  type OptionsCategoryKey,
  type OptionsHubWorkspaceViewKey,
  type OptionsWorkspaceViewKey,
} from "@/lib/optionsIa";

/**
 * Options workspace composer — the `/options` body.
 *
 * R5 Stage A replaces the flat twelve-pill rail with the roadmap's seven
 * categories. The category row chooses a deterministic home; the view row keeps
 * every existing pane, component, fetch, and `?tab=` contract intact. This is an
 * IA layer only: OptionsHubView remains the one implementation of every live pane.
 *
 * Reads resolve synchronously from `?tab=` on first render. Writes stay shallow
 * through native history. `statistics` is a category home with an explicit
 * validated prospective Statistics snapshot; no values are inferred from Tape.
 */

const ROUTE_VIEW: Record<string, OptionsWorkspaceViewKey> = {
  tape: "tape",
  desk: "desk",
  tide: "tide",
  "0dte": "zero_dte",
  largest: "largest",
  tickers: "tickers",
  vol: "screener",
  screener: "screener",
  gex: "gex",
  surface: "surface",
  // §5.3 compatibility: PRISM remains a read alias onto Exposure's matrix view.
  prism: "gex",
  structure: "structure",
  volatility: "volatility",
  positioning: "positioning",
  levels: "levels",
  prophet: "prophet",
  statistics: "statistics",
};

const CATEGORY_TABS: WorkspaceTab[] = OPTIONS_IA_CATEGORIES.map((category) => ({
  key: `cat-${category.key}`,
  labelKey: category.labelKey,
}));

const CATEGORY_BY_TAB = Object.fromEntries(
  OPTIONS_IA_CATEGORIES.map((category) => [`cat-${category.key}`, category.key]),
) as Record<string, OptionsCategoryKey>;

const RESEARCH_ALLOWED: TabKey[] = [...OPTIONS_HUB_WORKSPACE_VIEWS];
const DEFAULT_VIEW: OptionsHubWorkspaceViewKey = "tape";
const FUNDAMENTALS_HREF = "/analysis";

function readTabFromUrl() {
  return new URLSearchParams(window.location.search).get("tab");
}

function writeTabToUrl(pageKey: string) {
  const url = new URL(window.location.href);
  if (url.searchParams.get("tab") === pageKey) return;
  url.searchParams.set("tab", pageKey);
  window.history.pushState(null, "", url.toString());
}

export default function OptionsWorkspace() {
  const { lang } = useLang();
  const t = useT();
  const futuresText = useFuturesText();
  const searchParams = useSearchParams();
  const routerQuery = searchParams.toString();
  const tabListeners = useRef(new Set<() => void>());
  const subscribeToTab = useCallback((listener: () => void) => {
    const listeners = tabListeners.current;
    listeners.add(listener);
    window.addEventListener("popstate", listener);
    return () => {
      listeners.delete(listener);
      window.removeEventListener("popstate", listener);
    };
  }, []);
  const notifyTabChange = useCallback(() => {
    for (const listener of tabListeners.current) listener();
  }, []);
  // Next propagates native history through a transition, which a cold desk can
  // suspend. Observe the browser URL immediately for owned writes and history.
  const rawTab = useSyncExternalStore(subscribeToTab, readTabFromUrl, () => searchParams.get("tab"));
  // External router navigation may commit its URL after rendering searchParams.
  // Re-read that committed URL while preserving it as the single source of truth.
  useEffect(notifyTabChange, [notifyTabChange, routerQuery]);
  const activeView = rawTab && Object.hasOwn(ROUTE_VIEW, rawTab) ? ROUTE_VIEW[rawTab] : DEFAULT_VIEW;

  // Redirected legacy destinations are handled before this component in normal
  // requests. Keep a client guard for a passthrough or stale cached route.
  useEffect(() => {
    if (rawTab === "leaders" || rawTab === "radar") {
      window.location.replace(`/discover?tab=${rawTab}`);
    } else if (rawTab === "fundamentals") {
      window.location.replace(FUNDAMENTALS_HREF);
    }
  }, [rawTab]);

  const selectView = useCallback((view: OptionsWorkspaceViewKey) => {
    const pageKey = view === "statistics" ? "statistics" : OPTIONS_IA_VIEW_BY_KEY[view].pageKey;
    writeTabToUrl(pageKey);
    notifyTabChange();
  }, [notifyTabChange]);

  const activeCategory = optionsCategoryForView(activeView);
  const onCategorySelect = useCallback((categoryTab: string) => {
    const category = CATEGORY_BY_TAB[categoryTab];
    if (!category || category === activeCategory) return;
    selectView(OPTIONS_IA_BY_CATEGORY[category].defaultView);
  }, [activeCategory, selectView]);

  const onViewSelect = useCallback((pageKey: string) => {
    const view = ROUTE_VIEW[pageKey];
    if (!view || view === "statistics") return;
    selectView(view);
  }, [selectView]);

  // Hub-internal drills (for example Tape → Tickers) remain URL-addressable.
  const onHubTab = useCallback((tab: TabKey) => {
    if (tab === "leaders" || tab === "radar") {
      window.location.assign(`/discover?tab=${tab}`);
      return;
    }
    selectView(tab);
  }, [selectView]);

  const activeCategoryConfig = OPTIONS_IA_BY_CATEGORY[activeCategory];
  const activePageKey = activeView === "statistics"
    ? "statistics"
    : OPTIONS_IA_VIEW_BY_KEY[activeView].pageKey;
  const viewTabs: WorkspaceTab[] = activeCategoryConfig.views.map((view) => ({
    key: view.pageKey,
    labelKey: view.labelKey,
  }));

  const copy = optionsWorkspaceCopy(lang);
  const viewLabel = t(activeView === "statistics" ? activeCategoryConfig.labelKey : OPTIONS_IA_VIEW_BY_KEY[activeView].labelKey);
  const categoryLabel = t(activeCategoryConfig.labelKey);
  const panelId = "options-active-view";

  return (
    <main
      className={`main2 options-workspace ${s.workspace}`}
      data-options-ia="seven-category-stage-a"
      style={{ overflow: "hidden", display: "flex", flexDirection: "column" }}
    >
      <header className={`options-ia-nav ${s.nav}`}>
        <div className="options-ia-row options-ia-category-row">
          <label className={s.viewPicker}>
            <svg className={s.pickerIcon} aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="2" y="2" width="4.5" height="4.5" rx="1" /><rect x="9.5" y="2" width="4.5" height="4.5" rx="1" />
              <rect x="2" y="9.5" width="4.5" height="4.5" rx="1" /><rect x="9.5" y="9.5" width="4.5" height="4.5" rx="1" />
            </svg>
            <span className={s.pickerCaption} aria-hidden="true">{copy.allViews}</span>
            <span className={s.pickerLocation} aria-hidden="true">
              {categoryLabel !== viewLabel && <small>{categoryLabel}</small>}
              <strong>{viewLabel}</strong>
            </span>
            <svg className={s.pickerChevron} aria-hidden="true" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m2 4 4 4 4-4" /></svg>
            <select aria-label={copy.switchView} value={activePageKey} aria-controls={panelId}
              onChange={event => selectView(ROUTE_VIEW[event.currentTarget.value])}>
              {OPTIONS_IA_CATEGORIES.map(category => (
                <optgroup key={category.key} label={t(category.labelKey)}>
                  {category.views.length ? category.views.map(view =>
                    <option key={view.key} value={view.pageKey}>{t(view.labelKey)}</option>
                  ) : <option value={category.defaultView}>{t(category.labelKey)}</option>}
                </optgroup>
              ))}
            </select>
          </label>
          <div className="options-ia-main">
            <WorkspaceTabs
              tabs={CATEGORY_TABS}
              active={`cat-${activeCategory}`}
              onSelect={onCategorySelect}
              aria-label={t("optionsCategoriesAria")}
              panelId={panelId}
              className="options-category-tabs"
            />
            <Link href="/options/futures" data-testid="options-futures-link"
              className={s.futuresLink} aria-label={futuresText("title")}>
              {futuresText("navTitle")}
            </Link>
            <OptionsWorkflowGuide activeView={activeView} onOpenView={selectView} />
          </div>
        </div>
        {viewTabs.length !== 1 && <div className="options-ia-row options-ia-view-row">
          <span className="options-ia-row-label">{t("optionsIaViewLabel", "View")}</span>
          {viewTabs.length > 0 ? (
            <WorkspaceTabs
              tabs={viewTabs}
              active={activePageKey}
              onSelect={onViewSelect}
              aria-label={t("optionsViewsAria")}
              panelId={panelId}
              className="options-view-tabs"
            />
          ) : (
            <div className={s.statisticsSummary} data-options-ia-gate="statistics-r3">
              {copy.statisticsSummary}
            </div>
          )}
        </div>}
      </header>

      <div id={panelId} role="tabpanel" className={s.activePanel}
        aria-labelledby={`wtab-${viewTabs.length > 1 ? activePageKey : `cat-${activeCategory}`}`}>
        {activeView === "statistics" ? (
          <OptionsStatisticsView />
        ) : (
          <OptionsHubView
            allowedTabs={RESEARCH_ALLOWED}
            activeTab={activeView}
            onTab={onHubTab}
            hideTabStrip
          />
        )}
      </div>
    </main>
  );
}
