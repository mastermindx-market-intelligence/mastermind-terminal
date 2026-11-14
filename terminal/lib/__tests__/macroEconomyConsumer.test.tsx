// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { economicSelection, ECONOMIC_WORKSPACES, macroEconomyPayload, type EconomicSelection, type EconomicWorkspaceId } from "../shared-shell/macroEconomyPayload";
import MacroEconomicHistory, { historySegments } from "@/components/macro-economy/MacroEconomicHistory";
import MacroEconomicCurve from "@/components/macro-economy/MacroEconomicCurve";
import MacroEconomicEvidence from "@/components/macro-economy/MacroEconomicEvidence";
import MacroEconomyWorkspace from "@/components/macro-economy/MacroEconomyWorkspace";
import MacroEconomyReader, { type MacroEconomyReaderProps } from "@/components/macro-economy/MacroEconomyReader";
import MacroEconomyOverview from "@/components/macro-economy/MacroEconomyOverview";
import MacroPayrollRevisions from "@/components/macro-economy/MacroPayrollRevisions";
import { todayPayload } from "../shared-shell/readingPayloads";

const auth = vi.hoisted(() => ({ getUser: vi.fn(), onAuthStateChange: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth }) }));
vi.mock("next/link", () => ({ default: ({ href, children, prefetch: _prefetch, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) => <a href={href} {...props}>{children}</a> }));
const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/macro_economy_views.json"), "utf8"));
const overviewFixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/macro_economy_overview.json"), "utf8"));
const payrollFixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/macro_payroll_revisions.json"), "utf8"));
const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222";
const choice = (search = "") => economicSelection(new URLSearchParams(search))!;
const read = (id: EconomicWorkspaceId) => macroEconomyPayload(structuredClone(fixtures[id]), id)!;
const href = (id: EconomicWorkspaceId) => ECONOMIC_WORKSPACES[id].path;
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  auth.getUser.mockResolvedValue({ data: { user: { id: A } }, error: null });
  auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
const mount = async (element: React.ReactNode) => { await act(async () => { root.render(element); }); };
const click = async (text: string) => { const button = Array.from(host.querySelectorAll("button")).find(el => el.textContent === text); expect(button).toBeTruthy(); await act(async () => button!.click()); };

describe("native charts and evidence", () => {
  it("shows the exact driver source and a Chinese calculation while keeping unlinked evidence explicit", async () => {
    const result = read("liquidity_regime");
    if (result.selected_workspace.state !== "ready") throw Error("fixture");
    const source = result.selected_workspace.view.evidence.sources.find(row => row.source_id === "nfci")!;
    await mount(<MacroEconomicEvidence read={result} selection="driver:nfci_pctile" lang="zh" onClose={vi.fn()} onSelect={vi.fn()}/>);
    expect(host.textContent).toContain(source.label.zh);
    expect(host.textContent).toContain("标准化读数");
    expect(host.textContent).toContain("0.30");
    expect(host.textContent).toContain("分项贡献");
    expect(host.querySelector("[data-source-unlinked]")).toBeNull();
    await mount(<MacroEconomicEvidence read={result} selection="driver:rates_scare_score" lang="en" onClose={vi.fn()} onSelect={vi.fn()}/>);
    expect(host.querySelector("[data-source-unlinked]")).not.toBeNull();
    expect(host.textContent).toContain("Component contribution");
  });

  it("opens the source for the exact credit-driver alias without pretending a component calculation exists", async () => {
    const result = read("financial_conditions");
    if (result.selected_workspace.state !== "ready") throw Error("fixture");
    const source = result.selected_workspace.view.evidence.sources.find(row => row.source_id === "hy_oas")!;
    await mount(<MacroEconomicEvidence read={result} selection="driver:hy_oas_z_credit_leg" lang="en" onClose={vi.fn()} onSelect={vi.fn()}/>);
    expect(host.textContent).toContain(source.label.en);
    expect(host.textContent).toContain("does not supply the full component calculation");
    expect(host.querySelector("[data-source-unlinked]")).toBeNull();
  });

  it("keeps an older driver reading usable without guessing its source attribution", async () => {
    const result = read("financial_conditions");
    if (result.selected_workspace.state !== "ready") throw Error("fixture");
    for (const group of result.selected_workspace.view.drivers) for (const row of group.rows) {
      delete row.source_binding; delete row.calculation;
    }
    await mount(<MacroEconomicEvidence read={result} selection="driver:real_10y_pctile" lang="en" onClose={vi.fn()} onSelect={vi.fn()}/>);
    expect(host.querySelector("[data-source-unlinked]")).not.toBeNull();
    expect(host.textContent).toContain("does not supply the full component calculation");
  });

  it.each([[100, 110], [-110, -100], [-10, 20], [0, 0], [75, 75]])("keeps the payroll bar zero baseline inside the plot for %s and %s", async (first, last) => {
    const result = macroEconomyPayload(structuredClone(payrollFixture), "labor_markets")!;
    if (result.selected_workspace.state !== "ready") throw Error("payroll fixture");
    const data = structuredClone(result.selected_workspace.view.payroll_revisions!);
    data.rows = [data.rows.at(-1)!];
    Object.assign(data.rows[0], { earliest_change: first, selected_change: last, net_revision: last - first });
    await mount(<MacroPayrollRevisions data={data} selection={choice("study=revisions")} onSelect={vi.fn()} onEvidence={vi.fn()} lang="en"/>);
    const zero = Number(host.querySelector("[data-payroll-zero]")!.getAttribute("y1"));
    expect(zero).toBeGreaterThanOrEqual(20); expect(zero).toBeLessThanOrEqual(270);
    for (const bar of Array.from(host.querySelectorAll("[data-vintage-role]"))) {
      const top = Number(bar.getAttribute("y")), bottom = top + Number(bar.getAttribute("height"));
      expect(top).toBeGreaterThanOrEqual(20); expect(bottom).toBeLessThanOrEqual(271);
    }
  });

  it("restores a delayed legacy section without pulling the user back on refresh", async () => {
    const scroll = vi.fn(), descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { value: scroll, configurable: true });
    const data = todayPayload(structuredClone(overviewFixture))!;
    const common = { lang: "en" as const, dashboardHref: "/macro.html", overviewHref: "/macro_monetary.html", workspaceHref: href, onRefresh: vi.fn() };
    try {
      window.history.replaceState({}, "", "/macro_monetary.html#growth");
      await mount(<MacroEconomyOverview {...common} data={null} phase="loading"/>);
      expect(scroll).not.toHaveBeenCalled();
      await mount(<MacroEconomyOverview {...common} data={data} phase="ready"/>);
      expect(scroll).toHaveBeenCalledOnce(); expect(scroll.mock.instances[0]).toBe(host.querySelector("#growth"));
      await mount(<MacroEconomyOverview {...common} data={null} phase="loading"/>);
      await mount(<MacroEconomyOverview {...common} data={data} phase="ready"/>);
      expect(scroll).toHaveBeenCalledOnce();
      await act(async () => { window.history.replaceState({}, "", "/macro_monetary.html#trade"); window.dispatchEvent(new HashChangeEvent("hashchange")); });
      expect(scroll).toHaveBeenCalledTimes(2); expect(scroll.mock.instances[1]).toBe(host.querySelector("#trade"));
      await act(async () => { window.history.replaceState({}, "", "/macro_monetary.html#growth"); window.dispatchEvent(new PopStateEvent("popstate")); });
      expect(scroll).toHaveBeenCalledTimes(3); expect(scroll.mock.instances[2]).toBe(host.querySelector("#growth"));
      await act(async () => { window.history.replaceState({}, "", "/macro_monetary.html#not-a-section"); window.dispatchEvent(new HashChangeEvent("hashchange")); });
      expect(scroll).toHaveBeenCalledTimes(3);
    } finally {
      window.history.replaceState({}, "", "/");
      if (descriptor) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", descriptor);
      else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
    }
  });

  it("preserves the full published overview and its mixed-date and coverage meanings in both languages", async () => {
    const data = todayPayload(structuredClone(overviewFixture))!;
    data.read.clauses = Array.from({ length: 5 }, (_, index) => ({ ...data.read.clauses[0], topic: { en: `Topic ${index}`, zh: `主题${index}` }, predicate: { en: `reading ${index}`, zh: `读数${index}` } }));
    data.read.as_of_meaning = { en: "Oldest of five dated readings; each has its own date.", zh: "五项读数中最早的日期；各项保留各自日期。" };
    for (const lang of ["en", "zh"] as const) {
      await mount(<MacroEconomyOverview lang={lang} data={data} phase="ready" dashboardHref="/macro.html" overviewHref="/macro_monetary.html" workspaceHref={href} onRefresh={vi.fn()}/>);
      for (const clause of data.read.clauses) expect(host.querySelector("[data-economic-assessment]")!.textContent).toContain(clause.predicate[lang]);
      expect(host.querySelector("[data-economic-date]")!.textContent).toContain(data.read.as_of_meaning[lang]);
      expect(host.querySelector("[data-economic-date] time")!.textContent).toBe(data.read.as_of_display![lang]);
      expect(host.querySelector("[data-economic-coverage]")!.textContent).toBe(data.strip.find(row => row.id === "coverage")!.note![lang]);
    }
    expect(host.textContent).not.toContain("尚未发布综合经济解读");
  });

  it("clears a weekly observation only when crossing into or out of payroll revisions", async () => {
    const result = macroEconomyPayload(structuredClone(payrollFixture), "labor_markets")!, select = vi.fn();
    const common = { workspaceId: "labor_markets" as const, lang: "en" as const, read: { phase: "ready" as const, data: result }, onSelect: select, onRefresh: vi.fn(), onNavigate: vi.fn(), overviewHref: "/macro_monetary.html", dashboardHref: "/macro.html", workspaceHref: href };
    await mount(<MacroEconomyWorkspace {...common} selection={choice("study=history&series=ICSA&observation=2025-01-09")}/>);
    await click("Payroll revisions"); expect(select).toHaveBeenLastCalledWith({ task: "revisions", evidence: null, series: null, observation: null });
    await mount(<MacroEconomyWorkspace {...common} selection={choice("study=revisions&observation=2025-01-01")}/>);
    await click("History"); expect(select).toHaveBeenLastCalledWith({ task: "history", evidence: null, series: null, observation: null });
    await mount(<MacroEconomyWorkspace {...common} selection={choice("study=history&series=ICSA&observation=2025-01-09")}/>);
    await click("Overview"); expect(select).toHaveBeenLastCalledWith({ task: "overview", evidence: null });
  });

  it("puts owner-specific axis meanings before history and keeps calculation detail collapsed", async () => {
    const result = read("labor_markets");
    await mount(<MacroEconomyWorkspace workspaceId="labor_markets" lang="en" read={{ phase: "ready", data: result }} selection={choice()} onSelect={vi.fn()} onRefresh={vi.fn()} onNavigate={vi.fn()} overviewHref="/macro_monetary.html" dashboardHref="/macro.html" workspaceHref={href}/>);
    const axes = host.querySelector("[data-economic-axes]")!;
    expect(axes.textContent).toContain("Tight market"); expect(axes.textContent).not.toContain("tighter funding");
    const history = host.querySelector("[data-history-qualification]")!;
    expect(axes.compareDocumentPosition(history) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const disclosure = Array.from(host.querySelectorAll("details")).find(detail => detail.querySelector("summary")?.textContent === "How the assessment is formed")!;
    expect(disclosure.open).toBe(false);
    expect(disclosure.textContent).toContain("hold-back");
    expect(host.querySelector("[aria-labelledby='economic-assessment']")!.textContent).not.toContain("hold-back");
  });

  it("keeps payroll chart/table values and month selection bound to the URL", async () => {
    const result = macroEconomyPayload(structuredClone(payrollFixture), "labor_markets")!;
    if (result?.selected_workspace.state !== "ready") throw Error("payroll fixture");
    const data = result.selected_workspace.view.payroll_revisions!, select = vi.fn(), evidence = vi.fn();
    const selection = choice("study=revisions&observation=2025-01-01&display=chart&window=published");
    await mount(<MacroPayrollRevisions data={data} selection={selection} onSelect={select} onEvidence={evidence} lang="en"/>);
    expect(host.querySelector('[data-reference-period="2025-01-01"] [data-vintage-role="earliest_change"]')!.getAttribute("data-value")).toBe("57");
    expect(host.querySelector('[data-reference-period="2025-01-01"] [data-vintage-role="selected_change"]')!.getAttribute("data-value")).toBe("30");
    expect(host.querySelector('[data-reference-period="2024-11-01"] [data-vintage-role]')).toBeNull();
    await click("Table"); expect(select).toHaveBeenLastCalledWith({ display: "table" });
    await mount(<MacroPayrollRevisions data={data} selection={{ ...selection, display: "table" }} onSelect={select} onEvidence={evidence} lang="en"/>);
    expect(host.querySelector("tr[data-selected]")!.textContent).toContain("-27");
    expect(host.querySelector("tr[data-selected]")!.textContent).toContain("7 Feb 2025");
    await click("Show the calculation ↗"); expect(evidence).toHaveBeenLastCalledWith("metric:payroll_revision:2025-01-01:net_revision");
  });

  it("shows Chinese revision calculation and exact receipt sources without a first-release claim", async () => {
    const result = macroEconomyPayload(structuredClone(payrollFixture), "labor_markets")!;
    if (result?.selected_workspace.state !== "ready") throw Error("payroll fixture");
    await mount(<MacroEconomyWorkspace workspaceId="labor_markets" lang="zh" read={{ phase: "ready", data: result }} selection={choice("study=revisions&observation=2025-01-01&display=table")} onSelect={vi.fn()} onRefresh={vi.fn()} onNavigate={vi.fn()} overviewHref="/macro_monetary.html" dashboardHref="/macro.html" workspaceHref={href}/>);
    expect(host.textContent).toContain("最早保留读数可能晚于首次发布");
    expect(host.querySelector("tr[data-selected]")!.textContent).toContain("-27");
    await mount(<MacroEconomicEvidence read={result} selection="metric:payroll_revision:2025-01-01:net_revision" lang="zh" onClose={vi.fn()} onSelect={vi.fn()}/>);
    expect(host.textContent).toContain("同一版本");
    expect(host.querySelector("table")!.textContent).toContain("57");
    expect(host.querySelector("table")!.textContent).toContain("30");
    expect(host.querySelector('a[href="https://alfred.stlouisfed.org/series?seid=PAYEMS"]')).not.toBeNull();
  });
  it("keeps all fourteen destinations and distinguishes Policy's figure-only reading", async () => {
    const data = todayPayload(structuredClone(overviewFixture))!;
    const policy = data.strip.find(row => row.section === "policy")!;
    Object.assign(policy, { null: true, value: null, cause: "see_curve" });
    await mount(<MacroEconomyOverview lang="en" data={data} phase="ready" dashboardHref="/macro.html" overviewHref="/macro_monetary.html" workspaceHref={href} onRefresh={vi.fn()}/>);
    for (const id of Object.keys(ECONOMIC_WORKSPACES) as EconomicWorkspaceId[]) expect(host.querySelector(`a[href="${href(id)}"]`)).not.toBeNull();
    expect(host.querySelector('a[href="/macro_monetary_policy.html"] strong')!.textContent).toBe("Explore policy rates");
  });

  it("does not display a retained overview response through an access failure", async () => {
    await mount(<MacroEconomyOverview lang="en" data={todayPayload(overviewFixture)} phase="access" dashboardHref="/macro.html" overviewHref="/macro_monetary.html" workspaceHref={href} onRefresh={vi.fn()}/>);
    expect(host.textContent).toContain("Your current access");
    expect(host.textContent).not.toContain("is easy to get but thinly supported");
  });

  it("places the qualified state explanation before charts and retains every remaining context entry", async () => {
    const result = read("liquidity_regime"); if (result.selected_workspace.state !== "ready") throw Error("fixture");
    await mount(<MacroEconomyWorkspace workspaceId="liquidity_regime" lang="en" read={{ phase: "ready", data: result }} selection={choice()} onSelect={vi.fn()} onRefresh={vi.fn()} onNavigate={vi.fn()} overviewHref="/macro_monetary.html" dashboardHref="/macro.html" workspaceHref={href}/>);
    const context = host.querySelector("[data-economic-reading-context]")!;
    const history = host.querySelector("[data-history-qualification]")!;
    expect(context.compareDocumentPosition(history) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const disclosure = context.querySelector("details")!;
    expect(disclosure.open).toBe(false);
    for (const entry of result.selected_workspace.view.implications.entries) {
      expect(context.textContent).toContain(entry.text.en);
      if (entry.evidence_claim) expect(context.textContent).toContain(entry.evidence_claim.en);
    }
    const lead = result.selected_workspace.view.implications.entries.find(entry => entry.implication_id === "state_descriptive")!;
    expect(context.querySelector("ul")!.textContent).toContain(lead.text.en);
    expect(disclosure.textContent).not.toContain(lead.text.en);
    const rates = read("rates_curves"); if (rates.selected_workspace.state !== "ready") throw Error("fixture");
    await mount(<MacroEconomyWorkspace workspaceId="rates_curves" lang="en" read={{ phase: "ready", data: rates }} selection={choice()} onSelect={vi.fn()} onRefresh={vi.fn()} onNavigate={vi.fn()} overviewHref="/macro_monetary.html" dashboardHref="/macro.html" workspaceHref={href}/>);
    const ratesContext = host.querySelector("[data-economic-reading-context]")!;
    expect(ratesContext.querySelector("details")!.open).toBe(false);
    expect(ratesContext.querySelector("details")!.textContent).toContain("added after the original twelve workspaces");
    expect(host.querySelector("#economic-assessment")!.textContent).toBe(rates.selected_workspace.view.curve_hero!.shape_read.en);
  });

  it.each(["en", "zh"] as const)("does not fill unavailable inflation rates from populated price-level history (%s)", async lang => {
    const result = read("inflation_system"); if (result.selected_workspace.state !== "ready") throw Error("fixture");
    expect(result.selected_workspace.view.series.entries[0].points!.some(point => point.v !== null)).toBe(true);
    await mount(<MacroEconomyWorkspace workspaceId="inflation_system" lang={lang} read={{ phase: "ready", data: result }} selection={choice()} onSelect={vi.fn()} onRefresh={vi.fn()} onNavigate={vi.fn()} overviewHref="/macro_monetary.html" dashboardHref="/macro.html" workspaceHref={href}/>);
    expect(Array.from(host.querySelectorAll("[data-inflation-rate] strong")).map(node => node.textContent)).toEqual(["—", "—", "—", "—"]);
    expect(host.querySelector("[data-inflation-rates]")!.textContent).toContain(lang === "zh" ? "当前通胀率暂不可用" : "Current inflation rates are unavailable");
    expect(host.querySelector("#economic-assessment")!.textContent).toBe(lang === "zh" ? "当前解读不可用" : "Current assessment unavailable");
    expect(host.textContent).toContain(lang === "zh" ? "价格水平" : "Price levels");
    const rates = host.querySelector("[data-inflation-rates]")!, history = host.querySelector("[data-history-qualification]")!;
    expect(rates.compareDocumentPosition(history) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows exact published inflation rates including zero and opens the matching metric evidence", async () => {
    const result = read("inflation_system"); if (result.selected_workspace.state !== "ready") throw Error("fixture");
    const metric = result.selected_workspace.view.metrics.find(row => row.metric_id === "headline_cpi_yoy_pct")!;
    metric.value = { en: "0.00", zh: "0.00" }; metric.value_raw = 0;
    metric.reference_period = "2026-10"; metric.freshness = { en: "Older input", zh: "较早的数据" };
    const onSelect = vi.fn();
    await mount(<MacroEconomyWorkspace workspaceId="inflation_system" lang="en" read={{ phase: "ready", data: result }} selection={choice()} onSelect={onSelect} onRefresh={vi.fn()} onNavigate={vi.fn()} overviewHref="/macro_monetary.html" dashboardHref="/macro.html" workspaceHref={href}/>);
    const tile = host.querySelector<HTMLButtonElement>('[data-inflation-rate="headline_cpi_yoy_pct"]')!;
    expect(tile.querySelector("strong")!.textContent).toBe("0.00%");
    expect(tile.textContent).toContain("Over the past year"); expect(tile.textContent).toContain("2026-10"); expect(tile.textContent).toContain("Older input");
    expect(host.querySelector('[data-inflation-rate="core_cpi_yoy_pct"] strong')!.textContent).toBe("—");
    await act(async () => { tile.focus(); tile.click(); });
    expect(onSelect).toHaveBeenLastCalledWith({ evidence: "metric:headline_cpi_yoy_pct" });
  });

  it.each([0.5, 1.6])("selects the actual observation when the history SVG is rendered at %s scale", async scale => {
    const result = read("inflation_system"); if (result.selected_workspace.state !== "ready") throw Error("fixture");
    const v = result.selected_workspace.view, series = structuredClone(v.series.entries[0]);
    series.points = [{ t: "2026-01-01", v: 100 }, { t: "2026-01-02", v: 101 }, { t: "2026-01-03", v: 102 }];
    const onSelect = vi.fn();
    await mount(<MacroEconomicHistory entries={[series]} sources={v.evidence.sources} lang="en" selection={choice("window=published")} onSelect={onSelect} onEvidence={vi.fn()}/>);
    const svg = host.querySelector("svg")!, hit = svg.querySelector('rect[fill="transparent"]')!;
    const width = Number(svg.getAttribute("width"));
    const midpoint = Number(hit.getAttribute("x")) + Number(hit.getAttribute("width")) / 2;
    svg.getBoundingClientRect = () => ({ x: 100, y: 0, left: 100, top: 0, right: 100 + width * scale, bottom: 322, width: width * scale, height: 322, toJSON() {} });
    await act(async () => hit.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 100 + midpoint * scale })));
    expect(onSelect).toHaveBeenLastCalledWith({ series: series.series_id, observation: "2026-01-02" });
  });

  it("breaks the actual inflation fixture at its null observation and keeps the gap in the table", async () => {
    const result = read("inflation_system"); if (result.selected_workspace.state !== "ready") throw Error("fixture");
    const v = result.selected_workspace.view, series = v.series.entries.find(row => row.points?.some(p => p.v === null))!;
    const segments = historySegments(series.points!, p => Date.parse(p.t), n => n);
    expect(segments.length).toBeGreaterThan(1);
    await mount(<MacroEconomicHistory entries={[series]} sources={v.evidence.sources} lang="en" selection={choice("display=table&window=published")} onSelect={vi.fn()} onEvidence={vi.fn()}/>);
    expect(host.querySelector("table")!.textContent).toContain("No observation");
    expect(host.querySelector("[data-history-qualification]")!.textContent).toContain(series.freshness.en);
  });

  it("qualifies populated simulated and older history in chart and table views", async () => {
    const result = read("inflation_system"); if (result.selected_workspace.state !== "ready") throw Error("fixture");
    const v = result.selected_workspace.view, series = structuredClone(v.series.entries[0]);
    for (const display of ["chart", "table"]) {
      series.freshness = { en: "Simulated", zh: "模拟" };
      await mount(<MacroEconomicHistory entries={[series]} sources={v.evidence.sources} lang="en" selection={choice(`display=${display}`)} onSelect={vi.fn()} onEvidence={vi.fn()}/>);
      expect(host.querySelector("[data-history-qualification]")!.textContent).toContain("Simulated");
    }
  });

  it("keeps selected tenor, comparison and table from the URL through remount", async () => {
    const result = read("rates_curves"); if (result.selected_workspace.state !== "ready") throw Error("fixture");
    const curve = result.selected_workspace.view.curve_hero!, onSelect = vi.fn();
    const selected = choice("tenor=2y&comparison=prior_month&display=table");
    await mount(<MacroEconomicCurve curve={curve} lang="en" selection={selected} onSelect={onSelect}/>);
    expect(host.querySelectorAll("select")[0].value).toBe("2y");
    expect(host.querySelectorAll("select")[1].value).toBe("prior_month");
    expect(host.querySelector("tr[data-selected]")!.textContent).toContain("2-year");
    const row = curve.tenors.find(row => row.tenor === "2y")!;
    expect(host.querySelector("tr[data-selected]")!.textContent).toContain(row.prior_month_as_of);
    await click("Chart"); expect(onSelect).toHaveBeenLastCalledWith({ display: "chart" });
    await mount(<div>Another study</div>);
    await mount(<MacroEconomicCurve curve={curve} lang="en" selection={selected} onSelect={onSelect}/>);
    expect(host.querySelector("table")).not.toBeNull();
    expect(host.querySelectorAll("select")[0].value).toBe("2y");
  });

  it("opens the published Rates disclosure and retains correction lineage", async () => {
    await mount(<MacroEconomicEvidence read={read("rates_curves")} selection="FRED:DGS10" lang="en" onClose={vi.fn()} onSelect={vi.fn()}/>);
    expect(host.textContent).toContain("Federal Reserve Bank of St. Louis");
    expect(host.textContent).not.toContain("does not include a source disclosure matching");
    expect(host.textContent).toContain("Corrections & revisions");
    expect(host.textContent).toContain("No correction recorded");
  });

  it("renders no-axis Policy without inventing a state map", async () => {
    await mount(<MacroEconomyWorkspace workspaceId="monetary_policy" lang="en" read={{ phase: "ready", data: read("monetary_policy") }} selection={choice("study=drivers")} onSelect={vi.fn()} onRefresh={vi.fn()} onNavigate={vi.fn()} overviewHref="/macro_monetary.html" dashboardHref="/macro.html" workspaceHref={href}/>);
    expect(host.querySelector("[data-read-state]")!.getAttribute("data-read-state")).toBe("ready");
    expect(host.textContent).toContain("All measures");
    expect(host.textContent).toContain("Published influence");
    expect(host.querySelectorAll("dl").length).toBe(0);
  });
});

const props = (workspaceId: EconomicWorkspaceId, ownerKey = A, selection: EconomicSelection = choice()): MacroEconomyReaderProps => ({ ownerKey, workspaceId, lang: "en", selection, onSelect: vi.fn(), onNavigate: vi.fn(), overviewHref: "/macro_monetary.html", dashboardHref: "/macro.html", signInHref: "/login", workspaceHref: href });
function pendingFetch() {
  const pending: { url: string; signal: AbortSignal; resolve: (value: Response) => void }[] = [];
  const fetch = vi.fn((url: string, init: RequestInit) => new Promise<Response>(resolve => pending.push({ url, signal: init.signal as AbortSignal, resolve })));
  vi.stubGlobal("fetch", fetch); return { pending, fetch };
}
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

describe("subject-keyed economic reader", () => {
  it("fences late A -> B -> A workspace responses and does not refetch chart controls", async () => {
    const { pending, fetch } = pendingFetch();
    await mount(<MacroEconomyReader {...props("inflation_system")}/>);
    await mount(<MacroEconomyReader {...props("rates_curves")}/>);
    expect(pending.map(x => x.url)).toEqual(["/api/shared-shell/today?workspace=inflation_system", "/api/shared-shell/today?workspace=rates_curves"]);
    await act(async () => pending[1].resolve(response(fixtures.rates_curves)));
    expect(host.textContent).toContain("The Treasury curve");
    await mount(<MacroEconomyReader {...props("inflation_system")}/>);
    const old = structuredClone(fixtures.inflation_system); old.selected_workspace.view.headline.state_label = { en: "OLD PRIVATE READING", zh: "旧" }; old.selected_workspace.view.headline.state_id = "A";
    await act(async () => pending[0].resolve(response(old)));
    expect(host.textContent).not.toContain("OLD PRIVATE READING");
    const fresh = structuredClone(old); fresh.selected_workspace.view.headline.state_label.en = "FRESH PRIVATE READING";
    await act(async () => pending[2].resolve(response(fresh)));
    expect(host.textContent).toContain("FRESH PRIVATE READING");
    await mount(<MacroEconomyReader {...props("inflation_system", A, choice("display=table"))}/>);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(host.querySelector("table")).not.toBeNull();
  });

  it("aborts and clears data on subject departure, including A -> B -> A", async () => {
    const { pending } = pendingFetch();
    await mount(<MacroEconomyReader {...props("rates_curves")}/>);
    await act(async () => pending[0].resolve(response(fixtures.rates_curves)));
    expect(host.textContent).toContain("The Treasury curve");
    auth.getUser.mockResolvedValue({ data: { user: { id: B } }, error: null });
    await mount(<MacroEconomyReader {...props("rates_curves", B)}/>);
    expect(host.textContent).not.toContain("The Treasury curve");
    auth.getUser.mockResolvedValue({ data: { user: { id: A } }, error: null });
    await mount(<MacroEconomyReader {...props("rates_curves", A)}/>);
    expect(pending[1].signal.aborted).toBe(true);
    await act(async () => pending[1].resolve(response(fixtures.rates_curves)));
    expect(host.textContent).not.toContain("The Treasury curve");
    await act(async () => pending[2].resolve(response(fixtures.rates_curves)));
    expect(host.textContent).toContain("The Treasury curve");
  });

  it("closes identity on 401 before touching an unbounded error body", async () => {
    const json = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 401, ok: false, json })));
    await mount(<MacroEconomyReader {...props("rates_curves")}/>);
    expect(host.textContent).toContain("Private readings have been cleared");
    expect(json).not.toHaveBeenCalled();
  });

  it("keeps malformed publication failure separate from an access refusal", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ schema: "wrong" })));
    await mount(<MacroEconomyReader {...props("rates_curves")}/>);
    expect(host.textContent).toContain("could not be verified");
    expect(host.querySelector("svg")).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => response({}, 403)));
    await click("Refresh");
    expect(host.textContent).toContain("Your current access");
  });
});
