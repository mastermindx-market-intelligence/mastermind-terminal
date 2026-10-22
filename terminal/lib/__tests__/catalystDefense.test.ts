import { describe, expect, it } from "vitest";
import owner from "./fixtures/catalystDefenseOwner.json";
import { decodeDefenseContext, defenseCoreFacts, DefenseDecodeError } from "../catalystDefense";
const now = Date.parse("2026-10-17T18:00:00Z");
const input = () => structuredClone(owner);

describe("Defense owner presentation boundary", () => {
  it("reads the original dated owner artifact without rewriting its content identity", () => {
    const payload=input(), result=decodeDefenseContext(payload,now);
    expect(result).toBe(payload);
    expect(result.content_id).toBe("dfe1-e90d7dd8f5678391f90e2c46");
    expect(result.profiles.map(p=>p.ticker_display)).toEqual(["LMT","RTX","NOC","LHX"]);
    expect(result.profiles.every(p=>p.axes.demand.state==="stale")).toBe(true);
    expect(defenseCoreFacts(result.profiles[0]).map(f=>f.value)).toEqual([4101,594,14.5]);
  });
  it.each(["can_rank","can_size","can_gate","can_originate_signal","can_escalate"] as const)("refuses widened %s authority",key=>{
    const p=input();p.authority[key]=true;
    expect(()=>decodeDefenseContext(p,now)).toThrow(DefenseDecodeError);
  });
  it("refuses future generation independently of a valid content reference",()=>{
    const p=input();p.generated_at="2026-10-18T00:00:00Z";
    expect(()=>decodeDefenseContext(p,now)).toThrow(DefenseDecodeError);
  });
  it("refuses impossible calendar dates",()=>{
    const p=input();p.generated_at="2026-02-30T00:00:00Z";
    expect(()=>decodeDefenseContext(p,now)).toThrow(DefenseDecodeError);
  });
  it("does not admit a name as issuer identity",()=>{
    const p=input();p.profiles[0].issuer_id=p.profiles[1].issuer_id;
    expect(()=>decodeDefenseContext(p,now)).toThrow(DefenseDecodeError);
  });
  it("rejects a financial fact from another issuer",()=>{
    const p=input();p.profiles[0].axes.economics.facts[0].owner_ref=p.profiles[1].axes.economics.facts[0].owner_ref;
    expect(()=>decodeDefenseContext(p,now)).toThrow(DefenseDecodeError);
  });
  it("retains source time limits even when the wrapper time is plausible",()=>{
    const p=input();p.profiles[0].axes.economics.observed_at="2027-01-01T00:00:00Z";
    expect(()=>decodeDefenseContext(p,now)).toThrow(DefenseDecodeError);
  });
  it("refuses an unbound narrative fact",()=>{
    const p=input();p.profiles[0].interpretation.chain[0].fact_refs[0].fact_id="invented-fact";
    expect(()=>decodeDefenseContext(p,now)).toThrow(DefenseDecodeError);
  });
  it("does not expose arbitrary source links",()=>{
    const p=input();p.profiles[0].axes.economics.facts[0].source_span.source_url="https://evil.example/collect";
    expect(()=>decodeDefenseContext(p,now)).toThrow();
  });
  it("refuses a false complete-state claim",()=>{
    const p=input();p.profiles[0].research_state="SOURCE_CONTEXT_COMPLETE";
    expect(()=>decodeDefenseContext(p,now)).toThrow(DefenseDecodeError);
  });
  it("keeps the quartet fixed instead of manufacturing a broader universe",()=>{
    const p=input();p.profiles.reverse();expect(()=>decodeDefenseContext(p,now)).toThrow(DefenseDecodeError);
  });
  it("refuses display values that are not finite numbers or source text",()=>{
    const p=input();p.profiles[0].axes.economics.facts[0].value=Infinity;
    expect(()=>decodeDefenseContext(p,now)).toThrow(DefenseDecodeError);
  });
});
