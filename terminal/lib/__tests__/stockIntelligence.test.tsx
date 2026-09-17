// @vitest-environment jsdom
import { getJSON } from "../dataCache"
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import OracleDash from "../../components/fin/OracleDash"
import SignalButton from "../../components/SignalButton"
vi.mock("../dataCache", () => ({ getJSON: vi.fn().mockResolvedValue(null) }))
let host: HTMLDivElement, root: Root
const intel = { asof: "2026-09-14", cards: { ai_judgment: { verdict: "Accounting warning — verify before buying", size_pct: 50 }, conviction: { score: 46, band: "Setting up", drivers: ["earnings · insider · revisions"], cautions: ["Accounting quality looks weak."] } }, tape: { ai_lean: { dir: "NEUTRAL" } } }
const signals = Array.from({ length: 60 }, (_, i) => ({ ts: `2026-07-${String(i % 28 + 1).padStart(2, "0")}`, known_ts: "2026-09-10", type: "BUY", quality: "block", score: 20, price: 100 + i }))
const slice = { indicator: { signals }, backtest: { metrics: { n_trades: 8, win_rate: 0.375, profit_factor: 2.1, cagr: 0.052 } } }
const text = () => document.body.textContent || ""
const tab = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(el => el.textContent?.includes(label))!
async function click(el: Element) { await act(async () => (el as HTMLElement).click()) }
beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", "") }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open") }
})
beforeEach(() => {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host)
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }))
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
async function render(props: Partial<React.ComponentProps<typeof OracleDash>> = {}) {
  await act(async () => root.render(<OracleDash sym="INTC" intel={intel} slice={slice} {...props} />))
}
describe("Stock Intelligence workspace", () => {
  it("opens one named dialog and defers performance/history until requested", async () => {
    await render()
    expect(document.querySelectorAll("dialog[open]")).toHaveLength(1)
    expect(text()).toContain("Stock Intelligence")
    expect(text()).toContain("INTC")
    expect(document.querySelectorAll('[role="tab"]')).toHaveLength(4)
    expect(tab("Overview").getAttribute("aria-selected")).toBe("true")
    expect(text()).toContain("Accounting warning — verify before buying")
    expect(text()).not.toContain("Win rate")
    expect(document.querySelectorAll(".sd-sigrow")).toHaveLength(0)
  })
  it("puts historical statistics in Performance with their actual sample count", async () => {
    await render(); await click(tab("Performance"))
    expect(text()).toContain("Historical backtest")
    expect(text()).toContain("37.5%")
    expect(text()).toContain("8")
    expect(text()).toContain("not a forecast")
  })
  it("progressively reveals history without losing starter qualification or chart coordinates", async () => {
    const jump = vi.fn(); await render({ onJump: jump }); await click(tab("Signals"))
    expect(document.querySelectorAll(".sd-sigrow")).toHaveLength(25)
    expect(text()).toContain("confirmation failed")
    const more = [...document.querySelectorAll("button")].find(el => el.textContent?.includes("Show more"))!
    await click(more); expect(document.querySelectorAll(".sd-sigrow")).toHaveLength(50)
    await click(document.querySelector(".sd-sigrow")!)
    expect(jump).toHaveBeenCalledWith(signals.at(-1)!.ts)
  })
  it("exposes unavailable research and unknown dates instead of implying freshness", async () => {
    await render({ intel: null, slice: null })
    expect(text()).toContain("Research unavailable")
    expect(text()).toContain("Research date unavailable")
    expect(text()).not.toContain("Suggested size")
  })
  it("resets navigation and history expansion on a symbol change", async () => {
    await render(); await click(tab("Signals"))
    await render({ sym: "AAPL", intel: null, slice: null })
    expect(tab("Overview").getAttribute("aria-selected")).toBe("true")
    expect(text()).toContain("AAPL")
    expect(text()).not.toContain("Accounting warning")
  })
  it("supports roving keyboard tab selection", async () => {
    await render(); const first = tab("Overview"); first.focus()
    await act(async () => first.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })))
    expect(tab("Research").getAttribute("aria-selected")).toBe("true")
    expect(document.activeElement).toBe(tab("Research"))
  })
  it("retains the two source dates in one clearly actionable launcher", async () => {
    const view = vi.fn()
    await act(async () => root.render(<SignalButton oracle={{ label: "Starter", color: "var(--signal)", sub: "Sep 10" }} desk={{ label: "Neutral", color: "var(--muted)", sub: "Sep 14" }} oracleLabel="Golden Oracle" deskLabel="Research Desk" viewLabel="View" onView={view} />))
    const launcher = document.querySelector('button[aria-haspopup="dialog"]')!
    expect(launcher).not.toBeNull(); expect(launcher.textContent).toContain("Sep 10")
    expect(launcher.textContent).toContain("Sep 14"); expect(document.querySelector(".sig-btn-seam")).toBeNull()
    await click(launcher); expect(view).toHaveBeenCalledOnce()
  })
})
it("does not turn an empty sector object into an available Neutral research assessment", async () => {
  await render({ intel: { cards: {}, tape: { sector_pulse: {} } }, slice: null })
  expect(text()).toContain("Research unavailable")
})
it("retains refused-entry and retro-projection disclosures in the history view", async () => {
  await render({ slice: { indicator: { signals: [
    { ts: "2026-07-01", type: "BUY", blocked: true, quality: "regime_blocked" },
    { ts: "2026-07-02", type: "BUY", blocked: true, retro_override: true },
  ] } } })
  await click(tab("Signals"))
  expect(text()).toContain("not an entry")
  expect(text()).toContain("(retro)")
  expect(document.querySelector(".sd-sig-legend")).not.toBeNull()
})
it("keeps unscored reclaim events visibly outside scored entries", async () => {
  await render({ slice: { indicator: { signals: [{ ts: "2026-07-01", type: "RECLAIM", scored: false }] } } })
  await click(tab("Signals"))
  expect(text()).toContain("unscored")
  expect(document.querySelector(".sd-sig-badge")?.classList.contains("hollow")).toBe(true)
})
it("uses the existing full-analysis handoff and closes the intelligence panel", async () => {
  const onClose = vi.fn(), onOpenFull = vi.fn(); await render({ onClose, onOpenFull })
  await click(tab("Research"))
  await click([...document.querySelectorAll("button")].find(el => el.textContent?.includes("Open full analysis"))!)
  expect(onClose).toHaveBeenCalledOnce(); expect(onOpenFull).toHaveBeenCalledOnce()
})

it("renders the real producer's columnar equity contract with its own provenance", async () => {
  vi.mocked(getJSON).mockResolvedValueOnce({ schema: "backtest_result/v1", status: "ok", as_of: "2026-06-26",
    universe: { start: "2021-01-26", end: "2026-06-26", timeframe: "3D" }, validation: null,
    honest_read: "After-cost historical simulation; significance requires separate validation.",
    equity: { t: ["2026-06-22", "2026-06-25", "2026-06-26"], v: [1, 0.92, 1.35] } })
  await render(); await click(tab("Performance"))
  expect(document.querySelector(".od-curve svg")).not.toBeNull()
  expect(text()).toContain("Jun 26, 2026")
  expect(text()).toContain("Jan 26, 2021")
  expect(text()).toContain("Statistical validation not supplied")
  expect(text()).toContain("After-cost historical simulation")
})
it("rejects unpaired columnar dates/values rather than inventing an equity path", async () => {
  vi.mocked(getJSON).mockResolvedValueOnce({ status: "ok", equity: { t: ["2026-06-26"], v: [1, 2] } })
  await render(); await click(tab("Performance"))
  expect(document.querySelector(".od-curve")).toBeNull()
  expect(text()).toContain("Equity curve unavailable")
})
it("does not display an explicitly failed backtest even when it includes numeric values", async () => {
  vi.mocked(getJSON).mockResolvedValueOnce({ status: "error", equity: [{ date: "2026-06-26", value: 1 }, { date: "2026-06-27", value: 2 }] })
  await render(); await click(tab("Performance"))
  expect(document.querySelector(".od-curve")).toBeNull()
  expect(text()).toContain("Equity curve unavailable")
})
it("keeps the legacy row-oriented equity format working", async () => {
  vi.mocked(getJSON).mockResolvedValueOnce({ equity: [{ date: "2026-06-25", value: 1 }, { date: "2026-06-26", value: 1.1 }] })
  await render(); await click(tab("Performance"))
  expect(document.querySelector(".od-curve svg")).not.toBeNull()
})
it("rejects invalid columnar dates without assigning invented calendar labels", async () => {
  vi.mocked(getJSON).mockResolvedValueOnce({ status: "ok", equity: { t: [null, "2026-06-26"], v: [1, 2] } })
  await render(); await click(tab("Performance"))
  expect(document.querySelector(".od-curve")).toBeNull()
  expect(text()).toContain("Equity curve unavailable")
})
it("keeps every tab control connected to an existing panel across navigation", async () => {
  await render()
  for (const label of ["Overview", "Research", "Signals", "Performance"]) {
    await click(tab(label))
    for (const control of document.querySelectorAll('[role="tab"]')) {
      expect(document.getElementById(control.getAttribute("aria-controls")!)).not.toBeNull()
    }
    const panel = document.querySelector('[role="tabpanel"]')!
    expect(panel.getAttribute("aria-labelledby")).toBe(tab(label).id)
  }
})
