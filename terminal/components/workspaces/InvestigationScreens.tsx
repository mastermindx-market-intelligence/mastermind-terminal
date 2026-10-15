"use client";
import {useEffect,useLayoutEffect,useRef,useState,type ReactNode} from "react";
import type {InvestigationEvidenceRef} from "@/lib/investigationContracts";
import {isScreenEvidenceReference,parseRetainedInvestigationScreen,SCREEN_EVIDENCE_OWNER,type ScreenCapture} from "@/lib/investigationScreen";
import {MAX_SCREENS,parseScreenRecord,type ScreenRecord} from "@/lib/smartScreen/record";
import {groupParts,isGroup,type ScreenNode} from "@/lib/smartScreen/predicate";
import {useSmartScreenT} from "@/lib/smartScreenLex";
import {MARKET_TKEY} from "@/lib/markets";
import styles from "./InvestigationWorkspace.module.css";
const COPY={
 en:{title:"Retained screens",intro:"Choose one saved definition to retain with this research. Only Save research commits it; matching rows and review history are not retained.",browse:"Browse my screens",loading:"Loading…",unavailable:"Saved screens are unavailable. Your selection is unchanged.",empty:"No readable saved screens found.",choose:"Retain this definition",clear:"Clear selection",selected:"Selected screen",revision:"Version",remove:"Remove reference",missing:"This exact screen definition is unavailable. A current screen has not replaced it.",none:"No screen definitions retained.",newer:"Some saved screens cannot be interpreted by this version and cannot be selected.",scope:"Market scope",asset:"Asset type",unpriced:"Include unpriced",all:"All of",any:"Any of",definition:"Conditions",time:"Screen last saved",kept:"Retained screen",fingerprint:"Retained content fingerprint",version:"Retained version"},
 zh:{title:"保留筛选",intro:"选择一个已保存的定义，随本研究保留。只有“保存研究”才会提交；匹配结果和复核历史不会保留。",browse:"浏览个人筛选",loading:"加载中…",unavailable:"已保存筛选暂不可用，所选内容保持不变。",empty:"未找到可读取的已保存筛选。",choose:"保留此定义",clear:"清除所选内容",selected:"所选筛选",revision:"版本",remove:"移除引用",missing:"此确切筛选定义暂不可用，未替换为当前筛选。",none:"未保留筛选定义。",newer:"部分已保存筛选无法由此版本解释，不能选择。",scope:"市场范围",asset:"资产类型",unpriced:"包含无价格标的",all:"全部满足",any:"任一满足",definition:"条件",time:"筛选上次保存时间",kept:"保留的筛选",fingerprint:"保留内容指纹",version:"保留版本"},
} as const;
type Lang="en"|"zh";
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
/** A tree display of the native grammar, never a second predicate evaluator or filter-bar conversion. */
function ScreenContent({screen,lang}:{screen:ScreenRecord;lang:Lang}){
 const c=COPY[lang],t=useSmartScreenT();
 const value=(f:string,v:unknown):string=>Array.isArray(v)?v.join(", "):typeof v==="boolean"?t(v?"ssYes":"ssNo"):typeof v==="number"&&(f==="dv"||f==="mcap")?`$${v.toLocaleString("en-US")}`:typeof v==="number"&&["chg","offHi","offLo"].includes(f)?`${v}%`:String(v);
 const tree=(node:ScreenNode,path:string):ReactNode=>{
  if(isGroup(node)){const[kind,items]=groupParts(node);return <li key={path}>{c[kind]}{items.length?<ul>{items.map((item,i)=>tree(item,`${path}.${i}`))}</ul>:<span> — {t("ssNoConditions")}</span>}</li>;}
  return <li key={path}>{t(`ssF_${node.f}`)} {node.op==="gte"?"≥":node.op==="lte"?"≤":t(`ssOp_${node.op}`)}{node.op!=="present"?` ${value(node.f,node.v)}`:""}</li>;
 };
 return <><h4>{screen.name}</h4><p>{c.revision} {screen.rev}</p><dl className={styles.context}><div><dt>{c.scope}</dt><dd>{screen.def.scope.markets==="all"?t("ssScopeAll"):screen.def.scope.markets.map(m=>t(MARKET_TKEY[m])).join(", ")}</dd></div>{screen.def.scope.asset&&<div><dt>{c.asset}</dt><dd>{screen.def.scope.asset}</dd></div>}<div><dt>{c.unpriced}</dt><dd>{t(screen.def.scope.unpriced?"ssYes":"ssNo")}</dd></div><div><dt>{c.time}</dt><dd><time dateTime={screen.updatedAt}>{screen.updatedAt}</time></dd></div></dl><p>{c.definition}</p><ul className={`${styles.question} ${styles.screenTree}`}>{tree(screen.def.where,"root")}</ul></>;
}
/** Read-only view uses only the already authenticated exact Investigation response. No head lookup. */
export function InvestigationScreenReader({refs,lookups,lang}:{refs:InvestigationEvidenceRef[];lookups:unknown;lang:Lang}){
 const c=COPY[lang],screenRefs=refs.filter(r=>r.owner===SCREEN_EVIDENCE_OWNER);
 if(!screenRefs.length)return null;
 return <section className={styles.card} aria-label={c.title}><h3>{c.title}</h3>{!screenRefs.length?<p>{c.none}</p>:screenRefs.map((ref,i)=>{
  const candidates=Array.isArray(lookups)?lookups.filter(raw=>object(raw)&&raw.object_id===ref.object_id&&raw.version_ref===ref.version_ref):[];
  const screen=isScreenEvidenceReference(ref)&&candidates.length===1?parseRetainedInvestigationScreen(candidates[0],ref):null;
  return <article key={`${ref.object_id}:${ref.version_ref}:${i}`} data-investigation-screen={screen?"available":"unavailable"}>{screen?<ScreenContent screen={screen} lang={lang}/>:<p role="status">{c.missing}</p>}<details><summary>{c.kept}</summary><p className={styles.identifier}>{ref.object_id}</p><p>{c.version}</p><p className={styles.identifier}>{ref.version_ref}</p><p>{c.fingerprint}</p><p className={styles.identifier}>{ref.fingerprint}</p></details></article>;
 })}</section>;
}
/** Browse is an existing owner GET. Selecting changes this draft only; the parent's Save owns capture. */
export function InvestigationScreenPicker({refs,capture,lang,disabled,read,onChange,onRemove}:{refs:InvestigationEvidenceRef[];capture:ScreenCapture|null;lang:Lang;disabled:boolean;read:()=>Promise<unknown>;onChange:(capture:ScreenCapture|null)=>void;onRemove:(ref:InvestigationEvidenceRef)=>void}){
 const c=COPY[lang],locked=useRef(disabled),scope=useRef(0);
 useLayoutEffect(()=>{locked.current=disabled;},[disabled]);
 const [items,setItems]=useState<ScreenRecord[]|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(false),[unreadable,setUnreadable]=useState(false);
 useEffect(()=>()=>{++scope.current;},[]);
 async function browse(){
  if(locked.current)return;
  const ticket=++scope.current;setBusy(true);setError(false);setItems(null);
  try{
   const raw=await read();if(ticket!==scope.current)return;
   if(!object(raw)||!Array.isArray(raw.screens)||raw.screens.length>MAX_SCREENS||!Array.isArray(raw.readOnly)||!Number.isSafeInteger(raw.invalid)||Number(raw.invalid)<0)throw Error("unavailable");
   const parsed=raw.screens.map(s=>parseScreenRecord(s)),valid=parsed.flatMap(p=>p.kind==="ok"?[p.record]:[]);
   if(new Set(valid.map(s=>s.id)).size!==valid.length)throw Error("duplicate");
   setItems(valid);setUnreadable(valid.length!==parsed.length||raw.readOnly.length>0||Number(raw.invalid)>0);
  }catch{if(ticket===scope.current){setError(true);setItems(null);}}
  finally{if(ticket===scope.current)setBusy(false);}
 }
 const selected=capture&&items?.find(s=>s.id===capture.screen_id&&s.rev===capture.expected_revision);
 return <section className={styles.card} aria-label={c.title}><h3>{c.title}</h3><p>{c.intro}</p>
  {refs.filter(r=>r.owner===SCREEN_EVIDENCE_OWNER).map((ref,i)=><p key={`${ref.object_id}:${ref.version_ref}:${i}`} className={styles.identifier}>{c.kept} · {ref.object_id} · {ref.version_ref} <button type="button" disabled={disabled} onClick={()=>{if(!locked.current)onRemove(ref);}}>{c.remove}</button></p>)}
  {capture&&<div data-screen-capture><p>{c.selected}: {selected?.name??capture.screen_id} · {c.revision} {capture.expected_revision}</p><button type="button" disabled={disabled} onClick={()=>{if(!locked.current)onChange(null);}}>{c.clear}</button></div>}
  <button type="button" disabled={disabled||busy} onClick={()=>void browse()}>{c.browse}</button>{busy&&<p role="status">{c.loading}</p>}{error&&<p role="status">{c.unavailable}</p>}{unreadable&&<p>{c.newer}</p>}
  {items&&!items.length&&<p>{c.empty}</p>}{items?.map(screen=><article key={screen.id}><ScreenContent screen={screen} lang={lang}/><button type="button" disabled={disabled||refs.length>=128||refs.some(r=>r.owner===SCREEN_EVIDENCE_OWNER&&r.object_id===screen.id)} onClick={()=>{if(!locked.current)onChange({screen_id:screen.id,expected_revision:screen.rev});}}>{c.choose}</button></article>)}
 </section>;
}
