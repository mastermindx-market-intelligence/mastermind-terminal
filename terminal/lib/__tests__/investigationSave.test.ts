import { describe, expect, it } from "vitest";
import { beginInvestigationSave, settleInvestigationSave, retryInvestigationSave, partitionInvestigationSave, recoverInvestigationSave } from "../investigationSave";
const command=()=>({id:"10000000-0000-4000-8000-000000000001",operation_id:"20000000-0000-4000-8000-000000000001",action:"create",expected_revision:0,manifest:{schema:"investigation_manifest.v2",intent:{title:"Research",question:"Exact draft",subjects:[]},layout_refs:[],thesis_refs:[],evidence_refs:[],continuation:{}}});
describe("lost Investigation save response",()=>{
 it("retains the original operation and draft across loss and a temporary receipt miss",()=>{
  const draft=command();const pending=beginInvestigationSave("alice",draft,{phase:"idle"});
  draft.manifest.intent.question="Edited after send";
  let state=settleInvestigationSave(pending,"alice",null);
  state=settleInvestigationSave(state,"alice",{status:"not_found"});
  expect(state.phase).toBe("uncertain");
  expect(retryInvestigationSave(state,"alice")).toEqual(command());
  const retry = retryInvestigationSave(state,"alice")!; retry.manifest.intent.question="Bad mutation";
  expect(retryInvestigationSave(state,"alice")?.manifest.intent.question).toBe("Exact draft");
  expect(beginInvestigationSave("alice",{...command(),operation_id:"30000000-0000-4000-8000-000000000001"},state)).toBe(state);
 });
 it("accepts the committed original response without consulting the later head",()=>{
  const original=command();const pending=beginInvestigationSave("alice",original,{phase:"idle"});
  const response={status:"committed",id:original.id,revision:1,lifecycle:"active",manifest:original.manifest,committed_at:"2026-10-04T00:00:00Z"};
  expect(settleInvestigationSave(pending,"alice",response)).toEqual({phase:"committed",principal:"alice",result:response});
 });
 it("partitions and clears pending data on logout or account switch",()=>{
  const pending=beginInvestigationSave("alice",command(),{phase:"idle"});
  expect(retryInvestigationSave(pending,"bob")).toBeNull();
  expect(partitionInvestigationSave(pending,"bob")).toEqual({phase:"idle"});
  expect(partitionInvestigationSave(pending,null)).toEqual({phase:"idle"});
  expect(beginInvestigationSave("bob",command(),pending)).toMatchObject({phase:"pending",principal:"bob"});
 });
 it("refuses a receipt from a different body even when id and revision match",()=>{
  const draft=command();const pending=beginInvestigationSave("alice",draft,{phase:"idle"});
  const result=settleInvestigationSave(pending,"alice",{status:"committed",id:draft.id,revision:1,lifecycle:"active",manifest:{...draft.manifest,intent:{...draft.manifest.intent,question:"Wrong question"}},committed_at:"2026-10-04T00:00:00Z"});
  expect(result.phase).toBe("uncertain");
 });
 it("keeps conflicting edits visible rather than silently rebasing and writing",()=>{
  const pending=beginInvestigationSave("alice",command(),{phase:"idle"});
  const result=settleInvestigationSave(pending,"alice",{status:"version_conflict",current_revision:8});
  expect(result.phase).toBe("rejected");expect(retryInvestigationSave(result,"alice")).toBeNull();
 });
});


it("recovers a rejected exact draft without inventing a commit or automatic retry",()=>{
 const original=command();
 const rejected=recoverInvestigationSave("alice",{owner:"alice",command:original,phase:"rejected",reason:"version_conflict"});
 expect(rejected).toEqual({phase:"rejected",principal:"alice",command:original,reason:"version_conflict"});
 expect(retryInvestigationSave(rejected!,"alice")).toBeNull();
 expect(recoverInvestigationSave("bob",{owner:"alice",command:original})).toBeNull();
 expect(recoverInvestigationSave("alice",{owner:"alice",command:{...original,manifest:{}}})).toBeNull();
 expect(recoverInvestigationSave("alice",{owner:"alice",command:original,phase:"committed"})?.phase).toBe("uncertain");
 expect(recoverInvestigationSave("alice",{owner:"alice",command:original})?.phase).toBe("uncertain");
});
