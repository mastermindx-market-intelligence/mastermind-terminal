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
    ["/today", "", "/today?workspaceMarket=us"],
    ["/macro.html", "", "/macro.html"],
    ["/us_stocks.html", "", "/us_stocks.html"],
    ["/prophet", "", "/us_stocks.html"],
    ["/sector_cycles.html", "", "/sectors?workspaceMarket=us"],
    ["/options", "", "/options"],
    ["/sectors", "", "/sectors?workspaceMarket=us"],
    ["/options", "tab=prophet", "/us_stocks.html"],
    ["/discover", "tab=sectors", "/sectors?workspaceMarket=us"],
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
  it("keeps instrument tools local and opens marketwide Options without an inherited symbol", () => {
    mock.path="/today";
    for (const mode of ["rail","drawer"] as const) {
      const refs=[...nav(mode).querySelectorAll("a")].map(a=>a.getAttribute("href"));
      expect(refs).toContain("/options?workspaceMarket=us");
      expect(refs).toContain("/portfolio?workspaceMarket=us");
      for(const local of ["/analysis","/discover","/scripts","/alerts","/monitor","/research"])
        expect(refs.some(href=>href?.startsWith(local))).toBe(false);
    }
  });
  it("renders the same three flagship intelligence intelligence destinations without losing labels", () => {
    mock.lang="zh";
    const host=nav("drawer");
    expect(host.textContent).toContain("市场情报");
    expect(host.textContent).toContain("行业情报");
    expect(host.textContent).toContain("宏观仪表盘");
    expect(host.querySelectorAll('[data-intelligence-nav="drawer"] a')).toHaveLength(3);
  });
});
