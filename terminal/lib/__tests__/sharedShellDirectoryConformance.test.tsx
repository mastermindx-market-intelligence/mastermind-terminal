// @vitest-environment jsdom
import { act, useState, type AnchorHTMLAttributes } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ShellMegaMenu from "@/components/chrome/shared-shell/ShellDirectory";

let phone = false;
vi.mock("@/lib/i18n", () => ({ useLang: () => ({ lang: "en" }), useT: () => (key: string, fallback?: string) => fallback ?? key }));
vi.mock("next/navigation", () => ({ usePathname: () => "/discover", useSearchParams: () => new URLSearchParams() }));
vi.mock("next/link", () => ({ default: ({ children, href, onNavigate, ...attrs }: AnchorHTMLAttributes<HTMLAnchorElement> & { onNavigate?: () => void; prefetch?: boolean }) =>
  <a href={href} onClick={event => { if (!event.ctrlKey) { event.preventDefault(); onNavigate?.(); } }} {...attrs}>{children}</a> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;

function Harness({ mode }: { mode: "hover" | "browse" }) {
  const [open, setOpen] = useState(false);
  return <>
    <button data-tool-browser-trigger="" data-shell-menu-opener="" onClick={() => setOpen(true)}>Open</button>
    {open && <ShellMegaMenu mode={mode} onClose={() => setOpen(false)} />}
  </>;
}
beforeEach(() => {
  phone = false;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  vi.stubGlobal("matchMedia", () => ({ matches: phone, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(1); return 1; });
  vi.stubGlobal("scrollTo", () => {});
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([{ width: 100 }] as unknown as DOMRectList);
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.open = false; } });
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks();
  Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal"); Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
});
async function show(mode: "hover" | "browse") {
  await act(async () => root.render(<Harness mode={mode} />));
  const opener = host.querySelector<HTMLButtonElement>("[data-tool-browser-trigger]")!;
  opener.focus();
  await act(async () => opener.click());
  return opener;
}
function families() { return Array.from(host.querySelectorAll<HTMLButtonElement>("[data-family]")); }
function key(element: Element, value: string) {
  return act(async () => { element.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true })); });
}
describe("Shared Shell tool browser", () => {
  it("preserves focus for hover and dismisses the non-modal panel on an outside action", async () => {
    const opener = await show("hover");
    expect(families()).toHaveLength(6);
    expect(host.querySelector("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
    await act(async () => { document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
    expect(host.querySelector("#shared-shell-tools")).toBeNull();
  });
  it("supports keyboard entry to a native destination and preserves the regional source link", async () => {
    await show("browse");
    const rows = families();
    expect(document.activeElement).toBe(rows[0]);
    await key(rows[0], "ArrowDown");
    expect(document.activeElement).toBe(rows[1]);
    await key(rows[1], "ArrowRight");
    expect(document.activeElement?.getAttribute("href")).toBe("/discover?tab=screener&workspaceMarket=us");
    await act(async () => rows.at(-1)!.click());
    const external = host.querySelector<HTMLAnchorElement>('a[href^="https://www.mastermind-x.com/"]');
    expect(external).not.toBeNull();
    expect(external?.target).toBe("");
    expect(host.querySelector("iframe")).toBeNull();
    await key(rows.at(-1)!, "Escape");
    expect(document.activeElement).toBe(host.querySelector("[data-tool-browser-trigger]"));
  });
  it("only opens one mobile family at a time, and a second tap collapses it", async () => {
    phone = true;
    const opener = await show("browse");
    expect(host.querySelector("dialog[open]")).not.toBeNull();
    // Browser dialog cleanup can restore opener focus before the mobile
    // presentation effect runs again; only an explicit dismissal owns closure.
    await act(async () => { opener.dispatchEvent(new FocusEvent("focusin", { bubbles: true })); });
    expect(host.querySelector("dialog[open]")).not.toBeNull();
    expect(host.querySelector(".mega-content")).toBeNull();
    await act(async () => families()[3].click());
    expect(families()[3].getAttribute("aria-expanded")).toBe("true");
    await act(async () => families()[1].click());
    expect(host.querySelectorAll('[aria-expanded="true"]')).toHaveLength(1);
    expect(host.querySelector("summary")).not.toBeNull();
    await act(async () => families()[1].click());
    expect(host.querySelector(".mega-content")).toBeNull();
  });
});
