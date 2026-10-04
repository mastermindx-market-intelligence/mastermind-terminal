/**
 * optionsAlphaCandidateFeed.ts — typed view of the verified Options Alpha
 * candidate feed (formed_candidates-v2) plus its publication receipt.
 *
 * The server-only verifier (lib/optionsAlphaCandidatePair.ts) is authoritative
 * for schema and raw-byte binding. This module normalizes the verified payload
 * into absent-safe types — direction, orientation, profit, OOS/BH promotion, or
 * ranking must never be inferred here.
 */

export const OPTIONS_ALPHA_CANDIDATE_FEED_SCHEMA = "options.alpha_candidate_feed/v2";
export const OPTIONS_ALPHA_CANDIDATE_RECEIPT_SCHEMA = "options.alpha_candidate_feed_publication_receipt/v1";
export const OPTIONS_ALPHA_CANDIDATE_FENCE_STATES = [
  "pre_policy_freeze",
  "post_policy_freeze_pre_activation",
  "post_activation",
] as const;
export const OPTIONS_ALPHA_CANDIDATE_ELIGIBILITY = [
  "synthetic_until_publisher_validates_activation",
  "preregistered_inactive_until_activation",
] as const;
export const OPTIONS_ALPHA_CANDIDATE_DISPOSITION = ["research_candidate", "abstain", "degraded"] as const;
export const OPTIONS_ALPHA_CANDIDATE_HORIZONS = ["h60", "eod", "1d", "3d", "5d", "10d"] as const;

export type OptionsAlphaCandidateFence = typeof OPTIONS_ALPHA_CANDIDATE_FENCE_STATES[number];
export type OptionsAlphaCandidateEligibility = typeof OPTIONS_ALPHA_CANDIDATE_ELIGIBILITY[number];
export type OptionsAlphaCandidateDisposition = (typeof OPTIONS_ALPHA_CANDIDATE_DISPOSITION)[number];
export type OptionsAlphaCandidateHorizon = (typeof OPTIONS_ALPHA_CANDIDATE_HORIZONS)[number];

export type OptionsAlphaCandidateOutcomeStatus = "available" | "pending" | "unavailable";

export interface OptionsAlphaCandidatePolicy {
  policy_id: string | null;
  policy_version: number | null;
  policy_digest_sha256: string | null;
  policy_path: string | null;
  policy_schema: string | null;
}

export interface OptionsAlphaCandidateActivation {
  activation_receipt_id: string | null;
  activation_receipt_digest_sha256: string | null;
  activation_preconditions: string[];
  all_preconditions_cleared: boolean;
  fence_state: OptionsAlphaCandidateFence;
  policy_freeze_at: string | null;
  activation_boundary_at: string | null;
}

export interface OptionsAlphaCandidateUnderlyingOutcome {
  status: "complete" | "unavailable";
  ret: number | null;
  mfe: number | null;
  mae: number | null;
}

export interface OptionsAlphaCandidateHorizonOutcome {
  state: OptionsAlphaCandidateOutcomeStatus;
  horizon: OptionsAlphaCandidateHorizon;
  status: string | null;
  reason: string | null;
  campaign_available_at: string | null;
  computed_at: string | null;
  target_time: string | null;
  matured_at: string | null;
  underlying: OptionsAlphaCandidateUnderlyingOutcome | null;
}

export interface OptionsAlphaCandidateDispositionEntry {
  state: OptionsAlphaCandidateDisposition;
  reasons: string[];
}

export interface OptionsAlphaCandidateCurrentRevision {
  campaign_revision_id: string | null;
  revision_number: number | null;
  formed_at: string | null;
}

export interface OptionsAlphaCandidateFrozenFormation {
  campaign_revision_id: string | null;
  formed_at: string | null;
  policy_id: string | null;
  policy_version: number | null;
  policy_digest_sha256: string | null;
  campaign_member_count: number | null;
  measured_nbbo_valid_print_count: number | null;
  measured_nbbo_premium_coverage: number | null;
}

export interface OptionsAlphaCandidateEvidenceDigests {
  campaign_row_digest_sha256: string | null;
  microstructure_row_digest_sha256: string | null;
  policy_digest_sha256: string | null;
}

export interface OptionsAlphaCandidateMeasureMicro {
  source_print_count: number | null;
  nbbo_valid_print_count: number | null;
  nbbo_premium_coverage: number | null;
  source_premium_usd: number | null;
  nbbo_covered_premium_usd: number | null;
  schema: string | null;
}

/**
 * Optional canonical campaign context attached to the FIRST qualifying campaign revision
 * (the immutable frozen formation). When absent, the candidate card must render an
 * explicit "context absent" message rather than synthesising identity. The renderer
 * MUST NEVER infer direction (bullish/bearish) from these fields — direction_reliability
 * is "soft" and opening/closing + accumulation/distribution are "unavailable".
 */
export interface OptionsAlphaCandidateCampaignContext {
  schema: "options.alpha_candidate_campaign_context/v1";
  campaign_revision_id: string;
  group: {
    session_date: string;
    ticker: string;
    right: "C" | "P";
    expiration: string;
    strike: number;
    strike_key: string;
  };
  flow_side_counts: {
    "~buy": number;
    "~sell": number;
    mixed: number;
  };
  intent: {
    opening_closing: "unavailable";
    direction_reliability: "soft";
    accumulation_distribution: "unavailable";
  };
}

export interface OptionsAlphaCandidateItem {
  candidate_id: string;
  campaign_id: string;
  first_qualifying_campaign_revision_id: string;
  current_campaign_revision_id: string;
  source_formed_at: string | null;
  first_observed_at: string | null;
  decision_at: string | null;
  state: OptionsAlphaCandidateDisposition;
  reasons: string[];
  frozen_formation: OptionsAlphaCandidateFrozenFormation;
  current_revision: OptionsAlphaCandidateCurrentRevision | null;
  current_disposition: OptionsAlphaCandidateDispositionEntry;
  measured: OptionsAlphaCandidateMeasureMicro | null;
  evidence_digests: OptionsAlphaCandidateEvidenceDigests;
  missingness: string[];
  contradictions: string[];
  post_formation_outcomes: Record<OptionsAlphaCandidateHorizon, OptionsAlphaCandidateHorizonOutcome> | null;
  campaign_context: OptionsAlphaCandidateCampaignContext | null;
}

export interface OptionsAlphaCandidateAbstention {
  campaign_id: string;
  campaign_revision_id: string;
  formed_at: string | null;
  first_observed_at: string | null;
  reasons: string[];
  state: "abstain";
}

export interface OptionsAlphaCandidateReceiptEntry {
  first_receipt_id: string | null;
  first_consumer_published_at: string | null;
}

export interface OptionsAlphaCandidateFeedView {
  feed_id: string | null;
  schema: string | null;
  schema_version: number | null;
  generated_at: string | null;
  policy: OptionsAlphaCandidatePolicy;
  activation: OptionsAlphaCandidateActivation;
  eligibility_state: OptionsAlphaCandidateEligibility | null;
  implementation_carrier: string | null;
  deterministic_seed: string | null;
  formed_candidates: OptionsAlphaCandidateItem[];
  abstentions: OptionsAlphaCandidateAbstention[];
}

export interface OptionsAlphaCandidateReceiptView {
  receipt_id: string | null;
  feed_id: string | null;
  feed_schema: string | null;
  payload_sha256: string | null;
  payload_bytes: number | null;
  local_durability_confirmed_at: string | null;
  payload_r2_confirmed_at: string | null;
  prior_receipt_id: string | null;
  r2_payload_key: string | null;
  r2_etag: string | null;
  candidates: Record<string, OptionsAlphaCandidateReceiptEntry>;
}

export interface OptionsAlphaCandidateMetadata {
  payload_etag: string | null;
  payload_last_modified: string | null;
  receipt_etag: string | null;
  receipt_last_modified: string | null;
  served_at: string | null;
}

export interface OptionsAlphaCandidateFeedSource {
  feed: OptionsAlphaCandidateFeedView;
  receipt: OptionsAlphaCandidateReceiptView;
  metadata: OptionsAlphaCandidateMetadata;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Number.isInteger(value) ? value : null;
}

function asNonnegativeInteger(value: unknown): number | null {
  const n = asInteger(value);
  return n !== null && n >= 0 ? n : null;
}

function asArray<T>(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asEligibility(value: unknown): OptionsAlphaSelector {
  if (value === "synthetic_until_publisher_validates_activation") return value;
  if (value === "preregistered_inactive_until_activation") return value;
  return null;
}

type OptionsAlphaSelector = OptionsAlphaCandidateEligibility | null;

function asFence(value: unknown): OptionsAlphaCandidateFence {
  if (value === "pre_policy_freeze") return "pre_policy_freeze";
  if (value === "post_policy_freeze_pre_activation") return "post_policy_freeze_pre_activation";
  if (value === "post_activation") return "post_activation";
  return "pre_policy_freeze";
}

function asDisposition(value: unknown): OptionsAlphaCandidateDisposition {
  if (value === "research_candidate") return "research_candidate";
  if (value === "abstain") return "abstain";
  if (value === "degraded") return "degraded";
  return "research_candidate";
}

function asOutcomeStatus(value: unknown): OptionsAlphaCandidateOutcomeStatus {
  if (value === "available") return "available";
  if (value === "pending") return "pending";
  if (value === "unavailable") return "unavailable";
  return "unavailable";
}

function asUnderlying(value: unknown): OptionsAlphaCandidateUnderlyingOutcome | null {
  const obj = asObject(value);
  if (!Object.keys(obj).length) return null;
  const status = obj.status === "complete" ? "complete" : obj.status === "unavailable" ? "unavailable" : "unavailable";
  return {
    status,
    ret: asNumber(obj.ret),
    mfe: asNumber(obj.mfe),
    mae: asNumber(obj.mae),
  };
}

function asHorizon(value: unknown): OptionsAlphaCandidateHorizon {
  if (typeof value !== "string") return "1d";
  return (OPTIONS_ALPHA_CANDIDATE_HORIZONS as readonly string[]).includes(value)
    ? (value as OptionsAlphaCandidateHorizon)
    : "1d";
}

function asHorizonOutcome(value: unknown): OptionsAlphaCandidateHorizonOutcome {
  const obj = asObject(value);
  return {
    state: asOutcomeStatus(obj.state),
    horizon: asHorizon(obj.horizon),
    status: asString(obj.status),
    reason: asString(obj.reason),
    campaign_available_at: asString(obj.campaign_available_at),
    computed_at: asString(obj.computed_at),
    target_time: asString(obj.target_time),
    matured_at: asString(obj.matured_at),
    underlying: asUnderlying(obj.underlying),
  };
}

function asMeasureMicro(value: unknown): OptionsAlphaCandidateMeasureMicro | null {
  const obj = asObject(value);
  if (!Object.keys(obj).length) return null;
  return {
    source_print_count: asInteger(obj.source_print_count),
    nbbo_valid_print_count: asInteger(obj.nbbo_valid_print_count),
    nbbo_premium_coverage: asNumber(obj.nbbo_premium_coverage),
    source_premium_usd: asNumber(obj.source_premium_usd),
    nbbo_covered_premium_usd: asNumber(obj.nbbo_covered_premium_usd),
    schema: asString(obj.schema),
  };
}

function asFrozenFormation(value: unknown): OptionsAlphaCandidateFrozenFormation {
  const obj = asObject(value);
  return {
    campaign_revision_id: asString(obj.campaign_revision_id),
    formed_at: asString(obj.formed_at),
    policy_id: asString(obj.policy_id),
    policy_version: asInteger(obj.policy_version),
    policy_digest_sha256: asString(obj.policy_digest_sha256),
    campaign_member_count: asInteger(obj.campaign_member_count),
    measured_nbbo_valid_print_count: asInteger(obj.measured_nbbo_valid_print_count),
    measured_nbbo_premium_coverage: asNumber(obj.measured_nbbo_premium_coverage),
  };
}

function asCurrentRevision(value: unknown): OptionsAlphaCandidateCurrentRevision | null {
  if (value === null || value === undefined) return null;
  const obj = asObject(value);
  if (!Object.keys(obj).length) return null;
  return {
    campaign_revision_id: asString(obj.campaign_revision_id),
    revision_number: asInteger(obj.revision_number),
    formed_at: asString(obj.formed_at),
  };
}

function asDispositionEntry(value: unknown): OptionsAlphaCandidateDispositionEntry {
  const obj = asObject(value);
  const reasons = asArray(obj.reasons).filter((entry): entry is string => typeof entry === "string");
  return {
    state: asDisposition(obj.state),
    reasons: Array.from(new Set(reasons)),
  };
}

function asEvidenceDigests(value: unknown): OptionsAlphaCandidateEvidenceDigests {
  const obj = asObject(value);
  return {
    campaign_row_digest_sha256: asString(obj.campaign_row_digest_sha256),
    microstructure_row_digest_sha256: asString(obj.microstructure_row_digest_sha256),
    policy_digest_sha256: asString(obj.policy_digest_sha256),
  };
}

function asPostFormationOutcomes(value: unknown): Record<OptionsAlphaCandidateHorizon, OptionsAlphaCandidateHorizonOutcome> | null {
  const obj = asObject(value);
  if (!Object.keys(obj).length) return null;
  const horizons = asObject(obj.horizons);
  return {
    h60: asHorizonOutcome(horizons.h60),
    eod: asHorizonOutcome(horizons.eod),
    "1d": asHorizonOutcome(horizons["1d"]),
    "3d": asHorizonOutcome(horizons["3d"]),
    "5d": asHorizonOutcome(horizons["5d"]),
    "10d": asHorizonOutcome(horizons["10d"]),
  };
}

const CAMPAIGN_REVISION_ID = /^ocrev_[a-f0-9]{24}$/;
const CAMPAIGN_TICKER = /^[A-Z0-9.^=-]+$/;
const CAMPAIGN_STRIKE_KEY = /^(0|[1-9][0-9]*)(\.[0-9]*[1-9])?$/;
const CAMPAIGN_DATE = /^\d{4}-\d{2}-\d{2}$/;

function asCampaignContext(value: unknown, firstQualifyingRevisionId: string): OptionsAlphaCandidateCampaignContext | null {
  if (value === null || value === undefined) return null;
  const obj = asObject(value);
  if (!Object.keys(obj).length) return null;
  if (obj.schema !== "options.alpha_candidate_campaign_context/v1") return null;
  const revisionId = asString(obj.campaign_revision_id);
  if (!revisionId || !CAMPAIGN_REVISION_ID.test(revisionId) || revisionId !== firstQualifyingRevisionId) return null;
  const group = asObject(obj.group);
  const sessionDate = asString(group.session_date);
  const ticker = asString(group.ticker);
  const right = group.right === "C" || group.right === "P" ? group.right : null;
  const expiration = asString(group.expiration);
  const strike = typeof group.strike === "number" && Number.isFinite(group.strike) && group.strike >= 0 ? group.strike : null;
  const strikeKey = asString(group.strike_key);
  if (!sessionDate || !CAMPAIGN_DATE.test(sessionDate)) return null;
  if (!ticker || !CAMPAIGN_TICKER.test(ticker)) return null;
  if (!right) return null;
  if (!expiration || !CAMPAIGN_DATE.test(expiration)) return null;
  if (strike === null) return null;
  if (!strikeKey || !CAMPAIGN_STRIKE_KEY.test(strikeKey)) return null;
  const flow = asObject(obj.flow_side_counts);
  if (!Object.prototype.hasOwnProperty.call(flow, "~buy") || !Object.prototype.hasOwnProperty.call(flow, "~sell") || !Object.prototype.hasOwnProperty.call(flow, "mixed")) return null;
  const buy = asNonnegativeInteger(flow["~buy"]);
  const sell = asNonnegativeInteger(flow["~sell"]);
  const mixed = asNonnegativeInteger(flow.mixed);
  if (buy === null || sell === null || mixed === null) return null;
  const intent = asObject(obj.intent);
  if (intent.opening_closing !== "unavailable" || intent.direction_reliability !== "soft" || intent.accumulation_distribution !== "unavailable") return null;
  return {
    schema: "options.alpha_candidate_campaign_context/v1",
    campaign_revision_id: revisionId,
    group: {
      session_date: sessionDate,
      ticker,
      right,
      expiration,
      strike,
      strike_key: strikeKey,
    },
    flow_side_counts: {
      "~buy": buy,
      "~sell": sell,
      mixed,
    },
    intent: {
      opening_closing: "unavailable",
      direction_reliability: "soft",
      accumulation_distribution: "unavailable",
    },
  };
}

function asCandidateItem(value: unknown): OptionsAlphaCandidateItem | null {
  const obj = asObject(value);
  const candidateId = asString(obj.candidate_id);
  const campaignId = asString(obj.campaign_id);
  const firstQualifying = asString(obj.first_qualifying_campaign_revision_id);
  const currentRevisionId = asString(obj.current_campaign_revision_id);
  if (!candidateId || !campaignId || !firstQualifying || !currentRevisionId) return null;
  return {
    candidate_id: candidateId,
    campaign_id: campaignId,
    first_qualifying_campaign_revision_id: firstQualifying,
    current_campaign_revision_id: currentRevisionId,
    source_formed_at: asString(obj.source_formed_at),
    first_observed_at: asString(obj.first_observed_at),
    decision_at: asString(obj.decision_at),
    state: asDisposition(obj.state),
    reasons: asArray(obj.reasons).filter((entry): entry is string => typeof entry === "string"),
    frozen_formation: asFrozenFormation(obj.frozen_formation),
    current_revision: asCurrentRevision(obj.current_revision),
    current_disposition: asDispositionEntry(obj.current_disposition),
    measured: asMeasureMicro(obj.measured),
    evidence_digests: asEvidenceDigests(obj.evidence_digests),
    missingness: asArray(obj.missingness).filter((entry): entry is string => typeof entry === "string"),
    contradictions: asArray(obj.contradictions).filter((entry): entry is string => typeof entry === "string"),
    post_formation_outcomes: asPostFormationOutcomes(obj.post_formation_outcomes),
    campaign_context: asCampaignContext(obj.campaign_context, firstQualifying),
  };
}

function asAbstention(value: unknown): OptionsAlphaCandidateAbstention | null {
  const obj = asObject(value);
  const campaignId = asString(obj.campaign_id);
  const revisionId = asString(obj.campaign_revision_id);
  if (!campaignId || !revisionId) return null;
  return {
    campaign_id: campaignId,
    campaign_revision_id: revisionId,
    formed_at: asString(obj.formed_at),
    first_observed_at: asString(obj.first_observed_at),
    reasons: asArray(obj.reasons).filter((entry): entry is string => typeof entry === "string"),
    state: "abstain",
  };
}

function asPolicy(value: unknown): OptionsAlphaCandidatePolicy {
  const obj = asObject(value);
  return {
    policy_id: asString(obj.policy_id),
    policy_version: asInteger(obj.policy_version),
    policy_digest_sha256: asString(obj.policy_digest_sha256),
    policy_path: asString(obj.policy_path),
    policy_schema: asString(obj.policy_schema),
  };
}

function asActivation(value: unknown): OptionsAlphaCandidateActivation {
  const obj = asObject(value);
  return {
    activation_receipt_id: asString(obj.activation_receipt_id),
    activation_receipt_digest_sha256: asString(obj.activation_receipt_digest_sha256),
    activation_preconditions: asArray(obj.activation_preconditions).filter((entry): entry is string => typeof entry === "string"),
    all_preconditions_cleared: obj.all_preconditions_cleared === true,
    fence_state: asFence(obj.fence_state),
    policy_freeze_at: asString(obj.policy_freeze_at),
    activation_boundary_at: asString(obj.activation_boundary_at),
  };
}

function asReceiptEntry(value: unknown): OptionsAlphaCandidateReceiptEntry {
  const obj = asObject(value);
  return {
    first_receipt_id: asString(obj.first_receipt_id),
    first_consumer_published_at: asString(obj.first_consumer_published_at),
  };
}

function asReceipt(value: unknown): OptionsAlphaCandidateReceiptView {
  const obj = asObject(value);
  const r2 = asObject(obj.r2);
  const prior = asObject(obj.prior_receipt);
  const candidates: Record<string, OptionsAlphaCandidateReceiptEntry> = {};
  for (const [id, entry] of Object.entries(asObject(obj.candidates))) {
    candidates[id] = asReceiptEntry(entry);
  }
  return {
    receipt_id: asString(obj.receipt_id),
    feed_id: asString(obj.feed_id),
    feed_schema: asString(obj.feed_schema),
    payload_sha256: asString(obj.payload_sha256),
    payload_bytes: asInteger(obj.payload_bytes),
    local_durability_confirmed_at: asString(obj.local_durability_confirmed_at),
    payload_r2_confirmed_at: asString(obj.payload_r2_confirmed_at),
    prior_receipt_id: asString(prior.receipt_id),
    r2_payload_key: asString(r2.payload_key),
    r2_etag: asString(r2.etag),
    candidates,
  };
}

function asMetadata(value: unknown): OptionsAlphaCandidateMetadata {
  const obj = asObject(value);
  return {
    payload_etag: asString(obj.payload_etag),
    payload_last_modified: asString(obj.payload_last_modified),
    receipt_etag: asString(obj.receipt_etag),
    receipt_last_modified: asString(obj.receipt_last_modified),
    served_at: asString(obj.served_at),
  };
}

/**
 * Minimum response-shape check before display. The verifier on the server
 * already proves the strict schemas; this guard ensures an unrelated payload
 * (e.g. an auth error envelope) does not render as candidate content.
 */
export function isCandidateFeedResponse(value: unknown): value is OptionsAlphaCandidateFeedSource {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  const feed = obj.feed as Record<string, unknown> | undefined;
  const receipt = obj.receipt as Record<string, unknown> | undefined;
  const metadata = obj.metadata as Record<string, unknown> | undefined;
  return Boolean(
    feed &&
    typeof feed === "object" &&
    typeof feed.feed_id === "string" &&
    feed.schema === OPTIONS_ALPHA_CANDIDATE_FEED_SCHEMA &&
    Array.isArray(feed.formed_candidates) &&
    Array.isArray(feed.abstentions) &&
    receipt &&
    typeof receipt === "object" &&
    receipt.schema === OPTIONS_ALPHA_CANDIDATE_RECEIPT_SCHEMA &&
    typeof receipt.receipt_id === "string" &&
    metadata &&
    typeof metadata === "object",
  );
}

/**
 * Normalize a verified payload into the typed view consumed by the panel.
 * Returns null if the response shape is not a feed envelope (the verifier
 * guarantees strict schemas server-side, so the strict cast is safe).
 */
export function normalizeCandidateFeed(value: unknown): OptionsAlphaCandidateFeedSource | null {
  if (!isCandidateFeedResponse(value)) return null;
  const obj = value as OptionsAlphaCandidateFeedSource;
  const feedRaw = obj.feed as unknown as Record<string, unknown>;
  const header = asObject(feedRaw.header);
  const feed: OptionsAlphaCandidateFeedView = {
    feed_id: asString(feedRaw.feed_id),
    schema: asString(feedRaw.schema),
    schema_version: asInteger(feedRaw.schema_version),
    generated_at: asString(feedRaw.generated_at),
    policy: asPolicy(feedRaw.policy),
    activation: asActivation(feedRaw.activation),
    eligibility_state: asEligibility(header.eligibility_state),
    implementation_carrier: asString(header.implementation_carrier),
    deterministic_seed: asString(header.deterministic_seed),
    formed_candidates: asArray(feedRaw.formed_candidates).map(asCandidateItem).filter((item): item is OptionsAlphaCandidateItem => item !== null),
    abstentions: asArray(feedRaw.abstentions).map(asAbstention).filter((item): item is OptionsAlphaCandidateAbstention => item !== null),
  };
  return {
    feed,
    receipt: asReceipt(obj.receipt),
    metadata: asMetadata(obj.metadata),
  };
}