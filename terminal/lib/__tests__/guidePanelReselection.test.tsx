// @vitest-environment jsdom
//
// Reselecting the library entry that is already displayed must be idempotent.
//
// The guide load effect only depends on currentModule/currentSuite/lang. A reselection that
// cleared the document and set the status to "loading" therefore started no load and restored
// nothing: the panel was stranded on the skeleton with an empty article.
//
// Mounts the real GuidePanel through react-dom/client (no @testing-library). The guide loader,
// the language and the visual child are the only doubles. requestAnimationFrame is stubbed so no
// deferred focus/scroll callback can interleave with the assertions.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import GuidePanel from "@/components/GuidePanel";
import { MODULE_CATALOG } from "@/lib/suites/catalog";

const loader = vi.hoisted(() => vi.fn());
const language = vi.hoisted(() => ({ value: "en" as "en" | "zh" }));

vi.mock("@/lib/guides/registry", () => ({ loadGuide: loader }));
vi.mock("@/components/guides/GuideVisual", () => ({ default: () => null }));
vi.mock("@/lib/i18n", () => ({
  useLang: () => ({ lang: language.value }),
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CURRENT = MODULE_CATALOG.find((entry) => entry.suiteKey === "structure" && entry.moduleKey === "ms")!;
const OTHER = MODULE_CATALOG.find((entry) => entry.suiteKey === "structure" && entry.moduleKey === "ob")!;

const GUIDE_TEXT = [
  "# Synthetic",
  "",
  "Synthetic introduction.",
  "",
  "## What you see",
  "",
  "Synthetic anatomy.",
].join("\n");

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const restorers: Array<() => void> = [];

function stub(target: object, name: string, value: unknown) {
  const original = Object.getOwnPropertyDescriptor(target, name);
  Object.defineProperty(target, name, { configurable: true, writable: true, value });
  restorers.push(() => {
    if (original) Object.defineProperty(target, name, original);
    else Reflect.deleteProperty(target, name);
  });
}

async function flush() {
  await act(async () => {
    for (let index = 0; index < 10; index++) await Promise.resolve();
  });
}

function props() {
  return { suiteKey: CURRENT.suiteKey, moduleKey: CURRENT.moduleKey, moduleLabel: CURRENT.label };
}

async function render(next = props()) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<GuidePanel {...next} onClose={() => {}} />);
  });
  await flush();
  return container!;
}

async function rerender(next = props()) {
  await act(async () => {
    root!.render(<GuidePanel {...next} onClose={() => {}} />);
  });
  await flush();
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.click();
  });
  await flush();
}

const currentButton = (el: HTMLElement) =>
  el.querySelector<HTMLButtonElement>('.gp-library-modules [aria-current="page"]')!;
const libraryButton = (el: HTMLElement, label: string) =>
  Array.from(el.querySelectorAll<HTMLButtonElement>(".gp-library-modules button")).find((button) =>
    Array.from(button.querySelectorAll("span")).some((span) => span.textContent === label),
  )!;
const busy = (el: HTMLElement) => el.querySelector(".gp-scroll")?.getAttribute("aria-busy");
const article = (el: HTMLElement) => el.querySelector(".gp-article");
const heading = (el: HTMLElement) => el.querySelector(".gp-article h1")?.textContent;

beforeEach(() => {
  loader.mockReset();
  loader.mockImplementation(async (_suite: string, module: string) => ({
    text: GUIDE_TEXT.replace("# Synthetic", `# ${module.toUpperCase()}`),
    fellBack: false,
  }));
  language.value = "en";
  stub(window, "matchMedia", vi.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} })));
  stub(window, "requestAnimationFrame", vi.fn(() => 1));
  stub(window, "cancelAnimationFrame", vi.fn());
  stub(Element.prototype, "scrollIntoView", vi.fn());
  stub(Element.prototype, "scrollTo", vi.fn());
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  container?.remove();
  container = null;
  while (restorers.length) restorers.pop()!();
  vi.clearAllMocks();
});

describe("reselecting the displayed library entry is idempotent", () => {
  it("keeps the loaded English guide readable without another load", async () => {
    const el = await render();
    expect(loader).toHaveBeenCalledTimes(1);
    expect(loader).toHaveBeenLastCalledWith(CURRENT.suiteKey, CURRENT.moduleKey, "en");
    expect(busy(el)).toBe("false");
    expect(article(el)).not.toBeNull();
    const before = article(el)!.textContent;

    const button = currentButton(el);
    button.focus();
    await click(button);

    expect(loader).toHaveBeenCalledTimes(1);
    expect(busy(el)).toBe("false");
    expect(article(el)).not.toBeNull();
    expect(article(el)!.textContent).toBe(before);
    expect(document.activeElement).toBe(button);
  });

  it("keeps the loaded Chinese guide readable without another load", async () => {
    language.value = "zh";
    const el = await render();
    expect(loader).toHaveBeenLastCalledWith(CURRENT.suiteKey, CURRENT.moduleKey, "zh");
    expect(busy(el)).toBe("false");
    const before = article(el)!.textContent;

    await click(currentButton(el));

    expect(loader).toHaveBeenCalledTimes(1);
    expect(busy(el)).toBe("false");
    expect(article(el)).not.toBeNull();
    expect(article(el)!.textContent).toBe(before);
  });

  it("keeps the English fallback marker when the current entry is selected again in Chinese", async () => {
    language.value = "zh";
    loader.mockResolvedValue({ text: GUIDE_TEXT, fellBack: true });
    const el = await render();
    expect(el.querySelector(".gp-enchip")).not.toBeNull();

    await click(currentButton(el));

    expect(loader).toHaveBeenCalledTimes(1);
    expect(busy(el)).toBe("false");
    expect(article(el)).not.toBeNull();
    expect(el.querySelector(".gp-enchip")).not.toBeNull();
  });

  it("keeps the honest empty state when a missing current guide is selected again", async () => {
    loader.mockResolvedValue(null);
    const el = await render();
    expect(el.querySelector(".gp-empty")).not.toBeNull();
    expect(busy(el)).toBe("false");

    await click(currentButton(el));

    expect(loader).toHaveBeenCalledTimes(1);
    expect(busy(el)).toBe("false");
    expect(el.querySelector(".gp-empty")).not.toBeNull();
    expect(article(el)).toBeNull();
  });

  it("keeps a newly selected guide readable when it is selected again", async () => {
    const el = await render();
    await click(libraryButton(el, OTHER.label));
    expect(loader).toHaveBeenCalledTimes(2);
    expect(loader).toHaveBeenLastCalledWith(OTHER.suiteKey, OTHER.moduleKey, "en");
    expect(heading(el)).toBe(OTHER.moduleKey.toUpperCase());

    await click(currentButton(el));

    expect(loader).toHaveBeenCalledTimes(2);
    expect(busy(el)).toBe("false");
    expect(heading(el)).toBe(OTHER.moduleKey.toUpperCase());
  });
});

describe("the idempotence guard does not swallow real navigation", () => {
  it("still loads a different module in the same suite", async () => {
    const el = await render();
    await click(libraryButton(el, OTHER.label));
    expect(loader).toHaveBeenCalledTimes(2);
    expect(loader).toHaveBeenLastCalledWith(OTHER.suiteKey, OTHER.moduleKey, "en");
    expect(busy(el)).toBe("false");
    expect(heading(el)).toBe(OTHER.moduleKey.toUpperCase());
  });

  it("still reloads the guide when the language changes", async () => {
    const el = await render();
    expect(loader).toHaveBeenCalledTimes(1);

    language.value = "zh";
    await rerender();

    expect(loader).toHaveBeenCalledTimes(2);
    expect(loader).toHaveBeenLastCalledWith(CURRENT.suiteKey, CURRENT.moduleKey, "zh");
    expect(busy(el)).toBe("false");
    expect(article(el)).not.toBeNull();
  });
});
