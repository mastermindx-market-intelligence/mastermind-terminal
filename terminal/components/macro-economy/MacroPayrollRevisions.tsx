"use client";

import { useId, useRef } from "react";
import { fmtTick, niceTicks, padDomain, thinLabels, useChartWidth } from "@/components/charts/svgChart";
import { localText } from "@/lib/shared-shell/readingPayloads";
import type { EconomicPayrollRevisions, EconomicPayrollRow, EconomicSelection } from "@/lib/shared-shell/macroEconomyPayload";
import { economicNumber } from "./MacroEconomicHistory";
import s from "./MacroEconomy.module.css";

const COPY = {
  en: { chart: "Chart", table: "Table", earliest: "Earliest retained", selected: "Selected vintage", revision: "Net revision", unit: "thousand jobs", missing: "Not available", period: "Reference month", cutoff: "Vintage cutoff", collection: "Archive collected", window: "Time range", m3: "3 months", y1: "1 year", all: "Published history", measure: "Monthly job gains or losses", note: "The earliest retained reading may be later than the first release.", partial: "Some months lack a comparable reading. Missing revisions remain unavailable.", noValues: "The archive does not contain a comparable monthly jobs reading for this selection.", choose: "Select reference month", evidence: "Show the calculation", firstDate: "Earliest vintage day", selectedDate: "Selected vintage day", limits: "About these revisions", source: "Bureau of Labor Statistics · ALFRED vintage archive", noMonth: "No published reading for this month" },
  zh: { chart: "图表", table: "表格", earliest: "最早保留读数", selected: "所选版本", revision: "净修订", unit: "千个就业岗位", missing: "不可用", period: "参考月份", cutoff: "版本截止日", collection: "历史库采集时间", window: "时间范围", m3: "三个月", y1: "一年", all: "已发布历史", measure: "月度就业增减", note: "最早保留读数可能晚于首次发布。", partial: "部分月份缺少可比较读数，无法计算的修订保留为空。", noValues: "历史库未包含所选范围可比较的月度就业读数。", choose: "选择参考月份", evidence: "查看计算", firstDate: "最早版本日期", selectedDate: "所选版本日期", limits: "关于这些修订", source: "美国劳工统计局·ALFRED历史版本库", noMonth: "此月份没有已发布读数" },
} as const;

export function payrollWindow(rows: EconomicPayrollRow[], window: EconomicSelection["window"]) {
  if (!rows.length || window === "published") return rows;
  const cutoff = new Date(rows.at(-1)!.period + "T00:00:00Z");
  cutoff.setUTCMonth(cutoff.getUTCMonth() - (window === "3m" ? 2 : 11));
  return rows.filter(row => row.period >= cutoff.toISOString().slice(0, 10));
}

export default function MacroPayrollRevisions({ data, selection, onSelect, onEvidence, lang }: {
  data: EconomicPayrollRevisions; selection: EconomicSelection;
  onSelect: (change: Partial<EconomicSelection>) => void; onEvidence: (id: string) => void; lang: "en" | "zh";
}) {
  const c = COPY[lang], id = useId(), container = useRef<HTMLDivElement>(null), width = useChartWidth(container, 700);
  const rows = payrollWindow(data.rows, selection.window);
  const selected = rows.find(row => row.period === selection.observation) ?? (selection.observation ? null : [...rows].reverse().find(row => row.selected_change !== null) ?? rows.at(-1));
  const values = rows.flatMap(row => [row.earliest_change, row.selected_change].filter((value): value is number => value !== null));
  // Bars encode distance from zero; the shared line-chart helper does not
  // extend a one-sided domain to zero on our behalf.
  const [low, high] = values.length ? padDomain(Math.min(0, ...values), Math.max(0, ...values)) : [0, 1];
  const ticks = niceTicks(low, high, 4), left = 58, right = width - 18, top = 20, bottom = 270, height = 314;
  const firstTime = rows.length ? Date.parse(rows[0].period) : 0, lastTime = rows.length ? Date.parse(rows.at(-1)!.period) : 0;
  const spacing = (right - left) / Math.max(2, rows.length), bar = Math.min(16, spacing / 3);
  const x = (row: EconomicPayrollRow) => firstTime === lastTime ? (left + right) / 2 : left + spacing / 2 + (Date.parse(row.period) - firstTime) / (lastTime - firstTime) * (right - left - spacing);
  const y = (value: number) => bottom - (value - low) / (high - low) * (bottom - top);
  const number = (value: number | null) => economicNumber(value, lang, c.missing);
  const day = (value: string, monthOnly = false) => new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-GB", { year: "numeric", month: "short", ...(monthOnly ? {} : { day: "numeric" }), timeZone: "UTC" }).format(new Date(value + "T00:00:00Z"));
  const choose = (row: EconomicPayrollRow) => onSelect({ observation: row.period });
  return <section className={s.history} aria-labelledby={`${id}-title`} data-payroll-revisions="">
    <div className={s.sectionHeading}><div><h2 id={`${id}-title`}>{localText(data.title, lang)}</h2><p className={s.caption}>{c.measure} · {c.unit}</p></div><div className={s.segment} aria-label={localText(data.title, lang)}>
      <button type="button" aria-pressed={selection.display === "chart"} onClick={() => onSelect({ display: "chart" })}>{c.chart}</button><button type="button" aria-pressed={selection.display === "table"} onClick={() => onSelect({ display: "table" })}>{c.table}</button>
    </div></div>
    <p>{localText(data.description, lang)}</p><p className={s.caption}>{c.note}</p>
    <div className={s.historyControls}><label>{c.window}<select value={selection.window} onChange={event => onSelect({ window: event.target.value as EconomicSelection["window"], observation: null })}><option value="3m">{c.m3}</option><option value="1y">{c.y1}</option><option value="published">{c.all}</option></select></label><span className={s.caption}>{c.cutoff}: <time dateTime={data.cutoff}>{day(data.cutoff)}</time></span></div>
    {data.status === "partial" && <p className={s.caption} data-payroll-partial="">{c.partial}</p>}
    <div className={s.revisionReadout} aria-live="polite"><div className={s.revisionPeriod}>{selected ? <time dateTime={selected.period}>{day(selected.period, true)}</time> : c.noMonth}</div>
      {(["earliest_change", "selected_change", "net_revision"] as const).map((role, index) => <div key={role}><span className={s.caption}>{[c.earliest, c.selected, c.revision][index]}</span><strong>{selected ? number(selected[role]) : c.missing}</strong></div>)}
    </div>
    <div ref={container} className={s.chartContainer}>
      {selection.display === "table" && rows.length ? <div className={s.tableScroll} role="region" aria-label={localText(data.title, lang)} tabIndex={0}><table className={s.table}>
        <caption>{c.measure} · {c.unit}</caption><thead><tr><th>{c.period}</th><th>{c.earliest}</th><th>{c.selected}</th><th>{c.revision}</th></tr></thead><tbody>{rows.map(row => <tr key={row.period} data-selected={selected?.period === row.period || undefined}>
          <th scope="row"><button type="button" onClick={() => choose(row)} aria-current={selected?.period === row.period ? "true" : undefined}>{day(row.period, true)}</button></th>
          <td>{number(row.earliest_change)}<small className={s.vintageDate}>{day(row.earliest_vintage)}</small></td><td>{number(row.selected_change)}<small className={s.vintageDate}>{day(row.selected_vintage)}</small></td><td>{number(row.net_revision)}</td>
        </tr>)}</tbody></table></div> : !values.length ? <div className={s.chartEmpty} role="status"><p>{localText(data.absence?.label, lang) || c.noValues}</p></div> : <>
        <div className={s.revisionLegend}><span><i className={s.earliestSwatch}/>{c.earliest}</span><span><i className={s.selectedSwatch}/>{c.selected}</span></div>
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${id}-chart-title ${id}-chart-desc`}>
          <title id={`${id}-chart-title`}>{localText(data.title, lang)}</title><desc id={`${id}-chart-desc`}>{c.measure}. {c.unit}. {c.note} {c.partial}</desc>
          {ticks.values.map(tick => <g key={tick}><line x1={left} x2={right} y1={y(tick)} y2={y(tick)} className={s.gridLine}/><text x={left - 12} y={y(tick) + 4} textAnchor="end" className={s.axisText}>{fmtTick(tick, ticks.step)}</text></g>)}
          <line data-payroll-zero="" x1={left} x2={right} y1={y(0)} y2={y(0)} className={s.zeroLine}/>
          {rows.map(row => <g key={row.period} data-reference-period={row.period}>
            {selected?.period === row.period && <rect x={x(row) - spacing / 2} y={top} width={spacing} height={bottom - top} className={s.revisionSelection}/>}
            {(["earliest_change", "selected_change"] as const).map((role, index) => row[role] !== null && <rect key={role} data-vintage-role={role} data-value={row[role]} x={x(row) + (index ? 2 : -bar - 2)} y={Math.min(y(0), y(row[role]!))} width={bar} height={Math.max(1, Math.abs(y(row[role]!) - y(0)))} className={index ? s.revisedBar : s.earliestBar}/>)}
          </g>)}
          {thinLabels(rows, x, 92).map(row => <text key={row.period} x={x(row)} y={bottom + 28} textAnchor="middle" className={s.axisText}>{day(row.period, true)}</text>)}
          <rect x={left} y={top} width={right - left} height={bottom - top} fill="transparent" onPointerDown={event => {
            const bounds = event.currentTarget.ownerSVGElement?.getBoundingClientRect(); if (!bounds?.width) return;
            const position = (event.clientX - bounds.left) * width / bounds.width;
            const row = rows.reduce((best, row) => Math.abs(x(row) - position) < Math.abs(x(best) - position) ? row : best, rows[0]);
            if (row) choose(row);
          }}/>
        </svg>
        <label className={s.scrubber}>{c.choose}<input type="range" min={0} max={Math.max(0, rows.length - 1)} value={Math.max(0, rows.findIndex(row => row.period === selected?.period))} aria-valuetext={selected ? `${day(selected.period, true)}: ${c.revision} ${number(selected.net_revision)} ${c.unit}` : c.noMonth} onChange={event => choose(rows[Number(event.target.value)])}/></label>
      </>}
    </div>
    {selected && <div className={s.historyFooter}><p className={s.caption}>{c.firstDate}: {day(selected.earliest_vintage)}<br/>{c.selectedDate}: {day(selected.selected_vintage)}</p><button type="button" className={s.textButton} onClick={() => onEvidence(`metric:${selected.metric_ids.net_revision}`)}>{c.evidence} ↗</button></div>}
    <p className={s.caption}>{c.source}{data.collected_at && <> · {c.collection}: {day(data.collected_at.slice(0, 10))}</>}</p>
    <details className={s.receipt}><summary>{c.limits}</summary><p>{localText(data.limitation, lang)}</p></details>
  </section>;
}
