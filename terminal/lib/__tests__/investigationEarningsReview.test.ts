import {describe,expect,it} from "vitest";
import fixture from "./fixtures/aapl-event-workspace.json";
import {normalizeEventWorkspace,type RetainedEventWorkspaceResult} from "../eventWorkspace";
import {reviewRetainedEarnings} from "../investigationEarningsReview";
function retained():Extract<RetainedEventWorkspaceResult,{ok:true}>{
 const workspace=normalizeEventWorkspace(structuredClone(fixture));
 if(!workspace)throw Error("Invalid owner fixture");
 return {ok:true,workspace,receipt:{schema:"earnings.retained_baseline.v1",owner:"earnings.workspace_generation",company_id:workspace.issuer.company_id,event_id:workspace.event_id,generation_id:workspace.generation_id,workspace_schema:workspace.schema,manifest_schema:"event_workspace_manifest.v3",authority:"context_only",manifest_sha256:"a".repeat(64),manifest_bytes:1,workspace_sha256:"b".repeat(64),workspace_bytes:1,fingerprint:"c".repeat(64),public_known_at:workspace.lifecycle.source_available_at,platform_known_at:workspace.lifecycle.observed_at,generation_emitted_at:workspace.generated_at,rights:{allowed:true,checked_at:workspace.generated_at,policy_version:"fixture-current-rights"}}};
}
describe("existing Earnings owner change projection",()=>{
 it("does not infer a complete census from lifecycle complete or missing fact rows",()=>{
  const old=retained(),now=retained();now.workspace.facts=[];
  const result=reviewRetainedEarnings(old,now);
  expect(result.removalProofAvailable).toBe(false);expect(result.review.summary).toBe("incomplete");
  expect(result.review.items.filter(row=>row.id.startsWith("fact:")).every(row=>row.membership==="not_observed")).toBe(true);
  expect(result.review.items.some(row=>row.membership==="removed")).toBe(false);
 });
 it("detects transcript-only source changes with an unchanged issuer release",()=>{
  const old=retained(),now=retained();const source=now.workspace.sources.find(s=>s.kind==="transcript")!;
  expect(source).toBeDefined();source.source_sha256="d".repeat(64);
  const result=reviewRetainedEarnings(old,now);
  expect(result.review.items.find(row=>row.id.startsWith("source:transcript:"))?.version).toBe("revised");
  expect(result.review.items.find(row=>row.id.startsWith("source:issuer_release:"))?.version).toBe("unchanged");
 });
 it("keeps transport clocks separate from source content and qualifications",()=>{
  const old=retained(),now=retained();now.workspace.generated_at="2026-10-04T00:00:00Z";now.workspace.lifecycle.observed_at=now.workspace.generated_at;
  const result=reviewRetainedEarnings(old,now);
  expect(result.review.items.some(row=>row.version==="revised"||row.qualification==="changed")).toBe(false);
 });
 it("exposes corrections as qualification changes independently of source body",()=>{
  const old=retained(),now=retained();now.workspace.lifecycle.state="corrected";
  const result=reviewRetainedEarnings(old,now);
  expect(result.review.items.find(row=>row.id==="owner:qualification")).toMatchObject({qualification:"changed",correction:true});
  expect(result.review.items.filter(row=>row.id!=="owner:qualification").every(row=>row.qualification==="unchanged"&&!row.correction)).toBe(true);
  expect(result.review.items.some(row=>row.version==="revised")).toBe(false);
 });
 it("refuses denied or mismatched current owner receipts without old row disclosure",()=>{
  const old=retained(),now=retained();now.receipt.company_id="cik:0000000001";
  expect(reviewRetainedEarnings(old,now).review).toMatchObject({summary:"unavailable",items:[]});
  expect(reviewRetainedEarnings(old,{ok:false,code:"HISTORICAL_UNAVAILABLE",reason:"denied"}).review).toMatchObject({summary:"denied",items:[]});
 });
});
