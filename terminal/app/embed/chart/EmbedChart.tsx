"use client";

/**
 * EmbedChart — the self-contained TradingView-style chart widget rendered inside the
 * /embed/chart iframe. Daily bars only (no live quotes, no indicators engine, no Supabase).
 *
 * Deliberately imports only:
 *   - lightweight-charts (already a dependency)
 *   - the pure lib/embed/* helpers (DOM-free)
 * so the client bundle never pulls the AppShell, flow desks, pine engine, or auth.
 *
 * Aesthetic is locked to the Terminal's own chart (app/globals.css v5 tokens): #131722 plot bg,
 * #26c281 / #f0566b candles, Inter labels + Inter tabular numerals. See lib/embed/theme.ts.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  CrosshairMode,
  ColorType,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type MouseEventParams,
  type Time,
} from "lightweight-charts";
import {
  toBars,
  computeQuote,
  sma,
  visibleRange,
  fmtPrice,
  fmtChange,
  fmtPct,
  fmtVolume,
  RANGE_KEYS,
  type Bar,
  type Quote,
  type RangeKey,
  type ThemeName,
  type Lang,
} from "@/lib/embed/chartData";
import { palette, CLEAN, type EmbedPalette } from "@/lib/embed/theme";
import { makeT } from "@/lib/embed/labels";

export interface EmbedChartProps {
  symbol: string;
  theme: ThemeName;
  lang: Lang;
  transparent: boolean;
  initialRange: RangeKey;
  /** hdr=0 — hide the symbol/price quote line (native hosts render their own header);
   *  the range tabs and SMA legend stay. */
  hideQuote?: boolean;
  /** clean=1 — the TV symbol-sheet mini chart (docs/tv-parity/spec-symbol-detail.md §2B):
   *  candles ONLY (no SMA overlays, no legend, no volume band), quiet canvas, TV palette,
   *  dashed prior-close rule, TV-styled range capsules. Off ⇒ the widget is unchanged. */
  clean?: boolean;
  /** fs=1 — append the native "open full chart" affordance to the right end of the range
   *  row. Posts `openFullChart` to a native host; a plain browser is a no-op. */
  fullscreenBtn?: boolean;
}

/** Ask the native host to open the full chart. No host (browser / e2e) ⇒ silent no-op. */
function postOpenFullChart(): void {
  try {
    (window as unknown as { webkit?: { messageHandlers?: { mm?: { postMessage(m: unknown): void } } } })
      .webkit?.messageHandlers?.mm?.postMessage({ type: "openFullChart" });
  } catch {
    /* not hosted by a native shell */
  }
}

type LoadState =
  | { kind: "loading" }
  | { kind: "empty" } // valid symbol, but no bars
  | { kind: "ready"; bars: Bar[]; quote: Quote };

// Reduced-motion: skip the ribbon sweep + shimmer.
function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

const TERMINAL_BASE = "https://app.mastermind-x.com/terminal";

/** Transparent mode must reach the ROOT — the app's globals.css paints html/body dark,
 * which would otherwise show through as an opaque dark box inside the parent's
 * light/glass card (the widget's own pageBg:transparent can't override an ancestor). */
function useTransparentRoot(transparent: boolean): void {
  useEffect(() => {
    if (!transparent) return;
    const html = document.documentElement;
    const prevHtml = html.style.background;
    const prevBody = document.body.style.background;
    html.style.background = "transparent";
    document.body.style.background = "transparent";
    return () => {
      html.style.background = prevHtml;
      document.body.style.background = prevBody;
    };
  }, [transparent]);
}

export default function EmbedChart({ symbol, theme, lang, transparent, initialRange, hideQuote, clean = false, fullscreenBtn = false }: EmbedChartProps) {
  const pal = useMemo<EmbedPalette>(() => palette(theme, transparent, clean), [theme, transparent, clean]);
  const t = useMemo(() => makeT(lang), [lang]);

  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [range, setRange] = useState<RangeKey>(initialRange);
  // SMA overlays are ON by default (brief) and tap-toggle via the legend.
  const [sma50On, setSma50On] = useState(true);
  const [sma200On, setSma200On] = useState(true);
  // Crosshair OHLC readout — null when the pointer is off the chart (show the day-quote instead).
  const [hover, setHover] = useState<Bar | null>(null);

  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const sma50Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const sma200Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const barsRef = useRef<Bar[]>([]);

  useTransparentRoot(transparent);

  // ── Fetch daily bars (same-origin static file) ────────────────────────────────
  // Small self-contained fetch (not lib/dataCache) so the embed doesn't pull the coverage/neg404
  // machinery. A 404/empty file → clean empty state; never a crash, never a blank white box.
  useEffect(() => {
    let alive = true;
    setState({ kind: "loading" });
    fetch(`/data/${encodeURIComponent(symbol)}.json`, { cache: "force-cache" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((json) => {
        if (!alive) return;
        const bars = toBars(json);
        const quote = computeQuote(bars);
        if (bars.length === 0 || !quote) {
          setState({ kind: "empty" });
          return;
        }
        barsRef.current = bars;
        setState({ kind: "ready", bars, quote });
      });
    return () => {
      alive = false;
    };
  }, [symbol]);

  // ── Build the chart once bars are ready ───────────────────────────────────────
  useEffect(() => {
    if (state.kind !== "ready") return;
    const host = hostRef.current;
    if (!host) return;
    const bars = state.bars;

    const chart = createChart(host, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: pal.chartBg },
        // pal.muted is already CLEAN.axisText (#B1B5BE) when clean=1 — see lib/embed/theme.ts.
        textColor: pal.muted,
        fontSize: clean ? 12 : 11,
        fontFamily: "var(--font-inter), -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        attributionLogo: false,
      },
      // C11/CHART-11 — clean mode drops BOTH axes' gridlines (spec §2B: TV's symbol sheet has
      // zero gridlines; only the verticals were gated before, so the sheet chart still ruled every
      // price label). The candles and the dashed prior close carry the canvas.
      grid: {
        vertLines: { visible: !clean, color: pal.grid },
        horzLines: { visible: !clean, color: pal.grid },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: pal.crosshair, width: 1, labelBackgroundColor: pal.crosshairLabelBg },
        horzLine: { color: pal.crosshair, width: 1, labelBackgroundColor: pal.crosshairLabelBg },
      },
      // No volume band in clean mode ⇒ no bottom reserve to hold for it.
      rightPriceScale: {
        borderColor: pal.axisLine,
        borderVisible: !clean,
        scaleMargins: { top: 0.08, bottom: clean ? 0.08 : 0.24 },
      },
      timeScale: { borderColor: pal.axisLine, borderVisible: !clean, rightOffset: 4, barSpacing: 8, fixLeftEdge: true },
      localization: { locale: lang === "zh" ? "zh-CN" : "en-US" },
      handleScale: { axisPressedMouseMove: { time: true, price: false } },
    });
    chartRef.current = chart;

    // Candles (house colors, borderless — matches ChartPanel).
    const candle = chart.addSeries(CandlestickSeries, {
      upColor: pal.up,
      downColor: pal.down,
      wickUpColor: pal.up,
      wickDownColor: pal.down,
      borderVisible: false,
      priceLineVisible: false,
      // C11/CHART-12 — the filled last-value badge collides with the newest candles and duplicates
      // the price already in the sheet header. TV's sheet has none. Default embeds keep it.
      lastValueVisible: !clean,
      priceFormat: { type: "price", precision: 2, minMove: 0.01 },
    });
    candle.setData(bars.map((b) => ({ time: b.time as Time, open: b.open, high: b.high, low: b.low, close: b.close })));
    candleRef.current = candle;

    if (clean) {
      // TV's dashed prior-session-close rule (spec §2B). No axis label and no title — with C11
      // the clean price scale carries no floating tag at all, only its tick labels.
      const prev = state.quote.prev;
      if (prev != null && Number.isFinite(prev)) {
        try {
          candle.createPriceLine({
            price: prev,
            color: CLEAN.priorClose,
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            lineVisible: true,
            axisLabelVisible: false,
            title: "",
          });
        } catch {}
      }
    } else {
      // Volume histogram in its own overscaled band along the base (own price scale id).
      const vol = chart.addSeries(HistogramSeries, {
        priceFormat: { type: "volume" },
        priceScaleId: "vol",
        priceLineVisible: false,
        lastValueVisible: false,
      });
      try {
        chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      } catch {}
      vol.setData(bars.map((b) => ({ time: b.time as Time, value: b.volume, color: b.close >= b.open ? pal.volUp : pal.volDown })));
      volRef.current = vol;

      // SMA overlays (muted, thin) — created once; visibility toggled by a later effect.
      const s50 = chart.addSeries(LineSeries, {
        color: pal.sma50,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      s50.setData(sma(bars, 50) as { time: Time; value: number }[]);
      sma50Ref.current = s50;

      const s200 = chart.addSeries(LineSeries, {
        color: pal.sma200,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      s200.setData(sma(bars, 200) as { time: Time; value: number }[]);
      sma200Ref.current = s200;
    }

    // ── C11 test hook (dev/e2e only) ───────────────────────────────────────────
    // Candle colours, gridline visibility and the last-value badge are all canvas-drawn, so the
    // option layer is the only assertable surface for the clean-vs-default split.
    if (process.env.NODE_ENV !== "production") {
      (window as any).__mmEmbedOpts = () => {
        const o = chart.options() as any;
        const c = candle.options() as any;
        return {
          up: c.upColor, down: c.downColor, lastValueVisible: c.lastValueVisible,
          horzLines: o.grid?.horzLines?.visible ?? null, vertLines: o.grid?.vertLines?.visible ?? null,
        };
      };
    }

    // Crosshair → header OHLC readout. Off-chart move clears it (header falls back to day quote).
    const onCrosshair = (param: MouseEventParams) => {
      if (!param.time || !param.point) {
        setHover(null);
        return;
      }
      const d = param.seriesData.get(candle) as
        | { open: number; high: number; low: number; close: number }
        | undefined;
      if (!d) {
        setHover(null);
        return;
      }
      const timeStr = String(param.time);
      const match = barsRef.current.find((b) => b.time === timeStr);
      setHover({
        time: timeStr,
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
        volume: match ? match.volume : 0,
      });
    };
    chart.subscribeCrosshairMove(onCrosshair);

    return () => {
      chart.unsubscribeCrosshairMove(onCrosshair);
      if (process.env.NODE_ENV !== "production") { try { delete (window as any).__mmEmbedOpts; } catch {} }
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volRef.current = null;
      sma50Ref.current = null;
      sma200Ref.current = null;
    };
    // Rebuild only when the data identity or palette changes (theme/transparent). Range + SMA
    // toggles are applied imperatively below without a teardown.
  }, [state, pal, lang, clean]);

  // ── Apply the visible range (initial + chip changes) ──────────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || state.kind !== "ready") return;
    const vr = visibleRange(state.bars, range);
    if (!vr) return;
    try {
      chart.timeScale().setVisibleRange({ from: vr.from as Time, to: vr.to as Time });
    } catch {
      chart.timeScale().fitContent();
    }
  }, [range, state]);

  // ── Toggle SMA visibility without rebuilding ──────────────────────────────────
  useEffect(() => {
    sma50Ref.current?.applyOptions({ visible: sma50On });
  }, [sma50On]);
  useEffect(() => {
    sma200Ref.current?.applyOptions({ visible: sma200On });
  }, [sma200On]);

  // ── Render ────────────────────────────────────────────────────────────────────
  const terminalHref = `${TERMINAL_BASE}?sym=${encodeURIComponent(symbol)}&from=embed`;

  return (
    <div
      className="embed-root"
      lang={lang === "zh" ? "zh-CN" : "en"}
      data-theme={theme}
      data-transparent={transparent ? "1" : "0"}
      data-hdr={hideQuote ? "0" : undefined}
      data-clean={clean ? "1" : undefined}
    >
      <Header
        symbol={symbol}
        state={state}
        hover={hover}
        pal={pal}
        t={t}
        range={range}
        onRange={setRange}
        showFullscreen={fullscreenBtn}
        legend={
          // Clean mode is candles-only — no SMA series exist, so no legend to drive them.
          state.kind === "ready" && !clean ? (
            <Legend
              sma50On={sma50On}
              sma200On={sma200On}
              onToggle50={() => setSma50On((v) => !v)}
              onToggle200={() => setSma200On((v) => !v)}
              pal={pal}
              t={t}
            />
          ) : null
        }
      />

      <div className="embed-body">
        {state.kind === "loading" && <Skeleton pal={pal} />}

        {state.kind === "empty" && (
          <EmptyOrError
            kind="empty"
            symbol={symbol}
            terminalHref={terminalHref}
            pal={pal}
            t={t}
          />
        )}

        {/* The chart host is always mounted once ready; overlays sit above it. */}
        {state.kind === "ready" && (
          <>
            <div ref={hostRef} className="embed-chart-host" />
            <PriceRibbon dir={state.quote.dir} pal={pal} />
          </>
        )}

        {/* Attribution is always present (brand + funnel), quiet like TradingView's mark. */}
        <a className="embed-attr" href={terminalHref} target="_blank" rel="noopener noreferrer">
          {t("attribution")}
          <span aria-hidden="true" className="embed-attr-arrow">↗</span>
        </a>
      </div>

      <StyleTag pal={pal} />
    </div>
  );
}

// ── Header: ticker + day quote (or crosshair OHLC) + range chips ─────────────────
function Header({
  symbol,
  state,
  hover,
  pal,
  t,
  range,
  onRange,
  legend,
  showFullscreen,
}: {
  symbol: string;
  state: LoadState;
  hover: Bar | null;
  pal: EmbedPalette;
  t: ReturnType<typeof makeT>;
  range: RangeKey;
  onRange: (r: RangeKey) => void;
  legend?: React.ReactNode;
  /** fs=1 — render the native fullscreen affordance at the right end of the range row. */
  showFullscreen?: boolean;
}) {
  const quote = state.kind === "ready" ? state.quote : null;
  // When hovering the chart, the header becomes an OHLC status line (house pattern).
  const showOhlc = hover != null && quote != null;

  return (
    <header className="embed-header">
      <div className="embed-head-quote">
        <span className="embed-ticker">{symbol}</span>
        {showOhlc ? (
          <span className="embed-ohlc num">
            <Ohlc label={t("o")} v={hover!.open} pal={pal} ref0={hover!.open} close={hover!.close} />
            <Ohlc label={t("h")} v={hover!.high} pal={pal} ref0={hover!.open} close={hover!.close} />
            <Ohlc label={t("l")} v={hover!.low} pal={pal} ref0={hover!.open} close={hover!.close} />
            <Ohlc label={t("c")} v={hover!.close} pal={pal} ref0={hover!.open} close={hover!.close} />
            <span className="embed-ohlc-vol">{t("volume")} {fmtVolume(hover!.volume)}</span>
          </span>
        ) : quote ? (
          <span className="embed-day num">
            <span className="embed-last">{fmtPrice(quote.last)}</span>
            {quote.change != null && quote.changePct != null ? (
              <span
                className="embed-chg"
                style={{ color: quote.dir === "up" ? pal.up : quote.dir === "down" ? pal.down : pal.muted }}
              >
                {fmtChange(quote.change)} <span className="embed-chg-pct">({fmtPct(quote.changePct)})</span>
              </span>
            ) : null}
          </span>
        ) : (
          <span className="embed-day num embed-day-skel" aria-hidden="true">
            <span className="embed-skel-pill" />
          </span>
        )}
      </div>

      <div className="embed-head-right">
      {legend}
      <nav className="embed-ranges" aria-label={t("rangePrefix")}>
        {RANGE_KEYS.map((rk) => (
          <button
            key={rk}
            type="button"
            className={"embed-chip" + (rk === range ? " is-active" : "")}
            aria-pressed={rk === range}
            onClick={() => onRange(rk)}
          >
            {rk}
          </button>
        ))}
        {showFullscreen && (
          /* TV's ⤢ — four corner strokes in a ~34px square at the right end of the range row.
             Tapping asks the native host to open the full chart; a browser gets a no-op. */
          <button
            type="button"
            className="embed-fs"
            aria-label={t("fullscreen")}
            title={t("fullscreen")}
            onClick={postOpenFullChart}
          >
            <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
              <path
                d="M2.6 6.4V2.6h3.8M11.6 2.6h3.8v3.8M15.4 11.6v3.8h-3.8M6.4 15.4H2.6v-3.8"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
      </nav>
      </div>
    </header>
  );
}

// One OHLC cell — the value is colored by whether that bar closed up vs open (house convention).
function Ohlc({
  label,
  v,
  pal,
  ref0,
  close,
}: {
  label: string;
  v: number;
  pal: EmbedPalette;
  ref0: number;
  close: number;
}) {
  const col = close >= ref0 ? pal.up : pal.down;
  return (
    <span className="embed-ohlc-cell">
      <span className="embed-ohlc-k" style={{ color: pal.textDim }}>{label}</span>
      <span style={{ color: col }}>{fmtPrice(v)}</span>
    </span>
  );
}

// ── Signature: the day-direction price ribbon (single left→right draw-in sweep) ──
function PriceRibbon({ dir, pal }: { dir: Quote["dir"]; pal: EmbedPalette }) {
  const color = dir === "up" ? pal.up : dir === "down" ? pal.down : pal.muted;
  const reduced = prefersReducedMotion();
  return (
    <div
      className={"embed-ribbon" + (reduced ? " no-anim" : "")}
      style={{ ["--ribbon-color" as string]: color }}
      aria-hidden="true"
    />
  );
}

// ── Legend: SMA toggles, whisper-quiet, bottom-left ──────────────────────────────
function Legend({
  sma50On,
  sma200On,
  onToggle50,
  onToggle200,
  pal,
  t,
}: {
  sma50On: boolean;
  sma200On: boolean;
  onToggle50: () => void;
  onToggle200: () => void;
  pal: EmbedPalette;
  t: ReturnType<typeof makeT>;
}) {
  return (
    <div className="embed-legend">
      <button
        type="button"
        className={"embed-leg" + (sma50On ? "" : " is-off")}
        onClick={onToggle50}
        aria-pressed={sma50On}
        aria-label={t("toggleSma50")}
      >
        <span className="embed-leg-dot" style={{ background: pal.sma50 }} />
        <span>{t("sma")} 50</span>
      </button>
      <button
        type="button"
        className={"embed-leg" + (sma200On ? "" : " is-off")}
        onClick={onToggle200}
        aria-pressed={sma200On}
        aria-label={t("toggleSma200")}
      >
        <span className="embed-leg-dot" style={{ background: pal.sma200 }} />
        <span>{t("sma")} 200</span>
      </button>
    </div>
  );
}

// ── Loading skeleton (subtle shimmer; reduced-motion → static) ───────────────────
function Skeleton({ pal }: { pal: EmbedPalette }) {
  const reduced = prefersReducedMotion();
  // A few faux candles + a baseline volume band so the shape reads before data lands.
  const heights = [42, 58, 50, 66, 48, 72, 60, 54, 68, 46, 62, 56, 70, 52, 64];
  return (
    <div className={"embed-skel" + (reduced ? " no-anim" : "")} aria-hidden="true">
      <div className="embed-skel-candles">
        {heights.map((h, i) => (
          <span key={i} className="embed-skel-candle" style={{ height: `${h}%` }} />
        ))}
      </div>
      <div className="embed-skel-shimmer" style={{ background: `linear-gradient(90deg, transparent, ${pal.skelHi}, transparent)` }} />
    </div>
  );
}

// ── Empty / error state (plain-word stance + the Terminal link as the action) ────
function EmptyOrError({
  kind,
  symbol,
  terminalHref,
  pal,
  t,
}: {
  kind: "empty" | "error";
  symbol: string | null;
  terminalHref: string;
  pal: EmbedPalette;
  t: ReturnType<typeof makeT>;
}) {
  const title = kind === "empty" ? t("emptyTitle") : t("errorTitle");
  const body = kind === "empty" ? t("emptyBody", { sym: symbol ?? "" }) : t("errorBody");
  return (
    <div className="embed-empty">
      <svg className="embed-empty-glyph" viewBox="0 0 48 32" width="48" height="32" aria-hidden="true">
        <path
          d="M2 26 L12 18 L20 22 L30 8 L38 14 L46 6"
          fill="none"
          stroke={pal.textDim}
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.55"
        />
      </svg>
      <div className="embed-empty-title">{title}</div>
      <div className="embed-empty-body">{body}</div>
      {kind === "empty" && symbol ? (
        <a className="embed-empty-link" href={terminalHref} target="_blank" rel="noopener noreferrer" style={{ color: pal.brand }}>
          {t("openTerminal")} <span aria-hidden="true">↗</span>
        </a>
      ) : null}
    </div>
  );
}

// Exported so the page can render the pure error state (invalid/missing symbol) without a chart.
export function EmbedError({ theme, lang, transparent }: { theme: ThemeName; lang: Lang; transparent: boolean }) {
  const pal = palette(theme, transparent);
  const t = makeT(lang);
  useTransparentRoot(transparent);
  return (
    <div className="embed-root" lang={lang === "zh" ? "zh-CN" : "en"} data-theme={theme} data-transparent={transparent ? "1" : "0"}>
      <div className="embed-body embed-body-solo">
        <EmptyOrError kind="error" symbol={null} terminalHref={TERMINAL_BASE} pal={pal} t={t} />
      </div>
      <StyleTag pal={pal} />
    </div>
  );
}

// ── Scoped styles (component-owned; palette drives every color via CSS custom props) ──
function StyleTag({ pal }: { pal: EmbedPalette }) {
  const css = `
  .embed-root{
    --e-page:${pal.pageBg}; --e-text:${pal.text}; --e-dim:${pal.textDim}; --e-muted:${pal.muted};
    --e-chip:${pal.chipBg}; --e-chip-active:${pal.chipActiveBg}; --e-chip-border:${pal.chipBorder};
    --e-up:${pal.up}; --e-down:${pal.down}; --e-brand:${pal.brand}; --e-skel-base:${pal.skelBase};
    position:fixed; inset:0; display:flex; flex-direction:column; background:var(--e-page);
    color:var(--e-text); overflow:hidden;
    font-family:var(--font-inter),-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
    -webkit-font-smoothing:antialiased; letter-spacing:.005em;
  }
  .embed-root .num{font-family:var(--font-inter),-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-variant-numeric:tabular-nums;font-feature-settings:"tnum" 1;}
  .embed-root *{box-sizing:border-box;}

  /* Header — one compact line, wraps to two on narrow phones. */
  .embed-header{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;
    padding:8px 12px 7px;min-height:38px;}
  .embed-head-quote{display:flex;align-items:baseline;gap:10px;min-width:0;flex:1 1 auto;}
  .embed-root[data-hdr="0"] .embed-head-quote{display:none;}
  .embed-ticker{font-weight:700;font-size:15px;letter-spacing:.02em;color:var(--e-text);flex:none;}
  .embed-day{display:inline-flex;align-items:baseline;gap:8px;min-width:0;}
  .embed-last{font-weight:600;font-size:15px;color:var(--e-text);}
  .embed-chg{font-weight:600;font-size:12.5px;white-space:nowrap;}
  .embed-chg-pct{opacity:.92;}
  .embed-day-skel{min-height:16px;}
  .embed-skel-pill{display:inline-block;width:118px;height:13px;border-radius:4px;background:var(--e-skel-base);}

  /* Crosshair OHLC status line (replaces the day quote on hover). */
  .embed-ohlc{display:inline-flex;align-items:baseline;gap:9px;font-size:11.5px;flex-wrap:wrap;}
  .embed-ohlc-cell{display:inline-flex;align-items:baseline;gap:3px;}
  .embed-ohlc-k{font-size:9.5px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;}
  .embed-ohlc-vol{color:var(--e-muted);font-size:10.5px;}

  /* Range chips. */
  .embed-ranges{display:flex;align-items:center;gap:3px;flex:none;overflow-x:auto;scrollbar-width:none;max-width:100%;}
  .embed-ranges::-webkit-scrollbar{display:none;}
  .embed-chip{flex:none;padding:3px 8px;border-radius:5px;font-size:11px;font-weight:600;letter-spacing:.02em;
    color:var(--e-muted);background:transparent;border:1px solid transparent;cursor:pointer;
    transition:background 120ms cubic-bezier(.4,0,.2,1),color 120ms cubic-bezier(.4,0,.2,1),border-color 120ms;}
  .embed-chip:hover{color:var(--e-text);background:var(--e-chip);}
  .embed-chip.is-active{color:var(--e-text);background:var(--e-chip-active);border-color:var(--e-chip-border);}
  .embed-chip:focus-visible{outline:2px solid var(--e-brand);outline-offset:1px;}

  /* Body + chart host. */
  .embed-body{position:relative;flex:1 1 auto;min-height:0;}
  .embed-body-solo{display:grid;place-items:center;}
  .embed-chart-host{position:absolute;inset:0;}

  /* Signature — day-direction ribbon just under the header, single draw-in sweep. */
  .embed-ribbon{position:absolute;top:0;left:0;right:0;height:2px;pointer-events:none;z-index:6;
    background:linear-gradient(90deg,var(--ribbon-color) 0%,color-mix(in srgb,var(--ribbon-color) 45%,transparent) 55%,transparent 100%);
    transform-origin:left center;animation:embedRibbon 640ms cubic-bezier(.22,1,.36,1) both;}
  .embed-ribbon.no-anim{animation:none;}
  @keyframes embedRibbon{from{transform:scaleX(0);opacity:.2;}to{transform:scaleX(1);opacity:1;}}

  /* Legend — quiet, bottom-left, floated ABOVE the LWC time-axis strip (~22px) so it never
     collides with the date labels the chart canvas paints along the bottom edge. */
  .embed-head-right{display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:flex-end;}
  .embed-legend{display:flex;gap:7px;}
  .embed-leg{display:inline-flex;align-items:center;gap:5px;padding:2px 6px;border-radius:5px;
    font-size:10.5px;font-weight:600;letter-spacing:.02em;color:var(--e-muted);
    background:color-mix(in srgb,var(--e-page) 62%,transparent);border:1px solid transparent;cursor:pointer;
    transition:color 120ms,background 120ms,opacity 120ms;}
  .embed-leg:hover{color:var(--e-text);}
  .embed-leg.is-off{opacity:.4;}
  .embed-leg.is-off .embed-leg-dot{opacity:.5;}
  .embed-leg:focus-visible{outline:2px solid var(--e-brand);outline-offset:1px;}
  .embed-leg-dot{width:12px;height:2.5px;border-radius:2px;flex:none;}

  /* Attribution — bottom-right, whisper-quiet, floated above the time-axis strip, brightens on hover. */
  .embed-attr{position:absolute;left:10px;bottom:6px;z-index:7;display:inline-flex;align-items:center;gap:3px;
    padding:2px 5px;border-radius:5px;font-size:10px;font-weight:600;letter-spacing:.03em;
    color:var(--e-dim);background:color-mix(in srgb,var(--e-page) 55%,transparent);
    transition:color 120ms cubic-bezier(.4,0,.2,1);}
  .embed-attr:hover{color:var(--e-text);}
  .embed-attr-arrow{font-size:9px;opacity:.85;}
  .embed-attr:focus-visible{outline:2px solid var(--e-brand);outline-offset:1px;}

  /* Skeleton. */
  .embed-skel{position:absolute;inset:0;overflow:hidden;}
  .embed-skel-candles{position:absolute;inset:0;display:flex;align-items:flex-end;justify-content:space-around;
    gap:2%;padding:14% 8% 20%;}
  .embed-skel-candle{width:3.2%;border-radius:2px;background:var(--e-skel-base);}
  .embed-skel-shimmer{position:absolute;inset:0;transform:translateX(-100%);animation:embedShimmer 1.35s ease-in-out infinite;}
  .embed-skel.no-anim .embed-skel-shimmer{display:none;}
  @keyframes embedShimmer{100%{transform:translateX(100%);}}

  /* Empty / error. */
  .embed-empty{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;
    gap:6px;text-align:center;padding:16px;}
  .embed-body-solo .embed-empty{position:static;}
  .embed-empty-glyph{margin-bottom:2px;}
  .embed-empty-title{font-weight:600;font-size:13.5px;color:var(--e-text);}
  .embed-empty-body{font-size:12px;color:var(--e-muted);max-width:280px;line-height:1.5;}
  .embed-empty-link{margin-top:6px;font-size:12px;font-weight:600;}
  .embed-empty-link:hover{text-decoration:underline;}

  /* ── clean=1 — TV symbol-sheet mini chart (docs/tv-parity/spec-symbol-detail.md §2B) ──
     Everything below is scoped to [data-clean="1"]; the default widget is untouched. */
  /* TV parks the range row at the BOTTOM of the symbol-sheet chart so a thumb never has to
     travel to the top of the widget. .embed-root is already flex-direction:column, so the row
     moves by flipping flex ORDER — the DOM stays put (header still owns the quote line, and
     the tab/reading order is unchanged for assistive tech, which reads it as the widget's
     footer controls). .embed-body keeps flex:1 1 auto, so the absolute-inset chart host still
     sizes to whatever height is left over. Full-bleed row: the chips' own 12px padding is the
     only inset, and the ⤢ square keeps its margin-left:auto right-end anchor. */
  .embed-root[data-clean="1"] .embed-body{order:1;}
  .embed-root[data-clean="1"] .embed-header{order:2;padding:2px 0 8px;min-height:0;}
  /* clean+hdr=1: the header is now the widget's FOOTER, so the quote line needs the inset back
     (the chips carry their own capsule padding; the quote text has none). */
  .embed-root[data-clean="1"] .embed-head-quote{padding:0 12px;}
  /* TV's mini chart carries no brand accent and no attribution (the app IS the brand,
     and the attribution collides with the time-axis labels at 300pt heights). */
  .embed-root[data-clean="1"] .embed-ribbon,
  .embed-root[data-clean="1"] .embed-attr{display:none;}
  /* flex-basis:100% ⇒ the chips always own a full row (the header is flex-wrap:wrap), so
     clean+hdr=1 puts them under the quote instead of fighting it for the same line. */
  .embed-root[data-clean="1"] .embed-head-right{flex:1 1 100%;justify-content:flex-start;gap:0;}
  .embed-root[data-clean="1"] .embed-ranges{width:100%;gap:4px;align-items:center;}
  /* TV capsules: Semibold 13.5px, selected #2E2E2E on #DBDBDB, unselected transparent on #8C8C8C. */
  .embed-root[data-clean="1"] .embed-chip{
    padding:6px 12px;border-radius:999px;border:0;background:transparent;
    font-size:13.5px;font-weight:600;letter-spacing:.01em;color:#8c8c8c;}
  .embed-root[data-clean="1"] .embed-chip:hover{background:transparent;color:#dbdbdb;}
  .embed-root[data-clean="1"] .embed-chip.is-active,
  .embed-root[data-clean="1"] .embed-chip.is-active:hover{background:#2e2e2e;color:#dbdbdb;border:0;}
  /* fs=1 — the ⤢ corner-bracket square, pinned to the right end of the range row. */
  .embed-fs{flex:none;margin-left:auto;width:34px;height:34px;display:inline-flex;align-items:center;
    justify-content:center;border-radius:8px;background:transparent;border:0;color:#8c8c8c;cursor:pointer;
    transition:color 120ms cubic-bezier(.4,0,.2,1),background 120ms cubic-bezier(.4,0,.2,1);}
  .embed-fs:hover{color:#dbdbdb;}
  .embed-fs:focus-visible{outline:2px solid var(--e-brand);outline-offset:1px;}

  /* Narrow phones (~360px): header stacks, keep everything inside the frame. */
  @media (max-width:430px){
    .embed-header{padding:7px 10px 6px;gap:6px;}
    .embed-ticker{font-size:14px;}
    .embed-last{font-size:14px;}
    .embed-ranges{width:100%;order:3;}
    .embed-ohlc{font-size:10.5px;gap:7px;}
  }
  @media (prefers-reduced-motion:reduce){
    .embed-ribbon{animation:none;}
    .embed-skel-shimmer{display:none;}
  }
  `;
  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}
