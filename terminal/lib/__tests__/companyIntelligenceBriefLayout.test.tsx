// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import CompanyIntelligenceBriefLayout from "../../components/fin/CompanyIntelligenceBriefLayout";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let node: HTMLDivElement | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  node?.remove();
});
const revenue = { id: "revenue", label: "Revenue", value: "$109.4B", detail: "Reported quarter" };
const watch = { id: "watch", label: "Demand", value: "Demand remains a watchpoint" };
const unique = { id: "unique", label: "Additional context", value: "A distinct reported fact" };
function props(): ComponentProps<typeof CompanyIntelligenceBriefLayout> {
  return { zh: false, ticker: "AAPL", periodLabel: "Q3 FY2026", eventDate: "2026-07-30",
    headline: "Quarterly revenue", summary: null, metrics: [revenue],
    takeaways: [revenue, watch, unique], changes: [], implications: [], risks: [watch], watch: [], onSelect: vi.fn() };
}
async function mount(value: ComponentProps<typeof CompanyIntelligenceBriefLayout>) {
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
  await act(async () => root!.render(<CompanyIntelligenceBriefLayout {...value} />));
  return node;
}

describe("Intelligence brief evidence access", () => {
  it("keeps each hero fact and distinct takeaway selectable without duplicating panel evidence", async () => {
    const value = props();
    const el = await mount(value);
    const fact = el.querySelector<HTMLButtonElement>(".ci-paper-metrics button")!;
    const takeaway = el.querySelector<HTMLButtonElement>(".ci-paper-takeaways button")!;
    expect(el.querySelectorAll(".ci-paper-takeaways button")).toHaveLength(1);
    expect(takeaway.textContent).toContain(unique.value);
    expect(el.textContent).toContain(watch.value);
    await act(async () => fact.click());
    expect(value.onSelect).toHaveBeenLastCalledWith(revenue);
    await act(async () => takeaway.click());
    expect(value.onSelect).toHaveBeenLastCalledWith(unique);
  });

  it("retains a distinct takeaway when there are no facts and states missing implications honestly in Chinese", async () => {
    const el = await mount({ ...props(), zh: true, metrics: [], takeaways: [unique], risks: [] });
    expect(el.querySelector(".ci-paper-metrics")).toBeNull();
    expect(el.textContent).toContain(unique.value);
    expect(el.textContent).toContain("本事件尚未提供业务含义分析");
    expect(el.textContent).toContain("暂无有来源支持的关注点");
  });
});
