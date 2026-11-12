// @vitest-environment jsdom
// Incumbent delivery ownership cases, adapted to the current language consumer.
// Scheduling UI and mutation-owner cases remain on their original #662 carrier.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import BriefsInbox from "@/components/briefs/BriefsInbox";
import { BRIEFS_EXPLICIT_LANGUAGE_CONTRACT, briefCopy, type BriefLang, type PinnedDelivery } from "@/lib/briefs";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function jsonRes(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json" },
  });
}

function delivery(name: string): PinnedDelivery {
  return {
    deliveryId: name,
    subscriptionId: "s1",
    slotAsof: "2026-10-02",
    state: "ready",
    degradedReason: null,
    artifactAsof: null,
    body: {
      target: { kind: "thesis", id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name, version_or_asof: "v3" },
      market_read: [{ section: "tape", sentence_en: "Current original.", sentence_zh: null,
        translation_status: "unavailable", asof: "2026-10-02" }],
      monitors: [], artifact: { name: "Digest", asof: "2026-10-02" },
    },
    createdAt: "2026-10-02T20:10:00.000Z",
    subscription: {
      targetKind: "thesis",
      targetId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      cadence: "daily_after_us_close",
      state: "active",
      targetName: name,
    },
  };
}

let container: HTMLDivElement | null;
let root: Root | null;
let requests: Deferred<Response>[];
let calls: Array<{ url: string; method: string }>;

function installFetch() {
  requests = [];
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method || "GET";
    calls.push({ url, method });
    if (method !== "GET") throw new Error("Unexpected mutation: " + method);
    if (url === `/api/briefs/deliveries?limit=40&contract=${BRIEFS_EXPLICIT_LANGUAGE_CONTRACT}`) {
      const request = deferred<Response>();
      requests.push(request);
      return request.promise;
    }
    if (url === "/api/briefs/subscriptions") return jsonRes(200, { subscriptions: [] });
    if (url === "/api/watchlist") return jsonRes(200, { lists: [] });
    if (url === "/api/theses") return jsonRes(200, { theses: [] });
    throw new Error("Unexpected request: " + url); // No live-network fallback.
  }));
}

async function mount(lang: BriefLang, strict = false) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    const inbox = <BriefsInbox lang={lang} />;
    root!.render(strict ? <StrictMode>{inbox}</StrictMode> : inbox);
  });
}

function unmount() {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
}

function delivered(): HTMLElement {
  const section = container?.querySelector<HTMLElement>('[data-testid="briefs-inbox"]');
  if (!section) throw new Error("Delivered section not mounted");
  return section;
}

function retry(): HTMLButtonElement {
  const button = delivered().querySelector("button");
  if (!button) throw new Error("Delivery Retry not available");
  return button;
}

async function clickRetry() {
  await act(async () => { retry().dispatchEvent(new MouseEvent("click", { bubbles: true })); });
}

async function respond(request: Deferred<Response>, status: number, rows: PinnedDelivery[] = []) {
  await act(async () => { request.resolve(jsonRes(status, { deliveries: rows, contract: BRIEFS_EXPLICIT_LANGUAGE_CONTRACT })); });
}

async function reject(request: Deferred<Response>) {
  await act(async () => { request.reject(new Error("Synthetic response loss")); });
}

async function startOverlappingRetries(lang: BriefLang) {
  await mount(lang);
  await respond(requests[0], 503);
  await clickRetry();
  await clickRetry();
  expect(requests).toHaveLength(3);
  return { a: requests[1], b: requests[2] };
}

function expectRows(name: string) {
  expect(delivered().querySelector("[data-brief-name]")?.textContent).toBe(name);
  expect(delivered().querySelectorAll("[data-brief-row]")).toHaveLength(1);
  expect(delivered().querySelector("[data-briefs-state]")).toBeNull();
  expect(delivered().querySelector("button")).toBeNull();
  expect(delivered().querySelector("[data-brief-language-availability]")).not.toBeNull();
  expect(delivered().getAttribute("aria-busy")).toBe("false");
}

function expectFailure(lang: BriefLang) {
  expect(delivered().textContent).toContain(briefCopy("unavailable", lang));
  expect(delivered().querySelector("[data-brief-row]")).toBeNull();
  expect(delivered().querySelector("[data-briefs-state]")).toBeNull();
  expect(retry().textContent).toBe(briefCopy("retry", lang));
  expect(delivered().getAttribute("aria-busy")).toBe("false");
}

describe.each(["en", "zh"] as const)("Briefs delivery request ownership (%s)", (lang) => {
  beforeEach(() => { container = null; root = null; installFetch(); });
  afterEach(() => {
    unmount();
    expect(calls.every((call) => call.method === "GET")).toBe(true);
    expect(calls.every((call) => [
      `/api/briefs/deliveries?limit=40&contract=${BRIEFS_EXPLICIT_LANGUAGE_CONTRACT}`, "/api/briefs/subscriptions", "/api/watchlist", "/api/theses",
    ].includes(call.url))).toBe(true);
    vi.unstubAllGlobals();
  });

  it.each(["reject", "503", "401", "older rows", "empty"] as const)(
    "keeps recovered B when older retry A completes with %s",
    async (outcome) => {
      const { a, b } = await startOverlappingRetries(lang);
      await respond(b, 200, [delivery("New B")]);
      expectRows("New B");
      if (outcome === "reject") await reject(a);
      else await respond(a, outcome === "older rows" || outcome === "empty" ? 200 : Number(outcome), outcome === "empty" ? [] : [delivery("Old A")]);
      expectRows("New B");
    },
  );

  it("keeps B's actionable failure when older A succeeds afterward", async () => {
    const { a, b } = await startOverlappingRetries(lang);
    await respond(b, 503);
    await respond(a, 200, [delivery("Old A")]);
    expectFailure(lang);
  });

  it.each(["resolve", "reject"] as const)(
    "ignores A JSON that %ss only after B has recovered",
    async (outcome) => {
      await mount(lang);
      await respond(requests[0], 503);
      await clickRetry();
      const body = deferred<{ deliveries: PinnedDelivery[] }>();
      const response = jsonRes(200, {});
      const parse = vi.spyOn(response, "json").mockImplementation(() => body.promise);
      await act(async () => { requests[1].resolve(response); });
      expect(parse).toHaveBeenCalledTimes(1); // A has passed fetch and is inside JSON.
      await clickRetry();
      await respond(requests[2], 200, [delivery("New B")]);
      await act(async () => {
        if (outcome === "resolve") body.resolve({ deliveries: [delivery("Old A")] });
        else body.reject(new Error("Synthetic late JSON failure"));
      });
      expectRows("New B");
    },
  );

  it("does not let stale completion clear B's retrying state", async () => {
    const { a, b } = await startOverlappingRetries(lang);
    expect(delivered().getAttribute("aria-busy")).toBe("true");
    expect(retry().textContent).toBe(briefCopy("retrying", lang));
    await reject(a);
    expect(delivered().getAttribute("aria-busy")).toBe("true");
    expect(retry().textContent).toBe(briefCopy("retrying", lang));
    await respond(b, 200, [delivery("New B")]);
    expectRows("New B");
  });

  it("preserves a legitimate current empty result against older rows", async () => {
    const { a, b } = await startOverlappingRetries(lang);
    await respond(b, 200);
    await respond(a, 200, [delivery("Old A")]);
    expect(delivered().querySelector('[data-briefs-state="empty"]')?.textContent)
      .toBe(briefCopy("empty", lang));
    expect(delivered().querySelector("[data-brief-row]")).toBeNull();
    expect(delivered().querySelector("button")).toBeNull();
    expect(delivered().getAttribute("aria-busy")).toBe("false");
  });

  it("keeps current 401 unavailable, then recovers on an explicit GET", async () => {
    await mount(lang);
    await respond(requests[0], 401);
    expectFailure(lang);
    const nonDeliveryCalls = calls.filter((call) => !call.url.includes("/deliveries"));
    await clickRetry();
    await respond(requests[1], 200, [delivery("Recovered")]);
    expectRows("Recovered");
    expect(calls.filter((call) => !call.url.includes("/deliveries"))).toEqual(nonDeliveryCalls);
  });

  it("settles current JSON failure as actionable rather than leaving retrying stuck", async () => {
    await mount(lang);
    const response = jsonRes(200, {});
    vi.spyOn(response, "json").mockRejectedValue(new Error("Synthetic malformed JSON"));
    await act(async () => { requests[0].resolve(response); });
    expectFailure(lang);
  });

  it("accepts the live StrictMode setup and ignores its cleaned-up predecessor", async () => {
    await mount(lang, true);
    expect(requests).toHaveLength(2);
    await respond(requests[1], 200, [delivery("Live setup")]);
    expectRows("Live setup");
    await reject(requests[0]);
    expectRows("Live setup");
  });

  it("does not parse an old fetch response after unmount and remount", async () => {
    await mount(lang);
    const old = requests[0];
    unmount();
    await mount(lang);
    await respond(requests[1], 200, [delivery("Remounted")]);
    const response = jsonRes(200, { deliveries: [delivery("Unmounted")] });
    const parse = vi.spyOn(response, "json");
    await act(async () => { old.resolve(response); });
    expect(parse).not.toHaveBeenCalled();
    expectRows("Remounted");
  });

  it("ignores a JSON failure after unmount while a new inbox is mounted", async () => {
    await mount(lang);
    const body = deferred<unknown>();
    const response = jsonRes(200, {});
    const parse = vi.spyOn(response, "json").mockImplementation(() => body.promise);
    await act(async () => { requests[0].resolve(response); });
    expect(parse).toHaveBeenCalledTimes(1);
    unmount();
    await mount(lang);
    await respond(requests[1], 200, [delivery("Remounted")]);
    await act(async () => { body.reject(new Error("Unmounted parse")); });
    expectRows("Remounted");
  });

  it.each(["resolve", "reject"] as const)("ignores a retired 409 JSON %s after a newer partial body arrives", async (outcome) => {
    await mount(lang); await respond(requests[0], 503); await clickRetry();
    const body = deferred<unknown>(), response = jsonRes(409, {});
    const parse = vi.spyOn(response, "json").mockImplementation(() => body.promise);
    await act(async () => { requests[1].resolve(response); });
    expect(parse).toHaveBeenCalledTimes(1);
    await clickRetry(); await respond(requests[2], 200, [delivery("Current partial")]);
    await act(async () => {
      if (outcome === "resolve") body.resolve({ error: "UPGRADE_REQUIRED", requiredContract: BRIEFS_EXPLICIT_LANGUAGE_CONTRACT, reloadRequired: true });
      else body.reject(new Error("Retired upgrade JSON"));
    });
    expectRows("Current partial");
  });

  it("keeps a current typed-upgrade action when an older successful JSON body settles", async () => {
    await mount(lang); await respond(requests[0], 503); await clickRetry();
    const body = deferred<unknown>(), response = jsonRes(200, {});
    vi.spyOn(response, "json").mockImplementation(() => body.promise);
    await act(async () => { requests[1].resolve(response); });
    await clickRetry();
    await act(async () => { requests[2].resolve(jsonRes(409, {
      error: "UPGRADE_REQUIRED", requiredContract: BRIEFS_EXPLICIT_LANGUAGE_CONTRACT, reloadRequired: true,
    })); });
    await act(async () => { body.resolve({ deliveries: [delivery("Old partial")], contract: BRIEFS_EXPLICIT_LANGUAGE_CONTRACT }); });
    expect(delivered().textContent).toContain(briefCopy("upgradeRequired", lang));
    expect(retry().textContent).toBe(briefCopy("refresh", lang));
    expect(delivered().querySelector("[data-brief-row]")).toBeNull();
    expect(delivered().getAttribute("aria-busy")).toBe("false");
  });

  it("ignores an upgrade JSON response after its inbox unmounts", async () => {
    await mount(lang);
    const body = deferred<unknown>(), response = jsonRes(409, {});
    vi.spyOn(response, "json").mockImplementation(() => body.promise);
    await act(async () => { requests[0].resolve(response); });
    unmount(); await mount(lang); await respond(requests[1], 200, [delivery("Remounted partial")]);
    await act(async () => { body.resolve({ error: "UPGRADE_REQUIRED", requiredContract: BRIEFS_EXPLICIT_LANGUAGE_CONTRACT, reloadRequired: true }); });
    expectRows("Remounted partial");
  });
});
