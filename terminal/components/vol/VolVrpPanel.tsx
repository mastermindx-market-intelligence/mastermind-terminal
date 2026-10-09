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
 * Only a resolved agg read (a payload, or a 404) may be described as published or not; a read
 * still in flight or one that did not land has its own state and contributes no history.
 *
 * Vol is NON-DIRECTIONAL: neutral accents; upper/lower-range tones use
 * --warn/--signal (severity/attention), never --up/--down (which flip in zh).
 *
 * SVG LAW: svgChart.ts primitives throughout.
 */

import React, { useMemo, useRef } from "react";
import { fmtTick, niceTicks, padDomain, thinLabels, useChartWidth } from "@/components/charts/svgChart";
import { makeVolT } from "./volStrings";
import { ProvenanceLine, PanelEmpty, volIsoDay } from "./volShared";
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

/** Where the `agg:{ROOT}` read stands: in flight, answered (payload or 404), or failed. */
export type AggRead = "loading" | "resolved" | "unavailable";

interface VrpPoint {
  d: string;
  v: number;
  /** Source session position in agg.series; non-consecutive values mark missing sessions. */
  i: number;
}

/** Consecutive-session runs: a missing derived session breaks the line, never bridges it. */
function sessionRuns(pts: VrpPoint[]): VrpPoint[][] {
  const runs: VrpPoint[][] = [];
  for (const p of pts) {
    const run = runs[runs.length - 1];
    if (run && run[run.length - 1].i === p.i - 1) run.push(p);
    else runs.push([p]);
  }
  return runs;
}

/**
 * Session identity admission for agg.series. A row keeps its date only when that exact ISO
 * day is strictly later than every earlier dated row AND strictly earlier than every later
 * one. A duplicate date or an ordering inversion therefore turns EVERY row involved into a
 * gap: the client never picks a winning revision or a "correct" position, and no return is
 * computed across a pair of rows whose session order is not established.
 */
function admitSessionDays(raw: unknown[]): {
  days: (string | null)[];
  isoDays: (string | null)[];
  orderRejected: number;
  orderRejectedIdx: number[];
  malformedDates: number;
} {
  const days = raw.map((d) => volIsoDay(d));
  const suffixMin: (string | null)[] = new Array(days.length).fill(null);
  let min: string | null = null;
  for (let i = days.length - 1; i >= 0; i--) {
    suffixMin[i] = min;
    const d = days[i];
    if (d != null && (min == null || d < min)) min = d;
  }
  let max: string | null = null;
  const orderRejectedIdx: number[] = [];
  const admittedDays = days.map((d, i) => {
    const admitted = d != null && (max == null || d > max) && (suffixMin[i] == null || d < (suffixMin[i] as string));
    if (d != null && (max == null || d > max)) max = d;
    // A valid ISO day that is not admitted was rejected only for duplicate/out-of-order identity.
    if (d != null && !admitted) orderRejectedIdx.push(i);
    return admitted ? d : null;
  });
  const malformedDates = days.reduce((n, d) => (d == null ? n + 1 : n), 0);
  return { days: admittedDays, isoDays: days, orderRejected: orderRejectedIdx.length, orderRejectedIdx, malformedDates };
}

export interface VrpHistory {
  points: VrpPoint[];
  /** The agg store supplied at least one row (so "not published" would be false). */
  supplied: boolean;
  /** Supplied rows with a valid date rejected for a duplicate or out-of-order date. */
  orderRejected: number;
  /** Source positions (agg.series index) of those order-rejected rows. */
  orderRejectedIdx: number[];
  /** Supplied rows whose session date is missing or not a valid ISO day. */
  malformedDates: number;
  /**
   * Wording only, never rendered as data: true when the order rejections alone kept the
   * series below MIN_SESSIONS (the same rows with their ISO dates taken as given would reach it).
   */
  orderCausedShortfall: boolean;
}

/** Derive the trailing VRP series (vol points) from the agg store's spot+IV columns. */
export function deriveVrpSeries(agg: AggTrendPayload | null | undefined): VrpPoint[] {
  return deriveVrpHistory(agg).points;
}

/** The derived series plus what was supplied and what admission rejected, for honest empty/partial states. */
export function deriveVrpHistory(agg: AggTrendPayload | null | undefined): VrpHistory {
  const series = agg?.series;
  if (!Array.isArray(series) || series.length === 0) {
    return { points: [], supplied: false, orderRejected: 0, orderRejectedIdx: [], malformedDates: 0, orderCausedShortfall: false };
  }
  const { days, isoDays, orderRejected, orderRejectedIdx, malformedDates } = admitSessionDays(series.map((row) => row?.d));
  const base = { supplied: true, orderRejected, orderRejectedIdx, malformedDates };
  if (series.length < 22) return { ...base, points: [], orderCausedShortfall: false };
  const all = derivePoints(series, days);
  const orderCausedShortfall = orderRejected > 0 && all.length < MIN_SESSIONS
    && derivePoints(series, isoDays).length >= MIN_SESSIONS;
  return { ...base, points: all.slice(-WINDOW), orderCausedShortfall };
}

/** rv20-based spread points for every session whose 20-return window is fully established by `days`. */
function derivePoints(series: NonNullable<AggTrendPayload["series"]>, days: (string | null)[]): VrpPoint[] {
  const out: VrpPoint[] = [];
  // log returns over published closes; rv20 = stdev(last 20) × √252, in percent.
  const rets: number[] = [];
  for (let i = 1; i < series.length; i++) {
    const a = series[i - 1];
    const b = series[i];
    const ok = days[i - 1] != null && days[i] != null
      && isNum(a?.s) && isNum(b?.s) && (a.s as number) > 0 && (b.s as number) > 0;
    rets.push(ok ? Math.log((b.s as number) / (a.s as number)) : NaN);
    const iv = b?.iv;
    if (!isNum(iv) || i < 20) continue;
    const win = rets.slice(i - 20, i);
    if (win.some((r) => !Number.isFinite(r))) continue;
    const mean = win.reduce((x, y) => x + y, 0) / win.length;
    const varSum = win.reduce((x, y) => x + (y - mean) ** 2, 0) / (win.length - 1);
    const rv20 = Math.sqrt(varSum * 252) * 100;
    out.push({ d: days[i] as string, v: iv * 100 - rv20, i });
  }
  return out;
}

/** Order-rejection note: "Partial" only when a rejected row lies inside the drawn window's source span. */
export function vrpOrderNote(lang: Lang, n: number, scope: "window" | "outside" | "undrawn"): string | null {
  if (n <= 0) return null;
  const t = makeVolT(lang);
  const [one, many] = scope === "window"
    ? (["vrpOrderRejectedWindowOne", "vrpOrderRejectedWindow"] as const)
    : scope === "outside"
      ? (["vrpOrderRejectedOutsideOne", "vrpOrderRejectedOutside"] as const)
      : (["vrpOrderRejectedOne", "vrpOrderRejected"] as const);
  return n === 1 ? t(one) : t(many).replace("{n}", String(n));
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
  aggRead = "resolved",
  onRetry,
  sourceAsOf,
  lang,
}: {
  /** The PUBLISHED headline (atm_iv − rv20 upstream) — never recomputed. */
  vrp: number | null | undefined;
  agg: AggTrendPayload | null;
  aggRead?: AggRead;
  /** Re-reads the aggregate-trend store after a read that did not land. */
  onRetry?: () => void;
  /** Source session of the headline options_hub.vol snapshot. */
  sourceAsOf: string | null | undefined;
  lang: Lang;
}) {
  const t = makeVolT(lang);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const w = useChartWidth(boxRef, 460);

  const derived = useMemo(() => deriveVrpHistory(aggRead === "resolved" ? agg : null), [agg, aggRead]);
  const pts = derived.points;
  const enough = pts.length >= MIN_SESSIONS;
  const sourceDay = volIsoDay(typeof sourceAsOf === "string" ? sourceAsOf.slice(0, 10) : null);
  const historyDay = pts.length ? volIsoDay(pts[pts.length - 1].d) : null;
  // Historical context may remain useful when stale, but rank/trend/velocity are
  // current-state claims only when the derived series reaches the same source session.
  const sessionsAligned = enough && sourceDay != null && historyDay === sourceDay;

  const stats = useMemo(() => {
    if (!enough) return null;
    const vals = pts.map((p) => p.v);
    const sorted = [...vals].sort((a, b) => a - b);
    const lastPt = pts[pts.length - 1];
    const last = lastPt.v;
    const lo = pctileOf(sorted, P_LO);
    const hi = pctileOf(sorted, P_HI);
    const less = vals.filter((x) => x < last).length;
    const equal = vals.filter((x) => x === last).length;
    const pct = ((less + equal / 2) / vals.length) * 100;
    // Changes are quoted only against the exact earlier SESSION, never the nearest emitted point.
    const atSession = (i: number) => pts.find((p) => p.i === i)?.v ?? null;
    const prev1 = atSession(lastPt.i - 1);
    const prev5 = atSession(lastPt.i - 5);
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
    // x is the source session position, so a missing session stays a visible gap.
    const i0 = pts[0].i;
    const span = pts[pts.length - 1].i - i0;
    const sx = (i: number) => PAD.l + (span <= 0 ? 0 : ((i - i0) / span) * innerW);
    const sy = (v: number) => PAD.t + innerH - ((v - y0) / (y1 - y0 || 1)) * innerH;
    // Calendar-boundary month labels, pixel-thinned (chart law R6).
    const bounds: { x: number; label: string }[] = [];
    let prevYm = "";
    pts.forEach((p) => {
      const ym = p.d.slice(0, 7);
      if (ym && ym !== prevYm) {
        bounds.push({ x: sx(p.i), label: prevYm === "" || ym.slice(5) === "01" ? ym : ym.slice(5) });
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
      runs: sessionRuns(pts),
    };
  }, [pts, enough, w]);

  const currentStats = sessionsAligned ? stats : null;
  const regimeKey =
    currentStats?.regime === "compressed" ? "vrpCompressed" : currentStats?.regime === "elevated" ? "vrpElevated" : "vrpNormal";
  const regimeTone =
    currentStats?.regime === "elevated" ? "var(--warn)" : currentStats?.regime === "compressed" ? "var(--signal)" : "var(--text)";

  // A supplied store is never described as unpublished; rejected rows are counted, not hidden.
  const drawn = enough && pts.length > 0;
  const rejectedInWindow = drawn
    && derived.orderRejectedIdx.some((r) => r >= pts[0].i && r <= pts[pts.length - 1].i);
  const orderNote = vrpOrderNote(lang, derived.orderRejected, rejectedInWindow ? "window" : drawn ? "outside" : "undrawn");
  // Name the cause that actually emptied a supplied store: ordering only when it alone kept the
  // series short, then malformed dates, else too few sessions with closes and IV.
  const emptyTitle = derived.supplied && derived.orderCausedShortfall ? t("vrpEmptyRejectedTitle") : t("vrpEmptyTitle");
  const emptyWhy = !derived.supplied
    ? t("vrpEmptyWhy")
    : derived.orderCausedShortfall
      ? t("vrpEmptyWhyRejected").replace("{n}", String(derived.orderRejected))
      : derived.malformedDates > 0
        ? (derived.malformedDates === 1 ? t("vrpEmptyWhyMalformedOne") : t("vrpEmptyWhyMalformed").replace("{m}", String(derived.malformedDates)))
          .replace("{n}", String(MIN_SESSIONS))
        : t("vrpEmptyWhyShort").replace("{n}", String(MIN_SESSIONS));

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

      {historyDay && (
        <div data-testid="vrp-history-session" role={!sessionsAligned && sourceDay ? "status" : undefined}
          style={{ fontSize: 10.5, lineHeight: 1.45, color: !sessionsAligned && sourceDay ? "var(--warn)" : "var(--text-dim)", margin: "-2px 0 8px" }}>
          {sessionsAligned
            ? t("vrpHistoryAligned").replace("{date}", historyDay)
            : sourceDay
              ? t("vrpHistoryMismatch").replace("{history}", historyDay).replace("{current}", sourceDay)
              : t("vrpHistoryThrough").replace("{date}", historyDay)}
        </div>
      )}

      {orderNote && (
        <div data-testid="vrp-order-status" role="status"
          style={{ fontSize: 10.5, lineHeight: 1.45, color: "var(--warn)", margin: "-2px 0 8px" }}>
          {orderNote}
        </div>
      )}

      <div className="fin-kpis" style={{ marginBottom: 4 }}>
        <div className="fin-kpi">
          <span className="k">{t("vrpNow")}</span>
          <span className="v">{fmtPts(vrp)}</span>
          <span className="s">{t("vrpUnit")}</span>
        </div>
        <div className="fin-kpi">
          <span className="k">{t("vrpRegime")}</span>
          <span className="v" style={{ color: regimeTone }}>
            {currentStats ? t(regimeKey) : enough ? t("vrpUnaligned") : aggRead === "resolved" ? t("vrpUnknown") : "—"}
          </span>
          {currentStats && <span className="s">{t("vrpPctile").replace("{p}", currentStats.pct.toFixed(0))}</span>}
        </div>
        <div className="fin-kpi">
          <span className="k">{t("vrpTrend")}</span>
          <span className="v">{currentStats ? fmtPts(currentStats.trend5, true) : "—"}</span>
          <span className="s">{currentStats ? t("vrpTrendCaption") : enough ? t("vrpWithheldCaption") : t("vrpTrendCaption")}</span>
        </div>
        <div className="fin-kpi">
          <span className="k">{t("vrpVelocity")}</span>
          <span className="v">{currentStats ? fmtPts(currentStats.velocity, true) : "—"}</span>
          <span className="s">{currentStats ? t("vrpVelocityCaption") : enough ? t("vrpWithheldCaption") : t("vrpVelocityCaption")}</span>
        </div>
      </div>

      <div ref={boxRef} style={{ width: "100%", minWidth: 0 }}>
        {aggRead === "loading" ? (
          <PanelEmpty title={t("vrpLoading")} minHeight={120} />
        ) : aggRead === "unavailable" ? (
          <PanelEmpty
            title={t("vrpErrorTitle")}
            why={t("vrpErrorWhy")}
            minHeight={120}
            action={onRetry && (
              <button type="button" className="btn btn-ghost vol-retry" onClick={onRetry}>{t("retry")}</button>
            )}
          />
        ) : !enough || !geom || !stats ? (
          <PanelEmpty title={emptyTitle} why={emptyWhy} minHeight={120} />
        ) : (
          <svg viewBox={`0 0 ${w} ${H}`} width={w} height={H} role="img" aria-label={orderNote ? `${t("vrpTitle")}. ${orderNote}` : t("vrpTitle")}>
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
            {geom.runs.map((run) => (
              <polyline
                key={run[0].i}
                fill="none"
                stroke="var(--brand-2)"
                strokeWidth={1.4}
                strokeLinejoin="round"
                points={run.map((p) => `${geom.sx(p.i)},${geom.sy(p.v)}`).join(" ")}
              />
            ))}
            <circle
              cx={geom.sx(pts[pts.length - 1].i)}
              cy={geom.sy(stats.last)}
              r={2.5}
              fill={!sessionsAligned || regimeTone === "var(--text)" ? "var(--brand)" : regimeTone}
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
