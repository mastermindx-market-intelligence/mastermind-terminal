// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, useState, type AnchorHTMLAttributes, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import ShellDirectory from "@/components/chrome/shared-shell/ShellDirectory";

// The real directory, copy owner, ranking and native title aliases execute.
// Only the route projection and framework/locale edges are controlled here.
// Native focus trapping/IME/new-tab behavior is covered separately in a browser.
const fixture = vi.hoisted(() => ({
  lang: "en" as "en" | "zh",
  directory: [] as { href: string; kind: string; title: { en: string; zh: string }; group: string }[],
  paths: [] as string[], navigation: vi.fn(), companies: vi.fn(), closes: vi.fn(),
}));
vi.mock("@/lib/sharedShellRoutes", () => ({
  get sharedShellDirectory() { return fixture.directory; },
  sharedShellCatalog: { get legacyPaths() { return fixture.paths; } },
}));
vi.mock("@/lib/i18n", () => ({
  LEX: {},
  useLang: () => ({ lang: fixture.lang }),
  useT: () => (key: string, fallback?: string) => key === "close" ? (fixture.lang === "zh" ? "关闭" : "Close") : fallback ?? key,
}));
vi.mock("next/link", () => ({ default: ({ children, href, onNavigate, prefetch: _prefetch, onClick, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & {
  children: ReactNode; href: string; prefetch?: boolean;
  onNavigate?: (event: { preventDefault: () => void }) => void;
}) => <a {...props} data-prefetch={String(_prefetch)} href={href} onClick={event => {
  onClick?.(event);
  if (!event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
    onNavigate?.({ preventDefault: () => event.preventDefault() });
    fixture.navigation(href);
  }
  event.preventDefault(); // jsdom does not implement navigation.
}}>{children}</a> }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
const entry = (href: string, kind = "legacy", group = "nav.tools", title = href) => ({ href, kind, group, title: { en: title, zh: title } });
function Harness() {
  const [open, setOpen] = useState(false);
  return <div className="shared-shell">
    <button className="shared-shell-directory-trigger" onClick={() => setOpen(true)}>Tools opener</button>
    <div className="mobilebar"><button aria-haspopup="dialog" aria-controls="mobile-navigation">Navigation opener</button></div>
    <button id="outside">Other task</button>
    <main><h1>Discover</h1></main>
    <ShellDirectory open={open} onClose={() => { fixture.closes(); setOpen(false); }} onSearchCompanies={() => { fixture.companies(); setOpen(false); }} />
  </div>;
}
const button = (text: string) => {
  const found = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(node => node.textContent?.trim() === text || node.getAttribute("aria-label") === text);
  if (!found) throw new Error(`Missing button: ${text}`);
  return found;
};
const links = () => Array.from(container.querySelectorAll<HTMLAnchorElement>(".shared-directory-link"));
const hrefs = () => links().map(node => node.getAttribute("href"));
const status = () => container.querySelector('[role="status"]')?.textContent ?? "";
async function click(node: HTMLElement, options: MouseEventInit = {}) {
  node.focus();
  await act(async () => { node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...options })); });
}
async function type(value: string) {
  const input = container.querySelector<HTMLInputElement>('input[type="search"]')!;
  input.focus();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function escape(options: KeyboardEventInit = {}) {
  await act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true, ...options })); });
}
async function mount() {
  await act(async () => { root.render(<Harness />); });
  await click(button("Tools opener"));
}
beforeEach(() => {
  fixture.lang = "en";
  fixture.directory = [
    entry("/options", "native", "nav.options", "Options hub"),
    entry("/options.html", "legacy", "nav.options", "Options hub"),
    entry("/options_screener.html", "legacy", "nav.options", "Options scanner"),
    entry("/options/futures", "native", "nav.options", "Futures"),
    entry("/learn/options.html", "legacy", "nav.learn", "期权课堂"),
    entry("/tools/options-calc.html"),
    entry("/about-options.html", "legacy", "footer.test", "Options information"),
    ...Array.from({ length: 100 }, (_, i) => entry(`/learn/lesson-${i}.html`, "legacy", "nav.learn", `Lesson ${i}`)),
  ];
  fixture.paths = fixture.directory.filter(row => row.kind === "legacy").map(row => row.href).concat("/learn/options-risk.html");
  fixture.navigation.mockReset(); fixture.companies.mockReset(); fixture.closes.mockReset();
  document.body.style.overflow = "clip";
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(function (this: HTMLElement) {
    const hidden = this.closest('[hidden], [style*="display: none"]');
    return (hidden ? [] : [{ width: 44, height: 44 }]) as unknown as DOMRectList;
  });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.removeAttribute("open"); } });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); }); container.remove(); vi.restoreAllMocks(); document.body.style.overflow = "";
});

describe("incumbent directory conformance", () => {
  it.each(["en", "zh"] as const)("%s distinguishes the complete Prophet workspace from model plans", async lang => {
    fixture.lang = lang;
    fixture.directory = [entry("/us_stocks.html", "legacy", "nav.us", "Stock Dashboard"), entry("/prophet", "native", "nav.intelligence", "Prophet")];
    fixture.paths = ["/us_stocks.html"];
    await mount();
    const workspace = links().find(link => link.getAttribute("href") === "/us_stocks.html");
    const plans = links().find(link => link.getAttribute("href") === "/prophet");
    expect(workspace?.textContent).toContain("Prophet");
    expect(plans?.textContent).toContain(lang === "zh" ? "模型计划与期权" : "Model plans & options");
    expect(hrefs()).toHaveLength(2);
  });
  it("recovers zero-in-category matches without changing the typed query", async () => {
    await mount(); await type("options"); await click(button("Research"));
    expect(links()).toHaveLength(0);
    expect(container.querySelector("h3")?.textContent).toBe("No matches in this category");
    expect(status()).toBe("0 in this category");
    await click(button("Show all 8 matches"));
    expect(container.querySelector<HTMLInputElement>("input")?.value).toBe("options");
    expect(links()).toHaveLength(8); expect(status()).toBe("8 matches");
    expect(document.activeElement).toBe(button("All"));
  });

  it("preserves category-specific canonical fallback and distinct same-title routes", async () => {
    await mount(); await type("ｏｐｔｉｏｎｓ");
    expect(hrefs()).toContain("/options"); expect(hrefs()).toContain("/options.html");
    expect(new Set(hrefs()).size).toBe(8);
    await click(button("Markets"));
    expect(hrefs()).toEqual(["/options.html", "/options_screener.html", "/about-options.html"]);
    expect(status()).toBe("3 in this category");
    expect(button("Show all 8 matches")).toBeTruthy();
    await click(button("About")); expect(hrefs()).toEqual(["/about-options.html"]);
    await type("期权"); await click(button("All")); expect(hrefs()).toEqual(["/learn/options.html"]);
    expect(status()).toBe("1 match");
  });

  it("clears only query and retains the selected category", async () => {
    await mount(); await type("absent"); await click(button("Learn"));
    expect(container.querySelector("h3")?.textContent).toBe("No pages found");
    expect(container.textContent).not.toContain("Show all 0 matches");
    await click(button("Clear search"));
    expect(container.querySelector<HTMLInputElement>("input")?.value).toBe("");
    expect(button("Learn").getAttribute("aria-pressed")).toBe("true");
    expect(links()).toHaveLength(48); expect(status()).toContain("101 destinations in this category");
    expect(document.activeElement).toBe(container.querySelector("input"));
  });

  it("retains expansion on same-instance reopen and resets it on query or category change", async () => {
    await mount(); await type("lesson"); await click(button("Show more"));
    expect(links()).toHaveLength(96); expect(status()).toContain("Showing 96 of 100");
    await click(button("Close")); await click(button("Tools opener"));
    expect(links()).toHaveLength(96); expect(container.querySelector<HTMLInputElement>("input")?.value).toBe("lesson");
    await click(button("Learn")); expect(links()).toHaveLength(48);
    await click(button("Show more")); await type("lesson "); expect(links()).toHaveLength(48);
  });

  it("focuses the first newly revealed destination when the final batch removes Show more", async () => {
    await mount(); await type("lesson"); await click(button("Show more")); await click(button("Show more"));
    expect(links()).toHaveLength(100); expect(container.querySelector(".shared-directory-more")).toBeNull();
    expect(document.activeElement).toBe(links()[96]); expect(status()).toBe("100 matches");
  });

  it("uses a concise atomic status instead of announcing the result grid", async () => {
    await mount(); await type("options");
    expect(container.querySelector(".shared-directory-results")?.hasAttribute("aria-live")).toBe(false);
    const region = container.querySelector('[role="status"]')!;
    expect(region.getAttribute("aria-atomic")).toBe("true");
    expect(region.querySelector("a")).toBeNull();
    expect(container.querySelector("input")?.getAttribute("aria-describedby")).toBe(region.id);
  });

  it("retains query, category, expansion and focus through a locale rerender", async () => {
    await mount(); await type("lesson"); await click(button("Learn")); await click(button("Show more"));
    const active = document.activeElement; fixture.lang = "zh";
    await act(async () => { root.render(<Harness />); });
    expect(links()).toHaveLength(96); expect(container.querySelector<HTMLInputElement>("input")?.value).toBe("lesson");
    expect(button("学习").getAttribute("aria-pressed")).toBe("true");
    expect(document.activeElement).toBe(active); expect(status()).toContain("已显示 96 / 100");
  });

  it("returns to a visible navigation opener when the desktop opener becomes hidden", async () => {
    await mount(); button("Tools opener").style.display = "none"; await escape();
    expect(container.querySelector("dialog")).toBeNull();
    expect(document.activeElement).toBe(button("Navigation opener"));
    expect(document.body.style.overflow).toBe("clip");
  });

  it("uses the current main heading if all old controls are hidden or disabled", async () => {
    await mount(); button("Tools opener").disabled = true; button("Navigation opener").hidden = true; await escape();
    expect(document.activeElement).toBe(container.querySelector("main h1"));
  });

  it("does not steal deliberate later focus during an external close", async () => {
    await mount(); const outside = container.querySelector<HTMLButtonElement>("#outside")!; outside.focus();
    await act(async () => { button("Close").click(); });
    expect(document.activeElement).toBe(outside); expect(document.body.style.overflow).toBe("clip");
  });

  it("leaves composing and child-consumed Escape to their existing owner", async () => {
    await mount(); const input = container.querySelector("input")!;
    await act(async () => { input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })); });
    await escape({ isComposing: true }); expect(container.querySelector("dialog")).not.toBeNull();
    await act(async () => { input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })); });
    const consume = (event: KeyboardEvent) => event.preventDefault(); input.addEventListener("keydown", consume);
    await escape(); expect(container.querySelector("dialog")).not.toBeNull(); input.removeEventListener("keydown", consume);
    await escape(); expect(container.querySelector("dialog")).toBeNull();
  });

  it.each([{ isComposing: true }, { keyCode: 229 }, { repeat: true }])("guards native cancellation for protected Escape %j", async (signal) => {
    await mount(); const input = container.querySelector("input")!; const dialog = container.querySelector("dialog")!;
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true, ...signal }));
      dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
    });
    expect(fixture.closes).not.toHaveBeenCalled(); expect(dialog.open).toBe(true);
  });

  it("retains the original composition decision if composition ends during Escape dispatch", async () => {
    await mount(); const input = container.querySelector("input")!; const dialog = container.querySelector("dialog")!;
    act(() => { input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })); });
    input.addEventListener("keydown", () => input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })), { once: true });
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
    });
    expect(fixture.closes).not.toHaveBeenCalled(); expect(dialog.open).toBe(true);
  });

  it("defensively retains a child-consumed Escape when a synthetic cancel is injected", async () => {
    await mount(); const input = container.querySelector("input")!; const dialog = container.querySelector("dialog")!;
    input.addEventListener("keydown", event => { event.preventDefault(); event.stopPropagation(); }, { once: true });
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
    });
    expect(fixture.closes).not.toHaveBeenCalled(); expect(dialog.open).toBe(true);
  });

  it("allows a later non-keyboard cancel after a protected Escape with no keyup", async () => {
    await mount(); const input = container.querySelector("input")!; const dialog = container.querySelector("dialog")!;
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", isComposing: true, bubbles: true, cancelable: true }));
      dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
    });
    expect(fixture.closes).not.toHaveBeenCalled(); expect(dialog.open).toBe(true);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    act(() => { dialog.dispatchEvent(new Event("cancel", { cancelable: true })); });
    expect(fixture.closes).toHaveBeenCalledTimes(1); expect(container.querySelector("dialog")).toBeNull();
  });

  it("consumes protected cancellation once without blocking a second independent close", async () => {
    await mount(); const input = container.querySelector("input")!; const dialog = container.querySelector("dialog")!;
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", isComposing: true, bubbles: true, cancelable: true }));
      dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
    });
    expect(fixture.closes).not.toHaveBeenCalled(); expect(dialog.open).toBe(true);
    act(() => { dialog.dispatchEvent(new Event("cancel", { cancelable: true })); });
    expect(fixture.closes).toHaveBeenCalledTimes(1); expect(container.querySelector("dialog")).toBeNull();
  });

  it("expires an unconsumed Escape association when no cancel or key release arrives", async () => {
    await mount(); const input = container.querySelector("input")!; const dialog = container.querySelector("dialog")!;
    act(() => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", isComposing: true, bubbles: true, cancelable: true })); });
    expect(fixture.closes).not.toHaveBeenCalled(); expect(dialog.open).toBe(true);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    act(() => { dialog.dispatchEvent(new Event("cancel", { cancelable: true })); });
    expect(fixture.closes).toHaveBeenCalledTimes(1); expect(container.querySelector("dialog")).toBeNull();
  });

  it("preserves modified-click context and closes only for ordinary navigation", async () => {
    await mount(); await type("options"); await click(links()[0], { metaKey: true });
    expect(container.querySelector("dialog")).not.toBeNull(); expect(fixture.navigation).not.toHaveBeenCalled();
    await click(links()[0]); expect(container.querySelector("dialog")).toBeNull(); expect(fixture.navigation).toHaveBeenCalledTimes(1);
  });

  it("hands off to company search once through its parent without a deferred opener", async () => {
    await mount(); await click(container.querySelector<HTMLButtonElement>(".shared-directory-footer button")!);
    expect(fixture.companies).toHaveBeenCalledTimes(1); expect(container.querySelector("dialog")).toBeNull();
    expect(document.body.style.overflow).toBe("clip");
  });
});
