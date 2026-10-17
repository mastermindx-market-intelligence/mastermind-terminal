import { describe, expect, it } from "vitest"
import { workspaceCurve, workspaceSourceClock, workspaceSecurityContext, workspaceSourceValid } from "../intelligenceWorkspaceView"
import { deskVerdict, oracleVerdict } from "../signalVerdict"

describe("Intelligence source projection", () => {
  it("preserves paired equity columns and gaps without rebuilding returns", () => {
    const raw = { status: "ok", equity: { t: ["2026-01-01", "2026-01-02", "2026-01-03"], v: [100, null, 108.25] }, as_of: "2026-01-03", universe: { start: "2026-01-01", end: "2026-01-03" } }
    expect(workspaceCurve(raw)).toMatchObject({ dates: raw.equity.t, values: raw.equity.v, asOf: raw.as_of, validationSupplied: false })
    expect(raw.equity.v).toEqual([100, null, 108.25])
  })
  it("does not invent a curve for missing, unavailable or misaligned data", () => {
    for (const raw of [null, {}, { status: "unavailable", equity: [100] }, { equity: { t: ["2026-01-01"], v: [1, 2] } }, { equity: { t: ["invalid"], v: [1] } }, { equity: [null, Infinity] }]) expect(workspaceCurve(raw)).toBeNull()
  })
  it("supports the existing legacy row contract, retaining null points", () => {
    expect(workspaceCurve({ equity: [{ date: "2026-01-01", value: 100 }, { date: "2026-01-02", value: NaN }, { date: "2026-01-03", value: 94 }] })?.values).toEqual([100, null, 94])
    expect(workspaceCurve({ equity: [100, null, 95] })?.values).toEqual([100, null, 95])
  })
  it("does not describe missing, impossible or future observations as fresh", () => {
    const now = Date.parse("2026-10-17T12:00:00Z")
    for (const value of [null, "", "not a date", "2026-02-30", "2027-01-01"]) expect(workspaceSourceClock(value, now)).toEqual({ kind: "unknown" })
    expect(workspaceSourceClock("2026-10-10", now)).toMatchObject({ kind: "dated", ageDays: 7 })
  })
})

describe("Workspace source shapes", () => {
  it("accepts current research and nullable legacy decisions without changing their evidence", () => {
    const raw = { asof: "2026-10-16", cards: { ai_judgment: { verdict: "Wait", gloss: null }, conviction: { score: 0, drivers: [], cautions: ["Pending evidence"] } },
      analysis: { decision: null, confluence: { status: "pending" } }, tape: { asof: "2026-10-16", ai_lean: { dir: "NEUTRAL", band: "mid", entry: "wait_pullback", score: 0 } } }
    const before = JSON.stringify(raw)
    expect(workspaceSourceValid("intel", raw)).toBe(true)
    expect(deskVerdict(raw, false, Date.parse("2026-10-17"))).toMatchObject({ label: "Wait for pullback", raw: "NEUTRAL", dim: false })
    expect(JSON.stringify(raw)).toBe(before)
    expect(workspaceSourceValid("intel", { cards: null, analysis: { decision: { verb: "WAIT", headline: null, score: 0 } }, tape: null, asof: null })).toBe(true)
  })
  it("preserves false flags, null fields, and a refused entry beside its Oracle anchor", () => {
    const raw = { indicator: { state: { last_scored_signal: "SELL", position_hint: "flat", strong_bull: false, extended: null, weeklyBull: false, above200: false }, signals: [
      { ts: "2026-10-15", type: "SELL", price: 0, scored: true, basis: "structure_stop" },
      { ts: "2026-10-16", type: "BUY", blocked: true, override_candidate: false, retro_override: false, scored: null, price: null, quality: "regime_blocked", retro_ctx: null, override_ctx: { name: null, name_zh: null, peer_dd: -0.2 } },
    ], warnings: [] }, opportunities: { events: [] }, backtest: { metrics: { n_trades: 0, win_rate: null } } }
    const before = JSON.stringify(raw)
    expect(workspaceSourceValid("slice", raw)).toBe(true)
    expect(oracleVerdict(null, raw, false, Date.parse("2026-10-17"))).toMatchObject({ raw: "SELL", blocked: true })
    expect(JSON.stringify(raw)).toBe(before)
    expect(workspaceSourceValid("slice", { indicator: { signals: null, state: null } })).toBe(true)
  })
  it("rejects unrecognized envelopes without inventing an empty source", () => {
    for (const raw of [null, [], "source", {}, { ticker: "AAPL" }, { cards: [] }]) expect(workspaceSourceValid("intel", raw)).toBe(false)
    for (const raw of [null, [], {}, { indicator: [] }, { indicator: { signals: {} } }, { indicator: { signals: [null] } }]) expect(workspaceSourceValid("slice", raw)).toBe(false)
  })
  it.each([
    ["object judgment", { cards: { ai_judgment: { verdict: { label: "Buy" } } } }],
    ["non-text caution", { cards: { conviction: { cautions: ["One", { en: "Two" }] } } }],
    ["object tape date", { cards: {}, tape: { asof: {} } }],
    ["object entry posture", { cards: {}, tape: { ai_lean: { entry: {} } } }],
    ["non-finite lean score", { cards: {}, tape: { ai_lean: { score: Infinity } } }],
    ["primitive legacy decision", { analysis: { decision: "BUY" } }],
    ["array legacy decision", { analysis: { decision: [] } }],
    ["object legacy headline", { analysis: { decision: { headline: { en: "Wait" } } } }],
    ["text legacy score", { analysis: { decision: { score: "75" } } }],
  ])("rejects malformed research fields before verdict rendering: %s", (_name, raw) => {
    expect(workspaceSourceValid("intel", raw)).toBe(false)
  })
  it.each([
    ["truthy string stance flag", { indicator: { state: { above200: "false" } } }],
    ["object position hint", { indicator: { state: { position_hint: {} } } }],
    ["text event price", { indicator: { signals: [{ ts: "2026-10-16", type: "BUY", price: "100" }] } }],
    ["text override flag", { indicator: { signals: [{ ts: "2026-10-16", type: "BUY", override_candidate: "false" }] } }],
    ["object override name", { indicator: { signals: [{ ts: "2026-10-16", type: "BUY", override_ctx: { name: {} } }] } }],
    ["text peer drawdown", { indicator: { signals: [{ ts: "2026-10-16", type: "BUY", override_ctx: { peer_dd: "-0.2" } }] } }],
    ["array retro context", { indicator: { signals: [{ ts: "2026-10-16", type: "BUY", retro_ctx: [] }] } }],
    ["object warning date", { indicator: { warnings: [{ ts: {}, kind: "arm" }] } }],
    ["text candidate price", { indicator: {}, opportunities: { events: [{ entry_price: "100" }] } }],
    ["text performance metric", { indicator: {}, backtest: { metrics: { win_rate: "0.5" } } }],
  ])("rejects malformed activity fields before event rendering: %s", (_name, raw) => {
    expect(workspaceSourceValid("slice", raw)).toBe(false)
  })
})

const context = (fact: unknown = { en: "Evidence pending", zh: "证据待定" }) => ({
  security_state_read: { disposition: "accepted" },
  security_state: {
    schema: "security_state.v1", version: "1.0.0", ticker_display: "AAPL", listing_key: "US-XNAS-AAPL", security_id: "SEC:US-XNAS-AAPL",
    generated_at: "2026-10-16T20:00:00Z", as_of: { market_at: "2026-10-16" }, content_sha256: "a".repeat(64),
    authority: { class: "context_only", display_only: true, can_rank: false, can_gate: false, can_size: false, can_originate_signal: false, can_execute: false },
    identity_proof: { state: "PROVEN" }, coverage: { overall_state: "PARTIAL" }, dominant_degradation: "PARTIAL",
    legs: {
      personal_impact: { state: "NO_USER_CONTEXT", user_exposure_overlay_ref: null },
      state: { coverage_state: "AVAILABLE", summary: { en: "Source state", zh: "数据源状态" } },
      change: { coverage_state: "UNAVAILABLE", summary: { en: "No change evidence", zh: "无变化证据" } },
      opportunity_context: { entry: { available: true, state: "AVAILABLE" }, prophet: { state: "UNAVAILABLE" } },
      risk: { strongest_unresolved_fact: fact },
      catalyst: { coverage_state: "AVAILABLE", next_observables: [{ kind: "ESTIMATED_WINDOW", authoritative: false, window_start: "2027-01-20", window_end: "2027-01-25", basis: "Owner estimate" }] },
    },
  },
})

describe("Security State stays context-only", () => {
  it("retains coverage and separates source availability from entry permission", () => {
    const view = workspaceSecurityContext(context(), "AAPL")
    expect(view).toMatchObject({ disposition: "accepted", coverage: "PARTIAL", degradation: "PARTIAL", entrySourceAvailable: true, prophetCoverage: "UNAVAILABLE", change: null })
    expect(view).not.toHaveProperty("entryPermission")
    expect(view.catalysts[0]).toEqual({ start: "2027-01-20", end: "2027-01-25", basis: "Owner estimate" })
  })
  it("distinguishes unsupported coverage, failed reads and unproven identity", () => {
    expect(workspaceSecurityContext({}, "AAPL").disposition).toBe("not_published")
    expect(workspaceSecurityContext({ security_state_read: { disposition: "digest_mismatch" } }, "AAPL").disposition).toBe("unavailable")
    expect(workspaceSecurityContext(context(), "MSFT").disposition).toBe("identity_blocked")
    const raw = context(); raw.security_state.identity_proof.state = "BLOCKED_IDENTITY_BRIDGE"
    expect(workspaceSecurityContext(raw, "AAPL").disposition).toBe("identity_blocked")
  })
  it("refuses private context and authority upgrades in the public projection", () => {
    const raw = context(); raw.security_state.authority.can_size = true
    expect(workspaceSecurityContext(raw, "AAPL").disposition).toBe("unavailable")
    const privateRaw = context(); privateRaw.security_state.legs.personal_impact.state = "HAS_HOLDINGS"
    expect(workspaceSecurityContext(privateRaw, "AAPL").disposition).toBe("unavailable")
  })
  it.each([
    ["conflicted_leg", "Conflicting source evidence", "数据源证据存在冲突"],
    ["corrected_source", "Source evidence was corrected", "数据源证据已更正"],
    ["required_leg_degraded", "Required evidence is degraded", "必要证据完整性下降"],
    ["workspace_warning", "Source warning", "数据源警示"],
  ])("keeps structured risk visible when the owner supplies no narrative: %s", (state, en, zh) => {
    const fact = { state, en: null, zh: null, leg: "state", code: "STALE_SOURCE" }
    expect(workspaceSecurityContext(context(fact), "AAPL").unresolved).toEqual({ en, zh, leg: "state", code: "STALE_SOURCE" })
    expect(fact.en).toBeNull()
  })
  it("preserves owner risk wording before generic structured labels", () => {
    expect(workspaceSecurityContext(context({ state: "required_leg_degraded", en: "Owner evidence gap", zh: "来源证据缺口", leg: "change", code: "NO_PRIOR_STATE" }), "AAPL").unresolved)
      .toEqual({ en: "Owner evidence gap", zh: "来源证据缺口", leg: "change", code: "NO_PRIOR_STATE" })
  })
  it("does not invent risk language for missing, unknown, or inherited labels", () => {
    for (const fact of [null, {}, { state: "not_supplied" }, { state: "constructor" }, { state: "__proto__" }, { state: { toString: "invalid" } }]) {
      expect(workspaceSecurityContext(context(fact), "AAPL").unresolved).toBeNull()
    }
  })
})
