"use client";
/**
 * VolVrpPanel — descriptive history of the source-reported IV minus trailing
 * realized-volatility spread. It preserves the existing R2.3 level/trend/velocity
 * analysis without promoting the spread into a relative-value or trading verdict.
 *
 * DATA HONESTY: the headline spread is the PUBLISHED figure (options_hub.vol/v1 `vrp` =
 * atm_iv − rv20, upstream). The series behind the band is DERIVED client-side from the
 * aggregate-trend store (`agg:{ROOT}` — per-session spot and ATM IV back to 2017):
 * rv20 recomputed from published closes with the standard annualisation, VRP(t) =
 * iv(t) − rv20(t). Derivation is disclosed in the ⓘ; when the agg store is absent the
 * panel declines the historical-range classification rather than asserting one from a single point.
 *
 * Vol is NON-DIRECTIONAL: neutral accents; upper/lower-range tones use
 * --warn/--signal (severity/attention), never --up/--down (which flip in zh).
 *
 * SVG LAW: svgChart.ts primitives throughout.
 */

import React, { useMemo, useRef } from "react";
import { fmtTick, niceTicks, padDomain, thinLabels, useChartWidth } from "@/components/charts/svgChart";
import { makeVolT } from "./volStrings";
import { ProvenanceLine, PanelEmpty } from "./volShared";
import type { AggTrendPayload } from "@/lib/aggTrend";
import type { Lang } from "@/lib/i18n";

// 169, not 190 — this card carries an extra fin-kpis stat row (4 tiles,
// ~78-79px) that VolHistoryPanel/VolTermPanel don't, so its chart needs to be
// shorter for the three CARD TOTALS to land equal (see the matching comment
// in VolHistoryPanel.tsx H=250 / VolTermPanel.tsx H=244). Re-measure all
// three via offsetHeight before changing.
const H = 169;
const PAD = { l: 8, r: 40, t: 12, b: 20 };
/** Regime band percentiles within the trailing window. */
const WINDOW = 252;
const P_LO = 25;
const P_HI = 75;
/** Sessions of derived history required before a regime is asserted. */
const MIN_SESSIONS = 60;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

interface VrpPoint {
  d: string;
  v: number;
}

/** Derive the trailing VRP series (vol points) from the agg store's spot+IV columns. */
export function deriveVrpSeries(agg: AggTrendPayload | null | undefined): VrpPoint[] {
  const series = agg?.series;
  if (!Array.isArray(series) || series.length < 22) return [];
  const out: VrpPoint[] = [];
  // log returns over published closes; rv20 = stdev(last 20) × √252, in percent.
  const rets: number[] = [];
  for (let i = 1; i < series.length; i++) {
    const a = series[i - 1];
    const b = series[i];
    const ok = isNum(a?.s) && isNum(b?.s) && (a.s as number) > 0 && (b.s as number) > 0;
    rets.push(ok ? Math.log((b.s as number) / (a.s as number)) : NaN);
    const iv = b?.iv;
    if (!isNum(iv) || i < 20) continue;
    const win = rets.slice(i - 20, i);
    if (win.some((r) => !Number.isFinite(r))) continue;
    const mean = win.reduce((x, y) => x + y, 0) / win.length;
    const varSum = win.reduce((x, y) => x + (y - mean) ** 2, 0) / (win.length - 1);
    const rv20 = Math.sqrt(varSum * 252) * 100;
    out.push({ d: String(b.d ?? ""), v: iv * 100 - rv20 });
  }
  return out.slice(-WINDOW);
}

function pctileOf(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = (sorted.length - 1) * (p / 100);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function VolVrpPanel({
  vrp,
  agg,
  lang,
}: {
  /** The PUBLISHED headline (atm_iv − rv20 upstream) — never recomputed. */
  vrp: number | null | undefined;
  agg: AggTrendPayload | null;
  lang: Lang;
}) {
  const t = makeVolT(lang);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const w = useChartWidth(boxRef, 460);

  const pts = useMemo(() => deriveVrpSeries(agg), [agg]);
  const enough = pts.length >= MIN_SESSIONS;

  const stats = useMemo(() => {
    if (!enough) return null;
    const vals = pts.map((p) => p.v).filter(Number.isFinite);
    const sorted = [...vals].sort((a, b) => a - b);
    const last = vals[vals.length - 1];
    const lo = pctileOf(sorted, P_LO);
    const hi = pctileOf(sorted, P_HI);
    const less = vals.filter((x) => x < last).length;
    const equal = vals.filter((x) => x === last).length;
    const pct = ((less + equal / 2) / vals.length) * 100;
    const prev1 = vals.length >= 2 ? vals[vals.length - 2] : null;
    const prev5 = vals.length >= 6 ? vals[vals.length - 6] : null;
    const regime: "compressed" | "normal" | "elevated" =
      last <= lo ? "compressed" : last >= hi ? "elevated" : "normal";
    return {
      last,
      lo,
      hi,
      pct,
      regime,
      velocity: prev1 == null ? null : last - prev1,
      trend5: prev5 == null ? null : last - prev5,
    };
  }, [pts, enough]);

  const geom = useMemo(() => {
    if (!enough) return null;
    const ys = pts.map((p) => p.v);
    let [y0, y1] = padDomain(Math.min(...ys), Math.max(...ys), { padFrac: 0.1, includeZero: true });
    y0 = Math.min(y0, 0);
    y1 = Math.max(y1, 0);
    const innerW = Math.max(40, w - PAD.l - PAD.r);
    const innerH = H - PAD.t - PAD.b;
    const sx = (i: number) => PAD.l + (pts.length <= 1 ? 0 : (i / (pts.length - 1)) * innerW);
    const sy = (v: number) => PAD.t + innerH - ((v - y0) / (y1 - y0 || 1)) * innerH;
    // Calendar-boundary month labels, pixel-thinned (chart law R6).
    const bounds: { x: number; label: string }[] = [];
    let prevYm = "";
    pts.forEach((p, i) => {
      const ym = p.d.slice(0, 7);
      if (ym && ym !== prevYm) {
        bounds.push({ x: sx(i), label: prevYm === "" || ym.slice(5) === "01" ? ym : ym.slice(5) });
        prevYm = ym;
      }
    });
    return {
      sx,
      sy,
      innerW,
      innerH,
      ticks: niceTicks(y0, y1, 3),
      labels: thinLabels(bounds, (l) => l.x, 60),
    };
  }, [pts, enough, w]);

  const regimeKey =
    stats?.regime === "compressed" ? "vrpCompressed" : stats?.regime === "elevated" ? "vrpElevated" : "vrpNormal";
  const regimeTone =
    stats?.regime === "elevated" ? "var(--warn)" : stats?.regime === "compressed" ? "var(--signal)" : "var(--text)";

  const fmtPts = (v: number | null | undefined, signed = false) =>
    v == null || !Number.isFinite(v)
      ? "—"
      : `${signed && v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}`;

  return (
    <section className="fin-card" style={{ minWidth: 0 }}>
      <div className="fin-card-h" style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span>{t("vrpTitle")}</span>
        <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--text-dim)" }}>
          {t("vrpDerived")}
        </span>
      </div>

      <div className="fin-kpis" style={{ marginBottom: 4 }}>
        <div className="fin-kpi">
          <span className="k">{t("vrpNow")}</span>
          <span className="v">{fmtPts(vrp ?? stats?.last)}</span>
          <span className="s">{t("vrpUnit")}</span>
        </div>
        <div className="fin-kpi">
          <span className="k">{t("vrpRegime")}</span>
          <span className="v" style={{ color: regimeTone }}>
            {stats ? t(regimeKey) : t("vrpUnknown")}
          </span>
          {stats && <span className="s">{t("vrpPctile").replace("{p}", stats.pct.toFixed(0))}</span>}
        </div>
        <div className="fin-kpi">
          <span className="k">{t("vrpTrend")}</span>
          <span className="v">{stats ? fmtPts(stats.trend5, true) : "—"}</span>
          <span className="s">{t("vrpTrendCaption")}</span>
        </div>
        <div className="fin-kpi">
          <span className="k">{t("vrpVelocity")}</span>
          <span className="v">{stats ? fmtPts(stats.velocity, true) : "—"}</span>
          <span className="s">{t("vrpVelocityCaption")}</span>
        </div>
      </div>

      <div ref={boxRef} style={{ width: "100%", minWidth: 0 }}>
        {!enough || !geom || !stats ? (
          <PanelEmpty title={t("vrpEmptyTitle")} why={t("vrpEmptyWhy")} minHeight={120} />
        ) : (
          <svg viewBox={`0 0 ${w} ${H}`} width={w} height={H} role="img" aria-label={t("vrpTitle")}>
            {/* p25–p75 band: "normal for this ticker", drawn not asserted */}
            <rect
              x={PAD.l}
              y={geom.sy(stats.hi)}
              width={geom.innerW}
              height={Math.max(0.5, geom.sy(stats.lo) - geom.sy(stats.hi))}
              fill="var(--brand-2)"
              opacity={0.08}
            />
            {geom.ticks.values.map((tv) => (
              <g key={tv}>
                <line
                  x1={PAD.l} x2={PAD.l + geom.innerW} y1={geom.sy(tv)} y2={geom.sy(tv)}
                  stroke={tv === 0 ? "var(--line-2)" : "var(--grid)"}
                  strokeWidth={tv === 0 ? 1 : 0.5}
                />
                <text x={PAD.l + geom.innerW + 5} y={geom.sy(tv) + 3} fontSize={9} fill="var(--muted)">
                  {fmtTick(tv, geom.ticks.step)}
                </text>
              </g>
            ))}
            <polyline
              fill="none"
              stroke="var(--brand-2)"
              strokeWidth={1.4}
              strokeLinejoin="round"
              points={pts.map((p, i) => `${geom.sx(i)},${geom.sy(p.v)}`).join(" ")}
            />
            <circle
              cx={geom.sx(pts.length - 1)}
              cy={geom.sy(stats.last)}
              r={2.5}
              fill={regimeTone === "var(--text)" ? "var(--brand)" : regimeTone}
            />
            {geom.labels.map((l) => (
              <text
                key={l.x}
                x={l.x}
                y={H - 6}
                fontSize={9}
                fill="var(--muted)"
                textAnchor={l.x - PAD.l < 20 ? "start" : PAD.l + geom.innerW - l.x < 20 ? "end" : "middle"}
              >
                {l.label}
              </text>
            ))}
          </svg>
        )}
      </div>
      <ProvenanceLine lang={lang} />
    </section>
  );
}
