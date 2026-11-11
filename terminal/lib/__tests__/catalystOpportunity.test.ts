import { describe, expect, it } from "vitest";
import fixture from "./fixtures/catalystOpportunity.json";
import { decodeCatalystView, CatalystDecodeError, AUTHORITY_KEYS } from "../catalystOpportunity";

const copy = () => structuredClone(fixture);

describe("Catalyst closed read contract",()=>{
  it("consumes the Python producer's synthetic serialization without inventing values",()=>{
    const result = decodeCatalystView(copy());
    expect(result.cases).toHaveLength(2);
    expect(result.coverage).toMatchObject({valid:3,watch_count:2,not_all_securities:true});
    expect(result.cases[0].metrics.rel_5d).toBe(.0621);
    expect(result.cases[0].entry.status).toBe("unavailable");
    expect(result.source?.historical_availability_proven).toBe(false);
  });
  it("strips arbitrary upstream fields rather than forwarding raw JSON",()=>{
    const input = {...copy(),private_debug:"not public",token:"secret"};
    const result = decodeCatalystView(input);
    expect(JSON.stringify(result)).not.toContain("private_debug");
    expect(JSON.stringify(result)).not.toContain("secret");
  });
  it.each(AUTHORITY_KEYS)("refuses widening %s",key=>{
    const input=copy();(input.authority as Record<string,boolean>)[key]=true;
    expect(()=>decodeCatalystView(input)).toThrow(CatalystDecodeError);
  });
  it("refuses an extra authority key, including future unknown permissions",()=>{
    const input=copy();Object.assign(input.authority,{can_buy:true});
    expect(()=>decodeCatalystView(input)).toThrow();
  });
  it("refuses a recommendation disguised as a case",()=>{
    const input=copy();input.cases[0].discovery_state="buy_now";
    expect(()=>decodeCatalystView(input)).toThrow();
  });
  it.each([true,"0.6",Infinity,NaN])("does not turn malformed measurements into numbers",value=>{
    const input=copy();Object.assign(input.cases[0].metrics,{rel_5d:value});
    expect(()=>decodeCatalystView(input)).toThrow();
  });
  it("preserves unknown rather than zero",()=>{
    const input=copy();Object.assign(input.cases[0].metrics,{rel_5d:null,pct50:null});
    const result=decodeCatalystView(input);
    expect(result.cases[0].metrics.rel_5d).toBeNull();
    expect(result.cases[0].metrics.pct50).toBeNull();
  });
  it.each([-1,1.01])("refuses impossible breadth",value=>{
    const input=copy();input.cases[0].metrics.pct50=value;
    expect(()=>decodeCatalystView(input)).toThrow();
  });
  it("refuses a future receipt",()=>{
    const input=copy();input.source.received_at="2027-01-01T00:00:00Z";
    expect(()=>decodeCatalystView(input)).toThrow();
  });
  it.each(["2026-10-18", "2026-11-01", "2027-01-01"])("refuses future source date %s even when all source references agree",asOf=>{
    const input=copy();input.as_of=asOf;input.source.as_of=asOf;
    for (const row of input.cases) {
      row.observed_on=asOf;
      for (const source of row.source_refs) source.as_of=asOf;
    }
    expect(()=>decodeCatalystView(input)).toThrow(CatalystDecodeError);
  });
  it("accepts a date-only source from the assessment's UTC calendar day",()=>{
    const input=copy(), asOf=input.assessed_at.slice(0,10);
    input.as_of=asOf;input.source.as_of=asOf;input.source.age_calendar_days=0;
    for (const row of input.cases) {
      row.observed_on=asOf;
      for (const source of row.source_refs) source.as_of=asOf;
    }
    expect(decodeCatalystView(input).as_of).toBe(asOf);
  });
  it("refuses a case with a different observation date",()=>{
    const input=copy();input.cases[0].observed_on="2026-10-17";
    expect(()=>decodeCatalystView(input)).toThrow();
  });
  it("refuses source/case identity disagreement",()=>{
    const input=copy();input.cases[0].source_refs[0].theme_id="defense";
    expect(()=>decodeCatalystView(input)).toThrow();
  });
  it("refuses mismatched counts and duplicates",()=>{
    const a=copy();a.coverage.watch_count=99;expect(()=>decodeCatalystView(a)).toThrow();
    const b=copy();b.inventory[0].theme_id=b.inventory[1].theme_id;expect(()=>decodeCatalystView(b)).toThrow();
    const c=copy();c.cases[1]=c.cases[0];expect(()=>decodeCatalystView(c)).toThrow();
  });
  it("does not change source ordering into opportunity ranking",()=>{
    const input=copy();input.cases.reverse();input.cases[0].metrics.rank=33;
    expect(decodeCatalystView(input).cases.map(c=>c.theme_id)).toEqual(["defense","energy_complex"]);
  });
  it.each(["javascript:alert(1)","https://evil.example", "https://www.mastermind-x.com@evil.example/"])("refuses arbitrary links",href=>{
    const input=copy();input.cases[0].links[0].href=href;
    expect(()=>decodeCatalystView(input)).toThrow();
  });
  it("does not make stale observations look ready",()=>{
    const input=copy();input.source.freshness="stale";
    expect(()=>decodeCatalystView(input)).toThrow();
  });
  it("sanitizes decoder errors",()=>{
    try{decodeCatalystView({password:"sensitive"});}catch(e){expect(String(e)).not.toContain("sensitive");}
  });
});
