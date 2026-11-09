"use client";
import { useEffect, useId, useRef } from "react";
import { CmpCfg, CMP_LINE_STYLES } from "@/lib/compare";
import { useLang, useT } from "@/lib/i18n";
import { activateSettingsDialog, colorInputHex } from "@/lib/chartSettingsUi";
import { parseCssColor } from "@/lib/chart-engine/canvas/priceAxis";
import dialogStyles from "./IndicatorSettings.module.css";
import styles from "./CompareSettings.module.css";

const SWATCHES = ["#4d82ff", "#26c281", "#f0566b", "#e8b339", "#e8a33d", "#9d86ff", "#19c2c2", "#d6dae3", "#868d9c", "#ff8a3d"];
const hexToRgba = (hex: string, a: number) => { let h = hex.replace("#", ""); if (h.length === 3) h = h.split("").map((x) => x + x).join(""); const n = parseInt(h, 16); const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255; return a >= 1 ? `#${h}` : `rgba(${r}, ${g}, ${b}, ${a})`; };

function ColorField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useT();
  const hex = colorInputHex(value);
  const apply = (next: string) => onChange(hexToRgba(next, parseCssColor(value)?.[3] ?? 1));
  return (
    <span className="is-color" role="group" aria-label={t("cmpColor")}>
      <span className="is-sw-cur" style={{ background: value }} aria-hidden="true" />
      {SWATCHES.map((s) => <button key={s} type="button" className={`is-sw${hex === s ? " on" : ""}`} style={{ background: s }}
        title={s} aria-label={`${t("cmpColor")}: ${s}`} aria-pressed={hex === s} onClick={() => apply(s)} />)}
      <input type="color" value={hex} onChange={(e) => apply(e.target.value)} aria-label={t("customColor")} />
    </span>
  );
}

function NumberField({ value, min, max, step = 1, onChange }: { value: number; min?: number; max?: number; step?: number; onChange: (v: number) => void }) {
  const t = useT();
  const { lang } = useLang();
  const clamp = (v: number) => Math.max(min ?? -Infinity, Math.min(max ?? Infinity, Math.round(v)));
  return (
    <span className="is-stepper">
      <button type="button" disabled={min !== undefined && value <= min} onClick={() => onChange(clamp(value - step))} aria-label={lang === "zh" ? "减小粗细" : "Decrease thickness"}>−</button>
      <input type="number" aria-label={t("cmpThickness")} value={value} step={step} min={min} max={max} onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v)) onChange(clamp(v)); }} />
      <button type="button" disabled={max !== undefined && value >= max} onClick={() => onChange(clamp(value + step))} aria-label={lang === "zh" ? "增大粗细" : "Increase thickness"}>+</button>
    </span>
  );
}

export default function CompareSettings({ sym, cfg, onChange, onClose }: { sym: string; cfg: CmpCfg; onChange: (patch: Partial<CmpCfg>) => void; onClose: () => void }) {
  const t = useT();
  const { lang } = useLang();
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const restore = activateSettingsDialog(dialog, opener);
    dialog.focus({ preventScroll: true });
    return () => {
      restore();
      if (!document.querySelector("dialog[open]") && opener?.isConnected && !opener.getClientRects().length) {
        opener.closest<HTMLElement>(".lg-row[tabindex]")?.focus({ preventScroll: true });
        opener.focus({ preventScroll: true });
      }
    };
  }, []);

  return (
      <dialog ref={dialogRef} className={`ind-set ${dialogStyles.dialog} ${styles.dialog}`} aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        onCancel={(e) => { e.preventDefault(); onClose(); }} onKeyDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          if (e.target !== e.currentTarget) return;
          const bounds = e.currentTarget.getBoundingClientRect();
          if (e.clientX < bounds.left || e.clientX > bounds.right || e.clientY < bounds.top || e.clientY > bounds.bottom) onClose();
        }}>
        <div className="is-head"><b id={titleId}>{sym}</b><button type="button" className="x" onClick={onClose} aria-label={lang === "zh" ? "关闭" : "Close"}>✕</button></div>
        <div className="is-body">
          <div className="is-row">
            <span className="is-label">{t("cmpColor")}</span>
            <ColorField value={cfg.color} onChange={(color) => onChange({ color })} />
          </div>
          <div className="is-row">
            <span className="is-label">{t("cmpLineStyle")}</span>
            <span className="cmp-set-seg" role="group" aria-label={t("cmpLineStyle")}>
              {CMP_LINE_STYLES.map(({ v, label }) => (
                <button key={v} type="button" className={`cmp-set-opt${cfg.lineStyle === v ? " on" : ""}`} aria-pressed={cfg.lineStyle === v}
                  onClick={() => onChange({ lineStyle: v })}>{lang === "zh" ? (v === 0 ? "实线" : v === 2 ? "虚线" : "点线") : label}</button>
              ))}
            </span>
          </div>
          <div className="is-row">
            <span className="is-label">{t("cmpThickness")}</span>
            <NumberField value={cfg.lineWidth} min={1} max={4} step={1} onChange={(lineWidth) => onChange({ lineWidth })} />
          </div>
          <div className="is-row">
            <span className="is-label">{t("cmpScaleMode")}</span>
            <span className="cmp-set-seg" role="group" aria-label={t("cmpScaleMode")}>
              <button type="button" className={`cmp-set-opt${cfg.mode === "price" ? " on" : ""}`} aria-pressed={cfg.mode === "price"} onClick={() => onChange({ mode: "price" })}>{t("cmpModePrice")}</button>
              <button type="button" className={`cmp-set-opt${cfg.mode === "percent" ? " on" : ""}`} aria-pressed={cfg.mode === "percent"} onClick={() => onChange({ mode: "percent" })}>{t("cmpModePercent")}</button>
            </span>
          </div>
        </div>
        <div className="is-foot">
          <div className="spacer" />
          <button type="button" className="ai" onClick={onClose}>{lang === "zh" ? "完成" : "Done"}</button>
        </div>
      </dialog>
  );
}
