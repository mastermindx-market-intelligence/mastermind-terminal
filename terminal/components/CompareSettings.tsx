"use client";
import { useEffect } from "react";
import { CmpCfg, CMP_LINE_STYLES } from "@/lib/compare";
import { useT } from "@/lib/i18n";

const SWATCHES = ["#4d82ff", "#26c281", "#f0566b", "#e8b339", "#e8a33d", "#9d86ff", "#19c2c2", "#d6dae3", "#868d9c", "#ff8a3d"];
const hexOf = (c: string) => (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c) ? c : "#888888");
const alphaOf = (c: string) => { const m = /rgba?\([^)]*,\s*([\d.]+)\s*\)/i.exec(c); return m ? parseFloat(m[1]) : 1; };
const hexToRgba = (hex: string, a: number) => { let h = hex.replace("#", ""); if (h.length === 3) h = h.split("").map((x) => x + x).join(""); const n = parseInt(h, 16); const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255; return a >= 1 ? `#${h}` : `rgba(${r}, ${g}, ${b}, ${a})`; };

function ColorField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useT();
  const apply = (hex: string) => onChange(hexToRgba(hex, alphaOf(value)));
  return (
    <span className="is-color">
      <span className="is-sw-cur" style={{ background: value }} />
      {SWATCHES.map((s) => (
        <button
          key={s}
          type="button"
          className={`is-sw${value === s ? " on" : ""}`}
          style={{ background: s }}
          title={s}
          aria-label={`${t("cmpColor")} ${s}`}
          onClick={() => apply(s)}
        />
      ))}
      <input type="color" value={hexOf(value)} onChange={(e) => apply(e.target.value)} aria-label={t("customColor")} />
    </span>
  );
}

function NumberField({
  value,
  min,
  max,
  step = 1,
  onChange,
  label,
}: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
  label: string;
}) {
  const clamp = (v: number) => Math.max(min ?? -Infinity, Math.min(max ?? Infinity, Math.round(v)));
  return (
    <span className="is-stepper">
      <button type="button" onClick={() => onChange(clamp(value - step))} aria-label={`${label} −`}>−</button>
      <input aria-label={label} type="number" value={value} step={step} min={min} max={max} onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v)) onChange(clamp(v)); }} />
      <button type="button" onClick={() => onChange(clamp(value + step))} aria-label={`${label} +`}>+</button>
    </span>
  );
}

export default function CompareSettings({ sym, cfg, onChange, onClose }: { sym: string; cfg: CmpCfg; onChange: (patch: Partial<CmpCfg>) => void; onClose: () => void }) {
  const t = useT();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="ind-set"
        role="dialog"
        aria-modal="true"
        aria-label={`${sym} ${t("settings")}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="is-head">
          <b>{sym}</b>
          <button type="button" className="x" onClick={onClose} aria-label={t("sheetClose")}>✕</button>
        </div>
        <div className="is-body">
          <div className="is-row">
            <span className="is-label">{t("cmpColor")}</span>
            <ColorField value={cfg.color} onChange={(color) => onChange({ color })} />
          </div>
          <div className="is-row">
            <span className="is-label">{t("cmpLineStyle")}</span>
            <span className="cmp-set-seg">
              {CMP_LINE_STYLES.map(({ v, label }) => (
                <button key={v} className={`cmp-set-opt${cfg.lineStyle === v ? " on" : ""}`} onClick={() => onChange({ lineStyle: v })}>{label}</button>
              ))}
            </span>
          </div>
          <div className="is-row">
            <span className="is-label">{t("cmpThickness")}</span>
            <NumberField value={cfg.lineWidth} min={1} max={4} step={1} label={t("cmpThickness")} onChange={(lineWidth) => onChange({ lineWidth })} />
          </div>
          <div className="is-row">
            <span className="is-label">{t("cmpScaleMode")}</span>
            <span className="cmp-set-seg">
              <button className={`cmp-set-opt${cfg.mode === "price" ? " on" : ""}`} onClick={() => onChange({ mode: "price" })}>{t("cmpModePrice")}</button>
              <button className={`cmp-set-opt${cfg.mode === "percent" ? " on" : ""}`} onClick={() => onChange({ mode: "percent" })}>{t("cmpModePercent")}</button>
            </span>
          </div>
        </div>
        <div className="is-foot">
          <div className="spacer" />
          <button type="button" className="ai" onClick={onClose}>{t("sheetClose")}</button>
        </div>
      </div>
    </div>
  );
}
