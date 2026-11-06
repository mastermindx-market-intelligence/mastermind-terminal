"use client";
import { useCallback, useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import DiscoverLanding from "./DiscoverLanding";
import { useOptionalSharedShellPresentation } from "@/components/chrome/shared-shell/SharedShellPresentation";
const SectorIntelligenceWorkspace = dynamic(() => import("@/components/sector-intelligence/SectorIntelligenceWorkspace"));
const RSPivotStudy = dynamic(() => import("@/components/workspaces/RSPivotStudy"));
const MedTechWatchdesk = dynamic(() => import("@/components/medtech/MedTechWatchdesk"), { ssr: false });
import WorkspaceTabs, { type WorkspaceTab } from "@/components/chrome/WorkspaceTabs";
import ScreenerView from "@/components/ScreenerView";
import HeatmapPageRoot from "@/components/heatmap/HeatmapPageRoot";
import { DiscoverLeadersMount, DiscoverRadarMount } from "@/components/workspaces/DiscoverFlowMounts";
import { useShellIdentity } from "@/components/chrome/AppShell";
import { useT } from "@/lib/i18n";
import { SECTOR_INTELLIGENCE_LEX } from "@/lib/sectorIntelligenceLex";

/**
 * Discover workspace composer (Wave-2 IA) — the `/discover` body.
 *
 * Sub-tabs (spec order): screener (Stock Screener) · heatmap · leaders · radar.
 * Owns `?tab=` (shallow, window.history.replaceState — the app-router idiom that
 * keeps mounted tools local). Ordinary Terminal defaults to screener; Shared Shell
 * uses the question chooser without a valid explicit tab and keeps tool history.
 *
 * ── Layout note (nested .main2) ──────────────────────────────────────────────
 * AppShell mounts this page's root element straight into the .app2 grid, so the
 * root must BE the .main2 grid cell. The composed views (ScreenerView renders
 * <main className="main2 screener-main">, the Leaders/Radar hub mounts render
 * their own bodies) each still emit a .main2 — a Wave-1 hold-over kept for the
 * single-view routes (portfolio/admin). To host them under a tab strip without a
 * rewrite, this composer's root is a <div className="main2"> (the grid cell) and
 * a scoped style makes the inner view fill the remaining height (the .app2>.main2
 * `flex:1` rule doesn't reach a nested .main2). Only one <main> is ever visible
 * at a time, so the a11y landmark stays singular. HeatmapPageRoot / ScreenerView
 * bring their own <main className="main2">; the Leaders/Radar hub mounts run the
 * engine embedded (bare flex div, see OptionsHubView Wrapper) — both fill the cell.
 */

const TABS: WorkspaceTab[] = [
  { key: "screener", labelKey: "wtStockScreener" },
  { key: "heatmap", labelKey: "wtHeatmap" },
  { key: "sectors", labelKey: SECTOR_INTELLIGENCE_LEX.siTab[0], zhLabel: SECTOR_INTELLIGENCE_LEX.siTab[1] },
  { key: "medtech", labelKey: "MedTech", zhLabel: "医疗科技" },
  { key: "leaders", labelKey: "wtLeaders" },
  { key: "radar", labelKey: "wtRadar" },
  { key: "rs-pivot", labelKey: "RS · 30m Pivot", zhLabel: "相对强度·30分钟枢轴" },
];

const KEYS = new Set(["screener", "heatmap", "sectors", "medtech", "leaders", "radar", "rs-pivot"]);
const DEFAULT_TAB = "screener";

export default function DiscoverWorkspace() {
  const t = useT();
  const presentation = useOptionalSharedShellPresentation();
  const params = useSearchParams();
  const selected = params.get("tab");
  const chooser = !!presentation && (!selected || !KEYS.has(selected));
  const identity = useShellIdentity(); // resolved once by the (shell) layout → AppShell context
  const tab = selected && KEYS.has(selected) ? selected : DEFAULT_TAB;
  // Bumped on every tab click so re-selecting the active Leaders/Radar tab
  // remounts its hub engine — the only way back after a row drills into the hub's
  // Tickers view (the hub's internal drill flips LOCAL state we don't otherwise
  // reset). Cheap: it's only used as a React `key` on the two hub mounts.
  const [nonce, setNonce] = useState(0);

  const onSelect = useCallback((key: string) => {
    if (!KEYS.has(key)) return;
    setNonce((n) => n + 1);
    const u = new URL(window.location.href);
    u.searchParams.set("tab", key);
    if (u.href !== window.location.href) window.history.pushState(null, "", u.toString());
    window.dispatchEvent(new Event("mmx:shell-location"));
  }, []);

  if (chooser) return <div className="main2 ws-shell discover-chooser-shell">
    <DiscoverLanding onSelect={onSelect} onSearchCompanies={() => window.dispatchEvent(new Event("mmx:shell-company-search"))} />
  </div>;

  return (
    <div className="main2 ws-shell" role={tab === "leaders" || tab === "radar" ? "main" : undefined}
      style={{ overflow: "hidden", display: "flex", flexDirection: "column" }}>
      {/* Scoped: let the nested view .main2 fill the cell (see layout note). */}
      <style>{".ws-shell > .ws-body{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}.ws-shell .ws-body > .main2{flex:1;min-height:0}"}</style>
      <div style={{ display: "flex", alignItems: "center", padding: "8px 14px", borderBottom: "1px solid var(--line)", flexShrink: 0, gap: 8 }}>
        {presentation && <button className="discover-chooser-back" type="button" onClick={() => {
          const u = new URL(window.location.href); u.searchParams.delete("tab");
          window.history.pushState(null, "", u.toString());
          window.dispatchEvent(new Event("mmx:shell-location"));
        }}>{presentation.context.locale === "zh" ? "发现" : "Discover"} ←</button>}
        <WorkspaceTabs
          tabs={TABS}
          active={tab}
          onSelect={onSelect}
          aria-label={t("wtDiscoverTabs")}
        />
      </div>

      <div className="ws-body">
        {tab === "screener" && <ScreenerView identity={identity} />}
        {tab === "heatmap" && <HeatmapPageRoot />}
        {tab === "sectors" && <SectorIntelligenceWorkspace />}
        {tab === "medtech" && <MedTechWatchdesk />}
        {tab === "leaders" && <DiscoverLeadersMount key={`leaders-${nonce}`} />}
        {tab === "radar" && <DiscoverRadarMount key={`radar-${nonce}`} />}
        {tab === "rs-pivot" && <RSPivotStudy />}
      </div>
    </div>
  );
}
