import { describe, it, expect } from "vitest";
import { decodeObservedStatistics } from "../optionsObservedStatistics";
// Synthetic fixture emitted by actual reviewed Python snapshot at 05f75f1d.
const fixture = {
  "observed_statistics": {
    "schema": "options.observed_statistics_snapshot/v1",
    "session_date": "2026-10-24",
    "first_observed_at": "2026-10-24T14:00:01+00:00",
    "last_observed_at": "2026-10-24T14:00:01+00:00",
    "roots": {
      "SPY": {
        "first_observed_at": "2026-10-24T14:00:01+00:00",
        "last_observed_at": "2026-10-24T14:00:01+00:00",
        "first_trade_at": "2026-10-24T14:00:00+00:00",
        "last_trade_at": "2026-10-24T14:00:00+00:00",
        "input_row_count": 1,
        "rejected_row_count": 0,
        "duplicate_row_count": 0,
        "conflicting_identity_count": 0,
        "ambiguous_row_count": 0,
        "source_input_row_count": 1,
        "source_rejected_row_count": 0,
        "source_non_novel_row_count": 0,
        "totals": {
          "print_count": 1,
          "contract_volume": 3,
          "premium_qualified_print_count": 1,
          "premium_print_coverage": 1.0,
          "qualified_premium_usd": 600.0,
          "premium_total_status": "QUALIFIED_SUBTOTAL"
        },
        "rights": {
          "C": {
            "print_count": 1,
            "contract_volume": 3,
            "premium_qualified_print_count": 1,
            "premium_print_coverage": 1.0,
            "qualified_premium_usd": 600.0,
            "premium_total_status": "QUALIFIED_SUBTOTAL"
          },
          "P": {
            "print_count": 0,
            "contract_volume": 0,
            "premium_qualified_print_count": 0,
            "premium_print_coverage": null,
            "qualified_premium_usd": null,
            "premium_total_status": "UNAVAILABLE"
          }
        },
        "locations": {
          "below_bid": {
            "print_count": 0,
            "contract_volume": 0,
            "premium_qualified_print_count": 0,
            "premium_print_coverage": null,
            "qualified_premium_usd": null,
            "premium_total_status": "UNAVAILABLE"
          },
          "at_bid": {
            "print_count": 0,
            "contract_volume": 0,
            "premium_qualified_print_count": 0,
            "premium_print_coverage": null,
            "qualified_premium_usd": null,
            "premium_total_status": "UNAVAILABLE"
          },
          "inside_below_mid": {
            "print_count": 0,
            "contract_volume": 0,
            "premium_qualified_print_count": 0,
            "premium_print_coverage": null,
            "qualified_premium_usd": null,
            "premium_total_status": "UNAVAILABLE"
          },
          "at_mid": {
            "print_count": 1,
            "contract_volume": 3,
            "premium_qualified_print_count": 1,
            "premium_print_coverage": 1.0,
            "qualified_premium_usd": 600.0,
            "premium_total_status": "QUALIFIED_SUBTOTAL"
          },
          "inside_above_mid": {
            "print_count": 0,
            "contract_volume": 0,
            "premium_qualified_print_count": 0,
            "premium_print_coverage": null,
            "qualified_premium_usd": null,
            "premium_total_status": "UNAVAILABLE"
          },
          "at_ask": {
            "print_count": 0,
            "contract_volume": 0,
            "premium_qualified_print_count": 0,
            "premium_print_coverage": null,
            "qualified_premium_usd": null,
            "premium_total_status": "UNAVAILABLE"
          },
          "above_ask": {
            "print_count": 0,
            "contract_volume": 0,
            "premium_qualified_print_count": 0,
            "premium_print_coverage": null,
            "qualified_premium_usd": null,
            "premium_total_status": "UNAVAILABLE"
          },
          "UNKNOWN": {
            "print_count": 0,
            "contract_volume": 0,
            "premium_qualified_print_count": 0,
            "premium_print_coverage": null,
            "qualified_premium_usd": null,
            "premium_total_status": "UNAVAILABLE"
          }
        },
        "venues": {
          "int:0": {
            "print_count": 1,
            "contract_volume": 3,
            "premium_qualified_print_count": 1,
            "premium_print_coverage": 1.0,
            "qualified_premium_usd": 600.0,
            "premium_total_status": "QUALIFIED_SUBTOTAL"
          }
        },
        "nbbo_print_coverage": 1.0,
        "venue_print_coverage": 1.0,
        "status": "OBSERVED"
      }
    },
    "status": "OBSERVED",
    "population": "prospective_observed_source_valid_novel_prints",
    "coverage": "caller_selected_roots_not_whole_market_or_whole_session",
    "continuity": "observed_poll_batches_continuous_session_coverage_not_established",
    "source_counter_basis": "received_rows_across_poll_batches_including_repeated_observations"
  }
};
const now = Date.parse("2026-10-24T14:00:02Z");
const decode = (data: unknown = fixture, root = "SPY", time = now) => decodeObservedStatistics(data, root, time);
type MutableBucket = Record<string, unknown>;
type MutableRoot = Record<string, unknown> & { totals: MutableBucket; rights: Record<string, MutableBucket>; locations: Record<string, MutableBucket>; venues: Record<string, MutableBucket> };
const edit = (fn: (s: Record<string, unknown>, r: MutableRoot) => void) => { const f = structuredClone(fixture); fn(f.observed_statistics, f.observed_statistics.roots.SPY as unknown as MutableRoot); return f; };
describe("observed Statistics producer contract", () => {
  it("retains actual producer population, qualified subtotal and opaque venue", () => {
    const before = JSON.stringify(fixture), result = decode();
    expect(result).toMatchObject({state:"available",status:"OBSERVED",stale:false,sessionDate:"2026-10-24",totals:{print_count:1,contract_volume:3,qualified_premium_usd:600},venues:{"int:0":{print_count:1}},nbboPrintCoverage:1});
    expect(JSON.stringify(fixture)).toBe(before);
  });
  it.each([null, undefined, {}, {observed_statistics:undefined}])("keeps absent publisher unavailable", input => expect(decodeObservedStatistics(input,"SPY",now)).toEqual({state:"unavailable",reason:"publisher_absent"}));
  it("recognizes explicit unavailable and unobserved roots", () => {
    expect(decode({observed_statistics:{schema:"options.observed_statistics_snapshot/v1",status:"UNAVAILABLE",roots:null}}).state).toBe("unavailable");
    expect(decode(fixture,"QQQ")).toEqual({state:"unavailable",reason:"root_unobserved"});
  });
  it("uses the selected root observation clock, not envelope freshness", () => {
    const f = edit(s => s.last_observed_at="2026-10-24T15:00:00Z");
    expect(decode(f,"SPY",Date.parse("2026-10-24T15:00:01Z"))).toMatchObject({state:"available",stale:true,sessionDate:"2026-10-24"});
    expect(decode(fixture,"SPY",Date.parse("2026-10-25T14:00:00Z"))).toMatchObject({state:"available",stale:true,sessionDate:"2026-10-24"});
  });
  it.each([
    (s:Record<string, unknown>)=>s.schema="other", (s:Record<string, unknown>)=>s.coverage="whole_market",
    (s:Record<string, unknown>)=>s.session_date="2026-02-30", (s:Record<string, unknown>)=>s.last_observed_at="2026-10-24T14:00:01",
    (s:Record<string, unknown>)=>s.last_observed_at="2026-10-24T14:24:01Z",
    (_:Record<string, unknown>,r:MutableRoot)=>r.last_observed_at="2026-02-30T14:00:01Z",
    (_:Record<string, unknown>,r:MutableRoot)=>r.source_input_row_count=4,
    (_:Record<string, unknown>,r:MutableRoot)=>r.totals.print_count=Number.MAX_SAFE_INTEGER+1,
    (_:Record<string, unknown>,r:MutableRoot)=>r.totals.contract_volume=true,
    (_:Record<string, unknown>,r:MutableRoot)=>r.locations.at_mid.print_count=0,
    (_:Record<string, unknown>,r:MutableRoot)=>r.nbbo_print_coverage=0.5,
    (_:Record<string, unknown>,r:MutableRoot)=>r.totals.qualified_premium_usd=Infinity,
    (_:Record<string, unknown>,r:MutableRoot)=>r.status="OBSERVED_EMPTY",
    (_:Record<string, unknown>,r:MutableRoot)=>r.venues.NYSE=r.venues["int:0"],
    (_:Record<string, unknown>,r:MutableRoot)=>r.first_trade_at="2026-10-24T15:00:00Z",
  ])("rejects corrupt or misleading metadata", fn => expect(decode(edit(fn)).state).toBe("invalid"));
  it("does not read inherited snapshot properties", () => expect(decode(Object.create(fixture))).toEqual({state:"unavailable",reason:"publisher_absent"}));
  it.each(["UNAVAILABLE", "UNREPRESENTABLE"]) ("preserves null premium %s", status => {
    const f = edit((_,r) => {
      for (const b of [r.totals, ...Object.values(r.rights), ...Object.values(r.locations), ...Object.values(r.venues)] as MutableBucket[]) {
        b.qualified_premium_usd=null;
        b.premium_total_status=b.print_count && status==="UNREPRESENTABLE" ? status:"UNAVAILABLE";
        b.premium_qualified_print_count=status==="UNREPRESENTABLE" ? b.print_count:0;
        b.premium_print_coverage=b.print_count ? (status==="UNREPRESENTABLE" ? 1:0):null;
      }
    });
    expect(decode(f)).toMatchObject({state:"available",totals:{qualified_premium_usd:null,premium_total_status:status}});
  });
  it.each(["OBSERVED_EMPTY", "NO_VALID_SOURCE_ROWS", "NO_NEW_VALID_ROWS", "NO_UNAMBIGUOUS_VALID_ROWS"]) ("distinguishes %s from missing data", status => {
    const f=edit((_,r)=>{
      for(const b of [r.totals,...Object.values(r.rights),...Object.values(r.locations)] as MutableBucket[]) Object.assign(b,{print_count:0,contract_volume:0,premium_qualified_print_count:0,premium_print_coverage:null,qualified_premium_usd:null,premium_total_status:"UNAVAILABLE"});
      r.venues={}; r.nbbo_print_coverage=null;r.venue_print_coverage=null;r.first_trade_at=null;r.last_trade_at=null;r.status=status;
      for(const k of ["input_row_count","rejected_row_count","duplicate_row_count","conflicting_identity_count","ambiguous_row_count","source_input_row_count","source_rejected_row_count","source_non_novel_row_count"]) r[k]=0;
      if(status!=="OBSERVED_EMPTY")r.source_input_row_count=2;
      if(status==="NO_VALID_SOURCE_ROWS")r.source_rejected_row_count=2;
      if(status==="NO_NEW_VALID_ROWS")r.source_non_novel_row_count=2;
      if(status==="NO_UNAMBIGUOUS_VALID_ROWS"){r.input_row_count=2;r.ambiguous_row_count=2;r.conflicting_identity_count=1;}
    });
    expect(decode(f)).toMatchObject({state:"available",status,totals:{print_count:0},nbboPrintCoverage:null});
  });
});
