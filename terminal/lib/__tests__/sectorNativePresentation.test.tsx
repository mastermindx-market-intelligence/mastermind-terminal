// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SectorNativeBrief from "@/components/sector-intelligence/SectorNativeBrief";
import SectorNativeExplore from "@/components/sector-intelligence/SectorNativeExplore";
import { sectorNativeContext, sectorNativeRankedRows } from "@/components/sector-intelligence/sectorNativeSlots";
import { sectorNativeGeneration } from "@/lib/sectorNativeGeneration";
import captured from "./fixtures/sector_generation.captured.preview.v1.json";

vi.mock("@/lib/i18n", async original => ({ ...await original<typeof import("@/lib/i18n")>(), useLang: () => ({ lang: "en" }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const generation = sectorNativeGeneration(captured);
const sourceRows = sectorNativeRankedRows(generation);
const context = (subjectId: string | null = null) => sectorNativeContext({ generation, transport: "ready",
  subjectId, language: "en", theme: "dark", ownerRevision: "test-owner" });
let root: Root, host: HTMLDivElement;
const actions = { onJob: vi.fn(), onSelect: vi.fn(), onOpenDossier: vi.fn(), onSources: vi.fn() };
beforeEach(() => { vi.clearAllMocks(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

describe("Sector evidence presentation", () => {
  it("keeps source-ordered observations in an accessible comparison and opens the selected subject", async () => {
    await act(async () => root.render(<SectorNativeExplore context={context()} rows={sourceRows} {...actions} />));
    const table = host.querySelector("table")!;
    expect(table.querySelector("caption")?.textContent).toBe("Relative wealth vs SPY · Total return");
    expect([...table.querySelectorAll("thead th")].map(cell => cell.getAttribute("scope"))).toEqual(["col", "col", "col"]);
    const choices = [...table.querySelectorAll<HTMLButtonElement>("tbody th[scope='row'] button")];
    expect(choices.map(button => button.dataset.sectorChoice)).toEqual(sourceRows.map(row => row.id));
    expect(table.querySelectorAll("tbody td")).toHaveLength(sourceRows.length * 2);
    expect(host.querySelector("aside")).toBeNull();
    expect(host.textContent).toContain("Select a sector to inspect it.");
    await act(async () => choices[3].click());
    expect(actions.onSelect).toHaveBeenCalledWith(sourceRows[3].id);
    await act(async () => root.render(<SectorNativeExplore context={context(sourceRows[3].id)} rows={sourceRows} {...actions} />));
    expect(host.querySelector("aside")?.textContent).toContain(sourceRows[3].name);
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="sector-native-inspector-open"]')!.click());
    expect(actions.onOpenDossier).toHaveBeenCalledWith(sourceRows[3].id);
  });

  it.each([[0, 0, "At the benchmark in both measured windows."], [0, 1, "At the benchmark in one measured window."],
    [-1, 0, "At the benchmark in one measured window."], [-1, 1, "The measured windows disagree"]])(
    "describes measured windows %s and %s without turning equality into lagging", async (rs21d, rs63d, copy) => {
      const row = { ...sourceRows[0], rs21d: Number(rs21d), rs63d: Number(rs63d) };
      await act(async () => root.render(<SectorNativeExplore context={context(row.id)} rows={[row]} {...actions} />));
      expect(host.querySelector("aside")?.textContent).toContain(copy);
      expect(host.querySelector("aside")?.textContent).not.toContain("Behind");
    });

  it("distinguishes an empty inventory from unmeasured subjects and keeps recovery actionable", async () => {
    await act(async () => root.render(<SectorNativeExplore context={context()} rows={[]} {...actions} />));
    expect(host.querySelector("h2")?.textContent).toBe("No sectors in this reading");
    expect(host.querySelector("table")).toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
    expect(actions.onJob).toHaveBeenCalledWith("brief");
    const row = { ...sourceRows[0], measured: false, rs21d: null, rs63d: null, reason: "missing_input" };
    await act(async () => root.render(<SectorNativeExplore context={context(row.id)} rows={[row]} {...actions} />));
    expect([...host.querySelectorAll("tbody td")].map(cell => cell.textContent)).toEqual(["—", "—"]);
    expect(host.querySelector("aside")?.textContent).toContain("Not measured");
    expect(host.querySelector("aside")?.textContent).not.toContain("At the benchmark");
  });

  it("puts measured leaders before unavailable breadth and does not promote disconnected save consumers", async () => {
    await act(async () => root.render(<SectorNativeBrief context={context()} rows={sourceRows} {...actions} />));
    const chart = host.querySelector('[data-testid="sector-native-brief-leaders"]')!;
    const coverage = host.querySelector('[data-testid="sector-native-brief-status"]')!;
    expect(chart.compareDocumentPosition(coverage) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(coverage.tagName).toBe("DETAILS");
    expect(coverage.textContent).toContain("Constituent membership is not supplied by this source.");
    expect(host.textContent).not.toContain("Reopen saved context");
    expect(host.querySelector('[data-testid="sector-native-brief-next-research"]')).toBeNull();
    const zeroRow = { ...sourceRows[0], rs21d: 0, rs63d: 1 };
    await act(async () => root.render(<SectorNativeBrief context={context()} rows={[zeroRow]} {...actions} />));
    expect(host.textContent).not.toContain("leads one measured window and lags the other");
  });

  it("offers the inventory when a valid generation has no measured returns", async () => {
    const rows = sourceRows.map(row => ({ ...row, measured: false, rs21d: null, rs63d: null }));
    await act(async () => root.render(<SectorNativeBrief context={context()} rows={rows} {...actions} />));
    expect(host.querySelector('[data-testid="sector-native-brief-unmeasured"]')).not.toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
    expect(actions.onJob).toHaveBeenCalledWith("explore");
  });
});
