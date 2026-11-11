"use client";
/**
 * ExpiryBars — per-expiration signed net-exposure bar chart ("Exposure by Expiration").
 *
 * Companion to StrikeLadder: same greek lens, same bar aesthetic, but bucketed by
 * expiration date instead of strike. Reads `by_expiry[{exp, gamma_net, delta_net}]`
 * from the GEX payload — data we already fetch but only ever used as a filter dropdown.
 *
 * HONESTY: the by_expiry array carries gamma & delta only (no vanna/charm), so the
 * VEX/CHEX lenses render an honest "not provided per-expiration" state rather than
 * faking zeros. Bar direction (dealer-sign) is an assumption; magnitude is the read.
 * A row with no value for the active greek stays listed as "—" with no bar: switching the
 * greek never changes which expirations are shown, and an unknown is never drawn as 0.
 */

import React from "react";
import { makeGexT } from "./gexStrings";
import type { Lang } from "@/lib/i18n";
import type { GexPayload, GreekLens } from "./GexDeskView";
import { dteLabelFor, expLabel } from "@/lib/dte";
import { fmtMn } from "@/lib/gexLadder";

type ExpiryRow = NonNullable<GexPayload["by_expiry"]>[number];

interface ExpiryBarsProps {
  byExpiry: GexPayload["by_expiry"] | null;
  greek: GreekLens;
  /** as-of of the snapshot — anchors DTE captions (T-A / B7: never the wall clock). */
  asOf?: string | null;
  lang: Lang;
}

// ─── Helpers (mirror StrikeLadder formatting) ───────────────────────────────────
// Values and DTE both come from shared modules now: `by_expiry` is $mn like `by_strike`
// (engine/options_hub.py divides by 1e6), and every DTE on the desk is anchored to the
// snapshot's own session day.

/** Net exposure for an expiry under the active lens. by_expiry carries gamma+delta only. */
function expiryNet(r: ExpiryRow, greek: GreekLens): number | null {
  if (greek === "gamma") return Number.isFinite(r.gamma_net) ? r.gamma_net : null;
  if (greek === "delta") return r.delta_net != null && Number.isFinite(r.delta_net) ? r.delta_net : null;
  return null; // vanna / charm not provided per-expiration
}

// ─── Component ──────────────────────────────────────────────────────────────────

export function ExpiryBars({ byExpiry, greek, asOf = null, lang }: ExpiryBarsProps) {
  const t = makeGexT(lang);

  // Vanna/charm aren't available per-expiration — honest state, not faked zeros.
  if (greek === "vanna" || greek === "charm") {
    return <div style={EMPTY}>{t("expiryLensNA")}</div>;
  }

  const rows = (byExpiry ?? [])
    .slice()
    .sort((a, b) => a.exp.localeCompare(b.exp)); // nearest expiration first (top)

  if (!rows.some((r) => expiryNet(r, greek) != null)) {
    return <div style={EMPTY}>{t("expiryNoData")}</div>;
  }

  const maxAbs = rows.reduce((m, r) => {
    const v = expiryNet(r, greek);
    return v != null ? Math.max(m, Math.abs(v)) : m;
  }, 0.001);

  return (
    <div style={SCROLL} className="obs-scroll">
      <div style={CENTER_LINE} />
      {rows.map((r) => {
        const value = expiryNet(r, greek);
        const net = value ?? 0;
        const isPos = net >= 0;
        const pct = Math.abs(net) / maxAbs;
        const shaped = Math.pow(pct, 0.7);
        const barW = Math.max(shaped * 46, pct > 0 ? 2 : 0);
        const isBig = pct > 0.35;
        return (
          <div key={r.exp} style={ROW}>
            <div style={EXP_COL}>
              <span style={EXP_LABEL}>{expLabel(r.exp)}</span>
              <span style={DTE_LABEL}>{dteLabelFor(r.exp, asOf)}</span>
            </div>
            <div style={BAR_AREA}>
              {value != null && !isPos && barW > 0 && (
                <div style={{ ...BAR_NEG, width: `${barW}%`, opacity: isBig ? 1 : 0.75 }} />
              )}
              {value != null && isPos && barW > 0 && (
                <div style={{ ...BAR_POS, width: `${barW}%`, opacity: isBig ? 1 : 0.75 }} />
              )}
            </div>
            <span
              className="num"
              style={{ ...VAL, color: value == null ? "var(--text-dim)" : isPos ? "var(--up)" : "var(--down)" }}
            >
              {fmtMn(value)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Styles (mirror StrikeLadder's bar language) ────────────────────────────────

const SCROLL: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  position: "relative",
};

const CENTER_LINE: React.CSSProperties = {
  position: "absolute",
  left: "calc(70px + (100% - 142px) / 2)",
  top: 0,
  bottom: 0,
  width: 1,
  background: "rgba(255,255,255,0.10)",
  pointerEvents: "none",
  zIndex: 1,
};

const ROW: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "70px 1fr 72px",
  alignItems: "center",
  height: 22,
  borderBottom: "1px solid rgba(255,255,255,0.04)",
  position: "relative",
};

const EXP_COL: React.CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: 4,
  padding: "0 6px",
  overflow: "hidden",
};

const EXP_LABEL: React.CSSProperties = {
  fontSize: 11,
  fontVariantNumeric: "tabular-nums",
  color: "var(--text-2)",
  flexShrink: 0,
};

const DTE_LABEL: React.CSSProperties = {
  fontSize: 9,
  color: "var(--muted)",
  fontVariantNumeric: "tabular-nums",
  flexShrink: 0,
};

const BAR_AREA: React.CSSProperties = {
  position: "relative",
  height: "100%",
  display: "flex",
  alignItems: "center",
};

const BAR_POS: React.CSSProperties = {
  position: "absolute",
  left: "50%",
  height: 11,
  borderRadius: "0 2px 2px 0",
  background: "linear-gradient(90deg, rgba(var(--up-rgb),0.45), rgba(var(--up-rgb),0.85))",
  transition: "width 0.35s cubic-bezier(.22,1,.36,1)",
};

const BAR_NEG: React.CSSProperties = {
  position: "absolute",
  right: "50%",
  height: 11,
  borderRadius: "2px 0 0 2px",
  background: "linear-gradient(270deg, rgba(var(--down-rgb),0.45), rgba(var(--down-rgb),0.85))",
  transition: "width 0.35s cubic-bezier(.22,1,.36,1)",
};

const VAL: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  textAlign: "right",
  paddingRight: 8,
  fontVariantNumeric: "tabular-nums",
};

const EMPTY: React.CSSProperties = {
  flex: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  textAlign: "center",
  padding: "24px 20px",
  fontSize: 12,
  color: "var(--muted)",
  lineHeight: 1.5,
};
