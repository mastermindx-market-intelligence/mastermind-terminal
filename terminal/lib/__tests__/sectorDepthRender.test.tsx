// @vitest-environment jsdom
// r2 render-law suite (review lane7_1419_review_r2): the S5 ZH surface — a
// raw owner id or field id must never reach a Chinese reader — plus the
// R2-S1 refused panel, the N2 zero-groups coverage line, the N7 ticker
// escape and the lane-3 CallsNavigateTarget consumer delta, all proved
// against the real depth components.
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ZH without mounting LangProvider's document effect: useLang resolves
// through this override so renderToStaticMarkup can assert each component's
// ZH surface (same approach the r2 review probe proved on this head).
const G = globalThis as unknown as { __SD_LANG?: "en" | "zh" };
G.__SD_LANG = "en";
vi.mock("@/lib/i18n", async (orig) => {
  const m = (await orig()) as Record<string, unknown>;
  return {
    ...m,
    useLang: () => ({ lang: G.__SD_LANG ?? "en", setLang: () => {} }),
  };
});

import { SectorCallsBoard } from "@/components/sector-intelligence/depth/SectorCallsBoard";
import { SectorFlowMatrix } from "@/components/sector-intelligence/depth/SectorFlowMatrix";
import { SectorThemeCompare } from "@/components/sector-intelligence/depth/SectorThemeCompare";
import { SectorConfluenceUniverses } from "@/components/sector-intelligence/depth/SectorConfluenceUniverses";
import { sectorRotationHistory } from "@/lib/sectorIntelligence";
import { cellFocusSelector, flowsFromCarriedBlock, type FlowsData } from "@/lib/sectorDepthFlows";
import type { ActionBoardData, CallsNavigateTarget } from "@/lib/sectorDepthCalls";
import type { UniverseData, UniverseId } from "@/lib/sectorDepthUniverses";
import callsFx from "./fixtures/sectorDepthCallsContract.v1.json";
import flowsFx from "./fixtures/sectorDepthFlowsCarried.v1.json";
import universesFx from "./fixtures/sectorDepthUniversesContract.v1.json";
import capturedFx from "./fixtures/sector_generation.captured.preview.v1.json";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const boardContract = callsFx as unknown as { action_board: ActionBoardData };
const universesContract = universesFx as unknown as {
  universes: Partial<Record<UniverseId, UniverseData>>;
};
const captured = capturedFx as unknown as { projection: { data: Record<string, unknown> } };
const capturedHistory = sectorRotationHistory(captured.projection.data.history);

const html = (el: React.ReactElement): string => renderToStaticMarkup(el);
const text = (h: string): string => h.replace(/<[^>]+>/g, " ");

afterAll(() => {
  G.__SD_LANG = "en";
});

describe("S5 — the ZH surface names the owner and field in Chinese, never raw ids", () => {
  beforeEach(() => {
    G.__SD_LANG = "zh";
  });
  afterEach(() => {
    G.__SD_LANG = "en";
  });

  it("calls board unavailable shows 行动看板 and Macro 板块生成引擎, not the raw ids", () => {
    const zh = text(html(<SectorCallsBoard board={null} />));
    expect(zh).toContain("行动看板"); // siDepthFieldActionBoard[1]
    expect(zh).toContain("Macro 板块生成引擎"); // siDepthOwnerMacroGen[1]
    expect(zh).toContain("本读数未包含"); // siDepthUnavailableTitle[1]
    // A caller regressing to owner="Macro sector generation" or a raw field
    // id fails here — the exact r2 finding at the old SectorThemeCompare mounts.
    expect(zh).not.toContain("Macro sector generation");
    expect(zh).not.toContain("action_board");
    expect(zh).not.toContain("rs_history");
  });

  it("flow matrix unavailable shows ETF 资金流 and the Chinese owner line", () => {
    const zh = text(html(<SectorFlowMatrix flows={null} />));
    expect(zh).toContain("ETF 资金流"); // siDepthFieldEtfFlows[1]
    expect(zh).toContain("Macro 板块生成引擎");
    expect(zh).not.toContain("Macro sector generation");
    expect(zh).not.toContain("ETF fund flows");
    expect(zh).not.toContain("etf_flows");
  });

  it("theme compare WITHOUT history names 相对强弱历史 — the old raw rs_history mount", () => {
    const zh = text(html(<SectorThemeCompare history={null} labels={{}} />));
    expect(zh).toContain("相对强弱历史"); // siDepthFieldRsHistory[1]
    expect(zh).toContain("Macro 板块生成引擎");
    expect(zh).not.toContain("rs_history");
    expect(zh).not.toContain("Macro sector generation");
  });

  it("theme compare WITH the captured history — the unconditional theme_table block's owner line is localized", () => {
    expect(capturedHistory).not.toBeNull();
    const zh = text(html(<SectorThemeCompare history={capturedHistory} labels={{}} />));
    expect(zh).toContain("表现一览"); // siThemeTableTitle[1]
    expect(zh).toContain("Macro 板块生成引擎");
    expect(zh).not.toContain("Macro sector generation");
    expect(zh).not.toContain("theme_table");
  });

  it("entry-evidence identity on the default tab: 标普500 样本域 with the Chinese benchmark", () => {
    const zh = text(html(<SectorConfluenceUniverses universes={universesContract.universes} />));
    expect(zh).toContain("标普500 样本域"); // siUniverseSourceIdentity[1] + siUniverseSp500[1]
    expect(zh).toContain("对比标普500（SPY）"); // siUniverseBenchmarkSp500[1]
    // Raw tab id or English template literals must not survive into ZH.
    expect(zh).not.toContain("vs S&P 500");
    expect(zh).not.toContain("universe · benchmark");
  });
});

describe("depth components, interactive mounts (jsdom)", () => {
  // The calls board's phone accordion reads window.matchMedia; pin desktop.
  const mql = {
    matches: false,
    media: "",
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  };

  let host: HTMLDivElement;
  let root: Root;

  const mount = async (el: React.ReactElement) =>
    act(async () => {
      root.render(el);
    });

  beforeEach(() => {
    vi.stubGlobal("matchMedia", () => mql);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    host.remove();
    vi.unstubAllGlobals();
  });

  it("R2-S1 — an S&P payload mounted under the Nasdaq tab shows the honest unavailable panel, never the S&P rows", async () => {
    const crossMounted: Partial<Record<UniverseId, UniverseData>> = {
      nasdaq: universesContract.universes.subsectors, // owner word sp500_subsectors
    };
    await mount(<SectorConfluenceUniverses universes={crossMounted} />);
    // The nasdaq tab carries data, but the owner word names another universe:
    // no gateable count on the chip (identity precedes access).
    const tab = host.querySelector<HTMLButtonElement>('[data-universe="nasdaq"]');
    expect(tab).not.toBeNull();
    expect(tab!.querySelector("[data-count]")).toBeNull();
    await act(async () => {
      tab!.click();
    });
    expect(host.querySelector('[data-depth-unavailable="confluence"]')).not.toBeNull();
    expect(host.querySelector("table")).toBeNull();
    // Not one S&P group row leaks into the wrong universe's panel.
    expect(host.textContent).not.toContain("Networking Equipment");
  });

  it("N2 — a zero-groups universe keeps its coverage line and identity above the zero sentence", async () => {
    await mount(<SectorConfluenceUniverses universes={universesContract.universes} />);
    const tab = host.querySelector<HTMLButtonElement>('[data-universe="baskets"]');
    expect(tab).not.toBeNull();
    // The baskets payload IS this tab's (curated_baskets): the chip shows 0.
    expect(tab!.querySelector("[data-count]")?.textContent).toContain("0");
    await act(async () => {
      tab!.click();
    });
    const panel = host.textContent ?? "";
    // Coverage line first (0 of 0 … have enough data to time), identity, then
    // the zero-groups sentence — removing CoverageBlock from the zero branch
    // fails these.
    expect(panel).toMatch(/0 of 0 [a-z]+ have enough data to time/);
    expect(panel).toContain("equal-weight basket complex");
    expect(panel).toContain("This universe carries no groups tonight.");
  });

  it("S5 — the baskets tab identity names the basket complex in Chinese, never the raw English literal", async () => {
    G.__SD_LANG = "zh";
    try {
      await mount(<SectorConfluenceUniverses universes={universesContract.universes} />);
      const tab = host.querySelector<HTMLButtonElement>('[data-universe="baskets"]');
      await act(async () => {
        tab!.click();
      });
      const panel = host.textContent ?? "";
      expect(panel).toContain("主题篮子 样本域"); // siUniverseBaskets[1] + identity template
      expect(panel).toContain("等权主题篮子组合"); // siUniverseBasketBenchmark[1]
      expect(panel).not.toContain("equal-weight basket complex");
      expect(panel).not.toContain("Thematic Baskets");
    } finally {
      G.__SD_LANG = "en";
    }
  });

  it("lane-3 delta — the detail control hands the row's href, kind, id and ticker as one CallsNavigateTarget", async () => {
    const onNavigate = vi.fn<(target: CallsNavigateTarget) => void>();
    await mount(<SectorCallsBoard board={boardContract.action_board} onNavigate={onNavigate} />);
    // Desktop keeps every column open; buy_now row 0 is the SYN_S1 sector
    // card ("Synthetic sector 1" — the card shows the display name, so scope
    // by it; column DOM order is layout-driven).
    const card = Array.from(host.querySelectorAll("li[data-kind]")).find(
      (li) =>
        li.getAttribute("data-kind") === "sector" &&
        li.textContent?.includes("Synthetic sector 1"),
    );
    expect(card).toBeDefined();
    const detail = Array.from(card!.querySelectorAll("button")).find(
      (b) => b.textContent === "Open detail",
    );
    expect(detail).toBeDefined();
    await act(async () => {
      detail!.click();
    });
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith({
      href: "/sector/syn_sector_1.html",
      kind: "sector",
      id: "syn_sector_1",
      ticker: "SYN_S1",
    });
  });

  it("N7 — cellFocusSelector matches the rendered hostile-ticker cell (escape pinned end to end)", async () => {
    const parsed = flowsFromCarriedBlock(
      (flowsFx as { cases: { realFull: unknown } }).cases.realFull,
    );
    expect(parsed).not.toBeNull();
    // Lane-authored hostile input: a ticker carrying both quote and backslash.
    const hostile = structuredClone(parsed) as FlowsData;
    hostile.rows[0] = { ...hostile.rows[0], ticker: 'A"B\\C' };
    await mount(<SectorFlowMatrix flows={hostile} />);
    // The unescaped selector is invalid CSS — querySelector throws without
    // the escape inside cellFocusSelector (this is the rAF-crash path).
    expect(() =>
      host.querySelector('td[data-cell-ticker="A"B\\C"][data-cell-window="1d"]'),
    ).toThrow();
    // The escaped one finds the exact rendered cell.
    const sel = cellFocusSelector('A"B\\C', "1d");
    const found: { el: Element | null } = { el: null };
    expect(() => {
      found.el = host.querySelector(sel);
    }).not.toThrow();
    expect(found.el).not.toBeNull();
    expect(found.el!.getAttribute("data-cell-ticker")).toBe('A"B\\C');
    expect(found.el!.getAttribute("data-cell-window")).toBe("1d");
  });
});
