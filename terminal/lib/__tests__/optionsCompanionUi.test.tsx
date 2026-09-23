// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOptionsSnapshot } from "@/components/options-companion/useOptionsSnapshot";
import { StrikeExpiryMatrix, buildMatrixGrid } from "@/components/shared/StrikeExpiryMatrix";
const { fetchSnapshot } = vi.hoisted(() => ({ fetchSnapshot: vi.fn() }));
vi.mock("@/lib/flowClientCache", () => ({ flowGetFresh: fetchSnapshot }));
let element: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers(); fetchSnapshot.mockReset();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  element = document.createElement("div"); document.body.appendChild(element); root = createRoot(element);
});
afterEach(async () => { await act(async () => root.unmount()); element.remove(); vi.useRealTimers(); });
function Probe({ feed }: { feed: string }) { const s = useOptionsSnapshot(feed); return <div><output>{JSON.stringify({ data: s.data, loading: s.loading, failed: s.failed })}</output><button onClick={s.refresh}>Refresh</button></div>; }
const output = () => JSON.parse(element.querySelector("output")!.textContent!);
const deferred = () => { let resolve!: (value: unknown) => void; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

describe("snapshot lifecycle", () => {
  it("cannot paint a late NVDA response after the chart switched to AMD", async () => {
    const nvda = deferred(), amd = deferred(); fetchSnapshot.mockImplementation((feed: string) => feed === "matrix:NVDA" ? nvda.promise : amd.promise);
    await act(async () => root.render(<Probe feed="matrix:NVDA" />));
    await act(async () => root.render(<Probe feed="matrix:AMD" />));
    await act(async () => nvda.resolve({ root: "NVDA" })); expect(output().data).toBeNull();
    await act(async () => amd.resolve({ root: "AMD" })); expect(output().data.root).toBe("AMD");
  });
  it("retains only a same-root dated snapshot on refresh failure and recovers", async () => {
    fetchSnapshot.mockResolvedValueOnce({ root: "NVDA", session: "2026-09-22" }).mockResolvedValueOnce(null).mockResolvedValueOnce({ root: "NVDA", session: "2026-09-23" });
    await act(async () => root.render(<Probe feed="matrix:NVDA" />));
    await act(async () => element.querySelector("button")!.click());
    expect(output()).toMatchObject({ data: { root: "NVDA", session: "2026-09-22" }, failed: true });
    await act(async () => element.querySelector("button")!.click());
    expect(output()).toMatchObject({ data: { session: "2026-09-23" }, failed: false });
  });
  it("does not poll a hidden document or an unmounted perspective", async () => {
    fetchSnapshot.mockResolvedValue({ root: "NVDA" });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    await act(async () => root.render(<Probe feed="matrix:NVDA" />));
    await act(async () => vi.advanceTimersByTime(240_000)); expect(fetchSnapshot).not.toHaveBeenCalled();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    await act(async () => document.dispatchEvent(new Event("visibilitychange"))); expect(fetchSnapshot).toHaveBeenCalledTimes(1);
    await act(async () => root.render(<div />));
    await act(async () => vi.advanceTimersByTime(240_000)); expect(fetchSnapshot).toHaveBeenCalledTimes(1);
  });
  it("ignores a rejected source without retaining another root", async () => {
    fetchSnapshot.mockResolvedValueOnce({ root: "NVDA" }).mockRejectedValueOnce(Error("offline"));
    await act(async () => root.render(<Probe feed="matrix:NVDA" />));
    await act(async () => root.render(<Probe feed="matrix:AMD" />));
    expect(output()).toMatchObject({ data: null, failed: true, loading: false });
  });
});

describe("shared rail matrix", () => {
  const matrix = { spot: 192, _build_meta: { asof_date: "2026-09-22" }, cells: [
    { strike: 192, expiry: "2026-09-25", gex: 0 }, { strike: 194, expiry: "2026-09-25", gex: 2_000_000 },
    { strike: 194, expiry: "2026-10-02", gex: -1_000_000 },
  ] };
  it("keeps a missing cell keyboard reachable and distinct from measured zero", async () => {
    const grid = buildMatrixGrid({ matrix, metric: "gex", exactStrikes: true })!;
    const onSelect = vi.fn();
    await act(async () => root.render(<StrikeExpiryMatrix grid={grid} metric="gex" variant="rail" rail={{ selected: null, onSelect, name: "GEX", strikeLabel: "Strike", missingLabel: "Not published", spotLabel: "Reference", units: "dollars per 1%" }} />));
    const zero = element.querySelector<HTMLButtonElement>('[data-row="1"][data-col="0"]')!;
    const missing = element.querySelector<HTMLButtonElement>('[data-row="1"][data-col="1"]')!;
    expect(zero.textContent).toBe("0"); expect(missing.textContent).toBe("—");
    await act(async () => zero.focus());
    await act(async () => zero.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(document.activeElement).toBe(missing); expect(missing.tabIndex).toBe(0);
    expect(element.querySelectorAll('button[tabindex="0"]')).toHaveLength(1);
    await act(async () => missing.click()); expect(onSelect).toHaveBeenLastCalledWith({ strike: 192, expiry: "2026-10-02" });
    await act(async () => missing.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });
  it("never renders rounded non-contract strikes", async () => {
    const grid = buildMatrixGrid({ matrix: { ...matrix, cells: matrix.cells.map(c => ({ ...c, strike: c.strike + .25 })) }, metric: "oi", exactStrikes: true })!;
    expect(grid.strikes).toEqual([194.25, 192.25]); expect(grid.bucket).toBe(0);
  });
});
