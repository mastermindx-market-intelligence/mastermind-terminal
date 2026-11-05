// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { LangProvider, applyLang, useLang } from "@/lib/i18n";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;

function Probe() {
  const { lang, setLang } = useLang();
  return <button type="button" onClick={() => setLang(lang === "en" ? "zh" : "en")}>{lang}</button>;
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.lang = "en";
  document.documentElement.setAttribute("data-lang", "en");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  localStorage.clear();
  document.documentElement.lang = "en";
  document.documentElement.setAttribute("data-lang", "en");
});

function renderFixture() {
  act(() => root.render(<LangProvider><Probe /></LangProvider>));
}

it("normalizes a preselected Chinese provider to the Chinese document language", () => {
  document.documentElement.setAttribute("data-lang", "zh");
  renderFixture();
  expect(host.textContent).toBe("zh");
  expect(document.documentElement.lang).toBe("zh-CN");
});

it("imperative account language synchronizes the existing preference, provider and HTML lang", () => {
  renderFixture();
  act(() => applyLang("zh"));
  expect(host.textContent).toBe("zh");
  expect(localStorage.getItem("mm.lang")).toBe("zh");
  expect(document.documentElement.getAttribute("data-lang")).toBe("zh");
  expect(document.documentElement.lang).toBe("zh-CN");
});

it("the actual provider UI setter updates root document language", () => {
  renderFixture();
  act(() => host.querySelector<HTMLButtonElement>("button")!.click());
  expect(host.textContent).toBe("zh");
  expect(document.documentElement.lang).toBe("zh-CN");
});

it("returns all existing language owners to English after a round trip", () => {
  renderFixture();
  act(() => applyLang("zh"));
  act(() => applyLang("en"));
  expect(host.textContent).toBe("en");
  expect(document.documentElement.getAttribute("data-lang")).toBe("en");
  expect(document.documentElement.lang).toBe("en");
});

it("the real source-extracted prepaint bootstrap declares saved Chinese before React starts", () => {
  localStorage.setItem("mm.lang", "zh");
  const source = readFileSync(resolve(process.cwd(), "app/layout.tsx"), "utf8");
  const bootstrap = source.match(/const LOCALE_INIT = `([\s\S]*?)`;/)?.[1];
  expect(bootstrap).toBeTruthy();
  // Only the repository's fixed inline bootstrap is evaluated, never request data.
  runInNewContext(bootstrap!, { document, localStorage, navigator, location, URLSearchParams });
  expect(document.documentElement.getAttribute("data-lang")).toBe("zh");
  expect(document.documentElement.lang).toBe("zh-CN");
});
