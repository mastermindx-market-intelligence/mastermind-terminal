"use client";
/**
 * TrendCards — the book against its own history (Volland-parity W2, rebuilt in the
 * 2026-08-01 production sweep).
 *
 * Sweep changes, each answering a defect the operator saw on production:
 *   • Trend chart axis: the first pass thinned per-POINT date labels by a 54px gap —
 *     ~25 seven-character labels packed edge to edge, an unreadable smear. Labels are
 *     now built from MONTH/YEAR BOUNDARIES (year-only past three years of span), then
 *     thinned by pixel gap. A date axis labels calendar boundaries, not samples.
 *   • Chart height to ≥190px (svgChart R4 minimum for a labelled x-axis).
 *   • Copy discipline (MscCard): explanation in the ⓘ, one visible foot line.
 *
 * THE PERCENTILE IS THE PRODUCT (unchanged): the level is Tier B; today's rank against
 * the same book under the same convention is the sturdier read, and every card leads
 * with it.
 */

import React, { useMemo, useRef, useState } from "react";
import { fmtTick, niceTicks, padDomain, thinLabels, useChartWidth } from "@/components/charts/svgChart";
import {
  decimate,
  extremes,
  spotVol,
  TREND_GREEKS,
  TREND_WINDOWS,
  trendSeries,
  type AggTrendPayload,
  type HorizonKey,
  type TrendGreek,
  type TrendWindowKey,
} from "@/lib/aggTrend";
import { makeMscT, type MscKey } from "./mscStrings";
import { MscCard, CardFoot, CardSpacer } from "./MscCard";
import type { Lang } from "@/lib/i18n";

const H = 200;
const PAD = { l: 8, r: 56, t: 10, b: 20 };

const GREEK_KEY: Record<TrendGreek, MscKey> = {
  gamma: "hgGamma",
  delta: "hgDelta",
  vanna: "hgVanna",
  charm: "hgCharm",
  vega: "atVega",
};

const WINDOW_KEY: Record<TrendWindowKey, MscKey> = {
  "1y": "atWin1y",
  "3y": "atWin3y",
  all: "atWinAll",
};

const HORIZON_KEY: Record<HorizonKey, MscKey> = {
  near: "exNear",
  swing: "exSwing",
  far: "exFar",
};

/** $bn with a sign, for a series whose whole point is which side of zero it sits on. */
function fmtBnSigned(v: number | null | undefined): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  const digits = a >= 100 ? 0 : a >= 10 ? 1 : 2;
  return `${v < 0 ? "−" : "+"}$${a.toFixed(digits)}bn`;
}

function fmtPct(v: number | null | undefined, digits = 0): string {
  return typeof v === "number" && Number.isFinite(v) ? `${v.toFixed(digits)}%` : "—";
}

/**
 * 12.5 → "12th" (EN) / "第12" (zh) — ordinals read faster than "12.5th percentile",
 * and an English "th" leaking into the zh view violates the i18n law.
 */
function ordinal(p: number | null | undefined, lang: Lang): string {
  if (typeof p !== "number" || !Number.isFinite(p)) return "—";
  const n = Math.max(0, Math.min(100, Math.round(p)));
  if (lang === "zh") return `第${n}`;
  const rem100 = n % 100;
  const rem10 = n % 10;
  const suffix =
    rem100 >= 11 && rem100 <= 13 ? "th" : rem10 === 1 ? "st" : rem10 === 2 ? "nd" : rem10 === 3 ? "rd" : "th";
  return `${n}${suffix}`;
}

/**
 * Date-axis labels from CALENDAR BOUNDARIES, not samples. Month starts while the span
 * is ≤ 3 years (first label and Januaries carry the year); year starts beyond that.
 * The result still goes through thinLabels — boundaries can crowd at narrow widths.
 */
function boundaryLabels(
  points: readonly { d: string }[],
  sx: (i: number) => number,
): { x: number; label: string }[] {
  if (points.length < 2) return [];
  const years = new Set<string>();
  for (const p of points) years.add(p.d.slice(0, 4));
  const yearOnly = years.size > 3;
  const out: { x: number; label: string }[] = [];
  let prevY = "";
  let prevYm = "";
  points.forEach((p, i) => {
    const y = p.d.slice(0, 4);
    const ym = p.d.slice(0, 7);
    if (yearOnly) {
      if (y !== prevY) {
        prevY = y;
        out.push({ x: sx(i), label: y });
      }
    } else if (ym !== prevYm) {
      const label = prevYm === "" || y !== prevY ? ym : p.d.slice(5, 7);
      prevYm = ym;
      prevY = y;
      out.push({ x: sx(i), label });
    }
  });
  return out;
}

// ─── Card 1: aggregate greek trend ───────────────────────────────────────────────────

export function AggTrendCard({
  agg,
  lang,
}: {
  agg: AggTrendPayload | null | undefined;
  lang: Lang;
}) {
  const t = makeMscT(lang);
  const [greek, setGreek] = useState<TrendGreek>("gamma");
  // Defaults to 1Y, not All: dealer exposure scales with the underlying (gamma with S²),
  // so a nine-year rank partly measures market growth. The full series stays one click
  // away, where the drift is visible and the foot names it.
  const [win, setWin] = useState<TrendWindowKey>("1y");
  const boxRef = useRef<HTMLDivElement | null>(null);
  const W = useChartWidth(boxRef, 640);

  const ts = useMemo(() => trendSeries(agg, greek, win), [agg, greek, win]);
  const stats = ts.stats;
  const hasData = ts.points.length > 1 && stats != null;

  const innerW = Math.max(60, W - PAD.l - PAD.r);
  const innerH = H - PAD.t - PAD.b;

  const geom = useMemo(() => {
    if (!hasData) return null;
    const ys = ts.points.map((p) => p.v);
    // Zero is ALWAYS in this domain — which side of zero the book sits on is the
    // headline fact. padDomain's includeZero only unions when the data straddles
    // zero, so a one-sided window (SPY gamma positive for a whole year is common)
    // would silently drop the reference line; force it here.
    let [y0, y1] = padDomain(Math.min(...ys), Math.max(...ys), {
      padFrac: 0.08,
      includeZero: true,
    });
    y0 = Math.min(y0, 0);
    y1 = Math.max(y1, 0);
    const n = ts.points.length;
    const sx = (i: number) => PAD.l + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
    const sy = (v: number) => PAD.t + innerH - ((v - y0) / (y1 - y0 || 1)) * innerH;
    // One min/max pair per pixel column — every extreme survives at its own date.
    const drawn = decimate(ts.points, Math.max(1, Math.round(innerW)));
    // Calendar-boundary labels, thinned by PIXEL GAP (the sweep's axis fix).
    const labels = thinLabels(boundaryLabels(ts.points, sx), (l) => l.x, 64);
    return { y0, y1, sx, sy, ticks: niceTicks(y0, y1, 4), labels, drawn };
  }, [ts, hasData, innerW, innerH]);

  // The payload's `units` map is English prose — rendering it verbatim leaks EN
  // into the zh view. The unit is determined by the greek, so it maps to LEX.
  const unitKey: MscKey =
    greek === "gamma" ? "unitSpot"
      : greek === "vanna" || greek === "vega" ? "unitVol"
      : greek === "charm" ? "unitDay"
      : "unitPosition";

  return (
    <MscCard
      title={t("atTitle")}
      info={`${t("atLead")} ${t("atBandLegend")}`}
      tier={t("tierB")}
      tierWhy={t("atTierWhy")}
      headRight={<span style={UNIT}>$bn · {t(unitKey)}</span>}
      span={8}
    >
      <div style={CTRL_ROW}>
        <div style={CHIP_GROUP} role="group" aria-label={t("hgGreekAria")}>
          {TREND_GREEKS.map((g) => (
            <button
              key={g}
              className={`obs-chip${greek === g ? " on" : ""}`}
              style={CHIP}
              aria-pressed={greek === g}
              onClick={() => setGreek(g)}
            >
              {t(GREEK_KEY[g])}
            </button>
          ))}
        </div>
        <div style={CHIP_GROUP} role="group" aria-label={t("atWinAria")}>
          {TREND_WINDOWS.map((w) => (
            <button
              key={w.key}
              className={`obs-chip${win === w.key ? " on" : ""}`}
              style={CHIP}
              aria-pressed={win === w.key}
              onClick={() => setWin(w.key)}
            >
              {t(WINDOW_KEY[w.key])}
            </button>
          ))}
        </div>
      </div>

      {!hasData ? (
        <div style={EMPTY_SM}>{t("atNone")}</div>
      ) : (
        <>
          <div style={STAT_ROW}>
            <div style={STAT}>
              <span style={LEG_LBL}>{t("atToday")}</span>
              {/* Neutral tint on purpose: this is an exposure LEVEL, and the flow
                  colours are reserved for transaction sides — positive dealer gamma
                  means dealers SELL strength, so a "buy" green here would assert the
                  opposite trade. */}
              <span style={LEG_VAL}>{fmtBnSigned(stats.last)}</span>
            </div>
            <div style={STAT}>
              <span style={LEG_LBL}>{t("atRank")}</span>
              <span style={{ ...LEG_VAL, fontWeight: 700 }}>{ordinal(stats.pctile, lang)}</span>
            </div>
            <div style={STAT}>
              <span style={LEG_LBL}>{t("atTypical")}</span>
              <span style={LEG_VAL}>{fmtBnSigned(stats.p50)}</span>
            </div>
            <div style={STAT}>
              <span style={LEG_LBL}>{t("atRange")}</span>
              <span style={LEG_VAL}>
                {fmtBnSigned(stats.p05)} … {fmtBnSigned(stats.p95)}
              </span>
            </div>
          </div>

          <div ref={boxRef} style={{ width: "100%" }}>
            {geom && (
              <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("atTitle")}>
                {/* p05–p95 reference band: the "is this normal" answer, drawn not stated. */}
                <rect
                  x={PAD.l}
                  y={geom.sy(stats.p95)}
                  width={innerW}
                  height={Math.max(0.5, geom.sy(stats.p05) - geom.sy(stats.p95))}
                  fill="var(--brand-2)"
                  opacity={0.09}
                />
                <line
                  x1={PAD.l} x2={PAD.l + innerW}
                  y1={geom.sy(stats.p50)} y2={geom.sy(stats.p50)}
                  stroke="var(--text-dim)" strokeWidth={0.75} strokeDasharray="4 4"
                />
                {geom.ticks.values.map((tv) => (
                  <g key={tv}>
                    <line
                      x1={PAD.l} x2={PAD.l + innerW} y1={geom.sy(tv)} y2={geom.sy(tv)}
                      stroke={tv === 0 ? "var(--line-2)" : "var(--hairline)"}
                      strokeWidth={tv === 0 ? 1 : 0.5}
                    />
                    <text x={PAD.l + innerW + 6} y={geom.sy(tv) + 3} fill="var(--text-dim)" fontSize={9}>
                      {fmtTick(tv, geom.ticks.step)}
                    </text>
                  </g>
                ))}
                <polyline
                  fill="none"
                  stroke="var(--brand-2)"
                  strokeWidth={1.25}
                  points={geom.drawn.map((p) => `${geom.sx(p.i)},${geom.sy(p.v)}`).join(" ")}
                />
                <circle
                  cx={geom.sx(ts.points.length - 1)}
                  cy={geom.sy(ts.points[ts.points.length - 1].v)}
                  r={2.5}
                  fill="var(--brand)"
                />
                {geom.labels.map((l) => {
                  // Edge-proximity anchoring keeps end labels inside the viewBox.
                  const anchor =
                    l.x - PAD.l < 20 ? "start" : PAD.l + innerW - l.x < 20 ? "end" : "middle";
                  return (
                    <text
                      key={l.x}
                      x={l.x}
                      y={H - 6}
                      fill="var(--text-dim)"
                      fontSize={9}
                      textAnchor={anchor}
                    >
                      {l.label}
                    </text>
                  );
                })}
              </svg>
            )}
          </div>

          <CardFoot>
            {t("atCoverage")
              .replace("{n}", String(ts.n))
              .replace("{since}", ts.since ?? "—")}
            {ts.truncated ? ` · ${t("atTruncated")}` : ""}
            {win === "all" ? ` · ${t("atDrift")}` : ""}
          </CardFoot>
        </>
      )}
    </MscCard>
  );
}

// ─── Card 2: spot–vol relationship ───────────────────────────────────────────────────

export function SpotVolCard({
  agg,
  lang,
}: {
  agg: AggTrendPayload | null | undefined;
  lang: Lang;
}) {
  const t = makeMscT(lang);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const W = useChartWidth(boxRef, 320);
  const sv = useMemo(() => spotVol(agg?.series, 252), [agg]);

  const CH = 148;
  const CPAD = { l: 8, r: 34, t: 8, b: 8 };
  const innerW = Math.max(40, W - CPAD.l - CPAD.r);
  const innerH = CH - CPAD.t - CPAD.b;

  const geom = useMemo(() => {
    if (sv.points.length < 2) return null;
    const xs = sv.points.map((p) => p.x);
    const ys = sv.points.map((p) => p.y);
    const [x0, x1] = padDomain(Math.min(...xs), Math.max(...xs), { padFrac: 0.06, includeZero: true });
    const [y0, y1] = padDomain(Math.min(...ys), Math.max(...ys), { padFrac: 0.06, includeZero: true });
    const sx = (v: number) => CPAD.l + ((v - x0) / (x1 - x0 || 1)) * innerW;
    const sy = (v: number) => CPAD.t + innerH - ((v - y0) / (y1 - y0 || 1)) * innerH;
    return { x0, x1, y0, y1, sx, sy, ticks: niceTicks(y0, y1, 3) };
  }, [sv.points, innerW, innerH]);

  const verdictKey: MscKey =
    sv.verdict === "overvixed" ? "svOver"
      : sv.verdict === "undervixed" ? "svUnder"
      : sv.verdict === "inline" ? "svInline"
      : "svUnknown";

  return (
    <MscCard
      title={t("svTitle")}
      info={`${t("svLead")} ${t("svLegend").replace("{n}", String(sv.n))}`}
      tier={t("tierMeasured")}
      tierWhy={t("svTierWhy")}
      span={4}
    >
      {sv.beta == null ? (
        <CardFoot>{t("svNone").replace("{n}", String(sv.n))}</CardFoot>
      ) : (
        <>
          <div style={STAT_ROW}>
            <div style={STAT}>
              <span style={LEG_LBL}>{t("svBeta")}</span>
              <span style={LEG_VAL}>{sv.beta.toFixed(2)}</span>
            </div>
            <div style={STAT}>
              <span style={LEG_LBL}>{t("svR2")}</span>
              <span style={LEG_VAL}>{fmtPct(sv.r2 == null ? null : sv.r2 * 100)}</span>
            </div>
            <div style={STAT}>
              <span style={LEG_LBL}>{t("svVerdict")}</span>
              <span
                style={{
                  ...LEG_VAL,
                  fontWeight: 700,
                  color:
                    sv.verdict === "overvixed" ? "var(--warn)"
                      : sv.verdict === "undervixed" ? "var(--signal)"
                      : "var(--text)",
                }}
              >
                {t(verdictKey)}
              </span>
            </div>
          </div>

          {/* Overvixed ↔ undervixed dial — a bounded scalar reads faster on a track. */}
          {sv.gauge != null && (
            <div style={GAUGE_WRAP} aria-label={t("svGaugeAria")}>
              <div style={GAUGE_TRACK}>
                <div style={{ ...GAUGE_MID }} />
                <div
                  style={{
                    ...GAUGE_NEEDLE,
                    left: `${((sv.gauge + 1) / 2) * 100}%`,
                    background:
                      sv.verdict === "overvixed" ? "var(--warn)"
                        : sv.verdict === "undervixed" ? "var(--signal)"
                        : "var(--text-2)",
                  }}
                />
              </div>
              <div style={GAUGE_ENDS}>
                <span>{t("svUnder")}</span>
                <span>{t("svOver")}</span>
              </div>
            </div>
          )}

          <div ref={boxRef} style={{ width: "100%" }}>
            {geom && (
              <svg width={W} height={CH} viewBox={`0 0 ${W} ${CH}`} role="img" aria-label={t("svTitle")}>
                {geom.ticks.values.map((tv) => (
                  <g key={tv}>
                    <line
                      x1={CPAD.l} x2={CPAD.l + innerW} y1={geom.sy(tv)} y2={geom.sy(tv)}
                      stroke={tv === 0 ? "var(--line-2)" : "var(--hairline)"}
                      strokeWidth={tv === 0 ? 1 : 0.5}
                    />
                    <text x={CPAD.l + innerW + 4} y={geom.sy(tv) + 3} fill="var(--text-dim)" fontSize={8}>
                      {fmtTick(tv, geom.ticks.step)}
                    </text>
                  </g>
                ))}
                {geom.x0 < 0 && geom.x1 > 0 && (
                  <line
                    x1={geom.sx(0)} x2={geom.sx(0)} y1={CPAD.t} y2={CPAD.t + innerH}
                    stroke="var(--line-2)" strokeWidth={1}
                  />
                )}
                {sv.points.map((p, i) => (
                  <circle
                    key={`${p.x}-${p.y}-${i}`}
                    cx={geom.sx(p.x)}
                    cy={geom.sy(p.y)}
                    r={1.4}
                    fill="var(--text-dim)"
                    opacity={0.55}
                  />
                ))}
                <line
                  x1={geom.sx(geom.x0)}
                  y1={geom.sy((sv.intercept ?? 0) + sv.beta * geom.x0)}
                  x2={geom.sx(geom.x1)}
                  y2={geom.sy((sv.intercept ?? 0) + sv.beta * geom.x1)}
                  stroke="var(--brand-2)"
                  strokeWidth={1.25}
                />
                {sv.lastReturnPct != null && sv.lastIvChangePts != null && (
                  <circle
                    cx={geom.sx(sv.lastReturnPct)}
                    cy={geom.sy(sv.lastIvChangePts)}
                    r={3}
                    fill="none"
                    stroke="var(--brand)"
                    strokeWidth={1.5}
                  />
                )}
              </svg>
            )}
          </div>

          <CardSpacer />
          <CardFoot>
            {t("svToday")
              .replace("{r}", fmtPct(sv.lastReturnPct, 2))
              .replace("{a}", (sv.lastIvChangePts ?? 0).toFixed(2))
              .replace("{p}", (sv.predictedPts ?? 0).toFixed(2))}
          </CardFoot>
        </>
      )}
    </MscCard>
  );
}

// ─── Card 3: positioning extremes by horizon ─────────────────────────────────────────

export function ExtremesCard({
  matrix,
  spot,
  asof,
  lang,
}: {
  matrix: { spot?: number | null; cells?: { strike: number; expiry: string; gex: number | null }[] } | null | undefined;
  spot: number | null | undefined;
  asof: string | null | undefined;
  lang: Lang;
}) {
  const t = makeMscT(lang);
  const ex = useMemo(() => extremes(matrix, spot, asof), [matrix, spot, asof]);

  return (
    <MscCard
      title={t("exTitle")}
      info={`${t("exLead")} ${t("exLegend")}`}
      tier={t("tierB")}
      tierWhy={t("exTierWhy")}
      span={4}
    >
      {!ex.available ? (
        <CardFoot>{t("exNone")}</CardFoot>
      ) : (
        <>
          <table style={TABLE}>
            <thead>
              <tr>
                <th style={TH}>{t("exColHorizon")}</th>
                <th style={{ ...TH, textAlign: "right" }}>{t("exColBelow")}</th>
                <th style={{ ...TH, textAlign: "right" }}>{t("exColAbove")}</th>
              </tr>
            </thead>
            <tbody>
              {/* Strikes render NEUTRAL and through price(): these are magnitude
                  concentrations (heaviest |gamma| each side, any sign), and the flow
                  colours are reserved for transaction sides. */}
              {ex.rows.map((r) => (
                <tr key={r.horizon}>
                  <td style={{ ...TD, whiteSpace: "nowrap" }}>{t(HORIZON_KEY[r.horizon])}</td>
                  <td style={{ ...TD, textAlign: "right", color: r.cells === 0 || r.support == null ? "var(--text-dim)" : "var(--text)" }}>
                    {r.cells === 0
                      ? t("exUnknown")
                      : r.support == null
                        ? t("exNoWall")
                        : r.support.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </td>
                  <td style={{ ...TD, textAlign: "right", color: r.cells === 0 || r.resistance == null ? "var(--text-dim)" : "var(--text)" }}>
                    {r.cells === 0
                      ? t("exUnknown")
                      : r.resistance == null
                        ? t("exNoWall")
                        : r.resistance.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <CardSpacer />
          <CardFoot>{t("exDisclose")}</CardFoot>
        </>
      )}
    </MscCard>
  );
}

// ─── Local styles (v5 tokens) ────────────────────────────────────────────────────────

const CTRL_ROW: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6,
};

const CHIP_GROUP: React.CSSProperties = { display: "flex", gap: 3, flexWrap: "wrap" };

const CHIP: React.CSSProperties = { fontSize: 10, padding: "2px 7px" };

const UNIT: React.CSSProperties = {
  fontSize: "var(--fs-micro)", letterSpacing: ".03em", color: "var(--text-dim)",
  textTransform: "uppercase", whiteSpace: "nowrap",
};

const STAT_ROW: React.CSSProperties = {
  display: "flex", gap: "6px 16px", flexWrap: "wrap", marginBottom: 8,
};

const STAT: React.CSSProperties = {
  display: "flex", flexDirection: "column", gap: 1, minWidth: 0,
};

const LEG_LBL: React.CSSProperties = {
  fontSize: "var(--fs-micro)", letterSpacing: ".04em", textTransform: "uppercase",
  color: "var(--text-dim)", whiteSpace: "nowrap",
};

const LEG_VAL: React.CSSProperties = {
  fontSize: 13, fontWeight: 600, fontVariantNumeric: "tabular-nums",
};

const GAUGE_WRAP: React.CSSProperties = { margin: "2px 0 9px" };

const GAUGE_TRACK: React.CSSProperties = {
  position: "relative", height: 6, borderRadius: 999,
  background: "var(--inset)", border: "1px solid var(--line-2)",
};

const GAUGE_MID: React.CSSProperties = {
  position: "absolute", left: "50%", top: -2, bottom: -2, width: 1,
  background: "var(--line-2)",
};

const GAUGE_NEEDLE: React.CSSProperties = {
  position: "absolute", top: -3, width: 3, height: 12, borderRadius: 2,
  transform: "translateX(-50%)",
};

const GAUGE_ENDS: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", marginTop: 3,
  fontSize: "var(--fs-micro)", letterSpacing: ".04em", textTransform: "uppercase",
  color: "var(--text-dim)",
};

const TABLE: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 11 };

const TH: React.CSSProperties = {
  textAlign: "left", fontWeight: 500, fontSize: "var(--fs-micro)", letterSpacing: ".04em",
  textTransform: "uppercase", color: "var(--text-dim)", padding: "3px 5px",
  borderBottom: "1px solid var(--line)", whiteSpace: "nowrap",
};

const TD: React.CSSProperties = {
  padding: "3px 5px", color: "var(--text)", borderBottom: "1px solid var(--hairline)",
  fontVariantNumeric: "tabular-nums",
};

const EMPTY_SM: React.CSSProperties = {
  padding: "24px 8px", textAlign: "center", fontSize: 11, color: "var(--muted)",
};
