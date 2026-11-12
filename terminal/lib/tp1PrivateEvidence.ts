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
 * Terminal also exposes a separately versioned, invertible private /v1
 * projection with decimal-string clocks. The original Macro /v0 source
 * schema, bytes and authority remain unchanged; this is not source /v1.
 */
import { createHash } from "node:crypto";
import { NanosecondContractError, parseUnsignedNanoseconds } from "./tp1Nanoseconds";

export type EvidenceKind = "minute" | "research";
export type PrivateEvidence = {
  kind: EvidenceKind;
  ticker: string;
  session: string;
  clocksNs: Readonly<Record<string, bigint>>;
  sourceHashes: Readonly<Record<string, string | null>>;
  unknownReasons: Readonly<Record<string, number>>;
  litUnknownReasons: Readonly<Record<string, number>>;
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
// Align exact private Decimal representation with Macro source limits:
// native/quote values <= 128 fixed-point characters; R0 derived midpoint
// response and normalized pressure may use 2*(2*128+16) = 544 chars.
const DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const MAX_SOURCE_DECIMAL_CHARS = 128;
const MAX_R0_DERIVED_DECIMAL_CHARS = 544;
const MINUTE_NS = BigInt("60000000000");
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
  try { return parseUnsignedNanoseconds(value, field); }
  catch (error) {
    if (error instanceof NanosecondContractError)
      throw new PrivateEvidenceRefusal(error.message);
    throw error;
  }
}
function assertCount(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new PrivateEvidenceRefusal(field + ":unsafe_count");
  return value;
}
function assertDecimal(
  value: unknown, field: string, signed = false,
  maxWidth = MAX_SOURCE_DECIMAL_CHARS,
): string {
  if (typeof value !== "string" || value.length > maxWidth ||
      !DECIMAL.test(value) || (!signed && value.startsWith("-")))
    throw new PrivateEvidenceRefusal(field + ":bad_decimal");
  return value;
}
/**
 * TP-1's actual Python projector uses Decimal.to_eng_string() for money and
 * shares. Normalize only those fields for internal exact arithmetic. Keep
 * original lexical text in source/projection bytes and their hashes.
 *
 * Check the expanded Python Decimal width BEFORE padding any zeroes.
 * Exponent text is bounded before Number conversion; no monetary Number cast.
 */
function assertMinuteDecimal(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length > MAX_SOURCE_DECIMAL_CHARS)
    throw new PrivateEvidenceRefusal(field + ":bad_decimal");
  if (DECIMAL.test(value)) return assertDecimal(value, field);
  const match = /^((?:0|[1-9][0-9]{0,2})(?:\.[0-9]+)?)E([+-](?:0|[1-9][0-9]{0,2}))$/.exec(value);
  if (!match) throw new PrivateEvidenceRefusal(field + ":bad_decimal");
  const exponent = Number(match[2]);
  if (exponent % 3 !== 0) throw new PrivateEvidenceRefusal(field + ":bad_decimal");
  const [whole, fraction = ""] = match[1].split(".");
  const digits = (whole + fraction).replace(/^0+(?=[0-9])/, "");
  const fixedExponent = exponent - fraction.length;
  const left = digits.length + fixedExponent;
  const width = fixedExponent >= 0 ? left
    : left > 0 ? digits.length + 1 : 2 - left + digits.length;
  if (width > MAX_SOURCE_DECIMAL_CHARS)
    throw new PrivateEvidenceRefusal(field + ":bad_decimal");
  const expanded = left <= 0 ? "0." + "0".repeat(-left) + digits
    : left >= digits.length ? digits + "0".repeat(left - digits.length)
    : digits.slice(0, left) + "." + digits.slice(left);
  return assertDecimal(expanded.replace(/^0+(?=[0-9])/, ""), field);
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
  const scaleUp = (x: Fixed) => x.n * BigInt("10") ** BigInt(scale - x.scale);
  return entries.slice(0,-1).reduce((a,x) => a + scaleUp(x), BigInt("0")) === scaleUp(entries[entries.length-1]);
}
function atMostOne(value: string): boolean {
  const x=fixed(value);
  return x.n >= BigInt("0") && x.n <= BigInt("10") ** BigInt(x.scale);
}
function canonical(value: unknown, depth = 0): string {
  if (depth > 12) throw new PrivateEvidenceRefusal("source_bytes:max_depth");
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const o=value as RecordValue;
    return "{" + Object.keys(o).sort().map(k => JSON.stringify(k)+":"+canonical(o[k], depth + 1)).join(",") + "}";
  }
  if (Array.isArray(value)) return "["+value.map(x => canonical(x, depth + 1)).join(",")+"]";
  const rendered=JSON.stringify(value);
  if (rendered===undefined) throw new PrivateEvidenceRefusal("source_bytes:noncanonical_value");
  return rendered;
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
  const n=vals.map(x=>x.n*BigInt("10")**BigInt(scale-x.scale));
  if (n[0]<=BigInt("0") || n[1]<=BigInt("0") || n[3]<=BigInt("0") || fixed(price).n<=BigInt("0") ||
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
      obj.source_schema!==(kind==="minute"?
        "equity.tick_plane.minute_observation/v0":
        "equity.pressure_response.tp1_context/v0") ||
      obj.public_delivery_allowed!==false || obj.rank_trade_alert_authority!==false ||
      obj.absorption_signal!==null ||
      obj.distribution_class!==(kind==="minute"?
      "PRIVATE_SERVICE_HOLD_PENDING_LICENSE_AND_CONSUMER_REVIEW":
      "PRIVATE_SERVICE_HOLD_PENDING_LICENSE_REVIEW"))
    throw new PrivateEvidenceRefusal("source:distribution_or_authority");
  if (kind==="minute") {
    if (obj.source_mode!=="ACTUAL_AS_SEEN_ONLY_WHEN_OWNER_PROVES_RECEIPTS" ||
        obj.source_authenticity!=="EXTERNAL_INCUMBENT_PROOF_REQUIRED" ||
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
  if (start%MINUTE_NS!==BigInt("0") || end<=start || cutoff<end ||
      (end-start)%MINUTE_NS!==BigInt("0") ||
      (kind==="minute"?end-start!==MINUTE_NS:end-start>BigInt("5")*MINUTE_NS))
    throw new PrivateEvidenceRefusal("source:time_window");
  if (kind==="minute" &&
      (clocksNs.source_complete_through_ns<end ||
       clocksNs.source_watermark_available_ns<clocksNs.source_complete_through_ns ||
       clocksNs.source_watermark_available_ns>cutoff ||
       clocksNs.source_latest_print_available_ns>cutoff ||
       clocksNs.source_latest_print_available_ns<start))
    throw new PrivateEvidenceRefusal("source:original_availability");
  const hashes: Record<string,string|null>={};
  for (const field of (kind==="minute"?
      ["source_manifest_sha256","source_watermark_receipt_sha256",
       "source_observation_sha256","condition_policy_sha256",
       "exchange_policy_sha256","quote_policy_sha256"]:
      ["source_manifest_sha256","source_manifest_name_sha256",
       "source_watermark_receipt_sha256","minute_observations_sha256",
       "quote_observations_sha256","source_condition_rules_sha256",
       "source_exchange_rules_sha256","source_quote_condition_rules_sha256"])) {
    if (kind==="minute" &&
        ["condition_policy_sha256","exchange_policy_sha256","quote_policy_sha256"].includes(field)
        && obj[field]===null) {
      // A source-complete minute can contain only abstained prints.
      // Missing original condition/venue policy is missingness, not a zero.
      hashes[field]=null;
    } else hashes[field]=assertHash(obj[field],field);
  }
  const counted=record(obj[kind==="minute"?"counts":"n_observations"],"counts");
  assertKeys(counted,COUNTS[kind],"counts");
  const counts: Record<string,number>={};
  for (const name of COUNTS[kind]) counts[name]=assertCount(counted[name],name);
  if (counts.n_sampled_prints<=0) throw new PrivateEvidenceRefusal("counts:no_source_sample");
  const unknownReasons: Record<string,number> = kind==="minute"
    ? { ...record(obj.unknown_reason_counts,"unknown_reason_counts") } as Record<string,number>
    : {};
  const litUnknownReasons: Record<string,number> = kind==="minute"
    ? { ...record(obj.lit_unknown_reason_counts,"lit_unknown_reason_counts") } as Record<string,number>
    : {};
  if (kind==="minute") {
    if ((counts.n_buy_proxy+counts.n_sell_proxy+counts.n_midpoint)>0 &&
        ["condition_policy_sha256","exchange_policy_sha256","quote_policy_sha256"]
          .some(field=>hashes[field]===null))
      throw new PrivateEvidenceRefusal("minute:measured_without_source_policy");
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
  for(const name of MONEY) usd[name]=kind==="minute"
    ? assertMinuteDecimal(money[name],name) : assertDecimal(money[name],name);
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
    for(const name of SHARES) volumeShares[name]=assertMinuteDecimal(shares[name],name);
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
      pressureBalance=assertDecimal(
        obj.pressure_balance,"pressure_balance",true,MAX_R0_DERIVED_DECIMAL_CHARS);
      const value=fixed(pressureBalance),bound=BigInt("10")**BigInt(value.scale);
      if(value.n< -bound || value.n>bound)throw new PrivateEvidenceRefusal("research:pressure_range");
    }
    completedWindowResponseBps=assertDecimal(obj.completed_window_midpoint_response_bps,
      "completed_window_midpoint_response_bps",true,MAX_R0_DERIVED_DECIMAL_CHARS);
    quoteRecovery={bid:parseRecovery(obj.bid_size_recovery_proxy,"bid"),
                   ask:parseRecovery(obj.ask_size_recovery_proxy,"ask")};
  }
  return {kind,ticker:obj.ticker,session:obj.session,clocksNs,sourceHashes:hashes,
    unknownReasons,litUnknownReasons,
    sourceCounts:counts,notionalUsd:usd,volumeShares,pressureBalance,
    completedWindowResponseBps,quoteRecovery,originalByteSha256:rawHash,
    sourceAuthenticated:false,productionApproved:false,publicDeliveryAllowed:false};
}

/**
 * Align ONE TP-1 minute and ONE R0 completed minute from already decoded
 * private originals. This is compatibility verification, not a new source
 * generation, vendor receipt, cryptographic signature or consumer permission.
 *
 * R0's multi-minute source-minute digest cannot be re-derived from the
 * intentionally reduced TP-1 private view; that needs original owner custody.
 */
export function pairPrivateEvidence(
  minute: PrivateEvidence, research: PrivateEvidence,
): {
  pairingState: "PRIVATE_COMPATIBLE_ORIGINAL_SOURCE_UNPROVEN";
  ticker: string; session: string; decisionNs: bigint;
  pairedArtifactsSha256: string;
  sourceManifestSha256: string; quotePolicySha256: string;
  sourceAuthenticated: false; productionApproved: false;
  publicDeliveryAllowed: false;
} {
  if (minute.kind!=="minute" || research.kind!=="research" ||
      minute.volumeShares===null || research.volumeShares!==null ||
      minute.publicDeliveryAllowed!==false || research.publicDeliveryAllowed!==false ||
      minute.productionApproved!==false || research.productionApproved!==false)
    throw new PrivateEvidenceRefusal("pair:wrong_private_artifact_types");
  if (minute.ticker!==research.ticker || minute.session!==research.session)
    throw new PrivateEvidenceRefusal("pair:symbol_session_mismatch");
  for (const field of ["start_ns","end_ns","decision_ns"]) {
    if (minute.clocksNs[field]!==research.clocksNs[field])
      throw new PrivateEvidenceRefusal("pair:original_clock_mismatch");
  }
  if (minute.clocksNs.end_ns-minute.clocksNs.start_ns!==MINUTE_NS)
    throw new PrivateEvidenceRefusal("pair:not_one_original_minute");
  if (minute.clocksNs.max_quote_age_ns>research.clocksNs.source_quote_age_limit_ns)
    throw new PrivateEvidenceRefusal("pair:research_age_policy_too_strict");
  // R0 records the original minutes' exact policy, not a new processing ceiling.
  if (minute.clocksNs.max_quote_age_ns!==research.clocksNs.source_quote_age_limit_ns)
    throw new PrivateEvidenceRefusal("pair:research_age_policy_mismatch");
  for (const [left,right] of [
    ["source_manifest_sha256","source_manifest_sha256"],
    ["source_watermark_receipt_sha256","source_watermark_receipt_sha256"],
    ["condition_policy_sha256","source_condition_rules_sha256"],
    ["exchange_policy_sha256","source_exchange_rules_sha256"],
    ["quote_policy_sha256","source_quote_condition_rules_sha256"],
  ]) {
    if (minute.sourceHashes[left]===null ||
        minute.sourceHashes[left]!==research.sourceHashes[right])
      throw new PrivateEvidenceRefusal("pair:source_policy_or_receipt_mismatch");
  }
  for(const name of MONEY) {
    if(!sameSum([minute.notionalUsd[name]],research.notionalUsd[name]))
      throw new PrivateEvidenceRefusal("pair:source_notional_mismatch");
  }
  if (minute.sourceCounts.n_sampled_prints!==research.sourceCounts.n_sampled_prints ||
      minute.sourceCounts.n_unclassified!==research.sourceCounts.n_unclassified)
    throw new PrivateEvidenceRefusal("pair:source_population_mismatch");
  const pairDigest=createHash("sha256").update(
    minute.originalByteSha256+":"+research.originalByteSha256).digest("hex");
  const manifest=minute.sourceHashes.source_manifest_sha256;
  const quotePolicy=minute.sourceHashes.quote_policy_sha256;
  if (typeof manifest!=="string" || typeof quotePolicy!=="string")
    throw new PrivateEvidenceRefusal("pair:missing_original_source_policy");
  return {
    pairingState:"PRIVATE_COMPATIBLE_ORIGINAL_SOURCE_UNPROVEN",
    ticker:minute.ticker,session:minute.session,
    decisionNs:minute.clocksNs.decision_ns,
    pairedArtifactsSha256:pairDigest,
    sourceManifestSha256:manifest,
    quotePolicySha256:quotePolicy,
    sourceAuthenticated:false,productionApproved:false,
    publicDeliveryAllowed:false,
  };
}

/**
 * Terminal-owned JSON transport contract. This is an invertible projection of
 * the accepted Macro /v0 artifact, not a new Macro source schema or a service.
 * Frozen means the original observation bytes; corrections remain provisional.
 */
export const PRIVATE_EVIDENCE_PROJECTION_SCHEMA =
  "terminal.tp1.private_evidence_projection/v1" as const;
const ORIGINAL_SCHEMAS: Record<EvidenceKind, string> = {
  minute: "equity.tick_plane.private_minute_artifact/v0",
  research: "equity.pressure_response.private_context_view/v0",
};
const PROJECTION_FIELDS = [
  "schema", "kind", "timestamp_encoding", "temporal_role", "original_artifact",
  "observation", "source_authenticated", "production_approved",
  "public_delivery_allowed", "rank_trade_alert_authority",
] as const;
const PROJECTION_OVERHEAD_BYTES = 2048;

export type PrivateEvidenceProjectionReceipt = Readonly<{
  schema: typeof PRIVATE_EVIDENCE_PROJECTION_SCHEMA;
  kind: EvidenceKind;
  bytesPrivateOnly: Uint8Array;
  sha256: string;
  byteLength: number;
  originalArtifactSha256: string;
  originalArtifactByteLength: number;
  sourceAuthenticated: false;
  productionApproved: false;
  publicDeliveryAllowed: false;
}>;

function validKind(kind: EvidenceKind): void {
  if (kind !== "minute" && kind !== "research")
    throw new PrivateEvidenceRefusal("kind:unknown");
}
function validByteLength(bytes: Uint8Array, expected: number, limit: number, name: string): void {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 2 ||
      bytes.byteLength > limit || !Number.isSafeInteger(expected) ||
      expected !== bytes.byteLength)
    throw new PrivateEvidenceRefusal(name + ":invalid_length");
}

/**
 * Take one stable snapshot of the caller's input. Verify it through the existing
 * v0 semantic decoder before lifting the same snapshot into the v1 envelope.
 * The projection preserves every original non-clock field's lexical value.
 */
export function projectPrivateEvidence(args: {
  kind: EvidenceKind; bytes: Uint8Array; expectedSha256: string; expectedLength: number;
}): PrivateEvidenceProjectionReceipt {
  const { kind, bytes, expectedSha256, expectedLength } = args;
  validKind(kind);
  validByteLength(bytes, expectedLength, MAX_LENGTH[kind], "source_bytes");
  const snapshot = Buffer.from(bytes);
  decodePrivateEvidence({ kind, bytes: snapshot, expectedSha256, expectedLength });
  const { schema, ...observation } = liftKnownTopLevelClocks(snapshot, kind);
  const document = {
    schema: PRIVATE_EVIDENCE_PROJECTION_SCHEMA,
    kind,
    timestamp_encoding: "UNSIGNED_DECIMAL_STRING_NS",
    temporal_role: "ORIGINAL_FROZEN_OBSERVATION",
    original_artifact: { schema, sha256: expectedSha256, byte_length: expectedLength },
    observation,
    source_authenticated: false,
    production_approved: false,
    public_delivery_allowed: false,
    rank_trade_alert_authority: false,
  };
  const packed = Buffer.from(canonical(document) + "\n", "utf8");
  validByteLength(packed, packed.byteLength, MAX_LENGTH[kind] + PROJECTION_OVERHEAD_BYTES,
    "projection_bytes");
  return Object.freeze({
    schema: PRIVATE_EVIDENCE_PROJECTION_SCHEMA,
    kind, bytesPrivateOnly: packed,
    sha256: createHash("sha256").update(packed).digest("hex"),
    byteLength: packed.byteLength,
    originalArtifactSha256: expectedSha256,
    originalArtifactByteLength: expectedLength,
    sourceAuthenticated: false,
    productionApproved: false,
    publicDeliveryAllowed: false,
  });
}

/**
 * Both expected receipts MUST come from the caller's independently admitted
 * private manifest/custody path. Never promote a digest declared by the
 * envelope into its own trust anchor. SHA-256 integrity is not vendor identity,
 * entitlement, live capture completeness, public delivery or trading authority.
 */
export function decodePrivateEvidenceProjection(args: {
  kind: EvidenceKind;
  bytes: Uint8Array;
  expectedProjectionSha256: string;
  expectedProjectionLength: number;
  expectedOriginalSha256: string;
  expectedOriginalLength: number;
}): PrivateEvidence & {
  projectionSchema: typeof PRIVATE_EVIDENCE_PROJECTION_SCHEMA;
  projectionByteSha256: string;
  originalByteLength: number;
  temporalRole: "ORIGINAL_FROZEN_OBSERVATION";
} {
  const { kind, bytes, expectedProjectionSha256, expectedProjectionLength,
    expectedOriginalSha256, expectedOriginalLength } = args;
  validKind(kind);
  validByteLength(bytes, expectedProjectionLength,
    MAX_LENGTH[kind] + PROJECTION_OVERHEAD_BYTES, "projection_bytes");
  assertHash(expectedProjectionSha256, "expectedProjectionSha256");
  assertHash(expectedOriginalSha256, "expectedOriginalSha256");
  if (!Number.isSafeInteger(expectedOriginalLength) || expectedOriginalLength < 2 ||
      expectedOriginalLength > MAX_LENGTH[kind])
    throw new PrivateEvidenceRefusal("original_artifact:invalid_length");
  const snapshot = Buffer.from(bytes);
  const projectionHash = createHash("sha256").update(snapshot).digest("hex");
  if (projectionHash !== expectedProjectionSha256)
    throw new PrivateEvidenceRefusal("projection_bytes:hash_mismatch");
  const raw = snapshot.toString("utf8");
  if (!Buffer.from(raw, "utf8").equals(snapshot) || /[^\x09\x0a\x0d\x20-\x7e]/.test(raw))
    throw new PrivateEvidenceRefusal("projection_bytes:not_canonical_ascii");
  if (!raw.startsWith("{") || !raw.endsWith("}\n"))
    throw new PrivateEvidenceRefusal("projection_bytes:not_canonical_json");
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { throw new PrivateEvidenceRefusal("projection_bytes:malformed_json"); }
  const document = record(parsed, "projection_root");
  if (canonical(document) + "\n" !== raw)
    throw new PrivateEvidenceRefusal("projection_bytes:noncanonical");
  assertKeys(document, PROJECTION_FIELDS, "projection");
  if (document.schema !== PRIVATE_EVIDENCE_PROJECTION_SCHEMA ||
      document.kind !== kind || document.timestamp_encoding !== "UNSIGNED_DECIMAL_STRING_NS" ||
      document.temporal_role !== "ORIGINAL_FROZEN_OBSERVATION")
    throw new PrivateEvidenceRefusal("projection:schema_or_temporal_role");
  if (document.source_authenticated !== false || document.production_approved !== false ||
      document.public_delivery_allowed !== false || document.rank_trade_alert_authority !== false)
    throw new PrivateEvidenceRefusal("projection:false_authority");
  const original = record(document.original_artifact, "original_artifact");
  assertKeys(original, ["schema", "sha256", "byte_length"], "original_artifact");
  if (original.schema !== ORIGINAL_SCHEMAS[kind] ||
      original.sha256 !== expectedOriginalSha256 ||
      original.byte_length !== expectedOriginalLength)
    throw new PrivateEvidenceRefusal("original_artifact:receipt_mismatch");
  const observation = record(document.observation, "observation");
  assertKeys(observation, TOP_FIELDS[kind].filter(field => field !== "schema"), "observation");

  // Structured restoration touches ONLY the static approved top-level clock
  // fields. No global regex, arbitrary *_ns coercion or monetary reformatting.
  const restored: RecordValue = { ...observation, schema: ORIGINAL_SCHEMAS[kind] };
  const originalJson = "{" + Object.keys(restored).sort().map(field => {
    const value = restored[field];
    let encoded: string;
    if (NS_FIELDS[kind].includes(field)) {
      assertClock(value, field);
      encoded = value as string;
    } else encoded = canonical(value);
    return JSON.stringify(field) + ":" + encoded;
  }).join(",") + "}\n";
  const evidence = decodePrivateEvidence({
    kind, bytes: Buffer.from(originalJson, "utf8"),
    expectedSha256: expectedOriginalSha256, expectedLength: expectedOriginalLength,
  });
  return {
    ...evidence,
    projectionSchema: PRIVATE_EVIDENCE_PROJECTION_SCHEMA,
    projectionByteSha256: projectionHash,
    originalByteLength: expectedOriginalLength,
    temporalRole: "ORIGINAL_FROZEN_OBSERVATION",
  };
}
