// @vitest-environment jsdom
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
const cache = vi.hoisted(() => ({ getJSONResult: vi.fn(), invalidate: vi.fn() }))
vi.mock("../dataCache", () => cache)
import { useWorkspaceSource } from "../useWorkspaceSource"
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const intel = (ticker: string, verdict: string) => ({ ticker, cards: { ai_judgment: { verdict } } })

function Read({ symbol, enabled = true }: { symbol: string; enabled?: boolean }) {
  const result = useWorkspaceSource<ReturnType<typeof intel>>(symbol, "intel", enabled)
  return <div><output>{JSON.stringify({ status: result.status, data: result.data, refresh: result.refresh, reason: result.reason })}</output><button onClick={result.retry}>Retry</button></div>
}

describe("Workspace shared-cache consumer", () => {
  let root: Root, host: HTMLDivElement
  beforeEach(() => {
    cache.getJSONResult.mockReset(); cache.invalidate.mockReset()
    host = document.createElement("div"); document.body.append(host); root = createRoot(host)
  })
  afterEach(async () => { await act(async () => root.unmount()); host.remove() })
  const render = async (symbol: string, enabled = true) => act(async () => root.render(<Read symbol={symbol} enabled={enabled} />))
  const value = () => JSON.parse(host.querySelector("output")!.textContent!)

  it("fences late responses when the watchlist symbol changes", async () => {
    let finish!: (value: unknown) => void
    cache.getJSONResult.mockImplementation((url: string) => url.includes("AAPL") ? new Promise(resolve => { finish = resolve }) : Promise.resolve({ status: "data", data: intel("MSFT", "Microsoft") }))
    await render("AAPL"); expect(value().status).toBe("loading")
    await render("MSFT"); expect(value().data.ticker).toBe("MSFT")
    await act(async () => finish({ status: "data", data: intel("AAPL", "Apple") }))
    expect(value().data.ticker).toBe("MSFT")
  })
  it("rejects source identity mismatch and keeps absence distinct from outages", async () => {
    cache.getJSONResult.mockResolvedValueOnce({ status: "data", data: intel("NVDA", "Wrong subject") })
    await render("AAPL"); expect(value()).toMatchObject({ status: "unavailable", data: null, reason: "identity" })
    cache.getJSONResult.mockResolvedValueOnce({ status: "absent", httpStatus: 404 })
    await render("MSFT"); expect(value().status).toBe("absent")
    cache.getJSONResult.mockResolvedValueOnce({ status: "unavailable", reason: "network" })
    await render("COST"); expect(value()).toMatchObject({ status: "unavailable", reason: "network" })
  })
  it("labels a failed refresh while retaining the saved source", async () => {
    let finish!: (value: string) => void
    cache.getJSONResult.mockResolvedValue({ status: "data", data: intel("AAPL", "Saved"), stale: { revalidation: new Promise(resolve => { finish = resolve }) } })
    await render("AAPL"); expect(value().refresh).toBe("checking")
    await act(async () => finish("failed"))
    expect(value()).toMatchObject({ data: { cards: { ai_judgment: { verdict: "Saved" } } }, refresh: "failed" })
  })
  it.each([
    ["unrecognized source", { ticker: "AAPL", value: "Not research" }],
    ["non-text judgment", { ticker: "AAPL", cards: { ai_judgment: { verdict: {} } } }],
    ["malformed legacy decision", { ticker: "AAPL", analysis: { decision: { headline: [] } } }],
    ["malformed verdict tape", { ticker: "AAPL", cards: {}, tape: { ai_lean: { entry: {} } } }],
  ])("exposes malformed research as unavailable: %s", async (_name, data) => {
    cache.getJSONResult.mockResolvedValueOnce({ status: "data", data })
    await render("AAPL")
    expect(value()).toMatchObject({ status: "unavailable", data: null, refresh: "settled", reason: "malformed" })
  })
  it("does not retain a saved judgment after shared revalidation accepts malformed data", async () => {
    let finish!: (value: string) => void
    cache.getJSONResult.mockResolvedValueOnce({ status: "data", data: intel("AAPL", "Saved"), stale: { revalidation: new Promise(resolve => { finish = resolve }) } })
      .mockResolvedValueOnce({ status: "data", data: { ticker: "AAPL", analysis: { decision: [] } } })
    await render("AAPL"); expect(value()).toMatchObject({ status: "ready", refresh: "checking" })
    await act(async () => finish("success"))
    expect(value()).toMatchObject({ status: "unavailable", data: null, refresh: "settled", reason: "malformed" })
    expect(cache.getJSONResult).toHaveBeenCalledTimes(2)
  })
  it("recovers from malformed data through the same shared retry path", async () => {
    cache.getJSONResult.mockResolvedValueOnce({ status: "data", data: { cards: [] } })
      .mockResolvedValueOnce({ status: "data", data: intel("AAPL", "Recovered") })
    await render("AAPL"); expect(value().reason).toBe("malformed")
    await act(async () => host.querySelector("button")!.click())
    expect(value()).toMatchObject({ status: "ready", data: { cards: { ai_judgment: { verdict: "Recovered" } } }, refresh: "settled" })
    expect(value().reason).toBeUndefined()
    expect(cache.invalidate).toHaveBeenCalledWith("/data/AAPL.intel.json")
  })
  it("uses shared invalidation for retry and performs no closed-workspace reads", async () => {
    await render("AAPL", false); expect(cache.getJSONResult).not.toHaveBeenCalled()
    cache.getJSONResult.mockResolvedValue({ status: "absent" })
    await render("AAPL"); expect(cache.getJSONResult).toHaveBeenCalledTimes(1)
    await act(async () => host.querySelector("button")!.click())
    expect(cache.invalidate).toHaveBeenCalledWith("/data/AAPL.intel.json")
    expect(cache.getJSONResult).toHaveBeenCalledTimes(2)
  })
})
