"use client";
import { useCallback, useEffect } from "react";
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
 * through history.replaceState. `statistics` is a category home with an explicit
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

function writeTabToUrl(pageKey: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("tab", pageKey);
  window.history.replaceState(null, "", url.toString());
}

export default function OptionsWorkspace() {
  const { lang } = useLang();
  const t = useT();
  const futuresText = useFuturesText();
  const searchParams = useSearchParams();
  const rawTab = searchParams.get("tab");
  // Native history changes and Back/Forward update useSearchParams through
  // Next's router. Derive the view on every render so the URL stays authoritative.
  const activeView = (rawTab && ROUTE_VIEW[rawTab]) || DEFAULT_VIEW;

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
  }));

  return (
    <main
      className={`main2 options-workspace ${s.workspace}`}
      data-options-ia="seven-category-stage-a"
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
            <Link href="/options/futures" data-testid="options-futures-link"
              className={s.futuresLink} aria-label={futuresText("title")}>
              {futuresText("navTitle")}
            </Link>
            <OptionsWorkflowGuide activeView={activeView} onOpenView={selectView} />
          </div>
          <p className={s.navHint} aria-hidden="true">{optionsWorkspaceCopy(lang).browseCategories} <span>↔</span></p>
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
            <div className={s.statisticsSummary} data-options-ia-gate="statistics-r3">
              {lang === "zh" ? "已观测交易 · 部分覆盖 · 不使用合成数值" : "Observed trading · partial coverage · no synthetic values"}
            </div>
          )}
        </div>
      </header>

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
    </main>
  );
}
