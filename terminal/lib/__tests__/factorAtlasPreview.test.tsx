// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import nativeFixture from "./fixtures/factorAtlasNativeSynthetic.json";
import type { FactorHistoryPreview as PreviewType } from "../../components/factor-atlas/FactorHistoryPreview";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let Preview: typeof PreviewType | undefined;
beforeAll(async () => {
  const path = resolve(process.cwd(), "components/factor-atlas/FactorHistoryPreview.tsx");
  if (existsSync(path)) Preview = (await import(/* @vite-ignore */ pathToFileURL(path).href)).FactorHistoryPreview;
});
const baseProps = () => ({
  items: [{ basketId: "mag7", label: ["Synthetic round trip", "合成往返示例"] as const, payload: structuredClone(nativeFixture) }],
  initialWindow: { anchorDate: "2026-01-28", endDate: "2026-01-30" },
  audience: "synthetic-preview" as const,
  lang: "en" as const,
});

describe("native Factor Atlas preview component", () => {
  let container: HTMLDivElement, root: Root;
  beforeEach(() => { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
  afterEach(() => { act(() => root.unmount()); container.remove(); });
  async function mount(props: Parameters<typeof PreviewType>[0] = baseProps()) {
    expect(Preview, "native Factor Atlas preview component must exist").toBeDefined();
    await act(async () => { root.render(React.createElement(Preview!, props)); });
  }
  it("labels the real native fixture as synthetic, never live or source-admitted", async () => {
    await mount();
    expect(container.textContent).toContain("Synthetic preview");
    expect(container.textContent).toContain("not live market data");
    expect(container.textContent).toContain("Synthetic round trip");
    expect(container.textContent).toContain("0.0%");
    expect(container.querySelector('svg[role="img"]')).not.toBeNull();
    expect(container.innerHTML).not.toContain('preserveAspectRatio="none"');
  });
  it("keeps customer mode entirely withheld", async () => {
    await mount({ ...baseProps(), audience: "customer" });
    expect(container.textContent).toContain("Source admission required");
    expect(container.textContent).not.toContain("Synthetic round trip");
    expect(container.querySelector("svg")).toBeNull();
    expect(container.textContent).not.toContain("33.3%");
  });
  it("cannot preview a real retained-owner payload by caller flag alone", async () => {
    const props = baseProps(); props.items[0].payload.evidence_kind = "RETAINED_OWNER_INPUT";
    await mount(props);
    expect(container.textContent).toContain("Synthetic fixture required");
    expect(container.querySelector("svg")).toBeNull();
  });
  it("switches to customer mode without a stale numeric frame", async () => {
    await mount();
    await mount({ ...baseProps(), audience: "customer" });
    expect(container.querySelector("svg")).toBeNull();
    expect(container.textContent).not.toContain("33.3%");
  });
  it("reuses source holdings when the explicit date control changes", async () => {
    await mount();
    const input = container.querySelector('input[aria-label="Comparison anchor"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "2026-01-29");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.querySelector('[data-metric="window-return"]')?.textContent).toBe("-25.0%");
    expect(container.textContent).not.toContain("-16.7%");
  });
  it("does not silently substitute a nonexistent reference date", async () => {
    await mount({ ...baseProps(), initialWindow: { anchorDate: "2026-01-27", endDate: "2026-01-30" } });
    expect(container.textContent).toContain("Exact reference or end date is unavailable");
    expect(container.querySelector("svg")).toBeNull();
  });
  it("shows a source gap as unavailable, not flat performance", async () => {
    const props = baseProps(); props.items[0].payload.status = "PARTIAL";
    Object.assign(props.items[0].payload.points[1], { return: null, index_level: null, reasons: ["MISSING_OR_INVALID_HELD_PRICE"] });
    await mount(props);
    expect(container.querySelector('[data-metric="window-return"]')?.textContent).toBe("—");
    expect(container.textContent).toContain("Valuation gap");
    expect(container.querySelectorAll('[data-observation="2026-01-30"]')[0]?.textContent).toContain("—");
  });
  it("renders Chinese without leaking English explanatory copy", async () => {
    await mount({ ...baseProps(), lang: "zh" });
    expect(container.textContent).toContain("合成数据预览");
    expect(container.textContent).toContain("合成往返示例");
    expect(container.textContent).not.toContain("Synthetic preview");
    expect(container.querySelector('input[aria-label="参考日期"]')).not.toBeNull();
  });
  it("selection changes do not create a fetch or an implicit new date", async () => {
    await mount();
    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await act(async () => checkbox.click());
    expect(container.textContent).toContain("Select at least one factor");
    expect((container.querySelector('input[aria-label="Comparison anchor"]') as HTMLInputElement).value).toBe("2026-01-28");
    expect(container.querySelector("svg")).toBeNull();
  });
  it("does not create stock-price or vendor-data links for a factor", async () => {
    await mount();
    expect(container.querySelector('a[href*="/data/"]')).toBeNull();
    expect(container.querySelector('a[href*="/stock/"]')).toBeNull();
    expect(container.textContent).toContain("construction");
  });
});
