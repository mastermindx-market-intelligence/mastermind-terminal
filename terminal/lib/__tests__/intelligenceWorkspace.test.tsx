// @vitest-environment jsdom
import React,{act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import IntelligenceWorkspace from "@/components/intelligence/IntelligenceWorkspace";
(globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const A="11111111-1111-4111-8111-111111111111",B="22222222-2222-4222-8222-222222222222";
const state=vi.hoisted(()=>({owner:"11111111-1111-4111-8111-111111111111",failure:false,lang:"en",listener:null as null|((event:string,session:{user:{id:string}}|null)=>void)}));
vi.mock("@/lib/i18n",()=>({useLang:()=>({lang:state.lang})}));
vi.mock("next/navigation",()=>({usePathname:()=>"/intelligence",useSearchParams:()=>new URLSearchParams()}));
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
beforeEach(()=>{state.owner=A;state.lang="en";state.failure=false;state.listener=null;held=[];host=document.createElement("div");document.body.appendChild(host);root=createRoot(host);vi.stubGlobal("fetch",vi.fn((url:RequestInfo|URL,init?:RequestInit)=>new Promise<Response>(resolve=>held.push({url:String(url),init,resolve}))));});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
describe("intelligence overview privacy, source truth and independent lanes",()=>{
 it("updates the retained source age at a session boundary without another source read",async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date("2026-11-02T20:59:59Z"));
  const visible=vi.spyOn(document,"visibilityState","get").mockReturnValue("visible");
  try {
   await mount();await answer(0,macro);
   const panel=()=>host.querySelector('[data-intelligence-source="macro"]')!;
   expect(panel().textContent).toContain("Latest session");
   await act(async()=>{await vi.advanceTimersByTimeAsync(1000);});await flush();
   expect(panel().textContent).toContain("1 session old");
   expect(held).toHaveLength(3);expect(panel().textContent).toContain("2026-10-30");
  } finally {visible.mockRestore();vi.useRealTimers();}
 });
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
