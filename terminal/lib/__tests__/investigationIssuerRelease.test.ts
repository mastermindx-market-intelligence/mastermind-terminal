import {createHash} from "node:crypto";
import {afterEach,describe,expect,it,vi} from "vitest";
import golden from "./fixtures/aapl-event-workspace.json";
import {resolveInvestigationIssuerRelease,type IssuerReleaseIdentity} from "../investigationIssuerRelease";
const R2="https://pub-f7ffb4441c5f4ad983ca56ec7c651c61.r2.dev";
const pin={event_id:golden.event_id,generation_id:golden.generation_id,company_id:golden.issuer.company_id};
const sha=(s:string)=>createHash("sha256").update(s).digest("hex");
function serve(workspace:unknown=golden){
 const body=JSON.stringify(workspace);
 const manifest=JSON.stringify({schema:"event_workspace_manifest.v1",generation_id:pin.generation_id,generated_at:golden.generated_at,status:"ready",event_count:1,files:{[`workspaces/${pin.event_id}.json`]:{sha256:sha(body),bytes:Buffer.byteLength(body)}},aliases:{[pin.event_id]:pin.event_id},authority:"context_only",warnings:[]});
 const fetch=vi.fn(async(url:string)=>new Response(url.endsWith("manifest.json")?manifest:body));vi.stubGlobal("fetch",fetch);return fetch;
}
const authorize=async(identity:IssuerReleaseIdentity)=>({allowed:true,family:"sec_edgar" as const,policy_version:"fixture-current-owner.v1",registry_revision:"fixture-snapshot",permitted_display_class:"direct_display_ok" as const,checked_at:"2026-10-05T00:00:00.000Z",document_id:identity.document_id,source_sha256:identity.source_sha256});
afterEach(()=>vi.unstubAllGlobals());
describe("selected issuer-release baseline",()=>{
 it("defaults to unavailable without using public-primary labels as a grant",async()=>{
  const fetch=serve();expect(await resolveInvestigationIssuerRelease(pin,R2)).toMatchObject({ok:false,reason:"rights_unavailable"});expect(fetch).not.toHaveBeenCalled();
 });
 it("emits only a selected reference projection despite mixed retained source bodies",async()=>{
  serve();const owner=vi.fn(authorize);const result=await resolveInvestigationIssuerRelease(pin,R2,{authorize:owner});expect(result.ok).toBe(true);if(!result.ok)return;
  expect(result.reference.selection).toEqual({field:"issuer_release"});
  expect(result.workspace.selected_release.document_id).toBe(golden.sources[0].document_id);
  expect(Object.keys(result.workspace).sort()).toEqual(["schema","issuer","event_id","generation_id","completeness","selected_release"].sort());
  expect(Object.keys(result.workspace.completeness)).toEqual(["release"]);
  expect(JSON.stringify(result)).not.toContain("tx:AAPL/2026Q3");
  expect(JSON.stringify(result)).not.toContain("qa_exchanges");
  expect(JSON.stringify(result)).not.toContain("source_span");
  expect(result.workspace.selected_release.public_known_at).toBeNull();
  expect(owner.mock.calls[0][0]).toMatchObject({company_id:pin.company_id,event_id:pin.event_id,generation_id:pin.generation_id,document_id:golden.sources[0].document_id});
  expect((await resolveInvestigationIssuerRelease({...pin,fingerprint:result.reference.fingerprint},R2,{authorize:owner})).ok).toBe(true);
  expect(owner).toHaveBeenCalledTimes(2); // current rights on every read
  expect(await resolveInvestigationIssuerRelease({...pin,fingerprint:result.receipt.fingerprint},R2,{authorize})).toMatchObject({ok:false,reason:"invalid_owner_receipt"});
 });
 it("refuses denied or incorrectly bound rights and unretained releases",async()=>{
  serve();expect(await resolveInvestigationIssuerRelease(pin,R2,{authorize:async i=>({...await authorize(i),allowed:false})})).toMatchObject({ok:false,reason:"denied"});
  expect(await resolveInvestigationIssuerRelease(pin,R2,{authorize:async i=>({...await authorize(i),source_sha256:"a".repeat(64)})})).toMatchObject({ok:false,reason:"rights_unavailable"});
  const copy=structuredClone(golden);copy.sources[0].receipt_state="address_only";serve(copy);
  expect((await resolveInvestigationIssuerRelease(pin,R2,{authorize})).ok).toBe(false);
 });
});
