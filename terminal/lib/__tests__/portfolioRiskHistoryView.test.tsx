// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PortfolioRiskHistoryReadout } from "@/components/PortfolioView";
import {
  computePortfolioRiskHistory,
  historyCopy,
  type HistoryInputPosition,
  type CloseSeries,
  type RiskFreeSeries,
} from "@/lib/portfolioRiskHistory";

vi.mock("@/components/PortfolioRisk.module.css", () => ({
  default: new Proxy({}, { get: (_t, key) => String(key) }),
}));
vi.mock("@/components/PortfolioRiskHistory.module.css", () => ({
  default: new Proxy({}, { get: (_t, key) => String(key) }),
}));
vi.mock("@/components/PortfolioTargets.module.css", () => ({
  default: new Proxy({}, { get: (_t, key) => String(key) }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const pos = (
  ticker: string,
  shares: number | null,
  entryPrice: number | null,
  status: "open" | "closed" = "open",
): HistoryInputPosition => ({ ticker, shares, entryPrice, status });

const DATES = ["2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05", "2024-01-08", "2024-01-09"];
const series = (closes: number[]): CloseSeries => DATES.map((date, i) => ({ date, close: closes[i] }));
const AAA = series([100, 110, 100, 105, 95, 100]);
const BBB = series([50, 50, 55, 50, 52, 53]);
const SPY = series([200, 202, 198, 201, 199, 204]);
const RF: RiskFreeSeries = { source: "DGS3MO", points: DATES.map((date) => ({ date, close: 5 })) };

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function mount(history = computePortfolioRiskHistory(
  [pos("AAA", 10, 10), pos("BBB", 2, 50)],
  { AAA, BBB },
  SPY,
  RF,
  { minAligned: 5, trailAligned: 5 },
), lang: "en" | "zh" = "en") {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<PortfolioRiskHistoryReadout history={history} lang={lang} />);
  });
  return container;
}

function unmount() {
  if (root) act(() => root!.unmount());
  if (container) container.remove();
  root = null;
  container = null;
}

describe("PortfolioRiskHistoryReadout", () => {
  beforeEach(() => { unmount(); });
  afterEach(() => { unmount(); });

  it("prints Sharpe, Sortino, beta and concentration in both languages without a grade", () => {
    const en = mount();
    expect(en.getAttribute("data-testid") || en.querySelector("[data-testid='portfolio-risk-history']")).toBeTruthy();
    const text = en.textContent ?? "";
    expect(text).toContain("Historical risk of today's book");
    expect(text).toContain("Sharpe ratio");
    expect(text).toContain("Sortino ratio");
    expect(text).toContain("Beta versus SPY");
    expect(text).toContain("Biggest holding");
    expect(text).toMatch(/not realized account/);
    expect(text.toLowerCase()).not.toContain("falsifier");
    unmount();
    const zh = mount(undefined, "zh");
    const zhText = zh.textContent ?? "";
    expect(zhText).toContain("今日持仓的历史风险特征");
    expect(zhText).toContain("夏普比率");
    expect(zhText).toContain("索提诺比率");
    expect(zhText).toMatch(/[，。]/);
  });

  it("shows the empty-book sentence when the open book is empty", () => {
    const h = computePortfolioRiskHistory([], {}, null, null, { minAligned: 5, trailAligned: 5 });
    const el = mount(h);
    expect(el.querySelector("[data-testid='risk-history-empty']")?.textContent).toContain("no open holding");
    expect(el.textContent).not.toContain("At least 126 aligned sessions");
  });

  it("does not print the empty-book sentence when an open name is only excluded", () => {
    const h = computePortfolioRiskHistory(
      [pos("NVDA", 25, 10)],
      {},
      null,
      null,
      { minAligned: 5, trailAligned: 5 },
    );
    const el = mount(h);
    expect(el.querySelector("[data-testid='risk-history-empty']")).toBeNull();
    expect(el.textContent).not.toContain("There is no open holding to describe yet.");
    expect(el.textContent).toContain("Holdings left out");
    expect(el.textContent).toContain("NVDA");
    expect(el.textContent).toContain("no daily price history to read");
    expect(el.textContent).toContain("Biggest holding");
    expect(el.querySelector("[data-card='sharpe']")?.textContent).toMatch(/126|price history|three-month|not enough/i);
  });

  it("shows the not-enough-history sentence when N is below 126", () => {
    const h = computePortfolioRiskHistory(
      [pos("AAA", 10, 10), pos("BBB", 2, 50)],
      { AAA, BBB },
      SPY,
      RF,
    );
    const c = historyCopy(h);
    const el = mount(h);
    expect(el.textContent).toContain(c.sharpe.unread!.en);
    expect(el.textContent).toMatch(/126/);
  });
});
