import {createHash} from "node:crypto";
import {afterEach,describe,expect,it,vi} from "vitest";
import golden from "./fixtures/aapl-event-workspace.json";
import {resolveInvestigationIssuerRelease,resolveInvestigationIssuerReleaseAtCutoff,type IssuerReleaseIdentity} from "../investigationIssuerRelease";
import {reviewSelectedIssuerRelease} from "../investigationEarningsReview";
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

describe("selected release comparison and replay",()=>{
 it("ignores mixed-container changes and transport clocks when comparing release content",async()=>{
  serve();const prior=await resolveInvestigationIssuerRelease(pin,R2,{authorize});if(!prior.ok)throw Error("fixture");
  const copy=structuredClone(golden);copy.sources.find(s=>s.kind==="transcript")!.source_sha256="d".repeat(64);serve(copy);
  const current=await resolveInvestigationIssuerRelease(pin,R2,{authorize});if(!current.ok)throw Error("fixture");
  expect(current.reference.fingerprint).not.toBe(prior.reference.fingerprint);
  const result=reviewSelectedIssuerRelease(prior,current);
  expect(result.review.summary).toBe("incomplete");expect(result.review.items).toHaveLength(1);
  expect(result.review.items[0]).toMatchObject({version:"unchanged",qualification:"unchanged"});
  expect(JSON.stringify(result)).not.toContain("transcript");expect(result.removalProofAvailable).toBe(false);
 });
 it("reports release and current-policy changes independently and denies mismatched rights",async()=>{
  serve();const prior=await resolveInvestigationIssuerRelease(pin,R2,{authorize});if(!prior.ok)throw Error("fixture");
  const current=structuredClone(prior);current.workspace.selected_release.source_sha256="e".repeat(64);current.selection_receipt.rights.source_sha256="e".repeat(64);current.selection_receipt.rights.registry_revision="new-policy";
  expect(reviewSelectedIssuerRelease(prior,current).review.items[0]).toMatchObject({version:"revised",qualification:"changed"});
  current.selection_receipt.rights.document_id="wrong-document";
  expect(reviewSelectedIssuerRelease(prior,current).review).toMatchObject({summary:"unavailable",items:[]});
 });
 it("replays the exact selected reference without returning mixed workspace rows",async()=>{
  const fetcher=serve();const baseline=await resolveInvestigationIssuerRelease(pin,R2,{authorize});if(!baseline.ok)throw Error("fixture");
  const result=await resolveInvestigationIssuerReleaseAtCutoff({...pin,fingerprint:baseline.reference.fingerprint},{policy:"platform_snapshot",cutoff:golden.generated_at},R2,{authorize});
  expect(result.ok).toBe(true);if(!result.ok)return;
  expect(result.reference).toEqual(baseline.reference);expect(result.receipt.fingerprint).toBe(baseline.receipt.fingerprint);
  expect(result.workspace.schema).toBe("earnings.issuer_release_projection.v1");expect(result.replay.selected_generation_id).toBe(pin.generation_id);
  expect(JSON.stringify(result)).not.toContain("qa_exchanges");expect(JSON.stringify(result)).not.toContain("tx:AAPL");
  expect(fetcher.mock.calls.every(call=>String(call[0]).includes("/generations/"))).toBe(true);
 });
 it("never accepts a container fingerprint or unsupported knowledge policy as a selected replay",async()=>{
  serve();const baseline=await resolveInvestigationIssuerRelease(pin,R2,{authorize});if(!baseline.ok)throw Error("fixture");
  const selection={policy:"platform_snapshot" as const,cutoff:golden.generated_at};
  expect(await resolveInvestigationIssuerReleaseAtCutoff({...pin,fingerprint:baseline.receipt.fingerprint},selection,R2,{authorize})).toMatchObject({ok:false,reason:"invalid_owner_receipt"});
  expect(await resolveInvestigationIssuerReleaseAtCutoff({...pin,fingerprint:baseline.reference.fingerprint},selection,R2)).toMatchObject({ok:false,reason:"rights_unavailable"});
  expect(await resolveInvestigationIssuerReleaseAtCutoff({...pin,fingerprint:baseline.reference.fingerprint},{...selection,policy:"public_known"},R2,{authorize})).toMatchObject({ok:false,reason:"unsupported_policy"});
 });
});
