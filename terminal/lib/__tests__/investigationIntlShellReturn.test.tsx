// @vitest-environment jsdom
import React,{act} from "react";
import {createRoot} from "react-dom/client";
import {afterEach,expect,it,vi} from "vitest";
import InvestigationWorkspace from "@/components/workspaces/InvestigationWorkspace";
import {SharedShellPresentation} from "@/components/chrome/shared-shell/SharedShellPresentation";
import {accountIdentity} from "../accountIdentity";
vi.mock("@/lib/i18n",()=>({useLang:()=>({lang:"en",setLang:vi.fn()})}));
// Isolate the preference transport, not the real presentation owner/context.
vi.mock("@/lib/useMarketPrefs",()=>({useAccountPrefs:()=>({metaPrefs:{}})}));
vi.mock("@/lib/supabase/investigationAuthOwner",()=>({subscribeInvestigationAuthOwner:()=>({getSnapshot:()=>({availability:"ready",principal_partition:"90000000-0000-4000-8000-000000000009",auth_epoch:"synthetic-return-epoch"}),unsubscribe:vi.fn()})}));
vi.mock("next/link",()=>({default:({children,href}:React.PropsWithChildren<{href:string}>)=><a href={href}>{children}</a>}));
afterEach(()=>{vi.unstubAllGlobals();document.documentElement.removeAttribute("data-theme");document.documentElement.removeAttribute("data-lang");document.documentElement.removeAttribute("data-mmx-shared-shell");sessionStorage.clear();});
for(const market of ["JP",""])it.each([false,true])(`real presentation owner enabled=%s retains native Intl return (market=${market})`,async enabled=>{
 (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
 const match=()=>({matches:true,addEventListener:vi.fn(),removeEventListener:vi.fn()});vi.stubGlobal("matchMedia",match);
 const requests:Array<{url:string;method:string}>=[];vi.stubGlobal("fetch",vi.fn(async(input,init)=>{const url=String(input),method=init?.method??"GET";requests.push({url,method});expect(method).toBe("GET");const value=url.startsWith("/api/investigations")?{status:"listed",items:[]}:url==="/api/layouts"?{layouts:[]}:url==="/api/alerts"?{alerts:[]}:url==="/api/alerts/receipts"?{outbox:[]}:null;if(value===null)throw Error("Unexpected source-only request "+url);return new Response(JSON.stringify(value),{headers:{"content-type":"application/json"}});}));
 const back=`https://www.mastermind-x.com/intl.html?view=risk&market=${market}&pins=${market?"JP,TW":""}&horizon=3m&basis=local&return_basis=price&group=`,host=document.createElement("div");document.body.append(host);const root=createRoot(host);
 try{
  await act(async()=>root.render(<SharedShellPresentation enabled={enabled} identity={accountIdentity()}><InvestigationWorkspace ownerKey="90000000-0000-4000-8000-000000000009" intlReturnTo={back}/></SharedShellPresentation>));
  const link=[...host.querySelectorAll("a")].find(a=>a.textContent==="Return to International Markets");expect(link).toBeDefined();expect(link!.getAttribute("href")).toBe(enabled?back.replace("https://www.mastermind-x.com",""):back);expect(requests.every(r=>r.method==="GET")).toBe(true);
  const resolved=new URL(link!.getAttribute("href")!,"https://beta.mastermind-x.com");expect(resolved.origin).toBe(enabled?"https://beta.mastermind-x.com":"https://www.mastermind-x.com");expect(resolved.search).toBe(new URL(back).search);
 }finally{await act(async()=>root.unmount());host.remove();(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=false;}
});
