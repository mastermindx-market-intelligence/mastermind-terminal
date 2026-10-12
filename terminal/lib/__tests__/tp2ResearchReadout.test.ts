/** Fixture-only SSR source-maturity checks; no routes, credentials or vendor data. */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { decodeTp2PrivateArtifact, decodeTp2R0Sidecar } from "../../lib/tp2PrivateEvidence";
import { Tp2ResearchReadout } from "../../components/offexchange/Tp2ResearchReadout";

const tp2=readFileSync(new URL("../../lib/__tests__/fixtures/tp2PrivateView.synthetic.v0.json",import.meta.url));
const r0Raw=readFileSync(new URL("../../lib/__tests__/fixtures/tp2R0Sidecar.synthetic.v0.json",import.meta.url));
function evidence(){
  return decodeTp2PrivateArtifact({bytes:tp2,expectedSha256:
   "8c1ee4f865566f013d7a5805fccdd11c031223d39c6d8ec6b66968cbdc35f60b",
   expectedLength:tp2.length,requestedAsOfNs:"1791478890000000001"});
}
function r0(){
  return decodeTp2R0Sidecar({bytes:r0Raw,expectedSha256:
    "fe03401a908d26230aa6f8426f9dd9318249a0cdd2eac256ed93786a0a48b715",
    expectedLength:r0Raw.length,requestedAsOfNs:"1791478890000000001"});
}
function render(props:Parameters<typeof Tp2ResearchReadout>[0]){
  return renderToStaticMarkup(createElement(Tp2ResearchReadout,props));
}
const authorized=()=>({evidence:evidence(),r0:r0(),privateViewAuthorized:true as const,lang:"en" as const});

describe("Terminal TP-2 private source-aware readout",()=>{
  it("does not reveal private figures when existing auth has not admitted the read",()=>{
    const html=render({...authorized(),privateViewAuthorized:false});
    expect(html).toContain('data-testid="tp2-private-gated"');
    expect(html).toContain("Private access required");
    expect(html).not.toContain("SPY");
    expect(html).not.toContain("$250,000");
    expect(html).not.toContain("$500,000");
    expect(html).not.toContain("0.333333333333");
  });
  it("separates one print, a level cluster, a whole-day sample, and delayed ATS",()=>{
    const html=render(authorized());
    expect(html).toContain("Off-Exchange Intelligence");
    expect(html).toContain("Provisional tape");
    expect(html).toContain("Historical observations");
    expect(html).toContain("Delayed ATS");
    expect(html).toContain("Individual print");
    expect(html).toContain("Same-level cluster");
    expect(html).toContain("Observed day total");
    expect(html).toContain("$200,000");
    expect(html).toContain("$300,000");
    expect(html).toContain("$500,000");
    expect(html).toContain("Observed history, not all-time records");
    expect(html).not.toMatch(/BUY NOW|Institutional buyer|Confirmed absorption/);
  });
  it("never mathematically joins raw provisional and historical-qualified TRF",()=>{
    const html=render(authorized());
    expect(html).toContain("Provisional any-condition TRF");
    expect(html).toContain("$250,000");
    expect(html).toContain("$500,000");
    expect(html).toContain("Not comparable to historical-qualified totals");
    expect(html).not.toContain("$750,000");
    expect(html).toContain("not source authenticated");
  });
  it("keeps FINRA named ATS delayed, distinct and unavailable in this source",()=>{
    const html=render(authorized());
    expect(html).toContain("Delayed FINRA ATS attribution is not supplied here");
    expect(html).toContain("Existing EOD context is separate");
    expect(html).not.toContain("TRF 201 is");
  });
  it("shows exact-minute cumulative context and honest historical sample N",()=>{
    const html=render(authorized());
    expect(html).toContain("Minute 30");
    expect(html).toContain("40%");
    expect(html).toContain("5 comparable prior sessions");
    expect(html).toContain("#1");
    expect(html).toContain("source age");
  });
  it("marks R0 quote-location as descriptive and not a validated predictor",()=>{
    const html=render(authorized());
    expect(html).toContain("NBBO research context");
    expect(html).toContain("0.333333");
    expect(html).toContain("Quote-location proxy only");
    expect(html).toContain("No validated directional edge");
    expect(html).not.toContain("Entry level");
  });
  it("uses approved Mastermind design tokens and responsive layout classes",()=>{
    const html=render(authorized());
    expect(html).toContain("var(--panel)");
    expect(html).toContain("var(--line)");
    expect(html).toContain("grid-cols-1");
    expect(html).toContain("lg:grid-cols-3");
    for(const part of ["tp2-provisional","tp2-history","tp2-delayed"])
      expect(html).toContain('data-testid="'+part+'"');
  });
  it("localizes source maturity in Chinese without changing reported figures",()=>{
    const html=render({...authorized(),lang:"zh"});
    expect(html).toContain("盘外成交情报");
    expect(html).toContain("临时成交样本");
    expect(html).toContain("历史参照");
    expect(html).toContain("延迟 ATS");
    expect(html).toContain("$250,000");
    expect(html).toContain("$500,000");
    expect(html).not.toMatch(/买入信号|机构买入确认/);
    expect(html).toContain("不代表具体 ATS 或机构买家");
  });
  it("shows unavailable, not zero, for missing source",()=>{
    const html=render({evidence:null,r0:null,privateViewAuthorized:true,lang:"en"});
    expect(html).toContain("Source not yet available");
    expect(html).toContain("Not evidence of zero trading");
    expect(html).not.toContain("$0");
    expect(html).not.toContain("No unusual trades");
  });
  it("withholds wrong-ticker R0 sidecar rather than leaking another name",()=>{
    const html=render({...authorized(),r0:{...r0(),ticker:"QQQ"}});
    expect(html).toContain("R0 context withheld");
    expect(html).not.toContain("0.333333");
    expect(html).not.toContain("QQQ");
  });
  it("withholds a source-independent R0 sidecar when TP-2 has no ticker identity",()=>{
    const html=render({evidence:null,r0:r0(),privateViewAuthorized:true,lang:"en"});
    expect(html).toContain("Source not yet available");
    expect(html).toContain("R0 context withheld");
    expect(html).not.toContain("0.333333");
    expect(html).not.toContain("SPY");
  });
  it("shows historical correction staleness rather than a valid old rank",()=>{
    const current=evidence();
    const stale={...current,state:"CALIBRATION_STALE_SOURCE_GENERATION",
      ranks:null,minuteBaseline:null};
    const html=render({...authorized(),evidence:stale});
    expect(html).toContain("History stale after source correction");
    expect(html).toContain("Historical ruler not yet qualified");
    expect(html).not.toContain("Observed sample rank");
  });
  it("shows pending calibration without substituting zero or record ranks",()=>{
    const current=evidence();
    const pending={...current,state:"HISTORICAL_CALIBRATION_PENDING",
      ranks:null,minuteBaseline:null};
    const html=render({...authorized(),evidence:pending});
    expect(html).toContain("Historical calibration pending");
    expect(html).not.toContain("Observed sample rank");
    expect(html).not.toContain("$0");
  });
  it("withholds whole-day ranks from an incomplete RTH session",()=>{
    const current=evidence();
    if(!current.observed) throw new Error("fixture unexpectedly lacks source");
    const partial={...current,observed:{
      ...current.observed,fullRthCoveredClaimUnverified:false}};
    const html=render({...authorized(),evidence:partial});
    expect(html).toContain("Partial RTH session");
    expect(html).not.toContain("Observed sample rank");
    expect(html).not.toContain("#1");
  });
  it("has no active fake buttons, source URLs, scripts or routes",()=>{
    const html=render(authorized());
    expect(html).not.toMatch(/<button\b|<a\s+href|<script\b/);
    expect(html).not.toContain("source_frame_sha256");
    expect(html).not.toContain("trade_id");
    expect(html).not.toContain("R2_BASE");
  });
  it("uses timestamp only for display after source BigInt verification",()=>{
    const html=render(authorized());
    expect(html).toContain("Oct");
    expect(html).toContain("2026");
    expect(html).toContain("America/New_York");
    expect(html).not.toContain("NaN");
  });
});
