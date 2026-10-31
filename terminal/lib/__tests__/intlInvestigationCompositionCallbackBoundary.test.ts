import { test } from "vitest";
import assert from "node:assert/strict";
import { reviewIntlEvidence } from "@/lib/intlInvestigationEvidence";
import { composeIntlInvestigationPanel } from "@/lib/intlInvestigationComposition";
const context={researchMarket:"global-equities",toolBindingVersion:"v1",periodIdentity:"2024Q4",currencyBasis:"USD-constant",returnBasis:"total-return",owner:"intl.evidence",query:"q-capex-share",cohort:"pilot-banks",temporalPolicy:"point-in-time",selectedMeasureIds:["m1"]};
const current={...context,read:"ok" as const,membership:"complete" as const,generation:"g1",observations:[{id:"m1",availability:"available" as const,qualified:true,excluded:false,correction:false,contentIdentity:"c1",qualificationIdentity:"q1",interpretation:{value:10,unit:"%",basis:"USD-constant",cohort:"pilot-banks"}}],tombstones:[]};
const review=reviewIntlEvidence(null,current,context);
const owner={lang:"en" as const,question:"Exact question",marketLabel:"Global equities",toolLabel:"Intl",periodLabel:"Q4",basisLabel:"USD",savedAt:null,updatedAt:null,sourceGenerationAt:null,rightsAt:null,measureLabels:{m1:"Capex"},unmetLabels:[]};
test("callback channel cannot replace adjudicated comparison or numeric props",()=>{
 const out=composeIntlInvestigationPanel({review,owner,callbacks:{comparisonStatus:"unchanged",selectedMeasures:[{value:999,availability:"qualified"}]} as never});
 assert.equal(out.ok,false);
 if(!out.ok) assert.equal(out.reason,"invalid_input");
});
test("non-callable callback is refused before a deliberate interaction can throw",()=>{
 const out=composeIntlInvestigationPanel({review,owner,callbacks:{onInspect:"not-a-function"} as never});
 assert.equal(out.ok,false);
 if(!out.ok) assert.equal(out.reason,"invalid_input");
});
