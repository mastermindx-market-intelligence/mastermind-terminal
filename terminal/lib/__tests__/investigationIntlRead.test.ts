import {describe,expect,it} from "vitest";
import {parseIntlSelectedRead} from "../investigationIntlRead";
import type {IntlResolvedPacket} from "../intlInvestigationCaller";
import type {InvestigationManifest} from "../investigationContracts";
const contextId="intl-workspace-context:sha256:"+"c".repeat(64),generation="im-workspace-generation:11111111-1111-4111-8111-111111111111";
function setup(){
 const ref={owner:"intl.workspace_generation",object_type:"selected_generation",object_id:contextId,mode:"pinned" as const,version_ref:generation,fingerprint:"a".repeat(64),selection:{field:"synthetic.measure"}};
 const detail={id:"90000000-0000-4000-8000-000000000001",revision:7,committed_at:"2026-11-04T09:00:00.000Z",manifest:{schema:"investigation_manifest.v3",intent:{title:"Synthetic read-frame test",question:"Exact authored private question",subjects:[{owner:"intl.workspace_context",kind:"economy",object_id:contextId}]},evidence_refs:[ref],review_baseline_ref:ref,layout_refs:[],thesis_refs:[],argument_relations:[],continuation:{}} as InvestigationManifest};
 const context={researchMarket:"EZ",toolBindingVersion:"2",periodIdentity:"3m",currencyBasis:"local",returnBasis:"price",owner:"synthetic source",query:detail.manifest.intent.question,cohort:"synthetic cohort",temporalPolicy:"synthetic policy"};
 const result=(version:string,value:number)=>({...context,generation:version,read:"ok" as const,membership:"complete" as const,tombstones:[],observations:[{id:"synthetic.measure",availability:"available" as const,qualified:true,excluded:false,correction:false,contentIdentity:`synthetic-content-${value}`,qualificationIdentity:"synthetic-policy-identity",interpretation:{value,unit:"bp",basis:"local",cohort:"synthetic cohort"}}]});
 const packet:IntlResolvedPacket={exactContext:{...context,selectedMeasureIds:["synthetic.measure"]},prior:result(generation,1),current:result("im-workspace-generation:22222222-2222-4222-8222-222222222222",2),requirements:{requiredMeasureIds:["synthetic.measure"],unmetPrerequisites:[]},owner:{lang:"en",question:detail.manifest.intent.question,marketLabel:"Synthetic market",toolLabel:"Synthetic tool",periodLabel:"Synthetic period",basisLabel:"Synthetic basis",savedAt:detail.committed_at,updatedAt:null,sourceGenerationAt:null,rightsAt:null,measureLabels:{"synthetic.measure":"Synthetic measure"},unmetLabels:[]}};
 return {detail,raw:{status:"international",id:detail.id,revision:detail.revision,input:{disposition:"resolved" as const,...packet}}};
}
describe("private selected-revision International response fence",()=>{
 it("accepts only the exact native question, selected fields, pinned history and record clock",()=>{const {detail,raw}=setup();expect(parseIntlSelectedRead(raw,detail)).toEqual({selection:{id:detail.id,revision:7},input:raw.input});});
 it.each([{id:"other"},{revision:8},{status:"reviewed"}])("refuses another response identity %j",change=>{const {detail,raw}=setup();expect(parseIntlSelectedRead({...raw,...change},detail)).toBeNull();});
 it.each(["question","savedAt"])("refuses substituted private %s",field=>{const {detail,raw}=setup();(raw.input.owner as unknown as Record<string,unknown>)[field]="other";expect(parseIntlSelectedRead(raw,detail)).toBeNull();});
 it("rejects a generation or selected-domain substitution",()=>{const {detail,raw}=setup();raw.input.prior!.generation="other";expect(parseIntlSelectedRead(raw,detail)).toBeNull();const n=setup();n.raw.input.exactContext.selectedMeasureIds=["other.measure"];expect(parseIntlSelectedRead(n.raw,n.detail)).toBeNull();});
 it("keeps explicit owner dispositions without accepting extra numeric fields",()=>{const {detail,raw}=setup();expect(parseIntlSelectedRead({...raw,input:{disposition:"denied"}},detail)?.input).toEqual({disposition:"denied"});expect(parseIntlSelectedRead({...raw,input:{disposition:"denied",value:2}},detail)).toBeNull();});
 it("refuses malformed packet input instead of throwing during native render",()=>{const {detail,raw}=setup();expect(parseIntlSelectedRead({...raw,input:{disposition:"resolved"}},detail)).toBeNull();});
});
