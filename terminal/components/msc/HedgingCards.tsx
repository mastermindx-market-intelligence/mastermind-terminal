"use client";
/**
 * HedgingCards — the hedging-requirement reframing (Volland-parity W1, rebuilt in the
 * 2026-08-01 production sweep).
 *
 * THE FRAMING: every greek lens renders on ONE axis — USD mn of modeled hedge
 * sensitivity under the stated shock. Not the exposure itself, and not a spot-path total.
 *
 * Sweep changes, each answering a defect the operator saw on production:
 *   • By-strike chart: STRIKE AXIS LABELS (the first pass drew a price chart with no
 *     x-axis — unreadable), wall markers (CW/PW), taller plot (svgChart R4), copy → ⓘ.
 *   • Term structure: the four-column table wrapped its dates mid-string at real widths
 *     ("2026-07-" / "10") and truncated "CUMULATIVE". It is now a zero-centred BAR list —
 *     MM-DD label, DTE, signed bar, value — which cannot wrap and reads at a glance.
 *   • Today's hedging: same legs, copy discipline (one foot line, rest in ⓘ).
 *
 * SVG LAW (components/charts/svgChart.ts R1–R9) and COLOUR LAW (--flow-buy/--flow-sell,
 * transaction side, never flips in zh) unchanged.
 */

import React, { useMemo, useRef, useState } from "react";
import { fmtMn, fmtMnMag } from "@/lib/gexLadder";
import {
  hedgeProfile,
  termStructure,
  dailyHedging,
  type AggregateResult,
  type HedgeGreek,
  type MscExpiryRow,
  type MscStrikeRow,
  type TenorBand,
} from "@/lib/marketStructure";
import { fmtTick, niceTicks, padDomain, thinLabels, useChartWidth } from "@/components/charts/svgChart";
import { makeMscT, type MscKey } from "./mscStrings";
import { MscCard, CardFoot, CardSpacer } from "./MscCard";
import type { Lang } from "@/lib/i18n";

const H = 236;
const PAD = { l: 8, r: 54, t: 12, b: 22 };

const GREEKS: { key: HedgeGreek; labelKey: MscKey }[] = [
  { key: "gamma", labelKey: "hgGamma" },
  { key: "delta", labelKey: "hgDelta" },
  { key: "vanna", labelKey: "hgVanna" },
  { key: "charm", labelKey: "hgCharm" },
];

const BAND_COLOR: Record<TenorBand, string> = {
  daily: "var(--warn)",
  weekly: "var(--signal)",
  monthly: "var(--brand-2)",
  quarterly: "var(--brand)",
  annual: "var(--code-fn)",
};

const BAND_KEY: Record<TenorBand, MscKey> = {
  daily: "bandDaily",
  weekly: "bandWeekly",
  monthly: "bandMonthly",
  quarterly: "bandQuarterly",
  annual: "bandAnnual",
};

const sideColor = (v: number) =>
  v > 0 ? "var(--flow-buy)" : v < 0 ? "var(--flow-sell)" : "var(--text-dim)";

// ─── Card 1: snapshot hedge sensitivity by strike ────────────────────────────────────

export function HedgingByStrikeCard({
  byStrike,
  spot,
  callWall,
  putWall,
  windowNote,
  lang,
}: {
  byStrike: readonly MscStrikeRow[] | null | undefined;
  spot: number | null | undefined;
  callWall?: number | null;
  putWall?: number | null;
  /** The ±20%-window disclosure, pre-formatted by the caller. Null when not windowed. */
  windowNote?: string | null;
  lang: Lang;
}) {
  const t = makeMscT(lang);
  const [greek, setGreek] = useState<HedgeGreek>("gamma");
  const [view, setView] = useState<"bars" | "profile">("bars");
  const boxRef = useRef<HTMLDivElement | null>(null);
  const W = useChartWidth(boxRef, 640);

  const p = useMemo(() => hedgeProfile(byStrike, greek, spot), [byStrike, greek, spot]);
  const series = view === "bars"
    ? p.rows.map((r) => ({ x: r.strike, y: r.hedgeMn }))
    : p.cumulative.map((c) => ({ x: c.strike, y: c.cumMn }));

  const hasData = series.length > 1;
  const innerW = Math.max(60, W - PAD.l - PAD.r);
  const innerH = H - PAD.t - PAD.b;

  const geom = useMemo(() => {
    if (!hasData) return null;
    const xs = series.map((s) => s.x).filter(Number.isFinite);
    const ys = series.map((s) => s.y).filter(Number.isFinite);
    if (!xs.length || !ys.length) return null;
    const [x0, x1] = padDomain(Math.min(...xs), Math.max(...xs), { padFrac: 0.02 });
    // Hedging flips sign, so zero is a meaningful reference and is always unioned in.
    const [y0, y1] = padDomain(Math.min(...ys), Math.max(...ys), {
      padFrac: 0.12,
      includeZero: true,
    });
    const sx = (v: number) => PAD.l + ((v - x0) / (x1 - x0 || 1)) * innerW;
    const sy = (v: number) => PAD.t + innerH - ((v - y0) / (y1 - y0 || 1)) * innerH;
    const ticks = niceTicks(y0, y1, 4);
    // Strike axis (the sweep's fix — a price chart with no x-axis is unreadable):
    // nice ticks across the domain, thinned by PIXEL GAP per the chart law.
    const xt = thinLabels(
      niceTicks(x0, x1, 8).values.map((v) => ({ x: sx(v), v })),
      (l) => l.x,
      56,
    );
    return { x0, x1, y0, y1, sx, sy, ticks, xt, xStep: niceTicks(x0, x1, 8).step };
  }, [series, hasData, innerW, innerH]);

  const wallMarks = useMemo(() => {
    if (!geom) return [];
    const out: { x: number; label: string }[] = [];
    if (callWall != null && callWall > geom.x0 && callWall < geom.x1)
      out.push({ x: geom.sx(callWall), label: "CW" });
    if (putWall != null && putWall > geom.x0 && putWall < geom.x1)
      out.push({ x: geom.sx(putWall), label: "PW" });
    return out;
  }, [geom, callWall, putWall]);

  return (
    <MscCard
      title={t("hgTitle")}
      info={`${t("hgLead")} ${view === "profile" ? t(p.anchored ? "hgAnchored" : "hgUnanchored") : ""}`}
      tier={t("tierB")}
      tierWhy={t("tierBWhy")}
      headRight={<span style={UNIT}>{t("hgPerUnit").replace("{u}", t(perUnitKey(p.perUnit)))}</span>}
      span={8}
    >
      <div style={CTRL_ROW}>
        <div style={CHIP_GROUP} role="group" aria-label={t("hgGreekAria")}>
          {GREEKS.map((g) => (
            <button
              key={g.key}
              className={`obs-chip${greek === g.key ? " on" : ""}`}
              style={CHIP}
              aria-pressed={greek === g.key}
              onClick={() => setGreek(g.key)}
            >
              {t(g.labelKey)}
            </button>
          ))}
        </div>
        <div style={CHIP_GROUP} role="group" aria-label={t("hgViewAria")}>
          {(["bars", "profile"] as const).map((v) => (
            <button
              key={v}
              className={`obs-chip${view === v ? " on" : ""}`}
              style={CHIP}
              aria-pressed={view === v}
              onClick={() => setView(v)}
            >
              {t(v === "bars" ? "hgViewBars" : "hgViewProfile")}
            </button>
          ))}
        </div>
      </div>

      <div ref={boxRef} style={{ width: "100%" }}>
        {!hasData || !geom ? (
          <div style={EMPTY_SM}>{t("hgNoLens")}</div>
        ) : (
          <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("hgTitle")}>
            {geom.ticks.values.map((tv) => (
              <g key={tv}>
                <line
                  x1={PAD.l} x2={PAD.l + innerW} y1={geom.sy(tv)} y2={geom.sy(tv)}
                  stroke={tv === 0 ? "var(--line-2)" : "var(--hairline)"}
                  strokeWidth={tv === 0 ? 1 : 0.5}
                />
                <text
                  x={PAD.l + innerW + 6} y={geom.sy(tv) + 3}
                  fill="var(--text-dim)" fontSize={9}
                >
                  {fmtTick(tv, geom.ticks.step)}
                </text>
              </g>
            ))}

            {/* strike axis labels */}
            {geom.xt.map((l) => (
              <text
                key={l.v}
                x={l.x}
                y={H - 6}
                fill="var(--text-dim)"
                fontSize={9}
                textAnchor={l.x - PAD.l < 20 ? "start" : PAD.l + innerW - l.x < 20 ? "end" : "middle"}
              >
                {fmtTick(l.v, geom.xStep)}
              </text>
            ))}

            {view === "bars"
              ? series.map((s) => {
                  const y0 = geom.sy(0);
                  const y = geom.sy(s.y);
                  const bw = Math.max(1, Math.min(6, innerW / Math.max(series.length, 1) - 1));
                  return (
                    <rect
                      key={s.x}
                      x={geom.sx(s.x) - bw / 2}
                      y={Math.min(y, y0)}
                      width={bw}
                      height={Math.max(0.6, Math.abs(y - y0))}
                      fill={sideColor(s.y)}
                      opacity={0.85}
                    />
                  );
                })
              : (
                <polyline
                  fill="none"
                  stroke="var(--brand-2)"
                  strokeWidth={1.5}
                  points={series.map((s) => `${geom.sx(s.x)},${geom.sy(s.y)}`).join(" ")}
                />
              )}

            {/* wall markers — the levels the rest of the tab talks about, on the chart */}
            {wallMarks.map((m) => (
              <g key={m.label}>
                <line
                  x1={m.x} x2={m.x} y1={PAD.t} y2={PAD.t + innerH}
                  stroke="var(--text-dim)" strokeWidth={0.75} strokeDasharray="2 4"
                />
                <text x={m.x + 3} y={PAD.t + innerH - 4} fill="var(--text-dim)" fontSize={8.5}>
                  {m.label}
                </text>
              </g>
            ))}

            {Number.isFinite(spot ?? NaN) && (spot as number) > geom.x0 && (spot as number) < geom.x1 && (
              <>
                <line
                  x1={geom.sx(spot as number)} x2={geom.sx(spot as number)}
                  y1={PAD.t} y2={PAD.t + innerH}
                  stroke="var(--text-2)" strokeWidth={1} strokeDasharray="3 3"
                />
                <text
                  x={geom.sx(spot as number) + 4} y={PAD.t + 9}
                  fill="var(--text-2)" fontSize={9}
                >
                  {t("hgSpot")}
                </text>
              </>
            )}
          </svg>
        )}
      </div>

      {hasData && geom && (
        <div style={{ ...UNIT, textAlign: "center", marginTop: 2 }}>{t("hgStrikeAxis")}</div>
      )}

      <CardSpacer />
      <CardFoot>
        {t("hgLegendByStrike")}
        {hasData
          ? ` · ${t("hgScale").replace("{v}", fmtMnMag(view === "bars" ? p.maxAbsMn : p.maxAbsCumMn))}`
          : ""}
        {` · ${t("hgCoverage").replace("{known}", String(p.knownRows)).replace("{total}", String(p.inputRows))}`}
        {p.missingRows > 0 ? ` · ${t("hgPartial")}` : ""}
        {windowNote ? ` · ${windowNote}` : ""}
      </CardFoot>
    </MscCard>
  );
}

function perUnitKey(u: string): MscKey {
  return u === "1% spot" ? "hgUnitSpot"
    : u === "1 vol point" ? "hgUnitVol"
    : u === "1 day" ? "hgUnitDay"
    : "hgUnitPosition";
}

// ─── Card 2: term structure — zero-centred bars per expiration ──────────────────────

const TS_MAX_ROWS = 10;

export function TermStructureCard({
  byExpiry,
  asof,
  lang,
}: {
  byExpiry: readonly MscExpiryRow[] | null | undefined;
  asof: string | null | undefined;
  lang: Lang;
}) {
  const t = makeMscT(lang);
  const ts = useMemo(() => termStructure(byExpiry, "gamma", asof), [byExpiry, asof]);
  const nodes = ts.nodes;
  const max = ts.maxAbsMn || 1;

  const bandsPresent = useMemo(() => {
    const s = new Set<TenorBand>();
    for (const n of nodes.slice(0, TS_MAX_ROWS)) if (n.band) s.add(n.band);
    return [...s];
  }, [nodes]);

  return (
    <MscCard
      title={t("tsTitle")}
      info={`${t("tsLead")} ${t("tsBandWhy")} ${t("tsGammaOnly")}`}
      tier={t("tierB")}
      tierWhy={t("tierBWhy")}
      span={4}
    >
      {!nodes.length ? (
        <CardFoot>{t("tsNone")}</CardFoot>
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {nodes.slice(0, TS_MAX_ROWS).map((n) => {
              const frac = Math.min(1, Math.abs(n.hedgeMn) / max);
              return (
                <div key={n.exp} style={TS_ROW}>
                  <span
                    style={{
                      width: 3, height: 11, borderRadius: 1, flexShrink: 0,
                      background: n.band ? BAND_COLOR[n.band] : "transparent",
                    }}
                    aria-hidden
                  />
                  <span style={TS_EXP}>{n.exp.slice(5)}</span>
                  <span style={TS_DTE}>
                    {n.dte == null ? "—" : t("dteUnit").replace("{n}", String(n.dte))}
                  </span>
                  <span style={TS_BAR_BOX} aria-hidden>
                    <span style={TS_BAR_MID} />
                    <span
                      style={{
                        position: "absolute",
                        top: 2,
                        bottom: 2,
                        borderRadius: 1,
                        background: sideColor(n.hedgeMn),
                        opacity: 0.85,
                        left: n.hedgeMn < 0 ? `${50 - frac * 50}%` : "50%",
                        width: `${Math.max(1.5, frac * 50)}%`,
                      }}
                    />
                  </span>
                  <span style={{ ...TS_VAL, color: sideColor(n.hedgeMn) }}>{fmtMn(n.hedgeMn)}</span>
                </div>
              );
            })}
          </div>

          {bandsPresent.length > 0 && (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 6 }}>
              {bandsPresent.map((b) => (
                <span key={b} style={BAND_LEG}>
                  <span
                    style={{ width: 3, height: 9, borderRadius: 1, background: BAND_COLOR[b] }}
                    aria-hidden
                  />
                  {t(BAND_KEY[b])}
                </span>
              ))}
            </div>
          )}

          <CardSpacer />
          <CardFoot>
            {t("hgLegend")}
            {nodes.length > TS_MAX_ROWS
              ? ` · ${t("tsMore").replace("{n}", String(nodes.length - TS_MAX_ROWS))}`
              : ""}
          </CardFoot>
        </>
      )}
    </MscCard>
  );
}

// ─── Card 3: today's hedging ─────────────────────────────────────────────────────────

export function DailyHedgingCard({
  agg,
  emPct1sig,
  lang,
}: {
  agg: AggregateResult;
  emPct1sig: number | null;
  lang: Lang;
}) {
  const t = makeMscT(lang);
  const d = useMemo(() => dailyHedging(agg, emPct1sig), [agg, emPct1sig]);

  const legs: { key: MscKey; v: number | null; note: string }[] = [
    // "+", not "±": dailyHedging computes the leg for a one-sigma move UP — a down
    // move mirrors the gamma leg's sign, and a ± label would claim a symmetry the
    // number does not have (adversarial-audit finding, deferred then fixed).
    { key: "dhSpot", v: d.fromSpotMn, note: d.emPct == null ? "" : `+${d.emPct.toFixed(2)}%` },
    {
      key: "dhVol",
      v: d.fromVolMn,
      note: d.volPts == null ? "" : t("volPtNote").replace("{n}", String(d.volPts)),
    },
    { key: "dhTime", v: d.fromTimeMn, note: t("dhOneDay") },
  ];

  return (
    <MscCard
      title={t("dhTitle")}
      info={`${t("dhLead")} ${t("dhDisclose")}`}
      tier={t("tierB")}
      tierWhy={t("tierBWhy")}
      span={4}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {legs.map((l) => (
          <div key={l.key} style={LEG_ROW}>
            <span style={LEG_LBL}>
              {t(l.key)}
              {l.note && <span style={{ color: "var(--text-dim)", marginLeft: 5, textTransform: "none" }}>{l.note}</span>}
            </span>
            <span style={{ ...LEG_VAL, color: l.v == null ? "var(--text-dim)" : sideColor(l.v) }}>
              {l.v == null ? t("dhAbsent") : fmtMn(l.v)}
            </span>
          </div>
        ))}
        <div style={{ ...LEG_ROW, borderTop: "1px solid var(--line)", paddingTop: 6 }}>
          <span style={{ ...LEG_LBL, color: "var(--text-2)" }}>{t("dhTotal")}</span>
          <span style={{ ...LEG_VAL, fontSize: 15, fontWeight: 700, color: d.totalMn == null ? "var(--text-dim)" : sideColor(d.totalMn) }}>
            {d.totalMn == null ? "—" : fmtMn(d.totalMn)}
          </span>
        </div>
      </div>

      <CardSpacer />
      <CardFoot>{t("dhLegend")}</CardFoot>
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

const TS_ROW: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 6, minWidth: 0,
};

const TS_EXP: React.CSSProperties = {
  width: 40, flexShrink: 0, fontSize: 10.5, color: "var(--text)",
  fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap",
};

const TS_DTE: React.CSSProperties = {
  width: 32, flexShrink: 0, fontSize: 10, color: "var(--text-2)",
  fontVariantNumeric: "tabular-nums", textAlign: "right", whiteSpace: "nowrap",
};

const TS_BAR_BOX: React.CSSProperties = {
  position: "relative", flex: 1, minWidth: 30, height: 13,
  background: "var(--inset)", borderRadius: 2, overflow: "hidden",
};

const TS_BAR_MID: React.CSSProperties = {
  position: "absolute", left: "50%", top: 0, bottom: 0, width: 1,
  background: "var(--line-2)",
};

const TS_VAL: React.CSSProperties = {
  width: 58, flexShrink: 0, fontSize: 10.5, fontWeight: 600, textAlign: "right",
  fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap",
};

const BAND_LEG: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 4,
  fontSize: 10, color: "var(--muted)",
};

const LEG_ROW: React.CSSProperties = {
  display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10,
};

const LEG_LBL: React.CSSProperties = {
  fontSize: "var(--fs-micro)", letterSpacing: ".04em", textTransform: "uppercase",
  color: "var(--text-dim)",
};

const LEG_VAL: React.CSSProperties = {
  fontSize: 13, fontWeight: 600, fontVariantNumeric: "tabular-nums",
};

const EMPTY_SM: React.CSSProperties = {
  padding: "24px 8px", textAlign: "center", fontSize: 11, color: "var(--muted)",
};
