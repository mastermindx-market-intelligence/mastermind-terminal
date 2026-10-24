// @vitest-environment jsdom
import React, {act} from "react";
import {createRoot, type Root} from "react-dom/client";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {createHash} from "node:crypto";
import InvestigationWorkspace from "@/components/workspaces/InvestigationWorkspace";
import {canonicalInvestigationJson} from "@/lib/investigationContracts";
import type {InvestigationCommand} from "@/lib/investigations";

vi.mock("@/lib/i18n",()=>({useLang:()=>({lang:"en"})}));
vi.mock("next/link",()=>({default:({children,href}:React.PropsWithChildren<{href:string}>)=><a href={href}>{children}</a>}));
vi.mock("@/lib/useInvestigationTheme",()=>({useInvestigationTheme:()=>"dark"}));
vi.mock("@/components/workspaces/InvestigationTheses",()=>({InvestigationThesisPicker:()=>null,InvestigationThesisReader:()=>null}));
vi.mock("@/components/workspaces/InvestigationEvidenceReview",()=>({default:()=>null}));
vi.mock("@/components/workspaces/InvestigationReplay",()=>({default:()=>null}));
const id="10000000-0000-4000-8000-000000000001";
const at="2026-10-13T00:00:00.000Z";
const original={schema:"investigation_manifest.v2",argument_relations:[],intent:{title:"Acknowledged revision one",question:"Preserve exact selected question",subjects:[]},layout_refs:[],thesis_refs:[],evidence_refs:[],continuation:{}};
let host:HTMLDivElement,root:Root,posts:InvestigationCommand[],saved:InvestigationCommand|null,failReadback:boolean;
const response=(body:unknown,status=200)=>Promise.resolve({ok:status<400,status,json:async()=>body} as Response);
const button=(name:string)=>[...host.querySelectorAll("button")].find(b=>b.textContent===name);
async function click(name:string){expect(button(name),name).toBeDefined();await act(async()=>button(name)!.click());}
beforeEach(()=>{
 vi.stubGlobal("React",React);vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);sessionStorage.clear();posts=[];saved=null;failReadback=true;
 host=document.createElement("div");document.body.append(host);root=createRoot(host);
 vi.stubGlobal("fetch",vi.fn((url:string,options?:RequestInit)=>{
  if(options?.method==="POST"){
   const c:InvestigationCommand=JSON.parse(String(options.body));posts.push(c);saved=c;
   return response({status:"committed",id:c.id,revision:2,current_revision:2,lifecycle:"active",manifest:c.manifest,committed_at:at,investigation_id:c.id,sequence:2,revision_id:"30000000-0000-4000-8000-000000000002",parent_revision_id:"30000000-0000-4000-8000-000000000001",operation_id:c.operation_id,author_ref:"40000000-0000-4000-8000-000000000001",recorded_at:at,manifest_digest:createHash("sha256").update(canonicalInvestigationJson(c.manifest)).digest("hex")});
  }
  if(options?.method==="PUT")throw Error("Unexpected recovery write");
  if(url==="/api/layouts")return response({layouts:[]});
  if(url==="/api/investigations")return response({status:"listed",items:[{id,revision:saved?2:1,lifecycle:"active",title:saved?"New acknowledged revision":"Acknowledged revision one",question:original.intent.question,updated_at:at}]});
  if(url.startsWith("/api/investigations?")){
   const q=new URL(url,"https://terminal.test").searchParams;
   if(saved&&q.get("revision")==="2"&&failReadback)return response({status:"unavailable"},503);
   return response({status:"found",id,revision:saved&&!failReadback?2:1,current_revision:saved?2:1,lifecycle:"active",manifest:saved&&!failReadback?saved.manifest:original,committed_at:at,layouts:[]});
  }
  throw Error(`Unexpected request ${url}`);
 }));
});
afterEach(()=>{act(()=>root.unmount());host.remove();sessionStorage.clear();vi.unstubAllGlobals();vi.restoreAllMocks();});

it("an older displayed detail cannot authorize duplicate after a committed revision fails exact readback",async()=>{
 await act(async()=>root.render(<InvestigationWorkspace ownerKey="local-preview" initialInvestigationId={id} initialRevision={1}/>));
 expect(button("Duplicate as new research")?.disabled).toBe(false);
 await click("Edit saved question");
 const title=host.querySelector<HTMLInputElement>('input[aria-label="Title"]')!;
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(title,"New acknowledged revision");title.dispatchEvent(new Event("input",{bubbles:true}));});
 await click("Save research");
 expect(posts).toHaveLength(1);expect(posts[0].action).toBe("revise");
 expect(window.location.search).toContain("revision=2");
 expect(host.textContent).toContain("Saved, but exact readback is unavailable.");
 await click("Cancel editing");
 expect(host.textContent).toContain("Acknowledged revision one");
 const staleDuplicate=button("Duplicate as new research");
 expect(!staleDuplicate||staleDuplicate.disabled).toBe(true);
 await act(async()=>staleDuplicate?.click());
 expect(host.querySelector('input[aria-label="Title"]')).toBeNull();expect(posts).toHaveLength(1);
 // A later exact acknowledged owner read, rather than the old detail object or toast, re-enables it.
 failReadback=false;
 const library=host.querySelector('[aria-label="Saved questions"]')!;
 const latest=[...library.querySelectorAll("button")].find(b=>b.textContent?.includes("New acknowledged revision"))!;
 await act(async()=>latest.click());
 expect(button("Duplicate as new research")?.disabled).toBe(false);
 await click("Duplicate as new research");
 expect(host.querySelector<HTMLInputElement>('input[aria-label="Title"]')?.value).toBe("New acknowledged revision");expect(posts).toHaveLength(1);
});
