import {describe,expect,it,vi} from "vitest";
import {readFileSync,readdirSync} from "node:fs";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {decodeIntlGeneration,parseIntlPublicationPolicies} from "../investigationIntlGenerationCodec";
import {createIntlInvestigationHandlers} from "../investigationIntlApi";
import {readCurrentIntlGeneration} from "../investigationIntlGeneration";
import {createPolicyPreviewSession,updatePolicyDraft,beginPolicyPreview,receivePublishedPolicyPreview,type PolicySettings} from "../intlPolicyPreviewSession";
const root=join(__dirname,"fixtures/intl_policy_generation_actual_20261104"),generation="im-workspace-generation:f180e9f4-eeee-488d-b312-5a68d09ccf5c",fingerprint="0dc2265e5985adaff29f0c2efbf7191be9f80472a6c0f73646a4ac1b5776f8b8";
const file=`intl_generation_f180e9f4-eeee-488d-b312-5a68d09ccf5c_${fingerprint}.json`,bytes=readFileSync(join(root,file)),document=JSON.parse(bytes.toString("utf8"));
const context=document.contexts.find((c:{market:string;horizon:string;currency_basis:string})=>c.market==="EZ"&&c.horizon==="3m"&&c.currency_basis==="local"),codec={decodeIntlGeneration,parseIntlPublicationPolicies};
function source(){const files=new Map(readdirSync(root).filter(name=>name.startsWith("intl_generation_")).map(name=>[name,readFileSync(join(root,name))]));const fetcher=vi.fn<typeof fetch>(async input=>{const name=new URL(String(input)).pathname.split("/").at(-1)!;return new Response(files.get(name)??"",{status:files.has(name)?200:404,headers:{"content-type":"application/json"}});});return {files,fetcher};}
describe("actual additive policy generation remains independently usable by native B5",()=>{
 it("uses exact actual generation/current descriptor without following the companion or replacing private scope",async()=>{
  expect(bytes.byteLength).toBe(28646);expect(createHash("sha256").update(bytes).digest("hex")).toBe(fingerprint);const s=source(),current=await readCurrentIntlGeneration({fetcher:s.fetcher,base:"https://synthetic.fixture.test"});expect(current?.descriptor.current_policy_points).toEqual({metadata:"allowed",value_permission:"allowed",mapping_identity:"6c196e8d2d2f3d3e926b02653f4ae15b66d495a28c346b03c9771cca1b23e132"});
  const decoded=decodeIntlGeneration(current!.artifact,context.id,"en");expect(decoded?.result.observations.map(row=>row.value)).toEqual([2.5,1.7,1.3,3.8]);expect(s.fetcher.mock.calls.every(([url])=>!String(url).includes("intl_policy_points_"))).toBe(true);
  const q=new URLSearchParams({kind:"international",context:context.id,generation,fingerprint});context.measure_ids.forEach((f:string)=>q.append("field",f));const handlers=createIntlInvestigationHandlers(codec,{fetcher:s.fetcher,base:"https://synthetic.fixture.test"});expect((await handlers.baseline(new Request("https://terminal.test/api/investigations/baseline?"+q),"90000000-0000-4000-8000-000000000009")).status).toBe(200);
 });
 it.each([{metadata:"denied"},{mapping_identity:"a".repeat(64)},{extra:"grant"}])("rejects a malformed/mismatched current companion policy %j",async change=>{
  const s=source(),raw=JSON.parse(s.files.get("intl_generation_current.json")!.toString("utf8"));Object.assign(raw.current_policy_points,change);const changed=Buffer.from(JSON.stringify(raw));s.files.set("intl_generation_current.json",changed);s.files.set(`intl_generation_descriptor_${createHash("sha256").update(changed).digest("hex")}.json`,changed);expect(await readCurrentIntlGeneration({fetcher:s.fetcher,base:"https://synthetic.fixture.test"})).toBeNull();
 });
 it("adopts the real unchanged Python response IDs/numbers into only the original synthetic private ticket",()=>{
  const reply=JSON.parse(readFileSync(join(root,"preview.json"),"utf8")),before=structuredClone(reply);const settings:PolicySettings={economy_a:"EZ",economy_b:"GB",lens:"nominal_policy_point_gap",definition:"absolute_gap_change_bp",method_version:reply.result.identity.method_version,period:{mode:"fixed_dates",start:"2026-08-28",end:"2026-09-30"},instrument_a_ref:null,instrument_b_ref:null,revision_policy:"latest_vintage"};
  const request=beginPolicyPreview(updatePolicyDraft(createPolicyPreviewSession({principal_partition:"synthetic-private-owner",auth_epoch:"synthetic-epoch",saved_id:"synthetic-saved-A",saved_revision:7,source_generation:generation,instrument_mapping_identity:null,qualification_identity:null}),{ok:true,settings}));const result=receivePublishedPolicyPreview(request.state,request.ticket!,{generation,fingerprint},reply);
  expect(result.preview).toMatchObject({state:"qualified",signed_start_bp:-150,signed_end_bp:-125,signed_change_bp:25,absolute_change_bp:-25,direction:"narrowed",identity:{binding:{principal_partition:"synthetic-private-owner",saved_id:"synthetic-saved-A",saved_revision:7,instrument_mapping_identity:reply.mapping_identity,qualification_identity:reply.qualification_identity}}});expect(reply).toEqual(before);
 });
});
