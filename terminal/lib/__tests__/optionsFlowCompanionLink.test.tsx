// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FlowCompanion } from "@/components/options-companion/FlowCompanion";
import { optionsT } from "@/components/options-companion/optionsStrings";
import { decodeTapeView } from "@/lib/optionsTapeView";
import fixture from "../../public/data/flow_fixture.json";

const { stream } = vi.hoisted(() => ({ stream: vi.fn() }));
vi.mock("@/lib/flowStream", () => ({ useFlowStream: stream }));
let host: HTMLDivElement, root: Root, feed: unknown;
beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-14T13:00:00Z"));
  feed = fixture.feed;
  stream.mockReset().mockImplementation((key: string) => ({ data: key === "feed" ? feed : null, connected: false }));
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });
async function render(symbol: string, lang: "en" | "zh" = "en") {
  await act(async () => root.render(<FlowCompanion root={symbol} lang={lang} t={optionsT(lang)} />));
}
const action = () => host.querySelector<HTMLAnchorElement>("a");
function destination() {
  const link = action(); expect(link).not.toBeNull();
  const url = new URL(link!.href);
  expect(url.pathname).toBe("/options");
  expect([...url.searchParams.keys()]).toEqual(["tab", "tapeView"]);
  expect(url.searchParams.get("tab")).toBe("tape");
  const encoded = url.searchParams.get("tapeView");
  const view = decodeTapeView(encoded); expect(view).not.toBeNull();
  return { url, view: view!, encoded: JSON.parse(encoded!) };
}

describe("chart Flow expansion adopts the chart root through the existing Tape owner", () => {
  it.each(["en", "zh"] as const)("names the symbol and opens a strict root view (%s)", async lang => {
    await render("NVDA", lang);
    const { view, encoded } = destination();
    expect(action()?.textContent).toContain(lang === "zh" ? "NVDA · 交易动态" : "NVDA · Activity tape");
    expect(view.drillTicker).toBe("NVDA");
    expect(view.tapeTickerSearch).toBe("");
    expect(view.minPrem).toBe(0);
    expect(view.sideFilter).toBe("");
    expect(view.dteBuckets).toEqual([]);
    expect(encoded).not.toHaveProperty("eventId");
    expect(encoded).not.toHaveProperty("session");
    expect(host.querySelectorAll("[data-options-tape] article").length).toBeGreaterThan(0);
  });

  it("follows an in-place chart-root change while the old-root feed remains", async () => {
    await render("NVDA"); expect(destination().view.drillTicker).toBe("NVDA");
    const oldFeed = feed;
    await render("AMD");
    expect(feed).toBe(oldFeed);
    expect(destination().view.drillTicker).toBe("AMD");
    expect(action()?.textContent).toContain("AMD");
    expect(host.querySelector("[data-options-tape]")?.textContent).not.toContain("NVDA");
  });

  it("retains a dotted root without substring matching or alias substitution", async () => {
    await render("BRK.B");
    expect(destination().view.drillTicker).toBe("BRK.B");
    expect(destination().view.tapeTickerSearch).toBe("");
  });

  it.each(["absent", "untimed"] as const)("keeps destination identity with an %s feed", async mode => {
    feed = mode === "absent" ? null : { ...fixture.feed, events: [{ ...fixture.feed.events[0], ts: "invalid" }] };
    await render("QQQ");
    expect(destination().view.drillTicker).toBe("QQQ");
    expect(host.querySelectorAll("[data-options-tape] article")).toHaveLength(0);
    expect(host.querySelector("[data-flow-freshness]")?.getAttribute("data-flow-freshness")).toBe("unavailable");
    expect(action()?.textContent).not.toMatch(/live/i);
  });

  it.each(["en", "zh"] as const)("does not widen or truncate a root the Tape codec rejects (%s)", async lang => {
    await render("ABCDEFGHIJK", lang);
    expect(action()).toBeNull();
    expect(host.textContent).toContain(lang === "zh" ? "ABCDEFGHIJK · 交易动态 — 不可用" : "ABCDEFGHIJK · Activity tape — unavailable");
    expect(host.querySelector('[data-options-flow-destination="unavailable"]')?.getAttribute("role")).toBe("status");
  });
});
