"use client";
import React,{useEffect,useRef,useState} from "react";
import type {EventWorkspace,RetainedEventWorkspaceReceipt} from "@/lib/eventWorkspace";
import type {IssuerReleaseProjection} from "@/lib/investigationIssuerRelease";
import type {InvestigationEvidenceRef} from "@/lib/investigationContracts";
import type {EvidenceChange,EvidenceReview} from "@/lib/investigationEvidenceDiff";
import {presentEventWorkspace} from "@/lib/eventWorkspacePresent";
import {sourceVisibleKindLabel} from "@/lib/plainLabels";
import styles from "./InvestigationWorkspace.module.css";
import reviewStyles from "./InvestigationEvidenceReview.module.css";

const COPY={
 en:{title:"Review evidence changes",intro:"Compare this saved baseline with the current publication. Reviewing keeps your saved research unchanged.",review:"Review current evidence",loading:"Checking both evidence versions and current access…",unavailable:"The comparison is unavailable. Your saved baseline is unchanged.",scope:"The current publication covers a different event. These versions cannot be compared.",coverage:"The available evidence does not include a complete source inventory or records of removed items. Missing rows do not prove removal, and this review cannot establish that everything is unchanged.",none:"No identified changes in the observed rows.",all:"Show all observed rows",changes:"Show changes and incomplete comparisons",more:"Show more rows",advance:"Use this reviewed version in an edit",advanceHint:"You will review the edit and save a new revision. The earlier baseline stays retained.",versions:"Compared evidence versions",baseline:"Saved baseline",current:"Current publication",priorValue:"Saved value",currentValue:"Current value",change:"Difference",fact:"Financial fact",claim:"Management statement",qualifications:"Source qualifications",guidance:"Guidance",deltas:"Published comparisons",evidence:"Evidence item",present:"Observed in both versions",added:"Added in complete comparison",removed:"Confirmed removal",not_observed:"Not observed in the current read",not_previously_observed:"Not observed in the saved read",initial:"First observed version",unchanged:"Same observed content",revised:"Content revised",unknown:"Version not established",qualificationChanged:"Qualification changed",available:"Available",stale:"Out of date",denied:"Access unavailable",not_applicable:"Not applicable",excluded:"Excluded by the source",correction:"Source marks this version as corrected",unclassified:"Evidence category not classified",valueUnavailable:"Value comparison unavailable",incompatible:"Units, reporting basis or periods do not match",missing:"A value, unit, reporting basis or period is missing",unavailableLabel:"Unavailable"},
 zh:{title:"复核证据变化",intro:"比较已保存基准与当前发布版本。复核不会更改已保存研究。",review:"复核当前证据",loading:"正在核验两个证据版本及当前访问权限…",unavailable:"暂时无法比较。已保存基准保持不变。",scope:"当前发布版本属于不同事件，无法直接比较。",coverage:"此来源仅提供已观察到的证据，没有完整来源清单或删除记录。未出现的项目不代表已删除，本次复核也不能确认全部证据均未变化。",none:"已观察项目中未识别出变化。",all:"显示全部已观察项目",changes:"显示变化及未完成的比较",more:"显示更多项目",advance:"在编辑中使用此已复核版本",advanceHint:"请核对编辑并保存新修订，先前基准仍会保留。",versions:"比较的证据版本",baseline:"已保存基准",current:"当前发布版本",priorValue:"已保存数值",currentValue:"当前数值",change:"差值",fact:"财务事实",claim:"管理层陈述",qualifications:"来源限定条件",guidance:"业绩指引",deltas:"来源比较结果",evidence:"证据项目",present:"两个版本均已观察到",added:"完整比较确认新增",removed:"来源确认已删除",not_observed:"当前读取未观察到",not_previously_observed:"已保存读取未观察到",initial:"首次观察的版本",unchanged:"已观察内容相同",revised:"内容已修订",unknown:"尚无法确认版本",qualificationChanged:"限定条件已变化",available:"可用",stale:"已过期",denied:"暂无访问权限",not_applicable:"不适用",excluded:"来源已排除此项",correction:"来源标记此版本包含更正",unclassified:"证据类别未分类",valueUnavailable:"暂无法比较数值",incompatible:"单位、报告口径或期间不一致",missing:"缺少数值、单位、报告口径或期间",unavailableLabel:"不可用"},
} as const;
type Result={status:"reviewed";id:string;revision:number;baseline:RetainedEventWorkspaceReceipt;current:RetainedEventWorkspaceReceipt;review:EvidenceReview;baseline_reference?:InvestigationEvidenceRef;current_reference?:InvestigationEvidenceRef};
type Props={id:string;revision:number;lang:"en"|"zh";baseline:{workspace:EventWorkspace|IssuerReleaseProjection;receipt:RetainedEventWorkspaceReceipt;reference?:InvestigationEvidenceRef};canAdvance:boolean;onSelect:(receipt:RetainedEventWorkspaceReceipt,reference?:InvestigationEvidenceRef)=>void};
// Keep incomplete observations in the default view. A missing/denied row needs
// attention even when the owner cannot establish a content change or removal.
const needsAttention=(row:EvidenceChange)=>row.membership!=="present"||row.version!=="unchanged"||row.qualification!=="unchanged"||row.availability!=="available"||row.excluded||row.correction||(row.interpretation.comparable?row.interpretation.delta!==0:row.interpretation.reason!=="not_applicable");

export default function InvestigationEvidenceReview({id,revision,lang,baseline,canAdvance,onSelect}:Props){
 const c=COPY[lang],request=useRef<AbortController|null>(null);
 const [result,setResult]=useState<Result|null>(null),[state,setState]=useState<"idle"|"loading"|"ready"|"unavailable"|"scope">("idle");
 const [showAll,setShowAll]=useState(false),[limit,setLimit]=useState(25);
 useEffect(()=>()=>request.current?.abort(),[]);
 async function review(){
  request.current?.abort();const controller=new AbortController();request.current=controller;setState("loading");setResult(null);setLimit(25);
  try{
   const response=await fetch(`/api/investigations/review?${new URLSearchParams({id,revision:String(revision)})}`,{cache:"no-store",signal:controller.signal});
   const data=await response.json();if(controller.signal.aborted||request.current!==controller)return;
   if(data.status==="scope_changed"){setState("scope");return;}
   if(!response.ok||data.status!=="reviewed"||data.id!==id||data.revision!==revision||data.baseline?.fingerprint!==baseline.receipt.fingerprint||data.review?.schema!=="investigation.evidence_review.v1"||!Array.isArray(data.review.items))throw Error("unavailable");
   if(baseline.workspace.schema==="earnings.issuer_release_projection.v1"&&(!baseline.reference||data.baseline_reference?.fingerprint!==baseline.reference.fingerprint||data.current_reference?.selection?.field!=="issuer_release"))throw Error("unavailable");
   setResult(data);setState("ready");
  }catch{if(!controller.signal.aborted){setResult(null);setState("unavailable");}}
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
 return <section className={styles.card} aria-label={c.title}>
  <h3>{c.title}</h3><p>{c.intro}</p><button disabled={state==="loading"} onClick={()=>void review()}>{c.review}</button>
  {state==="loading"&&<p role="status">{c.loading}</p>}{state==="unavailable"&&<p role="status">{c.unavailable}</p>}{state==="scope"&&<p role="status">{c.scope}</p>}
  {result&&<><p role="status" className={styles.notice}>{c.coverage}</p>
   <button aria-pressed={showAll} onClick={()=>{setShowAll(!showAll);setLimit(25);}}>{showAll?c.changes:c.all}</button>
   {!rows.length&&<p>{c.none}</p>}
   <ul className={reviewStyles.rows}>{rows.slice(0,limit).map(row=>{
    const fact=row.id.startsWith("fact:")&&baseline.workspace.schema==="event_workspace.v1"?baseline.workspace.facts.find(value=>value.fact_id===row.id.slice(5)):undefined;
    return <li key={row.id}><h4>{label(row)}</h4><div className={reviewStyles.chips}><span>{c[row.membership]}</span><span>{c[row.version]}</span><span>{row.availability==="unavailable"?c.unavailableLabel:c[row.availability]}</span>{row.qualification==="changed"&&<span>{c.qualificationChanged}</span>}{row.excluded&&<span>{c.excluded}</span>}{row.correction&&<span>{c.correction}</span>}</div>
     {!row.interpretation.comparable&&row.interpretation.reason!=="not_applicable"&&<p>{row.interpretation.reason==="incompatible"?c.incompatible:row.interpretation.reason==="missing"?c.missing:c.valueUnavailable}</p>}
     {row.interpretation.comparable&&fact?.unit&&<dl className={styles.context}><div><dt>{c.priorValue}</dt><dd>{row.interpretation.prior} {fact.unit}</dd></div><div><dt>{c.currentValue}</dt><dd>{row.interpretation.current} {fact.unit}</dd></div><div><dt>{c.change}</dt><dd>{row.interpretation.delta} {fact.unit}</dd></div></dl>}
    </li>;
   })}</ul>{rows.length>limit&&<button onClick={()=>setLimit(limit+25)}>{c.more}</button>}
   <details><summary>{c.versions}</summary><dl className={styles.context}><div><dt>{c.baseline}</dt><dd className={styles.identifier}>{result.baseline.generation_id}</dd></div><div><dt>{c.current}</dt><dd className={styles.identifier}>{result.current.generation_id}</dd></div></dl></details>
   {result.current.fingerprint!==baseline.receipt.fingerprint&&<><button disabled={!canAdvance} onClick={()=>result.current_reference?onSelect(result.current,result.current_reference):onSelect(result.current)}>{c.advance}</button><p>{c.advanceHint}</p></>}
  </>}
 </section>;
}
