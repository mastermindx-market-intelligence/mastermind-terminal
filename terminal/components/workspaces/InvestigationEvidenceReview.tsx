"use client";
import React,{useEffect,useLayoutEffect,useRef,useState} from "react";
import type {EventWorkspace,RetainedEventWorkspaceReceipt} from "@/lib/eventWorkspace";
import type {IssuerReleaseProjection} from "@/lib/investigationIssuerRelease";
import type {InvestigationEvidenceRef} from "@/lib/investigationContracts";
import type {EvidenceChange,EvidenceReview} from "@/lib/investigationEvidenceDiff";
import type {AuthLifecycleSnapshot} from "@/lib/supabase/authLifecycle";
import {useInvestigationAuthLifecycle} from "./InvestigationAuthContext";
import {presentEventWorkspace} from "@/lib/eventWorkspacePresent";
import {sourceVisibleKindLabel} from "@/lib/plainLabels";
import styles from "./InvestigationWorkspace.module.css";
import reviewStyles from "./InvestigationEvidenceReview.module.css";

const COPY={
 en:{title:"Review evidence changes",intro:"Compare this saved baseline with the current publication. Reviewing keeps your saved research unchanged.",review:"Review current evidence",loading:"Checking both evidence versions and current access…",unavailable:"The comparison is unavailable. Your saved baseline is unchanged.",scope:"The current publication covers a different event. These versions cannot be compared.",coverage:"The available evidence does not include a complete source inventory or records of removed items. Missing rows do not prove removal, and this review cannot establish that everything is unchanged.",none:"No identified changes in the observed rows.",all:"Show all observed rows",changes:"Show changes and incomplete comparisons",more:"Show more rows",advance:"Use this reviewed version in an edit",advanceHint:"You will review the edit and save a new revision. The earlier baseline stays retained.",versions:"Compared evidence versions",baseline:"Saved baseline",current:"Current publication",priorValue:"Saved value",currentValue:"Current value",change:"Difference",fact:"Financial fact",claim:"Management statement",qualifications:"Source qualifications",guidance:"Guidance",deltas:"Published comparisons",evidence:"Evidence item",present:"Observed in both versions",added:"Added in complete comparison",removed:"Confirmed removal",not_observed:"Not observed in the current read",not_previously_observed:"Not observed in the saved read",initial:"First observed version",unchanged:"Same observed content",revised:"Content revised",unknown:"Version not established",qualificationChanged:"Qualification changed",available:"Available",stale:"Out of date",denied:"Access unavailable",not_applicable:"Not applicable",excluded:"Excluded by the source",correction:"Source marks this version as corrected",unclassified:"Evidence category not classified",valueUnavailable:"Value comparison unavailable",incompatible:"Units, reporting basis or periods do not match",missing:"A value, unit, reporting basis or period is missing",unavailableLabel:"Unavailable"},
 zh:{title:"复核证据变化",intro:"比较已保存基准与当前发布版本。复核不会更改已保存研究。",review:"复核当前证据",loading:"正在核验两个证据版本及当前访问权限…",unavailable:"暂时无法比较。已保存基准保持不变。",scope:"当前发布版本属于不同事件，无法直接比较。",coverage:"此来源仅提供已观察到的证据，没有完整来源清单或删除记录。未出现的项目不代表已删除，本次复核也不能确认全部证据均未变化。",none:"已观察项目中未识别出变化。",all:"显示全部已观察项目",changes:"显示变化及未完成的比较",more:"显示更多项目",advance:"在编辑中使用此已复核版本",advanceHint:"请核对编辑并保存新修订，先前基准仍会保留。",versions:"比较的证据版本",baseline:"已保存基准",current:"当前发布版本",priorValue:"已保存数值",currentValue:"当前数值",change:"差值",fact:"财务事实",claim:"管理层陈述",qualifications:"来源限定条件",guidance:"业绩指引",deltas:"来源比较结果",evidence:"证据项目",present:"两个版本均已观察到",added:"完整比较确认新增",removed:"来源确认已删除",not_observed:"当前读取未观察到",not_previously_observed:"已保存读取未观察到",initial:"首次观察的版本",unchanged:"已观察内容相同",revised:"内容已修订",unknown:"尚无法确认版本",qualificationChanged:"限定条件已变化",available:"可用",stale:"已过期",denied:"暂无访问权限",not_applicable:"不适用",excluded:"来源已排除此项",correction:"来源标记此版本包含更正",unclassified:"证据类别未分类",valueUnavailable:"暂无法比较数值",incompatible:"单位、报告口径或期间不一致",missing:"缺少数值、单位、报告口径或期间",unavailableLabel:"不可用"},
} as const;
// Preserve numeric precision and unfamiliar units; only translate the known display unit.
const unitLabel=(unit:string,lang:"en"|"zh")=>unit==="usd_millions"?(lang==="zh"?"百万美元":"million USD"):unit;
type Result={status:"reviewed";id:string;revision:number;baseline:RetainedEventWorkspaceReceipt;current:RetainedEventWorkspaceReceipt;review:EvidenceReview;baseline_reference?:InvestigationEvidenceRef;current_reference?:InvestigationEvidenceRef;attempt:Attempt};
type Props={id:string;revision:number;lang:"en"|"zh";baseline:{workspace:EventWorkspace|IssuerReleaseProjection;receipt:RetainedEventWorkspaceReceipt;reference?:InvestigationEvidenceRef};canAdvance:boolean;onSelect:(receipt:RetainedEventWorkspaceReceipt,reference?:InvestigationEvidenceRef)=>void};
// Local stale-preview fence only. The original owner getter is the decision
// truth; server auth stays the sole access authority and this binds identity,
// never permission, admission, Saved operations, or any retry.
type Attempt={controller:AbortController;getSnapshot:()=>AuthLifecycleSnapshot|null;principal:string;epoch:string;binding:string};
type ReadySnapshot=AuthLifecycleSnapshot&{readonly principal_partition:string};
const isReady=(snapshot:AuthLifecycleSnapshot|null):snapshot is ReadySnapshot=>!!snapshot&&snapshot.availability==="ready"&&typeof snapshot.principal_partition==="string"&&snapshot.principal_partition.length>0&&typeof snapshot.auth_epoch==="string"&&snapshot.auth_epoch.length>0;
const sameLifetime=(a:Attempt,snapshot:AuthLifecycleSnapshot|null)=>!!snapshot&&snapshot.availability==="ready"&&snapshot.principal_partition===a.principal&&snapshot.auth_epoch===a.epoch;
const baselineBinding=(id:string,revision:number,baseline:Props["baseline"])=>JSON.stringify([id,revision,baseline.receipt.fingerprint,baseline.workspace.schema,baseline.reference?[baseline.reference.owner,baseline.reference.object_type,baseline.reference.object_id,baseline.reference.mode,baseline.reference.version_ref,baseline.reference.fingerprint,baseline.reference.selection?.field]:null]);
// Keep incomplete observations in the default view. A missing/denied row needs
// attention even when the owner cannot establish a content change or removal.
const needsAttention=(row:EvidenceChange)=>row.membership!=="present"||row.version!=="unchanged"||row.qualification!=="unchanged"||row.availability!=="available"||row.excluded||row.correction||(row.interpretation.comparable?row.interpretation.delta!==0:row.interpretation.reason!=="not_applicable");

export default function InvestigationEvidenceReview({id,revision,lang,baseline,canAdvance,onSelect}:Props){
 const c=COPY[lang],request=useRef<AbortController|null>(null);
 const [result,setResult]=useState<Result|null>(null),[state,setState]=useState<"idle"|"loading"|"ready"|"unavailable"|"scope">("idle");
 const [showAll,setShowAll]=useState(false),[limit,setLimit]=useState(25);
 // Observe only the existing owner projection; no new client, subscription,
 // registry or store is created. The projection ref tracks the latest
 // published getter identity, never the projection object identity.
 const auth=useInvestigationAuthLifecycle();
 const projected=useRef(auth);
 const latest=useRef({id,revision,baseline});
 const attempt=useRef<Attempt|null>(null);
 useEffect(()=>()=>{request.current?.abort();request.current=null;attempt.current=null;},[]);
 const isCurrent=(a:Attempt)=>a.binding===baselineBinding(latest.current.id,latest.current.revision,latest.current.baseline);
 // Cleanup and subscription replacement are fenced by the original captured
 // getter/lifetime; a newly published context object with the same getter is
 // not invalidation, and the rendered snapshot alone never authorises work.
 const freshOk=(a:Attempt)=>projected.current?.getSnapshot===a.getSnapshot&&sameLifetime(a,a.getSnapshot());
 function invalidate(a:Attempt){
  if(attempt.current!==a)return;
  a.controller.abort();attempt.current=null;
  if(request.current===a.controller)request.current=null;
  setResult(null);setState("unavailable");
 }
 function validAttempt(a:Attempt){
  if(attempt.current!==a||request.current!==a.controller||a.controller.signal.aborted)return false;
  if(!isCurrent(a)||!freshOk(a)){invalidate(a);return false;}
  return true;
 }
 // A committed change can discard an attempt, but can never start a request.
 // Read the synchronous owner so a lagging projection alone does not revoke
 // a genuinely unchanged ready lifetime. Once discarded it stays discarded.
 useLayoutEffect(()=>{
  projected.current=auth;latest.current={id,revision,baseline};
  const a=attempt.current;if(a)validAttempt(a);
 });
 async function review(){
  // Explicit GET only after a fresh synchronous read; no fabricated ready
  // fallback and no automatic fetch/retry when readiness later returns.
  request.current?.abort();request.current=null;attempt.current=null;setResult(null);
  const getter=projected.current?.getSnapshot,snapshot=getter?getter():null;
  if(!getter||!isReady(snapshot)){setResult(null);setState("unavailable");return;}
  const controller=new AbortController();request.current=controller;
  const a:Attempt={controller,getSnapshot:getter,principal:snapshot.principal_partition,epoch:snapshot.auth_epoch,binding:baselineBinding(latest.current.id,latest.current.revision,latest.current.baseline)};
  attempt.current=a;setState("loading");setResult(null);setLimit(25);
  try{
   const response=await fetch(`/api/investigations/review?${new URLSearchParams({id:latest.current.id,revision:String(latest.current.revision)})}`,{cache:"no-store",signal:controller.signal});
   if(!validAttempt(a))return;
   const data=await response.json();
   if(!validAttempt(a))return;
   if(data.status==="scope_changed"){setState("scope");return;}
   const identity=latest.current;
   if(!response.ok||data.status!=="reviewed"||data.id!==identity.id||data.revision!==identity.revision||data.baseline?.fingerprint!==identity.baseline.receipt.fingerprint||data.review?.schema!=="investigation.evidence_review.v1"||!Array.isArray(data.review.items))throw Error("unavailable");
   if(identity.baseline.workspace.schema==="earnings.issuer_release_projection.v1"&&(!identity.baseline.reference||data.baseline_reference?.fingerprint!==identity.baseline.reference.fingerprint||data.current_reference?.selection?.field!=="issuer_release"))throw Error("unavailable");
   setResult({...data,attempt:a});setState("ready");
  }catch{if(validAttempt(a)){setResult(null);setState("unavailable");}}
 }
 function advance(){
  const a=attempt.current,identity=latest.current;
  // The click fresh-reads again and revalidates the captured binding plus the
  // latest canAdvance/record identity before onSelect; rejection is terminal
  // for this result and only a fresh explicit review continues.
  if(!result||!a||result.attempt!==a||!canAdvance)return;
  if(!validAttempt(a))return;
  if(result.id!==identity.id||result.revision!==identity.revision||result.baseline.fingerprint!==identity.baseline.receipt.fingerprint){invalidate(a);return;}
  if(result.current_reference)onSelect(result.current,result.current_reference);
  else onSelect(result.current);
 }
 const presented=baseline.workspace.schema==="event_workspace.v1"?presentEventWorkspace(baseline.workspace,{zh:lang==="zh"}):null;
 const labels=new Map([...(presented?.facts??[]),...(presented?.reported??[]),...(presented?.watch??[]),...(presented?.completeness??[])].map(item=>[item.id,item.label]));
 function label(row:EvidenceChange){
  if(row.id.startsWith("source:"))return sourceVisibleKindLabel(row.id.split(":")[1],lang);
  if(row.id.startsWith("fact:"))return labels.get(row.id.slice(5))??c.fact;
  if(row.id.startsWith("claim:"))return labels.get(row.id.slice(6))??c.claim;
  if(row.id.startsWith("coverage:"))return labels.get(row.id)??labels.get(row.id.slice(9))??c.unclassified;
  return row.id==="owner:qualification"?c.qualifications:row.id==="owner:guidance"?c.guidance:row.id==="owner:deltas"?c.deltas:c.evidence;
 }
 const rows=result?.review.items.filter(row=>showAll||needsAttention(row))??[];
 const a=result?.attempt;
 // Hide a stale comparison and its action once an invalid binding is observed
 // in the new projection; the getter, not this snapshot, gates decisions.
 const live=!!result&&!!a&&!!auth&&auth.getSnapshot===a.getSnapshot&&a.binding===baselineBinding(id,revision,baseline)&&auth.snapshot.availability==="ready"&&auth.snapshot.principal_partition===a.principal&&auth.snapshot.auth_epoch===a.epoch&&result.attempt===a;
 return <section className={styles.card} aria-label={c.title}>
  <h3>{c.title}</h3><p>{c.intro}</p><button disabled={state==="loading"} onClick={()=>void review()}>{c.review}</button>
  {state==="loading"&&<p role="status">{c.loading}</p>}{state==="unavailable"&&<p role="status">{c.unavailable}</p>}{state==="scope"&&<p role="status">{c.scope}</p>}
  {live&&<><p role="status" className={styles.notice}>{c.coverage}</p>
   <button aria-pressed={showAll} onClick={()=>{setShowAll(!showAll);setLimit(25);}}>{showAll?c.changes:c.all}</button>
   {!rows.length&&<p>{c.none}</p>}
   <ul className={reviewStyles.rows}>{rows.slice(0,limit).map(row=>{
    const fact=row.id.startsWith("fact:")&&baseline.workspace.schema==="event_workspace.v1"?baseline.workspace.facts.find(value=>value.fact_id===row.id.slice(5)):undefined;
    return <li key={row.id}><h4>{label(row)}</h4><div className={reviewStyles.chips}><span>{c[row.membership]}</span><span>{c[row.version]}</span><span>{row.availability==="unavailable"?c.unavailableLabel:c[row.availability]}</span>{row.qualification==="changed"&&<span>{c.qualificationChanged}</span>}{row.excluded&&<span>{c.excluded}</span>}{row.correction&&<span>{c.correction}</span>}</div>
     {!row.interpretation.comparable&&row.interpretation.reason!=="not_applicable"&&<p>{row.interpretation.reason==="incompatible"?c.incompatible:row.interpretation.reason==="missing"?c.missing:c.valueUnavailable}</p>}
     {row.interpretation.comparable&&fact?.unit&&<dl className={styles.context}><div><dt>{c.priorValue}</dt><dd>{row.interpretation.prior} {unitLabel(fact.unit,lang)}</dd></div><div><dt>{c.currentValue}</dt><dd>{row.interpretation.current} {unitLabel(fact.unit,lang)}</dd></div><div><dt>{c.change}</dt><dd>{row.interpretation.delta} {unitLabel(fact.unit,lang)}</dd></div></dl>}
    </li>;
   })}</ul>{rows.length>limit&&<button onClick={()=>setLimit(limit+25)}>{c.more}</button>}
   <details><summary>{c.versions}</summary><dl className={styles.context}><div><dt>{c.baseline}</dt><dd className={styles.identifier}>{result.baseline.generation_id}</dd></div><div><dt>{c.current}</dt><dd className={styles.identifier}>{result.current.generation_id}</dd></div></dl></details>
   {result.current.fingerprint!==baseline.receipt.fingerprint&&<><button disabled={!canAdvance} onClick={advance}>{c.advance}</button><p>{c.advanceHint}</p></>}
  </>}
 </section>;
}
