// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, useLayoutEffect, type ComponentProps } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import ScreenerView from "@/components/ScreenerView";
import type SmartScreensPanel from "@/components/screener/SmartScreensPanel";
import type { ScreenDefinition } from "@/lib/smartScreen/predicate";
import { FUNDAMENTAL_FIELD_IDS, parseFundamentalScan, type FundamentalScanSource } from "@/lib/fundamentalScan";
import { projectFundamental } from "@/lib/fundamentalScanProducer";
import { SCREENER_SCAN_SCHEMA } from "@/lib/screenerScan";
import { fundDoc, JUNCO_ANNUAL, SEPCO_ANNUAL } from "./fixtures/fundamentalScan/fundDoc";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const h=vi.hoisted(()=>({ get:vi.fn(), owner:"account:u1", failure:null as string|null, capture:null as unknown,
 fundSource:null as FundamentalScanSource|null, fundEnabled:false }));
vi.mock("@/lib/dataCache",()=>({getJSONResult:h.get,invalidate:vi.fn()}));
vi.mock("next/navigation",()=>({useRouter:()=>({push:vi.fn()})}));
vi.mock("@/lib/i18n",()=>({useLang:()=>({lang:"en"}),useT:()=>(k:string)=>k}));
vi.mock("@/lib/useMarketPrefs",()=>({useMarketPrefs:()=>({prefs:{enabled:["us"]},ready:true})}));
vi.mock("@/lib/smartScreen/useSmartScreens",()=>({useSmartScreens:()=>({snap:{owner:h.owner,readFailure:h.failure}})}));
vi.mock("@/lib/flowClientCache",()=>({flowGet:async()=>null}));
vi.mock("@/components/screener/useFundamentalScan",()=>({useFundamentalScan:(enabled:boolean)=>{
 h.fundEnabled=enabled;
 return {source:h.fundSource,nowMs:Date.parse("2026-10-11T00:00:00Z"),pending:false,retry:vi.fn()};
}}));
vi.mock("@/components/AssetLogo",()=>({default:()=>null}));
vi.mock("@/components/screener/SmartScreensPanel",()=>({default:(p:ComponentProps<typeof SmartScreensPanel>)=><>
  <button onClick={()=>p.onOpenExact?.("Whole",h.capture as ScreenDefinition)}>Open exact</button>
  <button onClick={p.onCloseDefinition}>Close exact</button>
  {p.openedDefinition&&<span data-exact-copy>{JSON.stringify(p.openedDefinition)}</span>}
</>}));
const identity=(userId:string)=>({kind:"account" as const,userId,email:"same@example.test"});
const row=(chg:number|null,mkt="NASDAQ",last:number|null=50)=>({last,chg,vol:2000000,sec:"Equities",mkt});
const manifest={as_of:"2026-10-15",symbols:{UP:row(4),DOWN:row(-4),MIDDLE:row(1),UNKNOWN:row(null),NOPRICE:row(4,"NASDAQ",null),"0700.HK":row(5,"HKEX"),"600000.SS":row(5,"SSE")}};
const settle=async()=>{await act(async()=>{});};
const symbols=(el:HTMLElement)=>Array.from(el.querySelectorAll(".sym-cell .tk"),e=>e.textContent).sort();
beforeEach(()=>{
 h.owner="account:u1";h.failure=null;h.get.mockResolvedValue({status:"data",data:manifest});
 h.fundSource=null;h.fundEnabled=false;
 h.capture={grammar:1,scope:{markets:["us","hk"],asset:"Equities",unpriced:false},where:{all:[{f:"dv",op:"gte",v:1000000},{any:[{f:"chg",op:"gte",v:3},{f:"chg",op:"lte",v:-3}]}]}} satisfies ScreenDefinition;
 vi.stubGlobal("ResizeObserver",class {observe(){} disconnect(){}});
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it("applies both OR arms and exact saved scope, restores device filters, and owns a detached copy",async()=>{
 const v=render(<ScreenerView identity={identity("u1")}/>);await settle();
 expect(symbols(v.container)).not.toContain("0700.HK");
 fireEvent.change(v.getByRole("searchbox"),{target:{value:"MIDDLE"}});await settle();
 fireEvent.click(v.getByText("Open exact"));await settle();
 expect(symbols(v.container)).toEqual(["0700.HK","DOWN","UP"]);
 expect(v.container.querySelector(".scr2-bar")).toBeNull();
 (h.capture as ScreenDefinition).scope.markets="all";
 v.rerender(<ScreenerView identity={identity("u1")}/>);await settle();
 expect(symbols(v.container)).toEqual(["0700.HK","DOWN","UP"]);
 fireEvent.click(v.getByText("Close exact"));await settle();
 expect(v.container.querySelector(".scr2-bar")).not.toBeNull();
 expect(symbols(v.container)).not.toContain("0700.HK");
});
it("fences a changed owner before layout effects and never restores the previous owner's session copy",async()=>{
 let seen=false;
 function Harness({id}:{id:string}) { useLayoutEffect(()=>{if(id==="u2") seen=!!document.querySelector("[data-exact-copy]");});return <ScreenerView identity={identity(id)}/>; }
 const v=render(<Harness id="u1"/>);await settle();fireEvent.click(v.getByText("Open exact"));await settle();
 expect(v.container.querySelector("[data-exact-copy]")).not.toBeNull();
 h.owner="account:u2";v.rerender(<Harness id="u2"/>);await settle();expect(seen).toBe(false);
 h.owner="account:u1";v.rerender(<Harness id="u1"/>);await settle();expect(v.container.querySelector("[data-exact-copy]")).toBeNull();
});
it("clears an expired account session without restoring the copy after reauthentication",async()=>{
 const v=render(<ScreenerView identity={identity("u1")}/>);await settle();fireEvent.click(v.getByText("Open exact"));await settle();
 h.failure="unauthenticated";v.rerender(<ScreenerView identity={identity("u1")}/>);await settle();expect(v.container.querySelector("[data-exact-copy]")).toBeNull();
 h.failure=null;v.rerender(<ScreenerView identity={identity("u1")}/>);await settle();expect(v.container.querySelector("[data-exact-copy]")).toBeNull();
});

it("opens the whole saved grammar-2 definition and applies its own fundamental condition",async()=>{
 const generation=Date.parse("2026-10-10T23:00:00Z")/1000;
 const parsed=parseFundamentalScan({schema:SCREENER_SCAN_SCHEMA,family:"fundamental",family_version:1,
  generation,generated_at:new Date(generation*1000).toISOString(),complete:true,
  universe:{source:"manifest",as_of:"2026-10-09",count:2},fields:[...FUNDAMENTAL_FIELD_IDS],
  rows:[{sym:"UP",...projectFundamental("UP",fundDoc("UP",{pe:25.5,annual:SEPCO_ANNUAL})).observation},
   {sym:"DOWN",...projectFundamental("DOWN",fundDoc("DOWN",{pe:14,annual:JUNCO_ANNUAL})).observation}]});
 if(!parsed.ok)throw new Error(parsed.error);
 h.fundSource={kind:"ready",scan:parsed.value};
 h.capture={...(h.capture as ScreenDefinition),grammar:2,
  fund:[{field:"fund.net_margin_fy",op:"range",gte:0.15}]} satisfies ScreenDefinition;
 const v=render(<ScreenerView identity={identity("u1")}/>);await settle();
 expect(h.fundEnabled).toBe(false);
 fireEvent.click(v.getByText("Open exact"));await settle();
 expect(symbols(v.container)).toEqual(["UP"]);
 expect(h.fundEnabled).toBe(true);
 // Removing only the saved fundamental condition must admit the lower-margin row;
 // its manifest OR arm already matches. No screen save or owner mutation is involved.
 fireEvent.click(v.getByText("Close exact"));await settle();
 h.capture={...(h.capture as ScreenDefinition),grammar:1};
 delete (h.capture as {fund?:unknown}).fund;
 fireEvent.click(v.getByText("Open exact"));await settle();
 expect(symbols(v.container)).toContain("DOWN");
});
