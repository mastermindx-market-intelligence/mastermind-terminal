"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {useLang} from "@/lib/i18n";
import s from "./PortfolioBrokerage.module.css";

type Account={id:string;stage:string;synced_at:string|null;sync_error:boolean;accounts:string[]};
export default function PortfolioBrokerage({owner,onRefresh}:{owner:string;onRefresh:()=>void}){
  const {lang}=useLang(), zh=lang==="zh";
  const [rows,setRows]=useState<Account[]|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(false);
  const [confirm,setConfirm]=useState<string|null>(null);
  const controller=useRef<AbortController|null>(null),locked=useRef(false);
  const load=useCallback(async(signal:AbortSignal)=>{
    const res=await fetch("/api/portfolio/brokerage",{cache:"no-store",signal});
    if(!res.ok) throw new Error("Account read unavailable");
    const data=await res.json();
    if(signal.aborted) return;
    if(data.enabled && data.owner===owner && Array.isArray(data.connections)) setRows(data.connections);
    else setRows(null);
  },[owner]);
  const act=useCallback(async(action:string,id?:string)=>{
    const scope=controller.current;
    if(!scope || scope.signal.aborted || locked.current) return;
    locked.current=true;setBusy(true);setError(false);
    try{
      const res=await fetch("/api/portfolio/brokerage",{method:"POST",headers:{"Content-Type":"application/json"},cache:"no-store",
        body:JSON.stringify({action,id,expectedOwnerId:owner}),signal:scope.signal});
      if(!res.ok) throw new Error("Account action unconfirmed");
      const data=await res.json();
      if(scope.signal.aborted) return;
      if(action==="start"){
        const url=new URL(data.url);
        if(url.origin!=="https://secure.plaid.com") throw new Error("Invalid link");
        window.location.assign(url.href);
      }else{
        await load(scope.signal);
        if(!scope.signal.aborted){setConfirm(null);onRefresh();}
      }
    }catch{if(!scope.signal.aborted)setError(true);}
    finally{locked.current=false;if(!scope.signal.aborted)setBusy(false);}
  },[load,owner,onRefresh]);
  // The return token is only a local connection id; provider results are checked on the server.
  const finish=useRef(act);useEffect(()=>{finish.current=act;},[act]);
  useEffect(()=>{
    const scope=new AbortController();controller.current=scope;
    void load(scope.signal).then(()=>{
      if(scope.signal.aborted)return;
      const url=new URL(window.location.href),id=url.searchParams.get("brokerage_return");
      if(id && /^[a-f0-9-]{36}$/i.test(id)){
        url.searchParams.delete("brokerage_return");window.history.replaceState(window.history.state,"",url);
        void finish.current("finish",id);
      }
    }).catch(()=>{if(!scope.signal.aborted)setError(true);});
    return ()=>scope.abort();
  },[load]);
  if(rows===null && !error)return null;
  return <section className={s.panel} aria-label={zh?"投资账户":"Investment accounts"}>
    <header><div><h2>{zh?"投资账户":"Investment accounts"}</h2><p>{zh?"只读同步 · 每日更新持仓":"Read-only connection · holdings refresh daily"}</p></div>
      {rows!==null && <button className="pf-btn primary" type="button" disabled={busy} onClick={()=>void act("start")}>{zh?"连接账户":"Connect account"}</button>}</header>
    {error && <p role="alert">{zh?"账户操作未确认。请检查连接状态。":"The account action could not be confirmed. Check your connection status."}</p>}
    {rows?.map(row=><div key={row.id} className={s.account}>
      <b>{row.accounts.join(" · ") || (zh?"已连接投资账户":"Connected investment account")}</b>
      <small>{row.synced_at ? (zh?"上次同步 ":"Last synced ")+new Date(row.synced_at).toLocaleString(lang==="zh"?"zh-CN":"en-US") : (zh?"等待首次同步":"Awaiting first sync")}{row.sync_error ? (zh?" · 更新失败":" · refresh failed") : ""}</small>
      {row.stage==="connected" && <div><button type="button" className="pf-btn" disabled={busy} onClick={()=>void act("sync",row.id)}>{zh?"刷新持仓":"Refresh holdings"}</button>
      <button type="button" className="pf-btn" disabled={busy} onClick={()=>confirm===row.id?void act("disconnect",row.id):setConfirm(row.id)}>{confirm===row.id?(zh?"确认断开":"Confirm disconnect"):(zh?"断开":"Disconnect")}</button>
      {confirm===row.id && <button type="button" className="pf-btn" onClick={()=>setConfirm(null)}>{zh?"取消":"Cancel"}</button>}</div>}
    </div>)}
  </section>;
}
