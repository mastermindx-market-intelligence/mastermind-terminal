import {createHash} from "node:crypto";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import fixture from "./fixtures/sec_acquisition.emitted.synthetic.json";
import {normalizeEventWorkspace,normalizeEventWorkspaceManifest} from "../eventWorkspace";
import {createSelectedIssuerReleaseReadOptions,resolveInvestigationIssuerRelease,resolveInvestigationIssuerReleaseAtCutoff} from "../investigationIssuerRelease";
import {parseSecAcquisitionReceipt,secAcquisitionNoLaterThan} from "../issuerReleaseSecAcquisition";
const base="https://pub-f7ffb4441c5f4ad983ca56ec7c651c61.r2.dev";
const principal="11111111-1111-4111-8111-111111111111";
const digest=(body:string)=>createHash("sha256").update(body).digest("hex");
const documents=fixture.generations as Record<string,{row:string;manifest:string}>;
function emitted(generation:string){
  const wire=documents[generation];return {wire,row:JSON.parse(wire.row),manifest:JSON.parse(wire.manifest)};
}
function serve(){
  const fetch=vi.fn(async(url:string)=>{
    for(const [g,wire] of Object.entries(documents)){
      const prefix=`${base}/company_intelligence/event_workspaces/generations/${g}/`;
      if(url===prefix+"manifest.json")return new Response(wire.manifest);
      if(url===prefix+`workspaces/${JSON.parse(wire.row).event_id}.json`)return new Response(wire.row);
    }
    return new Response("missing",{status:404});
  });vi.stubGlobal("fetch",fetch);return fetch;
}
beforeEach(()=>{
  // The producer's controlled acquisition clock is synthetic, not an observed
  // live fetch. Move only this test's request clock past that fixture instant.
  vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date("2026-10-25T00:00:00Z"));
});
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
describe("exact corrected Macro producer bytes against the selected consumer",()=>{
  it("keeps the original synthetic/no-live provenance and exact retained wire hashes",()=>{
    expect(fixture.fixture_kind).toBe("SYNTHETIC_MOCKED_ACQUISITION_AND_LOCAL_EMISSION_NOT_LIVE_NOT_RIGHTS_GRANT");
    expect(fixture.producer_head).toBe("2b17d6c4c3e03cfb49f6d3cd8c4ce781e9d3b607");
    for(const example of fixture.cases){
      const {wire,row,manifest}=emitted(example.generation);
      expect(digest(wire.row)).toBe(example.row_sha256);expect(digest(wire.manifest)).toBe(example.manifest_sha256);
      expect(manifest.files[`workspaces/${row.event_id}.json`]).toEqual({sha256:example.row_sha256,bytes:Buffer.byteLength(wire.row)});
      expect(normalizeEventWorkspaceManifest(manifest)).not.toBeNull();
      const normalized=normalizeEventWorkspace(row,row.event_id,example.generation);expect(normalized).not.toBeNull();
      const release=normalized!.sources.find(s=>s.kind==="issuer_release")!;
      expect(release.acquisition_receipt?.acquired_at).toBe(example.acquired_at);
      expect(parseSecAcquisitionReceipt(release.acquisition_receipt,{filing_key:release.filing_key!,source_url:release.url!,source_sha256:release.source_sha256!})).not.toBeNull();
      expect(secAcquisitionNoLaterThan(example.acquired_at,row.generated_at)).toBe(true);
      expect(secAcquisitionNoLaterThan(example.acquired_at,manifest.generated_at)).toBe(true);
    }
    // The repeated identical acquisition reuses the original immutable bytes.
    expect(fixture.cases[2].row_sha256).toBe(fixture.cases[1].row_sha256);
    expect(fixture.cases[2].manifest_sha256).toBe(fixture.cases[1].manifest_sha256);
  });
  it.each(Object.keys(documents))("resolves the exact emitted selected projection without exposing the mixed payload: %s",async(generation)=>{
    const fetch=serve(),{row}=emitted(generation),pin={event_id:row.event_id,generation_id:generation,company_id:row.issuer.company_id};
    const options=createSelectedIssuerReleaseReadOptions(principal);
    const result=await resolveInvestigationIssuerRelease(pin,base,options);expect(result.ok).toBe(true);if(!result.ok)return;
    expect(result.reference.version_ref).toBe(generation);
    expect(result.workspace.selected_release.source_sha256).toBe(row.sources[0].source_sha256);
    expect(result.selection_receipt.rights.decision_binding).toMatchObject({principal_id:principal,generation_id:generation});
    expect(result.workspace).not.toHaveProperty("qa_exchanges");expect(result.workspace).not.toHaveProperty("facts");
    expect(result.receipt.platform_known_at).toBeNull(); // absent selected-source clock stays unknown
    const saved={...pin,fingerprint:result.reference.fingerprint};
    const atCutoff=await resolveInvestigationIssuerReleaseAtCutoff(saved,{policy:"platform_snapshot",cutoff:row.generated_at},base,options);
    expect(atCutoff.ok).toBe(true);
    const before=await resolveInvestigationIssuerReleaseAtCutoff(saved,{policy:"platform_snapshot",cutoff:"2026-10-24T21:00:00Z"},base,options);
    expect(before).toMatchObject({ok:false,reason:"no_retained_snapshot_at_cutoff"});
    expect(fetch.mock.calls.every(([url])=>url.startsWith(base+"/company_intelligence/event_workspaces/generations/"))).toBe(true);
  });
});
