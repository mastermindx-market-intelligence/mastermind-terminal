// @vitest-environment jsdom
import React from "react";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {cleanup,render,screen} from "@testing-library/react";
import {afterEach,describe,expect,it} from "vitest";
import raw from "./fixtures/intl_macro_risk_actual_20261104/IntlResolvedPacket.json";
import {resolveIntlInvestigation,type IntlResolvedPacket} from "@/lib/intlInvestigationCaller";
import {IntlInvestigationPanel} from "@/components/research/IntlInvestigationPanel";
const packet=()=>structuredClone(raw) as IntlResolvedPacket;
afterEach(cleanup);
describe("accepted actual Macro Risk packet through the native caller",()=>{
 it("retains the original source bytes and exact four-field values without creating a prior",()=>{
  const bytes=readFileSync(join(__dirname,"fixtures/intl_macro_risk_actual_20261104/IntlResolvedPacket.json"));
  expect(createHash("sha256").update(bytes).digest("hex")).toBe("061599958f1afb683e94289cbb521b7645c4a3a7594fa149f59a888c44f47e80");
  const input=packet(),before=structuredClone(input);const result=resolveIntlInvestigation({disposition:"resolved",...input});
  expect(input).toEqual(before);expect(input.prior).toBeNull();expect(result.kind).toBe("resolved");
  if(result.kind!=="resolved")throw Error("Unexpected disposition");
  expect(result.review.coverage).toEqual({selectedCount:4,qualifiedCount:4});
  expect(result.review.currentSafeCensus.items.map(row=>[row.id,row.interpretation?.value])).toEqual([["EZ.gdp_yoy",1.3],["EZ.cpi_yoy",3.8],["EZ.policy_rate",2.5],["EZ.annual_current_account",1.7]]);
  expect(result.review.baselineState).toBe("unavailable");expect(result.composition.ok).toBe(true);
  if(!result.composition.ok)throw Error(result.composition.reason);
  const props=result.composition.props;expect([props.savedAt,props.updatedAt,props.sourceGenerationAt,props.rightsAt]).toEqual([null,null,null,null]);
  expect(props.selectedMeasures.map(row=>row.observedAt)).toEqual(["2026-09-30","2026-09-30","2026-11-04","2025-12-31"]);
  render(<IntlInvestigationPanel {...props}/>);expect(screen.getByText(input.owner.question,{exact:true})).toBeTruthy();
  expect(props.selectedMeasures.find(row=>row.stableId==="EZ.annual_current_account")).toMatchObject({label:"Annual current account · extra-EA21",value:1.7,unit:"percent_gdp"});
  expect(screen.getAllByText("Annual current account · extra-EA21",{exact:true}).length).toBeGreaterThan(0);
 });
 it("refuses an actual packet whose source context was substituted",()=>{
  const input=packet();input.current.currencyBasis="USD";const result=resolveIntlInvestigation({disposition:"resolved",...input});
  expect(result).toMatchObject({kind:"disposition",disposition:"scope_changed",side:"current",fields:["currencyBasis"]});
 });
 it("scrubs a newly stale source value and its display observation clock",()=>{
  const input=packet();input.current.observations=[{...input.current.observations[0],availability:"stale"},...input.current.observations.slice(1)];
  const result=resolveIntlInvestigation({disposition:"resolved",...input});if(result.kind!=="resolved"||!result.composition.ok)throw Error("Unexpected refusal");
  expect(result.review.currentSafeCensus.items[0].interpretation).toBeNull();
  expect(result.composition.props.selectedMeasures[0]).toMatchObject({availability:"stale",value:null,observedAt:null});
 });
 it("keeps a denied whole read distinct and exposes no qualified interpretation",()=>{
  const input=packet();input.current.read="denied";const result=resolveIntlInvestigation({disposition:"resolved",...input});
  if(result.kind!=="resolved"||!result.composition.ok)throw Error("Unexpected refusal");
  expect(result.review.currentSafeCensus.items.every(row=>row.interpretation===null)).toBe(true);
  expect(result.composition.props.selectedMeasures.every(row=>row.value===null&&row.observedAt===null)).toBe(true);
 });
});
