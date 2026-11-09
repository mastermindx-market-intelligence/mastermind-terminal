"use client";
import { useState } from "react";
import { DEFENSE_AXES, DEFENSE_COHORT, defenseCoreFacts, type DefenseContext, type DefenseTicker } from "@/lib/catalystDefense";
import { defensePeriodText } from "@/lib/catalystDefenseEvidence";
import { defenseText, type DefenseTextKey } from "@/lib/catalystDefenseLex";
import { DefenseFactEvidence } from "./DefenseFactEvidence";
import type { CatalystLoadError } from "./CatalystOpportunityView";
import styles from "./CatalystOpportunity.module.css";

export type DefensePanelProps = { view: DefenseContext|null; lang: "en"|"zh"; loading: boolean; error: CatalystLoadError; onRefresh: ()=>void };
function dateText(value: string, lang: "en"|"zh"): string {
  return new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-US", {year:"numeric",month:"short",day:"numeric",timeZone:"UTC"}).format(new Date(value));
}
export function DefenseResearchPanel({view,lang,loading,error,onRefresh}: DefensePanelProps) {
  const t = (key:DefenseTextKey) => defenseText(lang,key);
  const [ticker,setTicker] = useState<DefenseTicker>("LMT");
  const visible = !error && !loading ? view : null;
  const profile = visible?.profiles.find(p=>p.ticker_display===ticker) || null;
  const profileKey = `${visible?.content_id}:${profile?.issuer_id}:${ticker}`;
  const core = profile ? defenseCoreFacts(profile) : [];
  const segment = core[0]?.accounting_basis.match(/^issuer_reported_segment:([^:]+):reported$/)?.[1];
  const interpretation = profile?.interpretation;
  const sources = [...new Set(profile?.axes.economics.facts.map(f=>f.source_span.source_url).filter((v):v is string=>!!v) || [])];
  const unavailable = !loading && (!visible || error);
  const axisRows = profile && DEFENSE_AXES.map(key=>{
    const axis=profile.axes[key], state=axis.state === "unavailable" ? "unavailableState" : axis.state;
    return <details className={styles.defenseAxis} key={`${profileKey}:${key}`}>
      <summary><span>{t(key)}</span><strong data-dated={axis.state==="stale"}>{t(state)}</strong></summary>
      <p>{lang==="zh"?axis.summary_zh:axis.summary_en}</p>
      {axis.observed_at && <p>{t("axisObserved")}: {dateText(axis.observed_at,lang)}</p>}
    </details>;
  });
  const chainRows = profile && interpretation?.chain.map(row=><details className={styles.defenseDisclosure} key={`${profileKey}:${row.stage}`}>
    <summary><span>{t(row.stage)}</span><span className={styles.badge}>{t(row.state)}</span></summary>
    <p>{lang==="zh"?row.summary_zh:row.summary_en}</p>
    <DefenseFactEvidence profile={profile} lang={lang} references={row.fact_refs}/>
  </details>);
  const scenarioRows = profile && interpretation?.scenarios.map(row=><details className={styles.defenseDisclosure} key={`${profileKey}:${row.kind}`}>
    <summary>{t(row.kind)}</summary>
    <p><strong>{t("assumption")}: </strong>{lang==="zh"?row.assumption_zh:row.assumption_en}</p>
    <p><strong>{t("implication")}: </strong>{lang==="zh"?row.implication_zh:row.implication_en}</p>
    <p><strong>{t("invalidation")}: </strong>{lang==="zh"?row.invalidation_zh:row.invalidation_en}</p>
    <DefenseFactEvidence profile={profile} lang={lang} references={row.fact_refs}/>
  </details>);
  return <section id="defense-evidence" className={styles.defensePanel} data-testid="defense-research" aria-labelledby="defense-research-title" aria-busy={loading}>
    <header className={styles.defenseHead}><div><h2 id="defense-research-title">{t("title")}</h2><p>{t("subtitle")}</p></div>
      <button className={styles.button} onClick={onRefresh} disabled={loading}>{t("refresh")}</button></header>
    <p className={styles.defenseBoundary}>{t("separate")}</p>
    {loading && <p role="status">{t("loading")}</p>}
    {unavailable && <div className={styles.notice} role="status"><h3>{t(error==="auth" || error==="access"?"access":"unavailable")}</h3>
      <p>{t(error==="auth" || error==="access"?"accessBody":"unavailableBody")}</p></div>}
    {visible && profile && <>
      <div className={styles.defenseSelector} role="group" aria-label={t("cohort")}>
        {DEFENSE_COHORT.map(symbol=><button className={styles.button} key={symbol} aria-pressed={symbol===ticker} onClick={()=>setTicker(symbol)}>{symbol}</button>)}
        <span>{t("cohort")}</span>
      </div>
      <div className={styles.defenseIdentity}><h3>{profile.name}</h3>{segment && <p>{segment} · {t("baseline")}</p>}<p>{t("generated")}: {dateText(visible.generated_at,lang)} · {t("historic")}</p></div>
      <div className={styles.defenseAxes}>{axisRows}</div>
      <div className={styles.defenseMetrics} aria-label={t("baseline")}>
        {core.map((fact,index)=><div key={fact.fact_id}><span>{t((["sales","profit","margin"] as const)[index])}</span>
          <strong>{typeof fact.value==="number"?new Intl.NumberFormat(lang==="zh"?"zh-CN":"en-US",{maximumFractionDigits:2}).format(fact.value):fact.value}{fact.unit==="percent"?"%":""}</strong>
          <span>{fact.unit==="USD_million"?`${t("millions")} · `:""}{defensePeriodText(fact.period,lang)}</span></div>)}
        {core.length===0 && <p>{t("noBaseline")}</p>}
      </div>
      {profile.axes.economics.observed_at && <p className={styles.defenseBoundary}>{t("sourceTime")}: {dateText(profile.axes.economics.observed_at,lang)}</p>}
      <p className={styles.defenseBoundary}>{t("boundary")}</p>
      {interpretation && <div className={styles.defenseReading}><section><h3>{t("chain")}</h3>{chainRows}</section><section><h3>{t("scenarios")}</h3>{scenarioRows}</section></div>}
      {(lang==="zh"?profile.next_condition_zh:profile.next_condition) && <details className={styles.defenseDisclosure} key={`${profileKey}:next`}><summary>{t("next")}</summary><p>{lang==="zh"?profile.next_condition_zh:profile.next_condition}</p>
        <p><strong>{t("contrary")}: </strong>{lang==="zh"?profile.contrary_case_zh:profile.contrary_case}</p>
        <p><strong>{t("invalidation")}: </strong>{lang==="zh"?profile.invalidation_zh:profile.invalidation}</p></details>}
      <DefenseFactEvidence key={`${profileKey}:all`} profile={profile} lang={lang}/>
      <div className={styles.actions}>{sources.map((href,index)=><a className={styles.button} href={href} key={href} target="_blank" rel="noopener noreferrer">{t("source")} {index+1} ↗</a>)}
        <a className={styles.button} href="https://www.mastermind-x.com/government_revenue.html" target="_blank" rel="noopener noreferrer">{t("full")} ↗</a></div>
      <details className={styles.defenseDisclosure} key={`${profileKey}:receipts`}><summary>{t("receipts")}</summary><p>{visible.content_id}</p>
        <p>{profile.axes.economics.facts.length} {t("facts")}</p>
        {core.map(f=><div className={styles.defenseReceipt} key={f.fact_id}><code>{f.fact_id}</code><code>{f.accounting_basis}</code><code>{f.source_span.text_sha256}</code></div>)}
      </details>
    </>}
  </section>;
}
