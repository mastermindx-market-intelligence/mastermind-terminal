"use client";
/**
 * ExpiryBars — per-expiration signed net-exposure bar chart ("Exposure by Expiration").
 *
 * Companion to StrikeLadder: same greek lens, same bar aesthetic, but bucketed by
 * expiration date instead of strike. Reads the owner-native `by_expiry` net exposures
 * from the GEX payload — data we already fetch but only ever used as a filter dropdown.
 *
 * HONESTY: current payloads may carry gamma/delta/vanna/charm; older archived payloads
 * legitimately omit VEX/CHEX. A missing lens renders the existing "not provided
 * per-expiration" state rather than faking zeros. Bar direction (dealer-sign) is an
 * assumption; magnitude is the read.
 */

import React from "react";
import { makeGexT } from "./gexStrings";
import type { Lang } from "@/lib/i18n";
import type { GexPayload, GreekLens } from "./GexDeskView";
import { fmtMn } from "@/lib/gexLadder";
import { dteLabelFor, expLabel } from "@/lib/dte";
import { byExpiryToTermStructure, expiryObservationFor, exposureSign, EXPIRY_UNIT_KEYS, type ExpiryRow } from "@/lib/expiryTermStructure";

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

// ─── Component ──────────────────────────────────────────────────────────────────

export function ExpiryBars({ byExpiry, greek, asOf = null, lang }: ExpiryBarsProps) {
  const t = makeGexT(lang);

  const sourceRows = (byExpiry ?? []) as ExpiryRow[];
  if (sourceRows.length < 1) {
    return <div style={EMPTY}>{t("expiryNoData")}</div>;
  }

  const ts = byExpiryToTermStructure(sourceRows, greek, asOf);
  if (ts.nodes.length < 1) {
    return <div style={EMPTY}>{t(ts.available ? "expiryNoData" : "expiryLensNA")}</div>;
  }
  // Preserve the complete expiry population when a neighboring value is missing.
  const rows = sourceRows.slice().sort((a, b) => a.exp.localeCompare(b.exp));
  const maxAbs = Math.max(ts.maxAbs, 0.001);
  const basis = t("expirySupportSummary").replace("{known}", String(ts.nodes.length))
    .replace("{total}", String(ts.sourceCount)).replace("{partial}", String(ts.partialCount));

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
      {(ts.missingCount > 0 || ts.partialCount > 0) && <p role="status" data-testid="expiry-support" style={{ fontSize: 11, color: "var(--muted)", margin: "4px 6px" }}>{basis}</p>}
      <div data-testid="expiry-unit" style={{ fontSize: 11, color: "var(--muted)", margin: "4px 6px" }}>{t(EXPIRY_UNIT_KEYS[greek])}</div>
      <div style={SCROLL} className="obs-scroll">
      <div style={CENTER_LINE} />
      {rows.map((r) => {
        const observation = expiryObservationFor(r, greek);
        const value = observation.net;
        const sign = value == null ? null : exposureSign(value);
        const isPos = sign === 1;
        const isNeg = sign === -1;
        const pct = value == null ? 0 : Math.abs(value) / maxAbs;
        const shaped = Math.pow(pct, 0.7);
        const barW = Math.max(shaped * 46, pct > 0 ? 2 : 0);
        const isBig = pct > 0.35;
        return (
          <div key={r.exp} data-expiry={r.exp} data-partial={observation.partial ? "true" : undefined}
            title={observation.partial ? `${t("expiryKnownSubtotal")} · ${observation.knownContracts}/${observation.admittedContracts} ${t("expiryAdmittedInputs")}` : undefined}
            style={{ ...ROW, height: observation.partial ? 32 : ROW.height }}>
            <div style={EXP_COL}>
              <span style={EXP_LABEL}>{expLabel(r.exp)}</span>
              <span style={DTE_LABEL}>{dteLabelFor(r.exp, asOf)}</span>
            </div>
            <div style={BAR_AREA}>
              {isNeg && barW > 0 && (
                <div style={{ ...BAR_NEG, width: `${barW}%`, opacity: isBig ? 1 : 0.75 }} />
              )}
              {isPos && barW > 0 && (
                <div style={{ ...BAR_POS, width: `${barW}%`, opacity: isBig ? 1 : 0.75 }} />
              )}
            </div>
            <span
              className="num"
              style={{
                ...VAL,
                color: value == null ? "var(--text-dim)" : isPos ? "var(--up)" : isNeg ? "var(--down)" : "var(--muted)",
              }}
            >
              {observation.partial && <small style={{ display: "block", fontSize: 9 }}>{t("expiryKnownSubtotal")}</small>}
              {fmtMn(value)}
            </span>
          </div>
        );
      })}
      </div>
      <p data-testid="expiry-source-basis" style={{ fontSize: 10, color: "var(--muted)", margin: "4px 6px" }}>{t("expirySourceBasis")}</p>
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
