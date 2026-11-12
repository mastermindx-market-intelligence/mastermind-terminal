// @vitest-environment jsdom
import { Component, useState, type ReactNode } from "react";
import { act } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ErrorPage from "@/app/error";
import { GUEST_IDENTITY } from "@/lib/accountIdentity";
import { applyLang, LangProvider } from "@/lib/i18n";
import { SharedShellPresentation } from "@/components/chrome/shared-shell/SharedShellPresentation";

const prefs = vi.hoisted(() => ({ read: vi.fn(() => ({ metaPrefs: { theme: "light" } })) }));
vi.mock("@/lib/useMarketPrefs", () => ({ useAccountPrefs: prefs.read }));
const failure = new Error("Controlled ordinary route failure");
const target = "https://www.mastermind-x.com/portfolio?book=fixture#holding-AAPL";
let root: Root | null;
let host: HTMLDivElement;
let stylesheet: HTMLStyleElement;
const page = () => <ErrorPage error={failure} unstable_retry={() => {}} />;
const ui = (key?: string) => <LangProvider><ErrorPage key={key} error={failure} unstable_retry={() => {}} /></LangProvider>;
const main = () => host.querySelector<HTMLElement>("main")!;
// Vitest exposes its real browser realm here. New Node Web Storage globals can
// otherwise shadow the jsdom accessors while returning undefined.
const browserRealm = () => (globalThis as unknown as {
  jsdom: { window: { localStorage: Storage; Storage: typeof Storage } };
}).jsdom.window;

function tokenRule(source: string, selector: string) {
  const start = source.indexOf(selector);
  if (start < 0) throw Error("Canonical presentation rule missing");
  return source.slice(start, source.indexOf("}", start) + 1);
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.spyOn(console, "error").mockImplementation(() => {});
  // Use the browser storage surface, rather than Node's optional Web Storage shim.
  vi.stubGlobal("localStorage", browserRealm().localStorage);
  Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) });
  prefs.read.mockClear();
  document.documentElement.dataset.lang = "en";
  document.documentElement.dataset.theme = "light";
  document.documentElement.dataset.mmxSharedShell = "1";
  const native = readFileSync(resolve("app/globals.css"), "utf8");
  const shell = readFileSync(resolve("components/chrome/shared-shell/shared-shell.css"), "utf8");
  stylesheet = document.createElement("style");
  stylesheet.textContent = tokenRule(native, ":root{") + tokenRule(shell, ':root[data-mmx-shared-shell="1"][data-theme="light"]') + tokenRule(shell, ':root[data-mmx-shared-shell="1"][data-theme="dark"]');
  document.head.appendChild(stylesheet);
  host = document.createElement("div"); document.body.appendChild(host);
  window.history.replaceState(null, "", "/terminal?ret=" + encodeURIComponent(target));
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null; host.remove(); stylesheet.remove();
  delete document.documentElement.dataset.mmxSharedShell;
  delete document.documentElement.dataset.theme;
  browserRealm().localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
async function mount(element = ui()) {
  root = createRoot(host);
  await act(async () => root!.render(element));
}

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? page() : this.props.children; }
}
function Fault({ failed }: { failed: boolean }) { if (failed) throw failure; return <p>Owned route body</p>; }
function Lifecycle() {
  const [failed, fail] = useState(false);
  return <LangProvider><button id="fault" onClick={() => fail(true)}>Fail</button><Boundary><SharedShellPresentation enabled identity={GUEST_IDENTITY}><Fault failed={failed} /></SharedShellPresentation></Boundary></LangProvider>;
}

describe("native error public presentation snapshot", () => {
  it("retains the actual light tokens through the real owner's unmount without changing its cleanup", async () => {
    const lightBg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
    const lightInk = getComputedStyle(document.documentElement).getPropertyValue("--text").trim();
    await mount(<Lifecycle />);
    await act(async () => host.querySelector<HTMLButtonElement>("#fault")!.click());
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.mmxSharedShell).toBeUndefined();
    expect(main().dataset.errorTheme).toBe("light");
    expect(main().style.getPropertyValue("--bg")).toBe(lightBg);
    expect(main().style.getPropertyValue("--text")).toBe(lightInk);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Back to Portfolio");
  });

  it("uses no account, storage or system-theme fallback when the boundary's root is already native dark", async () => {
    delete document.documentElement.dataset.mmxSharedShell;
    document.documentElement.dataset.theme = "dark";
    localStorage.setItem("mmx.shell.theme", "light");
    const get = vi.spyOn(browserRealm().Storage.prototype, "getItem");
    const set = vi.spyOn(browserRealm().Storage.prototype, "setItem");
    await mount();
    expect(main().dataset.errorTheme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(prefs.read).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });

  it("keeps recovery usable when computed presentation cannot be read", async () => {
    vi.spyOn(window, "getComputedStyle").mockImplementation(() => { throw Error("Computed style unavailable"); });
    await mount();
    expect(main().dataset.errorTheme).toBeUndefined();
    expect(host.textContent).toContain("Something went wrong");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Back to Portfolio");
    expect(host.querySelector("a")?.getAttribute("href")).toBe("/terminal");
  });

  it("does not claim a light snapshot when its required canonical tokens are absent", async () => {
    vi.spyOn(window, "getComputedStyle").mockReturnValue({ getPropertyValue: () => "" } as unknown as CSSStyleDeclaration);
    await mount();
    expect(main().dataset.errorTheme).toBeUndefined();
    expect(main().style.getPropertyValue("--bg")).toBe("");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Back to Portfolio");
  });

  it("does not turn an unknown document appearance into a new theme authority", async () => {
    document.documentElement.dataset.theme = "unknown";
    await mount();
    expect(main().dataset.errorTheme).toBeUndefined();
    expect(document.documentElement.dataset.theme).toBe("unknown");
    expect(prefs.read).not.toHaveBeenCalled();
  });

  it("takes a fresh snapshot on a new failure and follows only the existing locale owner", async () => {
    await mount(ui("first"));
    expect(main().dataset.errorTheme).toBe("light");
    await act(async () => applyLang("zh"));
    expect(host.textContent).toContain("出现错误");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("返回投资组合");
    document.documentElement.dataset.theme = "dark";
    await act(async () => root!.render(ui("next")));
    expect(main().dataset.errorTheme).toBe("dark");
    expect(document.documentElement.dataset.lang).toBe("zh");
  });

  it("keeps server/hydration markup neutral before revealing the readable client snapshot", async () => {
    let html: string;
    vi.stubGlobal("window", undefined);
    try { html = renderToString(ui()); } finally { vi.unstubAllGlobals(); }
    expect(html!).not.toContain("data-error-theme");
    expect(html!).not.toContain("--bg:");
    host.innerHTML = html!;
    const recovered: unknown[] = [];
    await act(async () => { root = hydrateRoot(host, ui(), { onRecoverableError: error => recovered.push(error) }); });
    expect(recovered).toEqual([]);
    expect(main().dataset.errorTheme).toBe("light");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Back to Portfolio");
    expect(vi.mocked(console.error).mock.calls.filter(args => args[0] !== "[ErrorBoundary]")).toEqual([]);
  });
});
