// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import InvestigationWorkspace from "@/components/workspaces/InvestigationWorkspace";
import SavedScenarioCapture from "@/components/research/SavedScenarioCapture";
import {owner,principal,command,bound,native,committed,fence} from "./investigationNativeRecovery.fixture";
const locale=vi.hoisted(()=>({lang:"en"}));
const identity=vi.hoisted(()=>({kind:"account",userId:"10000000-0000-4000-8000-000000000001",email:"fixture@test"}));
vi.mock("@/lib/i18n",()=>({useLang:()=>locale}));
vi.mock("@/components/chrome/AppShell",()=>({useShellIdentity:()=>identity}));
vi.mock("@/lib/supabase/client",()=>({createClient:()=>({auth:{onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}})}));
(globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const key=`mm.investigation.pending.v2:${encodeURIComponent(owner)}`;
let root:Root,el:HTMLDivElement;const fetcher=vi.fn();
vi.mock("@/lib/useMarketPrefs",()=>({useAccountPrefs:()=>({owner:"fixture",ready:true,metaPrefs:{},appearanceRevision:0})}));
vi.mock("@/lib/supabase/investigationAuthOwner",()=>({subscribeInvestigationAuthOwner:(on:(s:unknown)=>void,observed:(p:string)=>void)=>{const snapshot={availability:"ready",principal_partition:`account:${identity.userId}`,auth_epoch:"native-recovery-joined"};on(snapshot);observed(snapshot.principal_partition);return{getSnapshot:()=>snapshot,unsubscribe(){}};}}));
const response=(v:unknown)=>({status:200,ok:true,json:async()=>v});
const metadata=(u:string)=>response(u==="/api/layouts"?{layouts:[]}:{status:"listed",items:[]});
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve()};
const button=(label:string)=>[...el.querySelectorAll<HTMLButtonElement>("button")].find(b=>b.textContent===label)!;
beforeEach(()=>{locale.lang="en";identity.userId=principal;sessionStorage.clear();sessionStorage.setItem(key,JSON.stringify({owner,command}));fetcher.mockReset();vi.stubGlobal("fetch",fetcher);el=document.createElement("div");document.body.append(el);root=createRoot(el)});
afterEach(async()=>{await act(async()=>root.unmount());el.remove();vi.unstubAllGlobals()});
it.each(["en","zh"])("Workspace recovers exact owner/full-command without capture, then permits deliberate new draft (%s)",async lang=>{
 locale.lang=lang;fetcher.mockImplementation(async(u:string)=>u==="/api/investigations/operation-read"?response(bound()):metadata(u));
 await act(async()=>{root.render(<InvestigationWorkspace ownerKey={owner}/>);await flush()});
 const reads=fetcher.mock.calls.filter(([u])=>u==="/api/investigations/operation-read");expect(reads).toHaveLength(1);expect(JSON.parse(reads[0][1].body)).toEqual(command);
 expect(reads[0][1].headers["x-mm-scenario-owner"]).toBe(principal);
 expect(el.querySelector('[data-testid="native-operation-facts"]')?.textContent).toContain(lang==="zh"?"不是当前私有来源访问权限":"does not grant current private-source access");
 expect(fetcher.mock.calls.some(([u,init])=>u==="/api/investigations"&&init?.method==="POST")).toBe(false);
 expect(sessionStorage.getItem(key)).not.toBeNull();
 await act(async()=>{button(lang==="zh"?"开始新研究":"Start new research").click();await flush()});
 expect(sessionStorage.getItem(key)).toBeNull();
});
it("Workspace ignores a late original-owner response after identity changes",async()=>{
 let finish!:(value:unknown)=>void;const held=new Promise(resolve=>{finish=resolve});
 fetcher.mockImplementation(async(u:string)=>u==="/api/investigations/operation-read"?held:metadata(u));
 await act(async()=>{root.render(<InvestigationWorkspace ownerKey={owner}/>);await flush()});
 await act(async()=>{root.render(<InvestigationWorkspace ownerKey={`account:${command.id}`}/>);await flush()});
 await act(async()=>{finish(response(bound()));await flush()});
 expect(el.querySelector('[data-testid="native-operation-facts"]')).toBeNull();expect(sessionStorage.getItem(key)).not.toBeNull();
 expect(el.textContent).not.toContain(command.manifest.intent.question);
});
it("Workspace retains both phases and journal through a pending read/reload, with no retry",async()=>{
 fetcher.mockImplementation(async(u:string)=>u==="/api/investigations/operation-read"?response(bound(native("started","not_applied"))):metadata(u));
 await act(async()=>{root.render(<InvestigationWorkspace ownerKey={owner}/>);await flush()});
 expect(button("Start new research").disabled).toBe(true);expect(button("Retry original save")).toBeUndefined();
 expect(el.querySelector('[data-testid="native-operation-facts"]')?.textContent).toContain("not confirmed finished");
 expect(el.querySelector('[data-testid="native-operation-facts"]')?.textContent).toContain("save not applied");
 const raw=sessionStorage.getItem(key)!;expect(raw).not.toContain("nativeObservation");expect(raw).toContain("native_participant_unresolved");
 await act(async()=>root.unmount());root=createRoot(el);
 await act(async()=>{root.render(<InvestigationWorkspace ownerKey={owner}/>);await flush()});
 expect(fetcher.mock.calls.filter(([u])=>u==="/api/investigations/operation-read")).toHaveLength(2);
 expect(button("Start new research").disabled).toBe(true);
});
it.each(["en","zh"])("standalone reload checks exact capture read-only, preserves current rights and deliberate new-draft boundary (%s)",async lang=>{
 const capture=command.manifest.scenario_capture!;
 fetcher.mockResolvedValue(response(bound()));
 await act(async()=>{root.render(<SavedScenarioCapture inputs={capture.inputs} sourceReference={capture.source} lang={lang as "en"|"zh"}/>);await flush()});
 expect(fetcher).not.toHaveBeenCalled();
 expect(button(lang==="zh"?"检查原请求结果":"Check original outcome"),el.textContent??"").toBeDefined();
 await act(async()=>{button(lang==="zh"?"检查原请求结果":"Check original outcome").click();await flush()});
 expect(fetcher).toHaveBeenCalledTimes(1);expect(fetcher.mock.calls[0][0]).toBe("/api/investigations/operation-read");expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual(command);
 expect(sessionStorage.getItem(key)).not.toBeNull();
 expect(el.querySelector('[data-testid="native-operation-facts"]')?.textContent).toContain(lang==="zh"?"不是当前私有来源访问权限":"does not grant current private-source access");
 await act(async()=>{root.render(<SavedScenarioCapture inputs={capture.inputs} sourceReference={null} lang={lang as "en"|"zh"}/>);await flush()});
 expect((el.querySelector('[data-testid="scenario-save"]') as HTMLButtonElement).disabled).toBe(true);
 await act(async()=>{button(lang==="zh"?"开始新方案草稿":"Start a new scenario draft").click();await flush()});
 expect(sessionStorage.getItem(key)).toBeNull();expect(fetcher).toHaveBeenCalledTimes(1);
});
it("standalone refuses another capture and does not adopt another original command",async()=>{
 const capture=command.manifest.scenario_capture!;
 await act(async()=>{root.render(<SavedScenarioCapture inputs={{...capture.inputs,targetSpot:601}} sourceReference={capture.source} lang="en"/>);await flush()});
 expect(el.textContent).toContain("previous save");expect(button("Check original outcome")).toBeUndefined();expect(fetcher).not.toHaveBeenCalled();
});

it("standalone ignores an older started response after a newer terminal read",async()=>{
 const capture=command.manifest.scenario_capture!;let finish!:(v:unknown)=>void;const delayed=new Promise(resolve=>{finish=resolve});
 fetcher.mockImplementationOnce(()=>delayed).mockResolvedValue(response(bound()));
 await act(async()=>{root.render(<SavedScenarioCapture inputs={capture.inputs} sourceReference={capture.source} lang="en"/>);await flush()});
 await act(async()=>{button("Check original outcome").click();await flush()});
 await act(async()=>{button("Check original outcome").click();await flush()});
 expect(button("Start a new scenario draft")).toBeDefined();
 await act(async()=>{finish(response(bound(native("started","pending"))));await flush()});
 expect(button("Start a new scenario draft")).toBeDefined();expect(el.querySelector('[data-testid="native-operation-facts"]')?.textContent).toContain("writes finished");
 expect(sessionStorage.getItem(key)).not.toBeNull();
});
it("standalone discards late owner data and preserves that owner's original journal",async()=>{
 const capture=command.manifest.scenario_capture!;let finish!:(v:unknown)=>void;const delayed=new Promise(resolve=>{finish=resolve});fetcher.mockReturnValue(delayed);
 await act(async()=>{root.render(<SavedScenarioCapture inputs={capture.inputs} sourceReference={capture.source} lang="en"/>);await flush()});
 await act(async()=>{button("Check original outcome").click();await flush()});
 identity.userId=command.id;
 await act(async()=>{root.render(<SavedScenarioCapture inputs={capture.inputs} sourceReference={capture.source} lang="en"/>);await flush()});
 await act(async()=>{finish(response(bound()));await flush()});
 expect(el.querySelector('[data-testid="native-operation-facts"]')).toBeNull();expect(button("Start a new scenario draft")).toBeUndefined();expect(sessionStorage.getItem(key)).not.toBeNull();
});

it.each([["remove",1],["restore",1],["create",1],["revise",0]] as const)("standalone leaves %s/%s another intent occupied without Check/Retry/POST",async(action,expected_revision)=>{
 const capture=command.manifest.scenario_capture!;
 const original=JSON.stringify({owner,command:{...command,action,expected_revision}});sessionStorage.setItem(key,original);
 await act(async()=>{root.render(<SavedScenarioCapture inputs={capture.inputs} sourceReference={capture.source} lang="en"/>);await flush()});
 expect(el.textContent).toContain("previous save");expect(button("Check original outcome")).toBeUndefined();expect(button("Retry original save")).toBeUndefined();
 expect(fetcher).not.toHaveBeenCalled();expect(sessionStorage.getItem(key)).toBe(original);
});

it("Intl entry and canonical return remain present but cannot start policy/evidence writes while native capture is unresolved",async()=>{
 const selection={context:"intl-context:EZ:3m:local",generation:"im-workspace-generation:f180e9f4-eeee-488d-b312-5a68d09ccf5c",fingerprint:"a".repeat(64),fields:["policy_rate"]};
 const back="https://www.mastermind-x.com/intl.html?view=risk&market=EZ&pins=EZ,GB&horizon=3m&basis=local&return_basis=price&group=";
 fetcher.mockImplementation(async(u:string)=>u==="/api/investigations/operation-read"?response(bound(native("started","pending"))):metadata(u));
 await act(async()=>{root.render(<InvestigationWorkspace ownerKey={owner} initialIntlEntry={selection} intlReturnTo={back}/>);await flush()});
 expect(el.querySelector<HTMLAnchorElement>('a[href*="intl.html"]')?.href).toBe(back);
 expect(button("Start new research").disabled).toBe(true);
 expect(el.querySelector('[data-testid="native-operation-facts"]')?.textContent).toContain("save pending");
 expect(fetcher.mock.calls.filter(([u])=>u==="/api/investigations/operation-read")).toHaveLength(1);
 expect(fetcher.mock.calls.some(([u,init])=>u==="/api/investigations/policy-preview"||(u==="/api/investigations"&&["POST","PUT"].includes(init?.method)))).toBe(false);
 expect(sessionStorage.getItem(key)).not.toBeNull();
});

it.each([["workspace","committed"],["standalone","committed"],["workspace","not_applied"],["standalone","not_applied"]] as const)("old Scenario invalid_payload keeps native UNKNOWN after full-owner observation, then reaches native read (%s/%s)",async(surface,status)=>{
 sessionStorage.setItem(key,JSON.stringify({owner,command,phase:"rejected",reason:"invalid_payload"}));
 const canonical=status==="committed"?{...committed,read_binding:"native_lineage",read_principal:principal,read_operation_id:command.operation_id}:{...fence,read_binding:"stored_no_effect",read_principal:principal,read_operation_id:command.operation_id};
 const originalAnswer=status==="committed"?committed:{status:"not_applied",id:command.id,operation_id:command.operation_id};
 fetcher.mockImplementation(async(u:string,init?:RequestInit)=>{
  if(u==="/api/investigations/operation-read")return response(bound(native("retained",status),canonical));
  if(u==="/api/investigations"&&init?.method==="PUT")return response(originalAnswer);
  if(u.startsWith("/api/investigations?operation_id="))return response(originalAnswer);
  return metadata(u);
 });
 const capture=command.manifest.scenario_capture!;
 await act(async()=>{root.render(surface==="workspace"?<InvestigationWorkspace ownerKey={owner}/>:<SavedScenarioCapture inputs={capture.inputs} sourceReference={capture.source} lang="en"/>);await flush()});
 if(surface==="standalone")await act(async()=>{button("Check original outcome").click();await flush()});
 const puts=fetcher.mock.calls.filter(([u,init])=>u==="/api/investigations"&&init?.method==="PUT");
 expect(puts).toHaveLength(1);expect(JSON.parse(puts[0][1].body)).toEqual(command);
 expect(fetcher.mock.calls.filter(([u])=>u==="/api/investigations/operation-read")).toHaveLength(0);
 expect(sessionStorage.getItem(key)).not.toBeNull();
 expect(button("Retry original save")).toBeUndefined();
 if(surface==="workspace")expect(button("Start new research").disabled).toBe(true);
 else expect(button("Start a new scenario draft")).toBeUndefined();
 expect(fetcher.mock.calls.some(([u,init])=>u==="/api/investigations"&&init?.method==="POST")).toBe(false);
 await act(async()=>{button("Check original outcome").click();await flush()});
 expect(fetcher.mock.calls.filter(([u])=>u==="/api/investigations/operation-read")).toHaveLength(1);
 expect(fetcher.mock.calls.filter(([u,init])=>u==="/api/investigations"&&init?.method==="PUT")).toHaveLength(1);
 if(status==="not_applied"){
  expect(sessionStorage.getItem(key)).not.toBeNull();
  await act(async()=>{button(surface==="workspace"?"Start new research":"Start a new scenario draft").click();await flush()});
 }
 expect(sessionStorage.getItem(key)).toBeNull();
});
