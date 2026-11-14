import { describe, expect, it } from "vitest";
import { candidateScore, decodeProphetCandidatePool } from "@/lib/prophetCandidatePool";
import { candidatePoolFixture } from "./fixtures/prophetCandidatePool";

describe("complete candidate pool consumer contract", () => {
  it("accepts an original synthetic publication projected by the actual Macro owner", () => {
    const source = candidatePoolFixture(), result = decodeProphetCandidatePool(source)!;
    expect(result).toEqual(source);
    expect(result.projection.rows.map(row => row.ticker)).toEqual(["DEMOA", "DEMOB", "DEMOC", "DEMOD"]);
    expect(result.projection.rows[1].prophet?.score).toBe(0);
    expect(result.projection.rows[2].prophet).toBeNull();
    expect(result.projection.rows[2].pool_rank).toBe("7");
    expect(result.projection.counts).toEqual({ eligible:4, in_buy_lane:2, off_buy_lane:2, scored:2, unscored:2 });
  });
  it("preserves numeric precision and a legitimate zero score", () => {
    expect(candidateScore(0)).toBe("0.0"); expect(candidateScore(82.5123)).toBe("82.5123");
  });
  it("keeps a verified empty population distinct from unknown counts", () => {
    const empty = candidatePoolFixture(); empty.projection.status="empty"; empty.projection.rows=[];
    for (const key of Object.keys(empty.projection.counts) as (keyof typeof empty.projection.counts)[]) empty.projection.counts[key]=0;
    expect(decodeProphetCandidatePool(empty)?.projection.status).toBe("empty");
    const unknown = candidatePoolFixture(); unknown.projection.status="unavailable"; unknown.projection.rows=[];
    unknown.projection.reason="candidate_pool_absent"; unknown.projection.source_digest=null; unknown.projection.as_of=null;
    for (const key of Object.keys(unknown.projection.counts) as (keyof typeof unknown.projection.counts)[]) unknown.projection.counts[key]=null;
    expect(decodeProphetCandidatePool(unknown)?.projection.counts.eligible).toBeNull();
    unknown.projection.counts.eligible=0; expect(decodeProphetCandidatePool(unknown)).toBeNull();
  });
  it.each(["market","schema","hash","hashNewline","bytes","clock","yearZero","unknownDate","dateNewline","authority","digest","digestNewline","tickerNewline","tickerSpace","status","count","duplicate","cohort","zeroBasis","missingField","unsafeRank","hexRank"])("rejects a broken %s envelope without dropping rows", mutation => {
    const value = candidatePoolFixture();
    if(mutation==="market") (value as {market:string}).market="CN";
    if(mutation==="schema") (value as {schema:string}).schema="another-owner";
    if(mutation==="hash") value.source.sha256="a".repeat(64);
    if(mutation==="hashNewline") value.source.sha256+="\n";
    if(mutation==="bytes") value.source.bytes=8*1024*1024+1;
    if(mutation==="clock") value.projection.as_of="2026-02-30";
    if(mutation==="yearZero") value.projection.as_of="0000-01-01";
    if(mutation==="unknownDate") value.projection.as_of=null;
    if(mutation==="dateNewline") value.projection.as_of+="\n";
    if(mutation==="authority") (value.projection as {display_only:boolean}).display_only=false;
    if(mutation==="digest") value.projection.source_digest=null;
    if(mutation==="digestNewline") value.projection.source_digest+="\n";
    if(mutation==="tickerNewline") value.projection.rows[0].ticker+="\n";
    if(mutation==="tickerSpace") value.projection.rows[0].ticker+=" ";
    if(mutation==="status") value.projection.status="empty";
    if(mutation==="count") value.projection.counts.eligible=5;
    if(mutation==="duplicate") value.projection.rows[1].ticker="demoa";
    if(mutation==="cohort") { value.projection.rows[2].prophet={score:82}; value.projection.rows[2].prophet_score_basis="buy_lane_pool"; }
    if(mutation==="zeroBasis") value.projection.rows[1].prophet_score_basis=null;
    if(mutation==="missingField") delete (value.projection.rows[0] as Partial<typeof value.projection.rows[0]>).name;
    if(mutation==="unsafeRank") value.projection.rows[0].pool_rank=Number.MAX_SAFE_INTEGER+1;
    if(mutation==="hexRank") value.projection.rows[0].pool_rank="0x10";
    expect(decodeProphetCandidatePool(value)).toBeNull();
  });
  it("does not invent a meaning for unknown source decision codes", () => {
    const value=candidatePoolFixture();value.projection.rows[0].headline_reason="future_owner_code";
    value.projection.rows[0].lane_reasons=["future_owner_code"];
    expect(decodeProphetCandidatePool(value)?.projection.rows[0].headline_reason).toBe("future_owner_code");
  });
});
