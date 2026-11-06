// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import InvestigationWorkspace from "@/components/workspaces/InvestigationWorkspace";
const locale = vi.hoisted(() => ({ lang: "en" }));
vi.mock("@/lib/i18n", () => ({ useLang: () => locale }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } }) }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const principal = "10000000-0000-4000-8000-000000000001", owner = `account:${principal}`;
const command = { id: "20000000-0000-4000-8000-000000000002", operation_id: "30000000-0000-4000-8000-000000000003", expected_revision: 0, action: "create",
  manifest: { schema: "investigation_manifest.v2", intent: { title: "Original draft", question: "Exact question", subjects: [] }, layout_refs: [], thesis_refs: [], evidence_refs: [], continuation: {} } };
const key = `mm.investigation.pending.v2:${encodeURIComponent(owner)}`;
const retained = JSON.stringify({ owner, command });
const capture={schema:"investigation_scenario_reference.v1",model_version:"exposure-scenario/v1",inputs:{targetSpot:600,deltaSigmaPts:1,days:1},
 source:{owner:"options_hub",root:"SPX",session:"2026-10-16",source_as_of:"2026-10-16t15:30:00z",evaluated_at:"2026-10-16T15:45:00Z",lens:{kind:"one",exp:"2026-10-30"},selection_key:"2026-10-30|2026-10-30T09:30:00-04:00,2026-10-30|2026-10-30T16:00:00-04:00",basis_sha256:"a".repeat(64),gex:{sha256:"b".repeat(64),byte_length:2048},moves:null}};
let el: HTMLDivElement, root: Root;
const fetcher = vi.fn();
beforeEach(() => { sessionStorage.clear(); sessionStorage.setItem(key, retained); fetcher.mockReset(); vi.stubGlobal("fetch", fetcher); el = document.createElement("div"); document.body.append(el); root = createRoot(el); });
afterEach(async () => { await act(async () => root.unmount()); el.remove(); vi.unstubAllGlobals(); });
async function mount(outcome: unknown) {
  fetcher.mockImplementation(async (url: string) => ({ json: async () => (url.includes("operation_id=")||url==="/api/investigations/operation-read") ? outcome : url === "/api/layouts" ? { layouts: [] } : { status: "listed", items: [] } }));
  await act(async () => { root.render(<InvestigationWorkspace ownerKey={owner} />); for (let i = 0; i < 12; i++) await Promise.resolve(); });
}
it.each(["en", "zh"])("shows a bound durable fence with retained draft and no original retry (%s)", async lang => {
  locale.lang = lang;
  await mount({ status: "not_applied", id: command.id, operation_id: command.operation_id, read_principal: principal, read_operation_id: command.operation_id, read_binding: "stored_no_effect" });
  expect(el.textContent).toContain(lang === "zh" ? "原请求已记录为未执行" : "original request was recorded as not applied");
  expect(el.textContent).toContain("Exact question");
  expect([...el.querySelectorAll("button")].some(b => b.textContent === (lang === "zh" ? "重试原保存请求" : "Retry original save"))).toBe(false);
  expect(sessionStorage.getItem(key)).toBe(retained);
  expect(fetcher.mock.calls.filter(([u, init]) => u === "/api/investigations" && init?.method === "POST")).toHaveLength(0);
  const start = [...el.querySelectorAll("button")].find(b => b.textContent === (lang === "zh" ? "开始新研究" : "Start new research"));
  expect(start).toBeDefined();
  await act(async () => start!.click());
  expect(sessionStorage.getItem(key)).toBeNull();
  expect(fetcher.mock.calls.filter(([u, init]) => u === "/api/investigations" && init?.method === "POST")).toHaveLength(0);
});
it.each(["en", "zh"])("keeps a receipt miss or incomplete fence UNKNOWN without a mutation (%s)", async lang => {
  locale.lang = lang;
  await mount({ status: "not_found" });
  expect(el.textContent).toContain(lang === "zh" ? "保存结果尚未确认" : "save outcome is not confirmed");
  expect(sessionStorage.getItem(key)).toBe(retained);
  expect(fetcher.mock.calls.filter(([u, init]) => u === "/api/investigations" && init?.method === "POST")).toHaveLength(0);
});

it.each(["en", "zh"])("keeps a scenario capture UNKNOWN after the canonical fence and prevents new drafts (%s)", async lang => {
 locale.lang=lang;
 const scenario_capture={schema:"investigation_scenario_reference.v1",model_version:"exposure-scenario/v1",inputs:{targetSpot:600,deltaSigmaPts:1,days:1},
  source:{owner:"options_hub",root:"SPX",session:"2026-10-16",source_as_of:"2026-10-16t15:30:00z",evaluated_at:"2026-10-16T15:45:00Z",lens:{kind:"one",exp:"2026-10-30"},selection_key:"2026-10-30|2026-10-30T09:30:00-04:00,2026-10-30|2026-10-30T16:00:00-04:00",basis_sha256:"a".repeat(64),gex:{sha256:"b".repeat(64),byte_length:2048},moves:null}};
 const original={...command,manifest:{...command.manifest,scenario_capture}};
 sessionStorage.setItem(key,JSON.stringify({owner,command:original}));
 await mount({status:"not_applied",id:command.id,operation_id:command.operation_id,read_principal:principal,read_operation_id:command.operation_id,read_binding:"stored_no_effect"});
 expect(el.textContent).toContain(lang==="zh"?"私有来源捕获结果仍未知":"private source capture outcome is still unknown");
 expect([...el.querySelectorAll("button")].some(b=>b.textContent===(lang==="zh"?"重试原保存请求":"Retry original save"))).toBe(false);
 const start=[...el.querySelectorAll("button")].find(b=>b.textContent===(lang==="zh"?"开始新研究":"Start new research"));
 expect(start?.disabled).toBe(true);
 expect(JSON.parse(sessionStorage.getItem(key)!).command).toEqual(original);
 const check=[...el.querySelectorAll("button")].find(b=>b.textContent===(lang==="zh"?"检查原请求结果":"Check original outcome"));
 const before=fetcher.mock.calls.filter(([u])=>(String(u).includes("operation_id=")||u==="/api/investigations/operation-read")).length;
 await act(async()=>{check!.click();for(let i=0;i<8;i++)await Promise.resolve();});
 expect(fetcher.mock.calls.filter(([u])=>(String(u).includes("operation_id=")||u==="/api/investigations/operation-read"))).toHaveLength(before+1);
 expect(fetcher.mock.calls.filter(([u,init])=>u==="/api/investigations"&&init?.method==="POST")).toHaveLength(0);
});

it.each(["rejected","committed"])("does not let a late canonical POST %s erase a newer native-capture UNKNOWN fence, including after reload",async late=>{
 locale.lang="en";
 const original={...command,manifest:{...command.manifest,scenario_capture:capture}};
 sessionStorage.setItem(key,JSON.stringify({owner,command:original}));
 await mount({status:"not_found"});
 let finishPost!:(v:unknown)=>void;
 const post=new Promise(resolve=>{finishPost=resolve;});
 fetcher.mockImplementation(async(url:string,init?:RequestInit)=>{
  if(url==="/api/investigations"&&init?.method==="POST")return post;
  return{json:async()=>(url.includes("operation_id=")||url==="/api/investigations/operation-read")?{status:"not_applied",id:command.id,operation_id:command.operation_id,read_principal:principal,read_operation_id:command.operation_id,read_binding:"stored_no_effect"}:url==="/api/layouts"?{layouts:[]}:{status:"listed",items:[]}};
 });
 const button=(text:string)=>[...el.querySelectorAll("button")].find(b=>b.textContent===text)!;
 await act(async()=>{button("Retry original save").click();await Promise.resolve();});
 expect(fetcher.mock.calls.filter(([u,init])=>u==="/api/investigations"&&init?.method==="POST")).toHaveLength(1);
 await act(async()=>{button("Check original outcome").click();for(let i=0;i<8;i++)await Promise.resolve();});
 expect(el.textContent).toContain("private source capture outcome is still unknown");
 const body=late==="committed"?{status:"committed",id:command.id,revision:1,lifecycle:"active",manifest:original.manifest,committed_at:"2026-11-05T01:00:00Z"}:{status:"version_conflict",current_revision:9};
 await act(async()=>{finishPost({json:async()=>body});for(let i=0;i<8;i++)await Promise.resolve();});
 expect(el.textContent).toContain("private source capture outcome is still unknown");
 expect(button("Start new research").disabled).toBe(true);
 expect(button("Retry original save")).toBeUndefined();
 if(late==="committed")expect(el.textContent).toContain("Canonical save recorded · Revision 1");
 const retainedUnknown=JSON.parse(sessionStorage.getItem(key)!);
 expect(retainedUnknown.command).toEqual(original);
 expect(retainedUnknown.capture_outcome).toBe("unknown_after_canonical_not_applied");
 await act(async()=>root.unmount());root=createRoot(el);
 await act(async()=>{root.render(<InvestigationWorkspace ownerKey={owner}/>);for(let i=0;i<12;i++)await Promise.resolve();});
 expect(el.textContent).toContain("private source capture outcome is still unknown");
 expect(button("Start new research").disabled).toBe(true);
 expect(fetcher.mock.calls.filter(([u,init])=>u==="/api/investigations"&&init?.method==="POST")).toHaveLength(1);
});
