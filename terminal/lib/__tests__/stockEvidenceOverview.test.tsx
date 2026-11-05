// @vitest-environment jsdom
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import StockEvidenceOverview, { type StockEvidenceCard } from "../../components/fin/StockEvidenceOverview"
import { workspaceActivity } from "../intelligenceActivity"
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe("Stock Evidence overview is presentation, not signal authority", () => {
  let host: HTMLDivElement, root: Root
  const oracleRetry = vi.fn(), researchRetry = vi.fn(), jump = vi.fn(), activity = vi.fn()
  const cards = (checking = false): StockEvidenceCard[] => [
    { id: "oracle", heading: "Oracle", label: "Historical Starter", observed: "2026-10-21", source: { status: "ready", refresh: "settled", retry: oracleRetry }, onOpen: vi.fn() },
    { id: "research", heading: "Research setup", label: "No current reading", observed: "2026-10-16", source: { status: "ready", refresh: checking ? "checking" : "failed", retry: researchRetry }, onOpen: vi.fn() },
  ]
  const render = async (overrides: Partial<React.ComponentProps<typeof StockEvidenceOverview>> = {}) => act(async () => root.render(
    <StockEvidenceOverview zh={false} entry={{ status: "UNAVAILABLE_DATA", label: "Entry unverified", reason: "Qualified source unavailable" }}
      cards={cards()} prophet={<p>Prophet permission unavailable</p>} sample={null} events={[]} historyAvailable={false}
      marketRisk={null} formatDate={value => value} onJump={jump} onActivity={activity} {...overrides} />,
  ))
  beforeEach(() => { vi.clearAllMocks(); host = document.createElement("div"); document.body.append(host); root = createRoot(host) })
  afterEach(async () => { await act(async () => root.unmount()); host.remove() })

  it("retains the unavailable entry and failed-refresh limitations even beside historical signals", async () => {
    await render()
    expect(host.querySelector('[data-testid="workspace-oracle-entry-availability"]')?.getAttribute("data-status")).toBe("UNAVAILABLE_DATA")
    expect(host.textContent).toContain("Historical signals are not current entry calls.")
    expect(host.textContent).toContain("Saved · refresh failed")
    expect(host.textContent).not.toContain("0 events")
    expect(host.querySelectorAll('[data-testid="recent-observation"]')).toHaveLength(0)
  })

  it("opens source detail without refreshing and retries only the explicitly chosen owner", async () => {
    await render()
    const control = host.querySelector('button[aria-controls]') as HTMLButtonElement
    await act(async () => control.click())
    expect(control.getAttribute("aria-expanded")).toBe("true")
    expect(host.querySelector('[data-testid="evidence-source-inspector"]')?.hasAttribute("hidden")).toBe(false)
    expect(oracleRetry).not.toHaveBeenCalled(); expect(researchRetry).not.toHaveBeenCalled()
    await act(async () => (host.querySelector('button[aria-label="Refresh research"]') as HTMLButtonElement).click())
    expect(researchRetry).toHaveBeenCalledTimes(1); expect(oracleRetry).not.toHaveBeenCalled()
    await render({ cards: cards(true) })
    expect((host.querySelector('button[aria-label="Refresh research"]') as HTMLButtonElement).disabled).toBe(true)
  })

  it("preserves zero prices and zero-trade history without inventing missing chart targets", async () => {
    const events = workspaceActivity([{ type: "BUY", ts: "2026-10-20", known_ts: "2026-10-21", price: 0 }, { type: "SELL", ts: "invalid", price: null }], [], "all")
    await render({ events, historyAvailable: true, sample: { trades: 0, drawdown: "0.0%", onOpen: activity } })
    const rows = host.querySelectorAll<HTMLButtonElement>('[data-testid="recent-observation"]')
    expect(rows[0].textContent).toContain("0.00")
    expect(rows[0].textContent).toContain("2026-10-21")
    await act(async () => rows[0].click())
    expect(jump).toHaveBeenCalledWith("2026-10-20")
    expect(rows[1].disabled).toBe(true)
    expect(rows[1].textContent).toContain("Date unavailable")
    expect(host.textContent).toContain("0 trades")
    expect(host.textContent).toContain("0.0%")
  })

  it("renders untrusted source text as text and makes no current entry or confidence claims", async () => {
    const evidence = cards(); evidence[0].label = '<img src=x onerror="alert(1)">'
    await render({ cards: evidence })
    expect(host.querySelector("img")).toBeNull()
    expect(host.textContent).toContain(evidence[0].label)
    expect(host.textContent).not.toMatch(/confidence|probability|Buy now/i)
  })
})
