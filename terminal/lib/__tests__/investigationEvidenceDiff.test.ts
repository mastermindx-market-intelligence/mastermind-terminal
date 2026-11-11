import {describe,expect,it} from "vitest";
import {reviewEvidence, type EvidenceCensus, type EvidenceObservation} from "../investigationEvidenceDiff";

const row=(id="release",patch:Partial<EvidenceObservation>={}):EvidenceObservation=>({
 id,availability:"available",contentIdentity:"content-1",qualificationIdentity:"qualification-1",
 correction:false,excluded:false,interpretation:{value:0,unit:"USD",basis:"reported",cohort:"FY2026"},...patch,
});
const census=(items=[row()],patch:Partial<EvidenceCensus>={}):EvidenceCensus=>({
 scope:{owner:"earnings.workspace_generation",query:"event:aapl-q3",cohort:"all-sources",temporalPolicy:"platform-known"},
 read:"ok",membership:"complete",generation:"generation-1",items,tombstones:[],...patch,
});
describe("Investigation evidence comparison without false absence",()=>{
 it.each(["page","top_k","unknown"] as const)("%s absence cannot prove removal",membership=>{
  const result=reviewEvidence(census(),census([],{membership}));
  expect(result.items[0]).toMatchObject({membership:"not_observed",version:"unknown"});
  expect(result.summary).toBe("incomplete");
 });
 it("requires a complete comparable census or an explicit owner tombstone",()=>{
  expect(reviewEvidence(census(),census([])).items[0].membership).toBe("removed");
  expect(reviewEvidence(census(),census([],{membership:"page",tombstones:["release"]})).items[0].membership).toBe("removed");
 });
 it("changed query/cohort/time policy refuses a comparison even with tombstones",()=>{
  for(const key of ["owner","query","cohort","temporalPolicy"] as const){
   const current=census([],{tombstones:["release"]});current.scope={...current.scope,[key]:"changed"};
   expect(reviewEvidence(census(),current)).toMatchObject({summary:"scope_changed",items:[]});
  }
 });
 it.each(["denied","unavailable"] as const)("%s reads expose no old rows and never mean empty",read=>{
  expect(reviewEvidence(census(),census([],{read}))).toMatchObject({summary:read,items:[]});
  expect(reviewEvidence(census([],{read}),census())).toMatchObject({summary:read,items:[]});
 });
 it("does not call a transport-only generation change a content revision",()=>{
  const result=reviewEvidence(census(),census([row()],{generation:"generation-2"}));
  expect(result.summary).toBe("unchanged");expect(result.items[0]).toMatchObject({version:"unchanged",qualification:"unchanged"});
 });
 it("keeps qualification, exclusion, correction and content change independent",()=>{
  const change=row("release",{qualificationIdentity:"qualification-2",excluded:true,correction:true});
  expect(reviewEvidence(census(),census([change])).items[0]).toMatchObject({membership:"present",version:"unchanged",qualification:"changed",excluded:true,correction:true});
  expect(reviewEvidence(census(),census([row("release",{contentIdentity:"content-2"})])).items[0].version).toBe("revised");
 });
 it("stale/null/missing units never become zero or a valid numeric delta",()=>{
  for(const change of [row("release",{availability:"stale"}),row("release",{interpretation:{value:null,unit:"USD",basis:"reported",cohort:"FY2026"}}),row("release",{interpretation:{value:0,unit:null,basis:"reported",cohort:"FY2026"}})]){
   const result=reviewEvidence(census(),census([change]));expect(result.items[0].interpretation.comparable).toBe(false);expect(result.summary).not.toBe("unchanged");
  }
  expect(reviewEvidence(census(),census()).items[0].interpretation).toEqual({comparable:true,prior:0,current:0,delta:0});
 });
 it("refuses numeric comparisons across units, basis or cohorts",()=>{
  for(const key of ["unit","basis","cohort"] as const){
   const current=row();current.interpretation={...current.interpretation!,[key]:"different"};
   expect(reviewEvidence(census(),census([current])).items[0].interpretation).toMatchObject({comparable:false,reason:"incompatible"});
  }
 });
 it("a missing old row in an incomplete baseline cannot prove a new addition",()=>{
  const result=reviewEvidence(census([],{membership:"top_k"}),census());
  expect(result.items[0].membership).toBe("not_previously_observed");expect(result.summary).toBe("incomplete");
 });
 it("missing identities cannot prove unchanged, and invalid duplicate rows fail closed",()=>{
  expect(reviewEvidence(census(),census([row("release",{contentIdentity:null})])).summary).toBe("incomplete");
  expect(reviewEvidence(census(),census([row(),row()]))).toMatchObject({summary:"invalid",items:[]});
 });
 it("is a pure read and leaves both saved baseline and current census unchanged",()=>{
  const old=census(),current=census([row("transcript")]);const before=JSON.stringify([old,current]);
  reviewEvidence(old,current);expect(JSON.stringify([old,current])).toBe(before);
 });
});
