"use client";

import { useId, useRef } from "react";
import { fmtTick, niceTicks, padDomain, thinLabels, useChartWidth } from "@/components/charts/svgChart";
import { localText } from "@/lib/shared-shell/readingPayloads";
import type { EconomicCurve, EconomicSelection, EconomicTenor } from "@/lib/shared-shell/macroEconomyPayload";
import { economicNumber } from "./MacroEconomicHistory";
import s from "./MacroEconomy.module.css";

const COPY = {
  en: { title: "The Treasury curve", latest: "Latest observation", prior: "Previous observation", month: "At least 30 days earlier", chart: "Chart", table: "Table", tenor: "Maturity", date: "Reference date", missing: "Unavailable", comparison: "Comparison", note: "Each maturity retains its own observation date. Comparisons use the dates supplied by the publisher.", choose: "Select a maturity", rate: "Yield · %", noComparison: "This publication has no dated observations for the selected comparison.", source: "Source for this maturity", noSource: "This publication has no verified source link for this maturity." },
  zh: { title: "美国国债收益率曲线", latest: "最新观察值", prior: "上次观察值", month: "至少30天前", chart: "图表", table: "表格", tenor: "期限", date: "参考日期", missing: "不可用", comparison: "对比", note: "每个期限保留自身观察日期，对比使用发布方提供的日期。", choose: "选择期限", rate: "收益率·%", noComparison: "本次发布未提供所选对比的带日期观察值。", source: "查看该期限来源", noSource: "本次发布没有可核验的期限来源关联。" },
} as const;
const MATURITY: Record<string, number> = { "3m": .25, "6m": .5, "1y": 1, "2y": 2, "3y": 3, "5y": 5, "7y": 7, "10y": 10, "20y": 20, "30y": 30 };

export default function MacroEconomicCurve({ curve, lang, selection, onSelect, onEvidence }: { curve: EconomicCurve; lang: "en" | "zh"; selection: EconomicSelection; onSelect: (change: Partial<EconomicSelection>) => void; onEvidence: (sourceId: string, trigger?: HTMLElement) => void }) {
  const c = COPY[lang], id = useId(), wrapper = useRef<HTMLDivElement>(null), width = useChartWidth(wrapper, 700);
  const display = selection.display, compare = selection.comparison, selected = selection.tenor;
  const setSelected = (tenor: string) => onSelect({ tenor: tenor as EconomicTenor });
  const rows = [...curve.tenors].sort((a, b) => MATURITY[a.tenor] - MATURITY[b.tenor]), current = rows.find(row => row.tenor === selected);
  const binding = current?.source_binding;
  const values = rows.flatMap(row => [row.today, row[compare]].filter((v): v is number => v !== null));
  const [lo, hi] = values.length ? padDomain(Math.min(...values), Math.max(...values), { includeZero: true }) : [0, 1], ticks = niceTicks(lo, hi, 4);
  const left = 52, right = width - 16, top = 24, bottom = 276, height = 322;
  // Maturities use their actual year distances, not equally spaced labels.
  const x = (row: EconomicCurve["tenors"][number]) => left + MATURITY[row.tenor] / 30 * (right - left);
  const y = (value: number) => bottom - (value - lo) / (hi - lo) * (bottom - top);
  const paths = (key: "today" | "prior_close" | "prior_month") => { const result: string[] = []; let path = ""; for (const row of rows) { const value = row[key]; if (value === null) { if (path) result.push(path); path = ""; } else path += `${path ? " L" : "M"}${x(row)},${y(value)}`; } if (path) result.push(path); return result; };
  const number = (value: number | null) => economicNumber(value, lang, c.missing);
  return <section className={s.history} aria-labelledby={`${id}-title`}>
    <div className={s.sectionHeading}><h2 id={`${id}-title`}>{c.title}</h2><div className={s.segment}>
      <button type="button" aria-pressed={display === "chart"} onClick={() => onSelect({ display: "chart" })}>{c.chart}</button><button type="button" aria-pressed={display === "table"} onClick={() => onSelect({ display: "table" })}>{c.table}</button>
    </div></div>
    <p>{localText(curve.shape_read, lang)}</p>
    <div className={s.historyControls} style={{ marginTop: 20 }}><label>{c.choose}<select value={selected} onChange={event => setSelected(event.target.value)}>{rows.map(row => <option key={row.tenor} value={row.tenor}>{localText(row.label, lang)}</option>)}</select></label><label>{c.comparison}<select value={compare} onChange={event => onSelect({ comparison: event.target.value as EconomicSelection["comparison"] })}><option value="prior_close">{c.prior}</option><option value="prior_month">{c.month}</option></select></label></div>
    {current && <div className={`${s.observation} ${s.curveObservation}`} aria-live="polite"><div><span className={s.caption}>{localText(current.label, lang)} · {c.latest}</span><strong>{number(current.today)}{current.today !== null && <small> %</small>}</strong></div><div className={s.observationDate}>{current.as_of_tenor ?? c.missing}</div>{binding ? <button type="button" className={s.button} data-curve-source={binding.source_id} onClick={event => onEvidence(binding.source_id, event.currentTarget)}>{c.source} →</button> : <span className={s.caption} data-curve-source-unlinked="">{c.noSource}</span>}</div>}
    <div ref={wrapper} className={s.chartContainer}>
      {!curve.ok ? <div className={s.chartEmpty}>{localText(curve.null_panel, lang)}</div> : display === "table" ? <div className={s.tableScroll} tabIndex={0} role="region" aria-label={c.title}><table className={s.table}><thead><tr><th>{c.tenor}</th><th>{c.latest} · %</th><th>{c.date}</th><th>{compare === "prior_close" ? c.prior : c.month} · %</th><th>{c.date}</th></tr></thead><tbody>{rows.map(row => <tr key={row.tenor} data-selected={row.tenor === selected || undefined}><th scope="row"><button type="button" onClick={() => setSelected(row.tenor)}>{localText(row.label, lang)}</button></th><td>{number(row.today)}</td><td>{row.as_of_tenor ?? c.missing}</td><td>{number(row[compare])}</td><td>{(compare === "prior_close" ? row.prior_close_as_of : row.prior_month_as_of) ?? c.missing}</td></tr>)}</tbody></table></div> : <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={`${c.title}. ${localText(curve.as_of_caption, lang)}. ${c.note}`}>
        {ticks.values.map(tick => <g key={tick}><line x1={left} x2={right} y1={y(tick)} y2={y(tick)} className={s.gridLine}/><text x={left - 10} y={y(tick) + 4} textAnchor="end" className={s.axisText}>{fmtTick(tick, ticks.step)}</text></g>)}
        {thinLabels(rows, x, 44).map(row => <text key={row.tenor} x={x(row)} y={bottom + 30} textAnchor="middle" className={s.axisText}>{row.tenor}</text>)}
        {paths(compare).map((path, i) => <path d={path} key={`prior-${i}`} className={s.comparisonLine}/>)}{paths("today").map((path, i) => <path d={path} key={`today-${i}`} className={s.primaryLine}/>)}
        {rows.map(row => row.today !== null && <g key={row.tenor}><circle cx={x(row)} cy={y(row.today)} r={row.tenor === selected ? 5 : 3} className={s.selectedPoint}/><circle cx={x(row)} cy={y(row.today)} r={18} fill="transparent" onPointerDown={() => setSelected(row.tenor)}/></g>)}
      </svg>}
    </div>
    {curve.ok && <div className={s.curveLegend}><span>● {c.latest}</span>{rows.some(row => row[compare] !== null) ? <span>┄ {compare === "prior_close" ? c.prior : c.month}</span> : <span>{c.noComparison}</span>}</div>}<div className={s.historyFooter}><div><p>{localText(curve.as_of_caption, lang)}</p><p className={s.caption}>{c.note}</p></div></div>
  </section>;
}

