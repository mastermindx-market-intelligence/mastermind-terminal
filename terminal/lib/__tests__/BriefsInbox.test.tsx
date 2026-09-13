// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import BriefsInbox from "@/components/briefs/BriefsInbox";
import BriefSubscribeControls from "@/components/briefs/BriefSubscribeControls";
import { briefCopy, degradedLine } from "@/lib/briefs";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const THESIS = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const validBody = {
  target: { kind: "thesis", id: THESIS, name: "NVDA cycle", version_or_asof: "v3" },
  market_read: [
    { section: "tape", sentence_en: "The close held above last week's range.", sentence_zh: "收盘守住了上周的区间。", asof: "2026-09-11" },
    { section: "flow", sentence_en: "Call buying stayed in the front week.", sentence_zh: "买权仍集中在近月。", asof: "2026-09-11" },
  ],
  monitors: [{ name: "range hold", state_en: "Holding", state_zh: "仍成立" }],
  artifact: { name: "US session digest", asof: "2026-09-11T20:05:00.000Z" },
};

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let deliveries: unknown[] = [];

function jsonRes(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function installFetch() {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/briefs/deliveries")) {
      return jsonRes(200, { deliveries });
    }
    if (url.includes("/api/briefs/subscriptions")) {
      return jsonRes(200, { subscriptions: [] });
    }
    return jsonRes(404, {});
  }));
}

async function mountInbox(lang: "en" | "zh") {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<BriefsInbox lang={lang} />);
  });
  await act(async () => { await Promise.resolve(); });
}

async function mountSubscribe(lang: "en" | "zh") {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<BriefSubscribeControls targetKind="thesis" targetId={THESIS} lang={lang} />);
  });
  await act(async () => { await Promise.resolve(); });
}

function unmount() {
  if (root) act(() => root!.unmount());
  if (container) container.remove();
  root = null;
  container = null;
}

function text(): string {
  return container?.textContent ?? "";
}

describe("BriefsInbox rendering", () => {
  beforeEach(() => {
    deliveries = [];
    installFetch();
  });
  afterEach(() => {
    unmount();
    vi.unstubAllGlobals();
  });

  it("renders the empty state in EN and ZH", async () => {
    await mountInbox("en");
    expect(text()).toContain(briefCopy("empty", "en"));
    unmount();
    await mountInbox("zh");
    expect(text()).toContain(briefCopy("empty", "zh"));
  });

  it("renders a ready row and a degraded row, pinning the last good brief", async () => {
    deliveries = [
      {
        deliveryId: "d-deg",
        subscriptionId: "s1",
        slotAsof: "2026-09-11",
        state: "degraded",
        body: {},
        createdAt: "2026-09-11T20:10:00.000Z",
        subscription: { targetKind: "thesis", targetId: THESIS, cadence: "daily_after_us_close", state: "active", targetName: "NVDA cycle" },
      },
      {
        deliveryId: "d-ready",
        subscriptionId: "s1",
        slotAsof: "2026-09-10",
        state: "ready",
        pinned: true,
        body: validBody,
        createdAt: "2026-09-10T20:10:00.000Z",
        subscription: { targetKind: "thesis", targetId: THESIS, cadence: "daily_after_us_close", state: "active", targetName: "NVDA cycle" },
      },
    ];
    await mountInbox("en");
    expect(text()).toContain(degradedLine("daily_after_us_close", "en"));
    expect(text()).toContain("The close held above last week's range.");
    expect(text()).toContain("Call buying stayed in the front week.");
    expect(text()).toContain(briefCopy("lastGood", "en"));
    expect(text()).toContain("1 monitor");
    expect(text()).not.toContain("1 monitors");
    expect(container?.querySelectorAll("[data-brief-name]").length).toBe(2);
    for (const el of Array.from(container?.querySelectorAll("[data-brief-name]") ?? [])) {
      expect(el.textContent).toBe("NVDA cycle");
    }
    expect(container?.querySelector("[data-brief-date]")?.textContent).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const sentence = container?.querySelector("[data-brief-sentence]");
    expect(sentence?.className ?? "").toMatch(/sentence/);
    expect(container?.querySelector("[data-brief-row]")?.className ?? "").toMatch(/briefRow/);
    expect(text()).not.toMatch(/daily_after_us_close|falsifier|证伪/);
    unmount();
    await mountInbox("zh");
    expect(text()).toContain(degradedLine("daily_after_us_close", "zh"));
    expect(text()).toContain("收盘守住了上周的区间。");
  });
});

describe("BriefSubscribeControls", () => {
  beforeEach(() => installFetch());
  afterEach(() => {
    unmount();
    vi.unstubAllGlobals();
  });

  it("offers the two cadence sentences in EN and ZH", async () => {
    await mountSubscribe("en");
    expect(text()).toContain(briefCopy("subscribeDaily", "en"));
    expect(text()).toContain(briefCopy("subscribeWeekly", "en"));
    unmount();
    await mountSubscribe("zh");
    expect(text()).toContain(briefCopy("subscribeDaily", "zh"));
    expect(text()).toContain(briefCopy("subscribeWeekly", "zh"));
  });
});

describe("watchlist subscribe mount is outside the nowrap wl-bar", () => {
  it("places BriefSubscribeControls after the wl-bar closes", () => {
    const src = readFileSync(join(__dirname, "../../components/TerminalShell.tsx"), "utf8");
    const mount = src.indexOf("<BriefSubscribeControls");
    expect(mount).toBeGreaterThan(0);
    const before = src.slice(Math.max(0, mount - 250), mount);
    expect(before).not.toMatch(/wl-acts/);
    const after = src.slice(mount, mount + 500);
    expect(after).toMatch(/BriefSubscribeControls[\s\S]{0,450}className="wl-scroll"/);
  });
});
