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

// Selecting a strike changes two rows; cached values in a dense book stay intact.
const ExposureNodeRow = memo(function ExposureNodeRow({ node, selected, onSelect }: {
  node: ExposureNode; selected: boolean; onSelect: (strike: number, button: HTMLButtonElement) => void;
}) {
  return <tr aria-selected={selected}><td><button type="button" onClick={(e) => onSelect(node.strike, e.currentTarget)}>{node.strike}</button></td><td>{exposureValue(node.netMn)}</td><td>{exposureValue(node.grossMn)}</td><td>{node.grossShare == null ? "—" : exposureValue(node.grossShare * 100)}</td></tr>;
});

/** Presentation over the desk's existing acquisitions; this component opens no options reader. */
export default function ExposureMap({ root, source, matrix, stale = false, sourceStatus = "data", onRetry, onOpenRoot, onView, onResearch, historySlot, archivedSession, onLatest }:
  { root: string; source: unknown; matrix: GexMatrix | null; stale?: boolean;
    sourceStatus?: "data" | "loading" | "absent" | "unavailable"; onRetry?: () => void; onOpenRoot?: (root: string) => void; onView?: (view: "matrix" | "strike" | "expiry") => void; onResearch?: () => void; historySlot?: ReactNode; archivedSession?: string | null; onLatest?: () => void }) {
  const { lang } = useLang();
  const phone = useIsPhone();
  useResearchAppearance(useShellIdentity());
  const t = exposureMapT(lang);
  const [metric, setMetric] = useState<ExposureMapMetric>("gamma");
  const [scope, setScope] = useState("all");
  const [shock, setShock] = useState({ spotPercent: 0, ivPoints: 0, calendarDays: 0 });
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
  // Include the actual source object generation, not merely its unchanged calendar day.
  const [generation, setGeneration] = useState({ source, matrix, n: 0 });
  if (generation.source !== source || generation.matrix !== matrix) setGeneration({ source, matrix, n: generation.n + 1 });
  const identity = `${root}|${read.sourceAsOf}|${metric}|${scope}|${read.selectionKey}|${generation.n}|${JSON.stringify(shock)}`;
  const selected = selection?.identity === identity ? read.summary.nodes.find((n) => n.strike === selection.strike) ?? null : null;
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
      color: css?.getPropertyValue("--brand-2").trim() || "#4d82ff", selectedColor: css?.getPropertyValue("--warn").trim() || "#e8a33d" };
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
    { name: zh ? "不变" : "Unchanged", spotPercent: 0, ivPoints: 0, calendarDays: 0 },
    { name: zh ? "价格下跌 / IV 上升" : "Spot down / IV up", spotPercent: -1, ivPoints: 1, calendarDays: 0 },
    { name: zh ? "价格上涨 / IV 下降" : "Spot up / IV down", spotPercent: 1, ivPoints: -1, calendarDays: 0 },
    { name: zh ? "经过一天" : "One day passes", spotPercent: 0, ivPoints: 0, calendarDays: 1 },
  ];
  const inspectorPanel = <aside ref={inspector} tabIndex={-1} className={styles.inspector} aria-label={t("inspect")} data-testid="exposure-node-inspector">
        <span className={styles.eyebrow}>{selected ? (zh ? "节点调查" : "NODE INVESTIGATION") : (zh ? "结构概览" : "STRUCTURE AT A GLANCE")}</span>
        <h3>{selected ? `${t("selected")} ${selected.strike}` : (zh ? "从价格到节点" : "Price to positioning")}</h3>
        {focus && <><div className={styles.routeHero}><span>${exposureValue(read.spot)}</span><span>→</span><strong>{focus.strike}</strong></div><dl>
          <dt>{t("distance")}</dt><dd>{signed(structure.distancePoints)} · {signed(structure.distancePercent)}%</dd>
          <dt>{t(metric === "combined" ? "hedgeDemand" : "net")}</dt><dd>{signed(focus.netMn)}M</dd>
          <dt>{t("gross")}</dt><dd>{focus.grossMn == null ? "—" : `${exposureValue(focus.grossMn)}M`}</dd>
          <dt>{t("share")}</dt><dd>{focus.grossShare == null ? "—" : `${exposureValue(focus.grossShare * 100)}%`}</dd>
        </dl><ExposureDistance root={root} session={read.session} spot={read.spot} target={focus.strike} zh={zh} /><div className={styles.route}><span className={styles.eyebrow}>{zh ? "途经节点" : "INTERVENING STRIKES"}</span>{structure.intervening.length ? structure.intervening.slice(0, 5).map(n => <button key={n.strike} type="button" onClick={e => select(n.strike, e.currentTarget)}><b>{n.strike}</b><span>{signed(n.netMn)}M</span></button>) : <p className={styles.note}>{zh ? "参考现价与此节点之间没有已提供的行权价。" : "No supplied strikes between the reference spot and this node."}</p>}<small>{zh ? "距离调查，不表示价格路径或到达概率。" : "Distance investigation; no path or arrival probability."}</small></div></>}
        {selected && <div className={styles.inspectorActions}><button type="button" className={styles.primary} aria-pressed={pinned?.price === selected.strike} onClick={() => setPin(pinned?.price === selected.strike ? null : { identity, strike: selected.strike })}>{pinned?.price === selected.strike ? t("unpin") : t("pin")}</button><button type="button" onClick={close}>{t("close")}</button></div>}
        <div className={styles.rankedNodes}><span className={styles.eyebrow}>{zh ? "最大净节点" : "LARGEST NET NODES"}</span>{structure.ranked.slice(0, 5).map((n, i) => <button key={n.strike} type="button" onClick={e => select(n.strike, e.currentTarget)} aria-pressed={selected?.strike === n.strike}><span><small>{String(i + 1).padStart(2, "0")}</small> {n.strike}</span><b data-sign={n.netMn! < 0 ? "negative" : "positive"}>{signed(n.netMn)}M</b></button>)}</div>
        <p className={styles.note}>{t("model")}{metric === "delta" && (zh ? " Delta 应用假设的多看涨 / 空看跌持仓，非全多头未平仓期权的方向性 Delta。" : " Delta applies assumed long-call / short-put inventory; it is not the signed delta of an all-long open-interest book.")}</p>
      </aside>;
  return <section className={styles.map} data-testid="exposure-map" data-chart-ready={chartCurrent ? "true" : "false"} data-source-root={root} data-source-session={read.session ?? ""}>
    <nav className={styles.workspaceNav} aria-label={zh ? "敞口工作区" : "Exposure workspace"}>
      <input list="exposure-roots" value={symbolInput} onChange={e => setSymbolInput(e.target.value.toUpperCase())} onBlur={commitSymbol} onKeyDown={e => { if (e.key === "Enter") commitSymbol(); }} aria-label={zh ? "标的代码" : "Exposure symbol"} maxLength={12} />
      <datalist id="exposure-roots">{GEX_AUTOCOMPLETE_ROOTS.map(r => <option key={r}>{r}</option>)}</datalist>
      {(["focus", "compare", "scan"] as const).map(v => <button type="button" key={v} aria-pressed={view === v} onClick={() => setView(v)}>{v === "focus" ? (zh ? "结构图" : "Structure") : v === "compare" ? (zh ? "多市场对比" : "Compare") : (zh ? "扫描" : "Scanner")}</button>)}
      <span>{zh ? "期权敞口研究" : "OPTIONS INTELLIGENCE"}</span><details className={styles.moreViews}><summary>{zh ? "工具" : "Tools"}</summary><div>{(["matrix","strike","expiry"] as const).map(v => <button type="button" key={v} onClick={() => onView?.(v)}>{v === "matrix" ? (zh ? "到期矩阵" : "Expiry matrix") : v === "strike" ? (zh ? "行权价阶梯" : "Strike ladder") : (zh ? "到期分布" : "Expiry profile")}</button>)}<button type="button" onClick={onResearch}>{zh ? "3D 研究实验室" : "3D Research Lab"}</button></div></details>
    </nav>
    {view !== "focus" ? <ExposureBoard mode={view} onOpen={openRoot} /> : <>
    {archivedSession && <div className={styles.archiveNotice} role="status"><div><strong>{zh ? "存档快照" : "Stored snapshot"} · {archivedSession}</strong><p>{zh ? "所选历史账簿与当前价格图并列显示；不表示当时已知或历史节点演变。" : "The stored book is shown against the current price chart. This does not assert historical availability or node evolution."}</p></div><button type="button" onClick={onLatest}>{zh ? "返回最新账簿" : "Return to latest book"}</button></div>}
    <div className={styles.overviewBar}><header className={styles.heading}><div className={styles.instrument}><span className={styles.eyebrow}>{t("title")}</span><h2>{root} <span>${exposureValue(read.spot)}</span></h2><p>{zh ? "账簿参考现价" : "Book reference price"} · {read.session ?? "—"}</p></div><button type="button" className={styles.badge} onClick={() => { const details = document.getElementById("exposure-source-details") as HTMLDetailsElement | null; if (details) { details.open = true; details.scrollIntoView({ block: "nearest", behavior: "smooth" }); } }}>{stale ? t("stale") : read.qualification === "qualified" ? (zh ? "逐合约覆盖" : "Contract coverage") : read.qualification === "dated" ? (zh ? "供应商 EOD 近似值" : "Vendor EOD approximation") : (zh ? "汇总快照" : "Aggregate snapshot")} ↗</button></header>
    <div className={styles.toolbar}>
      <label>{t("metric")}<select aria-label={t("metric")} value={metric} onChange={(e) => { setMetric(e.target.value as ExposureMapMetric); setScope("all"); setMode("net"); setDual(false); }}>
        <option value="gamma">{t("gamma")}</option><option value="vanna">{t("vanna")}</option><option value="charm">{t("charm")}</option><option value="delta">{zh ? "Delta · 假设持仓" : "Delta · assumed inventory"}</option><option value="combined">{zh ? "情景压力测试" : "Scenario stress"}</option>
      </select></label>
      <label>{t("scope")}<select aria-label={t("scope")} value={scope} disabled={metric !== "gamma" && read.qualification !== "qualified"} onChange={(e) => setScope(e.target.value)}>
        <option value="all">{t("all")}</option><option value="zero">{t("zero")}</option>
        <option value="next-live" disabled={read.qualification !== "qualified"}>{t("nextLive")}</option><option value="week" disabled={read.qualification !== "qualified"}>{t("week")}</option>
        {read.expiries.map((exp) => <option key={exp} value={exp}>{exp}</option>)}
      </select></label>
      <button type="button" aria-pressed={dual} disabled={metric !== "gamma"} onClick={() => setDual(v => !v)}>{zh ? "Gamma + Vanna 双层" : "Gamma + Vanna layers"}</button><div className={styles.segment}><button type="button" aria-pressed={mode === "net"} onClick={() => setMode("net")}>{t(metric === "combined" ? "hedgeDemand" : "net")}</button><button type="button" aria-pressed={mode === "gross"} disabled={metric !== "gamma" || s.grossTotalMn == null} onClick={() => setMode("gross")}>{t("gross")}</button></div>
    </div>
    </div>
    {dual && <p className={styles.note}>{vannaRead?.state === "data" ? (phone ? (zh ? "双层视图：实心 Gamma · 轮廓 Vanna · 独立尺度" : "Dual layers: solid Gamma · outlined Vanna · separate scales") : zh ? "双层视图：Gamma 为实心条，Vanna 为右侧轮廓条；各自归一化、单位不同，不相加。" : "Dual layers: solid Gamma and outlined Vanna at right; independent scales and units, never summed.") : (zh ? "所选范围没有联合 Vanna 单元。Gamma 继续显示。" : "No joint Vanna cells for this scope. Gamma remains visible.")}</p>}
    {metric === "combined" && <section className={styles.scenario}><div className={styles.sectionHead}><div><span className={styles.eyebrow}>{zh ? "条件性机制" : "CONDITIONAL MECHANICS"}</span><h3>{zh ? "改变假设，查看对冲需求" : "Change the assumptions. Inspect hedge demand."}</h3></div></div><div className={styles.presetRow}>{presets.map(({ name, ...values }) => <button type="button" key={name} onClick={() => setShock(values)}>{name}</button>)}</div><div className={styles.toolbar}>
      {(["spotPercent", "ivPoints", "calendarDays"] as const).map((key) => <label key={key}>{t(key)}<input type="number" step={0.25} min={key === "calendarDays" ? 0 : key === "spotPercent" ? -3 : -5} max={key === "spotPercent" ? 3 : 5} value={Number.isNaN(shock[key]) ? "" : shock[key]} onChange={(e) => setShock({ ...shock, [key]: e.target.value === "" ? NaN : Number(e.target.value) })} /></label>)}
    </div>{attribution.length > 0 && <div className={styles.attribution}>{attribution.map(a => <div key={a.greek}><span>{a.greek[0].toUpperCase() + a.greek.slice(1)} × {a.weight}</span><strong data-sign={(a.value ?? 0) < 0 ? "negative" : "positive"}>{signed(a.value)} M</strong></div>)}<div><span>{zh ? "共同合格总体 · 合计" : "Joint qualified population · total"}</span><strong>{signed(s.netTotalMn)} M</strong></div></div>}<p className={styles.note}>{t("localScenario")} {zh ? "正值为模型对冲买入，负值为卖出。此总体未提供非线性重估。" : "Positive is modeled hedge buying; negative is selling. Nonlinear repricing is not supplied for this population."}</p></section>}
    {read.state !== "data" && <div className={styles.empty} role="status">{sourceStatus === "loading" ? t("loading") : sourceStatus === "absent" ? t("absent") : sourceStatus === "unavailable" ? t("readFailed") : ["wrong_root", "future", "malformed"].includes(read.state) ? t("invalid") : t("noData")}
      {sourceStatus === "unavailable" && onRetry && <button type="button" onClick={onRetry}>{t("retry")}</button>}{metric === "combined" && <p>{t("noCombination")}</p>}</div>}
    {read.qualification === "dated" && <p className={styles.note} data-testid="exposure-dated-methodology">{zh ? "逐合约 Gamma 使用供应商 EOD 近似值：整天期限，到期日按 0.15 天计算。只标记交易日；不表示瞬时风险、下一有效到期日、联合情景或历史可知时间。" : "Contract Gamma uses the vendor EOD approximation: whole-day tenor, 0.15 days on expiry day. Session-level observation; instantaneous risk, next-live expiry, joint scenarios and historical availability are not established."}</p>}
    <div className={styles.leaders}>
      <div className={styles.stat}><span>{zh ? "覆盖账簿净值" : "COVERED BOOK NET"}</span><strong data-sign={(s.netTotalMn ?? 0) < 0 ? "negative" : "positive"}>{signed(s.netTotalMn)}<small> M</small></strong><small>{metric === "gamma" ? (zh ? "每 +1% 现价" : "per +1% spot") : metric === "vanna" ? (zh ? "每 +1 IV 点" : "per +1 IV point") : metric === "delta" ? (zh ? "假设持仓美元 Delta" : "assumed-inventory dollar delta") : metric === "charm" ? (zh ? "每天" : "per calendar day") : (zh ? "明确冲击" : "explicit shocks")}</small></div>
      <button type="button" disabled={!s.netLeader} onClick={(e) => s.netLeader && select(s.netLeader.strike, e.currentTarget)}><span>{t(metric === "combined" ? "largestDemand" : "largestNet")}</span><strong>{s.netLeader ? `${s.netLeader.strike}` : "—"}</strong><small>{signed(s.netLeader?.netMn ?? null)}M {structure.contested ? (zh ? " · 相近节点" : " · contested") : ""}</small></button>
      <button type="button" disabled={!s.grossLeader} onClick={(e) => s.grossLeader && select(s.grossLeader.strike, e.currentTarget)}><span>{t("largestGross")}</span><strong>{s.grossLeader?.strike ?? "—"}</strong><small>{s.grossLeader ? `${exposureValue(s.grossLeader.grossMn)}M · ${exposureValue((s.grossLeader.grossShare ?? 0) * 100, 1)}%` : zh ? "需要看涨 / 看跌两侧" : "Requires call / put sides"}</small></button>
      <div className={styles.stat}><span>{zh ? "覆盖范围" : "PUBLISHED COVERAGE"}</span><strong>{s.netKnown}<small> / {s.fullCount ?? s.offered}</small></strong><small>{s.population === "full" ? (zh ? "已发布行权价" : "published strikes") : (zh ? "已知净值 / 行权价" : "known net / strikes")}</small></div>
    </div>
    <div className={styles.workspace}>
      <div className={styles.chartColumn}>
        <div className={styles.chartTools}><div className={styles.segment} aria-label={t("timeframe")}>{["5m", "30m", "2h", "D", "W"].map(f => <button type="button" key={f} aria-pressed={tf === f} onClick={() => setTf(f)}>{f}</button>)}</div><div><button type="button" aria-pressed={showMa} onClick={() => setShowMa(v => !v)}>{phone ? "MA" : t("ma")}</button><button type="button" title={zh ? "重置视图" : "Reset view"} onClick={frameChart}>{phone ? (zh ? "适配" : "Fit") : (zh ? "重置视图" : "Reset view")}</button></div></div>
        {showMa && !archivedSession && <div className={styles.averageStrip}>{visibleAverages.map(a => <span key={a.label} title={`${a.label} · ${new Date(a.observedAt * 1000).toISOString().slice(0,16)} ET`}><b>{a.label}</b> {exposureValue(a.price)} <time>{new Date(a.observedAt * 1000).toISOString().slice(5,10)}</time></span>)}<small>{zh ? "已收盘快照参考值" : "Closed-bar snapshot references"}</small></div>}
        <div ref={chartHost} tabIndex={-1} className={styles.chart} aria-label={t("chart")}>
          <div className={styles.chartBody}><ChartPanel symbol={root} indicators={NONE} timeframe={tf} onChartApi={setApi} onVisualReady={onVisualReady} optionsLevel={pinned} userTier="free" /></div>
          <div className={styles.caption}><span>{zh ? "＋ 正敞口　− 负敞口　◆ 所选节点" : "+ Positive exposure   − Negative exposure   ◆ Selected node"}</span><span>{t("reference")}</span></div>
        </div>
        {!archivedSession && <ExposureDivergence root={root} onAverages={onAverages} />}
      </div>
      {phone ? <MobileSheet open={!!selected} onClose={close} title={`${root} · ${t("inspect")}`} ariaLabel={t("inspect")} detents={[60,94]} maxHeight="94svh" initialFocus="sheet" escapeKey="bubble" className={`${styles.map} ${styles.inspectorSheet}`}>{inspectorPanel}</MobileSheet> : inspectorPanel}
    </div>
    <section className={styles.analytics}>
      <div className={styles.sectionHead}><div><span className={styles.eyebrow}>{zh ? "深度分析" : "BOOK ANATOMY"}</span><h3>{detail === "expiries" ? (zh ? "到期日贡献" : "Expiration contributions") : detail === "changes" ? (zh ? "观测到的变化" : "Observed book changes") : t("values")}</h3></div><div className={styles.segment}><button type="button" aria-pressed={detail === "expiries"} onClick={() => setDetail("expiries")}>{zh ? "对比到期日" : "Compare expiries"}</button><button type="button" aria-pressed={detail === "changes"} onClick={() => setDetail("changes")}>{zh ? "变化" : "Changes"}</button><button type="button" aria-pressed={detail === "values"} onClick={() => setDetail("values")}>{zh ? "精确值" : "Exact values"}</button></div></div>
      {detail === "changes" ? (read.session ? <GexMarketMemory root={root} matrixSession={read.session} strike={focus?.strike ?? null} t={optionsT(lang)} /> : <p className={styles.note}>{t("noData")}</p>) : detail === "expiries" ? <><div className={styles.expiryGrid}>{expiryReads.slice(0, 12).map(({ exp, read: r }) => <button type="button" key={exp} disabled={r.state !== "data" || !r.summary.netKnown} aria-pressed={scope === exp} onClick={() => setScope(exp)}><span>{exp}</span><strong data-sign={(r.summary.netTotalMn ?? 0) < 0 ? "negative" : "positive"}>{r.state === "data" && r.summary.netTotalMn != null ? `${signed(r.summary.netTotalMn)}M` : "—"}</strong><small>{r.summary.netTotalMn == null ? (zh ? `${r.summary.netKnown} 个已知行 · 不完整` : `${r.summary.netKnown} known strikes · incomplete`) : `${zh ? "主节点" : "Lead node"} ${r.summary.netLeader?.strike ?? "—"}`}</small></button>)}</div><p className={styles.note}>{zh ? "精确到期日单元贡献；未提供的单元不会从边际总值中推算。所有日期可在范围菜单中选择。" : "Exact expiry-cell contributions; missing cells are not inferred from marginal totals. Every supplied date remains available in the scope menu."}</p></> : <div className={styles.scroll}><table><thead><tr><th>{t("selected")}</th><th>{t(metric === "combined" ? "hedgeDemand" : "net")}</th><th>{t("gross")}</th><th>%</th></tr></thead><tbody>{s.nodes.map(n => <ExposureNodeRow key={n.strike} node={n} selected={n.strike === selected?.strike} onSelect={select} />)}</tbody></table></div>}
    </section>
    </>}
    {historySlot && <details className={`${styles.source} ${styles.history}`} data-testid="exposure-stored-snapshots"><summary>{zh ? "历史账簿快照" : "Stored book snapshots"}</summary><p className={styles.note}>{zh ? "从现有存档选择实际账簿。缺失日期保持空缺；不从当前账簿重建历史。" : "Inspect actual books from the existing archive. Missing sessions remain gaps; past books are never reconstructed from the current book."}</p>{historySlot}</details>}
    <details className={styles.source} id="exposure-source-details"><summary>{t("source")}</summary><dl>
      <dt>{t("session")}</dt><dd>{read.session ?? "—"}</dd><dt>{t("asof")}</dt><dd>{read.sourceAsOf ?? "—"}</dd>
      <dt>{t("spot")}</dt><dd>{exposureValue(read.spot)}</dd><dt>{t("rows")}</dt><dd>{s.netKnown} / {s.grossKnown} · {s.offered}</dd>
      <dt>{t("population")}</dt><dd>{["qualified","dated"].includes(read.qualification) ? (zh ? "已声明合格合约范围；市场完整性未知" : "Declared qualified population; market completeness unknown") : t(s.population === "full" ? "full" : s.population === "window" ? "window" : "unknown")} {s.fullCount == null ? "" : `(${s.offered}/${s.fullCount})`}</dd>
      <dt>{t("convention")}</dt><dd>{read.convention ?? t("missing")}</dd>
      {read.coverage && <><dt>{t("contracts")}</dt><dd>{read.coverage.qualified} / {read.coverage.expected ?? "?"} · {t("missing")}: {read.coverage.missing}</dd></>}
      {read.sourceRef && <><dt>{t("snapshot")}</dt><dd>{read.sourceRef}</dd></>}
      {read.clocks && Object.entries(read.clocks).filter(([key]) => ["option_observed_at", "underlying_observed_at", "oi_report_date", "oi_position_session", "oi_available_at", "greeks_available_at"].includes(key)).map(([key, value]) => <div key={key} style={{ display: "contents" }}><dt>{t(key as "option_observed_at")}</dt><dd>{value ?? t("missing")}</dd></div>)}
      <dt>{t("ties")}</dt><dd>{s.netTies.join(", ") || "—"} / {s.grossTies.join(", ") || "—"}</dd>
    </dl><p className={styles.note}>{t("tieRule")} {t("units")}</p>{read.qualification !== "qualified" && <p className={styles.note}>{t("clocks")}</p>}</details>

  </section>;
}
