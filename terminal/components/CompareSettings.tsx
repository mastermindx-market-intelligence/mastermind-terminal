"use client";
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { type CmpCfg, CMP_LINE_STYLES } from "@/lib/compare";
import { activateSettingsDialog, colorInputHex, commitNumber, previewNumber } from "@/lib/chartSettingsUi";
import { useT } from "@/lib/i18n";
import styles from "./CompareSettings.module.css";

const SWATCHES = ["#4d82ff", "#26c281", "#f0566b", "#e8b339", "#e8a33d", "#9d86ff", "#19c2c2", "#d6dae3", "#868d9c", "#ff8a3d"];
const STYLE_KEYS: Record<number, string> = { 0: "drawingDashSolid", 2: "drawingDashDashed", 1: "drawingDashDotted" };
// The existing color control preserves opacity; RGB normalization belongs to chartSettingsUi.
function alphaOf(value: string): number {
  const color = value.trim();
  if (/^#[\da-f]{8}$/i.test(color)) return parseInt(color.slice(7, 9), 16) / 255;
  if (/^#[\da-f]{4}$/i.test(color)) return parseInt(color[4] + color[4], 16) / 255;
  const rgb = color.match(/^rgba?\(([^)]+)\)$/i);
  const alpha = rgb?.[1].trim().split(/\s*[,/]\s*|\s+/)[3];
  const number = alpha ? Number.parseFloat(alpha) / (alpha.endsWith("%") ? 100 : 1) : 1;
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 1;
}
function withAlpha(hex: string, alpha: number): string {
  if (alpha >= 1) return hex;
  const number = parseInt(hex.slice(1), 16);
  return `rgba(${(number >> 16) & 255}, ${(number >> 8) & 255}, ${number & 255}, ${alpha})`;
}
function ColorField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const t = useT();
  const hex = colorInputHex(value, "#888888");
  const apply = (next: string) => onChange(withAlpha(next, alphaOf(value)));
  return <div className={styles.colors}>
    <div className={styles.palette} role="group" aria-label={t("cmpColor")}>
      {SWATCHES.map((swatch) => <button key={swatch} type="button" className={styles.swatch}
        style={{ "--swatch": swatch } as CSSProperties} title={swatch}
        aria-label={`${t("cmpColor")} ${swatch}`} aria-pressed={hex === swatch} onClick={() => apply(swatch)} />)}
    </div>
    <label className={styles.custom}><span>{t("customColor")}</span><code>{hex.toUpperCase()}</code>
      <input type="color" value={hex} onChange={(event) => apply(event.target.value)} aria-label={t("customColor")} />
    </label>
  </div>;
}
function NumberField({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const t = useT();
  const [draft, setDraft] = useState<string | null>(null);
  const apply = (next: number) => { setDraft(null); if (next !== value) onChange(next); };
  const commit = () => apply(Math.round(commitNumber(draft ?? String(value), value, 1, 4)));
  return <div className={styles.stepper}>
    <button type="button" disabled={value <= 1} aria-label={`${t("cmpThickness")} −`} onClick={() => apply(Math.max(1, value - 1))}>−</button>
    <input type="number" value={draft ?? value} min={1} max={4} step={1} aria-label={t("cmpThickness")}
      onChange={(event) => {
        const raw = event.target.value; setDraft(raw);
        const number = previewNumber(raw, 1, 4);
        if (number !== null && Number.isInteger(number) && number !== value) onChange(number);
      }} onBlur={commit} onKeyDown={(event) => {
        if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
      }} />
    <button type="button" disabled={value >= 4} aria-label={`${t("cmpThickness")} +`} onClick={() => apply(Math.min(4, value + 1))}>+</button>
  </div>;
}

export default function CompareSettings({ sym, cfg, onChange, onClose }: {
  sym: string; cfg: CmpCfg; onChange: (patch: Partial<CmpCfg>) => void; onClose: () => void;
}) {
  const t = useT();
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!dialog.current) return;
    const opener = document.querySelector<HTMLElement>(".cmp-btn");
    return activateSettingsDialog(dialog.current, opener);
  }, []);
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby={`${id}-title`}
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onKeyDown={(event) => event.stopPropagation()}
    onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className={`ind-set ${styles.card}`}>
      <header className={styles.header}>
        <div><span className={styles.eyebrow}>{t("compareTitle")}</span><h2 id={`${id}-title`}>{sym}</h2></div>
        <span className={styles.linePreview} aria-hidden="true" style={{ color: cfg.color,
          borderTopWidth: cfg.lineWidth, borderTopStyle: cfg.lineStyle === 2 ? "dashed" : cfg.lineStyle === 1 ? "dotted" : "solid" }} />
        <button type="button" className={styles.close} aria-label={t("smClose")} title={t("smClose")} onClick={onClose}>×</button>
      </header>
      <div className={styles.body}>
        <section className={styles.section} aria-labelledby={`${id}-color`}>
          <h3 id={`${id}-color`}>{t("cmpColor")}</h3><ColorField value={cfg.color} onChange={(color) => onChange({ color })} />
        </section>
        <section className={styles.section} aria-labelledby={`${id}-line`}>
          <h3 id={`${id}-line`}>{t("cmpLineStyle")}</h3>
          <div className={styles.segment} role="group" aria-label={t("cmpLineStyle")}>
            {CMP_LINE_STYLES.map(({ v }) => <button type="button" key={v} aria-pressed={cfg.lineStyle === v}
              onClick={() => onChange({ lineStyle: v })}><span aria-hidden="true" className={styles.styleLine}
                style={{ borderTopStyle: v === 2 ? "dashed" : v === 1 ? "dotted" : "solid" }} />{t(STYLE_KEYS[v])}</button>)}
          </div>
          <div className={styles.widthRow}><span>{t("cmpThickness")}</span>
            <NumberField key={sym} value={cfg.lineWidth} onChange={(lineWidth) => onChange({ lineWidth })} />
          </div>
        </section>
        <section className={styles.section} aria-labelledby={`${id}-scale`}>
          <h3 id={`${id}-scale`}>{t("cmpScaleMode")}</h3>
          <div className={styles.segment} role="group" aria-label={t("cmpScaleMode")}>
            <button type="button" aria-pressed={cfg.mode === "price"} onClick={() => onChange({ mode: "price" })}>{t("cmpModePrice")}</button>
            <button type="button" aria-pressed={cfg.mode === "percent"} onClick={() => onChange({ mode: "percent" })}>{t("cmpModePercent")}</button>
          </div>
        </section>
      </div>
      <footer className={styles.footer}><button type="button" className={styles.done} onClick={onClose}>{t("isOk")}</button></footer>
    </div>
  </dialog>;
}
