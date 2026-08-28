"use client";
import { useCallback, useEffect, useState } from "react";
import WorkspaceTabs, { type WorkspaceTab } from "@/components/chrome/WorkspaceTabs";
import ScreenerView from "@/components/ScreenerView";
import HeatmapPageRoot from "@/components/heatmap/HeatmapPageRoot";
import { DiscoverLeadersMount, DiscoverRadarMount } from "@/components/workspaces/DiscoverFlowMounts";
import { useShellIdentity } from "@/components/chrome/AppShell";
import { useLang } from "@/lib/i18n";

/**
 * Discover workspace composer (Wave-2 IA) — the `/discover` body.
 *
 * Sub-tabs (spec order): screener (Stock Screener) · heatmap · leaders · radar.
 * Owns `?tab=` (shallow, window.history.replaceState — the app-router idiom that
 * avoids the useSearchParams CSR-bailout). Default = screener.
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
  { key: "leaders", labelKey: "wtLeaders" },
  { key: "radar", labelKey: "wtRadar" },
];

const KEYS = new Set(["screener", "heatmap", "leaders", "radar"]);
const DEFAULT_TAB = "screener";

export default function DiscoverWorkspace() {
  const { lang } = useLang();
  const identity = useShellIdentity(); // resolved once by the (shell) layout → AppShell context
  const [tab, setTab] = useState<string>(DEFAULT_TAB);
  // Bumped on every tab click so re-selecting the active Leaders/Radar tab
  // remounts its hub engine — the only way back after a row drills into the hub's
  // Tickers view (the hub's internal drill flips LOCAL state we don't otherwise
  // reset). Cheap: it's only used as a React `key` on the two hub mounts.
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get("tab");
    if (raw && KEYS.has(raw)) setTab(raw);
  }, []);

  const onSelect = useCallback((key: string) => {
    if (!KEYS.has(key)) return;
    setTab(key);
    setNonce((n) => n + 1);
    const u = new URL(window.location.href);
    u.searchParams.set("tab", key);
    window.history.replaceState(null, "", u.toString());
  }, []);

  return (
    <div className="main2 ws-shell" style={{ overflow: "hidden", display: "flex", flexDirection: "column" }}>
      {/* Scoped: let the nested view .main2 fill the cell (see layout note). */}
      <style>{".ws-shell > .ws-body{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}.ws-shell .ws-body > .main2{flex:1;min-height:0}"}</style>
      <div style={{ display: "flex", alignItems: "center", padding: "8px 14px", borderBottom: "1px solid var(--line)", flexShrink: 0, gap: 8 }}>
        <WorkspaceTabs
          tabs={TABS}
          active={tab}
          onSelect={onSelect}
          aria-label={lang === "zh" ? "发现选项卡" : "Discover tabs"}
        />
      </div>

      <div className="ws-body">
        {tab === "screener" && <ScreenerView identity={identity} />}
        {tab === "heatmap" && <HeatmapPageRoot />}
        {tab === "leaders" && <DiscoverLeadersMount key={`leaders-${nonce}`} />}
        {tab === "radar" && <DiscoverRadarMount key={`radar-${nonce}`} />}
      </div>
    </div>
  );
}
