// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CompanyTopicTimeline from "@/components/fin/CompanyTopicTimeline";
import type { CompanyIntelligenceTopic } from "@/lib/companyIntelligence";

const topics: CompanyIntelligenceTopic[] = [
  { tag: "data_center", status: "added", event_count: 2, first_event_id: "one", last_event_id: "two" },
  { tag: "ai", status: "persistent", event_count: 8, first_event_id: "one", last_event_id: "two" },
  { tag: "cloud", status: "dropped", event_count: 0, first_event_id: "one", last_event_id: "one" },
];
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function render(zh = false, records = topics) {
  await act(async () => root.render(<CompanyTopicTimeline topics={records} zh={zh} />));
}
async function search(value: string) {
  const input = host.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function select(index: number, value: string) {
  const input = host.querySelectorAll("select")[index];
  await act(async () => { input.value = value; input.dispatchEvent(new Event("change", { bubbles: true })); });
}
const rows = () => [...host.querySelectorAll("tbody tr")].map(row => row.textContent);

describe("published topic history browsing", () => {
  it("sorts existing evidence, combines status and search, and preserves zero counts", async () => {
    const original = JSON.stringify(topics);
    await render();
    expect(rows()[0]).toContain("8");
    await select(0, "dropped");
    expect(rows()).toHaveLength(1);
    expect(host.querySelector("tbody .num")?.textContent).toBe("0");
    await search("data center");
    expect(rows()).toHaveLength(0);
    expect(host.textContent).toContain("No topics match these filters.");
    await select(0, "all");
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toContain("Data center");
    expect(host.querySelector('[role="status"]')?.textContent).toBe("1 of 3 topics");
    await search("");
    await select(1, "name");
    expect(rows().map(row => row?.replace(/(?:Added|Persistent|Dropped).*$/, ""))).toEqual(["AI", "Cloud", "Data center"]);
    expect(JSON.stringify(topics)).toBe(original);
  });

  it("finds localized topic names without changing the source tags", async () => {
    await render(true);
    await search("数据中心");
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toContain("数据中心");
    expect(host.querySelector('[role="status"]')?.textContent).toBe("1 / 3 个主题");
  });

  it("shows an honest compact absence when no topic history is published", async () => {
    await render(false, []);
    expect(host.querySelector("table")).toBeNull();
    expect(host.querySelector("input")).toBeNull();
    expect(host.textContent).toBe("Topic history is not available for this company yet.");
  });
});
