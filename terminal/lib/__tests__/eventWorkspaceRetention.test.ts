import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { resolveRetainedEventWorkspaceFromR2, authorizeRetainedPublicEventContext } from "../eventWorkspace";
const golden=JSON.parse(readFileSync(path.join(__dirname,"fixtures/aapl-event-workspace.json"),"utf8"));
const R2="https://pub-f7ffb4441c5f4ad983ca56ec7c651c61.r2.dev";
const event=golden.event_id as string, generation=golden.generation_id as string;
const company=golden.issuer.company_id as string;
const sha=(s:string)=>createHash("sha256").update(s).digest("hex");
const wire=JSON.stringify(golden);
const manifest=JSON.stringify({schema:"event_workspace_manifest.v1",generation_id:generation,generated_at:golden.generated_at,status:"ready",event_count:1,files:{[`workspaces/${event}.json`]:{sha256:sha(wire),bytes:Buffer.byteLength(wire)}},aliases:{[event]:event},authority:"context_only",warnings:[]});
const pin={event_id:event,generation_id:generation,company_id:company};
function serve(body=wire, header=manifest) {
 const calls:string[]=[];
 vi.stubGlobal("fetch",vi.fn(async(url:string)=>{
  calls.push(String(url));
  return new Response(String(url).endsWith("manifest.json")?header:body,{status:200});
 }));
 return calls;
}
afterEach(()=>vi.unstubAllGlobals());
describe("owner-backed retained Earnings generation",()=>{
 it("loads exact immutable bytes with full semantic binding and no current selection",async()=>{
  const calls=serve();
  const result=await resolveRetainedEventWorkspaceFromR2(pin,R2,{authorize:async()=>({allowed:true,policy_version:"test.public_context.v1",checked_at:"2026-10-04T00:00:00Z"})});
  expect(result.ok).toBe(true);
  if(!result.ok)return;
  expect(result.workspace.event_id).toBe(event);expect(result.receipt.company_id).toBe(company);
  expect(result.receipt.workspace_sha256).toBe(sha(wire));expect(result.receipt.manifest_sha256).toBe(sha(manifest));
  expect(calls.every(url=>url.includes(`/generations/${generation}/`))).toBe(true);
 });
 it("fails closed for rights denial, wrong subject, missing object, and altered fingerprint",async()=>{
  serve();
  expect((await resolveRetainedEventWorkspaceFromR2(pin,R2,{authorize:async()=>({allowed:false,policy_version:"test.denied",checked_at:"2026-10-04T00:00:00Z"})})).ok).toBe(false);
  const allow={authorize:async()=>({allowed:true,policy_version:"test.public_context.v1",checked_at:"2026-10-04T00:00:00Z"})};
  expect((await resolveRetainedEventWorkspaceFromR2({...pin,company_id:"cik:0000999999"},R2,allow)).ok).toBe(false);
  expect((await resolveRetainedEventWorkspaceFromR2({...pin,fingerprint:"0".repeat(64)},R2,allow)).ok).toBe(false);
  vi.stubGlobal("fetch",vi.fn(async()=>new Response("",{status:404})));
  const missing=await resolveRetainedEventWorkspaceFromR2(pin,R2,allow);
  expect(missing).toMatchObject({ok:false,code:"HISTORICAL_UNAVAILABLE"});
 });
 it("changes identity when qualification changes with the same issuer release hash",async()=>{
  serve();const allow={authorize:async()=>({allowed:true,policy_version:"test.public_context.v1",checked_at:"2026-10-04T00:00:00Z"})};
  const before=await resolveRetainedEventWorkspaceFromR2(pin,R2,allow);
  const changed=JSON.stringify({...golden,warnings:golden.warnings.filter((w:string)=>w!=="questions_count_unstructured")});
  const updated=JSON.parse(manifest);updated.files[`workspaces/${event}.json`]={sha256:sha(changed),bytes:Buffer.byteLength(changed)};
  serve(changed,JSON.stringify(updated));
  const after=await resolveRetainedEventWorkspaceFromR2(pin,R2,allow);
  expect(before.ok && after.ok && before.receipt.fingerprint!==after.receipt.fingerprint).toBe(true);
 });
 it("does not grant access without an owner rights decision",async()=>{
  serve();expect((await resolveRetainedEventWorkspaceFromR2(pin,R2)).ok).toBe(false);
 });
 it("does not treat public-primary annotations as a mixed-workspace rights grant",async()=>{
  const calls=serve();
  const currentRights={authorize:(workspace:Parameters<typeof authorizeRetainedPublicEventContext>[0])=>authorizeRetainedPublicEventContext(workspace,R2)};
  expect(await resolveRetainedEventWorkspaceFromR2(pin,R2,currentRights)).toMatchObject({ok:false,code:"HISTORICAL_UNAVAILABLE",reason:"rights_unavailable"});
  expect(calls.every(url=>url.includes(`/generations/${generation}/`))).toBe(true);
 });
});
