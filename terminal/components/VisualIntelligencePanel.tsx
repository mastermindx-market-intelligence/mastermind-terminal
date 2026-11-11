"use client";

import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ChartContextDock } from "./ChartContextDock";
import { useLang } from "@/lib/i18n";
import { getFund } from "@/lib/fund";
import { track } from "@/lib/analytics";
import { EMPTY_VISUAL_CALENDAR, formatVisualTime, visualCalendar, type VisualCalendar, type VisualFrame, type VisualIntelligenceSettings } from "@/lib/visualIntelligence";
import { candleModeText, candleStateText, visualHeadline, visualQuoteCopyKey, visualShortState, visualSynthesis, visualText, type VisualCopyKey } from "@/lib/visualIntelligenceCopy";
import styles from "./VisualIntelligencePanel.module.css";

export interface VisualIntelligenceHandle {
  update(frame: VisualFrame): void;
  select(time: string | number | null): void;
  reset(state?: "loading" | "empty"): void;
  isInspecting(): boolean;
}
interface Props {
  symbol: string;
  timeframe: string;
  visible: boolean;
  replay: boolean;
  dock?: ChartContextDock;
  settings: VisualIntelligenceSettings;
  onSettings: (patch: Partial<VisualIntelligenceSettings>) => void;
  onInspectTime: (time: string | number | null) => void;
  onCalendar: (symbol: string, calendar: VisualCalendar) => void;
  onCandleSettings?: () => void;
}
const number = (value: number | null | undefined, decimals = 2) =>
  value == null || !Number.isFinite(value) ? "—" : value.toLocaleString("en-US", { maximumFractionDigits: decimals });

/** A small, per-chart view. Crosshair updates never re-render the chart's parent or rerun analysis. */
const VisualIntelligencePanel = forwardRef<VisualIntelligenceHandle, Props>(function VisualIntelligencePanel(props, ref) {
  const { symbol, timeframe, visible, replay, settings, dock } = props;
  const { lang } = useLang();
  const tx = (key: VisualCopyKey) => visualText(key, lang);
  const id = useId();
  const open = !!dock?.open && visible && !!dock.target;
  const openRef = useRef(false); openRef.current = open && settings.visualContext;
  const [availability, setAvailability] = useState<"loading" | "empty">("loading");
  const [frame, setFrame] = useState<VisualFrame | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [source, setSource] = useState<{ symbol: string; calendar: VisualCalendar }>({ symbol, calendar: EMPTY_VISUAL_CALENDAR });
  const latestFrame = useRef<VisualFrame | null>(null);
  const callbacks = useRef(props); callbacks.current = props;
  const root = useRef<HTMLElement>(null);
  useImperativeHandle(ref, () => ({
    isInspecting: () => openRef.current,
    update(next) {
      const old = latestFrame.current;
      latestFrame.current = next;
      if (!old || old.series.symbol !== next.series.symbol || old.series.timeframe !== next.series.timeframe || old.replay !== next.replay) setSelected(null);
      else setSelected((time) => time !== null && !next.series.indexByTime.has(time) ? null : time);
      setFrame(next);
    },
    select(time) {
      if (time === null) { setSelected(null); return; }
      const key = String(time);
      if (latestFrame.current?.series.indexByTime.has(key)) setSelected(key);
    },
    reset(state = "loading") { latestFrame.current = null; setFrame(null); setSelected(null); setAvailability(state); },
  }), []);

  const requestedCalendar = visible && settings.visualContext && (open || settings.visualEvents);
  useEffect(() => {
    let alive = true;
    if (!requestedCalendar) return;
    const emit = (calendar: VisualCalendar) => {
      if (!alive) return;
      setSource({ symbol, calendar });
      callbacks.current.onCalendar(symbol, calendar);
    };
    if (replay) { emit({ state: "withheld", asof: null, events: [] }); return; }
    emit({ state: "loading", asof: null, events: [] });
    void getFund(symbol).then((fund) => emit(visualCalendar(fund, symbol, false))).catch(() => emit(EMPTY_VISUAL_CALENDAR));
    return () => { alive = false; };
  }, [symbol, replay, requestedCalendar]);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !root.current?.contains(event.target as Node)) return;
      event.preventDefault(); event.stopPropagation(); callbacks.current.dock?.onClose();
    };
    window.addEventListener("keydown", close, true);
    return () => window.removeEventListener("keydown", close, true);
  }, [open]);

  const current = frame && frame.series.symbol === symbol && frame.series.timeframe === timeframe && frame.replay === replay ? frame : null;
  const lastIndex = (current?.series.facts.length ?? 0) - 1;
  const selectedIndex = selected === null ? lastIndex : current?.series.indexByTime.get(selected) ?? lastIndex;
  const fact = current?.series.facts[selectedIndex] ?? null;
  const historical = selectedIndex !== lastIndex;
  const calendar = replay || historical ? { state: "withheld" as const, asof: null, events: [] }
    : source.symbol === symbol ? source.calendar : { state: "loading" as const, asof: null, events: [] };
  const telemetry = (action: string, details: Record<string, unknown> = {}) => track({
    type: "click", ticker: symbol,
    meta: { feature: "visual_intelligence", action, timeframe, language: lang, ...details },
  });
  const inspect = (index: number | null) => {
    const time = index === null ? null : current?.series.facts[index]?.time ?? null;
    setSelected(time === null ? null : String(time));
    callbacks.current.onInspectTime(time);
  };
  const setting = (key: keyof VisualIntelligenceSettings, value: boolean) => {
    callbacks.current.onSettings({ [key]: value }); telemetry("layer_toggle", { layer: key, enabled: value });
  };
  if (!visible) return null;
  const tone = (state: string) => state === "up" ? styles.up : state === "down" ? styles.down : state === "weakening" ? styles.warn : styles.neutral;
  const optional: [keyof VisualIntelligenceSettings, VisualCopyKey][] = [
    ["visualRegime", "regimeToggle"], ["visualVolume", "volumeToggle"], ["visualLevels", "levelsToggle"], ["visualEvents", "eventsToggle"],
  ];
  const recentEvents = [...calendar.events].reverse().slice(0, 5);
  const quoteCopy = visualQuoteCopyKey(current?.basis);
  const close = (restoreFocus = true) => callbacks.current.dock?.onClose(restoreFocus);
  return <>
    {settings.visualContext && <span hidden data-visual-context data-context-symbol={symbol} data-context-timeframe={timeframe} />}
    {open && dock?.target && createPortal(
      <section ref={root} id={id} className={styles.panel} aria-label={tx("title")} data-context-reader
        data-context-symbol={symbol} data-context-timeframe={timeframe}
        onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
        <header className={styles.header}>
          <div><h3>{tx("title")}</h3><p>{symbol} <span aria-hidden="true">·</span> {timeframe}</p></div>
          <button type="button" className={styles.iconButton} aria-label={tx("close")} onClick={() => close()}>×</button>
        </header>
        {!settings.visualContext ? <div className={styles.empty}>
          <p>{tx("disabled")}</p><button className={styles.enable} type="button" onClick={() => setting("visualContext", true)}>{tx("enable")}</button>
        </div> : !fact || !current ? <div className={styles.empty} role="status"><span className={styles.emptyIcon} aria-hidden="true">—</span><p>{tx(availability === "empty" ? "empty" : "loading")}</p></div> : <>
          <div className={styles.barNav}>
            <div><small>{replay ? tx("replay") : historical ? tx("selectedBar") : tx("latestBar")}</small><time data-context-bar-time>{formatVisualTime(fact.time)}{typeof fact.time === "number" ? " UTC" : ""}</time></div>
            <button type="button" aria-label={tx("previous")} disabled={selectedIndex <= 0} onClick={() => inspect(selectedIndex - 1)}>‹</button>
            <button type="button" aria-label={tx("next")} disabled={selectedIndex >= lastIndex} onClick={() => inspect(selectedIndex + 1)}>›</button>
            <button type="button" className={styles.latest} disabled={selected === null} onClick={() => inspect(null)}>{tx("latest")}</button>
          </div>
          <div className={styles.synthesis}>
            <h4 data-context-synthesis>{visualHeadline(fact, lang)}</h4>
            <span className={tone(fact.momentum)}><i aria-hidden="true" />{tx("momentum")}: {visualShortState(fact.momentum, lang)}</span>
            {!current.colored && <small>{tx("classic")}</small>}
          </div>
          <div className={styles.facts}>
            <section className={`${styles.card} ${styles.barMove}`}>
              <div><h4>{tx("barMove")}</h4><small>{timeframe} · {tx("openClose")}</small></div>
              <strong className={tone(fact.barChangePct === null || fact.barChangePct === 0 ? "neutral" : fact.barChangePct > 0 ? "up" : "down")} data-context-price-change>{fact.barChangePct !== null && fact.barChangePct > 0 ? "+" : ""}{number(fact.barChangePct)}{fact.barChangePct !== null ? "%" : ""}</strong>
            </section>
            <section className={styles.card}>
              <div className={styles.cardHead}><h4>{lang === "zh" ? "趋势" : "Trend"}</h4><strong className={tone(fact.trend)}>{visualShortState(fact.trend, lang)}</strong></div>
              <p>{tx(fact.trend === "up" ? "aboveAverages" : fact.trend === "down" ? "belowAverages" : fact.trend === "warming" || fact.trend === "missing" ? "trendBasis" : "mixedTrend")}</p>
              <dl className={styles.averages}>
                <div><dt>{tx("priceLabel")}</dt><dd>{number(fact.close)}</dd></div>
                <div><dt>EMA 20</dt><dd>{number(fact.ema20)}</dd></div>
                <div><dt>EMA 50</dt><dd>{number(fact.ema50)}</dd></div>
              </dl>
            </section>
            <section className={styles.card}>
              <div className={styles.cardHead}><h4>{tx("momentum")}</h4><strong className={tone(fact.momentum)} data-context-momentum>{visualShortState(fact.momentum, lang)}</strong></div>
              <div className={styles.reading}><strong data-context-rsi>{number(fact.rsi14)}</strong><small>RSI 14</small></div>
              {fact.rsi14 !== null && <div className={styles.rsiMeter} role="meter" aria-label="RSI 14" aria-valuemin={0} aria-valuemax={100} aria-valuenow={fact.rsi14}>
                <span style={{ left: `${Math.max(0, Math.min(100, fact.rsi14))}%` }} />
              </div>}
              <div className={styles.scale} aria-hidden="true"><span>0 · {lang === "zh" ? "向下" : "Down"}</span><span>40</span><span>60</span><span>{lang === "zh" ? "向上" : "Up"} · 100</span></div>
            </section>
            <section className={styles.card}>
              <div className={styles.cardHead}><h4>{tx("volumeRank")}</h4><div className={styles.rank}><strong data-context-volume>{fact.volumePercentile === null ? "—" : number(fact.volumePercentile * 100, 0)}</strong><small>/ 100</small></div></div>
              {fact.volumePercentile === null ? <p>{tx("volumeMissing")}</p> : <>
                <div className={styles.volumeMeter} role="meter" aria-label={tx("volumeRank")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={fact.volumePercentile * 100}><span style={{ width: `${fact.volumePercentile * 100}%` }} /></div>
                <small>{tx("volumeComparison")} {fact.volumeSamples} {tx("earlierBars")}</small>
              </>}
            </section>
          </div>
          <div className={styles.details}>
            <details><summary><span>{tx("rangeEvents")}</span><span aria-hidden="true">›</span></summary><div className={styles.detailBody}>
              <section><h4>{tx("range")}</h4><strong data-context-range>{number(fact.priorLow20)} / {number(fact.priorHigh20)}</strong>
                {fact.priorLow20 === null && <p>{tx("rangeMissing")}</p>}<p>{tx("rangeBasis")}</p></section>
              <section data-context-calendar={calendar.state}><h4>{tx("events")}</h4>
                {calendar.state !== "available" ? <p>{tx(calendar.state === "withheld" ? "eventsWithheld" : calendar.state === "loading" ? "eventsLoading" : "eventsMissing")}</p>
                  : <>{recentEvents.length === 0 ? <p>{tx("eventsEmpty")}</p> : <div className={styles.events}>{recentEvents.map((event) => <div key={event.kind + event.date}>
                    <span>{tx(event.kind)}</span><time>{event.date}</time>{event.scheduled && <small>{tx("scheduled")}</small>}
                  </div>)}</div>}
                  <small>{tx("asof")}: {calendar.asof ?? tx("unknown")}</small><p>{tx("eventsBasis")}</p></>}
              </section>
            </div></details>
            <details><summary><span>{tx("chartLayers")}</span><span aria-hidden="true">›</span></summary><div className={styles.detailBody}>
              <fieldset className={styles.layers}><legend>{tx("layers")}</legend>{optional.map(([key, label]) => <button key={key} type="button"
                role="switch" aria-checked={settings[key]} aria-label={tx(label)} onClick={() => setting(key, !settings[key])}>
                <span>{tx(label)}</span><span className={`${styles.switch} ${settings[key] ? styles.on : ""}`} aria-hidden="true" />
              </button>)}<p>{tx("layerHint")}</p></fieldset>
            </div></details>
            <details><summary><span>{tx("howToRead")}</span><span aria-hidden="true">›</span></summary><div className={styles.detailBody}>
              <p>{tx("movementHint")}</p><p>{tx("priceBasis")}</p>
              <section><h4>{tx("candles")} · {candleModeText(current.series.mode, lang)}</h4>
                <strong className={tone(fact.state)} data-context-candle-state>{candleStateText(fact.state, lang)}</strong>
                <p>{visualSynthesis(fact, lang)}</p><p>{tx("momentumBasis")}</p><p>{tx("trendBasis")}</p>
                {props.onCandleSettings && <button type="button" className={styles.textButton} onClick={() => { close(false); callbacks.current.onCandleSettings?.(); }}>{tx("settings")} ↗</button>}
              </section>
              <p>{tx("volumeBasis")}</p><p>{tx("disclaimer")}</p>
              <div className={styles.feedback}>{feedback ? <span>{tx("thanks")}</span> : <>
                <button type="button" onClick={() => { telemetry("feedback", { useful: true }); setFeedback("helpful"); }}>{tx("useful")}</button>
                <button type="button" onClick={() => { telemetry("feedback", { useful: false }); setFeedback("unclear"); }}>{tx("unclear")}</button>
              </>}</div>
              <button type="button" className={styles.textButton} onClick={() => { setting("visualContext", false); close(); }}>{tx("hide")}</button>
            </div></details>
          </div>
          <footer className={styles.footer}>{tx("quoteSource")}: {tx(quoteCopy)}</footer>
        </>}
      </section>, dock.target
    )}
  </>;
});
export default VisualIntelligencePanel;
