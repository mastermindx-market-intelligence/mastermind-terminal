// @vitest-environment jsdom
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SharedShellPrimaryNav from "@/components/intelligence/SharedShellPrimaryNav";

const mock = vi.hoisted(() => ({ path: "/intelligence", search: "", lang: "en" }));
vi.mock("next/navigation", () => ({
  usePathname: () => mock.path,
  useSearchParams: () => new URLSearchParams(mock.search),
}));
vi.mock("next/link", () => ({
  default: ({children, prefetch, ...rest}: React.ComponentProps<"a"> & {prefetch?:boolean}) => {
    void prefetch; return <a {...rest}>{children}</a>;
  },
}));
vi.mock("@/lib/i18n", () => ({ useLang: () => ({ lang: mock.lang }) }));
vi.mock("@/lib/sharedShellCopy", () => ({
  useSharedShellT: () => (_key:string, fallback?:string) => fallback ?? "",
}));
vi.mock("@/components/ui/Tip", () => ({
  Tip: ({ children }: {children:React.ReactNode}) => <>{children}</>,
}));
function nav(mode: "rail" | "drawer", activeKeyOverride?: string) {
  const html = renderToStaticMarkup(<SharedShellPrimaryNav mode={mode} labelled
    activeSymbol="SMR" activeKeyOverride={activeKeyOverride}
    renderGlyph={key => <svg data-icon={key} />} />);
  const host = document.createElement("div"); host.innerHTML = html;
  return host;
}
beforeEach(() => { mock.path="/intelligence"; mock.search=""; mock.lang="en"; });
describe("beta-only primary nav and intelligence current-page policy", () => {
  it.each([
    ["/intelligence", "", "/intelligence"],
    ["/macro.html", "", "/macro.html"],
    ["/us_stocks.html", "", "/us_stocks.html"],
    ["/prophet", "", "/us_stocks.html"],
    ["/sector_cycles.html", "", "/sector_cycles.html"],
    ["/sectors", "", "/sectors"],
    ["/options", "tab=prophet", "/us_stocks.html"],
    ["/discover", "tab=sectors", "/sectors"],
  ])("%s %s has one current destination, not Today", (path,search,expected) => {
    mock.path=path; mock.search=search;
    for(const mode of ["rail","drawer"] as const) {
      const host = nav(mode);
      expect([...host.querySelectorAll('a[aria-current="page"]')].map(a=>a.getAttribute("href"))).toEqual([expected]);
    }
  });
  it("does not let a mobile caller override mark Today while displaying Prophet", () => {
    mock.path="/options"; mock.search="tab=prophet";
    expect([...nav("drawer","shellToday").querySelectorAll('a[aria-current="page"]')]
      .map(a=>a.getAttribute("href"))).toEqual(["/us_stocks.html"]);
  });
  it("preserves a legitimate caller override on a non-intelligence route", () => {
    mock.path="/analysis";
    expect([...nav("drawer","shellMonitor").querySelectorAll('a[aria-current="page"]')]
      .map(a=>a.getAttribute("href"))).toEqual(["/monitor"]);
  });
  it("marks nested workspace navigation as a location without a caller override", () => {
    mock.path="/research/notes";
    for (const mode of ["rail", "drawer"] as const) {
      const host=nav(mode);
      const current=host.querySelector('a[aria-current="location"]');
      expect(current?.getAttribute("href")).toBe("/research");
      expect(host.querySelectorAll('a[aria-current="page"]')).toHaveLength(0);
    }
  });
  it("preserves original symbol decoration for Analysis only", () => {
    mock.path="/today";
    const host=nav("rail");
    const refs=[...host.querySelectorAll("a")].map(a=>a.getAttribute("href"));
    expect(refs.find(x=>x?.startsWith("/analysis"))).toBe("/analysis?symbol=SMR");
    expect(refs).toContain("/us_stocks.html");
    expect(refs).not.toContain("/prophet");
  });
  it("renders the same five bilingual intelligence destinations without losing labels", () => {
    mock.lang="zh";
    const host=nav("drawer");
    expect(host.textContent).toContain("市场情报");
    expect(host.textContent).toContain("行业周期");
    expect(host.textContent).toContain("宏观仪表盘");
    expect(host.querySelectorAll('[data-intelligence-nav="drawer"] a')).toHaveLength(5);
  });
});
