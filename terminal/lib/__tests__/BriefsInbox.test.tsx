// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import BriefsInbox from "@/components/briefs/BriefsInbox";
import { briefCopy, degradedLine } from "@/lib/briefs";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const THESIS = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WATCHLIST = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
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
    if (url.includes("/api/briefs/subscriptions") && init?.method === "POST") {
      const body = JSON.parse(String(init.body || "{}")) as {
        target_kind?: "thesis" | "watchlist";
        target_id?: string;
        cadence?: "daily_after_us_close" | "weekly_saturday";
      };
      subscriptions = [
        ...subscriptions,
        {
          subscriptionId: "33333333-3333-4333-8333-333333333333",
          userId: "u-1",
          targetKind: body.target_kind,
          targetId: body.target_id,
          targetName: body.target_kind === "watchlist" ? "Semis" : "NVDA cycle",
          cadence: body.cadence,
          delivery: "in_product_inbox",
          state: "active",
          createdAt: "2026-09-11T20:00:00.000Z",
        },
      ];
      return jsonRes(201, { ok: true });
    }
    if (url.includes("/api/briefs/subscriptions")) {
      return jsonRes(200, { subscriptions });
    }
    if (url.endsWith("/api/watchlist")) {
      return jsonRes(200, {
        lists: [{ id: WATCHLIST, name: "Semis", position: 0, symbols: [] }],
        sharedWithMe: [],
      });
    }
    if (url.endsWith("/api/theses")) {
      return jsonRes(200, {
        theses: [{
          id: THESIS,
          currentVersion: 3,
          lifecycleState: "active",
          subject: {},
          title: "NVDA cycle",
          updatedAt: "2026-09-11T20:00:00.000Z",
        }],
        truncated: false,
      });
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

  it("can create a watchlist schedule from the central Briefs surface", async () => {
    await mountInbox("en");
    const target = container?.querySelector<HTMLSelectElement>(
      'select[aria-label="' + briefCopy("scheduleTarget", "en") + '"]',
    );
    const cadence = container?.querySelector<HTMLSelectElement>(
      'select[aria-label="' + briefCopy("scheduleCadence", "en") + '"]',
    );
    expect(target).not.toBeNull();
    expect(cadence).not.toBeNull();

    await act(async () => {
      target!.value = "watchlist:" + WATCHLIST;
      target!.dispatchEvent(new Event("change", { bubbles: true }));
      cadence!.value = "weekly_saturday";
      cadence!.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const add = Array.from(container?.querySelectorAll("button") ?? [])
      .find((button) => button.textContent === briefCopy("addSchedule", "en"));
    expect(add).toBeDefined();
    await act(async () => { add!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/briefs/subscriptions",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          target_kind: "watchlist",
          target_id: WATCHLIST,
          cadence: "weekly_saturday",
        }),
      }),
    );
    expect(text()).toContain("Semis");
    expect(text()).toContain(briefCopy("subscribeWeekly", "en"));
    expect(container?.querySelectorAll("[data-brief-schedule]").length).toBe(1);
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

  it("links only a real ready delivery to the source-authorized sharing review", async () => {
    const id = "40000000-0000-4000-8000-000000000001";
    deliveries = [{ deliveryId: id, state: "ready", body: validBody,
      slotAsof: "2026-11-02", subscription: { cadence: "daily_after_us_close", state: "active" } },
      { deliveryId: "40000000-0000-4000-8000-000000000002", state: "degraded", body: {},
      slotAsof: "2026-11-02", subscription: { cadence: "daily_after_us_close", state: "active" } }];
    await mountInbox("en");
    const links = container!.querySelectorAll("a");
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe(`/briefs/${id}/sharing`);
    expect(links[0].textContent).toBe("Review team sharing");
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

describe("Briefs scheduling is centralized in Alerts", () => {
  it("keeps the legacy contextual component inert with no subscription side effects", () => {
    const src = readFileSync(join(__dirname, "../../components/briefs/BriefSubscribeControls.tsx"), "utf8");
    expect(src).toContain("return null;");
    expect(src).not.toContain("/api/briefs/subscriptions");
    expect(src).not.toContain('method: "POST"');
    expect(src).not.toContain('method: "PATCH"');
    expect(src).not.toContain('data-testid="brief-subscribe"');
  });
});

describe("brief schedule deletion stays out of the central management UI", () => {
  it("does not expose the destructive DELETE path from Alerts → Briefs", () => {
    const inbox = readFileSync(join(__dirname, "../../components/briefs/BriefsInbox.tsx"), "utf8");
    expect(inbox).not.toContain('method: "DELETE"');
    expect(inbox).not.toContain("removeSchedule");
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

type ReadHandler = (init?: RequestInit) => Response | Promise<Response>;

function installReadFetch(overrides: Record<string, ReadHandler> = {}) {
  const defaults: Record<string, ReadHandler> = {
    "GET /api/briefs/deliveries?limit=40": () => jsonRes(200, { deliveries: [] }),
    "GET /api/briefs/subscriptions": () => jsonRes(200, { subscriptions: [] }),
    "GET /api/watchlist": () => jsonRes(200, { lists: [] }),
    "GET /api/theses": () => jsonRes(200, { theses: [] }),
  };
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = (init?.method || "GET") + " " + String(input);
    const handler = overrides[key] || defaults[key];
    if (!handler) throw new Error("Unexpected request: " + key);
    return handler(init);
  }));
}

function pendingResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}

function section(name: "new-schedule" | "schedules" | "delivered"): HTMLElement {
  const el = container?.querySelector<HTMLElement>(`[data-testid="briefs-${name}"]`);
  if (!el) throw new Error("Missing Briefs section: " + name);
  return el;
}

function schedule(state: "active" | "paused" = "active") {
  return {
    subscriptionId: "11111111-1111-4111-8111-111111111111",
    userId: "u-1", targetKind: "thesis", targetId: THESIS, targetName: "NVDA cycle",
    cadence: "daily_after_us_close", delivery: "in_product_inbox", state,
    createdAt: "2026-09-11T20:00:00.000Z",
  };
}

function scheduleAction(label: string): HTMLButtonElement {
  const button = Array.from(section("schedules").querySelectorAll("button"))
    .find((candidate) => candidate.textContent === label);
  if (!button) throw new Error("Missing schedule action: " + label);
  return button;
}

async function click(button: HTMLButtonElement) {
  await act(async () => { button.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
}

describe.each(["en", "zh"] as const)("Briefs read truth and update reconciliation (%s)", (lang) => {
  beforeEach(() => { installReadFetch(); });
  afterEach(() => { unmount(); vi.unstubAllGlobals(); });

  it("does not present two unauthorized target reads as an empty target set", async () => {
    installReadFetch({
      "GET /api/watchlist": () => jsonRes(401, {}),
      "GET /api/theses": () => jsonRes(401, {}),
    });
    await mountInbox(lang);
    expect(section("new-schedule").textContent).toContain(briefCopy("targetsUnavailable", lang));
    expect(section("new-schedule").textContent).not.toContain(briefCopy("noTargets", lang));
    expect(section("new-schedule").querySelector("select")).toBeNull();
    expect(vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
  });

  it.each(["http", "transport", "json"] as const)(
    "preserves available watchlists when the thesis read fails at %s",
    async (failure) => {
      installReadFetch({
        "GET /api/watchlist": () => jsonRes(200, { lists: [{ id: WATCHLIST, name: "Semis" }] }),
        "GET /api/theses": async () => {
          if (failure === "transport") throw new Error("Synthetic connection failure");
          if (failure === "http") return jsonRes(503, {});
          return new Response("{", { status: 200 });
        },
      });
      await mountInbox(lang);
      const composer = section("new-schedule");
      expect(composer.textContent).toContain(briefCopy("targetsPartial", lang));
      expect(composer.textContent).not.toContain(briefCopy("noTargets", lang));
      const target = composer.querySelector<HTMLSelectElement>("select");
      expect(target?.options).toHaveLength(1);
      expect(target?.value).toBe("watchlist:" + WATCHLIST);
      expect(composer.querySelector("button")?.disabled).toBe(false);
    },
  );

  it("requires both target reads to succeed before claiming that no targets exist", async () => {
    installReadFetch({ "GET /api/theses": () => jsonRes(200, { wrong: [] }) });
    await mountInbox(lang);
    expect(section("new-schedule").textContent).toContain(briefCopy("targetsUnavailable", lang));
    expect(section("new-schedule").textContent).not.toContain(briefCopy("noTargets", lang));
    unmount();
    installReadFetch();
    await mountInbox(lang);
    expect(section("new-schedule").textContent).toContain(briefCopy("noTargets", lang));
    expect(section("new-schedule").textContent).not.toContain(briefCopy("targetsUnavailable", lang));
  });

  it("keeps the live StrictMode target generation when the old setup settles later", async () => {
    const oldWatchlists = pendingResponse();
    const oldTheses = pendingResponse();
    let watchlistReads = 0;
    let thesisReads = 0;
    installReadFetch({
      "GET /api/watchlist": () => ++watchlistReads === 1 ? oldWatchlists.promise
        : jsonRes(200, { lists: [{ id: WATCHLIST, name: "Live target" }] }),
      "GET /api/theses": () => ++thesisReads === 1 ? oldTheses.promise : jsonRes(200, { theses: [] }),
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root!.render(<StrictMode><BriefsInbox lang={lang} /></StrictMode>); });
    expect(watchlistReads).toBe(2);
    expect(thesisReads).toBe(2);
    expect(section("new-schedule").querySelector("option")?.textContent).toContain("Live target");
    await act(async () => {
      oldWatchlists.resolve(jsonRes(200, { lists: [] }));
      oldTheses.resolve(jsonRes(401, {}));
    });
    expect(section("new-schedule").querySelector("option")?.textContent).toContain("Live target");
    expect(section("new-schedule").textContent).not.toContain(briefCopy("targetsUnavailable", lang));
    expect(section("new-schedule").textContent).not.toContain(briefCopy("targetsPartial", lang));
  });

  it.each([null, {}])("does not turn malformed collection payload %j into successful empty states", async (body) => {
    installReadFetch({
      "GET /api/briefs/deliveries?limit=40": () => jsonRes(200, body),
      "GET /api/briefs/subscriptions": () => jsonRes(200, body),
    });
    await mountInbox(lang);
    for (const name of ["delivered", "schedules"] as const) {
      expect(section(name).textContent).toContain(briefCopy("unavailable", lang));
      expect(section(name).querySelector("[data-briefs-state], [data-briefs-schedules-state]")).toBeNull();
    }
    expect(section("delivered").querySelector("button")?.textContent).toBe(briefCopy("retry", lang));
  });

  it("keeps an unauthorized schedule read independent of a genuinely empty delivery read", async () => {
    installReadFetch({ "GET /api/briefs/subscriptions": () => jsonRes(401, {}) });
    await mountInbox(lang);
    expect(section("schedules").textContent).toContain(briefCopy("unavailable", lang));
    expect(section("schedules").textContent).not.toContain(briefCopy("noSchedules", lang));
    expect(section("delivered").textContent).toContain(briefCopy("empty", lang));
    expect(section("delivered").querySelector("button")).toBeNull();
  });

  it.each(["null member", "unknown state"] as const)("rejects %s without crashing or presenting a positive state", async (shape) => {
    const badSchedule = shape === "null member" ? null : { ...schedule(), state: "unknown" };
    const badDelivery = shape === "null member" ? null : {
      deliveryId: "40000000-0000-4000-8000-000000000001", state: "unknown",
      body: validBody, slotAsof: "2026-11-02", subscription: schedule(),
    };
    installReadFetch({
      "GET /api/briefs/subscriptions": () => jsonRes(200, { subscriptions: [badSchedule] }),
      "GET /api/briefs/deliveries?limit=40": () => jsonRes(200, { deliveries: [badDelivery] }),
    });
    await mountInbox(lang);
    expect(section("schedules").textContent).toContain(briefCopy("unavailable", lang));
    expect(section("schedules").querySelector("[data-brief-schedule]")).toBeNull();
    expect(section("delivered").textContent).toContain(briefCopy("unavailable", lang));
    expect(section("delivered").querySelector("[data-brief-row], a")).toBeNull();
  });

  it("does not treat a missing thesis lifecycle as a known inactive target", async () => {
    installReadFetch({
      "GET /api/theses": () => jsonRes(200, { theses: [{ id: THESIS, title: "Unknown lifecycle" }] }),
    });
    await mountInbox(lang);
    expect(section("new-schedule").textContent).toContain(briefCopy("targetsUnavailable", lang));
    expect(section("new-schedule").textContent).not.toContain(briefCopy("noTargets", lang));
  });

  it("separates unavailable ready content from a missed delivery and preserves the sharing predicate", async () => {
    const ids = [1, 2, 3].map((n) => "40000000-0000-4000-8000-00000000000" + n);
    installReadFetch({
      "GET /api/briefs/deliveries?limit=40": () => jsonRes(200, { deliveries: [
        { deliveryId: ids[0], state: "ready", body: validBody, slotAsof: "2026-11-02", subscription: schedule() },
        { deliveryId: ids[1], state: "ready", body: {}, slotAsof: "2026-11-01", subscription: schedule() },
        { deliveryId: ids[2], state: "degraded", body: {}, slotAsof: "2026-10-31", subscription: schedule() },
      ] }),
    });
    await mountInbox(lang);
    const rows = section("delivered").querySelectorAll("[data-brief-row]");
    expect(rows).toHaveLength(3);
    expect(rows[1].querySelector('[data-brief-content-unavailable="true"]')?.textContent)
      .toBe(briefCopy("contentUnavailable", lang));
    expect(rows[1].getAttribute("data-brief-miss")).toBeNull();
    expect(rows[1].textContent).toContain("NVDA cycle");
    expect(rows[1].textContent).toContain("2026-11-01");
    expect(rows[1].textContent).not.toContain(degradedLine("daily_after_us_close", lang));
    expect(rows[2].getAttribute("data-brief-miss")).toBe("true");
    expect(rows[2].textContent).toContain(degradedLine("daily_after_us_close", lang));
    const links = section("delivered").querySelectorAll("a");
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe(`/briefs/${ids[0]}/sharing`);
    expect(links[0].textContent).toBe(briefCopy("reviewSharing", lang));
  });

  it("reconciles a lost PATCH reply with GET only and labels a later observation honestly", async () => {
    let reads = 0;
    installReadFetch({
      "GET /api/briefs/subscriptions": () => ++reads === 2 ? jsonRes(503, {})
        : jsonRes(200, { subscriptions: [schedule(reads > 2 ? "paused" : "active")] }),
      "PATCH /api/briefs/subscriptions/11111111-1111-4111-8111-111111111111": async () => {
        throw new Error("Synthetic reply lost after send");
      },
    });
    await mountInbox(lang);
    await click(scheduleAction(briefCopy("pause", lang)));
    expect(section("schedules").querySelector('[data-state="unknown"]')).not.toBeNull();
    expect(section("schedules").textContent).toContain(briefCopy("updateUnconfirmed", lang));
    expect(section("schedules").querySelectorAll("button")).toHaveLength(1);
    await click(scheduleAction(briefCopy("checkStatus", lang)));
    expect(section("schedules").querySelector('[data-state="paused"]')).not.toBeNull();
    expect(section("schedules").textContent).toContain(briefCopy("updateObserved", lang));
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1);
    expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/briefs/subscriptions", { cache: "no-store" });
  });

  it("does not infer the new schedule state from a successful PATCH when its readback fails", async () => {
    let reads = 0;
    installReadFetch({
      "GET /api/briefs/subscriptions": () => ++reads === 1
        ? jsonRes(200, { subscriptions: [schedule()] }) : jsonRes(200, { subscriptions: [] }),
      "PATCH /api/briefs/subscriptions/11111111-1111-4111-8111-111111111111": () => jsonRes(200, { ok: true }),
    });
    await mountInbox(lang);
    await click(scheduleAction(briefCopy("pause", lang)));
    expect(section("schedules").querySelector('[data-state="unknown"]')).not.toBeNull();
    expect(section("schedules").querySelector('[data-state="paused"]')).toBeNull();
    expect(section("schedules").textContent).toContain(briefCopy("scheduleReadPending", lang));
  });

  it("synchronously fences repeated row actions while the first PATCH is outstanding", async () => {
    const pending = pendingResponse();
    let reads = 0;
    installReadFetch({
      "GET /api/briefs/subscriptions": () => jsonRes(200, { subscriptions: [schedule(++reads > 1 ? "paused" : "active")] }),
      "PATCH /api/briefs/subscriptions/11111111-1111-4111-8111-111111111111": () => pending.promise,
    });
    await mountInbox(lang);
    const pause = scheduleAction(briefCopy("pause", lang));
    await act(async () => {
      pause.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      pause.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1);
    expect(section("schedules").querySelector("button")?.disabled).toBe(true);
    await act(async () => { pending.resolve(jsonRes(200, { ok: true })); });
    expect(section("schedules").querySelector('[data-state="paused"]')).not.toBeNull();
  });

  it("does not let a collection read started before a row update replace its reconciled status", async () => {
    const collection = pendingResponse();
    let reads = 0;
    installReadFetch({
      "GET /api/watchlist": () => jsonRes(200, { lists: [{ id: WATCHLIST, name: "Semis" }] }),
      "POST /api/briefs/subscriptions": () => jsonRes(201, { ok: true }),
      "GET /api/briefs/subscriptions": () => ++reads === 2 ? collection.promise
        : jsonRes(200, { subscriptions: [schedule(reads > 2 ? "paused" : "active")] }),
      "PATCH /api/briefs/subscriptions/11111111-1111-4111-8111-111111111111": () => jsonRes(200, { ok: true }),
    });
    await mountInbox(lang);
    await click(section("new-schedule").querySelector("button")!);
    expect(reads).toBe(2);
    await click(scheduleAction(briefCopy("pause", lang)));
    expect(section("schedules").querySelector('[data-state="paused"]')).not.toBeNull();
    await act(async () => { collection.resolve(jsonRes(200, { subscriptions: [schedule()] })); });
    expect(section("schedules").querySelector('[data-state="paused"]')).not.toBeNull();
    expect(section("schedules").querySelector('[data-state="active"]')).toBeNull();
  });
});
