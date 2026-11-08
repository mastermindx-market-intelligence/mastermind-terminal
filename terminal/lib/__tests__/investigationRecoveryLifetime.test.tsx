// @vitest-environment jsdom
// Controlled lifecycle/navigation only. No browser, backend, issuer or source-byte access.
import React,{act,useLayoutEffect,type ComponentProps,type ReactNode} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import InvestigationWorkspace from "@/components/workspaces/InvestigationWorkspace";
import SavedScenarioCapture from "@/components/research/SavedScenarioCapture";
import {owner,principal,command,bound} from "./investigationNativeRecovery.fixture";

const context=vi.hoisted(()=>({userId:"10000000-0000-4000-8000-000000000001",lang:"en" as "en"|"zh"}));
const links=vi.hoisted(()=>({values:[] as Array<{href:string;prefetch?:boolean;onNavigate?:(event:{preventDefault:()=>void})=>void}>}));
vi.mock("@/components/chrome/AppShell",()=>({useShellIdentity:()=>({kind:"account",userId:context.userId,email:"controlled@test.invalid"})}));
vi.mock("@/lib/i18n",()=>({useLang:()=>({lang:context.lang})}));
vi.mock("@/lib/useInvestigationTheme",()=>({useInvestigationTheme:()=>"dark"}));
vi.mock("@/components/research/SavedScenarioRead",()=>({default:()=>null}));
vi.mock("@/lib/supabase/investigationAuthOwner",()=>({subscribeInvestigationAuthOwner:(publish:(value:unknown)=>void)=>{
 const snapshot={availability:"ready",principal_partition:`account:${context.userId}`,auth_epoch:"controlled-current-epoch"};let active=true;
 publish(snapshot);return{getSnapshot:()=>active?snapshot:null,unsubscribe(){active=false;}};
}}));
// Canonical Next Link contract boundary: record its real supplied navigation hook,
// href and prefetch value. No router, navigation or prefetch executes here.
vi.mock("next/link",()=>({default:({children,href,prefetch,onNavigate,...rest}:ComponentProps<"a">&{href:string;prefetch?:boolean;onNavigate?:(event:{preventDefault:()=>void})=>void})=>{
 links.values.push({href,prefetch,onNavigate});return <a {...rest} href={href}>{children}</a>;
}}));
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const nextUser="60000000-0000-4000-8000-000000000006";
const journalKey=`mm.investigation.pending.v2:${encodeURIComponent(owner)}`;
const capture=command.manifest.scenario_capture!;
const fetcher=vi.fn();let host:HTMLDivElement,root:Root;
const reply=(value:unknown,status=200)=>Promise.resolve(new Response(JSON.stringify(value),{status}));
const flush=async()=>{for(let n=0;n<10;n++)await Promise.resolve();};
const button=(label:string)=>[...host.querySelectorAll<HTMLButtonElement>("button")].find(node=>node.textContent===label)!;
async function render(value:ReactNode){await act(async()=>{root.render(value);await flush();});}
async function fill(label:string,value:string){
 const el=host.querySelector<HTMLInputElement|HTMLTextAreaElement>(`[aria-label="${label}"]`)!;expect(el).not.toBeNull();
 await act(async()=>{Object.getOwnPropertyDescriptor(el instanceof HTMLInputElement?HTMLInputElement.prototype:HTMLTextAreaElement.prototype,"value")!.set!.call(el,value);el.dispatchEvent(new Event("input",{bubbles:true}));});
}
function CommitProbe({children,token,samples}:{children:ReactNode;token:string;samples:string[]}){
 useLayoutEffect(()=>{samples.push(host.textContent??"");},[token,samples]);return children;
}
function InputProbe({children,token,samples}:{children:ReactNode;token:string;samples:string[]}){
 useLayoutEffect(()=>{samples.push(host.querySelector<HTMLInputElement>('input[aria-label="Title"]')?.value??"");},[token,samples]);return children;
}
beforeEach(()=>{
 context.userId=principal;context.lang="en";links.values=[];sessionStorage.clear();fetcher.mockReset();
 fetcher.mockImplementation((url:string)=>reply(url==="/api/layouts"?{layouts:[]}:url==="/api/investigations/operation-read"?{status:"unavailable"}:{status:"listed",items:[]}));
 vi.stubGlobal("React",React);vi.stubGlobal("fetch",fetcher);host=document.createElement("div");document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});

it("standalone owner switch never commits the previous private draft before passive effects",async()=>{
 const samples:string[]=[];
 await render(<InputProbe token={principal} samples={samples}><SavedScenarioCapture inputs={capture.inputs} sourceReference={capture.source} lang="en"/></InputProbe>);
 await fill("Title","PRIVATE OWNER A DRAFT");await fill("Question","PRIVATE OWNER A QUESTION");
 context.userId=nextUser;
 await render(<InputProbe token={nextUser} samples={samples}><SavedScenarioCapture inputs={capture.inputs} sourceReference={capture.source} lang="en"/></InputProbe>);
 expect(samples.at(-1)).toBe("");expect(host.textContent).not.toContain("PRIVATE OWNER A");expect(fetcher).not.toHaveBeenCalled();
 expect(sessionStorage.length).toBe(0);
});

it("Workspace owner switch has a new state lifetime before its first layout observation",async()=>{
 sessionStorage.setItem(journalKey,JSON.stringify({owner,command}));const samples:string[]=[];
 await render(<InputProbe token={owner} samples={samples}><InvestigationWorkspace ownerKey={owner}/></InputProbe>);
 expect(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Research question"]')?.value).toBe(command.manifest.intent.question);
 const retained=sessionStorage.getItem(journalKey);
 context.userId=nextUser;
 await render(<InputProbe token={nextUser} samples={samples}><InvestigationWorkspace ownerKey={`account:${nextUser}`}/></InputProbe>);
 expect(samples.at(-1)).toBe("");
 expect(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Research question"]')).toBeNull();
 expect(sessionStorage.getItem(journalKey)).toBe(retained);
 expect(fetcher.mock.calls.some(([url,init])=>url==="/api/investigations"&&["POST","PUT"].includes(init?.method))).toBe(false);
});

it("same-owner entry change removes the previous selected detail before the new entry commits",async()=>{
 const samples:string[]=[];let holdNext=false;
 fetcher.mockImplementation((url:string)=>{
  if(url.includes(`id=${command.id}`))return reply({status:"found",id:command.id,revision:1,current_revision:1,lifecycle:"active",manifest:command.manifest,layouts:[],committed_at:"2026-11-01T00:00:00Z"});
  if(url.includes(`id=${nextUser}`)&&holdNext)return new Promise(()=>{});
  return reply(url==="/api/layouts"?{layouts:[]}:{status:"listed",items:[]});
 });
 await render(<CommitProbe token="old" samples={samples}><InvestigationWorkspace ownerKey={owner} initialInvestigationId={command.id} initialRevision={1}/></CommitProbe>);
 expect(host.textContent).toContain(command.manifest.intent.question);holdNext=true;
 await render(<CommitProbe token="new" samples={samples}><InvestigationWorkspace ownerKey={owner} initialInvestigationId={nextUser} initialRevision={1}/></CommitProbe>);
 expect(samples.at(-1)).not.toContain(command.manifest.intent.question);expect(host.textContent).not.toContain(command.manifest.intent.question);
});

it("locale-only rerender preserves the same-owner unsaved draft and creates no request",async()=>{
 await render(<SavedScenarioCapture inputs={capture.inputs} sourceReference={capture.source} lang="en"/>);
 await fill("Title","Same owner title");
 await render(<SavedScenarioCapture inputs={capture.inputs} sourceReference={capture.source} lang="zh"/>);
 expect(host.querySelector<HTMLInputElement>('input[aria-label="标题"]')?.value).toBe("Same owner title");
 expect(fetcher).not.toHaveBeenCalled();expect(sessionStorage.length).toBe(0);
});

it("a delayed native reply after standalone unmount cannot clear or replace its original journal",async()=>{
 sessionStorage.setItem(journalKey,JSON.stringify({owner,command}));let finish!:(value:Response)=>void;
 fetcher.mockImplementation(()=>new Promise<Response>(resolve=>{finish=resolve;}));
 await render(<SavedScenarioCapture inputs={capture.inputs} sourceReference={capture.source} lang="en"/>);
 await act(async()=>{button("Check original outcome").click();await flush();});
 const retained=sessionStorage.getItem(journalKey),signal=fetcher.mock.calls[0][1].signal;
 await render(<div>unmounted</div>);expect(signal.aborted).toBe(true);
 await act(async()=>{finish(new Response(JSON.stringify(bound()),{status:200}));await flush();});
 expect(sessionStorage.getItem(journalKey)).toBe(retained);expect(fetcher).toHaveBeenCalledTimes(1);
});

it.each(["occupied","committed"] as const)("%s saved-research handoff uses full document navigation, exact selectors and no prefetch",async state=>{
 let savedCommand:typeof command|undefined;
 if(state==="occupied")sessionStorage.setItem(journalKey,JSON.stringify({owner,command:{...command,manifest:{...command.manifest,scenario_capture:{...capture,inputs:{...capture.inputs,targetSpot:601}}}}}));
 else fetcher.mockImplementation((url:string,init?:RequestInit)=>{
  if(init?.method==="POST"){
   savedCommand=JSON.parse(String(init.body));const sent=savedCommand!;
   return reply({status:"committed",id:sent.id,revision:1,lifecycle:"active",manifest:sent.manifest,committed_at:"2026-11-01T00:00:00Z",investigation_id:sent.id,sequence:1,revision_id:nextUser,operation_id:sent.operation_id,author_ref:principal,parent_revision_id:null,recorded_at:"2026-11-01T00:00:00Z",manifest_digest:"a".repeat(64)});
  }
  return reply({status:"found",revision:1,manifest:savedCommand!.manifest});
 });
 await render(<SavedScenarioCapture inputs={capture.inputs} sourceReference={capture.source} lang="en"/>);
 if(state==="committed"){
  await fill("Title","Source reference only");await fill("Question","What changed?");
  await act(async()=>{host.querySelector<HTMLButtonElement>('[data-testid="scenario-save"]')!.click();await flush();});
 }
 const link=links.values.at(-1)!;expect(link).toBeDefined();expect(link.prefetch).toBe(false);expect(link.onNavigate).toBeTypeOf("function");
 const expected=state==="occupied"?"/analysis?view=investigations":`/analysis?view=investigations&investigation=${savedCommand!.id}&revision=1`;
 expect(link.href).toBe(expected);const assign=vi.fn(),preventDefault=vi.fn();
 const actualWindow=window;vi.stubGlobal("window",new Proxy(actualWindow,{get(target,key){return key==="location"?{assign}:Reflect.get(target,key);}}));
 link.onNavigate!({preventDefault});expect(preventDefault).toHaveBeenCalledTimes(1);expect(assign).toHaveBeenCalledTimes(1);expect(assign).toHaveBeenCalledWith(expected);
});
