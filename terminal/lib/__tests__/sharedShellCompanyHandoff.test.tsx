// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SharedShellLaunchLinks from "@/components/chrome/shared-shell/SharedShellLaunchLinks";
import { ACTIVE_SYMBOL_KEY, readActiveSymbol, resetActiveSymbolCache } from "@/lib/activeSymbol";

const navigation = vi.hoisted(() => ({ path: "/stock.html", params: new URLSearchParams() }));
vi.mock("next/navigation", () => ({
 usePathname: () => navigation.path, useSearchParams: () => navigation.params, useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("next/link", () => ({
 default: ({ children, href, ...props }: React.ComponentProps<"a">) =>
  <a {...props} href={href}>{children}</a>,
}));
vi.mock("@/lib/sharedShellCopy", () => ({ useSharedShellT: () => (key: string) => key }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
function location(href: string) {
 window.history.replaceState({}, "", href);
 navigation.path = window.location.pathname;
 navigation.params = new URLSearchParams(window.location.search);
}
async function render(href: string) {
 location(href);
 await act(async () => root.render(<SharedShellLaunchLinks drawer labelled glyph={() => null} />));
}
function link() { return host.querySelector<HTMLAnchorElement>("[data-shell-terminal]"); }
function target() { return new URL(link()!.href); }

beforeEach(() => {
 window.localStorage.setItem(ACTIVE_SYMBOL_KEY, "NVDA");
 resetActiveSymbolCache();
 host = document.createElement("div");
 document.body.append(host);
 root = createRoot(host);
});
afterEach(async () => {
 await act(async () => root.unmount());
 host.remove();
 window.localStorage.clear();
 resetActiveSymbolCache();
});

describe("Shared Shell current-company chart handoff", () => {
 it.each([
  ["/stock.html?filter=a%20b&filter=a+b#AAPL", "AAPL"],
  ["/stock.html#b%72k.b", "BRK.B"],
  ["/stock.html?ticker=BTC-USD", "BTC-USD"],
  ["/stock.html?ticker=NVDA#MSFT", "MSFT"],
  ["/stock.html#UNKNOWNCOMPANY", "UNKNOWNCOMPANY"],
 ])("uses the explicit company at %s and preserves the complete return URL", async (href, symbol) => {
  await render(href);
  expect(target().searchParams.get("symbol")).toBe(symbol);
  expect(target().searchParams.get("ret")).toBe(window.location.href);
  expect(target().searchParams.get("from")).toBe("macro");
  expect(host.querySelector('a[aria-label="shellMastermindAI"]')?.getAttribute("href")).toBe("/brain?symbol=" + encodeURIComponent(symbol));
  expect(readActiveSymbol()).toBe("NVDA");
  expect(window.localStorage.getItem(ACTIVE_SYMBOL_KEY)).toBe("NVDA");
 });

 it.each([
  "/stock.html", "/stock.html#%E0%A4%A", "/stock.html#AAPL+MSFT",
  "/stock.html#BAD%2FIDENTITY", "/stock.html?ticker=NVDA#BAD%2FIDENTITY",
 ])("does not offer an unrelated previous chart for %s", async href => {
  await render(href);
  expect(link()?.getAttribute("href")).toBe("/terminal");
 });

 it.each(["hashchange", "popstate", "mmx:shell-location"])("follows a committed %s without publishing another cursor", async event => {
  await render("/stock.html#AAPL");
  await act(async () => {
   window.history.replaceState({}, "", "/stock.html#MSFT");
   window.dispatchEvent(new Event(event));
  });
  expect(target().searchParams.get("symbol")).toBe("MSFT");
  expect(target().searchParams.get("ret")).toBe(window.location.href);
  expect(readActiveSymbol()).toBe("NVDA");
 });

 it("opens a neutral Brain outside of an explicit company and for invalid subjects", async () => {
  for (const href of ["/discover", "/stock.html#BAD%2FSYMBOL", "/analysis?symbol=BAD%2FSYMBOL"]) {
   await render(href);
   expect(host.querySelector('a[aria-label="shellMastermindAI"]')?.getAttribute("href")).toBe("/brain");
  }
 });

 it("opens the in-place Analysis reader with its exact selected thesis", async () => {
  await render("/analysis?view=theses&symbol=MU&thesis=reader-selection");
  const open = vi.fn();
  window.addEventListener("mm:copilot", open);
  try {
   await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="shellMastermindAI"]')!.click());
   expect(open).toHaveBeenCalledTimes(1);
   expect(window.location.search).toBe("?view=theses&symbol=MU&thesis=reader-selection");
  } finally {
   window.removeEventListener("mm:copilot", open);
  }
 });

 it("retains the cursor on non-company pages and native Analysis selection rules", async () => {
  await render("/macro.html#risk");
  expect(target().searchParams.get("symbol")).toBe("NVDA");
  await render("/analysis?symbol=AAPL");
  expect(target().searchParams.get("symbol")).toBe("AAPL");
  await render("/analysis?symbol=BAD%2FIDENTITY");
  expect(link()?.getAttribute("href")).toBe("/terminal");
  await render("/analysis");
  expect(target().searchParams.get("symbol")).toBe("NVDA");
 });
});
