// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LangProvider } from "@/lib/i18n";
import NotFoundActions from "@/app/not-found-actions";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() { return store.size; },
  });
  document.documentElement.removeAttribute("data-lang");
  document.documentElement.lang = "en";
  localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  vi.restoreAllMocks();
  host.remove();
  localStorage.clear();
  document.documentElement.removeAttribute("data-lang");
  vi.unstubAllGlobals();
});

function renderRecovery() {
  act(() => root.render(<LangProvider><NotFoundActions /></LangProvider>));
}

it("restores the saved language through the actual provider when the 404 lacks initialization", () => {
  localStorage.setItem("mm.lang", "zh");
  renderRecovery();
  expect(document.documentElement.getAttribute("data-lang")).toBe("zh");
  expect(document.documentElement.lang).toBe("zh-CN");
  expect(host.querySelector('nav[aria-label="返回入口"]')).not.toBeNull();
  expect(host.querySelector('a[href="/today"]')?.textContent).toContain("前往今日");
});

it("preserves an already active language when the saved preference differs", () => {
  document.documentElement.setAttribute("data-lang", "en");
  localStorage.setItem("mm.lang", "zh");
  renderRecovery();
  expect(document.documentElement.getAttribute("data-lang")).toBe("en");
  expect(localStorage.getItem("mm.lang")).toBe("zh");
  expect(host.querySelector('a[href="/today"]')?.textContent).toContain("Go to Today");
});

it("keeps usable recovery links when the saved language is invalid", () => {
  localStorage.setItem("mm.lang", "invalid");
  renderRecovery();
  expect(document.documentElement.hasAttribute("data-lang")).toBe(false);
  expect(host.querySelector('a[href="/discover"]')?.textContent).toBe("Browse tools");
});

it("keeps the provider default and recovery links when storage is unavailable", () => {
  vi.spyOn(localStorage, "getItem").mockImplementation(() => { throw new Error("Storage blocked"); });
  renderRecovery();
  expect(document.documentElement.hasAttribute("data-lang")).toBe(false);
  expect(host.querySelector('a[href="/terminal"]')?.textContent).toBe("Go to chart");
});
