"use client";
/**
 * ExposureMatrix — the Exposure desk's strike × expiry matrix view (masterplan §5.3).
 *
 * This is where the retired PRISM tab's worthwhile half landed: the controls it did
 * better (expiry column count, 0DTE / ALL scope, strike window, per-column vs global
 * normalisation, the pinned Σ column, the level badges) now sit on the desk that
 * already owned the ladder, the levels and the gexstate feed.
 *
 * WHAT DID NOT COME ACROSS, and why:
 *   • PRISM's own grid renderer — it painted RAW gex on --up-rgb/--down-rgb, the
 *     opposite colouring of the same payload on the Positioning tab, and it inverted
 *     under html[data-updown="east"] on a quantity that is not a price direction.
 *     Both surfaces now render through components/shared/StrikeExpiryMatrix.
 *   • The GEX/VEX/UNUSUAL lens names — VEX and UNUSUAL were permanently disabled chips,
 *     and VEX is already a LIVE greek lens on this desk's ladder. The matrix speaks the
 *     Positioning card's metric set instead: net hedge / OI / volume / ΔOI.
 *   • OiMoversRail — a duplicate of the Screener tab's ΔOI Builds preset over the same
 *     flowGet("oi") payload. Not ported; the Screener owns that read.
 *
 * HONESTY: the matrix store is a NIGHTLY EOD snapshot. The provenance chip states the
 * session the CELLS describe — which is not always the ladder's session — and there is
 * deliberately no live chrome anywhere on this view.
 */

import React, { useMemo, useState } from "react";
import { makeGexT, type GexDeskKey } from "./gexStrings";
import type { Lang } from "@/lib/i18n";
import type { MatrixDoc } from "./matrixDoc";
import {
  buildMatrixUnusualRail,
  type ExactContractUnusualFlag,
  type ExactSideReceipt,
  type MatrixOptionSide,
  type MatrixUnusualRailModel,
} from "./matrixUnusual";
import { MatrixConfluence } from "./MatrixConfluence";
import {
  StrikeExpiryMatrix,
  buildMatrixGrid,
  LEVEL_BADGE_COLORS,
  LEVEL_BADGE_ORDER,
  type LevelBadgeKey,
  type MatrixLevels,
  type MatrixMetric,
  type MatrixNorm,
  type MatrixScope,
} from "@/components/shared/StrikeExpiryMatrix";

// ─── Control vocabularies ─────────────────────────────────────────────────────

type Mode = "single" | "confluence";
type DteColCount = 4 | 8;
/**
 * Strike window each side of spot, in PERCENT — comparable across roots, unlike a strike
 * COUNT (PRISM's original), which meant ±40 dollars on SPY and ±200 on a $5-spaced name.
 *
 * Sized against a PROD ladder, not the thin fixture: real SPY publishes ~281 strikes at
 * $1 spanning roughly ±19% of spot, so a ±20% and a ±40% window both clamped to the whole
 * ladder and produced the SAME $5-bucket grid — two chips, one picture. These three
 * diverge: ±3% keeps native $1 rows inside DESK_MAX_ROWS, ±6% and ±12% coarsen and widen.
 * ±6% is the default (PRISM's old ±40-strikes default was ≈±5.3% on that ladder).
 */
type StrikeRangePct = 3 | 6 | 12;

const METRICS: { key: MatrixMetric; labelKey: GexDeskKey }[] = [
  { key: "hedge", labelKey: "mtxMetricHedge" },
  { key: "oi", labelKey: "mtxMetricOi" },
  { key: "vol", labelKey: "mtxMetricVol" },
  { key: "doi", labelKey: "mtxMetricDoi" },
];

const SCOPES: { key: MatrixScope; labelKey: GexDeskKey }[] = [
  { key: "default", labelKey: "scopeDefault" },
  { key: "0dte", labelKey: "scope0dte" },
  { key: "all", labelKey: "scopeAll" },
];

const RANGES: { key: StrikeRangePct; labelKey: GexDeskKey }[] = [
  { key: 3, labelKey: "range3" },
  { key: 6, labelKey: "range6" },
  { key: 12, labelKey: "range12" },
];

const NORMS: { key: MatrixNorm; labelKey: GexDeskKey }[] = [
  { key: "column", labelKey: "normColumn" },
  { key: "global", labelKey: "normGlobal" },
];

/** Row budget for the desk's matrix — roughly PRISM's ±40-strike depth. */
const DESK_MAX_ROWS = 81;

export interface ExposureMatrixProps {
  matrix: MatrixDoc | null;
  /** Merged levels — gexstate FIRST for the flip (see matrixDoc.mergeMatrixLevels). */
  levels: MatrixLevels;
  spot: number | null;
  /** Confluence mode refetches SPY/QQQ/IWM through the desk's own fetcher. */
  fetchMatrix: (root: string) => Promise<MatrixDoc | null>;
  lang: Lang;
}

export function ExposureMatrix({
  matrix,
  levels,
  spot,
  fetchMatrix,
  lang,
}: ExposureMatrixProps) {
  const t = makeGexT(lang);

  const [mode, setMode] = useState<Mode>("single");
  const [metric, setMetric] = useState<MatrixMetric>("hedge");
  const [scope, setScope] = useState<MatrixScope>("default");
  const [cols, setCols] = useState<DteColCount>(4);
  const [range, setRange] = useState<StrikeRangePct>(6);
  const [norm, setNorm] = useState<MatrixNorm>("column");

  // ALL scope makes Σ the primary read, so it must actually SHOW every expiry the
  // payload carries — a hard 8 shipped "ALL Σ" with "+3 later expirations not shown"
  // printed beside it. Capped at 16 so a 40-expiry LEAPS chain still renders.
  const nExpAll = matrix?.expiries?.length ?? 0;
  const effectiveCols: number = scope === "all" ? Math.min(16, Math.max(8, nExpAll)) : cols;

  const grid = useMemo(
    () =>
      buildMatrixGrid({
        matrix,
        spot,
        callWall: levels.call_wall,
        putWall: levels.put_support,
        metric,
        windowPct: range,
        maxRows: DESK_MAX_ROWS,
        maxCols: effectiveCols,
        normalization: norm,
        scope,
        withSigma: true,
      }),
    [matrix, spot, levels.call_wall, levels.put_support, metric, range, effectiveCols, norm, scope]
  );

  // IMPORTANT: raw cells, before buildMatrixGrid() coarsens strikes and sums sides.
  // This is an annotation rail, never a scalar lens and never a heatmap input.
  const unusualRail = useMemo(() => buildMatrixUnusualRail(matrix), [matrix]);

  const badgeLabel = (k: LevelBadgeKey) => t(k);

  // Provenance: the session the CELLS describe. The desk's asof chip above speaks for
  // the gex ladder, which can run a different session than this store.
  const matrixSession = grid?.sessionDate || (matrix?.asof ?? "").slice(0, 10);

  return (
    <div style={OUTER} className="obs-mtx-exposure">
      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div style={TOOLBAR}>
        <div style={CHIP_GROUP} role="group" aria-label={t("mtxModeAria")}>
          {(["single", "confluence"] as Mode[]).map((m) => (
            <button
              key={m}
              className={`chip${mode === m ? " on" : ""}`}
              style={CHIP}
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
            >
              {t(m === "single" ? "modeSingle" : "modeConfluence")}
            </button>
          ))}
        </div>

        <div style={SEP} />

        <div style={CHIP_GROUP} role="group" aria-label={t("mtxMetricAria")}>
          {METRICS.map((m) => (
            <button
              key={m.key}
              className={`chip${metric === m.key ? " on" : ""}`}
              style={CHIP}
              aria-pressed={metric === m.key}
              onClick={() => setMetric(m.key)}
            >
              {t(m.labelKey)}
            </button>
          ))}
        </div>

        {mode === "single" && (
          <>
            <div style={SEP} />

            <div style={CHIP_GROUP} role="group" aria-label={t("mtxColsAria")}>
              <span className="obs-lbl" style={GROUP_LBL}>{t("mtxColsLabel")}</span>
              {([4, 8] as DteColCount[]).map((n) => (
                <button
                  key={n}
                  className={`chip${cols === n && scope === "default" ? " on" : ""}`}
                  style={CHIP}
                  aria-pressed={cols === n && scope === "default"}
                  onClick={() => { setCols(n); setScope("default"); }}
                >
                  {n}
                </button>
              ))}
            </div>

            <div style={CHIP_GROUP} role="group" aria-label={t("mtxScopeAria")}>
              {SCOPES.map((sc) => (
                <button
                  key={sc.key}
                  className={`chip${scope === sc.key ? " on" : ""}`}
                  style={CHIP}
                  aria-pressed={scope === sc.key}
                  onClick={() => setScope(sc.key)}
                >
                  {t(sc.labelKey)}
                </button>
              ))}
            </div>

            <div style={SEP} />

            <div style={CHIP_GROUP} role="group" aria-label={t("mtxRangeAria")}>
              <span className="obs-lbl" style={GROUP_LBL}>{t("strikeRangeLabel")}</span>
              {RANGES.map((r) => (
                <button
                  key={r.key}
                  className={`chip${range === r.key ? " on" : ""}`}
                  style={CHIP}
                  aria-pressed={range === r.key}
                  onClick={() => setRange(r.key)}
                >
                  {t(r.labelKey)}
                </button>
              ))}
            </div>

            <div style={SEP} />

            <div style={CHIP_GROUP} role="group" aria-label={t("mtxNormAria")}>
              {NORMS.map((n) => (
                <button
                  key={n.key}
                  className={`chip${norm === n.key ? " on" : ""}`}
                  style={CHIP}
                  aria-pressed={norm === n.key}
                  onClick={() => setNorm(n.key)}
                >
                  {t(n.labelKey)}
                </button>
              ))}
            </div>
          </>
        )}

        {/* Provenance — nightly EOD, stated, with no live chrome anywhere near it. */}
        {mode === "single" && matrixSession && (
          <span style={PROV_CHIP} data-testid="matrix-asof">
            {t("mtxAsOfLabel")} <span className="num">{matrixSession}</span> · {t("mtxEodNote")}
          </span>
        )}
      </div>

      {/* ── Honesty banner (signed metrics only) ────────────────────────── */}
      {mode === "single" && (metric === "hedge" || metric === "doi") && (
        <div className="obs-note" style={BANNER}>{t("magnitudeFirst")}</div>
      )}

      {/* Exact-side EOD baseline — deliberately outside the shared heatmap renderer. */}
      {mode === "single" && matrix && (
        <ExactSideUnusualRail model={unusualRail} lang={lang} t={t} />
      )}

      {/* ── Body ────────────────────────────────────────────────────────── */}
      {mode === "confluence" ? (
        <MatrixConfluence fetchMatrix={fetchMatrix} metric={metric} lang={lang} />
      ) : !grid ? (
        <div style={EMPTY}>{t("mtxNone")}</div>
      ) : (
        <>
          <StrikeExpiryMatrix
            grid={grid}
            metric={metric}
            variant="desk"
            levels={levels}
            badgeLabel={badgeLabel}
            showSigma
            sigmaAria={t("mtxSigmaAria")}
            spotLabel={t("levelSpot")}
            strikeLabel={t("colStrike")}
          />

          {/* Level-marker legend — the badge key, so a WALL/FLIP tag never needs decoding */}
          <div style={LEGEND_ROW}>
            <span className="obs-lbl">{t("legendTitle")}</span>
            {LEVEL_BADGE_ORDER.map((k) => (
              <span
                key={k}
                className="obs-tag"
                style={{ ...BADGE, "--c": LEVEL_BADGE_COLORS[k] } as React.CSSProperties}
              >
                {t(k)}
              </span>
            ))}
            <span
              className="obs-tag"
              style={{ ...BADGE, "--c": "var(--brand-2)" } as React.CSSProperties}
            >
              {t("levelSpot")}
            </span>
          </div>

          {/* Foot: what the colour means, and what the window cut. */}
          <div style={FOOT}>
            {t(metric === "hedge" ? "mtxHedgeLegend" : metric === "doi" ? "mtxDoiLegend" : "mtxMagLegend")}
            {" · "}
            {t("mtxWindow")
              .replace("{p}", String(range))
              .replace("{n}", String(grid.strikes.length))
              .replace("{full}", String(grid.nAll))
              .replace("{e}", String(grid.exps.length))}
            {grid.bucket > 0 && grid.strikes.length < grid.nAll
              ? ` · ${t("mtxBucket").replace("{b}", String(grid.bucket))}`
              : ""}
            {grid.nExpAll > grid.exps.length
              ? ` · ${t("mtxMoreExp").replace("{n}", String(grid.nExpAll - grid.exps.length))}`
              : ""}
          </div>
        </>
      )}
    </div>
  );
}

function fmtContracts(value: number, lang: Lang): string {
  return value.toLocaleString(lang === "zh" ? "zh-CN" : "en-US", {
    maximumFractionDigits: 2,
  });
}

function stateCopyKey(state: MatrixUnusualRailModel["state"]): GexDeskKey {
  switch (state) {
    case "insufficient": return "mtxUnusualInsufficient";
    case "clear": return "mtxUnusualClear";
    case "malformed": return "mtxUnusualMalformed";
    case "unavailable": return "mtxUnusualUnavailable";
    case "flagged": return "mtxUnusualFlagged";
  }
}

function receiptCopyKey(receipt: ExactSideReceipt): GexDeskKey {
  if (receipt.availability !== "eligible") {
    return receipt.availability === "unavailable"
      ? "mtxUnusualReceiptUnavailable"
      : "mtxUnusualReceiptWithheld";
  }
  return receipt.status === "unusual"
    ? "mtxUnusualReceiptUnusual"
    : "mtxUnusualReceiptNormal";
}

function ExactSideReceiptRow({
  side,
  receipt,
  lang,
  t,
}: {
  side: MatrixOptionSide;
  receipt: ExactSideReceipt;
  lang: Lang;
  t: (key: GexDeskKey) => string;
}) {
  const sideKey = side === "call" ? "mtxUnusualCall" : "mtxUnusualPut";
  const receiptState = receipt.availability === "eligible" ? receipt.status : receipt.availability;
  return (
    <div
      className={`obs-mtx-unusual-receipt ${side} ${receiptState}`}
      data-testid="matrix-unusual-side"
      data-side={side}
      data-status={receiptState}
    >
      <div className="obs-mtx-unusual-receipt-top">
        <span
          className="obs-tag obs-mtx-unusual-side"
          style={{ "--c": side === "call" ? "var(--brand-2)" : "var(--ai)" } as React.CSSProperties}
        >
          {t(sideKey)}
        </span>
        <span className="obs-mtx-unusual-receipt-status">{t(receiptCopyKey(receipt))}</span>
        {receipt.availability === "eligible" && (
          <strong className="num obs-mtx-unusual-ratio">{receipt.ratio.toFixed(2)}×</strong>
        )}
      </div>
      {receipt.availability === "eligible" && (
        <div className="obs-mtx-unusual-meta">
          {t("mtxUnusualCurrent")} <span className="num">{fmtContracts(receipt.currentVolume, lang)}</span>
          {" · "}{t("mtxUnusualMedian")} <span className="num">{fmtContracts(receipt.medianVol30d, lang)}</span>
          {" · "}<span className="num">{receipt.samples}</span> {t("mtxUnusualSamples")}
        </div>
      )}
    </div>
  );
}

function ExactContractFlagCard({
  flag,
  lang,
  t,
}: {
  flag: ExactContractUnusualFlag;
  lang: Lang;
  t: (key: GexDeskKey) => string;
}) {
  return (
    <article
      className="obs-mtx-unusual-card"
      data-testid="matrix-unusual-contract"
      data-strike={String(flag.strike)}
      data-expiry={flag.expiry}
    >
      <div className="obs-mtx-unusual-card-top">
        <strong className="num obs-mtx-unusual-strike">
          {flag.strike.toLocaleString(lang === "zh" ? "zh-CN" : "en-US", { maximumFractionDigits: 3 })}
        </strong>
        <span className="num obs-mtx-unusual-expiry">{flag.expiry}</span>
      </div>
      <div className="obs-mtx-unusual-receipts">
        {(["call", "put"] as const).map((side) => (
          <ExactSideReceiptRow
            key={side}
            side={side}
            receipt={flag.sides[side]}
            lang={lang}
            t={t}
          />
        ))}
      </div>
    </article>
  );
}

function ExactSideUnusualRail({
  model,
  lang,
  t,
}: {
  model: MatrixUnusualRailModel;
  lang: Lang;
  t: (key: GexDeskKey) => string;
}) {
  const stateText = model.state === "flagged"
    ? t("mtxUnusualFlagged").replace("{n}", String(model.flags.length))
    : t(stateCopyKey(model.state));

  return (
    <section
      className="obs-mtx-unusual"
      aria-label={t("mtxUnusualAria")}
      data-testid="matrix-unusual-rail"
      data-state={model.state}
    >
      <div className="obs-mtx-unusual-head">
        <span className="obs-lbl">{t("mtxUnusualTitle")}</span>
        <span className="obs-mtx-unusual-rule">{t("mtxUnusualRule")}</span>
        <span
          className="obs-tag obs-mtx-unusual-authority"
          style={{ "--c": "var(--muted)" } as React.CSSProperties}
        >
          {t("mtxUnusualAuthority")}
        </span>
        <span className="obs-mtx-unusual-exact">{t("mtxUnusualExactNote")}</span>
        {model.state === "flagged" && (
          <span className="obs-mtx-unusual-summary" aria-live="polite">{stateText}</span>
        )}
      </div>

      {model.state === "flagged" ? (
        <div className="obs-mtx-unusual-track">
          {model.flags.map((flag) => (
            <ExactContractFlagCard
              key={`${flag.expiry}|${flag.strike}`}
              flag={flag}
              lang={lang}
              t={t}
            />
          ))}
        </div>
      ) : (
        <div className={`obs-mtx-unusual-state ${model.state}`} aria-live="polite">
          {stateText}
        </div>
      )}
    </section>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const OUTER: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  // When the desktop desk has a short vertical budget, fixed honesty/rail/legend rows
  // must not collapse the matrix to 0px. The desk grid keeps a small basis and this
  // container scrolls the whole dossier; tablet/mobile still get the taller page band.
  overflowX: "hidden",
  overflowY: "auto",
  overscrollBehavior: "contain",
  background: "var(--bg)",
};

const TOOLBAR: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  padding: "5px 10px",
  borderBottom: "1px solid var(--line)",
  background: "var(--panel)",
  flexShrink: 0,
  flexWrap: "wrap",
};

const CHIP_GROUP: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 3,
};

const GROUP_LBL: React.CSSProperties = {
  marginRight: 2,
};

const CHIP: React.CSSProperties = {
  height: 22,
  padding: "0 8px",
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.03em",
};

const SEP: React.CSSProperties = {
  width: 1,
  height: 18,
  background: "var(--line)",
  margin: "0 3px",
  flexShrink: 0,
};

const PROV_CHIP: React.CSSProperties = {
  marginLeft: "auto",
  fontSize: 9,
  color: "var(--muted)",
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
};

const BANNER: React.CSSProperties = {
  margin: 0,
  borderRadius: 0,
  borderLeft: "none",
  borderRight: "none",
  borderTop: "none",
  padding: "4px 10px",
  fontSize: 9,
  flexShrink: 0,
};

const LEGEND_ROW: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--sp-2)",
  flexWrap: "wrap",
  padding: "var(--sp-2) 10px",
  borderTop: "1px solid var(--line-2)",
  background: "var(--panel)",
  flexShrink: 0,
};

const BADGE: React.CSSProperties = {
  fontSize: 7.5,
  fontWeight: 800,
  letterSpacing: "0.06em",
  padding: "2px 5px",
  gap: 3,
};

const FOOT: React.CSSProperties = {
  padding: "4px 10px 6px",
  fontSize: 9,
  color: "var(--muted)",
  lineHeight: 1.5,
  borderTop: "1px solid var(--line-2)",
  background: "var(--panel)",
  flexShrink: 0,
};

const EMPTY: React.CSSProperties = {
  flex: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 12,
  color: "var(--muted)",
  padding: "var(--sp-5)",
  textAlign: "center",
};
