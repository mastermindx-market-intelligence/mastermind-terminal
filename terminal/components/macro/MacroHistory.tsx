"use client";
import { useId, useMemo, useRef, useState } from "react";
import { fmtTick, niceTicks, padDomain, thinLabels, useChartWidth } from "@/components/charts/svgChart";
import type { MacroHistoryPoint } from "@/lib/shared-shell/macroDashboard";
import s from "./MacroDashboard.module.css";

export default function MacroHistory({ points, lang }: { points: MacroHistoryPoint[]; lang: "en" | "zh" }) {
  const ref = useRef<HTMLDivElement>(null), width = useChartWidth(ref, 520), gradient = useId().replaceAll(":", "");
  const [period, setPeriod] = useState<20 | 60>(60), [table, setTable] = useState(false), [selected, setSelected] = useState<number | null>(null);
  const rows = useMemo(() => points.slice(-period), [points, period]);
  const active = rows[Math.min(selected ?? rows.length - 1, rows.length - 1)];
  const values = rows.map(row => row.score).filter((v): v is number => v !== null);
  const [lower, upper] = values.length ? padDomain(Math.min(...values), Math.max(...values), { padFrac: .22, clampMin: 0 }) : [0, 100];
  const top = Math.min(100, upper), bottom = Math.min(lower, top - 1), height = 218, left = 6, right = 36, plotTop = 16, plotBottom = 181;
  const minTime = Date.parse(rows[0]?.asof ?? "2000-01-01"), maxTime = Date.parse(rows.at(-1)?.asof ?? "2000-01-02");
  const x = (row: MacroHistoryPoint) => left + (Date.parse(row.asof) - minTime) / (maxTime - minTime || 1) * (width - left - right);
  const y = (score: number) => plotBottom - (score - bottom) / (top - bottom) * (plotBottom - plotTop);
  const segments: MacroHistoryPoint[][] = [];
  for (const row of rows) {
    if (row.score === null) { segments.push([]); continue; }
    let segment = segments.at(-1);
    // A missing week is an evidence gap, never an interpolated reading.
    if (!segment || (segment.length && Date.parse(row.asof) - Date.parse(segment.at(-1)!.asof) > 7 * 86400000)) { segment = []; segments.push(segment); }
    segment.push(row);
  }
  const ticks = niceTicks(bottom, top, 3), labels = thinLabels(rows, x, 74);
  const date = (day: string) => new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
  const choose = (clientX: number) => {
    if (!ref.current || !rows.length) return;
    const at = clientX - ref.current.getBoundingClientRect().left;
    setSelected(rows.reduce((best, row, i) => Math.abs(x(row) - at) < Math.abs(x(rows[best]) - at) ? i : best, 0));
  };
  return <section className={s.history} aria-labelledby="macro-history-heading">
    <div className={s.sectionHead}><div><p className={s.eyebrow}>{lang === "zh" ? "实测环境" : "MEASURED BACKDROP"}</p><h2 id="macro-history-heading">{lang === "zh" ? "市场的轨迹" : "The market’s trajectory"}</h2></div>
      <div className={s.segmented} aria-label={lang === "zh" ? "历史范围" : "History range"}>{([20, 60] as const).map(n => <button key={n} aria-pressed={period === n} onClick={() => { setPeriod(n); setSelected(null); }}>{n}{lang === "zh" ? "期" : "S"}</button>)}</div>
    </div>
    <div className={s.chartReadout} aria-live="polite"><strong>{active?.score ?? "—"}</strong><span>{active ? date(active.asof) : (lang === "zh" ? "历史不可用" : "History unavailable")}</span><button onClick={() => setTable(v => !v)} aria-pressed={table}>{table ? (lang === "zh" ? "查看图表" : "Chart view") : (lang === "zh" ? "查看数据" : "Table view")}</button></div>
    <div ref={ref} className={s.chartHost}>
      {table ? <div className={s.historyTable}><table><caption className={s.srOnly}>{lang === "zh" ? "实测分数历史" : "Measured score history"}</caption><thead><tr><th>{lang === "zh" ? "日期" : "Session"}</th><th>{lang === "zh" ? "实测分数" : "Measured score"}</th></tr></thead><tbody>{rows.map(row => <tr key={row.asof}><td>{row.asof}</td><td>{row.score ?? "—"}</td></tr>)}</tbody></table></div> : values.length < 2 ? <p className={s.empty}>{lang === "zh" ? "尚无足够的已发布观测值。" : "Not enough published observations to draw a history."}</p> : <>
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${gradient}-title`} onPointerDown={e => choose(e.clientX)} onPointerMove={e => choose(e.clientX)} onPointerLeave={() => setSelected(null)}>
          <title id={`${gradient}-title`}>{lang === "zh" ? `${rows.length}期实测分数；数值越高，环境越支持风险资产。` : `${rows.length} published sessions of measured score. Higher is more supportive of risk assets.`}</title>
          <defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--brand-2, #4d82ff)" stopOpacity=".15" /><stop offset="100%" stopColor="var(--brand-2, #4d82ff)" stopOpacity="0" /></linearGradient></defs>
          {ticks.values.map(v => <g key={v}><line x1={left} x2={width - right} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeDasharray="3 5" /><text x={width - right + 10} y={y(v) + 4}>{fmtTick(v, ticks.step)}</text></g>)}
          {segments.filter(v => v.length).map((segment, i) => {
            const path = segment.map((row, index) => `${index ? "L" : "M"}${x(row).toFixed(2)},${y(row.score!).toFixed(2)}`).join(" ");
            return <g key={i}><path d={`${path} L${x(segment.at(-1)!)},${plotBottom} L${x(segment[0])},${plotBottom} Z`} fill={`url(#${gradient})`} /><path d={path} fill="none" stroke="var(--brand-2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />{segment.length === 1 && <circle cx={x(segment[0])} cy={y(segment[0].score!)} r="3" fill="var(--brand-2)" />}</g>;
          })}
          {active?.score != null && <g><line x1={x(active)} x2={x(active)} y1={plotTop} y2={plotBottom} stroke="var(--text-2)" strokeDasharray="3 4" opacity=".45" /><circle cx={x(active)} cy={y(active.score)} r="4" fill="var(--panel)" stroke="var(--brand-2)" strokeWidth="2" /></g>}
          {labels.map((row, i) => <text key={row.asof} x={x(row)} y={208} textAnchor={i === 0 ? "start" : i === labels.length - 1 ? "end" : "middle"}>{date(row.asof)}</text>)}
        </svg>
        <input className={s.chartSlider} type="range" min={0} max={Math.max(0, rows.length - 1)} value={selected ?? rows.length - 1} onChange={e => setSelected(Number(e.target.value))} aria-label={lang === "zh" ? "探索历史观测" : "Explore historical observations"} aria-valuetext={active ? `${active.asof}: ${active.score ?? "—"}` : "—"} />
      </>}
    </div>
    <p className={s.caption}>{lang === "zh" ? "已发布的观测值 · 非预测 · 优先采用实测值，旧记录可能包含风险上限调整" : "Published observations · not a forecast · measured values where available; older records may include risk caps"}</p>
  </section>;
}
