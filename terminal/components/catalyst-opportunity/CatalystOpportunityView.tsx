"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { CatalystCase, CatalystView, ThemeLabel } from "@/lib/catalystOpportunity";
import { catalystText, type CatalystTextKey } from "@/lib/catalystOpportunityLex";
import { marketNavigationHref, workspaceMarket } from "@/lib/sharedShellMarket";
import styles from "./CatalystOpportunity.module.css";

export type CatalystLoadError = "auth" | "access" | "unavailable" | null;
export type CatalystOpportunityViewProps = {
  view: CatalystView | null; lang: "en" | "zh"; loading: boolean;
  /** The existing workspace result owns account/read identity; this view does not create one. */
  readContext: object | null;
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

export function CatalystOpportunityView({view:loadedView,readContext,lang,loading,error,onRefresh,defensePanel}: CatalystOpportunityViewProps) {
  const t = (key:CatalystTextKey) => catalystText(lang,key);
  const params = useSearchParams();
  const sectorHref = marketNavigationHref("/sectors",workspaceMarket("/discover",params?.toString() || ""));
  const [scope,setScope] = useState<Scope>("all"), [query,setQuery] = useState("");
  const [selectedId,setSelectedId] = useState<string|null>(null), [limit,setLimit] = useState(6);
  const [selectionReady,setSelectionReady] = useState(false);
  // Do not retain a prior read's detail, link or figures while the owner clears access.
  const view = !loading && !error && readContext && loadedView?.status!=="unavailable" ? loadedView : null;
  const heading = useRef<HTMLHeadingElement>(null), pageHeading = useRef<HTMLHeadingElement>(null);
  const watchesHeading = useRef<HTMLHeadingElement>(null);
  const watchControls = useRef(new Map<string,HTMLButtonElement>());
  const missingNotice = useRef<HTMLParagraphElement>(null), manualLink = useRef<HTMLTextAreaElement>(null);
  const detailHasFocus = useRef(false);
  const choiceFocus = useRef<{themeId:string;view:CatalystView|null;readContext:object|null}|null>(null);
  const returnFocus = useRef<typeof choiceFocus.current>(null);
  const activeCopy = useRef<object|null>(null);
  const [copyState,setCopyState] = useState<{context:object;url:string;status:"copying"|"copied"|"copyFailed"}|null>(null);
  useEffect(()=>{
    const sync = () => {
      activeCopy.current=null;choiceFocus.current=null;returnFocus.current=null;setCopyState(null);
      const id = new URLSearchParams(window.location.search).get("case");
      setSelectedId(id && VALID_THEME.test(id) ? id : null);setSelectionReady(true);
    };
    sync();window.addEventListener("popstate",sync);
    return ()=>window.removeEventListener("popstate",sync);
  },[]);
  const watches = useMemo(()=>{
    const term = query.trim().toLocaleLowerCase();
    return (view?.cases || []).filter(row=>(scope==="all" || row.sector===scope)
      && (!term || `${row.name} ${row.name_zh}`.toLocaleLowerCase().includes(term)));
  },[view,scope,query]);
  // An explicit case belongs to the authorized snapshot, not to the filtered list.
  // Only an absent URL selection may default to the first visible watch.
  const selected = !selectionReady || !view ? null : selectedId===null
    ? watches[0] || null : view.cases.find(row=>row.theme_id===selectedId) || null;
  const missingSelection = selectionReady && selectedId!==null && view!==null && selected===null;
  const outsideFilters = !!selected && selectedId!==null && !watches.some(row=>row.theme_id===selected.theme_id);
  const copyContext = useMemo(()=>({view,readContext,themeId:selected?.theme_id,selectedId,selectionReady}),
    [view,readContext,selected?.theme_id,selectedId,selectionReady]);
  // A context change (including A -> B -> A) retires the attempt before paint.
  // This suppresses late feedback; an already issued clipboard write is not cancellable.
  useLayoutEffect(()=>()=>{activeCopy.current=null;},[copyContext]);
  useLayoutEffect(()=>{
    const request = choiceFocus.current;choiceFocus.current=null;
    if (request && request.themeId===selected?.theme_id && request.view===view && request.readContext===readContext) {
      heading.current?.focus();
    } else if (!selected && detailHasFocus.current) {
      detailHasFocus.current=false;
      (missingNotice.current || pageHeading.current)?.focus();
    }
  },[selected,view,readContext]);
  const currentCopy = copyState?.context===copyContext ? copyState : null;
  const clearFilters = () => {setScope("all");setQuery("");setLimit(6);};
  const choose = (row:CatalystCase) => {
    activeCopy.current=null;setCopyState(null);
    const intent={themeId:row.theme_id,view,readContext};
    choiceFocus.current=intent;returnFocus.current=intent;setSelectedId(row.theme_id);
    const url = new URL(window.location.href);url.searchParams.set("tab","catalysts");url.searchParams.set("case",row.theme_id);
    window.history.pushState(null,"",url);
    if (selected?.theme_id===row.theme_id) {choiceFocus.current=null;heading.current?.focus();}
  };
  const backToWatches = () => {
    const point=returnFocus.current;
    const control=point && point.view===view && point.readContext===readContext
      && watches.some(row=>row.theme_id===point.themeId) ? watchControls.current.get(point.themeId) : null;
    (control?.isConnected ? control : watchesHeading.current)?.focus();
  };
  const copy = async () => {
    if (!selected || !view) return;
    const prepared = new URL(window.location.href);prepared.searchParams.set("tab","catalysts");prepared.searchParams.set("case",selected.theme_id);
    const url = prepared.toString(), attempt = {context:copyContext,url};
    activeCopy.current=attempt;setCopyState({...attempt,status:"copying"});
    try {
      await navigator.clipboard.writeText(url);
      if (activeCopy.current===attempt) setCopyState({...attempt,status:"copied"});
    } catch {
      if (activeCopy.current===attempt) setCopyState({...attempt,status:"copyFailed"});
    }
  };
  const empty = error || (!loading && !view);
  const populationUnknown = view?.coverage.declared === null;
  const observationsIncomplete = !!view && (view.coverage.refused > 0 ||
    (view.coverage.declared !== null && view.coverage.declared !== view.coverage.observed));
  const cautionRows = selected?.cautions.map(c => (
    <p key={c.code} className={styles.caution}>{lang === "zh" ? c.text_zh : c.text}</p>
  ));
  return <main className={`main2 ${styles.root}`} data-testid="catalyst-opportunities" aria-busy={loading}>
    <div className={styles.page}>
      <header className={styles.header}>
        <div><p className={styles.eyebrow}>{t("eyebrow")}</p><h1 ref={pageHeading} tabIndex={-1}>{t("title")}</h1><p className={styles.subtitle}>{t("subtitle")}</p></div>
        <div className={styles.actions}>{defensePanel && <a className={styles.button} href="#defense-evidence">{t("defenseResearch")}</a>}<button className={styles.button} onClick={onRefresh} disabled={loading}>{t("refresh")}</button></div>
      </header>
      <div className={styles.context}><span className={styles.badge}>{t("daily")}</span><span>{t("research")}</span></div>
      {loading && <div className={styles.loading} role="status">{t("loading")}</div>}
      {empty && <section className={styles.empty} role="status">
        <h2>{t(error==="auth"?"signIn":error==="access"?"access":"unavailable")}</h2>
        <p>{t(error==="auth" || error==="access"?"accessBody":"unavailableBody")}</p>
        <div className={styles.actions}>
          {error==="auth" && <Link className={styles.button} prefetch={false} href="/login">{t("signInLink")}</Link>}
          <Link className={styles.button} prefetch={false} href={sectorHref}>{t("sectorLink")}</Link>
          <button className={styles.button} onClick={onRefresh}>{t("refresh")}</button>
        </div>
      </section>}
      {view && !empty && <>
        {view.status==="stale" && <aside className={styles.notice}><strong>{t("datedTitle")}</strong><p>{t("datedBody")}</p></aside>}
        {populationUnknown && <aside className={styles.notice}><strong>{t("unknownPopulationTitle")}</strong><p>{t("unknownPopulationBody")}</p></aside>}
        {observationsIncomplete && <aside className={styles.notice}><strong>{t("partialTitle")}</strong><p>{t("partialBody")}</p></aside>}
        {missingSelection && <p className={styles.notice} ref={missingNotice} tabIndex={-1} role="status">{t("invalidLink")}</p>}
        <div className={styles.sourceBand} data-catalyst-source-summary>
          <div className={styles.counts}>
            <span><strong>{view.coverage.watch_count}</strong> {t("provisionalWatches")}</span>
            <span><strong>{view.coverage.valid}</strong> {t("usableThemes")}</span>
          </div>
          <div className={styles.sourceMeta} data-dated={view.source?.freshness==="stale"}>
            <span>{t("sourceDate")}: {sourceDate(view.as_of,lang)}</span>
            {view.source?.freshness==="stale" && <span>{t("datedShort")}</span>}
          </div>
          <div className={styles.scopeLine}><span>{t("universe")}</span><span>
            {t("observed")}: {view.coverage.observed} / {t("declared")}: {view.coverage.declared===null?t("unknown"):view.coverage.declared}
          </span></div>
        </div>
        <div className={styles.columns} data-has-detail={!!selected}>
          <div className={styles.listPane}>
            <div className={styles.listHeading}><h2 id="catalyst-watches-title" ref={watchesHeading} tabIndex={-1}>{t("watches")} <span>{watches.length}</span></h2><span>{t("sourceOrder")}</span></div>
            <div className={styles.filters}>
              <div className={styles.scope} role="group" aria-label={t("theme")}>
                {(["all","defense","energy"] as const).map(key=><button key={key} aria-pressed={scope===key} onClick={()=>{setScope(key);setLimit(6);}}>{t(key)}</button>)}
              </div>
              <label>{t("search")}<input type="search" maxLength={120} value={query} onChange={event=>{setQuery(event.target.value);setLimit(6);}} autoComplete="off" /></label>
            </div>
            {watches.length===0 ? <section className={styles.empty}>
              <h2>{t("noMatches")}</h2><p>{t("noMatchesBody")}</p>
              {scope==="defense" && view.inventory.some(row=>row.theme_id==="defense" && !row.watch) && <p>{t("defenseNoWatch")}</p>}
              <div className={styles.actions}><button className={styles.button} onClick={clearFilters}>{t("clear")}</button>
                <a className={styles.button} href="https://www.mastermind-x.com/government_revenue.html" target="_blank" rel="noopener noreferrer">{t("defenseResearch")}</a></div>
            </section> : <section className={styles.watchList} aria-labelledby="catalyst-watches-title">
              {watches.slice(0,limit).map(row=><article className={styles.watchCard} key={row.id} data-selected={selected?.id===row.id}>
                <div className={styles.cardTop}><span>{t(row.watch_kind==="emerging_watch"?"emergingWatch":"leadershipWatch")}</span><span>{t(stateKey(row.source_label))}</span></div>
                <h2><button className={styles.inspect} ref={node=>{if(node)watchControls.current.set(row.theme_id,node);else watchControls.current.delete(row.theme_id);}}
                  onClick={()=>choose(row)} aria-pressed={selected?.id===row.id} data-catalyst-watch-choice={row.theme_id}
                  aria-label={`${t("openCase")}: ${localName(row,lang)}`}>{localName(row,lang)}<span className={styles.rowArrow} aria-hidden="true" /></button></h2>
                <div className={styles.cardMetrics}><span>{t("relative")}<strong data-sign={row.metrics.rel_5d===null?undefined:row.metrics.rel_5d>0?"up":row.metrics.rel_5d<0?"down":"flat"}>{percentage(row.metrics.rel_5d,lang,true)}</strong></span>
                  <span>{t("breadth")}<strong>{percentage(row.metrics.pct50,lang)}</strong></span></div>
              </article>)}
              {limit<watches.length && <button className={styles.button} onClick={()=>setLimit(value=>value+12)}>{t("more")} ({watches.length-limit})</button>}
            </section>}
          </div>
          {selected && <section className={styles.detail} aria-labelledby="catalyst-detail-title"
            onFocusCapture={()=>{detailHasFocus.current=true;}}
            onBlurCapture={event=>{detailHasFocus.current=event.currentTarget.contains(event.relatedTarget as Node|null);}}>
            <div className={styles.detailHead}>
              <button type="button" className={styles.returnButton} onClick={backToWatches}><span aria-hidden="true">←</span> {t("backToWatches")}</button>
              <p className={styles.sourceState}>{t("sourceState")}: <strong>{t(stateKey(selected.source_label))}</strong> · {sourceDate(selected.observed_on,lang)}</p>
              <h2 id="catalyst-detail-title" ref={heading} tabIndex={-1}>{localName(selected,lang)}</h2>
              <p>{lang==="zh"?selected.summary_zh:selected.summary}</p>
              {outsideFilters && <div className={styles.selectionNotice}><p role="status">{t("outsideFilters")}</p>
                {watches.length>0 && <button className={styles.button} onClick={clearFilters}>{t("clear")}</button>}</div>}
            </div>
            <div className={styles.detailMetrics} data-catalyst-detail-metrics>
              <div><span>{t("relative")}</span><strong>{percentage(selected.metrics.rel_5d,lang,true)}</strong><small>{t("relativeFoot")}</small></div>
              <div><span>{t("breadth")}</span><strong>{percentage(selected.metrics.pct50,lang)}</strong><small>{t("breadthFoot")}</small></div>
            </div>
            <div className={styles.detailBody}>
              <section className={styles.assessments} aria-labelledby="catalyst-evidence-title" data-catalyst-assessments>
                <h3 id="catalyst-evidence-title">{t("evidenceToCheck")}</h3><p className={styles.evidenceContext}>{t("causeBody")}</p>
                {(["event","economics","entry"] as const).map(key=><div className={styles.assessment} key={key}>
                  <div><h4>{t(key)}</h4><span data-assessment-state={selected[key].status}>{t("unknown")}</span></div>
                  <p>{lang==="zh"?selected[key].summary_zh:selected[key].summary}</p>
                </div>)}
              </section>
              {cautionRows}
              <h3 className={styles.next}>{t("next")}</h3>
              <div className={styles.actions} data-catalyst-continuations>
                {selected.links.map((link,index)=>link.href==="https://www.mastermind-x.com/baskets.html"
                  ? <Link className={styles.button} prefetch={false} href={sectorHref} key={`${link.href}:${index}`}>{t("sectorLink")}</Link>
                  : link.href==="https://www.mastermind-x.com/government_revenue.html"
                    ? <a className={styles.button} href={link.href} key={`${link.href}:${index}`} target="_blank" rel="noopener noreferrer">{t("defenseLink")}</a> : null)}
                <button className={styles.button} onClick={()=>void copy()}>{t("copy")}</button>
              </div>
              {currentCopy && <p className={styles.copyStatus} role="status">{t(currentCopy.status)}</p>}
              {currentCopy?.status==="copyFailed" && <div className={styles.manualCopy}>
                <label htmlFor="catalyst-case-link">{t("caseLink")}</label>
                <textarea id="catalyst-case-link" ref={manualLink} readOnly rows={3} value={currentCopy.url} spellCheck={false} />
                <button className={styles.button} onClick={()=>{manualLink.current?.focus();manualLink.current?.select();}}>{t("selectLink")}</button>
              </div>}
            </div>
          </section>}
        </div>
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
