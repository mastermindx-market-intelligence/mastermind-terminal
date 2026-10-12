/** Source-pinned, synthetic-only TP-2 server reader contract tests. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  decodeTp2PrivateArtifact,
  decodeTp2R0Sidecar,
  Tp2PrivateRefusal,
} from "../tp2PrivateEvidence";

const TP2_SHA = "8c1ee4f865566f013d7a5805fccdd11c031223d39c6d8ec6b66968cbdc35f60b";
const R0_SHA = "fe03401a908d26230aa6f8426f9dd9318249a0cdd2eac256ed93786a0a48b715";
const TP2_ASOF = "1791478890000000001";
const R0_ASOF = "1791466270000000001";
const rawTp2 = readFileSync(new URL("./fixtures/tp2PrivateView.synthetic.v0.json", import.meta.url));
const rawR0 = readFileSync(new URL("./fixtures/tp2R0Sidecar.synthetic.v0.json", import.meta.url));

function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return "{" + Object.keys(obj).sort().map(k => JSON.stringify(k) + ":" + canonical(obj[k])).join(",") + "}";
  }
  return JSON.stringify(value);
}
function nested(value: Record<string, unknown>, key: string): Record<string, unknown> {
  const inner=value[key];
  if (!inner || typeof inner!=="object" || Array.isArray(inner))
    throw new Error("Invalid synthetic fixture object: "+key);
  return inner as Record<string, unknown>;
}
function wrap(value: unknown) {
  const bytes = Buffer.from(canonical(value) + "\n");
  return { bytes, expectedLength: bytes.length,
    expectedSha256: createHash("sha256").update(bytes).digest("hex") };
}
function alteredTp2(edit: (v: Record<string, unknown>) => void) {
  const j = JSON.parse(rawTp2.toString("utf8")) as Record<string, unknown>;
  edit(j);
  return wrap(j);
}
function alteredR0(edit: (v: Record<string, unknown>) => void) {
  const j = JSON.parse(rawR0.toString("utf8")) as Record<string, unknown>;
  edit(j);
  return wrap(j);
}
function decodeTp2(params = { bytes: rawTp2, expectedSha256: TP2_SHA,
  expectedLength: rawTp2.length }) {
  return decodeTp2PrivateArtifact({ ...params, requestedAsOfNs: TP2_ASOF });
}
function decodeR0(params = { bytes: rawR0, expectedSha256: R0_SHA,
  expectedLength: rawR0.length }) {
  return decodeTp2R0Sidecar({ ...params, requestedAsOfNs: R0_ASOF });
}

describe("TP-2 private derived-view decoder (no storage or authentication)", () => {
  it("accepts exact native Macro Python golden bytes and preserves three grains", () => {
    expect(rawTp2).toHaveLength(3394);
    expect(createHash("sha256").update(rawTp2).digest("hex")).toBe(TP2_SHA);
    const out = decodeTp2();
    expect(out.schema).toBe("terminal.tp2.private_projection/v0");
    expect(out.sourceSchema).toBe("darkpool.tp2_private_offexchange_view/v0");
    expect(out.state).toBe("PRIVATE_TPB_RESEARCH_CONTEXT_ONLY");
    expect(out.ticker).toBe("SPY");
    expect(out.observed?.individualPrintUsd).toBe("200000");
    expect(out.observed?.sameLevelClusterUsd).toBe("300000");
    expect(out.observed?.rthTotalUsd).toBe("500000");
    expect(out.observed?.sourceCapturedMarket).toBe(false);
    expect(out.ranks?.SINGLE_PRINT.sampleRank).toBe(1);
    expect(out.ranks?.SAME_LEVEL_CLUSTER.sampleRank).toBeNull();
    expect(out.ranks?.DAILY_TOTAL.sampleRank).toBe(1);
    expect(out.minuteBaseline?.minuteIndex).toBe(30);
    expect(out.minuteBaseline?.sampleN).toBe(5);
    expect(out.minuteBaseline?.cumulativeOffexchangeShare).toBe("0.4");
    expect(out.minuteBaseline?.median).toBe("0.22");
    expect(out.minuteBaseline?.robustZ?.startsWith("12.140833")).toBe(true);
    expect(out.productionApproved).toBe(false);
    expect(out.publicDeliveryAllowed).toBe(false);
    expect(out.tradingAuthority).toBe(false);
    expect(out.sourceAuthenticated).toBe(false);
    expect(out.namedATS).toBeNull();
    expect(out.blockTape).toBeNull();
    expect(out.signedFlow).toBeNull();
  });

  it("keeps provisional raw TP1 and historical qualifying TP-B notionals distinct", () => {
    const out = decodeTp2();
    expect(out.provisional?.trfAnyConditionNotionalUsd).toBe("250000");
    expect(out.observed?.rthTotalUsd).toBe("500000");
    expect(out.provisional?.qualifiedForHistoricalJoin).toBe(false);
    expect(out.provisional?.trfVolumeEligibilityProven).toBe(false);
    expect(out.provisional?.sampledLitPrints).toBe(1);
    expect(out.provisional?.sampledTrfPrints).toBe(1);
    expect(out.provisional?.locatedLitQuotePrintsLe5s).toBe(1);
    expect(out.livePriceShelves).toBeNull();
    expect(out.finraATSDelayed).toBeNull();
    expect(out.eodSourceUnchanged).toBe(true);
  });

  it("keeps all nanosecond clocks exact BigInts, not JS Numbers", () => {
    const out = decodeTp2();
    expect(out.viewAsOfNs).toBe(BigInt(TP2_ASOF));
    expect(out.observationAsOfNs).toBe(1791478860000000000n);
    expect(out.provisional?.minuteStartNs).toBe(1791466200000000000n);
    expect(out.provisional?.minuteDecisionNs).toBe(1791466290000000000n);
    expect(typeof out.provisional?.minuteStartNs).toBe("bigint");
  });

  it("rejects a read requested before the artifact's view cutoff", () => {
    expect(() => decodeTp2PrivateArtifact({bytes: rawTp2,
      expectedLength: rawTp2.length,expectedSha256: TP2_SHA,
      requestedAsOfNs: "1791478890000000000"})).toThrow(Tp2PrivateRefusal);
  });

  it("requires exact SHA, exact length, canonical sorted-key bytes", () => {
    expect(() => decodeTp2({bytes:rawTp2,expectedSha256:"f".repeat(64),
      expectedLength:rawTp2.length})).toThrow(/digest/i);
    expect(() => decodeTp2({bytes:rawTp2,expectedSha256:TP2_SHA,
      expectedLength:rawTp2.length-1})).toThrow(/length/i);
    const uncanonical=Buffer.from(JSON.stringify(JSON.parse(rawTp2.toString("utf8")),null,2)+"\n");
    expect(() => decodeTp2(wrap(JSON.parse(uncanonical.toString("utf8"))))).not.toThrow();
    expect(() => decodeTp2({ bytes:uncanonical,
      expectedSha256:createHash("sha256").update(uncanonical).digest("hex"),
      expectedLength:uncanonical.length })).toThrow(/canonical/i);
    expect(() => decodeTp2({bytes:Buffer.alloc(65537),expectedSha256:TP2_SHA,
      expectedLength:65537})).toThrow(/length|budget/i);
  });

  it("rejects duplicate JSON key shadowing even with a recomputed SHA", () => {
    const prior=rawTp2.toString("utf8");
    const duplicated=Buffer.from(prior.replace('"public_delivery_allowed":false',
      '"public_delivery_allowed":true,"public_delivery_allowed":false'));
    expect(() => decodeTp2({bytes:duplicated,
      expectedLength:duplicated.length,
      expectedSha256:createHash("sha256").update(duplicated).digest("hex")}))
      .toThrow(/canonical/i);
  });

  it.each([
    ["public delivery",v=>{v.public_delivery_allowed=true;}],
    ["ranking authority",v=>{v.ranking_trading_alert_authority=true;}],
    ["source authenticity",v=>{v.source_authenticated=true;}],
    ["capture completeness",v=>{v.market_capture_completeness_proven=true;}],
    ["named ATS",v=>{v.named_ats_attribution={firm:"SYNTHETIC"};}],
    ["live block",v=>{v.live_block_tape=[{p:100}];}],
    ["signed flow",v=>{v.live_signed_offexchange_flow={buy:1};}],
    ["price shelf",v=>{v.repeat_print_price_shelves=[{price:100}];}],
    ["signal",v=>{v.signal={buy:true};}],
    ["rogue native source field",v=>{v.original_vendor_trade_id="a";}],
    ["price level label",v=>{nested(v, "tp1_provisional_minute").join_to_tpb_historical_ranks=true;}],
  ] as Array<[string,(o:Record<string,unknown>)=>void]>)(
    "rejects %s promotion even when the attacker recomputes SHA",(_label,edit) => {
      expect(() => decodeTp2(alteredTp2(edit))).toThrow(Tp2PrivateRefusal);
    });

  it.each([
    ["future provisional minute",v=>{nested(v, "tp1_provisional_minute").minute_decision_ns_decimal=TP2_ASOF.slice(0,-1)+"2";}],
    ["mislabelled minute session",v=>{nested(v, "tp1_provisional_minute").session="2026-10-09:RTH";}],
    ["unbounded nano string",v=>{nested(v, "tp1_provisional_minute").minute_start_ns_decimal="999999999999999999999999999";}],
    ["unsafe numeric nano",v=>{nested(v, "tp1_provisional_minute").minute_start_ns_decimal=1791466200000000000;}],
    ["future observation",v=>{v.observation_asof_ns_decimal="1791479999999999999";}],
    ["source generation missing",v=>{v.source_generation_sha256=null;}],
    ["wrong absolute tier",v=>{nested(nested(v, "observed_source"), "block_tier_counts")["100000"]=1000000;}],
    ["fake historical metric",v=>{nested(nested(v, "historical_ruler"), "DAILY_TOTAL").source_metric="largest_individual_print_usd";}],
    ["too-large rank",v=>{nested(nested(v, "historical_ruler"), "DAILY_TOTAL").rank_desc_in_observed_sample=100;}],
    ["impossible cumulative share",v=>{nested(v, "intraday_minute_baseline").cumulative_offexchange_share="1.1";}],
    ["negative historical MAD",v=>{nested(v, "intraday_minute_baseline").mad="-0.1";}],
    ["made-up future z",v=>{nested(v, "intraday_minute_baseline").state="INSUFFICIENT_MINUTE_MATCHED_HISTORY";}],
  ] as Array<[string,(o:Record<string,unknown>)=>void]>)(
    "rejects %s despite matching recomputed bytes",(_label,edit) => {
      expect(() => decodeTp2(alteredTp2(edit))).toThrow(Tp2PrivateRefusal);
    });

  it("allows strict missing-source holds without fabricating zero market activity", () => {
    const absent=alteredTp2(v=>{
      v.state="NO_TPB_OBSERVATION_SOURCE";v.ticker=null;v.session=null;
      v.observation_asof_ns_decimal=null;
      v.source_manifest_sha256=null;v.source_generation_sha256=null;
      v.source_snapshot_sha256=null;v.observed_source=null;
      v.historical_ruler=null;v.intraday_minute_baseline=null;
      v.tp1_minute_state="TP1_MINUTE_NOT_SUPPLIED";
      v.tp1_provisional_minute=null;
    });
    const out=decodeTp2(absent);
    expect(out.state).toBe("NO_TPB_OBSERVATION_SOURCE");
    expect(out.observed).toBeNull();
    expect(out.ranks).toBeNull();
    expect(out.minuteBaseline).toBeNull();
    expect(out.provisional).toBeNull();
  });

  it("refuses future-source metadata in an as-seen hold",()=>{
    const forged=alteredTp2(v=>{v.state="SOURCE_NOT_YET_KNOWABLE";v.observed_source=null;
      v.historical_ruler=null;v.intraday_minute_baseline=null;});
    expect(()=>decodeTp2(forged)).toThrow(Tp2PrivateRefusal);
  });

  it("does not allow late source corrections to carry earlier historical ranks",()=>{
    const forged=alteredTp2(v=>{v.state="CALIBRATION_STALE_SOURCE_GENERATION";});
    expect(()=>decodeTp2(forged)).toThrow(Tp2PrivateRefusal);
  });
});

describe("separately versioned R0 descriptive sidecar (not a numeric join)",()=>{
  it("accepts the exact R0 sidecar fixture without changing TP-2 source v0",()=>{
    expect(rawR0).toHaveLength(1541);
    expect(createHash("sha256").update(rawR0).digest("hex")).toBe(R0_SHA);
    const view=decodeR0();
    expect(view.schema).toBe("terminal.tp2.r0_research_projection/v0");
    expect(view.sourceSchema).toBe("darkpool.tp2_r0_observed_research/v0");
    expect(view.state).toBe("R0_OBSERVATIONAL_CONTEXT_HOLD");
    expect(view.ticker).toBe("SPY");
    expect(view.pressure?.pressureBalance).toBe("0.3333333333333333333333333333");
    expect(view.pressure?.coverage).toBe("0.7894736842105263157894736842");
    expect(view.pressure?.midpointResponseBps).toBe("0");
    expect(view.pressure?.sampledPrints).toBe(10);
    expect(view.pressure?.tradeSideAccuracyCalibrated).toBe(false);
    expect(view.joinToTp1OrTpb).toBe(false);
    expect(view.forwardLabel).toBeNull();
    expect(view.absorptionSignal).toBeNull();
    expect(view.publicDeliveryAllowed).toBe(false);
    expect(view.tradingAuthority).toBe(false);
  });
  it("keeps source clocks lossless",()=>{
    const view=decodeR0();
    expect(view.viewAsOfNs).toBe(BigInt(R0_ASOF));
    expect(view.originalStartNs).toBe(1791466200000000000n);
    expect(view.originalDecisionNs).toBe(1791466270000000000n);
  });
  it("blocks point-in-time reversal",()=>{
    expect(()=>decodeTp2R0Sidecar({bytes:rawR0,expectedSha256:R0_SHA,
      expectedLength:rawR0.length,requestedAsOfNs:"1791466270000000000"}))
      .toThrow(Tp2PrivateRefusal);
  });
  it.each([
    ["public",v=>{v.public_delivery_allowed=true;}],
    ["signal",v=>{v.absorption_signal={buy:true};}],
    ["future",v=>{v.forward_label={gain:true};}],
    ["source proved",v=>{v.source_authenticated=true;}],
    ["joined",v=>{v.join_to_tp1_or_tpb=true;}],
    ["pressure out of range",v=>{nested(v, "observed_proxy").pressure_balance="2";}],
    ["invalid coverage",v=>{nested(v, "observed_proxy").classified_notional_coverage="1.1";}],
    ["wrong basis",v=>{nested(v, "observed_proxy").basis="VERIFIED_AGGRESSOR";}],
    ["extra native trade",v=>{nested(v, "observed_proxy").native_trade_id="abc";}],
  ] as Array<[string,(o:Record<string,unknown>)=>void]>)(
    "rejects %s even with rehashed sidecar",(_label,edit)=>{
      expect(()=>decodeR0(alteredR0(edit))).toThrow(Tp2PrivateRefusal);
    });
});
