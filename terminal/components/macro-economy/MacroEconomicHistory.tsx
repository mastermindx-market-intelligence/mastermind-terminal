"use client";

import { useId, useRef } from "react";
import { fmtTick, niceTicks, padDomain, thinLabels, useChartWidth } from "@/components/charts/svgChart";
import { localText } from "@/lib/shared-shell/readingPayloads";
import { economicSourceIds, type EconomicPoint, type EconomicSelection, type EconomicSeries, type EconomicSource } from "@/lib/shared-shell/macroEconomyPayload";
import s from "./MacroEconomy.module.css";

const COPY = {
  en: { title: "Explore the history", series: "Measure", window: "Time range", m3: "3 months", y1: "1 year", published: "Published history", chart: "Chart", table: "Table", date: "Reference date", value: "Value", missing: "No observation", unavailable: "History is not available for this measure.", metadata: "This publication contains a history summary, but no chart observations.", observation: "Selected observation", sources: "Source & calculation", gap: "Gaps remain gaps. The chart does not replace missing observations.", windowEmpty: "No observations fall in this window.", reference: "Each date identifies the observation period.", actual: "Actual published range", count: "observations", tableLabel: "Historical observations", revise: "History basis", selected: "Select observation" },
  zh: { title: "探索历史", series: "指标", window: "时间范围", m3: "三个月", y1: "一年", published: "已发布历史", chart: "图表", table: "表格", date: "参考日期", value: "数值", missing: "无观察值", unavailable: "此指标暂无历史数据。", metadata: "本次发布包含历史摘要，但未提供图表观察值。", observation: "所选观察值", sources: "来源与计算", gap: "缺失数据保留为空，不会填补或替代。", windowEmpty: "此时间范围内没有观察值。", reference: "日期表示观察值的参考期。", actual: "实际发布范围", count: "个观察值", tableLabel: "历史观察值", revise: "历史口径", selected: "选择观察值" },
} as const;
export function historyWindow(points: EconomicPoint[], range: EconomicSelection["window"]): EconomicPoint[] {
  if (!points.length || range === "published") return points;
  const last = new Date(points[points.length - 1].t + "T00:00:00Z");
  const cutoff = new Date(last);
  cutoff.setUTCDate(cutoff.getUTCDate() - (range === "3m" ? 92 : 366));
  return points.filter(point => point.t >= cutoff.toISOString().slice(0, 10));
}
/** Nulls terminate a segment. They are not filtered into a connected line. */
export function historySegments(points: EconomicPoint[], x: (point: EconomicPoint) => number, y: (value: number) => number): string[] {
  const segments: string[] = [];
  let segment = "";
  for (const point of points) {
    if (point.v === null) { if (segment) segments.push(segment); segment = ""; continue; }
    segment += `${segment ? " L" : "M"}${x(point)},${y(point.v)}`;
  }
  if (segment) segments.push(segment);
  return segments;
}
export const economicNumber = (value: number | null, lang: "en" | "zh", missing: string) => value === null ? missing : new Intl.NumberFormat(lang === "zh" ? "zh-CN" : "en-US", { maximumFractionDigits: 6 }).format(value);

export default function MacroEconomicHistory({ entries, sources, selection, onSelect, lang, onEvidence, heading, description }: {
  sources: EconomicSource[];
  entries: EconomicSeries[]; selection: EconomicSelection; onSelect: (change: Partial<EconomicSelection>) => void;
  lang: "en" | "zh"; onEvidence: (sourceId: string) => void; heading?: string; description?: string;
}) {
  const c = COPY[lang], container = useRef<HTMLDivElement>(null), width = useChartWidth(container, 700), id = useId();
  const chosen = entries.find(entry => entry.series_id === selection.series) ?? (selection.series ? null : entries.find(entry => entry.points?.some(point => point.v !== null)) ?? entries[0]);
  const points = historyWindow(chosen?.points ?? [], selection.window);
  const sourceIds = economicSourceIds(chosen?.source_ref ? [chosen.source_ref] : [], sources);
  const source = sources.find(source => sourceIds.includes(source.source_id));
  const selected = points.find(point => point.t === selection.observation) ?? (selection.observation ? null : [...points].reverse().find(point => point.v !== null) ?? points.at(-1));
  const selectedIndex = selected ? points.indexOf(selected) : -1;
  const values = points.flatMap(point => point.v === null ? [] : [point.v]);
  const [low, high] = values.length ? padDomain(Math.min(...values), Math.max(...values), { includeZero: true }) : [0, 1];
  const ticks = niceTicks(low, high, 4);
  const left = 64, right = width - 18, top = 24, bottom = 276, height = 322;
  const firstTime = points.length ? Date.parse(points[0].t + "T00:00:00Z") : 0;
  const lastTime = points.length ? Date.parse(points.at(-1)!.t + "T00:00:00Z") : 1;
  const x = (point: EconomicPoint) => lastTime === firstTime ? (left + right) / 2 : left + (Date.parse(point.t + "T00:00:00Z") - firstTime) / (lastTime - firstTime) * (right - left);
  const y = (value: number) => bottom - (value - low) / (high - low) * (bottom - top);
  const segments = historySegments(points, x, y);
  const labels = thinLabels(points, x, 100);
  const number = (value: number | null) => economicNumber(value, lang, c.missing);
  const selectDate = (index: number) => { const point = points[index]; if (point && chosen) onSelect({ series: chosen.series_id, observation: point.t }); };
  return <section className={s.history} aria-labelledby={`${id}-title`}>
    <div className={s.sectionHeading}><div><h2 id={`${id}-title`}>{heading ?? c.title}</h2>{description && <p className={s.caption}>{description}</p>}</div><div className={s.segment} aria-label={heading ?? c.title}>
      <button type="button" aria-pressed={selection.display === "chart"} onClick={() => onSelect({ display: "chart" })}>{c.chart}</button>
      <button type="button" aria-pressed={selection.display === "table"} onClick={() => onSelect({ display: "table" })}>{c.table}</button>
    </div></div>
    <div className={s.historyControls}>
      <label>{c.series}<select value={chosen?.series_id ?? ""} onChange={event => onSelect({ series: event.target.value, observation: null })}>
        {!chosen && <option value="">{c.unavailable}</option>}{entries.map(entry => <option key={entry.series_id} value={entry.series_id}>{localText(entry.label, lang)}</option>)}
      </select></label>
      <label>{c.window}<select value={selection.window} onChange={event => onSelect({ window: event.target.value as EconomicSelection["window"], observation: null })}>
        <option value="3m">{c.m3}</option><option value="1y">{c.y1}</option><option value="published">{c.published}</option>
      </select></label>
    </div>
    <div className={s.observation} aria-live="polite"><div><span className={s.caption}>{c.observation}</span><strong>{selected ? number(selected.v) : c.missing} <small>{chosen && localText(chosen.unit, lang)}</small></strong></div><div className={s.observationDate}>{selected?.t ?? c.missing}</div></div>
    {chosen && <p className={s.caption} data-history-qualification="">{localText(chosen.freshness, lang)} · {localText(chosen.basis, lang)}</p>}
    <div ref={container} className={s.chartContainer}>
      {!chosen || !points.length || !values.length ? <div className={s.chartEmpty} role="status"><h3>{chosen?.points === null ? c.metadata : c.unavailable}</h3>{chosen && <p>{localText(chosen.freshness, lang)}</p>}</div> : selection.display === "table" ? <div className={s.tableScroll} tabIndex={0} role="region" aria-label={c.tableLabel}>
        <table className={s.table}><caption className={s.srOnly}>{localText(chosen.label, lang)} · {localText(chosen.unit, lang)}</caption><thead><tr><th scope="col">{c.date}</th><th scope="col">{c.value} · {localText(chosen.unit, lang)}</th></tr></thead>
          <tbody>{points.map((point, index) => <tr key={point.t} data-selected={selected?.t === point.t || undefined}><th scope="row"><button type="button" aria-current={selected?.t === point.t ? "true" : undefined} onClick={() => selectDate(index)}>{point.t}</button></th><td>{number(point.v)}</td></tr>)}</tbody></table>
      </div> : <>
        <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-labelledby={`${id}-chart-title ${id}-chart-desc`}>
          <title id={`${id}-chart-title`}>{localText(chosen.label, lang)}</title><desc id={`${id}-chart-desc`}>{localText(chosen.basis, lang)}. {c.actual}: {points[0].t} – {points.at(-1)!.t}. {c.gap}</desc>
          {ticks.values.map(tick => <g key={tick}><line x1={left} x2={right} y1={y(tick)} y2={y(tick)} className={s.gridLine}/><text x={left - 12} y={y(tick) + 4} textAnchor="end" className={s.axisText}>{fmtTick(tick, ticks.step)}</text></g>)}
          {labels.map(point => <text key={point.t} x={x(point)} y={bottom + 30} textAnchor="middle" className={s.axisText}>{point.t.slice(0, 7)}</text>)}
          {segments.map((path, index) => <path key={index} d={path} className={s.primaryLine}/>)}
          {points.map(point => point.v !== null && <circle key={point.t} cx={x(point)} cy={y(point.v)} r={points.length < 8 ? 3 : 1.5} className={s.point}/>)}
          {selected && <g><line x1={x(selected)} x2={x(selected)} y1={top} y2={bottom} className={s.crosshair}/>{selected.v !== null && <circle cx={x(selected)} cy={y(selected.v)} r={5} className={s.selectedPoint}/>}</g>}
          <rect x={left} y={top} width={right - left} height={bottom - top} fill="transparent" onPointerDown={event => {
            const rect = event.currentTarget.ownerSVGElement?.getBoundingClientRect(); if (!rect?.width) return;
            const location = (event.clientX - rect.left) * width / rect.width;
            const index = points.reduce((best, point, next) => Math.abs(x(point) - location) < Math.abs(x(points[best]) - location) ? next : best, 0);
            selectDate(index);
          }}/>
        </svg>
        <label className={s.scrubber}>{c.selected}<input type="range" min={0} max={Math.max(0, points.length - 1)} value={Math.max(0, selectedIndex)} aria-valuetext={selected ? `${selected.t}: ${number(selected.v)} ${localText(chosen.unit, lang)}` : c.missing} onChange={event => selectDate(Number(event.target.value))}/></label>
      </>}
    </div>
    {chosen && <div className={s.historyFooter}><div><p>{localText(chosen.basis, lang)}</p>{source?.provider && <p className={s.caption}>{source.provider}{source.owner_ref?.startsWith("https://fred.stlouisfed.org/series/") && <> · <a href={source.owner_ref} target="_blank" rel="noopener noreferrer">FRED ↗</a></>}</p>}<p className={s.caption}>{chosen.first && chosen.last ? `${c.actual}: ${chosen.first} – ${chosen.last} · ${chosen.count} ${c.count}` : c.unavailable}</p><p className={s.caption}>{c.gap}</p></div>{chosen.source_ref && <button type="button" className={s.textButton} onClick={() => onEvidence(chosen.source_ref!)}>{c.sources} ↗</button>}</div>}
  </section>;
}
