// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SharedShellToolbar from "@/components/chrome/shared-shell/SharedShellToolbar";
import { ACTIVE_SYMBOL_KEY, readActiveSymbol, resetActiveSymbolCache } from "@/lib/activeSymbol";

const navigation = vi.hoisted(() => ({ path: "/stock.html", params: new URLSearchParams() }));
vi.mock("next/navigation", () => ({
 usePathname: () => navigation.path, useSearchParams: () => navigation.params,
}));
vi.mock("next/link", () => ({
 default: ({ children, href, className }: React.ComponentProps<"a">) =>
  <a className={className} href={href}>{children}</a>,
}));
vi.mock("@/components/chrome/shared-shell/ShellSearch", () => ({ default: () => null }));
vi.mock("@/components/chrome/shared-shell/SharedShellPresentationControls", () => ({ default: () => null }));
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
 await act(async () => root.render(<SharedShellToolbar symbolOpen={false} onSymbolOpenChange={() => {}} onOpenDirectory={() => {}} />));
}
function link() { return host.querySelector<HTMLAnchorElement>(".shared-shell-terminal-link"); }
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
  expect(readActiveSymbol()).toBe("NVDA");
  expect(window.localStorage.getItem(ACTIVE_SYMBOL_KEY)).toBe("NVDA");
 });

 it.each([
  "/stock.html", "/stock.html#%E0%A4%A", "/stock.html#AAPL+MSFT",
  "/stock.html#BAD%2FIDENTITY", "/stock.html?ticker=NVDA#BAD%2FIDENTITY",
 ])("does not offer an unrelated previous chart for %s", async href => {
  await render(href);
  expect(link()).toBeNull();
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

 it("retains the cursor on non-company pages and native Analysis selection rules", async () => {
  await render("/macro.html#risk");
  expect(target().searchParams.get("symbol")).toBe("NVDA");
  await render("/analysis?symbol=AAPL");
  expect(target().searchParams.get("symbol")).toBe("AAPL");
  await render("/analysis?symbol=BAD%2FIDENTITY");
  expect(link()).toBeNull();
  await render("/analysis");
  expect(target().searchParams.get("symbol")).toBe("NVDA");
 });
});
