"use client";
import { useCallback, useEffect, useState } from "react";
import { useShellIdentity } from "@/components/chrome/AppShell";
import { useLang } from "@/lib/i18n";
import { decodeCatalystView, type CatalystView } from "@/lib/catalystOpportunity";
import { CatalystOpportunityView, type CatalystLoadError } from "./CatalystOpportunityView";
import DefenseContextWorkspace from "./DefenseContextWorkspace";

type Result = {identity:ReturnType<typeof useShellIdentity>; revision:number; view:CatalystView|null; error:CatalystLoadError};

/** Account-bound read of the existing BFF. No browser storage or shared data cache. */
export default function CatalystOpportunityWorkspace() {
  const identity = useShellIdentity(), {lang} = useLang();
  const [revision,setRevision] = useState(0), [result,setResult] = useState<Result|null>(null);
  // Hide prior-account data in render, before an effect has a chance to run.
  const current = result?.identity === identity && result.revision === revision ? result : null;
  // Either endpoint consumes the same server-owned site-full entitlement. A denial
  // is sticky only for this account/read generation; late successes cannot undo it.
  const [denial,setDenial] = useState<{identity:typeof identity;revision:number;error:"auth"|"access"}|null>(null);
  const accessError = denial?.identity===identity && denial.revision===revision ? denial.error : null;
  const onDefenseAccessDenied = useCallback((error:"auth"|"access")=>setDenial({identity,revision,error}),[identity,revision]);
  useEffect(()=>{
    const controller = new AbortController();let active = true;
    const timer = setTimeout(()=>controller.abort(),10000);
    void (async()=>{
      let view:CatalystView|null = null, error:CatalystLoadError = null;
      try {
        const response = await fetch("/api/catalyst-opportunities",{
          credentials:"same-origin",cache:"no-store",signal:controller.signal,
        });
        if (response.status===401) error="auth";
        else if (response.status===403) error="access";
        else if (response.status===200 || response.status===503) {
          view = decodeCatalystView(await response.json());
          if ((response.status===503)!==(view.status==="unavailable")) throw new Error("status mismatch");
          if (view.status==="unavailable") error="unavailable";
        } else error="unavailable";
      } catch {error="unavailable";view=null;}
      finally {clearTimeout(timer);}
      if (active) setResult({identity,revision,view,error});
    })();
    return ()=>{active=false;clearTimeout(timer);controller.abort();};
  },[identity,revision]);
  useEffect(()=>{
    // This is an on-screen current read, not a server-side alert or worker loop.
    const refresh = () => {if (document.visibilityState==="visible") setRevision(v=>v+1);};
    const timer = setInterval(refresh,60000);
    document.addEventListener("visibilitychange",refresh);
    return ()=>{clearInterval(timer);document.removeEventListener("visibilitychange",refresh);};
  },[]);
  return <CatalystOpportunityView view={accessError?null:current?.view || null} error={accessError || current?.error || null}
    lang={lang} loading={!accessError && current===null} onRefresh={()=>setRevision(v=>v+1)}
    defensePanel={<DefenseContextWorkspace revision={revision} lang={lang} blocked={accessError || current?.error || null} onAccessDenied={onDefenseAccessDenied} onRefresh={()=>setRevision(v=>v+1)} />} />;
}
