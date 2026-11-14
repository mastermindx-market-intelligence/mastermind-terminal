// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TodayWorkspace from "@/components/workspaces/TodayWorkspace";
import { STORAGE_KEY, ownerSlot } from "@/components/workspaces/TodaySinceLastVisit";
import { readingHref, saveBrowserReadingProgress } from "@/lib/shared-shell/readingProgress";
import { todayMarketFixture, todayPersonalBriefFixture, todayChangesFixture, todayDigestFixture,
 todayCatalogFixture, todayWatchlistFixture, TODAY_SAVED_SELECTION } from "./fixtures/todayDailyDesk";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const A="11111111-1111-4111-8111-111111111111";
const identity=vi.hoisted(()=>({user:"11111111-1111-4111-8111-111111111111",listener:null as null|((event:string,session:{user:{id:string}}|null)=>void),open:vi.fn(),reads:0}));
const locale = vi.hoisted(() => ({ lang: "en" as "en" | "zh" }));
vi.mock("@/lib/i18n",()=>({useLang:()=>({lang:locale.lang})}));
vi.mock("@/components/onboarding/OnboardingProvider",()=>({useOnboarding:()=>({open:identity.open})}));
vi.mock("@/lib/supabase/client",()=>({createClient:()=>({auth:{getUser:async()=>{identity.reads++;return{data:{user:{id:identity.user}},error:null};},onAuthStateChange:(listener:typeof identity.listener)=>{identity.listener=listener;return{data:{subscription:{unsubscribe:vi.fn()}}};}}})}));
vi.mock("@/lib/useMediaQuery",()=>({useMediaQuery:()=>false}));
vi.mock("next/link",()=>({default:({children,prefetch,...props}:React.AnchorHTMLAttributes<HTMLAnchorElement> & {prefetch?:boolean})=><a {...props} data-prefetch={String(prefetch)}>{children}</a>}));
const inventory={lists:[{id:"owned-list",name:"PRIVATE WATCH",position:0,symbols:[{symbol:"AAPL",section:"",position:0}]}],sharedWithMe:[]};
const catalog={items:[{id:"report-one",title:"PRIVATE REPORT",institution:"Source desk",published_at:"2026-10-19",summary_points:["Actual source summary"]}],preview:false,stale:false,generated_at:"2026-10-20T10:00:00Z"};
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{"Content-Type":"application/json"}});
type Held={url:string;init?:RequestInit;resolve:(response:Response)=>void};
let held:Held[],root:Root,container:HTMLDivElement;
async function flush(){for(let i=0;i<5;i++)await act(async()=>{await Promise.resolve();});}
async function mount(){await act(async()=>root.render(<TodayWorkspace ownerKey={A}/>));await flush();}
async function answer(path:string,value:unknown,status=200){const request=held.filter(entry=>entry.url===path).at(-1);expect(request,path).toBeTruthy();await act(async()=>request!.resolve(json(value,status)));await flush();return request!;}
beforeEach(()=>{held=[];locale.lang="en";identity.user=A;identity.listener=null;identity.open.mockClear();identity.reads=0;
 const dom=(globalThis as unknown as {jsdom?:{window:Window}}).jsdom;
 if(dom)Object.defineProperty(window,"localStorage",{value:dom.window.localStorage,configurable:true,writable:true});
 vi.stubGlobal("localStorage",window.localStorage);window.localStorage.clear();
 window.history.replaceState({},"","/today?context=preserved#briefing");container=document.createElement("div");document.body.appendChild(container);root=createRoot(container);vi.stubGlobal("fetch",vi.fn((input:RequestInfo|URL,init?:RequestInit)=>new Promise<Response>(resolve=>held.push({url:String(input),init,resolve}))));});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();delete document.documentElement.dataset.theme;vi.unstubAllGlobals();vi.restoreAllMocks();});

describe("Unified Today daily desk", () => {
 const snapshot = todayMarketFixture();

 it("features three independent macro readings and retains every observation exactly once", async () => {
  await mount(); await answer("/api/shared-shell/today", snapshot);
  const market = container.querySelector("[data-today-market-snapshot]")!;
  const detail = container.querySelector<HTMLDetailsElement>("[data-today-source-details]")!;
  expect(market.querySelector("h2")?.textContent).toBe("Market snapshot");
  expect(detail.open).toBe(false);
  const summary=market.querySelector("[data-today-market-summary]")!;
  expect(summary.textContent?.trim()).toBe("Liquidity is mixed. Growth is picking up.");
  expect(summary.closest("details")).toBeNull();
  expect(detail.textContent).not.toContain("Liquidity is mixed");
  expect(detail.textContent).toContain("Source qualification stays accessible");
  for (const id of ["money", "growth", "credit", "inflation"]) {
   expect(container.querySelectorAll(`[data-today-reading="${id}"]`)).toHaveLength(1);
  }
  expect(detail.querySelector('[data-today-reading="money"]')).toBeNull();
  expect(detail.querySelector('[data-today-reading="inflation"]')).toBeTruthy();
  expect(market.querySelector('a[href="/intelligence?workspaceMarket=us"]')?.getAttribute("data-prefetch")).toBe("false");
  expect(market.querySelector('a[href="/macro_monetary.html"]')).toBeTruthy();
 });

 it("keeps a missing summary distinct from independent readings and personal comparison", async () => {
  const partial=todayMarketFixture();partial.read.clauses=[];
  await mount();await answer("/api/shared-shell/today",partial);
  await answer("/api/portfolio-brief",todayPersonalBriefFixture());await answer("/api/portfolio-changes",todayChangesFixture());
  const summary=container.querySelector("[data-today-market-summary]")!;
  expect(summary.getAttribute("data-summary-state")).toBe("unavailable");
  expect(summary.textContent).toContain("A market summary was not published.");
  expect(container.textContent).not.toContain("The Macro Command reading is unavailable");
  expect(container.querySelector('[data-today-reading="money"]')?.textContent).toContain("Tight and thin");
  expect(container.querySelector("[data-today-since-state]")?.getAttribute("data-today-since-state")).toBe("ready");
  expect(container.querySelector("[data-today-brief-context]")?.textContent).toContain("The desk's daily read: Mixed.");
 });

 it("settled layout, source disclosure and language changes preserve one accepted digest write and the saved revision", async () => {
  saveBrowserReadingProgress(A,{selection:TODAY_SAVED_SELECTION,segmentStart:7});
  const writes=vi.spyOn(Object.getPrototypeOf(window.localStorage),"setItem");
  await mount();await answer("/api/shared-shell/today",snapshot);
  await answer("/api/shared-shell/research/catalog",todayCatalogFixture());await answer("/api/watchlist",todayWatchlistFixture());
  await answer("/api/market-breadth",{},503);
  await answer("/api/portfolio-brief",todayPersonalBriefFixture());await answer("/api/portfolio-changes",todayChangesFixture());
  const since=container.querySelector("[data-today-since-state]");
  expect(since?.getAttribute("data-today-since-state")).toBe("ready");
  expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!)).toEqual({[ownerSlot(A)]:todayDigestFixture()});
  expect(writes.mock.calls.filter(call=>call[0]===STORAGE_KEY)).toHaveLength(1);
  const resume=readingHref(TODAY_SAVED_SELECTION,7);
  expect(container.querySelector(`a[href="${resume}"]`)).toBeTruthy();
  const before=held.map(r=>[r.url,r.init?.method??"GET"]);
  const detail=container.querySelector<HTMLDetailsElement>("[data-today-source-details]")!;
  await act(async()=>{detail.querySelector("summary")!.click();window.dispatchEvent(new Event("resize"));document.documentElement.dataset.theme="light";});
  locale.lang="zh";await mount();
  expect(container.querySelector("[data-today-market-summary]")?.textContent?.trim()).toBe("流动性不均衡。增长正在回升。");
  expect(container.querySelector("[data-today-since-state]")).toBe(since);
  expect(container.querySelector(`a[href="${resume}"]`)).toBeTruthy();
  expect(detail.open).toBe(true);expect(held.map(r=>[r.url,r.init?.method??"GET"])).toEqual(before);
  expect(held.filter(r=>r.url==="/api/portfolio-changes")).toHaveLength(1);
  expect(writes.mock.calls.filter(call=>call[0]===STORAGE_KEY)).toHaveLength(1);
  expect(held.some(r=>r.url.includes("/research/read/"))).toBe(false);expect(identity.reads).toBe(1);
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
