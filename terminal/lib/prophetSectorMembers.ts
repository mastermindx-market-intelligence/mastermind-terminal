/**
 * Prophet × Sector Intelligence — member-population decoder for the frozen wire
 * contract `prophet.sector_members/v1` (Fable CEO, 2026-11-10; Lead A owns the
 * bytes, Terminal decodes).
 *
 * Laws encoded here:
 *   - Closed admission: unknown fields are tolerated ONLY inside objects the
 *     contract marks `open` (GroupContext). Everything else is closed — a
 *     payload outside the contract decodes to null and the surface renders its
 *     unavailable state, never a partial read and never invented members.
 *   - Descriptive only: the disclosure block is carried verbatim and rendered;
 *     nothing in this module converts a member's Prophet state into a trade
 *     instruction. `descriptive_only` must be true or the payload is refused.
 *   - Fail-closed joins: an unavailable side arrives as a 200 with the null ref
 *     and the matching `compatibility.status`; members then carry
 *     `prophet.state:"unavailable"` (or an empty list when the sector side is
 *     missing). Never 200 with a silently-partial join.
 *   - Counts are invariants, not suggestions: open_plan+resolved_plan+
 *     early_observation+none+unavailable == served, or the payload is refused.
 *   - No plan on none: `plan` is present exactly for open_plan/resolved_plan;
 *     `reason` is REQUIRED for none/unavailable; `observation` is required for
 *     early_observation. The contract's precedence lives upstream — the decoder
 *     only refuses shapes that would let two stories ship at once.
 *
 * Wire values whose grammar the contract spells out (dates, hashes, enums,
 * counts) are validated strictly; opaque owner strings (ids, labels, reasons,
 * qualification) are admitted as bounded strings — tolerance is for the owner's
 * vocabulary, never for structure.
 */

export const SECTOR_MEMBERS_URL = "/api/prophet/sector-members";

/** Wire grammar (shared with the sector population lane). */
export const SECTOR_MEMBERS_GROUP_ID = /^[a-z][a-z0-9_-]{0,79}$/;
export const SECTOR_MEMBERS_SYMBOL = /^[A-Z][A-Z0-9.-]{0,31}$/;
export const SECTOR_MEMBERS_QUERY = /^[\w .&'-]{1,64}$/;
export const SECTOR_MEMBERS_MIN_LIMIT = 1;
export const SECTOR_MEMBERS_MAX_LIMIT = 200;
export const SECTOR_MEMBERS_DEFAULT_LIMIT = 100;

/** Contract state order (sort rank and filter chips use the same order). */
export const PROPHET_MEMBER_STATES = [
  "open_plan", "early_observation", "resolved_plan", "none", "unavailable",
] as const;
export type ProphetMemberState = (typeof PROPHET_MEMBER_STATES)[number];
export const prophetMemberStateRank = (state: ProphetMemberState): number =>
  PROPHET_MEMBER_STATES.indexOf(state);

export const SECTOR_MEMBERS_COMPAT_STATUSES = [
  "compatible", "stale_sector", "stale_prophet", "mixed_basis",
  "sector_unavailable", "prophet_unavailable",
] as const;
export type SectorMembersCompatStatus = (typeof SECTOR_MEMBERS_COMPAT_STATUSES)[number];

const HASH64 = /^[0-9a-f]{64}$/;

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const int = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
const str = (value: unknown, max = 1024): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max;
const strOrNull = (value: unknown, max = 1024): value is string | null =>
  value === null || str(value, max);
const pct = (value: unknown): value is number | null =>
  value === null || (typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 10_000);

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

/** Open object admission (contract `open` marker): required keys present; extra
 * keys tolerated — the ONLY place unknown fields survive a decode. */
function openRecord(value: unknown, required: string[]): value is Record<string, unknown> {
  return record(value) && required.every(key => Object.hasOwn(value, key));
}

export type SectorRef = {
  owner: "sector_generation"; generationId: string; contentId: string;
  sourceSession: string; publishedAt: string; memberSha256: string | null; qualification: string;
};
export type ProphetRef = {
  owner: "prophet_index"; schema: string; asof: string; generatedAt: string | null;
  indexSha256: string; planCount: number; openPlanCount: number;
};
export type SectorMembersCompatibility = {
  status: SectorMembersCompatStatus; sectorSession: string | null; prophetAsof: string | null;
  sessionGap: number | null; reason: string | null;
};
export type SectorMembersDisclosure = {
  membershipBasis: string; taxonomyBasis: string; joinKey: string; descriptiveOnly: true;
};
/** GroupContext — the contract's ONE `open` object. Every measure nullable;
 * `reasons` carries the owner's reason for each null field. */
export type SectorGroupContext = {
  windowSessions: number | null; groupReturnPct: number | null; marketReturnPct: number | null;
  relativePp: number | null;
  breadth: { aboveTrend: number; measured: number } | null;
  stateLabel: string | null;
  reasons: Record<string, string>;
};
export type CoverageCounts = {
  /** null ONLY on the fail-closed read (A1-9): configured unknown, all counts zero. */
  configured: number | null; served: number; accountedUnserved: number; unaccounted: number;
  openPlan: number; resolvedPlan: number; earlyObservation: number; none: number; unavailable: number;
};
/** The group object as the wire carries it in group/symbol modes: no counts
 * (A1: counts live at group mode's top level; the index's groups carry their own). */
export type SectorGroupDescriptor = {
  id: string; kind: "basket" | "sector"; name: string | null; nameZh: string | null;
  benchmark: string | null; context: SectorGroupContext;
};
/** Index-mode group entry: the descriptor plus its own coverage counts. */
export type SectorGroupSummary = SectorGroupDescriptor & { counts: CoverageCounts };
export type SectorMemberPlan = {
  id: string; direction: "long" | "short" | null; strategy: string | null;
  phase: string | null; openedOn: string | null; resolvedOn: string | null; outcome: string | null;
};
export type SectorMemberObservation = { kind: string; asof: string };
export type SectorMemberProphet = {
  state: ProphetMemberState; reason: string | null; plan: SectorMemberPlan | null;
  openPlanCount: number; resolvedPlanCount: number; observation: SectorMemberObservation | null;
};
export type SectorMember = {
  symbol: string; name: string | null; industry: string | null; subIndustry: string | null;
  memberSince: string | null; firstKnown: string | null; alsoInGroups: string[];
  prophet: SectorMemberProphet;
};
export type SectorUnservedEntry = { symbol: string; reason: string };
export type SectorMembersPage = {
  offset: number; limit: number; totalMatching: number; nextOffset: number | null;
  q: string | null; state: ProphetMemberState | null;
};

export type SectorMembersEnvelope = {
  capturedAt: string;
  sectorRef: SectorRef | null;
  prophetRef: ProphetRef | null;
  compatibility: SectorMembersCompatibility;
  disclosure: SectorMembersDisclosure;
};
export type SectorMembersPayload =
  | ({ mode: "index" } & SectorMembersEnvelope & { groups: SectorGroupSummary[]; totals: CoverageCounts })
  | ({ mode: "group" } & SectorMembersEnvelope & {
      /** null on the fail-closed read (A1-9/A2-4): sector side unavailable. */
      group: SectorGroupDescriptor | null; counts: CoverageCounts; members: SectorMember[];
      unserved: SectorUnservedEntry[]; page: SectorMembersPage;
    })
  | ({ mode: "symbol" } & SectorMembersEnvelope & {
      symbol: string; memberOf: { group: SectorGroupDescriptor; member: SectorMember }[];
      prophet: SectorMemberProphet;
    });

const ENVELOPE_KEYS = ["schema", "mode", "captured_at", "sector_ref", "prophet_ref", "compatibility", "disclosure"];
const GROUP_DESCRIPTOR_KEYS = ["id", "kind", "name", "name_zh", "benchmark", "context"];

/** Abbreviated evidence hash for disclosure surfaces (copyable full value stays in the wire object). */
export function abbrevHash(hash: string | null | undefined, keep = 8): string {
  if (!hash) return "—";
  return hash.length <= keep ? hash : `${hash.slice(0, keep)}…`;
}

function readSectorRef(value: unknown): SectorRef | null | false {
  if (value === null) return null;
  if (!closed(value, ["owner", "generation_id", "content_id", "source_session", "published_at", "member_sha256", "qualification"])
    || value.owner !== "sector_generation"
    || !str(value.generation_id, 128) || !str(value.content_id, 200)
    || !day(value.source_session) || !clock(value.published_at)
    || !(value.member_sha256 === null || (typeof value.member_sha256 === "string" && HASH64.test(value.member_sha256)))
    || !str(value.qualification, 128)) return false;
  return {
    owner: "sector_generation", generationId: value.generation_id, contentId: value.content_id,
    sourceSession: value.source_session, publishedAt: value.published_at,
    memberSha256: value.member_sha256, qualification: value.qualification,
  };
}

function readProphetRef(value: unknown): ProphetRef | null | false {
  if (value === null) return null;
  if (!closed(value, ["owner", "schema", "asof", "generated_at", "index_sha256", "plan_count", "open_plan_count"])
    || value.owner !== "prophet_index"
    || !str(value.schema, 128) || !day(value.asof)
    || !(value.generated_at === null || clock(value.generated_at))
    || typeof value.index_sha256 !== "string" || !HASH64.test(value.index_sha256)
    || !int(value.plan_count, 0, 1_000_000) || !int(value.open_plan_count, 0, 1_000_000)) return false;
  return {
    owner: "prophet_index", schema: value.schema, asof: value.asof, generatedAt: value.generated_at,
    indexSha256: value.index_sha256, planCount: value.plan_count, openPlanCount: value.open_plan_count,
  };
}

function readCompatibility(value: unknown): SectorMembersCompatibility | null {
  if (!closed(value, ["status", "sector_session", "prophet_asof", "session_gap", "reason"])
    || !(SECTOR_MEMBERS_COMPAT_STATUSES as readonly string[]).includes(String(value.status))
    || !(value.sector_session === null || day(value.sector_session))
    || !(value.prophet_asof === null || day(value.prophet_asof))
    || !(value.session_gap === null || int(value.session_gap, -366, 366))
    || !strOrNull(value.reason, 400)) return null;
  return {
    status: value.status as SectorMembersCompatStatus,
    sectorSession: value.sector_session as string | null,
    prophetAsof: value.prophet_asof as string | null,
    sessionGap: value.session_gap as number | null,
    reason: value.reason as string | null,
  };
}

function readDisclosure(value: unknown): SectorMembersDisclosure | null {
  if (!closed(value, ["membership_basis", "taxonomy_basis", "join_key", "descriptive_only"])
    || !str(value.membership_basis, 200) || !str(value.taxonomy_basis, 200)
    || !str(value.join_key, 128) || value.descriptive_only !== true) return null;
  return {
    membershipBasis: value.membership_basis, taxonomyBasis: value.taxonomy_basis,
    joinKey: value.join_key, descriptiveOnly: true,
  };
}

/** GroupContext — open admission: required keys must exist, unknown keys are
 * tolerated (contract's only `open` object), values still validated. */
function readGroupContext(value: unknown): SectorGroupContext | null {
  if (!openRecord(value, ["window_sessions", "group_return_pct", "market_return_pct", "relative_pp", "breadth", "state_label", "reasons"])
    || !intOrNull(value.window_sessions, 1_000_000)
    || !pct(value.group_return_pct) || !pct(value.market_return_pct) || !pct(value.relative_pp)
    || !strOrNull(value.state_label, 300)
    || !record(value.reasons) || Object.keys(value.reasons).length > 64
    || !Object.entries(value.reasons).every(([key, reason]) =>
      key.length > 0 && key.length <= 64 && str(reason, 200))) return null;
  const breadthRaw = value.breadth;
  let breadth: SectorGroupContext["breadth"] = null;
  if (breadthRaw !== null) {
    if (!closed(breadthRaw, ["above_trend", "measured"])
      || !int(breadthRaw.above_trend, 0, 1_000_000) || !int(breadthRaw.measured, 0, 1_000_000)) return null;
    breadth = { aboveTrend: breadthRaw.above_trend, measured: breadthRaw.measured };
  }
  const reasons: Record<string, string> = {};
  for (const [key, reason] of Object.entries(value.reasons)) reasons[key] = reason as string;
  return {
    windowSessions: value.window_sessions as number | null,
    groupReturnPct: value.group_return_pct as number | null,
    marketReturnPct: value.market_return_pct as number | null,
    relativePp: value.relative_pp as number | null,
    breadth, stateLabel: value.state_label as string | null, reasons,
  };
}
function intOrNull(value: unknown, max: number): value is number | null {
  return value === null || int(value, 0, max);
}

function readCounts(value: unknown): CoverageCounts | null {
  if (!closed(value, ["configured", "served", "accounted_unserved", "unaccounted",
    "open_plan", "resolved_plan", "early_observation", "none", "unavailable"])) return null;
  const keys = ["served", "accounted_unserved", "unaccounted",
    "open_plan", "resolved_plan", "early_observation", "none", "unavailable"] as const;
  const wire: Record<string, number> = {};
  for (const key of keys) {
    if (!int(value[key], 0, 1_000_000)) return null;
    wire[key] = value[key] as number;
  }
  // configured is null ONLY on the fail-closed read (A1-9) — and there every
  // other count is zero; a null configured beside nonzero counts is contradictory.
  if (value.configured === null) {
    if (keys.some(key => wire[key] !== 0)) return null;
  } else if (!int(value.configured, 0, 1_000_000)) return null;
  // Contract invariant: the five Prophet states account for every served member.
  if (wire.open_plan + wire.resolved_plan + wire.early_observation + wire.none + wire.unavailable !== wire.served) return null;
  // Map wire snake_case to the decoded camelCase surface explicitly — a cast
  // would leave snake keys under a camelCase type for every consumer.
  return {
    configured: value.configured as number | null,
    served: wire.served, accountedUnserved: wire.accounted_unserved, unaccounted: wire.unaccounted,
    openPlan: wire.open_plan, resolvedPlan: wire.resolved_plan, earlyObservation: wire.early_observation,
    none: wire.none, unavailable: wire.unavailable,
  };
}

function readGroupDescriptor(value: unknown, extraKeys: string[] = []): SectorGroupDescriptor | null {
  if (!closed(value, [...GROUP_DESCRIPTOR_KEYS, ...extraKeys])
    || typeof value.id !== "string" || !SECTOR_MEMBERS_GROUP_ID.test(value.id)
    || (value.kind !== "basket" && value.kind !== "sector")
    || !strOrNull(value.name, 200) || !strOrNull(value.name_zh, 200)
    || !(value.benchmark === null || (typeof value.benchmark === "string" && SECTOR_MEMBERS_SYMBOL.test(value.benchmark)))) return null;
  const context = readGroupContext(value.context);
  if (!context) return null;
  return {
    id: value.id, kind: value.kind, name: value.name, nameZh: value.name_zh,
    benchmark: value.benchmark, context,
  };
}

function readGroupSummary(value: unknown): SectorGroupSummary | null {
  // The index entry is the descriptor plus its own counts key.
  const descriptor = readGroupDescriptor(value, ["counts"]);
  if (descriptor === null) return null;
  const counts = readCounts((value as Record<string, unknown>).counts);
  if (!counts) return null;
  return { ...descriptor, counts };
}

function readMemberProphet(value: unknown): SectorMemberProphet | null {
  if (!closed(value, ["state", "reason", "plan", "open_plan_count", "resolved_plan_count", "observation"])
    || !(PROPHET_MEMBER_STATES as readonly string[]).includes(String(value.state))) return null;
  const state = value.state as ProphetMemberState;
  // reason is REQUIRED for none/unavailable (contract MemberProphet note).
  if ((state === "none" || state === "unavailable") && !str(value.reason, 200)) return null;
  if (!strOrNull(value.reason, 200)) return null;
  if (!int(value.open_plan_count, 0, 1_000_000) || !int(value.resolved_plan_count, 0, 1_000_000)) return null;
  let plan: SectorMemberPlan | null = null;
  if (value.plan !== null) {
    const p = value.plan;
    if (!closed(p, ["id", "direction", "strategy", "phase", "opened_on", "resolved_on", "outcome"])
      || !str(p.id, 128)
      || !(p.direction === null || p.direction === "long" || p.direction === "short")
      || !strOrNull(p.strategy, 128) || !strOrNull(p.phase, 128)
      || !(p.opened_on === null || day(p.opened_on))
      || !(p.resolved_on === null || day(p.resolved_on))
      || !strOrNull(p.outcome, 128)) return null;
    // The plan id is the exact id Terminal's Prophet board uses to select a plan.
    plan = {
      id: p.id, direction: p.direction as "long" | "short" | null, strategy: p.strategy,
      phase: p.phase, openedOn: p.opened_on as string | null,
      resolvedOn: p.resolved_on as string | null, outcome: p.outcome as string | null,
    };
  }
  // plan present exactly for open_plan/resolved_plan; early_observation may carry
  // a superseded plan in its history — none/unavailable never may.
  if ((state === "open_plan" || state === "resolved_plan") && plan === null) return null;
  if ((state === "none" || state === "unavailable") && plan !== null) return null;
  let observation: SectorMemberObservation | null = null;
  if (value.observation !== null) {
    const o = value.observation;
    if (!closed(o, ["kind", "asof"]) || !str(o.kind, 128) || !day(o.asof)) return null;
    observation = { kind: o.kind, asof: o.asof };
  }
  // The contract's MemberProphet carries observation as an independent nullable
  // object — real bytes pair it with open_plan too (e.g. a turn_watch beside a
  // live plan), so the decoder checks shape only, never state coupling.
  return {
    state, reason: value.reason as string | null, plan,
    openPlanCount: value.open_plan_count as number,
    resolvedPlanCount: value.resolved_plan_count as number,
    observation,
  };
}

function readMember(value: unknown): SectorMember | null {
  if (!closed(value, ["symbol", "name", "industry", "sub_industry", "member_since", "first_known", "also_in_groups", "prophet"])
    || typeof value.symbol !== "string" || !SECTOR_MEMBERS_SYMBOL.test(value.symbol)
    || !strOrNull(value.name, 200) || !strOrNull(value.industry, 200) || !strOrNull(value.sub_industry, 200)
    || !(value.member_since === null || day(value.member_since))
    || !(value.first_known === null || day(value.first_known))
    || !Array.isArray(value.also_in_groups) || value.also_in_groups.length > 32
    || !value.also_in_groups.every((g: unknown) => typeof g === "string" && SECTOR_MEMBERS_GROUP_ID.test(g))) return null;
  const prophet = readMemberProphet(value.prophet);
  if (!prophet) return null;
  return {
    symbol: value.symbol, name: value.name, industry: value.industry, subIndustry: value.sub_industry,
    memberSince: value.member_since as string | null, firstKnown: value.first_known as string | null,
    alsoInGroups: value.also_in_groups as string[], prophet,
  };
}

function readPage(value: unknown): SectorMembersPage | null {
  if (!closed(value, ["offset", "limit", "total_matching", "next_offset", "q", "state"])
    || !int(value.offset, 0, 1_000_000)
    || !int(value.limit, SECTOR_MEMBERS_MIN_LIMIT, SECTOR_MEMBERS_MAX_LIMIT)
    || !int(value.total_matching, 0, 1_000_000)
    || !(value.next_offset === null || int(value.next_offset, 0, 1_000_000))
    || !(value.q === null || (typeof value.q === "string" && SECTOR_MEMBERS_QUERY.test(value.q)))
    || !(value.state === null || (PROPHET_MEMBER_STATES as readonly string[]).includes(String(value.state)))) return null;
  return {
    offset: value.offset, limit: value.limit, totalMatching: value.total_matching,
    nextOffset: value.next_offset as number | null,
    q: value.q as string | null, state: value.state as ProphetMemberState | null,
  };
}

function readUnserved(value: unknown): SectorUnservedEntry | null {
  if (!closed(value, ["symbol", "reason"])
    || typeof value.symbol !== "string" || !SECTOR_MEMBERS_SYMBOL.test(value.symbol)
    || !str(value.reason, 200)) return null;
  return { symbol: value.symbol, reason: value.reason };
}

/**
 * Decode one `prophet.sector_members/v1` response body. Returns null for any
 * payload outside the contract — the caller renders its unavailable state;
 * nothing partial is ever returned. Mode-specific keys live beside the common
 * envelope at the wire's top level, so admission is closed over envelope+mode
 * keys together.
 */
export function decodeProphetSectorMembers(value: unknown): SectorMembersPayload | null {
  if (!record(value) || typeof value.schema !== "string" || value.schema !== "prophet.sector_members/v1") return null;
  if (value.mode !== "index" && value.mode !== "group" && value.mode !== "symbol") return null;
  const mode = value.mode;

  const sectorRef = readSectorRef(value.sector_ref);
  const prophetRef = readProphetRef(value.prophet_ref);
  const compatibility = readCompatibility(value.compatibility);
  const disclosure = readDisclosure(value.disclosure);
  if (sectorRef === false || prophetRef === false || !compatibility || !disclosure) return null;
  if (!clock(value.captured_at)) return null;

  // Fail-closed joins: a null ref means that side is unavailable and the status
  // must say so; a present ref under an unavailable status is contradictory.
  if (sectorRef === null && compatibility.status !== "sector_unavailable") return null;
  if (prophetRef === null && compatibility.status !== "prophet_unavailable") return null;
  if (sectorRef !== null && compatibility.status === "sector_unavailable") return null;
  if (prophetRef !== null && compatibility.status === "prophet_unavailable") return null;

  const envelope: SectorMembersEnvelope = {
    capturedAt: value.captured_at, sectorRef, prophetRef, compatibility, disclosure,
  };

  if (mode === "index") {
    if (!closed(value, [...ENVELOPE_KEYS, "groups", "totals"])) return null;
    if (!Array.isArray(value.groups) || value.groups.length > 512) return null;
    const groups: SectorGroupSummary[] = [];
    for (const g of value.groups) {
      const decoded = readGroupSummary(g);
      if (!decoded) return null;
      groups.push(decoded);
    }
    const totals = readCounts(value.totals);
    if (!totals) return null;
    return { mode: "index", ...envelope, groups, totals };
  }

  if (mode === "group") {
    if (!closed(value, [...ENVELOPE_KEYS, "group", "counts", "members", "unserved", "page"])) return null;
    // A1-9/A2-4: with the sector side unavailable the group object itself is
    // null (no capture → no roster), members/unserved empty, counts zeroed.
    const group = value.group === null ? null : readGroupDescriptor(value.group);
    if (value.group !== null && group === null) return null;
    const counts = readCounts(value.counts);
    if (!counts) return null;
    const page = readPage(value.page);
    if (!page) return null;
    if (!Array.isArray(value.members) || value.members.length > page.limit) return null;
    const members: SectorMember[] = [];
    const seen = new Set<string>();
    for (const m of value.members) {
      const decoded = readMember(m);
      if (!decoded) return null;
      if (seen.has(decoded.symbol)) return null; // ambiguous/duplicate join keys are refused, never guessed
      seen.add(decoded.symbol);
      members.push(decoded);
    }
    if (!Array.isArray(value.unserved) || value.unserved.length > 10_000) return null;
    const unserved: SectorUnservedEntry[] = [];
    for (const u of value.unserved) {
      const decoded = readUnserved(u);
      if (!decoded) return null;
      unserved.push(decoded);
    }
    // An unfiltered page-one read that claims served members but joins zero of
    // them is a silently-partial join — refused (contract fail-closed rule).
    // An empty list from a q/state filter or a past-the-end offset is legitimate.
    if (members.length === 0 && sectorRef !== null && page.q === null && page.state === null
      && page.offset === 0 && page.totalMatching === 0 && counts.served > 0) return null;
    // The fail-closed shape is coherent or it is refused: group null ⇒ no roster.
    if (group === null && (counts.configured !== null || counts.served !== 0 || members.length !== 0)) return null;
    return { mode: "group", ...envelope, group, counts, members, unserved, page };
  }

  // mode === "symbol"
  if (!closed(value, [...ENVELOPE_KEYS, "symbol", "member_of", "prophet"])) return null;
  if (typeof value.symbol !== "string" || !SECTOR_MEMBERS_SYMBOL.test(value.symbol)) return null;
  if (!Array.isArray(value.member_of) || value.member_of.length > 32) return null;
  const memberOf: { group: SectorGroupDescriptor; member: SectorMember }[] = [];
  for (const entry of value.member_of) {
    if (!closed(entry, ["group", "member"])) return null;
    const group = readGroupDescriptor(entry.group);
    const member = readMember(entry.member);
    if (!group || !member || member.symbol !== value.symbol) return null;
    memberOf.push({ group, member });
  }
  const prophet = readMemberProphet(value.prophet);
  if (!prophet) return null;
  return { mode: "symbol", ...envelope, symbol: value.symbol, memberOf, prophet };
}

/** Client-visible outcome of one sector-members read. `payload` is set only on ok. */
export type SectorMembersRead =
  | { status: "ok"; payload: SectorMembersPayload }
  | { status: "signed_out" }   // 401 — the only sign-in state
  | { status: "denied" }       // 403
  | { status: "not_found"; code: string | null } // 404 unknown_group
  | { status: "invalid_request" } // 422 malformed query
  | { status: "unavailable" }  // 5xx from the BFF — the reading is not published yet (designed degradation, never a broken page)
  | { status: "retry" }        // 429/network — transient; never a sign-in prompt
  | { status: "invalid" };     // 200 with a body outside the wire contract

export function classifySectorMembersResponse(status: number, body: unknown): SectorMembersRead {
  const code = record(body) && typeof body.code === "string" ? body.code : null;
  if (status === 200) {
    const payload = decodeProphetSectorMembers(body);
    return payload ? { status: "ok", payload } : { status: "invalid" };
  }
  if (status === 401) return { status: "signed_out" };
  if (status === 403) return { status: "denied" };
  if (status === 404) return { status: "not_found", code };
  if (status === 422) return { status: "invalid_request" };
  if (status === 429) return { status: "retry" };
  if (status >= 500) return { status: "unavailable" };
  return { status: "retry" };
}

export type SectorMembersFetch = {
  group?: string; symbol?: string; offset?: number; limit?: number;
  q?: string | null; state?: ProphetMemberState | null; signal?: AbortSignal;
};

/** Client fetch of the BFF proxy. The BFF owns auth/entitlement; this client
 * only forwards contract query parameters. Network failure reads as retry; a
 * caller abort propagates as a throw so React state stays owned by the caller. */
export async function fetchProphetSectorMembers(query: SectorMembersFetch = {}): Promise<SectorMembersRead> {
  const params = new URLSearchParams();
  if (query.group !== undefined) params.set("group", query.group);
  if (query.symbol !== undefined) params.set("symbol", query.symbol);
  if (query.offset !== undefined) params.set("offset", String(query.offset));
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.q !== undefined && query.q !== null) params.set("q", query.q);
  if (query.state !== undefined && query.state !== null) params.set("state", query.state);
  const search = params.toString();
  let response: Response;
  try {
    response = await fetch(search ? `${SECTOR_MEMBERS_URL}?${search}` : SECTOR_MEMBERS_URL,
      { credentials: "same-origin", cache: "no-store", signal: query.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return { status: "retry" };
  }
  let body: unknown = null;
  try { body = await response.json(); } catch { body = null; }
  return classifySectorMembersResponse(response.status, body);
}
