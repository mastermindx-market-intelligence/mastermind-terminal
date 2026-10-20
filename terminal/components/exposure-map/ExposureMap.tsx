"use client";

import dynamic from "next/dynamic";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLang } from "@/lib/i18n";
import { useShellIdentity } from "@/components/chrome/AppShell";
import { useResearchAppearance } from "@/components/researchlab/useResearchAppearance";
import "@/components/researchlab/ResearchAppearance.css";
import type { TerminalVisualReadyDetail } from "@/lib/terminalBoot";
import type { ChartEngine, SeriesHandle } from "@/lib/chart-engine/api";
import type { GexMatrix } from "@/lib/gexLadder";
import type { ExposureLens } from "@/lib/exposureMapProjection";
import type { OptionsChartLevel } from "@/lib/optionsCompanion";
import { readExposureMap, exposureValue, type ExposureMapMetric } from "@/lib/exposureMap";
import { createExposureMapPrimitive } from "@/lib/exposureMapPrimitive";
import type { ExposureNode } from "@/lib/marketStructure";
import { exposureMapT } from "./exposureMapStrings";
import ExposureDivergence from "./ExposureDivergence";
import styles from "./ExposureMap.module.css";

const ChartPanel = memo(dynamic(() => import("@/components/ChartPanel"), { ssr: false }));
const MA = new Set(["ema"]);
const NONE = new Set<string>();

// Selecting a strike changes two rows; cached values in a dense book stay intact.
const ExposureNodeRow = memo(function ExposureNodeRow({ node, selected, onSelect }: {
  node: ExposureNode; selected: boolean; onSelect: (strike: number, button: HTMLButtonElement) => void;
}) {
  return <tr aria-selected={selected}><td><button type="button" onClick={(e) => onSelect(node.strike, e.currentTarget)}>{node.strike}</button></td><td>{exposureValue(node.netMn)}</td><td>{exposureValue(node.grossMn)}</td><td>{node.grossShare == null ? "—" : exposureValue(node.grossShare * 100)}</td></tr>;
});

/** Presentation over the desk's existing acquisitions; this component opens no options reader. */
export default function ExposureMap({ root, source, matrix, stale = false, sourceStatus = "data", onRetry }:
  { root: string; source: unknown; matrix: GexMatrix | null; stale?: boolean;
    sourceStatus?: "data" | "loading" | "absent" | "unavailable"; onRetry?: () => void }) {
  const { lang } = useLang();
  useResearchAppearance(useShellIdentity());
  const t = exposureMapT(lang);
  const [metric, setMetric] = useState<ExposureMapMetric>("gamma");
  const [scope, setScope] = useState("all");
  const [shock, setShock] = useState({ spotPercent: 0, ivPoints: 0, calendarDays: 0 });
  const [mode, setMode] = useState<"net" | "gross">("net");
  const [tf, setTf] = useState("D");
  const [showMa, setShowMa] = useState(true);
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
  const read = useMemo(() => readExposureMap(source, root, matrix, lens, metric, today, clock, shock), [source, root, matrix, lens, metric, today, clock, shock]);
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
  const drawing = useMemo(() => {
    const css = typeof document !== "undefined" ? getComputedStyle(document.documentElement) : null;
    return { nodes: read.state === "data" ? read.summary.nodes : [], selected: selected?.strike ?? null, mode,
      color: css?.getPropertyValue("--brand-2").trim() || "#4d82ff", selectedColor: css?.getPropertyValue("--warn").trim() || "#e8a33d" };
  }, [read.state, read.summary.nodes, selected?.strike, mode]);
  useLayoutEffect(() => {
    if (!api || !chartCurrent) return;
    // This view fixes chartType=candles: select the actual owned price handle, not a volume pane.
    const series: SeriesHandle | undefined = api.panes()[0]?.getSeries().find((s) => s.kind === "candles");
    if (!series) return;
    const p = createExposureMapPrimitive({ nodes: [], selected: null, mode: "net", color: "", selectedColor: "" });
    series.attachPrimitive(p); primitive.current = p;
    return () => { series.detachPrimitive(p); if (primitive.current === p) primitive.current = null; };
  }, [api, ready, chartCurrent, root, tf]);
  useLayoutEffect(() => { primitive.current?.set(chartCurrent ? drawing : { ...drawing, nodes: [], selected: null }); }, [drawing, api, ready, chartCurrent, root, tf]);
  const close = useCallback(() => { setSelection(null); returnFocus.current?.focus(); }, []);
  useEffect(() => {
    if (!api || !chartCurrent) return;
    const pick = (event: { point?: { x: number; y: number } }) => {
      const hit = event.point && primitive.current?.hitTest?.(event.point.x, event.point.y);
      const strike = hit?.data?.strike;
      if (typeof strike !== "number") return;
      returnFocus.current = chartHost.current;
      setSelection({ identity, strike });
      requestAnimationFrame(() => inspector.current?.focus());
    };
    api.subscribeClick(pick);
    return () => api.unsubscribeClick(pick);
  }, [api, chartCurrent, identity]);
  useEffect(() => {
    if (!selected) return;
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); close(); } };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [selected, close]);
  const select = useCallback((strike: number, button: HTMLButtonElement) => {
    returnFocus.current = button; setSelection({ identity, strike });
    requestAnimationFrame(() => { inspector.current?.focus(); if (window.innerWidth < 1000) inspector.current?.scrollIntoView({ block: "nearest" }); });
  }, [identity]);
  const s = read.summary;
  const distance = selected && read.spot != null ? (selected.strike / read.spot - 1) * 100 : null;
  return <section className={styles.map} data-testid="exposure-map" data-chart-ready={chartCurrent ? "true" : "false"} data-source-root={root} data-source-session={read.session ?? ""}>
    <div className={styles.heading}><h2>{t("title")}</h2><span className={styles.badge}>{stale ? t("stale") : t("dated")} · {read.session ?? "—"}</span></div>
    <div className={styles.toolbar}>
      <label>{t("metric")}<select aria-label={t("metric")} value={metric} onChange={(e) => { setMetric(e.target.value as ExposureMapMetric); setScope("all"); setMode("net"); }}>
        <option value="gamma">{t("gamma")}</option><option value="vanna">{t("vanna")}</option><option value="charm">{t("charm")}</option><option value="combined">{t("combined")}</option>
      </select></label>
      <label>{t("scope")}<select aria-label={t("scope")} value={scope} disabled={metric !== "gamma" && read.qualification !== "qualified"} onChange={(e) => setScope(e.target.value)}>
        <option value="all">{t("all")}</option><option value="zero">{t("zero")}</option>
        <option value="next-live" disabled={read.qualification !== "qualified"}>{t("nextLive")}</option><option value="week" disabled={read.qualification !== "qualified"}>{t("week")}</option>
        {read.expiries.map((exp) => <option key={exp} value={exp}>{exp}</option>)}
      </select></label>
      <button type="button" aria-pressed={mode === "net"} onClick={() => setMode("net")}>{t(metric === "combined" ? "hedgeDemand" : "net")}</button>
      <button type="button" aria-pressed={mode === "gross"} disabled={metric !== "gamma" || s.grossTotalMn == null} onClick={() => setMode("gross")}>{t("gross")}</button>
      <label>{t("timeframe")}<select aria-label={t("timeframe")} value={tf} onChange={(e) => setTf(e.target.value)}>{["5m", "30m", "2h", "D", "W"].map((f) => <option key={f}>{f}</option>)}</select></label>
      <button type="button" aria-pressed={showMa} onClick={() => setShowMa((v) => !v)}>{t("ma")}</button>
    </div>
    {metric === "combined" && <div className={styles.toolbar}>
      {(["spotPercent", "ivPoints", "calendarDays"] as const).map((key) => <label key={key}>{t(key)}<input type="number" step={0.25} min={key === "calendarDays" ? 0 : key === "spotPercent" ? -3 : -5} max={key === "spotPercent" ? 3 : 5} value={Number.isNaN(shock[key]) ? "" : shock[key]} onChange={(e) => setShock({ ...shock, [key]: e.target.value === "" ? NaN : Number(e.target.value) })} /></label>)}
      <p className={styles.note}>{t("localScenario")}</p>
    </div>}
    <p className={styles.note}>{t("model")}</p>
    {read.state !== "data" && <div className={styles.empty} role="status">{sourceStatus === "loading" ? t("loading") : sourceStatus === "absent" ? t("absent") : sourceStatus === "unavailable" ? t("readFailed") : ["wrong_root", "future", "malformed"].includes(read.state) ? t("invalid") : t("noData")}
      {sourceStatus === "unavailable" && onRetry && <button type="button" onClick={onRetry}>{t("retry")}</button>}</div>}
    <>
      {read.state === "data" && <p className={styles.warning}>{t(read.qualification === "qualified" ? "coveredQualified" : "provisional")}</p>}
      <div className={styles.leaders}>
        <button type="button" disabled={!s.netLeader} onClick={(e) => s.netLeader && select(s.netLeader.strike, e.currentTarget)}><span>{t(metric === "combined" ? "largestDemand" : "largestNet")}</span><strong>{s.netLeader ? `${s.netLeader.strike} · ${exposureValue(s.netLeader.netMn)}M` : "—"}</strong></button>
        <button type="button" disabled={!s.grossLeader} onClick={(e) => s.grossLeader && select(s.grossLeader.strike, e.currentTarget)}><span>{t("largestGross")}</span><strong>{s.grossLeader ? `${s.grossLeader.strike} · ${exposureValue(s.grossLeader.grossMn)}M` : "—"}</strong></button>
      </div>
      <div className={styles.workspace}>
        <div ref={chartHost} tabIndex={-1} className={styles.chart} aria-label={t("chart")}>
          <div className={styles.chartBody}><ChartPanel symbol={root} indicators={showMa ? MA : NONE} timeframe={tf} onChartApi={setApi} onVisualReady={onVisualReady} optionsLevel={pinned} userTier="free" /></div>
          <div className={styles.caption}>{t("reference")}</div>
        </div>
        <aside ref={inspector} tabIndex={-1} className={styles.inspector} aria-label={t("inspect")} data-testid="exposure-node-inspector">
          <h3>{selected ? `${t("selected")} ${selected.strike}` : t("inspect")}</h3>
          {selected ? <><dl>
            <dt>{t(metric === "combined" ? "hedgeDemand" : "net")}</dt><dd>{exposureValue(selected.netMn)}M</dd>
            <dt>{t("gross")}</dt><dd>{exposureValue(selected.grossMn)}M</dd>
            <dt>{t("share")}</dt><dd>{selected.grossShare == null ? "—" : `${exposureValue(selected.grossShare * 100)}%`}</dd>
            <dt>{t("distance")}</dt><dd>{distance == null ? "—" : `${exposureValue(distance)}%`}</dd>
          </dl><button type="button" aria-pressed={pinned?.price === selected.strike} onClick={() => setPin(pinned?.price === selected.strike ? null : { identity, strike: selected.strike })}>{pinned?.price === selected.strike ? t("unpin") : t("pin")}</button><button type="button" onClick={close}>{t("close")}</button></> : <p className={styles.note}>{t("values")}</p>}
          {metric === "gamma" && s.grossTotalMn == null && <p className={styles.note}>{t("grossUnavailable")}</p>}
        </aside>
      </div>
      <details className={styles.table} open><summary>{t("values")}</summary><div className={styles.scroll}><table>
        <thead><tr><th>{t("selected")}</th><th>{t(metric === "combined" ? "hedgeDemand" : "net")}</th><th>{t("gross")}</th><th>%</th></tr></thead>
        <tbody>{s.nodes.map((n) => <ExposureNodeRow key={n.strike} node={n} selected={n.strike === selected?.strike} onSelect={select} />)}</tbody>
      </table></div></details>
    </>
    <ExposureDivergence root={root} />
    <details className={styles.source}><summary>{t("source")}</summary><dl>
      <dt>{t("session")}</dt><dd>{read.session ?? "—"}</dd><dt>{t("asof")}</dt><dd>{read.sourceAsOf ?? "—"}</dd>
      <dt>{t("spot")}</dt><dd>{exposureValue(read.spot)}</dd><dt>{t("rows")}</dt><dd>{s.netKnown} / {s.grossKnown} · {s.offered}</dd>
      <dt>{t("population")}</dt><dd>{t(s.population === "full" ? "full" : s.population === "window" ? "window" : "unknown")} {s.fullCount == null ? "" : `(${s.offered}/${s.fullCount})`}</dd>
      <dt>{t("convention")}</dt><dd>{read.convention ?? t("missing")}</dd>
      {read.coverage && <><dt>{t("contracts")}</dt><dd>{read.coverage.qualified} / {read.coverage.expected ?? "?"} · {t("missing")}: {read.coverage.missing}</dd></>}
      {read.sourceRef && <><dt>{t("snapshot")}</dt><dd>{read.sourceRef}</dd></>}
      {read.clocks && Object.entries(read.clocks).filter(([key]) => ["option_observed_at", "underlying_observed_at", "oi_report_date", "oi_position_session", "oi_available_at", "greeks_available_at"].includes(key)).map(([key, value]) => <div key={key} style={{ display: "contents" }}><dt>{t(key as "option_observed_at")}</dt><dd>{value ?? t("missing")}</dd></div>)}
      <dt>{t("ties")}</dt><dd>{s.netTies.join(", ") || "—"} / {s.grossTies.join(", ") || "—"}</dd>
    </dl><p className={styles.note}>{t("tieRule")} {t("units")}</p>{read.qualification !== "qualified" && <p className={styles.note}>{t("clocks")}</p>}</details>
    <p className={styles.note}>{t("noCombination")}</p>
  </section>;
}
