"use client";

import { useMemo, useRef, useState } from "react";
import { fmtTick, niceTicks, padDomain, thinLabels, useChartWidth } from "../charts/svgChart";
import { compareFactorHistories, formatFactorPercent, formatFactorPoints, prepareFactorHistory, splitFactorSegments,
  type FactorComparison, type HistoryWindowRequest } from "../../lib/factorAtlasHistory";
import styles from "./FactorHistoryPreview.module.css";

type Lang = "en" | "zh";
type Copy = readonly [string, string];
const LEX = {
  brand: ["Factor Atlas", "Factor Atlas"],
  eyebrow: ["RESEARCH WORKSPACE", "研究工作区"],
  preview: ["Synthetic preview — not live market data", "合成数据预览 — 非实时市场数据"],
  description: ["Compare the same source history without changing the basket underneath it.", "比较同一份源历史，不因显示区间而改变篮子持仓。"],
  withheld: ["Source admission required", "需要完成数据源准入"],
  withheldDetail: ["Customer data remains withheld. This component does not authorize a source or publication.", "客户数据仍不展示。此组件不授予数据源或发布权限。"],
  select: ["Compare factors", "比较因子"], anchor: ["Comparison anchor", "参考日期"], end: ["Window end", "区间结束"],
  none: ["Select at least one factor", "请至少选择一个因子"],
  synthetic: ["Synthetic fixture required", "仅支持合成测试数据"], invalid: ["Unsupported native candidate", "不支持的原生候选数据"],
  return: ["Return over selected window", "所选区间收益"], ready: ["Complete window", "区间完整"],
  partial: ["Valuation gap", "估值数据缺口"], unavailable: ["Exact reference or end date is unavailable", "缺少所选参考日期或结束日期的数据"],
  chart: ["Source history, rebased at the selected anchor", "源历史，以所选参考日期重新标定"],
  noChart: ["No comparable history at these exact dates", "这些确切日期没有可比较的历史"],
  incompatible: ["History modes or price bases differ; no combined comparison is shown.", "历史模式或价格口径不同，不展示合并比较。"],
  axis: ["Cumulative return from reference", "相对参考日期的累计收益"],
  rule: ["Dates change the reference, not the holdings. Missing valuations are never filled.", "日期只改变参考点，不改变持仓。缺失估值不会被补齐。"],
  observations: ["Observations & provenance", "观测值与来源"],
  date: ["Date", "日期"], interval: ["Source interval return", "源区间收益"], rebased: ["Rebased return", "重新标定收益"], state: ["State", "状态"],
  observed: ["Observed", "已有观测"], gap: ["Unavailable", "不可用"],
  construction: ["Source construction", "源构建方法"], inception: ["Construction inception", "构建起始日期"],
  digest: ["Source digest reference — not authenticated", "源摘要引用 — 尚未认证"],
  current: ["Current roster", "当前成员"], pit: ["PIT roster candidate", "时点成员候选"],
  basis: ["USD · total return · gross before costs", "美元 · 总收益 · 未扣成本"],
  difference: ["Return difference (percentage points)", "收益差值（百分点）"],
  noPnl: ["A comparison, not a funded long/short strategy.", "仅为比较，不代表有资金支持的多空策略。"],
  selectionInvalid: ["Choose up to eight distinct factors", "请选择最多八个不同因子"],
} satisfies Record<string, Copy>;
function pick(key: keyof typeof LEX, lang: Lang): string { return LEX[key][lang === "zh" ? 1 : 0]; }

export interface FactorPreviewItem { basketId: string; label: Copy; payload: unknown }
export interface FactorHistoryPreviewProps {
  items: readonly FactorPreviewItem[];
  initialWindow: HistoryWindowRequest;
  audience: "synthetic-preview" | "customer";
  /** Passed by the incumbent locale owner; this component owns no language store. */
  lang?: Lang;
}

function HistoryPlot({ comparison, labels, window, lang }: {
  comparison: FactorComparison; labels: Map<string, string>; window: HistoryWindowRequest; lang: Lang;
}) {
  const ref = useRef<HTMLDivElement>(null), width = useChartWidth(ref), height = 276;
  const values = comparison.series.flatMap(s => s.window.points.map(p => p.rebasedPercent))
    .filter((v): v is number => v !== null && Number.isFinite(v));
  const available = values.length > 0 && comparison.status !== "INCOMPATIBLE";
  const [lo, hi] = padDomain(values.length ? Math.min(...values) : 0, values.length ? Math.max(...values) : 1);
  const ticks = niceTicks(lo, hi, 4), left = 54, right = 22, top = 20, bottom = 42;
  const start = Date.parse(window.anchorDate), end = Date.parse(window.endDate);
  const x = (date: string) => left + (Date.parse(date) - start) / (end - start) * (width - left - right);
  const y = (value: number) => top + (hi - value) / (hi - lo) * (height - top - bottom);
  const dates = Array.from(new Set(comparison.series.flatMap(s => s.window.points.map(p => p.date)))).sort();
  const tickDates = available ? thinLabels(dates, x, 96) : [];
  return <div ref={ref} className={styles.chartHost}>
    {available ? <svg className={styles.chart} width={width} height={height} viewBox={`0 0 ${width} ${height}`}
      role="img" aria-label={pick("chart", lang)}>
      <title>{pick("chart", lang)}</title>
      {ticks.values.map(value => <g key={value}>
        <line className={styles.grid} x1={left} x2={width - right} y1={y(value)} y2={y(value)} />
        <text className={styles.axis} x={left - 10} y={y(value) + 4} textAnchor="end">
          {ticks.step >= 0.01 ? fmtTick(value, ticks.step) : value.toPrecision(3)}%
        </text>
      </g>)}
      {comparison.series.flatMap((series, i) => splitFactorSegments(series.window.points).map((segment, j) =>
        segment.length === 1
          ? <circle key={`${series.history.basketId}:${j}`} className={styles.dataPoint} data-series={series.history.basketId}
            cx={x(segment[0].date)} cy={y(segment[0].rebasedPercent!)} r={3} />
          : <path key={`${series.history.basketId}:${j}`} className={styles.series} data-series={series.history.basketId}
            data-segment={j} strokeDasharray={i === 0 ? undefined : `${3 + i * 2} 4`}
            d={segment.map((p, n) => `${n ? "L" : "M"}${x(p.date).toFixed(2)},${y(p.rebasedPercent!).toFixed(2)}`).join(" ")} />))}
      {tickDates.map((date, i) => <text key={date} className={styles.axis} x={x(date)} y={height - 15}
        textAnchor={i === 0 ? "start" : i === tickDates.length - 1 ? "end" : "middle"}>{date.slice(5)}</text>)}
    </svg> : <div className={styles.empty} role="status">{pick(comparison.status === "INCOMPATIBLE" ? "incompatible" : "noChart", lang)}</div>}
    {available && <div className={styles.legend}>{comparison.series.map((s, i) => <span key={s.history.basketId}>
      <i className={styles.swatch} style={{ borderTopStyle: i ? "dashed" : "solid" }} />{labels.get(s.history.basketId)}
    </span>)}</div>}
  </div>;
}

export function FactorHistoryPreview({ items, initialWindow, audience, lang = "en" }: FactorHistoryPreviewProps) {
  const [selected, setSelected] = useState(() => items.slice(0, 8).map(i => i.basketId));
  const [window, setWindow] = useState(initialWindow);
  const reads = useMemo(() => items.filter(i => selected.includes(i.basketId)).map(item => ({ item,
    read: prepareFactorHistory(item.payload, { basketId: item.basketId, audience }) })), [items, selected, audience]);
  const histories = reads.flatMap(r => r.read.history ? [r.read.history] : []);
  const comparison = compareFactorHistories(histories, window);
  const labels = new Map(items.map(item => [item.basketId, item.label[lang === "zh" ? 1 : 0]]));
  const selectionInvalid = items.length > 8 || new Set(items.map(i => i.basketId)).size !== items.length;
  if (audience !== "synthetic-preview") return <section className={styles.shell} aria-label={pick("brand", lang)}>
    <h2>{pick("brand", lang)}</h2><p role="status">{pick("withheld", lang)}</p><p>{pick("withheldDetail", lang)}</p>
  </section>;
  return <section className={styles.shell} aria-label={pick("brand", lang)}>
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>{pick("eyebrow", lang)}</p><h2>{pick("brand", lang)}</h2>
        <p className={styles.description}>{pick("description", lang)}</p></div>
      <span className={styles.preview}>{pick("preview", lang)}</span>
    </header>
    <div className={styles.controls}>
      <fieldset className={styles.selection}><legend>{pick("select", lang)}</legend>
        {items.slice(0, 8).map((item, i) => <label className={styles.chip} key={`${item.basketId}:${i}`}>
          <input type="checkbox" checked={selected.includes(item.basketId)} onChange={event => setSelected(current =>
            event.target.checked ? [...current, item.basketId] : current.filter(id => id !== item.basketId))} />
          {labels.get(item.basketId)}
        </label>)}
      </fieldset>
      <div className={styles.dates}>
        <label>{pick("anchor", lang)}<input type="date" aria-label={pick("anchor", lang)} value={window.anchorDate}
          onChange={event => setWindow(current => ({ ...current, anchorDate: event.target.value }))} /></label>
        <label>{pick("end", lang)}<input type="date" aria-label={pick("end", lang)} value={window.endDate}
          onChange={event => setWindow(current => ({ ...current, endDate: event.target.value }))} /></label>
      </div>
    </div>
    {selectionInvalid ? <p role="status">{pick("selectionInvalid", lang)}</p> : <>
      {!selected.length && <p role="status">{pick("none", lang)}</p>}
      {reads.filter(r => !r.read.history).map(({ item, read }) => <p role="status" className={styles.notice} key={item.basketId}>
        {labels.get(item.basketId)} — {pick(read.kind === "withheld" ? "synthetic" : "invalid", lang)}
      </p>)}
      <div className={styles.cards}>{comparison.series.map(({ history, window: range }) => <article className={styles.card} key={history.basketId}>
        <h3>{labels.get(history.basketId)}</h3><p className={styles.caption}>{pick("return", lang)}</p>
        <strong className={styles.metric} data-metric="window-return">{formatFactorPercent(range.returnFraction, lang)}</strong>
        <p className={styles.status}>{pick(range.status === "READY" ? "ready" : range.status === "PARTIAL" ? "partial" : "unavailable", lang)}</p>
        <p className={styles.caption}>{pick(history.historyMode === "CURRENT_ROSTER" ? "current" : "pit", lang)} · {pick("basis", lang)}</p>
      </article>)}</div>
      <section className={styles.chartSection} aria-label={pick("chart", lang)}>
        <div className={styles.chartHeader}><h3>{pick("axis", lang)}</h3><span>{window.anchorDate} → {window.endDate}</span></div>
        <HistoryPlot comparison={comparison} labels={labels} window={window} lang={lang} />
      </section>
      <p className={styles.rule}>{pick("rule", lang)}</p>
      {comparison.spreadFraction !== null && <p className={styles.difference}>{pick("difference", lang)}: <strong>
        {formatFactorPoints(comparison.spreadFraction, lang)}
      </strong><span>{pick("noPnl", lang)}</span></p>}
      {!!histories.length && <details className={styles.details}><summary>{pick("observations", lang)}</summary>
        {comparison.series.map(({ history, window: range }) => <section className={styles.observations} key={history.basketId}>
          <h3>{labels.get(history.basketId)}</h3>
          <dl className={styles.provenance}><dt>{pick("construction", lang)}</dt><dd>{history.constructionRef}</dd>
            <dt>{pick("inception", lang)}</dt><dd>{history.seriesInception}</dd>
            <dt>{pick("digest", lang)}</dt><dd><code>{history.sourceDigest}</code></dd></dl>
          <div className={styles.tableWrap}><table><thead><tr>
            <th scope="col">{pick("date", lang)}</th><th scope="col">{pick("interval", lang)}</th>
            <th scope="col">{pick("rebased", lang)}</th><th scope="col">{pick("state", lang)}</th>
          </tr></thead><tbody>{range.points.map((point, i) => <tr key={point.date} data-observation={point.date}>
            <th scope="row">{point.date}</th><td>{i === 0 ? "—" : formatFactorPercent(point.returnFraction, lang)}</td>
            <td>{formatFactorPercent(point.rebasedPercent === null ? null : point.rebasedPercent / 100, lang)}</td>
            <td>{pick(point.level === null ? "gap" : "observed", lang)}</td>
          </tr>)}</tbody></table></div>
        </section>)}
      </details>}
    </>}
  </section>;
}
