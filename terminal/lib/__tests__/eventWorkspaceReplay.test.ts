import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {createHash} from "node:crypto";
import golden from "./fixtures/aapl-event-workspace.json";
import {resolveRetainedEventWorkspaceFromR2,resolveRetainedEventWorkspaceAtCutoff} from "../eventWorkspace";
const base="https://pub-f7ffb4441c5f4ad983ca56ec7c651c61.r2.dev",event=golden.event_id;
const sha=(value:string)=>createHash("sha256").update(value).digest("hex");
const a="a".repeat(24),b="b".repeat(24),c="c".repeat(24),dates=["2026-08-01T00:00:00Z","2026-08-02T00:00:00Z","2026-08-03T00:00:00Z"];
let files:Map<string,string>,calls:string[];
const key=(generation:string,file="manifest.json")=>`${base}/company_intelligence/event_workspaces/generations/${generation}/${file}`;
const allow=vi.fn(async(_workspace?:{generation_id:string})=>({allowed:true,policy_version:"fixture.context.v1",checked_at:"2026-10-04T00:00:00Z"}));
function add(generation:string,date:string,previous:string|null,correction=false){
 const workspace={...golden,generation_id:generation,generated_at:date,lifecycle:{...golden.lifecycle,observed_at:date},warnings:correction?golden.warnings.filter(w=>w!=="questions_count_unstructured"):golden.warnings};
 const wire=JSON.stringify(workspace);files.set(key(generation,`workspaces/${event}.json`),wire);
 files.set(key(generation),JSON.stringify({schema:"event_workspace_manifest.v2",generation_id:generation,generated_at:date,status:"ready",event_count:1,files:{[`workspaces/${event}.json`]:{sha256:sha(wire),bytes:Buffer.byteLength(wire)}},aliases:{[event]:event},authority:"context_only",warnings:[],previous_generation_id:previous,previous_manifest_sha256:previous?sha(files.get(key(previous))!):null}));
}
async function root(){const r=await resolveRetainedEventWorkspaceFromR2({event_id:event,generation_id:c,company_id:golden.issuer.company_id},base,{authorize:allow});if(!r.ok)throw Error(JSON.stringify(r));return {event_id:event,generation_id:c,company_id:golden.issuer.company_id,fingerprint:r.receipt.fingerprint};}
beforeEach(()=>{files=new Map();calls=[];allow.mockClear();allow.mockImplementation(async()=>({allowed:true,policy_version:"fixture.context.v1",checked_at:"2026-10-04T00:00:00Z"}));add(a,dates[0],null);add(b,dates[1],a,true);add(c,dates[2],b,true);vi.stubGlobal("fetch",vi.fn(async(url:string)=>{calls.push(String(url));const body=files.get(String(url));return new Response(body??"",{status:body?200:404});}));});
afterEach(()=>vi.unstubAllGlobals());
describe("retained Earnings platform snapshot replay",()=>{
 it("selects the original before correction and corrected snapshot after correction",async()=>{
  const pin=await root();const before=await resolveRetainedEventWorkspaceAtCutoff(pin,{policy:"platform_snapshot",cutoff:"2026-08-01T12:00:00Z"},base,{authorize:allow});
  expect(before).toMatchObject({ok:true,workspace:{generation_id:a},replay:{policy:"platform_snapshot",root_generation_id:c,selected_generation_id:a,scope:"retained_chain_through_saved_baseline",steps:3}});
  const after=await resolveRetainedEventWorkspaceAtCutoff(pin,{policy:"platform_snapshot",cutoff:"2026-08-02T12:00:00Z"},base,{authorize:allow});expect(after).toMatchObject({ok:true,workspace:{generation_id:b}});
  if(before.ok&&after.ok){expect(before.workspace.warnings).toContain("questions_count_unstructured");expect(after.workspace.warnings).not.toContain("questions_count_unstructured");}
  expect(calls.every(url=>url.includes("/generations/"))).toBe(true);
 });
 it("does not show the original before the earliest retained snapshot",async()=>{
  expect(await resolveRetainedEventWorkspaceAtCutoff(await root(),{policy:"platform_snapshot",cutoff:"2026-07-31T00:00:00Z"},base,{authorize:allow})).toMatchObject({ok:false,reason:"no_retained_snapshot_at_cutoff"});
 });
 it("refuses public-known and user-seen replay instead of treating release time as every row's availability",async()=>{
  const pin=await root();calls=[];for(const policy of ["public_known","user_seen"] as const)expect(await resolveRetainedEventWorkspaceAtCutoff(pin,{policy,cutoff:dates[2]},base,{authorize:allow})).toMatchObject({ok:false,reason:"unsupported_policy"});expect(calls).toHaveLength(0);
 });
 it("requires a fingerprint and a timezone-qualified valid cutoff",async()=>{
  const pin=await root();calls=[];for(const cutoff of ["2026-08-01","2026-08-01T00:00:00","not-a-date","2026-02-30T00:00:00Z"])expect(await resolveRetainedEventWorkspaceAtCutoff(pin,{policy:"platform_snapshot",cutoff},base,{authorize:allow})).toMatchObject({ok:false,reason:"invalid_reference"});
  expect(await resolveRetainedEventWorkspaceAtCutoff({...pin,fingerprint:undefined},{policy:"platform_snapshot",cutoff:dates[2]},base,{authorize:allow})).toMatchObject({ok:false,reason:"invalid_reference"});expect(calls).toHaveLength(0);
 });
 it("fails closed on a missing or tampered intermediate manifest without current fallback",async()=>{
  const pin=await root();files.delete(key(b));expect(await resolveRetainedEventWorkspaceAtCutoff(pin,{policy:"platform_snapshot",cutoff:dates[0]},base,{authorize:allow})).toMatchObject({ok:false,reason:"missing_history"});
  add(b,dates[1],a);expect(await resolveRetainedEventWorkspaceAtCutoff(pin,{policy:"platform_snapshot",cutoff:dates[0]},base,{authorize:allow})).toMatchObject({ok:false,reason:"invalid_history"});
 });
 it("reauthorizes the selected generation and never uses saved rights as a grant",async()=>{
  const pin=await root();allow.mockImplementation(async()=>({allowed:false,policy_version:"fixture.revoked",checked_at:"2026-10-04T00:00:00Z"}));expect(await resolveRetainedEventWorkspaceAtCutoff(pin,{policy:"platform_snapshot",cutoff:dates[1]},base,{authorize:allow})).toMatchObject({ok:false,reason:"denied"});
 });
 it("rejects a history link that moves forwards in platform time",async()=>{
  add(b,"2026-08-04T00:00:00Z",a);add(c,dates[2],b);expect(await resolveRetainedEventWorkspaceAtCutoff(await root(),{policy:"platform_snapshot",cutoff:dates[0]},base,{authorize:allow})).toMatchObject({ok:false,reason:"invalid_history"});
 });
 it("does not walk past an absent event at the selected platform snapshot",async()=>{
  const raw=JSON.parse(files.get(key(b))!);raw.files={};raw.event_count=0;files.set(key(b),JSON.stringify(raw));add(c,dates[2],b);
  expect(await resolveRetainedEventWorkspaceAtCutoff(await root(),{policy:"platform_snapshot",cutoff:dates[1]},base,{authorize:allow})).toMatchObject({ok:false,reason:"selected_snapshot_unavailable"});
 });
 it("checks the selected older generation's rights independently from the permitted root",async()=>{
  const pin=await root();allow.mockClear();allow.mockImplementation(async workspace=>({allowed:workspace?.generation_id===c,policy_version:"fixture.selected_denied",checked_at:"2026-10-04T00:00:00Z"}));
  expect(await resolveRetainedEventWorkspaceAtCutoff(pin,{policy:"platform_snapshot",cutoff:dates[1]},base,{authorize:allow})).toMatchObject({ok:false,reason:"denied"});expect(allow.mock.calls.map(call=>call[0]?.generation_id)).toEqual([c,b]);
 });
 it("bounds retained traversal even if every individual history edge is valid",async()=>{
  files.clear();let prior:string|null=null;
  for(let n=0;n<33;n++){const generation=n===32?c:n.toString(16).padStart(24,"0");add(generation,new Date(Date.UTC(2026,7,1+n)).toISOString(),prior);prior=generation;}
  expect(await resolveRetainedEventWorkspaceAtCutoff(await root(),{policy:"platform_snapshot",cutoff:"2026-07-31T00:00:00Z"},base,{authorize:allow})).toMatchObject({ok:false,reason:"history_limit"});
 });
 it("refuses an object observed after its containing snapshot was supposedly emitted",async()=>{
  const path=key(b,`workspaces/${event}.json`),workspace=JSON.parse(files.get(path)!);workspace.lifecycle.observed_at=dates[2];const wire=JSON.stringify(workspace);files.set(path,wire);const m=JSON.parse(files.get(key(b))!);m.files[`workspaces/${event}.json`]={sha256:sha(wire),bytes:Buffer.byteLength(wire)};files.set(key(b),JSON.stringify(m));add(c,dates[2],b);
  expect(await resolveRetainedEventWorkspaceAtCutoff(await root(),{policy:"platform_snapshot",cutoff:dates[1]},base,{authorize:allow})).toMatchObject({ok:false,reason:"invalid_history"});
 });
});
