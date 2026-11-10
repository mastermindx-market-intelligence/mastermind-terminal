// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BottomPivotContextCard from "../../components/fin/BottomPivotContextCard";
import fixture from "./fixtures/bottom-pivot/context.json";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
const payload = () => structuredClone(fixture);
const response = (status = 200, body: unknown = payload()) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const render = async (sym = "AAPL", zh = false) => act(async () => root.render(<BottomPivotContextCard sym={sym} zh={zh} />));
const open = async () => act(async () => (host.querySelector("button[aria-expanded]") as HTMLButtonElement).click());

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-05T22:00:00Z"));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response()));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

describe("on-demand bottom-pivot consumer", () => {
  it("makes no startup request and uses the incumbent caller-bound relay when opened", async () => {
    await render(); expect(fetch).not.toHaveBeenCalled();
    expect(host.querySelector("button")?.getAttribute("aria-expanded")).toBe("false");
    await open();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("/api/nw?f=bottom_sensors", expect.objectContaining({ credentials: "same-origin", cache: "no-store", signal: expect.any(AbortSignal) }));
    expect(host.querySelector('[data-testid="bottom-pivot-context"]')?.getAttribute("data-state")).toBe("evidence");
    expect(host.textContent).toContain("A moving-average reclaim is not required");
    expect(host.textContent).toContain("Market, group and intraday bottom confirmation are not established");
    expect(host.textContent).toContain("No calibrated probability");
  });
  it("retains zero and false and renders hostile source strings only as text", async () => {
    const raw = payload(), rows = raw.rows[0].pivot_context.evidence;
    rows.find(row => row.field === "knife_score")!.value = 0;
    rows.find(row => row.field === "above200")!.value = false;
    rows.find(row => row.field === "hold_state")!.value = '<img src=x onerror="alert(1)">';
    vi.mocked(fetch).mockResolvedValue(response(200, raw));
    await render(); await open();
    expect(host.querySelector('[data-field="knife_score"] dd')?.textContent).toBe("0");
    expect(host.querySelector('[data-field="above200"] dd')?.textContent).toBe("No");
    expect(host.querySelector("img")).toBeNull();
    expect(host.textContent).toContain('<img src=x onerror="alert(1)">');
  });
  it.each([[401, "signIn"], [403, "entitled"]])("does not retry an access refusal %s", async (status, state) => {
    vi.mocked(fetch).mockResolvedValue(response(status as number));
    await render(); await open();
    expect(host.querySelector("section")?.getAttribute("data-state")).toBe(state);
    expect(host.textContent).not.toContain("Refresh evidence");
    expect(host.querySelectorAll("[data-field]")).toHaveLength(0);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("distinguishes an unavailable feed from a negative signal", async () => {
    vi.mocked(fetch).mockResolvedValue(response(503));
    await render(); await open();
    expect(host.textContent).toContain("unavailable evidence, not a negative signal");
    expect(host.querySelectorAll("[data-field]")).toHaveLength(0);
  });
  it("does not fetch this US-only record for a Hong Kong listing", async () => {
    await render("0700.HK"); await open();
    expect(fetch).not.toHaveBeenCalled(); expect(host.textContent).toContain("covers U.S. securities only");
  });
  it("keeps unknown first-seen limits visible and provides all thirteen source rows", async () => {
    const raw = payload(); Object.assign(raw.rows[0].pivot_context.evidence[0], { available_at: null });
    vi.mocked(fetch).mockResolvedValue(response(200, raw));
    await render(); await open();
    expect(host.textContent).toContain("original first-seen times are unknown");
    expect(host.querySelectorAll("[data-source-field]")).toHaveLength(13);
  });
  it("does not add an automatic poller or fetch on locale changes", async () => {
    vi.useFakeTimers();
    await render(); await open();
    await act(async () => { vi.advanceTimersByTime(900_000); });
    await render("AAPL", true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("底部转折证据");
    expect(host.textContent).not.toContain("Bottom-pivot evidence");
    expect(host.textContent).not.toContain("Early-turn marker");
  });
  it("clears the prior symbol and ignores its late response", async () => {
    let resolveOld!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
    await render(); await open();
    const firstSignal = vi.mocked(fetch).mock.calls[0][1]?.signal;
    await render("MSFT");
    expect(firstSignal?.aborted).toBe(true);
    expect(host.querySelector("section")?.getAttribute("data-state")).toBe("closed");
    const next = payload(); next.rows[0].symbol = "MSFT"; next.rows[0].pivot_context.symbol = "MSFT";
    next.rows[0].pivot_context.evidence.find(row => row.field === "hold_state")!.value = "NEW_SOURCE";
    vi.mocked(fetch).mockResolvedValueOnce(response(200, next));
    await open();
    const old = payload(); old.rows[0].pivot_context.evidence.find(row => row.field === "hold_state")!.value = "OLD_SOURCE";
    await act(async () => resolveOld(response(200, old)));
    expect(host.textContent).toContain("NEW_SOURCE"); expect(host.textContent).not.toContain("OLD_SOURCE");
  });
});
