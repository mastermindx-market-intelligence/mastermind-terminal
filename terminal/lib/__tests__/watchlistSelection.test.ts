import { describe, expect, it } from "vitest";

import {
  copyWatchlistSelection,
  moveWatchlistSelection,
  pruneWatchlistSelection,
  resolveWatchlistContextSelection,
  resolveWatchlistSelection,
} from "@/lib/watchlistSelection";
import {
  insertWatchlistSectionBefore,
  moveWatchlistDragGroup,
  moveWatchlistSection,
  orderWatchlistRowsBySections,
  removeWatchlistSection,
  WATCHLIST_ROOT_SECTION,
  watchlistSectionOrder,
  watchlistVisualOrder,
} from "@/lib/watchlistSections";

const visualOrder = ["AAPL", "MSFT", "NVDA", "AMD", "QQQ"];

describe("watchlist range and discontiguous selection", () => {
  it("selects an inclusive Shift range in visual order", () => {
    expect([...resolveWatchlistSelection({
      current: new Set(), anchor: "MSFT", target: "AMD", visualOrder,
      range: true, toggle: false,
    })]).toEqual(["MSFT", "NVDA", "AMD"]);
  });

  it("unions Cmd/Ctrl+Shift ranges and toggles nonconsecutive rows", () => {
    const toggled = resolveWatchlistSelection({
      current: new Set(["AAPL"]), anchor: "AAPL", target: "QQQ", visualOrder,
      range: false, toggle: true,
    });
    expect([...toggled]).toEqual(["AAPL", "QQQ"]);

    const union = resolveWatchlistSelection({
      current: toggled, anchor: "MSFT", target: "AMD", visualOrder,
      range: true, toggle: true,
    });
    expect([...union]).toEqual(["AAPL", "QQQ", "MSFT", "NVDA", "AMD"]);
  });

  it("keeps an existing selection on right-click and retargets an unselected row", () => {
    const selected = new Set(["AAPL", "NVDA"]);
    expect([...resolveWatchlistContextSelection(selected, "NVDA")]).toEqual(["AAPL", "NVDA"]);
    expect([...resolveWatchlistContextSelection(selected, "AMD")]).toEqual(["AMD"]);
  });

  it("clears bulk state for a plain navigation click and prunes removed rows", () => {
    expect(resolveWatchlistSelection({
      current: new Set(["AAPL", "NVDA"]), anchor: "AAPL", target: "MSFT", visualOrder,
      range: false, toggle: false,
    }).size).toBe(0);
    expect([...pruneWatchlistSelection(new Set(["AAPL", "NVDA"]), [
      { symbol: "NVDA", section: "Growth" },
    ])]).toEqual(["NVDA"]);
  });
});

describe("watchlist bulk mutations", () => {
  const rows = [
    { symbol: "AAPL", section: "Core" },
    { symbol: "MSFT", section: "Core" },
    { symbol: "NVDA", section: "Growth" },
    { symbol: "AMD", section: "Growth" },
    { symbol: "QQQ", section: "Funds" },
  ];

  it("moves selected rows to an existing section in visible order", () => {
    expect(moveWatchlistSelection(rows, new Set(["MSFT", "AMD"]), "Funds", visualOrder)).toEqual([
      { symbol: "AAPL", section: "Core" },
      { symbol: "NVDA", section: "Growth" },
      { symbol: "QQQ", section: "Funds" },
      { symbol: "MSFT", section: "Funds" },
      { symbol: "AMD", section: "Funds" },
    ]);
  });

  it("copies exactly the selected rows in visual order without mutating the source", () => {
    const copied = copyWatchlistSelection(rows, new Set(["QQQ", "AAPL", "NVDA"]), visualOrder);
    expect(copied).toEqual([
      { symbol: "AAPL", section: "Core" },
      { symbol: "NVDA", section: "Growth" },
      { symbol: "QQQ", section: "Funds" },
    ]);
    copied[0]!.section = "Changed";
    expect(rows[0]!.section).toBe("Core");
  });
});

describe("TradingView-style section dividers", () => {
  const rows = [
    { symbol: "SPY", section: WATCHLIST_ROOT_SECTION },
    { symbol: "AAPL", section: "Core" },
    { symbol: "MSFT", section: "Core" },
    { symbol: "NVDA", section: "Growth" },
    { symbol: "AMD", section: "Growth" },
  ];

  it("keeps an unsectioned run ahead of explicit dividers", () => {
    const sections = watchlistSectionOrder(rows, ["Core", "Growth", "Empty"]);
    expect(sections).toEqual(["Core", "Growth", "Empty"]);
    expect(watchlistVisualOrder(rows, sections)).toEqual(["SPY", "AAPL", "MSFT", "NVDA", "AMD"]);
    expect(watchlistVisualOrder(rows, sections, new Set(["Core"]))).toEqual(["SPY", "NVDA", "AMD"]);
  });

  it("inserts a divider above a symbol and splits the tail of that run", () => {
    expect(insertWatchlistSectionBefore(rows, ["Core", "Growth"], "MSFT", "Mega Caps")).toEqual({
      rows: [
        { symbol: "SPY", section: "" },
        { symbol: "AAPL", section: "Core" },
        { symbol: "MSFT", section: "Mega Caps" },
        { symbol: "NVDA", section: "Growth" },
        { symbol: "AMD", section: "Growth" },
      ],
      sections: ["Core", "Mega Caps", "Growth"],
      movedSymbols: ["MSFT"],
    });
  });

  it("removes only the divider and preserves every symbol in order", () => {
    expect(removeWatchlistSection(rows, ["Core", "Growth"], "Growth")).toEqual({
      rows: [
        { symbol: "SPY", section: "" },
        { symbol: "AAPL", section: "Core" },
        { symbol: "MSFT", section: "Core" },
        { symbol: "NVDA", section: "Core" },
        { symbol: "AMD", section: "Core" },
      ],
      sections: ["Core"],
      movedSymbols: ["NVDA", "AMD"],
      targetSection: "Core",
    });
    expect(removeWatchlistSection(rows, ["Core", "Growth"], "Core")?.rows.map((row) => [row.symbol, row.section])).toEqual([
      ["SPY", ""], ["AAPL", ""], ["MSFT", ""], ["NVDA", "Growth"], ["AMD", "Growth"],
    ]);
    const only = removeWatchlistSection(rows.slice(1, 3), ["Core"], "Core");
    expect(only?.sections).toEqual([]);
    expect(only?.rows).toEqual([
      { symbol: "AAPL", section: "" },
      { symbol: "MSFT", section: "" },
    ]);
  });

  it("moves divider blocks without changing membership", () => {
    expect(moveWatchlistSection(["Core", "Growth", "Funds"], "Funds", "Core")).toEqual(["Funds", "Core", "Growth"]);
    expect(moveWatchlistSection(["Core", "Growth"], "Growth", null)).toEqual(["Growth", "Core"]);
    expect(moveWatchlistSection(["Core", "Growth", "Funds"], "Core", "Growth")).toEqual(["Growth", "Core", "Funds"]);
    expect(moveWatchlistSection(["Core", "Growth", "Funds"], "Growth", "Funds")).toEqual(["Core", "Funds", "Growth"]);
  });

  it("stores rows in divider order so a later divider removal cannot scramble symbols", () => {
    const reorderedSections = moveWatchlistSection(["Core", "Growth"], "Core", "Growth");
    const reorderedRows = orderWatchlistRowsBySections(rows, reorderedSections);
    expect(reorderedRows.map((row) => row.symbol)).toEqual(["SPY", "NVDA", "AMD", "AAPL", "MSFT"]);
    expect(removeWatchlistSection(rows, reorderedSections, "Core")?.rows.map((row) => row.symbol)).toEqual([
      "SPY", "NVDA", "AMD", "AAPL", "MSFT",
    ]);
  });

  it("canonicalizes a move into an empty middle divider before later removal", () => {
    const physical = [
      { symbol: "B", section: "Core" },
      { symbol: "G", section: "Growth" },
    ];
    const moved = moveWatchlistSelection(physical, new Set(["G"]), "Empty", ["B", "G"]);
    const canonical = orderWatchlistRowsBySections(moved, ["Core", "Empty", "Growth"]);
    expect(canonical).toEqual([
      { symbol: "B", section: "Core" },
      { symbol: "G", section: "Empty" },
    ]);
    expect(removeWatchlistSection(canonical, ["Core", "Empty", "Growth"], "Growth")?.rows).toEqual(canonical);
  });
});


describe("watchlist grouped drag ordering", () => {
  it("moves a discontiguous selection as one ordered block after the target ticker", () => {
    const rows = [
      { symbol: "SPY", section: "" },
      { symbol: "AAPL", section: "Core" },
      { symbol: "MSFT", section: "Core" },
      { symbol: "NVDA", section: "Growth" },
      { symbol: "AMD", section: "Growth" },
      { symbol: "QQQ", section: "Funds" },
    ];

    expect(moveWatchlistDragGroup(rows, ["Core", "Growth", "Funds"], ["AAPL", "NVDA"], {
      section: "Growth", targetSymbol: "AMD", edge: "after",
    })).toEqual([
      { symbol: "SPY", section: "" },
      { symbol: "MSFT", section: "Core" },
      { symbol: "AMD", section: "Growth" },
      { symbol: "AAPL", section: "Growth" },
      { symbol: "NVDA", section: "Growth" },
      { symbol: "QQQ", section: "Funds" },
    ]);
  });

  it("inserts the whole group at an empty section start and rewrites membership", () => {
    const rows = [
      { symbol: "SPY", section: "" },
      { symbol: "AAPL", section: "Core" },
      { symbol: "MSFT", section: "Core" },
      { symbol: "NVDA", section: "Growth" },
    ];
    expect(moveWatchlistDragGroup(rows, ["Core", "Archive", "Growth"], ["MSFT", "NVDA"], {
      section: "Archive", targetSymbol: null, edge: "start",
    })).toEqual([
      { symbol: "SPY", section: "" },
      { symbol: "AAPL", section: "Core" },
      { symbol: "MSFT", section: "Archive" },
      { symbol: "NVDA", section: "Archive" },
    ]);
  });

  it("moves a selected block to the root and treats a carried target as a no-op", () => {
    const rows = [
      { symbol: "SPY", section: "" },
      { symbol: "AAPL", section: "Core" },
      { symbol: "MSFT", section: "Core" },
      { symbol: "NVDA", section: "Growth" },
    ];
    expect(moveWatchlistDragGroup(rows, ["Core", "Growth"], ["AAPL", "NVDA"], {
      section: WATCHLIST_ROOT_SECTION, targetSymbol: null, edge: "start",
    })).toEqual([
      { symbol: "AAPL", section: "" },
      { symbol: "NVDA", section: "" },
      { symbol: "SPY", section: "" },
      { symbol: "MSFT", section: "Core" },
    ]);
    expect(moveWatchlistDragGroup(rows, ["Core", "Growth"], ["AAPL", "NVDA"], {
      section: "Growth", targetSymbol: "NVDA", edge: "after",
    })).toEqual(orderWatchlistRowsBySections(rows, ["Core", "Growth"]));
  });
});
