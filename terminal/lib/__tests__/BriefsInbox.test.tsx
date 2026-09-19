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
let subscriptions: unknown[] = [];

function jsonRes(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function installFetch() {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/briefs/deliveries")) {
      return jsonRes(200, { deliveries });
    }
    if (url.includes("/api/briefs/subscriptions/") && init?.method === "DELETE") {
      const id = url.split("/").pop();
      subscriptions = subscriptions.filter((row) => (row as { subscriptionId?: string }).subscriptionId !== id);
      return jsonRes(200, { ok: true, deleted: true });
    }
    if (url.includes("/api/briefs/subscriptions/") && init?.method === "PATCH") {
      const id = url.split("/").pop();
      const body = JSON.parse(String(init.body || "{}")) as { state?: "pause" | "resume" };
      subscriptions = subscriptions.map((row) => {
        const sub = row as { subscriptionId?: string; state?: string };
        if (sub.subscriptionId !== id) return row;
        return { ...sub, state: body.state === "pause" ? "paused" : "active" };
      });
      return jsonRes(200, { ok: true });
    }
    if (url.includes("/api/briefs/subscriptions")) {
      return jsonRes(200, { subscriptions });
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
    subscriptions = [];
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

  it("shows and manages scheduled briefs from the same Alerts surface", async () => {
    subscriptions = [
      {
        subscriptionId: "11111111-1111-4111-8111-111111111111",
        userId: "u-1",
        targetKind: "thesis",
        targetId: THESIS,
        targetName: "NVDA cycle",
        cadence: "daily_after_us_close",
        delivery: "in_product_inbox",
        state: "active",
        createdAt: "2026-09-11T20:00:00.000Z",
      },
      {
        subscriptionId: "22222222-2222-4222-8222-222222222222",
        userId: "u-1",
        targetKind: "watchlist",
        targetId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        targetName: "Semis",
        cadence: "weekly_saturday",
        delivery: "in_product_inbox",
        state: "paused",
        createdAt: "2026-09-10T20:00:00.000Z",
      },
    ];
    await mountInbox("en");
    expect(container?.querySelectorAll("[data-brief-schedule]").length).toBe(2);
    expect(text()).toContain("NVDA cycle");
    expect(text()).toContain("Semis");
    expect(text()).toContain(briefCopy("subscribeDaily", "en"));
    expect(text()).toContain(briefCopy("subscribeWeekly", "en"));
    expect(text()).toContain(briefCopy("on", "en"));
    expect(text()).toContain(briefCopy("paused", "en"));

    const pause = Array.from(container?.querySelectorAll("button") ?? [])
      .find((button) => button.textContent === briefCopy("pause", "en"));
    expect(pause).toBeDefined();
    await act(async () => { pause!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(container?.querySelectorAll('[data-brief-schedule] [data-state="paused"]').length).toBe(2);

    expect(container?.querySelectorAll("[data-brief-schedule]").length).toBe(2);
    expect(text()).toContain("Semis");
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
    expect(text()).toContain(briefCopy("subscribeDaily", "en"));
    expect(container?.querySelector("[data-brief-cadence]")?.textContent).toBe(briefCopy("subscribeDaily", "en"));
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
  beforeEach(() => {
    subscriptions = [];
    installFetch();
  });
  afterEach(() => {
    unmount();
    vi.unstubAllGlobals();
  });

  it("offers explicit schedules and tells the user exactly where briefs arrive", async () => {
    await mountSubscribe("en");
    expect(text()).toContain(briefCopy("controlsTitle", "en"));
    expect(text()).toContain(briefCopy("scheduleHelp", "en"));
    expect(text()).toContain(briefCopy("emailNull", "en"));
    expect(text()).toContain(briefCopy("subscribeDaily", "en"));
    expect(text()).toContain(briefCopy("subscribeWeekly", "en"));
    expect(text()).not.toContain("Send me a brief");
    unmount();
    await mountSubscribe("zh");
    expect(text()).toContain(briefCopy("controlsTitle", "zh"));
    expect(text()).toContain(briefCopy("emailNull", "zh"));
    expect(text()).toContain(briefCopy("subscribeDaily", "zh"));
    expect(text()).toContain(briefCopy("subscribeWeekly", "zh"));
  });

  it("links to the real inbox and lets an existing schedule be paused without deleting history", async () => {
    subscriptions = [{
      subscriptionId: "11111111-1111-4111-8111-111111111111",
      userId: "22222222-2222-4222-8222-222222222222",
      targetKind: "thesis",
      targetId: THESIS,
      cadence: "daily_after_us_close",
      delivery: "in_product_inbox",
      state: "active",
      createdAt: "2026-09-11T20:00:00.000Z",
    }];
    await mountSubscribe("en");
    const inboxLink = container?.querySelector('a[href="/alerts"]');
    expect(inboxLink?.textContent).toBe(briefCopy("openInbox", "en"));
    expect(text()).toContain(briefCopy("on", "en"));

    const pause = Array.from(container?.querySelectorAll("button") ?? [])
      .find((button) => button.textContent === briefCopy("pause", "en"));
    expect(pause).toBeDefined();
    await act(async () => { pause!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/briefs/subscriptions/11111111-1111-4111-8111-111111111111",
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(text()).toContain(briefCopy("paused", "en"));
    expect(text()).toContain(briefCopy("resume", "en"));
    expect(container?.querySelectorAll('button')).not.toBeNull();
  });
});

describe("brief schedule deletion stays out of casual UI", () => {
  it("does not expose the destructive DELETE path in either Brief surface", () => {
    const contextual = readFileSync(join(__dirname, "../../components/briefs/BriefSubscribeControls.tsx"), "utf8");
    const inbox = readFileSync(join(__dirname, "../../components/briefs/BriefsInbox.tsx"), "utf8");
    expect(contextual).not.toContain('method: "DELETE"');
    expect(inbox).not.toContain('method: "DELETE"');
    expect(contextual).not.toContain("removeSchedule");
    expect(inbox).not.toContain("removeSchedule");
  });
});

describe("unfinished recurring briefs stay out of primary Terminal chrome", () => {
  it("keeps BriefSubscribeControls out of TerminalShell until the producer is live", () => {
    const src = readFileSync(join(__dirname, "../../components/TerminalShell.tsx"), "utf8");
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
