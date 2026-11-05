import { describe, expect, it } from "vitest"
import { workspaceActivity } from "../intelligenceActivity"

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
