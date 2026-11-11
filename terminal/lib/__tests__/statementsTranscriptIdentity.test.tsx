// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StatementsPage from "../../components/fin/StatementsPage";
import type { EarningsQuarter, Fund, StatementPeriodSet } from "../fund";
import { LangProvider, type Lang } from "../i18n";

let host: HTMLDivElement | null = null;
let root: Root | null = null;
let previousLang: string | null = null;

beforeEach(() => {
  previousLang = document.documentElement.getAttribute("data-lang");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  if (previousLang === null) document.documentElement.removeAttribute("data-lang");
  else document.documentElement.setAttribute("data-lang", previousLang);
  vi.unstubAllGlobals();
});

function periodSet(
  periods: string[],
  period_end: string[],
  reporting_cadence: "annual" | "quarterly",
  amount: number | null,
): StatementPeriodSet {
  const v = periods.map(() => amount);
  return {
    periods, period_end, reporting_cadence,
    source_market: "us", source_family: "industrial", flow_basis: "as_reported",
    income: {
      revenue: v, cogs: v, gross_profit: v, opex: v, op_income: v,
      nonop_income: v, pretax_income: v, taxes: v, net_income: v,
      eps_basic: v, eps_diluted: v, ebitda: v,
    },
    balance: {
      assets: v, assets_st: v, assets_lt: v, liabilities: v, liab_st: v,
      liab_lt: v, equity: v, debt: v, cash: v, net_debt: v,
    },
    cashflow: { cfo: v, cfi: v, cff: v, capex: v, fcf: v },
  };
}

function quarter(period: string, end: string, tx: string | null): EarningsQuarter {
  return {
    period, end, tx, report_date: null,
    eps_a: null, eps_e: null, rev_a: null, rev_e: null, surp_pct: null,
  };
}

type Case = {
  name: string;
  annualEnd: string;
  q3End: string;
  q4End: string | null;
  q4Tx: string | null;
  annualTx: string | null;
};

const cases: Case[] = [
  {
    name: "Q4 tx=null does not substitute Q3",
    annualEnd: "2025-12-31", q3End: "2025-09-30",
    q4End: "2025-12-31", q4Tx: null, annualTx: null,
  },
  {
    name: "an absent Q4 row does not substitute Q3",
    annualEnd: "2025-12-31", q3End: "2025-09-30",
    q4End: null, q4Tx: null, annualTx: null,
  },
  {
    name: "an exact Q4 end opens the exact Q4 callback",
    annualEnd: "2025-12-31", q3End: "2025-09-30",
    q4End: "2025-12-31", q4Tx: "2025Q4", annualTx: "2025Q4",
  },
  {
    name: "a Q4 after the off-month annual end cannot authorize Q3",
    annualEnd: "2025-09-27", q3End: "2025-06-30",
    q4End: "2025-09-30", q4Tx: "2025Q4", annualTx: null,
  },
  {
    // Conservative exact-end tradeoff: a legitimate nearby Q4 remains unlinked.
    name: "a Q4 before the annual end is not a heuristic match",
    annualEnd: "2025-09-30", q3End: "2025-06-30",
    q4End: "2025-09-27", q4Tx: "2025Q4", annualTx: null,
  },
];

function fixture(c: Case, amount: number | null): Fund {
  const q = [quarter("Q3 2025", c.q3End, "2025Q3")];
  if (c.q4End) q.push(quarter("Q4 2025", c.q4End, c.q4Tx));
  const q2End = c.q3End === "2025-09-30" ? "2025-06-30" : "2025-03-31";
  const fund: Pick<Fund,
    "schema" | "ticker" | "asof" | "stmt_currency" | "quote_currency" |
    "statements" | "earnings"
  > = {
    schema: "mastermind.fund/v1", ticker: "TEST", asof: "2026-10-10",
    stmt_currency: "USD", quote_currency: "USD",
    statements: {
      annual: periodSet(["2025"], [c.annualEnd], "annual", amount),
      quarterly: periodSet(
        ["Q2 2025", "Q3 2025"], [q2End, c.q3End], "quarterly", amount,
      ),
    },
    earnings: {
      q, fy: [], next_date: null, next_period: null,
      next_eps_est: null, next_rev_est: null,
    },
  };
  // Only unrelated Fund sections are omitted; consumed sections are type-checked above.
  return fund as Fund;
}

function setLanguage(lang: Lang) {
  act(() => {
    document.documentElement.setAttribute("data-lang", lang);
    window.dispatchEvent(new Event("mm:lang"));
  });
}

function selectBasis(label: string) {
  const button = [...host!.querySelectorAll<HTMLButtonElement>(".fin-aq button")]
    .find((node) => node.textContent === label);
  expect(button).toBeDefined();
  expect(button!.disabled).toBe(false);
  act(() => button!.click());
  expect(button!.classList.contains("on")).toBe(true);
}

describe.each([100, 0, null])("statement transcript identity; amount=%s", (amount) => {
  it.each(cases)("$name across basis and language switches", (c) => {
    const onOpenTx = vi.fn();
    const expectedCalls: string[][] = [];
    document.documentElement.setAttribute("data-lang", "en");
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root!.render(
        <LangProvider>
          <StatementsPage sym="TEST" fund={fixture(c, amount)} onOpenTx={onOpenTx} />
        </LangProvider>,
      );
    });

    const check = (period: string, tx: string | null, lang: Lang) => {
      const cells = [...host!.querySelectorAll(".fin-doc-cell")]
        .filter((node) => node.querySelector(".fin-doc-per")?.textContent === period);
      expect(cells).toHaveLength(1);
      const cell = cells[0]!;
      const buttons = cell.querySelectorAll<HTMLButtonElement>("button");
      if (tx === null) {
        expect(buttons).toHaveLength(0);
        expect(cell.querySelector(".fin-doc-none")?.textContent?.trim()).toBe("·");
      } else {
        expect(buttons).toHaveLength(1);
        expect(cell.querySelector(".fin-doc-none")).toBeNull();
        expect(buttons[0]!.getAttribute("aria-label")).toBe(
          lang === "en" ? `Open ${period} transcript` : `打开 ${period} 记录`,
        );
        expectedCalls.push([tx]);
        act(() => buttons[0]!.click());
      }
      // Each real click emits exactly its ID once; controls emit nothing.
      expect(onOpenTx.mock.calls).toEqual(expectedCalls);
    };

    check("2025", c.annualTx, "en");
    selectBasis("Quarterly");
    check("Q2 2025", null, "en");
    check("Q3 2025", "2025Q3", "en");
    setLanguage("zh");
    check("Q2 2025", null, "zh");
    check("Q3 2025", "2025Q3", "zh");
    selectBasis("年度");
    check("2025", c.annualTx, "zh");
    setLanguage("en");
    check("2025", c.annualTx, "en");
  });
});

describe("current Compare source focus survives Financials composition", () => {
  const renderSource = (periodEnd: string, index: number) => {
    document.documentElement.setAttribute("data-lang", "en");
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(
      <LangProvider>
        <StatementsPage sym="TEST" fund={fixture(cases[2]!, 100)}
          focus={{ stmt: "income", basis: "quarterly", index, periodEnd, rowId: "revenue" }} />
      </LangProvider>,
    ));
  };

  it("re-finds the exact source period when the old index is stale and omits a foreign transcript action", () => {
    renderSource("2025-09-30", 0);
    expect(host!.querySelector(".fin-aq button.on")?.textContent).toBe("Quarterly");
    expect([...host!.querySelectorAll("th[data-focus=true]")].map(node => node.textContent))
      .toEqual(["Q3 2025"]);
    expect(host!.querySelectorAll("[data-focus-cell=true]")).toHaveLength(1);
    expect(host!.querySelector("[data-focus-cell=true]")?.textContent).toContain("100");
    expect(host!.querySelector(".fin-doc-strip")).toBeNull();
  });

  it("does not highlight a different period when the source endpoint disappeared", () => {
    renderSource("2025-12-31", 1);
    expect(host!.querySelectorAll("[data-focus]")).toHaveLength(0);
    expect(host!.querySelector(".fin-doc-strip")).toBeNull();
  });
});
