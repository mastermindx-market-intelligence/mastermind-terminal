// @vitest-environment jsdom
import { act } from "react";
import { renderToString } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RegionalIntelligenceWorkspace, { resolveRegionalIntelligenceView } from "@/components/fin/RegionalIntelligenceWorkspace";
import { applyLang, LangProvider } from "@/lib/i18n";
import type { Fund } from "@/lib/fund";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));


/**
 * These tests pin the HISTORICAL BOUNDARY, not the snapshot's layout. The rule under test is
 * one-directional: a URL that names an event must land on that event and on its own refusal,
 * and no failure of company intelligence may ever resolve into current reported data shown in
 * its place.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FUND = {
  schema: "mastermind.fund/v1",
  ticker: "0700.HK",
  asof: "2026-10-20",
  quote_currency: "HKD",
  stmt_currency: "HKD",
  src: { statements: "akshare", estimates: null, dividends: "yfinance" },
  profile: {
    website: null, employees: null, sector: "Communication Services",
    industry: "Internet Content", description: "Internet and value-added services.", founded: null, hq: "Shenzhen",
  },
  stats: { mktcap: null, shares_out: null, float_shares: null, inst_pct: null, insider_pct: null, beta: null, num_holders: null },
  statements: {
    annual: {
      periods: ["FY2024", "FY2025"], period_end: ["2024-12-31", "2025-12-31"],
      fiscal_year: ["2024", "2025"], period_kind: ["full_year", "full_year"], period_number: [null, null],
      reporting_cadence: "annual",
      income: {
        revenue: [100, 120], cogs: [60, 70], gross_profit: [40, 50], opex: [20, 22],
        op_income: [20, 28], nonop_income: [0, 0], pretax_income: [20, 28], taxes: [4, 6],
        net_income: [16, 22], eps_basic: [1, 1.4], eps_diluted: [1, 1.4], ebitda: [24, 33],
      },
      balance: {
        assets: [500, 560], assets_st: [200, 220], assets_lt: [300, 340], liabilities: [300, 320],
        liab_st: [120, 130], liab_lt: [180, 190], equity: [200, 240], debt: [80, 75],
        cash: [60, 90], net_debt: [20, -15],
      },
      cashflow: { cfo: [18, 25], cfi: [-5, -6], cff: [0, 0], capex: [-5, -6], fcf: [13, 19] },
    },
    quarterly: null,
  },
  ratios: {
    periods: [], pe: [], ps: [], pb: [], pcf: [], ev: [], ev_ebitda: [],
    current: {
      pe_ttm: null, pe_fwd: null, ps: null, pb: null, ev_ebitda: null, ev_sales: null,
      ev_ebit: null, p_fcf: null, div_yield: null, payout: null, gross_margin: null,
      net_margin: null, roe: null, roa: null, debt_to_equity: null, current_ratio: null,
    },
  },
  earnings: { next_date: null, next_period: null, next_eps_est: null, next_rev_est: null, q: [], fy: [] },
  estimates: null, analyst: null,
  dividends: { never_paid: false, yield_ttm: null, payout_ratio: null, events: [], splits: [] },
  ownership: { free_float_pct: null, closely_held_pct: null, top_inst: [] },
  guidance: null, segments: null,
} as unknown as Fund;

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  window.history.replaceState({}, "", "/analysis?symbol=0700.HK&page=intelligence");
  applyLang("en");
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

function setUrl(search: string) {
  window.history.replaceState({}, "", `/analysis${search}`);
}

async function render(props: {
  sym?: string;
  fund?: Fund | null;
  fundLoading?: boolean;
} = {}) {
  const sym = props.sym ?? "0700.HK";
  await act(async () => {
    root.render(
      <LangProvider>
        <RegionalIntelligenceWorkspace
          sym={sym}
          fund={props.fund === undefined ? FUND : props.fund}
          fundLoading={props.fundLoading}
          name={null}
          onNavigate={() => {}}
        >
          <div data-testid="event-view" data-ci-context-state="historical_unavailable">EVENT VIEW</div>
        </RegionalIntelligenceWorkspace>
      </LangProvider>,
    );
  });
}

const view = () => host.querySelector("[data-ci-regional-view]")?.getAttribute("data-ci-regional-view");
const snapshot = () => host.querySelector("[data-regional-company-snapshot]");
const eventView = () => host.querySelector("[data-testid='event-view']");
const tab = (which: "snapshot" | "event") =>
  host.querySelector<HTMLButtonElement>(`[data-ci-regional-tab='${which}']`);

describe("the pure decision", () => {
  it("defaults to the snapshot with no pins and no explicit view", () => {
    expect(resolveRegionalIntelligenceView("")).toBe("snapshot");
    expect(resolveRegionalIntelligenceView("?symbol=0700.HK&page=intelligence")).toBe("snapshot");
  });

  it("forces the event view for ANY pin presence, including blank and malformed values", () => {
    // Presence is the signal. Validity is the child's business, and an invalid reference must
    // render the child's own refusal rather than quietly becoming current data.
    for (const search of [
      "?ci_event=",
      "?ci_event=not-a-real-event-id",
      "?ci_generation=",
      "?ci_company=0",
      "?ci_fingerprint=",
      "?ci_event=x&ci_generation=&ci_company=&ci_fingerprint=",
    ]) expect(resolveRegionalIntelligenceView(search)).toBe("event");
  });

  it("lets a retained pin beat a contradictory ci_view=snapshot", () => {
    expect(resolveRegionalIntelligenceView("?ci_view=snapshot&ci_event=e1")).toBe("event");
  });

  it("honours ci_view=snapshot only when no pin is present", () => {
    expect(resolveRegionalIntelligenceView("?ci_view=snapshot")).toBe("snapshot");
  });

  it("mounts the event view for an explicit ci_view=event with no pins invented", () => {
    expect(resolveRegionalIntelligenceView("?ci_view=event")).toBe("event");
  });

  it("treats an unrecognised ci_view value as the default, not as an event request", () => {
    expect(resolveRegionalIntelligenceView("?ci_view=banana")).toBe("snapshot");
  });
});

describe("regional listing, current and un-pinned", () => {
  it("shows supported reported facts with no company intelligence available at all", async () => {
    // No fetch, no receipt, no CI identity — the listing artifact alone must be useful.
    await render();
    expect(view()).toBe("snapshot");
    expect(snapshot()).not.toBeNull();
    expect(host.textContent).toContain("Internet and value-added services.");
    expect(host.querySelector('[data-ci-regional-metric="revenue"]')).not.toBeNull();
    expect(eventView()).toBeNull();
  });

  it("does not mount the event child by default, so it cannot auto-pin and flash", async () => {
    await render();
    expect(eventView()).toBeNull();
    expect(new URLSearchParams(window.location.search).has("ci_event")).toBe(false);
  });

  it("distinguishes loading from unavailable", async () => {
    await render({ fund: null, fundLoading: true });
    expect(host.querySelector("[data-ci-regional-load-state]")?.getAttribute("data-ci-regional-load-state")).toBe("loading");

    await render({ fund: null, fundLoading: false });
    expect(host.querySelector("[data-ci-regional-load-state]")?.getAttribute("data-ci-regional-load-state")).toBe("unavailable");
  });

  it("says so plainly when the loaded fund belongs to another ticker", async () => {
    await render({ fund: { ...FUND, ticker: "0005.SZ" } as Fund });
    expect(host.textContent).toContain("does not match this symbol");
    expect(host.querySelector('[data-ci-regional-metric="revenue"]')).toBeNull();
  });
});

describe("a pinned historical event always wins", () => {
  it("mounts the event child for a blank pin instead of falling back to current data", async () => {
    setUrl("/analysis?symbol=0700.HK&page=intelligence&ci_event=");
    await render();
    expect(view()).toBe("event");
    expect(eventView()).not.toBeNull();
    expect(snapshot()).toBeNull();
    // The child's exact denial state survives — nothing was replaced by reported data.
    expect(eventView()!.getAttribute("data-ci-context-state")).toBe("historical_unavailable");
  });

  it("mounts the event child for a malformed pin", async () => {
    setUrl("/analysis?symbol=0700.HK&page=intelligence&ci_event=nope&ci_generation=&ci_company=&ci_fingerprint=");
    await render();
    expect(eventView()).not.toBeNull();
    expect(snapshot()).toBeNull();
  });

  it("mounts the event child even when ci_view=snapshot contradicts the pin", async () => {
    setUrl("/analysis?symbol=0700.HK&page=intelligence&ci_view=snapshot&ci_event=e1&ci_generation=g1&ci_company=c1&ci_fingerprint=f1");
    await render();
    expect(view()).toBe("event");
    expect(eventView()).not.toBeNull();
  });

  it("preserves the denial UI rather than replacing it with a snapshot", async () => {
    setUrl("/analysis?symbol=0700.HK&page=intelligence&ci_event=");
    await render();
    expect(host.textContent).toContain("EVENT VIEW");
    expect(host.textContent).not.toContain("Reported company information and financial context");
  });
});

describe("the two view buttons", () => {
  it("shows both, compact, on a regional listing", async () => {
    await render();
    expect(tab("snapshot")!.textContent).toBe("Company snapshot");
    expect(tab("event")!.textContent).toBe("Earnings events");
    expect(tab("snapshot")!.getAttribute("aria-pressed")).toBe("true");
  });

  it("writes EN copy only — no zh leakage", async () => {
    await render();
    expect(host.textContent).not.toContain("公司概况");
  });

  it("switches to the event view without inventing an event or a pin", async () => {
    await render();
    await act(async () => { tab("event")!.click(); });
    expect(view()).toBe("event");
    expect(eventView()).not.toBeNull();
    const params = new URLSearchParams(window.location.search);
    expect(params.get("ci_view")).toBe("event");
    for (const key of ["ci_event", "ci_generation", "ci_company", "ci_fingerprint"])
      expect(params.has(key)).toBe(false);
  });

  it("clears the retained and event-local keys only, preserving symbol, page and other queries", async () => {
    setUrl("/analysis?symbol=0700.HK&page=intelligence&ci_event=e1&ci_generation=g1&ci_company=c1&ci_fingerprint=f1&ci_lens=results&ci_evidence=ev9&watchlist=mine");
    await render();
    expect(view()).toBe("event");

    await act(async () => { tab("snapshot")!.click(); });

    const params = new URLSearchParams(window.location.search);
    for (const key of ["ci_event", "ci_generation", "ci_company", "ci_fingerprint", "ci_lens", "ci_evidence"])
      expect(params.has(key)).toBe(false);
    // Everything the reader arrived with, and everything another surface owns, survives.
    expect(params.get("symbol")).toBe("0700.HK");
    expect(params.get("page")).toBe("intelligence");
    expect(params.get("watchlist")).toBe("mine");
    expect(params.get("ci_view")).toBe("snapshot");

    expect(view()).toBe("snapshot");
    expect(snapshot()).not.toBeNull();
    expect(eventView()).toBeNull();
  });

  it("navigates with pushState so Back returns to the event view", async () => {
    setUrl("/analysis?symbol=0700.HK&page=intelligence&ci_event=e1");
    await render();
    await act(async () => { tab("snapshot")!.click(); });
    expect(view()).toBe("snapshot");

    // jsdom applies history.back() on a later task and fires popstate itself; the component's
    // own popstate listener is what must pick it up, so no event is dispatched by hand here.
    await act(async () => { window.history.back(); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(view()).toBe("event");
    expect(eventView()).not.toBeNull();
  });
});

describe("ticker transitions", () => {
  it("recomputes from the URL and refuses the previous symbol's fund", async () => {
    await render({ sym: "0700.HK" });
    expect(host.querySelector("[data-ci-regional-sym]")?.getAttribute("data-ci-regional-sym")).toBe("0700.HK");

    setUrl("/analysis?symbol=600519.SS&page=intelligence");
    await render({ sym: "600519.SS", fund: { ...FUND, ticker: "0700.HK" } as Fund });
    // The URL now names 600519.SS but the loaded artifact is still 0700's — nothing is shown.
    expect(host.querySelector("[data-ci-regional-sym]")?.getAttribute("data-ci-regional-sym")).toBe("600519.SS");
    expect(host.textContent).toContain("does not match this symbol");
    expect(host.querySelector('[data-ci-regional-metric="revenue"]')).toBeNull();
  });

  it("re-reads the URL when the shell dispatches its own location event", async () => {
    await render();
    expect(view()).toBe("snapshot");
    setUrl("/analysis?symbol=0700.HK&page=intelligence&ci_view=event");
    await act(async () => { window.dispatchEvent(new Event("mmx:shell-location")); });
    expect(view()).toBe("event");
    expect(eventView()).not.toBeNull();
  });

  it("survives rapid consecutive ticker changes without leaking the earlier symbol", async () => {
    const sequence = ["600519.SS", "000001.SZ", "430047.BJ", "SHOP.TO"];
    let previous = "0700.HK";
    for (const sym of sequence) {
      const fund = { ...FUND, ticker: sym } as Fund;
      setUrl(`/analysis?symbol=${encodeURIComponent(sym)}&page=intelligence`);
      await render({ sym, fund });
      expect(host.querySelector("[data-ci-regional-sym]")?.getAttribute("data-ci-regional-sym")).toBe(sym);
      // The heading names THIS ticker and never the one the reader just left.
      expect(host.querySelector(".ci-regional-head h2")!.textContent).toContain(sym);
      expect(host.textContent).not.toContain(previous);
      previous = sym;
    }
  });
});

describe("Chinese copy", () => {
  it("renders zh labels and leaks no EN chrome", async () => {
    await act(async () => { applyLang("zh"); });
    await render();
    const text = host.textContent!;
    expect(text).toContain("公司概况");
    expect(text).toContain("财报事件");
    expect(text).toContain("已披露业绩");
    expect(text).toContain("预测与覆盖");
    expect(text).toContain("公司已披露信息与财务背景");
    // The family-aware top line is localized through the shared helper, not a local string.
    expect(text).toContain("营业收入");
    expect(text).not.toContain("Company snapshot");
    expect(text).not.toContain("Earnings events");
    expect(text).not.toContain("Reported performance");
  });

  it("keeps the ticker, currency and numbers identical across languages", async () => {
    await render();
    const en = host.textContent!;
    await act(async () => { applyLang("zh"); });
    await render();
    const zhText = host.textContent!;
    for (const invariant of ["0700.HK", "HKD", "2025-12-31", "2026-10-20", "120.00", "+20.00%"])
      expect(zhText).toContain(invariant);
    expect(zhText).not.toBe(en);
  });
});

describe("US listings are untouched", () => {
  it("renders the event view directly, with no switch and no snapshot", async () => {
    await render({ sym: "AAPL", fund: { ...FUND, ticker: "AAPL" } as Fund });
    expect(eventView()).not.toBeNull();
    expect(snapshot()).toBeNull();
    expect(host.querySelector("[data-ci-regional-tab]")).toBeNull();
    expect(host.querySelector("[data-ci-regional-view]")).toBeNull();
  });

  it("renders the event view for a Canada suffix this surface does not own", async () => {
    await render({ sym: "SHOP.NE" });
    expect(eventView()).not.toBeNull();
    expect(host.querySelector("[data-ci-regional-tab]")).toBeNull();
  });
});

it("server render of a pinned regional URL never emits a current-data snapshot", () => {
  setUrl("?symbol=0700.HK&page=intelligence&ci_event=");
  const html = renderToString(
    <LangProvider>
      <RegionalIntelligenceWorkspace sym="0700.HK" fund={FUND} onNavigate={() => {}}>
        <div data-incumbent-event="">Pinned event boundary</div>
      </RegionalIntelligenceWorkspace>
    </LangProvider>
  );
  expect(html).toContain("data-incumbent-event");
  expect(html).not.toContain("data-regional-company-snapshot");
});
