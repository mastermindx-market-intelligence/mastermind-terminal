"use client";
/**
 * MarketStateCard — renders the gex_state payload (options_structure.gex_state/v1).
 *
 * Pass 3 (MomoEdge parity) — right rail density:
 *   MARKET STATE: regime chip (large colored label) + thesis line
 *   STABILITY: ring gauge
 *   Three metric blocks exactly matching MomoEdge spirit:
 *     γ POLARITY  — LONG/SHORT γ DOMINANT + net dealer gamma regime caption + dominance %
 *     HEDGE PRESSURE — HIGH/LOW + size of dealer hedging flow caption + |net γ| value
 *     PIN TARGET — strike + probability, or — when null
 *   Structural range bar: horizontal track put-support → call-wall, spot marker,
 *     flip marker, gradient fill.
 *   WHAT-IF-FLIP-BREAKS scenario boxes.
 *   Passport .obs-note (always at bottom).
 *
 * HONESTY DOCTRINE (non-negotiable):
 *   - Passport caveat chip is always visible.
 *   - Single-name near-constant note shown when is_index_product=false.
 *   - Regime theses are structural descriptions — not trade forecasts.
 *   - No "validated", "predictive", or direction-assertive copy.
 *   - Computed values (γ dominance %, hedge pressure threshold) documented inline.
 *
 * Props:
 *   statePayload  — /api/flow?f=gexstate:<ROOT> (schema v1) | null
 *   gexPayload    — main GEX payload (for structural range bar and what-if)
 *   isIndexProduct — whether the root is an index ETF
 *   lang          — "en" | "zh"
 */

import React, { useMemo } from "react";
import { makeGexT } from "./gexStrings";
import type { Lang } from "@/lib/i18n";
import type { GexPayload } from "./GexDeskView";
import { RingGauge } from "@/components/ui/RingGauge";
import { Tip } from "@/components/ui/Tip";
// R3.2: the regime colour table lives in lib/mscGlance.ts so the desk and every
// glance surface (screener columns, watchlist dot, ticker block) read ONE table.
import { REGIME_COLORS } from "@/lib/mscGlance";
import { regimeLabel as plainRegime } from "@/lib/plainLabels";

// ─── Schema (gexstate/v1) ────────────────────────────────────────────────────

export interface GexStatePayload {
  schema: "options_structure.gex_state/v1";
  asof: string;
  root: string;
  state: "PIN" | "DRIFT" | "RANGE" | "TRANSITION" | "TREND" | "CASCADE" | "UNKNOWN";
  stability_pct: number;          // 0-100
  net_gamma: "POSITIVE" | "NEGATIVE" | "UNKNOWN";
  gravity: {
    up_pct: number;
    down_pct: number;
    direction: "up" | "down" | "neutral";
  };
  pin_target?: {
    strike: number;
    probability: number;          // 0-100
  } | null;
  cascade_trigger?: {
    strike: number;
    confidence: number;
  } | null;
  upside_trigger?: {
    strike: number;
    confidence: number;
  } | null;
  structural_range?: {
    low: number;
    high: number;
  } | null;
  is_index_product: boolean;
  // Extended fields from richer fixture (tolerated-optional)
  net_gex_bn?: number | null;
  gamma_flip?: number | null;
  dist_to_flip_pct?: number | null;   // spot's % distance from the flip level (signed: + = spot above flip)
  call_wall?: number | null;
  put_wall?: number | null;
  magnet?: number | null;
  spot?: number | null;
  // LIVE-schema aliases (options_structure.gex_state/v1 as published) — the card
  // was written against the fixture's field names; these are the real ones.
  gamma_regime?: GexStatePayload["state"];
  pin_probability?: number | null;      // 0..1 fraction (fixture pin_target.probability is 0-100)
  gravity_direction?: "up" | "down" | "neutral";
  gravity_up_pct?: number | null;
}

// ─── Regime colors ────────────────────────────────────────────────────────────

/**
 * Flip violet. `--cat-2` is referenced all over this desk but is defined nowhere in the
 * token set, so every `var(--cat-2)` site silently fell back (invisible markers, plain-text
 * values). `--ai` is defined and is the identical hue (#9d86ff) — kept behind --cat-2 so a
 * real definition would still win.
 */
const FLIP_VIOLET = "var(--cat-2, var(--ai))";

// (regime colours: see the REGIME_COLORS import at the top — one table for every surface)

// ─── Derived metrics ──────────────────────────────────────────────────────────

/**
 * γ POLARITY: dominance % = posGex / (posGex + |negGex|) * 100
 * Derived from by_strike in gexPayload (not statePayload).
 * Returns { pct: number, isLong: boolean } or null when insufficient data.
 */
function computeGammaPolarity(
  strikes: GexPayload["by_strike"]
): { pct: number; isLong: boolean } | null {
  if (!strikes || strikes.length === 0) return null;
  let posSum = 0;
  let negSum = 0;
  for (const s of strikes) {
    if (s.gamma_net > 0) posSum += s.gamma_net;
    else negSum += Math.abs(s.gamma_net);
  }
  const total = posSum + negSum;
  if (total <= 0) return null;
  const pct = (posSum / total) * 100;
  return { pct, isLong: pct >= 50 };
}

/**
 * HEDGE PRESSURE: HIGH when |net_gex_bn| > threshold (0.5B), LOW otherwise.
 * Threshold documented here — not externally validated.
 */
const HEDGE_PRESSURE_HIGH_THRESHOLD_BN = 0.5;

function computeHedgePressure(netGexBn: number | null | undefined): {
  level: "HIGH" | "LOW";
  absVal: number | null;
} {
  if (netGexBn == null || !Number.isFinite(netGexBn)) {
    return { level: "LOW", absVal: null };
  }
  const absVal = Math.abs(netGexBn);
  return {
    level: absVal >= HEDGE_PRESSURE_HIGH_THRESHOLD_BN ? "HIGH" : "LOW",
    absVal,
  };
}

function fmtBn(val: number | null): string {
  if (val == null) return "";
  if (val >= 1) return `${val.toFixed(2)}B`;
  if (val >= 0.001) return `${(val * 1000).toFixed(1)}M`;
  return `${(val * 1e6).toFixed(0)}K`;
}

function fmtLevel(val: number | null | undefined): string {
  if (val == null || !Number.isFinite(val)) return "—";
  return val % 1 === 0 ? String(val) : val.toFixed(1);
}

/** Which fixed scale a pin-probability FIELD is documented in — see `normalizePinProbability`. */
export type ProbabilityScale = "percent" | "fraction" | "auto";

/**
 * Pin probability — shape guard (bug B6; scale-per-field fix follow-up).
 *
 * Two producers publish this field on two scales: the fixture's `pin_target.probability`
 * is 0-100 (documented on the interface above) while the live schema's `pin_probability`
 * is a 0..1 fraction. The scale is a property of the FIELD, never of the value in hand —
 * so callers that know which field they are reading MUST say so via `scale`:
 *   - `"percent"`  — `pin_target.probability`. Never multiplied.
 *   - `"fraction"` — `pin_probability`. Always ×100.
 *
 * `scale: "auto"` (the default) is reserved for an UNFORESEEN third producer whose scale
 * isn't documented anywhere yet. It applies the old value-shape heuristic (>1 ⇒ already a
 * percent) but — unlike the original bug — never GUESSES inside the ambiguous (0, 1] seam:
 * a percent-scale reading of 1 (meaning 1%, e.g. a low-confidence far magnet) and a
 * fraction-scale reading of 1 (meaning 100%) are indistinguishable by value alone, and the
 * old code silently picked the fraction reading every time — turning a 1% confidence read
 * into a confident "100%". That range now returns null (an honest "can't tell") instead of
 * a guess; only an explicit `scale` can resolve it.
 *
 * Every result is clamped to 0-100; an absent/garbage/negative value returns null so the
 * caller can print an em dash instead of a confident "0%".
 */
export function normalizePinProbability(
  raw: number | null | undefined,
  scale: ProbabilityScale = "auto",
): number | null {
  if (raw == null || !Number.isFinite(raw) || raw < 0) return null;
  if (scale === "fraction") return Math.max(0, Math.min(100, Math.round(raw * 100)));
  if (scale === "percent") return Math.max(0, Math.min(100, Math.round(raw)));
  // auto: unforeseen-producer heuristic — never guesses inside the ambiguous seam.
  if (raw > 0 && raw <= 1) return null;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/**
 * StructuralRangeBar: horizontal track from put_wall→call_wall with
 * spot marker and flip marker. Gradient fill (teal positive side / neutral).
 */
function StructuralRangeBar({
  low,
  high,
  spot,
  flip,
  t,
}: {
  low: number;
  high: number;
  spot: number | null;
  flip: number | null;
  t: ReturnType<typeof makeGexT>;
}) {
  const range = high - low;
  if (range <= 0) return null;

  const spotPct =
    spot != null
      ? Math.max(0, Math.min(100, ((spot - low) / range) * 100))
      : null;
  const flipPct =
    flip != null
      ? Math.max(0, Math.min(100, ((flip - low) / range) * 100))
      : null;

  return (
    <div style={RANGE_BAR_WRAP}>
      <div style={RANGE_BAR_LABELS}>
        <span style={RANGE_BAR_LBL}>{fmtLevel(low)}</span>
        <span style={{ ...RANGE_BAR_LBL, opacity: 0.5 }}>{t("statePutSupp")}</span>
        <span style={{ ...RANGE_BAR_LBL, opacity: 0.5 }}>{t("stateCallWall")}</span>
        <span style={{ ...RANGE_BAR_LBL, textAlign: "right" }}>
          {fmtLevel(high)}
        </span>
      </div>
      <div style={RANGE_BAR_TRACK}>
        {/* Gradient fill: from put_wall to flip = negative tint, flip to call_wall = positive tint */}
        {flipPct != null ? (
          <>
            <div
              style={{
                ...RANGE_BAR_FILL_NEG,
                width: `${flipPct}%`,
              }}
            />
            <div
              style={{
                ...RANGE_BAR_FILL_POS,
                left: `${flipPct}%`,
                width: `${100 - flipPct}%`,
              }}
            />
          </>
        ) : (
          <div style={{ ...RANGE_BAR_FILL_POS, width: "100%" }} />
        )}
        {/* Flip marker */}
        {flipPct != null && (
          <div
            style={{
              ...RANGE_BAR_MARKER,
              left: `${flipPct}%`,
              background: FLIP_VIOLET,
              boxShadow: `0 0 6px ${FLIP_VIOLET}`,
            }}
          />
        )}
        {/* Spot marker */}
        {spotPct != null && (
          <div
            style={{
              ...RANGE_BAR_MARKER,
              left: `${spotPct}%`,
              background: "var(--signal)",
              boxShadow: "0 0 6px var(--signal)",
              height: 14,
              top: -3,
            }}
          />
        )}
      </div>
      {/* Sub-labels: FLIP and SPOT positions */}
      <div style={{ position: "relative", height: 14 }}>
        {flipPct != null && (
          <span
            style={{
              ...RANGE_BAR_SUB_LBL,
              left: `${Math.min(flipPct, 85)}%`,
              color: FLIP_VIOLET,
            }}
          >
            {t("stateFlipMark")}
          </span>
        )}
        {spotPct != null && (
          <span
            style={{
              ...RANGE_BAR_SUB_LBL,
              left: `${Math.min(spotPct, 85)}%`,
              color: "var(--signal)",
              marginTop: 0,
            }}
          >
            {t("stateSpotMark")}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * WhatIfFlipBreaks: 3 scenario boxes at put_support, flip, call_wall.
 */
function WhatIfFlipBreaks({
  low,
  flip,
  high,
  t,
}: {
  low: number | null;
  flip: number | null;
  high: number | null;
  t: ReturnType<typeof makeGexT>;
}) {
  if (low == null && flip == null && high == null) return null;
  return (
    <div style={WHATIF_WRAP}>
      <span style={WHATIF_TITLE}>{t("stateWhatIf")}</span>
      <div style={WHATIF_BOXES}>
        {low != null && (
          <div style={WHATIF_BOX}>
            <span style={{ ...WHATIF_BOX_VAL, color: "var(--down)" }}>
              {fmtLevel(low)}
            </span>
            <span style={WHATIF_BOX_LBL}>{t("statePutSupp")}</span>
          </div>
        )}
        {flip != null && (
          <div
            style={{
              ...WHATIF_BOX,
              borderColor: "color-mix(in srgb, var(--ai) 25%, transparent)",
            }}
          >
            <span style={{ ...WHATIF_BOX_VAL, color: FLIP_VIOLET }}>
              {fmtLevel(flip)}
            </span>
            <span style={WHATIF_BOX_LBL}>{t("stateFlipMark")}</span>
          </div>
        )}
        {high != null && (
          <div style={WHATIF_BOX}>
            <span style={{ ...WHATIF_BOX_VAL, color: "var(--brand-2)" }}>
              {fmtLevel(high)}
            </span>
            <span style={WHATIF_BOX_LBL}>{t("stateCallWall")}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface MarketStateCardProps {
  statePayload: GexStatePayload | null;
  gexPayload?: GexPayload | null;
  isIndexProduct: boolean;
  lang: Lang;
}

export function MarketStateCard({
  statePayload,
  gexPayload,
  isIndexProduct,
  lang,
}: MarketStateCardProps) {
  const t = makeGexT(lang);

  const passportText = t("passportIndex");
  const singleNameNote = !isIndexProduct ? t("passportSingleName") : null;
  const gateNote = t("passportGate");

  // Derived: γ polarity from gex payload strikes
  const gammaPolarity = useMemo(
    () => computeGammaPolarity(gexPayload?.by_strike ?? []),
    [gexPayload?.by_strike]
  );

  // Derived: hedge pressure
  const netGexBn = statePayload?.net_gex_bn ?? gexPayload?.net_gex_bn ?? null;
  const hedgePressure = useMemo(
    () => computeHedgePressure(netGexBn),
    [netGexBn]
  );

  // Level sources: prefer statePayload fields (richer), fall back to gexPayload
  const callWall = statePayload?.call_wall ?? gexPayload?.call_wall ?? null;
  const putWall = statePayload?.put_wall ?? gexPayload?.put_wall ?? null;
  const flipLevel = statePayload?.gamma_flip ?? gexPayload?.gamma_flip ?? null;
  const spotRef = statePayload?.spot ?? gexPayload?.spot_ref ?? null;

  if (!statePayload) {
    return (
      <div className="obs-card obs-scroll obs-gex-state" style={CARD_OUTER} data-tut="gex-state-card">
        <div className="obs-card-hd" style={CARD_HEADER}>
          <span className="obs-lbl">{t("stateTitle")}</span>
        </div>
        <div style={PLACEHOLDER}>
          <span style={PLACEHOLDER_TEXT}>{t("stateComputing")}</span>
        </div>
        <PassportBlock
          passportText={passportText}
          singleNameNote={singleNameNote}
          gateNote={gateNote}
        />
      </div>
    );
  }

  // Normalize live schema → the fields this card renders. Live gexstate publishes
  // gamma_regime / net_gex_bn-sign / magnet+pin_probability; the card was written
  // against the fixture's state / net_gamma / pin_target{} (blank hero otherwise).
  const state = statePayload.state ?? statePayload.gamma_regime ?? "UNKNOWN";
  const netGamma: "POSITIVE" | "NEGATIVE" | "UNKNOWN" =
    statePayload.net_gamma ?? (netGexBn != null ? (netGexBn >= 0 ? "POSITIVE" : "NEGATIVE") : "UNKNOWN");
  const regimeColor = REGIME_COLORS[state] ?? "var(--muted)";
  const thesisKey = (`thesis${state}` as Parameters<typeof t>[0]);
  const thesisText = t(thesisKey) || t("thesisUNKNOWN");
  const regimeLabel = plainRegime(t, state, lang);

  const stabilityPct = Math.round(statePayload.stability_pct ?? 0);

  // Distance from spot to the gamma-flip level, % of spot — how close we are to a
  // long-γ ↔ short-γ regime change (the most actionable dealer-positioning read).
  // Prefer the published field; else derive it. Signed: + = spot above flip.
  const distToFlipPct = statePayload.dist_to_flip_pct
    ?? (spotRef != null && flipLevel != null && spotRef !== 0
        ? ((spotRef - flipLevel) / spotRef) * 100
        : null);

  // Pin target: strike from either schema; probability through the B6 shape guard, keyed
  // per FIELD (never guessed from the value) so a low-confidence percent-scale reading in
  // (0, 1] can never be multiplied into a false near-100% read. `probability: null` is a
  // real state (strike known, confidence not published) and renders as an em dash rather
  // than a fabricated 0%.
  const pinStrike = statePayload.pin_target?.strike ?? statePayload.magnet ?? null;
  const pinProbability =
    statePayload.pin_target?.probability != null
      ? normalizePinProbability(statePayload.pin_target.probability, "percent")
      : normalizePinProbability(statePayload.pin_probability, "fraction");
  const pin = pinStrike != null ? { strike: pinStrike, probability: pinProbability } : null;

  const range = statePayload.structural_range ?? (
    callWall != null && putWall != null
      ? { low: putWall, high: callWall }
      : null
  );

  return (
    <div className="obs-card obs-scroll obs-gex-state" style={CARD_OUTER} data-tut="gex-state-card">
      {/* ── Header: title only ──────────────────────────────────────────────── */}
      <div className="obs-card-hd" style={CARD_HEADER}>
        <span className="obs-lbl">{t("stateTitle")}</span>
      </div>

      {/* ── Regime group ─────────────────────────────────────────────────────
          REGIME-DYNAMICS LAW: a state label never stands alone. The regime name, its
          γ-polarity, its stability and its distance to the flip now live in ONE bounded
          section railed in the regime's own colour — you cannot read "PIN" without
          reading how stable it is and how far the flip sits. Nothing is recomputed: the
          γ-polarity chip is the Net-γ readout that used to sit detached in the stats
          column, and the regime chip that used to float in the card header is this
          section's own hero (it said the same word twice). */}
      <div style={{ ...REGIME_GROUP, borderLeftColor: regimeColor } as React.CSSProperties}>
        <div style={REGIME_HEAD}>
          {/* Large state label — the translated regime name, not the raw enum key. In EN
              the two read identically (PIN/PIN); in ZH the chip said 锁定 while the hero
              still said "PIN", the last English leak on this card. */}
          <span style={{ ...STATE_HERO, color: regimeColor }}>{regimeLabel}</span>
          {/* γ polarity — the sign that produces the regime, riding with its name.
              --up/--down (not brand/--down): under html[data-updown="east"] the old pair
              left POSITIVE blue while NEGATIVE turned green, so the two stopped reading
              as opposites. */}
          <span
            className="obs-tag"
            style={{
              "--c":
                netGamma === "POSITIVE"
                  ? "var(--up)"
                  : netGamma === "NEGATIVE"
                  ? "var(--down)"
                  : "var(--muted)",
              marginLeft: "auto",
            } as React.CSSProperties}
          >
            {t("stateNetGamma")}{" "}
            {netGamma === "POSITIVE"
              ? t("stateGammaPos")
              : netGamma === "NEGATIVE"
              ? t("stateGammaNeg")
              : "—"}
          </span>
        </div>

        {/* Thesis */}
        <div style={THESIS}>{thesisText}</div>

        {/* ── Stability ring ────────────────────────────────────────────────── */}
        <div style={STAB_ROW}>
          <RingGauge
            value={stabilityPct}
            size="md"
            tone={
              netGamma === "POSITIVE"
                ? "up"
                : netGamma === "NEGATIVE"
                ? "down"
                : "muted"
            }
            label={t("stateStability")}
          />
          <div style={STAB_META}>
            <div style={STAB_STAT}>
              <span className="obs-lbl">{t("stateStability")}</span>
              <span className="num" style={STAB_VAL}>
                {stabilityPct}%
              </span>
            </div>
            {distToFlipPct != null && (
              <div style={STAB_STAT}>
                <Tip label={t("stateDistToFlipTip")} side="left" size="card">
                  <span className="obs-lbl" style={{ cursor: "help" }}>{t("stateDistToFlip")}</span>
                </Tip>
                <span className="num" style={{ ...STAB_VAL, fontWeight: 700 }}>
                  {Math.abs(distToFlipPct).toFixed(2)}%{" "}
                  <span style={{ color: "var(--muted)", fontWeight: 400 }}>
                    {distToFlipPct >= 0 ? t("stateAboveFlip") : t("stateBelowFlip")}
                  </span>
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="obs-card-hr" />

      {/* ── Structural range bar ─────────────────────────────────────────────── */}
      {range && (
        <div style={SECTION_PAD}>
          <span className="obs-lbl">{t("stateRange")}</span>
          <StructuralRangeBar
            low={range.low}
            high={range.high}
            spot={spotRef}
            flip={flipLevel}
            t={t}
          />
        </div>
      )}

      {/* ── What-if flip breaks ──────────────────────────────────────────────── */}
      <div style={SECTION_PAD}>
        <WhatIfFlipBreaks
          low={putWall}
          flip={flipLevel}
          high={callWall}
          t={t}
        />
      </div>

      <div className="obs-card-hr" />

      {/* ── γ POLARITY block ─────────────────────────────────────────────────── */}
      <div style={METRIC_BLOCK}>
        <span className="obs-lbl">{t("statePolarity")}</span>
        <div style={METRIC_BLOCK_BODY}>
          <span
            style={{
              ...METRIC_BLOCK_HERO,
              color:
                gammaPolarity == null
                  ? "var(--muted)"
                  : gammaPolarity.isLong
                  ? "var(--up)"
                  : "var(--down)",
            }}
          >
            {gammaPolarity == null
              ? "—"
              : gammaPolarity.isLong
              ? t("statePolarityLong")
              : t("statePolarityShort")}
          </span>
          <span style={METRIC_BLOCK_CAPTION}>{t("statePolarityCaption")}</span>
          {gammaPolarity != null && (
            <span
              className="num"
              style={{
                fontSize: "var(--fs-body)",
                fontWeight: 700,
                color: gammaPolarity.isLong ? "var(--up)" : "var(--down)",
              }}
            >
              {gammaPolarity.pct.toFixed(0)}%
            </span>
          )}
        </div>
      </div>

      <div className="obs-card-hr" />

      {/* ── HEDGE PRESSURE block ─────────────────────────────────────────────── */}
      <div style={METRIC_BLOCK}>
        <span className="obs-lbl">{t("stateHedgePressure")}</span>
        <div style={METRIC_BLOCK_BODY}>
          <span
            style={{
              ...METRIC_BLOCK_HERO,
              /* Hedge pressure is a MAGNITUDE (health), not a direction — so it must not
                 ride --up/--down. LOW used to render in the bull hue, which inverted under
                 the East-Asian flip and read as a directional call either way. */
              color:
                hedgePressure.level === "HIGH"
                  ? "var(--signal)"
                  : "var(--text-2)",
            }}
          >
            {hedgePressure.level === "HIGH" ? t("stateHedgeHigh") : t("stateHedgeLow")}
          </span>
          <span style={METRIC_BLOCK_CAPTION}>
            {t("stateHedgeCaption")}
          </span>
          {hedgePressure.absVal != null && (
            <span
              className="num"
              style={{ fontSize: "var(--fs-micro)", color: "var(--muted)" }}
            >
              {t("stateHedgeAbs")} {fmtBn(hedgePressure.absVal)}
            </span>
          )}
        </div>
      </div>

      <div className="obs-card-hr" />

      {/* ── PIN TARGET block ─────────────────────────────────────────────────── */}
      <div style={METRIC_BLOCK}>
        <span className="obs-lbl">{t("statePinTarget")}</span>
        <div style={METRIC_BLOCK_BODY}>
          {pin ? (
            <>
              <span
                className="num"
                style={{ ...METRIC_BLOCK_HERO, color: FLIP_VIOLET }}
              >
                {fmtLevel(pin.strike)}
              </span>
              <span style={METRIC_BLOCK_CAPTION}>
                {t("statePinCaption")}
              </span>
              {/* Not a calibrated probability — see statePinProbTip. The glance-tier
                  number stays; the hover carries the honesty disclosure. */}
              <Tip label={t("statePinProbTip")} side="left" size="card">
                <span
                  className="num"
                  style={{ fontSize: "var(--fs-micro)", color: "var(--muted)", cursor: "help" }}
                >
                  {pin.probability == null ? t("statePinNone") : `${pin.probability}%`}{" "}
                  {t("statePinProb")}
                </span>
              </Tip>
            </>
          ) : (
            <span style={{ fontSize: "var(--fs-ui)", color: "var(--muted)" }}>{t("statePinNone")}</span>
          )}
        </div>
      </div>

      {/* Passport (always at bottom) */}
      <PassportBlock
        passportText={passportText}
        singleNameNote={singleNameNote}
        gateNote={gateNote}
      />
    </div>
  );
}

// ─── Passport block ───────────────────────────────────────────────────────────

function PassportBlock({
  passportText,
  singleNameNote,
  gateNote,
}: {
  passportText: string;
  singleNameNote: string | null;
  gateNote: string;
}) {
  return (
    <div style={PASSPORT_BLOCK}>
      <div
        className="obs-note"
        style={{
          margin: 0,
          padding: "var(--sp-2) var(--sp-3)",
          fontSize: "var(--fs-micro)",
          lineHeight: 1.5,
          borderRadius: "var(--r-tile)",
        }}
      >
        {passportText}
        {singleNameNote && (
          <>
            <br />
            {singleNameNote}
          </>
        )}
        <br />
        <span style={{ opacity: 0.7 }}>{gateNote}</span>
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

/**
 * CONTAINMENT (v7b, re-homed in §5.3): the rail's width, left edge and — critically —
 * its bounded scroll region now live ONE level up, on GexDeskView's RIGHT_RAIL, because
 * the rail holds two cards (HeatSeeker + this one) instead of one. The invariant is
 * unchanged and still load-bearing: the rail is sized only by the desk's two-pane row,
 * so a drawer opening in the LEFT column can never change this card's scroll geometry —
 * that was what left it "pushed up" with its header parked off-screen after a collapse.
 * `minHeight:0` here lets the card shrink inside that rail rather than forcing it taller.
 */
const CARD_OUTER: React.CSSProperties = {
  borderRadius: 0,
  display: "flex",
  flexDirection: "column",
  minWidth: 0,
  maxWidth: "100%",
  minHeight: 0,
};

const CARD_HEADER: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--sp-2)",
};

/**
 * One bounded section holding the regime name AND everything that qualifies it
 * (γ-polarity, stability, distance to flip). The 2px rail carries the regime's own
 * colour, so the group reads as a single verdict rather than a label with orphaned
 * statistics scattered below it.
 */
const REGIME_GROUP: React.CSSProperties = {
  /* Full-bleed so the 3px rail lands on the card edge; inner rows carry --sp-3, which
     puts their text at 15px — level with the --sp-4 sections below. */
  borderLeft: "3px solid var(--muted)",
  background: "color-mix(in srgb, var(--panel-2) 55%, transparent)",
  paddingBottom: "var(--sp-1)",
};

const REGIME_HEAD: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--sp-2)",
  padding: "var(--sp-2) var(--sp-3) 0",
  flexWrap: "wrap",
};

const STATE_HERO: React.CSSProperties = {
  fontSize: "var(--fs-num)",
  fontWeight: 900,
  letterSpacing: "0.05em",
  lineHeight: 1.1,
  textTransform: "uppercase",
};

const THESIS: React.CSSProperties = {
  fontSize: "var(--fs-label)",
  color: "var(--text-2)",
  lineHeight: 1.5,
  padding: "var(--sp-1) var(--sp-3) var(--sp-2)",
  fontStyle: "italic",
};

const STAB_ROW: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--sp-3)",
  padding: "0 var(--sp-3) var(--sp-2)",
};

const STAB_META: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--sp-1)",
  flex: 1,
  minWidth: 0,
};

const STAB_STAT: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "var(--sp-1)",
};

const STAB_VAL: React.CSSProperties = {
  fontSize: "var(--fs-label)",
  fontFamily: "var(--font-num)",
  fontVariantNumeric: "tabular-nums",
  color: "var(--text-2)",
};

const SECTION_PAD: React.CSSProperties = {
  padding: "var(--sp-2) var(--sp-4) var(--sp-1)",
};

const METRIC_BLOCK: React.CSSProperties = {
  padding: "var(--sp-2) var(--sp-4)",
};

const METRIC_BLOCK_BODY: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--sp-1)",
  marginTop: "var(--sp-1)",
};

const METRIC_BLOCK_HERO: React.CSSProperties = {
  fontSize: "var(--fs-body)",
  fontWeight: 800,
  letterSpacing: "0.04em",
  lineHeight: 1.2,
};

const METRIC_BLOCK_CAPTION: React.CSSProperties = {
  fontSize: "var(--fs-micro)",
  color: "var(--muted)",
  lineHeight: 1.4,
};

// Structural range bar
const RANGE_BAR_WRAP: React.CSSProperties = {
  marginTop: "var(--sp-2)",
};

const RANGE_BAR_LABELS: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "auto 1fr 1fr auto",
  gap: "var(--sp-1)",
  marginBottom: "var(--sp-1)",
};

const RANGE_BAR_LBL: React.CSSProperties = {
  fontSize: "var(--fs-micro)",
  color: "var(--muted)",
  fontFamily: "var(--font-num)",
  fontVariantNumeric: "tabular-nums",
};

const RANGE_BAR_TRACK: React.CSSProperties = {
  position: "relative",
  height: 8,
  background: "var(--line-2)",
  borderRadius: "var(--r-pill)",
  overflow: "hidden",
};

/* The two halves of the track are the long-γ and short-γ sides of the flip — a gamma
   SIGN pair, so they ride --up/--down and flip together under data-updown="east".
   Previously hardcoded rgba(77,130,255)/rgba(240,86,107): the negative half flipped
   hue in East mode while the positive half stayed blue. */
const RANGE_BAR_FILL_POS: React.CSSProperties = {
  position: "absolute",
  top: 0,
  bottom: 0,
  background:
    "linear-gradient(90deg, rgba(var(--up-rgb),0.18), rgba(var(--up-rgb),0.38))",
};

const RANGE_BAR_FILL_NEG: React.CSSProperties = {
  position: "absolute",
  left: 0,
  top: 0,
  bottom: 0,
  background:
    "linear-gradient(90deg, rgba(var(--down-rgb),0.18), rgba(var(--down-rgb),0.12))",
};

const RANGE_BAR_MARKER: React.CSSProperties = {
  position: "absolute",
  width: 2,
  height: 8,
  top: 0,
  transform: "translateX(-50%)",
  borderRadius: 1,
};

const RANGE_BAR_SUB_LBL: React.CSSProperties = {
  position: "absolute",
  top: 0,
  fontSize: "var(--fs-micro)",
  fontWeight: 700,
  letterSpacing: "0.06em",
  transform: "translateX(-50%)",
};

// What-if boxes
const WHATIF_WRAP: React.CSSProperties = {
  marginTop: "var(--sp-1)",
};

const WHATIF_TITLE: React.CSSProperties = {
  fontSize: "var(--fs-micro)",
  fontWeight: 700,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "var(--muted)",
  display: "block",
  marginBottom: "var(--sp-1)",
};

const WHATIF_BOXES: React.CSSProperties = {
  display: "flex",
  gap: "var(--sp-1)",
};

const WHATIF_BOX: React.CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: "var(--sp-1)",
  padding: "var(--sp-2) var(--sp-1)",
  background: "var(--panel-2)",
  border: "1px solid var(--hairline)",
  borderRadius: "var(--r-tile)",
};

const WHATIF_BOX_VAL: React.CSSProperties = {
  fontSize: "var(--fs-body)",
  fontWeight: 800,
  fontFamily: "var(--font-num)",
  fontVariantNumeric: "tabular-nums",
  lineHeight: 1,
};

const WHATIF_BOX_LBL: React.CSSProperties = {
  /* was 7.5px — below the desk's 10px legibility floor. */
  fontSize: "var(--fs-micro)",
  color: "var(--muted)",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  textAlign: "center",
  lineHeight: 1.2,
};

const PLACEHOLDER: React.CSSProperties = {
  flex: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "var(--sp-4)",
};

const PLACEHOLDER_TEXT: React.CSSProperties = {
  fontSize: "var(--fs-label)",
  color: "var(--muted)",
  fontStyle: "italic",
  textAlign: "center",
  lineHeight: 1.5,
};

const PASSPORT_BLOCK: React.CSSProperties = {
  padding: "var(--sp-2) var(--sp-3)",
  marginTop: "auto",
};
