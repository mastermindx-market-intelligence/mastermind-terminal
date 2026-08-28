"use client";
import { useEffect, useRef, useState } from "react";
import { type IChartApi, PriceScaleMode } from "lightweight-charts";
import { DEFAULT_CHART_RIGHT_OFFSET, withChartFutureOffset } from "@/lib/chart-engine/viewReset";
import { isIntradayTf } from "@/lib/intradaySources";
import { useT } from "@/lib/i18n";

// Chart scale/display settings persisted alongside user prefs (key: mm.chartSettings).
export type ChartSettings = {
  // Scales and lines
  mode: PriceScaleMode;        // Normal=0, Log=1, Percent=2, IndexedTo100=3
  invertScale: boolean;
  scaleLeft: boolean;          // move price scale to left
  autoScale: boolean;
  priceLineVisible: boolean;
  lastValueVisible: boolean;
  gridHVisible: boolean;       // horizontal grid lines
  gridVVisible: boolean;       // vertical grid lines
  crosshairMode: number;       // 0=Normal, 1=Magnet (reserved for crosshair API)
  scaleMarginsTop: number;
  scaleMarginsBottom: number;
  rightOffsetBars: number;
  scaleTextColor: string;
  scaleFontSize: number;
  scaleLineColor: string;
  countdownVisible: boolean;
  hourFormat: "12" | "24";
  // Symbol (candle body/wick/border colors)
  candleBodyVisible: boolean;
  candleBordersVisible: boolean;
  candleWicksVisible: boolean;
  colorBarsPrevClose: boolean;
  candleUpColor: string;
  candleDownColor: string;
  candleUpBorder: string;
  candleDownBorder: string;
  candleUpWick: string;
  candleDownWick: string;
  precision: "auto" | "2" | "3" | "4";
  // Status line
  showLogo: boolean;
  showOHLC: boolean;           // status line bar change display
  showBarChange: boolean;      // show % change on status line
  showSymbolName: boolean;     // show symbol name on status line
  titleMode: "ticker" | "name" | "both";
  showVolume: boolean;
  showLastDayChange: boolean;
  showIndicatorTitles: boolean;
  indicatorBackgroundOpacity: number;
  // Canvas
  showWatermark: boolean;
  backgroundType: "solid" | "gradient";
  backgroundTop: string;
  backgroundBottom: string;
  gridHColor: string;
  gridVColor: string;
  paneSeparatorColor: string;
  crosshairColor: string;
  watermarkColor: string;
  paneButtons: "always" | "hover" | "never";
  // Extended hours (intraday only)
  extHours: boolean;
  extendedLineVisible: boolean;
  preMarketColor: string;
  postMarketColor: string;
  overnightColor: string;
};
export const DEFAULT_CHART_SETTINGS: ChartSettings = {
  mode: PriceScaleMode.Normal,
  invertScale: false,
  scaleLeft: false,
  autoScale: true,
  priceLineVisible: true,
  lastValueVisible: true,
  gridHVisible: true,
  gridVVisible: true,
  crosshairMode: 0,
  scaleMarginsTop: 10,
  scaleMarginsBottom: 8,
  rightOffsetBars: DEFAULT_CHART_RIGHT_OFFSET,
  scaleTextColor: "",
  scaleFontSize: 12,
  scaleLineColor: "",
  countdownVisible: true,
  hourFormat: "24",
  // Empty strings = "use CSS theme tokens (--up/--down)". Non-empty = user-overridden hex.
  // Effect 7 only applies candle colors when truthy, so the up/down flip in Effect 5 is never
  // clobbered by a settings-load on mount.
  candleBodyVisible: true,
  candleBordersVisible: true,
  candleWicksVisible: true,
  colorBarsPrevClose: false,
  candleUpColor: "",
  candleDownColor: "",
  candleUpBorder: "",
  candleDownBorder: "",
  candleUpWick: "",
  candleDownWick: "",
  precision: "auto",
  showLogo: true,
  showOHLC: true,
  showBarChange: true,
  showSymbolName: true,
  titleMode: "name",
  showVolume: false,
  showLastDayChange: false,
  showIndicatorTitles: true,
  indicatorBackgroundOpacity: 70,
  showWatermark: true,
  backgroundType: "solid",
  backgroundTop: "",
  backgroundBottom: "",
  gridHColor: "",
  gridVColor: "",
  paneSeparatorColor: "",
  crosshairColor: "",
  watermarkColor: "",
  paneButtons: "hover",
  extHours: false,
  extendedLineVisible: true,
  preMarketColor: "#ff9800",
  postMarketColor: "#2962ff",
  overnightColor: "#9c27b0",
};

// Range presets — the button click scrolls the chart time axis to show this window.
export type RangeKey = "1D" | "5D" | "1M" | "3M" | "6M" | "YTD" | "1Y" | "5Y" | "All";
const RANGE_KEYS: RangeKey[] = ["1D", "5D", "1M", "3M", "6M", "YTD", "1Y", "5Y", "All"];

// Date arithmetic helpers — ISO yyyy-mm-dd string manipulation.
function isoDate(d: Date): string { return d.toISOString().slice(0, 10); }
function addDays(base: Date, n: number): Date { const d = new Date(base); d.setDate(d.getDate() + n); return d; }
function addMonths(base: Date, n: number): Date { const d = new Date(base); d.setMonth(d.getMonth() + n); return d; }
function addYears(base: Date, n: number): Date { const d = new Date(base); d.setFullYear(d.getFullYear() + n); return d; }

// Navigate the chart to a given range key using the lightweight-charts time scale API.
// Every preset keeps the future gutter: setVisibleRange/setVisibleLogicalRange are
// EXPLICIT bounds and ignore timeScale.rightOffset, so a preset that ended at the
// newest candle pinned it to the right edge with nothing to draw into.
function applyRange(
  key: RangeKey,
  chartApi: IChartApi,
  isIntraday: boolean,
  rightOffsetBars = DEFAULT_CHART_RIGHT_OFFSET,
): void {
  const ts = chartApi.timeScale();
  const gutter = Number.isFinite(rightOffsetBars) ? Math.max(0, rightOffsetBars) : DEFAULT_CHART_RIGHT_OFFSET;
  try {
    // "All" fits every time point, which now includes the future gutter — that
    // blank tail is bounded against the loaded history, so it stays a gutter.
    if (key === "All") { ts.fitContent(); return; }
    const now = new Date();
    // For intraday charts: use logical range (bar counts approximate; intraday has hundreds of bars/day).
    // For daily charts: use the "from/to" date-string setVisibleRange API.
    if (isIntraday) {
      // approximate bar counts for intraday: 390 bars/day for 1m US equity
      const barsPerDay = 390;
      // Re-anchor at the newest bar even when the user had panned away, then let
      // the configured rightOffset supply the future-time gutter.
      ts.applyOptions({ rightOffset: gutter });
      ts.scrollToRealTime();
      const logRange = ts.getVisibleLogicalRange();
      const to = (logRange?.to ?? 0) as number;
      const barCount = key === "1D" ? barsPerDay : key === "5D" ? barsPerDay * 5 : barsPerDay * 20;
      ts.setVisibleLogicalRange({ from: to - barCount, to });
    } else {
      let fromDate: Date;
      switch (key) {
        case "1D": fromDate = addDays(now, -1); break;
        case "5D": fromDate = addDays(now, -5); break;
        case "1M": fromDate = addMonths(now, -1); break;
        case "3M": fromDate = addMonths(now, -3); break;
        case "6M": fromDate = addMonths(now, -6); break;
        case "YTD": fromDate = new Date(now.getFullYear(), 0, 1); break;
        case "1Y": fromDate = addYears(now, -1); break;
        case "5Y": fromDate = addYears(now, -5); break;
        default: return;
      }
      ts.setVisibleRange({ from: isoDate(fromDate) as any, to: isoDate(now) as any });
      const range = withChartFutureOffset(ts.getVisibleLogicalRange(), gutter);
      if (range) ts.setVisibleLogicalRange(range);
    }
  } catch {}
}

// Derive the UTC timezone offset label, e.g. "UTC+5:30" or "UTC-8".
function utcOffsetLabel(): string {
  const off = -new Date().getTimezoneOffset(); // minutes
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `UTC${sign}${h}${m ? ":" + String(m).padStart(2, "0") : ""}`;
}

function fmtHHMMSS(d: Date): string {
  return (
    String(d.getHours()).padStart(2, "0") + ":" +
    String(d.getMinutes()).padStart(2, "0") + ":" +
    String(d.getSeconds()).padStart(2, "0")
  );
}

type SubMenu = "labels" | "lines" | null;

export default function ChartFrameBar({
  timeframe,
  chartApi,
  settings,
  onSettings,
  onOpenSettingsModal,
  extendedEligible = false,
}: {
  timeframe: string;
  chartApi: IChartApi | null;
  settings: ChartSettings;
  onSettings: (patch: Partial<ChartSettings>) => void;
  onOpenSettingsModal?: (tab?: string) => void;
  extendedEligible?: boolean;
}) {
  const t = useT();
  // Client-only clock: render nothing until mounted to avoid SSR/hydration mismatch.
  // The server renders at server-local time; the client's timezone may differ completely.
  const [mounted, setMounted] = useState(false);
  const [clock, setClock] = useState("");
  const [tzLabel, setTzLabel] = useState("");
  const [gearOpen, setGearOpen] = useState(false);
  const [subMenu, setSubMenu] = useState<SubMenu>(null);
  const [gotoOpen, setGotoOpen] = useState(false);
  const [gotoDate, setGotoDate] = useState("");
  const gearRef = useRef<HTMLDivElement>(null);
  const gotoRef = useRef<HTMLInputElement>(null);
  // C8/CHART-08b — the native shell swaps the settings glyph for TV's hexagon nut. Read after mount
  // (the marker is stamped pre-paint on <html>, but this component is SSR'd) so the server output —
  // and therefore the whole browser web render — stays byte-identical under L2.
  const [shellMode, setShellMode] = useState(false);

  const isIntraday = isIntradayTf(timeframe);

  // Client-only mount gate: set initial clock + tz label, then tick every second.
  // Nothing is rendered until mounted=true, preventing SSR time from leaking in.
  useEffect(() => {
    setClock(fmtHHMMSS(new Date()));
    setTzLabel(utcOffsetLabel());
    setMounted(true);
    setShellMode(document.documentElement.getAttribute("data-shell") === "app");
    const id = setInterval(() => {
      setClock(fmtHHMMSS(new Date()));
      setTzLabel(utcOffsetLabel());
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // Close gear popup when clicking outside
  useEffect(() => {
    if (!gearOpen) return;
    const h = (e: MouseEvent) => {
      if (gearRef.current && !gearRef.current.contains(e.target as Node)) {
        setGearOpen(false);
        setSubMenu(null);
      }
    };
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, [gearOpen]);

  // Keyboard shortcuts:
  //   ⌥I invert, ⌥P percent, ⌥L log (existing, unchanged),
  //   ←/→ pan (Shift = larger step), +/- zoom (TradingView-standard chart nav).
  // All guarded against typing contexts.
  useEffect(() => {
    // Pan/zoom the visible logical range. `frac` is signed for pan (fraction of visible
    // width to shift; +right/-left), and a magnitude for zoom around the range center.
    const panBy = (frac: number) => {
      if (!chartApi) return;
      try {
        const ts = chartApi.timeScale();
        const r = ts.getVisibleLogicalRange();
        if (!r) return;                         // null range → no-op (no data / not laid out)
        const w = r.to - r.from;
        const d = w * frac;
        ts.setVisibleLogicalRange({ from: r.from + d, to: r.to + d });
      } catch {}
    };
    const zoomBy = (factor: number) => {        // <1 zooms in, >1 zooms out; anchored on center
      if (!chartApi) return;
      try {
        const ts = chartApi.timeScale();
        const r = ts.getVisibleLogicalRange();
        if (!r) return;
        const mid = (r.from + r.to) / 2;
        const half = ((r.to - r.from) / 2) * factor;
        ts.setVisibleLogicalRange({ from: mid - half, to: mid + half });
      } catch {}
    };

    const h = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement | null;
      const tag = tgt?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.isComposing) return;
      if (tgt?.isContentEditable) return;

      // Existing ⌥-bindings (invert / percent / log) — unchanged.
      if (e.altKey) {
        if (e.key === "i" || e.key === "I") {
          e.preventDefault();
          onSettings({ invertScale: !settings.invertScale });
        } else if (e.key === "p" || e.key === "P") {
          e.preventDefault();
          onSettings({ mode: settings.mode === PriceScaleMode.Percentage ? PriceScaleMode.Normal : PriceScaleMode.Percentage });
        } else if (e.key === "l" || e.key === "L") {
          e.preventDefault();
          onSettings({ mode: settings.mode === PriceScaleMode.Logarithmic ? PriceScaleMode.Normal : PriceScaleMode.Logarithmic });
        }
        return;
      }

      // Chart-nav keys: reject ctrl/meta/alt combos so ⌥-bindings + browser shortcuts stay
      // untouched (Shift is the only permitted modifier, and only for the arrows).
      if (e.ctrlKey || e.metaKey) return;

      // Yield to focused controls / open modals so this window-level (bubble) listener does
      // not double-fire with element-scoped arrow handlers. WorkspaceTabs' roving-tab arrows
      // (its focused <button> is document.activeElement) and the tutorial coach dialog
      // (aria-modal) are the two real bubble collisions; both are covered here.
      const active = document.activeElement as HTMLElement | null;
      if (active && active !== document.body) {
        const atag = active.tagName;
        if (
          atag === "INPUT" || atag === "TEXTAREA" || atag === "SELECT" ||
          atag === "BUTTON" || atag === "A" ||
          active.isContentEditable ||
          active.closest('[aria-modal="true"], [role="tab"], [role="dialog"]')
        ) return;
      }

      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          panBy(e.shiftKey ? -0.5 : -0.1);   // toward the past
          break;
        case "ArrowRight":
          e.preventDefault();
          panBy(e.shiftKey ? 0.5 : 0.1);     // toward the future
          break;
        // Zoom: match on the produced character. On a US layout "+" is itself Shift+"=" and
        // "_" is Shift+"-", so Shift is intrinsic to these keys and must NOT be rejected here
        // (ctrl/meta/alt were already filtered above). "=" and "-" cover the unshifted keys.
        case "+":
        case "=":
          e.preventDefault();
          zoomBy(0.8);                       // shrink by 20% → zoom in
          break;
        case "-":
        case "_":
          e.preventDefault();
          zoomBy(1.25);                      // expand by 25% → zoom out
          break;
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [settings, onSettings, chartApi]);

  // Go-to-date: focus the input when it opens
  useEffect(() => {
    if (gotoOpen) setTimeout(() => gotoRef.current?.focus(), 50);
  }, [gotoOpen]);

  function applyGotoDate() {
    if (!chartApi || !gotoDate) return;
    try {
      const ts = chartApi.timeScale();
      const logRange = ts.getVisibleLogicalRange();
      const width = logRange ? logRange.to - logRange.from : 120;
      const coord = ts.timeToCoordinate(gotoDate as any);
      if (coord != null) {
        const bar = ts.coordinateToLogical(coord);
        if (bar != null) ts.setVisibleLogicalRange({ from: bar - width / 2, to: bar + width / 2 });
      } else {
        // date not visible — use setVisibleRange to scroll there
        const from = isoDate(addDays(new Date(gotoDate), -30));
        const to = isoDate(addDays(new Date(gotoDate), 30));
        ts.setVisibleRange({ from: from as any, to: to as any });
      }
    } catch {}
    setGotoOpen(false);
  }

  const s = settings;

  return (
    <div className="chart-frame-bar">
      {/* LEFT: range buttons + go-to-date */}
      <div className="cfb-left">
        {RANGE_KEYS.map((rk) => (
          <button
            key={rk}
            className="cfb-range"
            onClick={() => chartApi && applyRange(rk, chartApi, isIntraday, s.rightOffsetBars)}
          >{rk}</button>
        ))}
        <div style={{ position: "relative" }}>
          <button className="cfb-cal" title={t("gotoDate")} onClick={(e) => { e.stopPropagation(); setGotoOpen((o) => !o); }}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
              <rect x="1.5" y="2.5" width="13" height="12" rx="1.5" />
              <path d="M1.5 6h13M5 1.5v2M11 1.5v2" />
            </svg>
          </button>
          {gotoOpen && (
            <div className="cfb-goto-pop" onClick={(e) => e.stopPropagation()}>
              <input
                ref={gotoRef}
                type="date"
                className="cfb-date-input"
                value={gotoDate}
                onChange={(e) => setGotoDate(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") applyGotoDate(); if (e.key === "Escape") setGotoOpen(false); }}
              />
              <button className="cfb-goto-go" onClick={applyGotoDate}>{t("go")}</button>
            </div>
          )}
        </div>
      </div>

      {/* RIGHT: clock + ETH + ADJ + gear */}
      <div className="cfb-right">
        {mounted && (
          <span className="cfb-clock num">
            {clock} <span className="cfb-tz">{tzLabel}</span>
          </span>
        )}
        {/* ETH chip — active when on; muted+non-interactive on daily TFs (no tooltip per spec) */}
        <button
          className={`cfb-chip${s.extHours && extendedEligible ? " on" : ""}${!isIntraday || !extendedEligible ? " dis" : ""}`}
          disabled={!isIntraday || !extendedEligible}
          onClick={() => isIntraday && extendedEligible && onSettings({ extHours: !s.extHours })}
          title={isIntraday && extendedEligible ? (s.extHours ? t("ethOff") : t("ethOn")) : undefined}
          aria-label={t("cfbExtendedHours")}
        >ETH</button>
        {/* ADJ chip — always passive (display-only; we only serve adjusted data) */}
        <span className="cfb-chip cfb-chip-adj" title={t("adjTip")}>ADJ</span>
        {/* Gear: quick settings */}
        <div className="cfb-gear-host" ref={gearRef}>
          <button
            className={`cfb-gear${gearOpen ? " on" : ""}`}
            title={t("quickSettings")}
            onClick={(e) => { e.stopPropagation(); setGearOpen((o) => !o); if (gearOpen) setSubMenu(null); }}
          >
            {/* C8b — at the shell's 26×26 / 15px svg the eight straight radial strokes read as a
                brightness/sun icon, not settings. TV draws a hexagon nut. House-neutral, but gated
                on shellMode anyway so the web render stays byte-identical (L2). */}
            {shellMode ? (
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                <path d="M8 1.7 13.4 4.85v6.3L8 14.3 2.6 11.15v-6.3z" strokeLinejoin="round" />
                <circle cx="8" cy="8" r="2.1" />
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                <circle cx="8" cy="8" r="2.2" />
                <path d="M8 1.5v1.3M8 13.2v1.3M1.5 8h1.3M13.2 8h1.3M3.2 3.2l.9.9M11.9 11.9l.9.9M3.2 12.8l.9-.9M11.9 4.1l.9-.9" strokeLinecap="round" />
              </svg>
            )}
          </button>

          {gearOpen && (
            <div className="qsg-menu" onClick={(e) => e.stopPropagation()}>
              {/* Auto-scale: fits price data to the visible bar range.
                  lightweight-charts only exposes a boolean toggle — no ratio-lock API exists.
                  We expose a single honest "Auto-scale" checkbox; when unchecked the axis
                  keeps its last manual zoom (the only alternative the library supports). */}
              <div className={`qsg-item${s.autoScale ? " checked" : ""}`} onClick={() => {
                const next = !s.autoScale;
                onSettings({ autoScale: next });
                try { if (chartApi) chartApi.priceScale(s.scaleLeft ? "left" : "right").setAutoScale(next); } catch {}
              }}>
                <span className="qsg-check">{s.autoScale ? "✓" : ""}</span>
                <span className="qsg-lbl">{t("qsgAuto")}</span>
              </div>

              <div className="qsg-item qsg-disabled">
                <span className="qsg-check" />
                <span className="qsg-lbl">{t("qsgScaleChartOnly")}</span>
              </div>

              {/* Invert scale ⌥I */}
              <div className={`qsg-item${s.invertScale ? " checked" : ""}`} onClick={() => onSettings({ invertScale: !s.invertScale })}>
                <span className="qsg-check">{s.invertScale ? "✓" : ""}</span>
                <span className="qsg-lbl">{t("qsgInvert")}</span>
                <kbd className="qsg-kbd">⌥I</kbd>
              </div>

              <div className="qsg-sep" />

              {/* Scale mode radio group */}
              {([
                [PriceScaleMode.Normal, t("qsgRegular"), ""],
                [PriceScaleMode.Percentage, t("qsgPercent"), "⌥P"],
                [PriceScaleMode.IndexedTo100, t("qsgIndexed"), ""],
                [PriceScaleMode.Logarithmic, t("qsgLog"), "⌥L"],
              ] as [PriceScaleMode, string, string][]).map(([m, label, kbd]) => (
                <div key={m} className={`qsg-item qsg-radio${s.mode === m ? " checked" : ""}`} onClick={() => onSettings({ mode: m })}>
                  <span className="qsg-radio-dot">{s.mode === m ? "●" : "○"}</span>
                  <span className="qsg-lbl">{label}</span>
                  {kbd && <kbd className="qsg-kbd">{kbd}</kbd>}
                </div>
              ))}

              <div className="qsg-sep" />

              {/* Move scale to left */}
              <div className={`qsg-item${s.scaleLeft ? " checked" : ""}`} onClick={() => onSettings({ scaleLeft: !s.scaleLeft })}>
                <span className="qsg-check">{s.scaleLeft ? "✓" : ""}</span>
                <span className="qsg-lbl">{t("qsgScaleLeft")}</span>
              </div>

              <div className="qsg-sep" />

              {/* Labels submenu */}
              <div className="qsg-item qsg-has-sub" onClick={(e) => { e.stopPropagation(); setSubMenu(subMenu === "labels" ? null : "labels"); }}>
                <span className="qsg-check" />
                <span className="qsg-sub-trigger"><span className="qsg-lbl">{t("qsgLabels")}</span><svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M3 2l4 3-4 3" /></svg></span>
                {subMenu === "labels" && (
                  <div className="qsg-submenu" onClick={(e) => e.stopPropagation()}>
                    <div className={`qsg-item${s.lastValueVisible ? " checked" : ""}`} onClick={() => onSettings({ lastValueVisible: !s.lastValueVisible })}>
                      <span className="qsg-check">{s.lastValueVisible ? "✓" : ""}</span>
                      <span className="qsg-lbl">{t("qsgLastValueLabel")}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Lines submenu */}
              <div className="qsg-item qsg-has-sub" onClick={(e) => { e.stopPropagation(); setSubMenu(subMenu === "lines" ? null : "lines"); }}>
                <span className="qsg-check" />
                <span className="qsg-sub-trigger"><span className="qsg-lbl">{t("qsgLines")}</span><svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M3 2l4 3-4 3" /></svg></span>
                {subMenu === "lines" && (
                  <div className="qsg-submenu" onClick={(e) => e.stopPropagation()}>
                    <div className={`qsg-item${s.priceLineVisible ? " checked" : ""}`} onClick={() => onSettings({ priceLineVisible: !s.priceLineVisible })}>
                      <span className="qsg-check">{s.priceLineVisible ? "✓" : ""}</span>
                      <span className="qsg-lbl">{t("qsgPriceLine")}</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="qsg-sep" />

              {/* More settings — opens the full settings modal on the Scales and lines tab */}
              <div className="qsg-item" onClick={() => { setGearOpen(false); onOpenSettingsModal?.("scales"); }}>
                <span className="qsg-check" />
                <span className="qsg-lbl">{t("qsgMoreSettings")}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
