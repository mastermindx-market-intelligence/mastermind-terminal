"use client";
// D4 Object Tree — right-rail panel showing all chart series (main + indicators).
// Each row has: icon · name · eye toggle (wired to existing hide/show) · hover × to remove.
// Sub-pane indicators are grouped below the price-pane overlays.
// "Data window" tab is omitted (crosshair value plumbing not yet accessible from this surface).

import { useT } from "@/lib/i18n";

export type OTEntry = {
  key: string;
  label: string;
  tag?: string;
  kind: "overlay" | "pane";    // overlay = price pane; pane = sub-pane
  hidden: boolean;
  color?: string;
  noRemove?: boolean;           // main series, _oracle, compare — eye-only
};

type Props = {
  symbol: string;
  entries: OTEntry[];
  onEye: (key: string) => void;
  onRemove: (key: string) => void;
  onClose: () => void;
};

const I = (d: string, sw = 1.7, w = 15, h = 15) => (
  <svg viewBox="0 0 24 24" style={{ width: w, height: h, stroke: "currentColor", fill: "none", strokeWidth: sw, strokeLinecap: "round", strokeLinejoin: "round", flexShrink: 0 }}>
    <path d={d} />
  </svg>
);

const EYE_ON = "M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z";
const EYE_OFF = "M3 3l18 18M10.6 10.7a2 2 0 0 0 2.8 2.8M9.4 5.2A10.6 10.6 0 0 1 12 5c7 0 11 7 11 7a18 18 0 0 1-3.2 4M6.1 6.2A18 18 0 0 0 1 12s4 7 11 7a10.6 10.6 0 0 0 3-.4";
const SQUIGGLE = "M3 12c2-3 4-3 6 0s4 3 6 0 4-3 6 0";
const CANDLE = "M9 4v16M9 7h6v10H9zM6 9v6M15 9v6";
const CLOSE_X = "M6 6l12 12M18 6L6 18";

function EyeBtn({
  hidden: off,
  onToggle,
  showLabel,
  hideLabel,
}: {
  hidden: boolean;
  onToggle: () => void;
  showLabel: string;
  hideLabel: string;
}) {
  const label = off ? showLabel : hideLabel;
  return (
    <button
      type="button"
      className="icbtn ot-eye"
      title={label}
      aria-label={label}
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      style={{ opacity: off ? 0.35 : 1 }}
    >
      <svg viewBox="0 0 24 24" style={{ width: 15, height: 15, stroke: "currentColor", fill: "none", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const }}>
        {off
          ? <path d={EYE_OFF} />
          : <><path d={EYE_ON} /><circle cx="12" cy="12" r="3" /></>}
      </svg>
    </button>
  );
}

export default function ChartObjectTree({ symbol, entries, onEye, onRemove, onClose }: Props) {
  const t = useT();
  const overlays = entries.filter((e) => e.kind === "overlay");
  const subPanes = entries.filter((e) => e.kind === "pane");

  return (
    <div className="ot-root">
      <div className="ot-head">
        <span className="ot-title">{t("objectTree")}</span>
        <button
          type="button"
          className="icbtn"
          onClick={onClose}
          title={t("sheetClose")}
          aria-label={t("sheetClose")}
        >
          {I(CLOSE_X)}
        </button>
      </div>

      <div className="ot-body">
        {/* Main series row */}
        <div className="ot-section-label">{t("ctvMainSeries")}</div>
        <div className="ot-row ot-main">
          <span className="ot-icon">{I(CANDLE, 1.5)}</span>
          <span className="ot-name"><b>{symbol}</b></span>
        </div>

        {/* Price pane overlays */}
        {overlays.length > 0 && (
          <>
            <div className="ot-section-label">{t("ctvOverlays")}</div>
            {overlays.map((e) => (
              <div key={e.key} className={`ot-row${e.hidden ? " ot-hidden" : ""}`}>
                <span className="ot-icon" style={{ color: e.color || "var(--text-2)" }}>
                  {I(SQUIGGLE, 2)}
                </span>
                <span className="ot-name">{e.label}</span>
                <EyeBtn
                  hidden={e.hidden}
                  onToggle={() => onEye(e.key)}
                  showLabel={t("lgShow")}
                  hideLabel={t("lgHide")}
                />
                {!e.noRemove && (
                  <button
                    type="button"
                    className="icbtn ot-remove"
                    title={t("lgRemove")}
                    aria-label={t("lgRemove")}
                    onClick={(ev) => { ev.stopPropagation(); onRemove(e.key); }}
                  >
                    {I(CLOSE_X, 1.5)}
                  </button>
                )}
              </div>
            ))}
          </>
        )}

        {/* Sub-pane indicators */}
        {subPanes.length > 0 && (
          <>
            <div className="ot-section-label">{t("ctvSubPanes")}</div>
            {subPanes.map((e) => (
              <div key={e.key} className={`ot-row${e.hidden ? " ot-hidden" : ""}`}>
                <span className="ot-icon" style={{ color: e.color || "var(--text-2)" }}>
                  {I(SQUIGGLE, 2)}
                </span>
                <span className="ot-name">{e.label}</span>
                <EyeBtn
                  hidden={e.hidden}
                  onToggle={() => onEye(e.key)}
                  showLabel={t("lgShow")}
                  hideLabel={t("lgHide")}
                />
                {!e.noRemove && (
                  <button
                    type="button"
                    className="icbtn ot-remove"
                    title={t("lgRemove")}
                    aria-label={t("lgRemove")}
                    onClick={(ev) => { ev.stopPropagation(); onRemove(e.key); }}
                  >
                    {I(CLOSE_X, 1.5)}
                  </button>
                )}
              </div>
            ))}
          </>
        )}

        {overlays.length === 0 && subPanes.length === 0 && (
          <div style={{ padding: "18px 14px", color: "var(--text-dim)", fontSize: 12.5 }}>{t("ctvNoIndicators")}</div>
        )}
      </div>
    </div>
  );
}
