// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TodayWorkspace from "@/components/workspaces/TodayWorkspace";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const A="11111111-1111-4111-8111-111111111111";
const identity=vi.hoisted(()=>({user:"11111111-1111-4111-8111-111111111111",listener:null as null|((event:string,session:{user:{id:string}}|null)=>void),open:vi.fn(),reads:0}));
vi.mock("@/lib/i18n",()=>({useLang:()=>({lang:"en"})}));
vi.mock("@/components/onboarding/OnboardingProvider",()=>({useOnboarding:()=>({open:identity.open})}));
vi.mock("@/lib/supabase/client",()=>({createClient:()=>({auth:{getUser:async()=>{identity.reads++;return{data:{user:{id:identity.user}},error:null};},onAuthStateChange:(listener:typeof identity.listener)=>{identity.listener=listener;return{data:{subscription:{unsubscribe:vi.fn()}}};}}})}));
vi.mock("@/lib/useMediaQuery",()=>({useMediaQuery:()=>false}));
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
beforeEach(()=>{held=[];identity.user=A;identity.listener=null;identity.open.mockClear();identity.reads=0;window.localStorage.clear();window.history.replaceState({},"","/today?context=preserved#briefing");container=document.createElement("div");document.body.appendChild(container);root=createRoot(container);vi.stubGlobal("fetch",vi.fn((input:RequestInfo|URL,init?:RequestInit)=>new Promise<Response>(resolve=>held.push({url:String(input),init,resolve}))));});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.unstubAllGlobals();});

describe("Unified Today daily desk", () => {
 const chip = (id: string, value: string, note: string | null = null) => ({ id, section: id,
  label: { en: id, zh: id }, tone: "neutral", null: false, value: { en: value, zh: value }, cause: null,
  note: note ? { en: note, zh: note } : null, meaning: null, as_of: "2026-10-16", as_of_display: { en: "16 October 2026", zh: "2026年10月16日" } });
 const snapshot = { ...briefing,
  strip: [chip("money", "Tight and thin", "Source qualification stays accessible"), chip("growth", "Picking up"),
   chip("credit", "Tight and tightening"), chip("inflation", "Rising, but narrow")],
  sections: ["money", "growth", "credit", "inflation"].map(id => ({ id, label: { en: id, zh: id }, href: `/macro_monetary.html#${id}` })) };

 it("features three independent macro readings and retains every observation exactly once", async () => {
  await mount(); await answer("/api/shared-shell/today", snapshot);
  const market = container.querySelector("[data-today-market-snapshot]")!;
  const detail = container.querySelector<HTMLDetailsElement>("[data-today-source-details]")!;
  expect(market.querySelector("h2")?.textContent).toBe("Market snapshot");
  expect(detail.open).toBe(false);
  expect(detail.textContent).toContain("Liquidity is mixed");
  expect(detail.textContent).toContain("Source qualification stays accessible");
  for (const id of ["money", "growth", "credit", "inflation"]) {
   expect(container.querySelectorAll(`[data-today-reading="${id}"]`)).toHaveLength(1);
  }
  expect(detail.querySelector('[data-today-reading="money"]')).toBeNull();
  expect(detail.querySelector('[data-today-reading="inflation"]')).toBeTruthy();
  expect(market.querySelector('a[href="/macro.html"]')).toBeTruthy();
  expect(market.querySelector('a[href="/macro_monetary.html"]')).toBeTruthy();
 });

 it("opening sources or resizing cannot fetch or remount the source and personal readers", async () => {
  await mount(); await answer("/api/shared-shell/today", snapshot);
  await answer("/api/shared-shell/research/catalog", catalog); await answer("/api/watchlist", inventory);
  const before = held.map(r => r.url);
  const detail = container.querySelector<HTMLDetailsElement>("[data-today-source-details]")!;
  await act(async () => { detail.querySelector("summary")!.click(); window.dispatchEvent(new Event("resize")); });
  await flush(); expect(detail.open).toBe(true); expect(held.map(r => r.url)).toEqual(before);
  expect(held.filter(r => r.url === "/api/market-breadth")).toHaveLength(1);
  expect(held.filter(r => r.url === "/api/watchlist")).toHaveLength(1);
 });

 it("saved membership is not presented as an alert and opens the exact company", async () => {
  await mount(); await answer("/api/watchlist", inventory);
  expect(container.textContent).toContain("Your watchlists");
  expect(container.textContent).not.toContain("Needs your attention");
  expect(container.querySelector('a[aria-label="Analyze AAPL"]')?.getAttribute("href")).toBe("/analysis?symbol=AAPL");
  expect(held.some(r => r.url.includes("/investigations/"))).toBe(false);
 });
});
