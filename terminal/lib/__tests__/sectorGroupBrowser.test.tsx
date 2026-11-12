// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SectorGroupBrowser, { findGroups, type SectorGroupBrowserProps } from "@/components/sector-intelligence/SectorGroupBrowser";
import { LangProvider, applyLang, LEX } from "@/lib/i18n";
import type { Row } from "@/lib/sectorIntelligence";

// Data/interaction unit tests. The persistent browser suite exercises the real shared modal.
vi.mock("@/components/ui/MobileSheet", () => ({ default: ({ open, children, ariaLabel }: { open: boolean; children: React.ReactNode; ariaLabel: string }) => open ? <div role="dialog" aria-label={ariaLabel}>{children}</div> : null }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const groups: Row[] = [
  { key: "semiconductors", label: "Semiconductors", label_zh: "半导体", n_members: 14, n_priced: 14 },
  { key: "computer-hardware", label: "Computer Hardware", label_zh: "计算机硬件", n_members: 8, n_priced: 6 },
  { key: "energy-equipment", label: "Energy Equipment", label_zh: "能源设备", n_members: null, n_priced: null },
];

describe("Company-group discovery over the existing source", () => {
  it("retains source order and does not mutate or rank the input", () => {
    const before = JSON.stringify(groups); expect(findGroups(groups, "")).toBe(groups);
    expect(findGroups(groups, "e").map(row => row.key)).toEqual(groups.map(row => row.key));
    expect(JSON.stringify(groups)).toBe(before);
  });
  it("supports English, Chinese, exact source keys, whitespace and width-normalized text", () => {
    for (const query of ["computer hardware", " HARDWARE   computer ", "计算机", "computer-hardware", "Ｃｏｍｐｕｔｅｒ"]) {
      expect(findGroups(groups, query).map(row => row.key)).toEqual(["computer-hardware"]);
    }
    expect(findGroups(groups, "unavailable-group")).toEqual([]);
  });
});

describe("Sector group browser", () => {
  let root: Root, host: HTMLDivElement;
  const select = vi.fn(), close = vi.fn(), sources = vi.fn();
  const render = async (patch: Partial<SectorGroupBrowserProps> = {}) => {
    const props: SectorGroupBrowserProps = { open: true, groups, selected: "semiconductors", status: "ready", theme: "light", onClose: close, onSelect: select, onReviewSources: sources, ...patch };
    await act(async () => root.render(<LangProvider><SectorGroupBrowser {...props} /></LangProvider>));
  };
  const choices = () => [...host.querySelectorAll<HTMLButtonElement>("[data-group-choice]")];
  const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent === label)!;
  const search = async (value: string) => { await act(async () => {
    const input = host.querySelector<HTMLInputElement>('input[type="search"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }); };
  beforeEach(() => { vi.clearAllMocks(); document.documentElement.setAttribute("data-lang", "en"); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

  it("identifies the selected group without presenting a sector-membership claim", async () => {
    await render(); expect(choices()).toHaveLength(3);
    expect(choices()[0].getAttribute("aria-pressed")).toBe("true");
    expect(host.textContent).toContain("independently of the sector selection"); expect(select).not.toHaveBeenCalled();
  });
  it("selects the exact source key once, never relabeling hardware as CPU", async () => {
    await render(); await act(async () => choices()[1].click());
    expect(select).toHaveBeenCalledTimes(1); expect(select).toHaveBeenCalledWith("computer-hardware");
    expect(host.textContent).not.toContain("CPU");
  });
  it("searches and clears without changing selection", async () => {
    await render(); await search("设备"); expect(choices()).toHaveLength(1);
    expect(choices()[0].dataset.groupChoice).toBe("energy-equipment");
    await act(async () => button("Clear search").click()); expect(choices()).toHaveLength(3); expect(select).not.toHaveBeenCalled();
  });
  it("distinguishes an empty search from a missing source", async () => {
    await render(); await search("nothing-matches"); expect(host.textContent).toContain("No groups match this search.");
    await render({ status: "unavailable" }); expect(host.textContent).toContain("Company groups are unavailable");
    expect(host.textContent).not.toContain("No groups match");
  });
  it.each(["loading", "access", "invalid", "error", "unavailable"] as const)("never retains actionable stale groups in %s", async status => {
    await render(); await render({ status }); expect(choices()).toHaveLength(0);
    if (status === "access") expect(host.querySelector("a")?.getAttribute("href")).toBe("/login");
  });
  it("keeps null counts different from an observed zero and refuses inconsistent priced counts", async () => {
    await render({ groups: [{ ...groups[0], n_members: 0, n_priced: 0 }, groups[2], { ...groups[1], n_priced: 9 }] });
    expect(choices()[0].textContent).toContain("0 companies · 0 priced");
    expect(choices()[1].textContent).toContain("— companies · — priced");
    expect(choices()[2].textContent).toContain("8 companies · — priced");
  });
  it("bounds initial rendering and exposes the rest without a second data fetch", async () => {
    const many = Array.from({ length: 65 }, (_, index) => ({ ...groups[0], key: `group-${index}`, label: `Group ${index}` }));
    await render({ groups: many }); expect(choices()).toHaveLength(30);
    await act(async () => button("Show more groups").click()); expect(choices()).toHaveLength(60);
    await search("Group 64"); expect(choices()).toHaveLength(1); expect(choices()[0].dataset.groupChoice).toBe("group-64");
  });
  it("uses the existing language provider without adding global LEX entries", async () => {
    await render(); await act(async () => applyLang("zh")); expect(host.textContent).toContain("浏览公司分组");
    expect(choices()[1].textContent).toContain("计算机硬件"); expect(LEX.siBrowseGroups).toBeUndefined();
  });
  it("close and source-review controls emit only their explicit actions", async () => {
    await render(); await act(async () => button("Close").click()); expect(close).toHaveBeenCalledTimes(1); expect(select).not.toHaveBeenCalled();
    await render({ status: "error" }); await act(async () => button("Review sources").click()); expect(sources).toHaveBeenCalledTimes(1);
  });
});
