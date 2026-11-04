"use client";
import dynamic from "next/dynamic";
import { useLayoutEffect } from "react";
import { flowInvalidate } from "@/lib/flowClientCache";
import Link from "next/link";
import { useLang, type Lang } from "@/lib/i18n";
import { useReadingScope } from "@/lib/shared-shell/useReadingScope";
import IntelligenceNav from "./IntelligenceNav";
import s from "./Intelligence.module.css";
const Prophet = dynamic(()=>import("@/components/prophet/ProphetLanesView").then(m=>m.ProphetLanesView));
const Sectors = dynamic(()=>import("@/components/sector-intelligence/SectorIntelligenceWorkspace"));
/** Preserve the existing English/Chinese auth copy without changing the shared i18n evidence lock. */
function pick(lang: Lang, en: string, zh: string): string {
 return lang === "zh" ? zh : en;
}
/** New entrance, incumbent implementation. The existing identity scope gates its entire lifetime. */
export default function IntelligenceToolWorkspace({ownerKey,kind}:{ownerKey:string;kind:"prophet"|"sectors"}) {
 return <Session key={`${ownerKey}:${kind}`} ownerKey={ownerKey} kind={kind} />;
}
function Session({ownerKey,kind}:{ownerKey:string;kind:"prophet"|"sectors"}) {
 const {lang} = useLang(), zh = lang === "zh";
 const {ready,ended,unavailable,retryIdentity} = useReadingScope(ownerKey);
 // Reuse the incumbent display-cache invalidation before child passive reads.
 // An old account's module cache must not seed a newly verified tool lifetime.
 useLayoutEffect(()=>{
  if (kind !== "prophet" || !ready) return;
  flowInvalidate();
  return ()=>flowInvalidate();
 },[kind,ready]);
 const title = kind === "prophet" ? "Prophet" : zh ? "行业情报" : "Sector Intelligence";
 const identityMessage = ended
  ? pick(lang, "Your account changed or your session ended. Private readings have been cleared.", "账户已更改或会话已结束。私人读数已清除。")
  : unavailable
    ? pick(lang, "Account verification is unavailable. Private readings are hidden.", "账户核验暂不可用。私人读数已隐藏。")
    : pick(lang, "Verifying your account…", "正在核验账户…");
 return <div className={`main2 ${s.workspace}`} data-intelligence-tool={kind}>
  <header className={s.workspaceHeader}><h1>{title}</h1><IntelligenceNav /></header>
  {!ready ? <main id="shared-shell-content" tabIndex={-1} className={s.root}>
   <div role="status" className={s.notice}><p>{identityMessage}</p>
    {(ended || unavailable) && <div className={s.footer}>
     {ended && <Link className={s.action} href={`/login?next=%2F${kind}`}>{pick(lang, "Sign in", "登录")}</Link>}
     <button className={s.action} onClick={retryIdentity}>{pick(lang, "Recheck account", "重新核验账户")}</button>
    </div>}
   </div>
  </main> : kind === "prophet" ? <main id="shared-shell-content" tabIndex={-1} className={s.workspaceBody}><Prophet /></main>
   : <div className={s.workspaceBody}><Sectors /></div>}
 </div>;
}
