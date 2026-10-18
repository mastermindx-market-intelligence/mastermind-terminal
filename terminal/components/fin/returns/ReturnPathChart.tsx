"use client";
import { useMemo, useRef, useState } from "react";
import { niceTicks, padDomain, thinLabels, useChartWidth } from "@/components/charts/svgChart";
import type { PathPoint } from "@/lib/returnsIntelligence";
import { dateLabel, pct, returnsT } from "./returnsCopy";
import styles from "./ReturnsWorkspace.module.css";

export type ReturnChartView = "performance" | "relative" | "drawdown";
export default function ReturnPathChart({ points, symbol, benchmark, selected, onSelect, view, horizon, zh }: {
  points: PathPoint[]; symbol: string; benchmark: string; selected: string | null; onSelect: (day: string) => void;
  view: ReturnChartView; horizon: number; zh: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null), width = useChartWidth(ref, 860), height = width < 560 ? 230 : 250;
  const [hover, setHover] = useState<number | null>(null), t = returnsT(zh);
  const left = 18, right = 62, top = 24, bottom = 32, plotWidth = Math.max(1, width - left - right), plotHeight = height - top - bottom;
  const val = (p: PathPoint) => view === "relative" ? p.relative : view === "drawdown" ? p.drawdown : p.value;
  const numbers = points.flatMap(p => [val(p), ...(view === "performance" ? [p.benchmark] : [])]).filter((n): n is number => n != null && Number.isFinite(n));
  const domain = numbers.length ? padDomain(Math.min(...numbers), Math.max(...numbers), { includeZero: true, padFrac: 0.12 }) : [-1, 1];
  const ticks = niceTicks(domain[0], domain[1], 4);
  const x = (i: number) => left + i / Math.max(1, points.length - 1) * plotWidth;
  const y = (v: number) => top + (domain[1] - v) / Math.max(1e-10, domain[1] - domain[0]) * plotHeight;
  function line(select: (p: PathPoint) => number | null): string {
    let active = false;
    return points.map((p, i) => { const v = select(p); if (v == null || !Number.isFinite(v)) { active = false; return ""; } const command = active ? "L" : "M"; active = true; return `${command}${x(i).toFixed(2)},${y(v).toFixed(2)}`; }).join(" ");
  }
  const labels = thinLabels(points.map((p, i) => ({ ...p, i })).filter((_, i) => i === 0 || i === points.length - 1 || i % Math.max(1, Math.floor(points.length / 5)) === 0), p => x(p.i), width < 560 ? 66 : 95);
  const pin = points.findIndex(p => p.date === selected), activeIndex = hover !== null && hover < points.length ? hover : pin >= 0 ? pin : points.length - 1;
  const active = points[activeIndex];
  const dataRows = useMemo(() => points.filter(p => p.value !== null), [points]);
  return <div className={styles.chartWrap} ref={ref}>
    <div className={styles.chartReadout} aria-live="polite"><span>{active ? dateLabel(active.date, zh, { month: "short", day: "numeric", year: "numeric" }) : "—"}</span><strong>{active ? pct(val(active)) : "—"}</strong>{view === "performance" && benchmark && <span>{benchmark} <b>{active ? pct(active.benchmark) : "—"}</b></span>}</div>
    {view === "relative" && !points.some(p => p.relative !== null) && <p className={styles.evidenceNote}>{t(benchmark ? "comparisonUnavailable" : "chooseBenchmark")}</p>}
    <div className={styles.chartInteractive} tabIndex={0} role="group" aria-label={t("chartKeyboard")}
      onKeyDown={event => { let next: number | null = null; if (event.key === "ArrowLeft") next = Math.max(0, activeIndex - 1); if (event.key === "ArrowRight") next = Math.min(points.length - 1, activeIndex + 1); if (event.key === "Home") next = 0; if (event.key === "End") next = points.length - 1; if (next !== null && points[next]) { event.preventDefault(); setHover(null); onSelect(points[next].date); } }}>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label={`${symbol} ${t(view)}`}
        onPointerMove={event => { const rect = event.currentTarget.getBoundingClientRect(); const px = (event.clientX - rect.left) / rect.width * width; setHover(Math.max(0, Math.min(points.length - 1, Math.round((px - left) / plotWidth * (points.length - 1))))); }}
        onPointerLeave={() => setHover(null)} onClick={() => { if (active) onSelect(active.date); }}>
        <rect x={x(Math.max(0, points.length - horizon - 1))} y={top} width={x(points.length - 1) - x(Math.max(0, points.length - horizon - 1))} height={plotHeight} fill="var(--text)" opacity="0.025" />
        {ticks.values.filter(v => v >= domain[0] && v <= domain[1]).map(v => <g key={v}><line x1={left} x2={width - right} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeDasharray={Math.abs(v) < 1e-9 ? undefined : "2 5"} /><text x={width - right + 12} y={y(v) + 4} fill="var(--muted)" fontSize="11">{pct(v, false, Math.abs(ticks.step) < 1 ? 1 : 0)}</text></g>)}
        {view === "performance" && <path d={line(p => p.benchmark)} fill="none" stroke="var(--muted)" strokeWidth="1.6" strokeDasharray="4 4" />}
        <path d={line(val)} fill="none" stroke={view === "drawdown" ? "var(--down)" : "var(--ai, #9d86ff)"} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        {active && <g><line x1={x(activeIndex)} x2={x(activeIndex)} y1={top} y2={height - bottom} stroke="var(--text-dim)" strokeDasharray="3 4" />{val(active) !== null && <circle cx={x(activeIndex)} cy={y(val(active)!)} r="4" fill={view === "drawdown" ? "var(--down)" : "var(--ai, #9d86ff)"} stroke="var(--panel)" strokeWidth="2" />}</g>}
        {labels.map(p => <text key={p.date} x={x(p.i)} y={height - 9} textAnchor={p.i === 0 ? "start" : p.i === points.length - 1 ? "end" : "middle"} fill="var(--muted)" fontSize="11">{dateLabel(p.date, zh, points.length > 252 ? { month: "short", year: "2-digit" } : undefined)}</text>)}
      </svg>
    </div>
    <details className={styles.dataTable}><summary>{t("chartTable")}</summary><div className={styles.tableScroll}><table><thead><tr><th>{t("selectedSession")}</th><th>{symbol}</th><th>{benchmark || t("benchmark")}</th><th>{t("relative")}</th><th>{t("drawdown")}</th></tr></thead><tbody>{dataRows.map(p => <tr key={p.date}><th scope="row">{p.date}</th><td>{pct(p.value)}</td><td>{pct(p.benchmark)}</td><td>{pct(p.relative)}</td><td>{pct(p.drawdown)}</td></tr>)}</tbody></table></div></details>
  </div>;
}
