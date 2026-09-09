"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import ChartPanel, { type DetectCmd, type LiveQuote, type PineScript } from "@/components/ChartPanel";
import ChartFrameBar, { DEFAULT_CHART_SETTINGS, type ChartSettings } from "@/components/ChartFrameBar";
import ChartSettingsModal, { type ChartSettingsTab } from "@/components/ChartSettingsModal";
import { type Drawing, type DrawKind } from "@/lib/drawings";
import { drawingPanelInstanceKey } from "@/lib/drawingOwnership";
import { type CmpCfg } from "@/lib/compare";
import { type IChartApi } from "lightweight-charts";
import { useLang } from "@/lib/i18n";
import { displayName } from "@/lib/markets";
import AssetLogo from "@/components/AssetLogo";
import { classify, isIntradayTf } from "@/lib/intradaySources";
import { isMacroSymbol } from "@/lib/macroSymbols";

const f = (n: number | null | undefined, d = 2) => (n == null || !isFinite(n) ? "—" : n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));

const SETTINGS_KEY = "mm.chartSettings";
const load = (d: ChartSettings): ChartSettings => { try { const v = localStorage.getItem(SETTINGS_KEY); return v ? { ...d, ...JSON.parse(v) } : d; } catch { return d; } };

// One pane of the chart grid. Hand-drawn drawings are owned by TerminalShell (a shared per-symbol
// store) so multiple panes on the same symbol (an MTF layout) share one set. Auto-DETECTED drawings,
// by contrast, are computed against THIS pane's timeframe and are transient (never persisted), so they
// stay pane-local and are merged in only for this pane's own render.
export default function ChartPane({ idx, symbol, drawingOwnerKey, isActive, onActivate, row, tf, chartType, dataReady = true, initialTimeframe = null, inds, tool, toolActivation = 0, drawingSticky = false, drawingCreationDisabled = false, drawStyle, detectCmd, compare, compareCfg, magnet, replayIdx, onMeta, drawings, drawingsVisible = true, onDrawingsChange, liveQuote, indParams, hidden, onToggleHidden, onRemoveInd, onOpenSettings, onOpenSource, pineScripts,
  onDetectedDrawingCount,
  onAddAlert, onTableView, onObjectTree, lockedVLine, onSetLockedVLine, onIndRowsAt, dayMode: _dayMode, onPaneCount, userTier }:
  { idx: number; symbol: string; drawingOwnerKey: string; isActive: boolean; onActivate: (i: number) => void; dataReady?: boolean; initialTimeframe?: string | null; row?: { name?: string; zh?: string; sec?: string; mkt?: string; col?: string; last?: number; chg?: number } | null; tf: string; chartType: string; inds: Set<string>; tool: DrawKind | null; toolActivation?: number; drawingSticky?: boolean; drawingCreationDisabled?: boolean; drawStyle?: { color: string; width: number; dash: "solid" | "dashed" | "dotted" }; detectCmd: DetectCmd; compare: string[]; compareCfg?: Record<string, CmpCfg>; magnet: "off" | "weak" | "strong"; replayIdx: number | null; onMeta: (m: { total: number }) => void; drawings: Drawing[]; drawingsVisible?: boolean; onDrawingsChange: (d: Drawing[]) => void; onDetectedDrawingCount?: (count: number) => void; liveQuote?: LiveQuote;
    indParams?: Record<string, any>; hidden?: Set<string>; onToggleHidden?: (key: string) => void; onRemoveInd?: (key: string) => void; onOpenSettings?: (key: string) => void; onOpenSource?: (key: string) => void; pineScripts?: PineScript[];
    onAddAlert?: (price: number) => void; onTableView?: () => void; onObjectTree?: () => void;
    lockedVLine?: string | null; onSetLockedVLine?: (t: string | null) => void;
    onIndRowsAt?: (fn: ((barTime: string | number) => Record<string, number | null>) | null) => void;
    /** Day Trade Mode — enables session shading, countdown, and stats strip (C lane wires the impl). */
    dayMode?: boolean;
    /** B3: forwarded to ChartPanel to notify TerminalShell of sub-pane count changes. */
    onPaneCount?: (n: number) => void;
    /** Entitlement tier — UI gate for premium suite modules. */
    userTier?: "free" | "essential" | "pro";
  }) {
  const { lang } = useLang();
  const [auto, setAuto] = useState<Drawing[]>([]);
  const [chartSettings, setChartSettings] = useState<ChartSettings>(DEFAULT_CHART_SETTINGS);
  const [chartSettingsReady, setChartSettingsReady] = useState(false);
  const [chartApi, setChartApi] = useState<IChartApi | null>(null);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [settingsModalTab, setSettingsModalTab] = useState<ChartSettingsTab>("scales");

  // Resolve this pane-local owner before child passive data work can become visually current.
  // `dataReady && chartSettingsReady` below also covers a fast child generation that was already
  // constructed: Effect 7 applies this value before the existing ready announcement is re-evaluated.
  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is client-only; this pre-paint handoff is the hydration boundary.
    setChartSettings(load(DEFAULT_CHART_SETTINGS));
    setChartSettingsReady(true);
  }, []);
  // Listen for tab-switch events dispatched by ChartSettingsModal tab buttons
  useEffect(() => {
    const h = (e: Event) => {
      const tab = (e as CustomEvent).detail as string;
      if (["symbol", "status", "scales", "canvas", "events"].includes(tab)) {
        setSettingsModalTab(tab as ChartSettingsTab);
      }
    };
    window.addEventListener("mm:settings-tab", h);
    return () => window.removeEventListener("mm:settings-tab", h);
  }, []);
  // The default render is not an authoritative setting. In development StrictMode the initial
  // effects are replayed, so an "ignore the first effect" ref can write that stale default during
  // the replay and destroy an existing localStorage owner. Persist only after hydration commits.
  useEffect(() => {
    if (!chartSettingsReady) return;
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(chartSettings)); } catch {}
  }, [chartSettingsReady, chartSettings]);

  const patchSettings = useCallback((patch: Partial<ChartSettings>) => {
    setChartSettings((s) => ({ ...s, ...patch }));
  }, []);

  // Day Trade Mode: listen for mm:set-eth events dispatched by TerminalShell (D lane §5b interface contract).
  useEffect(() => {
    const h = (e: Event) => {
      const on = !!(e as CustomEvent).detail?.on;
      patchSettings({ extHours: on });
    };
    window.addEventListener("mm:set-eth", h);
    return () => window.removeEventListener("mm:set-eth", h);
  }, [patchSettings]);

  useEffect(() => { setAuto([]); }, [symbol, tf]);   // detection is timeframe-specific — reset on change

  // ── Symbol swap (R2c) ───────────────────────────────────────────────────────────────────────
  // The renderer survives a ticker change now (see lib/drawingOwnership), so the OUTGOING chart
  // stays painted while the new bars load. Dim it for that stretch and let the new symbol snap
  // in when it is really on screen — `mm:terminal-visual-ready` fires after two frames, so it
  // means pixels, not "setData returned". A blank canvas for a second was the alternative.
  const [swapping, setSwapping] = useState(false);
  const swappedOnce = useRef(false);
  useEffect(() => {
    // The first paint has nothing to cross-fade from.
    if (!swappedOnce.current) { swappedOnce.current = true; return; }
    setSwapping(true);
    const settle = (event: Event) => {
      const painted = (event as CustomEvent<{ symbol?: string }>).detail?.symbol;
      if (!painted || painted === symbol) setSwapping(false);
    };
    window.addEventListener("mm:terminal-visual-ready", settle);
    // A symbol that never announces (a dead feed, a failed fetch) must not dim the chart forever.
    const failsafe = window.setTimeout(() => setSwapping(false), 4_000);
    return () => {
      window.removeEventListener("mm:terminal-visual-ready", settle);
      window.clearTimeout(failsafe);
      setSwapping(false);
    };
  }, [symbol]);
  useEffect(() => { onDetectedDrawingCount?.(auto.length); }, [auto.length, onDetectedDrawingCount]);
  const merged = useMemo(() => {
    if (!drawingsVisible) return [];
    return auto.length ? [...drawings, ...auto] : drawings;
  }, [drawingsVisible, drawings, auto]);
  const handleChange = useCallback((d: Drawing[]) => {
    const hand: Drawing[] = [], au: Drawing[] = [];
    for (const x of d) {
      if (x.source === "ai" || x.id.startsWith("ai_")) continue;
      if (x.source === "detector" || x.auto) au.push(x);
      else hand.push(x);
    }
    setAuto(au);
    // only push hand-drawn changes to the shared store; skip the redundant write/PUT when only auto changed
    const currentHand = drawings.filter((x) => x.source !== "ai" && !x.id.startsWith("ai_"));
    const sameHand = hand.length === currentHand.length && hand.every((x, i) => x === currentHand[i]);
    if (!sameHand) onDrawingsChange(hand);
  }, [drawings, onDrawingsChange]);
  const up = (row?.chg ?? 0) >= 0;
  const suspended = liveQuote?.suspended === true;
  const marketLabel = row?.mkt || row?.sec || "";

  const extendedEligible = classify(symbol) === "us" && !isMacroSymbol(symbol);
  const panelSettings = useMemo(() => ({ ...chartSettings }), [chartSettings]);
  const displayLabel = displayName(row, lang) || symbol;
  const title = chartSettings.titleMode === "ticker"
    ? symbol
    : chartSettings.titleMode === "both"
      ? `${displayLabel} · ${symbol}`
      : displayLabel;

  return (
    <div className={`pane${isActive ? " on" : ""}${swapping ? " is-swapping" : ""}`} data-swapping={swapping ? "1" : undefined} onPointerDownCapture={() => { if (!isActive) onActivate(idx); }}>
      <div className="pane-hd">
        {chartSettings.showLogo && <AssetLogo className="pic" symbol={symbol} name={displayLabel} market={marketLabel} color={row?.col} size={18} />}
        {chartSettings.showSymbolName && <b>{title}</b>}
        <span className="pane-tf">{tf}</span>
        <span className="px num">{f(row?.last, (row?.last ?? 99) < 10 ? 4 : 2)}</span>
        {suspended
          ? <span className="cg pane-suspended">{lang === "zh" ? "停牌" : "Suspended"}</span>
          : <span className={`cg num ${up ? "up" : "down"}`}>{up ? "+" : ""}{f(row?.chg)}%</span>}
      </div>
      {/* Authentication is a hard renderer boundary. Remounting tears down
          native pointer listeners, captures, pending creators, and inspector
          drafts before a stale transaction can call the next owner's callback.
          The SYMBOL is deliberately not part of that identity — see
          lib/drawingOwnership.ts and the swap state above. */}
      <ChartPanel
        symbol={symbol} companyName={displayName(row, lang)} chartType={chartType} indicators={inds} timeframe={tf} dataReady={dataReady && chartSettingsReady} initialTimeframe={initialTimeframe}
        replayIdx={isActive ? replayIdx : null} onMeta={isActive ? onMeta : undefined}
        tool={isActive ? tool : null} toolActivation={toolActivation} drawingSticky={isActive && drawingSticky} drawingCreationDisabled={drawingCreationDisabled} drawStyle={drawStyle} drawings={merged}
        onDrawingsChange={handleChange} detectCmd={detectCmd?.targetPane === idx ? detectCmd : null}
        compare={isActive ? compare.filter((c) => c !== symbol) : []} compareCfg={compareCfg}
        magnet={isActive ? magnet : "off"} isActive={isActive} syncId={idx}
        liveQuote={liveQuote} indParams={indParams} hidden={hidden}
        instrumentName={displayLabel}
        instrumentMarket={marketLabel}
        instrumentColor={row?.col}
        onToggleHidden={onToggleHidden} onRemoveInd={onRemoveInd}
        onOpenSettings={onOpenSettings} onOpenSource={onOpenSource}
        pineScripts={pineScripts} userTier={userTier}
        chartSettings={panelSettings}
        onChartApi={setChartApi}
        extHours={extendedEligible && chartSettings.extHours}
        key={drawingPanelInstanceKey(drawingOwnerKey)}
        onAddAlert={isActive ? onAddAlert : undefined}
        onTableView={isActive ? onTableView : undefined}
        onObjectTree={isActive ? onObjectTree : undefined}
        onOpenSettingsModal={(tab) => { if (tab) setSettingsModalTab(tab as any); setSettingsModalOpen(true); }}
        lockedVLine={lockedVLine}
        onSetLockedVLine={onSetLockedVLine}
        onIndRowsAt={isActive ? onIndRowsAt : undefined}
        dayMode={_dayMode}
        onPaneCount={onPaneCount}
      />
      <ChartFrameBar
        timeframe={tf}
        chartApi={chartApi}
        settings={chartSettings}
        onSettings={patchSettings}
        onOpenSettingsModal={(tab) => {
          if (tab) setSettingsModalTab(tab as ChartSettingsTab);
          setSettingsModalOpen(true);
        }}
        extendedEligible={extendedEligible}
      />
      <ChartSettingsModal
        open={settingsModalOpen}
        tab={settingsModalTab}
        settings={chartSettings}
        onSettings={patchSettings}
        onClose={() => setSettingsModalOpen(false)}
        chartApi={chartApi}
        extendedEligible={extendedEligible}
        intraday={isIntradayTf(tf)}
      />
    </div>
  );
}
