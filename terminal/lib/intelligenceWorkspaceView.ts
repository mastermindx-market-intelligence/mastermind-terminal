/** Source-preserving presentation helpers. This module makes no trading decisions. */
export type SourceClock = { kind: "dated"; date: string; ageDays: number } | { kind: "unknown" }

export function workspaceSourceClock(value: unknown, now = Date.now()): SourceClock {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value)) return { kind: "unknown" }
  const timestamp = Date.parse(value.length === 10 ? `${value}T00:00:00Z` : value)
  if (!Number.isFinite(timestamp) || timestamp > now + 86_400_000) return { kind: "unknown" }
  const day = value.slice(0, 10)
  // Reject normalized impossible dates such as February 30.
  if (new Date(Date.parse(`${day}T00:00:00Z`)).toISOString().slice(0, 10) !== day) return { kind: "unknown" }
  return { kind: "dated", date: value, ageDays: Math.max(0, Math.floor((now - timestamp) / 86_400_000)) }
}

export interface WorkspaceCurve {
  dates: string[]
  values: (number | null)[]
  asOf: string | null
  start: string | null
  end: string | null
  note: string | null
  validationSupplied: boolean
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value)
const strings = (value: unknown) => Array.isArray(value) && value.every(item => typeof item === "string")
const optionalFields = (source: Record<string, unknown>, keys: string[], accepts: (value: unknown) => boolean) => keys.every(key => source[key] == null || accepts(source[key]))
const stringFields = (source: Record<string, unknown>, keys: string[]) => optionalFields(source, keys, value => typeof value === "string")
const numberFields = (source: Record<string, unknown>, keys: string[]) => optionalFields(source, keys, value => typeof value === "number" && Number.isFinite(value))
const booleanFields = (source: Record<string, unknown>, keys: string[]) => optionalFields(source, keys, value => typeof value === "boolean")

/** Validate only the established shapes consumed by this view. A malformed
 * source is unavailable, never an empty signal history or a React exception. */
export function workspaceSourceValid(kind: "intel" | "slice" | "backtest", raw: unknown): boolean {
  if (!record(raw)) return false
  if (kind === "backtest") return true // workspaceCurve validates the two curve contracts.
  if (kind === "slice") {
    if (!record(raw.indicator)) return false
    const indicator = raw.indicator
    if (!optionalFields(indicator, ["state"], record)) return false
    if (record(indicator.state) && (!stringFields(indicator.state, ["last_signal", "last_scored_signal", "last_scored_ts", "position_hint", "last_scored_basis"])
      || !numberFields(indicator.state, ["bars_since_signal"])
      || !booleanFields(indicator.state, ["extended", "strong_bull", "overbought", "weeklyBull", "above200"]))) return false
    if (!optionalFields(indicator, ["signals"], value => Array.isArray(value) && value.every(signal => record(signal)
      && typeof signal.ts === "string" && typeof signal.type === "string"
      && stringFields(signal, ["known_ts", "quality", "quality_reason", "tier", "score_basis", "basis", "subtype", "risk_basis"])
      && numberFields(signal, ["strength", "price", "score", "stop_level", "prior_stop_level", "sweep_low"])
      && optionalFields(signal, ["reasons"], strings)
      && booleanFields(signal, ["blocked", "retro_override", "override_candidate", "scored"])
      && optionalFields(signal, ["regime"], record)
      && optionalFields(signal, ["retro_ctx", "override_ctx"], field => record(field) && stringFields(field, ["group_id", "name", "name_zh"]))
      && (!record(signal.override_ctx) || numberFields(signal.override_ctx, ["peer_dd"]))))) return false
    if (!optionalFields(indicator, ["warnings"], value => Array.isArray(value) && value.every(warning => record(warning) && typeof warning.ts === "string" && typeof warning.kind === "string"))) return false
    if (!optionalFields(raw, ["opportunities", "backtest"], record)) return false
    if (record(raw.opportunities) && !optionalFields(raw.opportunities, ["events"], value => Array.isArray(value) && value.every(event => record(event)
      && stringFields(event, ["id", "system", "definition", "authority", "surfaced_at", "entry_date", "entry_basis", "tier", "state"])
      && numberFields(event, ["entry_price", "rank", "latest_price", "return_pct", "excess_pct", "sessions"])))) return false
    if (record(raw.backtest) && (!optionalFields(raw.backtest, ["metrics"], record) || !numberFields(raw.backtest, ["n_trades"]))) return false
    if (record(raw.backtest) && record(raw.backtest.metrics) && !numberFields(raw.backtest.metrics, ["n_trades", "win_rate", "profit_factor", "cagr"])) return false
    return true
  }
  if (!record(raw.cards) && !record(raw.analysis)) return false
  if (!stringFields(raw, ["asof"]) || !optionalFields(raw, ["cards", "analysis", "tape"], record)) return false
  const analysis = record(raw.analysis) ? raw.analysis : {}
  if (!optionalFields(analysis, ["decision"], record)) return false
  if (record(analysis.decision) && (!stringFields(analysis.decision, ["verb", "verb_zh", "tone", "headline", "headline_zh", "gloss", "gloss_zh",
    "band", "band_label", "band_label_zh", "name_label", "name_label_zh", "trust_tier", "trust_en", "trust_zh"])
    || !numberFields(analysis.decision, ["score"]))) return false
  const cards = record(raw.cards) ? raw.cards : {}
  if (!optionalFields(cards, ["ai_judgment", "conviction"], record)) return false
  if (record(cards.ai_judgment) && (!stringFields(cards.ai_judgment, ["verdict", "verdict_zh", "gloss", "gloss_zh"]) || !numberFields(cards.ai_judgment, ["size_pct"]))) return false
  if (record(cards.conviction) && (!numberFields(cards.conviction, ["score"]) || !stringFields(cards.conviction, ["band", "band_zh"])
    || !optionalFields(cards.conviction, ["drivers", "cautions", "cautions_zh"], strings))) return false
  const tape = record(raw.tape) ? raw.tape : {}
  if (!stringFields(tape, ["asof"]) || !optionalFields(tape, ["ai_lean", "sector_pulse"], record)) return false
  if (record(tape.ai_lean) && (!stringFields(tape.ai_lean, ["dir", "band", "entry"]) || !numberFields(tape.ai_lean, ["score"]))) return false
  if (record(tape.sector_pulse) && (!stringFields(tape.sector_pulse, ["theme_name", "label", "reco"]) || !numberFields(tape.sector_pulse, ["rank", "n_themes"]))) return false
  return true
}
const date = (value: unknown): string | null => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value) || !Number.isFinite(Date.parse(value))) return null
  const day = value.slice(0, 10)
  const time = Date.parse(`${day}T00:00:00Z`)
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === day ? value : null
}

/** Accept the producer's paired columns and the supported legacy row contract.
 * Preserve supplied equity and gaps. Never reconstruct a curve from trade events. */
export function workspaceCurve(raw: unknown): WorkspaceCurve | null {
  if (!record(raw) || (raw.status != null && raw.status !== "ok")) return null
  const source = raw.equity ?? raw.curve
  const dates: string[] = []
  const values: (number | null)[] = []
  if (record(source)) {
    if (!Array.isArray(source.t) || !Array.isArray(source.v) || source.t.length !== source.v.length || !source.t.every(value => date(value))) return null
    for (let i = 0; i < source.t.length; i++) {
      dates.push(source.t[i] as string)
      const value = source.v[i]
      values.push(typeof value === "number" && Number.isFinite(value) ? value : null)
    }
  } else if (Array.isArray(source)) {
    for (let i = 0; i < source.length; i++) {
      const point = source[i]
      if (record(point)) {
        dates.push(date(point.date) ?? String(i + 1))
        values.push(typeof point.value === "number" && Number.isFinite(point.value) ? point.value : null)
      } else if (typeof point === "number" || point === null) {
        dates.push(String(i + 1)); values.push(typeof point === "number" && Number.isFinite(point) ? point : null)
      } else return null
    }
  } else return null
  if (!values.some(value => value !== null)) return null
  const universe = record(raw.universe) ? raw.universe : {}
  return { dates, values, asOf: date(raw.as_of), start: date(universe.start), end: date(universe.end),
    note: typeof raw.honest_read === "string" ? raw.honest_read : null, validationSupplied: raw.validation != null }
}

export interface SecurityContext {
  disposition: "accepted" | "not_published" | "unavailable" | "identity_blocked"
  coverage: string | null
  degradation: string | null
  generatedAt: string | null
  marketAt: string | null
  contentSha256: string | null
  state: { en: string; zh: string } | null
  change: { en: string; zh: string } | null
  unresolved: { en: string; zh: string; leg: string | null; code: string | null } | null
  entrySourceAvailable: boolean
  prophetCoverage: string | null
  catalysts: { start: string; end: string; basis: string }[]
}

/** Project only owner display fields from the validated public bridge. The
 * source's entry.available is evidence availability, never permission to enter. */
export function workspaceSecurityContext(intel: unknown, symbol: string): SecurityContext {
  const empty: SecurityContext = { disposition: "not_published", coverage: null, degradation: null, generatedAt: null,
    marketAt: null, contentSha256: null, state: null, change: null, unresolved: null,
    entrySourceAvailable: false, prophetCoverage: null, catalysts: [] }
  if (!record(intel)) return empty
  const receipt = record(intel.security_state_read) ? intel.security_state_read : null
  if (receipt?.disposition && receipt.disposition !== "accepted") {
    return { ...empty, disposition: receipt.disposition === "not_published" ? "not_published" : "unavailable" }
  }
  const raw = intel.security_state
  if (raw == null) return empty
  if (!record(raw) || receipt?.disposition !== "accepted" || raw.schema !== "security_state.v1" || raw.version !== "1.0.0") return { ...empty, disposition: "unavailable" }
  const authority = record(raw.authority) ? raw.authority : {}
  const personal = record(raw.legs) && record(raw.legs.personal_impact) ? raw.legs.personal_impact : {}
  if (authority.class !== "context_only" || authority.display_only !== true || ["can_rank", "can_gate", "can_size", "can_originate_signal", "can_execute"].some(key => authority[key] !== false)
    || personal.state !== "NO_USER_CONTEXT" || personal.user_exposure_overlay_ref !== null) return { ...empty, disposition: "unavailable" }
  if (typeof raw.ticker_display !== "string" || raw.ticker_display.toUpperCase() !== symbol.toUpperCase()
    || typeof raw.listing_key !== "string" || raw.security_id !== `SEC:${raw.listing_key}`
    || !record(raw.identity_proof) || raw.identity_proof.state !== "PROVEN") return { ...empty, disposition: "identity_blocked" }
  const legs = record(raw.legs) ? raw.legs : {}
  const leg = (key: string) => record(legs[key]) ? legs[key] : {}
  const text = (value: unknown): { en: string; zh: string } | null => record(value) && typeof value.en === "string" && typeof value.zh === "string" ? { en: value.en, zh: value.zh } : null
  const visible = (key: string) => ["AVAILABLE", "PARTIAL", "STALE", "CORRECTED", "CONFLICTED"].includes(String(leg(key).coverage_state))
  const opportunity = leg("opportunity_context")
  const entry = record(opportunity.entry) ? opportunity.entry : {}
  const prophet = record(opportunity.prophet) ? opportunity.prophet : {}
  const asOf = record(raw.as_of) ? raw.as_of : {}
  const coverage = record(raw.coverage) ? raw.coverage : {}
  const observables = leg("catalyst").next_observables
  const fact = leg("risk").strongest_unresolved_fact
  const factLabels: Record<string, { en: string; zh: string }> = {
    conflicted_leg: { en: "Conflicting source evidence", zh: "数据源证据存在冲突" },
    corrected_source: { en: "Source evidence was corrected", zh: "数据源证据已更正" },
    required_leg_degraded: { en: "Required evidence is degraded", zh: "必要证据完整性下降" },
    workspace_warning: { en: "Source warning", zh: "数据源警示" },
  }
  const factLabel = record(fact) && typeof fact.state === "string" && Object.prototype.hasOwnProperty.call(factLabels, fact.state)
    ? factLabels[fact.state] : null
  const factText = record(fact) ? text(fact) ?? factLabel : null
  return {
    disposition: "accepted", coverage: typeof coverage.overall_state === "string" ? coverage.overall_state : null,
    degradation: typeof raw.dominant_degradation === "string" ? raw.dominant_degradation : null,
    generatedAt: date(raw.generated_at), marketAt: date(asOf.market_at),
    contentSha256: typeof raw.content_sha256 === "string" && /^[0-9a-f]{64}$/.test(raw.content_sha256) ? raw.content_sha256 : null,
    state: visible("state") ? text(leg("state").summary) : null,
    change: visible("change") ? text(leg("change").summary) : null,
    unresolved: factText && record(fact) ? { ...factText, leg: typeof fact.leg === "string" ? fact.leg : null, code: typeof fact.code === "string" ? fact.code : null } : null,
    entrySourceAvailable: entry.available === true && entry.state === "AVAILABLE",
    prophetCoverage: typeof prophet.state === "string" ? prophet.state : null,
    catalysts: visible("catalyst") && Array.isArray(observables) ? observables.filter(record)
      .filter(value => value.kind === "ESTIMATED_WINDOW" && value.authoritative === false && date(value.window_start) && date(value.window_end) && typeof value.basis === "string")
      .map(value => ({ start: value.window_start as string, end: value.window_end as string, basis: value.basis as string })) : [],
  }
}
