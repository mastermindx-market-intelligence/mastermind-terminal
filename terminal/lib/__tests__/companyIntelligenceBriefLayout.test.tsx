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

  it("preserves the Chinese label and original source action when a fact replaces its takeaway", async () => {
    const value = { ...props(), zh: true, takeaways: [{ ...revenue, label: "营收" }], risks: [] };
    const el = await mount(value);
    const fact = el.querySelector<HTMLButtonElement>(".ci-paper-metrics button")!;
    expect(fact.textContent).toContain("营收");
    expect(fact.textContent).toContain(revenue.value);
    expect(el.querySelectorAll(".ci-paper-takeaways button")).toHaveLength(0);
    await act(async () => fact.click());
    expect(value.onSelect).toHaveBeenLastCalledWith(revenue);
  });

  it("retains a distinct takeaway when there are no facts and states missing implications honestly in Chinese", async () => {
    const el = await mount({ ...props(), zh: true, metrics: [], takeaways: [unique], risks: [] });
    expect(el.querySelector(".ci-paper-metrics")).toBeNull();
    expect(el.textContent).toContain(unique.value);
    expect(el.textContent).toContain("本事件尚未提供业务含义分析");
    expect(el.textContent).toContain("本次事件暂无有来源支持的关注事项。");
  });

  it.each([
    { zh: false, missing: "No comparison is available for this event." },
    { zh: true, missing: "本事件暂无可用的对比信息。" },
  ])("marks honest unavailable cards as compact without losing copy or source footer (zh=$zh)", async ({ zh, missing }) => {
    const el = await mount({ ...props(), zh, footer: <p data-source-footer="true">Source receipts retained</p> });
    expect(el.querySelectorAll(".ci-paper-insight[data-empty='true']")).toHaveLength(2);
    expect(el.querySelectorAll(".ci-paper-insight[data-empty='false']")).toHaveLength(1);
    expect(el.querySelectorAll(".ci-paper-watch[data-empty='true']")).toHaveLength(1);
    expect(el.textContent).toContain(missing);
    expect(el.querySelector("[data-source-footer]")?.textContent).toContain("Source receipts retained");
    expect(el.querySelector(".ci-paper-metrics button")).not.toBeNull();
  });

  it("does not compact populated panels or remove their original evidence actions", async () => {
    const change = { id: "change", label: "Reported change", value: "Revenue growth, source-backed" };
    const implication = { id: "impact", label: "Context", value: "Impact requires review" };
    const value = {
      ...props(),
      changes: [change], implications: [implication], watch: [watch],
      footer: <p data-source-footer="true">Original source boundary</p>,
    };
    const el = await mount(value);
    expect(el.querySelectorAll(".ci-paper-insight[data-empty='false']")).toHaveLength(3);
    expect(el.querySelectorAll(".ci-paper-insight[data-empty='true']")).toHaveLength(0);
    expect(el.querySelector(".ci-paper-watch[data-empty='false']")).not.toBeNull();
    const changeButton = el.querySelector<HTMLButtonElement>(".ci-paper-insight button")!;
    await act(async () => changeButton.click());
    expect(value.onSelect).toHaveBeenCalledWith(change);
    expect(el.textContent).toContain("Original source boundary");
  });
});
