// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import StatisticsPage from "../../components/fin/StatisticsPage";
import type { Fund } from "../fund";

function fixture(ratios: Partial<Fund["ratios"]> = {}, family = "industrial"): Fund {
  return {
    ticker: "TEST", asof: "2026-09-23", stmt_currency: "USD", stats: {}, profile: null,
    statements: {
      annual: {
        periods: ["FY2023", "FY2024", "FY2025"],
        period_end: ["2023-12-31", "2024-12-31", "2025-12-31"],
        source_market: "us", source_family: family, reporting_cadence: "annual",
        flow_basis: "as_reported", normalization_method: ["as_reported", "as_reported", "as_reported"],
        income: { revenue: [10, 11, 12] }, balance: {}, cashflow: {},
      }, quarterly: null,
    },
    ratios: {
      periods: ["FY2023", "FY2024", "FY2025"], pe: [], ps: [], pb: [], pcf: [], ev: [], ev_ebitda: [],
      current: { pe_ttm: 25, net_margin: .2 }, ...ratios,
    },
  } as unknown as Fund;
}

function render(fund: Fund) {
  const node = document.createElement("div");
  node.innerHTML = renderToStaticMarkup(<StatisticsPage fund={fund} zh={false} />);
  return node;
}

function values(node: HTMLElement, label: string) {
  const row = [...node.querySelectorAll('[data-statistics-group="valuation"] tbody tr')]
    .find(item => item.querySelector('th[scope="row"]')?.textContent === label);
  return row ? [...row.querySelectorAll("td")].map(cell => cell.textContent) : null;
}

describe("Statistics preserves independently published ratio history", () => {
  it.each([
    { field: "pb", label: "Price to book ratio" },
    { field: "pcf", label: "Price to cash flow ratio" },
    { field: "ev_ebitda", label: "Enterprise value to EBITDA" },
  ] as const)("keeps $field history without reserving an empty P/E and P/S chart", ({ field, label }) => {
    const node = render(fixture({ [field]: [1, 2, 3] }));
    expect(node.querySelector('[data-has-history="true"]')).not.toBeNull();
    expect(values(node, label)).toEqual(["1.00", "2.00", "3.00", "—"]);
    expect(values(node, "Price to earnings ratio")?.at(-1)).toBe("25.00");
    expect(node.querySelector(".fin-chart")).toBeNull();
    expect(node.textContent).toContain("Available historical ratios are shown in the table.");
  });

  it("does not expose industrial-only history for a financial-services statement family", () => {
    const node = render(fixture({ ev_ebitda: [1, 2, 3] }, "financial_services"));
    expect(values(node, "Enterprise value to EBITDA")).toBeNull();
    expect(node.querySelector('[data-has-history="false"]')).not.toBeNull();
    expect(values(node, "Price to earnings ratio")).toEqual(["25.00"]);
    expect(node.textContent).toContain("Gross margin is omitted for financial-services statement formats");
  });

  it("does not assign values to missing period labels", () => {
    const node = render(fixture({ periods: [], pe: [10, 20, 30] }));
    expect(node.querySelector('[data-has-history="false"]')).not.toBeNull();
    expect(node.querySelector(".fin-chart")).toBeNull();
    expect(values(node, "Price to earnings ratio")).toEqual(["25.00"]);
  });

  it("keeps a shorter series on its original indices in the latest-six-period window", () => {
    const node = render(fixture({
      periods: ["FY2019", "FY2020", "FY2021", "FY2022", "FY2023", "FY2024", "FY2025"],
      pcf: [10, 20, 30],
    }));
    expect(values(node, "Price to cash flow ratio")).toEqual(["20.00", "30.00", "—", "—", "—", "—", "—"]);
    const table = node.querySelector('[data-statistics-group="valuation"] table')!;
    expect([...table.querySelectorAll("thead th")].map(cell => cell.textContent))
      .toEqual(["Metrics", "FY2020", "FY2021", "FY2022", "FY2023", "FY2024", "FY2025", "Current"]);
  });
});
