import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import path from "node:path";
import {afterEach,describe,expect,it,vi} from "vitest";
import golden from "./fixtures/aapl-event-workspace.json";
import synthetic from "./fixtures/sec_acquisition.synthetic.json";
import {createSelectedIssuerReleaseReadOptions,resolveInvestigationIssuerRelease,resolveInvestigationIssuerReleaseAtCutoff,
  SELECTED_SEC_READ_POLICY,SELECTED_SEC_POLICY_REVISION,type IssuerReleaseDecisionBinding,type IssuerReleaseRights} from "../investigationIssuerRelease";
const A="11111111-1111-4111-8111-111111111111",B="22222222-2222-4222-8222-222222222222";
const R2="https://pub-f7ffb4441c5f4ad983ca56ec7c651c61.r2.dev";
const pin={event_id:golden.event_id,generation_id:golden.generation_id,company_id:golden.issuer.company_id};
const hash=(value:string)=>createHash("sha256").update(value).digest("hex");
// A synthetic owner-declaration fixture. It cannot establish real acquisition
// or publisher installation; the producer's exact byte vector is tested apart.
function admittedFixture(){
  const source=golden.sources[0],receipt={...structuredClone(synthetic.acquisition_receipt),
    filing_key:{...source.filing_key!},requested_url:source.url!,final_url:source.url!,
    decoder:"utf-8",decode_policy:"utf8_strict",entity_sha256:source.source_sha256!,source_sha256:source.source_sha256!,
    entity_length:synthetic.acquisition_receipt.source_utf8_length};
  return {...structuredClone(golden),sources:golden.sources.map((s,i)=>i===0?{...s,acquisition_receipt:receipt}:structuredClone(s))};
}
function serve(workspace:unknown=admittedFixture()){
  const body=JSON.stringify(workspace),manifest=JSON.stringify({schema:"event_workspace_manifest.v1",generation_id:pin.generation_id,
    generated_at:golden.generated_at,status:"ready",event_count:1,files:{[`workspaces/${pin.event_id}.json`]:{sha256:hash(body),bytes:Buffer.byteLength(body)}},
    aliases:{[pin.event_id]:pin.event_id},authority:"context_only",warnings:[]});
  const fetch=vi.fn(async(url:string)=>new Response(url.endsWith("manifest.json")?manifest:body));vi.stubGlobal("fetch",fetch);return fetch;
}
afterEach(()=>vi.unstubAllGlobals());

describe("current selected SEC read decision — source-only synthetic records",()=>{
  it("pins an honest immutable local policy definition to the exact producer schema",()=>{
    expect(SELECTED_SEC_READ_POLICY.acquisition_schema_sha256).toBe(createHash("sha256").update(readFileSync(path.join(__dirname,"fixtures/sec_acquisition.v1.schema.json"))).digest("hex"));
    expect(SELECTED_SEC_READ_POLICY.basis).toEqual(["https://www.sec.gov/files/about/webmaster-faq.htm","https://www.sec.gov/about/privacy-information"]);
    expect(SELECTED_SEC_POLICY_REVISION).toMatch(/^local_executable_policy\.sha256:[0-9a-f]{64}$/);
    expect(Object.isFrozen(SELECTED_SEC_READ_POLICY)).toBe(true);expect(Object.isFrozen(SELECTED_SEC_READ_POLICY.rules)).toBe(true);
    expect(SELECTED_SEC_READ_POLICY.exclusions).toContain("mixed_workspace");expect(SELECTED_SEC_READ_POLICY.exclusions).toContain("model_input");
  });
  it("keeps a legacy byte_replayed/public-primary row unavailable rather than synthesizing proof",async()=>{
    const fetch=serve(golden);expect(await resolveInvestigationIssuerRelease(pin,R2,createSelectedIssuerReleaseReadOptions(A))).toMatchObject({ok:false,reason:"rights_unavailable"});
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it.each(["", "anonymous", "00000000-0000-0000-0000-000000000000"])("refuses an invalid server-principal scope before retained fetches: %s",principal=>{
    const fetch=serve();return resolveInvestigationIssuerRelease(pin,R2,createSelectedIssuerReleaseReadOptions(principal)).then(result=>{
      expect(result).toMatchObject({ok:false,reason:"rights_unavailable"});expect(fetch).not.toHaveBeenCalled();
    });
  });
  it("binds every decision to the current server principal and exact selected tuple, outside saved identity",async()=>{
    serve();const before=Date.now();const a=await resolveInvestigationIssuerRelease(pin,R2,createSelectedIssuerReleaseReadOptions(A));
    const b=await resolveInvestigationIssuerRelease(pin,R2,createSelectedIssuerReleaseReadOptions(B));
    expect(a.ok).toBe(true);expect(b.ok).toBe(true);if(!a.ok||!b.ok)return;
    expect(a.reference).toEqual(b.reference);
    expect(a.selection_receipt.rights.decision_binding).toEqual({principal_id:A,action:"read",purpose:"investigation.selected_issuer_release",
      company_id:pin.company_id,event_id:pin.event_id,generation_id:pin.generation_id,document_id:golden.sources[0].document_id,source_sha256:golden.sources[0].source_sha256});
    expect(b.selection_receipt.rights.decision_binding?.principal_id).toBe(B);
    expect(a.selection_receipt.rights.registry_revision).toBe(SELECTED_SEC_POLICY_REVISION);
    expect(Date.parse(a.selection_receipt.rights.checked_at)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(a.selection_receipt.rights.checked_at)).toBeLessThanOrEqual(Date.now());
    expect(a.workspace.selected_release.public_known_at).toBeNull();expect(a.workspace.selected_release.platform_known_at).toBeNull();
    expect(a.workspace.selected_release).not.toHaveProperty("acquisition_receipt");expect(a.workspace.selected_release).not.toHaveProperty("request_scope");
    expect(JSON.stringify(a.workspace)).not.toContain("qa_exchanges");
  });
  it.each([
    ["principal_id",B],["action","model_input"],["purpose","company_context"],["company_id","cik:0000000001"],
    ["event_id","another-event"],["generation_id","a".repeat(24)],["document_id","another-document"],["source_sha256","a".repeat(64)],
  ])("rejects a decision rebound to another %s",async(key,value)=>{
    serve();const options=createSelectedIssuerReleaseReadOptions(A),native=options.authorize!;
    options.authorize=async(identity,source)=>{const d=await native(identity,source);return {...d,decision_binding:{...d.decision_binding!,[key]:value} as IssuerReleaseDecisionBinding};};
    expect(await resolveInvestigationIssuerRelease(pin,R2,options)).toMatchObject({ok:false,reason:"rights_unavailable"});
  });
  it.each([
    {checked_at:"2020-01-01T00:00:00.000Z"},{checked_at:"not-a-clock"},
    {policy_version:"an-old-policy"},{registry_revision:"an-old-registry"},
  ])("rejects persisted or incorrectly versioned permission %j",async(change)=>{
    serve();const options=createSelectedIssuerReleaseReadOptions(A),native=options.authorize!;
    options.authorize=async(identity,source)=>({...await native(identity,source),...change});
    expect(await resolveInvestigationIssuerRelease(pin,R2,options)).toMatchObject({ok:false,reason:"rights_unavailable"});
  });
  it("does not relabel a future acquisition time as current evidence",async()=>{
    const input=admittedFixture();const row=input.sources[0] as typeof input.sources[0]&{acquisition_receipt:typeof synthetic.acquisition_receipt};
    row.acquisition_receipt.acquired_at=new Date(Date.now()+365*86400_000).toISOString();input.generated_at=row.acquisition_receipt.acquired_at;serve(input);
    expect(await resolveInvestigationIssuerRelease(pin,R2,createSelectedIssuerReleaseReadOptions(A))).toMatchObject({ok:false,reason:"rights_unavailable"});
  });
  it("rechecks the actual replay selection and never grants unsupported replay purposes",async()=>{
    serve();const options=createSelectedIssuerReleaseReadOptions(A),baseline=await resolveInvestigationIssuerRelease(pin,R2,options);
    expect(baseline.ok).toBe(true);if(!baseline.ok)return;
    const native=options.authorize!,authorizations:IssuerReleaseRights[]=[];
    options.authorize=async(identity,source)=>{const d=await native(identity,source);authorizations.push(d);return d;};
    const savedPin={...pin,fingerprint:baseline.reference.fingerprint};
    expect((await resolveInvestigationIssuerReleaseAtCutoff(savedPin,{policy:"platform_snapshot",cutoff:golden.generated_at},R2,options)).ok).toBe(true);
    expect(authorizations.length).toBeGreaterThanOrEqual(2);
    expect(authorizations.every(d=>d.decision_binding?.generation_id===pin.generation_id&&d.decision_binding?.principal_id===A)).toBe(true);
    options.authorize=async(identity,source)=>{const d=await native(identity,source);return {...d,decision_binding:{...d.decision_binding!,generation_id:"b".repeat(24)}};};
    expect((await resolveInvestigationIssuerReleaseAtCutoff(savedPin,{policy:"platform_snapshot",cutoff:golden.generated_at},R2,options)).ok).toBe(false);
    expect(await resolveInvestigationIssuerReleaseAtCutoff(savedPin,{policy:"public_known",cutoff:golden.generated_at},R2,options)).toMatchObject({ok:false,reason:"unsupported_policy"});
  });
  it("refuses a historical replay snapshot acquired after its emission but before today's decision",async()=>{
    const previous="a".repeat(24),current="b".repeat(24),files=new Map<string,string>();
    const key=(g:string,f="manifest.json")=>`${R2}/company_intelligence/event_workspaces/generations/${g}/${f}`;
    for(const [g,date,prior] of [[previous,golden.generated_at,null],[current,"2026-08-02T00:00:00Z",previous]] as const){
      const workspace=admittedFixture();workspace.generation_id=g;workspace.generated_at=date;
      (workspace.sources[0] as typeof workspace.sources[0]&{acquisition_receipt:typeof synthetic.acquisition_receipt}).acquisition_receipt.acquired_at="2026-07-31T00:00:00Z";
      const body=JSON.stringify(workspace);files.set(key(g,`workspaces/${pin.event_id}.json`),body);
      files.set(key(g),JSON.stringify({schema:"event_workspace_manifest.v2",generation_id:g,generated_at:date,status:"ready",event_count:1,
        files:{[`workspaces/${pin.event_id}.json`]:{sha256:hash(body),bytes:Buffer.byteLength(body)}},aliases:{[pin.event_id]:pin.event_id},authority:"context_only",warnings:[],
        previous_generation_id:prior,previous_manifest_sha256:prior?hash(files.get(key(prior))!):null}));
    }
    vi.stubGlobal("fetch",vi.fn(async(url:string)=>new Response(files.get(url)??"missing",{status:files.has(url)?200:404})));
    const options=createSelectedIssuerReleaseReadOptions(A),currentPin={...pin,generation_id:current};
    const root=await resolveInvestigationIssuerRelease(currentPin,R2,options);expect(root.ok).toBe(true);if(!root.ok)return;
    expect(await resolveInvestigationIssuerReleaseAtCutoff({...currentPin,fingerprint:root.reference.fingerprint},
      {policy:"platform_snapshot",cutoff:golden.generated_at},R2,options)).toMatchObject({ok:false,reason:"selected_snapshot_unavailable"});
  });
  it("cannot mutate the callback's identity or request-evaluation scope",async()=>{
    serve();const options=createSelectedIssuerReleaseReadOptions(A),native=options.authorize!;
    options.authorize=async(identity,source)=>{
      expect(Reflect.set(identity,"document_id","substitute")).toBe(false);
      expect(Reflect.set(source.request_scope!,"principal_id",B)).toBe(false);
      return native(identity,source);
    };
    expect((await resolveInvestigationIssuerRelease(pin,R2,options)).ok).toBe(true);
  });
});
