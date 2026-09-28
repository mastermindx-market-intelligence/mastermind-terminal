// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOptionsSnapshot } from "@/components/options-companion/useOptionsSnapshot";
import { MatrixCompanion, type MatrixPreferences } from "@/components/options-companion/MatrixCompanion";
import { optionsT } from "@/components/options-companion/optionsStrings";
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


describe("transactional companion scope", () => {
  const doc = { schema: "options_structure.matrix/v1", root: "NVDA", spot: 193, asof: "2026-09-25T20:21:00Z",
    _build_meta: { asof_date: "2026-09-25" }, cells: [
      { strike: 192, expiry: "2026-09-25", gex: 1_000_000, call_oi: 2, put_oi: 1 },
      { strike: 194, expiry: "2026-09-25", gex: 2_000_000, call_oi: 3, put_oi: 2 },
      { strike: 194, expiry: "2026-10-02", gex: -500_000, call_oi: 1, put_oi: 3 },
      { strike: 196, expiry: "2026-10-02", gex: 250_000, call_oi: 2, put_oi: 2 },
    ] };
  function Harness() {
    const [prefs, setPrefs] = React.useState<MatrixPreferences>({ expiries: "3", window: 25, norm: "global" });
    const onPin = React.useCallback(() => {}, []);
    return <MatrixCompanion root="NVDA" metric="gex" prefs={prefs} onPrefs={setPrefs} t={optionsT("en")}
      pinned={null} onPin={onPin} replayActive={false} />;
  }
  it("keeps edits pending until Apply and retains a node hidden by the applied scope", async () => {
    fetchSnapshot.mockResolvedValue(doc);
    await act(async () => root.render(<Harness />));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const oct = element.querySelector<HTMLButtonElement>('button[aria-label^="194, 2026-10-02:"]')!;
    expect(oct).toBeTruthy(); await act(async () => oct.click()); expect(oct.getAttribute("aria-pressed")).toBe("true");
    const open = element.querySelector<HTMLButtonElement>('[data-testid="options-scope-toggle"]')!;
    await act(async () => open.click());
    const expiries = element.querySelector<HTMLSelectElement>('[data-testid="options-scope-expiries"]')!;
    await act(async () => { expiries.value = "0dte"; expiries.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(element.querySelector('button[aria-label^="194, 2026-10-02:"]')).toBeTruthy();
    expect(element.querySelector('[data-testid="options-selection-outside"]')).toBeNull();
    await act(async () => element.querySelector<HTMLButtonElement>('[data-testid="options-scope-apply"]')!.click());
    expect(element.querySelector('button[aria-label^="194, 2026-10-02:"]')).toBeNull();
    expect(element.querySelector('[data-testid="options-selection-outside"]')?.textContent).toContain("Selection outside this view");
    expect(element.querySelector('[data-options-inspector]')?.textContent).toContain("194 · 2026-10-02");
    await act(async () => open.click());
    const restore = element.querySelector<HTMLSelectElement>('[data-testid="options-scope-expiries"]')!;
    await act(async () => { restore.value = "3"; restore.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => element.querySelector<HTMLButtonElement>('[data-testid="options-scope-apply"]')!.click());
    const restored = element.querySelector<HTMLButtonElement>('button[aria-label^="194, 2026-10-02:"]')!;
    expect(restored).toBeTruthy(); expect(restored.getAttribute("aria-pressed")).toBe("true");
    expect(element.querySelector('[data-testid="options-selection-outside"]')).toBeNull();
  });
  it("Cancel discards a pending display change without clearing the selected cell", async () => {
    fetchSnapshot.mockResolvedValue(doc);
    await act(async () => root.render(<Harness />));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const cell = element.querySelector<HTMLButtonElement>('button[aria-label^="194, 2026-10-02:"]')!;
    await act(async () => cell.click());
    await act(async () => element.querySelector<HTMLButtonElement>('[data-testid="options-scope-toggle"]')!.click());
    const norm = element.querySelector<HTMLSelectElement>('[data-testid="options-scope-norm"]')!;
    await act(async () => { norm.value = "column"; norm.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => element.querySelector<HTMLButtonElement>('[data-testid="options-scope-cancel"]')!.click());
    expect(element.textContent).not.toContain("Per-expiry scale: compare intensities");
    expect(element.querySelector<HTMLButtonElement>('button[aria-label^="194, 2026-10-02:"]')?.getAttribute("aria-pressed")).toBe("true");
  });
});
