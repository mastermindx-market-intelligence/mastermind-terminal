"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { localText, type Pair } from "@/lib/shared-shell/readingPayloads";
import { freshnessLabel, readingFreshness } from "@/lib/shared-shell/readingFreshness";
import type { MacroWorkspaceRead } from "@/lib/shared-shell/macroWorkspacePayload";
import s from "./MacroLiquidity.module.css";

const COPY = {
  en: { title:"Liquidity Regime", macro:"Macro workspace", eyebrow:"United States · Macro", intro:"Funding conditions and balance-sheet support.", back:"Market overview", sources:"Sources & method", refresh:"Refresh", loading:"Loading the published liquidity reading…", unavailable:"The published liquidity reading could not be verified.", access:"Your current access does not include this reading.", missing:"This source has not published a reading.", invalid:"This Macro workspace selection is not available. Return to the overview to choose an available reading.", published:"Published regime", date:"Source as of", unknown:"Unavailable", noState:"The source has not published a regime classification.", coords:"These are the supplied coordinates. The published classification retains the producer's stability rules.", changes:"Since the previous publication", previous:"Previous", current:"Current", change:"Change", unchanged:"Unchanged", noPrior:"No comparable previous publication", noPriorBody:"Current evidence remains available below. No change is inferred from a missing or ineligible comparison.", drivers:"Published drivers", value:"Value", coverage:"Coverage", meaning:"Published implications", receipt:"Publication receipt & comparison method", method:"Method", generation:"Generation", digest:"Canonical content digest", digestNote:"This digest identifies the canonical workspace content; it is not a hash of the raw file bytes.", manifest:"Manifest digest", inputDates:"Input observation dates", source:"Source", noHistory:"The source has not published a historical series for this workspace.", hasHistory:"Published history remains available in the full workspace.", full:"Open full liquidity workspace", retained:"Full Macro Dashboard", impact:"Published model impact", impactUnit:"The source view does not specify an impact unit; these values are not labelled as returns or points.", sourceStatus:"Source status", calc:"Calculation as of", noImplications:"No implication is published.", comparisonUnavailable:"Comparison unavailable" },
  zh: { title:"流动性状态", macro:"宏观工作区", eyebrow:"美国 · 宏观", intro:"融资条件与资产负债表支持。", back:"市场总览", sources:"来源与方法", refresh:"刷新", loading:"正在加载已发布的流动性读数…", unavailable:"无法核验已发布的流动性读数。", access:"当前权限不包含此读数。", missing:"该来源尚未发布读数。", invalid:"此宏观工作区选项暂不可用。请返回总览选择可用读数。", published:"已发布状态", date:"来源截至", unknown:"不可用", noState:"来源尚未发布状态分类。", coords:"此处为来源提供的坐标。已发布分类保留生产端的稳定性规则。", changes:"较上次发布", previous:"上次", current:"本次", change:"变化", unchanged:"未变", noPrior:"暂无可比较的上次发布", noPriorBody:"下方仍展示当前可用证据。不会根据缺失或不符合条件的对比推断变化。", drivers:"发布依据", value:"数值", coverage:"覆盖情况", meaning:"已发布解读", receipt:"发布凭证与对比方法", method:"方法", generation:"发布代次", digest:"规范内容摘要", digestNote:"该摘要对应规范化的工作区内容，并非原始文件字节的哈希值。", manifest:"清单摘要", inputDates:"输入观察日期", source:"来源", noHistory:"来源尚未为本工作区发布历史序列。", hasHistory:"已发布历史仍可在完整工作区查看。", full:"打开完整流动性工作区", retained:"完整宏观仪表盘", impact:"已发布模型影响值", impactUnit:"来源视图未注明影响值单位；此处不会将其标为回报率或点数。", sourceStatus:"来源状态", calc:"计算截至", noImplications:"来源未发布解读。", comparisonUnavailable:"对比不可用" },
} as const;
type ReadPhase = "loading" | "ready" | "unavailable" | "access" | "missing";

/** Pure presenter: the parent owns identity, requests, refresh and URL lifetime. */
export default function MacroLiquidityDetail({ lang, read, now, backHref, fullHref, dashboardHref, onRefresh, onReturn, accountNotice, invalid = false }: {
  lang:"en"|"zh"; read:{phase:ReadPhase; data:MacroWorkspaceRead|null}; now:Date;
  backHref:string; fullHref:string; dashboardHref:string; onRefresh:()=>void; onReturn:()=>void;
  accountNotice?:ReactNode; invalid?:boolean;
}) {
  const c = COPY[lang], title = useRef<HTMLHeadingElement>(null), sources = useRef<HTMLElement>(null);
  const [sourcesOpen,setSourcesOpen] = useState(false);
  useEffect(()=>{title.current?.focus();},[invalid]);
  const selected = !invalid && !accountNotice && read.phase === "ready" ? read.data?.selected_workspace : null;
  const ready = selected?.state === "ready" ? selected : null;
  const v = ready?.view;
  const text = (value: Pair | null | undefined, fallback:string = c.unknown) => localText(value,lang) || fallback;
  const comparable = !!v && v.changes.comparable && v.changes.prior_is_earlier;
  const stateComparable = comparable && v?.headline.prior.state_id && v.headline.state_id && v.headline.prior.effective_date === v.changes.prior_effective_date;
  const showSources = () => { setSourcesOpen(true); sources.current?.focus(); sources.current?.scrollIntoView?.({block:"start"}); };
  return <div className={s.root} data-macro-liquidity="" data-read-state={invalid ? "invalid" : accountNotice ? "identity" : selected?.state === "unavailable" ? "unavailable" : read.phase}>
    <Link className={s.back} href={backHref} onClick={onReturn}>← {c.back}</Link>
    <header className={s.header}>
      <div><p className={s.eyebrow}>{c.eyebrow}</p><h1 ref={title} tabIndex={-1}>{invalid ? c.macro : c.title}</h1><p className={s.muted}>{c.intro}</p></div>
      <div className={s.actions}>{v && <button className={s.button} aria-controls="liquidity-sources" onClick={showSources}>{c.sources}</button>}
        {!invalid && !accountNotice && <button className={s.button} onClick={onRefresh} disabled={read.phase === "loading"}>{c.refresh}</button>}</div>
    </header>
    {accountNotice || (invalid ? <p className={s.notice} role="status">{c.invalid}</p> : !v ? <section className={s.notice} role="status" aria-busy={read.phase === "loading"}>
      <p>{read.phase === "ready" ? c.unavailable : c[read.phase]}</p>
    </section> : <>
      <section className={s.hero} aria-labelledby="liquidity-published-state">
        <div className={s.meta}><p>{c.published}{v.headline.state_id ? ` · ${v.headline.state_id}` : ""}</p><p>{c.date}: {v.headline.effective_date ?? c.unknown}</p></div>
        <h2 id="liquidity-published-state">{v.headline.state_id ? text(v.headline.state_label) : c.noState}</h2>
        {v.headline.subtitle && <p className={s.summary}>{text(v.headline.subtitle)}</p>}
        {v.headline.hysteresis.note && <p className={s.muted}>{text(v.headline.hysteresis.note)}</p>}
        <p className={s.status}>{c.sourceStatus}: {text(v.context.state_label)}{v.context.worst_freshness_token !== v.context.state && v.context.worst_freshness && ` · ${text(v.context.worst_freshness)}`} · {freshnessLabel(readingFreshness(v.headline.effective_date,now),lang)}</p>
        <dl className={s.coordinates} data-liquidity-coordinates="">{v.axes.map(axis=><div key={axis.axis_id}><dt>{text(axis.label)}</dt><dd>{axis.value_raw !== null ? <>{axis.value}<small>{text(v.metrics.find(metric=>metric.metric_id === axis.axis_id)?.unit)}</small></> : text(axis.absence?.label)}</dd></div>)}</dl>
        <p className={s.caption}>{c.coords}</p>
      </section>
      <section className={s.section} aria-labelledby="liquidity-changes">
        <div className={s.sectionHeading}><h2 id="liquidity-changes">{c.changes}</h2>{comparable && <p>{v.changes.prior_effective_date} → {v.headline.effective_date}</p>}</div>
        {!comparable ? <div className={s.notice}><h3>{text(v.changes.absence?.label,c.noPrior)}</h3><p>{c.noPriorBody}</p></div> : <div className={s.comparison} role="table" aria-label={c.changes}>
          <div className={s.comparisonHead} role="row"><span role="columnheader">{c.source}</span><span role="columnheader">{c.previous}</span><span role="columnheader">{c.current}</span><span role="columnheader">{c.change}</span></div>
          {stateComparable && <div className={s.comparisonRow} role="row"><strong role="rowheader">{c.published}</strong><span role="cell" data-label={c.previous}>{v.headline.prior.state_id}</span><span role="cell" data-label={c.current}>{v.headline.state_id}</span><span role="cell" data-label={c.change}>{v.headline.state_id === v.headline.prior.state_id ? c.unchanged : `${v.headline.prior.state_id} → ${v.headline.state_id}`}</span></div>}
          {v.changes.deltas.map(row=>{const eligible = row.comparable && row.is_movement && row.prior_present && row.current_present && row.delta_present;
            const unit = localText(v.metrics.find(m=>m.metric_id === row.metric_id)?.unit,lang);
            return <div className={s.comparisonRow} role="row" key={row.metric_id}>
              <strong role="rowheader">{text(row.label)}{unit && <small>{unit}</small>}</strong>
              <span role="cell" data-label={c.previous}>{row.prior_present && row.prior ? row.prior : c.unknown}</span>
              <span role="cell" data-label={c.current}>{row.current_present && row.current ? row.current : c.unknown}</span>
              <span role="cell" data-label={c.change}>{eligible && row.delta ? row.delta : text(row.absence?.label,c.comparisonUnavailable)}</span>
            </div>;})}
        </div>}
      </section>
      <section className={s.section} aria-labelledby="liquidity-drivers"><h2 id="liquidity-drivers">{c.drivers}</h2>
        <div className={s.driverGroups}>{v.drivers.map(group=><section className={s.driverGroup} key={group.group_id}>
          <h3>{text(group.title)}</h3>{group.absent ? <p className={s.notice}>{text(group.absence?.label)}</p> : <dl>{group.rows.map(row=><div className={s.driver} key={row.driver_id}>
            <dt>{text(row.label)}</dt><dd>{row.value ? <>{text(row.value)} <small>{localText(row.unit,lang)}</small></> : text(row.absence?.label)}</dd><dd className={s.muted}>{text(row.coverage)}</dd>
          </div>)}</dl>}
        </section>)}</div>
      </section>
      <section className={s.section} aria-labelledby="liquidity-implications"><h2 id="liquidity-implications">{c.meaning}</h2>
        {v.implications.absent ? <p className={s.caption}>{text(v.implications.absence_text,c.noImplications)}</p> : <ul className={s.implications}>{v.implications.entries.map(item=><li key={item.implication_id}><p>{text(item.text)}</p><p className={s.caption}>{text(item.evidence_label,"")}{item.evidence_claim && ` · ${text(item.evidence_claim)}`}</p></li>)}</ul>}
      </section>
      <section className={s.section} aria-labelledby="liquidity-source-heading"><h2 id="liquidity-source-heading">{c.sources}</h2>
        <h3 className={s.inputHeading}>{c.inputDates}</h3><dl className={s.inputDates}>{v.context.required.map(input=><div key={input.component_id}><dt>{text(input.label)}</dt><dd>{input.source_asof ?? c.unknown}</dd><dd>{text(input.presence)} · {text(input.freshness)}</dd></div>)}</dl>
        <details id="liquidity-sources" className={s.details} open={sourcesOpen} onToggle={event=>setSourcesOpen(event.currentTarget.open)}>
          <summary ref={sources}>{c.receipt}</summary>
          <dl className={s.receipt}><div><dt>{c.method}</dt><dd>{v.headline.method_version ?? c.unknown}</dd></div><div><dt>{c.generation}</dt><dd><code>{ready!.generation_id}</code></dd></div>
            <div><dt>{c.sourceStatus}</dt><dd>{text(v.context.state_label)}</dd></div><div><dt>{c.calc}</dt><dd>{v.evidence.generation.calculation_as_of ?? c.unknown}</dd></div>
            <div><dt>{c.digest}</dt><dd><code>{ready!.artifact.sha256}</code><p>{c.digestNote}</p></dd></div><div><dt>{c.manifest}</dt><dd><code>{read.data!.source.manifest_sha256}</code></dd></div>
          </dl><p className={s.caption}>{text(v.evidence.authority.statement)}</p>
          <h3>{c.impact}</h3><p className={s.caption}>{c.impactUnit}</p><dl className={s.receipt}>{v.drivers.flatMap(group=>group.rows.map(row=><div key={`${group.group_id}:${row.driver_id}`}><dt>{text(group.title)} · {text(row.label)}</dt><dd>{row.impact_present ? row.impact : c.unknown}</dd></div>))}</dl>
        </details>
        <p className={s.caption}>{v.series.absent ? text(v.series.absence?.label,c.noHistory) : c.hasHistory}</p>
      </section>
      <footer className={s.actions}><Link className={s.button} href={fullHref} prefetch={false}>{c.full} ↗</Link><Link className={s.back} href={dashboardHref} prefetch={false}>{c.retained} →</Link></footer>
    </>)}
  </div>;
}
