import {describe,expect,it,vi} from "vitest";
import {readFileSync,readdirSync} from "node:fs";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {decodeIntlGeneration,parseIntlPublicationPolicies} from "../investigationIntlGenerationCodec";
import {createIntlInvestigationHandlers} from "../investigationIntlApi";
const root=join(__dirname,"fixtures/intl_generation_actual_20261104/corrected");
const generation="im-workspace-generation:5c75f77b-96ff-4d0d-a156-5641fc3f6140",fingerprint="4e1101d873ee047d6b49703ac977bd9587b127e9423bcac9d098dbb9ec23c39e";
const file=`intl_generation_${generation.slice("im-workspace-generation:".length)}_${fingerprint}.json`;
const bytes=readFileSync(join(root,file)),document=JSON.parse(bytes.toString("utf8"));
const artifact={generation,fingerprint,bytes:bytes.byteLength,document};
const context=(market:string)=>document.contexts.find((c:{market:string;horizon:string;currency_basis:string})=>c.market===market&&c.horizon==="3m"&&c.currency_basis==="local");
const principal="90000000-0000-4000-8000-000000000009";
const codec={decodeIntlGeneration,parseIntlPublicationPolicies};
const source=()=>vi.fn<typeof fetch>(async input=>{const name=new URL(String(input)).pathname.split("/").at(-1)!;if(!readdirSync(root).includes(name))return new Response("",{status:404});return new Response(readFileSync(join(root,name)),{headers:{"content-type":"application/json"}});});
describe("exact original Macro five-value emitted generation join",()=>{
 it("retains the actual sealed publication bytes and byte-equal current descriptor sidecar",()=>{
  expect(bytes.byteLength).toBe(28192);expect(createHash("sha256").update(bytes).digest("hex")).toBe(fingerprint);
  const current=readFileSync(join(root,"intl_generation_current.json")),digest=createHash("sha256").update(current).digest("hex");expect(digest).toBe("d0840bf01269b53cd1c70ed9daca15e2c8a5748293b5e5cd626b7370809c1823");expect(current.equals(readFileSync(join(root,`intl_generation_descriptor_${digest}.json`)))).toBe(true);
 });
 it.each([["EZ",[2.5,1.7,1.3,3.8]],["GB",[3.75]]] as const)("decodes actual %s native selected values without fake clocks or dropping unrelated contexts",(market,values)=>{
  const selected=context(market),value=decodeIntlGeneration(artifact,selected.id,"en");expect(value).not.toBeNull();expect(value!.result.observations.map(row=>row.value)).toEqual(values);expect(value!.supportedMeasureIds).toEqual(selected.measure_ids);expect(value!.display.sourceGenerationAt).toBeNull();expect(value!.context).toEqual({researchMarket:market,toolBindingVersion:"2",periodIdentity:"3m",currencyBasis:"local",returnBasis:"price"});
 });
 it("does not turn the two withheld Japanese source rows or empty native contexts into qualified values",()=>{
  const jp=decodeIntlGeneration(artifact,context("JP").id,"zh");expect(jp).not.toBeNull();expect(jp!.result.observations.every(row=>!row.qualified&&row.value===null&&row.contentIdentity===null)).toBe(true);
  const empty=decodeIntlGeneration(artifact,context("KR").id,"en");expect(empty).not.toBeNull();expect(empty!.supportedMeasureIds).toEqual([]);expect(empty!.result.observations).toEqual([]);
 });
 it.each(["EZ","GB"])("qualifies actual %s references through real byte transport/current policy with synthetic private auth only",async market=>{
  const selected=context(market),fetcher=source(),handlers=createIntlInvestigationHandlers(codec,{fetcher,base:"https://synthetic-exact-bytes.test"}),q=new URLSearchParams({kind:"international",context:selected.id,generation,fingerprint});selected.measure_ids.forEach((field:string)=>q.append("field",field));
  const result=await handlers.baseline(new Request("https://terminal.test/api/investigations/baseline?"+q),principal);expect(result.status).toBe(200);expect(result.body).toMatchObject({status:"international_baseline",context:{researchMarket:market,periodIdentity:"3m"}});expect(fetcher).toHaveBeenCalledTimes(4);
 });
});

it("retains the original producer wire discrepancy as rejected bytes, never a repaired fixture",()=>{
 const old=readFileSync(join(root,"../intl_generation_2483cd1f-bd85-4c16-90e2-6a49504a6835_f2bfb56db1d9f308c94117658b79f262b9a8e78e7068d334933036a40b40e883.json"));expect(old.byteLength).toBe(27721);expect(createHash("sha256").update(old).digest("hex")).toBe("f2bfb56db1d9f308c94117658b79f262b9a8e78e7068d334933036a40b40e883");
 expect(decodeIntlGeneration({generation:"im-workspace-generation:2483cd1f-bd85-4c16-90e2-6a49504a6835",fingerprint:"f2bfb56db1d9f308c94117658b79f262b9a8e78e7068d334933036a40b40e883",bytes:old.byteLength,document:JSON.parse(old.toString("utf8"))},context("EZ").id,"en")).toBeNull();
});
