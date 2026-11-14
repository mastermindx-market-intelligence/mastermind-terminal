"use client";

import { useEffect, useRef } from "react";
import { localText, type Pair } from "@/lib/shared-shell/readingPayloads";
import { economicSourceIds, type EconomicWorkspaceRead } from "@/lib/shared-shell/macroEconomyPayload";
import s from "./MacroEconomy.module.css";
import { economicNumber } from "./MacroEconomicHistory";

const COPY = {
  en: { driverCalculation: "Driver calculation", revisionCalculation: "Monthly payroll revision calculation", monthlyJobUnit: "Monthly job gains or losses · thousand jobs", reading: "Reading", valueLabel: "Value", vintageDay: "Vintage day", earliestRetained: "Earliest retained", selectedVintage: "Selected vintage", netRevision: "Net revision (selected minus earliest)", contributesTo: "Contributes to", standardizedReading: "Standardized reading", weightLabel: "Weight", componentContribution: "Component contribution", publishedInfluence: "Published influence", compositionLabel: "Composition", missingCalculation: "This publication does not supply the full component calculation.", corrections: "Corrections & revisions", title: "Sources & calculation", close: "Close sources", source: "Source", unit: "Unit", basis: "Basis", period: "Reference period", method: "Calculation", version: "Definition version", sourceStatus: "Source status", rights: "Use rights", unavailable: "Not supplied", noMatch: "This publication does not include a source disclosure matching the selected reference.", all: "Browse all sources", receipt: "Publication receipt", digest: "Canonical content digest", digestNote: "Identifies the verified economic content, rather than the raw file bytes.", manifest: "Manifest digest", generation: "Publication", artifact: "Source artifact", revision: "Revision basis" },
  zh: { driverCalculation: "驱动因素计算", revisionCalculation: "月度就业修订计算", monthlyJobUnit: "月度就业增减·千个就业岗位", reading: "读数", valueLabel: "数值", vintageDay: "版本日期", earliestRetained: "最早保留读数", selectedVintage: "所选版本", netRevision: "净修订（所选减最早）", contributesTo: "所属指标", standardizedReading: "标准化读数", weightLabel: "权重", componentContribution: "分项贡献", publishedInfluence: "已发布影响", compositionLabel: "组成方式", missingCalculation: "本次发布未提供此分项的完整计算明细。", corrections: "更正与修订记录", title: "来源与计算", close: "关闭来源", source: "来源", unit: "单位", basis: "口径", period: "参考期", method: "计算方法", version: "定义版本", sourceStatus: "来源状态", rights: "使用权限", unavailable: "未提供", noMatch: "本次发布未包含与所选引用对应的来源说明。", all: "浏览所有来源", receipt: "发布凭证", digest: "规范内容摘要", digestNote: "标识已核验的经济内容，而非原始文件字节。", manifest: "清单摘要", generation: "发布代次", artifact: "来源文件", revision: "修订口径" },
} as const;
export default function MacroEconomicEvidence({ read, selection, lang, onClose, onSelect }: {
  read: EconomicWorkspaceRead; selection: string; lang: "en" | "zh"; onClose: () => void; onSelect: (source: string) => void;
}) {
  const panel = useRef<HTMLElement>(null), c = COPY[lang];
  useEffect(() => { panel.current?.focus(); panel.current?.scrollIntoView?.({ block: "start", behavior: "instant" }); }, [selection]);
  if (read.selected_workspace.state !== "ready") return null;
  const v = read.selected_workspace.view, all = selection === "all";
  const metric = selection.startsWith("metric:") ? v.metrics.find(row => row.metric_id === selection.slice(7)) : null;
  const driver = selection.startsWith("driver:") ? v.drivers.flatMap(group => group.rows).find(row => row.driver_id === selection.slice(7)) : null;
  const payroll = metric ? v.payroll_revisions?.rows.find(row => Object.values(row.metric_ids).includes(metric.metric_id)) : null;
  const sourceIds = driver ? driver.source_binding?.source_refs ?? [] : economicSourceIds(metric?.source_refs ?? [selection], v.evidence.sources);
  const sources = v.evidence.sources.filter(row => all || sourceIds.includes(row.source_id));
  const series = v.series.entries.find(row => row.source_ref === selection);
  const text = (value: Pair | null | undefined) => localText(value, lang) || c.unavailable;
  return <section ref={panel} tabIndex={-1} className={s.sourcePanel} aria-labelledby="economic-evidence-title" data-economic-evidence="">
    <div className={s.sectionHeading}><h2 id="economic-evidence-title">{driver ? (c.driverCalculation) : c.title}</h2><button type="button" className={s.button} onClick={onClose}>{c.close} ×</button></div>
    {metric && <section className={s.sectionHeading}><div><h3>{text(metric.label)}</h3><p>{text(metric.value)} {localText(metric.unit, lang)}</p><dl className={s.sourceDetails}>
      <div><dt>{c.period}</dt><dd>{metric.reference_period ?? c.unavailable}</dd></div><div><dt>{c.basis}</dt><dd>{text(metric.basis)}</dd></div><div><dt>{c.method}</dt><dd>{localText(metric.transformation_label, lang) || metric.transformation || c.unavailable}</dd></div><div><dt>{c.version}</dt><dd>{metric.definition_version ?? c.unavailable}</dd></div>
    </dl></div></section>}
    {payroll && <div className={s.tableScroll} tabIndex={0} role="region" aria-label={c.revisionCalculation}><table className={s.table}><caption>{c.monthlyJobUnit}</caption><thead><tr><th>{c.reading}</th><th>{c.valueLabel}</th><th>{c.vintageDay}</th></tr></thead><tbody>
      <tr><th scope="row">{c.earliestRetained}</th><td>{economicNumber(payroll.earliest_change, lang, c.unavailable)}</td><td>{payroll.earliest_vintage}</td></tr>
      <tr><th scope="row">{c.selectedVintage}</th><td>{economicNumber(payroll.selected_change, lang, c.unavailable)}</td><td>{payroll.selected_vintage}</td></tr>
      <tr><th scope="row">{c.netRevision}</th><td>{economicNumber(payroll.net_revision, lang, c.unavailable)}</td><td>—</td></tr>
    </tbody></table></div>}
    {series && <p className={s.limit}>{text(series.basis)}<br/>{series.revision_behavior ?? c.unavailable}</p>}
    {driver && <section><h3>{text(driver.label)}</h3><p>{text(driver.value)} {localText(driver.unit, lang)}</p>{driver.calculation ? <><dl className={s.sourceDetails}>
      <div><dt>{c.contributesTo}</dt><dd>{text(driver.calculation.axis_label)}</dd></div>
      <div><dt>{c.standardizedReading}</dt><dd>{driver.calculation.standardized ?? c.unavailable}</dd></div>
      <div><dt>{c.weightLabel}</dt><dd>{driver.calculation.weight ?? c.unavailable}</dd></div>
      <div><dt>{c.componentContribution}</dt><dd>{driver.calculation.contribution ?? c.unavailable}</dd></div>
      <div><dt>{c.publishedInfluence}</dt><dd>{driver.impact_present ? driver.impact : c.unavailable}</dd></div>
      <div><dt>{c.sourceStatus}</dt><dd>{text(driver.calculation.freshness)}</dd></div>
      <div><dt>{c.method}</dt><dd>{text(driver.calculation.transformation)}</dd></div>
      <div><dt>{c.compositionLabel}</dt><dd>{text(driver.calculation.weights_law)}</dd></div>
    </dl></> : <p className={s.caption}>{c.missingCalculation}</p>}</section>}
    {!sources.length && <p className={s.limit} data-source-unlinked="">{c.noMatch}</p>}
    <div className={s.sourceList}>{sources.map(source => <section key={source.source_id}>
      <h3>{text(source.label)}</h3><dl className={s.sourceDetails}>
        <div><dt>{c.source}</dt><dd>{source.provider ?? c.unavailable}{(source.owner_ref?.startsWith("https://fred.stlouisfed.org/series/") || source.owner_ref === "https://alfred.stlouisfed.org/series?seid=PAYEMS") && <p><a href={source.owner_ref} target="_blank" rel="noopener noreferrer">{source.owner_ref.includes("alfred.") ? "ALFRED" : "FRED"} ↗</a></p>}</dd></div><div><dt>{c.sourceStatus}</dt><dd>{text(source.freshness)}</dd></div><div><dt>{c.rights}</dt><dd>{text(source.rights)}</dd></div>
        {source.clocks.map((clock, index) => <div key={index}><dt>{text(clock.name)}</dt><dd>{clock.value ?? c.unavailable}<small>{text(clock.meaning)}</small></dd></div>)}
        {source.transform && <div><dt>{c.method}</dt><dd>{localText(source.transform_label, lang) || source.transform}</dd></div>}
      </dl>
    </section>)}</div>
    {!all && <button type="button" className={s.textButton} onClick={() => onSelect("all")}>{c.all} →</button>}
    <details className={s.receipt}><summary>{c.corrections}</summary><p>{text(v.evidence.corrections.state)}</p>{v.evidence.corrections.note && <p>{text(v.evidence.corrections.note)}</p>}{v.evidence.corrections.changed_sources && <p>{text(v.evidence.corrections.changed_sources)}</p>}{v.evidence.corrections.predecessor && <p>{text(v.evidence.corrections.predecessor_label)} <code>{v.evidence.corrections.predecessor}</code></p>}</details>
    <details className={s.receipt}><summary>{c.receipt}</summary><dl className={s.sourceDetails}>
      <div><dt>{c.generation}</dt><dd><code>{read.selected_workspace.generation_id}</code></dd></div>
      <div><dt>{c.digest}</dt><dd><code>{read.selected_workspace.artifact.sha256}</code><small>{c.digestNote}</small></dd></div>
      <div><dt>{c.manifest}</dt><dd><code>{read.source.manifest_sha256}</code></dd></div>
      <div><dt>{c.artifact}</dt><dd><code>{read.selected_workspace.artifact.path}</code></dd></div>
    </dl><p>{text(v.evidence.authority.statement)}</p></details>
  </section>;
}
