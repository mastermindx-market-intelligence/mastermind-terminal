// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AnalysisWorkspace from "@/components/workspaces/AnalysisWorkspace";
import StatisticsPage from "@/components/fin/StatisticsPage";
import { LangProvider } from "@/lib/i18n";
import type { Fund } from "@/lib/fund";

type Frame = { symbol: string; fundSymbol: string | null; intelSymbol: string | null; barClose: number | null; fundLoading: boolean };
const state = vi.hoisted(() => ({
  query: new URLSearchParams(), frames: [] as Frame[], fund: vi.fn(), bars: vi.fn(), intel: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push() {} }), useSearchParams: () => state.query }));
vi.mock("next/link", () => ({ default: ({ children, href }: React.ComponentProps<"a">) => <a href={href}>{children}</a> }));
vi.mock("@/components/chrome/shared-shell/SharedShellPresentation", () => ({ useOptionalSharedShellPresentation: () => null }));
vi.mock("@/components/fin/MegaPane", () => ({
  FIN_PAGES: ["overview", "intelligence", "earnings", "statistics"],
  default: ({ sym, fund, intel, bars, fundLoading }: {
    sym: string; fund: { ticker: string } | null; intel: { symbol: string } | null;
    bars: Array<{ c: number }>; fundLoading: boolean;
  }) => {
    const frame = { symbol: sym, fundSymbol: fund?.ticker ?? null,
      intelSymbol: intel?.symbol ?? null, barClose: bars[0]?.c ?? null, fundLoading };
    state.frames.push(frame);
    return <section data-company-read={JSON.stringify(frame)} />;
  },
}));
vi.mock("@/components/SymbolPicker", () => ({ default: () => null }));
vi.mock("@/lib/fund", () => ({ getFund: (symbol: string) => state.fund(symbol), getBars: (symbol: string) => state.bars(symbol) }));
vi.mock("@/lib/dataCache", () => ({ getJSON: (url: string) => state.intel(url) }));
vi.mock("@/lib/activeSymbol", () => ({ readActiveSymbol: () => null, writeActiveSymbol() {} }));
vi.mock("@/lib/shellBrainSymbol", () => ({ announceShellBrainSymbol() {} }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
function location(symbol: string, page = "overview") {
  state.query = new URLSearchParams({ symbol, page });
  window.history.replaceState({}, "", "/analysis?" + state.query);
}
async function render(initialSymbol = "NVDA") {
  await act(async () => root.render(<LangProvider><AnalysisWorkspace initialSymbol={initialSymbol} initialPage="overview" /></LangProvider>));
}
function shown(): Frame { return JSON.parse(host.querySelector("[data-company-read]")!.getAttribute("data-company-read")!); }

beforeEach(() => {
  vi.useFakeTimers(); state.frames = []; location("NVDA");
  state.fund.mockReset().mockImplementation(async (symbol: string) => ({ ticker: symbol }));
  state.bars.mockReset().mockImplementation(async (symbol: string) => [{ time: 100, o: 1, h: 1, l: 1, c: symbol === "NVDA" ? 11 : 22, v: 0 }]);
  state.intel.mockReset().mockImplementation(async (url: string) => ({ symbol: url.includes("/NVDA.") ? "NVDA" : "AAPL" }));
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ quotes: {} }) })));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.useRealTimers();
});

describe("Analysis company read ownership", () => {
  it("never renders previous-company fundamentals, bars or intelligence under the next ticker", async () => {
    await render(); expect(shown()).toMatchObject({ symbol: "NVDA", fundSymbol: "NVDA", barClose: 11 });
    state.frames = [];
    location("AAPL"); await render();
    expect(state.frames.filter(frame => frame.symbol === "AAPL" && (
      frame.fundSymbol === "NVDA" || frame.intelSymbol === "NVDA" || frame.barClose === 11
    ))).toEqual([]);
    expect(shown()).toMatchObject({ symbol: "AAPL", fundSymbol: "AAPL", intelSymbol: "AAPL", barClose: 22, fundLoading: false });
  });

  it("shows a clean loading frame for a new company whose sources are pending", async () => {
    await render();
    state.fund.mockImplementation(() => new Promise(() => {}));
    state.bars.mockImplementation(() => new Promise(() => {}));
    state.intel.mockImplementation(() => new Promise(() => {}));
    state.frames = []; location("AAPL"); await render();
    expect(state.frames.filter(frame => frame.symbol === "AAPL").every(frame =>
      frame.fundSymbol === null && frame.intelSymbol === null && frame.barClose === null && frame.fundLoading)).toBe(true);
  });

  it("does not adopt an older A request after A to B to A", async () => {
    const pending: Array<{ symbol: string; resolve: (value: { ticker: string }) => void }> = [];
    state.fund.mockImplementation((symbol: string) => new Promise(resolve => pending.push({ symbol, resolve })));
    await render(); location("AAPL"); await render(); location("NVDA"); await render();
    expect(pending.map(item => item.symbol)).toEqual(["NVDA", "AAPL", "NVDA"]);
    await act(async () => { pending[0].resolve({ ticker: "OLD_NVDA" }); pending[1].resolve({ ticker: "AAPL" }); });
    expect(shown()).toMatchObject({ symbol: "NVDA", fundSymbol: null, fundLoading: true });
    await act(async () => pending[2].resolve({ ticker: "NVDA" }));
    expect(shown()).toMatchObject({ fundSymbol: "NVDA", fundLoading: false });
  });

  it("keeps independently available current-company sections when fundamentals fail", async () => {
    state.fund.mockRejectedValue(new Error("fundamental source unavailable"));
    await render();
    expect(shown()).toEqual({ symbol: "NVDA", fundSymbol: null, intelSymbol: "NVDA", barClose: 11, fundLoading: false });
  });

  it("settles an uncovered company without leaving the loading state active", async () => {
    state.fund.mockResolvedValue(null); await render();
    expect(shown()).toMatchObject({ symbol: "NVDA", fundSymbol: null, fundLoading: false });
  });

  it.each(["overview", "statistics", "intelligence"])("does not poll unused live prices on %s", async page => {
    location("NVDA", page); await render();
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    const quoteCalls = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes("/api/quote"));
    expect(quoteCalls).toHaveLength(0);
  });

  it("does not fetch a malformed company selection", async () => {
    location("BAD/IDENTITY"); await render("BAD/IDENTITY");
    expect(state.fund).not.toHaveBeenCalled(); expect(state.bars).not.toHaveBeenCalled();
    expect(host.querySelector("[data-company-read]")).toBeNull();
  });

  it("proves Statistics uses the published ratios rather than the unused quote prop", () => {
    const fund = {
      schema: "mastermind.fund/v1", ticker: "NVDA", asof: "2026-11-06",
      stats: { shares_out: 10 }, profile: { employees: 100 },
      ratios: { periods: [], pe: [], ps: [], pb: [], pcf: [], current: { pe_ttm: 20 } },
      statements: { annual: null, quarterly: null },
    } as unknown as Fund;
    const first = renderToStaticMarkup(<StatisticsPage fund={fund} quote={{ last: 100 }} sym="NVDA" />);
    const second = renderToStaticMarkup(<StatisticsPage fund={fund} quote={{ last: 999 }} sym="NVDA" />);
    expect(first).toContain("20.00"); expect(second).toBe(first);
  });
});