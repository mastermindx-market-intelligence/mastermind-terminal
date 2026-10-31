// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import BriefsInbox from "@/components/briefs/BriefsInbox";
import BriefSubscribeControls from "@/components/briefs/BriefSubscribeControls";
import { briefCopy, degradedLine, BRIEFS_EXPLICIT_LANGUAGE_CONTRACT } from "@/lib/briefs";

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
let deliveryContract: string | undefined;
let deliveryResponse: { status: number; body: unknown } | null = null;

function jsonRes(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function installFetch() {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/briefs/deliveries")) {
      return deliveryResponse
        ? jsonRes(deliveryResponse.status, deliveryResponse.body)
        : jsonRes(200, { deliveries, ...(deliveryContract ? { contract: deliveryContract } : {}) });
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
    deliveryContract = undefined;
    deliveryResponse = null;
    installFetch();
  });
  afterEach(() => {
    unmount();
    vi.unstubAllGlobals();
  });


  function readyRow(body: unknown) {
    return {
      deliveryId: "language-ready", subscriptionId: "s1", slotAsof: "2026-10-17",
      state: "ready", body, createdAt: "2026-10-17T07:00:00.000Z",
      subscription: { targetKind: "thesis", targetId: THESIS, cadence: "weekly_saturday", state: "active" },
    };
  }

  it("retains mixed-language ready content and requests explicit capability in both locales", async () => {
    deliveryContract = BRIEFS_EXPLICIT_LANGUAGE_CONTRACT;
    deliveries = [readyRow({
      ...validBody,
      market_read: [
        { ...validBody.market_read[0], translation_status: "available" },
        { ...validBody.market_read[1], sentence_zh: null, translation_status: "unavailable" },
      ],
    })];
    await mountInbox("en");
    expect(fetch).toHaveBeenCalledWith(`/api/briefs/deliveries?limit=40&contract=${BRIEFS_EXPLICIT_LANGUAGE_CONTRACT}`);
    expect(text()).toContain(validBody.market_read[1].sentence_en);
    expect(text()).toContain("Chinese available for 1 of 2");
    expect(text()).toContain("NVDA cycle");
    expect(text()).toContain("1 monitor");
    expect(container?.querySelector("[data-brief-miss]")).toBeNull();
    expect(container?.querySelector("[data-brief-pinned]")).toBeNull();
    unmount();
    await mountInbox("zh");
    expect(text()).toContain(validBody.market_read[0].sentence_zh);
    expect(text()).toContain(`英文原文：${validBody.market_read[1].sentence_en}`);
    expect(text()).toContain("中文解读可用 1/2 条");
    expect(text()).not.toContain("翻译待补");
    expect(container?.querySelector("[data-brief-miss]")).toBeNull();
  });

  it("reports incomplete Chinese beyond the first two displayed passages", async () => {
    deliveryContract = BRIEFS_EXPLICIT_LANGUAGE_CONTRACT;
    deliveries = [readyRow({
      ...validBody,
      market_read: [
        ...validBody.market_read,
        { section: "watch_items", sentence_en: "Watch credit.", sentence_zh: null, translation_status: "unavailable", asof: "2026-10-17" },
      ],
    })];
    await mountInbox("zh");
    expect(text()).toContain("中文解读可用 2/3 条");
    expect(text()).not.toContain("Watch credit.");
    expect(text()).toContain(validBody.market_read[1].sentence_zh);
    expect(container?.querySelectorAll("[data-brief-language-availability]")).toHaveLength(1);
  });

  it("labels the historical pending-marker form without dropping an unacknowledged legacy response", async () => {
    deliveries = [readyRow({
      ...validBody,
      market_read: [{
        ...validBody.market_read[0],
        sentence_zh: `${validBody.market_read[0].sentence_en} （翻译待补）`,
      }],
    })];
    await mountInbox("zh");
    expect(text()).toContain(`英文原文：${validBody.market_read[0].sentence_en}`);
    expect(text()).toContain("中文解读可用 0/1 条");
    expect(text()).not.toContain("翻译待补");
  });

  it("does not accept nullable publication from an unacknowledged or unknown API contract", async () => {
    deliveries = [readyRow({
      ...validBody,
      market_read: [{ ...validBody.market_read[0], sentence_zh: null, translation_status: "unavailable" }],
    })];
    for (const contract of [undefined, "unknown"]) {
      deliveryContract = contract;
      await mountInbox("en");
      expect(text()).toContain(briefCopy("unavailable", "en"));
      expect(container?.querySelector("[data-brief-row]")).toBeNull();
      unmount();
    }
  });

  it("offers localized page refresh for a typed upgrade response, rather than another API retry", async () => {
    deliveryResponse = {
      status: 409,
      body: { error: "UPGRADE_REQUIRED", requiredContract: BRIEFS_EXPLICIT_LANGUAGE_CONTRACT, reloadRequired: true },
    };
    const reload = vi.fn();
    const realWindow = window;
    vi.stubGlobal("window", new Proxy(realWindow, {
      get(target, key) { return key === "location" ? { reload } : Reflect.get(target, key); },
    }));
    for (const lang of ["en", "zh"] as const) {
      await mountInbox(lang);
      expect(text()).toContain(briefCopy("upgradeRequired", lang));
      const button = container!.querySelector("button")!;
      expect(button.textContent).toBe(briefCopy("refresh", lang));
      const requests = vi.mocked(fetch).mock.calls.length;
      await act(async () => { button.click(); });
      expect(vi.mocked(fetch).mock.calls.length).toBe(requests);
      unmount();
    }
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("keeps an unrelated 409 as unavailable with the existing retry action", async () => {
    deliveryResponse = { status: 409, body: { error: "UNRELATED", reloadRequired: true } };
    await mountInbox("en");
    expect(text()).toContain(briefCopy("unavailable", "en"));
    expect(container?.querySelector("button")?.textContent).toBe(briefCopy("retry", "en"));
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

describe("unfinished recurring briefs stay out of primary Terminal chrome", () => {
  it("keeps BriefSubscribeControls out of TerminalShell until the producer is live", () => {
    const src = readFileSync(join(__dirname, "../../components/TerminalShell.tsx"), "utf8");
    expect(src).not.toContain('from "@/components/briefs/BriefSubscribeControls"');
    expect(src).not.toContain("<BriefSubscribeControls");
  });

  it("keeps BriefSubscribeControls out of ThesisWorkspace until the producer is live", () => {
    const src = readFileSync(join(__dirname, "../../components/workspaces/ThesisWorkspace.tsx"), "utf8");
    expect(src).not.toContain('from "@/components/briefs/BriefSubscribeControls"');
    expect(src).not.toContain("<BriefSubscribeControls");
  });

  it("does not advertise dormant Briefs delivery in Terminal settings", () => {
    const src = readFileSync(join(__dirname, "../../components/settings/SectionTerminal.tsx"), "utf8");
    expect(src).not.toContain('from "@/lib/briefs"');
    expect(src).not.toContain('briefCopy("title"');
    expect(src).not.toContain('briefCopy("emailNull"');
  });
});
