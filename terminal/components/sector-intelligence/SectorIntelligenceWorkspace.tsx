"use client";

import Link from "next/link";
import MobileSheet from "@/components/ui/MobileSheet";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLang } from "@/lib/i18n";
import { sectorPaperText as pick } from "@/lib/sectorPaperCopy";
import { useSectorT } from "@/lib/sectorIntelligenceLex";
import { useShellIdentity } from "@/components/chrome/AppShell";
import { SECTOR_FEEDS, SECTOR_VIEWS, DEFAULT_SECTOR_STATE, object, text, number, sectorRows,
  groupRows, themeRows, themeEntryReady, themeStaleLegs, sectorRotationHistory, sectorRotationEpisodes, sectorMeasuredRead, members, concentration, sortMembers, parseSectorState, writeSectorState,
  formatValue, type FeedMap, type FeedPayload, type FeedStatus,
  type SectorFeed, type SectorState, type SectorView, type Row } from "@/lib/sectorIntelligence";
import SectorGroupBrowser from "./SectorGroupBrowser";
import SectorCentralDiscovery from "./SectorCentralDiscovery";
import SectorRotationMap from "./SectorRotationMap";
import styles from "./SectorIntelligenceWorkspace.module.css";
import SectorCompanyComparison from "./SectorCompanyComparison";
import PaperSectorWorkspace from "./PaperSectorWorkspace";
import PaperSectorWatches from "./PaperSectorWatches";
import { PaperSectorConfluence, PaperSectorResearch, PaperSectorThemes } from "./PaperSectorEvidence";
import { paperWorkspaceForLens, resolvePaperSectorState, writePaperSectorState, normalizePaperSectorNative, paperSectorReturnContext, PAPER_SECTOR_RETURN_KEY,
  type PaperSectorLens, type PaperSectorNavigation, type PaperSectorRoute } from "@/lib/sectorPaper";

const VIEW_KEYS: Record<SectorView, string> = {
  intelligence: "siOverview", companies: "siCompaniesTab", signals: "siSignals", drivers: "siDrivers", history: "siHistory",
};
type OuterWorkspace = Exclude<SectorState["workspace"], "detail">;
const RETURN_KEYS: Record<OuterWorkspace, string> = {
  rotation: "siReturnToRotation", discover: "siReturnToDiscover", breadth: "siReturnToBreadth",
};
const FEED_KEYS: Record<SectorFeed, string> = {
  sector: "siFeedSector", confluence: "siFeedConfluence", themes: "siFeedThemes",
  heatmap: "siFeedHeatmap", risk: "siFeedRisk", history: "siFeedHistory", events: "siFeedEvents",
};
const STATUS_KEYS: Record<FeedStatus, string> = {
  loading: "siStatusLoading", ready: "siStatusReady", access: "siStatusAccess", unavailable: "siStatusUnavailable",
  invalid: "siStatusInvalid", error: "siStatusError",
};
const STATE_KEYS: Record<string, string> = {
  leading: "siStateLeading", lagging: "siStateLagging", cautious: "siStateCautious", mixed: "siStateMixed",
  extended: "siStateExtended", "turn signaled": "siStateTurn", watch: "siStateWatch", "top watch": "siStateWatch",
  early: "siStateEarly", confirmed: "siStateConfirmed", mature: "siStateMature", deteriorating: "siStateDeteriorating",
  "long-bias": "siStateLong", neutral: "siStateNeutral", "rolling over": "siStateRolling", improving: "siStateImproving",
  constructive: "siStateConstructive", unavailable: "siUnavailable",
};
const emptyFeed = (source: SectorFeed, status: FeedStatus): FeedPayload => ({ data: null,
  receipt: { source, status, path: "", asOf: null, observedAt: null, contentHash: null, stale: false } });
const count = (v: unknown): number | null => {
  const n = number(v); return n !== null && n >= 0 && Number.isInteger(n) ? n : null;
};
const rank = (v: unknown): string => { const n = count(v); return n ? `#${n}` : "—"; };
const pct = (v: unknown): number | null => { const n = number(v); return n !== null && n >= 0 && n <= 100 ? n : null; };
function Card({ title, subtitle, children, action }: { title: string; subtitle?: string; children: ReactNode; action?: ReactNode }) {
  return <section className={styles.card}><div className={styles.cardHead}><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</div><div className={styles.cardBody}>{children}</div></section>;
}
function Metric({ label, value, foot }: { label: string; value: string; foot: string }) {
  return <div className={styles.metric}><span>{label}</span><strong>{value}</strong><small>{foot}</small></div>;
}

export default function SectorIntelligenceWorkspace() {
  const t = useSectorT(), { lang } = useLang(), identity = useShellIdentity();
  const [state, setState] = useState<SectorState>(DEFAULT_SECTOR_STATE);
  const [paper, setPaper] = useState<PaperSectorNavigation>({ route: "brief", lens: "rotation" });
  const [returnPaper, setReturnPaper] = useState<PaperSectorNavigation | null>(null);
  const pendingDestination = useRef<string | null>(null);
  const [received, setReceived] = useState<{ identity: typeof identity; revision: number; feeds: FeedMap }>({ identity, revision: 0, feeds: {} });
  const [revision, setRevision] = useState(0);
  const [groupBrowserOpen, setGroupBrowserOpen] = useState(false);
  const [returnWorkspace, setReturnWorkspace] = useState<OuterWorkspace>("rotation");
  const [returnState, setReturnState] = useState<SectorState | null>(null);
  const nav = useRef<HTMLElement>(null);
  const sourceTrigger = useRef<HTMLButtonElement>(null);
  const sourceReturn = useRef<string | null>(null);
  const rootElement = useRef<HTMLElement>(null);
  const currentWorkspace = useRef("brief:rotation:discover");
  const scrollPositions = useRef<Record<string, { inner: number; outer: number; focus: string | null }>>({});
  const saveWorkspaceScroll = useCallback(() => {
    const active = document.activeElement;
    const returnFocus = active?.getAttribute("data-sector-return-focus"), choiceFocus = active?.getAttribute("data-sector-choice");
    scrollPositions.current[currentWorkspace.current] = {
      inner: rootElement.current?.scrollTop || 0, outer: window.scrollY,
      focus: returnFocus ? `return:${returnFocus}` : choiceFocus ? `choice:${choiceFocus}` : null,
    };
  }, []);
  // A changed account hides the previous account's data in the render itself,
  // before effects run. Nothing is persisted in browser storage or shared caches.
  const feeds = received.identity === identity && received.revision === revision ? received.feeds : {};
  useEffect(() => {
    const sync = () => {
      const params = new URLSearchParams(window.location.search);
      const parsed = parseSectorState(params), nextPaper = resolvePaperSectorState(params, parsed);
      const next = normalizePaperSectorNative(parsed, nextPaper);
      if (`${nextPaper.route}:${nextPaper.lens}:${next.workspace}` !== currentWorkspace.current) saveWorkspaceScroll();
      if (next.workspace !== parsed.workspace) {
        const url = new URL(window.location.href);
        writeSectorState(url, next);
        window.history.replaceState(window.history.state, "", writePaperSectorState(url, nextPaper));
      }
      const origin = next.workspace === "detail" && nextPaper.route === "explore"
        ? paperSectorReturnContext(object(window.history.state)[PAPER_SECTOR_RETURN_KEY], window.location.origin) : null;
      setPaper(nextPaper);
      setReturnState(origin?.native || null); setReturnPaper(origin?.paper || null);
      const outer = origin?.native || next, outerPaper = origin?.paper || nextPaper;
      setReturnWorkspace(outer.workspace === "detail" ? paperWorkspaceForLens(outerPaper.lens) : outer.workspace);
      setState(next);
      setGroupBrowserOpen(false);
    };
    sync(); window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [saveWorkspaceScroll]);
  useEffect(() => {
    const key = `${paper.route}:${paper.lens}:${state.workspace}`;
    currentWorkspace.current = key;
    const saved = scrollPositions.current[key] || { inner: 0, outer: 0, focus: null };
    const frame = window.requestAnimationFrame(() => {
      if (rootElement.current) rootElement.current.scrollTop = saved.inner;
      window.scrollTo({ top: saved.outer, behavior: "instant" });
      if (pendingDestination.current) {
        const destination = rootElement.current?.querySelector<HTMLElement>(`[data-testid="${pendingDestination.current}"]`);
        if (destination) { destination.tabIndex = -1; destination.focus({ preventScroll: true }); destination.scrollIntoView({ block: "start" }); pendingDestination.current = null; }
      } else if (saved.focus) {
        const separator = saved.focus.indexOf(":");
        const kind = saved.focus.slice(0, separator), value = saved.focus.slice(separator + 1);
        const attribute = kind === "return" ? "data-sector-return-focus" : "data-sector-choice";
        rootElement.current?.querySelector<HTMLButtonElement>(`[${attribute}="${CSS.escape(value || "")}"]`)?.focus({ preventScroll: true });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [state.workspace, paper.route, paper.lens]);
  useEffect(() => {
    const controller = new AbortController(); let alive = true;
    for (const source of SECTOR_FEEDS) {
      void (async () => {
        let payload: FeedPayload;
        try {
          const res = await fetch(`/api/sector-intelligence?source=${source}`, {
            credentials: "same-origin", cache: "no-store", signal: controller.signal,
          });
          const body = object(await res.json()), receipt = object(body.receipt);
          const status = text(receipt.status) as FeedStatus;
          if (receipt.source !== source || !Object.hasOwn(STATUS_KEYS, status) || (status === "ready" && !res.ok)) {
            payload = emptyFeed(source, "invalid");
          } else {
            payload = { data: res.ok ? body.data : null, receipt: {
              source, status, path: text(receipt.path), asOf: text(receipt.asOf) || null,
              observedAt: text(receipt.observedAt) || null, contentHash: text(receipt.contentHash) || null,
              stale: receipt.stale === true,
              qualificationReasons: Array.isArray(receipt.qualificationReasons)
                ? receipt.qualificationReasons.filter((value): value is string => typeof value === "string") : undefined,
            } };
          }
        } catch {
          if (controller.signal.aborted) return;
          payload = emptyFeed(source, "error");
        }
        if (alive) setReceived(previous => ({ identity, revision,
          feeds: { ...(previous.identity === identity && previous.revision === revision ? previous.feeds : {}), [source]: payload } }));
      })();
    }
    return () => { alive = false; controller.abort(); };
  }, [identity, revision]);

  const sectors = useMemo(() => sectorRows(feeds.sector?.data), [feeds.sector]);
  const groups = useMemo(() => groupRows(feeds.confluence?.data), [feeds.confluence]);
  const themes = useMemo(() => themeRows(feeds.themes?.data), [feeds.themes]);
  const rotationHistory = useMemo(() => sectorRotationHistory(feeds.history?.data), [feeds.history]);
  const rotationEpisodes = useMemo(() => sectorRotationEpisodes(feeds.events?.data), [feeds.events]);
  const measuredRead = useMemo(() => feeds.sector?.receipt.status === "ready" ? sectorMeasuredRead(feeds.sector.data) : null, [feeds.sector]);
  const sector = useMemo(() => sectors.find(r => r.id === state.sector) || {}, [sectors, state.sector]);
  const group = useMemo(() => groups.find(r => r.key === state.group) || {}, [groups, state.group]);
  const roster = useMemo(() => members(group), [group]);
  const visibleMembers = useMemo(() => sortMembers(roster, state.sort, state.query), [roster, state.sort, state.query]);
  const cap = useMemo(() => concentration(feeds.heatmap?.data, text(sector.name)), [feeds.heatmap, sector.name]);
  const momentum = object(sector.momentum), heat = object(sector.heat), cycle = object(sector.cycle);
  const rotation = object(sector.rotation), conviction = object(sector.conviction), entry = object(group.entry), regime = object(group.regime);
  const status = feeds.sector?.receipt.status || "loading";
  const hasSector = !!sector.id;
  const completed = SECTOR_FEEDS.filter(k => feeds[k]).length;
  const ready = SECTOR_FEEDS.filter(k => feeds[k]?.receipt.status === "ready").length;
  const sectorSourceName = text(sector.name);
  const sectorName = text(lang === "zh" ? sector.name_zh : sector.name) || sectorSourceName || text(sector.ticker);
  const groupName = text(lang === "zh" ? group.label_zh : group.label) || text(group.label);
  const localName = (r: Row, en = "name", zh = "name_zh") => text(lang === "zh" ? r[zh] : r[en]) || text(r[en]);
  const stateLabel = (v: unknown) => t(STATE_KEYS[text(v).toLowerCase()] || "siUnavailable");
  const change = useCallback((patch: Partial<SectorState>, push = false, paperPatch: Partial<PaperSectorNavigation> = {}, returnHref?: string) => {
    const nextPaper = { ...paper, ...paperPatch }, next = normalizePaperSectorNative({ ...state, ...patch }, nextPaper);
    if (next.workspace !== state.workspace || nextPaper.route !== paper.route || nextPaper.lens !== paper.lens) saveWorkspaceScroll();
    setState(next); setPaper(nextPaper);
    const url = new URL(window.location.href);
    writeSectorState(url, next);
    const href = writePaperSectorState(url, nextPaper);
    const historyState = { ...object(window.history.state) };
    if (next.workspace !== "detail" || nextPaper.route !== "explore") delete historyState[PAPER_SECTOR_RETURN_KEY];
    else if (returnHref !== undefined) historyState[PAPER_SECTOR_RETURN_KEY] = { version: 1, href: returnHref };
    if (push) window.history.pushState(historyState, "", href);
    else window.history.replaceState(historyState, "", href);
  }, [state, paper, saveWorkspaceScroll]);
  const navigatePaper = (route: PaperSectorRoute, lens: PaperSectorLens = paper.lens) => {
    if (route === "explore") { setReturnWorkspace(paperWorkspaceForLens(lens)); setReturnState(null); setReturnPaper(null); }
    change({ ...(route === "explore" ? { workspace: paperWorkspaceForLens(lens) } : {}), sourcesOpen: false }, true, { route, lens });
  };
  const openSectorResearch = (sectorId: string, view: SectorView = "intelligence") => {
    const fromOuter = state.workspace !== "detail" || paper.route !== "explore";
    if (fromOuter) { setReturnWorkspace(state.workspace === "detail" ? paperWorkspaceForLens(paper.lens) : state.workspace); setReturnState(state); setReturnPaper(paper); }
    change({ sector: sectorId, workspace: "detail", view, group: "", company: "", query: "", expanded: false, sourcesOpen: false }, true, { route: "explore" }, fromOuter ? window.location.href : undefined);
  };
  const returnToOuterWorkspace = () => {
    const target = returnState ? { ...returnState, sourcesOpen: false } : { workspace: returnWorkspace, sourcesOpen: false };
    const paperTarget = returnPaper || { route: "explore" as const, lens: paper.lens };
    setReturnState(null); setReturnPaper(null); change(target, true, paperTarget);
  };
  const openTurns = () => {
    pendingDestination.current = "rotation-native-episodes";
    change({ workspace: "rotation", rotationMode: "list", sourcesOpen: false }, true, { route: "explore", lens: "rotation" });
  };
  const go = (view: SectorView) => change({ view, sourcesOpen: false }, true);
  const openSources = (opener?: HTMLElement) => {
    // WebKit does not reliably focus a pointer-activated button by itself.
    (opener || sourceTrigger.current)?.focus({ preventScroll: true });
    sourceReturn.current = window.location.href;
    change({ sourcesOpen: true }, true);
  };
  const inspectMeasuredGroup = (groupId: string, view: SectorView = "intelligence") => {
    // The measured owner uses ETF IDs (e.g. XLE); the native route uses row.id.
    // Join against the owner's explicit ID/ticker pair rather than case-normalising an identifier.
    const matches = sectors.filter(row => row.id === groupId || row.ticker === groupId);
    if (matches.length !== 1) { openSources(); return; }
    openSectorResearch(text(matches[0].id), view);
  };
  const closeSources = () => {
    // A source panel opened here adds one history entry; dismissing consumes it.
    // A direct/legacy bookmark has no local opener entry, so replace it safely.
    if (sourceReturn.current) { sourceReturn.current = null; window.history.back(); }
    else change({ sourcesOpen: false });
  };
  const sourcesLink = <button type="button" className={styles.textButton}
    onClick={event => openSources(event.currentTarget)}>{t("siOpenSources")} →</button>;
  const glanceKey = !hasSector ? "siGlanceUnavailable" : text(momentum.lead).toLowerCase() !== "leading" ? "siGlanceMixed"
    : text(conviction.label_en).toLowerCase() === "cautious" || text(cycle.phaseLabel).toLowerCase() === "rolling over" ? "siGlanceLeading" : "siGlanceLeadingPlain";
  const comparison = <SectorCompanyComparison rows={visibleMembers} selected={state.company} expanded={state.expanded}
    groupName={groupName} asOf={feeds.confluence?.receipt.asOf || null}
    onSelect={company => change({ company }, true)} onExpand={() => change({ expanded: !state.expanded })}
    onOpenTable={() => go("companies")} />;
  const counts = `${formatValue(count(heat.adv), 0)} ${t("siAdvancing")} / ${formatValue(count(heat.dec), 0)} ${t("siDeclining")}`;
  const axes = <div className={styles.axes}>
    <div><h3>{t("siStrength")}</h3><p>{t("siRS")} {rank(momentum.rs_21d_rank)} · {t("siRS63")} {rank(momentum.rs_rank)}</p><span>{momentum.above_200d === true ? t("siAbove200") : momentum.above_200d === false ? t("siBelow200") : t("siTrendUnknown")}</span></div>
    <div><h3>{t("siFormation")}</h3><p>{t("siSlow")}: {stateLabel(conviction.label_en)} · {stateLabel(cycle.phaseLabel)}</p><span>{t("siFast")}: {stateLabel(rotation.state)}</span></div>
    <div><h3>{t("siEntry")}</h3><p>{t("siNotConnected")}</p><span>{t("siEntryCopy")}</span></div>
    <div><h3>{t("siEvidence")}</h3><p>{ready} / {SECTOR_FEEDS.length} {t("siSourceCount")}</p><span>{t("siSourceRecordCopy")}</span></div>
  </div>;
  const pocket = <Card title={groupName || t("siPocket")} subtitle={t("siPocket")}>
    {!!group.key ? <><div className={styles.split}>
      <div><span>{t("siEntryOwner")}</span><strong>{["T1", "T2", "T3"].includes(text(entry.tier)) ? text(entry.tier) : "—"}</strong><small>{formatValue(count(group.n_priced), 0)} / {formatValue(count(group.n_members), 0)} {t("siPriced")}</small></div>
      <span className={styles.versus} aria-hidden="true">↔</span>
      <div><span>{t("siRegimeOwner")}</span><strong>{stateLabel(regime.state)}</strong><small>{feeds.confluence?.receipt.asOf || t("siUnknownDate")}</small></div>
    </div><details className={styles.explanation}><summary>{t("siWhyDiffer")}</summary><p>{t("siSplitCopy")}</p></details>
      <button className={styles.textButton} type="button" onClick={() => go("companies")}>{t("siSeeCompanies")} →</button></>
      : <p className={styles.muted}>{t("siNoMembers")}</p>}
  </Card>;
  const business = <Card title={t("siBusiness")} action={<span className={styles.badge}>{t("siNotConnected")}</span>}><p className={styles.muted}>{t("siBusinessCopy")}</p></Card>;
  const concentrationCard = <Card title={t("siConcentration")}>
    <span className={styles.muted}>{t("siTop5")}</span><strong className={styles.largeValue}>{formatValue(cap ? cap.share * 100 : null, 1, "%")}</strong>
    {cap && <><meter className={styles.meter} min={0} max={100} value={cap.share * 100} aria-label={t("siTop5")} /><p className={styles.muted}>{cap.names.join(" · ")} · {cap.count} {t("siTiles")}</p></>}
    <p className={styles.note}>{cap ? t("siCohortCopy") : t("siConcentrationMissing")}</p>
  </Card>;

  return <main ref={rootElement} className={`main2 ${styles.root}`} data-testid="sector-intelligence" data-sector-theme={state.theme} data-sector-workspace={state.workspace}>
    <SectorGroupBrowser open={groupBrowserOpen} groups={groups} selected={state.group}
      sourceSectorName={text(sector.name) || null} sectorLabel={sectorName} asOf={feeds.confluence?.receipt.asOf || null}
      status={feeds.confluence?.receipt.status || "loading"} theme={state.theme}
      onClose={() => setGroupBrowserOpen(false)} onReviewSources={() => { setGroupBrowserOpen(false); window.requestAnimationFrame(() => openSources()); }}
      onSelect={group => {
        setGroupBrowserOpen(false);
        if (group !== state.group) change({ group, view: "intelligence", query: "", sort: "source", company: "", expanded: false }, true);
      }} />
    <MobileSheet open={state.sourcesOpen} onClose={closeSources} ariaLabel={t("siSourcesPanel")}
      maxHeight="90dvh" initialFocus="sheet" className={`${styles.sourcePanel} ${state.theme === "light" ? styles.light : ""}`}>
      <div className={styles.sourceContent}>
        <header className={styles.sourcePanelHeader}><div><h2>{t("siSourcesPanel")}</h2>
          <p>{state.workspace === "detail" ? `${groupName || state.group || sectorName} · ${t(VIEW_KEYS[state.view])}`
            : t(state.workspace === "rotation" ? "siRotation" : state.workspace === "breadth" ? "siMarketBreadth" : "siDiscoverSectors")}</p></div>
          <button type="button" className={styles.button} onClick={closeSources}>{t("siCloseSources")}</button></header>
        <div className={styles.sectionHeading}><h2>{t("siSourceRecord")}</h2><p>{t("siSourceRecordCopy")}</p></div><div className={styles.sourceGrid}>
          {SECTOR_FEEDS.map(source => { const receipt = feeds[source]?.receipt; return <Card key={source} title={t(FEED_KEYS[source])} action={<span className={styles.badge}>{t(STATUS_KEYS[receipt?.status || "loading"])}</span>}>
            <dl className={styles.pairs}><div><dt>{t("siSnapshotDate")}</dt><dd>{receipt?.asOf || t("siUnknownDate")}</dd></div><div><dt>{t("siFetched")}</dt><dd>{receipt?.observedAt || "—"}</dd></div></dl>
            {receipt?.stale && <p className={styles.note}>{t("siStale")}</p>}
            <details className={styles.explanation}><summary>{t("siReceipt")}</summary><p>{t("siSourcePath")}</p><code>{receipt?.path || "—"}</code><p>{t("siHash")}</p><code>{receipt?.contentHash || "—"}</code></details>
          </Card>; })}</div>
      </div>
    </MobileSheet>
    <PaperSectorWorkspace lang={lang} theme={state.theme} feeds={feeds} route={paper.route} lens={paper.lens}
      onRoute={navigatePaper} onLens={lens => navigatePaper("explore", lens)}
      onInspect={id => inspectMeasuredGroup(id)} onSources={opener => openSources(opener)}
      onRefresh={() => setRevision(n => n + 1)} onTurns={openTurns}
      controls={<button type="button" className={styles.appearanceToggle} aria-label={t(state.theme === "dark" ? "siUseLight" : "siUseDark")} title={t(state.theme === "dark" ? "siUseLight" : "siUseDark")} onClick={() => change({ theme: state.theme === "dark" ? "light" : "dark" })}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="12" cy="12" r="7"/><path d="M12 5a7 7 0 0 1 0 14Z" fill="currentColor" stroke="none"/></svg></button>}
      entryAction={<button type="button" className={styles.textButton} onClick={() => inspectMeasuredGroup(measuredRead?.ranked[0]?.groupId || state.sector, "signals")}>{pick(lang, "siPaperCheckEntrySignals")} →</button>}
      explore={paper.lens === "rotation" ? <SectorRotationMap embedded rows={sectors} status={status} risk={feeds.risk}
        asOf={feeds.sector?.receipt.asOf || null} measured={measuredRead} selected={state.sector} mode={state.rotationMode} query={state.rotationQuery}
        history={rotationHistory} historyStatus={feeds.history?.receipt.status || "loading"}
        historyRevision={feeds.history?.receipt.contentHash || null}
        episodes={rotationEpisodes} episodesStatus={feeds.events?.receipt.status || "loading"}
        onMode={rotationMode => change({ rotationMode })} onQuery={rotationQuery => change({ rotationQuery })}
        onSources={() => openSources()} onSelect={sector => change({ sector }, true)}
        onOpenResearch={openSectorResearch} />
        : paper.lens === "confluence" ? <PaperSectorConfluence feeds={feeds} lang={lang} selected={state.group}
          onSelect={group => change({ group }, true)} onSources={opener => openSources(opener)} stateLabel={stateLabel} />
        : paper.lens === "themes" ? <PaperSectorThemes feeds={feeds} lang={lang} onSources={opener => openSources(opener)} stateLabel={stateLabel} />
        : <SectorCentralDiscovery rows={sectors} status={status}
        asOf={feeds.sector?.receipt.asOf || null} selected={state.sector} selectedSourceName={sectorSourceName}
        selectedCompany={state.company} query={state.discoveryQuery} companyTableQuery={state.companyTableQuery}
        sort={state.discoverySort} companyTableSort={state.companyTableSort}
        breadth={state.workspace === "breadth"} mode={state.discoveryMode}
        heatmapData={feeds.heatmap?.data} heatmapStatus={feeds.heatmap?.receipt.status || "loading"}
        heatmapAsOf={feeds.heatmap?.receipt.asOf || null} matrixTimeframe={state.matrixTimeframe}
        matrixIndustry={state.matrixIndustry} matrixBand={state.matrixBand}
        onQuery={discoveryQuery => change({ discoveryQuery })}
        onCompanyTableQuery={companyTableQuery => change({ companyTableQuery })}
        onSort={discoverySort => change({ discoverySort })}
        onCompanyTableSort={companyTableSort => change({ companyTableSort })}
        onClearCompanyFilters={() => change({ companyTableQuery: "", matrixIndustry: "", matrixBand: "" }, true)}
        onClearScope={() => change({ matrixIndustry: "", matrixBand: "" }, true)}
        onMode={discoveryMode => change({ discoveryMode })}
        onTimeframe={matrixTimeframe => change({ matrixTimeframe })}
        onIndustry={matrixIndustry => change({ matrixIndustry }, true)}
        onBand={matrixBand => change({ matrixBand }, true)}
        onMatrixCell={(matrixIndustry, matrixBand) => change({ matrixIndustry, matrixBand }, true)}
        onInspectIndustry={matrixIndustry => change({ discoveryMode: "table", matrixIndustry, matrixBand: "", companyTableQuery: "", company: "" }, true)}
        onCompany={company => change({ company }, true)} onSources={() => openSources()}
        onSelect={sector => change({ sector, matrixIndustry: "", matrixBand: "", company: "" }, true)}
        onOpenResearch={openSectorResearch} />}
      research={<PaperSectorResearch sector={sector} feeds={feeds} lang={lang}
        onLens={lens => navigatePaper("explore", lens)} onInspect={() => openSectorResearch(state.sector)}
        onSources={opener => openSources(opener)} />}
      watches={<PaperSectorWatches identity={identity} lang={lang} sector={sector} sectors={sectors} refreshEpoch={revision}
        onInspect={id => openSectorResearch(id)} /> }
      dossier={state.workspace === "detail" ? <section className={styles.paperDossier}>
        <div className={styles.depthNavigation} data-testid="sector-detail-depth">
          <button type="button" data-testid="sector-detail-return" onClick={returnToOuterWorkspace}>← {returnPaper?.route === "brief" ? (pick(lang, "siPaperReturnToBrief")) : returnPaper?.route === "research" ? (pick(lang, "siPaperReturnToResearch")) : returnPaper?.route === "watches" ? (pick(lang, "siPaperReturnToMyWatches")) : t(RETURN_KEYS[returnWorkspace])}</button>
          <span>{t("siResearchDepth")} · {sectorName || state.sector.toUpperCase()}</span>
        </div>
        <header className={styles.dossierHeading}><div><p className={styles.eyebrow}>{t("siResearchDepth")}</p><h2>{sectorName || state.sector.toUpperCase()}</h2></div>
          <div className={styles.controls}>
            <label>{t("siSector")}<select aria-label={t("siSector")} value={state.sector} onChange={event => change({ sector: event.target.value, group: "", query: "", company: "", expanded: false })}>
              {!sectors.some(row => row.id === state.sector) && <option value={state.sector}>{state.sector.toUpperCase()}</option>}
              {sectors.map(row => <option key={text(row.id)} value={text(row.id)}>{localName(row)} · {text(row.ticker)}</option>)}
            </select></label>
            <label>{t("siGroup")}<button type="button" className={styles.button} aria-label={t("siBrowseGroups")} aria-haspopup="dialog" aria-expanded={groupBrowserOpen}
              onClick={event => { event.currentTarget.focus({ preventScroll: true }); setGroupBrowserOpen(true); }}>{groupName || t("siChooseGroup")} ▾</button></label>
          </div>
        </header>

      <div className={styles.navigation}><nav ref={nav} className={styles.tabs} role="tablist" aria-label={t("siViews")} onKeyDown={event => {
        const index = SECTOR_VIEWS.indexOf(state.view);
        const next = event.key === "ArrowRight" ? (index + 1) % SECTOR_VIEWS.length : event.key === "ArrowLeft" ? (index + SECTOR_VIEWS.length - 1) % SECTOR_VIEWS.length : event.key === "Home" ? 0 : event.key === "End" ? SECTOR_VIEWS.length - 1 : -1;
        if (next < 0) return;
        event.preventDefault(); go(SECTOR_VIEWS[next]);
        nav.current?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
      }}>
        {SECTOR_VIEWS.map(view => <button type="button" key={view} id={`si-tab-${view}`} role="tab"
          aria-selected={state.view === view} aria-controls={`si-panel-${view}`} tabIndex={state.view === view ? 0 : -1}
          onClick={() => go(view)}>{t(VIEW_KEYS[view])}</button>)}
      </nav><button ref={sourceTrigger} type="button" className={styles.sourceTrigger} aria-haspopup="dialog"
        aria-expanded={state.sourcesOpen} onClick={event => openSources(event.currentTarget)}>{t("siSourcesPanel")}</button></div>
      <div className={styles.contextLine}><span className={styles.badge}>{t("siResearchOnly")}</span><span>{t("siDated")} · {feeds.sector?.receipt.asOf || t("siUnknownDate")}</span></div>
      {completed === SECTOR_FEEDS.length && ready < SECTOR_FEEDS.length && <div className={styles.notice} role="status"><div><strong>{t("siCompactPartial")}</strong></div>{sourcesLink}</div>}
      <div role="tabpanel" id={`si-panel-${state.view}`} aria-labelledby={`si-tab-${state.view}`} tabIndex={0} className={styles.view}>
        {state.view === "intelligence" && <>
          {status === "loading" ? <div className={styles.empty} role="status">{t("siLoading")}</div> : !hasSector ? <div className={styles.empty} role="status">
            <h2>{status === "access" ? t("siAccess") : t("siMissingTitle")}</h2><p>{status === "access" ? t("siAccessCopy") : status === "invalid" || status === "ready" ? t("siInvalidCopy") : t("siMissingCopy")}</p>
            {status === "access" && <Link className={styles.button} href="/login">{t("siSignIn")}</Link>}{sourcesLink}
          </div> : <section className={styles.hero}>
            <div className={styles.heroCopy}>
              <p className={styles.heroSubject}>{sectorName}</p><h2>{t(glanceKey)}</h2>
              <p>{t("siGlanceLimit")}</p>
              <button className={styles.textButton} type="button" data-testid="sector-primary-action" onClick={event => {
                if (group.key) go("companies");
                else { event.currentTarget.focus({ preventScroll: true }); setGroupBrowserOpen(true); }
              }}>{t(group.key ? "siSeeCompanies" : "siBrowseGroups")} →</button>
            </div>
            <div className={styles.metrics}>
              <Metric label={t("siRS")} value={rank(momentum.rs_21d_rank)} foot={`${t("siRS63")} ${rank(momentum.rs_rank)}`} />
              <Metric label={t("siParticipation")} value={formatValue(pct(heat.breadth_pct), 0, "%")} foot={counts} />
              <Metric label={t("siHeat")} value={formatValue(number(heat.heat_1M), 2, "%", true)} foot={t("siHeatMethod")} />
              <Metric label={t("siTop5")} value={formatValue(cap ? cap.share * 100 : null, 1, "%")} foot={cap ? `${cap.count} ${t("siTiles")}` : t("siNotConnected")} />
            </div>
          </section>}
          {comparison}
          <details className={styles.studyDisclosure}><summary>{t("siShowEvidence")}</summary>
            <div className={styles.columns}><div className={styles.stack}><Card title={t("siFocus")} subtitle={t("siSeparate")}>{axes}</Card>{pocket}</div>
              <aside className={styles.stack}>{business}<Card title={t("siTaxonomy")}><p className={styles.note}>{t("siTaxonomyCopy")}</p></Card></aside></div>
          </details>
        </>}
        {state.view === "signals" && <div className={styles.columns}><div className={styles.stack}><Card title={`${sectorName || state.sector.toUpperCase()} · ${t("siSectorSignals")}`} subtitle={t("siSeparate")}>{axes}</Card>
          <Card title={t("siSignals")}><div className={styles.callout}><h3>{sectorName || state.sector.toUpperCase()} · {t("siSlow")} / {t("siFast")}</h3><p>{stateLabel(conviction.label_en)} / {stateLabel(rotation.state)}</p><span>{t("siClockCopy")}</span></div><div className={styles.callout}><h3>{groupName || t("siGroup")} · {t("siEntryOwner")} / {t("siRegimeOwner")}</h3><p>{text(entry.tier) || "—"} / {stateLabel(regime.state)}</p><span>{t("siSplitCopy")}</span></div></Card>{business}
        </div><aside className={styles.stack}>{concentrationCard}<Card title={t("siCohort")}><p className={styles.note}>{t("siMembershipCopy")}</p></Card></aside></div>}
        {state.view === "companies" && <Card title={groupName || t("siCompanies")} subtitle={`${formatValue(count(group.n_members), 0)} ${t("siMembers")} · ${feeds.confluence?.receipt.asOf || t("siUnknownDate")}`}>
          <p className={styles.note}>{t("siCompanyCaution")}</p>
          <div className={styles.tableControls}><label>{t("siSearch")}<input type="search" aria-label={t("siSearch")} value={state.query} maxLength={40} onChange={e => change({ query: e.target.value })} /></label>
            <label>{t("siSort")}<select aria-label={t("siSort")} value={state.sort} onChange={e => change({ sort: e.target.value as SectorState["sort"] })}>
              <option value="source">{t("siSourceOrder")}</option><option value="return">{t("siByReturn")}</option><option value="relative">{t("siByRelative")}</option><option value="ticker">{t("siByTicker")}</option>
            </select></label><span aria-live="polite">{visibleMembers.length} / {roster.length} {t("siShowing")}</span></div>
          <div className={styles.tableWrap}><table className={styles.companyTable}><thead><tr>{["siTicker", "siPrice", "siReturn20", "siRelative", "siTier", "siTicks", "siSourceFlag", "siState"].map(key => <th key={key}>{t(key)}</th>)}</tr></thead>
            <tbody>{visibleMembers.map(row => <tr key={row.ticker} data-testid="sector-company-row">
              <td data-label={t("siTicker")}><button type="button" className={styles.tableSelect} aria-pressed={state.company === row.ticker}
                aria-label={`${t("siSelectCompany")}: ${row.ticker}`} onClick={() => change({ company: row.ticker, view: "intelligence", expanded: true, query: "" }, true)}>{row.ticker} →</button></td>
              <td data-label={t("siPrice")}>{formatValue(row.price, 2)}</td><td data-label={t("siReturn20")} data-sign={row.return20d === null || row.return20d === 0 ? undefined : row.return20d < 0 ? "down" : "up"}>{formatValue(row.return20d, 1, "%", true)}</td>
              <td data-label={t("siRelative")}>{formatValue(row.relative, 1, "pp", true)}</td><td data-label={t("siTier")}>{row.tier || t("siSourceUnrated")}</td>
              <td data-label={t("siTicks")}>{formatValue(row.ticks, 0)}</td><td data-label={t("siSourceFlag")}>{row.buyable === null ? "—" : row.buyable ? t("siYes") : t("siNo")}</td><td data-label={t("siState")}>{stateLabel(row.state)}</td>
            </tr>)}</tbody></table></div>
          {!visibleMembers.length && <p className={styles.empty}>{roster.length ? t("siNoMatches") : t("siNoMembers")}</p>}
          <p className={styles.muted}>{t("siMembershipCopy")}</p>
        </Card>}
        {state.view === "drivers" && <>{business}<details className={styles.studyDisclosure}><summary>{t("siThemesDisclosure")}</summary><div className={styles.sectionHeading}><h2>{t("siThemeContext")}</h2><p>{t("siThemeScope")}</p>{themeStaleLegs(feeds.themes?.data).length > 0 && <p role="status">{t("siThemeFreshnessLimited")}</p>}</div><div className={styles.themeGrid}>
          {themes.map(row => <Card key={text(row.theme_id)} title={localName(row, "name_en", "name_zh")}><dl className={styles.pairs}><div><dt>{t("siThemeStage")}</dt><dd>{stateLabel(object(row.foresight).stage)}</dd></div><div><dt>{t("siThemeReady")}</dt><dd>{themeEntryReady(row) === null ? t("siUnavailable") : themeEntryReady(row) ? t("siYes") : t("siNo")}</dd></div><div><dt>{t("siSnapshotDate")}</dt><dd>{feeds.themes?.receipt.asOf || t("siUnknownDate")}</dd></div></dl></Card>)}
          {!themes.length && <p className={styles.empty}>{t("siNoThemes")}</p>}</div><div className={styles.columns}><Card title={t("siTaxonomy")}><p className={styles.note}>{t("siTaxonomyCopy")}</p></Card></div></details></>}
        {state.view === "history" && <Card title={t("siHistoryEmpty")}>
          <p className={styles.muted}>{t("siReplayCopy")}</p>
          <p className={styles.note}>{t("siHistoryContext")}</p>{sourcesLink}
        </Card>}
      </div>
      </section> : undefined}
    />
  </main>;
}
