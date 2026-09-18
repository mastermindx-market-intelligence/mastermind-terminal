"use client";
/**
 * SurfaceStylePopover — the "Style" control on the Surface toolbar.
 *
 * Two levels, in the order people actually reach for them:
 *   1. a preset (theme default / colourblind-safe / monochrome heat / classic)
 *   2. a per-metric signed colour pair: inflow/outflow for premium, positive/negative
 *      exposure for modeled Greeks
 *
 * Colour inputs are native `<input type="color">` — they emit `#rrggbb`, which is exactly
 * the shape surfaceTheme validates before anything reaches setProperty.
 *
 * The default preset is described in words ("follows the up/down colours") because that is
 * the one option whose behaviour changes with the language convention — picking an explicit
 * palette opts out of the East-Asian 红涨绿跌 flip, and the user should know that.
 */

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Lang } from "@/lib/i18n";
import { makeSurfaceT } from "./surfaceStrings";
import {
  PRESETS,
  PRESET_KEYS,
  THEME_METRICS,
  CONTRAST_MODES,
  effectivePair,
  effectiveContrast,
  nextThemeForPreset,
  type ContrastMode,
  type PresetKey,
  type SurfaceTheme,
  type ThemeMetric,
} from "./surfaceTheme";

/** Metric → its label key, and the fallback swatch when the metric inherits the theme. */
const METRIC_LABEL: Record<ThemeMetric, "metricNetPrem" | "metricGamma" | "metricVanna" | "metricCharm"> = {
  netprem: "metricNetPrem",
  gex: "metricGamma",
  vanna: "metricVanna",
  charm: "metricCharm",
};

/** CSS vars used for the swatch preview when a metric is inheriting (no explicit hex). */
const INHERIT_VAR: Record<ThemeMetric, { pos: string; neg: string }> = {
  netprem: { pos: "var(--up)", neg: "var(--down)" },
  gex: { pos: "var(--up)", neg: "var(--down)" },
  vanna: { pos: "var(--metric-vanna-pos)", neg: "var(--metric-vanna-neg)" },
  charm: { pos: "var(--metric-charm-pos)", neg: "var(--metric-charm-neg)" },
};

const PRESET_LABEL: Record<PresetKey, "presetDefault" | "presetColorblind" | "presetMono" | "presetClassic"> = {
  default: "presetDefault",
  colorblind: "presetColorblind",
  mono: "presetMono",
  classic: "presetClassic",
};

/** R1.4: the day-max normalizer clamps to the 95th percentile by default ("Balanced") —
 *  one outlier strike-minute can no longer wash out the rest of the field. "Raw" restores
 *  the pre-R1.4 max(|min|,|max|) behaviour for anyone who wants the literal extreme. */
const CONTRAST_LABEL: Record<ContrastMode, "styleContrastBalanced" | "styleContrastRaw"> = {
  balanced: "styleContrastBalanced",
  raw: "styleContrastRaw",
};

interface Props {
  lang: Lang;
  theme: SurfaceTheme;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (theme: SurfaceTheme) => void;
}

export function SurfaceStylePopover({ lang, theme, open, onOpenChange, onChange }: Props) {
  const t = makeSurfaceT(lang);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  // The panel is on a fixed layer (the surface root clips overflow), so it is positioned
  // from the trigger's viewport rect rather than by CSS offset.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Dismiss on outside click / Esc — a colour picker is a scratch control, not a mode.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const n = e.target as Node;
      // The panel is portalled out of wrapRef, so test it separately.
      if (wrapRef.current?.contains(n)) return;
      if ((n as Element)?.closest?.(".obs-surf-style-pop")) return;
      onOpenChange(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { e.stopPropagation(); onOpenChange(false); }
    }
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onOpenChange]);

  /** Swatch colours for a preset button: what the four-square preview shows. */
  function presetSwatches(key: PresetKey): string[] {
    const p = PRESETS[key];
    if (!p) return [INHERIT_VAR.netprem.pos, INHERIT_VAR.netprem.neg, INHERIT_VAR.vanna.pos, INHERIT_VAR.vanna.neg];
    return [p.netprem.pos, p.netprem.neg, p.vanna.pos, p.vanna.neg];
  }

  function setPreset(preset: PresetKey) {
    // F2: the transform itself lives in surfaceTheme.ts (nextThemeForPreset) so the test
    // suite pins the REAL function rather than a copy of this call site.
    onChange(nextThemeForPreset(theme, preset));
  }

  function setContrast(contrast: ContrastMode) {
    onChange({ ...theme, contrast });
  }

  function setPair(metric: ThemeMetric, side: "pos" | "neg", hex: string) {
    const current = effectivePair(theme, metric) ?? {
      // No explicit pair yet: seed from the classic table so the untouched side keeps a
      // sane concrete value once this metric stops inheriting.
      pos: PRESETS.classic![metric].pos,
      neg: PRESETS.classic![metric].neg,
    };
    onChange({
      ...theme,
      custom: { ...theme.custom, [metric]: { ...current, [side]: hex } },
    });
  }

  return (
    <div className="obs-surf-style-wrap" ref={wrapRef}>
      <button
        ref={btnRef}
        className={`obs-chip${open ? " on" : ""}`}
        style={TRIGGER}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          // Measure here rather than in an effect: the rect is available at click time, so
          // the panel is positioned on the very first paint (no flash) and no cascading
          // render is needed to place it.
          if (!open) {
            const r = btnRef.current?.getBoundingClientRect();
            const W = 268;
            if (r) {
              setPos({
                top: Math.round(r.bottom + 6),
                left: Math.round(Math.max(8, Math.min(r.right - W, window.innerWidth - W - 8))),
              });
            }
          }
          onOpenChange(!open);
        }}
      >
        {t("styleBtn")}
      </button>

      {/* Portalled to <body>. `.obs-ambient > *` gives every direct child of the surface
          root `position:relative; z-index:1`, so a fixed panel rendered inside the toolbar is
          trapped in that stacking context and the later-painting chart area covers it — the
          panel came out looking translucent with the heat field bleeding through. A portal
          escapes the trapped context entirely. */}
      {open && pos && createPortal(
        <div
          className="obs-surf-style-pop"
          role="dialog"
          aria-label={t("styleAria")}
          style={{ top: pos.top, left: pos.left }}
        >
          {/* R1.4 contrast: a SEPARATE axis from the pos/neg hue below (intensity, not
              colour) — clamping the day-max normalizer to the 95th percentile is the
              default fix for a field that reads bland because one outlier strike-minute
              ate the whole colour range. "Raw" is the pre-R1.4 literal-max behaviour. */}
          <div className="obs-lbl">{t("styleContrast")}</div>
          <div
            className="obs-surf-style-presets"
            role="group"
            aria-label={t("styleContrastAria")}
            style={{ marginTop: 4 }}
          >
            {CONTRAST_MODES.map((mode) => (
              <button
                key={mode}
                className="obs-surf-style-preset"
                aria-pressed={effectiveContrast(theme) === mode}
                onClick={() => setContrast(mode)}
              >
                {t(CONTRAST_LABEL[mode])}
              </button>
            ))}
          </div>
          <div className="obs-surf-style-note">{t("styleContrastNote")}</div>

          <div className="obs-surf-style-hd" style={{ marginTop: "var(--sp-3)" }}>
            <span className="obs-lbl">{t("stylePresets")}</span>
            <button
              className="obs-surf-pins-clear"
              style={{ marginLeft: 0 }}
              onClick={() => setPreset("default")}
            >
              {t("styleReset")}
            </button>
          </div>

          <div className="obs-surf-style-presets">
            {PRESET_KEYS.map((key) => (
              <button
                key={key}
                className="obs-surf-style-preset"
                aria-pressed={theme.preset === key}
                onClick={() => setPreset(key)}
              >
                <span className="obs-surf-style-swatches" aria-hidden>
                  {presetSwatches(key).map((c, i) => (
                    <span className="obs-surf-style-sw" key={i} style={{ background: c }} />
                  ))}
                </span>
                {t(PRESET_LABEL[key])}
              </button>
            ))}
          </div>

          <div className="obs-lbl" style={{ margin: "var(--sp-3) 0 var(--sp-1)" }}>{t("stylePerMetric")}</div>
          {THEME_METRICS.map((metric) => {
            const pair = effectivePair(theme, metric);
            const inherit = INHERIT_VAR[metric];
            const positiveLabel = metric === "netprem" ? t("stylePos") : t("styleExposurePos");
            const negativeLabel = metric === "netprem" ? t("styleNeg") : t("styleExposureNeg");
            return (
              <div className="obs-surf-style-row" key={metric}>
                <span className="obs-surf-style-row-lbl">{t(METRIC_LABEL[metric])}</span>
                <input
                  type="color"
                  className="obs-surf-style-pick"
                  aria-label={`${t(METRIC_LABEL[metric])} — ${positiveLabel}`}
                  value={pair?.pos ?? PRESETS.classic![metric].pos}
                  style={pair ? undefined : { background: inherit.pos }}
                  onChange={(e) => setPair(metric, "pos", e.target.value)}
                />
                <input
                  type="color"
                  className="obs-surf-style-pick"
                  aria-label={`${t(METRIC_LABEL[metric])} — ${negativeLabel}`}
                  value={pair?.neg ?? PRESETS.classic![metric].neg}
                  style={pair ? undefined : { background: inherit.neg }}
                  onChange={(e) => setPair(metric, "neg", e.target.value)}
                />
              </div>
            );
          })}

          {theme.preset === "default" && (
            <div className="obs-surf-style-note">{t("styleDefaultNote")}</div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

/** Level with the toolbar chips it sits beside (view / agg / root shortcuts). */
const TRIGGER: React.CSSProperties = {
  height: 28, fontSize: "var(--fs-label)", fontWeight: 600, padding: "0 var(--sp-3)",
};
