// @vitest-environment jsdom
import React,{act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import IntelligenceWorkspace from "@/components/intelligence/IntelligenceWorkspace";
import { liquidityFixture } from "./fixtures/macroLiquidity";
(globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const A="11111111-1111-4111-8111-111111111111",B="22222222-2222-4222-8222-222222222222";
const state=vi.hoisted(()=>({owner:"11111111-1111-4111-8111-111111111111",failure:false,lang:"en",search:"",listener:null as null|((event:string,session:{user:{id:string}}|null)=>void)}));
vi.mock("@/lib/i18n",()=>({useLang:()=>({lang:state.lang})}));
vi.mock("next/navigation",()=>({usePathname:()=>"/intelligence",useSearchParams:()=>new URLSearchParams(state.search)}));
vi.mock("next/link",()=>({default:({children,prefetch:_p,...props}:React.AnchorHTMLAttributes<HTMLAnchorElement>&{prefetch?:boolean})=>{void _p;return <a {...props}>{children}</a>;}}));
vi.mock("@/lib/supabase/client",()=>({createClient:()=>({auth:{getUser:async()=>({data:{user:{id:state.owner}},error:state.failure?Error("unavailable"):null}),onAuthStateChange:(listener:typeof state.listener)=>{state.listener=listener;return{data:{subscription:{unsubscribe:vi.fn()}}};}}})}));
type Held={url:string;init?:RequestInit;resolve:(response:Response)=>void};
let root:Root,host:HTMLDivElement,held:Held[];
const macro={schema:"mastermind.macro_command_read.v1",state:"partial",source:{served_root_qualified:true,manifest_generated_at:"2099-01-01T00:00:00Z",manifest_sha256:"d".repeat(64),composed_at:"2099-01-01T00:00:00Z"},read:{as_of:"2026-10-30",as_of_display:null,as_of_meaning:null,omitted:true,clauses:[{topic:{en:"Liquidity",zh:"流动性"},predicate:{en:"is mixed",zh:"不均衡"},punct:{en:".",zh:"。"},section:"liquidity"}]},strip:[],coverage:{available:2,total:5},sections:[{id:"liquidity",label:{en:"Liquidity",zh:"流动性"},href:"/macro_monetary.html#liquidity"}],workspaces:[]};
const cycles={schema:"mmx.intelligence.cycles.v1",sourceAsOf:"2026-10-30",stale:false,benchmark:"SPY",coverage:1,rows:[{id:"xlk",ticker:"XLK",name:"Technology",nameZh:"科技",phase:"Downturn",position:41,model:"published"}]};
const prophet={schema:"mmx.intelligence.prophet.v1",publishedAt:"2026-11-02",sourceAsOf:"2026-10-30",sourceUnknown:false,sourceDelayed:false,mixedVintage:false,stale:false,openCount:1,previewLimit:3,plans:[{id:"NVDA-20260917",symbol:"NVDA",phase:"triggered_pre_t1",priceAsOf:"2026-09-25",planAsOf:"2026-09-26"}]};
async function flush(){for(let i=0;i<4;i++)await act(async()=>{await Promise.resolve();});}
async function mount(owner=A){await act(async()=>root.render(<IntelligenceWorkspace ownerKey={owner}/>));await flush();}
async function answer(index:number,body:unknown,status=200){await act(async()=>held[index].resolve(Response.json(body,{status})));await flush();}
beforeEach(()=>{state.owner=A;state.lang="en";state.search="";state.failure=false;state.listener=null;held=[];host=document.createElement("div");document.body.appendChild(host);root=createRoot(host);vi.stubGlobal("fetch",vi.fn((url:RequestInfo|URL,init?:RequestInit)=>new Promise<Response>(resolve=>held.push({url:String(url),init,resolve}))));});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
describe("intelligence overview privacy, source truth and independent lanes",()=>{
 it("reads only compact views and displays real source readings with full-tool links",async()=>{
  await mount();expect(held.map(x=>x.url)).toEqual(["/api/shared-shell/today","/api/sector-intelligence?source=history&view=intelligence","/api/flow?f=prophet_idx&view=intelligence"]);
  await answer(0,macro);await answer(1,cycles);await answer(2,prophet);
  expect(host.textContent).toContain("Liquidity is mixed");expect(host.textContent).toContain("Technology");expect(host.textContent).toContain("NVDA");
  expect(host.textContent).toContain("2026-09-25");expect(host.textContent).not.toContain("2099-01-01");
  for(const href of ["/macro.html","/sector_cycles.html","/us_stocks.html","/prophet","/sectors","/analysis?symbol=NVDA"])expect(host.querySelector(`a[href='${href}']`)).toBeTruthy();
  expect(host.textContent).toContain("not a relative-strength rotation score");
 });
 it.each(["en","zh"])("%s distinguishes the opportunity workspace from the paid model-plan preview",async lang=>{
  state.lang=lang;await mount();await answer(2,prophet);
  const panel=host.querySelector('[data-intelligence-source="prophet"]')!;
  expect(panel.querySelector('a[href="/us_stocks.html"]')?.textContent).toContain(lang==="zh"?"打开机会工作台":"Open opportunity workspace");
  expect(panel.querySelector('a[href="/prophet"]')?.textContent).toBe(lang==="zh"?"模型计划与期权":"Model plans & options");
  expect(panel.textContent).toContain(lang==="zh"?"来源报告的开放计划数":"Open plans in published source");
  expect(panel.textContent).not.toContain(lang==="zh"?"今日机会数":"Today's opportunities");
 });
 it("a denied Prophet read does not erase available Macro or cycle readings",async()=>{
  await mount();await answer(0,macro);await answer(1,cycles);await answer(2,{error:"pro_required"},403);
  expect(host.textContent).toContain("Liquidity is mixed");expect(host.textContent).toContain("Technology");expect(host.querySelector('[data-intelligence-source="prophet"]')?.getAttribute("data-read-state")).toBe("access");
  expect(host.textContent).not.toContain("no open plans");
  expect(host.querySelector('[data-intelligence-source="prophet"] a[href="/us_stocks.html"]')).toBeTruthy();
 });
 it("malformed/503 responses are unavailable and never quiet, empty or zero",async()=>{
  await mount();await answer(0,{},503);await answer(1,{schema:"wrong"});await answer(2,{...prophet,plans:null});
  expect(host.querySelectorAll('[data-read-state="unavailable"]')).toHaveLength(3);expect(host.textContent).not.toContain("no open plans");expect(host.textContent).not.toContain("zero covered sectors");
 });
 it("401 clears all visible private readings and refuses late sibling responses",async()=>{
  await mount();await answer(0,macro);expect(host.textContent).toContain("Liquidity is mixed");await answer(2,{error:"unauthorized"},401);await answer(1,cycles);
  expect(host.textContent).toContain("Private readings have been cleared");expect(host.textContent).not.toContain("Liquidity is mixed");expect(host.textContent).not.toContain("Technology");
  expect(held[1].init?.signal?.aborted).toBe(true);
 });
 it("account departure during body parsing cannot commit old data",async()=>{
  await mount();let finish!:(value:unknown)=>void;
  await act(async()=>held[0].resolve({ok:true,status:200,json:()=>new Promise(resolve=>{finish=resolve;})} as Response));await flush();
  await act(async()=>state.listener!("SIGNED_IN",{user:{id:B}}));await act(async()=>finish(macro));await flush();
  expect(host.textContent).not.toContain("Liquidity is mixed");expect(host.textContent).toContain("Private readings have been cleared");
 });
 it("A to B to A cannot reuse a previous A lifetime",async()=>{
  await mount();await answer(0,macro);state.owner=B;await mount(B);state.owner=A;await mount(A);
  expect(host.textContent).not.toContain("Liquidity is mixed");expect(held).toHaveLength(9);
  await answer(3,macro);expect(host.textContent).not.toContain("Liquidity is mixed");await answer(6,macro);expect(host.textContent).toContain("Liquidity is mixed");
 });
 it("an identity-service outage makes no private reads",async()=>{state.failure=true;await mount();expect(held).toHaveLength(0);expect(host.textContent).toContain("verification is unavailable");});
 it("translated source and interface remain coherent in Chinese",async()=>{state.lang="zh";await mount();await answer(0,macro);await answer(1,cycles);await answer(2,prophet);expect(host.textContent).toContain("市场情报");expect(host.textContent).toContain("流动性不均衡");expect(host.textContent).toContain("科技");expect(host.textContent).toContain("下行");});
});


describe("native Liquidity selection uses the incumbent reading lifetime",()=>{
 const detail="workspaceMarket=us&macroWorkspace=liquidity_regime";
 it.each(["en","zh"])("%s reads only the selected Macro view and preserves its state, dates, zero and units",async lang=>{
  state.lang=lang;state.search=detail;await mount();
  expect(held.map(r=>r.url)).toEqual(["/api/shared-shell/today?workspace=liquidity_regime"]);
  await answer(0,liquidityFixture());
  expect(host.querySelectorAll("h1")).toHaveLength(1);expect(host.querySelector("iframe")).toBeNull();
  expect(host.textContent).toContain(lang==="zh"?"融资偏紧 / 支持偏弱":"Tight funding / Weak support");
  expect(host.textContent).toContain("48.00");expect(host.textContent).toContain("0.00");
  expect(host.textContent).toContain("2026-11-10");expect(host.textContent).toContain("2026-11-06");expect(host.textContent).not.toContain("2026-11-13T12:00:00Z");
  expect(host.textContent).toContain(lang==="zh"?"0–100 量表点数":"Points on a 0–100 scale");
  expect(host.querySelector('a[href="/macro_liquidity_regime.html"]')).toBeTruthy();
  expect(host.querySelector('a[href="/intelligence?workspaceMarket=us"]')).toBeTruthy();
  const sources=Array.from(host.querySelectorAll("button")).find(b=>b.textContent===(lang==="zh"?"来源与方法":"Sources & method"))!;
  await act(async()=>sources.click());expect(host.querySelector("details")?.open).toBe(true);expect(document.activeElement?.tagName).toBe("SUMMARY");
 });
 it("keeps a missing prior value separate from a published zero and eligible state comparison",async()=>{
  state.search=detail;await mount();const f=liquidityFixture(),row=f.selected_workspace.view.changes.deltas[1];
  row.prior=null;row.prior_raw=null;row.prior_present=false;row.delta=null;row.delta_raw=null;row.delta_present=false;row.comparable=false;row.is_movement=false;row.absence={label:{en:"Previous value unavailable",zh:"上次值不可用"}};
  await answer(0,f);const table=host.querySelector('[role="table"]')!;
  expect(table.textContent).toContain("Unchanged");expect(table.textContent).toContain("Previous value unavailable");expect(table.textContent).not.toContain("0.00");
  expect(host.textContent).toContain("0.00 USD bn");
 });
 it("no prior publication keeps useful current evidence without implying a one-month move",async()=>{
  state.search=detail;await mount();const f=liquidityFixture(),v=f.selected_workspace.view;
  v.changes={comparable:false,comparability:"NO_PRIOR",comparability_label:{en:"No prior publication",zh:"无上次发布"},prior_is_earlier:false,prior_effective_date:null,deltas:[],absence:{label:{en:"No prior publication",zh:"无上次发布"}}};v.headline.prior={state_id:null,effective_date:null};
  await answer(0,f);expect(host.querySelector('[role="table"]')).toBeNull();expect(host.textContent).toContain("Current evidence remains available");expect(host.textContent).toContain("48.00");expect(host.textContent).not.toContain("1M");
 });
 it("keeps source-declared stale status and typed history absence distinct from transport readiness",async()=>{
  state.search=detail;await mount();const f=liquidityFixture(),v=f.selected_workspace.view;
  v.context.worst_freshness_token="STALE_SOURCE";v.context.worst_freshness={en:"Stale source",zh:"来源过期"};
  v.series.absence={label:{en:"History rights blocked",zh:"历史数据权限受限"}};
  await answer(0,f);expect(host.querySelector('[data-macro-liquidity]')?.getAttribute('data-read-state')).toBe('ready');
  expect(host.textContent).toContain('Stale source');expect(host.textContent).toContain('History rights blocked');expect(host.textContent).not.toContain('has not published a historical series');
 });
 it("invalid/duplicate selection makes no private request or dead source action",async()=>{
  state.search="macroWorkspace=liquidity_regime&macroWorkspace=liquidity_regime";await mount();expect(held).toHaveLength(0);expect(host.querySelector('[data-read-state="invalid"]')).toBeTruthy();
  state.search=detail;await mount();await answer(0,liquidityFixture());state.search="macroWorkspace=unknown";await mount();
  expect(held).toHaveLength(1);expect(host.textContent).not.toContain("48.00");expect(host.querySelector('button[aria-controls="liquidity-sources"]')).toBeNull();
 });
 it("view departure rejects late body parsing, and overview return restores its visible opener",async()=>{
  await mount();await answer(0,macro);state.search=detail;await mount();let finish!:(value:unknown)=>void;
  await act(async()=>held[3].resolve({ok:true,status:200,json:()=>new Promise(resolve=>{finish=resolve;})} as Response));await flush();
  state.search="workspaceMarket=us";await mount();expect(host.textContent).not.toContain("Liquidity is mixed");
  expect(document.activeElement).toBe(host.querySelector('a[href="/intelligence?workspaceMarket=us&macroWorkspace=liquidity_regime"]'));
  await act(async()=>finish(liquidityFixture()));await flush();expect(host.querySelector("[data-macro-liquidity]")).toBeNull();
  await answer(4,macro);expect(document.activeElement).toBe(host.querySelector('a[href="/intelligence?workspaceMarket=us&macroWorkspace=liquidity_regime"]'));
  state.search=detail;await mount();expect(held.at(-1)?.url).toBe("/api/shared-shell/today?workspace=liquidity_regime");expect(host.textContent).not.toContain("48.00");
  await answer(7,liquidityFixture());expect(host.textContent).toContain("48.00");
 });
 it("refresh clears the selected reading and a 401 closes the account lifetime",async()=>{
  state.search=detail;await mount();await answer(0,liquidityFixture());
  await act(async()=>Array.from(host.querySelectorAll("button")).find(b=>b.textContent==="Refresh")!.click());await flush();
  expect(host.textContent).not.toContain("48.00");expect(held).toHaveLength(2);await answer(1,{error:"unauthorized"},401);
  expect(host.textContent).toContain("Private readings have been cleared");expect(host.textContent).not.toContain("48.00");expect(host.querySelector('button[aria-controls="liquidity-sources"]')).toBeNull();
 });
});

// Same source readers; only displayed freshness advances while the tab stays open.
describe("intelligence freshness while the page remains open", () => {
 const visibility = (value: "visible" | "hidden") => Object.defineProperty(document, "visibilityState", { configurable: true, get: () => value });
 const loaded = async () => { await mount(); await answer(0, macro); await answer(1, cycles); await answer(2, { ...prophet, plans: prophet.plans.map(p => ({ ...p, priceAsOf: "2026-10-30" })) }); };
 beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-02T20:59:59.500Z")); visibility("visible"); });
 afterEach(() => { Reflect.deleteProperty(document, "visibilityState"); vi.useRealTimers(); });
 it("ages source and plan-price readings at exchange close without new requests", async () => {
  await loaded(); expect(host.textContent).toContain("Latest session");
  await act(async () => vi.advanceTimersByTime(500)); await flush();
  for (const kind of ["macro", "cycles", "prophet"]) expect(host.querySelector(`[data-intelligence-source="${kind}"]`)?.textContent).toContain("1 session old");
  expect(host.textContent).not.toContain("Latest session"); expect(held).toHaveLength(3);
 });
 it("visible wake catches age after suspension without refreshing sources", async () => {
  await loaded(); await act(async () => { visibility("hidden"); document.dispatchEvent(new Event("visibilitychange")); });
  vi.setSystemTime(new Date("2026-11-04T15:00:00Z")); expect(host.textContent).toContain("Latest session");
  await act(async () => { visibility("visible"); document.dispatchEvent(new Event("visibilitychange")); }); await flush();
  expect(host.textContent).toContain("2 sessions old — check source"); expect(host.textContent).not.toContain("Latest session"); expect(held).toHaveLength(3);
 });
 it("Chinese readings age through the same source clock", async () => {
  state.lang = "zh"; await loaded(); expect(host.textContent).toContain("最新交易日");
  await act(async () => vi.advanceTimersByTime(500)); await flush();
  expect(host.textContent).toContain("落后 1 个交易日"); expect(host.textContent).not.toContain("最新交易日"); expect(held).toHaveLength(3);
 });
 it("clock wake cannot resurrect private readings after account departure", async () => {
  await loaded(); await act(async () => state.listener!("SIGNED_OUT", null));
  await act(async () => vi.advanceTimersByTime(500)); await flush();
  expect(host.textContent).toContain("Private readings have been cleared"); expect(host.textContent).not.toContain("Liquidity is mixed"); expect(host.textContent).not.toContain("NVDA"); expect(held).toHaveLength(3);
 });
});
