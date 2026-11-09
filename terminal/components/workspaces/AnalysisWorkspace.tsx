"use client";
// The `.analysis-*` shell/context-bar rules below live in this sheet (alongside the `.ci-*`
// intelligence surface). It used to load from app/layout.tsx on every route; it is imported
// here and in components/fin/CompanyIntelligencePage so only the two surfaces that use it pay
// for it. See the note in that file.
import { pick } from "@/lib/finFormat";
import "../../app/company-intelligence.css";
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import MegaPane, { FIN_PAGES as FIN_PAGE_LIST, type FinPage } from "@/components/fin/MegaPane";
import { getFund, getBars, type Fund, type Bar } from "@/lib/fund";
import { getJSON } from "@/lib/dataCache";
import { useLang, useT } from "@/lib/i18n";
import {
  hasMarketOntologyContext,
  parseMarketOntologyContext,
  serializeMarketOntologyContext,
  stripMarketOntologyParams,
} from "@/lib/marketOntologyContext";
import { ANALYSIS_DEFAULT_SYMBOL, normalizeAnalysisSymbol } from "@/lib/analysisSymbol";
import { announceShellBrainSymbol } from "@/lib/shellBrainSymbol";
import { readActiveSymbol, writeActiveSymbol } from "@/lib/activeSymbol";
import SymbolPicker from "@/components/SymbolPicker";
import CompanyListingIdentity from "@/components/CompanyListingIdentity";
import { normalizeCompanySearchQuery, readCompanySearchQuery } from "@/lib/companySearchContext";
import MarketOntologyContextStrip from "./MarketOntologyContextStrip";
import { sharedShellTerminalHref } from "@/lib/sharedShellNavigation";
import { useOptionalSharedShellPresentation } from "@/components/chrome/shared-shell/SharedShellPresentation";

/**
 * Analysis workspace composer (Wave-2 IA) — the `/analysis` body.
 *
 * Promotes the in-chart Fundamentals dashboard (components/fin/MegaPane) to its
 * own route. MegaPane already supports standalone rendering via mode="workspace"
 * (no scrim, no scroll-lock, positioned by .fin-pane--workspace CSS which is a
 * flex:1 child of a flex-column parent — see app/fin.css:947). This composer
 * supplies the two things TerminalShell supplies around it: (1) a per-symbol data
 * load (intel/fund/bars) and (2) symbol + sub-page context.
 *
 * ── URL state (seeded by the server page, then kept shallow with
 *    window.history.replaceState to avoid a useSearchParams CSR bailout) ──
 *   ?symbol=<TICKER>  the active symbol. Changing it rewrites the param so a copied
 *                     /analysis URL reproduces the view. With NO param the workspace adopts
 *                     the cross-route cursor (lib/activeSymbol) — the company you were just
 *                     looking at — and only falls back to DEFAULT_SYMBOL when this browser has
 *                     never opened one. Landing an SMR chart user on NVDA is the bug that
 *                     cursor exists to close; the nav also names the symbol in the href
 *                     (lib/navSymbol) so the usual path never reaches the adoption below.
 *   ?page=<FinPage>   the active sub-page (default overview). Validated against
 *                     FIN_PAGES on mount; MegaPane's onPage updates it.
 *   Standalone research uses ?page=; MegaPane retains ?pane= only for the
 *   chart-hosted overlay, and removes that legacy mirror in workspace mode.
 *
 * ── Data load ── replicates TerminalShell's per-symbol loader (TerminalShell.tsx
 *    ~576-605): on symbol change, reset (intel/fund/bars → null/[], fundLoading
 *    → true) then fetch. The snapshot is symbol-bound before render, with an
 *    `alive` flag per effect run so a fast switch cannot adopt stale responses. Deviation: TerminalShell defers the
 *    below-the-fold intel/fund/opts behind requestIdleCallback so they don't compete
 *    with the chart's cold-load OHLC fetch in the network queue. There is no chart
 *    fetch on this standalone route, so we fetch immediately — simpler, same result.
 *    (`opts` is not fetched: MegaPane never reads it.)
 */

const FIN_PAGES = new Set<FinPage>(FIN_PAGE_LIST);
// Sourced from lib/analysisSymbol.ts (not redeclared here) so lib/shellBrainSymbol.ts's
// shell-side fallback (SHELL_DEFAULT_BRAIN_SYMBOL) can share the exact same constant instead
// of duplicating the literal in a second file, where it could silently drift out of sync.
const DEFAULT_SYMBOL = ANALYSIS_DEFAULT_SYMBOL;
const DEFAULT_PAGE: FinPage = "overview";
/**
 * A symbol is an identifier, never a path fragment.  Keep this distinct from
 * the more permissive server-side market-data validators: the analysis route
 * accepts conventional dotted/dashed tickers and leading-index carets, but
 * rejects separators, repeated delimiters, and any other shape that could be
 * mistaken for a route or silently normalised into another company.
 */
// The research panels consume published company snapshots. Statistics renders
// fund.ratios.current, not quote.last; no separate live quote poll is needed.
const EMPTY_BARS: Bar[] = [];
interface CompanyRead {
  symbol: string;
  intel: unknown | null;
  fund: Fund | null;
  bars: Bar[];
  fundLoading: boolean;
}

export interface AnalysisWorkspaceProps {
  initialSymbol?: string;
  initialPage?: string;
}

export default function AnalysisWorkspace({ initialSymbol, initialPage }: AnalysisWorkspaceProps) {
  const { lang } = useLang();
  const t = useT();
  const router = useRouter();
  const sharedPresentation = useOptionalSharedShellPresentation();
  const searchParams = useSearchParams();

  const requestedSymbol = initialSymbol?.trim().toUpperCase() || "";
  const normalizedInitialSymbol = normalizeAnalysisSymbol(initialSymbol);
  const seededSymbol = normalizedInitialSymbol ?? DEFAULT_SYMBOL;
  const seededPage = initialPage && FIN_PAGES.has(initialPage as FinPage) ? initialPage as FinPage : DEFAULT_PAGE;
  const [sym, setSym] = useState<string>(seededSymbol);
  // An explicit malformed query must not quietly become NVDA.  The invalid
  // state deliberately stops all company-data effects below and leaves the
  // address bar intact so a shared bad link is visible and debuggable.
  const [invalidSymbol, setInvalidSymbol] = useState<string | null>(
    requestedSymbol && !normalizedInitialSymbol ? requestedSymbol : null,
  );
  const [page, setPage] = useState<FinPage>(seededPage);
  const [pickerOpen, setPickerOpen] = useState(false);
  const routeQuery = searchParams.toString();
  // A picker action invalidates the rendered origin immediately, including a
  // same-company pick while the router still exposes its previous query.
  const [clearedOntologyQuery, setClearedOntologyQuery] = useState<string | null>(null);
  if (clearedOntologyQuery !== null && clearedOntologyQuery !== routeQuery) {
    // The query changed; a later arrival at the original URL is valid again.
    setClearedOntologyQuery(null);
  }
  const companySearchQuery = readCompanySearchQuery(new URLSearchParams(routeQuery));
  useLayoutEffect(() => {
    // Router navigation and Back/Forward reuse this mounted workspace. Reconcile
    // URL identity before paint; a useState seed alone would leave the old company.
    const params = new URLSearchParams(routeQuery);
    const raw = params.get("symbol");
    if (raw) {
      const next = normalizeAnalysisSymbol(raw);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- synchronize the external URL owner before painting reused route content.
      setInvalidSymbol(next ? null : raw);
      if (next) setSym(next);
    } else {
      setInvalidSymbol(null);
      setSym(normalizeAnalysisSymbol(readActiveSymbol() ?? undefined) ?? DEFAULT_SYMBOL);
    }
    const nextPage = params.get("page") ?? params.get("pane");
    setPage(nextPage && FIN_PAGES.has(nextPage as FinPage) ? nextPage as FinPage : DEFAULT_PAGE);
  }, [routeQuery]);

  const [companyRead, setCompanyRead] = useState<CompanyRead | null>(null);
  // A URL update renders before passive-effect cleanup. Bind every projection to
  // its company now, not after a frame has borrowed the previous company's values.
  const selectedRead = companyRead?.symbol === sym ? companyRead : null;
  const intel = selectedRead?.intel ?? null;
  const fund = selectedRead?.fund ?? null;
  const fundLoading = selectedRead?.fundLoading ?? true;
  const bars = selectedRead?.bars ?? EMPTY_BARS;

  // ── adopt the cross-route cursor when the URL named no company ───────────────────────────
  //
  // Gate, not a race. `localStorage` cannot be read during render without a hydration mismatch
  // (the server already emitted DEFAULT_SYMBOL into the context bar), and setting the symbol
  // from a passive effect would let this commit's data effects fire a full NVDA load first —
  // three wasted requests on a phone, for a company nobody asked for. So the loaders below wait
  // on `symbolSettled`, and a LAYOUT effect resolves the cursor before the browser paints: the
  // user never sees the fallback, and the network never fetches it. Ordering, never a timer —
  // see the mount-effect starvation note in TerminalShell.
  const [symbolSettled, setSymbolSettled] = useState(() => !!normalizedInitialSymbol || !!requestedSymbol);
  useLayoutEffect(() => {
    if (symbolSettled) return;
    const params = new URLSearchParams(window.location.search);
    if (hasMarketOntologyContext(params) && !normalizedInitialSymbol) {
      const url = new URL(window.location.href);
      url.search = stripMarketOntologyParams(params).toString();
      window.history.replaceState(null, "", url.toString());
    }
    const cursor = normalizeAnalysisSymbol(readActiveSymbol() ?? undefined);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resolve the external cursor before paint and before company-data effects.
    if (cursor && cursor !== sym) setSym(cursor);
    setSymbolSettled(true);
    // Mount-only: once settled, the picker owns the symbol and re-running would undo a pick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── publish the cursor: picking a company HERE moves the global one ──────────────────────
  // This is the other half of the contract. Without it, switching to TSLA on this desk and
  // tapping Chart would still open whatever the chart last resolved on its own.
  useEffect(() => {
    if (invalidSymbol || !symbolSettled) return;
    writeActiveSymbol(sym);
  }, [invalidSymbol, sym, symbolSettled]);

  // Shared shallow-URL writer — set a search param without navigating (dodges the
  // useSearchParams CSR-bailout, matching the Discover/Research composers).
  const writeParam = useCallback((key: string, value: string) => {
    const u = new URL(window.location.href);
    if (u.searchParams.get(key) === value) return;
    u.searchParams.set(key, value);
    window.history.replaceState(null, "", u.toString());
  }, []);

  const marketOntologyContext = useMemo(() => {
    const params = new URLSearchParams(routeQuery);
    const routeSymbol = normalizeAnalysisSymbol(params.get("symbol") ?? undefined);
    // The first actionable link must already carry its validated origin. Never
    // attach an unscoped arrival to the cursor/default or another selected company.
    if (invalidSymbol || !routeSymbol || routeSymbol !== sym || clearedOntologyQuery === routeQuery) return null;
    return parseMarketOntologyContext(params);
  }, [clearedOntologyQuery, invalidSymbol, routeQuery, sym]);

  // ── symbol change → rewrite ?symbol= shallowly, and tell AppShell's Brain host ──
  // `writeParam` uses `history.replaceState`, which fires no Next.js navigation and no
  // native DOM event, so AppShell's shell-level resolver would otherwise never learn the
  // user switched company on the same /analysis visit.
  // `announceShellBrainSymbol` is the one channel that reaches it — see lib/shellBrainSymbol.ts.
  useEffect(() => {
    if (invalidSymbol || !symbolSettled) return;
    writeParam("symbol", sym);
    announceShellBrainSymbol(sym);
  }, [invalidSymbol, sym, symbolSettled, writeParam]);

  // ── sub-page change (MegaPane onPage) → state + ?page= shallowly ──
  const onPage = useCallback((p: FinPage) => {
    setPage(p);
    writeParam("page", p);
  }, [writeParam]);

  // ── per-symbol data load (see header note; mirrors TerminalShell ~576-605) ──
  useEffect(() => {
    if (invalidSymbol || !symbolSettled) return;
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initialize this selected company's read lifetime.
    setCompanyRead({ symbol: sym, intel: null, fund: null, bars: [], fundLoading: true });
    const publish = (patch: Partial<Omit<CompanyRead, "symbol">>) => {
      if (alive) setCompanyRead(current => current?.symbol === sym ? { ...current, ...patch } : current);
    };
    getJSON(`/data/${sym}.intel.json`).then(d => publish({ intel: d })).catch(() => {});
    getBars(sym).then(b => publish({ bars: b })).catch(() => {});
    getFund(sym)
      .then(d => publish({ fund: d }))
      .catch(() => {})
      .finally(() => publish({ fundLoading: false }));
    return () => { alive = false; };
  }, [invalidSymbol, sym, symbolSettled]);

  // ── symbol switch ────────────────────────────────────────────────────────────────────
  // The v1 fallback here was a bare uppercase text field, usable only by someone who already
  // knew the ticker. It is now components/SymbolPicker — the chart's own dialog — so a company
  // can be found by English or Chinese name, browsed by asset class, or taken straight from
  // Recently viewed. Every commit also moves the cross-route cursor via the effect above, which
  // is what makes this "change the ticker globally", not just on this desk.
  const openSymbol = useCallback((next: string, query?: string) => {
    const valid = normalizeAnalysisSymbol(next);
    if (!valid) return;   // the picker only ever yields manifest symbols; belt and braces
    const params = new URLSearchParams(window.location.search);
    params.delete("company_query");
    const selectedQuery = normalizeCompanySearchQuery(query);
    if (selectedQuery !== null) params.set("company_query", selectedQuery);
    for (const key of ["ci_event", "ci_generation", "ci_company", "ci_fingerprint", "ci_lens", "ci_evidence"]) params.delete(key);
    const investigationUrl = new URL(window.location.href);
    investigationUrl.search = params.toString();
    window.history.replaceState(window.history.state, "", investigationUrl.toString());
    if (hasMarketOntologyContext(params)) {
      const url = new URL(window.location.href);
      url.search = stripMarketOntologyParams(params).toString();
      window.history.replaceState(null, "", url.toString());
    }
    setClearedOntologyQuery(routeQuery);
    setInvalidSymbol(null);
    setSym(valid);
  }, [routeQuery, setClearedOntologyQuery]);

  // ── onClose (workspace) → jump to the chart for this symbol ──
  const onClose = useCallback(() => {
    const href = sharedPresentation
      ? sharedShellTerminalHref(window.location.href, sym)
      : `/terminal?symbol=${encodeURIComponent(sym)}`;
    router.push(href);
  }, [router, sharedPresentation, sym]);

  const zh = lang === "zh";
  const contextSymbol = invalidSymbol ?? sym;
  const thesesHref = useMemo(() => {
    if (!marketOntologyContext) return `/analysis?view=theses&symbol=${encodeURIComponent(sym)}`;
    const params = serializeMarketOntologyContext(
      marketOntologyContext,
      new URLSearchParams({ view: "theses", symbol: sym }),
    );
    return `/analysis?${params.toString()}`;
  }, [marketOntologyContext, sym]);

  return (
    // Root IS the (shell) .app2 grid cell (like DiscoverWorkspace). Flex-column so
    // MegaPane's .fin-pane--workspace (flex:1) fills the remaining height below the context
    // bar. `.analysis-shell` also keeps that in-flow behaviour at ≤860px, where the pane would
    // otherwise fall back to a fixed full-screen overlay and bury this bar and the app's mobile
    // nav underneath itself — see the scoped block in app/fin.css.
    <div className="main2 ws-shell analysis-shell" role="main" id="shared-shell-content" tabIndex={-1}>
      {marketOntologyContext && <MarketOntologyContextStrip context={marketOntologyContext} />}
      <div className="analysis-context-bar">
        {!invalidSymbol && <button type="button" className="analysis-context-back" onClick={onClose}>
          <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden>
            <path d="M15 18l-6-6 6-6" />
          </svg>
          {t("backToChart")}
        </button>}
        {/* The identity block IS the switcher. Two controls that both name the current company —
            a read-only chip beside a "switch to" field — is one more than the bar needs, and the
            chart already established that tapping the ticker is how you change it. */}
        <SymbolPicker
          scope={sharedPresentation ? "companies" : "symbols"}
          symbol={contextSymbol}
          mark={invalidSymbol ? "!" : undefined}
          eyebrow={pick(zh, "RESEARCH WORKSPACE", "研究工作区")}
          label={pick(zh, "Change symbol", "切换标的")}
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          onPick={openSymbol}
          onCompanyPick={openSymbol}
          trackSource="analysis-search"
          className={invalidSymbol ? "sym-pick--invalid" : undefined}
        />
        <div className="analysis-context-freshness" aria-label={t("wsCompanyResearch")}>
          <i />
          <span>{t("wsCompanyResearch")}</span>
        </div>
        {!invalidSymbol && sharedPresentation && <button type="button" className="analysis-context-chart" onClick={onClose}>
          {pick(zh, "Open current chart", "打开当前图表")} <span aria-hidden="true">↗</span>
        </button>}
        {!invalidSymbol && <Link className="analysis-context-theses" href={`/analysis?view=investigations&symbol=${encodeURIComponent(sym)}`}>{pick(zh, "Saved research", "已保存研究")}</Link>}
        {!invalidSymbol && (
          <Link
            href={thesesHref}
            className="analysis-context-theses"
            aria-label={t("wsOpenThesesFor", "Your theses on {sym}").replace("{sym}", sym)}
          >
            <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
              <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l5.414 5.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2z" />
            </svg>
            {t("wsOpenTheses")}
          </Link>
        )}
      </div>

      {!invalidSymbol && companySearchQuery !== null && (
        <CompanyListingIdentity key={sym} symbol={sym} query={companySearchQuery} fund={fund} loading={fundLoading} />
      )}
      {invalidSymbol ? (
        <section className="analysis-invalid-state" role="status" aria-live="polite">
          <span className="analysis-invalid-mark" aria-hidden>!</span>
          <div>
            <p className="fin-eyebrow">{t("wsUnresolvedSymbol")}</p>
            <h1>{t("wsResearchNotOpened")}</h1>
            <p>{zh
              ? `“${invalidSymbol}” 不是受支持的代码格式。系统未将其替换为 ${DEFAULT_SYMBOL}，也未请求公司数据。`
              : `“${invalidSymbol}” is not a supported symbol format. It was not substituted with ${DEFAULT_SYMBOL}, and no company data was requested.`}</p>
            <button className="btn btn-primary" onClick={() => setPickerOpen(true)}>
              {t("wsChooseCompany")}
            </button>
          </div>
        </section>
      ) : (
        <MegaPane
          sym={sym}
          fund={fund}
          fundLoading={fundLoading}
          bars={bars}
          page={page}
          onPage={onPage}
          onClose={onClose}
          // name omitted: MegaPane resolves its own header via fund?.ticker || sym
          // (TerminalShell feeds a manifest name we don't load; the fallback is correct).
          mode="workspace"
          intel={intel}
        />
      )}
    </div>
  );
}
