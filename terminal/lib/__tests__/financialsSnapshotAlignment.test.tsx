// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import StatementsPage from "../../components/fin/StatementsPage";
import type { Fund } from "../fund";

function snapshot(grossProfit: (number | null)[]) {
  const values = [100, 200, 300, 400, 500, 600];
  const income = {
    revenue: values, cogs: values, gross_profit: grossProfit, opex: values,
    op_income: values, nonop_income: values, pretax_income: values, taxes: values,
    net_income: values, eps_basic: values, eps_diluted: [], ebitda: values,
  };
  const annual = {
    periods: ["FY2020", "FY2021", "FY2022", "FY2023", "FY2024", "FY2025"],
    source_market: "us", source_family: "industrial", reporting_cadence: "annual",
    flow_basis: "as_reported", income,
    balance: { assets: values, liabilities: values, equity: values, cash: values, debt: values },
    cashflow: { cfo: values, cfi: values, cff: values, capex: values, fcf: values },
  };
  const fund = {
    ticker: "TEST", schema: "mastermind.fund/v1", asof: "2026-09-25",
    stmt_currency: "USD", quote_currency: "USD", statements: { annual, quarterly: null },
    earnings: { q: [], fy: [] },
  } as unknown as Fund;
  const root = document.createElement("div");
  root.innerHTML = renderToStaticMarkup(createElement(StatementsPage, {
    sym: "TEST", fund, onOpenTx: () => undefined,
  }));
  const table = root.querySelector(".fin-financials-snapshot-table")!;
  const row = (label: string) => {
    const match = [...table.querySelectorAll("tbody tr")]
      .find((item) => item.querySelector("th")?.textContent === label)!;
    return [...match.querySelectorAll("td")].map((cell) => {
      const text = cell.textContent?.trim();
      return text === "—" ? null : Number(text?.replaceAll(",", ""));
    });
  };
  return { table, row };
}

describe("Financials snapshot reporting-period identity", () => {
  it("keeps a short source row under its original periods rather than tail-aligning it", () => {
    const { table, row } = snapshot([50, 60, 70]);
    expect([...table.querySelectorAll("thead th")].slice(1).map((th) => th.textContent))
      .toEqual(["FY2022", "FY2023", "FY2024", "FY2025"]);
    expect(row("Gross profit")).toEqual([70, null, null, null]);
  });
  it("renders a missing metric as four explicit unavailable cells", () => {
    expect(snapshot([]).row("Diluted EPS")).toEqual([null, null, null, null]);
  });
  it("preserves explicit missing entries in an otherwise aligned source row", () => {
    expect(snapshot([50, 60, null, 80, 90, 100]).row("Gross profit"))
      .toEqual([null, 80, 90, 100]);
  });
});
