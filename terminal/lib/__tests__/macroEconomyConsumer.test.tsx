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

describe("curve to exact source and return", () => {
  it.each(["en", "zh"] as const)("opens the selected maturity through the real workspace and returns by Close or Escape (%s)", async lang => {
    const data = read("rates_curves"), onRefresh = vi.fn(), onNavigate = vi.fn();
    let selected = choice("tenor=2y&comparison=prior_month&display=table");
    const scroll = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const page = () => <MacroEconomyWorkspace workspaceId="rates_curves" lang={lang} read={{ phase: "ready", data }} selection={selected} onSelect={change => { selected = { ...selected, ...change }; root.render(page()); }} onRefresh={onRefresh} onNavigate={onNavigate} overviewHref="/macro_monetary.html" dashboardHref="/macro.html" workspaceHref={href}/>;
    try {
      await mount(page());
      const trigger = host.querySelector<HTMLButtonElement>('[data-curve-source="dgs2"]')!;
      expect(trigger).not.toBeNull();
      await act(async () => trigger.click());
      let evidence = host.querySelector<HTMLElement>("[data-economic-evidence]")!;
      expect(document.activeElement).toBe(evidence);
      expect(evidence.textContent).toContain("DGS2");
      expect(evidence.textContent).not.toContain("DGS10");
      expect(evidence.textContent).toContain("recomputed each owner cadence");
      expect(selected).toMatchObject({ evidence: "dgs2", tenor: "2y", comparison: "prior_month", display: "table" });
      await act(async () => evidence.querySelector<HTMLButtonElement>("button")!.click());
      expect(host.querySelector("[data-economic-evidence]")).toBeNull();
      expect(document.activeElement).toBe(trigger);
      expect(scroll).toHaveBeenCalledWith({ left: 0, top: 0, behavior: "instant" });
      await act(async () => trigger.click());
      evidence = host.querySelector<HTMLElement>("[data-economic-evidence]")!;
      await act(async () => evidence.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
      expect(host.querySelector("[data-economic-evidence]")).toBeNull();
      expect(document.activeElement).toBe(trigger);
      expect(selected).toMatchObject({ evidence: null, tenor: "2y", comparison: "prior_month", display: "table" });
      expect(onRefresh).not.toHaveBeenCalled(); expect(onNavigate).not.toHaveBeenCalled();
    } finally { scroll.mockRestore(); }
  });

  it("restores focus when the URL-owned evidence selection disappears independently of Close", async () => {
    const data = read("rates_curves"); let selected = choice("tenor=10y&comparison=prior_month&display=table");
    const scroll = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const page = () => <MacroEconomyWorkspace workspaceId="rates_curves" lang="en" read={{ phase: "ready", data }} selection={selected} onSelect={change => { selected = { ...selected, ...change }; root.render(page()); }} onRefresh={vi.fn()} onNavigate={vi.fn()} overviewHref="/macro_monetary.html" dashboardHref="/macro.html" workspaceHref={href}/>;
    try {
      await mount(page()); const trigger = host.querySelector<HTMLButtonElement>('[data-curve-source="dgs10"]')!;
      await act(async () => trigger.click());
      selected = { ...selected, evidence: null }; await mount(page());
      expect(document.activeElement).toBe(trigger);
      expect(selected).toMatchObject({ tenor: "10y", comparison: "prior_month", display: "table" });
    } finally { scroll.mockRestore(); }
  });

  it("restores the shared shell's scrolling ancestor as well as source focus", async () => {
    const data = read("rates_curves"); let selected = choice("tenor=2y&comparison=prior_month");
    const scroll = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const page = () => <MacroEconomyWorkspace workspaceId="rates_curves" lang="en" read={{ phase: "ready", data }} selection={selected} onSelect={change => { selected = { ...selected, ...change }; root.render(page()); }} onRefresh={vi.fn()} onNavigate={vi.fn()} overviewHref="/macro_monetary.html" dashboardHref="/macro.html" workspaceHref={href}/>;
    try {
      await mount(page()); const trigger = host.querySelector<HTMLButtonElement>('[data-curve-source="dgs2"]')!;
      host.scrollTop = 180; host.scrollLeft = 24;
      await act(async () => trigger.click());
      host.scrollTop = 920; host.scrollLeft = 0;
      const evidence = host.querySelector<HTMLElement>("[data-economic-evidence]")!;
      await act(async () => evidence.querySelector<HTMLButtonElement>("button")!.click());
      expect(host.scrollTop).toBe(180); expect(host.scrollLeft).toBe(24);
      expect(document.activeElement).toBe(trigger);
    } finally { scroll.mockRestore(); }
  });

  it.each(["history", "drivers"] as const)("keeps deliberate %s navigation focused without restoring the old chart", async task => {
    const data = read("rates_curves"); let selected = choice("tenor=2y");
    const scroll = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const page = () => <MacroEconomyWorkspace workspaceId="rates_curves" lang="en" read={{ phase: "ready", data }} selection={selected} onSelect={change => { selected = { ...selected, ...change }; root.render(page()); }} onRefresh={vi.fn()} onNavigate={vi.fn()} overviewHref="/macro_monetary.html" dashboardHref="/macro.html" workspaceHref={href}/>;
    try {
      await mount(page()); host.scrollTop = 180;
      await act(async () => host.querySelector<HTMLButtonElement>('[data-curve-source="dgs2"]')!.click());
      host.scrollTop = 920;
      const tab = Array.from(host.querySelectorAll("button")).find(button => button.textContent === (task === "history" ? "History" : "Drivers"))!;
      await act(async () => { tab.focus(); tab.click(); });
      expect(selected).toMatchObject({ task, evidence: null });
      expect(document.activeElement).toBe(tab);
      expect(host.scrollTop).toBe(920); expect(scroll).not.toHaveBeenCalled();
    } finally { scroll.mockRestore(); }
  });

  it("does not reuse a curve trigger after its maturity identity changes", async () => {
    const data = read("rates_curves"); let selected = choice("tenor=2y");
    const scroll = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const page = () => <MacroEconomyWorkspace workspaceId="rates_curves" lang="en" read={{ phase: "ready", data }} selection={selected} onSelect={change => { selected = { ...selected, ...change }; root.render(page()); }} onRefresh={vi.fn()} onNavigate={vi.fn()} overviewHref="/macro_monetary.html" dashboardHref="/macro.html" workspaceHref={href}/>;
    try {
      await mount(page()); const trigger = host.querySelector<HTMLButtonElement>('[data-curve-source="dgs2"]')!;
      host.scrollTop = 180; await act(async () => trigger.click());
      selected = { ...selected, tenor: "10y" }; await mount(page()); host.scrollTop = 920;
      expect(host.querySelector('[data-curve-source="dgs10"]')).toBe(trigger);
      await act(async () => host.querySelector<HTMLElement>("[data-economic-evidence]")!.querySelector<HTMLButtonElement>("button")!.click());
      expect(document.activeElement?.textContent).toBe("Sources & calculation");
      expect(host.scrollTop).toBe(920); expect(scroll).not.toHaveBeenCalled();
    } finally { scroll.mockRestore(); }
  });

  it("uses a visible fallback after refresh removes the original source trigger", async () => {
    const data = read("rates_curves"); let selected = choice("tenor=2y"), loading = false;
    const scroll = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const page = () => <MacroEconomyWorkspace workspaceId="rates_curves" lang="en" read={loading ? { phase: "loading", data: null } : { phase: "ready", data }} selection={selected} onSelect={change => { selected = { ...selected, ...change }; root.render(page()); }} onRefresh={vi.fn()} onNavigate={vi.fn()} overviewHref="/macro_monetary.html" dashboardHref="/macro.html" workspaceHref={href}/>;
    try {
      await mount(page()); const trigger = host.querySelector<HTMLButtonElement>('[data-curve-source="dgs2"]')!;
      host.scrollTop = 180; await act(async () => trigger.click());
      loading = true; await mount(page()); expect(trigger.isConnected).toBe(false);
      loading = false; await mount(page()); host.scrollTop = 920;
      const fallback = Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Sources & calculation")!;
      const focus = vi.spyOn(fallback, "focus");
      await act(async () => host.querySelector<HTMLElement>("[data-economic-evidence]")!.querySelector<HTMLButtonElement>("button")!.click());
      expect(document.activeElement).toBe(fallback); expect(focus).toHaveBeenCalledWith();
      expect(host.scrollTop).toBe(920); expect(scroll).not.toHaveBeenCalled();
    } finally { scroll.mockRestore(); }
  });

  it("focuses direct-link evidence and returns to the local sources control without an origin trigger", async () => {
    const data = read("rates_curves"); let selected = choice("tenor=10y&evidence=dgs10");
    const page = () => <MacroEconomyWorkspace workspaceId="rates_curves" lang="en" read={{ phase: "ready", data }} selection={selected} onSelect={change => { selected = { ...selected, ...change }; root.render(page()); }} onRefresh={vi.fn()} onNavigate={vi.fn()} overviewHref="/macro_monetary.html" dashboardHref="/macro.html" workspaceHref={href}/>;
    await mount(page()); const evidence = host.querySelector<HTMLElement>("[data-economic-evidence]")!;
    expect(document.activeElement).toBe(evidence);
    await act(async () => evidence.querySelector<HTMLButtonElement>("button")!.click());
    expect(document.activeElement?.textContent).toBe("Sources & calculation");
    expect(selected.tenor).toBe("10y");
  });

  it("keeps an older curve readable and explicitly unlinked", async () => {
    const data = read("rates_curves"); if (data.selected_workspace.state !== "ready") throw Error("fixture");
    for (const row of data.selected_workspace.view.curve_hero!.tenors) delete row.source_binding;
    await mount(<MacroEconomyWorkspace workspaceId="rates_curves" lang="en" read={{ phase: "ready", data }} selection={choice()} onSelect={vi.fn()} onRefresh={vi.fn()} onNavigate={vi.fn()} overviewHref="/macro_monetary.html" dashboardHref="/macro.html" workspaceHref={href}/>);
    expect(host.querySelector("[data-curve-source]")).toBeNull();
    expect(host.querySelector("[data-curve-source-unlinked]")).not.toBeNull();
    expect(host.textContent).toContain("3.743");
  });
});

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
    await mount(<MacroEconomicCurve curve={curve} lang="en" selection={selected} onSelect={onSelect} onEvidence={vi.fn()}/>);
    expect(host.querySelectorAll("select")[0].value).toBe("2y");
    expect(host.querySelectorAll("select")[1].value).toBe("prior_month");
    expect(host.querySelector("tr[data-selected]")!.textContent).toContain("2-year");
    const row = curve.tenors.find(row => row.tenor === "2y")!;
    expect(host.querySelector("tr[data-selected]")!.textContent).toContain(row.prior_month_as_of);
    await click("Chart"); expect(onSelect).toHaveBeenLastCalledWith({ display: "chart" });
    await mount(<div>Another study</div>);
    await mount(<MacroEconomicCurve curve={curve} lang="en" selection={selected} onSelect={onSelect} onEvidence={vi.fn()}/>);
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

