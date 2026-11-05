"use client";
/**
 * GexGuide — collapsible HOW-TO-READ drawer for the GEX Desk.
 *
 * Content adapted from gex_ui_spec.md §8 and gex_FEATURE_SPEC.md §4.2, but
 * rewritten to OUR epistemics:
 *   - Sign is the dealer convention (an assumption), magnitude is the reliable read.
 *   - Levels are structural descriptions, not forecasts.
 *   - Single-name GEX regime fragility is disclosed.
 *   - No "validated", "predictive", or directional trade-signal language.
 *
 * Layout: collapsed = color legend dots only.
 *         expanded = 4-column grid of concept cards.
 */

import React, { useState } from "react";
import { makeGexT } from "./gexStrings";
import type { Lang } from "@/lib/i18n";

interface GexGuideProps {
  lang: Lang;
}

interface ConceptCard {
  dot: string;
  termKey: Parameters<ReturnType<typeof makeGexT>>[0];
  bodyKey: Parameters<ReturnType<typeof makeGexT>>[0];
}

/**
 * Flip violet. `--cat-2` is used across this desk but is defined nowhere in the token
 * set, so `background:var(--cat-2)` resolved to nothing and the flip legend dot rendered
 * INVISIBLE. `--ai` is defined and is the identical hue (#9d86ff) the ladder hardcodes as
 * rgba(157,134,255,…) — used as the fallback so a real --cat-2 would still win.
 */
const FLIP_VIOLET = "var(--cat-2, var(--ai))";

const CONCEPT_CARDS: ConceptCard[] = [
  { dot: "var(--brand-2)",  termKey: "guideGexTerm",         bodyKey: "guideGexBody" },
  { dot: "var(--brand-2)",  termKey: "guideCallWallTerm",    bodyKey: "guideCallWallBody" },
  { dot: "var(--down)",     termKey: "guidePutSupportTerm",  bodyKey: "guidePutSupportBody" },
  { dot: "var(--signal)",   termKey: "guideMagnetTerm",      bodyKey: "guideMagnetBody" },
  { dot: FLIP_VIOLET,       termKey: "guideFlipTerm",        bodyKey: "guideFlipBody" },
  { dot: "var(--text-2)",   termKey: "guideRegimeTerm",      bodyKey: "guideRegimeBody" },
  { dot: "var(--muted)",    termKey: "guideDealerSignTerm",  bodyKey: "guideDealerSignBody" },
];

const LEGEND_DOTS: { color: string; labelKey: Parameters<ReturnType<typeof makeGexT>>[0] }[] = [
  { color: "var(--brand-2)",  labelKey: "ladderNetGex" },
  { color: "var(--down)",     labelKey: "sumPutSupport" },
  { color: "var(--signal)",   labelKey: "sumMagnet" },
  { color: FLIP_VIOLET,       labelKey: "sumFlip" },
];

export function GexGuide({ lang }: GexGuideProps) {
  const t = makeGexT(lang);
  const [open, setOpen] = useState(false);

  return (
    <div style={GUIDE_OUTER}>
      {/* ── Collapsed legend + toggle ─────────────────────────────────────── */}
      <div style={LEGEND_ROW}>
        {/* Color dots */}
        <div style={DOTS_ROW}>
          {LEGEND_DOTS.map((d) => (
            <span key={d.labelKey} style={DOT_ITEM}>
              <span style={{ ...DOT, background: d.color }} />
              <span style={DOT_LABEL}>{t(d.labelKey)}</span>
            </span>
          ))}
        </div>

        {/* Toggle button */}
        <button
          className="obs-gex-mobile-target"
          style={TOGGLE_BTN}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {open ? t("guideToggleClose") : t("guideToggleOpen")}
        </button>
      </div>

      {/* ── Expanded concept cards ────────────────────────────────────────── */}
      {open && (
        <div style={CARDS_GRID}>
          {CONCEPT_CARDS.map((c) => (
            <div key={c.termKey} style={CONCEPT_CARD}>
              <div style={CONCEPT_HEADER}>
                <span style={{ ...CONCEPT_DOT, background: c.dot }} />
                <span style={CONCEPT_TERM}>{t(c.termKey)}</span>
              </div>
              <p style={CONCEPT_BODY}>{t(c.bodyKey)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const GUIDE_OUTER: React.CSSProperties = {
  borderTop: "1px solid var(--line-2)",
  background: "var(--panel)",
  flexShrink: 0,
};

const LEGEND_ROW: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  padding: "var(--sp-1) var(--sp-3)",
  gap: "var(--sp-3)",
  flexWrap: "wrap",
};

const DOTS_ROW: React.CSSProperties = {
  display: "flex",
  gap: "var(--sp-3)",
  flex: 1,
  flexWrap: "wrap",
  alignItems: "center",
};

const DOT_ITEM: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--sp-1)",
};

const DOT: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: "var(--r-pill)",
  flexShrink: 0,
};

const DOT_LABEL: React.CSSProperties = {
  fontSize: "var(--fs-micro)",
  color: "var(--text-2)",
};

const TOGGLE_BTN: React.CSSProperties = {
  fontSize: "var(--fs-micro)",
  color: "var(--brand-2)",
  background: "none",
  border: "none",
  cursor: "pointer",
  padding: "var(--sp-1) 0",
  letterSpacing: "0.04em",
  fontWeight: 600,
  flexShrink: 0,
  whiteSpace: "nowrap",
};

const CARDS_GRID: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
  gap: "var(--sp-2)",
  padding: "var(--sp-2) var(--sp-3) var(--sp-3)",
  borderTop: "1px solid var(--line-2)",
};

const CONCEPT_CARD: React.CSSProperties = {
  background: "var(--panel-2)",
  border: "1px solid var(--line)",
  borderRadius: "var(--r-tile)",
  padding: "var(--sp-2) var(--sp-3)",
};

const CONCEPT_HEADER: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--sp-2)",
  marginBottom: "var(--sp-1)",
};

const CONCEPT_DOT: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: "var(--r-pill)",
  flexShrink: 0,
};

const CONCEPT_TERM: React.CSSProperties = {
  fontSize: "var(--fs-label)",
  fontWeight: 700,
  color: "var(--text)",
};

const CONCEPT_BODY: React.CSSProperties = {
  fontSize: "var(--fs-micro)",
  color: "var(--text-2)",
  lineHeight: 1.5,
  margin: 0,
};
