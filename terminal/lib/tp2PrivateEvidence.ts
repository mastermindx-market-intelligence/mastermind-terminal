/**
 * SERVER-ONLY phase-A Terminal consumer for Macro TP-2 PRIVATE derived v0.
 *
 * The owner-supplied bytes and their expected SHA/length must first come from
 * an independently admitted, entitled PRIVATE source service. We do not fetch,
 * authorize, persist, cache, publish, infer venue identity, or create an R2
 * fallback here. A matching representation SHA is NOT source authentication.
 *
 * Unlike native TP1/R0 source-v0 bytes, TP-2 and its R0 research sidecar
 * already store original nanosecond clocks as canonical decimal strings.
 * Reuse tp1Nanoseconds.parseUnsignedNanoseconds; never JSON Number for clocks.
 */
import { createHash } from "node:crypto";
import { parseUnsignedNanoseconds, NanosecondContractError } from "./tp1Nanoseconds";

const TP2_SCHEMA = "darkpool.tp2_private_offexchange_view/v0";
const R0_SCHEMA = "darkpool.tp2_r0_observed_research/v0";
const MINUTE_NS = 60_000_000_000n;
const SHA = /^[a-f0-9]{64}$/;
const SESSION = /^(\d{4})-(\d{2})-(\d{2}):RTH$/;
const SYMBOL = /^[A-Z][A-Z0-9.-]{0,19}$/;
const DECIMAL = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
const MAX_TP2_BYTES = 64 * 1024;
const MAX_R0_BYTES = 24 * 1024;
const TP2_KEYS = [
  "schema", "state", "reason", "authority", "observation_asof_ns_decimal",
  "view_asof_ns_decimal", "ticker", "session", "source_generation_sha256",
  "source_snapshot_sha256", "source_manifest_sha256", "observed_source",
  "historical_ruler", "intraday_minute_baseline", "tp1_minute_state",
  "tp1_provisional_minute", "live_block_tape", "repeat_print_price_shelves",
  "live_signed_offexchange_flow", "nbbo_classification_coverage",
  "named_ats_attribution", "finra_ats_delayed_context", "eod_weekly_context",
  "source_authenticated", "market_capture_completeness_proven",
  "public_delivery_allowed", "ranking_trading_alert_authority", "signal",
] as const;
const TP2_STATES = [
  "NO_TPB_OBSERVATION_SOURCE", "SOURCE_NOT_YET_KNOWABLE",
  "NO_QUALIFIED_TRF_OBSERVATIONS", "HISTORICAL_CALIBRATION_PENDING",
  "CALIBRATION_NOT_YET_KNOWABLE", "CALIBRATION_STALE_SOURCE_GENERATION",
  "PRIVATE_TPB_RESEARCH_CONTEXT_ONLY",
] as const;
const RANKS = ["SINGLE_PRINT", "SAME_LEVEL_CLUSTER", "DAILY_TOTAL"] as const;
type RankKind = (typeof RANKS)[number];
const RANK_METRIC: Record<RankKind,string> = {
  SINGLE_PRINT: "largest_individual_print_usd",
  SAME_LEVEL_CLUSTER: "largest_cluster_usd",
  DAILY_TOTAL: "oe_source_notional_usd",
};
const RANK_STATES = [
  "OBSERVED_COVERAGE_ONLY", "NOT_FULL_RTH",
  "NO_OBSERVED_OBJECT", "INSUFFICIENT_COMPARABLE_HISTORY",
] as const;
const MINUTE_STATES = [
  "OBSERVED_COVERAGE_ONLY", "NO_ROBUST_DISPERSION",
  "INSUFFICIENT_MINUTE_MATCHED_HISTORY", "TARGET_MINUTE_SOURCE_UNQUALIFIED",
] as const;
const OBS_KEYS = [
  "state", "n_trf_observed", "n_unknown_volume_policy",
  "largest_individual_print_usd", "largest_same_level_cluster_usd",
  "measured_rth_trf_notional_usd", "measured_rth_trf_shares",
  "block_tier_counts", "full_rth_covered_claim_unverified", "cluster_clock",
];
const MINUTE_KEYS = [
  "state", "conditioning", "minute_index", "n_prior",
  "cumulative_offexchange_share", "median", "mad", "robust_z",
  "midrank_percentile", "history_coverage_start",
];
const TP1_KEYS = [
  "source", "ticker", "session", "minute_start_ns_decimal",
  "minute_end_ns_decimal", "minute_decision_ns_decimal",
  "watermark_available_ns_decimal", "source_manifest_sha256",
  "source_observation_sha256", "sampled_prints", "sampled_lit_prints",
  "sampled_trf_prints", "lit_quote_located_le5s_prints",
  "provisional_trf_any_condition_notional_usd",
  "trf_volume_eligibility_proven", "classification_accuracy_validated",
  "join_to_tpb_historical_ranks", "source_authenticity",
];
const R0_KEYS = [
  "schema", "state", "authority", "view_asof_ns_decimal",
  "source_start_ns_decimal", "source_end_ns_decimal",
  "source_decision_ns_decimal", "ticker", "session",
  "source_manifest_sha256", "source_minutes_receipt_sha256",
  "source_quotes_receipt_sha256", "observed_proxy", "join_to_tp1_or_tpb",
  "source_authenticated", "public_delivery_allowed",
  "rank_trade_alert_authority", "forward_label", "absorption_signal",
];
const R0_PROXY_KEYS = [
  "basis", "sampled_prints", "unclassified_prints", "source_minute_packets",
  "buy_proxy_notional_usd", "sell_proxy_notional_usd",
  "unknown_notional_usd", "classified_notional_coverage",
  "pressure_balance", "completed_window_midpoint_response_bps",
  "bid_size_recovery_state", "ask_size_recovery_state",
  "quote_age_policy_ns_decimal", "price_response_kind",
  "trade_side_accuracy_calibrated",
];
const R0_STATES = [
  "R0_CONTEXT_NOT_SUPPLIED", "R0_CONTEXT_NOT_YET_KNOWABLE",
  "R0_OBSERVATIONAL_CONTEXT_HOLD",
] as const;

type RecordValue = Record<string, unknown>;
export type PrivateBytesInput = Readonly<{
  bytes: Uint8Array;
  expectedSha256: string;
  expectedLength: number;
  /** Original viewer/read-decision cutoff. Never earlier than the artifact. */
  requestedAsOfNs: string;
}>;
export class Tp2PrivateRefusal extends Error {
  constructor(reason: string) { super("tp2_private:" + reason); this.name = "Tp2PrivateRefusal"; }
}
export type ObservedRank = Readonly<{
  state: string;
  sampleRank: number | null;
  priorN: number;
  metric: string;
}>;
export type ObservedSource = Readonly<{
  individualPrintUsd: string;
  sameLevelClusterUsd: string | null;
  rthTotalUsd: string;
  measuredShares: string;
  sampledTrfPrints: number;
  tierCounts: Readonly<Record<string, number>>;
  /** This field can never certify original source/completeness. */
  sourceCapturedMarket: false;
  fullRthCoveredClaimUnverified: boolean;
}>;
export type MinuteBaseline = Readonly<{
  state: string;
  minuteIndex: number;
  sampleN: number;
  cumulativeOffexchangeShare: string | null;
  median: string | null;
  mad: string | null;
  midrankPercentile: string | null;
  robustZ: string | null;
}>;
export type ProvisionalMinute = Readonly<{
  minuteStartNs: bigint;
  minuteEndNs: bigint;
  minuteDecisionNs: bigint;
  watermarkAvailableNs: bigint;
  sampledLitPrints: number;
  sampledTrfPrints: number;
  locatedLitQuotePrintsLe5s: number;
  trfAnyConditionNotionalUsd: string;
  qualifiedForHistoricalJoin: false;
  trfVolumeEligibilityProven: false;
}>;
export type Tp2PrivateProjection = Readonly<{
  schema: "terminal.tp2.private_projection/v0";
  sourceSchema: typeof TP2_SCHEMA;
  state: string;
  ticker: string | null;
  session: string | null;
  viewAsOfNs: bigint;
  observationAsOfNs: bigint | null;
  observed: ObservedSource | null;
  ranks: Readonly<Record<RankKind, ObservedRank>> | null;
  minuteBaseline: MinuteBaseline | null;
  provisional: ProvisionalMinute | null;
  originalByteSha256: string;
  sourceAuthenticated: false;
  publicDeliveryAllowed: false;
  productionApproved: false;
  tradingAuthority: false;
  namedATS: null;
  finraATSDelayed: null;
  blockTape: null;
  livePriceShelves: null;
  signedFlow: null;
  eodSourceUnchanged: true;
}>;
export type Tp2R0Projection = Readonly<{
  schema: "terminal.tp2.r0_research_projection/v0";
  sourceSchema: typeof R0_SCHEMA;
  state: string;
  ticker: string | null;
  session: string | null;
  viewAsOfNs: bigint;
  originalStartNs: bigint | null;
  originalDecisionNs: bigint | null;
  pressure: null | Readonly<{
    pressureBalance: string | null;
    coverage: string | null;
    midpointResponseBps: string | null;
    sampledPrints: number;
    tradeSideAccuracyCalibrated: false;
  }>;
  originalByteSha256: string;
  joinToTp1OrTpb: false;
  sourceAuthenticated: false;
  publicDeliveryAllowed: false;
  tradingAuthority: false;
  forwardLabel: null;
  absorptionSignal: null;
}>;

function fail(what: string): never { throw new Tp2PrivateRefusal(what); }
function record(x: unknown, name: string): RecordValue {
  if (!x || typeof x !== "object" || Array.isArray(x)) return fail(name + ":object");
  return x as RecordValue;
}
function exactKeys(x: RecordValue, keys: readonly string[], name: string): void {
  const actual=Object.keys(x);
  if (actual.length !== keys.length ||
      actual.some(k=>!keys.includes(k)) ||
      keys.some(k=>!Object.hasOwn(x,k))) fail(name + ":unexpected_fields");
}
function assertSha(x: unknown, name: string): string {
  if (typeof x !== "string" || !SHA.test(x)) return fail(name + ":digest");
  return x;
}
function asString(x: unknown, name: string): string {
  if (typeof x !== "string" || !x.length) return fail(name + ":text");
  return x;
}
function oneOf(x: unknown, values: readonly string[], name: string): string {
  if (typeof x !== "string" || !values.includes(x)) return fail(name + ":unknown_state");
  return x;
}
function count(x: unknown, name: string, maximum = 20000): number {
  if (typeof x !== "number" || !Number.isSafeInteger(x) || x<0 || x>maximum)
    return fail(name + ":unsafe_count");
  return x;
}
function ns(x: unknown, name: string): bigint {
  try {
    const value=parseUnsignedNanoseconds(x,name);
    if (value<=0n) return fail(name + ":nonpositive_ns");
    return value;
  } catch (error) {
    if (error instanceof NanosecondContractError) return fail(name + ":unsafe_ns");
    throw error;
  }
}
type Exact = { numerator: bigint; scale: number };
function numeric(x: unknown, name: string, {signed=false,maxWidth=280}: {
  signed?:boolean;maxWidth?:number }={}): { text: string; exact: Exact } {
  if (typeof x!=="string" || x.length===0 || x.length>maxWidth ||
      !DECIMAL.test(x) || (!signed&&x.startsWith("-"))) return fail(name+":bounded_decimal");
  const negative=x.startsWith("-");
  const rest=negative?x.slice(1):x;
  const [whole,fraction=""]=rest.split(".");
  const numerator=BigInt((negative?"-":"")+whole+fraction);
  return {text:x,exact:{numerator,scale:fraction.length}};
}
function cmp(a:Exact,b:Exact):number {
  const scale=Math.max(a.scale,b.scale);
  const an=a.numerator*10n**BigInt(scale-a.scale);
  const bn=b.numerator*10n**BigInt(scale-b.scale);
  return an===bn?0:an>bn?1:-1;
}
function fraction(x: unknown,name:string): string {
  const v=numeric(x,name);
  if(cmp(v.exact,{numerator:1n,scale:0})>0) return fail(name+":exceeds_one");
  return v.text;
}
function signedRange(x:unknown,name:string):string {
  const v=numeric(x,name,{signed:true,maxWidth:1024});
  if(cmp(v.exact,{numerator:1n,scale:0})>0 ||
     cmp(v.exact,{numerator:-1n,scale:0})<0) return fail(name+":outside_unit");
  return v.text;
}
function optionalFraction(x: unknown,name:string):string|null {
  return x===null?null:fraction(x,name);
}
function optionalSigned(x:unknown,name:string):string|null {
  return x===null?null:numeric(x,name,{signed:true,maxWidth:1024}).text;
}
function assertAsciiCanonical(value:unknown):string {
  if (value===null) return "null";
  if (typeof value==="string") return JSON.stringify(value);
  if (typeof value==="boolean") return value?"true":"false";
  if (typeof value==="number") {
    if (!Number.isSafeInteger(value) || value<0) return fail("payload:unsafe_numeric");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return "["+value.map(assertAsciiCanonical).join(",")+"]";
  const obj=record(value,"payload");
  const keys=Object.keys(obj).sort();
  if (keys.some(k=>/[^ -~]/.test(k))) return fail("payload:nonascii_key");
  return "{"+keys.map(k=>JSON.stringify(k)+":"+assertAsciiCanonical(obj[k])).join(",")+"}";
}
function readArtifact(input:PrivateBytesInput,maximum:number):{doc:RecordValue;sha:string} {
  const expected=assertSha(input.expectedSha256,"expected_sha256");
  if (typeof input.expectedLength!=="number" ||
      !Number.isSafeInteger(input.expectedLength) || input.expectedLength<=0 ||
      input.expectedLength>maximum ||
      !(input.bytes instanceof Uint8Array) ||
      input.bytes.length!==input.expectedLength) return fail("artifact:byte_length_or_budget");
  const data=Buffer.from(input.bytes);
  const sha=createHash("sha256").update(data).digest("hex");
  if (sha!==expected) return fail("artifact:digest_mismatch");
  const text=data.toString("utf8");
  let decoded:unknown;
  try { decoded=JSON.parse(text); }
  catch { return fail("artifact:malformed_json"); }
  const serial=assertAsciiCanonical(decoded)+"\n";
  if (serial!==text) return fail("artifact:noncanonical_source_bytes");
  const requested=ns(input.requestedAsOfNs,"requested_cutoff");
  const root=record(decoded,"artifact");
  const view=ns(root.view_asof_ns_decimal,"view_asof");
  if(view>requested) return fail("artifact:future_view_cutoff");
  return {doc:root,sha};
}
function sessionOpen(s:unknown):bigint {
  if(typeof s!=="string") return fail("session:invalid");
  const m=SESSION.exec(s);
  if(!m) return fail("session:format");
  const year=Number(m[1]),month=Number(m[2]),day=Number(m[3]);
  const utcDate=new Date(Date.UTC(year,month-1,day));
  if (utcDate.toISOString().slice(0,10)!==s.slice(0,10)) return fail("session:invalid_date");
  const noon=new Date(Date.UTC(year,month-1,day,16,0));
  const tz=new Intl.DateTimeFormat("en-US",{
    timeZone:"America/New_York",timeZoneName:"shortOffset",
  }).formatToParts(noon).find(p=>p.type==="timeZoneName")?.value;
  const match=/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(tz||"");
  if(!match) return fail("session:timezone");
  const offset=(match[1]==="+"?1:-1)*(Number(match[2])*60+Number(match[3]||0));
  return BigInt(Date.UTC(year,month-1,day,9,30)-offset*60000)*1000000n;
}
function sourceIdentity(doc:RecordValue):{ticker:string;session:string} {
  const ticker=asString(doc.ticker,"ticker");
  if(!SYMBOL.test(ticker)) return fail("ticker:invalid");
  const session=asString(doc.session,"session");
  sessionOpen(session);
  return {ticker,session};
}
function nullFields(doc:RecordValue,fields:readonly string[],reason:string) {
  if(fields.some(key=>doc[key]!==null)) fail(reason);
}
function readObserved(x:unknown):ObservedSource {
  const o=record(x,"observed_source");exactKeys(o,OBS_KEYS,"observed_source");
  if(o.state!=="BOUNDED_SOURCE_OBSERVATION_NOT_AUTHENTICATED"||
     o.cluster_clock!=="SIP_REPORT_TIME_PROXY_NOT_EXECUTION_CLOCK"||
     typeof o.full_rth_covered_claim_unverified!=="boolean") fail("observed:source_state");
  const n=count(o.n_trf_observed,"observed.sampled_trf");
  if(n<1) fail("observed:no_qualified_TRF");
  count(o.n_unknown_volume_policy,"observed.unqualified",20000);
  const one=numeric(o.largest_individual_print_usd,"single_print_usd");
  const all=numeric(o.measured_rth_trf_notional_usd,"trf_daily_total");
  const shares=numeric(o.measured_rth_trf_shares,"trf_measured_shares");
  if(cmp(one.exact,all.exact)>0 || all.exact.numerator<=0n ||
     shares.exact.numerator<=0n) fail("observed:total_below_print");
  const cluster=o.largest_same_level_cluster_usd===null?null:
       numeric(o.largest_same_level_cluster_usd,"cluster_usd");
  if(cluster&&cmp(cluster.exact,all.exact)>0) fail("observed:total_below_cluster");
  const tiers=record(o.block_tier_counts,"observed.tiers");
  exactKeys(tiers,["100000","500000","1000000"],"observed.tiers");
  const t100=count(tiers["100000"],"tier100",n);
  const t500=count(tiers["500000"],"tier500",n);
  const t1000=count(tiers["1000000"],"tier1000",n);
  if(t1000>t500||t500>t100) fail("observed:tier_monotonicity");
  return Object.freeze({
    individualPrintUsd:one.text,sameLevelClusterUsd:cluster?.text||null,
    rthTotalUsd:all.text,measuredShares:shares.text,sampledTrfPrints:n,
    tierCounts:Object.freeze({"100000":t100,"500000":t500,"1000000":t1000}),
    sourceCapturedMarket:false,
    fullRthCoveredClaimUnverified:o.full_rth_covered_claim_unverified as boolean,
  });
}
function readRanks(x:unknown,observed:ObservedSource):Readonly<Record<RankKind,ObservedRank>> {
  const r=record(x,"ranks");exactKeys(r,RANKS,"ranks");
  const out={} as Record<RankKind,ObservedRank>;
  for(const kind of RANKS){
    const row=record(r[kind],kind);
    exactKeys(row,["state","rank_desc_in_observed_sample","n_prior_comparable","source_metric"],kind);
    const state=oneOf(row.state,RANK_STATES,kind);
    if(row.source_metric!==RANK_METRIC[kind]) fail(kind+":metric_mismatch");
    const n=count(row.n_prior_comparable,kind+":history_n",1500);
    const rank=row.rank_desc_in_observed_sample;
    if(state==="OBSERVED_COVERAGE_ONLY"){
      if(typeof rank!=="number"||!Number.isSafeInteger(rank)||rank<1||rank>n+1)
        fail(kind+":invalid_rank");
      if(!observed.fullRthCoveredClaimUnverified) fail(kind+":partial_day_rank");
    }else if(rank!==null) fail(kind+":rank_without_history");
    out[kind]=Object.freeze({state,sampleRank:rank as number|null,priorN:n,metric:RANK_METRIC[kind]});
  }
  return Object.freeze(out);
}
function readMinute(x:unknown):MinuteBaseline {
  const m=record(x,"minute_baseline");exactKeys(m,MINUTE_KEYS,"minute_baseline");
  const state=oneOf(m.state,MINUTE_STATES,"minute_baseline");
  if(m.conditioning!=="EXACT_MINUTE_INDEX_RTH_CUMULATIVE_ONLY") fail("minute:wrong_conditioning");
  const minute=count(m.minute_index,"minute:index",389);
  const n=count(m.n_prior,"minute:history_n",1500);
  const share=optionalFraction(m.cumulative_offexchange_share,"minute:share");
  const median=optionalFraction(m.median,"minute:median");
  const mad=optionalFraction(m.mad,"minute:mad");
  const midrank=optionalFraction(m.midrank_percentile,"minute:midrank");
  const z=optionalSigned(m.robust_z,"minute:robust_z");
  if(m.history_coverage_start!==null) sessionOpen(m.history_coverage_start);
  if(state==="OBSERVED_COVERAGE_ONLY"){
    if(n<2||share===null||median===null||mad===null||
       midrank===null||z===null||
       cmp(numeric(mad,"minute:mad").exact,{numerator:0n,scale:0})<=0)
      fail("minute:incomplete_robust_evidence");
  }else if(state==="NO_ROBUST_DISPERSION"){
    if(n<2||share===null||median===null||mad===null||midrank===null||
       cmp(numeric(mad,"minute:mad").exact,{numerator:0n,scale:0})!==0||
       z!==null) fail("minute:false_dispersion");
  }else if(median!==null||mad!==null||midrank!==null||z!==null) fail("minute:unqualified_statistic");
  return Object.freeze({state,minuteIndex:minute,sampleN:n,
    cumulativeOffexchangeShare:share,median,mad,midrankPercentile:midrank,robustZ:z});
}
function readProvisional(x:unknown,identity:{ticker:string;session:string},cutoff:bigint):ProvisionalMinute {
  const p=record(x,"tp1_minute");exactKeys(p,TP1_KEYS,"tp1_minute");
  if(p.source!=="TP1_VERIFIED_PRIVATE_BODY_REQUIRES_EXTERNAL_CUSTODY_PROOF"||
     p.source_authenticity!=="EXTERNAL_INCUMBENT_PROOF_REQUIRED"||
     p.ticker!==identity.ticker||p.session!==identity.session||
     p.trf_volume_eligibility_proven!==false||
     p.classification_accuracy_validated!==false||
     p.join_to_tpb_historical_ranks!==false) fail("tp1:source_authority_or_identity");
  assertSha(p.source_manifest_sha256,"tp1.manifest");
  assertSha(p.source_observation_sha256,"tp1.observation");
  const start=ns(p.minute_start_ns_decimal,"tp1.start");
  const end=ns(p.minute_end_ns_decimal,"tp1.end");
  const decision=ns(p.minute_decision_ns_decimal,"tp1.decision");
  const watermark=ns(p.watermark_available_ns_decimal,"tp1.watermark");
  const open=sessionOpen(identity.session);
  if(start<open||start%MINUTE_NS!==0n||end-start!==MINUTE_NS||
     end>open+390n*MINUTE_NS||decision<end||watermark>decision||
     decision>cutoff) fail("tp1:future_or_misaligned_clock");
  const total=count(p.sampled_prints,"tp1.count",10000);
  const lit=count(p.sampled_lit_prints,"tp1.lit",total);
  const trf=count(p.sampled_trf_prints,"tp1.trf",total);
  const located=count(p.lit_quote_located_le5s_prints,"tp1.located",lit);
  if(lit+trf>total) fail("tp1:sampled_print_denominator");
  const raw=numeric(p.provisional_trf_any_condition_notional_usd,"tp1.raw_TRF_notional");
  if(trf===0 && raw.exact.numerator!==0n) fail("tp1:nonzero_without_TRF");
  return Object.freeze({minuteStartNs:start,minuteEndNs:end,minuteDecisionNs:decision,
    watermarkAvailableNs:watermark,sampledLitPrints:lit,sampledTrfPrints:trf,
    locatedLitQuotePrintsLe5s:located,trfAnyConditionNotionalUsd:raw.text,
    qualifiedForHistoricalJoin:false,trfVolumeEligibilityProven:false});
}

/**
 * Exact-byte TP-2 PRIVATE derived view: no fetch, public endpoint, signer, or
 * silent TP1-vs-TPB volume join. This reader cannot grant source custody.
 */
export function decodeTp2PrivateArtifact(input:PrivateBytesInput):Tp2PrivateProjection {
  const {doc:d,sha}=readArtifact(input,MAX_TP2_BYTES);
  exactKeys(d,TP2_KEYS,"tp2");
  if(d.schema!==TP2_SCHEMA||
     d.authority!=="PRIVATE_RESEARCH_VIEW_HOLD_NOT_DELIVERY"||
     d.eod_weekly_context!=="UNCHANGED_SEPARATE_EXISTING_CONSUMER"||
     d.source_authenticated!==false||
     d.market_capture_completeness_proven!==false||
     d.public_delivery_allowed!==false||
     d.ranking_trading_alert_authority!==false) fail("tp2:authorization_or_schema");
  nullFields(d,["signal","live_block_tape","repeat_print_price_shelves",
    "live_signed_offexchange_flow","nbbo_classification_coverage",
    "named_ats_attribution","finra_ats_delayed_context"],"tp2:invented_live_evidence");
  const state=oneOf(d.state,TP2_STATES,"tp2.state");
  const view=ns(d.view_asof_ns_decimal,"tp2.view");
  const sourceAsOf=d.observation_asof_ns_decimal===null?null:
    ns(d.observation_asof_ns_decimal,"tp2.sourceAsOf");
  if(sourceAsOf!==null&&sourceAsOf>view) fail("tp2:future_source");
  const absent=state==="NO_TPB_OBSERVATION_SOURCE"||state==="SOURCE_NOT_YET_KNOWABLE";
  let identity:{ticker:string;session:string}|null=null;
  if(absent){
    nullFields(d,["ticker","session","source_generation_sha256",
      "source_snapshot_sha256","source_manifest_sha256",
      "observation_asof_ns_decimal","observed_source",
      "historical_ruler","intraday_minute_baseline"],"tp2:future_source_metadata");
  }else{
    identity=sourceIdentity(d);
    if(sourceAsOf===null||sourceAsOf<sessionOpen(identity.session))
      fail("tp2:missing_original_source_cutoff");
    assertSha(d.source_generation_sha256,"tp2.generation");
    assertSha(d.source_snapshot_sha256,"tp2.snapshot");
    assertSha(d.source_manifest_sha256,"tp2.manifest");
  }
  if(d.reason!==null &&
     (state!=="NO_QUALIFIED_TRF_OBSERVATIONS"||
      !["NO_SAMPLED_PRINTS","NO_QUALIFIED_OFF_EXCHANGE_OBSERVED"].includes(String(d.reason))))
    fail("tp2:invalid_null_reason");
  const observed=d.observed_source===null?null:readObserved(d.observed_source);
  if(["NO_QUALIFIED_TRF_OBSERVATIONS","SOURCE_NOT_YET_KNOWABLE",
      "NO_TPB_OBSERVATION_SOURCE"].includes(state)&&observed!==null)
    fail("tp2:absent_source_has_observed_volume");
  if(["HISTORICAL_CALIBRATION_PENDING","CALIBRATION_NOT_YET_KNOWABLE",
      "CALIBRATION_STALE_SOURCE_GENERATION","PRIVATE_TPB_RESEARCH_CONTEXT_ONLY"].includes(state)&&
      observed===null) fail("tp2:missing_observation");
  if(state!=="PRIVATE_TPB_RESEARCH_CONTEXT_ONLY" &&
      (d.historical_ruler!==null||d.intraday_minute_baseline!==null))
    fail("tp2:historical_evidence_before_maturity");
  if(state==="PRIVATE_TPB_RESEARCH_CONTEXT_ONLY" &&
     (observed===null||d.historical_ruler===null||d.intraday_minute_baseline===null))
    fail("tp2:incomplete_historical_evidence");
  const ranks=d.historical_ruler===null?null:readRanks(d.historical_ruler,observed!);
  const baseline=d.intraday_minute_baseline===null?null:readMinute(d.intraday_minute_baseline);
  const minuteState=oneOf(d.tp1_minute_state,[
    "TP1_MINUTE_NOT_SUPPLIED","TP1_MINUTE_NOT_YET_KNOWABLE",
    "PROVISIONAL_TP1_MINUTE_RESEARCH_HOLD"],"tp1.minute_state");
  if(minuteState!=="PROVISIONAL_TP1_MINUTE_RESEARCH_HOLD" &&
     d.tp1_provisional_minute!==null) fail("tp1:future_or_missing_minute_leaked");
  let provisional:ProvisionalMinute|null=null;
  if(minuteState==="PROVISIONAL_TP1_MINUTE_RESEARCH_HOLD"){
    if(identity===null) {
      const p=record(d.tp1_provisional_minute,"tp1.minute");
      identity=sourceIdentity(p);
    }
    provisional=readProvisional(d.tp1_provisional_minute,identity,view);
  }
  return Object.freeze({schema:"terminal.tp2.private_projection/v0",
    sourceSchema:TP2_SCHEMA,state,ticker:d.ticker as string|null,
    session:d.session as string|null,viewAsOfNs:view,
    observationAsOfNs:sourceAsOf,observed,ranks,minuteBaseline:baseline,
    provisional,originalByteSha256:sha,sourceAuthenticated:false,
    publicDeliveryAllowed:false,productionApproved:false,tradingAuthority:false,
    namedATS:null,finraATSDelayed:null,blockTape:null,livePriceShelves:null,
    signedFlow:null,eodSourceUnchanged:true});
}

/** Independently versioned R0 descriptive sidecar, NEVER joined to TP-B data. */
export function decodeTp2R0Sidecar(input:PrivateBytesInput):Tp2R0Projection {
  const {doc:d,sha}=readArtifact(input,MAX_R0_BYTES);
  exactKeys(d,R0_KEYS,"r0_sidecar");
  if(d.schema!==R0_SCHEMA||
     d.authority!=="PRIVATE_R0_RESEARCH_CONTEXT_HOLD"||
     d.join_to_tp1_or_tpb!==false||d.source_authenticated!==false||
     d.public_delivery_allowed!==false||d.rank_trade_alert_authority!==false||
     d.forward_label!==null||d.absorption_signal!==null)
    fail("r0:source_or_trading_authority");
  const state=oneOf(d.state,R0_STATES,"r0.state");
  const view=ns(d.view_asof_ns_decimal,"r0.view");
  const absent=state!=="R0_OBSERVATIONAL_CONTEXT_HOLD";
  if(absent) nullFields(d,[
    "ticker","session","source_start_ns_decimal","source_end_ns_decimal",
    "source_decision_ns_decimal","source_manifest_sha256",
    "source_minutes_receipt_sha256","source_quotes_receipt_sha256",
    "observed_proxy"],"r0:future_or_absent_source_metadata");
  let identity:{ticker:string;session:string}|null=null;
  let originalStart:bigint|null=null;
  let originalDecision:bigint|null=null;
  let pressure:Tp2R0Projection["pressure"]=null;
  if(!absent) {
    identity=sourceIdentity(d);
    const open=sessionOpen(identity.session);
    originalStart=ns(d.source_start_ns_decimal,"r0.start");
    const end=ns(d.source_end_ns_decimal,"r0.end");
    originalDecision=ns(d.source_decision_ns_decimal,"r0.decision");
    if(originalStart<open||originalStart%MINUTE_NS!==0n||
       end<=originalStart||end>open+390n*MINUTE_NS||
       end-originalStart>5n*MINUTE_NS||
       (end-originalStart)%MINUTE_NS!==0n||
       originalDecision<end||originalDecision>view)
      fail("r0:source_window_or_future");
    assertSha(d.source_manifest_sha256,"r0.manifest");
    assertSha(d.source_minutes_receipt_sha256,"r0.minutes");
    assertSha(d.source_quotes_receipt_sha256,"r0.quotes");
    const p=record(d.observed_proxy,"r0.observed_proxy");
    exactKeys(p,R0_PROXY_KEYS,"r0.observed_proxy");
    if(p.basis!=="LIT_QUOTE_LOCATION_RESEARCH_PROXY_NOT_AGGRESSOR_TRUTH"||
       p.price_response_kind!=="SAME_COMPLETED_WINDOW_DESCRIPTIVE_NOT_FORWARD"||
       p.trade_side_accuracy_calibrated!==false)
      fail("r0:validated_trade_inference_claim");
    const n=count(p.sampled_prints,"r0.sampled",100000);
    const unclassified=count(p.unclassified_prints,"r0.unclassified",n);
    const packets=count(p.source_minute_packets,"r0.packets",5);
    if(packets!==Number((end-originalStart)/MINUTE_NS)||n<1||unclassified>n)
      fail("r0:source_denominators");
    const buy=numeric(p.buy_proxy_notional_usd,"r0.buy_proxy");
    const sell=numeric(p.sell_proxy_notional_usd,"r0.sell_proxy");
    const unknown=numeric(p.unknown_notional_usd,"r0.unknown");
    void buy;void sell;void unknown;
    const coverage=p.classified_notional_coverage===null?null:
      fraction(p.classified_notional_coverage,"r0.coverage");
    const balance=p.pressure_balance===null?null:
      signedRange(p.pressure_balance,"r0.pressure_balance");
    const response=p.completed_window_midpoint_response_bps===null?null:
      numeric(p.completed_window_midpoint_response_bps,"r0.window_response",{signed:true,maxWidth:1024}).text;
    ns(p.quote_age_policy_ns_decimal,"r0.quote_age_policy");
    const recoveryStates=[
      "UNKNOWN","MEASURED_NBBO_SIZE_PROXY_NOT_ORDER_REPLENISHMENT"];
    oneOf(p.bid_size_recovery_state,recoveryStates,"r0.bid_recovery");
    oneOf(p.ask_size_recovery_state,recoveryStates,"r0.ask_recovery");
    pressure=Object.freeze({pressureBalance:balance,coverage,
      midpointResponseBps:response,sampledPrints:n,tradeSideAccuracyCalibrated:false});
  }
  return Object.freeze({schema:"terminal.tp2.r0_research_projection/v0",
    sourceSchema:R0_SCHEMA,state,ticker:d.ticker as string|null,
    session:d.session as string|null,viewAsOfNs:view,
    originalStartNs:originalStart,originalDecisionNs:originalDecision,
    pressure,originalByteSha256:sha,joinToTp1OrTpb:false,
    sourceAuthenticated:false,publicDeliveryAllowed:false,tradingAuthority:false,
    forwardLabel:null,absorptionSignal:null});
}
