"use client";
import { useEffect, useState } from "react";
import { useShellIdentity } from "@/components/chrome/AppShell";
import { decodeDefenseContext, type DefenseContext } from "@/lib/catalystDefense";
import { DefenseResearchPanel } from "./DefenseResearchPanel";
import type { CatalystLoadError } from "./CatalystOpportunityView";

type Result = { identity: ReturnType<typeof useShellIdentity>; revision: number; view: DefenseContext|null; error: CatalystLoadError };
/** Independent data lane, sharing the parent refresh and the existing account identity. */
export default function DefenseContextWorkspace({revision,lang,blocked,onRefresh,onAccessDenied}:{revision:number;lang:"en"|"zh";blocked:CatalystLoadError;onRefresh:()=>void;onAccessDenied:(error:"auth"|"access")=>void}) {
  const identity=useShellIdentity();
  const [result,setResult]=useState<Result|null>(null);
  const current=result?.identity===identity && result.revision===revision ? result : null;
  const denied=blocked==="auth" || blocked==="access";
  useEffect(()=>{
    if (denied) return;
    const controller=new AbortController(); let active=true;
    const timer=setTimeout(()=>controller.abort(),10000);
    void (async()=>{
      let view:DefenseContext|null=null, error:CatalystLoadError=null;
      try {
        const response=await fetch("/api/catalyst-opportunities/defense",{credentials:"same-origin",cache:"no-store",signal:controller.signal});
        if (response.status===401) error="auth";
        else if (response.status===403) error="access";
        else if (response.status===200) view=decodeDefenseContext(await response.json());
        else error="unavailable";
      } catch { error="unavailable"; }
      finally { clearTimeout(timer); }
      if (active) {
        setResult({identity,revision,view,error});
        if (error==="auth" || error==="access") onAccessDenied(error);
      }
    })();
    return ()=>{ active=false;clearTimeout(timer);controller.abort(); };
  },[identity,revision,denied,onAccessDenied]);
  // Rendering never exposes a previous account or refresh generation, even before effects run.
  return <DefenseResearchPanel view={denied?null:current?.view || null} lang={lang}
    loading={!denied && current===null} error={denied?blocked:current?.error || null} onRefresh={onRefresh} />;
}
