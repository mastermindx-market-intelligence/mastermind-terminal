// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FactorHistoryPreview, type FactorHistoryPreviewProps } from "../../components/factor-atlas/FactorHistoryPreview";
import native from "./fixtures/factorAtlasNativeSynthetic.json";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const seed = (): FactorHistoryPreviewProps => ({
  items: [{ basketId: "mag7", label: ["Synthetic round trip","合成往返示例"] as const, payload: structuredClone(native) }],
  initialWindow: { anchorDate:"2026-01-28", endDate:"2026-01-30" },
  audience:"synthetic-preview" as const, lang:"en" as const, urlState:true,
});

describe("Factor Atlas URL selection and exact window", () => {
  let host: HTMLDivElement, root: Root;
  beforeEach(() => {
    window.history.replaceState(null,"","/admin/factor-atlas-preview");
    host=document.createElement("div");
    document.body.appendChild(host);
    root=createRoot(host);
  });
  afterEach(() => {
    act(()=>root.unmount());
    host.remove();
    window.history.replaceState(null,"","/admin/factor-atlas-preview");
  });
  async function mount(props=seed()) {
    await act(async()=>{root.render(React.createElement(FactorHistoryPreview,props));});
  }
  async function changeAnchor(date:string) {
    const input=host.querySelector('input[aria-label="Comparison anchor"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    await act(async()=>{
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,date);
      input.dispatchEvent(new Event("input",{bubbles:true}));
      input.dispatchEvent(new Event("change",{bubbles:true}));
    });
  }
  it("loads exact source-held return from an explicit deep link without resetting holdings", async () => {
    window.history.replaceState(null,"","/admin/factor-atlas-preview?faFactor=mag7&faStart=2026-01-29&faEnd=2026-01-30");
    await mount();
    expect(host.querySelector('[data-metric="window-return"]')?.textContent).toBe("-25.0%");
    expect((host.querySelector('input[aria-label="Comparison anchor"]') as HTMLInputElement).value).toBe("2026-01-29");
  });
  it("writes date and factor URL state without deleting unrelated query parameters", async () => {
    window.history.replaceState(null,"","/admin/factor-atlas-preview?tab=sectors");
    await mount();
    await changeAnchor("2026-01-29");
    const params = new URLSearchParams(window.location.search);
    expect(params.get("tab")).toBe("sectors");
    expect(params.getAll("faFactor")).toEqual(["mag7"]);
    expect(params.get("faStart")).toBe("2026-01-29");
    expect(params.get("faEnd")).toBe("2026-01-30");
    expect(host.querySelector('[data-metric="window-return"]')?.textContent).toBe("-25.0%");
  });
  it("restores a prior exact window on browser navigation without writing a new history entry", async () => {
    await mount();
    await changeAnchor("2026-01-29");
    const previous="/admin/factor-atlas-preview?faFactor=mag7&faStart=2026-01-28&faEnd=2026-01-30";
    window.history.replaceState(null,"",previous);
    const before=window.history.length;
    await act(async()=>window.dispatchEvent(new PopStateEvent("popstate")));
    expect((host.querySelector('input[aria-label="Comparison anchor"]') as HTMLInputElement).value).toBe("2026-01-28");
    expect(host.querySelector('[data-metric="window-return"]')?.textContent).toBe("0.0%");
    expect(window.history.length).toBe(before);
    expect(window.location.href).toContain("faStart=2026-01-28");
  });
  it("rejects unknown factor link instead of silently presenting a different basket",async()=>{
    window.history.replaceState(null,"","/admin/factor-atlas-preview?faFactor=OTHER&faStart=2026-01-28&faEnd=2026-01-30");
    await mount();
    expect(host.textContent).toContain("Invalid factor link");
    expect(host.querySelectorAll('[data-metric="window-return"]')).toHaveLength(0);
    expect(host.querySelector("svg")).toBeNull();
    const box=host.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await act(async()=>box.click());
    expect(host.querySelectorAll('[data-metric="window-return"]')).toHaveLength(1);
    expect(host.textContent).not.toContain("Invalid factor link");
  });
  it("retains an explicit empty-selection link without selecting an arbitrary fallback",async()=>{
    window.history.replaceState(null,"","/admin/factor-atlas-preview?faFactor=&faStart=2026-01-28&faEnd=2026-01-30");
    await mount();
    expect(host.textContent).toContain("Select at least one factor");
    expect(host.querySelectorAll('[data-metric="window-return"]')).toHaveLength(0);
  });
  it("does not server-render an unvalidated default basket before processing a link", () => {
    window.history.replaceState(null,"","/admin/factor-atlas-preview?faFactor=OTHER&faStart=2026-01-28&faEnd=2026-01-30");
    const html = renderToString(<FactorHistoryPreview {...seed()} />);
    expect(html).toContain("Validating factor link");
    expect(html).not.toContain('data-metric="window-return"');
    expect(html).not.toContain("0.0%");
    expect(html).not.toContain("<svg");
  });
  it("continues withholding customer mode regardless of a syntactically valid deep link",async()=>{
    window.history.replaceState(null,"","/admin/factor-atlas-preview?faFactor=mag7&faStart=2026-01-28&faEnd=2026-01-30");
    await mount({...seed(),audience:"customer"});
    expect(host.textContent).toContain("Source admission required");
    expect(host.querySelectorAll('[data-metric="window-return"]')).toHaveLength(0);
  });
});
