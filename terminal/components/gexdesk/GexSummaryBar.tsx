"use client";
/**
 * GexSummaryBar — horizontal strip of computed GEX key levels.
 *
 * MomoEdge parity (Pass 3): NET GEX, CALL WALL, PUT SUPPORT, HVL/MAGNET,
 * GAMMA FLIP, P/C RATIO, CALL OI, PUT OI.
 *
 * P/C RATIO and OI fields come from payload when present; omitted gracefully
 * when absent (never faked).
 *
 * EXPIRY LENS (OEU T-A): when the ladder is scoped to 0DTE / All−0DTE / one expiration,
 * NET GEX re-derives from that lens. The LEVEL cells cannot: walls, flip, magnet and max
 * pain are all-expiry constructs the feed publishes once, so they keep their value and
 * wear an "all exp" tag. Showing them untagged beside a 0DTE ladder would be the silent
 * fallback this lane exists to remove.
 *
 * HONESTY DOCTRINE: all values are display-only levels-map metrics. No directional
 * claims. Net GEX color indicates sign only — not a signal.
 */

import React from "react";
import { makeGexT } from "./gexStrings";
import type { Lang } from "@/lib/i18n";
import type { GexPayload } from "./GexDeskView";
import { fmtBn, fmtMn, type ExpiryLens } from "@/lib/gexLadder";
import { Tip } from "@/components/ui/Tip";

interface GexSummaryBarProps {
  payload: GexPayload | null;
  /** Extended statePayload fields available for Call OI / Put OI */
  callOI?: number | null;
  putOI?: number | null;
  /** Active expiry lens — scopes NET GEX and tags the all-expiry level cells. */
  lens?: ExpiryLens;
  /** Σ of the active lens across covered strikes, $mn. null → lens has no data. */
  lensNetMn?: number | null;
  /** Display-grid arithmetic does not certify the upstream book. */
  lensReportedOnly?: boolean;
  /** How many of the ladder's own strikes the lens actually covers, out of the total —
   *  the scoped Net GEX swaps STRIKE UNIVERSE as well as unit/store, and the chip must
   *  disclose that, not just the expiry it's scoped to. */
  lensCoveredStrikes?: number | null;
  lensTotalStrikes?: number | null;
  lang: Lang;
}

function fmtLevel(val: number | null | undefined): string {
  if (val == null || !Number.isFinite(val)) return "—";
  return val % 1 === 0 ? String(val) : val.toFixed(1);
}

function fmtRatio(val: number | null | undefined): string {
  if (val == null || !Number.isFinite(val)) return "—";
  return val.toFixed(2);
}

function fmtOI(val: number | null | undefined): string {
  if (val == null || !Number.isFinite(val)) return "—";
  const abs = Math.abs(val);
  if (abs >= 1_000_000) return `${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(abs / 1_000).toFixed(0)}K`;
  return String(Math.round(abs));
}

interface MetricCellProps {
  label: string;
  value: string;
  valueColor?: string;
  /** Subtle text shown after value, e.g. " +" or unit hint */
  suffix?: string;
  /** Scope tag beside the label — e.g. "all exp" while an expiry lens is active. */
  tag?: string | null;
  /** Hover disclosure for `tag` — e.g. the strike-window fact a bare expiry tag omits. */
  tagTip?: string | null;
}

function MetricCell({ label, value, valueColor, suffix, tag, tagTip }: MetricCellProps) {
  const tagEl = tag ? <span style={{ ...CELL_TAG, cursor: tagTip ? "help" : undefined }}>{tag}</span> : null;
  return (
    <div style={CELL}>
      <span style={CELL_LABEL}>
        {label}
        {tagEl && tagTip ? (
          <Tip label={tagTip} side="top" size="card">
            {tagEl}
          </Tip>
        ) : (
          tagEl
        )}
      </span>
      <span style={{ ...CELL_VALUE, color: valueColor ?? "var(--text)" }}>
        {value}
        {suffix && value !== "—" && (
          <span style={CELL_SUFFIX}>{suffix}</span>
        )}
      </span>
    </div>
  );
}

export function GexSummaryBar({
  payload,
  callOI,
  putOI,
  lens,
  lensNetMn = null,
  lensReportedOnly = false,
  lensCoveredStrikes = null,
  lensTotalStrikes = null,
  lang,
}: GexSummaryBarProps) {
  const t = makeGexT(lang);

  if (!payload) {
    return (
      <div style={BAR_OUTER} data-tut="gex-summary">
        {[...Array(7)].map((_, i) => (
          <div key={i} style={{ ...CELL, opacity: 0.35 }}>
            <span style={CELL_LABEL}>{t("loading")}</span>
            <span style={CELL_VALUE}>—</span>
          </div>
        ))}
      </div>
    );
  }

  // Scoped = the ladder is showing one slice of the term structure, so the headline must
  // follow it. `net_gex_bn` is billions; a lens sum is $mn — two formatters, never one.
  const scoped = lens != null && lens.kind !== "all";
  const lensTag =
    !scoped ? null
    : lens!.kind === "zero" ? t("expiry0Dte")
    : lens!.kind === "ex-zero" ? t("expiryLensExZero")
    : (lens!.exp ?? "").slice(5, 10);
  const allExpTag = scoped ? t("sumAllExpTag") : null;

  // Strike-window disclosure: a scoped Net GEX sums over the MATRIX's narrower strike
  // window, not the full ladder — toggling All → 0DTE changes the number for the expiry
  // scope AND the strike universe, but the tag alone only ever named the former.
  const netGexTip =
    scoped && lensTotalStrikes != null && lensTotalStrikes > 0
      ? t("sumLensScopeTip")
          .replace("{n}", String(lensCoveredStrikes ?? 0))
          .replace("{m}", String(lensTotalStrikes))
      : null;

  const netGexVal = scoped ? lensNetMn : payload.net_gex_bn;
  const netGexStr = scoped ? fmtMn(lensNetMn) : fmtBn(payload.net_gex_bn);
  const netGexColor =
    netGexVal == null
      ? "var(--muted)"
      : netGexVal >= 0
      ? "var(--up)"
      : "var(--down)";

  // P/C OI ratio — from payload when present
  const pcRatioVal = payload.put_call_oi_ratio;
  const pcRatioStr = fmtRatio(pcRatioVal);
  const pcRatioColor =
    pcRatioVal != null
      ? pcRatioVal > 1
        ? "var(--down)"
        : "var(--up)"
      : "var(--text)";

  return (
    <div style={BAR_OUTER} data-tut="gex-summary">
      {/* 1. Net GEX — hero metric, scoped by the active expiry lens */}
      <MetricCell
        label={scoped && lensReportedOnly ? t("sumReportedGex") : t("sumNetGex")}
        tag={lensTag}
        tagTip={netGexTip}
        value={netGexStr}
        valueColor={netGexColor}
      />
      {/* 2. Call Wall */}
      <MetricCell
        label={t("sumCallWall")}
        tag={allExpTag}
        value={fmtLevel(payload.call_wall)}
        valueColor="var(--brand-2)"
      />
      {/* 3. Put Support */}
      <MetricCell
        label={t("sumPutSupport")}
        tag={allExpTag}
        value={fmtLevel(payload.put_wall)}
        valueColor="var(--down)"
      />
      {/* 4. HVL / Magnet */}
      <MetricCell
        label={t("sumMagnet")}
        tag={allExpTag}
        value={fmtLevel(payload.hvl ?? payload.magnet)}
        valueColor="var(--signal)"
      />
      {/* 5. Gamma Flip */}
      <MetricCell
        label={t("sumFlip")}
        tag={allExpTag}
        value={fmtLevel(payload.gamma_flip)}
        /* --cat-2 is never defined anywhere in the token set, so this cell rendered in
           plain text colour. var(--ai) IS defined and is the exact same violet the desk's
           other flip surfaces hardcode (#9d86ff) — kept as a fallback so a future --cat-2
           definition still wins. */
        valueColor="var(--cat-2, var(--ai))"
      />
      {/* 6. P/C Ratio — omit gracefully when absent */}
      {pcRatioStr !== "—" && (
        <MetricCell
          label={t("sumPcOi")}
          value={pcRatioStr}
          valueColor={pcRatioColor}
        />
      )}
      {/* 7. Call OI — from caller (gexstate or extended payload) */}
      {callOI != null && (
        <MetricCell
          label={t("sumCallOI")}
          value={fmtOI(callOI)}
          valueColor="var(--brand-2)"
        />
      )}
      {/* 8. Put OI */}
      {putOI != null && (
        <MetricCell
          label={t("sumPutOI")}
          value={fmtOI(putOI)}
          valueColor="var(--down)"
        />
      )}
      {/* Max pain — if present */}
      {payload.max_pain != null && (
        <MetricCell
          label={t("sumMaxPain")}
          tag={allExpTag}
          value={fmtLevel(payload.max_pain)}
        />
      )}
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const BAR_OUTER: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 0,
  borderBottom: "1px solid var(--line)",
  background: "var(--panel)",
  flexShrink: 0,
};

const CELL: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--sp-1)",
  padding: "var(--sp-2) var(--sp-4)",
  borderRight: "1px solid var(--line-2)",
  minWidth: 96,
};

// Uppercase tracked micro-label — the framework's eyebrow, inline (this file is
// deliberately className-free; the recipe is transcribed, not classified).
const CELL_LABEL: React.CSSProperties = {
  fontSize: "var(--fs-micro)",
  color: "var(--muted)",
  textTransform: "uppercase",
  letterSpacing: "0.1em",
  fontWeight: 700,
  whiteSpace: "nowrap",
  display: "flex",
  alignItems: "center",
  gap: "var(--sp-1)",
};

// Scope tag ("all exp" / "0DTE"): the universal tint formula written out — one hue
// drives text, fill and ring, so the pill can never drift from its label.
const CELL_TAG: React.CSSProperties = {
  fontSize: "var(--fs-micro)",
  fontWeight: 600,
  letterSpacing: "0.06em",
  color: "var(--muted)",
  background: "color-mix(in srgb, var(--muted) 12%, transparent)",
  boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--muted) 30%, transparent)",
  borderRadius: "var(--r-pill)",
  padding: "1px 6px",
  lineHeight: 1.5,
};

const CELL_VALUE: React.CSSProperties = {
  fontSize: "var(--fs-body)",
  fontWeight: 700,
  fontFamily: "var(--font-num)",
  fontVariantNumeric: "tabular-nums",
  letterSpacing: "0.01em",
};

const CELL_SUFFIX: React.CSSProperties = {
  fontSize: "var(--fs-micro)",
  opacity: 0.6,
  marginLeft: "var(--sp-1)",
};
