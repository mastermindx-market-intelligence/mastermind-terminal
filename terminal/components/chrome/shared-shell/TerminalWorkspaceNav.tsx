"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import "./mega-menu.css";
import { useCallback, useId, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import SettingsButton from "@/components/settings/SettingsButton";
import { canonicalChartSymbol } from "@/lib/terminalBoot";
import { useShellLocation } from "./useShellLocation";
import { BrandMark } from "@/components/BrandMark";
import { Glyph } from "@/components/AppNav";
import MobileNavModal from "@/components/MobileNavModal";
import SharedShellPrimaryNav from "@/components/intelligence/SharedShellPrimaryNav";
import { useSharedShellT } from "@/lib/sharedShellCopy";
import { normalizeAnalysisSymbol } from "@/lib/analysisSymbol";
import { inheritWorkspaceMarketHref, workspaceMarket } from "@/lib/sharedShellMarket";
import { chartAnalysisHref, sharedShellTerminalHref } from "@/lib/sharedShellNavigation";
import { useActiveSymbol } from "@/lib/activeSymbol";
import styles from "./terminal-workspace.module.css";

const BrowseTools = dynamic(() => import("./ShellDirectory"), { ssr: false });

/** The same three tasks are available on the chart, screener and company page. */
export function TerminalViews({ symbol, timeframe, onNavigate }: { symbol?: string | null; timeframe?: string; onNavigate?: () => void }) {
  const path = usePathname();
  const params = useSearchParams();
  const cursor = useActiveSymbol();
  const t = useSharedShellT();
  const location = useShellLocation();
  const subject = path === "/analysis" && params.has("symbol")
    ? normalizeAnalysisSymbol(params.get("symbol") ?? undefined) : canonicalChartSymbol(symbol ?? cursor);
  const analysis = normalizeAnalysisSymbol(subject ?? undefined);
  const episode = path === "/terminal" && subject === canonicalChartSymbol(params.get("symbol") ?? params.get("sym"))
    ? params.get("episode") ?? undefined : undefined;
  const market = workspaceMarket(path, params.toString());
  const chart = location ? sharedShellTerminalHref(location, subject)
    : subject ? "/terminal?symbol=" + encodeURIComponent(subject) : "/terminal";
  const views = [
    { path: "/terminal", key: "chart", href: chart },
    { path: "/discover", key: "discover", href: "/discover?tab=screener" },
    ...(!subject || analysis ? [{ path: "/analysis", key: "analysis", href: analysis ? chartAnalysisHref(analysis, timeframe, episode) : "/analysis" }] : []),
  ];
  return <nav className={styles.views} aria-label={t("shellTerminal")}>
    {views.map(view => path === view.path
      ? <span key={view.key} aria-current="page">{t(view.key)}</span>
      : <Link key={view.key} prefetch={false} href={inheritWorkspaceMarketHref(view.href, market)}
        onNavigate={onNavigate}>{t(view.key)}</Link>)}
  </nav>;
}

export default function TerminalWorkspaceMenu({ symbol, timeframe, email, optionsHref, onOpenBrain, onOpenCommands, onReturn }: {
  symbol: string; timeframe: string; email: string; optionsHref?: string; onOpenBrain: () => void;
  onOpenCommands: () => void; onReturn?: () => void;
}) {
  const t = useSharedShellT();
  const opener = useRef<HTMLButtonElement>(null);
  const id = useId();
  const [open, setOpen] = useState(false);
  const [browse, setBrowse] = useState(false);
  const closeBrowse = useCallback(() => {
    setBrowse(false);
    requestAnimationFrame(() => opener.current?.focus({ preventScroll: true }));
  }, []);
  const close = useCallback(() => setOpen(false), []);
  return <>
    <button type="button" ref={opener} className={styles.opener} data-chart-workspaces=""
      aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => setOpen(true)}>
      <BrandMark size={23} /><span>{t("shellWorkspaces")}</span>
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5"/></svg>
    </button>
    {open && <MobileNavModal id={id} label={t("shellWorkspaces")} closeLabel={t("shellCloseMenu")}
      openerRef={opener} onClose={close} breakpointPx={null}>
      <div className="m-drawer-h"><BrandMark size={24} /><strong>{t("shellWorkspaces")}</strong></div>
      <div className={`m-nav ${styles.drawerBody}`}>
        <nav aria-label={t("shellNavigation")}>
          <SharedShellPrimaryNav mode="drawer" labelled activeSymbol={symbol} renderGlyph={key => <Glyph k={key} />} onNavigate={close} />
          <button type="button" onClick={() => { close(); onOpenBrain(); }}><Glyph k="ai"/>{t("shellMastermindAI")}</button>
        </nav>
        <h2>{t("shellTerminal")}</h2>
        <TerminalViews symbol={symbol} timeframe={timeframe} onNavigate={close} />
        <h2>{t("shellChartTools")}</h2>
        {optionsHref && <Link href={optionsHref} prefetch={false} onNavigate={close}>
          <Glyph k="options"/>{t("shellOptionsFlow")} · {symbol}
        </Link>}
        <button type="button" onClick={() => { close(); onOpenCommands(); }}>{t("shellChartActions")}</button>
        {["dislocations", "scripts", "alerts"].map(key => <Link key={key} href={"/" + key} prefetch={false} onNavigate={close}>
          <Glyph k={key}/>{t(key)}
        </Link>)}
        <button type="button" onClick={() => { close(); setBrowse(true); }}>{t("shellBrowseTools")}</button>
        {onReturn && <button type="button" onClick={() => { close(); onReturn(); }}>← {t("shellReturnWorkspace")}</button>}
      </div>
      <div className="m-drawer-ft"><SettingsButton email={email} /></div>
    </MobileNavModal>}
    {browse && <div className={styles.browse}><BrowseTools mode="browse" onClose={closeBrowse} /></div>}
  </>;
}
