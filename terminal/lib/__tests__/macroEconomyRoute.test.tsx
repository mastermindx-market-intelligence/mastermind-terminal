// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MacroEconomyRoute from "@/components/macro-economy/MacroEconomyRoute";
import MacroEconomyMount from "@/components/mounts/MacroEconomyMount";
import MacroEconomyNavigation from "@/components/macro-economy/MacroEconomyNavigation";
import type { MacroEconomyReaderProps } from "@/components/macro-economy/MacroEconomyReader";
import { ECONOMIC_WORKSPACES, type EconomicWorkspaceId } from "../shared-shell/macroEconomyPayload";

const state = vi.hoisted(() => ({ path: "/macro_monetary.html", search: "", lang: "en" as "en" | "zh", push: vi.fn(), replace: vi.fn(), reader: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => state.path, useSearchParams: () => new URLSearchParams(state.search), useRouter: () => ({ push: state.push, replace: state.replace }) }));
vi.mock("@/lib/i18n", () => ({ useLang: () => ({ lang: state.lang }) }));
vi.mock("@/lib/sharedShellCopy", () => ({ useSharedShellT: () => (key: string, fallback?: string) => fallback ?? key }));
vi.mock("next/link", () => ({ default: ({ href, children, prefetch: _prefetch, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) => <a href={href} {...props}>{children}</a> }));
vi.mock("@/components/macro-economy/MacroEconomyReader", () => ({ default: (props: MacroEconomyReaderProps) => { state.reader(props); return <section data-reader=""/>; } }));
vi.mock("@/components/WorkspaceLoading", () => ({ default: () => <div role="status"/> }));
// Exercise the real mount's market fence and the real route. Next owns bundle loading.
vi.mock("next/dynamic", () => ({ default: () => (props: { ownerKey: string; workspaceId: EconomicWorkspaceId | null }) => <MacroEconomyRoute {...props}/> }));

let host: HTMLDivElement, root: Root;
const subject = "11111111-1111-4111-8111-111111111111";
const mount = async (workspaceId: EconomicWorkspaceId | null = null, ownerKey = subject) => { await act(async () => root.render(<MacroEconomyMount workspaceId={workspaceId} ownerKey={ownerKey}/>)); };
const props = () => state.reader.mock.calls.at(-1)![0] as MacroEconomyReaderProps;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.path = "/macro_monetary.html"; state.search = ""; state.lang = "en";
  window.history.replaceState({}, "", state.path);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("native Economy routes", () => {
  it.each(Object.entries(ECONOMIC_WORKSPACES))("opens the selected %s workspace with the verified subject", async (id, workspace) => {
    state.path = workspace.path; state.search = "workspaceMarket=us&study=history&window=3m&display=table";
    await mount(id as EconomicWorkspaceId);
    expect(props()).toMatchObject({ ownerKey: subject, workspaceId: id, lang: "en", selection: { task: "history", window: "3m", display: "table" } });
    expect(props().dashboardHref).toBe("/macro.html");
    expect(props().overviewHref).toBe("/macro_monetary.html?workspaceMarket=us");
    expect(host.querySelectorAll("#shared-shell-content")).toHaveLength(1);
  });

  it.each(["cn", "hk", "ca", "intl", "crypto", "unknown", "us&workspaceMarket=cn"])("does not mount a US data reader under %s context", async market => {
    state.path = ECONOMIC_WORKSPACES.inflation_system.path; state.search = `workspaceMarket=${market}`;
    await mount("inflation_system");
    expect(state.reader).not.toHaveBeenCalled();
    expect(host.querySelector(".shared-shell-market-coverage")).not.toBeNull();
  });

  it.each(["study=unknown", "study=history&study=drivers", "window=1y&window=3m", "display=unknown", "observation=2026-02-30", "study=revisions"])("keeps invalid selection %s out of the reader", async search => {
    state.path = ECONOMIC_WORKSPACES.inflation_system.path; state.search = search;
    await mount("inflation_system");
    expect(state.reader).not.toHaveBeenCalled();
    expect(host.querySelector('[role="status"]')?.textContent).toContain("This view could not be opened.");
    expect(host.querySelector('a[href="/macro_inflation_system.html?workspaceMarket=us"]')).not.toBeNull();
  });

  it("opens the payroll revision study only in Jobs", async () => {
    state.path = ECONOMIC_WORKSPACES.labor_markets.path; state.search = "study=revisions&observation=2026-10-01";
    await mount("labor_markets");
    expect(props().selection).toMatchObject({ task: "revisions", observation: "2026-10-01" });
    state.reader.mockClear(); state.path = "/macro_monetary.html";
    await mount(); expect(state.reader).not.toHaveBeenCalled();
  });

  it("updates only selected view fields and keeps the exact login return URL", async () => {
    state.path = ECONOMIC_WORKSPACES.inflation_system.path;
    state.search = "workspaceMarket=us&study=history&window=3m&series=cpi&display=chart&ref=daily";
    await mount("inflation_system");
    expect(props().signInHref).toBe(`/login?next=${encodeURIComponent(`${state.path}?${state.search}`)}`);
    props().onSelect({ display: "table", evidence: "source:cpi" });
    const [next, options] = state.push.mock.calls.at(-1)!;
    const url = new URL(next, "https://shell.invalid");
    expect(url.pathname).toBe(state.path);
    expect(Object.fromEntries(url.searchParams)).toEqual({ workspaceMarket: "us", study: "history", window: "3m", series: "cpi", display: "table", ref: "daily", evidence: "source:cpi" });
    expect(options).toEqual({ scroll: false });
    props().onSelect({ series: null, observation: null });
    expect(new URL(state.push.mock.calls.at(-1)![0], "https://shell.invalid").searchParams.has("series")).toBe(false);
  });

  it("reads browser navigation afresh and forwards subject and language changes", async () => {
    state.path = ECONOMIC_WORKSPACES.rates_curves.path; state.search = "tenor=2y&comparison=prior_month";
    await mount("rates_curves"); expect(props().selection).toMatchObject({ tenor: "2y" });
    state.search = "tenor=10y&comparison=prior_close"; state.lang = "zh";
    await mount("rates_curves", "22222222-2222-4222-8222-222222222222");
    expect(props()).toMatchObject({ ownerKey: "22222222-2222-4222-8222-222222222222", lang: "zh", selection: { tenor: "10y", comparison: "prior_close" } });
    const href = props().workspaceHref("labor_markets");
    expect(href).toBe("/macro_labor_markets.html?workspaceMarket=us");
    props().onNavigate(href); expect(state.push).toHaveBeenLastCalledWith(href);
  });

  it("replaces scrub observations while preserving a section and intentional view history", async () => {
    state.path = ECONOMIC_WORKSPACES.labor_markets.path;
    state.search = "workspaceMarket=us&study=history&series=payroll";
    window.history.replaceState({}, "", `${state.path}?${state.search}#history`);
    await mount("labor_markets");
    expect(props().signInHref).toBe(`/login?next=${encodeURIComponent(`${state.path}?${state.search}#history`)}`);
    for (const observation of ["2026-08-01", "2026-09-01", "2026-10-01"]) props().onSelect({ series: "payroll", observation });
    expect(state.push).not.toHaveBeenCalled(); expect(state.replace).toHaveBeenCalledTimes(3);
    expect(state.replace.mock.calls.at(-1)![0]).toContain("observation=2026-10-01#history");
    props().onSelect({ task: "drivers" }); expect(state.push).toHaveBeenCalledOnce();
    await act(async () => { window.history.replaceState({}, "", `${state.path}?${state.search}#jobs`); window.dispatchEvent(new HashChangeEvent("hashchange")); });
    expect(props().signInHref).toBe(`/login?next=${encodeURIComponent(`${state.path}?${state.search}#jobs`)}`);
  });
});

describe("shared Macro navigation", () => {
  it.each(["en", "zh"] as const)("marks one current view and keeps both destinations in %s", async lang => {
    await act(async () => root.render(<MacroEconomyNavigation lang={lang} active="today" dashboardHref="/macro.html" overviewHref="/macro_monetary.html?workspaceMarket=us"/>));
    expect(host.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(host.querySelector('[aria-current="page"]')?.getAttribute("href")).toBe("/macro.html");
    expect(host.querySelector('a[href="/macro_monetary.html?workspaceMarket=us"]')?.textContent).toBe(lang === "en" ? "Economy" : "经济");
    await act(async () => root.render(<MacroEconomyNavigation lang={lang} active="economy" dashboardHref="/macro.html" overviewHref="/macro_monetary.html?workspaceMarket=us"/>));
    expect(host.querySelector('[aria-current="page"]')?.getAttribute("href")).toBe("/macro_monetary.html?workspaceMarket=us");
  });
});
