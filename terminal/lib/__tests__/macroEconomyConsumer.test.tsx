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
