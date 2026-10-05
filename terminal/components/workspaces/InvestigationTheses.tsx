"use client";
import {useEffect,useRef,useState} from "react";
import type {InvestigationThesisRef} from "@/lib/investigationContracts";
import {isInvestigationId} from "@/lib/investigations";
import type {ThesisSummary,ThesisVersion} from "@/lib/theses";
import styles from "./InvestigationWorkspace.module.css";
const COPY={
 en:{title:"Retained Theses",intro:"Retain a specific version from your Theses. Save research to commit the selection.",browse:"Browse my Theses",open:"Open retained Theses",loading:"Loading…",unavailable:"These exact Thesis versions are unavailable. Current beliefs have not replaced them.",empty:"No Thesis versions retained.",inventoryEmpty:"No personal Theses found.",version:"Version",role:"Role",primary:"Primary",alternative:"Alternative",context:"Context",select:"Retain selected version",remove:"Remove reference",truncated:"Only the most recent results are shown.",limit:"Up to 16 distinct versions can be retained.",statement:"Belief",catalysts:"Catalysts",falsifiers:"Falsifiers",risks:"Risks",recorded:"Version recorded",active:"Active",archived:"Archived",invalidated:"Invalidated",none:"None recorded",retained:"Retained version"},
 zh:{title:"保留论点",intro:"从个人论点中选择确切版本，保存研究后生效。",browse:"浏览个人论点",open:"打开保留论点",loading:"加载中…",unavailable:"这些确切论点版本暂不可用，未替换为当前观点。",empty:"未保留论点版本。",inventoryEmpty:"未找到个人论点。",version:"版本",role:"角色",primary:"主要",alternative:"替代",context:"背景",select:"保留所选版本",remove:"移除引用",truncated:"仅显示最近结果。",limit:"最多保留 16 个不同版本。",statement:"观点",catalysts:"催化因素",falsifiers:"证伪条件",risks:"风险",recorded:"版本记录时间",active:"有效",archived:"已归档",invalidated:"已失效",none:"未记录",retained:"保留版本"},
} as const;
type Lang="en"|"zh";
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
// The server owns full canonical validation; the view still fences tuple identity
// and every field it renders so an incomplete response cannot masquerade as proof.
function visibleVersion(v:unknown,thesisId:string,versionId?:string):v is ThesisVersion{
 if(!object(v)||!isInvestigationId(v.id)||v.thesisId!==thesisId||(versionId&&v.id!==versionId)||!Number.isSafeInteger(v.version)||Number(v.version)<1||!["active","archived","invalidated"].includes(String(v.lifecycleState))||typeof v.systemRecordedAt!=="string"||!Number.isFinite(Date.parse(v.systemRecordedAt))||!object(v.content)||!object(v.subject)||typeof v.subject.display!=="string")return false;
 const content=v.content;
 return typeof content.title==="string"&&typeof content.statement==="string"&&["catalysts","falsifiers","risks"].every(key=>Array.isArray(content[key])&&(content[key] as unknown[]).every(item=>typeof item==="string"));
}
function VersionContent({version,lang}:{version:ThesisVersion;lang:Lang}){
 const c=COPY[lang];
 return <><h4>{version.content.title}</h4><p>{version.subject.display} · {c.version} {version.version} · {c[version.lifecycleState]}</p><p className={styles.question}>{version.content.statement}</p><dl className={styles.context}>{(["catalysts","falsifiers","risks"] as const).map(key=><div key={key}><dt>{c[key]}</dt><dd>{version.content[key].length?<ul>{version.content[key].map((text,i)=><li key={i}>{text}</li>)}</ul>:c.none}</dd></div>)}<div><dt>{c.recorded}</dt><dd><time dateTime={version.systemRecordedAt}>{new Date(version.systemRecordedAt).toLocaleString(lang==="zh"?"zh-CN":"en-US")}</time></dd></div></dl></>;
}
function useReadScope(){
 const scope=useRef<AbortController|null>(null),seq=useRef(0);
 useEffect(()=>{const controller=new AbortController();scope.current=controller;return()=>{controller.abort();++seq.current;};},[]);
 return {scope,seq};
}
export function InvestigationThesisPicker({refs,lang,disabled,onChange}:{refs:InvestigationThesisRef[];lang:Lang;disabled:boolean;onChange:(refs:InvestigationThesisRef[])=>void}){
 const c=COPY[lang],{scope,seq}=useReadScope(),locked=useRef(disabled);locked.current=disabled;
 const [items,setItems]=useState<ThesisSummary[]|null>(null),[versions,setVersions]=useState<ThesisVersion[]>([]),[selected,setSelected]=useState(""),[role,setRole]=useState<InvestigationThesisRef["role"]>("primary"),[busy,setBusy]=useState(false),[error,setError]=useState(false),[truncated,setTruncated]=useState(false);
 async function load(id?:string){
  if(locked.current||scope.current?.signal.aborted)return;
  const ticket=++seq.current,controller=scope.current;setBusy(true);setError(false);setVersions([]);setSelected("");setTruncated(false);
  try{
   const response=await fetch(id?`/api/theses?id=${encodeURIComponent(id)}`:"/api/theses",{cache:"no-store",signal:controller?.signal});const value:unknown=await response.json();
   if(ticket!==seq.current||controller?.signal.aborted)return;
   if(!response.ok||!object(value))throw Error("unavailable");
   if(id){
    const thesis=value.thesis;
    if(!object(thesis)||thesis.id!==id||!visibleVersion(thesis.current,id))throw Error("unavailable");
    const current=thesis.current;
    if(!Array.isArray(thesis.history)||!thesis.history.length||thesis.history.length>500||!thesis.history.every(v=>visibleVersion(v,id))||!thesis.history.some(v=>v.id===current.id))throw Error("unavailable");
    setVersions(thesis.history);setSelected(thesis.current.id);setTruncated(thesis.historyTruncated===true);
   }else{
    if(!Array.isArray(value.theses)||value.theses.length>200||!value.theses.every(t=>object(t)&&isInvestigationId(t.id)&&typeof t.title==="string"&&Number.isSafeInteger(t.currentVersion)&&Number(t.currentVersion)>0))throw Error("unavailable");
    setItems(value.theses as ThesisSummary[]);setTruncated(value.truncated===true);
   }
  }catch{if(ticket===seq.current&&!controller?.signal.aborted){setItems(null);setVersions([]);setError(true);}}
  finally{if(ticket===seq.current&&!controller?.signal.aborted)setBusy(false);}
 }
 const version=versions.find(v=>v.id===selected),duplicate=!!version&&refs.some(r=>r.thesis_id===version.thesisId&&r.version_id===version.id);
 return <section className={styles.card} aria-label={c.title}><h3>{c.title}</h3><p>{c.intro}</p><p>{c.limit}</p>
  {!refs.length?<p>{c.empty}</p>:<ul>{refs.map(ref=><li key={`${ref.thesis_id}:${ref.version_id}`}><span>{c[ref.role]} · {versions.find(v=>v.id===ref.version_id&&v.thesisId===ref.thesis_id)?.content.title??c.retained}</span> <button type="button" disabled={disabled} onClick={()=>{if(!locked.current)onChange(refs.filter(r=>r!==ref));}}>{c.remove}</button></li>)}</ul>}
  <button type="button" disabled={disabled||busy} onClick={()=>void load()}>{c.browse}</button>
  {busy&&<p role="status">{c.loading}</p>}{error&&<p role="status">{c.unavailable}</p>}{truncated&&<p>{c.truncated}</p>}
  {items&&<div className={styles.actions}>{!items.length?<p>{c.inventoryEmpty}</p>:items.map(item=><button key={item.id} type="button" disabled={disabled||busy} onClick={()=>void load(item.id)}>{item.title} · {c.version} {item.currentVersion}</button>)}</div>}
  {!!versions.length&&<><label>{c.version}<select value={selected} disabled={disabled} onChange={e=>setSelected(e.target.value)}>{versions.map(v=><option key={v.id} value={v.id}>{c.version} {v.version} · {c[v.lifecycleState]}</option>)}</select></label><label>{c.role}<select value={role} disabled={disabled} onChange={e=>setRole(e.target.value as InvestigationThesisRef["role"])}>{(["primary","alternative","context"] as const).map(r=><option key={r} value={r}>{c[r]}</option>)}</select></label>{version&&<VersionContent version={version} lang={lang}/>}<button type="button" disabled={disabled||!version||duplicate||refs.length>=16} onClick={()=>{if(!locked.current&&version&&!duplicate&&refs.length<16)onChange([...refs,{thesis_id:version.thesisId,version_id:version.id,role}]);}}>{c.select}</button></>}
 </section>;
}
type Resolved={ref:InvestigationThesisRef;status:"available";version:ThesisVersion}|{ref:InvestigationThesisRef;status:"unavailable"};
export function InvestigationThesisReader({id,revision,refs,lang}:{id:string;revision:number;refs:InvestigationThesisRef[];lang:Lang}){
 const c=COPY[lang],{scope,seq}=useReadScope();const [items,setItems]=useState<Resolved[]|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(false);
 async function open(){
  const ticket=++seq.current,controller=scope.current;setItems(null);setBusy(true);setError(false);
  try{
   const response=await fetch(`/api/investigations/theses?${new URLSearchParams({id,revision:String(revision)})}`,{cache:"no-store",signal:controller?.signal});const value:unknown=await response.json();
   if(ticket!==seq.current||controller?.signal.aborted)return;
   if(!response.ok||!object(value)||value.status!=="resolved"||value.id!==id||value.revision!==revision||!Array.isArray(value.items)||value.items.length!==refs.length||!value.items.every((item,i)=>object(item)&&object(item.ref)&&item.ref.thesis_id===refs[i].thesis_id&&item.ref.version_id===refs[i].version_id&&item.ref.role===refs[i].role&&(item.status==="unavailable"||(item.status==="available"&&visibleVersion(item.version,refs[i].thesis_id,refs[i].version_id)))))throw Error("unavailable");
   setItems(value.items as Resolved[]);
  }catch{if(ticket===seq.current&&!controller?.signal.aborted)setError(true);}
  finally{if(ticket===seq.current&&!controller?.signal.aborted)setBusy(false);}
 }
 return <section className={styles.card}><h3>{c.title}</h3>{!refs.length?<p>{c.empty}</p>:<><button type="button" disabled={busy} onClick={()=>void open()}>{c.open}</button>{busy&&<p role="status">{c.loading}</p>}{error&&<p role="status">{c.unavailable}</p>}{items?.map(item=><article key={`${item.ref.thesis_id}:${item.ref.version_id}`}><p>{c[item.ref.role]}</p>{item.status==="available"?<VersionContent version={item.version} lang={lang}/>:<p>{c.unavailable}</p>}</article>)}</>}</section>;
}
