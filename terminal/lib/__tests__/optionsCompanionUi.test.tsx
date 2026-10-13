// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOptionsSnapshot } from "@/components/options-companion/useOptionsSnapshot";
import OptionsCompanion from "@/components/options-companion/OptionsCompanion";
import { VannaCompanion } from "@/components/options-companion/VannaCompanion";
import { MatrixCompanion, type MatrixPreferences } from "@/components/options-companion/MatrixCompanion";
import { optionsT } from "@/components/options-companion/optionsStrings";
import { StrikeExpiryMatrix, buildMatrixGrid, type StrikeExpiryDoc } from "@/components/shared/StrikeExpiryMatrix";
import { LangProvider } from "@/lib/i18n";
const { fetchSnapshot } = vi.hoisted(() => ({ fetchSnapshot: vi.fn() }));
vi.mock("@/lib/flowClientCache", () => ({ flowGetResult: fetchSnapshot, flowGetFresh: fetchSnapshot }));
const asData = (data: unknown) => ({ status: "data" as const, data });
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
const doc = { schema: "options_structure.matrix/v1", root: "NVDA", spot: 193, asof: "2026-09-25T20:21:00Z",
  _build_meta: { asof_date: "2026-09-25" }, cells: [
    { strike: 192, expiry: "2026-09-25", gex: 1_000_000, call_oi: 2, put_oi: 1 },
    { strike: 194, expiry: "2026-09-25", gex: 2_000_000, call_oi: 3, put_oi: 2 },
    { strike: 194, expiry: "2026-10-02", gex: -500_000, call_oi: 1, put_oi: 3 },
    { strike: 196, expiry: "2026-10-02", gex: 250_000, call_oi: 2, put_oi: 2 },
  ] };

describe("snapshot lifecycle", () => {
  it("cannot paint a late NVDA response after the chart switched to AMD", async () => {
    const nvda = deferred(), amd = deferred(); fetchSnapshot.mockImplementation((feed: string) => feed === "matrix:NVDA" ? nvda.promise : amd.promise);
    await act(async () => root.render(<Probe feed="matrix:NVDA" />));
    await act(async () => root.render(<Probe feed="matrix:AMD" />));
    await act(async () => nvda.resolve(asData({ root: "NVDA" }))); expect(output().data).toBeNull();
    await act(async () => amd.resolve(asData({ root: "AMD" }))); expect(output().data.root).toBe("AMD");
  });
  it("retains only a same-root dated snapshot on refresh failure and recovers", async () => {
    fetchSnapshot.mockResolvedValueOnce(asData({ root: "NVDA", session: "2026-09-22" })).mockResolvedValueOnce({ status: "unavailable", reason: "server" }).mockResolvedValueOnce(asData({ root: "NVDA", session: "2026-09-23" }));
    await act(async () => root.render(<Probe feed="matrix:NVDA" />));
    await act(async () => element.querySelector("button")!.click());
    expect(output()).toMatchObject({ data: { root: "NVDA", session: "2026-09-22" }, failed: true });
    await act(async () => element.querySelector("button")!.click());
    expect(output()).toMatchObject({ data: { session: "2026-09-23" }, failed: false });
  });
  it("does not poll a hidden document or an unmounted perspective", async () => {
    fetchSnapshot.mockResolvedValue(asData({ root: "NVDA" }));
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    await act(async () => root.render(<Probe feed="matrix:NVDA" />));
    await act(async () => vi.advanceTimersByTime(240_000)); expect(fetchSnapshot).not.toHaveBeenCalled();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    await act(async () => document.dispatchEvent(new Event("visibilitychange"))); expect(fetchSnapshot).toHaveBeenCalledTimes(1);
    await act(async () => root.render(<div />));
    await act(async () => vi.advanceTimersByTime(240_000)); expect(fetchSnapshot).toHaveBeenCalledTimes(1);
  });
  it("ignores a rejected source without retaining another root", async () => {
    fetchSnapshot.mockResolvedValueOnce(asData({ root: "NVDA" })).mockRejectedValueOnce(Error("offline"));
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
  function Harness() {
    const [prefs, setPrefs] = React.useState<MatrixPreferences>({ expiries: "3", window: 25, norm: "global" });
    const onPin = React.useCallback(() => {}, []);
    return <MatrixCompanion root="NVDA" metric="gex" prefs={prefs} onPrefs={setPrefs} t={optionsT("en")}
      pinned={null} onPin={onPin} replayActive={false} />;
  }
  it("keeps edits pending until Apply and retains a node hidden by the applied scope", async () => {
    fetchSnapshot.mockResolvedValue(asData(doc));
    await act(async () => root.render(<Harness />));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const oct = element.querySelector<HTMLButtonElement>('button[aria-label^="194, 2026-10-02:"]')!;
    expect(oct).toBeTruthy(); await act(async () => oct.click()); expect(oct.getAttribute("aria-pressed")).toBe("true");
    const context = element.querySelector('[data-testid="options-node-context"]');
    expect(context?.textContent).toContain("Node context"); expect(context?.textContent).toContain("Strike Σ");
    expect(context?.textContent).toContain("Scope rank"); expect(context?.textContent).toContain("Expiry mix at this strike");
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
    fetchSnapshot.mockResolvedValue(asData(doc));
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

describe("companion fetch failure states", () => {
  const ABSENT = "no published options snapshot for this symbol";
  const UNREADABLE = "options data could not be read — retry";
  const pin = { pinned: null, onPin: () => {}, replayActive: false };
  async function renderCompanion(access: "allowed" | "locked" | "loading" = "allowed") {
    await act(async () => root.render(
      <LangProvider>
        <OptionsCompanion symbol="NVDA" onClose={() => {}} access={access} {...pin} />
      </LangProvider>,
    ));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  }

  it("404 → absent copy", async () => {
    fetchSnapshot.mockResolvedValue({ status: "absent", httpStatus: 404 });
    await renderCompanion();
    expect(element.textContent).toContain(ABSENT);
    expect(element.textContent).not.toContain(UNREADABLE);
  });

  it("503 → unavailable copy", async () => {
    fetchSnapshot.mockResolvedValue({ status: "unavailable", reason: "server", httpStatus: 503 });
    await renderCompanion();
    expect(element.textContent).toContain(UNREADABLE);
    expect(element.textContent).not.toContain(ABSENT);
  });

  it("malformed body → unavailable copy", async () => {
    fetchSnapshot.mockResolvedValue({ status: "unavailable", reason: "malformed", httpStatus: 200 });
    await renderCompanion();
    expect(element.textContent).toContain(UNREADABLE);
    expect(element.textContent).not.toContain(ABSENT);
  });

  it('access="locked" → not-entitled copy AND no fetch issued', async () => {
    await renderCompanion("locked");
    expect(element.textContent).toContain("Unlock the Options desk");
    expect(element.textContent).not.toContain(ABSENT);
    expect(element.textContent).not.toContain(UNREADABLE);
    expect(fetchSnapshot).not.toHaveBeenCalled();
  });

  it("200 → data renders", async () => {
    fetchSnapshot.mockResolvedValue(asData(doc));
    await renderCompanion();
    expect(element.querySelector("[data-options-companion]")).toBeTruthy();
    expect(element.querySelector('button[aria-label^="194, 2026-10-02:"]')).toBeTruthy();
    expect(element.querySelector("[data-options-session]")?.getAttribute("data-options-session")).toBe("2026-09-25");
  });
});

describe("vanna visible total", () => {
  const pin = { pinned: null, onPin: () => {}, replayActive: false };
  const PARTIAL = "Some visible cells are missing; the total includes published values only.";
  function vannaDoc(strikes: { strike: number; vanna_net: number | null }[]) {
    return {
      root: "NVDA", schema: "options_hub.gex/v1", asof: "2026-09-25T20:21:00Z", spot_ref: 193,
      by_strike: strikes,
    };
  }
  async function renderVanna(strikes: { strike: number; vanna_net: number | null }[]) {
    fetchSnapshot.mockResolvedValue(asData(vannaDoc(strikes)));
    await act(async () => root.render(<VannaCompanion root="NVDA" t={optionsT("en")} windowPct={25} {...pin} />));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  }
  function headline() {
    const label = [...element.querySelectorAll("span")].find((node) => node.textContent === "Visible net VEX");
    const row = label?.parentElement ?? null;
    return { summary: row?.parentElement ?? null, total: row?.querySelector("strong") ?? null };
  }

  it("partial Vanna profile shows no numeric headline total", async () => {
    await renderVanna([
      { strike: 190, vanna_net: 1.5 },
      { strike: 195, vanna_net: null },
      { strike: 200, vanna_net: -2.25 },
    ]);
    const profile = element.querySelector('[aria-label="NVDA Vanna"]')!;
    expect([...profile.querySelectorAll("button")].map((node) => node.querySelector("b")?.textContent)).toEqual(["−2.25M", "—", "+1.5M"]);
    const { summary, total } = headline();
    expect(total?.textContent ?? "").not.toMatch(/[0-9]|[MB]/);
    expect(summary?.textContent ?? "").toContain(PARTIAL);
    expect(summary?.querySelector("details")).toBeNull();
    expect(element.querySelector("details")?.textContent).toContain(PARTIAL);
  });

  it("complete Vanna profile shows the summed total", async () => {
    await renderVanna([
      { strike: 190, vanna_net: 1 },
      { strike: 195, vanna_net: 2 },
      { strike: 200, vanna_net: 3 },
    ]);
    const { summary, total } = headline();
    expect(total?.textContent).toBe("+6M");
    expect(summary?.textContent ?? "").not.toContain(PARTIAL);
    expect(element.querySelector("details")?.textContent ?? "").not.toContain(PARTIAL);
  });
});

/** Same ladder as matrixScopeScale.test.ts (a): extreme |gex| sits outside the 101 rows nearest spot. */
function wideScopeMatrix(): StrikeExpiryDoc & { schema: string; root: string } {
  const expiries = ["2026-09-25", "2026-10-02", "2026-10-16"];
  const strikes = Array.from({ length: 160 }, (_, i) => 80 + i * 0.25);
  const band = (index: number) => index >= 60 && index <= 100 ? 1e6
    : (index >= 48 && index <= 59) || (index >= 101 && index <= 112) ? 50e6
    : (index >= 30 && index <= 47) || (index >= 113 && index <= 130) ? 4e6
    : 100e6;
  return {
    schema: "options_structure.matrix/v1", root: "NVDA", spot: 100, asof: "2026-09-25T21:00:00Z",
    _build_meta: { asof_date: "2026-09-25" }, strikes, expiries,
    cells: strikes.flatMap((strike, index) => expiries.map((expiry) => ({ strike, expiry, gex: band(index) }))),
  };
}

describe("PP1-SM map lead", () => {
  function buttonsNamed(name: string): HTMLButtonElement[] {
    return [...element.querySelectorAll("button")].filter((button) => {
      const accessible = button.getAttribute("aria-label") ?? button.textContent ?? "";
      return accessible.replace(/\s+/g, " ").trim() === name;
    });
  }
  async function renderCompanion(metric: "gex" | "oi", payload: unknown) {
    fetchSnapshot.mockResolvedValue(asData(payload));
    function Harness() {
      const [prefs, setPrefs] = React.useState<MatrixPreferences>({ expiries: "3", window: 25, norm: "global" });
      const onPin = React.useCallback(() => {}, []);
      return <MatrixCompanion root="NVDA" metric={metric} prefs={prefs} onPrefs={setPrefs} t={optionsT("en")}
        pinned={null} onPin={onPin} replayActive={false} />;
    }
    await act(async () => root.render(<Harness />));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  }

  it("(e) puts the only pin button inside the selected-node strip", async () => {
    await renderCompanion("gex", doc);
    const cell = element.querySelector<HTMLButtonElement>('[data-options-grid] button[data-value]:not([data-value="missing"])')!;
    expect(cell).toBeTruthy();
    await act(async () => cell.click());
    const pins = buttonsNamed("Pin strike on chart");
    expect(pins).toHaveLength(1);
    expect(pins[0].closest('[data-testid="options-selected-summary"]')).toBeTruthy();
  });

  it("(f) names the real scale law and never asinh", async () => {
    await renderCompanion("gex", doc);
    const signed = element.querySelector('[data-testid="options-scale-basis"]')!;
    expect(signed.textContent).toContain("P95");
    expect(signed.textContent).toContain("square-root");
    expect(signed.textContent).not.toContain("asinh");
    await renderCompanion("oi", doc);
    expect(element.querySelector('[data-testid="options-scale-basis"]')!.textContent).toContain("P5–P95");
  });

  it("(g) keys a missing cell apart from a measured zero", async () => {
    await renderCompanion("gex", doc);
    const key = element.querySelector('[data-testid="options-missing-key"]')!;
    expect(key.textContent).toContain("Not published");
    expect(key.textContent).toContain("0");
  });

  it("(h) paints the rail with the uncapped scope scale", async () => {
    const payload = wideScopeMatrix();
    await renderCompanion("gex", payload);
    const uncapped = buildMatrixGrid({
      matrix: payload, metric: "gex", maxCols: 3, windowPct: 25, maxRows: 10_000,
      exactStrikes: true, normalization: "global", scope: "all",
    })!;
    expect(element.querySelector("[data-options-grid]")!.getAttribute("data-scale-hi")).toBe(String(uncapped.scaleHi));
  });

  it("(i) leads with the map and puts the selected strip directly under the grid", async () => {
    await renderCompanion("gex", doc);
    const map = element.querySelector('[data-testid="options-map-grid"]')!;
    const structure = element.querySelector('[data-testid="options-scope-structure"]')!;
    expect(map.compareDocumentPosition(structure) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(map.nextElementSibling).toBe(element.querySelector('[data-testid="options-selected-summary"]'));
  });

  it("(k) names the gamma legend with gamma and keeps the doi legend on build/unwind", async () => {
    await renderCompanion("gex", doc);
    const legend = element.querySelector('[data-testid="options-missing-key"]')!.parentElement!.textContent ?? "";
    expect(legend).toContain("Positive gamma");
    expect(legend).toContain("Negative gamma");
    await renderCompanion("oi", doc);
    const oiLegend = element.querySelector('[data-testid="options-missing-key"]')!.parentElement!.textContent ?? "";
    expect(oiLegend).not.toContain("gamma");
    const doiDoc = { ...doc, cells: doc.cells.map((c) => ({ ...c, doi: c.gex ?? null })) };
    await renderCompanion("gex", doiDoc);
    const doiLegend = element.querySelector('[data-testid="options-missing-key"]')!.parentElement!.textContent ?? "";
    expect(doiLegend).toContain("Build");
    expect(doiLegend).toContain("Unwind");
  });

  it("(l) puts the key row and coverage inside the map column under the selected strip", async () => {
    await renderCompanion("gex", doc);
    const layout = element.querySelector('[data-testid="options-map-layout"]')!;
    const summary = element.querySelector('[data-testid="options-selected-summary"]')!;
    const key = element.querySelector('[data-testid="options-missing-key"]')!;
    const coverage = element.querySelector('[data-testid="options-coverage"]')!;
    const structure = element.querySelector('[data-testid="options-scope-structure"]')!;
    expect(layout.contains(summary)).toBe(true);
    expect(layout.contains(key)).toBe(true);
    expect(layout.contains(coverage)).toBe(true);
    expect(coverage.closest('[data-testid="options-map-layout"]')).not.toBeNull();
    const order = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(order(summary, key)).toBe(true);
    expect(order(key, coverage)).toBe(true);
    expect(order(coverage, structure)).toBe(true);
  });
});
