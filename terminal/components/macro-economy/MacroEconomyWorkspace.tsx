"use client";

import { useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import { localText, type Pair } from "@/lib/shared-shell/readingPayloads";
import { ECONOMIC_WORKSPACES, type EconomicSelection, type EconomicWorkspaceId, type EconomicWorkspaceRead } from "@/lib/shared-shell/macroEconomyPayload";
import MacroEconomicHistory from "./MacroEconomicHistory";
import MacroEconomicCurve from "./MacroEconomicCurve";
import MacroEconomicEvidence from "./MacroEconomicEvidence";
import MacroPayrollRevisions from "./MacroPayrollRevisions";
import MacroInflationReadout from "./MacroInflationReadout";
import MacroEconomyNavigation from "./MacroEconomyNavigation";
import s from "./MacroEconomy.module.css";

const COPY = {
  en: { lower: "Lower", higher: "Higher", publishedInfluence: "Published influence", assessmentMethod: "How the assessment is formed", macro: "Macro", today: "Today", economy: "Economy", eyebrow: "United States · Economy", sources: "Sources & calculation", refresh: "Refresh", overview: "Overview", drivers: "Drivers", history: "History", revisions: "Payroll revisions", unavailable: "The published reading could not be verified.", loading: "Loading the published evidence…", missing: "No reading has been published.", access: "Your current access does not include this reading.", unknown: "Unavailable", invalid: "This study selection is not available.", reset: "Return to the workspace overview", assessment: "Current assessment", sourceStatus: "Source status", inputDates: "Observation dates", noState: "Explore the published evidence", noStateBody: "This workspace is explained through its measures and components.", changed: "What changed", prior: "Previous", current: "Current", change: "Change", noPrior: "No comparable previous publication is available.", noComparison: "Not comparable", measures: "Key measures", allMeasures: "All measures", meaning: "What the evidence says", detail: "Explore a workspace", return: "Economic overview", noHistory: "Historical observations have not been published for this workspace.", noDrivers: "No driver decomposition has been published.", assessmentRulesNote: "The assessment follows the publisher’s classification rules. The values below do not reclassify it.", dataTo: "Assessment date", source: "Source", coverage: "Coverage", noAxes: "This workspace has no two-axis model.", backHistory: "Explore all history", value: "Value", input: "Input", limitation: "Reading limitations", withheld: "Available analysis" },
  zh: { lower: "较低", higher: "较高", publishedInfluence: "已发布影响", assessmentMethod: "解读如何形成", macro: "宏观", today: "今日", economy: "经济", eyebrow: "美国·经济", sources: "来源与计算", refresh: "刷新", overview: "总览", drivers: "驱动因素", history: "历史", revisions: "非农就业修订", unavailable: "无法核验已发布读数。", loading: "正在加载已发布证据…", missing: "尚未发布读数。", access: "当前权限不包含此读数。", unknown: "不可用", invalid: "此分析选项不可用。", reset: "返回工作区总览", assessment: "当前解读", sourceStatus: "来源状态", inputDates: "观察日期", noState: "探索已发布证据", noStateBody: "通过各项指标和组成部分理解本工作区。", changed: "发生了什么变化", prior: "上次", current: "本次", change: "变化", noPrior: "暂无可比较的上次发布。", noComparison: "不可比较", measures: "关键指标", allMeasures: "所有指标", meaning: "证据说明了什么", detail: "探索工作区", return: "经济总览", noHistory: "本工作区尚未发布历史观察值。", noDrivers: "尚未发布驱动因素分解。", assessmentRulesNote: "解读遵循发布方的分类规则。下方数值不会重新分类。", dataTo: "解读日期", source: "来源", coverage: "覆盖情况", noAxes: "此工作区没有双轴模型。", backHistory: "探索全部历史", value: "数值", input: "输入", limitation: "读数限制", withheld: "可用分析" },
} as const;
type Phase = "loading" | "ready" | "unavailable" | "access" | "missing";
const CONTEXT_COPY = {
  en: { more: "Context & limitations", unavailable: "Current assessment unavailable", priceLevel: "Price levels", priceNote: "This chart tracks price levels. The rates above describe how quickly prices changed." },
  zh: { more: "背景与局限", unavailable: "当前解读不可用", priceLevel: "价格水平", priceNote: "此图展示价格水平；上方通胀率说明价格变化的速度。" },
} as const;

/** No auth/request/cache/preferences owner: incumbent subject-keyed page owns
 * data lifetime, selection URL and refresh. This component only presents it. */
export default function MacroEconomyWorkspace({ workspaceId, lang, read, selection, onSelect, onRefresh, onNavigate, overviewHref, dashboardHref, workspaceHref, accountNotice }: {
  workspaceId: EconomicWorkspaceId; lang: "en" | "zh"; read: { phase: Phase; data: EconomicWorkspaceRead | null };
  selection: EconomicSelection | null; onSelect: (change: Partial<EconomicSelection>) => void; onRefresh: () => void;
  onNavigate: (href: string) => void; overviewHref: string; dashboardHref: string;
  workspaceHref: (id: EconomicWorkspaceId) => string; accountNotice?: ReactNode;
}) {
  const c = COPY[lang], title = useRef<HTMLHeadingElement>(null), sourcesButton = useRef<HTMLButtonElement>(null), evidenceTrigger = useRef<HTMLElement | null>(null);
  const selected = read.phase === "ready" && !accountNotice ? read.data?.selected_workspace : null;
  const ready = selected?.state === "ready" && selected.workspace_id === workspaceId ? selected : null, v = ready?.view;
  const text = (pair: Pair | null | undefined, fallback: string = c.unknown) => localText(pair, lang) || fallback;
  const ids = Object.keys(ECONOMIC_WORKSPACES) as EconomicWorkspaceId[];
  useEffect(() => { title.current?.focus(); }, [workspaceId]);
  const openEvidence = (id: string) => { evidenceTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : sourcesButton.current; onSelect({ evidence: id }); };
  const closeEvidence = () => { onSelect({ evidence: null }); evidenceTrigger.current?.focus(); };
  const reset = () => onSelect({ task: "overview", series: null, observation: null, evidence: null, window: "1y", display: "chart", tenor: "10y", comparison: "prior_close" });
  const changeStudy = (task: EconomicSelection["task"]) => onSelect({ task, evidence: null, ...(task !== selection?.task && (task === "revisions" || selection?.task === "revisions") ? { series: null, observation: null } : {}) });
  const comparable = !!v && v.changes.comparable && v.changes.prior_is_earlier;
  const context = CONTEXT_COPY[lang];
  // Promote the owner's explicit state reading, never an arbitrary mechanism
  // or internal composition note. All other entries stay available in full.
  const lead = v?.implications.entries.find(entry => entry.implication_id === "state_descriptive" || entry.implication_id === "state_unavailable");
  const furtherContext = v?.implications.entries.filter(entry => entry !== lead) ?? [];
  const implication = (entry: NonNullable<typeof v>["implications"]["entries"][number]) => <li key={entry.implication_id}><p>{text(entry.text)}</p><p className={s.caption}>{text(entry.evidence_label, "")}{entry.evidence_claim && ` · ${text(entry.evidence_claim)}`}</p></li>;
  return <div className={s.root} data-macro-economy-workspace={workspaceId} data-read-state={accountNotice ? "identity" : !selection ? "invalid" : selected?.state === "unavailable" ? "unavailable" : read.phase}>
    <MacroEconomyNavigation active="economy" lang={lang} dashboardHref={dashboardHref} overviewHref={overviewHref}><Link href={overviewHref} className={s.back} prefetch={false}>← {c.return}</Link></MacroEconomyNavigation>
    <div className={s.studyLayout}>
      <nav className={s.studyNav} aria-label={c.detail}>{ids.map(id => <Link key={id} href={workspaceHref(id)} aria-current={id === workspaceId ? "page" : undefined} prefetch={false}>{ECONOMIC_WORKSPACES[id][lang]}</Link>)}</nav>
      <div style={{ minWidth: 0 }}>
        <label className={s.studyMobile}>{c.detail}<select value={workspaceId} onChange={event => onNavigate(workspaceHref(event.target.value as EconomicWorkspaceId))}>{ids.map(id => <option key={id} value={id}>{ECONOMIC_WORKSPACES[id][lang]}</option>)}</select></label>
        <header className={s.workspaceHeader}><div><p className={s.eyebrow}>{c.eyebrow}</p><h1 ref={title} tabIndex={-1}>{ECONOMIC_WORKSPACES[workspaceId][lang]}</h1></div><div className={s.actions}>{v && <button ref={sourcesButton} className={s.button} type="button" onClick={() => openEvidence("all")}>{c.sources}</button>}<button type="button" className={s.button} disabled={read.phase === "loading"} onClick={onRefresh}>{c.refresh}</button></div></header>
        {accountNotice || (!selection ? <section className={s.limit} role="status"><p>{c.invalid}</p><button type="button" className={s.textButton} onClick={reset}>{c.reset} →</button></section> : !v ? <section className={s.limit} role="status" aria-busy={read.phase === "loading"}><p>{read.phase === "ready" ? c.unavailable : c[read.phase]}</p></section> : <>
          <section className={s.assessment} aria-labelledby="economic-assessment">
            <h2 id="economic-assessment">{v.headline.state_id ? text(v.headline.state_label) : v.curve_hero ? text(v.curve_hero.shape_read) : v.axes.length ? context.unavailable : text(v.workspace.subtitle, c.noStateBody)}</h2>
            <div className={s.status}><span>{c.dataTo}: {v.headline.effective_date ?? c.unknown}</span><span>{c.sourceStatus}: {text(v.context.state_label)}</span>{v.context.worst_freshness_token !== v.context.state && <span>{text(v.context.worst_freshness)}</span>}</div>
            {v.context.state !== "CURRENT" && <div className={s.limit}><strong>{text(v.context.state_label)}</strong><p>{v.context.required.filter(row => row.freshness_state !== "CURRENT").map(row => `${text(row.label)}: ${text(row.freshness)}${row.source_asof ? ` · ${row.source_asof}` : ""}`).join("; ")}</p></div>}
          </section>
          <nav className={s.tabs} aria-label={c.withheld}>{(["overview", "drivers", "history", ...(workspaceId === "labor_markets" ? ["revisions" as const] : [])] as const).map(task => <button type="button" key={task} aria-current={selection.task === task ? "page" : undefined} onClick={() => changeStudy(task)}>{c[task]}</button>)}</nav>
          {selection.task === "overview" && <>
            <section className={s.readingContext} aria-labelledby={lead || v.implications.absent ? "economic-meaning" : undefined} data-economic-reading-context="">
              {(lead || v.implications.absent) && <><h2 id="economic-meaning">{c.meaning}</h2>{lead ? <ul className={s.leadImplication}>{implication(lead)}</ul> : <p className={s.muted}>{text(v.implications.absence_text)}</p>}</>}
              {furtherContext.length > 0 && <details className={s.methodDetails}><summary>{context.more}</summary><ul className={s.implications}>{furtherContext.map(implication)}</ul></details>}
            </section>
            {workspaceId === "inflation_system" && <MacroInflationReadout metrics={v.metrics} lang={lang} onEvidence={openEvidence}/>}
            {!!v.axes.length && <dl className={s.axes} data-economic-axes="">{v.axes.map(axis => <div key={axis.axis_id}><dt>{text(axis.label)}</dt><dd>{axis.value_raw === null ? text(axis.absence?.label) : text(axis.value_with_unit, axis.value ?? c.unknown)}</dd>{axis.low_label && axis.high_label && <p className={s.caption}>{c.lower}: {text(axis.low_label)} · {c.higher}: {text(axis.high_label)}</p>}<p className={s.caption}>{text(axis.freshness)}</p></div>)}</dl>}
            {v.curve_hero ? <MacroEconomicCurve curve={v.curve_hero} lang={lang} selection={selection} onSelect={onSelect}/> : v.series.entries.length ? <MacroEconomicHistory entries={v.series.entries} sources={v.evidence.sources} selection={selection} onSelect={onSelect} lang={lang} onEvidence={openEvidence} heading={workspaceId === "inflation_system" ? context.priceLevel : undefined} description={workspaceId === "inflation_system" ? context.priceNote : undefined}/> : <div className={s.limit}>{c.noHistory}</div>}
            <section className={s.section} aria-labelledby="economic-change-title"><div className={s.sectionHeading}><h2 id="economic-change-title">{c.changed}</h2>{comparable && <span className={s.caption}>{v.changes.prior_effective_date} → {v.headline.effective_date}</span>}</div>
              {!comparable ? <p className={s.muted}>{text(v.changes.absence?.label, c.noPrior)}</p> : <div className={s.tableScroll} tabIndex={0} role="region" aria-label={c.changed}><table className={s.table}><thead><tr><th>{c.measures}</th><th>{c.prior}</th><th>{c.current}</th><th>{c.change}</th></tr></thead><tbody>{v.changes.deltas.map(row => <tr key={row.metric_id}><th scope="row">{text(row.label)}</th><td>{row.prior_present ? row.prior : c.unknown}</td><td>{row.current_present ? row.current : c.unknown}</td><td>{row.comparable && row.is_movement && row.delta_present ? row.delta : text(row.absence?.label, c.noComparison)}</td></tr>)}</tbody></table></div>}
            </section>
          </>}
          {selection.task === "drivers" && <>
            {v.drivers.map(group => <section className={s.section} key={group.group_id}><h2>{text(group.title)}</h2>{group.absent ? <p className={s.muted}>{text(group.absence?.label, c.noDrivers)}</p> : <div className={s.tableScroll} role="region" aria-label={text(group.title)} tabIndex={0}><table className={s.table}><thead><tr><th>{c.input}</th><th>{c.value}</th><th>{c.publishedInfluence}</th><th>{c.coverage}</th></tr></thead><tbody>{group.rows.map(row => <tr key={row.driver_id}><th scope="row"><button type="button" onClick={() => openEvidence(`driver:${row.driver_id}`)}>{text(row.label)}</button></th><td>{row.value ? `${text(row.value)} ${localText(row.unit, lang)}` : text(row.absence?.label)}</td><td>{row.impact_present ? row.impact : text(row.impact_absence?.label)}</td><td>{text(row.coverage)}</td></tr>)}</tbody></table></div>}</section>)}
            <section className={s.section}><h2>{c.allMeasures}</h2><div className={s.metricGrid}>{v.metrics.filter(metric => !metric.metric_id.startsWith("payroll_revision:")).map(metric => <button type="button" className={s.metricButton} key={metric.metric_id} onClick={() => openEvidence(`metric:${metric.metric_id}`)}><span>{text(metric.label)}</span><strong>{metric.value ? text(metric.value) : text(metric.absence?.label)} <small>{localText(metric.unit, lang)}</small></strong><small>{metric.reference_period ?? c.unknown} · {text(metric.freshness)}</small><span className={s.caption}>{c.sources} ↗</span></button>)}</div></section>
          </>}
          {selection.task === "revisions" && (v.payroll_revisions ? <MacroPayrollRevisions data={v.payroll_revisions} selection={selection} onSelect={onSelect} onEvidence={openEvidence} lang={lang}/> : <div className={s.limit} role="status">{workspaceId === "labor_markets" ? c.noHistory : c.invalid}</div>)}
          {selection.task === "history" && <MacroEconomicHistory entries={v.series.entries} sources={v.evidence.sources} selection={selection} onSelect={onSelect} lang={lang} onEvidence={openEvidence}/>}
          {selection.evidence && read.data && <MacroEconomicEvidence read={read.data} selection={selection.evidence} lang={lang} onClose={closeEvidence} onSelect={id => onSelect({ evidence: id })}/>}
          <section className={s.section}>{v.headline.hysteresis.note && <details className={s.methodDetails}><summary>{c.assessmentMethod}</summary><p>{c.assessmentRulesNote}</p><p>{text(v.headline.hysteresis.note)}</p></details>}<details><summary>{c.inputDates}</summary><div className={s.tableScroll} role="region" aria-label={c.inputDates} tabIndex={0}><table className={s.table}><thead><tr><th>{c.source}</th><th>{c.inputDates}</th><th>{c.sourceStatus}</th></tr></thead><tbody>{v.context.required.map(row => <tr key={row.component_id}><th scope="row">{text(row.label)}</th><td>{row.source_asof ?? c.unknown}</td><td>{text(row.freshness)}</td></tr>)}</tbody></table></div></details></section>
        </>)}
      </div>
    </div>
  </div>;
}
