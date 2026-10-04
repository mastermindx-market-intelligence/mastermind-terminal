"use client";
import { useEffect, useRef, useState } from "react";
import { useLang } from "@/lib/i18n";
import { isInvestigationId } from "@/lib/investigations";
import { migrateLegacy } from "@/lib/workspaceMigrate";

/** Read-only entry to the EXISTING layout host. No layout save or Brain command is emitted. */
export default function RetainedInvestigationLayout({search,owner,onOpen}:{search:string;owner:string;onOpen:(config:unknown,name:string)=>void}) {
 const {lang}=useLang();const zh=lang==="zh";
 const openRef=useRef(onOpen);useEffect(()=>{openRef.current=onOpen;},[onOpen]);
 const [state,setState]=useState<"none"|"loading"|"opened"|"unavailable">("none"),[dismissed,setDismissed]=useState(false);
 useEffect(()=>{
  const q=new URLSearchParams(search),id=q.get("investigation"),revision=q.get("revision"),layout=q.get("layout_revision");
  if(!id&&!revision&&!layout){setState("none");return;}
  setDismissed(false);
  if(!isInvestigationId(id)||!isInvestigationId(layout)||!revision||!/^[1-9][0-9]{0,9}$/.test(revision)||Number(revision)>2147483647
    ||["investigation","revision","layout_revision"].some(key=>q.getAll(key).length!==1)){setState("unavailable");return;}
  const controller=new AbortController();setState("loading");
  void fetch(`/api/investigations?${new URLSearchParams({id,revision})}`,{cache:"no-store",signal:controller.signal}).then(async response=>{
   if(!response.ok)throw Error("unavailable");const value=await response.json();
   if(controller.signal.aborted)return;
   const ref=value?.manifest?.layout_refs?.find((r:{layout_revision_id:string})=>r.layout_revision_id===layout);
   const retained=value?.layouts?.find((r:{id:string})=>r.id===layout);
   if(value.status!=="found"||value.id!==id||value.revision!==Number(revision)||!ref||!retained||ref.digest!==retained.digest||ref.layout_id!==retained.layout_id||!migrateLegacy(retained.config,false).ok)throw Error("unavailable");
   openRef.current(retained.config,String(retained.name??"Retained layout"));setState("opened");
  }).catch(()=>{if(!controller.signal.aborted)setState("unavailable");});
  return()=>controller.abort();
 },[search,owner]);
 if(state==="none"||dismissed)return null;
 return <aside data-testid="retained-layout-read" style={{position:"fixed",zIndex:80,top:112,right:12,width:"min(400px, calc(100vw - 24px))",padding:14,border:"1px solid var(--line)",borderRadius:10,background:"var(--panel)",boxShadow:"0 8px 28px #0005",fontSize:13}}>
  <p role="status" style={{margin:"0 0 10px"}}>{state==="loading"?(zh?"正在打开保留布局…":"Opening retained layout…"):state==="opened"?(zh?"已打开保留布局。当前已命名布局保持不变；保存将创建副本。":"Retained layout opened. The current named layout is unchanged; saving creates a copy."):(zh?"保留布局暂不可用，未加载当前版本替代。":"The retained layout is unavailable. No current layout was substituted.")}</p>
  <button type="button" style={{minHeight:44,padding:"8px 12px"}} onClick={()=>setDismissed(true)}>{zh?"关闭":"Dismiss"}</button>
 </aside>;
}
