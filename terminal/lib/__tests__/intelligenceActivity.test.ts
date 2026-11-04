import { describe, expect, it } from "vitest"
import { workspaceActivity, exploreWorkspaceActivity, activityEventPresentation } from "../intelligenceActivity"

const ts = "2026-10-01"

describe("workspace activity", () => {
  const signals = [
    { ts, type: "BUY", quality: "block" }, // a reduced-size starter
    { ts, type: "RECLAIM", scored: true },
    { ts, type: "RECLAIM", scored: false },
    { ts, type: "RECLAIM" }, // scoring was not supplied
    { ts, type: "RECLAIM", quality: "stop_sweep_reclaim" },
    { ts, type: "BOTTOM_WATCH" },
    { ts, type: "CUT", scored: false },
    { ts, type: "SELL", basis: "structure_stop" },
    { ts, type: "BUY", quality: "regime_blocked" }, // legacy veto
    { ts, type: "REBUY", retro_override: true },
    { ts, type: "NEW_KIND" },
  ]
  const receipts = [{ surfaced_at: "2026-10-02", entry_price: 12.5 }]

  it("classifies producer markers without promoting display-only watches, refusals or candidate receipts", () => {
    const of = (filter: Parameters<typeof workspaceActivity>[2]) =>
      workspaceActivity(signals, receipts, filter).map(e => e.kind === "signal" ? e.signal : e.receipt)
    expect(of("entries")).toEqual([signals[1], signals[0]])
    expect(of("exits")).toEqual([signals[7]])
    expect(of("watches")).toEqual(signals.slice(2, 7).reverse())
    expect(of("refused")).toEqual([signals[9], signals[8]])
    expect(of("receipts")).toEqual(receipts)
    expect(of("all")).toHaveLength(12) // includes the unrecognized source event
  })

  it("orders the combined timeline by the displayed source date and keeps the original chart target", () => {
    const delayed = { type: "BUY", ts, known_ts: "2026-10-05" }
    const events = workspaceActivity([{ type: "SELL", ts }, delayed], receipts, "all")
    expect(events.map(e => [e.kind, e.clock, e.date, e.chartDate])).toEqual([
      ["signal", "observed", "2026-10-05", ts],
      ["receipt", "listed", "2026-10-02", "2026-10-02"],
      ["signal", "bar", ts, ts],
    ])
  })

  it("labels fallback dates and keeps an undated receipt visible without a chart action", () => {
    const events = workspaceActivity(
      [{ type: "SELL", ts, known_ts: "2026-02-30" }],
      [{ surfaced_at: "bad", entry_date: "2026-10-02" }, {}], "all",
    )
    expect(events.map(e => [e.clock, e.date, e.chartDate])).toEqual([
      ["entry", "2026-10-02", "2026-10-02"], ["bar", ts, ts], ["entry", null, null],
    ])
  })
})


describe("R6 source-faithful activity exploration", () => {
  const source = [
    { type: "BUY", ts: "2026-10-20", known_ts: "2026-10-21", quality: "block", price: 262.37 },
    { type: "SELL", ts: "2026-08-17", basis: "structure_stop", price: 261.31 },
    { type: "BUY", ts: "2026-07-31", quality: "take", price: 0 },
    { type: "BUY", ts: "2026-07-30", blocked: true, price: 244 },
    { type: "REBUY", ts: "2026-07-29", retro_override: true, price: 243 },
    { type: "BOTTOM_WATCH", ts: "2026-07-28", scored: false, price: 242 },
    { type: "NEW_KIND", ts: "bad", price: 0 },
  ]
  const candidates = [
    { system: "prophet", definition: "sector_context", surfaced_at: "2026-10-22", entry_date: "2026-10-19", entry_price: 260, rank: 0 },
    { system: "reversal", surfaced_at: null, entry_date: null, entry_price: 0 },
  ]
  const events = workspaceActivity(source, candidates, "all")

  it("exposes a source-preserving explorer rather than a second signal engine", () => {
    expect(exploreWorkspaceActivity).toEqual(expect.any(Function))
    expect(activityEventPresentation).toEqual(expect.any(Function))
  })

  it("finds displayed Starter semantics even though the producer type is BUY", () => {
    const result = exploreWorkspaceActivity(events, { query: "starter" })
    expect(result.events).toHaveLength(1)
    expect(result.events[0]).toMatchObject({ category: "entries", clock: "observed", date: "2026-10-21", chartDate: "2026-10-20" })
    expect(result.events[0].kind === "signal" && result.events[0].signal).toBe(source[0])
    expect(result.counts).toMatchObject({ all: 1, entries: 1, exits: 0, watches: 0, refused: 0, receipts: 0 })
  })

  it.each(["STOP", "stop swing", "止损", "跌破前低", "2026-08-17", "Aug 17, 2026", "2026年8月17日", "261.31"])("searches source date, price and bilingual visible terms: %s", query => {
    const result = exploreWorkspaceActivity(events, { query })
    expect(result.events).toHaveLength(1)
    expect(result.events[0].kind === "signal" && result.events[0].signal).toBe(source[1])
  })

  it("uses normalized literal AND matching, not regular expressions or arbitrary expressions", () => {
    expect(exploreWorkspaceActivity(events, { query: "  ＳＴＡＲＴＥＲ   failed  " }).events).toHaveLength(1)
    expect(exploreWorkspaceActivity(events, { query: "starter prophet" }).events).toHaveLength(0)
    expect(exploreWorkspaceActivity(events, { query: ".*" }).events).toHaveLength(0)
    expect(exploreWorkspaceActivity(events, { query: "[BUY]" }).events).toHaveLength(0)
    expect(exploreWorkspaceActivity(events, { query: "   " }).events).toHaveLength(events.length)
    expect(exploreWorkspaceActivity(events, { query: "x".repeat(10000) }).query.length).toBe(160)
  })

  it("keeps search cohort counts independent of the selected category", () => {
    const result = exploreWorkspaceActivity(events, { query: "oracle", filter: "exits" })
    expect(result.events).toHaveLength(1)
    expect(result.total).toBe(9)
    expect(result.matched).toBe(7)
    expect(result.counts).toEqual({ all: 7, entries: 2, exits: 1, watches: 1, refused: 2, receipts: 0 })
  })

  it("never converts refused, retrospective or candidate records into entry events", () => {
    expect(exploreWorkspaceActivity(events, { query: "not entered", filter: "entries" }).events).toHaveLength(0)
    expect(exploreWorkspaceActivity(events, { query: "未入场" }).events.map(x => x.category)).toEqual(["refused", "refused"])
    const receipt = exploreWorkspaceActivity(events, { query: "prophet", filter: "receipts" }).events[0]
    expect(receipt).toMatchObject({ kind: "receipt", clock: "listed", date: "2026-10-22", chartDate: "2026-10-22", category: "receipts" })
    expect(receipt.kind === "receipt" && receipt.receipt).toBe(candidates[0])
  })

  it("sorts oldest/newest while retaining undated source records last and never mutating input", () => {
    const before = JSON.stringify(events)
    const asc = exploreWorkspaceActivity(events, { order: "oldest" }).events
    const desc = exploreWorkspaceActivity(events, { order: "newest" }).events
    expect(asc[0].date).toBe("2026-07-28")
    expect(desc[0].date).toBe("2026-10-22")
    expect(asc.slice(-2).map(x => x.date)).toEqual([null, null])
    expect(desc.slice(-2).map(x => x.date)).toEqual([null, null])
    expect(asc.slice(-2).map(x => x.key)).toEqual(desc.slice(-2).map(x => x.key))
    expect(JSON.stringify(events)).toBe(before)
  })

  it("keeps same-date source tie order stable in either sorting direction", () => {
    const same = workspaceActivity([{ type: "BUY", ts }, { type: "SELL", ts }], [], "all")
    expect(exploreWorkspaceActivity(same, { order: "oldest" }).events.map(x => x.key)).toEqual(["s-1", "s-0"])
    expect(exploreWorkspaceActivity(same, { order: "newest" }).events.map(x => x.key)).toEqual(["s-1", "s-0"])
  })

  it("distinguishes zero price from missing price in the common presentation", () => {
    const zero = events.find(e => e.kind === "signal" && e.signal === source[2])!
    expect(activityEventPresentation(zero, false)).toMatchObject({ label: "BUY", source: "Oracle", price: 0 })
    const missing = workspaceActivity([{ type: "BUY", ts }], [], "all")[0]
    expect(activityEventPresentation(missing, false).price).toBeNull()
    const candidate = events.find(e => e.kind === "receipt" && e.receipt === candidates[1])!
    expect(activityEventPresentation(candidate, true)).toMatchObject({ label: "反转观察", price: 0 })
  })

  it("offers the same qualified display class to summary and Activity without probability claims", () => {
    const starter = events.find(e => e.kind === "signal" && e.signal === source[0])!
    const blocked = events.find(e => e.kind === "signal" && e.signal === source[3])!
    const retro = events.find(e => e.kind === "signal" && e.signal === source[4])!
    expect(activityEventPresentation(starter, false)).toMatchObject({ label: "STARTER", detail: "confirmation failed", tone: "watch" })
    expect(activityEventPresentation(blocked, true)).toMatchObject({ label: "已拦截", detail: "非入场信号", tone: "muted" })
    expect(activityEventPresentation(retro, false)).toMatchObject({ label: "REBUY", detail: "(retro)", tone: "watch" })
    expect(activityEventPresentation(starter, false)).not.toHaveProperty("confidence")
    expect(activityEventPresentation(starter, false)).not.toHaveProperty("entryPermission")
  })

  it("returns explicit empty cohorts without creating a fake observation", () => {
    const empty = exploreWorkspaceActivity([], { query: "prophet", filter: "receipts" })
    expect(empty).toMatchObject({ total: 0, matched: 0, events: [], counts: { all: 0, receipts: 0 } })
  })
})
