"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import { useLang } from "@/lib/i18n";
import { largeTradesText } from "@/lib/largeTrades/labels";
import type { ReplayCutoff } from "@/lib/replayContract";
import { isIntradayTf } from "@/lib/intradayShared";
import { buildLargeTradesSnapshot, settingsFromParams } from "@/lib/largeTrades/engine";
import { fetchLargeTrades, type LargeTradesRead } from "@/lib/largeTrades/client";
import { chartDisplayTimezone, largeTradesModeLabel, projectLargeTradeClusters, resolveLargeTradesClock, type ProjectionBar } from "@/lib/largeTrades/chartProjection";
import type { LargeTradeCluster, SideMethod } from "@/lib/largeTrades/types";
import { largeTradesClip, largeTradesControlBounds, largeTradesPlotBounds, largeTradesPoint, type LargeTradesPricePane } from "@/lib/largeTrades/visibility";
import { freezeLargeTradesExportFrame, sameLargeTradesFrameOwner, snapshotRelativeRect,
  type FrozenTradeMarker, type LargeTradesExportFrame, type LargeTradesFrameOwner } from "@/lib/largeTrades/snapshot";
import styles from "./LargeTradesOverlay.module.css";

export type LargeTradesChartContext = {
  chart: IChartApi | null;
  series: ISeriesApi<any> | null;
  bars: readonly ProjectionBar[];
  sourceSymbol: string;
  timeframe: string;
  replayCutoff: ReplayCutoff | null;
  pricePane: LargeTradesPricePane | null;
};
export type LargeTradesOverlayHandle = {
  refresh(): void; sourceChanged(): void; reposition(): void; clear(): void;
  captureSnapshot(root: HTMLElement, capturedAtMs: number): LargeTradesExportFrame | null;
};
type Props = {
  symbol: string; timeframe: string; params: Record<string, unknown>;
  replayCutoff: ReplayCutoff | null; interactive: boolean;
  getContext(): LargeTradesChartContext; onSettings?(): void;
};
type ReadState = { symbol: string; version: number; value: LargeTradesRead | null };
function frameOwner(context: LargeTradesChartContext): LargeTradesFrameOwner {
  return { chart: context.chart, series: context.series, bars: context.bars,
    symbol: context.sourceSymbol, timeframe: context.timeframe,
    replay: context.replayCutoff ? context.replayCutoff.clock + ":" + context.replayCutoff.at : "" };
}
const methodKeys: Record<SideMethod, string> = {
  exchange: "ltMethodExchange", resting_order: "ltMethodResting",
  quote_rule: "ltMethodQuote", unknown: "ltMethodUnknown",
};
const reasonKeys: Record<string, string> = {
  unavailable: "ltUnavailable", signed_out: "ltSignIn", denied: "ltDenied",
  invalid: "ltInvalid", error: "ltError", rate_limited: "ltRateLimited",
};
function nsIso(ns: string): string {
  const whole = BigInt(ns);
  return new Date(Number(whole / BigInt(1000000))).toISOString().replace(/\.\d{3}Z$/, "")
    + "." + (whole % BigInt(1000000000)).toString().padStart(9, "0") + "Z";
}

const LargeTradesOverlay = forwardRef<LargeTradesOverlayHandle, Props>(function LargeTradesOverlay(
  { symbol, timeframe, params, replayCutoff, interactive, getContext, onSettings }, forwardedRef,
) {
  const { lang } = useLang();
  const t = (key: string) => largeTradesText(lang, key);
  const locale = lang === "zh" ? "zh-CN" : "en-US";
  const [read, setRead] = useState<ReadState>({ symbol, version: 0, value: null });
  const [revision, setRevision] = useState(0);
  const [requestVersion, setRequestVersion] = useState(0);
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reportLimit, setReportLimit] = useState(25);
  const nodes = useRef(new Map<string, HTMLButtonElement>());
  const markerLayer = useRef<HTMLDivElement>(null);
  const controlsLayer = useRef<HTMLDivElement>(null);
  const openButton = useRef<HTMLButtonElement>(null);
  const inspector = useRef<HTMLElement>(null);
  const contextGetter = useRef(getContext); contextGetter.current = getContext;
  const ownerSymbol = useRef(symbol); ownerSymbol.current = symbol;
  const settings = useMemo(() => settingsFromParams(params), [params]);
  const currentRead = read.symbol === symbol && read.version === requestVersion ? read.value : null;
  const displayTimezone = chartDisplayTimezone(symbol);

  useEffect(() => {
    const abort = new AbortController();
    let current = true;
    setRead({ symbol, version: requestVersion, value: null }); setSelectedId(null);
    fetchLargeTrades(symbol, abort.signal).then((value) => {
      if (current && !abort.signal.aborted && ownerSymbol.current === symbol) setRead({ symbol, version: requestVersion, value });
    }).catch((error: unknown) => {
      if (current && !abort.signal.aborted && !(error instanceof DOMException && error.name === "AbortError")) {
        setRead({ symbol, version: requestVersion, value: { state: "error", reason: "source_read_failed" } });
      }
    });
    return () => { current = false; abort.abort(); };
  }, [symbol, requestVersion]);

  // One expiry, never a collector or polling loop: a stopped live producer loses its Live badge.
  useEffect(() => {
    if (currentRead?.state !== "ready" || currentRead.envelope.provenance.dataMode !== "live") return;
    const e = currentRead.envelope;
    const until = Math.min(Number(BigInt(e.range.endNs) / BigInt(1000000)),
      Number(BigInt(e.provenance.generatedAtNs) / BigInt(1000000))) + 60_001 - Date.now();
    if (until <= 0) return;
    const timer = setTimeout(() => setRevision((v) => v + 1), until);
    return () => clearTimeout(timer);
  }, [currentRead]);

  const view = useMemo(() => {
    if (currentRead?.state !== "ready") return null;
    const envelope = currentRead.envelope;
    try {
      const clock = resolveLargeTradesClock(envelope, replayCutoff, displayTimezone, Date.now());
      if (clock.state !== "ready") return { envelope, owner: null, snapshot: null, projection: [], clockState: clock.state };
      const snapshot = buildLargeTradesSnapshot(envelope, settings, clock.clock);
      const context = contextGetter.current();
      const accepted = context.sourceSymbol === symbol && context.timeframe === timeframe;
      const projection = accepted ? projectLargeTradeClusters(snapshot.clusters, context.bars, timeframe, displayTimezone, settings.minQuantity) : [];
      return { envelope, owner: accepted ? frameOwner(context) : null, snapshot, projection, clockState: "ready" as const };
    } catch {
      // A valid envelope can still exceed exact aggregate arithmetic; isolate it from the chart.
      return { envelope, owner: null, snapshot: null, projection: [], clockState: "invalid_evidence" as const };
    }
  }, [currentRead, replayCutoff?.at, replayCutoff?.clock, displayTimezone, settings, symbol, timeframe, revision]);
  const viewRef = useRef(view); viewRef.current = view;
  const paintedView = useRef<typeof view>(null);
  const invalidateFrame = useCallback(() => {
    paintedView.current = null;
    for (const node of nodes.current.values()) node.style.visibility = "hidden";
    if (markerLayer.current) markerLayer.current.style.clipPath = "inset(100%)";
    if (controlsLayer.current) {
      controlsLayer.current.style.visibility = "hidden";
      controlsLayer.current.setAttribute("aria-hidden", "true");
      controlsLayer.current.parentElement!.dataset.ownerVisible = "false";
    }
  }, []);

  const reposition = useCallback(() => {
    const context = contextGetter.current();
    const projection = viewRef.current?.projection ?? [];
    const owned = context.sourceSymbol === ownerSymbol.current && context.timeframe === timeframe;
    for (const node of nodes.current.values()) node.style.visibility = "hidden";
    if (markerLayer.current) markerLayer.current.style.clipPath = "inset(100%)";
    const controls = controlsLayer.current, root = controls?.parentElement;
    const hideControls = () => {
      if (controls) { controls.style.visibility = "hidden"; controls.setAttribute("aria-hidden", "true"); }
      if (root) root.dataset.ownerVisible = "false";
    };
    if (!owned || !context.chart || !context.series || !context.pricePane || !controls || !root) {
      hideControls(); return;
    }
    try {
      const nativePaneIndex = context.series.getPane().paneIndex();
      if (context.pricePane.paneIndex !== nativePaneIndex) { hideControls(); return; }
      const plot = largeTradesPlotBounds(context.pricePane, context.chart.priceScale("left").width(),
        context.chart.paneSize(nativePaneIndex).width);
      if (!plot) { hideControls(); return; }
      const bounds = root.getBoundingClientRect();
      if (!bounds.width || !bounds.height) { hideControls(); return; }
      const sx = root.clientWidth / bounds.width, sy = root.clientHeight / bounds.height;
      const viewport = window.visualViewport;
      const visible = { x: ((viewport?.offsetLeft ?? 0) - bounds.left) * sx,
        y: ((viewport?.offsetTop ?? 0) - bounds.top) * sy,
        width: (viewport?.width ?? window.innerWidth) * sx,
        height: (viewport?.height ?? window.innerHeight) * sy };
      const controlBounds = largeTradesControlBounds(plot, root.clientWidth, root.clientHeight, visible);
      if (!controlBounds) { hideControls(); return; } // Never leave quantities without reachable provenance.
      controls.style.left = controlBounds.x + "px"; controls.style.top = controlBounds.y + "px";
      controls.style.width = controlBounds.width + "px"; controls.style.height = controlBounds.height + "px";
      controls.style.visibility = "visible"; controls.removeAttribute("aria-hidden");
      root.dataset.ownerVisible = "true";
      if (paintedView.current !== viewRef.current
        || !sameLargeTradesFrameOwner(viewRef.current?.owner ?? null, frameOwner(context))) return;
      if (markerLayer.current) markerLayer.current.style.clipPath = largeTradesClip(plot,
        markerLayer.current.clientWidth, markerLayer.current.clientHeight);
      for (const mark of projection) {
        const node = nodes.current.get(mark.cluster.id);
        if (!node) continue;
        const x = context.chart.timeScale().timeToCoordinate(mark.chartTime as any);
        const y = context.series.priceToCoordinate(mark.price);
        const point = largeTradesPoint(plot, x, y);
        if (!point) continue;
        node.style.left = point.x + "px"; node.style.top = point.y + "px"; node.style.visibility = "visible";
      }
    } catch {
      hideControls();
      for (const node of nodes.current.values()) node.style.visibility = "hidden";
      if (markerLayer.current) markerLayer.current.style.clipPath = "inset(100%)";
    }
  }, [timeframe]);
  const captureSnapshot = useCallback((root: HTMLElement, capturedAtMs: number): LargeTradesExportFrame | null => {
    // Native takeScreenshot may flush coordinates. Reproject now, without changing its data/range.
    reposition();
    const current = viewRef.current, context = contextGetter.current();
    if (!current?.snapshot || !current.owner || paintedView.current !== current
      || !sameLargeTradesFrameOwner(current.owner, frameOwner(context))
      || !context.pricePane || !context.chart || !context.series || current.clockState !== "ready"
      || !isIntradayTf(context.timeframe) || controlsLayer.current?.style.visibility !== "visible") return null;
    const mode = largeTradesModeLabel(current.envelope, capturedAtMs);
    if (mode === "stale" || mode === "unavailable") return null;
    try {
      const plot = largeTradesPlotBounds(context.pricePane, context.chart.priceScale("left").width(),
        context.chart.paneSize(context.pricePane.paneIndex).width);
      if (!plot) return null;
      const bounds = root.getBoundingClientRect();
      const cssWidth = root.clientWidth, cssHeight = root.clientHeight;
      if (!cssWidth || !cssHeight || !bounds.width || !bounds.height) return null;
      const markers: FrozenTradeMarker[] = [];
      for (const mark of current.projection) {
        const node = nodes.current.get(mark.cluster.id);
        if (!node?.isConnected || !root.contains(node)) continue;
        const style = getComputedStyle(node);
        if (style.visibility !== "visible" || style.display === "none") continue;
        const rect = snapshotRelativeRect(node.getBoundingClientRect(), bounds, cssWidth, cssHeight);
        if (!rect) continue;
        const labelNode = settings.showLabels ? node.querySelector("span") : null;
        const labelStyle = labelNode ? getComputedStyle(labelNode) : null;
        const labelRect = labelNode ? snapshotRelativeRect(labelNode.getBoundingClientRect(), bounds, cssWidth, cssHeight) : null;
        const ring = /^(.*?)\s+0px\s+0px\s+0px\s+([.\d]+)px$/.exec(style.boxShadow);
        markers.push({ id: mark.cluster.id, quantity: mark.cluster.quantity, reports: mark.cluster.tradeCount,
          side: mark.cluster.side, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2,
          width: rect.width, height: rect.height, fill: style.backgroundColor,
          border: style.borderTopColor, borderWidth: parseFloat(style.borderTopWidth) || 0,
          opacity: parseFloat(style.opacity), ringColor: ring?.[1] ?? "", ringWidth: Number(ring?.[2] ?? 0),
          label: labelNode && labelStyle && labelRect ? { text: labelNode.textContent ?? "",
            rect: labelRect, fill: labelStyle.backgroundColor, color: labelStyle.color,
            font: `${labelStyle.fontStyle} ${labelStyle.fontWeight} ${labelStyle.fontSize} ${labelStyle.fontFamily}`,
            radius: parseFloat(labelStyle.borderTopLeftRadius) || 0 } : null });
      }
      const e = current.envelope, p = e.provenance;
      const translate = (key: string) => largeTradesText(lang, key);
      const unitText = translate(e.instrument.quantityUnit === "contracts" ? "ltContracts" : "ltShares");
      const footer = [
        [translate("ltTitle"), translate("ltMode" + mode[0].toUpperCase() + mode.slice(1)), e.instrument.symbol,
          p.venue, translate(p.scope === "venue" ? "ltVenueOnly" : "ltConsolidated"), unitText,
          nsIso(e.range.startNs).slice(0, 10)].join(" · "),
        translate("ltSettingMinQuantity") + ": " + settings.minQuantity.toLocaleString(locale)
          + " " + unitText + " · " + translate("ltOrders") + ": " + translate("ltNotAvailable"),
      ];
      if (p.coverage !== "complete") footer.push(translate("ltPartialCoverage"));
      if (mode === "fixture") footer.push(translate("ltFixtureNotice"));
      if (p.evidenceMode === "HISTORICAL_REPLAY") footer.push(translate("ltHistoricalKnowledge"));
      if (context.replayCutoff) footer.push(translate("ltReplayCutoff") + ": " + nsIso(current.snapshot.clock.marketCutoffNs));
      if (p.attribution) footer.push(p.attribution);
      if (p.termsUrl && /^https:\/\//i.test(p.termsUrl)) footer.push(p.termsUrl);
      return freezeLargeTradesExportFrame({ symbol: e.instrument.symbol, timeframe: context.timeframe,
        replay: current.owner.replay, sourceSha256: p.sourceSha256, capturedAtMs, cssWidth, cssHeight,
        plot, markers, footer });
    } catch { return null; }
  }, [reposition, settings, lang, locale]);

  useImperativeHandle(forwardedRef, () => ({
    refresh() { invalidateFrame(); setRevision((v) => v + 1); },
    // Called only by ChartPanel's accepted-source owner; replay and pan never fetch.
    sourceChanged() { invalidateFrame(); setRevision((v) => v + 1); setRequestVersion((v) => v + 1); },
    reposition, captureSnapshot,
    clear() { invalidateFrame(); setRevision((v) => v + 1); },
  }), [reposition, captureSnapshot, invalidateFrame]);
  useLayoutEffect(() => { paintedView.current = view; reposition(); }, [view, reposition, open]);
  useEffect(() => {
    // Page/visual-viewport movement can change the visible part of an unchanged native pane.
    const viewport = window.visualViewport;
    window.addEventListener("scroll", reposition, { passive: true, capture: true });
    viewport?.addEventListener("resize", reposition);
    viewport?.addEventListener("scroll", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      viewport?.removeEventListener("resize", reposition);
      viewport?.removeEventListener("scroll", reposition);
    };
  }, [reposition]);

  const clusters = view?.snapshot?.clusters ?? [];
  const selected = clusters.find((cluster) => cluster.id === selectedId) ?? clusters[0] ?? null;
  const reports = useMemo(() => {
    const ids = new Set(selected?.sourceIds ?? []);
    return (view?.snapshot?.visiblePrints ?? []).filter((print) => ids.has(print.id));
  }, [selected, view?.snapshot]);
  useEffect(() => { setReportLimit(25); }, [selected?.id]);
  const unit = t(view?.envelope.instrument.quantityUnit === "contracts" ? "ltContracts" : "ltShares");
  const qty = (value: number) => value.toLocaleString(locale);
  const sideLabel = (cluster: LargeTradeCluster) => t(cluster.side === "unknown" ? "ltUnknownSide"
    : cluster.side === "buy" ? (cluster.sideMethod === "exchange" ? "ltBuyNative" : "ltBuyEstimate")
      : cluster.sideMethod === "exchange" ? "ltSellNative" : "ltSellEstimate");
  const inspect = (id?: string) => {
    if (id) setSelectedId(id);
    setOpen(true);
    requestAnimationFrame(() => inspector.current?.focus({ preventScroll: true }));
  };
  const close = () => { setOpen(false); openButton.current?.focus({ preventScroll: true }); };
  const envelope = view?.envelope;
  const mode = envelope ? largeTradesModeLabel(envelope, Date.now()) : null;
  const modeText = mode ? t("ltMode" + mode[0].toUpperCase() + mode.slice(1)) : t(currentRead ? "ltModeUnavailable" : "ltLoading");
  const dateText = envelope ? nsIso(envelope.range.startNs).slice(0, 10) : "";
  const total = clusters.reduce((sum, cluster) => sum + cluster.quantity, 0);
  const state = view?.clockState === "invalid_evidence" ? "invalid" : currentRead?.state ?? "loading";
  const price = (value: number) => value.toLocaleString(locale, { maximumFractionDigits: Math.min(10, Math.ceil(Math.log10(envelope?.instrument.priceScale ?? 10000))) });
  const terms = envelope?.provenance.termsUrl;
  const safeTerms = terms && /^https:\/\//i.test(terms) ? terms : null;

  return <section className={styles.root} data-testid="large-trades-overlay" data-state={state}
    data-mode={mode ?? "unavailable"} data-symbol={symbol} data-open={open} aria-label={t("ltTitle")}>
    <div ref={markerLayer} className={styles.markerLayer} aria-label={t("ltMarkers")}>
      {(view?.projection ?? []).map((mark) => <button key={mark.cluster.id}
        ref={(node) => { if (node) nodes.current.set(mark.cluster.id, node); else nodes.current.delete(mark.cluster.id); }}
        type="button" data-testid="large-trade-marker" data-cluster-id={mark.cluster.id}
        data-quantity={mark.cluster.quantity} data-trade-count={mark.cluster.tradeCount}
        data-side={mark.cluster.side} data-side-method={mark.cluster.sideMethod}
        className={styles.marker}
        style={{ width: mark.diameter, height: mark.diameter, pointerEvents: interactive ? "auto" : "none" }}
        tabIndex={interactive ? 0 : -1}
        aria-label={`${qty(mark.cluster.quantity)} ${unit}; ${qty(mark.cluster.tradeCount)} ${t("ltTradeReports")}; ${sideLabel(mark.cluster)}`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => { event.stopPropagation(); inspect(mark.cluster.id); }}>
        {settings.showLabels && <span>{qty(mark.cluster.quantity)}</span>}
      </button>)}
    </div>
    <div ref={controlsLayer} className={styles.controlsLayer} data-testid="large-trades-controls">
    <div className={styles.dock} data-testid="large-trades-dock">
      <div className={styles.dockHeader}>
        <strong>{t("ltTitle")}</strong>
        <span className={styles.mode} data-warning={mode !== "live"}>{modeText}</span>
        <button type="button" className={styles.iconButton} onClick={() => { invalidateFrame(); setRequestVersion((v) => v + 1); }}
          aria-label={t("ltRefresh")} title={t("ltRefresh")}>↻</button>
      </div>
      {state === "ready" && envelope ? <>
        <div className={styles.sourceLine}>{envelope.provenance.venue} · {t(envelope.provenance.scope === "venue" ? "ltVenueOnly" : "ltConsolidated")} · {dateText}</div>
        {envelope.provenance.coverage !== "complete" && <div className={styles.notice}>{t("ltPartialCoverage")}</div>}
        <div className={styles.actions}>
          <button ref={openButton} type="button" onClick={() => inspect()} aria-expanded={open}
            data-testid="large-trades-inspect">{t("ltInspect")} <b>{qty(clusters.length)}</b></button>
          <span>{t("ltShownQuantity").replace("{n}", qty(total)).replace("{unit}", unit)}</span>
          {onSettings && <button type="button" onClick={onSettings}>{t("ltSettings")}</button>}
        </div>
        {!isIntradayTf(timeframe) && <p className={styles.notice}>{t("ltIntradayChart")}</p>}
        {view?.clockState !== "ready" && <p className={styles.notice}>{t(view?.clockState === "ambiguous_replay_time" ? "ltAmbiguousClock" : "ltReplayClock")}</p>}
        {!!view?.snapshot?.diagnostics.calibrationPending && <p className={styles.notice}>{t("ltCalibration").replace("{n}", qty(view.snapshot.diagnostics.calibrationPending))}</p>}
        {view?.snapshot && clusters.length === 0 && !view.snapshot.diagnostics.calibrationPending && <p className={styles.notice}>{t("ltNoMatches")}</p>}
        {view?.snapshot?.diagnostics.markerLimitApplied && <p className={styles.notice} data-testid="large-trades-truncated">{t("ltQualifying").replace("{shown}", qty(clusters.length)).replace("{total}", qty(view.snapshot.diagnostics.qualifyingClusters))} {t("ltLimit").replace("{n}", qty(settings.maxMarkers))}</p>}
        <div className={styles.dockAttribution}>{envelope.provenance.attribution}
          {safeTerms && <> <a href={safeTerms} target="_blank" rel="noopener noreferrer">{t("ltDataTerms")}</a></>}
        </div>
      </> : <p className={styles.notice}>{state === "loading" ? t("ltLoading") : t(currentRead?.state === "unavailable" && currentRead.reason === "feed_not_admitted" ? "ltNotAdmitted" : reasonKeys[state] ?? "ltUnavailable")}</p>}
    </div>
    {open && envelope && <aside ref={inspector} className={styles.inspector} tabIndex={-1} role="dialog" aria-modal="false"
      aria-label={t("ltInspector")} data-testid="large-trades-inspector"
      onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); close(); } }}>
      <header className={styles.inspectorHeader}><div><strong>{t("ltInspector")}</strong><p>{symbol} · {modeText} · {dateText}</p></div>
        <button type="button" className={styles.iconButton} onClick={close} aria-label={t("ltClose")}>×</button></header>
      {envelope.provenance.evidenceMode === "HISTORICAL_REPLAY" && <p className={styles.banner}>{t("ltHistoricalKnowledge")}</p>}
      {mode === "fixture" && <p className={styles.banner}>{t("ltFixtureNotice")}</p>}
      <div className={styles.inspectorBody}>
        <ol className={styles.tradeList} aria-label={t("ltClusters")}>
          {clusters.map((cluster) => <li key={cluster.id}><button type="button"
            aria-pressed={cluster.id === selected?.id} data-testid="large-trade-list-item"
            onClick={() => setSelectedId(cluster.id)}>
            <b>{qty(cluster.quantity)} <small>{unit}</small></b><span>{sideLabel(cluster)}</span>
            <time dateTime={nsIso(cluster.endNs)}>{new Date(Number(BigInt(cluster.endNs) / BigInt(1000000))).toLocaleTimeString(locale, { timeZone: displayTimezone, hour12: false })}</time>
          </button></li>)}
        </ol>
        {selected ? <div className={styles.detail} data-testid="large-trade-detail">
          <div className={styles.hero}><strong>{qty(selected.quantity)}</strong><span>{unit}</span></div>
          <p>{sideLabel(selected)} · {t(methodKeys[selected.sideMethod])}</p>
          <dl>
            <dt>{t("ltReports")}</dt><dd>{qty(selected.tradeCount)}</dd>
            <dt>{t("ltOrders")}</dt><dd>{t("ltNotAvailable")}</dd>
            <dt>{t("ltWeightedPrice")}</dt><dd>{price(selected.weightedPrice)}</dd>
            <dt>{t("ltClassifiedBuy")}</dt><dd>{qty(selected.buyQuantity)} {unit}</dd>
            <dt>{t("ltClassifiedSell")}</dt><dd>{qty(selected.sellQuantity)} {unit}</dd>
            <dt>{t("ltUnclassified")}</dt><dd>{qty(selected.unknownQuantity)} {unit}</dd>
            <dt>{t("ltThreshold")}</dt><dd>{qty(selected.threshold)} {unit}</dd>
            <dt>{t("ltPriceResponse")}</dt><dd data-response-state={selected.response.state}>{t("ltResponse_" + selected.response.state)}</dd>
            {selected.response.responseTicks != null && <><dt>{t("ltNetResponse")}</dt><dd>{price(selected.response.responseTicks)} {t("ltTicks")}</dd></>}
            {selected.response.maxExcursionTicks != null && <><dt>{t("ltMaxExcursion")}</dt><dd>{price(selected.response.maxExcursionTicks)} {t("ltTicks")}</dd></>}
            <dt>{t("ltAbsorption")}</dt><dd>{t(selected.response.absorption === "candidate" ? "ltCandidateOnly" : "ltNotEstablished")}</dd>
          </dl>
          {envelope.instrument.tickSizeInt === null && <p className={styles.notice}>{t("ltSamePriceOnly")}</p>}
          <p className={styles.notice}>{t("ltDescriptiveOnly")}</p>
          <details className={styles.evidence}><summary>{t("ltEvidence")}</summary>
            <dl><dt>{t("ltFirstExecution")}</dt><dd><code>{nsIso(selected.startNs)}</code></dd>
              <dt>{t("ltLastExecution")}</dt><dd><code>{nsIso(selected.endNs)}</code></dd>
              <dt>{t("ltKnownAt")}</dt><dd><code>{nsIso(selected.knownAtNs)}</code></dd>
              <dt>{t("ltResponseKnownAt")}</dt><dd><code>{selected.response.knownAtNs ? nsIso(selected.response.knownAtNs) : t("ltNotAvailable")}</code></dd>
              {selected.thresholdKnownAtNs && <><dt>{t("ltThresholdKnownAt")}</dt><dd><code>{nsIso(selected.thresholdKnownAtNs)}</code></dd></>}
              {selected.closedAtNs && <><dt>{t("ltClusterClosedAt")}</dt><dd><code>{nsIso(selected.closedAtNs)}</code></dd></>}
              <dt>{t("ltPathCoverage")}</dt><dd>{t(selected.response.pathEvidence === "complete" ? "ltCompletePath" : "ltNotAvailable")}</dd>
              {!!selected.correctionIds?.length && <><dt>{t("ltCorrections")}</dt><dd>{qty(selected.correctionIds.length)}</dd></>}
              <dt>{t("ltFeed")}</dt><dd>{envelope.provenance.provider} · {envelope.provenance.dataset}</dd>
              <dt>{t("ltSource")}</dt><dd><code>{envelope.provenance.sourceRef}</code></dd>
              <dt>{t("ltSequenceGaps")}</dt><dd>{qty(envelope.provenance.sequenceGaps)}</dd>
              <dt>{t("ltTickSize")}</dt><dd>{envelope.instrument.tickSizeInt === null ? t("ltNotAvailable") : price(envelope.instrument.tickSizeInt / envelope.instrument.priceScale)}</dd>
              <dt>{t("ltCapturedQuantity")}</dt><dd>{qty(view?.snapshot?.diagnostics.eligibleQuantity ?? 0)} {unit}</dd>
              <dt>{t("ltArtifactHash")}</dt><dd><code>{currentRead?.state === "ready" ? currentRead.artifactSha256 ?? t("ltNotAvailable") : t("ltNotAvailable")}</code></dd>
            </dl>
          </details>
          <details className={styles.evidence} data-testid="large-trade-reports"><summary>{t("ltReports")} ({qty(reports.length)})</summary>
            <ol className={styles.reportList}>
              {reports.slice(0, reportLimit).map((report) => <li key={report.id}>
                <b>{qty(report.quantity)} {unit} · {price(report.priceInt / envelope.instrument.priceScale)}</b>
                <dl><dt>{t("ltExecutionTime")}</dt><dd><code>{nsIso(report.eventNs)}</code></dd>
                  <dt>{t("ltAvailableAt")}</dt><dd><code>{nsIso(report.availableNs)}</code></dd>
                  <dt>{t("ltConditions")}</dt><dd>{report.conditions.length ? report.conditions.join(", ") : t("ltNoConditions")}</dd>
                  <dt>{t("ltRecordIds")}</dt><dd><code>{report.id}</code></dd>
                  <dt>{t("ltSideEvidence")}</dt><dd>{t(methodKeys[report.sideMethod])}</dd>
                </dl>
              </li>)}
            </ol>
            {reports.length > reportLimit && <button type="button" className={styles.moreReports}
              onClick={() => setReportLimit((n) => Math.min(reports.length, n + 25))}>{t("ltMoreReports")}</button>}
          </details>
        </div> : <p className={styles.notice}>{t("ltNoMatches")}</p>}
      </div>
      <footer className={styles.attribution}>{envelope.provenance.attribution}
        {safeTerms && <> <a href={safeTerms} target="_blank" rel="noopener noreferrer">{t("ltDataTerms")}</a></>}
      </footer>
    </aside>}
    </div>
  </section>;
});
export default LargeTradesOverlay;
