// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TodayWorkspace from "@/components/workspaces/TodayWorkspace";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const A="11111111-1111-4111-8111-111111111111";
const identity=vi.hoisted(()=>({user:"11111111-1111-4111-8111-111111111111",listener:null as null|((event:string,session:{user:{id:string}}|null)=>void),open:vi.fn()}));
vi.mock("@/lib/i18n",()=>({useLang:()=>({lang:"en"})}));
vi.mock("@/components/onboarding/OnboardingProvider",()=>({useOnboarding:()=>({open:identity.open})}));
vi.mock("@/lib/supabase/client",()=>({createClient:()=>({auth:{getUser:async()=>({data:{user:{id:identity.user}},error:null}),onAuthStateChange:(listener:typeof identity.listener)=>{identity.listener=listener;return{data:{subscription:{unsubscribe:vi.fn()}}};}}})}));
vi.mock("next/link",()=>({default:({children,...props}:React.AnchorHTMLAttributes<HTMLAnchorElement>)=><a {...props}>{children}</a>}));
const briefing={schema:"mastermind.macro_command_read.v1",state:"ready",source:{served_root_qualified:true,manifest_generated_at:"2026-10-20T10:00:00Z",manifest_sha256:"d".repeat(64),composed_at:"2026-10-21T12:00:00Z"},read:{as_of:"2026-10-18",as_of_display:{en:"18 October 2026",zh:"2026年10月18日"},as_of_meaning:{en:"Oldest dated reading",zh:"最早读数"},clauses:[{topic:{en:"Liquidity",zh:"流动性"},predicate:{en:"is mixed",zh:"不均衡"},punct:{en:".",zh:"。"},section:"liquidity"}],omitted:false},strip:[],coverage:{available:1,total:1},sections:[{id:"liquidity",label:{en:"Liquidity",zh:"流动性"},href:"/macro_monetary.html#liquidity"}],workspaces:[]};
const inventory={lists:[{id:"owned-list",name:"PRIVATE WATCH",position:0,symbols:[{symbol:"AAPL",section:"",position:0}]}],sharedWithMe:[]};
const catalog={items:[{id:"report-one",title:"PRIVATE REPORT",institution:"Source desk",published_at:"2026-10-19",summary_points:["Actual source summary"]}],preview:false,stale:false,generated_at:"2026-10-20T10:00:00Z"};
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{"Content-Type":"application/json"}});
type Held={url:string;init?:RequestInit;resolve:(response:Response)=>void};
let held:Held[],root:Root,container:HTMLDivElement;
async function flush(){for(let i=0;i<5;i++)await act(async()=>{await Promise.resolve();});}
async function mount(){await act(async()=>root.render(<TodayWorkspace ownerKey={A}/>));await flush();}
async function answer(path:string,value:unknown,status=200){const request=held.filter(entry=>entry.url===path).at(-1);expect(request,path).toBeTruthy();await act(async()=>request!.resolve(json(value,status)));await flush();return request!;}
beforeEach(()=>{held=[];identity.user=A;identity.listener=null;identity.open.mockClear();window.localStorage.clear();window.history.replaceState({},"","/today?context=preserved#briefing");container=document.createElement("div");document.body.appendChild(container);root=createRoot(container);vi.stubGlobal("fetch",vi.fn((input:RequestInfo|URL,init?:RequestInit)=>new Promise<Response>(resolve=>held.push({url:String(input),init,resolve}))));});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.unstubAllGlobals();});

describe("Today real attention composition",()=>{
 it("keeps continuation before secondary coverage in DOM order and preserves a real nullable curve reading",async()=>{
  await mount();await answer("/api/shared-shell/today",{...briefing,strip:[{id:"curve",section:"liquidity",label:{en:"Curve",zh:"曲线"},tone:"neutral",null:true,value:null,cause:"see_curve",note:null,meaning:null,as_of:null,as_of_display:null}]});
  await answer("/api/shared-shell/research/catalog",catalog);await answer("/api/watchlist",inventory);
  const continuation=Array.from(container.querySelectorAll("h2")).find(node=>node.textContent==="Pick up where you left off");
  const coverage=container.querySelector("#today-coverage");expect(continuation).toBeTruthy();expect(coverage).toBeTruthy();
  expect(continuation!.compareDocumentPosition(coverage!)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(container.textContent).toContain("View the curve");expect(container.textContent).toContain("Liquidity is mixed");
  expect(held.some(request=>request.url.includes("/research/read/")||request.url.includes("/investigations/"))).toBe(false);
 });
 it("starts independent source, catalog and owned-list reads without quota-metered background report reads",async()=>{
  await mount();expect(held.map(request=>request.url).sort()).toEqual(["/api/shared-shell/research/catalog","/api/shared-shell/today","/api/watchlist"].sort());
  await answer("/api/shared-shell/research/catalog",catalog);await answer("/api/watchlist",inventory);
  expect(container.textContent).toContain("PRIVATE REPORT");expect(container.textContent).toContain("PRIVATE WATCH");expect(held.some(request=>request.url.includes("/research/read/"))).toBe(false);
  await answer("/api/shared-shell/today",briefing);expect(container.textContent).toContain("Liquidity is mixed");expect(container.querySelectorAll("main")).toHaveLength(1);
 });
 it("keeps useful research and saved-list actions available through an unavailable macro briefing",async()=>{
  await mount();await answer("/api/shared-shell/today",{error:"unavailable"},503);await answer("/api/shared-shell/research/catalog",catalog);await answer("/api/watchlist",inventory);
  expect(container.textContent).toContain("does not mean markets are quiet");expect(container.textContent).toContain("PRIVATE REPORT");expect(container.textContent).toContain("PRIVATE WATCH");expect(container.querySelector('a[href="/monitor"]')).toBeTruthy();expect(container.querySelector('a[href="/research"]')).toBeTruthy();
 });
 it("a catalog401 aborts the complete private Today lifetime and preserves context for explicit sign-in",async()=>{
  await mount();await answer("/api/shared-shell/today",briefing);await answer("/api/watchlist",inventory);expect(container.textContent).toContain("PRIVATE WATCH");expect(container.textContent).toContain("Liquidity is mixed");
  const original=window.location.href;await answer("/api/shared-shell/research/catalog",{error:"unauthorized"},401);
  expect(container.textContent).toContain("Private readings have been cleared");expect(container.textContent).not.toContain("PRIVATE WATCH");expect(container.textContent).not.toContain("Liquidity is mixed");expect(container.textContent).not.toContain("PRIVATE REPORT");
  const signIn=Array.from(container.querySelectorAll("button")).find(button=>button.textContent==="Sign in");expect(signIn).toBeTruthy();await act(async()=>signIn!.click());expect(identity.open).toHaveBeenCalledWith("signin");expect(window.location.href).toBe(original);
 });
 it("requires a fresh identity and can close a second expired generation after explicit recovery",async()=>{
  await mount();await answer("/api/shared-shell/research/catalog",{error:"unauthorized"},401);expect(container.textContent).toContain("Private readings have been cleared");
  const recheck=Array.from(container.querySelectorAll("button")).find(button=>button.textContent==="Recheck selected context");expect(recheck).toBeTruthy();await act(async()=>recheck!.click());await flush();
  expect(held).toHaveLength(6);await answer("/api/shared-shell/today",briefing);await answer("/api/watchlist",inventory);expect(container.textContent).toContain("PRIVATE WATCH");
  await answer("/api/shared-shell/research/catalog",{error:"unauthorized"},401);expect(container.textContent).toContain("Private readings have been cleared");expect(container.textContent).not.toContain("PRIVATE WATCH");expect(container.textContent).not.toContain("Liquidity is mixed");
 });
 it("local research403 does not erase another authoritative source or watchlist",async()=>{
  await mount();await answer("/api/shared-shell/today",briefing);await answer("/api/watchlist",inventory);await answer("/api/shared-shell/research/catalog",{error:"rights_denied"},403);
  expect(container.textContent).toContain("Liquidity is mixed");expect(container.textContent).toContain("PRIVATE WATCH");expect(container.textContent).not.toContain("Private readings have been cleared");expect(held.every(request=>!request.init?.signal?.aborted)).toBe(true);
 });
 it("an owned-list401 hides already loaded report/source content and rejects late results",async()=>{
  await mount();await answer("/api/shared-shell/research/catalog",catalog);expect(container.textContent).toContain("PRIVATE REPORT");await answer("/api/watchlist",{error:"unauthorized"},401);expect(held.find(request=>request.url==="/api/shared-shell/today")?.init?.signal?.aborted).toBe(true);await answer("/api/shared-shell/today",briefing);
  expect(container.textContent).toContain("Private readings have been cleared");expect(container.textContent).not.toContain("PRIVATE REPORT");expect(container.textContent).not.toContain("Liquidity is mixed");
 });

 it.each([
  ["/api/shared-shell/today", ""],
  ["/api/shared-shell/research/catalog", "<html>Sign in</html>"],
  ["/api/watchlist", ""],
 ])("an unreadable401 body at %s closes every private sibling without decoding",async(path,body)=>{
  await mount();
  for(const [url,value] of [["/api/shared-shell/today",briefing],["/api/shared-shell/research/catalog",catalog],["/api/watchlist",inventory]] as const){
   if(url!==path)await answer(url,value);
  }
  const request=held.find(entry=>entry.url===path)!;
  const response=new Response(body,{status:401,headers:{"Content-Type":"text/html"}});
  const decode=vi.spyOn(response,"json");
  await act(async()=>request.resolve(response));await flush();
  expect(decode).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Private readings have been cleared");
  for(const privateText of ["PRIVATE WATCH","PRIVATE REPORT","Liquidity is mixed"]){expect(container.textContent).not.toContain(privateText);}
  expect(window.location.pathname+window.location.search+window.location.hash).toBe("/today?context=preserved#briefing");
 });
 it("a real selected Watch child401 closes the whole Today identity lifetime",async()=>{
  await mount();await answer("/api/shared-shell/today",briefing);await answer("/api/shared-shell/research/catalog",catalog);await answer("/api/watchlist",inventory);
  const choose=Array.from(container.querySelectorAll("button")).find(button=>button.textContent?.startsWith("Check event evidence"));
  expect(choose).toBeTruthy();await act(async()=>choose!.click());await flush();
  const event=held.at(-1)!;expect(event.url).toContain("AAPL");expect(event.url).not.toContain("/api/watchlist");
  expect(container.querySelector('[data-event-attention-state="loading"]')).toBeTruthy();
  await act(async()=>event.resolve(new Response("",{status:401})));await flush();
  expect(container.textContent).toContain("Private readings have been cleared");
  expect(container.textContent).not.toContain("PRIVATE WATCH");expect(container.textContent).not.toContain("PRIVATE REPORT");expect(container.textContent).not.toContain("Liquidity is mixed");
  expect(container.querySelector("[data-event-attention-state]")).toBeNull();expect(event.init?.signal?.aborted).toBe(true);
 });
 it("closing Today aborts a selected real Watch read and rejects its late completion",async()=>{
  await mount();await answer("/api/shared-shell/today",briefing);await answer("/api/watchlist",inventory);
  const choose=Array.from(container.querySelectorAll("button")).find(button=>button.textContent?.startsWith("Check event evidence"));
  await act(async()=>choose!.click());await flush();const event=held.at(-1)!;expect(event.url).toContain("AAPL");
  await answer("/api/shared-shell/research/catalog",{},401);expect(event.init?.signal?.aborted).toBe(true);
  await act(async()=>event.resolve(json({error:"late_event_completion"},503)));await flush();
  expect(container.querySelector("[data-event-attention-state]")).toBeNull();expect(container.textContent).toContain("Private readings have been cleared");expect(container.textContent).not.toContain("PRIVATE WATCH");
 });
});
