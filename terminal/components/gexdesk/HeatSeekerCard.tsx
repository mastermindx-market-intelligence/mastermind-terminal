"use client";
/**
 * HeatSeekerCard — renders the matrix artifact's heat_seeker pick.
 *
 * §5.3: moved verbatim from components/prism/ when the PRISM tab was retired — it is
 * the ONLY consumer of the published `heat_seeker` field, so it rides into the Exposure
 * desk's right rail rather than dying with the tab. Strings moved to gexStrings.
 *
 * Shows: strike / expiry / lens / standout_ratio / confidence
 * Carries verbatim disclaimer: "descriptive — not a recommendation"
 * Hidden (with honest empty copy) when pick is null.
 *
 * Reads entirely from the artifact's heat_seeker field — no client-side gate logic.
 *
 * HONESTY DOCTRINE:
 *   - Disclaimer is non-removable and verbatim from spec.
 *   - No "buy/sell" language; no asserted direction.
 *   - When null: honest empty copy "No standout pick — load is shared."
 */

import React from "react";
import { makeGexT } from "./gexStrings";
import type { Lang } from "@/lib/i18n";
import { RingGauge } from "@/components/ui/RingGauge";

function expDate(exp: string): string {
  return (exp || "").split(" ")[0].split("T")[0];
}

// ─── Type (matches options_structure.matrix/v1 heat_seeker field) ─────────────

export interface HeatSeekerPick {
  strike: number | null;
  expiry: string;
  lens: string;
  standout_ratio: number | null;
  /**
   * A 0..1 FRACTION, never a "low"/"medium"/"high" tier. The builder
   * (macro `engine/options_matrix.py` `_heat_seeker`) emits
   * `round(min(1, (standout_ratio - 1) / 3), 2)`, and the contract dataclass
   * `MatrixHeatSeeker.confidence` is `float | None` — so absent is legal, but a
   * string never is. A tier string means a malformed payload: it reads as absent
   * rather than being mapped to an invented number.
   */
  confidence: number | null;
  note?: string;
}

interface HeatSeekerCardProps {
  pick: HeatSeekerPick | null;
  spot: number | null;
  /**
   * The session the PICK describes (`matrix._build_meta.asof_date`), so staleness and
   * DTE read off the same clock as the matrix grid. Null falls back to the wall clock.
   */
  sessionAnchor?: string | null;
  lang: Lang;
  /** The matrix read did not land: say so and offer a re-read, never "no standout pick". */
  readFailed?: boolean;
  onRetry?: () => void;
  /** The matrix is still being read: nothing is known yet, so nothing is claimed. */
  reading?: boolean;
  /**
   * The matrix is not published for this name (404/410). Nothing was said about how its
   * load is spread, so this is never "load is shared across levels".
   */
  absent?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtStrike(s: number): string {
  return s % 1 === 0 ? `$${s}` : `$${s.toFixed(1)}`;
}

function fmtExpiry(exp: string): string {
  // "2026-07-18" -> "Jul 18"
  try {
    const d = new Date(expDate(exp) + "T12:00:00Z");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return exp.slice(5);
  }
}

/**
 * Days to expiry measured from the SNAPSHOT's session, never the wall clock.
 *
 * The pick is published by the same nightly matrix build that feeds the grid beside it,
 * and that grid labels its columns off `_build_meta.asof_date`. Anchoring this card to
 * `Date.now()` put "0DTE" next to a column the grid called "3d" whenever the store lagged
 * a day — two different clocks describing one payload.
 */
function dteDays(exp: string, sessionAnchor: string | null): number {
  try {
    const base = sessionAnchor
      ? new Date(sessionAnchor + "T20:00:00Z").getTime()
      : Date.now();
    const ms = new Date(expDate(exp) + "T20:00:00Z").getTime();
    if (!Number.isFinite(ms) || !Number.isFinite(base)) return 0;
    return Math.max(0, Math.round((ms - base) / 86_400_000));
  } catch {
    return 0;
  }
}

function spotPct(strike: number, spot: number): string {
  const pct = ((strike - spot) / spot) * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

/** The contract's `float | None` fields arrive as null in real payloads. */
function finite(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Confidence fraction → ring percent, or null when there is no usable number.
 *
 * Returning null (rather than 0) is load-bearing: RingGauge maps a NaN value to a
 * displayed "0" in the weak/"down" tone, so an unusable confidence would render as
 * a confident-looking reading of zero instead of showing nothing.
 */
export function heatSeekerConfPct(confidence: unknown): number | null {
  const n = finite(confidence);
  if (n === null) return null;
  return Math.round(Math.min(1, Math.max(0, n)) * 100);
}

// ─── Component ────────────────────────────────────────────────────────────────

export function HeatSeekerCard({ pick, spot, sessionAnchor = null, lang, readFailed = false, onRetry, reading = false, absent = false }: HeatSeekerCardProps) {
  const t = makeGexT(lang);

  // Staleness is judged against the SNAPSHOT's session, not today: a Friday pick viewed
  // on Monday is still the pick that Friday's build published. Judging it by wall clock
  // made the whole card vanish every time the nightly matrix store lagged.
  //
  // And an unusable pick renders the honest empty state — it must never `return null`,
  // which silently removed the card from the rail with no explanation. (That was the
  // pre-existing bug that made the `heatSeekerNull` branch below unreachable: a null pick
  // hit the expiry guard first and returned nothing at all.)
  const expiryMs = pick?.expiry
    ? new Date(expDate(pick.expiry) + "T20:00:00Z").getTime()
    : NaN;
  // ONE wall-clock read, and only as the fallback when no session anchor was supplied
  // (a second `Date.now()` here would add a fresh impure-render site for no benefit).
  const parsedAnchor = sessionAnchor
    ? new Date(sessionAnchor + "T20:00:00Z").getTime()
    : NaN;
  const anchor = Number.isFinite(parsedAnchor) ? parsedAnchor : Date.now();
  const usable = !!pick && Number.isFinite(expiryMs) && expiryMs >= anchor;

  if (!usable && readFailed) {
    // A third fact: nothing is known about the pick, because the read did not land.
    return (
      <div className="obs-card" style={CARD_ERROR} data-testid="gex-heatseeker-error" role="alert">
        <span style={NULL_TEXT}>{t("heatSeekerError")}</span>
        {onRetry && (
          <button type="button" className="btn btn-ghost load-retry" onClick={onRetry}>
            {t("errorRetry")}
          </button>
        )}
      </div>
    );
  }

  if (!usable && reading) {
    return (
      <div className="obs-card" style={CARD_NULL} data-testid="gex-heatseeker-reading">
        <span style={NULL_TEXT}>{t("loading")}</span>
      </div>
    );
  }

  if (!usable && absent && !pick) {
    return (
      <div className="obs-card" style={CARD_NULL} data-testid="gex-heatseeker-absent">
        <span style={NULL_STAR}>☆</span>
        <span style={NULL_TEXT}>{t("heatSeekerAbsent")}</span>
      </div>
    );
  }

  if (!usable) {
    // Two different facts, two different sentences: nothing was published vs something
    // was published and has since expired. Collapsing them would assert "load is shared
    // across levels" about a chain the builder never said that about.
    const reason = pick ? "heatSeekerStale" : "heatSeekerNull";
    return (
      <div className="obs-card" style={CARD_NULL}>
        <span style={NULL_STAR}>☆</span>
        <span style={NULL_TEXT}>{t(reason)}</span>
      </div>
    );
  }

  const dte = dteDays(pick.expiry, sessionAnchor);
  const strike = finite(pick.strike);
  const ratio = finite(pick.standout_ratio);
  const pct = spot != null && strike != null ? spotPct(strike, spot) : null;
  const above = spot != null && strike != null ? strike >= spot : null;
  const confPct = heatSeekerConfPct(pick.confidence);

  return (
    <div className="obs-card" style={CARD_OUTER}>
      {/* Header */}
      <div className="obs-card-hd" style={CARD_HEADER}>
        <span style={PICK_STAR}>★</span>
        <span className="obs-lbl" style={{ flex: 1 }}>{t("heatSeekerTitle")}</span>
        <span className="obs-tag" style={CARD_LENS}>{pick.lens}</span>
      </div>

      {/* Disclaimer — verbatim, non-removable, always amber */}
      <div className="obs-note" style={DISCLAIMER_NOTE}>
        {t("heatSeekerDisclaimer")}
      </div>

      {/*
        One number, one reason: the STRIKE is the pick and carries the headline;
        its distance from spot is the direction tag; the standout ratio is the single
        reason the strike was chosen; everything else drops to one muted line below.
        Confidence is a 0..1 engine fraction — the ring shows it as a percent.
      */}
      <div style={PICK_BODY}>
        <div style={HEADLINE_COL}>
          <div style={HEADLINE_ROW}>
            <span className="num" style={HEADLINE_VALUE}>
              {strike != null ? fmtStrike(strike) : "—"}
            </span>
            {pct != null && (
              <span
                className="obs-tag num"
                style={{
                  ...DIR_TAG,
                  "--c": above ? "var(--up)" : "var(--down)",
                } as React.CSSProperties}
                aria-label={`${pct} ${t("heatSeekerFromSpot")}`}
              >
                {pct}
              </span>
            )}
          </div>
          <div style={REASON_ROW}>
            <span className="obs-lbl">{t("heatSeekerRatio")}</span>
            <span className="num" style={REASON_VALUE}>
              {ratio != null ? `${ratio.toFixed(2)}×` : "—"}
            </span>
          </div>
        </div>
        {confPct != null && (
          <RingGauge
            value={confPct}
            size="sm"
            tone="auto"
            label={t("heatSeekerConfUnit")}
          />
        )}
      </div>

      {/* Metadata — one muted line, never competing with the headline */}
      <div style={META_LINE}>
        {t("heatSeekerExpiry")}{" "}
        <span className="num">
          {fmtExpiry(pick.expiry)} · {dte === 0 ? "0DTE" : `${dte}d`}
        </span>
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const CARD_OUTER: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 0,
};

const CARD_NULL: React.CSSProperties = {
  alignItems: "center",
  justifyContent: "center",
  padding: "14px 12px",
  gap: 6,
  opacity: 0.6,
  display: "flex",
  flexDirection: "column",
};

// Not dimmed like CARD_NULL: a failed read is something the reader can act on.
const CARD_ERROR: React.CSSProperties = {
  alignItems: "center",
  justifyContent: "center",
  padding: "14px 12px",
  gap: 8,
  display: "flex",
  flexDirection: "column",
};

const NULL_STAR: React.CSSProperties = {
  fontSize: 16,
  color: "var(--muted)",
};

const NULL_TEXT: React.CSSProperties = {
  fontSize: 11,
  color: "var(--muted)",
  textAlign: "center",
  lineHeight: 1.4,
};

const CARD_HEADER: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
};

const DISCLAIMER_NOTE: React.CSSProperties = {
  margin: "0 10px 0",
  padding: "6px 10px",
  borderRadius: "var(--r-tile)",
  fontSize: 10,
  lineHeight: 1.4,
};

const PICK_BODY: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "var(--sp-3)",
  padding: "10px 12px 8px",
};

const PICK_STAR: React.CSSProperties = {
  fontSize: 13,
  color: "var(--signal)",
};

/** `.obs-tag` supplies the tint; only the dense metrics stay inline. */
const CARD_LENS: React.CSSProperties = {
  "--c": "var(--brand-2)",
  fontSize: 9,
  fontWeight: 800,
  letterSpacing: "0.09em",
  padding: "2px 7px",
} as React.CSSProperties;

const HEADLINE_COL: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--sp-2)",
  minWidth: 0,
};

const HEADLINE_ROW: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--sp-2)",
  flexWrap: "wrap",
};

/** The pick itself — the one number the card exists to show. */
const HEADLINE_VALUE: React.CSSProperties = {
  fontSize: "var(--fs-num)",
  fontWeight: 750,
  color: "var(--text)",
  letterSpacing: "-.01em",
  lineHeight: 1,
};

const DIR_TAG: React.CSSProperties = {
  fontSize: 9.5,
  fontWeight: 700,
  padding: "2px 7px",
};

const REASON_ROW: React.CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: 6,
};

const REASON_VALUE: React.CSSProperties = {
  fontSize: "var(--fs-emph)",
  fontWeight: 700,
  color: "var(--text-2)",
};

/** Everything that is not the pick or its reason lives on this one line. */
const META_LINE: React.CSSProperties = {
  padding: "0 12px 11px",
  fontSize: 10,
  color: "var(--muted)",
  letterSpacing: "0.02em",
};
