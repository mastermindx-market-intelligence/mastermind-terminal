// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sourceSectorGroups, sourceGroupRelation } from "../sectorGroupScope";
import SectorGroupBrowser, { findGroups, type SectorGroupBrowserProps } from "@/components/sector-intelligence/SectorGroupBrowser";
import { LangProvider, applyLang } from "../i18n";
import type { Row } from "../sectorIntelligence";

vi.mock("@/components/ui/MobileSheet", () => ({ default: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div role="dialog">{children}</div> : null }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const semis: Row = { key: "semiconductors", kind: "subsector", sector: "Technology", label: "Semiconductors", label_zh: "半导体", n_members: 14, n_priced: 14 };
const hardware: Row = { key: "computer-hardware", kind: "subsector", sector: "Technology", label: "Computer Hardware", label_zh: "计算机硬件", n_members: 7, n_priced: 0 };
const energy: Row = { key: "oil-gas", kind: "subsector", sector: "Energy", sector_zh: "能源", label: "Oil and Gas", n_members: 3, n_priced: 2 };
const sectorGroup: Row = { key: "sec-technology", kind: "sector", sector: "Technology", label: "Technology sector", n_members: 79, n_priced: 79 };
const unclassified: Row = { key: "unclassified", label: "Unclassified example", n_members: null, n_priced: null };
const groups = [energy, hardware, sectorGroup, semis, unclassified];

describe("Explicit owner sector classifications", () => {
  it("selects only exact source subsectors in source order without mutation", () => {
    const before = JSON.stringify(groups);
    expect(sourceSectorGroups(groups, "Technology")).toEqual([hardware, semis]);
    expect(JSON.stringify(groups)).toBe(before);
  });
  it.each([null, "", "technology", "Technology ", "Information Technology", "科技"])("does not invent an alias for %s", name => {
    expect(sourceSectorGroups(groups, name)).toEqual([]);
  });
  it("rejects duplicate or missing keys in the matched population", () => {
    expect(sourceSectorGroups([semis, { ...semis }], "Technology")).toEqual([]);
    expect(sourceSectorGroups([{ ...semis, key: null }], "Technology")).toEqual([]);
  });
  it("never treats a sector aggregate or an untyped record as a subgroup", () => {
    expect(sourceSectorGroups([sectorGroup, { ...semis, kind: undefined }, { ...semis, sector: true }], "Technology")).toEqual([]);
  });
  it("reports different, unknown and aggregate classifications separately", () => {
    expect(sourceGroupRelation(semis, "Technology")).toBe("same-sector");
    expect(sourceGroupRelation(energy, "Technology")).toBe("other-sector");
    expect(sourceGroupRelation(sectorGroup, "Technology")).toBe("not-a-subsector");
    expect(sourceGroupRelation(unclassified, "Technology")).toBe("unknown");
    expect(sourceGroupRelation(undefined, "Technology")).toBe("unknown");
    expect(sourceGroupRelation(semis, null)).toBe("unknown");
  });
  it("searches source classification without changing it", () => {
    expect(findGroups(groups, "Energy")).toEqual([energy]);
    expect(findGroups(groups, "能源")).toEqual([energy]);
    expect(sourceSectorGroups(groups, "能源")).toEqual([]);
  });
});

describe("Scoped group browser", () => {
  let root: Root, host: HTMLDivElement;
  const select = vi.fn(), close = vi.fn(), sources = vi.fn();
  const render = async (patch: Partial<SectorGroupBrowserProps> = {}) => {
    const props: SectorGroupBrowserProps = { open: true, groups, selected: "semiconductors", status: "ready", theme: "light", sourceSectorName: "Technology", sectorLabel: "Technology", asOf: "2026-09-25", onClose: close, onSelect: select, onReviewSources: sources, ...patch };
    await act(async () => root.render(<LangProvider><SectorGroupBrowser {...props} /></LangProvider>));
  };
  const choices = () => [...host.querySelectorAll<HTMLButtonElement>("[data-group-choice]")];
  const scope = (name: string) => host.querySelector<HTMLButtonElement>(`[data-group-scope="${name}"]`)!;
  beforeEach(() => { vi.clearAllMocks(); document.documentElement.setAttribute("data-lang", "en"); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

  it("defaults to exact sector groups and names the source-date boundary", async () => {
    await render(); expect(choices().map(row => row.dataset.groupChoice)).toEqual(["computer-hardware", "semiconductors"]);
    expect(scope("sector").getAttribute("aria-pressed")).toBe("true");
    expect(host.textContent).toContain("Group snapshot: 2026-09-25");
    expect(host.textContent).toContain("not fund holdings or business exposure");
    expect(select).not.toHaveBeenCalled();
  });
  it("makes all groups recoverable without clearing the current selection", async () => {
    await render(); await act(async () => scope("all").click());
    expect(choices()).toHaveLength(5); expect(choices()[0].textContent).toContain("Energy");
    expect(choices()[3].getAttribute("aria-pressed")).toBe("true");
    await act(async () => scope("sector").click()); expect(choices()).toHaveLength(2);
    expect(select).not.toHaveBeenCalled();
  });
  it("uses the exact subgroup key, preserving observed zero priced coverage", async () => {
    await render(); expect(choices()[0].textContent).toContain("7 companies · 0 priced");
    await act(async () => choices()[0].click()); expect(select).toHaveBeenCalledTimes(1); expect(select).toHaveBeenCalledWith("computer-hardware");
  });
  it("has a recoverable exact-classification empty state rather than an invented alias", async () => {
    await render({ sourceSectorName: "Information Technology", sectorLabel: "Information Technology" });
    expect(choices()).toHaveLength(0); expect(host.textContent).toContain("No exact source classification matches");
    const browse = [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Browse all groups")!;
    await act(async () => browse.click()); expect(choices()).toHaveLength(5);
  });
  it("does not inherit the previous sector's scope choice when sector changes", async () => {
    await render(); await act(async () => scope("all").click()); await render({ sourceSectorName: "Energy", sectorLabel: "Energy" });
    expect(choices()).toHaveLength(1); expect(choices()[0].dataset.groupChoice).toBe("oil-gas");
  });
  it("warns about a selected group from another source sector without resetting it", async () => {
    await render({ selected: "oil-gas" }); expect(host.textContent).toContain("belongs to a different source sector");
    expect(select).not.toHaveBeenCalled(); expect(choices()).toHaveLength(2);
  });
  it("does not present an unclassified or aggregate selection as a verified subgroup", async () => {
    await render({ selected: "sec-technology" }); expect(host.textContent).toContain("does not identify this selection as a subgroup");
    await render({ selected: "unclassified" }); expect(host.textContent).toContain("does not identify this selection as a subgroup");
  });
  it.each(["loading", "access", "invalid", "error", "unavailable"] as const)("clears private group rows, dates and notices on %s", async status => {
    await render({ selected: "oil-gas" }); await render({ status, selected: "oil-gas" });
    expect(choices()).toHaveLength(0); expect(host.textContent).not.toContain("Oil and Gas"); expect(host.textContent).not.toContain("2026-09-25");
  });
  it("has the existing all-groups behavior when no source sector is bound", async () => {
    await render({ sourceSectorName: null }); expect(choices()).toHaveLength(5);
    expect(host.querySelector("[data-group-scope]")).toBeNull(); expect(host.textContent).toContain("independently of the sector selection");
  });
  it("translates controls without using translated names to infer a classification", async () => {
    await render({ sectorLabel: "科技" }); await act(async () => applyLang("zh"));
    expect(choices()).toHaveLength(2); expect(choices()[1].textContent).toContain("半导体");
    expect(host.textContent).toContain("全部来源分组"); expect(scope("sector").textContent).toBe("科技");
  });
});
