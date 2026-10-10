"use client";
import React,{useEffect,useRef,useState} from "react";
import type {IssuerReleaseReplayResult} from "@/lib/investigationIssuerRelease";
import type {EventWorkspaceReplayResult} from "@/lib/eventWorkspace";
import {presentEventWorkspace,type EventWorkspacePresented} from "@/lib/eventWorkspacePresent";
import styles from "./InvestigationWorkspace.module.css";

const COPY={
 en:{title:"Inspect a retained snapshot",intro:"Open a platform snapshot at a cutoff, within the history retained through this saved baseline. This does not establish what was publicly known or what you had seen at that time.",cutoff:"Snapshot cutoff (UTC)",open:"Open retained snapshot",loading:"Checking retained history and current access…",unavailable:"The retained history is unavailable. Current evidence has not replaced it.",none:"No retained snapshot is available at this cutoff.",denied:"Current access does not allow this snapshot to be displayed.",invalid:"Enter a valid timestamp including its timezone, for example 2026-08-01T00:00:00Z.",facts:"Snapshot facts",empty:"No reported facts are available in this snapshot.",emitted:"Snapshot emitted",observed:"Recorded by platform",release:"Source release time",details:"Exact snapshot details",unchanged:"Inspection leaves your saved baseline unchanged.",generation:"Selected generation",fingerprint:"Content fingerprint",selectedRelease:"Selected issuer release",releaseOnly:"Only the authorized release reference is shown. Other source documents and financial facts are outside this selection.",document:"Release document"},
 zh:{title:"查看保留快照",intro:"按截止时间打开平台快照，范围限于此已保存基准所保留的历史。这不能证明当时公众已知的内容或你当时已看过的内容。",cutoff:"快照截止时间（UTC）",open:"打开保留快照",loading:"正在核验保留历史及当前访问权限…",unavailable:"保留历史暂不可用，未使用当前证据替代。",none:"此截止时间没有可用的保留快照。",denied:"当前权限不允许显示此快照。",invalid:"请输入包含时区的有效时间，例如 2026-08-01T00:00:00Z。",facts:"快照事实",empty:"此快照暂无已报告事实。",emitted:"快照生成时间",observed:"平台记录时间",release:"来源发布时间",details:"确切快照详情",unchanged:"查看不会更改已保存基准。",generation:"所选版本",fingerprint:"内容指纹",selectedRelease:"所选发行人公告",releaseOnly:"仅显示已授权公告的引用。其他来源文件与财务事实不在本次选择范围内。",document:"公告文件"},
} as const;
type Success=Extract<EventWorkspaceReplayResult|IssuerReleaseReplayResult,{ok:true}>;
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
export default function InvestigationReplay({id,revision,fingerprint,generation,initialCutoff,lang,selection}:{id:string;revision:number;fingerprint:string;generation:string;initialCutoff:string;lang:"en"|"zh";selection?:"issuer_release"}){
 const c=COPY[lang],[cutoff,setCutoff]=useState(initialCutoff),[pending,setPending]=useState(false),[error,setError]=useState<"unavailable"|"none"|"denied"|"invalid"|null>(null),[result,setResult]=useState<{value:Success;presented:EventWorkspacePresented|null}|null>(null);
 const controller=useRef<AbortController|null>(null),sequence=useRef(0);
 useEffect(()=>()=>{++sequence.current;controller.current?.abort();},[id,revision,fingerprint,generation]);
 function change(value:string){++sequence.current;controller.current?.abort();setCutoff(value);setResult(null);setError(null);setPending(false);}
 async function inspect(){
  const ticket=++sequence.current;controller.current?.abort();const abort=new AbortController();controller.current=abort;setResult(null);setError(null);setPending(true);
  try{
   const response=await fetch(`/api/investigations/replay?${new URLSearchParams({id,revision:String(revision),policy:"platform_snapshot",cutoff})}`,{cache:"no-store",signal:abort.signal});
   const value:unknown=await response.json();if(abort.signal.aborted||ticket!==sequence.current)return;
   if(!response.ok){const reason=object(value)?value.reason:null;setError(reason==="no_retained_snapshot_at_cutoff"?"none":reason==="denied"?"denied":reason==="invalid_reference"?"invalid":"unavailable");return;}
   if(!object(value)||value.status!=="replayed"||value.ok!==true||value.id!==id||value.revision!==revision||value.root_fingerprint!==fingerprint||!object(value.replay)||!object(value.receipt)||!object(value.workspace)||value.replay.schema!=="earnings.platform_snapshot_replay.v1"||value.replay.policy!=="platform_snapshot"||value.replay.cutoff!==cutoff||value.replay.root_generation_id!==generation||value.replay.scope!=="retained_chain_through_saved_baseline"||value.replay.public_known_replay!==false||value.replay.user_seen_replay!==false||value.replay.selected_generation_id!==value.receipt.generation_id||value.workspace.generation_id!==value.receipt.generation_id)throw Error("Invalid snapshot");
   if(selection==="issuer_release"&&(value.workspace.schema!=="earnings.issuer_release_projection.v1"||!object(value.selection_receipt)||!object(value.reference)||value.selection_receipt.fingerprint!==value.reference.fingerprint))throw Error("Invalid selection");
   if(selection!=="issuer_release"&&value.workspace.schema!=="event_workspace.v1")throw Error("Invalid workspace");
   const selected=value as unknown as Success;setResult({value:selected,presented:selected.workspace.schema==="event_workspace.v1"?presentEventWorkspace(selected.workspace,{zh:lang==="zh"}):null});
  }catch{if(!abort.signal.aborted&&ticket===sequence.current)setError("unavailable");}
  finally{if(!abort.signal.aborted&&ticket===sequence.current)setPending(false);}
 }
 return <section className={styles.card} aria-label={c.title}>
  <h3>{c.title}</h3><p>{c.intro}</p>
  <label>{c.cutoff}<input value={cutoff} onChange={event=>change(event.target.value)} maxLength={64} spellCheck={false}/></label>
  <button type="button" disabled={pending||!cutoff} onClick={()=>void inspect()}>{pending?c.loading:c.open}</button>
  <p>{c.unchanged}</p>{error&&<p role="status" className={styles.notice}>{c[error]}</p>}
  {result&&<div aria-live="polite">
   {result.presented?<><h4>{c.facts}</h4><p>{result.presented.display_name} · {result.presented.period_label}</p>
   <dl className={styles.context}>{[...result.presented.reported,...result.presented.facts].filter((item,index,all)=>all.findIndex(other=>other.id===item.id)===index).map(item=><div key={item.id}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>
   {!result.presented.reported.length&&!result.presented.facts.length&&<p>{c.empty}</p>}</>:result.value.workspace.schema==="earnings.issuer_release_projection.v1"?<><h4>{c.selectedRelease}</h4><p>{result.value.workspace.issuer.display_name}</p><p>{c.releaseOnly}</p><dl className={styles.context}><div><dt>{c.document}</dt><dd className={styles.identifier}>{result.value.workspace.selected_release.document_id}</dd></div></dl></>:null}
   <dl className={styles.clocks}>{[[c.emitted,result.value.receipt.generation_emitted_at],[c.observed,result.value.receipt.platform_known_at],[c.release,result.value.receipt.public_known_at]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value??"—"}</dd></div>)}</dl>
   <details><summary>{c.details}</summary><p className={styles.identifier}>{c.generation}: {result.value.receipt.generation_id}</p><p className={styles.identifier}>{c.fingerprint}: {"reference" in result.value?result.value.reference.fingerprint:result.value.receipt.fingerprint}</p></details>
  </div>}
 </section>;
}
