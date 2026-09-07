"use client";
// The `.analysis-*` shell/context-bar rules below live in this sheet (alongside the `.ci-*`
// intelligence surface). It used to load from app/layout.tsx on every route; it is imported
// here and in components/fin/CompanyIntelligencePage so only the two surfaces that use it pay
// for it. See the note in that file.
import "../../app/company-intelligence.css";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { useRouter } from "next/navigation";
import MegaPane, { FIN_PAGES as FIN_PAGE_LIST, type FinPage } from "@/components/fin/MegaPane";
import { getFund, getBars, type Fund, type Bar } from "@/lib/fund";
import { getJSON } from "@/lib/dataCache";
import { useLang } from "@/lib/i18n";
import { normalizeAnalysisSymbol } from "@/lib/analysisSymbol";
import { readActiveSymbol, writeActiveSymbol } from "@/lib/activeSymbol";
import SymbolPicker from "@/components/SymbolPicker";

/**
 * Analysis workspace composer (Wave-2 IA) — the `/analysis` body.
 *
 * Promotes the in-chart Fundamentals dashboard (components/fin/MegaPane) to its
 * own route. MegaPane already supports standalone rendering via mode="workspace"
 * (no scrim, no scroll-lock, positioned by .fin-pane--workspace CSS which is a
 * flex:1 child of a flex-column parent — see app/fin.css:947). This composer
 * supplies the two things TerminalShell supplies around it: (1) a per-symbol data
 * load (intel/fund/bars/quote) and (2) symbol + sub-page context.
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
 *   NB: MegaPane ALSO writes ?pane=<page> internally (its own legacy deep-link,
 *   unchanged here). It carries the same value as our ?page= — harmless mirror.
 *
 * ── Data load ── replicates TerminalShell's per-symbol loader (TerminalShell.tsx
 *    ~576-605): on symbol change, reset (intel/fund/bars/quote → null/[], fundLoading
 *    → true) then fetch. Race-guarded by an `alive` flag captured per effect run so a
 *    fast symbol switch can't apply stale data. Deviation: TerminalShell defers the
 *    below-the-fold intel/fund/opts behind requestIdleCallback so they don't compete
 *    with the chart's cold-load OHLC fetch in the network queue. There is no chart
 *    fetch on this standalone route, so we fetch immediately — simpler, same result.
 *    (`opts` is not fetched: MegaPane never reads it.)
 */

const FIN_PAGES = new Set<FinPage>(FIN_PAGE_LIST);
const DEFAULT_SYMBOL = "NVDA";
const DEFAULT_PAGE: FinPage = "overview";
/**
 * A symbol is an identifier, never a path fragment.  Keep this distinct from
 * the more permissive server-side market-data validators: the analysis route
 * accepts conventional dotted/dashed tickers and leading-index carets, but
 * rejects separators, repeated delimiters, and any other shape that could be
 * mistaken for a route or silently normalised into another company.
 */
// Light live-quote refresh; matches the /api/quote snapshot cadence (TTL 5s). We
// poll a touch slower to avoid needless load on a single-symbol page.
const QUOTE_REFRESH_MS = 15_000;

export interface AnalysisWorkspaceProps {
  initialSymbol?: string;
  initialPage?: string;
}

export default function AnalysisWorkspace({ initialSymbol, initialPage }: AnalysisWorkspaceProps) {
  const { lang } = useLang();
  const router = useRouter();

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

  const [intel, setIntel] = useState<any | null>(null);
  const [fund, setFund] = useState<Fund | null>(null);
  const [fundLoading, setFundLoading] = useState(true);
  const [bars, setBars] = useState<Bar[]>([]);
  const [last, setLast] = useState<number | null>(null);

  // ── adopt the cross-route cursor when the URL named no company ───────────────────────────
  //
  // Gate, not a race. `localStorage` cannot be read during render without a hydration mismatch
  // (the server already emitted DEFAULT_SYMBOL into the context bar), and setting the symbol
  // from a passive effect would let this commit's data effects fire a full NVDA load first —
  // four wasted requests on a phone, for a company nobody asked for. So the loaders below wait
  // on `symbolSettled`, and a LAYOUT effect resolves the cursor before the browser paints: the
  // user never sees the fallback, and the network never fetches it. Ordering, never a timer —
  // see the mount-effect starvation note in TerminalShell.
  const [symbolSettled, setSymbolSettled] = useState(() => !!normalizedInitialSymbol || !!requestedSymbol);
  useLayoutEffect(() => {
    if (symbolSettled) return;
    const cursor = normalizeAnalysisSymbol(readActiveSymbol() ?? undefined);
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

  // ── symbol change → rewrite ?symbol= shallowly ──
  useEffect(() => {
    if (invalidSymbol || !symbolSettled) return;
    writeParam("symbol", sym);
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
    setIntel(null); setFund(null); setBars([]); setLast(null); setFundLoading(true);
    getJSON(`/data/${sym}.intel.json`).then((d) => { if (alive) setIntel(d); }).catch(() => {});
    getBars(sym).then((b) => { if (alive) setBars(b); }).catch(() => {});
    getFund(sym)
      .then((d) => { if (alive) setFund(d); })
      .catch(() => {})
      .finally(() => { if (alive) setFundLoading(false); });
    return () => { alive = false; };
  }, [invalidSymbol, sym, symbolSettled]);

  // ── live quote (single symbol): initial fetch + light refresh, race-guarded ──
  // MegaPane consumes only quote.last (Statistics "Current" column, forecast spot),
  // so we extract quotes[sym].last from /api/quote?syms=<SYM> and pass { last }.
  useEffect(() => {
    if (invalidSymbol || !symbolSettled) return;
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch(`/api/quote?syms=${encodeURIComponent(sym)}`, { cache: "no-store" });
        if (!r.ok) return;
        const j = await r.json();
        const px = j?.quotes?.[sym]?.last;
        if (alive) setLast(typeof px === "number" ? px : null);
      } catch { /* transient — keep last good */ }
    };
    load();
    const id = window.setInterval(load, QUOTE_REFRESH_MS);
    return () => { alive = false; window.clearInterval(id); };
  }, [invalidSymbol, sym, symbolSettled]);

  // ── symbol switch ────────────────────────────────────────────────────────────────────
  // The v1 fallback here was a bare uppercase text field, usable only by someone who already
  // knew the ticker. It is now components/SymbolPicker — the chart's own dialog — so a company
  // can be found by English or Chinese name, browsed by asset class, or taken straight from
  // Recently viewed. Every commit also moves the cross-route cursor via the effect above, which
  // is what makes this "change the ticker globally", not just on this desk.
  const openSymbol = useCallback((next: string) => {
    const valid = normalizeAnalysisSymbol(next);
    if (!valid) return;   // the picker only ever yields manifest symbols; belt and braces
    setInvalidSymbol(null);
    setSym(valid);
  }, []);

  // ── onClose (workspace) → jump to the chart for this symbol ──
  const onClose = useCallback(() => {
    router.push(`/terminal?symbol=${encodeURIComponent(sym)}`);
  }, [router, sym]);

  const zh = lang === "zh";
  const contextSymbol = invalidSymbol ?? sym;

  return (
    // Root IS the (shell) .app2 grid cell (like DiscoverWorkspace). Flex-column so
    // MegaPane's .fin-pane--workspace (flex:1) fills the remaining height below the context
    // bar. `.analysis-shell` also keeps that in-flow behaviour at ≤860px, where the pane would
    // otherwise fall back to a fixed full-screen overlay and bury this bar and the app's mobile
    // nav underneath itself — see the scoped block in app/fin.css.
    <div className="main2 ws-shell analysis-shell">
      <div className="analysis-context-bar">
        {/* The identity block IS the switcher. Two controls that both name the current company —
            a read-only chip beside a "switch to" field — is one more than the bar needs, and the
            chart already established that tapping the ticker is how you change it. */}
        <SymbolPicker
          symbol={contextSymbol}
          mark={invalidSymbol ? "!" : undefined}
          eyebrow={zh ? "研究工作区" : "RESEARCH WORKSPACE"}
          label={zh ? "切换标的" : "Change symbol"}
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          onPick={openSymbol}
          trackSource="analysis-search"
          className={invalidSymbol ? "sym-pick--invalid" : undefined}
        />
        <div className="analysis-context-freshness" aria-label={zh ? "公司研究工作区" : "Company research workspace"}>
          <i />
          <span>{zh ? "公司研究" : "Company research"}</span>
        </div>
      </div>

      {invalidSymbol ? (
        <section className="analysis-invalid-state" role="status" aria-live="polite">
          <span className="analysis-invalid-mark" aria-hidden>!</span>
          <div>
            <p className="fin-eyebrow">{zh ? "未解析标的" : "UNRESOLVED SYMBOL"}</p>
            <h1>{zh ? "无法打开该公司研究页" : "This company research page was not opened"}</h1>
            <p>{zh
              ? `“${invalidSymbol}” 不是受支持的代码格式。系统未将其替换为 ${DEFAULT_SYMBOL}，也未请求公司数据。`
              : `“${invalidSymbol}” is not a supported symbol format. It was not substituted with ${DEFAULT_SYMBOL}, and no company data was requested.`}</p>
            <button className="btn btn-primary" onClick={() => setPickerOpen(true)}>
              {zh ? "选择一个标的" : "Choose a company"}
            </button>
          </div>
        </section>
      ) : (
        <MegaPane
          sym={sym}
          fund={fund}
          fundLoading={fundLoading}
          quote={{ last }}
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
