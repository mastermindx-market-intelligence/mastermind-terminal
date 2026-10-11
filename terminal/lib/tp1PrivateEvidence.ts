/**
 * Phase-A, server-side TP-1/R0 private evidence adapter.
 *
 * No source collector, browser API, R2 fallback, auth provider, publisher,
 * public display permission or trading authority is implemented here.
 *
 * Macro's existing /v0 private JSON serializes SIP/receipt ns as JSON integers
 * above Number.MAX_SAFE_INTEGER. JSON.parse(raw) destroys their last digits.
 * This reader verifies the ORIGINAL byte digest, lexically lifts only the known
 * top-level nanosecond tokens into decimal strings BEFORE JSON.parse, and
 * exposes exact bigint clocks. All other JSON integers must be safe.
 *
 * The upstream source owner may introduce /v1 string-clock projection later.
 * Until reviewed, this /v0 reader stays private, standalone and unshipped.
 */
import { createHash } from "node:crypto";

export type EvidenceKind = "minute" | "research";
export type PrivateEvidence = {
  kind: EvidenceKind;
  ticker: string;
  session: string;
  clocksNs: Readonly<Record<string, bigint>>;
  sourceHashes: Readonly<Record<string, string>>;
  sourceCounts: Readonly<Record<string, number>>;
  notionalUsd: Readonly<Record<string, string>>;
  volumeShares: Readonly<Record<string, string>> | null;
  pressureBalance: string | null;
  completedWindowResponseBps: string | null;
  quoteRecovery: { bid: QuoteRecovery; ask: QuoteRecovery } | null;
  originalByteSha256: string;
  sourceAuthenticated: false;
  productionApproved: false;
  publicDeliveryAllowed: false;
};
export type QuoteRecovery =
  | { state: "UNKNOWN"; reason: string }
  | { state: "MEASURED_NBBO_SIZE_PROXY_NOT_ORDER_REPLENISHMENT";
      depletionShares: string; recoveredShares: string;
      originalShares: string; finalShares: string;
      bestExchange: string; bestPrice: string };

export class PrivateEvidenceRefusal extends Error {
  constructor(reason: string) { super(reason); this.name = "PrivateEvidenceRefusal"; }
}

const NS_FIELDS: Record<EvidenceKind, readonly string[]> = {
  minute: ["start_ns", "end_ns", "decision_ns", "source_complete_through_ns",
    "source_watermark_available_ns", "source_latest_print_available_ns", "max_quote_age_ns"],
  research: ["start_ns", "end_ns", "decision_ns", "source_quote_age_limit_ns"],
};
const TOP_FIELDS: Record<EvidenceKind, readonly string[]> = {
  minute: [
    "schema","source_schema","distribution_class","public_delivery_allowed",
    "rank_trade_alert_authority","source_authenticity","live_capture_completeness",
    "source_mode","correction_status","ticker","session","start_ns","end_ns",
    "source_complete_through_ns","decision_ns","source_watermark_available_ns",
    "source_latest_print_available_ns","max_quote_age_ns",
    "source_watermark_receipt_sha256","source_manifest_sha256",
    "source_observation_sha256","condition_policy_sha256",
    "exchange_policy_sha256","quote_policy_sha256","counts",
    "notional_usd","volume_shares","lit_quoted_notional_coverage",
    "unknown_reason_counts","lit_unknown_reason_counts","price_response_bps",
    "absorption_signal",
  ],
  research: [
    "schema","source_schema","distribution_class","public_delivery_allowed",
    "rank_trade_alert_authority","source_authenticity",
    "market_capture_completeness","ticker","session","start_ns","end_ns",
    "decision_ns","source_quote_age_limit_ns","source_manifest_sha256",
    "source_manifest_name_sha256","source_watermark_receipt_sha256",
    "minute_observations_sha256","quote_observations_sha256",
    "source_condition_rules_sha256","source_exchange_rules_sha256",
    "source_quote_condition_rules_sha256","n_observations","notional_usd",
    "classified_notional_coverage","pressure_balance",
    "completed_window_midpoint_response_bps","bid_size_recovery_proxy",
    "ask_size_recovery_proxy","absorption_signal","forward_label",
  ],
};
const COUNTS: Record<EvidenceKind, readonly string[]> = {
  minute: [
    "n_sampled_prints","n_lit","n_trf","n_unknown_venue","n_unclassified",
    "n_condition_ineligible","n_buy_proxy","n_sell_proxy","n_midpoint",
    "n_lit_eligible_prints","n_lit_classified_quote_le5s_prints",
    "n_lit_classified_quote_gt5s_prints","n_lit_unclassified_prints",
    "n_lit_source_unqualified_prints","n_source_volume_included_prints",
    "n_source_volume_excluded_prints","n_source_volume_unknown_prints",
  ],
  research: [
    "n_source_minute_packets","n_sampled_prints","n_unclassified",
    "n_quote_updates","n_quote_condition_unqualified",
  ],
};
const MONEY: readonly string[] = [
  "gross_sampled_notional_usd","buy_proxy_notional_usd",
  "sell_proxy_notional_usd","midpoint_notional_usd","unknown_notional_usd",
  "ineligible_notional_usd","trf_gross_notional_usd",
];
const SHARES: readonly string[] = [
  "source_all_printed_shares","source_volume_included_shares",
  "source_volume_excluded_shares","source_volume_unknown_shares",
];
const SHA = /^[a-f0-9]{64}$/;
const SYMBOL = /^[A-Z][A-Z0-9.-]{0,19}$/;
const SESSION = /^\d{4}-\d{2}-\d{2}:RTH$/;
const CLOCK = /^(0|[1-9]\d{0,18})$/;
const DECIMAL = /^-?(?:0|[1-9]\d{0,59})(?:\.\d{1,30})?$/;
const MINUTE_NS = 60_000_000_000n;
const MAX_NS = 9_223_372_036_854_775_807n; // signed native 64-bit
const MAX_LENGTH = { minute: 32 * 1024, research: 24 * 1024 };

type RecordValue = Record<string, unknown>;
function record(value: unknown, what: string): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new PrivateEvidenceRefusal(what + ":object");
  return value as RecordValue;
}
function assertKeys(value: RecordValue, keys: readonly string[], name: string): void {
  const actual = Object.keys(value);
  if (actual.length !== keys.length ||
      actual.some(k => !keys.includes(k)) ||
      keys.some(k => !Object.hasOwn(value, k)))
    throw new PrivateEvidenceRefusal(name + ":unapproved_fields");
}
function assertHash(value: unknown, field: string): string {
  if (typeof value !== "string" || !SHA.test(value))
    throw new PrivateEvidenceRefusal(field + ":digest");
  return value;
}
function assertClock(value: unknown, field: string): bigint {
  if (typeof value !== "string" || !CLOCK.test(value))
    throw new PrivateEvidenceRefusal(field + ":unsafe_ns");
  const n = BigInt(value);
  if (n > MAX_NS) throw new PrivateEvidenceRefusal(field + ":overflow");
  return n;
}
function assertCount(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new PrivateEvidenceRefusal(field + ":unsafe_count");
  return value;
}
function assertDecimal(value: unknown, field: string, signed = false): string {
  if (typeof value !== "string" || !DECIMAL.test(value) || (!signed && value.startsWith("-")))
    throw new PrivateEvidenceRefusal(field + ":bad_decimal");
  return value;
}
type Fixed = { n: bigint; scale: number };
function fixed(value: string): Fixed {
  const neg = value.startsWith("-");
  const parts = (neg ? value.slice(1) : value).split(".");
  return { n: BigInt((neg ? "-" : "") + parts.join("")), scale: parts[1]?.length ?? 0 };
}
function sameSum(parts: string[], total: string): boolean {
  const entries = [...parts, total].map(fixed);
  const scale = Math.max(...entries.map(x => x.scale));
  const scaleUp = (x: Fixed) => x.n * 10n ** BigInt(scale - x.scale);
  return entries.slice(0,-1).reduce((a,x) => a + scaleUp(x), 0n) === scaleUp(entries[entries.length-1]);
}
function atMostOne(value: string): boolean {
  const x=fixed(value);
  return x.n >= 0n && x.n <= 10n ** BigInt(x.scale);
}
function canonical(value: unknown): string {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const o=value as RecordValue;
    return "{" + Object.keys(o).sort().map(k => JSON.stringify(k)+":"+canonical(o[k])).join(",") + "}";
  }
  if (Array.isArray(value)) return "["+value.map(canonical).join(",")+"]";
  return JSON.stringify(value);
}
/** Preserve the exact original integer lexemes before any unsafe JS number parse. */
function liftKnownTopLevelClocks(bytes: Buffer, kind: EvidenceKind): RecordValue {
  const raw = bytes.toString("utf8");
  if (!Buffer.from(raw,"utf8").equals(bytes) || /[^\x09\x0a\x0d\x20-\x7e]/.test(raw))
    throw new PrivateEvidenceRefusal("source_bytes:not_canonical_ascii");
  if (!raw.startsWith("{") || !raw.endsWith("}\n"))
    throw new PrivateEvidenceRefusal("source_bytes:not_canonical_json");
  let lifted = raw;
  for (const name of NS_FIELDS[kind]) {
    const expression = new RegExp('"'+name+'":([0-9]+)(?=[,}])','g');
    const matches=[...lifted.matchAll(expression)];
    if (matches.length !== 1) throw new PrivateEvidenceRefusal(name+":missing_or_duplicate_ns");
    const old=matches[0][0], replacement='"'+name+'":"'+matches[0][1]+'"';
    lifted=lifted.replace(old,replacement);
  }
  let parsed: unknown;
  try { parsed=JSON.parse(lifted); }
  catch { throw new PrivateEvidenceRefusal("source_bytes:malformed_json"); }
  const obj=record(parsed,"source_root");
  // Byte-for-byte canonical order independently prevents duplicate/extra
  // field shadowing, escaped-token trickery, and noncanonical source variants.
  if (canonical(obj)+"\n" !== lifted)
    throw new PrivateEvidenceRefusal("source_bytes:noncanonical");
  return obj;
}
function reasonCounts(value: unknown, field: string): number {
  const obj=record(value,field);
  if (Object.keys(obj).length>100) throw new PrivateEvidenceRefusal(field+":unbounded");
  let count=0;
  for (const [k,v] of Object.entries(obj)) {
    if (!/^[A-Z][A-Z0-9_]{0,79}$/.test(k))
      throw new PrivateEvidenceRefusal(field+":invalid_reason");
    count+=assertCount(v,field+"."+k);
  }
  return count;
}
function parseRecovery(value: unknown, side: string): QuoteRecovery {
  const obj=record(value,side);
  if (obj.state==="UNKNOWN") {
    assertKeys(obj,["state","reason"],side);
    if (typeof obj.reason!=="string" || !/^[A-Z][A-Z0-9_]{0,79}$/.test(obj.reason))
      throw new PrivateEvidenceRefusal(side+":unknown_reason");
    return {state:"UNKNOWN",reason:obj.reason};
  }
  const state="MEASURED_NBBO_SIZE_PROXY_NOT_ORDER_REPLENISHMENT";
  if (obj.state!==state) throw new PrivateEvidenceRefusal(side+":not_a_proxy");
  assertKeys(obj,["state","depletion_shares","recovered_shares","original_shares",
    "final_shares","source_best_exchange","source_best_price"],side);
  const depleted=assertDecimal(obj.depletion_shares,side+".depletion_shares");
  const recovered=assertDecimal(obj.recovered_shares,side+".recovered_shares");
  const initial=assertDecimal(obj.original_shares,side+".original_shares");
  const ending=assertDecimal(obj.final_shares,side+".final_shares");
  const price=assertDecimal(obj.source_best_price,side+".price");
  // original - depletion + recovery = final; exact fixed-point arithmetic,
  // never infer participant/order-level replenishment from BBO-size recovery.
  const vals=[initial,depleted,recovered,ending].map(fixed);
  const scale=Math.max(...vals.map(x=>x.scale));
  const n=vals.map(x=>x.n*10n**BigInt(scale-x.scale));
  if (n[0]<=0n || n[1]<=0n || n[3]<=0n || fixed(price).n<=0n ||
      n[1]>n[0] || n[0]-n[1]+n[2]!==n[3])
    throw new PrivateEvidenceRefusal(side+":invalid_recovery");
  if (typeof obj.source_best_exchange!=="string" || !/^[0-9]{1,5}$/.test(obj.source_best_exchange))
    throw new PrivateEvidenceRefusal(side+":exchange");
  return {state,depletionShares:depleted,recoveredShares:recovered,
    originalShares:initial,finalShares:ending,
    bestExchange:obj.source_best_exchange,bestPrice:price};
}

export function decodePrivateEvidence(args: {
  kind: EvidenceKind; bytes: Uint8Array; expectedSha256: string; expectedLength: number;
}): PrivateEvidence {
  const {kind,bytes,expectedSha256,expectedLength}=args;
  if (kind!=="minute" && kind!=="research") throw new PrivateEvidenceRefusal("kind:unknown");
  if (!(bytes instanceof Uint8Array) || bytes.byteLength<2 ||
      bytes.byteLength>MAX_LENGTH[kind] ||
      !Number.isSafeInteger(expectedLength) || expectedLength!==bytes.byteLength)
    throw new PrivateEvidenceRefusal("source_bytes:invalid_length");
  assertHash(expectedSha256,"expectedSha256");
  const buf=Buffer.from(bytes);
  const rawHash=createHash("sha256").update(buf).digest("hex");
  if (rawHash!==expectedSha256) throw new PrivateEvidenceRefusal("source_bytes:hash_mismatch");
  const obj=liftKnownTopLevelClocks(buf,kind);
  assertKeys(obj,TOP_FIELDS[kind],kind);
  const prefix=kind==="minute"?"equity.tick_plane":"equity.pressure_response";
  if (obj.schema !== prefix + (kind==="minute"?
      ".private_minute_artifact/v0":".private_context_view/v0") ||
      obj.public_delivery_allowed!==false || obj.rank_trade_alert_authority!==false ||
      obj.absorption_signal!==null ||
      obj.distribution_class!==(kind==="minute"?
      "PRIVATE_SERVICE_HOLD_PENDING_LICENSE_AND_CONSUMER_REVIEW":
      "PRIVATE_SERVICE_HOLD_PENDING_LICENSE_REVIEW"))
    throw new PrivateEvidenceRefusal("source:distribution_or_authority");
  if (kind==="minute") {
    if (obj.source_authenticity!=="EXTERNAL_INCUMBENT_PROOF_REQUIRED" ||
        obj.live_capture_completeness!=="UNVERIFIED_BY_PROJECTION" ||
        obj.correction_status!=="STREAM_PROVISIONAL_UNRECONCILED" ||
        obj.price_response_bps!==null)
      throw new PrivateEvidenceRefusal("minute:false_source_finality");
  } else if (obj.source_authenticity!=="ORIGINAL_TQ_RECEIPTS_REQUIRE_EXTERNAL_OWNER_PROOF" ||
             obj.market_capture_completeness!=="NOT_PROVEN_BY_RESEARCH_MATH" ||
             obj.forward_label!==null) {
    throw new PrivateEvidenceRefusal("research:false_source_finality");
  }
  if (typeof obj.ticker!=="string" || !SYMBOL.test(obj.ticker) ||
      typeof obj.session!=="string" || !SESSION.test(obj.session))
    throw new PrivateEvidenceRefusal("source:symbol_or_session");
  const day=obj.session.slice(0,10);
  const d=new Date(day+"T00:00:00Z");
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0,10)!==day)
    throw new PrivateEvidenceRefusal("source:invalid_session_day");
  const clocksNs: Record<string,bigint>={};
  for (const field of NS_FIELDS[kind]) clocksNs[field]=assertClock(obj[field],field);
  const start=clocksNs.start_ns, end=clocksNs.end_ns, cutoff=clocksNs.decision_ns;
  if (start%MINUTE_NS!==0n || end<=start || cutoff<end ||
      (end-start)%MINUTE_NS!==0n ||
      (kind==="minute"?end-start!==MINUTE_NS:end-start>5n*MINUTE_NS))
    throw new PrivateEvidenceRefusal("source:time_window");
  if (kind==="minute" &&
      (clocksNs.source_complete_through_ns<end ||
       clocksNs.source_watermark_available_ns<clocksNs.source_complete_through_ns ||
       clocksNs.source_watermark_available_ns>cutoff ||
       clocksNs.source_latest_print_available_ns>cutoff))
    throw new PrivateEvidenceRefusal("source:original_availability");
  const hashes: Record<string,string>={};
  for (const field of (kind==="minute"?
      ["source_manifest_sha256","source_watermark_receipt_sha256",
       "source_observation_sha256","condition_policy_sha256",
       "exchange_policy_sha256","quote_policy_sha256"]:
      ["source_manifest_sha256","source_manifest_name_sha256",
       "source_watermark_receipt_sha256","minute_observations_sha256",
       "quote_observations_sha256","source_condition_rules_sha256",
       "source_exchange_rules_sha256","source_quote_condition_rules_sha256"])) {
    hashes[field]=assertHash(obj[field],field);
  }
  const counted=record(obj[kind==="minute"?"counts":"n_observations"],"counts");
  assertKeys(counted,COUNTS[kind],"counts");
  const counts: Record<string,number>={};
  for (const name of COUNTS[kind]) counts[name]=assertCount(counted[name],name);
  if (counts.n_sampled_prints<=0) throw new PrivateEvidenceRefusal("counts:no_source_sample");
  if (kind==="minute") {
    if (counts.n_lit+counts.n_trf+counts.n_unknown_venue!==counts.n_sampled_prints ||
        counts.n_buy_proxy+counts.n_sell_proxy+counts.n_midpoint+
          counts.n_unclassified+counts.n_condition_ineligible!==counts.n_sampled_prints ||
        counts.n_source_volume_included_prints+counts.n_source_volume_excluded_prints+
          counts.n_source_volume_unknown_prints!==counts.n_sampled_prints ||
        counts.n_lit_eligible_prints!==counts.n_lit_classified_quote_le5s_prints+
          counts.n_lit_classified_quote_gt5s_prints+counts.n_lit_unclassified_prints ||
        reasonCounts(obj.unknown_reason_counts,"unknown_reason_counts")!==
          counts.n_unclassified+counts.n_condition_ineligible ||
        reasonCounts(obj.lit_unknown_reason_counts,"lit_unknown_reason_counts")!==
          counts.n_lit_unclassified_prints)
      throw new PrivateEvidenceRefusal("counts:denominator_inconsistent");
  } else if (counts.n_source_minute_packets!==Number((end-start)/MINUTE_NS) ||
             counts.n_unclassified>counts.n_sampled_prints ||
             counts.n_quote_condition_unqualified>counts.n_quote_updates)
    throw new PrivateEvidenceRefusal("counts:denominator_inconsistent");
  const money=record(obj.notional_usd,"notional_usd");
  assertKeys(money,MONEY,"notional_usd");
  const usd:Record<string,string>={};
  for(const name of MONEY) usd[name]=assertDecimal(money[name],name);
  if(!sameSum(["buy_proxy_notional_usd","sell_proxy_notional_usd","midpoint_notional_usd",
               "unknown_notional_usd","ineligible_notional_usd"].map(x=>usd[x]),
              usd.gross_sampled_notional_usd))
    throw new PrivateEvidenceRefusal("money:notional_conservation");
  let volumeShares:Record<string,string>|null=null;
  let pressureBalance:string|null=null,completedWindowResponseBps:string|null=null;
  let quoteRecovery: PrivateEvidence["quoteRecovery"]=null;
  if(kind==="minute"){
    const shares=record(obj.volume_shares,"volume_shares");
    assertKeys(shares,SHARES,"volume_shares");
    volumeShares={};
    for(const name of SHARES) volumeShares[name]=assertDecimal(shares[name],name);
    if(!sameSum(SHARES.slice(1).map(x=>volumeShares![x]),volumeShares.source_all_printed_shares))
      throw new PrivateEvidenceRefusal("shares:volume_conservation");
    if(obj.lit_quoted_notional_coverage!==null &&
        !atMostOne(assertDecimal(obj.lit_quoted_notional_coverage,"lit_quoted_notional_coverage")))
      throw new PrivateEvidenceRefusal("minute:coverage");
  }else{
    if(obj.classified_notional_coverage!==null &&
       !atMostOne(assertDecimal(obj.classified_notional_coverage,"classified_notional_coverage")))
      throw new PrivateEvidenceRefusal("research:coverage");
    if(obj.pressure_balance!==null){
      pressureBalance=assertDecimal(obj.pressure_balance,"pressure_balance",true);
      const value=fixed(pressureBalance),bound=10n**BigInt(value.scale);
      if(value.n< -bound || value.n>bound)throw new PrivateEvidenceRefusal("research:pressure_range");
    }
    completedWindowResponseBps=assertDecimal(obj.completed_window_midpoint_response_bps,
      "completed_window_midpoint_response_bps",true);
    quoteRecovery={bid:parseRecovery(obj.bid_size_recovery_proxy,"bid"),
                   ask:parseRecovery(obj.ask_size_recovery_proxy,"ask")};
  }
  return {kind,ticker:obj.ticker,session:obj.session,clocksNs,sourceHashes:hashes,
    sourceCounts:counts,notionalUsd:usd,volumeShares,pressureBalance,
    completedWindowResponseBps,quoteRecovery,originalByteSha256:rawHash,
    sourceAuthenticated:false,productionApproved:false,publicDeliveryAllowed:false};
}
