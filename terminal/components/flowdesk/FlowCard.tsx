"use client";
/**
 * FlowCard — single event card in the Flow Desk center feed.
 *
 * v7 hierarchy (institutional pass): every card leads with ONE primary number
 * (premium) and ONE primary read (the contract-type tag + soft lean pill).
 * Identity (ticker / score ring / time) sits above it; the contract line and a
 * single muted meta line — which now absorbs the former badge rail — sit below.
 *
 * HONESTY DOCTRINE (non-negotiable):
 *  - Colors are by MAGNITUDE (score tier) — never green/red by asserted buy/sell.
 *    The tinted read tag carries CONTRACT TYPE (call/put), not an asserted side.
 *  - Direction "lean" is a SOFT chip with neutral styling + explicit tooltip.
 *  - No "validated", no predictive-edge claims in copy.
 *  - Sweep badge carries "heuristic" tooltip — aggressor is UNVERIFIED without NBBO.
 *
 * v7b EXPANSION MODEL (the fix for the sticky/unclosable panel):
 *  - Expansion state is OWNED BY FeedPane (one card open at a time), not by the
 *    card's own useState. The card is a controlled component.
 *  - The detail panel is an ABSOLUTE overlay hanging below the card, so the CSS
 *    grid row height never changes and neighbours never gape.
 *  - The affordance is a real 32px chevron button in its own reserved slot on the
 *    meta row — it no longer floats over the meta text, and it no longer drifts to
 *    the bottom of a grown card where it was effectively unreachable.
 */

import { memo, useEffect, useRef, useState } from "react";
import type { FlowEvent, EnrichEvent } from "./FeedPane";
import { fmtNum } from "@/lib/finFormat";
import { makeFlowT, scoreComponentLabel } from "@/lib/flowdeskStrings";
import { flowSideLabel, statTokenLabel } from "@/lib/plainLabels";
import { RingGauge } from "../ui/RingGauge";

// ── Props ─────────────────────────────────────────────────────────────────────

interface FlowCardProps {
  ev: FlowEvent;
  /** v2 enrich data for this event (null when artifact absent/stale) */
  enrichEv: EnrichEvent | null;
  lang: "en" | "zh";
  selected: boolean;
  onSelect: (ev: FlowEvent) => void;
  /** Controlled expansion — FeedPane keeps at most one card open at a time. */
  expanded: boolean;
  /** Toggle expansion for this event id (functional toggle lives in FeedPane). */
  onToggleExpand: (id: string) => void;
}

// ── Badge helpers ─────────────────────────────────────────────────────────────

interface BadgeSet {
  whale: boolean;
  cluster: boolean;
  sweep: boolean;
  unusual: boolean;
  block: boolean;
}

function deriveBadges(ev: FlowEvent): BadgeSet {
  return {
    whale:   ev.premium >= 1_000_000,
    cluster: ev.repeated === true,
    sweep:   ev.n_prints >= 3 && ev.swept === true,
    unusual: ev.premium_z != null && ev.premium_z >= 2,
    block:   ev.n_prints === 1 && ev.size >= 5000,
  };
}

// ── OTM pct computation ───────────────────────────────────────────────────────

function otmPct(ev: FlowEvent): string {
  if (ev.spot == null) return ev.mny_bucket.replace("_", " ");
  const diff = ((ev.strike - ev.spot) / ev.spot) * 100;
  const sign = diff >= 0 ? "+" : "";
  return `${sign}${diff.toFixed(1)}%`;
}

// ── Premium formatting ────────────────────────────────────────────────────────

function fmtPremium(v: number): string {
  return "$" + fmtNum(v, { decimals: 1 });
}

// ── Time formatting ───────────────────────────────────────────────────────────

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("en-US", {
      hour: "2-digit", minute: "2-digit", hour12: false,
      timeZone: "America/New_York",
    });
  } catch {
    return iso.slice(11, 16);
  }
}

// ── Score tone (auto via RingGauge) ──────────────────────────────────────────
// RingGauge "auto" maps ≥70→brand, ≥50→up, ≥30→muted, <30→down.
// No extra color logic needed here.

// ── Component ─────────────────────────────────────────────────────────────────

// Memoized to avoid re-rendering all 200 cards on every poll tick or selection change.
// Only re-renders when its own event data, selection state, enrich data, or lang changes.
export const FlowCard = memo(function FlowCard({
  ev, enrichEv, lang, selected, onSelect, expanded, onToggleExpand,
}: FlowCardProps) {
  const zh = lang === "zh";
  const [tipVisible, setTipVisible] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = `fc-detail-${ev.id}`;

  // The panel hangs BELOW the card as an overlay, so a card near the bottom of the
  // feed viewport would otherwise open off-screen and read as "nothing happened".
  // block:"nearest" scrolls the feed by the minimum needed and nothing else.
  useEffect(() => {
    if (!expanded) return;
    panelRef.current?.scrollIntoView({ block: "nearest" });
  }, [expanded]);

  // Score is precomputed server-side and attached to the event (ev.flowScore).
  const fs = ev.flowScore;
  const score = fs && !isNaN(fs.score) ? fs.score : 0;
  const components = fs?.components ?? [];
  const badges = deriveBadges(ev);
  const t = makeFlowT(lang);

  // v2 enrichment — present only when artifact is fresh
  const hasEnrich = enrichEv !== null;
  const v2Badges = enrichEv?.badges ?? [];
  const directionDiscounted = enrichEv?.direction_discounted ?? false;

  const isCall = ev.right === "C";

  // Secondary detail flags — v2 detections when enrich is fresh, else the v1
  // client-derived set. Same gating as before; they now render as muted words
  // on the meta line instead of a colored badge rail.
  const flags: MetaFlagSpec[] = [];
  if (hasEnrich) {
    for (const b of v2Badges) {
      const labels = V2_BADGE_LABELS[b] ?? { en: b, zh: b };
      flags.push({ key: b, label: zh ? labels.zh : labels.en });
    }
  } else {
    if (badges.whale)   flags.push({ key: "whale",   label: zh ? "巨单" : "WHALE",   tip: t("badgeWhaleDesc") });
    if (badges.cluster) flags.push({ key: "cluster", label: zh ? "集群" : "CLUSTER", tip: t("badgeClusterDesc") });
    if (badges.sweep)   flags.push({ key: "sweep",   label: zh ? "扫单≈" : "SWEEP≈", tip: t("badgeSweepDesc") });
    if (badges.unusual) flags.push({ key: "unusual", label: zh ? "异常" : "UNUSUAL", tip: t("badgeUnusualDesc") });
    if (badges.block)   flags.push({ key: "block",   label: zh ? "大宗" : "BLOCK",   tip: t("badgeBlockDesc") });
  }

  return (
    <div
      className={`obs-card obs-fc-card${selected ? " sel" : ""}${expanded ? " open" : ""}`}
      // When the panel is open the card itself is the close affordance (alongside
      // the chevron, Esc and outside-click). Otherwise a card click selects, as before.
      onClick={() => { if (expanded) onToggleExpand(ev.id); else onSelect(ev); }}
      role="option"
      aria-selected={selected}
      data-tut="flow-card"
      data-fc-open={expanded ? "1" : undefined}
    >
      {/* ── Identity row: ticker / score ring / time ── */}
      <div className="obs-fc-row1">
        <span className="obs-fc-ticker">{ev.root}</span>

        {/* Score ring — compact sm size, magnitude tone (never asserted side) */}
        <span className="obs-fc-ring-wrap obs-fc-ring-inline">
          <RingGauge value={score} size="sm" tone="auto" />
        </span>

        <span className="obs-fc-time num">{fmtTime(ev.ts)}</span>
      </div>

      {/* ── Headline: the one primary number, then the one primary read ──
          Premium leads. The tinted tag carries CONTRACT TYPE (call/put) via the
          up/down tokens — the same recipe the old C/P chip used, so the
          East-Asian flip still rides the token. The lean pill next to it stays
          neutral: direction is never asserted with color. */}
      <div className="obs-fc-head">
        <span className="obs-fc-prem num">{fmtPremium(ev.premium)}</span>

        <span
          className="obs-tag obs-fc-read"
          style={{ "--c": isCall ? "var(--up)" : "var(--down)" } as React.CSSProperties}
        >
          {isCall ? t("typeCall") : t("typePut")}
        </span>

        {/* Lean chip — dashed border, neutral color.
            direction_discounted=true (spread detected): muted + unreliable-direction label. */}
        {directionDiscounted ? (
          <span
            className="obs-fc-lean"
            style={{ opacity: 0.5 }}
          >
            {t("spreadUnreliable")}
          </span>
        ) : (
          <span
            className="obs-fc-lean"
            onMouseEnter={() => setTipVisible(true)}
            onMouseLeave={() => setTipVisible(false)}
            aria-label={t("leanTooltip")}
          >
            {flowSideLabel(ev.side, lang)}
            {tipVisible && (
              <span style={LEAN_TIP_STYLE}>{t("leanTooltip")}</span>
            )}
          </span>
        )}
      </div>

      {/* ── Contract line: strike / exp / DTE ── */}
      <div className="obs-fc-line2">
        <span className="obs-fc-subtitle num">${ev.strike} · {ev.exp} · {ev.dte}d</span>
      </div>

      {/* ── Meta row: the muted facts WRAP inside their own column; the expand
             chevron owns a reserved 32px slot at the row's right edge so it can
             never sit on top of the text (the old absolute button did). ── */}
      <div className="obs-fc-line3">
        <span className="obs-fc-meta">
          <span className="num">{zh ? "张数" : "Size"} {ev.size.toLocaleString()}</span>
          {ev.oi != null && (
            <>
              <span className="obs-fc-meta-sep">·</span>
              <span className="num">{statTokenLabel("oi", lang)} {(ev.oi as number).toLocaleString()}</span>
            </>
          )}
          {ev.iv != null && (
            <>
              <span className="obs-fc-meta-sep">·</span>
              <span className="num">IV {((ev.iv as number) * 100).toFixed(1)}%</span>
            </>
          )}
          {flags.map((f) => (
            <span key={f.key} className="obs-fc-meta-flagwrap">
              <span className="obs-fc-meta-sep">·</span>
              <MetaFlag label={f.label} tip={f.tip} />
            </span>
          ))}
        </span>

        {/* Expand chevron — its own hit area (32×32), never over the meta text. */}
        <button
          type="button"
          className="obs-fc-expand-btn"
          onClick={(e) => { e.stopPropagation(); onToggleExpand(ev.id); }}
          aria-expanded={expanded}
          aria-controls={panelId}
          aria-label={expanded ? t("cardCollapse") : t("cardExpand")}
        >
          <svg viewBox="0 0 12 12" width="12" height="12" fill="none" aria-hidden="true">
            <path d="M3 4.5 6 7.5 9 4.5" stroke="currentColor" strokeWidth="1.6"
                  strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {/* ── Expanded detail — ABSOLUTE overlay below the card ──
          It is taken out of flow on purpose: the feed is a CSS grid, so an
          in-flow panel stretched the whole row and every neighbour gaped. */}
      {expanded && (
        <div
          ref={panelRef}
          id={panelId}
          className="obs-card obs-fc-detail"
          role="region"
          aria-label={t("inspectorComponents")}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="obs-fc-detail-hd">
            <span className="obs-lbl">{t("inspectorComponents")}</span>
            <button
              type="button"
              className="obs-fc-detail-close"
              onClick={(e) => { e.stopPropagation(); onToggleExpand(ev.id); }}
              aria-label={t("inspectorClose")}
            >
              <svg viewBox="0 0 12 12" width="11" height="11" fill="none" aria-hidden="true">
                <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {components.map((c) => {
            // The direction-reliability component is a PENALTY (negative). A raw
            // negative width is an invalid CSS length, so the old bar silently fell
            // back to full-width — the weakest input read as the strongest. Clamp,
            // and let the value carry the sign.
            const neg = c.value < 0;
            const pct = Math.max(0, Math.min(100, c.value));
            return (
              <div key={c.key} className={`obs-fc-comp-row${neg ? " neg" : ""}`}>
                <span className="obs-fc-comp-label">
                  {scoreComponentLabel(lang, c.key, c.label)}
                </span>
                <div className="obs-fc-comp-track">
                  <div className="obs-fc-comp-fill" style={{ width: `${pct}%` }} />
                </div>
                <span className="obs-fc-comp-val num">{c.value.toFixed(0)}</span>
              </div>
            );
          })}

          <div className="obs-note obs-fc-detail-honesty">
            {t("scoreHonesty")}
          </div>
          <div className="obs-fc-detail-note">
            {t("directionLean")}:{" "}
            <span style={{ color: "var(--text-2)" }}>
              {flowSideLabel(ev.side, lang)} — {t("tickRuleInferred")}
            </span>
          </div>
        </div>
      )}
    </div>
  );
});

// ── Meta flag sub-component ───────────────────────────────────────────────────
// v7: the former colored badge rail is demoted to muted words on the meta line.
// The honesty tooltips (sweep is heuristic, cluster is repeat-root, …) survive.

interface MetaFlagSpec {
  key: string;
  label: string;
  tip?: string;
}

function MetaFlag({ label, tip }: { label: string; tip?: string }) {
  const [vis, setVis] = useState(false);
  if (!tip) return <span className="obs-fc-metaflag">{label}</span>;
  return (
    <span
      className="obs-fc-metaflag obs-fc-metaflag-tip"
      onMouseEnter={() => setVis(true)}
      onMouseLeave={() => setVis(false)}
      aria-label={tip}
    >
      {label}
      {vis && (
        <span style={BADGE_TIP_STYLE}>{tip}</span>
      )}
    </span>
  );
}

// ── V2 detection labels (compact token from enrich artifact) ──────────────────

const V2_BADGE_LABELS: Record<string, { en: string; zh: string }> = {
  MULTI_LEG:    { en: "MULTI-LEG", zh: "多腿" },
  LADDER:       { en: "LADDER",    zh: "梯形" },
  REPEAT_HITTER:{ en: "REPEAT",    zh: "重复" },
  SIZE_VS_OI:   { en: "SZ>OI",     zh: "量超OI" },
  WHALE:        { en: "WHALE",     zh: "巨单" },
  FRESH:        { en: "FRESH",     zh: "新仓" },
  Z_OUTLIER:    { en: "Z-OUT",     zh: "Z异常" },
  OI_CONFIRMED: { en: "OI✓",      zh: "OI确认" },
};

// ── Tooltip styles ────────────────────────────────────────────────────────────

const LEAN_TIP_STYLE: React.CSSProperties = {
  position: "absolute",
  top: "calc(100% + 5px)",
  left: "50%",
  transform: "translateX(-50%)",
  whiteSpace: "normal",
  maxWidth: 220,
  background: "var(--panel-3)",
  border: "1px solid var(--line-3)",
  borderRadius: "var(--r-md)",
  padding: "6px 9px",
  font: "500 10.5px/1.4 var(--font-ui)",
  color: "var(--text-2)",
  zIndex: 50,
  pointerEvents: "none",
  boxShadow: "var(--shadow-1)",
};

const BADGE_TIP_STYLE: React.CSSProperties = {
  position: "absolute",
  bottom: "calc(100% + 6px)",
  left: "50%",
  transform: "translateX(-50%)",
  maxWidth: 240,
  whiteSpace: "normal",
  background: "var(--panel-3)",
  border: "1px solid var(--line-3)",
  borderRadius: "var(--r-md)",
  padding: "6px 9px",
  font: "500 10.5px/1.4 var(--font-ui)",
  color: "var(--text-2)",
  zIndex: 50,
  pointerEvents: "none",
  boxShadow: "var(--shadow-1)",
};
