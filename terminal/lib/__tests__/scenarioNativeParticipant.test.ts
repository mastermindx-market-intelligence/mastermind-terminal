import { expect, it, vi } from "vitest";
import { decodeNativeScenario, parseScenarioNativeIntent, requestNativeScenario } from "../scenarioNative";
import { scenarioNativePacket } from "./fixtures/scenarioNativePacket";
const packet = scenarioNativePacket();
const id = "10000000-0000-4000-8000-000000000001", actor = "20000000-0000-4000-8000-000000000002";
const operation = "30000000-0000-4000-8000-000000000003", generation = "40000000-0000-4000-8000-000000000004";
const manifest = {schema:"investigation_manifest.v2",intent:{title:"A",question:"What changes?",subjects:[{owner:"terminal.analysis_symbol",kind:"security",object_id:"SPY"}]},layout_refs:[],thesis_refs:[],evidence_refs:[],argument_relations:[],continuation:{},scenario_capture:packet.capture};
const request = {principal:actor,action:"create",target:id,expected_revision:0,manifest,layout_capture:null};
const intent = {mode:"capture",investigation_id:id,revision:1,grant_id:null,expected_revision:0,operation_id:operation,capture:packet.capture,canonical_request:request};
const phase = {schema:"investigation.native_capture.v1",operation_id:operation,generation,request_sha256:"a".repeat(64),source_binding_sha256:"b".repeat(64),native_phase:"retained"};
const envelope = () => ({status:"resolved",mode:"capture",investigation_id:id,revision:1,grant_id:null,capture:packet.capture,
  gex:{...packet.capture.source.gex,base64:packet.gex_base64},moves:null,native_capture:phase});

it("binds the full canonical request without treating native digest as a canonical digest",()=>{
 expect(parseScenarioNativeIntent(intent)).toEqual(intent);
 const parsed = parseScenarioNativeIntent(intent)!;
 expect(decodeNativeScenario(envelope(),parsed).status).toBe("resolved");
});
it("refuses initial capture without the canonical request before transport",async()=>{
 const {canonical_request: omitted,...old} = intent;void omitted;
 const fetcher = vi.fn();
 expect(parseScenarioNativeIntent(old)).toBeNull();
 expect(await requestNativeScenario(old,"controlled-token",{fetcher})).toEqual({status:"unavailable"});
 expect(fetcher).not.toHaveBeenCalled();
});
it.each([{principal:"not-an-owner"},{target:generation},{expected_revision:1},{action:"revise"},
 {manifest:{...manifest,scenario_capture:{...packet.capture,inputs:{...packet.capture.inputs,days:1}}}},
 {ready:true},{layout_capture:{layout_id:id,expected_revision:1}}])("refuses substituted or mixed original request %o",change=>{
 expect(parseScenarioNativeIntent({...intent,canonical_request:{...request,...change}})).toBeNull();
});
it("requires bounded original producer metadata, never a browser supplied completion grant",()=>{
 const parsed = parseScenarioNativeIntent(intent)!;
 const {native_capture: missing,...old} = envelope();void missing;
 for (const raw of [old,{...envelope(),native_capture:{...phase,operation_id:generation}},
   {...envelope(),native_capture:{...phase,generation:"unknown"}},
   {...envelope(),native_capture:{...phase,native_phase:"started"}},
   {...envelope(),native_capture:{...phase,ready:true}},
   {...envelope(),native_capture:{...phase,request_sha256:"unbound"}}]) {
  expect(decodeNativeScenario(raw,parsed)).toEqual({status:"unavailable"});
 }
 expect(parseScenarioNativeIntent({...intent,native_capture:phase})).toBeNull();
});
it("keeps read-only recovery on its incumbent exact union",()=>{
 const {canonical_request: omit,...prior} = intent;void omit;
 expect(parseScenarioNativeIntent({...prior,mode:"qualify"})).not.toBeNull();
 expect(parseScenarioNativeIntent({...intent,mode:"qualify"})).toBeNull();
});

it("accepts only the existing pinned-layout claim shape and never infers its revision",()=>{
 const layout={layout_id:id,expected_revision:7,revision_id:generation};
 const pinned={...intent,canonical_request:{...request,layout_capture:layout}};
 expect(parseScenarioNativeIntent(pinned)).toEqual(pinned);
 for(const changed of [{layout_id:id,expected_revision:7},{...layout,revision_id:"AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"},{...layout,revision_id:"current"},{...layout,extra:true},{...layout,expected_revision:0}]){
  expect(parseScenarioNativeIntent({...pinned,canonical_request:{...pinned.canonical_request,layout_capture:changed}})).toBeNull();
 }
});
