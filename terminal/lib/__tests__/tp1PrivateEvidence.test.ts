/** Phase A: synthetic, byte-exact frozen-v0 private evidence tests. No vendor feed. */
import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import { decodePrivateEvidence, pairPrivateEvidence, type EvidenceKind } from "../tp1PrivateEvidence";

const START = "1791417600000000000";
const END = "1791417660000000000";
const DECISION = "1791417662000000000";
const ARRIVED = "1791417640000000123"; // deliberately not representable as JS Number
const SHA = (c: string) => c.repeat(64);
const CLOCK_KEYS: Record<EvidenceKind, readonly string[]> = {
  minute: ["start_ns","end_ns","decision_ns","source_complete_through_ns",
    "source_watermark_available_ns","source_latest_print_available_ns","max_quote_age_ns"],
  research: ["start_ns","end_ns","decision_ns","source_quote_age_limit_ns"],
};
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "["+value.map(canonical).join(",")+"]";
  if (value && typeof value==="object") {
    const obj=value as Record<string,unknown>;
    return "{"+Object.keys(obj).sort().map(k=>JSON.stringify(k)+":"+canonical(obj[k])).join(",")+"}";
  }
  return JSON.stringify(value);
}
function minute(): Record<string,unknown> {
  return {
    schema:"equity.tick_plane.private_minute_artifact/v0",
    source_schema:"equity.tick_plane.minute_observation/v0",
    distribution_class:"PRIVATE_SERVICE_HOLD_PENDING_LICENSE_AND_CONSUMER_REVIEW",
    public_delivery_allowed:false,rank_trade_alert_authority:false,
    source_authenticity:"EXTERNAL_INCUMBENT_PROOF_REQUIRED",
    live_capture_completeness:"UNVERIFIED_BY_PROJECTION",
    source_mode:"ACTUAL_AS_SEEN_ONLY_WHEN_OWNER_PROVES_RECEIPTS",
    correction_status:"STREAM_PROVISIONAL_UNRECONCILED",
    ticker:"SPY",session:"2026-10-08:RTH",
    start_ns:START,end_ns:END,decision_ns:DECISION,
    source_complete_through_ns:END,
    source_watermark_available_ns:"1791417661000000000",
    source_latest_print_available_ns:ARRIVED,max_quote_age_ns:"25000000000",
    source_watermark_receipt_sha256:SHA("a"),source_manifest_sha256:SHA("b"),
    source_observation_sha256:SHA("c"),condition_policy_sha256:SHA("d"),
    exchange_policy_sha256:SHA("e"),quote_policy_sha256:SHA("f"),
    counts:{
      n_sampled_prints:2,n_lit:2,n_trf:0,n_unknown_venue:0,
      n_unclassified:0,n_condition_ineligible:0,n_buy_proxy:1,
      n_sell_proxy:1,n_midpoint:0,n_lit_eligible_prints:2,
      n_lit_classified_quote_le5s_prints:1,n_lit_classified_quote_gt5s_prints:1,
      n_lit_unclassified_prints:0,n_lit_source_unqualified_prints:0,
      n_source_volume_included_prints:2,n_source_volume_excluded_prints:0,
      n_source_volume_unknown_prints:0,
    },
    notional_usd:{
      gross_sampled_notional_usd:"2010.0",buy_proxy_notional_usd:"1009.0",
      sell_proxy_notional_usd:"1001.0",midpoint_notional_usd:"0",
      unknown_notional_usd:"0",ineligible_notional_usd:"0",
      trf_gross_notional_usd:"0",
    },
    volume_shares:{
      source_all_printed_shares:"20",source_volume_included_shares:"20",
      source_volume_excluded_shares:"0",source_volume_unknown_shares:"0",
    },
    lit_quoted_notional_coverage:"1",
    unknown_reason_counts:{},lit_unknown_reason_counts:{},
    price_response_bps:null,absorption_signal:null,
  };
}
function research(): Record<string,unknown> {
  return {
    schema:"equity.pressure_response.private_context_view/v0",
    source_schema:"equity.pressure_response.tp1_context/v0",
    distribution_class:"PRIVATE_SERVICE_HOLD_PENDING_LICENSE_REVIEW",
    public_delivery_allowed:false,rank_trade_alert_authority:false,
    source_authenticity:"ORIGINAL_TQ_RECEIPTS_REQUIRE_EXTERNAL_OWNER_PROOF",
    market_capture_completeness:"NOT_PROVEN_BY_RESEARCH_MATH",
    ticker:"SPY",session:"2026-10-08:RTH",
    start_ns:START,end_ns:END,decision_ns:DECISION,
    source_quote_age_limit_ns:"25000000000",
    source_manifest_sha256:SHA("b"),source_manifest_name_sha256:SHA("9"),
    source_watermark_receipt_sha256:SHA("a"),
    minute_observations_sha256:SHA("3"),
    quote_observations_sha256:SHA("4"),
    source_condition_rules_sha256:SHA("d"),
    source_exchange_rules_sha256:SHA("e"),
    source_quote_condition_rules_sha256:SHA("f"),
    n_observations:{n_source_minute_packets:1,n_sampled_prints:2,
      n_unclassified:0,n_quote_updates:3,n_quote_condition_unqualified:0},
    notional_usd:{
      gross_sampled_notional_usd:"2010.0",buy_proxy_notional_usd:"1009.0",
      sell_proxy_notional_usd:"1001.0",midpoint_notional_usd:"0",
      unknown_notional_usd:"0",ineligible_notional_usd:"0",
      trf_gross_notional_usd:"0",
    },
    classified_notional_coverage:"1",
    pressure_balance:"0.003980099502487562189054726368",
    completed_window_midpoint_response_bps:"0",
    bid_size_recovery_proxy:{
      state:"MEASURED_NBBO_SIZE_PROXY_NOT_ORDER_REPLENISHMENT",
      depletion_shares:"10",recovered_shares:"20",
      original_shares:"100",final_shares:"110",
      source_best_exchange:"11",source_best_price:"100",
    },
    ask_size_recovery_proxy:{
      state:"MEASURED_NBBO_SIZE_PROXY_NOT_ORDER_REPLENISHMENT",
      depletion_shares:"100",recovered_shares:"90",
      original_shares:"200",final_shares:"190",
      source_best_exchange:"12",source_best_price:"101",
    },
    absorption_signal:null,forward_label:null,
  };
}
function bytes(kind: EvidenceKind, document: Record<string,unknown>): Buffer {
  let text=canonical(document)+"\n";
  // Simulate the unchanged Python /v0 serializer's native JSON ns numbers.
  for (const name of CLOCK_KEYS[kind]) {
    const value=document[name] as string;
    const prior='"'+name+'":"'+value+'"';
    expect(text.split(prior).length).toBe(2);
    text=text.replace(prior,'"'+name+'":'+value);
  }
  return Buffer.from(text,"utf8");
}
function input(kind: EvidenceKind, mutate?: (obj: Record<string,unknown>)=>void) {
  const doc=kind==="minute"?minute():research();
  mutate?.(doc);
  const raw=bytes(kind,doc);
  return {kind,bytes:raw,expectedLength:raw.length,
    expectedSha256:createHash("sha256").update(raw).digest("hex")};
}
function forged(kind: EvidenceKind, edit: (doc:Record<string,unknown>)=>void) {
  return input(kind,edit);
}
function reject(kind:EvidenceKind, edit:(doc:Record<string,unknown>)=>void, pattern: RegExp) {
  expect(()=>decodePrivateEvidence(forged(kind,edit))).toThrowError(pattern);
}
describe("private source consumer: original ns precision without a second source",()=>{
  it("exposes exact bigint ns from canonical TP1 v0 bytes",()=>{
    const m=decodePrivateEvidence(input("minute"));
    expect(m.clocksNs.source_latest_print_available_ns).toBe(BigInt("1791417640000000123"));
    expect(m.clocksNs.decision_ns).toBe(BigInt("1791417662000000000"));
    expect(m.clocksNs.end_ns-m.clocksNs.start_ns).toBe(BigInt("60000000000"));
    expect(m.sourceCounts.n_lit_classified_quote_gt5s_prints).toBe(1);
    expect(m.volumeShares?.source_volume_included_shares).toBe("20");
    expect(m.publicDeliveryAllowed).toBe(false);
    expect(m.sourceAuthenticated).toBe(false);
    expect(m.productionApproved).toBe(false);
  });
  it("shows ordinary JSON.parse really loses original 1ns resolution",()=>{
    const original=input("minute").bytes.toString("utf8");
    const parsed=JSON.parse(original);
    expect(Number.isSafeInteger(parsed.source_latest_print_available_ns)).toBe(false);
    expect(BigInt(Math.trunc(parsed.source_latest_print_available_ns))).not.toBe(BigInt("1791417640000000123"));
    const a=decodePrivateEvidence(input("minute"));
    const b=decodePrivateEvidence(input("minute",doc=>{
      doc.source_latest_print_available_ns="1791417640000000124";
    }));
    expect(a.clocksNs.source_latest_print_available_ns+BigInt("1"))
      .toBe(b.clocksNs.source_latest_print_available_ns);
    expect(a.originalByteSha256).not.toBe(b.originalByteSha256);
  });
  it("preserves the exact signed native 64-bit ceiling",()=>{
    const max="9223372036854775807";
    const minute=decodePrivateEvidence(input("minute",doc=>{doc.decision_ns=max;}));
    expect(minute.clocksNs.decision_ns.toString()).toBe(max);
    reject("minute",doc=>{doc.decision_ns="9223372036854775808";},/decision_ns:overflow/);
  });
  it("parses one completed R0 proxy without pretending order-level truth",()=>{
    const r=decodePrivateEvidence(input("research"));
    expect(r.clocksNs.source_quote_age_limit_ns).toBe(BigInt("25000000000"));
    expect(r.quoteRecovery?.ask.state).toBe("MEASURED_NBBO_SIZE_PROXY_NOT_ORDER_REPLENISHMENT");
    expect(r.quoteRecovery?.bid.state).toBe("MEASURED_NBBO_SIZE_PROXY_NOT_ORDER_REPLENISHMENT");
    if(r.quoteRecovery?.ask.state==="MEASURED_NBBO_SIZE_PROXY_NOT_ORDER_REPLENISHMENT")
      expect(r.quoteRecovery.ask.recoveredShares).toBe("90");
    expect(r.completedWindowResponseBps).toBe("0");
    expect(r.pressureBalance).toBe("0.003980099502487562189054726368");
    expect(r.productionApproved).toBe(false);
  });
  it("preserves same source and quote-condition generation across both private artifacts",()=>{
    const a=decodePrivateEvidence(input("minute"));
    const b=decodePrivateEvidence(input("research"));
    expect(a.sourceHashes.source_manifest_sha256).toBe(b.sourceHashes.source_manifest_sha256);
    expect(a.sourceHashes.quote_policy_sha256).toBe(b.sourceHashes.source_quote_condition_rules_sha256);
    expect(a.sourceHashes.source_watermark_receipt_sha256).toBe(b.sourceHashes.source_watermark_receipt_sha256);
  });
  it("refuses unsafe numeric source clocks silently rounded in a lookalike v1",()=>{
    reject("minute",m=>{m.source_latest_print_available_ns="1791417640000000123.0";},/missing_or_duplicate_ns/);
    reject("research",m=>{m.decision_ns="1791417662000000001.0";},/missing_or_duplicate_ns/);
  });
  it("rejects source byte digest and length mismatches before any parsing",()=>{
    const args=input("minute");
    expect(()=>decodePrivateEvidence({...args,expectedSha256:SHA("f")})).toThrowError(/hash_mismatch/);
    expect(()=>decodePrivateEvidence({...args,expectedLength:args.bytes.length-1})).toThrowError(/invalid_length/);
  });
  it("rejects falsely public or trade-enabled private source artifacts",()=>{
    reject("minute",m=>{m.public_delivery_allowed=true;},/distribution_or_authority/);
    reject("research",m=>{m.rank_trade_alert_authority=true;},/distribution_or_authority/);
    reject("research",m=>{m.absorption_signal=1;},/distribution_or_authority/);
  });
  it("cannot smuggle native trade identifiers or raw quotes in recomputed digest",()=>{
    reject("minute",m=>{m.raw_websocket_trades=[{"id":"original"}];},/unapproved_fields/);
    reject("research",m=>{m.raw_quote=[{"q":1}];},/unapproved_fields/);
  });
  it("rejects duplicate nanosecond JSON key even with matching hash",()=>{
    const args=input("minute");
    const raw=Buffer.from(args.bytes.toString().replace('"start_ns":'+START,
       '"start_ns":'+START+',"start_ns":'+START));
    const digest=createHash("sha256").update(raw).digest("hex");
    expect(()=>decodePrivateEvidence({...args,bytes:raw,expectedLength:raw.length,
      expectedSha256:digest})).toThrowError(/missing_or_duplicate_ns/);
  });
  it("rejects whitespace reserialization before any provenance projection",()=>{
    const args=input("minute");
    const raw=Buffer.from(args.bytes.toString().replace(',"ticker":',', "ticker":'));
    const digest=createHash("sha256").update(raw).digest("hex");
    expect(()=>decodePrivateEvidence({...args,bytes:raw,expectedLength:raw.length,
      expectedSha256:digest})).toThrowError(/noncanonical/);
  });
  it("rejects an impossible source receipt before its admitted minute begins",()=>{
    reject("minute",m=>{
      m.source_latest_print_available_ns="1791417599999999999";
    },/original_availability/);
  });
  it("rejects forged future source receipt and malformed session clock",()=>{
    reject("minute",m=>{m.source_watermark_available_ns="1791417663000000000";},/original_availability/);
    reject("minute",m=>{m.session="2026-10-08:POST";},/symbol_or_session/);
    reject("research",m=>{m.end_ns="1791417660000000001";},/time_window/);
  });
  it("does not drop one small dollar leg from a large source gross amount",()=>{
    reject("minute",m=>{
      const v=m.notional_usd as Record<string,string>;
      v.gross_sampled_notional_usd="1000000000000000000000000000000";
      v.buy_proxy_notional_usd="999999999999999999999999999999";
      v.sell_proxy_notional_usd="0";
    },/notional_conservation/);
  });
  it("refuses tampered native shares, counters and non-typed null reasons",()=>{
    reject("minute",m=>{
      (m.volume_shares as Record<string,string>).source_all_printed_shares="21";
    },/volume_conservation/);
    reject("minute",m=>{(m.counts as Record<string,number>).n_lit=10;},/denominator_inconsistent/);
    reject("minute",m=>{m.unknown_reason_counts={"source:/private/token":1};},/invalid_reason/);
  });
  it("does not downgrade correction provisionality or source uncertainty",()=>{
    reject("minute",m=>{m.correction_status="FINAL";},/false_source_finality/);
    reject("research",m=>{m.source_authenticity="VERIFIED";},/false_source_finality/);
    reject("research",m=>{m.forward_label="ACCEPTED_SIGNAL";},/false_source_finality/);
  });
  it("refuses fabricated order-level replenishment and impossible recovery",()=>{
    reject("research",m=>{
      (m.ask_size_recovery_proxy as Record<string,unknown>).state="ORDER_LEVEL_REPLENISHMENT";
    },/not_a_proxy/);
    reject("research",m=>{
      (m.ask_size_recovery_proxy as Record<string,unknown>).final_shares="191";
    },/invalid_recovery/);
    reject("research",m=>{
      (m.ask_size_recovery_proxy as Record<string,unknown>).source_best_exchange="EXCHANGE:SECRET";
    },/exchange/);
  });
  it("rejects source-claim upgrades with unknown schema generations",()=>{
    reject("research",m=>{m.schema="equity.pressure_response.private_context_view/v1";},/distribution_or_authority/);
    reject("minute",m=>{m.source_schema="equity.tick_plane.minute_observation/v99";},/distribution_or_authority/);
    reject("minute",m=>{m.source_authenticity="AUTHENTICATED";},/false_source_finality/);
  });
  it("rejects unsafe counters outside JavaScript safe-integer range",()=>{
    reject("minute",m=>{(m.counts as Record<string,number>).n_sampled_prints=Number.MAX_SAFE_INTEGER+1;},/unsafe_count/);
  });
});

describe("private minute + R0 joint source/cutoff compatibility",()=>{
  const pair = (changeMinute?: (v:Record<string,unknown>)=>void,
                changeResearch?: (v:Record<string,unknown>)=>void) =>
    pairPrivateEvidence(decodePrivateEvidence(input("minute",changeMinute)),
                        decodePrivateEvidence(input("research",changeResearch)));
  it("pairs one source minute under the same original watermark and policy",()=>{
    const p=pair();
    expect(p.pairingState).toBe("PRIVATE_COMPATIBLE_ORIGINAL_SOURCE_UNPROVEN");
    expect(p.ticker).toBe("SPY");
    expect(p.session).toBe("2026-10-08:RTH");
    expect(p.decisionNs).toBe(BigInt("1791417662000000000"));
    expect(p.sourceManifestSha256).toBe(SHA("b"));
    expect(p.quotePolicySha256).toBe(SHA("f"));
    expect(p.pairedArtifactsSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(p.productionApproved).toBe(false);
    expect(p.publicDeliveryAllowed).toBe(false);
    expect(p.sourceAuthenticated).toBe(false);
  });
  it("rejects a 1-nanosecond mismatch even when both originals separately pass",()=>{
    expect(()=>pair(v=>{v.decision_ns="1791417662000000001";}))
      .toThrowError(/original_clock_mismatch/);
  });
  it("rejects mixing one symbol with another valid original",()=>{
    expect(()=>pair(v=>{v.ticker="QQQ";})).toThrowError(/symbol_session_mismatch/);
  });
  it("rejects source quote-policy or watermark revision mismatches",()=>{
    expect(()=>pair(v=>{v.quote_policy_sha256=SHA("8");}))
      .toThrowError(/source_policy_or_receipt_mismatch/);
    expect(()=>pair(undefined,v=>{v.source_watermark_receipt_sha256=SHA("8");}))
      .toThrowError(/source_policy_or_receipt_mismatch/);
  });
  it("rejects preserved valid but different provisional buy/sell totals",()=>{
    expect(()=>pair(undefined,v=>{
      const m=v.notional_usd as Record<string,string>;
      m.buy_proxy_notional_usd="1010.0";
      m.gross_sampled_notional_usd="2011.0";
    })).toThrowError(/source_notional_mismatch/);
  });
  it("rejects research pretending to use tighter quote-age admission than source",()=>{
    expect(()=>pair(undefined,v=>{v.source_quote_age_limit_ns="1000000000";}))
      .toThrowError(/research_age_policy_too_strict/);
  });
  it("rejects differing print populations despite a matching market/session",()=>{
    expect(()=>pair(undefined,v=>{
      (v.n_observations as Record<string,number>).n_sampled_prints=3;
    })).toThrowError(/source_population_mismatch/);
  });
  it("rejects a non-minute source pairing and swapped inputs",()=>{
    const m=decodePrivateEvidence(input("minute"));
    const r=decodePrivateEvidence(input("research"));
    expect(()=>pairPrivateEvidence(r,m)).toThrowError(/wrong_private_artifact_types/);
  });
});

function allUnknownMinute(): Record<string,unknown> {
  const m=minute();
  const c=m.counts as Record<string,number>;
  c.n_sampled_prints=1;c.n_lit=1;c.n_unclassified=1;
  c.n_buy_proxy=0;c.n_sell_proxy=0;c.n_midpoint=0;
  c.n_lit_eligible_prints=0;c.n_lit_classified_quote_le5s_prints=0;
  c.n_lit_classified_quote_gt5s_prints=0;c.n_lit_unclassified_prints=0;
  c.n_lit_source_unqualified_prints=1;
  c.n_source_volume_included_prints=1;
  const dollars=m.notional_usd as Record<string,string>;
  dollars.gross_sampled_notional_usd="100.50";
  dollars.buy_proxy_notional_usd="0";
  dollars.sell_proxy_notional_usd="0";
  dollars.unknown_notional_usd="100.50";
  const shares=m.volume_shares as Record<string,string>;
  shares.source_all_printed_shares="10";
  shares.source_volume_included_shares="10";
  m.lit_quoted_notional_coverage="0";
  m.unknown_reason_counts={TRADE_CONDITION_POLICY_UNQUALIFIED:1};
  m.lit_unknown_reason_counts={};
  m.condition_policy_sha256=null;m.exchange_policy_sha256=null;m.quote_policy_sha256=null;
  return m;
}
describe("source missingness remains evidence, not a zero or an invented policy",()=>{
 it("reads a fully abstained source minute with null condition references",()=>{
   const m=allUnknownMinute();
   const decoded=decodePrivateEvidence(input("minute",target=>Object.assign(target,m)));
   expect(decoded.unknownReasons).toEqual({TRADE_CONDITION_POLICY_UNQUALIFIED:1});
   expect(decoded.litUnknownReasons).toEqual({});
   expect(decoded.sourceCounts.n_unclassified).toBe(1);
   expect(decoded.notionalUsd.unknown_notional_usd).toBe("100.50");
   expect(decoded.sourceHashes.condition_policy_sha256).toBeNull();
   expect(decoded.sourceHashes.exchange_policy_sha256).toBeNull();
   expect(decoded.sourceHashes.quote_policy_sha256).toBeNull();
   expect(decoded.productionApproved).toBe(false);
   expect(decoded.publicDeliveryAllowed).toBe(false);
 });
 it("does not treat missing source policy on a signed print as legitimate",()=>{
   reject("minute",m=>{m.quote_policy_sha256=null;},/measured_without_source_policy/);
 });
 it("will not pair unknown-only source with source-qualified R0 research",()=>{
   const m=decodePrivateEvidence(input("minute",target=>Object.assign(target,allUnknownMinute())));
   const r=decodePrivateEvidence(input("research"));
   expect(()=>pairPrivateEvidence(m,r)).toThrowError(/source_policy_or_receipt_mismatch/);
 });
 it("rejects untyped free-text reasons instead of leaking source paths",()=>{
   reject("minute",m=>{
     m.unknown_reason_counts={"vendor:/private/key.txt":1};
   },/invalid_reason/);
 });
});

describe("R0 exact high-precision derived decimal compatibility",()=>{
 it("preserves more than 30 fractional digits on a valid bounded response",()=>{
   const long="0."+"0".repeat(99)+"1";
   const item=decodePrivateEvidence(input("research",r=>{
     r.completed_window_midpoint_response_bps=long;
     r.pressure_balance=long;
   }));
   expect(item.completedWindowResponseBps).toBe(long);
   expect(item.pressureBalance).toBe(long);
   expect(item.productionApproved).toBe(false);
 });
 it("accepts the exact 544-char derived width limit without float rounding",()=>{
   const exact="0."+"0".repeat(541)+"1";
   expect(exact.length).toBe(544);
   const r=decodePrivateEvidence(input("research",v=>{
     v.completed_window_midpoint_response_bps=exact;
   }));
   expect(r.completedWindowResponseBps).toBe(exact);
 });
 it("rejects over-width 545-char derived R0 decimals",()=>{
   const tooLong="0."+"0".repeat(542)+"1";
   expect(tooLong.length).toBe(545);
   reject("research",r=>{
     r.completed_window_midpoint_response_bps=tooLong;
   },/bad_decimal/);
 });
 it("does not relax source-share or raw quote size 128-character budget",()=>{
   const tooLong="1".repeat(129);
   reject("minute",m=>{
     (m.volume_shares as Record<string,string>).source_all_printed_shares=tooLong;
   },/bad_decimal/);
   reject("research",r=>{
     (r.ask_size_recovery_proxy as Record<string,unknown>).original_shares=tooLong;
   },/bad_decimal/);
 });
});
