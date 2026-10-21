// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ResearchWorkspace from "@/components/workspaces/ResearchWorkspace";
import TodayWorkspace from "@/components/workspaces/TodayWorkspace";
import { readingHref } from "@/lib/shared-shell/readingProgress";
import type { ReadingSelection } from "@/lib/shared-shell/readingContracts";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const A="11111111-1111-4111-8111-111111111111", B="22222222-2222-4222-8222-222222222222";
const auth=vi.hoisted(()=>({user:"11111111-1111-4111-8111-111111111111",failure:false,open:vi.fn(),listener:null as null|((event:string,session:{user:{id:string}}|null)=>void)}));
vi.mock("@/components/onboarding/OnboardingProvider",()=>({useOnboarding:()=>({open:auth.open})}));
vi.mock("@/lib/i18n",()=>({useLang:()=>({lang:"en"})}));
vi.mock("@/lib/supabase/client",()=>({createClient:()=>({auth:{getUser:async()=>({data:{user:{id:auth.user}},error:auth.failure?Error("auth service unavailable"):null}),onAuthStateChange:(listener:typeof auth.listener)=>{auth.listener=listener;return{data:{subscription:{unsubscribe:vi.fn()}}};}}})}));
vi.mock("next/link",()=>({default:({children,...props}:React.AnchorHTMLAttributes<HTMLAnchorElement>)=><a {...props}>{children}</a>}));
const selection:ReadingSelection={docId:"report-one",sourcePdfSha256:"a".repeat(64),extractedTextSha256:"b".repeat(64),extractorVersion:"research_vault.ingest.extract_pdf_text.v1",segmenterVersion:"page-byte-v1"};
function body(text="PRIVATE SELECTED SOURCE",start=0,total=3,docId=selection.docId){return{
 schema:"research_vault.browser_read.v1",report_id:docId,selection:{source_pdf_sha256:selection.sourcePdfSha256,extracted_text_sha256:selection.extractedTextSha256,extractor_version:selection.extractorVersion,segmenter_version:selection.segmenterVersion,segment_max_bytes:4000},
 source:{catalog_generated_at:"2026-10-20T10:00:00Z",catalog_health:{}},text_layer_state:"full",segment_count_total:total,
 segments:[{schema:"research_vault.segment.v1",report_id:docId,source_pdf_sha256:selection.sourcePdfSha256,extracted_text_sha256:selection.extractedTextSha256,extractor_version:selection.extractorVersion,segmenter_version:selection.segmenterVersion,segment_max_bytes:4000,segment_index:start,page_start:1,page_end:1,start_byte:0,end_byte:new TextEncoder().encode(text).length,segment_text_sha256:"c".repeat(64),replay_state:"EXACT",text}],
};}
type Held={url:string;init?:RequestInit;resolve:(response:Response)=>void};
let held:Held[],root:Root,container:HTMLDivElement;
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{"Content-Type":"application/json"}});
async function flush(){for(let n=0;n<4;n++)await act(async()=>{await Promise.resolve();});}
async function answer(index:number,value:unknown,status=200){await act(async()=>{held[index].resolve(json(value,status));});await flush();}
async function click(text:string){const button=Array.from(container.querySelectorAll("button")).find(node=>node.textContent?.includes(text));expect(button, text).toBeTruthy();await act(async()=>button!.click());await flush();}
async function mount(component:React.ReactNode){await act(async()=>root.render(component));await flush();}
beforeEach(()=>{auth.user=A;auth.failure=false;auth.open.mockClear();auth.listener=null;held=[];window.history.replaceState({},"","/research");window.localStorage.clear();container=document.createElement("div");document.body.appendChild(container);root=createRoot(container);vi.stubGlobal("requestAnimationFrame",(cb:FrameRequestCallback)=>{cb(0);return 1;});vi.stubGlobal("fetch",vi.fn((input:RequestInfo|URL,init?:RequestInit)=>new Promise<Response>(resolve=>held.push({url:String(input),init,resolve}))));});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.unstubAllGlobals();});
async function library(){await answer(0,{items:[{id:"report-one",title:"First source report",institution:"Source desk",published_at:"2026-10-19"},{id:"report-two",title:"Second source report"}],preview:false});}

describe("Research selected revision and subject isolation",()=>{
 it("an unavailable identity service is distinct from signout, and explicit retry re-verifies before reading",async()=>{
  auth.failure=true;await mount(<ResearchWorkspace ownerKey={A}/>);
  expect(held).toHaveLength(0);expect(container.textContent).toContain("account service is unavailable");expect(container.textContent).not.toContain("session ended");
  auth.failure=false;await click("Try again");expect(held).toHaveLength(1);await library();expect(container.textContent).toContain("First source report");
 });
 it("selects current deliberately, pins pagination/reopen, persists no private body, and does not replace after409",async()=>{
  await mount(<ResearchWorkspace ownerKey={A}/>);await library();await click("Open current revision");
  expect(held[1].url).not.toContain("source_pdf_sha256");await answer(1,body());
  expect(container.textContent).toContain("PRIVATE SELECTED SOURCE");
  expect(window.location.search).toContain(selection.sourcePdfSha256);
  expect(JSON.stringify(window.localStorage)).not.toContain("PRIVATE SELECTED SOURCE");
  await click("Next text window");
  expect(held[2].url).toContain(`source_pdf_sha256=${selection.sourcePdfSha256}`);
  expect(held[2].url).toContain(`extracted_text_sha256=${selection.extractedTextSha256}`);
  expect(container.textContent).not.toContain("PRIVATE SELECTED SOURCE");
  await answer(2,{error:"selected_revision_unavailable"},409);
  expect(container.textContent).toContain("This selected revision is unavailable");expect(container.textContent).toContain(selection.sourcePdfSha256);
  expect(held).toHaveLength(3);
  const openButtons=Array.from(container.querySelectorAll("button")).filter(node=>node.textContent==="Open current revision");
  await act(async()=>openButtons.at(-1)!.click());await flush();
  expect(held.at(-1)!.url).not.toContain("source_pdf_sha256");
 });
 it("discards a delayed first selection after the user chooses a second document",async()=>{
  await mount(<ResearchWorkspace ownerKey={A}/>);await library();
  const buttons=Array.from(container.querySelectorAll("button")).filter(node=>node.textContent?.includes("Open current revision"));
  await act(async()=>buttons[0].click());await act(async()=>buttons[1].click());await flush();
  await answer(2,body("SECOND DOCUMENT",0,1,"report-two"));await answer(1,body("WRONG LATE FIRST"));
  expect(container.textContent).toContain("SECOND DOCUMENT");expect(container.textContent).not.toContain("WRONG LATE FIRST");
 });
 it("clears source text and refuses late data after an account change",async()=>{
  await mount(<ResearchWorkspace ownerKey={A}/>);await library();await click("Open current revision");await answer(1,body());await click("Next text window");
  await act(async()=>auth.listener!("SIGNED_IN",{user:{id:B}}));
  expect(held[2].init?.signal?.aborted).toBe(true);
  await answer(2,body("OLD ACCOUNT LATE",1));
  expect(container.textContent).not.toContain("OLD ACCOUNT LATE");expect(container.textContent).not.toContain("PRIVATE SELECTED SOURCE");expect(container.textContent).toContain("Private research has been cleared");
  const retainedUrl=window.location.href;await click("Sign in");expect(auth.open).toHaveBeenCalledWith("signin");expect(window.location.href).toBe(retainedUrl);
 });
 it("rejects an incomplete copied URL without making an unpinned body request",async()=>{
  window.history.replaceState({},"","/research?doc_id=report-one&source_pdf_sha256="+selection.sourcePdfSha256);
  await mount(<ResearchWorkspace ownerKey={A}/>);await library();
  expect(container.textContent).toContain("reading link is incomplete or invalid");expect(held).toHaveLength(1);
 });
 it("reopens the copied exact tuple with both hashes at segment0",async()=>{
  window.history.replaceState({},"",readingHref(selection));await mount(<ResearchWorkspace ownerKey={A}/>);
  expect(held[1].url).toContain(selection.sourcePdfSha256);expect(held[1].url).toContain(selection.extractedTextSha256);
  await answer(1,body());expect(container.textContent).toContain("PRIVATE SELECTED SOURCE");
 });
 it("distinguishes denial and search unavailability from an empty library",async()=>{
  await mount(<ResearchWorkspace ownerKey={A}/>);await library();await click("Open current revision");await answer(1,{error:"paid_required"},402);
  expect(container.textContent).toContain("requires current Pro access");expect(container.querySelector('a[href="/plans.html"]')).toBeTruthy();
  await mount(<ResearchWorkspace ownerKey={B}/>); // identity mismatch never keeps A's private state.
  expect(container.textContent).not.toContain(selection.sourcePdfSha256);
 });
});

const today={schema:"mastermind.macro_command_read.v1",state:"partial",source:{served_root_qualified:true,manifest_generated_at:"2026-10-20T10:00:00Z",manifest_sha256:"d".repeat(64),composed_at:"2099-01-01T00:00:00Z"},read:{as_of:"2026-10-18",as_of_display:{en:"18 October 2026",zh:"2026年10月18日"},as_of_meaning:{en:"Oldest dated reading",zh:"最早读数"},clauses:[{topic:{en:"Liquidity",zh:"流动性"},predicate:{en:"is mixed",zh:"不均衡"},punct:{en:".",zh:"。"},section:"liquidity"}],omitted:true},strip:[{id:"liquidity",section:"liquidity",label:{en:"Liquidity",zh:"流动性"},value:{en:"Mixed",zh:"不均衡"},tone:"neutral",null:false,cause:null,note:null,meaning:null,as_of:"2026-10-18",as_of_display:{en:"18 October 2026",zh:"2026年10月18日"}}],coverage:{available:2,total:5},sections:[{id:"liquidity",label:{en:"Liquidity",zh:"流动性"},href:"/macro_monetary.html#liquidity"}],workspaces:[{workspace_id:"liquidity",title:{en:"Liquidity source",zh:"流动性来源"},state:"STALE_SOURCE",effective_date:"2026-10-18",calculation_as_of:"2026-10-19",failure:null,availability:{},href:"/macro_liquidity.html"}]};
describe("Today source coverage",()=>{
 it("uses final owner coverage/source clocks and keeps market overview separate",async()=>{
  await mount(<TodayWorkspace ownerKey={A}/>);await answer(0,today);
  expect(container.textContent).toContain("2 of 5 sections have verified owner coverage");expect(container.textContent).toContain("18 October 2026");expect(container.textContent).not.toContain("2099-01-01");
  expect(container.textContent).toContain("Source is behind");expect(container.querySelector('a[href="/macro.html"]')).toBeTruthy();expect(container.querySelector('a[href="/macro_monetary.html"]')).toBeTruthy();
 });
 it("a503 remains unavailable with retry, never a quiet market or zero coverage",async()=>{
  await mount(<TodayWorkspace ownerKey={A}/>);await answer(0,{error:"macro command unavailable"},503);
  expect(container.textContent).toContain("does not mean markets are quiet");expect(container.textContent).not.toContain("0 of");await click("Try again");expect(held).toHaveLength(2);
 });
 it("clears a visible Today response immediately when the account ends",async()=>{
  await mount(<TodayWorkspace ownerKey={A}/>);await answer(0,today);expect(container.textContent).toContain("Liquidity is mixed");await act(async()=>auth.listener!("SIGNED_OUT",null));expect(container.textContent).not.toContain("Liquidity is mixed");expect(container.textContent).toContain("Private readings have been cleared");
 });
});
