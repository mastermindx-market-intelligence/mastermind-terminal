"use client";
/**
 * AdvancedSeasonality — the analytics deck beneath the interactive overlay.
 * Every panel recomputes over the caller-supplied ACTIVE year set:
 *   • headline insight cards (this-month edge, best hold window + overfit
 *     verdict, running hot/cold, seasonal fuel-left, coherence),
 *   • Path Fan-Cone (typical trajectory + where this year sits),
 *   • Month Edge table (avg / median / win-rate w/ Wilson CI / best-worst / n),
 *   • Optimal Holding-Window matrix (best contiguous month span to hold),
 *   • Quarter contribution,
 *   • Year-Agreement sign matrix (outlier-immune, visibly respects the toggle).
 *
 * All math lives in lib/seasonal.ts; small N is surfaced honestly (N shown,
 * Wilson intervals, hatched thin-sample cells, permutation-tested best window).
 *
 * Removed 2026-07-28 (D4 review): the Share-of-Return donut. Its weight was
 * Σ|monthly return|, which conflates volatility with drift, and its "top 3 mo"
 * centre stat has a ~25% structural floor — a constant dressed as an insight.
 * Concentration is answered honestly by the month-edge and quarter panels.
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type CSSProperties, type ReactNode } from "react";
import { fmtNum, fmtPct, pick } from "../../lib/finFormat";
import { FinTip, useFinTip } from "./FinCharts";
import { fmtTick, niceTicks, padDomain, useChartWidth } from "../charts/svgChart";
import {
  HORIZON,
  MONTHS_EN,
  MONTHS_ZH,
  QUARTERS,
  monthBoundIdx,
  idxToDateLabel,
  monthlyStats,
  quarterStats,
  holdingWindows,
  bestWindow,
  fullYearStats,
  fanCone,
  runway,
  signAgreement,
  overfitGuard,
  currentMonthIdx,
  wilson,
  type SeasWindow,
  type YearData,
  type WindowStat,
} from "../../lib/seasonal";

interface Props {
  years: YearData[];
  active: Set<string>;
  win?: SeasWindow;
  zh?: boolean;
}

const num = (v: number | null | undefined): v is number => v != null && isFinite(v);
const P = (v: number) => fmtPct(v, { alreadyPct: true, sign: true, decimals: 1 });
const WRp = (w: number) => `${Math.round(w * 100)}%`;
/** English ordinal suffix (1st, 2nd, 3rd, 21st, 42nd …). */
const ord = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};
const pctileTxt = (frac: number, zh: boolean) => (zh ? `${Math.round(frac * 100)} 分位` : `${ord(Math.round(frac * 100))} pctile`);

export function AdvancedSeasonality({ years, active, win, zh = false }: Props) {
  const isActive = useMemo(() => (yr: string) => active.has(yr), [active]);
  const activeList = years.filter((y) => active.has(y.year));
  const nActive = activeList.length;

  // Permutation overfit guard: heavier, so it is computed in a deferred effect and
  // never blocks paint. Lifted to the deck root so the SAME verdict reaches both the
  // headline card and the holding matrix — the 66-window search it corrects for lives
  // in the matrix, so the matrix must state it too.
  // Year labels alone do not identify the data: another symbol or a corrected
  // price history can have the same years. Bind the deferred result to the
  // exact inputs, and hide the prior verdict until this sample is evaluated.
  const [guardResult, setGuardResult] = useState<{
    years: YearData[];
    isActive: typeof isActive;
    value: ReturnType<typeof overfitGuard>;
  } | null>(null);
  const guard = guardResult?.years === years && guardResult.isActive === isActive ? guardResult.value : null;
  useEffect(() => {
    const id = setTimeout(() => setGuardResult({ years, isActive, value: overfitGuard(years, isActive, 200) }), 0);
    return () => clearTimeout(id);
  }, [years, isActive]);

  if (nActive === 0) {
    return (
      <div className="fin-adv">
        <div className="fin-adv-empty">{pick(zh, "Select at least one year to see seasonality stats.", "请至少选择一个年份以查看季节性统计。")}</div>
      </div>
    );
  }
  // Plain-word window statement — the sample scope is never hidden. The default
  // reads "Last 10 years"; a custom chip selection reads "10 years selected".
  const yrsSorted = activeList.map((y) => y.year).sort();
  const span = yrsSorted.length ? `${yrsSorted[0]}–${yrsSorted[yrsSorted.length - 1]}` : "";
  const isPreset = win != null && win !== "max";
  const scope = isPreset
    ? pick(zh, `Last ${win} years`, `近 ${win} 年`)
    : win === "max"
      ? pick(zh, "All history", "全部历史")
      : pick(zh, `${nActive} years selected`, `已选 ${nActive} 年`);
  return (
    <div className="fin-adv">
      <div className="fin-adv-title">
        {pick(zh, "Seasonal read", "季节性解读")}
        <span className="fin-adv-scope">{scope}</span>
        {span && <span className="fin-adv-n">{span} · N={nActive}</span>}
      </div>
      <HeadlineCards years={years} isActive={isActive} guard={guard} zh={zh} />
      <FanConePanel years={years} isActive={isActive} zh={zh} />
      <div className="fin-adv-row2">
        <MonthEdgePanel years={years} isActive={isActive} zh={zh} />
        <HoldingMatrixPanel years={years} isActive={isActive} guard={guard} zh={zh} />
      </div>
      <div className="fin-adv-row3">
        <QuarterPanel years={years} isActive={isActive} zh={zh} />
        <YearAgreementPanel years={years} isActive={isActive} zh={zh} />
      </div>
      {/* provenance: the sample every panel above recomputes over */}
      <div className="fin-asof">
        <span className="num">
          {pick(
            zh,
            `Daily closes · ${scope}${span ? ` (${span})` : ""} · N=${nActive} · all panels above`,
            `日线收盘价 · ${scope}${span ? `（${span}）` : ""} · N=${nActive} · 适用于以上全部面板`,
          )}
        </span>
      </div>
    </div>
  );
}

/* ── headline insight cards ──────────────────────────────────────────────── */
type Guard = ReturnType<typeof overfitGuard> | null;

/**
 * Minimum years a window must actually contain before it is allowed to win the
 * 66-window search. Two years crowning a "best window to hold" is not a finding,
 * it is a coin flip; 5 is the floor once the active set is deep enough to pay it.
 */
const searchMinN = (nActive: number) => Math.max(2, Math.min(5, nActive));

/** The permutation verdict, rendered identically wherever the best window is claimed. */
function VerdictFlag({ guard, zh }: { guard: Guard; zh: boolean }) {
  if (!guard?.verdict) return null;
  const tone = guard.verdict === "NOTABLE" ? "up" : guard.verdict === "WEAK" ? "warn" : "down";
  const txt =
    guard.verdict === "NOTABLE" ? pick(zh, "notable", "显著") : guard.verdict === "WEAK" ? pick(zh, "weak", "偏弱") : pick(zh, "likely noise", "疑似噪声");
  return <span className={"fin-adv-flag " + tone}>{txt}</span>;
}

function HeadlineCards({ years, isActive, guard, zh }: { years: YearData[]; isActive: (y: string) => boolean; guard: Guard; zh: boolean }) {
  const monthsL = zh ? MONTHS_ZH : MONTHS_EN;
  const curM = currentMonthIdx(years);
  const ms = useMemo(() => monthlyStats(years, isActive), [years, isActive]);
  const edge = ms[curM];
  const grid = useMemo(() => holdingWindows(years, isActive), [years, isActive]);
  const nActive = years.filter((y) => isActive(y.year)).length;
  const minN = searchMinN(nActive);
  const best = useMemo(() => bestWindow(grid, "hold", minN), [grid, minN]);
  const rw = useMemo(() => runway(years, isActive), [years, isActive]);

  return (
    <div className="fin-adv-cards">
      {/* this month's edge */}
      <div className="fin-adv-card">
        <div className="fin-adv-card-t">{pick(zh, "This month · ", "本月 · ")}{monthsL[curM]}</div>
        {edge && edge.n > 0 ? (
          <>
            <div className={"fin-adv-card-v " + ((edge.mean ?? 0) >= 0 ? "up" : "down")}>{edge.mean != null ? P(edge.mean) : "—"}</div>
            <div className="fin-adv-card-s">{pick(zh, "avg · ", "平均 · ")}{edge.wr != null ? `${edge.pos}/${edge.n} ${pick(zh, "up", "上涨")}` : "—"}{edge.n < 4 && <span className="fin-adv-flag">{pick(zh, "low N", "样本少")}</span>}</div>
          </>
        ) : (
          <div className="fin-adv-card-v muted">—</div>
        )}
      </div>

      {/* best window to hold */}
      <div className="fin-adv-card">
        <div className="fin-adv-card-t">{pick(zh, "Best window to hold", "最佳持有区间")}</div>
        {best && best.mean != null ? (
          <>
            <div className="fin-adv-card-v up">{monthsL[best.start]}→{monthsL[best.end]}<span className="fin-adv-holdlen"> · {best.end - best.start + 1}{pick(zh, "mo", "月")}</span></div>
            <div className="fin-adv-card-s">{P(best.mean)} {pick(zh, "avg", "平均")} · {best.wr != null ? WRp(best.wr) : "—"} {pick(zh, "WR", "胜率")}
              <VerdictFlag guard={guard} zh={zh} />
            </div>
          </>
        ) : (
          <div className="fin-adv-card-v muted">—</div>
        )}
      </div>

      {/* running hot / cold */}
      {rw.frontier != null && rw.gap != null ? (
        <div className="fin-adv-card">
          <div className="fin-adv-card-t">{pick(zh, "Running hot / cold", "当前强弱")}</div>
          <div className={"fin-adv-card-v " + (rw.gap >= 0 ? "up" : "down")}>{rw.gap >= 0 ? "+" : ""}{fmtNum(rw.gap, { decimals: 1 })}%</div>
          <div className="fin-adv-card-s">{rw.gap >= 0 ? pick(zh, "ahead of a typical year", "领先常年") : pick(zh, "behind a typical year", "落后常年")}{rw.pct != null && ` · ${pctileTxt(rw.pct, zh)}`}</div>
        </div>
      ) : null}

      {/* room left this year (typical move from today to year-end) */}
      {rw.frontier != null && rw.fuelMean != null ? (
        <div className="fin-adv-card">
          <div className="fin-adv-card-t">{pick(zh, "Room left this year", "年内剩余空间")}</div>
          <div className={"fin-adv-card-v " + (rw.fuelMean >= 0 ? "up" : "down")}>{rw.fuelMean >= 0 ? "+" : ""}{fmtNum(rw.fuelMean, { decimals: 1 })}%</div>
          <div className="fin-adv-card-s">{pick(zh, "avg to year-end", "至年末平均")}{rw.fuelP25 != null && rw.fuelP75 != null && ` · ${fmtNum(rw.fuelP25, { decimals: 0 })}…${fmtNum(rw.fuelP75, { decimals: 0 })}%`}</div>
        </div>
      ) : null}

      {/* coherence */}
      <CoherenceCard years={years} isActive={isActive} zh={zh} />
    </div>
  );
}

/**
 * E[max(k, n−k)/n] for k ~ Binomial(n, ½) — what "sign agreement" reads on PURE
 * NOISE at sample size n. It is strongly n-dependent (≈.62 at n=10 but ≈.69 at
 * n=5 and .75 at n=3), so the old fixed 0.72/0.60 thresholds sat BELOW the noise
 * expectation for thin samples: random data graded "MIXED"→"CONSISTENT" exactly
 * when the sample was weakest. Everything the card claims is now stated as
 * EXCESS over this baseline.
 */
const noiseShareCache = new Map<number, number>();
function noiseMaxShare(n: number): number {
  if (n <= 0) return 1;
  const memo = noiseShareCache.get(n);
  if (memo != null) return memo;
  let c = 1; // C(n,0), advanced by the Pascal recurrence
  let acc = 0;
  for (let k = 0; k <= n; k++) {
    acc += (Math.max(k, n - k) / n) * c;
    c = (c * (n - k)) / (k + 1);
  }
  const v = acc / 2 ** n;
  noiseShareCache.set(n, v);
  return v;
}

function CoherenceCard({ years, isActive, zh }: { years: YearData[]; isActive: (y: string) => boolean; zh: boolean }) {
  const sa = useMemo(() => signAgreement(years, isActive), [years, isActive]);
  // Same inclusion rule as signAgreement (months with n ≥ 2), so score and its
  // chance baseline are computed over exactly the same months.
  const e0 = useMemo(() => {
    const ns = monthlyStats(years, isActive).filter((s) => s.n >= 2).map((s) => noiseMaxShare(s.n));
    return ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : null;
  }, [years, isActive]);
  const excess = sa.score != null && e0 != null ? sa.score - e0 : null;
  const thin = sa.nYears < 5;
  const label = thin || excess == null ? null : excess >= 0.1 ? "CONSISTENT" : excess >= 0.04 ? "MIXED" : "WEAK";
  const tone = label === "CONSISTENT" ? "up" : label === "MIXED" ? "warn" : "down";
  const txt = label === "CONSISTENT" ? pick(zh, "Consistent", "一致") : label === "MIXED" ? pick(zh, "Mixed", "混合") : label === "WEAK" ? pick(zh, "Weak", "弱") : "—";
  const pctTxt = (v: number) => `${Math.round(v * 100)}%`;
  return (
    <div className="fin-adv-card">
      <div className="fin-adv-card-t">{pick(zh, "How much to trust it", "可信度")}</div>
      <div className={"fin-adv-card-v " + (label == null ? "muted" : tone)}>{txt}</div>
      <div className="fin-adv-card-s">
        {thin
          ? pick(zh, "needs ≥5 years", "需≥5年")
          : sa.score != null && e0 != null
            ? pick(zh, `sign agreement ${pctTxt(sa.score)} vs ${pctTxt(e0)} by chance`, `同向占比 ${pctTxt(sa.score)} · 随机基线 ${pctTxt(e0)}`)
            : "—"}
      </div>
    </div>
  );
}

/* ── Path Fan-Cone ───────────────────────────────────────────────────────── */
function FanConePanel({ years, isActive, zh }: { years: YearData[]; isActive: (y: string) => boolean; zh: boolean }) {
  const { tip, show, hide } = useFinTip();
  const boxRef = useRef<HTMLDivElement | null>(null);
  const vw = useChartWidth(boxRef, 840);
  const cone = useMemo(() => fanCone(years, isActive), [years, isActive]);
  const monthPulse = useMemo(() => monthlyStats(years, isActive), [years, isActive]);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const vh = vw >= 720 ? 300 : 252;
  const PAD = { t: 12, r: 62, b: 28, l: 8 };
  const iw = vw - PAD.l - PAD.r;
  const ih = vh - PAD.t - PAD.b;
  const months = zh ? MONTHS_ZH : MONTHS_EN;
  const bounds = monthBoundIdx();

  if (cone.points.length === 0 && !cone.current) {
    return <Panel title={pick(zh, "Typical path", "常年轨迹")} subtitle={pick(zh, "median trajectory + this year", "中位轨迹 + 今年")}><div className="fin-adv-panel-empty">{pick(zh, "No data", "暂无数据")}</div></Panel>;
  }

  // Scale to the interquartile path users are trying to read. Historical
  // extremes remain available in the tooltip, but no longer flatten the
  // median/current lines into an unreadable ribbon.
  let rawLo = Infinity, rawHi = -Infinity;
  for (const p of cone.points) {
    rawLo = Math.min(rawLo, p.p25, p.med);
    rawHi = Math.max(rawHi, p.p75, p.med);
  }
  if (cone.current) {
    for (const v of cone.current) {
      if (num(v)) {
        rawLo = Math.min(rawLo, v);
        rawHi = Math.max(rawHi, v);
      }
    }
  }
  const [lo, hi] = isFinite(rawLo)
    ? padDomain(rawLo, rawHi, { includeZero: true, padFrac: 0.1 })
    : ([-1, 1] as [number, number]);
  const ticks = niceTicks(lo, hi, 4);

  const x = (i: number) => PAD.l + (i / (HORIZON - 1)) * iw;
  const y = (v: number) => PAD.t + ih - ((v - lo) / (hi - lo)) * ih;

  const bandPath = (top: (p: (typeof cone.points)[number]) => number, bot: (p: (typeof cone.points)[number]) => number) => {
    const up = cone.points.map((p) => `${x(p.i).toFixed(1)},${y(top(p)).toFixed(1)}`);
    const dn = cone.points.slice().reverse().map((p) => `${x(p.i).toFixed(1)},${y(bot(p)).toFixed(1)}`);
    return "M" + up.join(" L") + " L" + dn.join(" L") + " Z";
  };
  const medLine = cone.points.map((p) => `${x(p.i).toFixed(1)},${y(p.med).toFixed(1)}`).join(" ");
  const curLine = cone.current ? cone.current.map((v, i) => (num(v) ? `${x(i).toFixed(1)},${y(v as number).toFixed(1)}` : null)).filter(Boolean).join(" ") : "";

  const idxAt = (clientX: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    const localX = (clientX - rect.left) * (vw / rect.width);
    return Math.max(0, Math.min(HORIZON - 1, Math.round(((localX - PAD.l) / Math.max(1, iw)) * (HORIZON - 1))));
  };
  const onMove = (e: RPointerEvent) => {
    const i = idxAt(e.clientX);
    setHoverIdx(i);
    const cp = cone.points.find((p) => p.i === i) ?? cone.points.reduce<null | (typeof cone.points)[number]>((best, p) => (best == null || Math.abs(p.i - i) < Math.abs(best.i - i) ? p : best), null);
    const rows = cp
      ? [
          { label: pick(zh, "Median", "中位"), value: P(cp.med), color: "var(--text)" },
          { label: "P25–P75", value: `${P(cp.p25)} … ${P(cp.p75)}`, color: "var(--muted)" },
          { label: pick(zh, "Historical range", "历史区间"), value: `${P(cp.min)} … ${P(cp.max)}`, color: "var(--muted)" },
        ]
      : [];
    if (cone.current && num(cone.current[i])) rows.push({ label: cone.curYear ?? pick(zh, "This year", "今年"), value: P(cone.current[i] as number), color: "var(--brand-2)" });
    show(e, idxToDateLabel(i, zh) + ` · N=${cp?.n ?? 0}`, rows);
  };

  return (
    <Panel
      title={pick(zh, "Typical seasonal path", "常年季节轨迹")}
      subtitle={pick(zh, "interquartile path + monthly rhythm", "四分位轨迹 + 月度节奏")}
      n={cone.nBand}
    >
      <div className="fin-adv-chartbox fin-adv-typical-chart" ref={boxRef} style={{ height: vh }}>
        <svg ref={svgRef} viewBox={`0 0 ${vw} ${vh}`} width={vw} height={vh} className="fin-svg">
          {bounds.map((bi, m) => (m > 0 ? <line key={m} className="fin-seas-sep" x1={x(bi)} x2={x(bi)} y1={PAD.t} y2={PAD.t + ih} /> : null))}
          {ticks.values.map((tick) => (
            <g key={tick}>
              <line className={tick === 0 ? "fin-grid fin-grid-0" : "fin-grid"} x1={PAD.l} x2={vw - PAD.r} y1={y(tick)} y2={y(tick)} />
              <text className="fin-axis-y" x={vw - PAD.r + 5} y={y(tick) + 3}>
                {tick > 0 ? "+" : ""}{fmtTick(tick, ticks.step)}%
              </text>
            </g>
          ))}
          {cone.points.length > 0 && <path className="fin-cone-inner" d={bandPath((p) => p.p75, (p) => p.p25)} />}
          {medLine && <polyline className="fin-cone-med" points={medLine} fill="none" />}
          {curLine && <polyline className="fin-cone-cur" points={curLine} fill="none" />}
          {cone.frontier != null && <line className="fin-cone-now" x1={x(cone.frontier)} x2={x(cone.frontier)} y1={PAD.t} y2={PAD.t + ih} />}
          {bounds.map((bi, m) => {
            const x1 = m < 11 ? x(bounds[m + 1]) : x(HORIZON - 1);
            return <text key={m} className="fin-seas-mlbl" x={(x(bi) + x1) / 2} y={vh - 8} textAnchor="middle">{months[m]}</text>;
          })}
          {hoverIdx != null && <line className="fin-seas-crossline" x1={x(hoverIdx)} x2={x(hoverIdx)} y1={PAD.t} y2={PAD.t + ih} />}
          <rect x={PAD.l} y={PAD.t} width={iw} height={ih} fill="transparent" className="fin-seas-overlay" onPointerMove={onMove} onPointerLeave={() => { setHoverIdx(null); hide(); }} />
        </svg>
      </div>
      <div className="fin-adv-conelegend">
        <span className="fin-adv-cl"><i className="fin-adv-cl-med" />{pick(zh, "Median", "中位")}</span>
        <span className="fin-adv-cl"><i className="fin-adv-cl-band" />P25–P75</span>
        {cone.curYear && <span className="fin-adv-cl"><i className="fin-adv-cl-cur" />{cone.curYear}</span>}
      </div>
      <div className="fin-adv-monthpulse" aria-label={pick(zh, "Monthly median returns and hit rates", "月度中位收益与胜率")}>
        {monthPulse.map((m) => {
          const tone = m.median == null ? "muted" : m.median >= 0 ? "up" : "down";
          return (
            <div className={"fin-adv-monthpulse-cell " + tone} key={m.month}>
              <span className="fin-adv-monthpulse-m">{months[m.month]}</span>
              <strong>{m.median == null ? "—" : P(m.median)}</strong>
              <small>{m.n ? `${Math.round((m.wr ?? 0) * 100)}% ${pick(zh, "up", "上涨")}` : "—"}</small>
            </div>
          );
        })}
      </div>
      <FinTip tip={tip} />
    </Panel>
  );
}

/* ── Month Edge table ────────────────────────────────────────────────────── */
type SortKey = "month" | "mean" | "wr";
function MonthEdgePanel({ years, isActive, zh }: { years: YearData[]; isActive: (y: string) => boolean; zh: boolean }) {
  const monthsL = zh ? MONTHS_ZH : MONTHS_EN;
  const curM = currentMonthIdx(years);
  const ms = useMemo(() => monthlyStats(years, isActive), [years, isActive]);
  const [sort, setSort] = useState<SortKey>("month");
  const rows = useMemo(() => {
    const r = ms.slice();
    if (sort === "mean") r.sort((a, b) => (b.mean ?? -Infinity) - (a.mean ?? -Infinity));
    else if (sort === "wr") r.sort((a, b) => (b.wr ?? -Infinity) - (a.wr ?? -Infinity));
    return r;
  }, [ms, sort]);

  return (
    <Panel title={pick(zh, "Best months", "最佳月份")} subtitle={pick(zh, "average return and how often each month rose", "各月平均收益与上涨频率")}>
      <div className="fin-adv-table-scroll">
        <table className="fin-adv-table">
          <thead>
            <tr>
              <th className="l" onClick={() => setSort("month")}>{pick(zh, "Mo", "月")}</th>
              <th className={"r sortable" + (sort === "mean" ? " on" : "")} onClick={() => setSort("mean")}>{pick(zh, "Avg", "平均")}</th>
              <th className="r">{pick(zh, "Med", "中位")}</th>
              <th className={"wr sortable" + (sort === "wr" ? " on" : "")} onClick={() => setSort("wr")}>{pick(zh, "Win rate", "胜率")}</th>
              <th className="r">{pick(zh, "Best", "最佳")}</th>
              <th className="r">{pick(zh, "Worst", "最差")}</th>
              <th className="r dim">N</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const isNow = s.month === curM;
              const [lo, hi] = s.n > 0 ? wilson(s.pos, s.n) : [0, 1];
              const point = s.wr ?? 0;
              const straddle = lo < 0.5 && hi > 0.5;
              return (
                <tr key={s.month} className={"fin-adv-trow" + (isNow ? " now" : "") + (s.n < 4 ? " lowN" : "")}>
                  <td className="l">
                    {monthsL[s.month]}
                    {isNow && <span className="fin-adv-nowchip">{pick(zh, "NOW", "本月")}</span>}
                  </td>
                  <td className={"r " + (num(s.mean) ? (s.mean! >= 0 ? "up" : "down") : "")}>{num(s.mean) ? P(s.mean!) : "—"}</td>
                  <td className={"r " + (num(s.median) ? (s.median! >= 0 ? "up" : "down") : "")}>{num(s.median) ? P(s.median!) : "—"}</td>
                  <td className="wr">
                    {s.n > 0 ? (
                      <span className="fin-adv-wrbar" title={`${Math.round(lo * 100)}–${Math.round(hi * 100)}% CI`}>
                        <span className={"fin-adv-wrci" + (straddle ? " straddle" : "")} style={{ left: `${lo * 100}%`, width: `${(hi - lo) * 100}%` }} />
                        <span className={"fin-adv-wrfill" + (point >= 0.5 ? " up" : " down")} style={{ width: `${point * 100}%` }} />
                        <span className="fin-adv-wrtxt">{WRp(point)}</span>
                      </span>
                    ) : "—"}
                  </td>
                  <td className="r up sm">{s.best ? `${P(s.best.ret)}` : "—"}<span className="fin-adv-yr">{s.best?.year.slice(2)}</span></td>
                  <td className="r down sm">{s.worst ? `${P(s.worst.ret)}` : "—"}<span className="fin-adv-yr">{s.worst?.year.slice(2)}</span></td>
                  <td className="r dim">{s.n}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/* ── Optimal Holding-Window matrix ───────────────────────────────────────── */
function HoldingMatrixPanel({ years, isActive, guard, zh }: { years: YearData[]; isActive: (y: string) => boolean; guard: Guard; zh: boolean }) {
  const { tip, show, hide } = useFinTip();
  const monthsL = zh ? MONTHS_ZH : MONTHS_EN;
  const grid = useMemo(() => holdingWindows(years, isActive), [years, isActive]);
  const nActive = years.filter((y) => isActive(y.year)).length;
  const minN = searchMinN(nActive);
  const best = useMemo(() => bestWindow(grid, "hold", minN), [grid, minN]);
  const bestSharpe = useMemo(() => bestWindow(grid, "sharpe", minN), [grid, minN]);

  let maxAbs = 0;
  for (let s = 0; s < 12; s++) for (let e = s; e < 12; e++) { const w = grid[s][e]; if (w && num(w.mean)) maxAbs = Math.max(maxAbs, Math.abs(w.mean!)); }
  if (maxAbs === 0) maxAbs = 1;

  const size = 300;
  const lab = 16;
  const cell = (size - lab) / 12;

  const cellTip = (e: RPointerEvent, w: WindowStat) => {
    show(e, `${monthsL[w.start]} → ${monthsL[w.end]}`, [
      { label: pick(zh, "Avg", "平均"), value: num(w.mean) ? P(w.mean!) : "—", color: num(w.mean) && w.mean! >= 0 ? "var(--up)" : "var(--down)" },
      { label: pick(zh, "Median", "中位"), value: num(w.median) ? P(w.median!) : "—", color: "var(--text-2)" },
      { label: pick(zh, "Win rate", "胜率"), value: w.wr != null ? `${WRp(w.wr)} (${w.n})` : "—", color: "var(--text-2)" },
      { label: pick(zh, "Risk-adj", "风险调整"), value: num(w.sharpe) ? fmtNum(w.sharpe, { decimals: 2 }) : "—", color: "var(--muted)" },
    ]);
  };

  return (
    <Panel title={pick(zh, "Best stretch to hold", "最佳持有区间")} subtitle={pick(zh, "average return of buying one month, selling another", "在某月买入、另一月卖出的平均收益")}>
      {best && best.mean != null ? (
        <div className="fin-adv-bestcall">
          <span className="fin-adv-bestcall-w">{monthsL[best.start]} → {monthsL[best.end]} <span className="fin-adv-holdlen">· {best.end - best.start + 1}{pick(zh, "mo", "月")}</span></span>
          <span className="fin-adv-bestcall-v up">{P(best.mean)}</span>
          <span className="fin-adv-bestcall-s">{best.wr != null ? `${WRp(best.wr)} ${pick(zh, "WR", "胜率")}` : ""} · N={best.n}</span>
          {/* the 66-window search lives HERE, so its permutation verdict belongs here too */}
          <VerdictFlag guard={guard} zh={zh} />
        </div>
      ) : null}
      <div className="fin-adv-matrixbox">
        <svg viewBox={`0 0 ${size} ${size}`} className="fin-adv-matrix" width="100%">
          {/* col labels (sell) */}
          {monthsL.map((m, e) => (
            <text key={"c" + e} className="fin-adv-mx-lbl" x={lab + cell * e + cell / 2} y={lab - 5} textAnchor="middle">{m.slice(0, zh ? 2 : 1)}</text>
          ))}
          {/* row labels (buy) */}
          {monthsL.map((m, s) => (
            <text key={"r" + s} className="fin-adv-mx-lbl" x={lab - 4} y={lab + cell * s + cell / 2 + 3} textAnchor="end">{m.slice(0, zh ? 2 : 1)}</text>
          ))}
          {grid.map((rowArr, s) =>
            rowArr.map((w, e) => {
              if (!w || e < s) return null;
              const gx = lab + cell * e;
              const gy = lab + cell * s;
              const hasN = w.n >= Math.min(3, nActive);
              const mag = num(w.mean) ? Math.abs(w.mean!) / maxAbs : 0;
              const fill = !num(w.mean) || w.n === 0 ? "var(--line-2)" : w.mean! >= 0 ? "var(--up)" : "var(--down)";
              const op = w.n === 0 ? 0.15 : Math.max(0.12, 0.15 + mag * 0.78) * Math.min(1, w.n / Math.max(1, nActive));
              const isBest = best && w.start === best.start && w.end === best.end;
              const isBestS = bestSharpe && w.start === bestSharpe.start && w.end === bestSharpe.end;
              return (
                <g key={`${s}-${e}`}>
                  <rect x={gx + 0.5} y={gy + 0.5} width={cell - 1} height={cell - 1} rx={1.5} fill={fill} fillOpacity={op}
                    className={"fin-adv-mx-cell" + (hasN ? "" : " thin")}
                    onPointerMove={(ev) => cellTip(ev, w)} onPointerLeave={hide} />
                  {isBest && <rect x={gx + 0.5} y={gy + 0.5} width={cell - 1} height={cell - 1} rx={1.5} fill="none" stroke="var(--warn)" strokeWidth={1.6} className="fin-adv-mx-crown" />}
                  {isBestS && !isBest && <rect x={gx + 1.5} y={gy + 1.5} width={cell - 3} height={cell - 3} rx={1} fill="none" stroke="var(--brand-2)" strokeWidth={1} strokeDasharray="2 1.5" />}
                </g>
              );
            }),
          )}
        </svg>
      </div>
      <div className="fin-adv-mx-key">
        {/* the crown marks the hold-SCORE winner (mean/√len × WR), not the highest average */}
        <span><i className="fin-adv-mx-crownkey" />{pick(zh, "Best window", "最佳区间")}</span>
        <span><i className="fin-adv-mx-sharpekey" />{pick(zh, "Best risk-adj", "最佳风险调整")}</span>
        <span className="dim">{pick(zh, "faint = thin sample", "浅色=样本少")}</span>
      </div>
      <FinTip tip={tip} />
    </Panel>
  );
}

/* ── Quarter contribution ────────────────────────────────────────────────── */
function QuarterPanel({ years, isActive, zh }: { years: YearData[]; isActive: (y: string) => boolean; zh: boolean }) {
  const qs = useMemo(() => quarterStats(years, isActive), [years, isActive]);
  const fy = useMemo(() => fullYearStats(years, isActive), [years, isActive]);
  let mx = 0.01;
  for (const q of qs) if (num(q.mean)) mx = Math.max(mx, Math.abs(q.mean!));
  return (
    <Panel title={pick(zh, "Quarter contribution", "季度贡献")} subtitle={pick(zh, "avg compounded return per quarter", "各季度平均复合收益")}>
      <div className="fin-adv-qrows">
        {qs.map((q) => (
          <div className="fin-adv-qrow" key={q.quarter}>
            <span className="fin-adv-qlbl">{QUARTERS[q.quarter]}</span>
            <span className="fin-adv-qbar">
              <span className="fin-adv-qbar-mid" />
              {num(q.mean) && (
                <span
                  className={"fin-adv-qbar-fill " + (q.mean! >= 0 ? "up" : "down")}
                  style={{ width: `${(Math.abs(q.mean!) / mx) * 50}%`, [q.mean! >= 0 ? "left" : "right"]: "50%" } as CSSProperties}
                />
              )}
            </span>
            <span className={"fin-adv-qval " + (num(q.mean) ? (q.mean! >= 0 ? "up" : "down") : "")}>{num(q.mean) ? P(q.mean!) : "—"}</span>
            <span className="fin-adv-qwr">{q.wr != null ? WRp(q.wr) : "—"}</span>
          </div>
        ))}
        <div className="fin-adv-qrow total">
          <span className="fin-adv-qlbl">{pick(zh, "Year", "全年")}</span>
          <span className="fin-adv-qbar" />
          <span className={"fin-adv-qval " + (num(fy.mean) ? (fy.mean! >= 0 ? "up" : "down") : "")}>{num(fy.mean) ? P(fy.mean!) : "—"}</span>
          <span className="fin-adv-qwr">{fy.wr != null ? WRp(fy.wr) : "—"}</span>
        </div>
      </div>
    </Panel>
  );
}

/* ── Year-Agreement sign matrix ──────────────────────────────────────────── */
function YearAgreementPanel({ years, isActive, zh }: { years: YearData[]; isActive: (y: string) => boolean; zh: boolean }) {
  const { tip, show, hide } = useFinTip();
  const monthsL = zh ? MONTHS_ZH : MONTHS_EN;
  const rows = years.filter((y) => isActive(y.year));
  return (
    <Panel title={pick(zh, "Up or down, year by year", "逐年涨跌")} subtitle={pick(zh, "each month's direction in every year — % up along the bottom", "每年各月的涨跌方向，底部为上涨占比")}>
      <div className="fin-adv-yamx">
        <div className="fin-adv-yamx-head">
          <span className="fin-adv-yamx-corner" />
          {monthsL.map((m, i) => <span key={i} className="fin-adv-yamx-mh">{m.slice(0, zh ? 2 : 1)}</span>)}
        </div>
        {rows.map((y) => (
          <div className="fin-adv-yamx-row" key={y.year}>
            <span className={"fin-adv-yamx-yr" + (y.isCurrent ? " cur" : "")}>{y.year.slice(2)}</span>
            {y.monthlyRet.map((r, m) => {
              const cls = r == null || !isFinite(r) ? "na" : r > 0 ? "up" : r < 0 ? "down" : "flat";
              return (
                <span
                  key={m}
                  className={"fin-adv-yamx-cell " + cls}
                  onPointerMove={(e) => show(e, `${y.year} · ${monthsL[m]}`, [{ label: pick(zh, "Return", "收益"), value: r == null ? "—" : P(r), color: r != null && r >= 0 ? "var(--up)" : "var(--down)" }])}
                  onPointerLeave={hide}
                />
              );
            })}
          </div>
        ))}
        <div className="fin-adv-yamx-row agg">
          <span className="fin-adv-yamx-yr dim">{pick(zh, "↑%", "↑%")}</span>
          {Array.from({ length: 12 }).map((_, m) => {
            const vals = rows.map((y) => y.monthlyRet[m]).filter((v): v is number => v != null && isFinite(v));
            const up = vals.filter((v) => v > 0).length;
            const frac = vals.length ? up / vals.length : 0;
            const unanimous = vals.length >= 3 && (up === vals.length || up === 0);
            return (
              <span key={m} className={"fin-adv-yamx-agg" + (unanimous ? " star" : "")} title={`${up}/${vals.length}`}>
                {vals.length ? Math.round(frac * 100) : "—"}
              </span>
            );
          })}
        </div>
      </div>
      <FinTip tip={tip} />
    </Panel>
  );
}

/* ── shared panel frame ──────────────────────────────────────────────────── */
function Panel({ title, subtitle, n, children }: { title: string; subtitle?: string; n?: number; children: ReactNode }) {
  return (
    <div className="fin-adv-panel">
      <div className="fin-adv-panel-h">
        <span className="fin-adv-panel-t">{title}</span>
        {subtitle && <span className="fin-adv-panel-s">{subtitle}</span>}
        {n != null && <span className="fin-adv-panel-n">N={n}</span>}
      </div>
      {children}
    </div>
  );
}
