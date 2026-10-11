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
import styles from "./LargeTradesOverlay.module.css";

export type LargeTradesChartContext = {
  chart: IChartApi | null;
  series: ISeriesApi<any> | null;
  bars: readonly ProjectionBar[];
  sourceSymbol: string;
  timeframe: string;
  pricePane: { top: number; height: number; collapsed?: boolean } | null;
};
export type LargeTradesOverlayHandle = { refresh(): void; sourceChanged(): void; reposition(): void; clear(): void };
type Props = {
  symbol: string; timeframe: string; params: Record<string, unknown>;
  replayCutoff: ReplayCutoff | null; interactive: boolean;
  getContext(): LargeTradesChartContext; onSettings?(): void;
};
type ReadState = { symbol: string; value: LargeTradesRead | null };
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
  const [read, setRead] = useState<ReadState>({ symbol, value: null });
  const [revision, setRevision] = useState(0);
  const [requestVersion, setRequestVersion] = useState(0);
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reportLimit, setReportLimit] = useState(25);
  const nodes = useRef(new Map<string, HTMLButtonElement>());
  const openButton = useRef<HTMLButtonElement>(null);
  const inspector = useRef<HTMLElement>(null);
  const contextGetter = useRef(getContext); contextGetter.current = getContext;
  const ownerSymbol = useRef(symbol); ownerSymbol.current = symbol;
  const settings = useMemo(() => settingsFromParams(params), [params]);
  const currentRead = read.symbol === symbol ? read.value : null;
  const displayTimezone = chartDisplayTimezone(symbol);

  useEffect(() => {
    const abort = new AbortController();
    let current = true;
    setRead({ symbol, value: null }); setSelectedId(null);
    fetchLargeTrades(symbol, abort.signal).then((value) => {
      if (current && !abort.signal.aborted && ownerSymbol.current === symbol) setRead({ symbol, value });
    }).catch((error: unknown) => {
      if (current && !abort.signal.aborted && !(error instanceof DOMException && error.name === "AbortError")) {
        setRead({ symbol, value: { state: "error", reason: "source_read_failed" } });
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
      if (clock.state !== "ready") return { envelope, snapshot: null, projection: [], clockState: clock.state };
      const snapshot = buildLargeTradesSnapshot(envelope, settings, clock.clock);
      const context = contextGetter.current();
      const accepted = context.sourceSymbol === symbol && context.timeframe === timeframe;
      const projection = accepted ? projectLargeTradeClusters(snapshot.clusters, context.bars, timeframe, displayTimezone, settings.minQuantity) : [];
      return { envelope, snapshot, projection, clockState: "ready" as const };
    } catch {
      // A valid envelope can still exceed exact aggregate arithmetic; isolate it from the chart.
      return { envelope, snapshot: null, projection: [], clockState: "invalid_evidence" as const };
    }
  }, [currentRead, replayCutoff?.at, replayCutoff?.clock, displayTimezone, settings, symbol, timeframe, revision]);
  const viewRef = useRef(view); viewRef.current = view;

  const reposition = useCallback(() => {
    const context = contextGetter.current();
    const projection = viewRef.current?.projection ?? [];
    const eligible = context.sourceSymbol === ownerSymbol.current
      && context.timeframe === timeframe && context.chart && context.series && !context.pricePane?.collapsed;
    for (const node of nodes.current.values()) node.style.visibility = "hidden";
    if (!eligible || !context.chart || !context.series) return;
    try {
      const pane = context.pricePane;
      const width = context.chart.paneSize(context.series.getPane().paneIndex()).width;
      const height = pane?.height ?? context.chart.paneSize(context.series.getPane().paneIndex()).height;
      const top = pane?.top ?? 0;
      for (const mark of projection) {
        const node = nodes.current.get(mark.cluster.id);
        if (!node) continue;
        const x = context.chart.timeScale().timeToCoordinate(mark.chartTime as any);
        const y = context.series.priceToCoordinate(mark.price);
        if (x == null || y == null || x < 0 || x > width || y < 0 || y > height) continue;
        node.style.left = x + "px"; node.style.top = (y + top) + "px"; node.style.visibility = "visible";
      }
    } catch { /* A retired renderer never keeps a marker at its previous owner's coordinates. */ }
  }, [timeframe]);
  useImperativeHandle(forwardedRef, () => ({
    refresh() { setRevision((v) => v + 1); },
    // Called only by ChartPanel's accepted-source owner; replay and pan never fetch.
    sourceChanged() { setRevision((v) => v + 1); setRequestVersion((v) => v + 1); },
    reposition,
    clear() {
      for (const node of nodes.current.values()) node.style.visibility = "hidden";
      setRevision((v) => v + 1);
    },
  }), [reposition]);
  useLayoutEffect(() => { reposition(); }, [view, reposition]);

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
    <div className={styles.markerLayer} aria-label={t("ltMarkers")}>
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
    <div className={styles.dock} data-testid="large-trades-dock">
      <div className={styles.dockHeader}>
        <strong>{t("ltTitle")}</strong>
        <span className={styles.mode} data-warning={mode !== "live"}>{modeText}</span>
        <button type="button" className={styles.iconButton} onClick={() => setRequestVersion((v) => v + 1)}
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
  </section>;
});
export default LargeTradesOverlay;
