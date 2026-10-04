"use client";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import WorkspaceTabs, { type WorkspaceTab } from "@/components/chrome/WorkspaceTabs";
import OptionsHubView, { type TabKey } from "@/components/OptionsHubView";
import { OptionsStatisticsView } from "@/components/statistics/OptionsStatisticsView";
import OptionsWorkflowGuide from "@/components/options/OptionsWorkflowGuide";
import { useLang, useT } from "@/lib/i18n";
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
 * The category row chooses a deterministic home and the view row keeps every existing
 * pane, component, fetch, and `?tab=` contract intact. Plan adds deterministic payoff
 * math; Statistics is a read-only synthesis over the existing moves / vol / agg owners.
 *
 * Reads resolve synchronously from `?tab=` on first render. Writes stay shallow
 * through history.replaceState. Statistics creates no publisher and keeps each source
 * clock explicit instead of inferring synchronized values.
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
  payoff: "payoff",
  positioning: "positioning",
  levels: "levels",
  prophet: "prophet",
  statistics: "statistics",
};

const STATISTICS_STRIP = {
  en: "Read-only · expected move + volatility + aggregate history",
  zh: "只读 · 预期波动 + 波动率 + 聚合历史",
} as const;

const CATEGORY_TABS: WorkspaceTab[] = OPTIONS_IA_CATEGORIES.map((category) => ({
  key: `cat-${category.key}`,
  labelKey: category.labelKey,
  enLabel: "enLabel" in category ? category.enLabel : undefined,
  zhLabel: "zhLabel" in category ? category.zhLabel : undefined,
}));

const CATEGORY_BY_TAB = Object.fromEntries(
  OPTIONS_IA_CATEGORIES.map((category) => [`cat-${category.key}`, category.key]),
) as Record<string, OptionsCategoryKey>;

const RESEARCH_ALLOWED: TabKey[] = [...OPTIONS_HUB_WORKSPACE_VIEWS];
const DEFAULT_VIEW: OptionsHubWorkspaceViewKey = "tape";
const FUNDAMENTALS_HREF = "/analysis";

function writeTabToUrl(pageKey: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("tab", pageKey);
  window.history.replaceState(null, "", url.toString());
}

export default function OptionsWorkspace() {
  const t = useT();
  const { lang } = useLang();
  const searchParams = useSearchParams();
  const rawTab = searchParams.get("tab");
  const [activeView, setActiveView] = useState<OptionsWorkspaceViewKey>(
    () => (rawTab && ROUTE_VIEW[rawTab]) || DEFAULT_VIEW,
  );

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
    setActiveView(view);
    const pageKey = view === "statistics" ? "statistics" : OPTIONS_IA_VIEW_BY_KEY[view].pageKey;
    writeTabToUrl(pageKey);
  }, []);

  const onCategorySelect = useCallback((categoryTab: string) => {
    const category = CATEGORY_BY_TAB[categoryTab];
    if (!category) return;
    selectView(OPTIONS_IA_BY_CATEGORY[category].defaultView);
  }, [selectView]);

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

  const activeCategory = optionsCategoryForView(activeView);
  const activeCategoryConfig = OPTIONS_IA_BY_CATEGORY[activeCategory];
  const activePageKey = activeView === "statistics"
    ? "statistics"
    : OPTIONS_IA_VIEW_BY_KEY[activeView].pageKey;
  const viewTabs: WorkspaceTab[] = activeCategoryConfig.views.map((view) => ({
    key: view.pageKey,
    labelKey: view.labelKey,
    enLabel: view.enLabel,
    zhLabel: view.zhLabel,
  }));

  return (
    <main
      className="main2 options-workspace"
      data-options-ia="seven-category-stage-a"
      data-options-ia-version="eight-category-plan-stage"
      style={{ overflow: "hidden", display: "flex", flexDirection: "column" }}
    >
      <header className={`options-ia-nav ${s.nav}`}>
        <div className="options-ia-row options-ia-category-row">
          <span className="options-ia-row-label">{t("optionsIaCategoryLabel", "Category")}</span>
          <div className="options-ia-main">
            <WorkspaceTabs
              tabs={CATEGORY_TABS}
              active={`cat-${activeCategory}`}
              onSelect={onCategorySelect}
              aria-label={t("optionsCategoriesAria")}
              className="options-category-tabs"
            />
            <OptionsWorkflowGuide activeView={activeView} onOpenView={selectView} />
          </div>
        </div>
        <div className="options-ia-row options-ia-view-row">
          <span className="options-ia-row-label">{t("optionsIaViewLabel", "View")}</span>
          {viewTabs.length > 0 ? (
            <WorkspaceTabs
              tabs={viewTabs}
              active={activePageKey}
              onSelect={onViewSelect}
              aria-label={t("optionsViewsAria")}
              className="options-view-tabs"
            />
          ) : (
            <div className="options-ia-gate-strip" data-options-ia-gate="statistics-existing-sources">
              <span className="options-ia-gate-dot" aria-hidden="true" />
              {STATISTICS_STRIP[lang === "zh" ? "zh" : "en"]}
            </div>
          )}
        </div>
      </header>

      {activeView === "statistics" ? (
        <section
          id="wpanel-statistics"
          className="options-statistics-live"
          data-options-ia-state="statistics-existing-sources"
          aria-labelledby="wtab-cat-statistics"
          style={{ flex: 1, minHeight: 0, overflow: "hidden" }}
        >
          <OptionsStatisticsView />
        </section>
      ) : (
        <OptionsHubView
          allowedTabs={RESEARCH_ALLOWED}
          activeTab={activeView}
          onTab={onHubTab}
          hideTabStrip
        />
      )}
    </main>
  );
}
