// @vitest-environment jsdom
import { act } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ErrorPage from "@/app/error";
import { LangProvider } from "@/lib/i18n";
import { backToMacro } from "@/lib/originNav";

vi.mock("@/lib/originNav", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/originNav")>(),
  backToMacro: vi.fn(),
}));

const target = "https://beta.mastermind-x.com/portfolio?book=owned&view=holdings#holding-AAPL";
const failure = new Error("Controlled unavailable route");
let root: Root | null = null;
let host: HTMLDivElement;
let retry: ReturnType<typeof vi.fn>;
const ui = () => <LangProvider><ErrorPage error={failure} unstable_retry={retry} /></LangProvider>;
const returnButton = () => host.querySelector<HTMLButtonElement>("button[aria-label^='Back to'],button[aria-label^='返回']");
const setUrl = (query: string) => window.history.replaceState(null, "", "/terminal?" + query);

async function mount() {
  root = createRoot(host);
  await act(async () => { root!.render(ui()); });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.documentElement.dataset.lang = "en";
  sessionStorage.clear();
  vi.mocked(backToMacro).mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
  host = document.createElement("div");
  document.body.appendChild(host);
  retry = vi.fn();
  setUrl("from=macro&ret=" + encodeURIComponent(target) + "&symbol=AAPL");
});

afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  host.remove();
  vi.restoreAllMocks();
});

describe("root route-error return recovery", () => {
  it.each(["en", "zh"])("keeps the exact validated Portfolio target and focuses its existing %s control", async lang => {
    document.documentElement.dataset.lang = lang;
    await mount();
    const button = returnButton()!;
    expect(button).not.toBeNull();
    expect(button.getAttribute("aria-label")).toBe(lang === "zh" ? "返回投资组合" : "Back to Portfolio");
    expect(document.activeElement).toBe(button);
    await act(async () => { button.click(); });
    expect(backToMacro).toHaveBeenCalledTimes(1);
    expect(backToMacro).toHaveBeenCalledWith(target);
  });

  it.each([
    "https://attacker.invalid/portfolio",
    "javascript:alert(1)",
    "https://user:password@beta.mastermind-x.com/portfolio",
    "https://beta.mastermind-x.com/terminal?symbol=AAPL",
  ])("does not admit the unsafe or recursive return %s", async unsafe => {
    setUrl("ret=" + encodeURIComponent(unsafe));
    await mount();
    expect(returnButton()).toBeNull();
    expect(backToMacro).not.toHaveBeenCalled();
  });

  it("requires an explicit current return, even when a previous session remembered a dashboard", async () => {
    sessionStorage.setItem("mm.fromMacro", "1");
    sessionStorage.setItem("mm.macroHref", target);
    setUrl("symbol=AAPL");
    await mount();
    expect(returnButton()).toBeNull();
    expect(backToMacro).not.toHaveBeenCalled();
  });

  it("retains the incumbent explicit return alias without falling through an invalid ret", async () => {
    setUrl("return=" + encodeURIComponent(target));
    await mount();
    expect(returnButton()).not.toBeNull();
    await act(async () => {
      setUrl("ret=" + encodeURIComponent("https://attacker.invalid/") + "&return=" + encodeURIComponent(target));
      window.dispatchEvent(new Event("mmx:shell-location"));
    });
    expect(returnButton()).toBeNull();
  });

  it("cannot activate an old target between URL replacement and the subscribed render", async () => {
    await mount();
    const oldButton = returnButton()!;
    const nextTarget = "https://beta.mastermind-x.com/analysis?symbol=BRK-B&page=intelligence#sources";
    await act(async () => {
      setUrl("ret=" + encodeURIComponent(nextTarget));
      oldButton.click();
    });
    expect(backToMacro).not.toHaveBeenCalled();
    await act(async () => { window.dispatchEvent(new Event("popstate")); });
    expect(returnButton()?.getAttribute("aria-label")).toBe("Back to Analysis");
    expect(document.activeElement).toBe(returnButton());
    await act(async () => { returnButton()!.click(); });
    expect(backToMacro).toHaveBeenCalledTimes(1);
    expect(backToMacro).toHaveBeenCalledWith(nextTarget);
    await act(async () => {
      setUrl("symbol=AAPL");
      window.dispatchEvent(new Event("hashchange"));
    });
    expect(returnButton()).toBeNull();
  });

  it("hydrates the empty server snapshot before revealing and focusing the current validated return", async () => {
    let html: string;
    vi.stubGlobal("window", undefined);
    try { html = renderToString(ui()); }
    finally { vi.unstubAllGlobals(); }
    expect(html!).not.toContain("Back to Portfolio");
    host.innerHTML = html!;
    const recoverable: unknown[] = [];
    await act(async () => {
      root = hydrateRoot(host, ui(), { onRecoverableError: error => recoverable.push(error) });
    });
    expect(recoverable).toEqual([]);
    expect(returnButton()?.getAttribute("aria-label")).toBe("Back to Portfolio");
    expect(document.activeElement).toBe(returnButton());
    const unrelatedErrors = vi.mocked(console.error).mock.calls.filter(args => args[0] !== "[ErrorBoundary]");
    expect(unrelatedErrors).toEqual([]);
  });

  it("preserves retry and the existing chart recovery action", async () => {
    await mount();
    expect(host.querySelector("a[href='/terminal']")?.textContent).toBe("Go to chart");
    const retryButton = [...host.querySelectorAll("button")].find(button => button.textContent === "Try again")!;
    await act(async () => { retryButton.click(); });
    expect(retry).toHaveBeenCalledOnce();
    expect(backToMacro).not.toHaveBeenCalled();
  });
});
