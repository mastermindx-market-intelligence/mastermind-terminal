"use client";
/**
 * MatrixConfluence — SPY + QQQ + IWM side-by-side, aligned on % from spot.
 *
 * §5.3: ported from components/prism/ConfluenceView.tsx when the PRISM tab was retired.
 * Logic kept (bands, nearest-strike mapping, alignment detection, thresholds); TWO
 * things changed, both required by the merge:
 *
 *   1. COLOUR/SIGN. It painted RAW gex on --up-rgb/--down-rgb, so the same payload read
 *      the opposite way from the Positioning card AND inverted under the zh east
 *      convention on a quantity that is not a price direction. It now renders through
 *      components/shared/StrikeExpiryMatrix's metric law — net dealer hedge on the
 *      aggressor-side pair, which never flips.
 *   2. The `activeLens` prop was accepted and then never read — the metric control did
 *      nothing here. It is wired: the chips now move this grid too.
 *
 * Normalizes strikes to % from spot in fixed CONF_BANDS buckets:
 *   [-2.4 … 0 … +2.4] (13 rows, each mapping the nearest actual strike to its % offset)
 *
 * Alignment chips: when flip/wall/support levels land within 0.5% across >= 2 indices,
 * a chip appears in the alignment column.
 *
 * HONESTY DOCTRINE:
 *   - "descriptive — not a recommendation" on the panel header.
 *   - "Index-only, descriptive" under the alignment legend.
 *   - No "signal" language; alignment = structural observation.
 *   - Sign is assumed dealer-convention, caveated via the magnitudeFirst banner.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { makeGexT } from "./gexStrings";
import type { Lang } from "@/lib/i18n";
import type { MatrixDoc, MatrixRead } from "./matrixDoc";
import { flowInvalidate } from "@/lib/flowClientCache";
import {
  fmtMatrixCell,
  matrixCellTone,
  matrixCellValue,
  type MatrixLevels,
  type MatrixMetric,
} from "@/components/shared/StrikeExpiryMatrix";

// ─── Constants (confluence bands) ─────────────────────────────────────────────

const CONF_BANDS = [2.4, 2.0, 1.6, 1.2, 0.8, 0.4, 0, -0.4, -0.8, -1.2, -1.6, -2.0, -2.4];

const CONF_INDICES = ["SPY", "QQQ", "IWM"] as const;
type ConfIndex = typeof CONF_INDICES[number];

const ALIGNMENT_THRESHOLD = 0.5; // % — levels within this are "aligned"

// ─── Types ────────────────────────────────────────────────────────────────────

interface MatrixConfluenceProps {
  fetchMatrix: (root: string) => Promise<MatrixRead>;
  metric: MatrixMetric;
  lang: Lang;
}

interface IndexData {
  payload: MatrixDoc | null;
  loading: boolean;
  /** The last read did not land. A published absence is NOT an error. */
  error: boolean;
}

interface BucketRow {
  pct: number;          // % offset (e.g. +1.2, 0.0, -0.8)
  values: Record<ConfIndex, number | null>;  // metric value for the nearest strike
  nearestStrikes: Record<ConfIndex, number | null>;
}

/** gexStrings keys for the structural level markers this board can honestly claim. */
type LevelKey = "levelWall" | "levelSupport" | "levelMagnet";

interface AlignmentChip {
  pct: number;
  level: LevelKey;
  indices: ConfIndex[];
  count: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Snap a % offset to its nearest band — or null when it is off the board.
 *
 * Without the distance guard a level at +9% snapped to the +2.4% edge band and drew an
 * "aligned" chip on a row it has nothing to do with. BAND_TOLERANCE_PCT matches the 0.8%
 * tolerance computeBucketRows already applies to strikes, so the two halves of this grid
 * agree on what "near a band" means.
 */
const BAND_TOLERANCE_PCT = 0.8;

function nearestBucket(pct: number): number | null {
  let best = CONF_BANDS[0];
  let bestDist = Infinity;
  for (const b of CONF_BANDS) {
    const d = Math.abs(pct - b);
    if (d < bestDist) { bestDist = d; best = b; }
  }
  return bestDist > BAND_TOLERANCE_PCT ? null : best;
}

function fmtPct(p: number): string {
  const sign = p >= 0 ? "+" : "";
  return `${sign}${p.toFixed(1)}%`;
}

function fmtValue(v: number | null, metric: MatrixMetric): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return fmtMatrixCell(v, metric);
}

function computeBucketRows(
  payloads: Record<ConfIndex, MatrixDoc | null>,
  metric: MatrixMetric
): BucketRow[] {
  return CONF_BANDS.map((band) => {
    const values: Record<ConfIndex, number | null> = { SPY: null, QQQ: null, IWM: null };
    const nearestStrikes: Record<ConfIndex, number | null> = { SPY: null, QQQ: null, IWM: null };

    for (const idx of CONF_INDICES) {
      const payload = payloads[idx];
      if (!payload?.cells || payload.spot == null) continue;
      const spot = payload.spot;

      // Find the actual strike nearest this band's pct offset
      let bestStrike: number | null = null;
      let bestDist = Infinity;
      for (const s of payload.strikes ?? []) {
        const strikePct = ((s - spot) / spot) * 100;
        const d = Math.abs(strikePct - band);
        if (d < bestDist) { bestDist = d; bestStrike = s; }
      }
      if (bestStrike == null || bestDist > 0.8) continue; // tolerance 0.8%

      nearestStrikes[idx] = bestStrike;

      // Near-term read: the first published expiry, through the SHARED metric law
      // (net hedge for the signed metric — never raw gex).
      const firstExp = payload.expiries?.[0];
      if (!firstExp) continue;
      const cell = payload.cells.find(
        (c) => c.strike === bestStrike && c.expiry === firstExp
      );
      values[idx] = cell ? matrixCellValue(cell, metric) : null;
    }

    return { pct: band, values, nearestStrikes };
  });
}

function detectAlignments(payloads: Record<ConfIndex, MatrixDoc | null>): AlignmentChip[] {
  const chips: AlignmentChip[] = [];
  // `label` is a gexStrings key so the chip text is bilingual, never baked English.
  //
  // NO gamma_flip ROW. This board reads each index's matrix doc DIRECTLY, and that doc's
  // levels block still carries the retired cumulative-by-strike flip estimator (see
  // matrixDoc.mergeMatrixLevels — the desk prefers gex_state for exactly this reason).
  // There is no per-root gex_state here to merge against, so the honest move is to make
  // no flip claim at all rather than align three indices on a known-bad number.
  const levelTypes: { key: keyof MatrixLevels; label: LevelKey }[] = [
    { key: "call_wall",    label: "levelWall" },
    { key: "put_support",  label: "levelSupport" },
    { key: "hvl",          label: "levelMagnet" },
  ];

  for (const { key, label } of levelTypes) {
    const pcts: { idx: ConfIndex; pct: number }[] = [];
    for (const idx of CONF_INDICES) {
      const p = payloads[idx];
      if (!p || !p.levels || p.spot == null) continue;
      const levelVal = p.levels[key];
      if (levelVal == null) continue;
      const pct = ((levelVal - p.spot) / p.spot) * 100;
      pcts.push({ idx, pct });
    }

    if (pcts.length < 2) continue;

    const pctValues = pcts.map((x) => x.pct);
    const spread = Math.max(...pctValues) - Math.min(...pctValues);
    if (spread > ALIGNMENT_THRESHOLD) continue;

    const avgPct = pctValues.reduce((a, b) => a + b, 0) / pctValues.length;
    const bucket = nearestBucket(avgPct);
    // Off the board entirely — the levels agree with each other but sit outside the
    // ±2.4% window this grid draws, so there is no row to chip.
    if (bucket === null) continue;

    chips.push({
      pct: bucket,
      level: label,
      indices: pcts.map((x) => x.idx),
      count: pcts.length,
    });
  }

  return chips;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function MatrixConfluence({ fetchMatrix, metric, lang }: MatrixConfluenceProps) {
  const t = makeGexT(lang);

  const [data, setData] = useState<Record<ConfIndex, IndexData>>({
    SPY: { payload: null, loading: true, error: false },
    QQQ: { payload: null, loading: true, error: false },
    IWM: { payload: null, loading: true, error: false },
  });

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const seqRef = useRef(0);

  const fetchAll = useCallback(async () => {
    const seq = ++seqRef.current;
    const results = await Promise.all(
      CONF_INDICES.map(async (idx) => ({ idx, read: await fetchMatrix(idx) }))
    );
    // A poll and a Retry can overlap: only the latest round may paint.
    if (seq !== seqRef.current) return;
    setData((prev) => {
      const next = { ...prev };
      for (const { idx, read } of results) {
        // A read that did not land keeps the last payload on screen and says so; only
        // a published absence (or bytes that are not this index's matrix) clears it.
        next[idx] = read.status === "unavailable"
          ? { payload: prev[idx].payload, loading: false, error: true }
          : { payload: read.status === "data" ? read.doc : null, loading: false, error: false };
      }
      return next;
    });
  }, [fetchMatrix]);

  const failed = CONF_INDICES.filter((idx) => data[idx].error);
  // Never read: alignment across a partial set is not judged at all.
  const unread = failed.filter((idx) => data[idx].payload == null);
  // Read before, failed now: the last read stays, labelled as such.
  const stale = failed.filter((idx) => data[idx].payload != null);

  const retryFailed = useCallback(() => {
    for (const idx of CONF_INDICES) if (data[idx].error) flowInvalidate(`matrix:${idx}`);
    void fetchAll();
  }, [data, fetchAll]);

  useEffect(() => {
    void fetchAll();
    pollRef.current = setInterval(() => void fetchAll(), 60_000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchAll]);

  const anyLoading = CONF_INDICES.some((idx) => data[idx].loading);
  const payloads: Record<ConfIndex, MatrixDoc | null> = {
    SPY: data.SPY.payload,
    QQQ: data.QQQ.payload,
    IWM: data.IWM.payload,
  };

  const bucketRows = computeBucketRows(payloads, metric);
  const alignments = unread.length > 0 ? [] : detectAlignments(payloads);

  // Max abs value across visible cells — the scale the eye compares within this grid.
  const allMags = bucketRows.flatMap((r) =>
    CONF_INDICES.map((idx) => Math.abs(r.values[idx] ?? 0))
  ).filter((v) => v > 0);
  const maxMag = allMags.length > 0 ? Math.max(...allMags) : 1;

  // Fill rides the SHARED metric tone (components/shared/StrikeExpiryMatrix). For the
  // hedge metric that is the aggressor-side pair, which globals.css deliberately keeps
  // out of the html[data-updown="east"] flip — a dealer hedge is a transaction side,
  // not a price direction. This grid used to ride --up-rgb/--down-rgb and inverted.
  function cellColor(v: number | null): string {
    if (v == null || v === 0) return "transparent";
    const intensity = Math.min(1, Math.abs(v) / maxMag);
    const pct = (8 + intensity * 55).toFixed(1);
    return `color-mix(in srgb, ${matrixCellTone(v, metric)} ${pct}%, transparent)`;
  }

  // Build alignment map: band -> AlignmentChip[]
  const alignMap = new Map<number, AlignmentChip[]>();
  for (const chip of alignments) {
    const existing = alignMap.get(chip.pct) ?? [];
    existing.push(chip);
    alignMap.set(chip.pct, existing);
  }

  return (
    <div style={CONF_OUTER}>
      {/* Header */}
      <div style={CONF_HEADER}>
        <span style={CONF_TITLE}>{t("confluenceTitle")}</span>
        <span style={CONF_NOTE}>{t("descriptiveOnly")}</span>
        {anyLoading && <span style={LOADING_CHIP}>{t("loading")}</span>}
      </div>

      {/* Honesty banner — same amber `.obs-note` the SINGLE-mode matrix uses */}
      <div className="obs-note" style={HONESTY_BANNER}>
        {t("magnitudeFirst")}
      </div>

      {/* Spot prices row */}
      <div style={SPOT_ROW_HEADER}>
        <div style={LABEL_COL}>
          <span className="obs-lbl">{t("colSpotPct")}</span>
        </div>
        {CONF_INDICES.map((idx) => {
          const spot = payloads[idx]?.spot;
          return (
            <div key={idx} style={IDX_COL_HEADER}>
              <span style={IDX_LABEL}>{idx}</span>
              {spot != null && (
                <span className="num" style={IDX_SPOT}>{spot.toFixed(2)}</span>
              )}
            </div>
          );
        })}
        <div style={ALIGN_COL_HEADER}>
          <span className="obs-lbl" style={ALIGN_HDR_TEXT}>{t("confluenceAligned")}</span>
        </div>
      </div>

      {/* Matrix rows */}
      <div style={MATRIX_BODY}>
        {bucketRows.map((row) => {
          const isSpot = row.pct === 0;
          const chips = alignMap.get(row.pct) ?? [];
          const hasAlignment = chips.length > 0;

          return (
            <div
              key={row.pct}
              style={{
                ...BUCKET_ROW,
                ...(isSpot ? SPOT_BAND : {}),
                ...(hasAlignment ? ALIGNED_BAND : {}),
              }}
            >
              {/* % label */}
              <div style={LABEL_COL}>
                <span
                  className="num"
                  style={{
                    ...PCT_LABEL,
                    color: isSpot ? "var(--signal)" : "var(--text-2)",
                    fontWeight: isSpot ? 700 : 400,
                  }}
                >
                  {isSpot ? t("spotLabel") : fmtPct(row.pct)}
                </span>
              </div>

              {/* GEX cells per index */}
              {CONF_INDICES.map((idx) => {
                const v = row.values[idx];
                const strike = row.nearestStrikes[idx];
                return (
                  <div
                    key={idx}
                    style={{
                      ...IDX_CELL,
                      background: cellColor(v),
                    }}
                  >
                    <span
                      className="num"
                      style={{
                        ...CELL_VAL,
                        color:
                          v == null || v === 0
                            ? "var(--muted)"
                            : `color-mix(in srgb, #fff 26%, ${matrixCellTone(v, metric)})`,
                      }}
                    >
                      {fmtValue(v, metric)}
                    </span>
                    {strike != null && (
                      <span className="num" style={STRIKE_HINT}>${strike}</span>
                    )}
                  </div>
                );
              })}

              {/* Alignment column */}
              <div style={ALIGN_COL}>
                {chips.map((chip, ci) => (
                  <span
                    key={ci}
                    className="obs-tag"
                    style={{
                      ...ALIGN_CHIP,
                      "--c": chip.count >= 3 ? "var(--signal)" : "var(--brand-2)",
                    } as React.CSSProperties}
                  >
                    {chip.count >= 3 ? t("confluence3of3") : t("confluence2of3")}
                    {" "}
                    {t(chip.level)}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* A failed read is named, never shown as "no alignment" */}
      {failed.length > 0 && (
        <div style={READ_ERROR} data-testid="gex-confluence-error" role="alert">
          {unread.length > 0 && <span>{t("confluenceError").replace("{roots}", unread.join(", "))}</span>}
          {stale.length > 0 && <span>{t("confluenceStale").replace("{roots}", stale.join(", "))}</span>}
          <button type="button" className="btn btn-ghost load-retry" onClick={retryFailed}>{t("errorRetry")}</button>
        </div>
      )}

      {/* No alignment notice */}
      {alignments.length === 0 && !anyLoading && unread.length === 0 && (
        <div style={NO_ALIGNMENT}>{t("confluenceEmpty")}</div>
      )}

      {/* Note */}
      <div style={CONF_FOOTNOTE}>
        {t("confluenceNote")}
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const CONF_OUTER: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minHeight: 0,
  overflow: "hidden",
  background: "var(--bg)",
};

const CONF_HEADER: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 14px",
  borderBottom: "1px solid var(--line)",
  background: "var(--panel)",
  flexShrink: 0,
};

const CONF_TITLE: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: "var(--text)",
  letterSpacing: "0.06em",
};

const CONF_NOTE: React.CSSProperties = {
  fontSize: 9,
  color: "var(--muted)",
  fontStyle: "italic",
};

const LOADING_CHIP: React.CSSProperties = {
  marginLeft: "auto",
  fontSize: 9,
  color: "var(--brand-2)",
};

/** `.obs-note` supplies the amber tint; this only flattens it into the header stack. */
const HONESTY_BANNER: React.CSSProperties = {
  margin: 0,
  borderRadius: 0,
  borderLeft: "none",
  borderRight: "none",
  borderTop: "none",
  padding: "5px 14px",
  fontSize: 9,
  letterSpacing: "0.02em",
  flexShrink: 0,
};

const SPOT_ROW_HEADER: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "72px 1fr 1fr 1fr 120px",
  gap: 0,
  borderBottom: "1px solid var(--line)",
  background: "var(--panel)",
  flexShrink: 0,
};

const LABEL_COL: React.CSSProperties = {
  padding: "5px 8px",
  display: "flex",
  alignItems: "center",
};

const IDX_COL_HEADER: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  padding: "5px 4px",
  borderLeft: "1px solid var(--line-2)",
};

const IDX_LABEL: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 800,
  color: "var(--text)",
  letterSpacing: "0.06em",
};

const IDX_SPOT: React.CSSProperties = {
  fontSize: 9,
  color: "var(--muted)",
  fontVariantNumeric: "tabular-nums",
};

const ALIGN_COL_HEADER: React.CSSProperties = {
  padding: "5px 8px",
  borderLeft: "1px solid var(--line)",
  display: "flex",
  alignItems: "center",
};

/** Type comes from `.obs-lbl`; only the dense size override stays inline. */
const ALIGN_HDR_TEXT: React.CSSProperties = {
  fontSize: 8.5,
  lineHeight: 1.25,
};

const MATRIX_BODY: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  minHeight: 0,
};

const BUCKET_ROW: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "72px 1fr 1fr 1fr 120px",
  borderBottom: "1px solid var(--line-2)",
  minHeight: 24,
  height: 24,
};

const SPOT_BAND: React.CSSProperties = {
  background: "color-mix(in srgb, var(--signal) 6%, transparent)",
  borderTop: "1px solid color-mix(in srgb, var(--signal) 22%, transparent)",
  borderBottom: "1px solid color-mix(in srgb, var(--signal) 22%, transparent)",
};

const ALIGNED_BAND: React.CSSProperties = {
  background: "color-mix(in srgb, var(--brand-2) 4%, transparent)",
};

const PCT_LABEL: React.CSSProperties = {
  fontSize: 10,
  fontVariantNumeric: "tabular-nums",
  letterSpacing: "0.01em",
};

const IDX_CELL: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  padding: "2px 4px",
  borderLeft: "1px solid var(--line-2)",
  gap: 1,
};

const CELL_VAL: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  fontVariantNumeric: "tabular-nums",
};

const STRIKE_HINT: React.CSSProperties = {
  fontSize: 7,
  color: "var(--muted)",
  fontVariantNumeric: "tabular-nums",
};

const ALIGN_COL: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  justifyContent: "center",
  padding: "2px 6px",
  borderLeft: "1px solid var(--line)",
  gap: 2,
};

/**
 * Dense override for `.obs-tag` in a 24px band row. The tint itself rides `--c`:
 * 3/3 alignment = var(--signal), 2/3 = var(--brand-2). Neither is a direction token:
 * an alignment COUNT is not a price direction, so it must not flip with the zh east theme.
 */
const ALIGN_CHIP: React.CSSProperties = {
  fontSize: 7.5,
  fontWeight: 800,
  letterSpacing: "0.04em",
  padding: "2px 6px",
  gap: 3,
};

const NO_ALIGNMENT: React.CSSProperties = {
  padding: "10px 14px",
  fontSize: 11,
  color: "var(--muted)",
  textAlign: "center",
};

const READ_ERROR: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  padding: "8px 14px",
  fontSize: 11,
  color: "var(--text-2)",
  textAlign: "center",
};

const CONF_FOOTNOTE: React.CSSProperties = {
  padding: "6px 14px",
  fontSize: 9,
  color: "var(--muted)",
  borderTop: "1px solid var(--line-2)",
  fontStyle: "italic",
  flexShrink: 0,
};
