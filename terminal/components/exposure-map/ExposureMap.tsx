"use client";

import dynamic from "next/dynamic";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLang } from "@/lib/i18n";
import { useShellIdentity } from "@/components/chrome/AppShell";
import { useResearchAppearance } from "@/components/researchlab/useResearchAppearance";
import "@/components/researchlab/ResearchAppearance.css";
import type { TerminalVisualReadyDetail } from "@/lib/terminalBoot";
import type { ChartEngine, SeriesHandle } from "@/lib/chart-engine/api";
import type { GexMatrix } from "@/lib/gexLadder";
import type { ExposureLens } from "@/lib/exposureMapProjection";
import type { OptionsChartLevel } from "@/lib/optionsCompanion";
import { createExposureMapReader, exposureValue, type ExposureMapMetric } from "@/lib/exposureMap";
import { exposureChartFingerprint, exposureChartHref, type ExposureChartRequest } from "@/lib/exposureChartLink";
import { withExposureOrigin, type ExposureOrigin } from "@/lib/exposureOrigin";
import ExposureOriginStrip from "./ExposureOriginStrip";
import { useExposureOriginRoster } from "./useExposureOriginRoster";
import { createExposureMapPrimitive } from "@/lib/exposureMapPrimitive";
import type { ExposureNode } from "@/lib/marketStructure";
import { exposureMapT } from "./exposureMapStrings";
import ExposureDivergence, { type ExposureAverage } from "./ExposureDivergence";
import { GEX_AUTOCOMPLETE_ROOTS } from "@/lib/optionsRoots";
import ExposureBoard from "./ExposureBoard";
import ExposureDistance from "./ExposureDistance";
import { describeExposure } from "@/lib/exposureWorkspace";
import { GexMarketMemory } from "@/components/options-companion/GexMarketMemory";
import { optionsT } from "@/components/options-companion/optionsStrings";
import styles from "./ExposureMap.module.css";
import MobileSheet from "@/components/ui/MobileSheet";
import { useIsPhone } from "@/lib/useMediaQuery";

const ChartPanel = memo(dynamic(() => import("@/components/ChartPanel"), { ssr: false }));
const NONE = new Set<string>();
const METRICS = ["gamma", "delta", "vanna", "charm", "combined"] as const;

// Selecting a strike changes two rows; cached values in a dense book stay intact.
const ExposureNodeRow = memo(function ExposureNodeRow({ node, selected, onSelect }: {
  node: ExposureNode; selected: boolean; onSelect: (strike: number, button: HTMLButtonElement) => void;
}) {
  return <tr aria-selected={selected}><td><button type="button" onClick={(e) => onSelect(node.strike, e.currentTarget)}>{node.strike}</button></td><td>{exposureValue(node.netMn)}</td><td>{exposureValue(node.grossMn)}</td><td>{node.grossShare == null ? "—" : exposureValue(node.grossShare * 100)}</td></tr>;
});

/** Presentation over the desk's existing acquisitions; this component opens no options reader. */
export default function ExposureMap({ root, source, matrix, stale = false, sourceStatus = "data", onRetry, onOpenRoot, onView, onResearch, historySlot, archivedSession, onLatest, initialRequest, origin = null, onOriginStep }:
  { root: string; source: unknown; matrix: GexMatrix | null; stale?: boolean;
    sourceStatus?: "data" | "loading" | "absent" | "unavailable"; onRetry?: () => void; onOpenRoot?: (root: string) => void; onView?: (view: "matrix" | "strike" | "expiry") => void; onResearch?: () => void; historySlot?: ReactNode; archivedSession?: string | null; onLatest?: () => void; initialRequest?: ExposureChartRequest | null; origin?: ExposureOrigin | null; onOriginStep?: (next: { company: string; index: number }) => void }) {
  const { lang } = useLang();
  const phone = useIsPhone();
  useResearchAppearance(useShellIdentity());
  const t = exposureMapT(lang);
  const entry = initialRequest?.root === root ? initialRequest : null;
  const sectorOrigin = origin?.company === root ? origin : null;
  const originRoster = useExposureOriginRoster(sectorOrigin);
  const [metric, setMetric] = useState<ExposureMapMetric>(entry?.metric ?? "gamma");
  const [scope, setScope] = useState(entry?.lens.kind === "one" ? entry.lens.exp : entry?.lens.kind ?? "all");
  const [shock, setShock] = useState(entry?.shock ?? { spotPercent: 0, ivPoints: 0, calendarDays: 0 });
  const [mode, setMode] = useState<"net" | "gross">("net");
  const [tf, setTf] = useState("5m");
  const [view, setView] = useState<"focus" | "compare" | "scan">("focus");
  const [detail, setDetail] = useState<"expiries" | "values" | "changes">("expiries");
  const zh = lang === "zh";
  const [symbolDraft, setSymbolDraft] = useState({root,value:root});
  const symbolInput = symbolDraft.root === root ? symbolDraft.value : root;
  const setSymbolInput = (value: string) => setSymbolDraft({root,value});
  const commitSymbol = () => { const value = symbolInput.trim().toUpperCase(); if (/^[A-Z][A-Z0-9.]{0,11}$/.test(value)) onOpenRoot?.(value); else setSymbolInput(root); };
  const [showMa, setShowMa] = useState(true);
  const [dual, setDual] = useState(false);
  const [averages, setAverages] = useState<{ root: string; values: ExposureAverage[] }>({root:"",values:[]});
  const onAverages = useCallback((root: string, values: ExposureAverage[]) => setAverages({root,values}), []);
  const [api, setApi] = useState<ChartEngine | null>(null);
  const [ready, setReady] = useState<TerminalVisualReadyDetail | null>(null);
  const [selection, setSelection] = useState<{ identity: string; strike: number } | null>(null);
  const [pin, setPin] = useState<{ identity: string; strike: number } | null>(null);
  const inspector = useRef<HTMLElement>(null);
  const chartHost = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const primitive = useRef<ReturnType<typeof createExposureMapPrimitive> | null>(null);
  const lens = useMemo<ExposureLens>(() => scope === "all" || scope === "zero" || scope === "next-live" || scope === "week" ? { kind: scope } : { kind: "one", exp: scope }, [scope]);
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 15_000); return () => clearInterval(timer); }, []);
  const today = new Date(clock).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const readScope = useMemo(() => createExposureMapReader(source, root, matrix, today, clock), [source, root, matrix, today, clock]);
  const read = useMemo(() => readScope(lens, metric, shock), [readScope, lens, metric, shock]);
  // Include each source actually used by this read, not merely its calendar day.
  // Qualified joint cells and all-expiry legacy reads do not consume the matrix.
  const selectionMatrix = read.qualification === "legacy" && lens.kind !== "all" ? matrix : null;
  const [generation, setGeneration] = useState({ source, matrix: selectionMatrix, n: 0 });
  if (generation.source !== source || generation.matrix !== selectionMatrix) setGeneration({ source, matrix: selectionMatrix, n: generation.n + 1 });
  const identity = `${root}|${read.sourceAsOf}|${metric}|${scope}|${read.selectionKey}|${generation.n}|${JSON.stringify(shock)}`;
  const [returnCheck, setReturnCheck] = useState<{ identity: string; state: "ready" | "changed" | "unavailable" } | null>(null);
  const returnApplies = entry && (entry.archived ? archivedSession === entry.session : !archivedSession);
  useEffect(() => {
    if (!entry || !returnApplies || returnCheck || sourceStatus === "loading") return;
    let canceled = false;
    void (async () => {
      let state: "ready" | "changed" | "unavailable" = "unavailable";
      try {
        if (sourceStatus === "data") {
          const node = read.summary.nodes.find(item => item.strike === entry.strike);
          state = read.state === "data" && read.session === entry.session && node
            && (node.netMn != null || node.grossMn != null)
            && await exposureChartFingerprint(root, read, lens, metric, shock) === entry.fingerprint ? "ready" : "changed";
        }
      } catch { /* A source that cannot be compared cannot restore a selection. */ }
      if (canceled) return;
      setReturnCheck({ identity, state });
      if (state === "ready") setSelection({ identity, strike: entry.strike });
    })();
    return () => { canceled = true; };
  }, [entry, returnApplies, returnCheck, sourceStatus, read, root, lens, metric, shock, identity]);
  const selected = selection?.identity === identity ? read.summary.nodes.find((n) => n.strike === selection.strike) ?? null : null;
  const linkKey = `${identity}|${selected?.strike ?? ""}`;
  const currentLinkKey = useRef(linkKey);
  useLayoutEffect(() => { currentLinkKey.current = linkKey; return () => { currentLinkKey.current = ""; }; }, [linkKey]);
  const [linkState, setLinkState] = useState<{ key: string; status: "pending" | "failed" } | null>(null);
  const openMainChart = async () => {
    if (!selected || read.state !== "data" || !read.session) return;
    setLinkState({ key: linkKey, status: "pending" });
    try {
      const fingerprint = await exposureChartFingerprint(root, read, lens, metric, shock);
      if (currentLinkKey.current !== linkKey) return;
      const chartHref = exposureChartHref({ v: 1, root, session: read.session, strike: selected.strike, archived: !!archivedSession, metric, lens, shock, fingerprint });
      if (!chartHref) throw new Error("invalid exposure selection");
      window.location.assign(withExposureOrigin(chartHref, sectorOrigin));
    } catch {
      if (currentLinkKey.current === linkKey) setLinkState({ key: linkKey, status: "failed" });
    }
  };
  const pinned = useMemo<OptionsChartLevel | null>(() => pin?.identity === identity && read.state === "data" && read.session
    ? { root, price: pin.strike, session: read.session, label: `${exposureMapT(lang)("dated")} ${read.session}` } : null,
  [pin, identity, read.state, read.session, root, lang]);
  const onVisualReady = useCallback((detail: TerminalVisualReadyDetail) => setReady(detail), []);
  const chartCurrent = ready?.state === "data" && ready.symbol === root && ready.timeframe === tf;
  const vannaRead = useMemo(() => dual && metric === "gamma" ? readScope(lens, "vanna") : null, [dual, metric, readScope, lens]);
  const visibleAverages = !archivedSession && averages.root === root ? averages.values : [];
  const drawing = useMemo(() => {
    const css = typeof document !== "undefined" ? getComputedStyle(document.documentElement) : null;
    return { averages: !archivedSession && showMa && averages.root === root ? averages.values : [], secondary: vannaRead?.state === "data" ? vannaRead.summary.nodes : [], nodes: read.state === "data" ? read.summary.nodes : [], selected: selected?.strike ?? null, mode,
      color: css?.getPropertyValue("--brand-2").trim() || "#4d82ff", selectedColor: css?.getPropertyValue("--exposure-selected").trim() || "#d4a017" };
  }, [read.state, read.summary.nodes, selected?.strike, mode, showMa, averages, root, vannaRead, archivedSession]);
  useLayoutEffect(() => {
    if (!api?.inventory().alive || !chartCurrent) return;
    // This view fixes chartType=candles: select the actual owned price handle, not a volume pane.
    const series: SeriesHandle | undefined = api.panes()[0]?.getSeries().find((s) => s.kind === "candles");
    if (!series) return;
    const p = createExposureMapPrimitive({ nodes: [], selected: null, mode: "net", color: "", selectedColor: "" });
    series.attachPrimitive(p); primitive.current = p;
    return () => { if (api.inventory().alive && api.panes()[0]?.getSeries().includes(series)) series.detachPrimitive(p); if (primitive.current === p) primitive.current = null; };
  }, [api, ready, chartCurrent, root, tf]);
  useLayoutEffect(() => { primitive.current?.set(chartCurrent ? drawing : { ...drawing, nodes: [], selected: null }); }, [drawing, api, ready, chartCurrent, root, tf]);
  const close = useCallback(() => { setSelection(null); returnFocus.current?.focus(); }, []);
  useEffect(() => {
    if (!api?.inventory().alive || !chartCurrent) return;
    const pick = (event: { point?: { x: number; y: number } }) => {
      const hit = event.point && primitive.current?.hitTest?.(event.point.x, event.point.y);
      const strike = hit?.data?.strike;
      if (typeof strike !== "number") return;
      returnFocus.current = chartHost.current;
      setSelection({ identity, strike });
      requestAnimationFrame(() => inspector.current?.focus());
    };
    api.subscribeClick(pick);
    return () => { if (api.inventory().alive) api.unsubscribeClick(pick); };
  }, [api, chartCurrent, identity]);
  useEffect(() => {
    if (!selected) return;
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); close(); } };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [selected, close]);
  const select = useCallback((strike: number, button: HTMLButtonElement) => {
    returnFocus.current = button; setSelection({ identity, strike });
    requestAnimationFrame(() => { inspector.current?.focus(); });
  }, [identity]);
  const s = read.summary;
  const focus = selected ?? s.netLeader;
  const structure = useMemo(() => describeExposure(s.nodes, read.spot, focus?.strike ?? null), [s.nodes, read.spot, focus?.strike]);
  const expiryReads = useMemo(() => read.expiries.map(exp => ({ exp, read: readScope({ kind: "one", exp }, metric, shock) })), [read.expiries, readScope, metric, shock]);
  const leaderStructure = useMemo(() => describeExposure(s.nodes, read.spot, s.netLeader?.strike ?? null), [s.nodes, read.spot, s.netLeader?.strike]);
  // A metric the admitted book cannot serve stays visible and locked with its reason; it is never hidden or promoted.
  const metricLocks = useMemo(() => {
    const locks: Partial<Record<ExposureMapMetric, string>> = {};
    const tt = exposureMapT(lang);
    if (readScope({ kind: "all" }, "gamma", shock).state !== "data") return locks;
    for (const m of ["delta", "vanna", "charm"] as const) {
      if (readScope({ kind: "all" }, m, shock).state !== "data") locks[m] = tt(m === "delta" ? "deltaRefused" : "metricLocked");
    }
    return locks;
  }, [readScope, shock, lang]);
  const projection = source && typeof source === "object" ? (source as { exposure_projection?: { security_id?: unknown; schema?: unknown } }).exposure_projection : null;
  const bookIdentity = projection && typeof projection.security_id === "string" ? `${projection.security_id} · ${String(projection.schema ?? "").endsWith("/v2") ? "v2" : "v1"}` : t("legacyBook");
  const qualificationLabel = stale ? t("stale") : read.qualification === "qualified" ? t("contractCoverage") : read.qualification === "dated" ? t("vendorEodApproximation") : t("aggregateSnapshot");
  const clockText = (v: string | null | undefined) => v ? (v.length > 16 ? `${v.slice(5, 10)} ${v.slice(11, 16)}${v.endsWith("Z") ? "Z" : ""}` : v) : t("missing");
  // Strike × expiry field: the 24 strikes nearest spot across the first 12 expiries; tiers are relative to the field's own largest cell.
  const field = useMemo(() => {
    const columns = expiryReads.slice(0, 12).map(({ exp, read: r }) => {
      const byStrike = new Map<number, ExposureNode>();
      if (r.state === "data") for (const n of r.summary.nodes) byStrike.set(n.strike, n);
      return { exp, read: r, byStrike };
    });
    const pick = (n: ExposureNode | undefined) => n ? (mode === "gross" ? n.grossMn : n.netMn) : null;
    const spot = read.spot;
    const strikes = [...s.nodes].sort((a, b) => (spot == null ? 0 : Math.abs(a.strike - spot) - Math.abs(b.strike - spot)) || a.strike - b.strike).slice(0, 24).map(n => n.strike).sort((a, b) => b - a);
    let maxAbs = 0;
    for (const c of columns) for (const k of strikes) { const v = pick(c.byStrike.get(k)); if (v != null && Math.abs(v) > maxAbs) maxAbs = Math.abs(v); }
    const dominant = columns.map(c => { let best: number | null = null; let bestAbs = -1; for (const k of strikes) { const v = pick(c.byStrike.get(k)); if (v != null && Math.abs(v) > bestAbs) { bestAbs = Math.abs(v); best = k; } } return best; });
    const spotRow = spot == null ? null : [...strikes].filter(k => k > spot).sort((a, b) => a - b)[0] ?? null;
    const tier = (v: number | null) => { if (v == null) return "u"; if (maxAbs <= 0) return "0"; const r = Math.abs(v) / maxAbs; return r >= 0.7 ? "5" : r >= 0.45 ? "4" : r >= 0.25 ? "3" : r >= 0.12 ? "2" : r >= 0.04 ? "1" : "0"; };
    const rows = strikes.map(k => ({ strike: k, spot: k === spotRow, cells: columns.map((c, i) => { const v = pick(c.byStrike.get(k)); return { value: v, tier: tier(v), dominant: dominant[i] === k }; }) }));
    return { columns, rows };
  }, [expiryReads, s.nodes, read.spot, mode]);
  const attribution = useMemo(() => metric === "combined" && read.qualification === "qualified" ? ([
    ["gamma", shock.spotPercent], ["vanna", shock.ivPoints], ["charm", shock.calendarDays],
  ] as const).map(([greek, weight]) => {
    const component = readScope(lens, greek).summary.netTotalMn;
    return {greek, weight, value:weight === 0 ? 0 : component == null ? null : -component * weight};
  }) : [], [metric, read.qualification, readScope, lens, shock]);
  const frameData = useRef({ nodes:s.nodes, focus:selected?.strike });
  useLayoutEffect(() => { frameData.current = {nodes:s.nodes,focus:selected?.strike}; }, [s.nodes,selected?.strike]);
  const frameChart = useCallback(() => {
    if (!api?.inventory().alive) return;
    const series = api.panes()[0]?.getSeries().find(item => item.kind === "candles");
    const bars = series?.data() ?? [], count = bars.length, windowSize = tf === "5m" ? 78 : 65;
    if (!series || !count) return;
    api.timeScale().setVisibleLogicalRange({from:Math.max(0,count-windowSize),to:count+18});
    const prices:number[] = [];
    for (const bar of bars.slice(-windowSize)) for (const field of ["low","high"] as const) {
      const value = (bar as unknown as Record<string,unknown>)[field];
      if (typeof value === "number" && Number.isFinite(value)) prices.push(value);
    }
    const ranked = frameData.current.nodes.filter(n => n.netMn != null && n.netMn !== 0).slice().sort((a,b) => Math.abs(b.netMn!) - Math.abs(a.netMn!));
    prices.push(...ranked.slice(0,6).map(n => n.strike));
    if (frameData.current.focus != null) prices.push(frameData.current.focus);
    if (prices.length) {
      const low = Math.min(...prices), high = Math.max(...prices), pad = Math.max((high-low)*.12,high*.0005);
      series.priceScale().setVisibleRange({from:Math.max(.001,low-pad),to:high+pad});
    }
  }, [api, tf]);
  useEffect(() => { if (chartCurrent) frameChart(); }, [chartCurrent, ready, frameChart, scope, metric, s.netLeader?.strike]);
  const openRoot = (symbol: string) => { onOpenRoot?.(symbol); setView("focus"); };
  const signed = (n: number | null) => n == null ? "—" : `${n > 0 ? "+" : ""}${exposureValue(n)}`;
  const presets = [
    { name: t("unchanged"), spotPercent: 0, ivPoints: 0, calendarDays: 0 },
    { name: t("spotDownIvUp"), spotPercent: -1, ivPoints: 1, calendarDays: 0 },
    { name: t("spotUpIvDown"), spotPercent: 1, ivPoints: -1, calendarDays: 0 },
    { name: t("oneDayPasses"), spotPercent: 0, ivPoints: 0, calendarDays: 1 },
  ];
  const inspectorPanel = <aside ref={inspector} tabIndex={-1} className={styles.inspector} aria-label={t("inspect")} data-testid="exposure-node-inspector">
        <span className={styles.eyebrow}>{selected ? (t("nodeInvestigation")) : (t("structureAtAGlance"))}</span>
        <h3>{selected ? `${t("selected")} ${selected.strike}` : (t("priceToPositioning"))}</h3>
        {s.coveredOnly && <p className={styles.note}>{t("measuredContributions")} · {t("measuredOnlyExplanation")}</p>}
        {focus && <><div className={styles.routeHero}><span>${exposureValue(read.spot)}</span><span>→</span><strong>{focus.strike}</strong></div><dl>
          <dt>{t("distance")}</dt><dd>{signed(structure.distancePoints)} · {signed(structure.distancePercent)}%</dd>
          <dt>{t(metric === "combined" ? "hedgeDemand" : "net")}</dt><dd>{signed(focus.netMn)}M</dd>
          <dt>{t("gross")}</dt><dd>{focus.grossMn == null ? "—" : `${exposureValue(focus.grossMn)}M`}</dd>
          <dt>{t("share")}</dt><dd>{focus.grossShare == null ? "—" : `${exposureValue(focus.grossShare * 100)}%`}</dd>
        </dl><ExposureDistance root={root} session={read.session} spot={read.spot} target={focus.strike} zh={zh} /><div className={styles.route}><span className={styles.eyebrow}>{t("interveningStrikes")}</span>{structure.intervening.length ? structure.intervening.slice(0, 5).map(n => <button key={n.strike} type="button" onClick={e => select(n.strike, e.currentTarget)}><b>{n.strike}</b><span>{signed(n.netMn)}M</span></button>) : <p className={styles.note}>{t("noSuppliedStrikesBetweenTheReferenceSpotAnd")}</p>}<small>{t("distanceInvestigationNoPathOrArrivalProbability")}</small></div></>}
        {selected && <div className={styles.inspectorActions}><button type="button" className={styles.primary} aria-pressed={pinned?.price === selected.strike} onClick={() => setPin(pinned?.price === selected.strike ? null : { identity, strike: selected.strike })}>{pinned?.price === selected.strike ? t("unpin") : t("pin")}</button><button type="button" disabled={linkState?.key === linkKey && linkState.status === "pending"} onClick={() => void openMainChart()}>{t("openOnMainChart")}</button><button type="button" onClick={close}>{t("close")}</button></div>}
        {linkState?.key === linkKey && linkState.status === "failed" && <p role="status" className={styles.note}>{t("referenceLinkFailed")}</p>}
        <div className={styles.rankedNodes}><span className={styles.eyebrow}>{t("largestNetNodes")}</span>{structure.ranked.slice(0, 5).map((n, i) => <button key={n.strike} type="button" onClick={e => select(n.strike, e.currentTarget)} aria-pressed={selected?.strike === n.strike}><span><small>{String(i + 1).padStart(2, "0")}</small> {n.strike}</span><b data-sign={n.netMn! < 0 ? "negative" : "positive"}>{signed(n.netMn)}M</b></button>)}</div>
        <p className={styles.note}>{t("model")}{metric === "delta" && (t("deltaAppliesAssumedLongCallShortPutInventory"))}</p>
      </aside>;
  return <section className={styles.map} data-testid="exposure-map" data-chart-ready={chartCurrent ? "true" : "false"} data-source-root={root} data-source-session={read.session ?? ""}>
    <nav className={styles.workspaceNav} aria-label={t("exposureWorkspace")}>
      <input list="exposure-roots" value={symbolInput} onChange={e => setSymbolInput(e.target.value.toUpperCase())} onBlur={commitSymbol} onKeyDown={e => { if (e.key === "Enter") commitSymbol(); }} aria-label={t("exposureSymbol")} maxLength={12} />
      <datalist id="exposure-roots">{GEX_AUTOCOMPLETE_ROOTS.map(r => <option key={r}>{r}</option>)}</datalist>
      {(["focus", "compare", "scan"] as const).map(v => <button type="button" key={v} aria-pressed={view === v} onClick={() => setView(v)}>{v === "focus" ? (t("structure")) : v === "compare" ? (t("compare")) : (t("scanner"))}</button>)}
      <div className={styles.navMeta}><span className={styles.navQuality} data-quality={read.coverage ? read.qualification : "legacy"}><i aria-hidden="true" />{t("dataQuality")} · {read.coverage ? `${read.coverage.qualified.toLocaleString()}${read.coverage.expected == null ? "" : ` / ${read.coverage.expected.toLocaleString()}`}` : t("legacyBook")}</span><details className={styles.learn}><summary aria-label={t("learnTheView")}>?</summary><div><strong>{t("exposureMapView")}</strong><p>{t("model")}</p><p>{t("units")}</p><p>{t("tieRule")}</p></div></details></div><details className={styles.moreViews}><summary>{t("tools")}</summary><div>{(["matrix","strike","expiry"] as const).map(v => <button type="button" key={v} onClick={() => onView?.(v)}>{v === "matrix" ? (t("expiryMatrix")) : v === "strike" ? (t("strikeLadder")) : (t("expiryProfile"))}</button>)}<button type="button" onClick={onResearch}>{t("label3dResearchLab")}</button></div></details>
    </nav>
    {view !== "focus" ? <ExposureBoard mode={view} onOpen={openRoot} /> : <>
    {sectorOrigin && <ExposureOriginStrip origin={sectorOrigin} lang={lang} roster={originRoster} onStep={next => onOriginStep?.(next)} />}
    {archivedSession && <div className={styles.archiveNotice} role="status"><div><strong>{t("storedSnapshot")} · {archivedSession}</strong><p>{t("theStoredBookIsShownAgainstTheCurrent")}</p></div><button type="button" onClick={onLatest}>{t("returnToLatestBook")}</button></div>}
    {returnApplies && (!returnCheck || returnCheck.identity === identity) && <p className={styles.note} role="status" data-testid="exposure-return-check" data-state={returnCheck?.state ?? "loading"}>{t(!returnCheck ? "referenceChecking" : returnCheck.state === "ready" ? "selectionRestored" : returnCheck.state === "changed" ? "selectionChanged" : "referenceUnavailable")}</p>}
    <div className={styles.overviewBar}><header className={styles.heading}><div className={styles.instrument}><span className={styles.crumb}>{t("breadcrumb")} · {root}</span><h2>{root} <span className={styles.viewTitle}>{t("exposureMapView")}</span></h2><p className={styles.identity}><code>{bookIdentity}</code><em className={stale ? styles.pillWarn : read.qualification === "qualified" ? styles.pillInfo : styles.pillMuted}>{qualificationLabel}</em></p><p className={styles.referenceLine}>{t("referenceSpot")} ${exposureValue(read.spot)} · {read.sourceAsOf ?? read.session ?? "—"} · {read.expiries.length} {t("expiriesCount")} · {s.offered} {t("strikesCount")}</p><p className={styles.honesty}>{read.qualification === "qualified" ? t("coveredQualified") : t("model")}</p></div><div className={styles.actions}><button type="button" className={styles.badge} onClick={() => { const details = document.getElementById("exposure-source-details") as HTMLDetailsElement | null; if (details) { details.open = true; details.scrollIntoView({ block: "nearest", behavior: "smooth" }); } }}>{t("sourcesAndCoverage")} ↗</button><a className={styles.primaryLink} href={`/analysis?view=investigations&symbol=${encodeURIComponent(root)}`}>{t("openInvestigation")}</a></div></header>
    <div className={styles.toolbar}>
      <div role="group" aria-label={t("metric")} className={styles.metricControl}>{METRICS.map(m => { const lock = metricLocks[m]; return <button type="button" key={m} aria-pressed={metric === m} data-locked={lock ? "true" : undefined} title={lock ?? (m === "delta" ? t("deltaAssumedInventory") : m === "combined" ? t("scenarioStress") : undefined)} onClick={() => { setMetric(m); setScope("all"); setMode("net"); setDual(false); }}>{t(m === "delta" ? "deltaShort" : m === "combined" ? "combinedShort" : m)}{m === "delta" && ["qualified", "dated"].includes(read.qualification) && <em title={t("deltaExtensionNote")}>{t("deltaExtension")}</em>}{lock && <i aria-hidden="true">🔒</i>}</button>; })}</div>
      <label>{t("scope")}<select aria-label={t("scope")} value={scope} disabled={metric !== "gamma" && read.qualification !== "qualified"} onChange={(e) => setScope(e.target.value)}>
        <option value="all">{t("all")}</option><option value="zero">{t("zero")}</option>
        <option value="next-live" disabled={read.qualification !== "qualified"}>{t("nextLive")}</option><option value="week" disabled={read.qualification !== "qualified"}>{t("week")}</option>
        {read.expiries.map((exp) => <option key={exp} value={exp}>{exp}</option>)}
      </select></label>
      <button type="button" aria-pressed={dual} disabled={metric !== "gamma"} onClick={() => setDual(v => !v)}>{t("gammaVannaLayers")}</button><div className={styles.segment}><button type="button" aria-pressed={mode === "net"} onClick={() => setMode("net")}>{t(metric === "combined" ? "hedgeDemand" : "net")}</button><button type="button" aria-pressed={mode === "gross"} disabled={metric !== "gamma" || s.grossTotalMn == null} onClick={() => setMode("gross")}>{t("gross")}</button></div>
    </div>
    </div>
    {dual && <p className={styles.note}>{vannaRead?.state === "data" ? (phone ? (t("dualLayersSolidGammaOutlinedVannaSeparateScales")) : t("dualLayersSolidGammaAndOutlinedVannaAt")) : (t("noJointVannaCellsForThisScopeGamma"))}</p>}
    {metric === "combined" && <section className={styles.scenario}><div className={styles.sectionHead}><div><span className={styles.eyebrow}>{t("conditionalMechanics")}</span><h3>{t("changeTheAssumptionsInspectHedgeDemand")}</h3></div></div><div className={styles.presetRow}>{presets.map(({ name, ...values }) => <button type="button" key={name} onClick={() => setShock(values)}>{name}</button>)}</div><div className={styles.toolbar}>
      {(["spotPercent", "ivPoints", "calendarDays"] as const).map((key) => <label key={key}>{t(key)}<input type="number" step={0.25} min={key === "calendarDays" ? 0 : key === "spotPercent" ? -3 : -5} max={key === "spotPercent" ? 3 : 5} value={Number.isNaN(shock[key]) ? "" : shock[key]} onChange={(e) => setShock({ ...shock, [key]: e.target.value === "" ? NaN : Number(e.target.value) })} /></label>)}
    </div>{attribution.length > 0 && <div className={styles.attribution}>{attribution.map(a => <div key={a.greek}><span>{a.greek[0].toUpperCase() + a.greek.slice(1)} × {a.weight}</span><strong data-sign={(a.value ?? 0) < 0 ? "negative" : "positive"}>{signed(a.value)} M</strong></div>)}<div><span>{t("jointQualifiedPopulationTotal")}</span><strong>{signed(s.netTotalMn)} M</strong></div></div>}<p className={styles.note}>{t("localScenario")} {t("positiveIsModeledHedgeBuyingNegativeIsSelling")}</p></section>}
    {read.state !== "data" && <div className={styles.empty} role="status">{sourceStatus === "loading" ? t("loading") : sourceStatus === "absent" ? t("absent") : sourceStatus === "unavailable" ? t("readFailed") : ["wrong_root", "future", "malformed"].includes(read.state) ? t("invalid") : t("noData")}
      {sourceStatus === "unavailable" && onRetry && <button type="button" onClick={onRetry}>{t("retry")}</button>}{metric === "combined" && <p>{t("noCombination")}</p>}</div>}
    {s.coveredOnly && read.coverage && <p className={styles.note} data-testid="exposure-partial-coverage"><strong>{t("measuredContracts")}: {read.coverage.qualified.toLocaleString()} / {(read.coverage.qualified + read.coverage.missing).toLocaleString()} · {t("missing")}: {read.coverage.missing.toLocaleString()}.</strong></p>}
    <div className={styles.leaders}>
      <div className={styles.stat}><span>{t(s.coveredOnly ? "measuredNet" : "coveredBookNet")}</span><strong data-sign={(s.netTotalMn ?? 0) < 0 ? "negative" : "positive"}>{signed(s.netTotalMn)}<small> M</small></strong><small>{metric === "gamma" ? (t("per1Spot")) : metric === "vanna" ? (t("per1IvPoint")) : metric === "delta" ? (t("assumedInventoryDollarDelta")) : metric === "charm" ? (t("perCalendarDay")) : (t("explicitShocks"))}</small></div>
      <button type="button" disabled={!s.netLeader} onClick={(e) => s.netLeader && select(s.netLeader.strike, e.currentTarget)}><span>{t(metric === "combined" ? "largestDemand" : s.coveredOnly ? "provisionalNetLeader" : "largestNet")}</span><strong>{s.netLeader ? `${s.netLeader.strike}` : "—"}</strong><small>{signed(s.netLeader?.netMn ?? null)}M{s.netLeader?.grossShare != null ? ` · ${exposureValue(s.netLeader.grossShare * 100, 1)}% ${t("ofGross")}` : ""}{leaderStructure.contested ? (t("contested")) : ""}</small></button>
      <div className={styles.stat} data-contested={leaderStructure.contested ? "true" : "false"}><span>{t("contestedRunnerUp")}</span>{leaderStructure.runnerUpRatio == null || !leaderStructure.ranked[1] ? <em className={styles.pillMuted}>n/a · {t("singleNode")}</em> : <><strong>{leaderStructure.ranked[1].strike}<small> {leaderStructure.runnerUpRatio.toFixed(2)}×</small></strong><div className={styles.ratio} aria-hidden="true"><i style={{ width: `${Math.min(100, leaderStructure.runnerUpRatio * 100)}%` }} /><b /></div></>}<small>{t("threshold")} 0.90 · runner-up-ratio/v1</small></div>
      {read.coverage ? <div className={styles.stat}><span>{t("qualifiedContracts")}</span><strong>{read.coverage.qualified.toLocaleString()}<small> / {(read.coverage.expected ?? read.coverage.qualified + read.coverage.missing).toLocaleString()}</small></strong><small>{read.coverage.missing.toLocaleString()} {t("withoutIdentity")}</small></div> : <div className={styles.stat}><span>{t("publishedCoverage")}</span><strong>{s.netKnown}<small> / {s.fullCount ?? s.offered}</small></strong><small>{s.population === "full" ? (t("publishedStrikes")) : (t("knownNetStrikes"))}</small></div>}
      <div className={`${styles.stat} ${styles.clocks}`}><span>{t("clocksLabel")}</span>{read.clocks ? <><strong>{t("observed")} <small>{clockText(read.clocks.option_observed_at)}</small></strong><small>{t("oiAsOf")} {read.clocks.oi_report_date ?? t("missing")} · {t("published")} {clockText(read.clocks.published_at ?? read.clocks.available_at)}</small></> : <><strong>{read.sourceAsOf ?? "—"}</strong><small>{t("asof")}</small></>}</div>
    </div>
    <div className={styles.workspace}>
      <div className={styles.chartColumn}>
        <div className={styles.chartTools}><div className={styles.segment} aria-label={t("timeframe")}>{["5m", "30m", "2h", "D", "W"].map(f => <button type="button" key={f} aria-pressed={tf === f} onClick={() => setTf(f)}>{f}</button>)}</div><div><button type="button" aria-pressed={showMa} onClick={() => setShowMa(v => !v)}>{phone ? "MA" : t("ma")}</button><button type="button" title={t("resetView")} onClick={frameChart}>{phone ? (t("fit")) : (t("resetView"))}</button></div></div>
        {showMa && !archivedSession && <div className={styles.averageStrip}>{visibleAverages.map(a => <span key={a.label} title={`${a.label} · ${new Date(a.observedAt * 1000).toISOString().slice(0,16)} ET`}><b>{a.label}</b> {exposureValue(a.price)} <time>{new Date(a.observedAt * 1000).toISOString().slice(5,10)}</time></span>)}<small>{t("closedBarSnapshotReferences")}</small></div>}
        <div ref={chartHost} tabIndex={-1} className={styles.chart} aria-label={t("chart")}>
          <div className={styles.chartBody}><ChartPanel symbol={root} indicators={NONE} timeframe={tf} onChartApi={setApi} onVisualReady={onVisualReady} optionsLevel={pinned} userTier="free" /></div>
          <div className={styles.caption}><span>{t("positiveExposureNegativeExposureSelectedNode")}</span><span>{t("reference")}</span></div>
        </div>
        {!archivedSession && <ExposureDivergence root={root} onAverages={onAverages} />}
      </div>
      {phone ? <MobileSheet open={!!selected} onClose={close} title={`${root} · ${t("inspect")}`} ariaLabel={t("inspect")} detents={[60,94]} maxHeight="94svh" initialFocus="sheet" escapeKey="bubble" className={`${styles.map} ${styles.inspectorSheet}`}>{inspectorPanel}</MobileSheet> : inspectorPanel}
    </div>
    <section className={styles.analytics}>
      <div className={styles.sectionHead}><div><span className={styles.eyebrow}>{t("bookAnatomy")}</span><h3>{detail === "expiries" ? (t("expirationContributions")) : detail === "changes" ? (t("observedBookChanges")) : t("values")}</h3></div><div className={styles.segment}><button type="button" aria-pressed={detail === "expiries"} onClick={() => setDetail("expiries")}>{t("compareExpiries")}</button><button type="button" aria-pressed={detail === "changes"} onClick={() => setDetail("changes")}>{t("changes")}</button><button type="button" aria-pressed={detail === "values"} onClick={() => setDetail("values")}>{t("exactValues")}</button></div></div>
    {detail === "changes" ? (read.session ? <GexMarketMemory root={root} matrixSession={read.session} strike={focus?.strike ?? null} t={optionsT(lang)} currentSnapshot={source} lens={lens} lang={lang} onSelectStrike={strike => setSelection({ identity, strike })} /> : <p className={styles.note}>{t("noData")}</p>) : detail === "expiries" ? <><div className={styles.fieldWrap}><table className={styles.field} aria-label={t("strikeByExpiry")}><thead><tr><th scope="col">{t("selected")}</th>{field.columns.map(({ exp, read: r }) => <th scope="col" key={exp}><button type="button" disabled={r.state !== "data" || !r.summary.netKnown} aria-pressed={scope === exp} onClick={() => setScope(exp)}><span>{exp}</span><strong data-sign={(r.summary.netTotalMn ?? 0) < 0 ? "negative" : "positive"}>{r.state === "data" && r.summary.netTotalMn != null ? `${signed(r.summary.netTotalMn)}M` : "—"}</strong><small>{r.summary.netTotalMn == null ? (zh ? `${r.summary.netKnown} 个已知行 · 不完整` : `${r.summary.netKnown} known strikes · incomplete`) : `${t(r.summary.coveredOnly ? "provisionalNetLeader" : "leadNode")} ${r.summary.netLeader?.strike ?? "—"}`}</small></button></th>)}</tr></thead><tbody>{field.rows.map(row => <tr key={row.strike} aria-selected={selected?.strike === row.strike} data-spot={row.spot ? "true" : undefined}><th scope="row"><button type="button" title={row.spot ? t("nearestSpotRow") : undefined} onClick={e => select(row.strike, e.currentTarget)}>{row.strike}</button></th>{row.cells.map((cell, i) => <td key={field.columns[i].exp} data-tier={cell.tier} data-sign={cell.value == null ? "unknown" : cell.value < 0 ? "negative" : "positive"} data-dominant={cell.dominant ? "true" : undefined} title={cell.value == null ? t("missing") : undefined} onClick={e => { const button = e.currentTarget.closest("tr")?.querySelector("button"); if (button) select(row.strike, button); }}>{cell.value == null ? "—" : `${cell.value < 0 ? "−" : cell.value > 0 ? "+" : ""}${exposureValue(Math.abs(cell.value), Math.abs(cell.value) >= 100 ? 0 : 1)}`}</td>)}</tr>)}</tbody></table></div><p className={styles.note}>{t("exactExpiryCellContributionsMissingCellsAreNot")}</p></> : <div className={styles.scroll}><table><thead><tr><th>{t("selected")}</th><th>{t(metric === "combined" ? "hedgeDemand" : "net")}</th><th>{t("gross")}</th><th>%</th></tr></thead><tbody>{s.nodes.map(n => <ExposureNodeRow key={n.strike} node={n} selected={n.strike === selected?.strike} onSelect={select} />)}</tbody></table></div>}
    </section>
    </>}
    {historySlot && <details className={`${styles.source} ${styles.history}`} data-testid="exposure-stored-snapshots"><summary>{t("storedBookSnapshots")}</summary><p className={styles.note}>{t("inspectActualBooksFromTheExistingArchiveMissing")}</p>{historySlot}</details>}
    <details className={styles.source} id="exposure-source-details"><summary>{t("source")}</summary>
    {read.qualification === "dated" && <p className={styles.note} data-testid="exposure-dated-methodology">{t("contractGammaUsesTheVendorEodApproximationWhole")}</p>}
    {s.coveredOnly && <p className={styles.note}>{t("measuredOnlyExplanation")}</p>}<dl>
      <dt>{t("session")}</dt><dd>{read.session ?? "—"}</dd><dt>{t("asof")}</dt><dd>{read.sourceAsOf ?? "—"}</dd>
      <dt>{t("spot")}</dt><dd>{exposureValue(read.spot)}</dd><dt>{t("rows")}</dt><dd>{s.netKnown} / {s.grossKnown} · {s.offered}</dd>
      <dt>{t("population")}</dt><dd>{["qualified","dated"].includes(read.qualification) ? (t("declaredQualifiedPopulationMarketCompletenessUnknown")) : t(s.population === "full" ? "full" : s.population === "window" ? "window" : "unknown")} {s.fullCount == null ? "" : `(${s.offered}/${s.fullCount})`}</dd>
      <dt>{t("convention")}</dt><dd>{read.convention ?? t("missing")}</dd>
      {read.coverage && <><dt>{t(read.coverage.expected == null ? "measuredContracts" : "contracts")}</dt><dd>{read.coverage.qualified} / {read.coverage.expected ?? (read.coverage.qualified + read.coverage.missing)} · {t("missing")}: {read.coverage.missing}</dd></>}
      {read.sourceRef && <><dt>{t("snapshot")}</dt><dd>{read.sourceRef}</dd></>}
      {read.clocks && Object.entries(read.clocks).filter(([key]) => ["option_observed_at", "underlying_observed_at", "oi_report_date", "oi_position_session", "oi_available_at", "greeks_available_at", "available_at"].includes(key)).map(([key, value]) => <div key={key} style={{ display: "contents" }}><dt>{t(key as "option_observed_at")}</dt><dd>{value ?? t("missing")}</dd></div>)}
      <dt>{t("ties")}</dt><dd>{s.netTies.join(", ") || "—"} / {s.grossTies.join(", ") || "—"}</dd>
    </dl><p className={styles.note}>{t("tieRule")} {t("units")}</p>{!["qualified", "dated"].includes(read.qualification) && <p className={styles.note}>{t("clocks")}</p>}</details>

  </section>;
}
