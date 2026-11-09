"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import type { CatalystCase, CatalystView, ThemeLabel } from "@/lib/catalystOpportunity";
import { catalystText, type CatalystTextKey } from "@/lib/catalystOpportunityLex";
import styles from "./CatalystOpportunity.module.css";
import { defenseText } from "@/lib/catalystDefenseLex";

export type CatalystLoadError = "auth" | "access" | "unavailable" | null;
export type CatalystOpportunityViewProps = {
  view: CatalystView | null; lang: "en" | "zh"; loading: boolean;
  error: CatalystLoadError; onRefresh: () => void; defensePanel?: ReactNode;
};
type Scope = "all" | "defense" | "energy";
const VALID_THEME = /^[a-z][a-z0-9_]{0,95}$/;
function localName(row: {name:string;name_zh:string}, lang: "en"|"zh"): string {return lang === "zh" ? row.name_zh : row.name;}
function sourceDate(value: string | null, lang: "en"|"zh"): string {
  if (!value) return catalystText(lang,"unknown");
  return new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-US",{month:"short",day:"numeric",year:"numeric",timeZone:"UTC"}).format(new Date(value+"T00:00:00Z"));
}
function percentage(value: number | null, lang: "en"|"zh", relative = false): string {
  if (value === null) return catalystText(lang,"unknown");
  const number = new Intl.NumberFormat(lang === "zh" ? "zh-CN":"en-US",{maximumFractionDigits:relative ? 2:0,signDisplay:relative?"always":"auto"}).format(value*100);
  return relative ? `${number} ${catalystText(lang,"pp")}` : `${number}%`;
}
function stateKey(value: ThemeLabel): CatalystTextKey {return value;}

export function CatalystOpportunityView({view,lang,loading,error,onRefresh,defensePanel}: CatalystOpportunityViewProps) {
  const t = (key:CatalystTextKey) => catalystText(lang,key);
  const [scope,setScope] = useState<Scope>("all"), [query,setQuery] = useState("");
  const [selectedId,setSelectedId] = useState<string|null>(null), [limit,setLimit] = useState(6);
  const [copyStatus,setCopyStatus] = useState<CatalystTextKey|null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(()=>{
    const sync = () => {
      const id = new URLSearchParams(window.location.search).get("case");
      setSelectedId(id && VALID_THEME.test(id) ? id : null);
    };
    sync();window.addEventListener("popstate",sync);
    return ()=>window.removeEventListener("popstate",sync);
  },[]);
  const watches = useMemo(()=>{
    const term = query.trim().toLocaleLowerCase();
    return (view?.cases || []).filter(row=>(scope==="all" || row.sector===scope)
      && (!term || `${row.name} ${row.name_zh}`.toLocaleLowerCase().includes(term)));
  },[view,scope,query]);
  const selected = watches.find(row=>row.theme_id===selectedId) || watches[0] || null;
  const missingSelection = selectedId !== null && view !== null && !view.cases.some(row=>row.theme_id===selectedId);
  const choose = (row:CatalystCase) => {
    setSelectedId(row.theme_id);setCopyStatus(null);
    const url = new URL(window.location.href);url.searchParams.set("tab","catalysts");url.searchParams.set("case",row.theme_id);
    window.history.pushState(null,"",url);
    window.requestAnimationFrame(()=>heading.current?.focus());
  };
  const copy = async () => {
    if (!selected) return;
    const url = new URL(window.location.href);url.searchParams.set("tab","catalysts");url.searchParams.set("case",selected.theme_id);
    try {await navigator.clipboard.writeText(url.toString());setCopyStatus("copied");}
    catch {setCopyStatus("copyFailed");}
  };
  const empty = error || (!loading && (!view || view.status==="unavailable"));
  const populationUnknown = view?.coverage.declared === null;
  const observationsIncomplete = !!view && (view.coverage.refused > 0 ||
    (view.coverage.declared !== null && view.coverage.declared !== view.coverage.observed));
  const cautionRows = selected?.cautions.map(c => (
    <p key={c.code} className={styles.caution}>{lang === "zh" ? c.text_zh : c.text}</p>
  ));
  return <main className={`main2 ${styles.root}`} data-testid="catalyst-opportunities" aria-busy={loading}>
    <div className={styles.page}>
      <header className={styles.header}>
        <div><p className={styles.eyebrow}>{t("eyebrow")}</p><h1>{t("title")}</h1><p className={styles.subtitle}>{t("subtitle")}</p></div>
        <div className={styles.actions}>{defensePanel && <a className={styles.button} href="#defense-evidence">{defenseText(lang,"inspect")}</a>}<button className={styles.button} onClick={onRefresh} disabled={loading}>{t("refresh")}</button></div>
      </header>
      <div className={styles.context}><span className={styles.badge}>{t("daily")}</span><span>{t("research")}</span>
        {view?.as_of && <span>{t("sourceDate")}: {sourceDate(view.as_of,lang)}</span>}
      </div>
      {loading && <div className={styles.loading} role="status">{t("loading")}</div>}
      {empty && <section className={styles.empty} role="status">
        <h2>{t(error==="auth"?"signIn":error==="access"?"access":"unavailable")}</h2>
        <p>{t(error==="auth" || error==="access"?"accessBody":"unavailableBody")}</p>
        <div className={styles.actions}>
          {error==="auth" && <Link className={styles.button} href="/login">{t("signInLink")}</Link>}
          <Link className={styles.button} href="/discover?tab=sectors">{t("sectorLink")}</Link>
          <button className={styles.button} onClick={onRefresh}>{t("refresh")}</button>
        </div>
      </section>}
      {view && !empty && <>
        {view.status==="stale" && <aside className={styles.notice}><strong>{t("datedTitle")}</strong><p>{t("datedBody")}</p></aside>}
        {populationUnknown && <aside className={styles.notice}><strong>{t("unknownPopulationTitle")}</strong><p>{t("unknownPopulationBody")}</p></aside>}
        {observationsIncomplete && <aside className={styles.notice}><strong>{t("partialTitle")}</strong><p>{t("partialBody")}</p></aside>}
        {missingSelection && <p className={styles.notice}>{t("invalidLink")}</p>}
        <div className={styles.counts}>
          <div><strong>{view.coverage.valid}</strong><span>{t("covered")}</span><small>{t("universe")}</small></div>
          <div><strong>{view.coverage.watch_count}</strong><span>{t("watches")}</span><small>{t("provisional")}</small></div>
        </div>
        <div className={styles.filters}>
          <div className={styles.scope} role="group" aria-label={t("theme")}>
            {(["all","defense","energy"] as const).map(key=><button key={key} aria-pressed={scope===key} onClick={()=>{setScope(key);setLimit(6);}}>{t(key)}</button>)}
          </div>
          <label>{t("search")}<input type="search" maxLength={120} value={query} onChange={event=>{setQuery(event.target.value);setLimit(6);}} autoComplete="off" /></label>
        </div>
        {watches.length===0 ? <section className={styles.empty}>
          <h2>{t("noMatches")}</h2><p>{t("noMatchesBody")}</p>
          {scope==="defense" && view.inventory.some(row=>row.theme_id==="defense" && !row.watch) && <p>{t("defenseNoWatch")}</p>}
          <div className={styles.actions}><button className={styles.button} onClick={()=>{setScope("all");setQuery("");}}>{t("clear")}</button>
            <a className={styles.button} href="https://www.mastermind-x.com/government_revenue.html" target="_blank" rel="noopener noreferrer">{t("defenseLink")}</a></div>
        </section> : <div className={styles.columns}>
          <section className={styles.watchList} aria-label={t("watches")}>
            {watches.slice(0,limit).map(row=><article className={styles.watchCard} key={row.id} data-selected={selected?.id===row.id}>
              <div className={styles.cardTop}><span className={styles.badge}>{t(row.watch_kind==="emerging_watch"?"emergingWatch":"leadershipWatch")}</span><span>{t(stateKey(row.source_label))}</span></div>
              <h2>{localName(row,lang)}</h2><p>{lang==="zh"?row.summary_zh:row.summary}</p>
              <div className={styles.cardMetrics}><span>{t("relative")}<strong data-sign={row.metrics.rel_5d===null?undefined:row.metrics.rel_5d>0?"up":row.metrics.rel_5d<0?"down":"flat"}>{percentage(row.metrics.rel_5d,lang,true)}</strong></span>
                <span>{t("breadth")}<strong>{percentage(row.metrics.pct50,lang)}</strong></span></div>
              <button className={styles.inspect} onClick={()=>choose(row)} aria-pressed={selected?.id===row.id} aria-label={`${t("openCase")}: ${localName(row,lang)}`}>{t("openCase")} <span aria-hidden="true">→</span></button>
            </article>)}
            {limit<watches.length && <button className={styles.button} onClick={()=>setLimit(value=>value+12)}>{t("more")} ({watches.length-limit})</button>}
          </section>
          {selected && <section className={styles.detail} aria-labelledby="catalyst-detail-title">
            <div className={styles.detailHead}><span className={styles.eyebrow}>{t("details")}</span><h2 id="catalyst-detail-title" ref={heading} tabIndex={-1}>{localName(selected,lang)}</h2>
              <p>{lang==="zh"?selected.summary_zh:selected.summary}</p></div>
            <div className={styles.detailMetrics}>
              <div><span>{t("relative")}</span><strong>{percentage(selected.metrics.rel_5d,lang,true)}</strong><small>{t("relativeFoot")}</small></div>
              <div><span>{t("breadth")}</span><strong>{percentage(selected.metrics.pct50,lang)}</strong><small>{t("breadthFoot")}</small></div>
            </div>
            <div className={styles.detailBody}>
              <p className={styles.sourceState}>{t("sourceState")}: <strong>{t(stateKey(selected.source_label))}</strong> · {sourceDate(selected.observed_on,lang)}</p>
              <section className={styles.callout}><h3>{t("causeTitle")}</h3><p>{t("causeBody")}</p></section>
              {cautionRows}
              <details className={styles.disclosure}><summary>{t("deeper")}</summary>
                {(["event","economics","entry"] as const).map(key=><div className={styles.assessment} key={key}><h3>{t(key)}</h3><p>{lang==="zh"?selected[key].summary_zh:selected[key].summary}</p></div>)}
              </details>
              <h3 className={styles.next}>{t("next")}</h3>
              <div className={styles.actions}><Link className={styles.button} href="/discover?tab=sectors">{t("sectorLink")}</Link>
                <a className={styles.button} href="https://www.mastermind-x.com/government_revenue.html" target="_blank" rel="noopener noreferrer">{t("defenseLink")}</a>
                <button className={styles.button} onClick={()=>void copy()}>{t("copy")}</button></div>
              {copyStatus && <p className={styles.copyStatus} role="status">{t(copyStatus)}</p>}
            </div>
          </section>}
        </div>}
        <details className={styles.coverage}><summary>{t("allCoverage")} ({view.inventory.length})</summary>
          <div className={styles.tableWrap}><table><thead><tr><th>{t("theme")}</th><th>{t("state")}</th><th>{t("watchColumn")}</th></tr></thead>
            <tbody>{view.inventory.map(row=><tr key={row.theme_id}><th scope="row">{localName(row,lang)}</th><td>{t(stateKey(row.source_label))}</td><td>{t(row.watch?"yes":"no")}</td></tr>)}</tbody></table></div>
        </details>
        <footer className={styles.footer}><details><summary>{t("sourceDetails")}</summary><p>{t("receiptNote")}</p><p>{t("historical")}</p>
          <p>{t("checked")}: {view.assessed_at}</p><code>{view.generation}</code></details>
          <p>{lang==="zh"?view.disclaimer_zh:view.disclaimer}</p></footer>
      </>}
      {defensePanel}
    </div>
  </main>;
}
