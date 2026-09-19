"use client";
/**
 * ExposureExpiryDrawer — collapsible bottom drawer on the GEX (Exposure) desk rendering the
 * term structure of net exposure across expirations (RECON §4.5), in our obs idiom.
 *
 * Two views over the SAME by_expiry payload:
 *   - Bubbles: x = expiration (DTE-ordered), y = net exposure, bubble size ∝ |net|,
 *     sign colour via var(--up)/var(--down). A term-structure scatter.
 *   - Bars: reuses the existing <ExpiryBars> (its horizontal ± bar language), unchanged.
 *
 * HONESTY: by_expiry carries NET only (no call/put split) → the drawer is labelled Net-only.
 * It is an EOD structural read (the by_expiry snapshot), NOT intraday — it does not
 * participate in the replay scrubber and stamps its as-of as EOD. Vanna/charm aren't provided
 * per-expiration → an honest "not per-expiration" state, never faked zeros. Bar/bubble
 * direction (dealer-sign) is an assumption; magnitude is the read.
 *
 * T-B: that "does not participate" is now VISIBLE rather than implicit. While the workspace
 * scrubber is off the live head, the drawer wears EodReplayTag — it keeps showing the close
 * it actually describes and says outright that it did not travel with the scrubber.
 */

import React, { useMemo, useState } from "react";
import { makeGexT } from "./gexStrings";
import { ExpiryBars } from "./ExpiryBars";
import { EodReplayTag } from "@/components/surface/EodReplayTag";
import type { Lang } from "@/lib/i18n";
import type { GexPayload, GreekLens } from "./GexDeskView";
import { byExpiryToTermStructure, type ExpiryRow } from "@/lib/expiryTermStructure";
import { fmtMn } from "@/lib/gexLadder";

interface Props {
  byExpiry: GexPayload["by_expiry"] | null;
  greek: GreekLens;
  /** The gex payload's as-of (EOD). Anchors deterministic DTE + the honest as-of stamp. */
  asOf: string | null;
  lang: Lang;
}

type View = "bubbles" | "bars";

// `by_expiry` values are $mn (engine/options_hub.py divides those columns by 1e6) — the
// desk's local formatter used to read them as billions and printed a $4.9bn expiration as
// "-4949.61B". lib/gexLadder.ts now owns one formatter per unit.

export function ExposureExpiryDrawer({ byExpiry, greek, asOf, lang }: Props) {
  const t = makeGexT(lang);
  // Keep the high-value ladder and Market State card full-height on entry. The term
  // structure remains one click away and owns its own scroll region when expanded.
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("bubbles");

  const ts = useMemo(
    () => byExpiryToTermStructure((byExpiry as ExpiryRow[] | null) ?? null, greek, asOf),
    [byExpiry, greek, asOf],
  );

  const count = ts.nodes.length;

  return (
    /* --inline: the drawer now sits inside the desk's LEFT column (see GexDeskView
       XDRAWER_SLOT) instead of spanning the desk below both panes, so it must be able to
       shrink to the slot it is given and let its own body scroll. The modifier is
       namespaced — a bare `.inline` would collide across the obs family. */
    <div className="obs-xdrawer obs-xdrawer--inline" style={XDRAWER_ROOT}>
      <button
        className="obs-xdrawer-hd"
        style={{ flexShrink: 0 }}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="obs-xdrawer-body"
      >
        <span className={`obs-xdrawer-caret${open ? " open" : ""}`} aria-hidden>▶</span>
        <span className="obs-lbl">{t("xdrawerTitle")}</span>
        <span className="obs-xdrawer-count">
          {count} {t("xdrawerExp")} · {t("dataEod")}
        </span>
        {/* On the header, not in the body — the tag has to be true whether the drawer is
            open or collapsed. */}
        <EodReplayTag lang={lang} />
      </button>

      {open && (
        <div className="obs-xdrawer-body" id="obs-xdrawer-body" style={XDRAWER_BODY}>
          {/* Toolbar: Bubbles | Bars + Net-only badge */}
          <div className="obs-xdrawer-toolbar">
            <div style={{ display: "flex", gap: 3 }} role="group" aria-label={t("xdrawerViewAria")}>
              <button
                className={`obs-chip${view === "bubbles" ? " on" : ""}`}
                style={TOGGLE_CHIP}
                aria-pressed={view === "bubbles"}
                onClick={() => setView("bubbles")}
              >
                {t("xdrawerBubbles")}
              </button>
              <button
                className={`obs-chip${view === "bars" ? " on" : ""}`}
                style={TOGGLE_CHIP}
                aria-pressed={view === "bars"}
                onClick={() => setView("bars")}
              >
                {t("xdrawerBars")}
              </button>
            </div>
            {/* Net-only is the ONLY track the payload supports — labelled, not a toggle. */}
            <span style={NET_BADGE}>{t("xdrawerNet")}</span>
          </div>

          {/* Body */}
          {!ts.available ? (
            <div className="obs-xdrawer-empty">{t("xdrawerNA")}</div>
          ) : count === 0 ? (
            <div className="obs-xdrawer-empty">{t("xdrawerEmpty")}</div>
          ) : view === "bubbles" ? (
            <BubbleField ts={ts} t={t} />
          ) : (
            // Bars view reuses the existing ExpiryBars component unchanged.
            <div style={{ display: "flex", flexDirection: "column", maxHeight: 168, overflowY: "auto" }}>
              <ExpiryBars byExpiry={byExpiry} greek={greek} asOf={asOf} lang={lang} />
            </div>
          )}

          {/* Honesty: Net-only + EOD, not intraday. */}
          <div className="obs-note obs-xdrawer-note">{t("xdrawerNetOnly")}</div>
        </div>
      )}
    </div>
  );
}

// ─── Bubble term-structure field (SVG) ──────────────────────────────────────────
// x = expiration in DTE order, y = net exposure (zero line centered), r ∝ |net|.
// SVG metrics (positions/anchors) are computed in JS; text is HTML-in-<foreignObject>-free
// (plain <text>) with values also shown as node labels so the read never depends on font
// metrics. Colours via var(--up)/var(--down) (East-Asian flip aware) — no direction hex.

function BubbleField({ ts, t }: { ts: ReturnType<typeof byExpiryToTermStructure>; t: ReturnType<typeof makeGexT> }) {
  // Give every expiry a real slot. A fixed 680px viewBox put 20–30 labels on top of
  // one another; this expands horizontally and lets the drawer scroll instead.
  const slotW = 68;
  const W = Math.max(840, ts.nodes.length * slotW);
  const H = 190;
  const padL = 34;
  const padR = 34;
  const padT = 24;
  const padB = 34;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const n = ts.nodes.length;
  const midY = padT + plotH / 2;

  // y scales to ±maxAbs; a node's center sits above (pos) / below (neg) the zero line.
  const yFor = (net: number) => {
    if (ts.maxAbs <= 0) return midY;
    return midY - (net / ts.maxAbs) * (plotH / 2 - 10);
  };
  const xFor = (i: number) => (n <= 1 ? padL + plotW / 2 : padL + (i / (n - 1)) * plotW);
  const rFor = (frac: number) => 5 + Math.sqrt(Math.max(0, frac)) * 17;

  return (
    <div className="obs-xdrawer-plot obs-scroll">
      {/* R1/R2 (components/charts/svgChart.ts): the viewBox is 1:1 with CSS px and
          preserveAspectRatio="none" is gone. It used to stretch a 190-unit box into the
          container's 204px, so every bubble rendered as a 7%-tall ellipse and the value
          labels were sheared. The field still scrolls horizontally at its natural width. */}
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ display: "block" }} role="img"
        aria-label={t("exposureByExpiry")}>
        {/* Quiet horizontal guides keep positive/negative distance legible. */}
        {[0.25, 0.75].map((p) => (
          <line key={p} x1={padL} y1={padT + plotH * p} x2={W - padR} y2={padT + plotH * p}
            stroke="var(--line-2)" strokeWidth={1} />
        ))}
        {/* Zero line */}
        <line x1={padL} y1={midY} x2={W - padR} y2={midY} stroke="var(--line-3)" strokeWidth={1} strokeDasharray="3 3" />
        {ts.nodes.map((node, i) => {
          const cx = xFor(i);
          const cy = yFor(node.net);
          const r = rFor(node.frac);
          const col = node.isPos ? "var(--up)" : "var(--down)";
          return (
            <g key={node.exp}>
              <circle
                cx={cx} cy={cy} r={r}
                fill={col} fillOpacity={0.28}
                stroke={col} strokeOpacity={0.9} strokeWidth={1.2}
              />
              {/* value label above/below the bubble depending on sign */}
              <text
                x={cx} y={node.isPos ? Math.max(12, cy - r - 5) : Math.min(H - padB + 4, cy + r + 12)}
                textAnchor="middle" fontSize={10} fontWeight={650} fill={col}
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {fmtMn(node.net)}
              </text>
              {/* DTE label on the x axis */}
              <text
                x={cx} y={H - 9}
                textAnchor="middle" fontSize={10} fill="var(--muted)"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {node.dteLabel}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

/**
 * Column-scoped flex mechanics. `.obs-xdrawer` is flex-shrink:0 in observatory.css, which is
 * right for a full-width desk footer but wrong now that the drawer lives inside the left
 * column's height budget (GexDeskView XDRAWER_SLOT caps it): unshrinkable, it would overflow
 * the slot and get clipped by the column. Shrinkable root + `0 1 auto` body means the body's
 * own overflow-y:auto absorbs whatever the slot cannot give it — expand and collapse are pure
 * re-flows of this column and never touch the Market State card next door.
 *
 * These are inline so the containment is self-contained; the equivalent
 * `.obs-xdrawer--inline` rules are offered as a CSS patch if the stylesheet is preferred.
 */
const XDRAWER_ROOT: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  flexShrink: 1,
};

const XDRAWER_BODY: React.CSSProperties = {
  flex: "0 1 auto",
  minHeight: 0,
};

const TOGGLE_CHIP: React.CSSProperties = { height: 22, minWidth: 46, fontSize: 10.5, fontWeight: 600, padding: "0 8px" };

const NET_BADGE: React.CSSProperties = {
  marginLeft: "auto",
  fontSize: 9.5,
  fontWeight: 600,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--muted)",
  padding: "2px 7px",
  border: "1px solid var(--line)",
  borderRadius: 5,
};
