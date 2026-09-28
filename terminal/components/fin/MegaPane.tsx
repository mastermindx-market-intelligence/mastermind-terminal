"use client";
/**
 * MegaPane — the in-shell full-coverage fundamentals overlay (BUILD-SPEC R7/R8,
 * §3.4 FE2a). NOT a route: a fixed z-90 overlay above the workspace. Hosts twelve
 * pages — the six TV "Financials" tabs (overview/statements/statistics/dividends/
 * earnings/revenue) plus sibling dashboards (forecast/technicals/seasonals). The
 * former deep-analysis ("mastermind") page was merged into the OracleDash
 * Research-Desk surface — the research read lives there now.
 *
 * JUDGE-FIXED behaviors (R7):
 *   - scrim + pane at z-index 90 (fin.css foundation)
 *   - Esc closes: window keydown, capture:true + stopPropagation so it wins over
 *     ChartPanel/SearchModal Esc listeners. The TranscriptDrawer, when open, has
 *     its OWN capture handler that calls stopImmediatePropagation, AND this
 *     handler early-returns while a drawer is open — so Esc closes the drawer
 *     before the pane (belt-and-braces).
 *   - body scroll lock while open
 *   - chart-overlay shallow deep-link: ?pane=<page>; standalone /analysis uses
 *     the canonical ?page=<page> key owned by AnalysisWorkspace
 *
 * FE3 mounts this and passes {sym, fund, quote, bars}. Sibling page components
 * (FE2b/FE2c/FE2d) are imported by name — they land in parallel.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useLang } from "../../lib/i18n";
import { pick } from "../../lib/finFormat";
import type { Fund, Bar } from "../../lib/fund";

import OverviewPage from "./OverviewPage";
import StatementsPage from "./StatementsPage";
import StatisticsPage from "./StatisticsPage";
import DividendsPage from "./DividendsPage";
import EarningsPage from "./EarningsPage";
import RevenuePage from "./RevenuePage";
import ForecastPage from "./ForecastPage";
// Sibling dashboards land from FE2c in parallel; imports resolve at integration.
import TechnicalsPage from "./TechnicalsPage";
import SeasonalsPage from "./SeasonalsPage";
import OwnershipPage from "./OwnershipPage";
import InsiderPage from "./InsiderPage";
import TechLabPanel from "./TechLabPanel";
import TranscriptDrawer from "./TranscriptDrawer";
import TranscriptsPage from "./TranscriptsPage";
import CompanyIntelligencePage from "./CompanyIntelligencePage";
import ResearchWorkspaceNav from "./ResearchWorkspaceNav";
import { isTranscriptId } from "../../lib/transcripts";
import type { TranscriptOpenTarget } from "../../lib/transcriptSearch";

// The page ids live in the import-free leaf `./finPages` — an eager module that needs
// FIN_PAGES as a runtime value (TerminalShell does) must import it from THERE, never from
// here, or the value edge pulls this file's whole graph into the first-paint bundle and
// cancels the dynamic() split that mounts it. See finPages.ts for the full contract.
// Re-exported so the fundamentals surfaces keep their single import site.
export { FIN_PAGES, type FinPage } from "./finPages";
import type { FinPage } from "./finPages";

const PAGE_LABELS: Record<FinPage, [string, string]> = {
  overview: ["Overview", "概览"],
  statements: ["Statements", "报表"],
  statistics: ["Statistics", "统计"],
  dividends: ["Dividends", "股息"],
  earnings: ["Earnings", "盈利"],
  intelligence: ["Intelligence", "公司情报"],
  transcripts: ["Transcripts", "电话会"],
  revenue: ["Revenue", "营收"],
  forecast: ["Analyst", "分析师"],
  technicals: ["Technicals", "技术面"],
  seasonals: ["Seasonal", "季节性"],
  ownership: ["Ownership", "持仓"],
  insider: ["Insider", "内部交易"],
  lab: ["Lab", "实验室"],
};

export interface MegaPaneProps {
  sym: string;
  fund: Fund | null;
  /** True while the shell's deferred getFund is in flight — gates the Analyst skeleton. */
  fundLoading?: boolean;
  /** live/delayed quote (statistics Current column, forecast spot). */
  quote?: { last: number | null } | null;
  /** OHLC bars for forecast/technicals/seasonals (from getBars). */
  bars?: Bar[];
  /** Which page is showing. */
  page: FinPage;
  /** Change page (tab click or a section `›` jump). */
  onPage: (p: FinPage) => void;
  /** Close the whole pane (Esc / scrim / Back to chart). */
  onClose: () => void;
  /** Company display name for the header + transcript title. */
  name?: string | null;
  /**
   * "overlay" (default) — legacy full-screen fixed overlay (used on mobile).
   * "workspace" — embedded in the chart-pane slot; no scrim, no scroll-lock,
   *   CSS handles positioning via .fin-pane--workspace.
   */
  mode?: "overlay" | "workspace";
  /** Full intel/v1 payload (for the Lab tab). Optional — Lab shows empty state when absent. */
  intel?: unknown | null;
}

export default function MegaPane({
  sym,
  fund,
  fundLoading = false,
  quote,
  bars = [],
  page,
  onPage,
  onClose,
  name,
  mode = "overlay",
  intel = null,
}: MegaPaneProps) {
  const workspace = mode === "workspace";
  const { lang } = useLang();
  const zh = lang === "zh";
  const [txTarget, setTxTarget] = useState<TranscriptOpenTarget | null>(null);
  const previousSym = useRef(sym);
  const initialTxHydration = useRef(false);
  const initialPaneSync = useRef(false);
  // Read the current drawer state inside the (once-registered) Esc handler
  // without re-subscribing the window listener on every drawer state change.
  const txOpenRef = useRef(false);
  const intelligenceEvidenceOpenRef = useRef(false);
  useEffect(() => {
    txOpenRef.current = txTarget != null;
  }, [txTarget]);

  // URL cleanup belongs to the explicit close action. An unmount can also be a
  // route or symbol transition; mutating the *new* location from that cleanup
  // used to erase valid transcript deep links during navigation.
  const closePane = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete("pane");
    url.searchParams.delete("tx");
    window.history.replaceState(window.history.state, "", url.toString());
    onClose();
  }, [onClose]);

  // A transcript ID belongs to exactly one ticker. Never carry an open drawer
  // across symbol changes, even if both symbols happen to share a fiscal ID.
  useEffect(() => {
    if (previousSym.current !== sym) {
      previousSym.current = sym;
      setTxTarget(null);
      const url = new URL(window.location.href);
      url.searchParams.delete("tx");
      window.history.replaceState(window.history.state, "", url.toString());
    }
  }, [sym]);

  const displayName = name || fund?.ticker || sym;
  const initial = (displayName || sym).trim().charAt(0).toUpperCase();

  // ── Esc (capture + stopPropagation so we win over ChartPanel/SearchModal) ──
  // The TranscriptDrawer registers its own capture handler; when it's open it
  // calls stopImmediatePropagation so this never fires. Belt-and-braces: we also
  // early-return here whenever a drawer is open (regardless of listener order),
  // so Esc closes the drawer BEFORE the pane.
  useEffect(() => {
    // The standalone analysis workspace is embedded in its route. Escape must
    // never send a reader away from that workspace; only the true overlay
    // variant owns the route-changing close affordance.
    if (workspace) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (txOpenRef.current || intelligenceEvidenceOpenRef.current) return; // nested inspector/drawer owns Esc
        e.stopPropagation();
        closePane();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, true);
  }, [closePane, workspace]);

  // ── body scroll lock while open (overlay mode only — workspace scrolls inside its slot) ──
  useEffect(() => {
    if (workspace) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [workspace]);

  // ── legacy ?pane= deep-link sync (chart overlay only) ──
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);

    // /analysis owns one canonical URL key: ?page=. The server still accepts a
    // legacy ?pane= deep link (analysisRoute.ts) and hydrates `page` from it,
    // but once mounted the workspace removes the mirror instead of maintaining
    // two independently-mutated URL authorities. The chart overlay keeps its
    // historical ?pane= contract unchanged.
    if (workspace) {
      if (url.searchParams.has("pane")) {
        url.searchParams.delete("pane");
        window.history.replaceState(window.history.state, "", url.toString());
      }
      return;
    }

    // The chart parent may hydrate `page` from an incoming pane query in its own
    // effect. Preserve that first valid target instead of replacing it with the
    // component's default page before hydration has completed.
    if (!initialPaneSync.current) {
      initialPaneSync.current = true;
      if (url.searchParams.has("pane")) return;
    }
    if (url.searchParams.get("pane") !== page) {
      url.searchParams.set("pane", page);
      window.history.replaceState(window.history.state, "", url.toString());
    }
  }, [page, workspace]);
  // Hydrate an optional transcript deep-link after the client URL is available.
  // Changing away from the archive closes the document and clears its URL key.
  useEffect(() => {
    const url = new URL(window.location.href);
    const urlTargetsTranscripts = url.searchParams.get("page") === "transcripts"
      || url.searchParams.get("pane") === "transcripts";
    if (page === "transcripts" || (!initialTxHydration.current && urlTargetsTranscripts)) {
      const linkedId = url.searchParams.get("tx");
      setTxTarget(linkedId && isTranscriptId(linkedId) ? { id: linkedId } : null);
    } else {
      setTxTarget(null);
      url.searchParams.delete("tx");
      window.history.replaceState(window.history.state, "", url.toString());
    }
    initialTxHydration.current = true;
  }, [page]);

  const openTranscript = useCallback((target: string | TranscriptOpenTarget) => {
    const resolved = typeof target === "string" ? { id: target } : target;
    if (!isTranscriptId(resolved.id)) return;
    setTxTarget(resolved);
    const url = new URL(window.location.href);
    url.searchParams.set("tx", resolved.id);
    window.history.replaceState(window.history.state, "", url.toString());
  }, []);
  const closeTranscript = useCallback(() => {
    setTxTarget(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("tx");
    window.history.replaceState(window.history.state, "", url.toString());
  }, []);
  const setIntelligenceEvidenceOpen = useCallback((open: boolean) => {
    intelligenceEvidenceOpenRef.current = open;
  }, []);

  const navigate = useCallback((p: FinPage) => onPage(p), [onPage]);

  const pageTitle = pick(zh, PAGE_LABELS[page][0], PAGE_LABELS[page][1]);

  return (
    <>
      {!workspace && <div className="fin-scrim" onClick={closePane} aria-hidden />}
      <div
        className={`fin-pane${workspace ? " fin-pane--workspace" : ""}`}
        role={workspace ? "region" : "dialog"}
        aria-modal={workspace ? undefined : true}
        aria-label={`${displayName} · ${pageTitle}`}
      >
        {/* The standalone /analysis workspace already owns company identity and Back-to-chart
            in its context bar. Keep this legacy header only for the chart-hosted overlay. */}
        {!workspace && (
          <div className="fin-head">
            <button className="fin-head-back" onClick={closePane}>
              <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden style={{ fill: "none", stroke: "currentColor", strokeWidth: 2 }}>
                <path d="M15 18l-6-6 6-6" />
              </svg>
              {pick(zh, "Back to chart", "返回图表")}
            </button>
            <span className="fin-head-logo" aria-hidden>
              {initial}
            </span>
            <span className="fin-head-title">
              {displayName} <span className="fin-head-sub">· {pageTitle}</span>
            </span>
          </div>
        )}

        <ResearchWorkspaceNav page={page} zh={zh} onPage={onPage} />

        {/* ── body ── */}
        <div className="fin-body" key={page} id="fin-active-panel" role="tabpanel" aria-labelledby={`fin-tab-${page}`}>
          {page === "overview" && <OverviewPage sym={sym} fund={fund} name={displayName} onNavigate={navigate} />}
          {page === "intelligence" && (
            <CompanyIntelligencePage
              sym={sym}
              name={displayName}
              onOpenTx={openTranscript}
              onEvidenceOpenChange={setIntelligenceEvidenceOpen}
            />
          )}
          {page === "statements" && (
            <StatementsPage sym={sym} fund={fund} name={displayName} onOpenTx={openTranscript} />
          )}
          {page === "transcripts" && (
            <TranscriptsPage sym={sym} fund={fund} onOpenTx={openTranscript} />
          )}
          {page === "statistics" && <StatisticsPage fund={fund} quote={quote} zh={zh} sym={sym} />}
          {page === "dividends" && <DividendsPage sym={sym} fund={fund} zh={zh} />}
          {page === "earnings" && <EarningsPage fund={fund} zh={zh} sym={sym} />}
          {page === "revenue" && <RevenuePage fund={fund} zh={zh} sym={sym} />}
          {page === "forecast" && <ForecastPage sym={sym} fund={fund} bars={bars} zh={zh} loading={fundLoading} />}
          {page === "technicals" && <TechnicalsPage sym={sym} bars={bars} zh={zh} />}
          {page === "seasonals" && <SeasonalsPage sym={sym} bars={bars} zh={zh} />}
          {page === "ownership" && <OwnershipPage sym={sym} />}
          {page === "insider" && <InsiderPage sym={sym} bars={bars} zh={zh} />}
          {page === "lab" && <TechLabPanel sym={sym} intel={intel} zh={zh} />}
        </div>
      </div>

      {/* ── transcript slide-in (own Esc handler above this pane's) ── */}
      {txTarget && <TranscriptDrawer key={`${sym}:${txTarget.id}:${txTarget.segment_index ?? ""}:${txTarget.expected_document_sha256 ?? ""}:${txTarget.query ?? ""}`} sym={sym} id={txTarget.id} name={displayName} focus={txTarget} onClose={closeTranscript} />}
    </>
  );
}
