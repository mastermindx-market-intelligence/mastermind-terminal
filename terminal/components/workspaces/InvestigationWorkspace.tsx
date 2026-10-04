"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useLang } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/client";
import { validateInvestigationManifest, type InvestigationManifest, type InvestigationEvidenceRef, type InvestigationThesisRef } from "@/lib/investigationContracts";
import { INVESTIGATION_ADMISSION, type InvestigationCommand, type InvestigationSummary } from "@/lib/investigations";
import { beginInvestigationSave, settleInvestigationSave, retryInvestigationSave, recoverInvestigationSave, type InvestigationSaveState } from "@/lib/investigationSave";
import type { EventWorkspace, RetainedEventWorkspaceReceipt } from "@/lib/eventWorkspace";
import styles from "./InvestigationWorkspace.module.css";
import InvestigationEvidenceReview from "./InvestigationEvidenceReview";
import InvestigationReplay from "./InvestigationReplay";
import {InvestigationThesisPicker,InvestigationThesisReader} from "./InvestigationTheses";

type Props = { ownerKey:string; initialSymbol?:string; initialInvestigationId?:string; initialRevision?:number };
type Detail = { id:string; revision:number; current_revision:number; lifecycle:"active"|"removed"; manifest:InvestigationManifest; committed_at:string; layouts:Array<{id:string;layout_id:string;digest:string;config:unknown}> };
type Baseline = {workspace:EventWorkspace;receipt:RetainedEventWorkspaceReceipt;reference:InvestigationEvidenceRef};
type Layout = {id:string;name:string;config:{schema:string;revision:number};userId?:string;mine?:boolean};
type Draft = {title:string;question:string;symbol:string;next:string;horizon:string;asOf:string;layoutId:string;theses:InvestigationThesisRef[]};
const emptyDraft=(symbol=""):Draft=>({title:"",question:"",symbol,next:"",horizon:"",asOf:"",layoutId:"",theses:[]});
const storageKey=(owner:string)=>`mm.investigation.pending.v2:${encodeURIComponent(owner)}`;
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
const clock=(v:string|null|undefined)=>v ? new Date(v).toLocaleString() : "—";
const COPY={
 en:{title:"Saved research",intro:"Continue your question with retained context.",back:"Company research",start:"Start new research",list:"Saved questions",empty:"No saved questions yet.",unavailable:"Saved research is unavailable. Your draft is unchanged.",retry:"Try again",loading:"Loading…",new:"New research",question:"Research question",name:"Title",symbol:"Security symbol",horizon:"Research horizon (optional)",asOf:"Research as-of date (optional)",next:"Next question (optional)",layout:"Retain a named layout (optional)",none:"No layout selected",baseline:"Earnings evidence",capture:"Choose current Earnings evidence",selected:"Selected generation",missing:"This exact evidence is unavailable. Current data has not replaced it.",save:"Save research",saving:"Saving…",cancel:"Cancel editing",edit:"Edit saved question",revision:"Revision",saved:"Saved",retained:"Retained context",continue:"Continue company research",openLayout:"Open retained layout",remove:"Remove from saved research",restore:"Restore saved research",removed:"Removed",all:"Active",trash:"Removed",uncertain:"The save outcome is not confirmed. Your exact draft and original request are retained.",check:"Check original outcome",retrySave:"Retry original save",checking:"Checking original outcome…",conflict:"The save was not committed. Your draft is retained. Reopen the latest revision before editing again.",storage:"This browser cannot safely retain the pending save. No new request was sent.",auth:"Your account changed or your session ended. Sign in again to open saved research.",signIn:"Sign in",clocks:"Evidence clocks",public:"Source release time",platform:"Recorded by platform",generated:"Generation emitted",seen:"Viewed in this session",rights:"Current access checked",coverage:"Evidence coverage",contextOnly:"Research context",noBaseline:"No retained Earnings evidence selected.",noLayout:"No retained layout.",readback:"Saved. Verifying the exact revision…",readbackFailed:"Saved, but exact readback is unavailable. Reopen this revision to verify it.",viewLatest:"Open latest revision",titleRequired:"Add a title and question within the displayed limits.",baselineLoading:"Checking source identity and current access…",layoutUnavailable:"Named layouts are unavailable.",invalidLink:"This saved research link is unavailable.",partial:"Coverage is shown separately for each source.",choose:"Select a saved question or start new research.",browse:"Saved research",operation:"Original save request",savedQuestion:"Saved question",viewRevision:"Open revision",previous:"Previous revision",nextRevision:"Next revision",retainedDraft:"Retained draft",reviewFailed:"The reviewed evidence could not be reopened. Your saved baseline is unchanged."},
 zh:{title:"已保存研究",intro:"结合保留的上下文，继续研究问题。",back:"公司研究",start:"开始新研究",list:"已保存的问题",empty:"暂无已保存的问题。",unavailable:"已保存研究暂不可用。草稿保持不变。",retry:"重试",loading:"加载中…",new:"新研究",question:"研究问题",name:"标题",symbol:"证券代码",horizon:"研究期限（可选）",asOf:"研究截至日期（可选）",next:"下一个问题（可选）",layout:"保留已命名布局（可选）",none:"未选择布局",baseline:"财报证据",capture:"选择当前财报证据",selected:"已选择的版本",missing:"此确切证据暂不可用，未替换为当前数据。",save:"保存研究",saving:"保存中…",cancel:"取消编辑",edit:"编辑问题",revision:"修订",saved:"已保存",retained:"保留的上下文",continue:"继续公司研究",openLayout:"打开保留布局",remove:"移出已保存研究",restore:"恢复研究",removed:"已移除",all:"有效",trash:"已移除",uncertain:"保存结果尚未确认。确切草稿和原请求已保留。",check:"检查原请求结果",retrySave:"重试原保存请求",checking:"正在检查原请求…",conflict:"保存未提交，草稿已保留。请先重新打开最新修订。",storage:"浏览器无法安全保留待确认的保存请求。未发送新请求。",auth:"账户已更改或会话已结束。请重新登录。",signIn:"登录",clocks:"证据时间",public:"来源发布时间",platform:"平台记录时间",generated:"版本生成时间",seen:"本次查看时间",rights:"当前访问检查时间",coverage:"证据覆盖",contextOnly:"研究上下文",noBaseline:"未选择保留的财报证据。",noLayout:"未保留布局。",readback:"已保存，正在核验确切修订…",readbackFailed:"已保存，但暂时无法回读。请重新打开此修订进行核验。",viewLatest:"打开最新修订",titleRequired:"请填写符合所示长度限制的标题和问题。",baselineLoading:"正在核验来源身份和当前访问权限…",layoutUnavailable:"已命名布局暂不可用。",invalidLink:"此研究链接暂不可用。",partial:"各来源的覆盖状态单独显示。",choose:"选择已保存的问题，或开始新研究。",browse:"已保存研究",operation:"原保存请求",savedQuestion:"已保存问题",viewRevision:"打开修订",previous:"上一修订",nextRevision:"下一修订",retainedDraft:"保留的草稿",reviewFailed:"暂时无法重新打开已复核证据。已保存基准保持不变。"},
} as const;
const CONTEXT_LABELS: Record<string,readonly [string,string]> = {
 security:["Security","证券"], issuer:["Issuer","发行人"], release:["Issuer release","发行人公告"],
 filing:["Regulatory filing","监管文件"], transcript:["Call transcript","电话会记录"], slides:["Presentation slides","演示文稿"],
 consensus:["Consensus estimates","市场共识"], reaction:["Market reaction","市场反应"],
 present:["Available","可用"], bound:["Source linked","已关联来源"], absent:["No source document","无来源文档"],
 unlicensed:["Not licensed","未获授权"], not_joined:["Not linked","未关联"], unavailable:["Unavailable","不可用"],
 missing:["Missing","缺失"], partial:["Partial coverage","部分覆盖"], stale:["Out of date","已过期"],
 denied:["Access denied","无访问权限"], address_only:["Address only","仅有地址"],
};
function contextLabel(value:string,lang:"en"|"zh") {
 const pair=CONTEXT_LABELS[value]??["Not classified","未分类"];
 return pair[lang==="zh"?1:0];
}

export default function InvestigationWorkspace({ownerKey,initialSymbol,initialInvestigationId,initialRevision}:Props) {
 const {lang}=useLang(), c=COPY[lang];
 const [items,setItems]=useState<InvestigationSummary[]|null>(null), [listError,setListError]=useState(false);
 const [detail,setDetail]=useState<Detail|null>(null),[detailLoading,setDetailLoading]=useState(false);
 const [editing,setEditing]=useState(false),[draft,setDraft]=useState<Draft>(emptyDraft(initialSymbol));
 const [baseline,setBaseline]=useState<Baseline|null>(null),[baselineState,setBaselineState]=useState<"none"|"loading"|"ready"|"unavailable">("none"),[seenAt,setSeenAt]=useState<string|null>(null);
 const [layouts,setLayouts]=useState<Layout[]>([]),[layoutError,setLayoutError]=useState(false);
 const [saveState,setSaveState]=useState<InvestigationSaveState>({phase:"idle"}),[message,setMessage]=useState("");
 const [storageBlocked,setStorageBlockedState]=useState(false),[authEnded,setAuthEnded]=useState(false),[filter,setFilter]=useState<"active"|"removed">("active");
 const scope=useRef<AbortController|null>(null),detailSeq=useRef(0),baselineSeq=useRef(0),stateRef=useRef<InvestigationSaveState>({phase:"idle"});
 const storageBlockedRef=useRef(false);
 const setStorageBlocked=(blocked:boolean)=>{storageBlockedRef.current=blocked;setStorageBlockedState(blocked);};
 const editLocked=()=>stateRef.current.phase==="pending"||stateRef.current.phase==="uncertain"||storageBlockedRef.current||!!scope.current?.signal.aborted;
 const detailTitle=useRef<HTMLHeadingElement>(null),draftTitle=useRef<HTMLInputElement>(null);
 useEffect(()=>{if(editing)draftTitle.current?.focus();else if(detail)detailTitle.current?.focus();},[editing,detail?.id,detail?.revision]);
 const locked=saveState.phase==="pending"||saveState.phase==="uncertain";
 const setSave=(s:InvestigationSaveState)=>{stateRef.current=s;setSaveState(s);};
 async function json(url:string,init?:RequestInit):Promise<unknown> {
  const controller=scope.current;
  if(!controller||controller.signal.aborted) throw Error("inactive");
  const response=await fetch(url,{...init,cache:"no-store",signal:controller.signal});
  const value:unknown=await response.json();
  if(controller!==scope.current||controller.signal.aborted) throw Error("inactive");
  return value;
 }
 async function inventory() {
  try {const value=await json("/api/investigations");if(!record(value)||value.status!=="listed"||!Array.isArray(value.items)) throw Error("unavailable");setItems(value.items as InvestigationSummary[]);setListError(false);}
  catch {if(!scope.current?.signal.aborted)setListError(true);}
 }
 async function resolveBaseline(url:string) {
  const ticket=++baselineSeq.current;setBaseline(null);setSeenAt(null);setBaselineState("loading");
  try {
   const value=await json(url);
   if(ticket!==baselineSeq.current)return;
   if(!record(value)||value.ok!==true||!record(value.receipt)||!record(value.reference)||!record(value.workspace))throw Error("unavailable");
   setBaseline(value as unknown as Baseline);setBaselineState("ready");setSeenAt(new Date().toISOString());
  } catch {if(ticket===baselineSeq.current&&!scope.current?.signal.aborted)setBaselineState("unavailable");}
 }
 function retainedBaseline(manifest:InvestigationManifest) {
  const ref=manifest.review_baseline_ref, issuer=manifest.intent.subjects.find(s=>s.owner==="data_os.security_master"&&s.kind==="issuer");
  if(!ref){++baselineSeq.current;setBaseline(null);setBaselineState("none");return;}
  if(ref.owner!=="earnings.workspace_generation"||!issuer||!ref.version_ref||!ref.fingerprint){setBaseline(null);setBaselineState("unavailable");return;}
  void resolveBaseline(`/api/investigations/baseline?${new URLSearchParams({event_id:ref.object_id,generation_id:ref.version_ref,company_id:issuer.object_id,fingerprint:ref.fingerprint})}`);
 }
 async function openRecord(id:string,revision?:number,afterSave=false) {
  const ticket=++detailSeq.current;++baselineSeq.current;setBaseline(null);setBaselineState("none");setDetailLoading(true);
  if(!afterSave)setMessage("");
  try {
   const value=await json(`/api/investigations?${new URLSearchParams({id,...(revision?{revision:String(revision)}:{})})}`);
   if(ticket!==detailSeq.current)return;
   if(!record(value)||value.status!=="found"||value.id!==id||(revision!==undefined&&value.revision!==revision)||!Array.isArray(value.layouts)||!validateInvestigationManifest(value.manifest,INVESTIGATION_ADMISSION).ok)throw Error("unavailable");
   const found=value as unknown as Detail;setDetail(found);setEditing(false);setMessage("");retainedBaseline(found.manifest);
   window.history.replaceState({},"",`/analysis?view=investigations&investigation=${id}&revision=${found.revision}`);
  } catch {if(ticket===detailSeq.current&&!scope.current?.signal.aborted){setMessage(afterSave?c.readbackFailed:c.invalidLink);if(!afterSave)setDetail(null);}}
  finally {if(ticket===detailSeq.current)setDetailLoading(false);}
 }
 async function settle(response:unknown) {
  const next=settleInvestigationSave(stateRef.current,ownerKey,response);setSave(next);
  if(next.phase==="committed") {
   try{sessionStorage.removeItem(storageKey(ownerKey));}catch{/* exact receipt remains authoritative */}
  }
  if(next.phase==="committed") {window.history.replaceState({},"",`/analysis?view=investigations&investigation=${next.result.id}&revision=${next.result.revision}`);setMessage(c.readback);await Promise.all([openRecord(next.result.id,next.result.revision,true),inventory()]);}
  else if(next.phase==="rejected") {
   try{sessionStorage.setItem(storageKey(ownerKey),JSON.stringify({owner:ownerKey,command:next.command,phase:"rejected",reason:next.reason}));}catch{setStorageBlocked(true);}
   setMessage(c.conflict);
  }
 }
 async function send(command:InvestigationCommand) {
  try {await settle(await json("/api/investigations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(command)}));}
  catch {if(!scope.current?.signal.aborted)await settle(null);}
 }
 async function checkOutcome() {
  const command=retryInvestigationSave(stateRef.current,ownerKey);if(!command)return;
  setMessage(c.checking);
  try {await settle(await json(`/api/investigations?operation_id=${command.operation_id}`));}catch{if(!scope.current?.signal.aborted)await settle(null);}
  if(stateRef.current.phase==="uncertain")setMessage("");
 }
 useEffect(()=>{
  const controller=new AbortController();scope.current=controller;
  setAuthEnded(false);setItems(null);setDetail(null);setBaseline(null);setSave({phase:"idle"});setStorageBlocked(false);
  void inventory();
  void json("/api/layouts").then(value=>{
   if(!record(value)||!Array.isArray(value.layouts))throw Error("unavailable");
   setLayouts((value.layouts as Layout[]).filter(l=>(l.mine===true||l.userId===ownerKey)&&l.config?.schema==="workspace_layout.v1"&&Number.isSafeInteger(l.config.revision)));
  }).catch(()=>{if(!controller.signal.aborted)setLayoutError(true);});
  let recovery=false;
  try {
   const stored=sessionStorage.getItem(storageKey(ownerKey));
   if(stored){const recovered=recoverInvestigationSave(ownerKey,JSON.parse(stored));
    if(!recovered||(recovered.phase!=="uncertain"&&recovered.phase!=="rejected"))throw Error("invalid recovery");
    const command=recovered.command;recovery=true;setSave(recovered);setEditing(true);
    setDraft({title:command.manifest.intent.title,question:command.manifest.intent.question,symbol:command.manifest.intent.subjects.find(s=>s.owner==="terminal.analysis_symbol")?.object_id??"",next:command.manifest.continuation.next_question??"",horizon:command.manifest.intent.horizon??"",asOf:command.manifest.intent.research_as_of??"",layoutId:command.layout_capture?.layout_id??"",theses:command.manifest.thesis_refs});
    retainedBaseline(command.manifest);if(recovered.phase==="uncertain")void checkOutcome();else setMessage(c.conflict);
   }
  } catch {setStorageBlocked(true);}
  if(!recovery&&initialInvestigationId)void openRecord(initialInvestigationId,initialRevision);
  let unsubscribe=()=>{};
  if(ownerKey!=="local-preview")try{
   const {data:{subscription}}=createClient().auth.onAuthStateChange((_event,session)=>{
    if(session?.user.id===ownerKey)return;
    controller.abort();++detailSeq.current;++baselineSeq.current;setAuthEnded(true);setItems(null);setDetail(null);setBaseline(null);setDraft(emptyDraft());setSave({phase:"idle"});setLayouts([]);setMessage("");
   });unsubscribe=()=>subscription.unsubscribe();
  }catch{setAuthEnded(true);controller.abort();}
  return()=>{controller.abort();++detailSeq.current;++baselineSeq.current;unsubscribe();};
  // Owner changes are remounted by the authenticated server page; every request also has a scope fence.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[ownerKey,initialInvestigationId,initialRevision]);
 function beginEdit(fresh=false) {
  // Async selection must consult current admission, never the render that
  // started its GET. The boolean return pairs baseline installation with edit.
  if(editLocked())return false;
  ++detailSeq.current;++baselineSeq.current;setMessage("");
  if(fresh){try{sessionStorage.removeItem(storageKey(ownerKey));}catch{setStorageBlocked(true);return false;}setSave({phase:"idle"});setDetail(null);setDraft(emptyDraft(initialSymbol));setBaseline(null);setBaselineState("none");window.history.replaceState({},"","/analysis?view=investigations");}
  else if(detail){const m=detail.manifest;setDraft({title:m.intent.title,question:m.intent.question,symbol:m.intent.subjects.find(s=>s.owner==="terminal.analysis_symbol")?.object_id??"",next:m.continuation.next_question??"",horizon:m.intent.horizon??"",asOf:m.intent.research_as_of??"",layoutId:"",theses:m.thesis_refs});setBaselineState(baseline?"ready":"unavailable");}
  setEditing(true);return true;
 }
 async function selectReviewedBaseline(receipt:RetainedEventWorkspaceReceipt) {
  if(!detail||editLocked()||detail.lifecycle!=="active"||detail.revision!==detail.current_revision)return;
  const ticket=++baselineSeq.current,recordTicket=detailSeq.current;setBaselineState("loading");
  try {
   const value=await json(`/api/investigations/baseline?${new URLSearchParams({event_id:receipt.event_id,generation_id:receipt.generation_id,company_id:receipt.company_id,fingerprint:receipt.fingerprint})}`);
   if(ticket!==baselineSeq.current||recordTicket!==detailSeq.current)return;
   if(!record(value)||value.ok!==true||!record(value.receipt)||value.receipt.fingerprint!==receipt.fingerprint||!record(value.reference)||!record(value.workspace))throw Error("unavailable");
   if(!beginEdit()){setBaselineState(baseline?"ready":"unavailable");return;}
   setBaseline(value as unknown as Baseline);setBaselineState("ready");setSeenAt(new Date().toISOString());
  } catch {if(ticket===baselineSeq.current&&!scope.current?.signal.aborted){setBaselineState(baseline?"ready":"unavailable");setMessage(c.reviewFailed);}}
 }
 function save(action:InvestigationCommand["action"]=detail?"revise":"create") {
  if(editLocked())return;
  if(!detail&&saveState.phase==="rejected"&&saveState.command.expected_revision>0){setMessage(c.conflict);return;}
  let manifest:InvestigationManifest;
  if((action==="remove"||action==="restore")&&detail)manifest=detail.manifest;
  else {
   const reference=baseline?.reference??detail?.manifest.review_baseline_ref;
   const subjects=detail?.manifest.intent.subjects??[...(draft.symbol?[{owner:"terminal.analysis_symbol",kind:"security",object_id:draft.symbol}]:[]),...(baseline?[{owner:"data_os.security_master",kind:"issuer",object_id:baseline.receipt.company_id}]:[])];
   manifest={schema:"investigation_manifest.v2",intent:{title:draft.title,question:draft.question,subjects,...(draft.horizon?{horizon:draft.horizon}:{}),...(draft.asOf?{research_as_of:draft.asOf}:{})},layout_refs:draft.layoutId?[]:detail?.manifest.layout_refs??[],thesis_refs:draft.theses,evidence_refs:reference?[reference]:detail?.manifest.evidence_refs??[],continuation:{...(detail?.manifest.continuation??{}),...(draft.next?{next_question:draft.next}:{})},...(reference?{review_baseline_ref:reference}:{})};
   if(!draft.next)delete manifest.continuation.next_question;
  }
  const layout=layouts.find(l=>l.id===draft.layoutId);
  const command={id:detail?.id??crypto.randomUUID(),operation_id:crypto.randomUUID(),expected_revision:detail?.revision??0,action,manifest,...(layout&&action!=="remove"&&action!=="restore"?{layout_capture:{layout_id:layout.id,expected_revision:layout.config.revision,revision_id:crypto.randomUUID()}}:{})};
  const next=beginInvestigationSave(ownerKey,command,stateRef.current);
  if(next.phase!=="pending"){setMessage(c.titleRequired);return;}
  try {sessionStorage.setItem(storageKey(ownerKey),JSON.stringify({owner:ownerKey,command:next.command}));if(!sessionStorage.getItem(storageKey(ownerKey)))throw Error("storage");}
  catch {setStorageBlocked(true);setMessage(c.storage);return;}
  // A competing mutation cancels pending evidence selection before taking the
  // synchronous operation lock. A late GET cannot change this saved baseline.
  ++baselineSeq.current;setBaselineState(baseline?"ready":baselineState==="loading"?"unavailable":baselineState);
  setSave(next);void send(next.command);
 }
 const symbol=detail?.manifest.intent.subjects.find(s=>s.owner==="terminal.analysis_symbol")?.object_id??draft.symbol;
 const visible=items?.filter(i=>i.lifecycle===filter);
 const frozen=locked||storageBlocked;
 if(authEnded)return <main className={`main2 ws-shell ${styles.root}`}><h1>{c.title}</h1><p role="status">{c.auth}</p><Link href="/login">{c.signIn}</Link></main>;
 return <main className={`main2 ws-shell ${styles.root}`}>
  <Link className={styles.back} href={`/analysis${symbol?`?symbol=${encodeURIComponent(symbol)}`:""}`}>← {c.back}</Link>
  <header className={styles.heading}><div><h1>{c.title}</h1><p>{c.intro}</p></div><button disabled={frozen} onClick={()=>beginEdit(true)}>{c.start}</button></header>
  {storageBlocked&&<p className={styles.notice} role="alert">{c.storage}</p>}
  {locked&&<section className={styles.notice} aria-label={c.operation}><p role="status">{c.uncertain}</p><div className={styles.actions}><button onClick={()=>void checkOutcome()}>{c.check}</button><button disabled={saveState.phase==="pending"} onClick={()=>{const cmd=retryInvestigationSave(stateRef.current,ownerKey);if(cmd){setSave({phase:"pending",principal:ownerKey,command:cmd});void send(cmd);}}}>{c.retrySave}</button></div></section>}
  {message&&<p role="status" className={styles.notice}>{message}</p>}
  {saveState.phase==="rejected"&&<section className={styles.notice}>{saveState.command.expected_revision>0&&<button onClick={()=>void openRecord(saveState.command.id)}>{c.viewLatest}</button>}<details><summary>{c.retainedDraft}</summary><h3>{saveState.command.manifest.intent.title}</h3><p className={styles.question}>{saveState.command.manifest.intent.question}</p><p className={styles.question}>{saveState.command.manifest.continuation.next_question}</p></details></section>}
  <div className={styles.columns}>
   <aside className={styles.library} aria-label={c.list}><h2>{c.list}</h2><div className={styles.actions}><button aria-pressed={filter==="active"} onClick={()=>setFilter("active")}>{c.all}</button><button aria-pressed={filter==="removed"} onClick={()=>setFilter("removed")}>{c.trash}</button></div>
    {listError?<p role="status">{c.unavailable} <button onClick={()=>void inventory()}>{c.retry}</button></p>:items===null?<p role="status">{c.loading}</p>:!visible?.length?<p>{c.empty}</p>:visible.map(item=><button key={item.id} disabled={locked} className={`${styles.record} ${detail?.id===item.id?styles.selected:""}`} aria-pressed={detail?.id===item.id} onClick={()=>{setEditing(false);void openRecord(item.id);}}><strong>{item.title}</strong><span>{item.question}</span><small>{c.revision} {item.revision} · {clock(item.updated_at)}</small></button>)}
   </aside>
   <section className={styles.detail} aria-label={editing?c.new:c.savedQuestion}>
    {detailLoading&&<p role="status">{c.loading}</p>}
    {editing?<form onSubmit={e=>{e.preventDefault();save();}}>
     <p className={styles.eyebrow}>{detail?c.edit:c.new}</p><h2>{c.question}</h2>
     <fieldset disabled={frozen}>
      <label>{c.name}<input ref={draftTitle} aria-label={c.name} required value={draft.title} onChange={e=>setDraft({...draft,title:e.target.value})}/><small>{Array.from(draft.title).length} / 160</small></label>
      <label>{c.question}<textarea aria-label={c.question} required rows={5} value={draft.question} onChange={e=>setDraft({...draft,question:e.target.value})}/><small>{Array.from(draft.question).length} / 4000</small></label>
      <label>{c.symbol}<input value={draft.symbol} disabled={!!detail} onChange={e=>{++baselineSeq.current;setDraft({...draft,symbol:e.target.value.toUpperCase()});setBaseline(null);setBaselineState("none");}} autoCapitalize="characters"/></label>
      <div className={styles.pair}><label>{c.horizon}<input value={draft.horizon} onChange={e=>setDraft({...draft,horizon:e.target.value})}/></label><label>{c.asOf}<input type="date" value={draft.asOf} onChange={e=>setDraft({...draft,asOf:e.target.value})}/></label></div>
      <label>{c.next}<textarea aria-label={c.next} rows={3} value={draft.next} onChange={e=>setDraft({...draft,next:e.target.value})}/><small>{Array.from(draft.next).length} / 4000</small></label>
      <label>{c.layout}<select value={draft.layoutId} onChange={e=>setDraft({...draft,layoutId:e.target.value})}><option value="">{c.none}</option>{layouts.map(l=><option key={l.id} value={l.id}>{l.name} · {c.revision} {l.config.revision}</option>)}</select></label>{layoutError&&<p role="status">{c.layoutUnavailable}</p>}
      <InvestigationThesisPicker key={`thesis-edit:${ownerKey}:${detail?.id??"new"}:${detail?.revision??0}`} refs={draft.theses} lang={lang} disabled={frozen} onChange={theses=>{if(!editLocked())setDraft(current=>({...current,theses}));}}/>
      {!detail&&<button type="button" disabled={!draft.symbol||baselineState==="loading"} onClick={()=>void resolveBaseline(`/api/investigations/baseline?symbol=${encodeURIComponent(draft.symbol)}`)}>{c.capture}</button>}
      <div className={styles.actions}><button className={styles.primary} type="submit" disabled={baselineState==="loading"}>{saveState.phase==="pending"?c.saving:c.save}</button><button type="button" onClick={()=>{setEditing(false);if(detail)retainedBaseline(detail.manifest);}}>{c.cancel}</button></div>
     </fieldset>
    </form>:detail?<>
     <p className={styles.eyebrow}>{c.saved} · {c.revision} {detail.revision}{detail.lifecycle==="removed"?` · ${c.removed}`:""}</p><h2 ref={detailTitle} tabIndex={-1}>{detail.manifest.intent.title}</h2><p className={styles.question}>{detail.manifest.intent.question}</p>
     <dl className={styles.context}>{detail.manifest.intent.subjects.map((s,i)=><div key={i}><dt>{contextLabel(s.kind,lang)}</dt><dd>{s.object_id}</dd></div>)}{detail.manifest.intent.horizon&&<div><dt>{c.horizon}</dt><dd>{detail.manifest.intent.horizon}</dd></div>}{detail.manifest.intent.research_as_of&&<div><dt>{c.asOf}</dt><dd>{detail.manifest.intent.research_as_of}</dd></div>}</dl>
     <div className={styles.actions}><button disabled={frozen||detail.lifecycle==="removed"} onClick={()=>beginEdit()}>{c.edit}</button>{detail.revision!==detail.current_revision&&<button disabled={locked} onClick={()=>void openRecord(detail.id)}>{c.viewLatest}</button>}{detail.revision>1&&<button disabled={locked} onClick={()=>void openRecord(detail.id,detail.revision-1)}>{c.previous}</button>}{detail.revision<detail.current_revision&&<button disabled={locked} onClick={()=>void openRecord(detail.id,detail.revision+1)}>{c.nextRevision}</button>}</div>
     <section className={styles.card}><h3>{c.retained}</h3>{detail.manifest.layout_refs.length?detail.manifest.layout_refs.map(ref=><p key={ref.layout_revision_id}><Link href={`/terminal?investigation=${detail.id}&revision=${detail.revision}&layout_revision=${ref.layout_revision_id}`}>{c.openLayout} →</Link></p>):<p>{c.noLayout}</p>}{symbol&&<Link href={`/analysis?symbol=${encodeURIComponent(symbol)}`}>{c.continue} →</Link>}</section>
     <InvestigationThesisReader key={`thesis-read:${ownerKey}:${detail.id}:${detail.revision}`} id={detail.id} revision={detail.revision} refs={detail.manifest.thesis_refs} lang={lang}/>
     {detail.manifest.continuation.next_question&&<section className={styles.card}><h3>{c.next}</h3><p className={styles.question}>{detail.manifest.continuation.next_question}</p></section>}
     {baseline&&<InvestigationEvidenceReview key={`${ownerKey}:${detail.id}:${detail.revision}`} id={detail.id} revision={detail.revision} lang={lang} baseline={baseline} canAdvance={!frozen&&baselineState==="ready"&&detail.revision===detail.current_revision&&detail.lifecycle==="active"} onSelect={receipt=>void selectReviewedBaseline(receipt)}/>}
     {baseline&&baselineState==="ready"&&<InvestigationReplay key={`replay:${ownerKey}:${detail.id}:${detail.revision}:${baseline.receipt.fingerprint}`} id={detail.id} revision={detail.revision} lang={lang} fingerprint={baseline.receipt.fingerprint} generation={baseline.receipt.generation_id} initialCutoff={baseline.receipt.generation_emitted_at??detail.committed_at}/>}
     <div className={styles.actions}><button disabled={frozen||detail.revision!==detail.current_revision} onClick={()=>save(detail.lifecycle==="removed"?"restore":"remove")}>{detail.lifecycle==="removed"?c.restore:c.remove}</button></div>
    </>:<p>{c.choose}</p>}
   </section>
   <aside className={styles.evidence} aria-label={c.baseline}><section className={styles.card}><h2>{c.baseline}</h2><p className={styles.eyebrow}>{c.contextOnly}</p>{baselineState==="loading"?<p role="status">{c.baselineLoading}</p>:baselineState==="unavailable"?<p role="status">{c.missing}</p>:!baseline?<p>{c.noBaseline}</p>:<><h3>{baseline.workspace.issuer.display_name}</h3><p className={styles.identifier}>{baseline.receipt.event_id}</p><details><summary>{c.selected}</summary><p className={styles.identifier}>{baseline.receipt.generation_id}</p><p className={styles.identifier}>{baseline.receipt.fingerprint}</p></details><h3>{c.coverage}</h3><p>{c.partial}</p><dl className={styles.context}>{Object.entries(baseline.workspace.completeness).map(([key,value])=><div key={key}><dt>{contextLabel(key,lang)}</dt><dd>{contextLabel(value.status,lang)}</dd></div>)}</dl></>}</section>
    {baseline&&<section className={styles.card}><h2>{c.clocks}</h2><dl className={styles.clocks}>{[[c.public,baseline.receipt.public_known_at],[c.platform,baseline.receipt.platform_known_at],[c.generated,baseline.receipt.generation_emitted_at],[c.seen,seenAt],[c.rights,baseline.receipt.rights.checked_at]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{clock(value)}</dd></div>)}</dl></section>}
   </aside>
  </div>
 </main>;
}
