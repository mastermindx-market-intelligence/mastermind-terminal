/**
 * Source-owned market-risk contract used by the Oracle chip and Copilot.
 * Supports the flat ingest projection plus legacy raw Macro wrappers. It never
 * recalculates a verdict, adds hazard scores, or grants capital authority.
 */
export type MarketRiskRead = {
  verdict: "RISK_ON" | "MIXED" | "RISK_OFF";
  score: number | null;
  raw_score: number | null;
  score_source: string | null;
  capped: boolean | null;
  score_caps: unknown[];
  label_en: string | null;
  label_zh: string | null;
  color: string | null;
  headline_en: string | null;
  headline_zh: string | null;
  asof: string | null;
  built: string | null;
  source_event_time: string | null;
  stale_after: string | null;
  source_basis: string;
  cause_basis: string;
  source_verdict: string | null;
  display_pending: Record<string, unknown> | null;
  source_path: string | null;
  stale: boolean;
  stale_reasons: string[];
  age_hours: number | null;
  realtime: boolean;
  radar: Record<string, unknown> | null;
  risk_envelope: Record<string, unknown> | null;
  risk_envelope_freshness: { qualified: boolean; reasons: string[] };
  is_display_only: true;
};

const DAY = 86_400_000;
const VERDICTS = new Set(["RISK_ON", "MIXED", "RISK_OFF"]);
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;
const numeric = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

function sessionDate(value: unknown): number | null {
  const day = text(value)?.slice(0, 10);
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const parsed = Date.parse(day + "T00:00:00Z");
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === day
    ? parsed : null;
}

function timestamp(value: unknown): number | null {
  const valueText = text(value);
  if (!valueText || sessionDate(valueText) === null || !/[T ]\d{2}:\d{2}:\d{2}/.test(valueText)
    || !/(?:Z|[+-]\d{2}:\d{2}|UTC)$/.test(valueText)) return null;
  const parsed = Date.parse(valueText);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeMarketRisk(raw: unknown, nowMs = Date.now()): MarketRiskRead | null {
  const source = record(raw);
  const schema = text(source.schema);
  const display = record(source.display);
  const wrapped = schema === "risk_state.v1" || (!schema && Object.keys(display).length > 0);
  const legacy = wrapped && !schema && source.live_active === undefined;
  const active = wrapped && source.live_active === true;
  const nightly = record(source.nightly);
  const live = record(source.live);
  let selected = source;
  let native = source;
  let basis = text(source.source_basis) ?? "settled";
  let cause = text(source.cause_basis) ?? basis;
  if (wrapped) {
    selected = active ? { ...live, ...display } : legacy ? display : { ...display, ...nightly };
    native = active ? { ...live, ...Object.fromEntries(
      ["raw_score", "score_source", "capped", "score_caps", "score_ceiling", "score_gap"]
        .filter(key => key in display).map(key => [key, display[key]])) } : legacy ? display : nightly;
    basis = active ? "live_display" : legacy ? "legacy_display" : "settled";
    cause = basis;
    if (active && live.verdict !== selected.verdict) cause = "live_score_pending_band";
  }
  if (!VERDICTS.has(String(selected.verdict))) return null;

  const reasons = new Set<string>();
  if (!wrapped && schema !== "market_risk/v1" && schema !== "market_state.v1") {
    reasons.add("unknown_source_schema");
  }
  if (!Number.isFinite(nowMs)) reasons.add("invalid_now");
  const currentDay = Number.isFinite(nowMs) ? Math.floor(nowMs / DAY) * DAY : NaN;
  let asof = text(wrapped ? source.nightly_asof ?? (legacy ? source.asof : null) : source.asof);
  const built = text(source.built ?? source.produced_at);
  const eventTime = text(source.source_event_time ?? (active ? live.source_event_time : null));
  const expiry = text(source.stale_after);
  const ownFreshness = record(source.freshness);
  const nestedOwner = record(ownFreshness.owner);
  for (const reason of Array.isArray(ownFreshness.reasons) ? ownFreshness.reasons : []) {
    if (typeof reason === "string") reasons.add(reason);
  }
  if (ownFreshness.qualified === false) reasons.add("owner_unqualified");
  if (ownFreshness.stale === true || nestedOwner.stale === true) reasons.add("owner_stale");
  if (source.stale === true && (!wrapped || active || legacy)) reasons.add("source_stale");

  const buildClock = timestamp(built);
  const eventClock = timestamp(eventTime);
  if (active && eventClock !== null) asof = new Date(eventClock).toISOString().slice(0, 10);
  const session = sessionDate(asof);
  const expiryClock = timestamp(expiry);
  const maxDays = numeric(ownFreshness.max_stale_days) ?? 5;
  if (session === null) reasons.add("missing_or_invalid_asof");
  else if (session > currentDay) reasons.add("future_asof");
  else if (currentDay - session >= Math.max(1, maxDays) * DAY) reasons.add("expired_asof");
  for (const [name, value, clock] of [
    ["built", source.built ?? source.produced_at, buildClock],
    ["source_event_time", source.source_event_time ?? (active ? live.source_event_time : null), eventClock],
  ] as const) {
    if (value != null && clock === null) reasons.add("invalid_" + name);
    else if (clock !== null && clock > nowMs) reasons.add("future_" + name);
  }
  if (active || source.source_basis === "live_display") {
    if (eventClock === null) reasons.add("missing_live_source_clock");
    if (expiryClock === null) reasons.add("missing_live_expiry");
  }
  if (source.stale_after != null && expiryClock === null) reasons.add("invalid_stale_after");
  if (expiryClock !== null && expiryClock <= nowMs) reasons.add("expired_source");

  let score = numeric(selected.score);
  if (selected.score !== undefined && selected.score !== null && (score === null || score < 0 || score > 100)) {
    reasons.add("invalid_score");
    score = null;
  }
  const staleReasons = Array.from(reasons).sort();
  const ageClock = active || source.source_basis === "live_display" ? eventClock : session;
  const envelopeRead = qualifyRiskEnvelope(source.risk_envelope, asof, nowMs);
  const mirroredQualification = record(source.risk_envelope_freshness);
  const envelopeReasons = source.risk_envelope == null && Array.isArray(mirroredQualification.reasons)
    ? mirroredQualification.reasons.filter((value): value is string => typeof value === "string")
    : envelopeRead.reasons;
  return {
    verdict: selected.verdict as MarketRiskRead["verdict"],
    score,
    raw_score: numeric(native.raw_score),
    score_source: text(native.score_source),
    capped: typeof native.capped === "boolean" ? native.capped : null,
    score_caps: Array.isArray(native.score_caps) ? native.score_caps : [],
    label_en: text(selected.label_en),
    label_zh: text(selected.label_zh),
    color: text(selected.color),
    headline_en: text((active || legacy ? selected : native).headline_en),
    headline_zh: text((active || legacy ? selected : native).headline_zh),
    asof, built, source_event_time: eventTime, stale_after: expiry,
    source_basis: basis, cause_basis: cause, source_path: text(source.source_path),
    source_verdict: text(native.source_verdict ?? native.verdict),
    display_pending: Object.keys(record(wrapped ? display.pending : source.display_pending)).length
      ? record(wrapped ? display.pending : source.display_pending) : null,
    stale: staleReasons.length > 0,
    stale_reasons: staleReasons,
    age_hours: ageClock !== null && Number.isFinite(nowMs) ? Math.round((nowMs - ageClock) / 3_600_000) : null,
    realtime: source.realtime === true && (active || source.source_basis === "live_display") && staleReasons.length === 0,
    radar: Object.keys(record(active ? live.radar : native.radar)).length
      ? record(active ? live.radar : native.radar) : null,
    risk_envelope: envelopeRead.envelope,
    risk_envelope_freshness: { qualified: envelopeRead.qualified, reasons: envelopeReasons },
    is_display_only: true,
  };
}

/** Qualified transport of the canonical descriptive envelope. Per-source coverage
 * remains native: an old optional organ does not invalidate fresh measured state.
 */
export type RiskEnvelopeQualification = {
  envelope: Record<string, unknown> | null;
  qualified: boolean;
  reasons: string[];
};
const ENVELOPE_FIELDS = [
  "schema", "definition_id", "market", "revision", "bundle_id", "source_session",
  "as_of", "observed_at", "produced_at", "stale_after", "measured_state",
  "hazard_summary", "policy_summary", "data_state", "authority", "coverage",
  "freshness", "coherence", "rotation_context", "confluence", "market_transition",
] as const;
const AUTHORITY_FLAGS = [
  "envelope_may_execute", "envelope_may_gate", "envelope_may_rank", "envelope_may_size",
] as const;

function finiteJson(value: unknown, depth = 0): boolean {
  if (depth > 24) return false;
  if (typeof value === "number") return Number.isFinite(value);
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.every(item => finiteJson(item, depth + 1));
  if (value && typeof value === "object") return Object.values(value).every(item => finiteJson(item, depth + 1));
  return false;
}

export function qualifyRiskEnvelope(
  raw: unknown, selectedSession?: string | null, nowMs = Date.now(),
): RiskEnvelopeQualification {
  const source = record(raw), reasons = new Set<string>();
  if (!Object.keys(source).length) return { envelope: null, qualified: false, reasons: ["missing_envelope"] };
  if (source.schema !== "mastermind.risk_envelope/v1") reasons.add("invalid_schema");
  const session = text(source.source_session), sessionMs = sessionDate(session);
  const currentDay = Math.floor(nowMs / DAY) * DAY;
  if (!Number.isFinite(nowMs)) reasons.add("invalid_now");
  if (sessionMs === null || session !== new Date(sessionMs).toISOString().slice(0, 10)
    || sessionMs > currentDay || currentDay - sessionMs >= 5 * DAY) {
    reasons.add("invalid_future_or_expired_session");
  }
  if (source.as_of !== session || (selectedSession !== undefined && session !== selectedSession)) {
    reasons.add("source_session_mismatch");
  }
  if (!["FRESH", "PARTIAL", "DEGRADED"].includes(String(source.data_state))) reasons.add("unusable_data_state");
  if (!text(source.bundle_id)) reasons.add("missing_bundle_id");
  for (const key of ["measured_state", "hazard_summary", "policy_summary"]) {
    if (!source[key] || typeof source[key] !== "object" || Array.isArray(source[key])) reasons.add("invalid_" + key);
  }
  const measured = record(source.measured_state);
  if (measured.usable === true && measured.as_of !== session) reasons.add("measured_session_mismatch");
  const authority = record(source.authority);
  if (AUTHORITY_FLAGS.some(key => authority[key] !== false)) reasons.add("unqualified_authority");
  const observed = timestamp(source.observed_at), produced = timestamp(source.produced_at);
  for (const [key, clock] of [["observed_at", observed], ["produced_at", produced]] as const) {
    if (clock === null) reasons.add("missing_or_invalid_" + key);
    else if (clock > nowMs) reasons.add("future_" + key);
  }
  if (observed !== null && produced !== null && observed > produced) reasons.add("incoherent_publication_clocks");
  const expiry = timestamp(source.stale_after);
  if ((source.stale_after != null && expiry === null) || (expiry !== null && expiry <= nowMs)) {
    reasons.add("invalid_or_expired_envelope");
  }
  if (source.revision === "live_provisional" && expiry === null) reasons.add("missing_live_expiry");
  const freshness = record(source.freshness);
  if (freshness.source_session != null && freshness.source_session !== session) reasons.add("freshness_session_mismatch");
  if (source.stale === true || freshness.stale === true) reasons.add("owner_stale");
  const confluence = record(source.confluence);
  if (Object.keys(confluence).length && ["statistical_independence_established", "changes_hazard_stage", "changes_policy"]
    .some(key => confluence[key] !== false)) reasons.add("invalid_confluence_authority");
  if (!finiteJson(source)) reasons.add("invalid_json_values");
  const qualified = reasons.size === 0;
  return {
    envelope: qualified ? Object.fromEntries(ENVELOPE_FIELDS.filter(key => key in source).map(key => [key, source[key]])) : null,
    qualified, reasons: Array.from(reasons).sort(),
  };
}

/** Plain-language labels for native values; this does not classify a market. */
export function riskEnvelopeCopy(envelope: Record<string, unknown> | null, zh: boolean): { caption: string; details: string[] } {
  const unavailable = zh ? "不可用" : "Unavailable";
  const label = (value: unknown, labels: Record<string, readonly [string, string]>) => {
    const pair = labels[String(value)];
    return pair ? pair[zh ? 1 : 0] : unavailable;
  };
  const verdicts = { RISK_ON: ["Risk on", "风险偏好"], MIXED: ["Mixed", "混合"], RISK_OFF: ["Risk off", "风险规避"] } as const;
  if (!envelope) return {
    caption: zh ? "市场背景与短期轮动信息不可用。" : "Market backdrop and early rotation context unavailable.",
    details: [zh ? "缺失、过期或无法核实的数据不会被视为平静市场。" : "Missing, expired or unqualified data does not imply calm conditions."],
  };
  const measured = record(envelope.measured_state), rotation = record(envelope.rotation_context);
  const early = record(rotation.early_context), confluence = record(envelope.confluence);
  const hazard = record(envelope.hazard_summary), policy = record(envelope.policy_summary);
  const backdrop = measured.usable === true ? label(measured.verdict, verdicts) : unavailable;
  const rotationLabel = rotation.usable === true ? label(rotation.state, {
    DEFENSIVE_RELATIVE_STRENGTH: ["Defensive relative strength", "防御板块相对走强"],
    BROADENING: ["Broader-market proxies gaining relative strength", "更广市场代理相对转强"],
    MIXED_ROTATION: ["Defensive groups and broader-market proxies gaining relative strength", "防御板块与更广市场代理相对转强"],
    NO_EARLY_SHIFT: ["No early relative shift", "暂无早期相对变化"],
  }) : unavailable;
  const sourceDate = text(early.as_of) ?? text(rotation.as_of) ?? text(envelope.source_session);
  const caption = zh
    ? `市场背景：${backdrop} · 短期轮动：${rotationLabel} · ${sourceDate ?? "日期不可用"}`
    : `Market backdrop: ${backdrop} · Early rotation: ${rotationLabel} · ${sourceDate ?? "Date unavailable"}`;
  const stage = label(hazard.stage, {
    NONE: ["None", "无"], FRAGILE: ["Fragile", "脆弱"], TRANSMITTING: ["Transmitting", "传导中"], BREAKDOWN: ["Breakdown", "失稳"],
  });
  const details = [
    zh ? `风险阶段（来源判断）：${stage}。观测日期：${text(envelope.source_session) ?? "不可用"}。`
      : `Source hazard stage: ${stage}. Observation session: ${text(envelope.source_session) ?? "unavailable"}.`,
    zh ? "短期相对强弱与较长期趋势保留各自含义；相对抗跌不证明资金流入或同一投资者调仓。"
      : "Early relative strength and longer-term trends retain their separate meanings. Relative resilience does not establish inflows or a transfer by the same investor.",
  ];
  if (policy.basis === "zero_active_policies") details.push(zh
    ? "当前没有生效的风险政策；这不代表市场风险为零。"
    : "No risk policy is active; this does not mean market risk is zero.");
  const count = numeric(confluence.nonredundant_component_count);
  if (Object.keys(confluence).length) details.push(count === null
    ? zh ? "证据来源关系不完整，无法给出剔除重复后的总数。未确立统计独立性；轮动信息不提高风险等级或政策权限。"
      : "Evidence lineage is incomplete, so the total after removing overlap is unavailable. Statistical independence is unproven; rotation context does not raise hazard or policy authority."
    : zh ? `按已记录来源合并重叠后为${count}组。未确立统计独立性；轮动信息不提高风险等级或政策权限。`
      : `${count} source group${count === 1 ? "" : "s"} after recorded overlap is grouped. Statistical independence is unproven; rotation context does not raise hazard or policy authority.`);
  const transition = record(envelope.market_transition), change = record(transition.latest_recorded_change);
  const before = record(change.before), after = record(change.after);
  if (change.verdict_changed === true && text(before.asof) && text(after.asof)) details.push(zh
    ? `最近记录的状态变化：${label(before.verdict, verdicts)} → ${label(after.verdict, verdicts)}（${text(before.asof)} → ${text(after.asof)}）。当前快照本身不确定变化发生时间。`
    : `Last recorded state change: ${label(before.verdict, verdicts)} → ${label(after.verdict, verdicts)} (${text(before.asof)} → ${text(after.asof)}). The current snapshot alone does not date the transition.`);
  else details.push(zh ? "现有记录未确立最近一次状态变化的日期。" : "The available record does not establish the date of a latest state change.");
  return { caption, details };
}
