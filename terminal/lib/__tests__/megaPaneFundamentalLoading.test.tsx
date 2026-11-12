// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MegaPane from "@/components/fin/MegaPane";
import type { Fund } from "@/lib/fund";
import type { FinPage } from "@/components/fin/finPages";

const state = vi.hoisted(() => ({ lang: "en" as "en" | "zh" }));
vi.mock("@/lib/i18n", () => ({ useLang: () => ({ lang: state.lang }), useT: () => (key: string) => key }));
vi.mock("@/lib/useMediaQuery", () => ({ useIsMobile: () => false }));
vi.mock("@/components/chrome/shared-shell/SharedShellPresentation", () => ({ useOptionalSharedShellPresentation: () => null }));
vi.mock("@/components/fin/ResearchWorkspaceNav", () => ({ default: () => null }));
vi.mock("@/components/fin/OverviewPage", () => ({ default: ({ fund }: { fund: unknown }) => <p data-fund-child>{fund ? "published data" : "uncovered"}</p> }));
vi.mock("@/components/fin/StatementsPage", () => ({ default: ({ fund }: { fund: unknown }) => <p data-fund-child>{fund ? "published data" : "uncovered"}</p> }));
vi.mock("@/components/fin/StatisticsPage", () => ({ default: ({ fund }: { fund: unknown }) => <p data-fund-child>{fund ? "published data" : "uncovered"}</p> }));
vi.mock("@/components/fin/DividendsPage", () => ({ default: ({ fund }: { fund: unknown }) => <p data-fund-child>{fund ? "published data" : "uncovered"}</p> }));
vi.mock("@/components/fin/EarningsPage", () => ({ default: ({ fund }: { fund: unknown }) => <p data-fund-child>{fund ? "published data" : "uncovered"}</p> }));
vi.mock("@/components/fin/RevenuePage", () => ({ default: ({ fund }: { fund: unknown }) => <p data-fund-child>{fund ? "published data" : "uncovered"}</p> }));
vi.mock("@/components/fin/RegionalIntelligenceWorkspace", () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/components/fin/CompanyIntelligencePage", () => ({ default: () => <p data-independent>independent intelligence</p> }));
vi.mock("@/components/fin/TranscriptsPage", () => ({ default: () => <p data-independent>independent transcripts</p> }));
vi.mock("@/components/fin/ForecastPage", () => ({ default: () => <p data-independent>forecast owns its loading</p> }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
const fundPages: FinPage[] = ["overview", "statements", "statistics", "dividends", "earnings", "revenue"];
const noop = () => {};
beforeEach(() => {
  state.lang = "en"; window.history.replaceState({}, "", "/analysis?symbol=AAPL&page=statistics");
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function render(page: FinPage, fundLoading: boolean, fund: Fund | null = null) {
  await act(async () => root.render(<MegaPane sym="AAPL" page={page} fund={fund} fundLoading={fundLoading} onPage={noop} onClose={noop} mode="workspace" host="route" />));
}

describe("financial read loading is not missing coverage", () => {
  it.each(fundPages)("keeps %s pending instead of invoking its empty-state reader", async page => {
    await render(page, true);
    expect(host.querySelector('[role="status"][aria-busy="true"]')?.textContent).toContain("Loading financial data");
    expect(host.querySelector("[data-fund-child]")).toBeNull();
    await render(page, false);
    expect(host.querySelector('[aria-busy="true"]')).toBeNull();
    expect(host.textContent).toContain("uncovered");
  });
  it.each(fundPages)("preserves the genuine settled absence in %s", async page => {
    await render(page, false);
    expect(host.querySelector('[aria-busy="true"]')).toBeNull();
    expect(host.textContent).toContain("uncovered");
  });
  it.each(fundPages)("does not hide usable %s data during a refresh", async page => {
    await render(page, true, { ticker: "AAPL" } as Fund);
    expect(host.querySelector('[aria-busy="true"]')).toBeNull();
    expect(host.textContent).toContain("published data");
  });
  it.each<FinPage>(["intelligence", "transcripts", "forecast"])("leaves %s with its existing independent loading owner", async page => {
    await render(page, true);
    expect(host.querySelector('[aria-busy="true"]')).toBeNull();
    expect(host.querySelector("[data-independent]")).not.toBeNull();
  });
  it("uses the existing locale for the pending state", async () => {
    state.lang = "zh"; await render("statistics", true);
    expect(host.querySelector('[role="status"][aria-busy="true"]')?.textContent).toContain("正在加载财务数据");
  });
});