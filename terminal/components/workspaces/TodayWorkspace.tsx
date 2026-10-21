"use client";
import React from "react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useLang } from "@/lib/i18n";
import { useOnboarding } from "@/components/onboarding/OnboardingProvider";
import { localText, todayPayload, type TodayPayload } from "@/lib/shared-shell/readingPayloads";
import { loadBrowserReadingProgress, readingHref, type ReadingProgress } from "@/lib/shared-shell/readingProgress";
import { readingJson, useReadingScope } from "@/lib/shared-shell/useReadingScope";
import styles from "./ReadingWorkspace.module.css";

const COPY = {
 en:{title:"Today",intro:"A source-backed starting point for your research.",owner:"Macro Command · United States",loading:"Checking published source coverage…",unavailable:"The Macro Command reading is unavailable. This does not mean markets are quiet.",auth:"Your account changed or your session ended. Private readings have been cleared.",signIn:"Sign in",retry:"Try again",command:"Open Macro Command",overview:"Open market overview",coverage:"Source coverage",of:"of",sections:"sections have verified owner coverage",published:"Publication verification",ready:"All admitted workspace publications verified",partial:"Some workspace publications are unavailable",missing:"No workspace publications verified",asof:"Reading as of",manifest:"Publication manifest generated",noClock:"Source date unavailable",omitted:"Some owner readings are omitted. Inspect each source's coverage before drawing a conclusion.",attention:"Coverage to inspect",noAttention:"No publication failures were returned. Check each source date and availability below.",sourceState:"Source availability",effective:"Effective date",calculated:"Calculated as of",details:"All source coverage and dates",allSections:"Explore Macro Command sections",local:"Research · opened in this browser profile",continue:"Pick up where you left off",localNote:"Reading position is local to this origin and browser profile. Current access is checked on every reopen.",noLocal:"Choose a report from the Research library to start reading.",resume:"Continue the selected revision",research:"Open Research",researchScreener:"Open research screener",clocks:"Publication evidence",clockNote:"Manifest generation and publication verification do not certify the freshness of every source. Each reading keeps its own clock.",hash:"Manifest SHA-256",monitor:"Open Monitor"},
 zh:{title:"今日",intro:"以来源证据为起点，开始研究。",owner:"宏观指挥台 · 美国",loading:"正在核验已发布来源覆盖…",unavailable:"宏观指挥台读数暂不可用。这并不代表市场平静。",auth:"账户已更改或会话已结束。私人读数已清除。",signIn:"登录",retry:"重试",command:"打开宏观指挥台",overview:"打开市场概览",coverage:"来源覆盖",of:"/",sections:"个板块具有已核验来源覆盖",published:"发布核验",ready:"所有已准入工作区的发布均已核验",partial:"部分工作区发布不可用",missing:"没有工作区发布通过核验",asof:"读数截至",manifest:"发布清单生成于",noClock:"来源日期不可用",omitted:"部分来源读数未显示。请先查看各来源覆盖，再作判断。",attention:"需要查看的覆盖",noAttention:"未返回发布失败。请检查下方各来源日期与可用状态。",sourceState:"来源可用状态",effective:"生效日期",calculated:"计算截至",details:"全部来源覆盖与日期",allSections:"查看宏观指挥台板块",local:"研究 · 在此浏览器配置中打开",continue:"接续上次阅读",localNote:"阅读位置仅保留在当前来源与浏览器配置中。每次重新打开均核验当前权限。",noLocal:"从研究资料库选择报告，开始阅读。",resume:"继续所选修订",research:"打开研究",researchScreener:"打开研究筛选器",clocks:"发布证据",clockNote:"清单生成与发布核验并不证明所有来源均为最新。每项读数保留各自时间。",hash:"清单 SHA-256",monitor:"打开监控"},
} as const;
const AVAILABILITY:Record<string,readonly[string,string]> = {
 CURRENT:["Current source","当前来源"],LATE_WITHIN_TOLERANCE:["Late within tolerance","延迟仍在容忍范围"],STALE_SOURCE:["Source is behind","来源滞后"],NOT_YET_RELEASED:["Not yet released","尚未发布"],SOURCE_FAILED:["Source failed","来源失败"],RIGHTS_BLOCKED:["Source rights restricted","来源权限受限"],NOT_COVERED:["Not covered","未覆盖"],HISTORICAL_AS_KNOWN:["Historical as known","当时已知的历史数据"],COMPUTATION_REFUSED:["Computation unavailable","计算不可用"],DISAGREEMENT:["Sources disagree","来源存在分歧"],
};
export default function TodayWorkspace({ownerKey}:{ownerKey:string}) {
 const onboarding=useOnboarding();
 const {lang}=useLang(),c=COPY[lang],{scope,ready,ended,unavailable:identityUnavailable,retryIdentity}=useReadingScope(ownerKey);
 const [result,setResult]=useState<{owner:string;data:TodayPayload}|null>(null),[phase,setPhase]=useState<"loading"|"ready"|"auth"|"unavailable">("loading");
 const [progress,setProgress]=useState<ReadingProgress|null>(null);
 const loadSequence=useRef(0);
 async function load() {
  const ticket=++loadSequence.current;
  setPhase("loading");setResult(null);
  try {
   const {response,value}=await readingJson(scope,"/api/shared-shell/today"),data=todayPayload(value);
   if(ticket!==loadSequence.current)return;
   if(response.status===401){setPhase("auth");return;}
   if(!response.ok||!data)throw Error("unavailable");
   setResult({owner:ownerKey,data});setPhase("ready");
  }catch{if(!scope.current?.signal.aborted&&ticket===loadSequence.current)setPhase("unavailable");}
 }
 useEffect(()=>{
  if(!ready){++loadSequence.current;queueMicrotask(()=>{setResult(null);setProgress(null);});return;}
  const controller=scope.current;
  queueMicrotask(()=>{if(controller?.signal.aborted)return;setProgress(loadBrowserReadingProgress(ownerKey));void load();});
  // The request and displayed result are bound to the verified identity generation.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[ready,ownerKey]);
 const data=ready&&result?.owner===ownerKey?result.data:null;
 const status=(state:string|null)=>AVAILABILITY[state||""]?.[lang==="zh"?1:0] || (lang==="zh"?"来源状态不可用":"Source availability unavailable");
 const needsAttention=data?.workspaces.filter(workspace=>workspace.failure||!workspace.state||!["CURRENT","HISTORICAL_AS_KNOWN"].includes(workspace.state))??[];
 const sectionHref=(id:string)=>data?.sections.find(section=>section.id===id)?.href ?? "/macro_monetary.html";
 return <div className={styles.root}>
  <header className={styles.heading}><div><h1>{c.title}</h1><p>{c.intro}</p></div></header>
  {ended||phase==="auth"?<div role="status" className={styles.notice}>{c.auth} <button onClick={()=>onboarding.open("signin")}>{c.signIn}</button><button onClick={retryIdentity}>{lang==="zh"?"重新验证所选内容":"Recheck selected context"}</button></div>:identityUnavailable?<div role="status" className={styles.notice}><p>{lang==="zh"?"账户服务暂不可用。私人读数已隐藏。":"The account service is unavailable. Private readings are hidden."}</p><button onClick={retryIdentity}>{c.retry}</button></div>:!ready||phase==="loading"?<div role="status" className={styles.loading}>{c.loading}<div className={styles.skeleton}/><div className={styles.skeleton}/></div>:<>
   {!data?<div role="status" className={styles.notice}><h2>{c.unavailable}</h2><div className={styles.actions}><button onClick={()=>void load()}>{c.retry}</button><Link href="/macro.html">{c.overview} →</Link></div></div>:<section className={styles.hero} aria-labelledby="today-command">
    <div className={styles.eyebrow}>{c.owner}</div><h2 id="today-command">{data.read.clauses.length?data.read.clauses.map(clause=>`${localText(clause.topic,lang)} ${localText(clause.predicate,lang)}${localText(clause.punct,lang)}`).join(lang==="zh"?"":" "):c.unavailable}</h2>
    <p className={styles.coverage}>{c.published}: {data.state==="ready"?c.ready:data.state==="partial"?c.partial:c.missing}</p>
    {data.read.as_of&&<p>{c.asof}: {localText(data.read.as_of_display,lang)||data.read.as_of}<br/><small>{localText(data.read.as_of_meaning,lang)}</small></p>}
    {data.read.omitted&&<p className={styles.muted}>{c.omitted}</p>}
    <div className={styles.actions}><Link className={`${styles.action} ${styles.primary}`} href="/macro_monetary.html">{c.command} →</Link><Link href="/macro.html">{c.overview} →</Link></div>
    <div className={styles.chips}>{data.strip.filter(chip=>chip.id!=="coverage").map(chip=><div className={styles.chip} key={chip.id}><small>{localText(chip.label,lang)}</small><strong>{localText(chip.value,lang)}</strong>{chip.note&&<p>{localText(chip.note,lang)}</p>}{!chip.null&&<p>{localText(chip.as_of_display,lang)||chip.as_of||c.noClock}</p>}<Link href={sectionHref(chip.section)}>{c.command} →</Link></div>)}</div>
    <p className={styles.coverage}>{c.coverage}: {data.coverage.available} {c.of} {data.coverage.total} {c.sections}</p>
   </section>}
   <div className={styles.columns}><section aria-labelledby="today-attention"><div className={styles.heading}><h2 id="today-attention">{c.attention}</h2><Link href="/monitor">{c.monitor} →</Link></div>
    {!data?<p>{c.unavailable}</p>:needsAttention.length===0?<p className={styles.muted}>{c.noAttention}</p>:<ul className={styles.list}>{needsAttention.slice(0,4).map(workspace=><li className={styles.row} key={workspace.workspace_id}><div className={styles.eyebrow}>{c.sourceState}</div><h3>{localText(workspace.title,lang)||workspace.workspace_id}</h3><p>{status(workspace.state)}</p><small>{c.effective}: {workspace.effective_date||c.noClock}</small></li>)}</ul>}
    {data&&<details><summary>{c.details}</summary><ul className={styles.list}>{data.workspaces.map(workspace=><li className={styles.row} key={workspace.workspace_id}><h3>{localText(workspace.title,lang)||workspace.workspace_id}</h3><p>{status(workspace.state)}</p><small>{c.effective}: {workspace.effective_date||c.noClock}<br/>{c.calculated}: {workspace.calculation_as_of||c.noClock}</small></li>)}</ul></details>}
    {data&&<details><summary>{c.allSections}</summary><ul className={styles.list}>{data.sections.map(section=><li className={styles.row} key={section.id}><Link href={section.href}>{localText(section.label,lang)} →</Link></li>)}</ul></details>}
   </section><aside className={styles.side}><div className={styles.eyebrow}>{c.local}</div><h2>{c.continue}</h2><p className={styles.muted}>{c.localNote}</p>{progress?<div className={styles.panel}><h3>{progress.selection.docId}</h3><p className={styles.source}>{progress.selection.sourcePdfSha256.slice(0,16)}…</p><Link href={readingHref(progress.selection,progress.segmentStart)}>{c.resume} →</Link></div>:<p>{c.noLocal}</p>}<div className={styles.actions}><Link href="/research">{c.research} →</Link><Link href="/research_screener.html">{c.researchScreener} →</Link></div></aside></div>
   {data&&<details><summary>{c.clocks}</summary><p>{c.clockNote}</p><dl><div><dt>{c.manifest}</dt><dd>{data.source.manifest_generated_at||c.noClock}</dd></div><div><dt>{c.hash}</dt><dd className={styles.source}>{data.source.manifest_sha256}</dd></div></dl></details>}
  </>}
 </div>;
}
