"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type KeyboardEvent } from "react";
import Link from "next/link";
import { companyHref } from "@/lib/sectorIntelligence";
import { useOptionalSharedShellPresentation } from "@/components/chrome/shared-shell/SharedShellPresentation";
import { sharedShellTerminalHref } from "@/lib/sharedShellNavigation";
import { useLang, useT } from "@/lib/i18n";
import { marketValue, sinceEntryPct, type BookTotals, type Position } from "@/lib/portfolio";
import { finite, nativePrice } from "@/lib/portfolioMoney";
import type { PortfolioRisk } from "@/lib/portfolioRisk";
import {
  portfolioCopy, recordIssues, needsEntryDetails, needsPriceCoverage, selectPortfolioRecords,
  type PortfolioSection, type RecordFilter, type RecordIssue, type WorkspaceQuote, type WorkspaceManifest,
} from "@/lib/portfolioWorkspace";
import s from "./PortfolioWorkspace.module.css";

type Props = {
  positions: Position[]; quotes: Record<string, WorkspaceQuote>; manifest: Record<string, WorkspaceManifest>;
  totals: BookTotals; risk: PortfolioRisk | null; unreadable: boolean; stale: boolean; retrying: boolean;
  lastChecked: string | null; failure: string | null; busyId: string | null; confirmDelete: string | null;
  riskContent: ReactNode; historyContent: ReactNode; targetsContent: ReactNode; briefContent: ReactNode; eventContent: ReactNode;
  onRetry: () => void; onAdd: () => void; onEdit: (position: Position) => void;
  onToggleStatus: (position: Position) => void; onDeleteRequest: (position: Position) => void;
  onDeleteCancel: () => void; onDeleteConfirm: (position: Position) => void;
  onSectionChange: (section: PortfolioSection) => void;
};
const SECTIONS: PortfolioSection[] = ["overview", "holdings", "risk", "targets"];
const PAGE_SIZE = 25;
const formatters = [0, 1, 2, 3, 4].map(d => new Intl.NumberFormat("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));
const number = (n: number | null | undefined, decimals = 2) => finite(n) ? formatters[decimals].format(n) : "—";
const amount = (n: number | null | undefined, currency: string | null | undefined, signed = false) =>
  finite(n) && currency ? `${currency} ${signed && n >= 0 ? "+" : ""}${number(n)}` : "—";
const percent = (n: number | null) => finite(n) ? `${n >= 0 ? "+" : ""}${number(n)}%` : "—";

// SSR and the first hydration render share null; the live browser URL arrives
// through the external store after hydration, including subsequent shell navigation.
const serverLocationSnapshot = (): string | null => null;
const browserLocationSnapshot = () => window.location.href;
function subscribeToLocation(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  window.addEventListener("hashchange", onChange);
  window.addEventListener("mmx:shell-location", onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener("hashchange", onChange);
    window.removeEventListener("mmx:shell-location", onChange);
  };
}

type ShellPresentation = ReturnType<typeof useOptionalSharedShellPresentation>;
const terminalHref = (presentation: ShellPresentation, currentHref: string | null, ticker: string) =>
  presentation && currentHref
    ? sharedShellTerminalHref(currentHref, ticker)
    : `/terminal?sym=${encodeURIComponent(ticker)}`;
const issueCopy: Record<RecordIssue, Parameters<ReturnType<typeof portfolioCopy>>[0]> = {
  shares: "sharesIssue", entryPrice: "entryPriceIssue", entryCurrency: "entryCurrencyIssue",
  quote: "quoteIssue", quoteCurrency: "quoteCurrencyIssue", currencyMismatch: "currencyMismatchIssue",
};

function Icon({ name }: { name: "plus" | "arrow" | "search" | "refresh" | "close" | "book" | "check" }) {
  const paths = {
    plus: "M12 5v14M5 12h14", arrow: "M5 12h14m-6-6 6 6-6 6", search: "m16.5 16.5 4 4M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15",
    refresh: "M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 3M5 15a8 8 0 0 0 13 3",
    close: "m6 6 12 12M18 6 6 18", book: "M4 5h6a3 3 0 0 1 3 3v12a3 3 0 0 0-3-3H4V5Zm9 3a3 3 0 0 1 3-3h4v12h-4a3 3 0 0 0-3 3",
    check: "m5 12 4 4L19 6",
  };
  return <svg viewBox="0 0 24 24" className={s.icon} aria-hidden="true"><path d={paths[name]} /></svg>;
}

export default function PortfolioWorkspace(p: Props) {
  const t = useT();
  const { lang } = useLang();
  const c = portfolioCopy(lang);
  const shellPresentation = useOptionalSharedShellPresentation();
  const currentHref = useSyncExternalStore(subscribeToLocation, browserLocationSnapshot, serverLocationSnapshot);
  const [section, setSection] = useState<PortfolioSection>("overview");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<RecordFilter>("all");
  const [status, setStatus] = useState<"open" | "closed">("open");
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const open = useMemo(() => p.positions.filter(row => row.status === "open"), [p.positions]);
  const closedCount = p.positions.length - open.length;
  const securities = useMemo(() => new Set(open.map(row => row.ticker)).size, [open]);
  const issues = useMemo(() => open.map(position => ({
    position, issues: recordIssues(position, p.quotes[position.ticker], p.manifest[position.ticker]),
  })), [open, p.quotes, p.manifest]);
  const detailRows = issues.filter(row => needsEntryDetails(row.issues));
  const priceRows = issues.filter(row => needsPriceCoverage(row.issues));
  const filtered = useMemo(() => selectPortfolioRecords(p.positions, p.quotes, p.manifest, { query, filter, status }),
    [p.positions, p.quotes, p.manifest, query, filter, status]);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1));
  const visibleRows = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const selected = p.positions.find(row => row.id === selectedId);
  const nameFor = (ticker: string) => (lang === "zh" ? p.manifest[ticker]?.zh : null) || p.manifest[ticker]?.name || ticker;
  const switchSection = (next: PortfolioSection) => { setSection(next); p.onSectionChange(next); };
  const showHoldings = (nextFilter: RecordFilter = "all") => {
    setFilter(nextFilter); setQuery(""); setStatus("open"); setPage(0); switchSection("holdings");
    requestAnimationFrame(() => tabRefs.current[1]?.focus());
  };
  const tabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number | null = null;
    if (event.key === "ArrowRight") next = (index + 1) % SECTIONS.length;
    if (event.key === "ArrowLeft") next = (index + SECTIONS.length - 1) % SECTIONS.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = SECTIONS.length - 1;
    if (next !== null) { event.preventDefault(); tabRefs.current[next]?.focus(); switchSection(SECTIONS[next]); }
  };
  const rowTable = (rows: Position[], preview = false) => <div className={s.tableWrap}>
    <table className={`pf-table ${s.table} ${preview ? s.previewTable : ""}`}>
      <thead><tr>
        <th scope="col">{c("security")}</th><th scope="col">{c("quantity")}</th>
        {!preview && <th scope="col">{c("entry")}</th>}
        {!preview && <th scope="col">{c("last")}</th>}
        <th scope="col">{c("value")}</th><th scope="col">{c("change")}</th><th scope="col"><span className={s.srOnly}>{c("actions")}</span></th>
      </tr></thead>
      <tbody>{rows.map(position => {
        const quote = nativePrice(p.quotes[position.ticker], p.manifest[position.ticker]);
        const value = marketValue(position, quote?.last ?? null, quote?.currency);
        const change = sinceEntryPct(position, quote?.last ?? null, quote?.currency);
        return <tr key={position.id} data-position-id={position.id} data-ticker={position.ticker} data-status={position.status}
          className={`pf-row ${p.busyId === position.id ? s.busy : ""}`}>
          <td className={s.securityCell}>
            <span className={s.monogram} aria-hidden="true">{position.ticker.slice(0, 2)}</span>
            <div className={s.securityText}><Link className="pf-tk" href={terminalHref(shellPresentation, currentHref, position.ticker)}>{position.ticker}</Link>
              <span title={nameFor(position.ticker)}>{nameFor(position.ticker)}</span></div>
          </td>
          <td data-label={c("quantity")}>{number(position.shares, position.shares != null && position.shares % 1 !== 0 ? 4 : 0)}
            {position.shares === null && <small>{t("unsized")}</small>}</td>
          {!preview && <td data-label={c("entry")}>{number(position.entryPrice, position.entryPrice != null && position.entryPrice < 10 ? 4 : 2)}
            {position.entryPrice !== null && <small>{position.entryCurrency || c("currencyUnknown")}</small>}</td>}
          {!preview && <td data-label={c("last")}>{number(quote?.last, quote && quote.last < 10 ? 4 : 2)}
            {quote && <small>{quote.currency || c("currencyUnknown")}</small>}</td>}
          <td data-label={c("value")}>{amount(value, quote?.currency)}</td>
          <td data-label={c("change")} className={change === null ? "" : change >= 0 ? s.positive : s.negative}>{percent(change)}</td>
          <td className={s.rowActions}><button type="button" className={s.reviewButton}
            aria-label={`${c("inspect")} ${position.ticker}`} onClick={() => setSelectedId(position.id)}>
            <span>{c("inspect")}</span><Icon name="arrow" /></button></td>
        </tr>;
      })}</tbody>
    </table>
  </div>;

  return <main className={`main2 ${s.workspace}`} data-portfolio="w5-positions"
    data-portfolio-state={p.unreadable ? "unreadable" : p.positions.length ? "book" : "empty"} data-position-count={p.unreadable ? undefined : p.positions.length}>
    <div className={`pg ${s.scroll}`}>
      <div className={s.canvas}>
        <header className={s.header}>
          <h1>{t("portfolio")}</h1>
          <div className={s.headerActions}>
            <button type="button" className={s.iconButton} disabled={p.retrying} onClick={p.onRetry}
              aria-label={p.retrying ? c("refreshing") : c("refresh")} title={c("refresh")}><Icon name="refresh" /></button>
            <button type="button" className={`pf-btn primary ${s.addButton}`} disabled={p.unreadable} onClick={p.onAdd} aria-label={t("addPosition")}><Icon name="plus" />{t("addPosition")}</button>
          </div>
        </header>
        {!p.unreadable && <div className={s.bookMeta}>
          <span><strong>{securities}</strong> {c("securities")}<i aria-hidden="true">·</i><strong>{open.length}</strong> {c("records")}</span>
          {p.lastChecked && <span>{c("checked")} <time dateTime={p.lastChecked}>{new Date(p.lastChecked).toLocaleTimeString(lang === "zh" ? "zh-CN" : "en-GB", { hour: "2-digit", minute: "2-digit" })}</time></span>}
        </div>}
        {p.failure && <div className={s.failure} role="alert">{p.failure}</div>}
        {p.stale && !p.unreadable && <div className={s.stale} role="status"><strong>{c("staleTitle")}</strong><span>{c("staleHint")}</span></div>}

        {p.unreadable ? <section className={s.unreadable} data-testid="portfolio-unreadable" aria-live="polite">
          <div className={s.emptyIcon}><Icon name="book" /></div><h2>{t("portfolioUnreadableTitle")}</h2>
          <p>{t("portfolioUnreadableBody")}</p><button type="button" className="pf-btn primary" onClick={p.onRetry} disabled={p.retrying}>
            {p.retrying ? c("refreshing") : c("refresh")}</button>
        </section> : <>
          <div className={s.tabs} role="tablist" aria-label={t("portfolio")}>
            {SECTIONS.map((key, index) => <button key={key} type="button" role="tab" id={`portfolio-tab-${key}`}
              ref={node => { tabRefs.current[index] = node; }} aria-controls={`portfolio-panel-${key}`}
              aria-selected={section === key} tabIndex={section === key ? 0 : -1}
              onClick={() => switchSection(key)} onKeyDown={event => tabKey(event, index)}>{c(key)}</button>)}
          </div>

          <section className={s.tabPanel} role="tabpanel" id="portfolio-panel-overview" aria-labelledby="portfolio-tab-overview" hidden={section !== "overview"} tabIndex={0}>
            {open.length ? <>
              <div className={s.metrics}>
                <article className={s.primaryMetric} data-testid="portfolio-market-value"><span className={s.metricLabel}>{c("pricedValue")}</span>
                  <strong className={s.metricValue}>{amount(p.totals.marketValue, p.totals.marketValueCurrency)}</strong>
                  <p><b>{p.totals.valued}/{open.length}</b> {c("pricedRecords")}</p></article>
                <article data-testid="portfolio-day-change"><span className={s.metricLabel}>{c("dayMove")}</span>
                  <strong className={`${s.metricValue} ${p.totals.dayChange === null ? "" : p.totals.dayChange >= 0 ? s.positive : s.negative}`}>{amount(p.totals.dayChange, p.totals.dayChangeCurrency, true)}</strong>
                  <p>{c("valueScope")}</p></article>
                <article data-testid="portfolio-since-entry"><span className={s.metricLabel}>{c("sinceEntry")}</span>
                  <strong className={`${s.metricValue} ${p.totals.sinceEntry === null ? "" : p.totals.sinceEntry >= 0 ? s.positive : s.negative}`}>{amount(p.totals.sinceEntry, p.totals.sinceEntryCurrency, true)}</strong>
                  <p>{p.totals.sinceEntryPct !== null && <b>{percent(p.totals.sinceEntryPct)} · </b>}{p.totals.based} {c("basedRecords")}</p></article>
              </div>
              <details className={s.coverage} data-testid="portfolio-currency-coverage"><summary>{c("coverage")}<span>{p.totals.monetaryGaps.length ? c("valueUnavailable") : c("pnlScope")}</span></summary>
                <p data-testid="portfolio-coverage">{p.totals.valued}/{open.length} {c("pricedRecords")}. {c("valueScope")} {c("pnlScope")} {c("noReturns")} {c("commonUnits")}</p>
                {p.totals.noBasis.length > 0 && <p data-testid="portfolio-coverage-nobasis">{c("sinceEntry")}: {p.totals.based}/{open.length} {c("basedRecords")}. {c("entryPriceIssue")}: {p.totals.noBasis.join(", ")}</p>}
                {p.totals.unpriced.length > 0 && <p>{c("quoteUnavailable")}: {p.totals.unpriced.join(", ")}</p>}
                {p.totals.monetaryGaps.length > 0 && <p>{c("valueUnavailable")} {p.totals.monetaryGaps.join(", ")}</p>}
                <button type="button" className={s.textButton} onClick={() => showHoldings("prices")}>{c("reviewCoverage")} <Icon name="arrow" /></button>
              </details>
              <div className={s.overviewGrid}>
                <div className={s.mainColumn}>
                  <section className={s.card}><header className={s.cardHeader}><div><h2>{c("yourHoldings")}</h2><span>{open.length} {c("records")}</span></div>
                    <button type="button" className={s.textButton} onClick={() => showHoldings()}>{c("viewAll")}<Icon name="arrow" /></button></header>
                    {rowTable(open.slice(0, 5), true)}
                  </section>
                  <details className={s.disclosure}><summary><span><b>{c("desk")}</b><small>{c("deskHint")}</small></span><span aria-hidden="true">+</span></summary>{p.briefContent}</details>
                  <details className={s.disclosure}><summary><b>{c("events")}</b><span aria-hidden="true">+</span></summary>{p.eventContent}</details>
                </div>
                <aside className={s.sideColumn} aria-label={c("reviewNext")}>
                  <section className={s.card}><header className={s.cardHeader}><div><h2>{c("reviewNext")}</h2><span>{c("reviewNextHint")}</span></div></header>
                    <div className={s.tasks}>
                      {detailRows.length > 0 && <button type="button" className={s.task} onClick={() => showHoldings("details")}><span className={s.taskCount}>{detailRows.length}</span><span><b>{c("detailsTask")}</b><small>{[...new Set(detailRows.map(row => row.position.ticker))].slice(0, 3).join(", ")}</small></span><Icon name="arrow" /></button>}
                      {priceRows.length > 0 && <button type="button" className={s.task} onClick={() => showHoldings("prices")}><span className={s.taskCount}>{priceRows.length}</span><span><b>{c("pricesTask")}</b><small>{[...new Set(priceRows.map(row => row.position.ticker))].slice(0, 3).join(", ")}</small></span><Icon name="arrow" /></button>}
                      {!detailRows.length && !priceRows.length && <div className={s.ready}><Icon name="check" /><b>{c("detailsReady")}</b><p>{c("detailsReadyHint")}</p></div>}
                    </div>
                  </section>
                  <section className={`${s.card} ${s.concentration}`}><header><h2>{c("concentration")}</h2><p>{c("concentrationHint")}</p></header>
                    {p.risk?.concentration?.topNWeightPct !== null && p.risk?.concentration?.topNWeightPct !== undefined ? <>
                      <div className={s.concentrationValue}>{number(p.risk.concentration.topNWeightPct, 1)}<span>%</span></div>
                      <div className={s.meter} role="meter" aria-label={c("concentration")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.risk.concentration.topNWeightPct}>
                        <span style={{ width: `${Math.max(0, Math.min(100, p.risk.concentration.topNWeightPct))}%` }} /></div>
                      <p className={s.topNames}>{p.risk.concentration.topNames.join(" · ")}</p>
                    </> : <p className={s.missing}>{c("concentrationMissing")}</p>}
                    <button type="button" className={s.textButton} onClick={() => { switchSection("risk"); requestAnimationFrame(() => tabRefs.current[2]?.focus()); }}>{c("exploreRisk")}<Icon name="arrow" /></button>
                  </section>
                </aside>
              </div>
            </> : <section className={s.empty} data-testid="portfolio-empty"><div className={s.emptyIcon}><Icon name="book" /></div><h2>{c("emptyTitle")}</h2><p>{c("emptyHint")}</p><button type="button" className="pf-btn primary" onClick={p.onAdd}><Icon name="plus" />{t("addPosition")}</button></section>}
          </section>

          {/* Panels stay mounted. A section change cannot discard a target draft or cancel its pending save. */}
          <section className={s.tabPanel} role="tabpanel" id="portfolio-panel-holdings" aria-labelledby="portfolio-tab-holdings" hidden={section !== "holdings"} tabIndex={0}>
            <div className={s.holdingsToolbar}>
              <div className={s.statusSwitch} role="group" aria-label={c("holdings")}>
                {(["open", "closed"] as const).map(key => <button key={key} type="button" aria-pressed={status === key}
                  onClick={() => { setStatus(key); setPage(0); }}>{c(key)} <span>{key === "open" ? open.length : closedCount}</span></button>)}
              </div>
              <label className={s.search}><Icon name="search" /><span className={s.srOnly}>{c("search")}</span><input type="search" value={query} placeholder={c("search")}
                onChange={event => { setQuery(event.target.value); setPage(0); }} /></label>
              <label className={s.filter}><span className={s.srOnly}>{c("filter")}</span><select value={filter}
                onChange={event => { setFilter(event.target.value as RecordFilter); setPage(0); }}>
                <option value="all">{c("allRecords")}</option><option value="details">{c("needsDetails")}</option><option value="prices">{c("priceCoverage")}</option>
              </select></label>
            </div>
            <section className={s.card} data-testid={status === "open" ? "portfolio-open" : "portfolio-closed"}>
              {filtered.length ? rowTable(visibleRows) : <div className={s.noMatches}><h2>{c("noMatches")}</h2><p>{c("noMatchesHint")}</p>
                <button type="button" className={s.textButton} onClick={() => { setQuery(""); setFilter("all"); setPage(0); }}>{c("clearFilters")}</button></div>}
              <footer className={s.tableFooter}><span role="status">{c("showing")} {filtered.length ? currentPage * PAGE_SIZE + 1 : 0}–{Math.min((currentPage + 1) * PAGE_SIZE, filtered.length)} {c("of")} {filtered.length} {c("records")}</span>
                {filtered.length > PAGE_SIZE && <div className={s.pagination}><button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)} aria-label={c("previousPage")}>←</button>
                  <span>{currentPage + 1} / {Math.ceil(filtered.length / PAGE_SIZE)}</span><button type="button" disabled={(currentPage + 1) * PAGE_SIZE >= filtered.length} onClick={() => setPage(currentPage + 1)} aria-label={c("nextPage")}>→</button></div>}
              </footer>
            </section>
          </section>

          <section className={`${s.tabPanel} ${s.analysisPanel}`} role="tabpanel" id="portfolio-panel-risk" aria-labelledby="portfolio-tab-risk" hidden={section !== "risk"} tabIndex={0}>
            <header className={s.sectionIntro}><h2>{c("riskIntro")}</h2><p>{c("concentrationHint")} {c("commonUnits")}</p></header>
            {p.riskContent}
            <section className={s.history}><header className={s.sectionIntro}><h2>{c("historyTitle")}</h2><p>{c("historyHint")}</p></header><p className={s.methodNote}>{c("historyNotPerformance")}</p>{p.historyContent}</section>
          </section>
          <section className={`${s.tabPanel} ${s.analysisPanel}`} role="tabpanel" id="portfolio-panel-targets" aria-labelledby="portfolio-tab-targets" hidden={section !== "targets"} tabIndex={0}>
            <header className={s.sectionIntro}><h2>{c("targetsIntro")}</h2><p>{c("targetsBasis")}</p></header>{p.targetsContent}
          </section>
        </>}
      </div>
    </div>
    {selected && !p.unreadable && <RecordDialog key={selected.id} position={selected} name={nameFor(selected.ticker)}
      quote={p.quotes[selected.ticker]} fallback={p.manifest[selected.ticker]} busy={p.busyId === selected.id} failure={p.failure}
      confirming={p.confirmDelete === selected.id}
      onClose={() => { setSelectedId(null); p.onDeleteCancel(); }}
      onEdit={() => p.onEdit(selected)} onToggleStatus={() => p.onToggleStatus(selected)}
      onDeleteRequest={() => p.onDeleteRequest(selected)} onDeleteCancel={p.onDeleteCancel} onDeleteConfirm={() => p.onDeleteConfirm(selected)} />}
  </main>;
}

function RecordDialog({ position, name, quote, fallback, busy, failure, confirming, onClose, onEdit, onToggleStatus, onDeleteRequest, onDeleteCancel, onDeleteConfirm }: {
  position: Position; name: string; quote: WorkspaceQuote; fallback: WorkspaceQuote; busy: boolean; failure: string | null; confirming: boolean;
  onClose: () => void; onEdit: () => void; onToggleStatus: () => void; onDeleteRequest: () => void; onDeleteCancel: () => void; onDeleteConfirm: () => void;
}) {
  const { lang } = useLang(); const c = portfolioCopy(lang); const t = useT();
  const shellPresentation = useOptionalSharedShellPresentation();
  const currentHref = useSyncExternalStore(subscribeToLocation, browserLocationSnapshot, serverLocationSnapshot);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const node = dialog.current;
    node?.showModal();
    return () => { node?.close(); if (trigger?.isConnected) trigger.focus(); else document.querySelector<HTMLButtonElement>("[data-portfolio] [role=tab][aria-selected=true]")?.focus(); };
  }, []);
  const price = nativePrice(quote, fallback);
  const issues = recordIssues(position, quote, fallback);
  return <dialog ref={dialog} className={s.recordDialog} aria-labelledby="portfolio-record-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div className={s.dialogInner}>
      <header className={s.dialogHeader}><span className={s.eyebrow}>{c("record")} · {c(position.status)}</span>
        <button type="button" className={s.iconButton} onClick={onClose} disabled={busy} aria-label={c("closeDialog")}><Icon name="close" /></button>
        <h2 id="portfolio-record-title" tabIndex={-1} autoFocus>{position.ticker}</h2><p>{name}</p></header>
      <div className={s.dialogBody}>
        {failure && <p className={s.failure} role="alert">{failure}</p>}
        <div className={s.recordValue}><span>{c("value")}</span><strong>{amount(marketValue(position, price?.last ?? null, price?.currency), price?.currency)}</strong></div>
        <dl className={s.recordFields}><div><dt>{c("quantity")}</dt><dd>{number(position.shares, position.shares != null && position.shares % 1 !== 0 ? 4 : 0)}</dd></div>
          <div><dt>{c("entry")}</dt><dd>{position.entryPrice === null ? "—" : `${number(position.entryPrice, position.entryPrice < 10 ? 4 : 2)} · ${position.entryCurrency || c("currencyUnknown")}`}</dd></div>
          <div><dt>{c("entryDate")}</dt><dd>{position.entryDate || "—"}</dd></div>
          <div><dt>{c("last")}</dt><dd>{price ? `${number(price.last, price.last < 10 ? 4 : 2)} · ${price.currency || c("currencyUnknown")}` : "—"}</dd></div></dl>
        <p className={s.quoteSource}>{!price ? c("quoteUnavailable") : finite(quote?.last) ? c("sourceQuote") : c("sourceFallback")}</p>
        {issues.length > 0 && <section className={s.recordIssues}><h3>{c("reviewCoverage")}</h3><ul>{issues.map(issue => <li key={issue}>{c(issueCopy[issue])}</li>)}</ul></section>}
        <section className={s.notes}><h3>{c("notes")}</h3><p>{position.notes || c("noNotes")}</p></section>
        <div className={s.researchLinks}>{companyHref(position.ticker) && <Link href={companyHref(position.ticker)!}>{c("research")}<Icon name="arrow" /></Link>}<Link href={terminalHref(shellPresentation, currentHref, position.ticker)}>{c("chart")}<Icon name="arrow" /></Link></div>
      </div>
      <footer className={s.dialogFooter}>
        {confirming ? <div className={s.deleteConfirm} role="group" aria-label={t("deletePositionConfirm")}><h3>{c("confirmDelete")}</h3><p>{c("deleteHint")}</p>
          <div><button type="button" className="pf-btn" disabled={busy} onClick={onDeleteCancel}>{c("cancel")}</button><button type="button" className={`pf-btn ${s.danger}`} disabled={busy} onClick={onDeleteConfirm}>{t("deletePositionYes")}</button></div></div>
          : <><button type="button" className="pf-btn primary" disabled={busy} onClick={onEdit} aria-label={`${t("editPosition")} ${position.ticker}`}>{c("edit")}</button>
            <button type="button" className="pf-btn" disabled={busy} onClick={onToggleStatus} aria-label={`${position.status === "closed" ? t("reopenPosition") : t("closePosition")} ${position.ticker}`}>{c(position.status === "closed" ? "reopenRecord" : "closeRecord")}</button>
            <button type="button" className={s.deleteButton} disabled={busy} onClick={onDeleteRequest} aria-label={`${t("deletePosition")} ${position.ticker}`}>{c("deleteRecord")}</button></>}
      </footer>
    </div>
  </dialog>;
}
