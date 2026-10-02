// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import MarketOntologyContextStrip from "@/components/workspaces/MarketOntologyContextStrip";
import { LangProvider, applyLang } from "@/lib/i18n";
import type { MarketOntologyContext } from "@/lib/marketOntologyContext";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ontologyContext: MarketOntologyContext = {
  from: "ontology",
  chain: "chain_1",
  focus: "node_1",
  pathRev: "3",
  asof: "2026-09-23",
  kc: "2026-08-31",
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function mount(context: MarketOntologyContext = ontologyContext) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <LangProvider>
        <MarketOntologyContextStrip context={context} />
      </LangProvider>,
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
  return container;
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  document.documentElement.setAttribute("data-lang", "en");
});

describe("MarketOntologyContextStrip", () => {
  it("renders English fixed copy, formatted dates, and the safe return link", async () => {
    applyLang("en");
    const dom = await mount();

    expect(dom.querySelector('[data-testid="mo-context-strip"]')).not.toBeNull();
    expect(dom.textContent).toContain("Opened from WTI Live Path");
    expect(dom.textContent).toContain("This company was opened from a MarketOntology research path. The context is not saved into your theses.");
    expect(dom.textContent).toContain("As of September 23, 2026");
    expect(dom.textContent).toContain("Knowledge cutoff August 31, 2026");
    expect(dom.querySelector("a")?.getAttribute("href")).toBe("https://www.mastermind-x.com/ontology.html?rev=3#ox-leg-node_1");
    expect(dom.querySelector("a")?.getAttribute("rel")).toBe("noopener");
  });

  it("renders Chinese fixed copy and formatted dates", async () => {
    applyLang("zh");
    const dom = await mount();

    expect(dom.textContent).toContain("来自 WTI 实时路径");
    expect(dom.textContent).toContain("该公司是从 MarketOntology 研究路径打开的。此上下文不会保存到你的论点中。");
    expect(dom.textContent).toContain("截至 2026年9月23日");
    expect(dom.textContent).toContain("知识截止 2026年8月31日");
    expect(dom.textContent).toContain("返回 WTI 实时路径");
  });

  it("does not print raw context identifiers", async () => {
    applyLang("en");
    const dom = await mount();
    const text = dom.textContent ?? "";

    expect(text).not.toContain("chain_1");
    expect(text).not.toContain("node_1");
  });
});

describe("MarketOntologyContextStrip transmission copy", () => {
  it("labels the return destination for both languages", async () => {
    const transmissionContext: MarketOntologyContext = {
      from: "transmission",
      chain: "chain_1",
      focus: "node_1",
      pathRev: "3",
    };

    applyLang("en");
    let dom = await mount(transmissionContext);
    expect(dom.textContent).toContain("Opened from Transmission");
    expect(dom.querySelector("a")?.textContent).toBe("Back to Transmission");
    expect(dom.querySelector("a")?.getAttribute("href")).toBe("https://www.mastermind-x.com/transmission.html");
    await act(async () => {
      root?.unmount();
    });
    container?.remove();
    root = null;
    container = null;

    applyLang("zh");
    dom = await mount(transmissionContext);
    expect(dom.textContent).toContain("来自传导");
    expect(dom.querySelector("a")?.textContent).toBe("返回传导");
  });
});
