"use client";

import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from "react";
import { useLang } from "@/lib/i18n";
import { getFund } from "@/lib/fund";
import { track } from "@/lib/analytics";
import { EMPTY_VISUAL_CALENDAR, formatVisualTime, visualCalendar, type VisualCalendar, type VisualFrame, type VisualIntelligenceSettings } from "@/lib/visualIntelligence";
import { candleModeText, candleStateText, visualSynthesis, visualText, type VisualCopyKey } from "@/lib/visualIntelligenceCopy";
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
  availableHeight: number;
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
  const { symbol, timeframe, visible, replay, settings, availableHeight } = props;
  const { lang } = useLang();
  const tx = (key: VisualCopyKey) => visualText(key, lang);
  const id = useId();
  const [open, setOpen] = useState(false);
  const openRef = useRef(false); openRef.current = open;
  const [availability, setAvailability] = useState<"loading" | "empty">("loading");
  const [frame, setFrame] = useState<VisualFrame | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [source, setSource] = useState<{ symbol: string; calendar: VisualCalendar }>({ symbol, calendar: EMPTY_VISUAL_CALENDAR });
  const latestFrame = useRef<VisualFrame | null>(null);
  const callbacks = useRef(props); callbacks.current = props;
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
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
      event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus();
    };
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", close, true);
    window.addEventListener("pointerdown", outside);
    return () => { window.removeEventListener("keydown", close, true); window.removeEventListener("pointerdown", outside); };
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
  if (!visible || !settings.visualContext) return null;
  const state = fact?.state ?? "warming";
  const stateClass = state === "up" ? styles.up : state === "down" ? styles.down : state === "weakening" ? styles.warn : styles.neutral;
  const optional: [keyof VisualIntelligenceSettings, VisualCopyKey][] = [
    ["visualRegime", "regimeToggle"], ["visualVolume", "volumeToggle"], ["visualLevels", "levelsToggle"], ["visualEvents", "eventsToggle"],
  ];
  const recentEvents = [...calendar.events].reverse().slice(0, 5);
  const quoteCopy: VisualCopyKey = current?.basis === "LIVE" ? "liveQuote" : current?.basis === "DELAYED_15M" ? "delayedQuote" : current?.basis === "EOD" ? "eodQuote" : "unknown";
  return (
    <div className={styles.root} ref={root} data-visual-context data-context-symbol={symbol} data-context-timeframe={timeframe}>
      <button ref={trigger} type="button" className={`${styles.trigger} ${stateClass}`} aria-expanded={open} aria-controls={id}
        aria-label={tx("title")} onClick={() => { setOpen((value) => !value); if (!open) { inspect(null); telemetry("open"); setFeedback(null); } }}>
        <span className={styles.spark} aria-hidden="true">◇</span>
        <span className={styles.triggerTitle}>{tx("title")}</span>
        <span className={styles.triggerState}>{fact ? candleStateText(state, lang) : tx(availability === "empty" ? "empty" : "loading")}</span>
        <span aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      {open && <section id={id} className={styles.panel} style={{ maxHeight: Math.max(120, availableHeight) }} aria-label={tx("title")}>
        <header className={styles.header}>
          <div><h3>{tx("title")}</h3><p>{symbol} <span aria-hidden="true">/</span> {timeframe}</p></div>
          <button type="button" className={styles.iconButton} aria-label={tx("close")} onClick={() => { setOpen(false); trigger.current?.focus(); }}>×</button>
        </header>
        {!fact || !current ? <p className={styles.empty}>{tx(availability === "empty" ? "empty" : "loading")}</p> : <>
          <div className={styles.barNav}>
            <button type="button" aria-label={tx("previous")} disabled={selectedIndex <= 0} onClick={() => inspect(selectedIndex - 1)}>←</button>
            <div><small>{replay ? tx("replay") : historical ? tx("selectedBar") : tx("latestBar")}</small><time data-context-bar-time>{formatVisualTime(fact.time)}</time></div>
            <button type="button" aria-label={tx("next")} disabled={selectedIndex >= lastIndex} onClick={() => inspect(selectedIndex + 1)}>→</button>
            <button type="button" className={styles.latest} onClick={() => inspect(null)}>{tx("latest")}</button>
          </div>
          <div className={`${styles.synthesis} ${stateClass}`} data-context-synthesis>{visualSynthesis(fact, lang)}</div>
          <p className={styles.hint}>{tx("movementHint")}</p>
          <div className={styles.facts}>
            <section className={styles.fact}>
              <div className={styles.factHead}><h4>{tx("price")}</h4><strong data-context-price-change>{fact.barChangePct !== null && fact.barChangePct > 0 ? "+" : ""}{number(fact.barChangePct)}{fact.barChangePct !== null ? "%" : ""}</strong></div>
              <p>{tx("priceBasis")}</p>
            </section>
            <section className={styles.fact}>
              <div className={styles.factHead}><h4>{tx("candles")}</h4><span>{candleModeText(current.series.mode, lang)}</span></div>
              <strong className={stateClass} data-context-candle-state>{candleStateText(fact.state, lang)}</strong>
              {!current.colored && <p className={styles.warning}>{tx("classic")}</p>}
              <div className={styles.numbers}><span>RSI (14)</span><strong data-context-rsi>{number(fact.rsi14)}</strong></div>
              <p>{current.series.mode.startsWith("momentum") ? tx("momentumBasis") : tx("trendBasis")}</p>
              {props.onCandleSettings && <button type="button" className={styles.textButton} onClick={() => { setOpen(false); callbacks.current.onCandleSettings?.(); }}>{tx("settings")} <span aria-hidden="true">↗</span></button>}
            </section>
            <section className={styles.fact}>
              <div className={styles.factHead}><h4>{tx("trend")}</h4><strong>{candleStateText(fact.trend, lang)}</strong></div>
              <div className={styles.numbers}><span>EMA (20 / 50)</span><strong>{number(fact.ema20)} / {number(fact.ema50)}</strong></div>
              <p>{tx("trendBasis")}</p>
            </section>
            <section className={styles.fact}>
              <div className={styles.factHead}><h4>{tx("volume")}</h4><strong data-context-volume>{fact.volumePercentile === null ? "—" : number(fact.volumePercentile * 100, 0) + "%"}</strong></div>
              {fact.volumePercentile === null ? <p className={styles.warning}>{tx("volumeMissing")}</p> : <div className={styles.meter} aria-hidden="true"><span style={{ width: `${fact.volumePercentile * 100}%` }} /></div>}
              <small>{fact.volumeSamples} {tx("samples")}</small><p>{tx("volumeBasis")}</p>
            </section>
            <section className={styles.fact}>
              <div className={styles.factHead}><h4>{tx("range")}</h4><strong data-context-range>{number(fact.priorLow20)} / {number(fact.priorHigh20)}</strong></div>
              {fact.priorLow20 === null && <p className={styles.warning}>{tx("rangeMissing")}</p>}
              <p>{tx("rangeBasis")}</p>
            </section>
            <section className={styles.fact} data-context-calendar={calendar.state}>
              <div className={styles.factHead}><h4>{tx("events")}</h4></div>
              {calendar.state !== "available" ? <p className={styles.warning}>{tx(calendar.state === "withheld" ? "eventsWithheld" : calendar.state === "loading" ? "eventsLoading" : "eventsMissing")}</p>
                : <>{recentEvents.length === 0 ? <p>{tx("eventsEmpty")}</p> : <div className={styles.events}>{recentEvents.map((event) => <div key={event.kind + event.date}>
                  <span>{tx(event.kind)}</span><time>{event.date}</time>{event.scheduled && <small>{tx("scheduled")}</small>}
                </div>)}</div>}
                <small>{tx("asof")}: {calendar.asof ?? tx("unknown")}</small><p>{tx("eventsBasis")}</p></>}
            </section>
          </div>
          <fieldset className={styles.layers}><legend>{tx("layers")}</legend>{optional.map(([key, label]) => <button key={key} type="button"
            role="switch" aria-checked={settings[key]} aria-label={tx(label)} onClick={() => setting(key, !settings[key])}>
            <span>{tx(label)}</span><span className={`${styles.switch} ${settings[key] ? styles.on : ""}`} aria-hidden="true" />
          </button>)}<p>{tx("layerHint")}</p></fieldset>
          <footer className={styles.footer}>
            <p>{tx("quoteSource")}: {tx(quoteCopy)}</p><p>{tx("disclaimer")}</p>
            <div className={styles.feedback}>{feedback ? <span>{tx("thanks")}</span> : <>
              <button type="button" onClick={() => { telemetry("feedback", { useful: true }); setFeedback("helpful"); }}>{tx("useful")}</button>
              <button type="button" onClick={() => { telemetry("feedback", { useful: false }); setFeedback("unclear"); }}>{tx("unclear")}</button>
            </>}</div>
            <button type="button" className={styles.textButton} onClick={() => setting("visualContext", false)}>{tx("hide")}</button>
          </footer>
        </>}
      </section>}
    </div>
  );
});
export default VisualIntelligencePanel;
