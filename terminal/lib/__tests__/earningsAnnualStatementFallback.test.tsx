// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import EarningsPage from "@/components/fin/EarningsPage";
import type { EarningsFY, Fund } from "@/lib/fund";

function annualFund(fy: EarningsFY[] = [], estimates: Fund["estimates"] = null): Fund {
  return {
    schema: "mastermind.fund/v1", ticker: "ANNUAL", asof: "2026-10-01", stmt_currency: "USD",
    earnings: { q: [], fy, next_date: null, next_eps_est: null, next_rev_est: null },
    estimates,
    statements: {
      quarterly: null,
      annual: {
        periods: ["FY2024", "FY2025"], period_end: ["2024-12-31", "2025-12-31"],
        source_market: "us", reporting_cadence: "annual",
        income: { revenue: [90e9, 130e9], eps_basic: [1.5, 2.95], eps_diluted: [1.4, 2.90] },
      },
    },
  } as unknown as Fund;
}

function annualRow(overrides: Partial<EarningsFY>): EarningsFY {
  return { period: "FY2025", eps_a: null, eps_e: null, rev_a: null, rev_e: null, surp_pct: null, ...overrides };
}

function render(fund: Fund, zh = false) {
  const element = document.createElement("div");
  element.innerHTML = renderToStaticMarkup(createElement(EarningsPage, { fund, sym: fund.ticker, zh }));
  return element;
}

function pulseValue(element: HTMLElement, metric: "eps" | "revenue") {
  return element.querySelector(`.fin-earn-vnext-pulse-grid article:nth-child(${metric === "eps" ? 2 : 3}) strong`)?.textContent;
}

describe("annual statements remain usable when earnings actuals are absent", () => {
  it.each([false, true])("renders canonical annual Revenue and basic EPS with truthful dates, zh=%s", zh => {
    const element = render(annualFund(), zh);
    expect(pulseValue(element, "eps")).toBe("2.95");
    expect(pulseValue(element, "revenue")).toBe("130.00B");
    const pulse = element.querySelector("[data-earnings-vnext-pulse]")!;
    expect(pulse.textContent).toContain(zh ? "年度 · FY2025" : "Annual · FY2025");
    expect(pulse.textContent).toContain(zh ? "财务报表支持" : "Statement-backed");
    expect(pulse.textContent).toContain(zh ? "报告日期不可用" : "Report date unavailable");
    expect(pulse.textContent).toContain("USD");
    expect(pulse.textContent).not.toContain("2025-12-31");
    expect(pulse.textContent).not.toContain("2026-10-01");
    expect(element.textContent).not.toContain(zh ? "暂无每股盈利数据" : "No EPS data");
  });

  it("uses the source independently for each metric", () => {
    const epsOnly = render(annualFund([annualRow({ eps_a: 7, eps_e: 6.5, surp_pct: 7.6923 })]));
    expect(pulseValue(epsOnly, "eps")).toBe("7.00");
    expect(pulseValue(epsOnly, "revenue")).toBe("130.00B");
    expect(epsOnly.textContent).toContain("Matched actual and estimate");
    const revenueOnly = render(annualFund([annualRow({ rev_a: 150e9, rev_e: 140e9 })]));
    expect(pulseValue(revenueOnly, "eps")).toBe("2.95");
    expect(pulseValue(revenueOnly, "revenue")).toBe("150.00B");
    expect(revenueOnly.textContent).toContain("Earnings contract");
  });

  it("retains available reported earnings actuals ahead of conflicting statements", () => {
    const element = render(annualFund([annualRow({ eps_a: 7, eps_e: 6.5, rev_a: 150e9, rev_e: 140e9 })]));
    expect(pulseValue(element, "eps")).toBe("7.00");
    expect(pulseValue(element, "revenue")).toBe("150.00B");
    expect(element.textContent).not.toContain("Derived from reported financial statements.");
  });

  it("does not join annual estimate-only rows to statement actuals by period label", () => {
    const element = render(annualFund([annualRow({ eps_e: 2, rev_e: 100e9 })], {
      eps_fy: { periods: ["FY2026"], avg: [4] }, rev_fy: { periods: ["FY2026"], avg: [170e9] },
    } as Fund["estimates"]));
    expect(pulseValue(element, "eps")).toBe("2.95");
    expect(pulseValue(element, "revenue")).toBe("130.00B");
    expect(element.textContent).not.toContain("Matched actual and estimate");
    expect(element.querySelector(".fin-earn-vnext-coverage")?.textContent).toContain("Not matched to reported basis");
    const estimateRows = Array.from(element.querySelectorAll(".fin-earn-module tbody tr"))
      .filter(row => /^(Estimate|Surprise)$/.test(row.querySelector("th")?.textContent ?? ""));
    expect(estimateRows.length).toBeGreaterThan(0);
    for (const row of estimateRows) {
      expect(Array.from(row.querySelectorAll("td"), cell => cell.textContent)).toEqual(["—", "—"]);
    }
  });

  it("retains estimate-only presentation when no reported statement actuals exist", () => {
    const fund = annualFund([annualRow({ eps_e: 2, rev_e: 100e9 })]);
    fund.statements!.annual = null;
    const element = render(fund);
    expect(pulseValue(element, "eps")).toBe("—");
    expect(pulseValue(element, "revenue")).toBe("—");
    expect(element.textContent).toContain("100.00B");
    expect(element.textContent).not.toContain("Statement-backed");
  });

  it("retains annual estimates when the displayed statement window contains no actuals", () => {
    const fund = annualFund([annualRow({ eps_e: 2, rev_e: 100e9 })]);
    const statement = fund.statements!.annual!;
    statement.periods = Array.from({ length: 13 }, (_, index) => `FY${2013 + index}`);
    statement.period_end = statement.periods.map(period => `${period.slice(2)}-12-31`);
    statement.income.revenue = [90e9, ...Array(12).fill(null)];
    statement.income.eps_basic = [1.5, ...Array(12).fill(null)];
    const element = render(fund);
    expect(pulseValue(element, "eps")).toBe("—");
    expect(pulseValue(element, "revenue")).toBe("—");
    const estimateRows = Array.from(element.querySelectorAll(".fin-earn-module tbody tr"))
      .filter(row => row.querySelector("th")?.textContent === "Estimate");
    expect(estimateRows).toHaveLength(2);
    expect(estimateRows.map(row => row.querySelector("td")?.textContent)).toEqual(["2.00", "100.00B"]);
    expect(element.textContent).toContain("No reported EPS in this view");
    expect(element.textContent).not.toContain("has not filed");
    expect(element.textContent).not.toContain("Statement-backed");
  });
});
