"use client";

import { useEffect, useRef, useState } from "react";
import { PriceScaleMode, type IChartApi } from "lightweight-charts";
import { DEFAULT_CHART_SETTINGS, type ChartSettings } from "@/components/ChartFrameBar";
import { visualText } from "@/lib/visualIntelligenceCopy";
import { useLang, useT } from "@/lib/i18n";

export type ChartSettingsTab = "symbol" | "status" | "scales" | "canvas";
type Patch = (patch: Partial<ChartSettings>) => void;

const TEMPLATE_KEY = "mm.chartSettingTemplates";

function cssToken(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function tabIcon(tab: ChartSettingsTab) {
  const paths: Record<ChartSettingsTab, React.ReactNode> = {
    symbol: <><path d="M7 2v4M7 10v4M5 6h4v4H5zM13 2v2M13 8v6M11 4h4v4h-4z" /></>,
    status: <><path d="M3 4h14M3 7h10M3 10h12M3 13h7" /></>,
    scales: <><path d="M4 3v12h12M2 5l2-2 2 2M14 13l2 2 2-2" /></>,
    canvas: <><path d="M4 13l8-8 3 3-8 8H4zM11 6l3 3" /></>,
  };
  return <svg className="sm-tab-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.35">{paths[tab]}</svg>;
}

export default function ChartSettingsModal({
  open,
  tab,
  settings,
  onSettings,
  onClose,
  chartApi,
  extendedEligible = false,
  intraday = false,
}: {
  open: boolean;
  tab: ChartSettingsTab;
  settings: ChartSettings;
  onSettings: Patch;
  onClose: () => void;
  chartApi?: IChartApi | null;
  extendedEligible?: boolean;
  intraday?: boolean;
}) {
  const t = useT();
  const backdropRef = useRef<HTMLDivElement>(null);
  const initialRef = useRef<ChartSettings>(settings);
  const wasOpenRef = useRef(false);
  const [templateNonce, setTemplateNonce] = useState(0);

  useEffect(() => {
    if (open && !wasOpenRef.current) initialRef.current = { ...settings };
    wasOpenRef.current = open;
  }, [open, settings]);

  function cancel() {
    onSettings({ ...initialRef.current });
    onClose();
  }

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => { if (event.key === "Escape") cancel(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // Capture the settings snapshot only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const tabs: { key: ChartSettingsTab; label: string }[] = [
    { key: "symbol", label: t("smTabSymbol") },
    { key: "status", label: t("smTabStatus") },
    { key: "scales", label: t("smTabScales") },
    { key: "canvas", label: t("smTabCanvas") },
  ];

  const templates = readTemplates();
  void templateNonce;

  function selectTemplate(value: string) {
    if (value === "__save") {
      const name = window.prompt(t("smTemplateName"));
      if (!name?.trim()) return;
      const next = { ...templates, [name.trim()]: settings };
      try { localStorage.setItem(TEMPLATE_KEY, JSON.stringify(next)); } catch {}
      setTemplateNonce((nonce) => nonce + 1);
      return;
    }
    if (value === "__default") onSettings({ ...DEFAULT_CHART_SETTINGS });
    else if (templates[value]) onSettings({ ...DEFAULT_CHART_SETTINGS, ...templates[value] });
  }

  function resetTab() {
    const defaults = DEFAULT_CHART_SETTINGS;
    const keys: Record<ChartSettingsTab, (keyof ChartSettings)[]> = {
      symbol: ["colorBarsPrevClose", "candleBodyVisible", "candleBordersVisible", "candleWicksVisible", "candleUpColor", "candleDownColor", "candleUpBorder", "candleDownBorder", "candleUpWick", "candleDownWick", "extHours", "precision"],
      status: ["showLogo", "showSymbolName", "titleMode", "showOHLC", "showBarChange", "showVolume", "showLastDayChange", "showIndicatorTitles", "indicatorBackgroundOpacity"],
      scales: ["mode", "invertScale", "scaleLeft", "autoScale", "lastValueVisible", "priceLineVisible", "countdownVisible", "extendedLineVisible", "preMarketColor", "postMarketColor", "overnightColor", "hourFormat"],
      canvas: ["visualContext", "visualRegime", "visualVolume", "visualLevels", "visualEvents", "showWatermark", "backgroundType", "backgroundTop", "backgroundBottom", "gridHVisible", "gridVVisible", "gridHColor", "gridVColor", "paneSeparatorColor", "crosshairColor", "watermarkColor", "scaleTextColor", "scaleFontSize", "scaleLineColor", "paneButtons", "scaleMarginsTop", "scaleMarginsBottom", "rightOffsetBars"],
    };
    onSettings(Object.fromEntries(keys[tab].map((key) => [key, defaults[key]])) as Partial<ChartSettings>);
  }

  return (
    <div className="sm-backdrop" ref={backdropRef} onMouseDown={(event) => { if (event.target === backdropRef.current) cancel(); }}>
      <div className="sm-modal" role="dialog" aria-modal="true" aria-label={t("smTitle")}>
        <div className="sm-header">
          <span className="sm-title">{t("smTitle")}</span>
          <button className="sm-close" onClick={cancel} aria-label={t("smClose")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <div className="sm-body">
          <nav className="sm-tabs" aria-label={t("smSections")}>
            {tabs.map(({ key, label }) => (
              <button
                key={key}
                className={`sm-tab${tab === key ? " on" : ""}`}
                onClick={() => window.dispatchEvent(new CustomEvent("mm:settings-tab", { detail: key }))}
              >
                {tabIcon(key)}<span>{label}</span>
              </button>
            ))}
          </nav>

          <main className="sm-content">
            {tab === "symbol" && <SymbolTab settings={settings} onSettings={onSettings} extendedEligible={extendedEligible} intraday={intraday} />}
            {tab === "status" && <StatusTab settings={settings} onSettings={onSettings} />}
            {tab === "scales" && <ScalesTab settings={settings} onSettings={onSettings} chartApi={chartApi} />}
            {tab === "canvas" && <CanvasTab settings={settings} onSettings={onSettings} />}
          </main>
        </div>

        <footer className="sm-footer">
          <div className="sm-template-wrap">
            <select className="sm-select sm-template" value="" onChange={(event) => { selectTemplate(event.target.value); event.currentTarget.value = ""; }}>
              <option value="">{t("smTemplate")}</option>
              <option value="__default">{t("smRestoreDefaults")}</option>
              {Object.keys(templates).sort().map((name) => <option key={name} value={name}>{name}</option>)}
              <option value="__save">{t("smSaveCurrent")}</option>
            </select>
            <button className="sm-reset" onClick={resetTab}>{t("smResetTabBtn")}</button>
          </div>
          <div className="sm-footer-actions">
            <button className="sm-cancel" onClick={cancel}>{t("smCancel")}</button>
            <button className="sm-ok" onClick={onClose}>{t("smOK")}</button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function readTemplates(): Record<string, ChartSettings> {
  try {
    const value = JSON.parse(localStorage.getItem(TEMPLATE_KEY) || "{}");
    return value && typeof value === "object" ? value : {};
  } catch { return {}; }
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="sm-section"><h3>{title}</h3>{children}</section>;
}

function CheckRow({ label, value, onChange, disabled = false, children }: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className={`sm-row${disabled ? " disabled" : ""}`}>
      <label className="sm-check-label">
        <input type="checkbox" checked={value} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
        <span>{label}</span>
      </label>
      {children && <div className="sm-row-control">{children}</div>}
    </div>
  );
}

function SelectRow({ label, value, onChange, options, disabled = false }: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  options: { value: string | number; label: string }[];
  disabled?: boolean;
}) {
  return (
    <div className={`sm-row${disabled ? " disabled" : ""}`}>
      <span className="sm-row-label">{label}</span>
      <select className="sm-select" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </div>
  );
}

function ColorControl({ value, fallback, onChange, title }: {
  value: string;
  fallback: string;
  onChange: (value: string) => void;
  title?: string;
}) {
  const shown = value || fallback;
  return (
    <label className="sm-color-wrap" title={title}>
      <span className="sm-color-swatch" style={{ background: shown }} />
      <input type="color" value={shown} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function ColorPair({ first, second, onFirst, onSecond }: {
  first: string;
  second: string;
  onFirst: (value: string) => void;
  onSecond: (value: string) => void;
}) {
  const t = useT();
  return <div className="sm-color-pair">
    <ColorControl value={first} fallback={cssToken("--up", "#26c281")} onChange={onFirst} title={t("smUpColor")} />
    <ColorControl value={second} fallback={cssToken("--down", "#f23645")} onChange={onSecond} title={t("smDownColor")} />
  </div>;
}

function NumberRow({ label, value, min, max, suffix, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return <div className="sm-row"><span className="sm-row-label">{label}</span><div className="sm-number-wrap">
    <input className="sm-number" type="number" value={value} min={min} max={max} onChange={(event) => onChange(Math.max(min, Math.min(max, Number(event.target.value))))} />
    {suffix && <span>{suffix}</span>}
  </div></div>;
}

function SymbolTab({ settings, onSettings, extendedEligible, intraday }: {
  settings: ChartSettings;
  onSettings: Patch;
  extendedEligible: boolean;
  intraday: boolean;
}) {
  const t = useT();
  const s = settings;
  return <div className="sm-section-list">
    <Section title={t("smCandles")}>
      <CheckRow label={t("smColorPrevClose")} value={s.colorBarsPrevClose} onChange={(value) => onSettings({ colorBarsPrevClose: value })} />
      <CheckRow label={t("smBody")} value={s.candleBodyVisible} onChange={(value) => onSettings({ candleBodyVisible: value })}>
        <ColorPair first={s.candleUpColor} second={s.candleDownColor} onFirst={(value) => onSettings({ candleUpColor: value })} onSecond={(value) => onSettings({ candleDownColor: value })} />
      </CheckRow>
      <CheckRow label={t("smBorders")} value={s.candleBordersVisible} onChange={(value) => onSettings({ candleBordersVisible: value })}>
        <ColorPair first={s.candleUpBorder} second={s.candleDownBorder} onFirst={(value) => onSettings({ candleUpBorder: value })} onSecond={(value) => onSettings({ candleDownBorder: value })} />
      </CheckRow>
      <CheckRow label={t("smWick")} value={s.candleWicksVisible} onChange={(value) => onSettings({ candleWicksVisible: value })}>
        <ColorPair first={s.candleUpWick} second={s.candleDownWick} onFirst={(value) => onSettings({ candleUpWick: value })} onSecond={(value) => onSettings({ candleDownWick: value })} />
      </CheckRow>
    </Section>
    <Section title={t("smDataMod")}>
      <SelectRow
        label={t("smSession")}
        value={extendedEligible && s.extHours ? "extended" : "regular"}
        disabled={!extendedEligible}
        onChange={(value) => onSettings({ extHours: extendedEligible && value === "extended" })}
        options={[{ value: "regular", label: t("smSessionRegular") }, { value: "extended", label: t("smSessionExtended") }]}
      />
      {!extendedEligible && <p className="sm-help">{t("smExtUsOnly")}</p>}
      {extendedEligible && !intraday && <p className="sm-help">{t("smExtIntradayOnly")}</p>}
      <SelectRow label={t("smPrecision")} value={s.precision} onChange={(value) => onSettings({ precision: value as ChartSettings["precision"] })}
        options={[{ value: "auto", label: t("smPrecDefault") }, { value: "2", label: "0.01" }, { value: "3", label: "0.001" }, { value: "4", label: "0.0001" }]} />
    </Section>
  </div>;
}

function StatusTab({ settings: s, onSettings }: { settings: ChartSettings; onSettings: Patch }) {
  const t = useT();
  return <div className="sm-section-list">
    <Section title={t("smInstrument")}>
      <CheckRow label={t("smLogo")} value={s.showLogo} onChange={(value) => onSettings({ showLogo: value })} />
      <CheckRow label={t("smTitleRow")} value={s.showSymbolName} onChange={(value) => onSettings({ showSymbolName: value })}>
        <select className="sm-select" value={s.titleMode} onChange={(event) => onSettings({ titleMode: event.target.value as ChartSettings["titleMode"] })}>
          <option value="ticker">{t("smTicker")}</option><option value="name">{t("smName")}</option><option value="both">{t("smNameTicker")}</option>
        </select>
      </CheckRow>
      <CheckRow label={t("smChartValues")} value={s.showOHLC} onChange={(value) => onSettings({ showOHLC: value })} />
      <CheckRow label={t("smBarChange")} value={s.showBarChange} onChange={(value) => onSettings({ showBarChange: value })} />
      <CheckRow label={t("smVolume")} value={s.showVolume} onChange={(value) => onSettings({ showVolume: value })} />
      <CheckRow label={t("smLastDayChange")} value={s.showLastDayChange} onChange={(value) => onSettings({ showLastDayChange: value })} />
    </Section>
    <Section title={t("smIndicators")}>
      <CheckRow label={t("smTitles")} value={s.showIndicatorTitles} onChange={(value) => onSettings({ showIndicatorTitles: value })} />
      <CheckRow label={t("smBackground")} value={s.indicatorBackgroundOpacity > 0} onChange={(value) => onSettings({ indicatorBackgroundOpacity: value ? 70 : 0 })}>
        <input className="sm-range" type="range" min="0" max="100" value={s.indicatorBackgroundOpacity} onChange={(event) => onSettings({ indicatorBackgroundOpacity: Number(event.target.value) })} />
      </CheckRow>
    </Section>
  </div>;
}

function ScalesTab({ settings: s, onSettings, chartApi }: { settings: ChartSettings; onSettings: Patch; chartApi?: IChartApi | null }) {
  function applyAuto(value: boolean) {
    onSettings({ autoScale: value });
    try { chartApi?.priceScale(s.scaleLeft ? "left" : "right").setAutoScale(value); } catch {}
  }
  const t = useT();
  return <div className="sm-section-list">
    <Section title={t("smPriceScale")}>
      <SelectRow label={t("smScaleMode")} value={s.mode} onChange={(value) => onSettings({ mode: Number(value) as PriceScaleMode })}
        options={[{ value: PriceScaleMode.Normal, label: t("qsgRegular") }, { value: PriceScaleMode.Percentage, label: t("qsgPercent") }, { value: PriceScaleMode.IndexedTo100, label: t("qsgIndexed") }, { value: PriceScaleMode.Logarithmic, label: t("qsgLog") }]} />
      <SelectRow label={t("smScalePlacement")} value={s.scaleLeft ? "left" : "right"} onChange={(value) => onSettings({ scaleLeft: value === "left" })}
        options={[{ value: "right", label: t("smPlacementRight") }, { value: "left", label: t("smPlacementLeft") }]} />
      <CheckRow label={t("smAutoScale")} value={s.autoScale} onChange={applyAuto} />
      <CheckRow label={t("smInvertScale")} value={s.invertScale} onChange={(value) => onSettings({ invertScale: value })} />
    </Section>
    <Section title={t("smPriceLabels")}>
      <CheckRow label={t("smCountdown")} value={s.countdownVisible} onChange={(value) => onSettings({ countdownVisible: value })} />
      <CheckRow label={t("smSymbolValueLine")} value={s.lastValueVisible && s.priceLineVisible}
        onChange={(value) => onSettings({ lastValueVisible: value, priceLineVisible: value })} />
      <CheckRow label={t("smPrePostOvernight")} value={s.extendedLineVisible} onChange={(value) => onSettings({ extendedLineVisible: value })}>
        <div className="sm-color-pair three">
          <ColorControl value={s.preMarketColor} fallback="#ff9800" onChange={(value) => onSettings({ preMarketColor: value })} title={t("smPreMarket")} />
          <ColorControl value={s.postMarketColor} fallback="#2962ff" onChange={(value) => onSettings({ postMarketColor: value })} title={t("smAfterHours")} />
          <ColorControl value={s.overnightColor} fallback="#9c27b0" onChange={(value) => onSettings({ overnightColor: value })} title={t("smOvernight")} />
        </div>
      </CheckRow>
    </Section>
    <Section title={t("smTimeScale")}>
      <SelectRow label={t("smHourFormat")} value={s.hourFormat} onChange={(value) => onSettings({ hourFormat: value as "12" | "24" })}
        options={[{ value: "24", label: t("smHour24") }, { value: "12", label: t("smHour12") }]} />
    </Section>
  </div>;
}

function CanvasTab({ settings: s, onSettings }: { settings: ChartSettings; onSettings: Patch }) {
  const t = useT();
  const { lang } = useLang();
  return <div className="sm-section-list">
    <Section title={visualText("title", lang)}>
      <CheckRow label={visualText("restore", lang)} value={s.visualContext} onChange={(visualContext) => onSettings({ visualContext })} />
      <CheckRow label={visualText("regimeToggle", lang)} value={s.visualRegime} disabled={!s.visualContext} onChange={(visualRegime) => onSettings({ visualRegime })} />
      <CheckRow label={visualText("volumeToggle", lang)} value={s.visualVolume} disabled={!s.visualContext} onChange={(visualVolume) => onSettings({ visualVolume })} />
      <CheckRow label={visualText("levelsToggle", lang)} value={s.visualLevels} disabled={!s.visualContext} onChange={(visualLevels) => onSettings({ visualLevels })} />
      <CheckRow label={visualText("eventsToggle", lang)} value={s.visualEvents} disabled={!s.visualContext} onChange={(visualEvents) => onSettings({ visualEvents })} />
    </Section>
    <Section title={t("smBasicStyles")}>
      <SelectRow label={t("smBackground")} value={s.backgroundType} onChange={(value) => onSettings({ backgroundType: value as "solid" | "gradient" })}
        options={[{ value: "solid", label: t("smBgSolid") }, { value: "gradient", label: t("smBgGradient") }]} />
      <div className="sm-row"><span className="sm-row-label">{t("smBackgroundColors")}</span><div className="sm-color-pair">
        <ColorControl value={s.backgroundTop} fallback={cssToken("--chart-bg", "#101521")} onChange={(value) => onSettings({ backgroundTop: value })} />
        <ColorControl value={s.backgroundBottom} fallback={cssToken("--chart-bg", "#101521")} onChange={(value) => onSettings({ backgroundBottom: value })} />
      </div></div>
      <CheckRow label={t("smGridV")} value={s.gridVVisible} onChange={(value) => onSettings({ gridVVisible: value })}>
        <ColorControl value={s.gridVColor} fallback={cssToken("--grid", "#202838")} onChange={(value) => onSettings({ gridVColor: value })} />
      </CheckRow>
      <CheckRow label={t("smGridH")} value={s.gridHVisible} onChange={(value) => onSettings({ gridHVisible: value })}>
        <ColorControl value={s.gridHColor} fallback={cssToken("--grid", "#202838")} onChange={(value) => onSettings({ gridHColor: value })} />
      </CheckRow>
      <div className="sm-row"><span className="sm-row-label">{t("smPaneSeparators")}</span><ColorControl value={s.paneSeparatorColor} fallback={cssToken("--line", "#2a3242")} onChange={(value) => onSettings({ paneSeparatorColor: value })} /></div>
      <div className="sm-row"><span className="sm-row-label">{t("smCrosshair")}</span><ColorControl value={s.crosshairColor} fallback="#9598a1" onChange={(value) => onSettings({ crosshairColor: value })} /></div>
      <CheckRow label={t("smWatermark")} value={s.showWatermark} onChange={(value) => onSettings({ showWatermark: value })}>
        <ColorControl value={s.watermarkColor} fallback="#788296" onChange={(value) => onSettings({ watermarkColor: value })} />
      </CheckRow>
    </Section>
    <Section title={t("smScales")}>
      <div className="sm-row"><span className="sm-row-label">{t("smText")}</span><div className="sm-inline">
        <ColorControl value={s.scaleTextColor} fallback={cssToken("--muted", "#8b93a6")} onChange={(value) => onSettings({ scaleTextColor: value })} />
        <select className="sm-select small" value={s.scaleFontSize} onChange={(event) => onSettings({ scaleFontSize: Number(event.target.value) })}>
          {[10, 11, 12, 13, 14, 16].map((size) => <option key={size}>{size}</option>)}
        </select>
      </div></div>
      <div className="sm-row"><span className="sm-row-label">{t("smLines")}</span><ColorControl value={s.scaleLineColor} fallback={cssToken("--line", "#2a3242")} onChange={(value) => onSettings({ scaleLineColor: value })} /></div>
    </Section>
    <Section title={t("smButtons")}>
      <SelectRow label={t("smPane")} value={s.paneButtons} onChange={(value) => onSettings({ paneButtons: value as ChartSettings["paneButtons"] })} options={visibilityOptions(t)} />
    </Section>
    <Section title={t("smMargins")}>
      <NumberRow label={t("smMarginTop")} value={s.scaleMarginsTop} min={0} max={50} suffix="%" onChange={(value) => onSettings({ scaleMarginsTop: value })} />
      <NumberRow label={t("smMarginBottom")} value={s.scaleMarginsBottom} min={0} max={50} suffix="%" onChange={(value) => onSettings({ scaleMarginsBottom: value })} />
      <NumberRow label={t("smMarginRight")} value={s.rightOffsetBars} min={0} max={100} suffix={t("smBarsSuffix")} onChange={(value) => onSettings({ rightOffsetBars: value })} />
    </Section>
  </div>;
}

// Built per render so the labels follow the active language rather than freezing
// at module-evaluation time.
const visibilityOptions = (t: (key: string) => string) => [
  { value: "always", label: t("smVisAlways") },
  { value: "hover", label: t("smVisHover") },
  { value: "never", label: t("smVisNever") },
];
