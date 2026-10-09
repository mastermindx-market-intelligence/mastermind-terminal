// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Framework/runtime boundaries only. The production AppShell, AppNav, TOP,
// navHref and LEX are real; no alternative navigation implementation is tested.
const state = vi.hoisted(() => ({ path: "/analysis", lang: "en", back: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => state.path,
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ children, href, prefetch, ...props }: React.ComponentProps<"a"> & { prefetch?: boolean }) => {
    void prefetch;
    return <a href={href} {...props}>{children}</a>;
  },
}));
vi.mock("@/lib/i18n", async (original) => {
  const actual = await original<typeof import("@/lib/i18n")>();
  return { ...actual, useT: () => (key: string, fallback?: string) =>
    actual.LEX[key]?.[state.lang === "zh" ? 1 : 0] ?? fallback ?? key };
});
vi.mock("@/lib/activeSymbol", () => ({ useActiveSymbol: () => "AAPL" }));
vi.mock("@/lib/originNav", () => ({
  useFromMacro: () => ({ fromMacro: true, macroHref: "https://www.mastermind-x.com/macro.html" }),
  backToMacro: (href: string) => state.back(href),
}));
vi.mock("@/lib/shellBrainSymbol", () => ({ useShellBrainSymbol: () => "AAPL" }));
vi.mock("@/components/ui/Tip", () => ({ Tip: ({ children }: React.PropsWithChildren) => <span>{children}</span> }));
vi.mock("@/components/BrandMark", () => ({ BrandLockup: () => <span>Mastermind</span> }));
vi.mock("@/components/DashboardBackButton", () => ({
  default: ({ onClick }: React.ComponentProps<"button">) => <button onClick={onClick} data-back="existing">Back to Macro</button>,
}));
vi.mock("@/components/MobileNav", () => ({ default: () => <div data-mobile-owner="existing" /> }));
vi.mock("@/components/settings/SettingsButton", () => ({ default: () => <button>Settings</button> }));
vi.mock("@/components/settings/SettingsProvider", () => ({
  SettingsProvider: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));
vi.mock("@/components/onboarding/OnboardingProvider", () => ({
  OnboardingProvider: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));
vi.mock("@/components/chrome/AnalysisBrainHost", () => ({
  default: () => <div data-brain-owner="existing" />,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: {
  getClaims: async () => ({ data: { claims: { sub: "existing-owner", email: "fixture@example.test" } } }),
} }) }));

import AppShell, { useShellIdentity } from "@/components/chrome/AppShell";
import { AppNav, TOP } from "@/components/AppNav";
import { LEX } from "@/lib/i18n";
import ShellLayout from "@/app/(shell)/layout";

let root: Root | undefined;
let host: HTMLDivElement;
function mount(element: React.ReactNode) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(element));
  return host;
}
function IdentityProbe() {
  const identity = useShellIdentity();
  return <main className="main2" data-identity={JSON.stringify(identity)}>Existing page content</main>;
}
function renderShell(preview?: boolean) {
  return mount(<AppShell investorShellPreview={preview} email="fixture@example.test" userId="existing-owner">
    <IdentityProbe />
  </AppShell>);
}
beforeEach(() => {
  state.path = "/analysis";
  state.lang = "en";
  state.back.mockClear();
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = undefined;
  host?.remove();
  vi.unstubAllEnvs();
});

describe("investor shell preview — existing shell, explicit presentation opt-in", () => {
  it("leaves the default shell and current native destination set unchanged", () => {
    const dom = renderShell();
    expect(dom.querySelector("[data-investor-shell]")).toBeNull();
    expect(dom.querySelectorAll("nav.appnav a")).toHaveLength(TOP.length);
    expect(dom.querySelectorAll(".investor-nav-label")).toHaveLength(0);
    expect(dom.querySelectorAll("[data-mobile-owner=existing]")).toHaveLength(1);
  });

  it.each(["/analysis", "/discover"])("opts in only the admitted %s page", (path) => {
    state.path = path;
    const dom = renderShell(true);
    expect(dom.querySelector("[data-investor-shell=preview]")).not.toBeNull();
    expect(dom.querySelectorAll(".investor-nav-label")).toHaveLength(TOP.length + 1);
  });

  it.each(["/terminal", "/terminal/", "/admin", "/portfolio", "/options", "/scripts", "/alerts",
    "/analysis-old", "/discoveries", "/analysis/unknown", "/discover/unknown"])(
    "does not enroll %s even when the server switch is enabled", (path) => {
      state.path = path;
      expect(renderShell(true).querySelector("[data-investor-shell]")).toBeNull();
    });

  it("keeps each current href and its selected destination when labelled", () => {
    const dom = renderShell(true);
    const nav = dom.querySelector("nav.appnav")!;
    const anchors = Array.from(nav.querySelectorAll("a"));
    expect(anchors).toHaveLength(TOP.length);
    TOP.forEach((item, i) => {
      expect(new URL(anchors[i].getAttribute("href")!, "https://app.example.test").pathname).toBe(item.href);
      expect(anchors[i].getAttribute("aria-label")).toBe(LEX[item.k]?.[0] ?? item.label);
    });
    expect(nav.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(nav.querySelector('[aria-current="page"]')?.getAttribute("href")).toContain("/analysis");
  });

  it.each(["en", "zh"])("renders genuine %s labels from the existing lexicon", (lang) => {
    state.lang = lang;
    const dom = renderShell(true);
    const labels = Array.from(dom.querySelectorAll(".investor-nav-label")).map(n => n.textContent);
    expect(labels).toEqual([...TOP.map(item => LEX[item.k]?.[lang === "zh" ? 1 : 0] ?? item.label), LEX.ai[lang === "zh" ? 1 : 0]]);
  });

  it("compacts the same navigation without removing its accessible names or links", () => {
    const dom = renderShell(true);
    const button = dom.querySelector<HTMLButtonElement>('[data-investor-compact-toggle]');
    expect(button).not.toBeNull();
    expect(button!.getAttribute("aria-pressed")).toBe("false");
    expect(button!.getAttribute("aria-controls")).toBe("investor-primary-navigation");
    act(() => button!.click());
    expect(button!.getAttribute("aria-pressed")).toBe("true");
    expect(dom.querySelectorAll(".investor-nav-label")).toHaveLength(0);
    expect(dom.querySelectorAll("nav.appnav a[aria-label]")).toHaveLength(TOP.length);
    expect(dom.querySelectorAll("#investor-primary-navigation")).toHaveLength(1);
    act(() => button!.click());
    expect(dom.querySelectorAll(".investor-nav-label")).toHaveLength(TOP.length + 1);
  });

  it("preserves the existing identity, page, Macro return and sole Analysis Brain host", () => {
    const dom = renderShell(true);
    expect(dom.querySelector("main")?.textContent).toBe("Existing page content");
    expect(dom.querySelector("main")?.getAttribute("data-identity")).toContain("existing-owner");
    expect(dom.querySelectorAll("[data-brain-owner=existing]")).toHaveLength(1);
    expect(dom.querySelectorAll("header.topbar")).toHaveLength(1);
    act(() => dom.querySelector<HTMLButtonElement>("[data-back=existing]")!.click());
    expect(state.back).toHaveBeenCalledTimes(1);
    expect(state.back).toHaveBeenCalledWith("https://www.mastermind-x.com/macro.html");
  });

  it("does not add an Analysis Brain host to Discover", () => {
    state.path = "/discover";
    expect(renderShell(true).querySelectorAll("[data-brain-owner=existing]")).toHaveLength(0);
  });
});

describe("server preview switch — no query, cookie or client-storage enrollment", () => {
  it.each([undefined, "", "0", "true", "TRUE", "yes", "01", " 1", "1 "])(
    "keeps presentation disabled for %s", async (value) => {
      vi.stubEnv("MMX_INVESTOR_SHELL_PREVIEW", value);
      const element = await ShellLayout({ children: <span>Page</span> });
      expect(element.props.investorShellPreview).toBe(false);
      expect(element.props.userId).toBe("existing-owner");
    });

  it("passes only the exact server opt-in without changing account claims", async () => {
    vi.stubEnv("MMX_INVESTOR_SHELL_PREVIEW", "1");
    const element = await ShellLayout({ children: <span>Page</span> });
    expect(element.props.investorShellPreview).toBe(true);
    expect(element.props.userId).toBe("existing-owner");
    expect(element.props.email).toBe("fixture@example.test");
  });

  it("keeps standalone AppNav callers in the existing unlabelled presentation", () => {
    expect(mount(<AppNav />).querySelectorAll(".investor-nav-label")).toHaveLength(0);
  });
});
