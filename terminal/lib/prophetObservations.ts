/** A bounded, display-only consumer of Macro's existing B03 observation contract. */
export const PROPHET_OBSERVATION_SCHEMA = "prophet.early_observations/v1";
const ACTIONS = ["buy", "alert", "entry_open", "rank", "size", "episode_write"] as const;
export type ProphetAuthority = Record<(typeof ACTIONS)[number], false>;
export const TRIGGER_NAMES: Record<string, readonly [string, string]> = {
  dot_1d: ["Daily turn", "日线转向"], pre_confluence_2d: ["Early 2-day confluence", "两日线早期共振"],
  basket_turn: ["Group turn", "板块转向"], leader_reset_turn: ["Leader pullback turn", "领涨股回调转向"],
};
export type ProphetTrigger = { fired: boolean; evaluated: boolean; last_date: string | null; days_since: number | null };
export type ProphetSourceTiming = {
  asof: string | null; close: number | null; reset_low: number | null; reset_low_date: string | null;
  off_reset_low_pct: number | null; slow_tier_eligible: boolean | null; slow_tier_tier: string | null;
  slow_tier_bars_to_cross_3d: number | null; slow_tier_blocking: string[] | null;
  slow_tier_evaluated: boolean | null; slow_tier_above_200dma: boolean | null;
};
export type ProphetUniverseCoverage = {
  state: "VERIFIED_SOURCE_PARTITION" | "UNAVAILABLE"; reason: string | null;
  selection_era: string | null; tickers_sha256: string | null;
  published_proof_sha256: string | null; source_session: string | null;
};
export type ProphetSubjectCoverage = {
  ticker: string; state: "VERIFIED_SOURCE_PARTITION" | "IN_UNIVERSE_NO_RECORDED_TRIGGER" | "NOT_IN_UNIVERSE" | "UNAVAILABLE";
  reason: string | null;
};
export type ProphetObservation = {
  ticker: string; security_id: string | null; identity_basis: string; source_event_id: string;
  source_receipt: string; source_session: string; source_visibility: string; triggers_fired: string[];
  source_timing?: ProphetSourceTiming | null;
  source_evidence: { triggers: Record<string, ProphetTrigger>; counterevidence: string[] | null; counterevidence_state: string };
  lineage: { selection_era: string | null; anchor_era: string | null; source_artifact_receipt: string | null };
  episode_relation: { state: string; reason: string; episode_id: string | null; generation_id: string | null };
  authority: ProphetAuthority;
};
export type ProphetProjection = {
  schema: typeof PROPHET_OBSERVATION_SCHEMA; market: "US"; status: "CURRENT_SESSION" | "RETAINED_PREVIOUS_SESSION";
  source_receipt: string; snapshot_id: string; reference_session: string;
  clocks: { source_session: string; logical_known_at: string | null; actual_clock_state: string };
  coverage: { state: string; total: number | null; featured: number | null; beyond_cap: number | null; source_artifact_receipt: string | null };
  universe_coverage?: ProphetUniverseCoverage | null; subject_coverage?: ProphetSubjectCoverage | null;
  rows: ProphetObservation[]; authority: ProphetAuthority;
  counts: { source: number; matched: number; returned: number };
  page: { offset: number; limit: number; next_offset: number | null };
};
export type ProphetReadStatus = "loading" | "ready" | "unavailable" | "unauthenticated" | "forbidden" | "unsupported";
export type ProphetObservationRead = {
  symbol: string; account: string | null; status: ProphetReadStatus; data: ProphetProjection | null;
  retry?: () => void;
};
const object = (x: unknown): Record<string, unknown> | null => x !== null && typeof x === "object" && !Array.isArray(x) ? x as Record<string, unknown> : null;
const text = (x: unknown, max = 256): string | null => typeof x === "string" && x.length > 0 && x.length <= max ? x : null;
const count = (x: unknown): x is number => typeof x === "number" && Number.isSafeInteger(x) && x >= 0;
const receipt = (x: unknown): x is string => typeof x === "string" && /^sha256:[0-9a-f]{64}$/.test(x);
const date = (x: unknown): x is string => {
  if (typeof x !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(x)) return false;
  const ms = Date.parse(x + "T00:00:00Z");
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === x;
};
function authority(x: unknown): ProphetAuthority | null {
  const a = object(x);
  if (!a || ACTIONS.some(key => a[key] !== false)) return null;
  return Object.fromEntries(ACTIONS.map(key => [key, false])) as ProphetAuthority;
}
export function isProphetTicker(ticker: string): boolean {
  return /^[A-Z][A-Z0-9.-]{0,31}$/.test(ticker)
    && !/(-USD|-EUR|-GBP|\.(HK|SS|SZ))$/.test(ticker);
}
function strings(x: unknown, max = 24): string[] | null {
  return Array.isArray(x) && x.length <= max && x.every(v => text(v, 128) !== null) ? [...x] as string[] : null;
}

function sourceTiming(raw: unknown, session: string): ProphetSourceTiming | null | false {
  if (raw == null) return null;
  const t = object(raw);
  if (!t) return false;
  for (const key of ["asof", "reset_low_date"]) {
    if (t[key] != null && (!date(t[key]) || (t[key] as string) > session)) return false;
  }
  if (typeof t.asof === "string" && typeof t.reset_low_date === "string" && t.reset_low_date > t.asof) return false;
  for (const key of ["close", "reset_low", "off_reset_low_pct", "slow_tier_bars_to_cross_3d"]) {
    const value = t[key];
    if (value != null && (typeof value !== "number" || !Number.isFinite(value))) return false;
  }
  if ((typeof t.close === "number" && t.close <= 0) || (typeof t.reset_low === "number" && t.reset_low <= 0)
    || (typeof t.slow_tier_bars_to_cross_3d === "number" && t.slow_tier_bars_to_cross_3d < 0)) return false;
  for (const key of ["slow_tier_eligible", "slow_tier_evaluated", "slow_tier_above_200dma"]) {
    if (t[key] != null && typeof t[key] !== "boolean") return false;
  }
  if (t.slow_tier_tier != null && !text(t.slow_tier_tier, 32)) return false;
  const blocking = t.slow_tier_blocking == null ? null : strings(t.slow_tier_blocking);
  if (t.slow_tier_blocking != null && blocking === null) return false;
  return {
    asof: (t.asof ?? null) as string | null, close: (t.close ?? null) as number | null,
    reset_low: (t.reset_low ?? null) as number | null, reset_low_date: (t.reset_low_date ?? null) as string | null,
    off_reset_low_pct: (t.off_reset_low_pct ?? null) as number | null,
    slow_tier_eligible: (t.slow_tier_eligible ?? null) as boolean | null,
    slow_tier_tier: (t.slow_tier_tier ?? null) as string | null,
    slow_tier_bars_to_cross_3d: (t.slow_tier_bars_to_cross_3d ?? null) as number | null,
    slow_tier_blocking: blocking, slow_tier_evaluated: (t.slow_tier_evaluated ?? null) as boolean | null,
    slow_tier_above_200dma: (t.slow_tier_above_200dma ?? null) as boolean | null,
  };
}

/** Null means malformed/unavailable, never an evaluated negative or a new recommendation. */
export function decodeProphetObservations(raw: unknown, ticker: string): ProphetProjection | null {
  const r = object(raw), c = object(r?.clocks), cov = object(r?.coverage), counts = object(r?.counts), page = object(r?.page);
  const auth = authority(r?.authority);
  if (!isProphetTicker(ticker) || !r || r.schema !== PROPHET_OBSERVATION_SCHEMA || r.market !== "US" || !auth || !c || !cov || !counts || !page) return null;
  if (r.status !== "CURRENT_SESSION" && r.status !== "RETAINED_PREVIOUS_SESSION") return null;
  if (!date(c.source_session) || !date(r.reference_session) || c.source_session > r.reference_session) return null;
  if ((r.status === "CURRENT_SESSION") !== (c.source_session === r.reference_session)) return null;
  if (!receipt(r.source_receipt) || typeof r.snapshot_id !== "string" || !/^early:[0-9a-f]{64}$/.test(r.snapshot_id)) return null;
  if (!Array.isArray(r.rows) || r.rows.length > 50 || !count(counts.source) || !count(counts.matched) || !count(counts.returned)
    || counts.returned !== r.rows.length || counts.source < counts.matched || counts.matched < counts.returned
    || !count(page.offset) || page.offset !== 0 || !count(page.limit) || page.limit < 1 || page.limit > 100
    || (page.next_offset !== null && !count(page.next_offset))) return null;
  let universe: ProphetUniverseCoverage | null = null, subject: ProphetSubjectCoverage | null = null;
  if (r.universe_coverage != null) {
    const u = object(r.universe_coverage);
    if (!u || !["VERIFIED_SOURCE_PARTITION", "UNAVAILABLE"].includes(String(u.state))) return null;
    const hash = (x: unknown): string | null => typeof x === "string" && /^[0-9a-f]{64}$/.test(x) ? x : null;
    universe = { state: u.state as ProphetUniverseCoverage["state"], reason: text(u.reason, 128),
      selection_era: text(u.selection_era, 128), tickers_sha256: hash(u.tickers_sha256),
      published_proof_sha256: hash(u.published_proof_sha256), source_session: date(u.source_session) ? u.source_session : null };
    if (universe.state === "VERIFIED_SOURCE_PARTITION" && (!universe.selection_era || !universe.tickers_sha256
      || !universe.published_proof_sha256 || universe.source_session !== c.source_session
      || cov.state !== "VERIFIED_SOURCE_PARTITION" || cov.source_artifact_receipt !== `sha256:${universe.published_proof_sha256}`)) return null;
  }
  if (r.subject_coverage != null) {
    const sc = object(r.subject_coverage);
    if (!sc || sc.ticker !== ticker || !["VERIFIED_SOURCE_PARTITION", "IN_UNIVERSE_NO_RECORDED_TRIGGER", "NOT_IN_UNIVERSE", "UNAVAILABLE"].includes(String(sc.state))) return null;
    subject = { ticker, state: sc.state as ProphetSubjectCoverage["state"], reason: text(sc.reason, 128) };
    if (subject.state !== "UNAVAILABLE" && universe?.state !== "VERIFIED_SOURCE_PARTITION") return null;
    if (subject.state === "IN_UNIVERSE_NO_RECORDED_TRIGGER" && r.rows.length !== 0) return null;
  }
  const rows: ProphetObservation[] = [], identities = new Set<string>();
  for (const value of r.rows) {
    const row = object(value), evidence = object(row?.source_evidence), triggers = object(evidence?.triggers);
    const relation = object(row?.episode_relation), lineage = object(row?.lineage), rowAuth = authority(row?.authority);
    if (!row || !evidence || !triggers || !relation || !lineage || !rowAuth || row.ticker !== ticker
      || row.source_session !== c.source_session || row.source_receipt !== r.source_receipt
      || typeof row.source_event_id !== "string" || !/^turn_watch:[0-9a-f]{64}$/.test(row.source_event_id)
      || identities.has(row.source_event_id)) return null;
    const timing = sourceTiming(row.source_timing, c.source_session);
    if (timing === false) return null;
    identities.add(row.source_event_id);
    const fired = strings(row.triggers_fired, 4), blockers = evidence.counterevidence === null ? null : strings(evidence.counterevidence);
    if (!fired || !fired.length || new Set(fired).size !== fired.length || fired.some(t => !Object.hasOwn(TRIGGER_NAMES, t))
      || (evidence.counterevidence !== null && blockers === null)) return null;
    const safeTriggers: Record<string, ProphetTrigger> = {};
    for (const [id, value] of Object.entries(triggers)) {
      const t = object(value);
      if (!Object.hasOwn(TRIGGER_NAMES, id) || !t || typeof t.fired !== "boolean" || typeof t.evaluated !== "boolean"
        || (t.last_date !== null && (!date(t.last_date) || t.last_date > c.source_session))
        || (t.days_since !== null && !count(t.days_since))) return null;
      safeTriggers[id] = { fired: t.fired, evaluated: t.evaluated, last_date: t.last_date as string | null, days_since: t.days_since as number | null };
    }
    if (fired.some(id => !safeTriggers[id]?.fired || !safeTriggers[id]?.evaluated)) return null;
    const state = text(relation.state, 64), reason = text(relation.reason, 128), basis = text(row.identity_basis, 64);
    if (!state || !reason || !basis || !text(evidence.counterevidence_state, 64)
      || !["FEATURED", "BEYOND_CAP", "UNAVAILABLE"].includes(String(row.source_visibility))) return null;
    const security = row.security_id === null ? null : text(row.security_id, 132);
    if (row.security_id !== null && (!security || !/^SEC:[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(security))) return null;
    const episode = relation.episode_id === null ? null : text(relation.episode_id, 256);
    const generation = relation.generation_id === null ? null : text(relation.generation_id, 68);
    if ((relation.episode_id !== null && (!episode || !episode.startsWith("pe:SEC:")))
      || (relation.generation_id !== null && (!generation || !/^peg:[0-9a-f]{64}$/.test(generation)))
      || (state === "EXACT_EPISODE" && (!episode || !generation))) return null;
    rows.push({ ticker, security_id: security, identity_basis: basis, source_event_id: row.source_event_id,
      source_receipt: row.source_receipt as string, source_session: c.source_session, source_visibility: String(row.source_visibility),
      source_timing: timing, triggers_fired: fired, source_evidence: { triggers: safeTriggers, counterevidence: blockers, counterevidence_state: String(evidence.counterevidence_state) },
      lineage: { selection_era: text(lineage.selection_era, 128), anchor_era: text(lineage.anchor_era, 128),
        source_artifact_receipt: receipt(lineage.source_artifact_receipt) ? lineage.source_artifact_receipt : null },
      episode_relation: { state, reason, episode_id: episode, generation_id: generation }, authority: rowAuth });
  }
  return { schema: PROPHET_OBSERVATION_SCHEMA, market: "US", status: r.status,
    source_receipt: r.source_receipt, snapshot_id: r.snapshot_id, reference_session: r.reference_session,
    clocks: { source_session: c.source_session, logical_known_at: text(c.logical_known_at, 64), actual_clock_state: text(c.actual_clock_state, 64) ?? "NOT_RECORDED" },
    coverage: { state: text(cov.state, 64) ?? "UNAVAILABLE", total: count(cov.total) ? cov.total : null,
      featured: count(cov.featured) ? cov.featured : null, beyond_cap: count(cov.beyond_cap) ? cov.beyond_cap : null,
      source_artifact_receipt: receipt(cov.source_artifact_receipt) ? cov.source_artifact_receipt : null },
    universe_coverage: universe, subject_coverage: subject, rows, authority: auth, counts: { source: counts.source, matched: counts.matched, returned: counts.returned },
    page: { offset: 0, limit: page.limit, next_offset: page.next_offset as number | null } };
}

export function prophetObservationSummary(read: ProphetObservationRead, zh: boolean): { label: string; detail: string; current: boolean } {
  const pick = (en: string, cn: string) => zh ? cn : en;
  const stateLabels: Record<Exclude<ProphetReadStatus, "ready">, string> = {
    loading: pick("Checking early evidence…", "正在检查早期迹象…"),
    unavailable: pick("Source unavailable", "数据源不可用"), unauthenticated: pick("Sign in to view", "登录后查看"),
    forbidden: pick("Plan access required", "需相应订阅权限"), unsupported: pick("Not a US scan", "非美股扫描范围"),
  };
  if (read.status !== "ready") return { label: stateLabels[read.status], detail: "", current: false };
  const data = read.data;
  if (!data) return { label: stateLabels.unavailable, detail: "", current: false };
  if (!data.rows.length) {
    const state = data.subject_coverage?.state;
    const label = state === "NOT_IN_UNIVERSE" ? pick("Not monitored by this scan", "未纳入此扫描")
      : state === "IN_UNIVERSE_NO_RECORDED_TRIGGER" ? pick("No recent recorded turn", "近期无转向记录")
      : pick("Coverage not reported", "未提供覆盖信息");
    return { label, detail: data.clocks.source_session, current: false };
  }
  const first = data.rows[0], label = TRIGGER_NAMES[first.triggers_fired[0]];
  // Only an explicit per-name clock may establish fresh completed-session evidence.
  const current = data.status === "CURRENT_SESSION"
    && data.rows.every(row => row.source_timing?.asof === data.reference_session);
  return { label: current ? pick("Early evidence — review", "早期迹象 · 待评估") : pick("Recorded evidence", "已记录迹象"),
    detail: `${data.clocks.source_session} · ${label?.[zh ? 1 : 0] ?? ""}`, current };
}
