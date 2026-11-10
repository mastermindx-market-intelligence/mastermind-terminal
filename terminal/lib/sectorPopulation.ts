/**
 * Sector population member list (COO order 2, 2026-11-10) — the ONE fetch + decoder
 * module for lane 1's population route (`GET /api/sector-generation/population`).
 *
 * Laws encoded here (lane 1 wire v1.1 + COO 11:40Z/12:06Z/12:55Z):
 *   - Only `audience=entitled` exists. The BFF forces it; this client never sends it.
 *   - `industry` (GICS) and `sub_industry` are TWO separate current-basis fields,
 *     never merged, never point-in-time, each with its own unavailable reason.
 *   - Unserved members are accounted-but-unmeasured: visible, labelled with a closed
 *     reason, never hidden from counts. Removed members never render as gaps.
 *   - `complete` is never proof of "all members": R3-S1 can drop a whole basket with
 *     no refusal row while complete reads true. Only counts (served of configured)
 *     are shown; nothing stronger is derivable here.
 *   - A refused group (owner refused observation) is shown as refused by the owner:
 *     members unmeasured, never missing. `group_index` entries carry no
 *     `refused_by_owner` at wire head 595fe6b7 — read it when present, else the
 *     three-part test (name null AND n_members_listed 0 AND n_unserved == configured).
 *   - 401 is the only sign-in state. 503 (identity-not-verified, >500 unserved,
 *     owner down) is a RETRY state; a retry never prompts sign-in.
 *   - 409 CURSOR_RESET restarts page one. 400 REQUEST_INVALID on a server-given
 *     cursor is treated as a reset until lane 1's grammar fix lands (COO order 2).
 *   - Lane 1 point-in-time facts (item 5, Macro #10965 §2b): membership_snapshot,
 *     roster_clock, membership_first_known and taxonomy_revision are WHOLE-fact
 *     tolerant reads — absent, unavailable, unknown reason or wrong type degrades
 *     to the fact's own unavailable state, never a refused page, never zero.
 *     roster_clock non-agree forces the completeness figures not stated here.
 *
 * The decoder is a closed admission: anything outside the wire contract is null and
 * the surface renders unavailable — never a partial read, never invented members.
 */
import { bounded } from "./sectorNativeGeneration";

export const SECTOR_POPULATION_URL = "/api/sector-intelligence?source=population";

/** Wire grammar (lane 1 v1.1): tokens, group ids, symbols, query strings. */
export const POPULATION_TOKEN = /^[A-Za-z0-9_.-]{1,1024}$/;
export const POPULATION_GROUP_ID = /^[a-z][a-z0-9_-]{0,79}$/;
export const POPULATION_SYMBOL = /^[A-Z][A-Z0-9.-]{0,31}$/;
export const POPULATION_QUERY = /^[\w .&'-]{1,64}$/;
export const POPULATION_MIN_LIMIT = 1;
export const POPULATION_MAX_LIMIT = 200;
export const POPULATION_DEFAULT_LIMIT = 100;

/** Closed unserved-reason catalogue (wire v1.1 after `empty_price_tape` removal). */
export const POPULATION_UNSERVED_REASONS = [
  "absent_from_price_panel",
  "not_observed_at_effective_as_of",
  "group_refused_by_owner_observation",
  "unaccounted_by_owner",
] as const;
export type PopulationUnservedReason = (typeof POPULATION_UNSERVED_REASONS)[number];
export const isPopulationUnservedReason = (value: string): value is PopulationUnservedReason =>
  (POPULATION_UNSERVED_REASONS as readonly string[]).includes(value);

const HASH = /^[0-9a-f]{64}$/;
const TOKEN128 = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const int = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
const str = (value: unknown, max = 262144): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max;
const strOrNull = (value: unknown, max = 262144): value is string | null =>
  value === null || str(value, max);
const bool = (value: unknown): value is boolean => typeof value === "boolean";

function day(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-")) return false;
  const time = new Date(value + "T00:00:00Z");
  return Number.isFinite(time.getTime()) && time.toISOString().slice(0, 10) === value;
}
function clock(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 32) return false;
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.exec(value);
  return !!match && day(match[1]) && +match[2] < 24 && +match[3] < 60
    && (!match[4] || +match[4] < 60) && Number.isFinite(Date.parse(value));
}
/** Closed object admission: every required key present, no key outside required+optional. */
function closed(value: unknown, required: string[], optional: string[] = []): value is Record<string, unknown> {
  if (!record(value)) return false;
  const names = Object.keys(value);
  return required.every(key => Object.hasOwn(value, key))
    && names.every(key => required.includes(key) || optional.includes(key));
}

/** A taxonomy field: available with its label(s), or unavailable with a closed reason. */
export type PopulationTaxonomy =
  | { status: "available"; label: string; labelZh?: string; key?: string; sector?: string }
  | { status: "unavailable"; reason: string };
export type PopulationMembership = { status: "listed"; effectiveOn: string | null };
export type PopulationRow = {
  ordinal: number; groupId: string; symbol: string; name: string;
  membership: PopulationMembership; alsoInGroups: number; inHandoffMemberSet: boolean | null;
  industry: PopulationTaxonomy; subIndustry: PopulationTaxonomy;
  prophetEligibility: { status: string; reason?: string };
  visibilityScope: string;
};
/** Capture-level unserved entry: `{group_id,symbol,reason}` (§2 population). */
export type PopulationUnservedEntry = { groupId: string; symbol: string; reason: PopulationUnservedReason };
/** GROUP-descriptor unserved entry: `{symbol,reason}` — the group is implicit (§1). */
export type PopulationGroupUnservedEntry = { symbol: string; reason: PopulationUnservedReason };
export type PopulationAction =
  | { status: "available"; lane: string; reco: string; label: string; score: number }
  | { status: "unavailable"; reason: string };
export type PopulationGroupDescriptor = {
  groupId: string; kind: "basket"; name: string | null; nameZh: string | null;
  category: string | null; weighting: string | null;
  configuredCurrent: number | null; membersListed: number; unserved: number;
  refusedByOwner: boolean; ownerObservationRefusal: Record<string, unknown> | null;
  membershipCoverage: Record<string, unknown>;
  action: PopulationAction; nativeSectorRef: Record<string, unknown>;
  unservedMembers: PopulationGroupUnservedEntry[];
};
export type PopulationGroupIndexEntry = {
  groupId: string; name: string | null; membersListed: number;
  configuredCurrent: number | null; unserved: number;
  /** Optional zh twin of `name` (COO 19:15Z item 6): null when absent or stated
   * null — the zh picker then falls back exactly as before, never the raw id. */
  nameZh: string | null;
  refusedByOwner: boolean; /** explicit when the wire carries it, else the three-part test */
  refusedExplicit: boolean;
};
export type PopulationRemovedMembers = {
  status: "available"; n: number; source: string; version: string; asOf: string;
  members: { groupId: string; symbol: string; removedOn: string }[];
} | { status: "unavailable"; reason: string };
/** Lane 1 point-in-time facts (COO 19:15Z item 5, Macro #10965 §2b). Each is a
 * WHOLE-fact tolerant read: absent, owner-unavailable, unknown reason or wrong
 * type degrades to the fact's own unavailable state — the page is never
 * refused and a number is never invented. */
export type PopulationSnapshotEntry =
  | { status: "available"; snapshotDate: string; membersSha: string | null;
      memberCount: number; equalsCurrentRoster: boolean | null }
  | { status: "unavailable" };
export type PopulationMembershipSnapshot =
  | { carried: false }
  | { carried: true; status: "available"; asOf: string; groups: Record<string, PopulationSnapshotEntry> }
  | { carried: true; status: "unavailable" };
/** `membership_first_known`: per (group, symbol) a LOWER-BOUND snapshot date —
 * null means NO stored snapshot holds the pair, never "not a member". */
export type PopulationFirstKnown =
  | { carried: false }
  | { carried: true; status: "available"; groups: Record<string, Record<string, string | null>> }
  | { carried: true; status: "unavailable" };
/** `roster_clock`: null when the wire carries no clock (today); any carried
 * non-agree — mismatch, unavailable or malformed — reads not_agree, and the
 * surface must treat the completeness figures as not stated. */
export type PopulationRosterClock = { status: "agree" } | { status: "not_agree" };
/** `taxonomy_revision`: the one statement lane 1 makes today is that the
 * classification labels are current-basis, not point-in-time. */
export type PopulationTaxonomyRevision = { currentNotPointInTime: boolean };
/** Counts only — never a completeness claim. `configuredCurrent`/`complete` are
 * null when the capture has no readable roster (F1): null means UNKNOWN — render
 * "not stated", never zero and never complete. `unaccounted` is null when the
 * #10965 producer withholds it beside a non-agree clock (B-1). `countsStated`
 * is the one stated rule (B-1/N-4, third review): counts are stated only when
 * the roster clock agrees with equal clocks AND `unaccounted` is an integer —
 * or on the pre-#10965 wire that carries no clock at all, unchanged. */
export type PopulationCounts = {
  configuredCurrent: number | null; served: number; accountedUnserved: number; unaccounted: number | null;
  countsStated: boolean;
  complete: boolean | null; groups: number; unservedMembers: PopulationUnservedEntry[];
  removedMembers: PopulationRemovedMembers | null;
};
export type PopulationOwnerRef = {
  owner: string; contract: string; populationSchema: string; basisVersion: string; domain: string;
  generationId: string; contentId: string; consumerContentSha256: string;
  memberSha256: Record<string, string>; retainedResolverRef: string | null;
  retainedResolverRefDurability: "durable" | "process_lifetime_only";
};
export type PopulationPage = {
  sourceSession: string; publishedAt: string; qualification: string;
  ownerRef: PopulationOwnerRef; counts: PopulationCounts;
  filter: { group: string | null; q: string | null };
  limit: number; offset: number; totalMatching: number; complete: boolean;
  rows: PopulationRow[]; groups: PopulationGroupDescriptor[];
  groupIndex: PopulationGroupIndexEntry[] | null;
  unservedMatching: PopulationUnservedEntry[] | null;
  nextCursor: string | null; contextRef: string;
  /** Lane 1 point-in-time facts (item 5) — tolerant whole-fact reads. */
  membershipSnapshot: PopulationMembershipSnapshot;
  firstKnown: PopulationFirstKnown;
  rosterClock: PopulationRosterClock | null;
  taxonomyRevision: PopulationTaxonomyRevision;
};

function taxonomy(value: unknown, withKeys: boolean): PopulationTaxonomy | null {
  if (closed(value, ["status", "label"], withKeys ? ["key", "label_zh", "sector"] : ["label_zh", "key", "sector"])) {
    if (!str(value.label, 200)) return null;
    const out: PopulationTaxonomy = { status: "available", label: value.label };
    if (withKeys) {
      if (!str(value.key, 200) || !str(value.label_zh ?? "", 200) || !str(value.sector ?? "", 200)) return null;
      out.key = value.key; out.labelZh = value.label_zh as string; out.sector = value.sector as string;
    } else if (str(value.label_zh, 200)) {
      // N-B (r2): the industry form's zh twin rides the row when the wire
      // carries it — it was admitted here and then dropped before.
      out.labelZh = value.label_zh;
    }
    return out;
  }
  if (closed(value, ["status", "reason"]) && value.status === "unavailable" && str(value.reason, 200)) {
    return { status: "unavailable", reason: value.reason };
  }
  return null;
}

function unservedEntry(value: unknown): PopulationUnservedEntry | null {
  if (!closed(value, ["group_id", "symbol", "reason"])) return null;
  if (typeof value.group_id !== "string" || !POPULATION_GROUP_ID.test(value.group_id)) return null;
  if (typeof value.symbol !== "string" || !POPULATION_SYMBOL.test(value.symbol)) return null;
  if (typeof value.reason !== "string" || !isPopulationUnservedReason(value.reason)) return null;
  return { groupId: value.group_id, symbol: value.symbol, reason: value.reason };
}

/** GROUP-descriptor unserved (§1): `{symbol,reason}` — the group is implicit.
 * The capture-level 3-key entry is NOT this shape; admitting it here would let a
 * refused basket's page read as invalid. */
function groupUnservedEntry(value: unknown): PopulationGroupUnservedEntry | null {
  if (!closed(value, ["symbol", "reason"])) return null;
  if (typeof value.symbol !== "string" || !POPULATION_SYMBOL.test(value.symbol)) return null;
  if (typeof value.reason !== "string" || !isPopulationUnservedReason(value.reason)) return null;
  return { symbol: value.symbol, reason: value.reason };
}

/** Lane 1's `_text` rule (R3-N1): every string inside an owner refusal is
 * 1..160 chars — a huge or empty string is dropped producer-side, never
 * shortened. A consumer admits only what the producer would have carried. */
const OWNER_REFUSAL_KEYS = ["status", "coverage", "observed_n", "configured_n", "min_members",
  "min_coverage", "effective_as_of"] as const;
function ownerObservationRefusal(value: unknown): Record<string, unknown> | null {
  if (!closed(value, [...OWNER_REFUSAL_KEYS])) return null;
  for (const field of OWNER_REFUSAL_KEYS) {
    const entry: unknown = value[field];
    if (typeof entry === "string") { if (entry.length < 1 || entry.length > 160) return null; }
    else if (typeof entry === "number") { if (!Number.isFinite(entry)) return null; }
    else if (typeof entry !== "boolean") return null;
  }
  return value;
}

function statusField(value: unknown, unavailableReason = true): { status: string; reason?: string } | null {
  if (!record(value) || typeof value.status !== "string") return null;
  if (value.status === "unavailable" && unavailableReason && typeof value.reason !== "string") return null;
  return { status: value.status, ...(typeof value.reason === "string" ? { reason: value.reason } : {}) };
}

function actionField(value: unknown): PopulationAction | null {
  if (closed(value, ["status", "lane", "reco", "label", "score"]) && value.status === "available"
    && str(value.lane, 64) && str(value.reco, 64) && str(value.label, 64) && int(value.score, 0, 1000)) {
    return { status: "available", lane: value.lane, reco: value.reco, label: value.label, score: value.score };
  }
  // §1 lists exactly one unavailable action reason: no row exists for the group.
  if (closed(value, ["status", "reason"]) && value.status === "unavailable" && value.reason === "no_action_row") {
    return { status: "unavailable", reason: value.reason };
  }
  return null;
}

/** Refusal detection for a group_index entry: the explicit flag when carried
 * (wire follow-up), else the three-part test confirmed at head 595fe6b7 (COO 12:06Z). */
export function groupIndexRefused(entry: {
  name: string | null; membersListed: number; configuredCurrent: number | null; unserved: number;
  refusedByOwner?: boolean;
}): boolean {
  if (typeof entry.refusedByOwner === "boolean") return entry.refusedByOwner;
  return entry.name === null && entry.membersListed === 0
    && entry.configuredCurrent !== null && entry.unserved === entry.configuredCurrent;
}

/** `capture.identity.membership_snapshot` — tolerant whole-fact read (item 5).
 * Absent reads not-carried; owner-unavailable, unknown reason, wrong type or a
 * malformed shape each read carried-unavailable. The ONE whole-fact trigger
 * inside entries is a stamped `members_sha` outside null|64-hex (owner S3:
 * never a partially trusted group set); every other entry fault degrades that
 * entry alone, matching the owner's per-group unavailable. */
function readMembershipSnapshot(value: unknown): PopulationMembershipSnapshot {
  if (value === undefined || value === null) return { carried: false };
  const unavailable = { carried: true, status: "unavailable" } as const;
  if (!record(value) || value.status !== "available"
    || !str(value.source, 200) || !day(value.as_of) || value.suite !== "baskets" || !record(value.groups)) {
    return unavailable;
  }
  const groups: Record<string, PopulationSnapshotEntry> = {};
  for (const [groupId, entry] of Object.entries(value.groups)) {
    if (!POPULATION_GROUP_ID.test(groupId)) return unavailable; // malformed group set
    if (record(entry) && entry.status === "unavailable") { groups[groupId] = { status: "unavailable" }; continue; }
    const shaFault = record(entry) && Object.hasOwn(entry, "members_sha") && entry.members_sha !== null
      && !(typeof entry.members_sha === "string" && HASH.test(entry.members_sha));
    if (shaFault) return unavailable;
    const ok = record(entry) && entry.status === "available"
      && closed(entry, ["status", "snapshot_date", "members_sha", "member_count", "equals_current_roster"])
      && day(entry.snapshot_date) && int(entry.member_count, 0, 1_000_000)
      // N-5 (third review): a snapshot dated after the fact's as_of is a
      // look-ahead the owner never vouched for at capture time — degrade this
      // entry alone. Both sides are day()-validated YYYY-MM-DD, so string
      // comparison is calendar comparison; as_of itself is inclusive.
      && entry.snapshot_date <= value.as_of
      && (entry.equals_current_roster === null || bool(entry.equals_current_roster));
    if (!ok) { groups[groupId] = { status: "unavailable" }; continue; }
    groups[groupId] = { status: "available", snapshotDate: entry.snapshot_date as string,
      membersSha: entry.members_sha as string | null, memberCount: entry.member_count as number,
      equalsCurrentRoster: entry.equals_current_roster as boolean | null };
  }
  return { carried: true, status: "available", asOf: value.as_of as string, groups };
}

/** `capture.identity.membership_first_known` — the LOWER-BOUND fact (item 5).
 * The basis and absent-pair literals are validated so the reader's fixed
 * lower-bound wording can never mislabel a different fact; every day value
 * (store bounds and pair dates) is pattern- AND calendar-checked, and any
 * fault degrades the whole fact — a partially trusted pair set is never read. */
function readFirstKnown(value: unknown): PopulationFirstKnown {
  if (value === undefined || value === null) return { carried: false };
  const unavailable = { carried: true, status: "unavailable" } as const;
  if (!record(value) || value.status !== "available"
    || value.basis !== "lower_bound_from_stored_snapshots" || value.absent_pair_reason !== "no_stored_snapshot"
    || !str(value.source, 200) || !day(value.as_of)
    || !(value.store_first === null || day(value.store_first))
    || !(value.store_last === null || day(value.store_last))
    || !record(value.groups)) return unavailable;
  const groups: Record<string, Record<string, string | null>> = {};
  for (const [groupId, pairs] of Object.entries(value.groups)) {
    if (!POPULATION_GROUP_ID.test(groupId) || !record(pairs)) return unavailable;
    const out: Record<string, string | null> = {};
    for (const [symbol, date] of Object.entries(pairs)) {
      if (!POPULATION_SYMBOL.test(symbol) || (date !== null && !day(date))) return unavailable;
      out[symbol] = date;
    }
    groups[groupId] = out;
  }
  return { carried: true, status: "available", groups };
}

/** `capture.population.roster_clock` — null only when the key is NOT carried;
 * agree only on the owner's exact agree shape; every mismatch/unavailable/
 * malformed reads not_agree (item 5: the completeness figures are then not
 * stated). N-4 (third review): `agree` MEANS exact string equality of the two
 * clocks — an agree label over differing clocks is not an agreement and reads
 * not_agree. r4 N-5 (fourth review): a CARRIED null is one more non-agree
 * shape (like 42/[]/{}), so the surface's generic not-stated reason line has
 * a case to print for — the producer always emits an object, this only
 * future-proofs the decode honestly; counts stay not stated either way. */
function readRosterClock(value: unknown): PopulationRosterClock | null {
  if (value === undefined) return null;
  if (record(value) && value.status === "agree"
    && typeof value.roster_as_of === "string" && str(value.roster_as_of, 32)
    && typeof value.capture_effective_as_of === "string" && str(value.capture_effective_as_of, 32)
    && value.roster_as_of === value.capture_effective_as_of) {
    return { status: "agree" };
  }
  return { status: "not_agree" };
}

/** `capture.identity.taxonomy_revision` — the only consumed statement is the
 * current-not-point-in-time labels basis; every other shape reads false. */
function readTaxonomyRevision(value: unknown): PopulationTaxonomyRevision {
  if (!record(value) || value.status !== "unavailable"
    || value.labels_basis !== "current_not_point_in_time"
    || !Array.isArray(value.labels) || !value.labels.every(label => typeof label === "string")) {
    return { currentNotPointInTime: false };
  }
  return { currentNotPointInTime: true };
}


export function sectorPopulationPage(value: unknown): PopulationPage | null {
  if (!bounded(value) || !closed(value, ["schema", "audience", "source_session", "published_at", "qualification", "page"])
    || value.schema !== "sector_population.read/v1" || value.audience !== "entitled"
    || !day(value.source_session) || !clock(value.published_at)
    || !["accepted", "stale", "degraded"].includes(String(value.qualification))) return null;
  const page = value.page;
  if (!closed(page, ["capture", "filter", "limit", "offset", "total_matching", "complete", "rows", "groups", "next_cursor", "context_ref"], ["group_index", "unserved_matching"])
    || !int(page.limit, POPULATION_MIN_LIMIT, POPULATION_MAX_LIMIT)
    || !int(page.offset, 0, 1_000_000) || !int(page.total_matching, 0, 1_000_000)
    || !bool(page.complete)  // page-end fact (§1): bool, never null
    || !Array.isArray(page.rows) || page.rows.length > page.limit
    || !Array.isArray(page.groups) || page.groups.length > 64
    || !(page.next_cursor === null || (typeof page.next_cursor === "string" && POPULATION_TOKEN.test(page.next_cursor)))
    || (typeof page.context_ref !== "string" || !POPULATION_TOKEN.test(page.context_ref))
    || !record(page.filter) || !(page.filter.group === null || (typeof page.filter.group === "string" && POPULATION_GROUP_ID.test(page.filter.group)))
    || !(page.filter.q === null || (typeof page.filter.q === "string" && POPULATION_QUERY.test(page.filter.q)))) return null;

  const capture = page.capture;
  if (!closed(capture, ["schema", "owner_ref", "population"], ["basis", "claims", "clocks", "correction_rights", "currentness", "identity"])
    || capture.schema !== "sector_population.capture/v1") return null;

  const ownerRefRaw = capture.owner_ref;
  if (!closed(ownerRefRaw, ["owner", "contract", "population_schema", "basis_version", "domain", "generation_id", "content_id", "consumer_content_sha256", "member_sha256", "retained_resolver_ref", "retained_resolver_ref_durability"])
    || ownerRefRaw.owner !== "sector_generation" || ownerRefRaw.contract !== "sector_generation.read/v1"
    || ownerRefRaw.population_schema !== "sector_population.page/v1" || ownerRefRaw.domain !== "sector"
    || !str(ownerRefRaw.basis_version, 128) || !str(ownerRefRaw.generation_id, 128) || !TOKEN128.test(ownerRefRaw.generation_id)
    || typeof ownerRefRaw.content_id !== "string" || !HASH.test(ownerRefRaw.content_id)
    || typeof ownerRefRaw.consumer_content_sha256 !== "string" || !HASH.test(ownerRefRaw.consumer_content_sha256)
    || !record(ownerRefRaw.member_sha256) || Object.keys(ownerRefRaw.member_sha256).length > 64
    || !Object.entries(ownerRefRaw.member_sha256).every(([, digest]) => typeof digest === "string" && HASH.test(digest))
    || !(ownerRefRaw.retained_resolver_ref === null || (typeof ownerRefRaw.retained_resolver_ref === "string" && POPULATION_TOKEN.test(ownerRefRaw.retained_resolver_ref)))
    || (ownerRefRaw.retained_resolver_ref_durability !== "durable" && ownerRefRaw.retained_resolver_ref_durability !== "process_lifetime_only")) return null;

  const population = capture.population;
  // B-1 (third review): the #10965 producer sends `unaccounted: null` beside
  // every non-agree roster clock. A carried clock admits null; the pre-#10965
  // wire (no clock key at all) keeps today's exact rule — an integer.
  // The record() conjunct keeps the probe behind the page's fail-closed law:
  // a non-object population (null included) reads "no clock" here and the
  // closed() guard below refuses the page — never Object.hasOwn's TypeError.
  const clockCarried = record(population) && Object.hasOwn(population, "roster_clock");
  if (!closed(population, ["configured_current", "served", "accounted_unserved", "unaccounted", "complete", "complete_rule", "unserved_reason_note", "unserved_reasons", "groups", "unserved_members", "removed_members", "eligible", "measured", "entitled_visibility_scope"], ["roster_clock"])
    // F1: configured_current/complete are NULL when the capture has no readable
    // roster — null is unknown, never zero, never complete.
    || !(population.configured_current === null || int(population.configured_current, 0, 1_000_000))
    || !int(population.served, 0, 1_000_000)
    || !int(population.accounted_unserved, 0, 1_000_000)
    || (clockCarried
      ? !(population.unaccounted === null || int(population.unaccounted, 0, 1_000_000))
      : !int(population.unaccounted, 0, 1_000_000))
    || !(population.complete === null || bool(population.complete)) || !str(population.complete_rule, 400)
    || !str(population.unserved_reason_note, 1000) || !int(population.groups, 0, 10_000)
    || !Array.isArray(population.unserved_reasons) || population.unserved_reasons.length > 16
    || !population.unserved_reasons.every(reason => typeof reason === "string" && isPopulationUnservedReason(reason))
    || population.entitled_visibility_scope !== "entitled_full"
    || !Array.isArray(population.unserved_members) || population.unserved_members.length > 100_000
    || !population.unserved_members.every(entry => unservedEntry(entry) !== null)
    || !statusField(population.eligible) || !statusField(population.measured)) return null;

  let removedMembers: PopulationRemovedMembers | null;
  const removed = population.removed_members;
  // §2 unavailable: any owner string reason renders the generic unavailable
  // note (item 5: lane 1 adds `carried_block_undated`; unlisted stays generic).
  if (closed(removed, ["status", "reason"]) && removed.status === "unavailable" && str(removed.reason, 200)) {
    removedMembers = { status: "unavailable", reason: removed.reason };
  } else if (closed(removed, ["status", "n", "source", "version", "as_of", "members"]) && removed.status === "available"
    && int(removed.n, 0, 1_000_000) && str(removed.source, 200) && str(removed.version, 128) && day(removed.as_of)
    && Array.isArray(removed.members) && removed.members.length <= 100_000
    && removed.members.every(member => closed(member, ["group_id", "symbol", "removed_on"])
      && typeof member.group_id === "string" && POPULATION_GROUP_ID.test(member.group_id)
      && typeof member.symbol === "string" && POPULATION_SYMBOL.test(member.symbol)
      && day(member.removed_on))) {
    removedMembers = { status: "available", n: removed.n, source: removed.source, version: removed.version,
      asOf: removed.as_of, members: removed.members.map(member => ({
        groupId: member.group_id, symbol: member.symbol, removedOn: member.removed_on })) };
  } else return null;

  const rows: PopulationRow[] = [];
  for (const row of page.rows) {
    if (!closed(row, ["ordinal", "group_id", "symbol", "name", "membership", "also_in_groups", "in_handoff_member_set", "industry", "sub_industry", "prophet_eligibility", "visibility"])
      || !int(row.ordinal, 0, 1_000_000) || typeof row.group_id !== "string" || !POPULATION_GROUP_ID.test(row.group_id)
      || typeof row.symbol !== "string" || !POPULATION_SYMBOL.test(row.symbol) || !str(row.name, 200)
      || !closed(row.membership, ["status", "effective_on"]) || row.membership.status !== "listed"
      || !(row.membership.effective_on === null || day(row.membership.effective_on))
      || !int(row.also_in_groups, 0, 64)  // the wire carries a COUNT of other baskets, never a member list
      || !(row.in_handoff_member_set === null || bool(row.in_handoff_member_set))
      || !statusField(row.prophet_eligibility) || !record(row.visibility) || row.visibility.scope !== "entitled_full") return null;
    const industry = taxonomy(row.industry, false), subIndustry = taxonomy(row.sub_industry, true);
    if (!industry || !subIndustry) return null;
    rows.push({ ordinal: row.ordinal, groupId: row.group_id, symbol: row.symbol, name: row.name,
      membership: { status: "listed", effectiveOn: row.membership.effective_on },
      alsoInGroups: row.also_in_groups, inHandoffMemberSet: row.in_handoff_member_set,
      industry, subIndustry,
      prophetEligibility: statusField(row.prophet_eligibility)!, visibilityScope: row.visibility.scope });
  }

  const groups: PopulationGroupDescriptor[] = [];
  for (const group of page.groups) {
    if (!closed(group, ["group_id", "kind", "name", "name_zh", "category", "weighting", "n_configured_current", "n_members_listed", "n_unserved", "refused_by_owner", "owner_observation_refusal", "membership_coverage", "action", "native_sector_ref", "unserved"])
      || typeof group.group_id !== "string" || !POPULATION_GROUP_ID.test(group.group_id)
      || group.kind !== "basket"  // §1: the only listed kind
      || !strOrNull(group.name, 160) || !strOrNull(group.name_zh, 160)   // live-group `_text` rule
      || !strOrNull(group.category, 160) || !strOrNull(group.weighting, 160)
      || !(group.n_configured_current === null || int(group.n_configured_current, 0, 1_000_000))
      || !int(group.n_members_listed, 0, 1_000_000) || !int(group.n_unserved, 0, 1_000_000)
      || !bool(group.refused_by_owner)
      || !(group.owner_observation_refusal === null || ownerObservationRefusal(group.owner_observation_refusal) !== null)
      // §1 lists two forms: {status,n_listed,n_effective,source_version} | unavailable
      || !(closed(group.membership_coverage, ["status", "n_listed", "n_effective", "source_version"])
        && str(group.membership_coverage.status, 160)
        && int(group.membership_coverage.n_listed, 0, 1_000_000)
        && int(group.membership_coverage.n_effective, 0, 1_000_000)
        && str(group.membership_coverage.source_version, 160)
        || (closed(group.membership_coverage, ["status", "reason"])
          && group.membership_coverage.status === "unavailable" && str(group.membership_coverage.reason, 160)))
      // §1: no crosswalk exists — this ref is only ever unavailable/not_produced.
      || !(closed(group.native_sector_ref, ["status", "reason"])
        && group.native_sector_ref.status === "unavailable" && group.native_sector_ref.reason === "not_produced")
      || !Array.isArray(group.unserved) || group.unserved.length > 100_000
      || !group.unserved.every(entry => groupUnservedEntry(entry) !== null)) return null;
    const action = actionField(group.action);
    if (!action) return null;
    groups.push({ groupId: group.group_id, kind: group.kind, name: group.name, nameZh: group.name_zh,
      category: group.category, weighting: group.weighting, configuredCurrent: group.n_configured_current,
      membersListed: group.n_members_listed, unserved: group.n_unserved, refusedByOwner: group.refused_by_owner,
      ownerObservationRefusal: group.owner_observation_refusal === null ? null
        : ownerObservationRefusal(group.owner_observation_refusal),
      membershipCoverage: group.membership_coverage,
      action, nativeSectorRef: group.native_sector_ref,
      unservedMembers: (group.unserved as unknown[]).map(entry => groupUnservedEntry(entry)!) });
  }

  let groupIndex: PopulationGroupIndexEntry[] | null = null;
  if (page.group_index !== undefined) {
    if (!Array.isArray(page.group_index) || page.group_index.length > 512) return null;
    groupIndex = [];
    for (const entry of page.group_index) {
      if (!closed(entry, ["group_id", "name", "n_members_listed", "n_configured_current", "n_unserved"], ["refused_by_owner", "name_zh"])
        || typeof entry.group_id !== "string" || !POPULATION_GROUP_ID.test(entry.group_id)
        || !strOrNull(entry.name, 200)
        // item 6 (COO 19:15Z): name_zh is the ONE new optional key; no other
        // new key is admitted (closed rule above). N-6 (third review): an
        // invalid name_zh (non-string, empty, over-long) is a display-label
        // fault, not a data fault — it degrades to null at the push below,
        // never a page refusal. The __proto__/constructor unknown-key refusal
        // above stays whole-page.
        || !int(entry.n_members_listed, 0, 1_000_000)
        || !(entry.n_configured_current === null || int(entry.n_configured_current, 0, 1_000_000))
        || !int(entry.n_unserved, 0, 1_000_000)
        || (entry.refused_by_owner !== undefined && !bool(entry.refused_by_owner))) return null;
      const explicit = typeof entry.refused_by_owner === "boolean";
      const refusedByOwner = groupIndexRefused({
        name: entry.name, membersListed: entry.n_members_listed,
        configuredCurrent: entry.n_configured_current, unserved: entry.n_unserved,
        // Pass the flag ONLY when the wire actually carried it — a defaulted boolean
        // here would make the explicit branch win and the three-part test never run.
        ...(explicit ? { refusedByOwner: entry.refused_by_owner } : {}),
      });
      groupIndex.push({ groupId: entry.group_id, name: entry.name, membersListed: entry.n_members_listed,
        configuredCurrent: entry.n_configured_current, unserved: entry.n_unserved,
        // N-6: null, absent, or a valid 1..160 string reads itself; anything
        // else reads null for this entry — the picker falls back, the page lives.
        nameZh: strOrNull(entry.name_zh, 160) ? entry.name_zh : null,
        refusedByOwner, refusedExplicit: explicit });
    }
  }

  let unservedMatching: PopulationUnservedEntry[] | null = null;
  if (page.unserved_matching !== undefined) {
    if (!Array.isArray(page.unserved_matching) || page.unserved_matching.length > 100_000
      || !page.unserved_matching.every(entry => unservedEntry(entry) !== null)) return null;
    unservedMatching = (page.unserved_matching as unknown[]).map(entry => unservedEntry(entry)!);
  }

  // Lane 1 point-in-time facts (item 5): tolerant whole-fact reads — none of
  // them can refuse the page, and none invents a number on a bad shape.
  const identity = record(capture.identity) ? capture.identity : null;
  const membershipSnapshot = readMembershipSnapshot(identity?.membership_snapshot);
  const firstKnown = readFirstKnown(identity?.membership_first_known);
  const rosterClock = readRosterClock(Object.hasOwn(population, "roster_clock") ? population.roster_clock : undefined);
  const taxonomyRevision = readTaxonomyRevision(identity?.taxonomy_revision);

  // Internal consistency (review S2): the wire's own invariants. A page that
  // breaks them is refused whole — the surface reads unavailable, never a
  // partial table that renders impossible counts or follows an end-of-list
  // cursor. §1: page.complete is true ⇔ next_cursor is null; §2: complete:true
  // means served+accounted == configured (nothing unaccounted) and served can
  // never exceed a stated configured roster; a page never shows more rows
  // than the filter's own total_matching.
  if ((page.complete === true) !== (page.next_cursor === null)) return null;
  if (population.configured_current !== null && population.served > population.configured_current) return null;
  if (population.complete === true && typeof population.unaccounted === "number" && population.unaccounted > 0) return null;
  if (rows.length > page.total_matching) return null;

  // B-1/N-4 one stated rule (third review): the configured count and the
  // unaccounted segment are STATED only beside an agreeing roster clock with
  // equal clocks and an integer unaccounted. The pre-#10965 wire carries no
  // clock key and keeps today's behaviour — counts stated as decoded.
  const countsStated = !clockCarried
    || (rosterClock !== null && rosterClock.status === "agree" && typeof population.unaccounted === "number");

  return {
    sourceSession: value.source_session, publishedAt: value.published_at,
    qualification: value.qualification as PopulationPage["qualification"],
    ownerRef: { owner: ownerRefRaw.owner, contract: ownerRefRaw.contract, populationSchema: ownerRefRaw.population_schema,
      basisVersion: ownerRefRaw.basis_version, domain: ownerRefRaw.domain, generationId: ownerRefRaw.generation_id,
      contentId: ownerRefRaw.content_id, consumerContentSha256: ownerRefRaw.consumer_content_sha256,
      memberSha256: ownerRefRaw.member_sha256 as Record<string, string>,
      retainedResolverRef: ownerRefRaw.retained_resolver_ref,
      // The guard above proved the literal; the cast only re-states it for TS.
      retainedResolverRefDurability: ownerRefRaw.retained_resolver_ref_durability as PopulationOwnerRef["retainedResolverRefDurability"] },
    counts: { configuredCurrent: population.configured_current, served: population.served,
      // The guard above proved unaccounted is a number, or null beside a
      // carried clock (B-1); the typeof re-statement is exact for both.
      accountedUnserved: population.accounted_unserved,
      unaccounted: typeof population.unaccounted === "number" ? population.unaccounted : null,
      countsStated,
      complete: population.complete, groups: population.groups,
      unservedMembers: (population.unserved_members as unknown[]).map(entry => unservedEntry(entry)!),
      removedMembers },
    filter: { group: page.filter.group ?? null, q: page.filter.q ?? null },
    limit: page.limit, offset: page.offset, totalMatching: page.total_matching, complete: page.complete,
    rows, groups, groupIndex, unservedMatching, nextCursor: page.next_cursor, contextRef: page.context_ref,
    membershipSnapshot, firstKnown, rosterClock, taxonomyRevision,
  };
}

/** Client-visible outcome of one population read. `page` is set only on ok. */
export type PopulationRead =
  | { status: "ok"; page: PopulationPage }
  | { status: "signed_out" }        // 401 — the ONLY sign-in state
  | { status: "denied" }            // 403
  | { status: "cursor_reset"; reason: string | null } // 409 CURSOR_RESET, or 400 on a server-given cursor
  | { status: "original_unavailable"; reason: string | null } // 404 ORIGINAL_UNAVAILABLE
  | { status: "invalid_request"; code: string | null } // our own grammar violation (page-one only)
  | { status: "retry"; code: string | null } // 503/5xx/429/network — never a sign-in prompt
  | { status: "invalid" };          // 200 with a body outside the wire contract

/** The refusal table shared by the member list and the reopen seam. */
export function classifyPopulationResponse(
  status: number,
  body: unknown,
  opts: { sentCursor?: boolean } = {},
): PopulationRead {
  const code = record(body) && typeof body.code === "string" ? body.code : null;
  if (status === 200) {
    const page = sectorPopulationPage(body);
    return page ? { status: "ok", page } : { status: "invalid" };
  }
  if (status === 401) return { status: "signed_out" };
  if (status === 403) return { status: "denied" };
  if (status === 409 && code === "CURSOR_RESET") return { status: "cursor_reset", reason: record(body) && typeof body.reason === "string" ? body.reason : null };
  if (status === 404 && code === "ORIGINAL_UNAVAILABLE") return { status: "original_unavailable", reason: null };
  if (status === 400 && code === "REQUEST_INVALID" && opts.sentCursor) {
    // A server-given cursor the route now rejects: treat as a reset until lane 1's
    // grammar fix (COO order 2) — restart page one, never lose the list silently.
    return { status: "cursor_reset", reason: "request_invalid_on_cursor" };
  }
  if (status === 400) return { status: "invalid_request", code };
  if (status >= 500 || status === 429) return { status: "retry", code };
  return { status: "retry", code };
}

export type PopulationFetch = { group?: string; q?: string; limit?: number; cursor?: string; signal?: AbortSignal };

/**
 * Client fetch of the BFF population proxy (`?source=population`). `audience` is
 * never a parameter here: the BFF forces entitled. Network failure reads as retry;
 * a caller abort propagates as a throw so React state stays owned by the caller.
 */
export async function fetchSectorPopulation(query: PopulationFetch = {}): Promise<PopulationRead> {
  // `source=population` already rides the base URL — never a second copy (review N2).
  const params = new URLSearchParams();
  if (query.group !== undefined) params.set("group", query.group);
  if (query.q !== undefined) params.set("q", query.q);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.cursor !== undefined) params.set("cursor", query.cursor);
  let response: Response;
  const url = [...params].length ? `${SECTOR_POPULATION_URL}&${params.toString()}` : SECTOR_POPULATION_URL;
  try {
    response = await fetch(url,
      { credentials: "same-origin", cache: "no-store", signal: query.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return { status: "retry", code: null };
  }
  let body: unknown = null;
  try { body = await response.json(); } catch { body = null; }
  return classifyPopulationResponse(response.status, body, { sentCursor: query.cursor !== undefined });
}
