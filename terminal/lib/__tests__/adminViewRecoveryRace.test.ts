// @vitest-environment jsdom
//
// AdminView recovery/race contract. The server-side admin gate and API status semantics are
// covered elsewhere; these cases pin the client transitions that happen after those answers land.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import React from "react";
import { createRoot, type Root } from "react-dom/client";

import AdminView from "@/components/AdminView";
import { LangProvider } from "@/lib/i18n";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type EventRow = {
  id: number;
  created_at: string;
  symbol: string;
  query: string | null;
  source: string;
  user_id: string | null;
  anon_id: string | null;
  ip: string | null;
  ua: string | null;
};

const row = (id: number, symbol: string, source: string): EventRow => ({
  id,
  created_at: "2026-09-17T08:00:00.000Z",
  symbol,
  query: symbol,
  source,
  user_id: null,
  anon_id: `anon-${id}`,
  ip: null,
  ua: null,
});

const stats = {
  total: 2,
  today: 2,
  visitors7d: 2,
  topSymbols7d: [{ symbol: "AAPL", count: 1 }],
  perDay14d: [],
};

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("AdminView — recovery and pagination races", () => {
  let container: HTMLDivElement;
  let root: Root | undefined;
  let realFetch: typeof globalThis.fetch;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    realFetch = globalThis.fetch;
  });

  afterEach(async () => {
    await act(async () => { root?.unmount(); });
    root = undefined;
    container.remove();
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  async function mount(authorityUnavailable = false) {
    await act(async () => {
      root = createRoot(container);
      root.render(
        React.createElement(
          LangProvider,
          null,
          React.createElement(AdminView, { email: "owner@example.com", authorityUnavailable }),
        ),
      );
    });
    await flush();
  }

  async function commitSource(value: string) {
    const input = container.querySelector('input[aria-label="Source"]') as HTMLInputElement | null;
    expect(input).toBeTruthy();
    const nativeValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    expect(nativeValueSetter).toBeTruthy();
    await act(async () => {
      nativeValueSetter!.call(input, value);
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await flush();
  }

  it("clears a server authority-outage notice after a successful client re-check", async () => {
    globalThis.fetch = vi.fn(async () =>
      response({ events: [row(2, "AAPL", "search")], nextBefore: null, userMap: {}, stats }),
    ) as typeof globalThis.fetch;

    await mount(true);

    expect(container.textContent).not.toContain("Couldn't verify admin access");
    expect(container.textContent).toContain("AAPL");
  });

  it("clears the authority notice when the gate passed but the events store returned 503", async () => {
    globalThis.fetch = vi.fn(async () =>
      response({ error: "events_unavailable" }, 503),
    ) as typeof globalThis.fetch;

    await mount(true);

    expect(container.textContent).not.toContain("Couldn't verify admin access");
    expect(container.textContent).toContain("The search log could not be read");
  });

  it("keeps the authority notice when the retry still says authority_unavailable", async () => {
    globalThis.fetch = vi.fn(async () =>
      response({ error: "authority_unavailable" }, 503),
    ) as typeof globalThis.fetch;

    await mount(true);

    expect(container.textContent).toContain("Couldn't verify admin access");
  });

  it("can filter an exact source that is absent from the currently loaded page", async () => {
    let hiddenRequested = false;
    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input), "https://x.test");
      if (url.searchParams.get("source") === "archived-source") {
        hiddenRequested = true;
        return Promise.resolve(response({
          events: [row(40, "HIDDEN_SOURCE", "archived-source")],
          nextBefore: null,
          userMap: {},
          stats,
        }));
      }
      return Promise.resolve(response({
        events: [row(100, "LATEST_ONLY", "recent-source")],
        nextBefore: null,
        userMap: {},
        stats,
      }));
    }) as typeof globalThis.fetch;

    await mount();
    expect(container.textContent).toContain("LATEST_ONLY");
    expect(container.textContent).not.toContain("archived-source");

    await commitSource("archived-source");

    expect(hiddenRequested).toBe(true);
    expect(container.textContent).toContain("HIDDEN_SOURCE");
  });

  it("does not label the global stats total as the total for a filtered log", async () => {
    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input), "https://x.test");
      const filtered = url.searchParams.get("source") === "new";
      return Promise.resolve(response({
        events: [row(filtered ? 40 : 100, filtered ? "FILTERED" : "ROOT", "new")],
        nextBefore: null,
        userMap: {},
        stats: { ...stats, total: 999 },
      }));
    }) as typeof globalThis.fetch;

    await mount();

    const logHeader = () =>
      [...container.querySelectorAll(".ph")].find((el) => el.textContent?.startsWith("Log"));
    expect(logHeader()?.textContent).toContain("1 loaded · 999 total");

    await commitSource("new");

    expect(logHeader()?.textContent).toContain("1 loaded");
    expect(logHeader()?.textContent).not.toContain("999 total");
  });

  it("does not append an old Load more response after the filter changes", async () => {
    const page2 = deferred<Response>();
    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input), "https://x.test");
      if (url.searchParams.get("before") === "50") return page2.promise;
      if (url.searchParams.get("source") === "new") {
        return Promise.resolve(response({
          events: [row(40, "NEW_FILTER", "new")],
          nextBefore: null,
          userMap: {},
          stats,
        }));
      }
      return Promise.resolve(response({
        events: [row(100, "OLD_ROOT", "old"), row(90, "SOURCE_OPTION", "new")],
        nextBefore: 50,
        userMap: {},
        stats,
      }));
    }) as typeof globalThis.fetch;

    await mount();

    const more = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("Load more"));
    expect(more).toBeTruthy();
    act(() => { more!.click(); });

    await commitSource("new");
    expect(container.textContent).toContain("NEW_FILTER");

    page2.resolve(response({
      events: [row(49, "STALE_PAGE_2", "old")],
      nextBefore: null,
      userMap: {},
    }));
    await flush();

    expect(container.textContent).toContain("NEW_FILTER");
    expect(container.textContent).not.toContain("STALE_PAGE_2");
  });

  it("does not append an old Load more response after Refresh replaces page 1", async () => {
    const page2 = deferred<Response>();
    let rootReads = 0;
    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input), "https://x.test");
      if (url.searchParams.get("before") === "50") return page2.promise;
      rootReads += 1;
      if (rootReads === 1) {
        return Promise.resolve(response({
          events: [row(100, "OLD_ROOT", "old")],
          nextBefore: 50,
          userMap: {},
          stats,
        }));
      }
      return Promise.resolve(response({
        events: [row(120, "REFRESHED_ROOT", "old")],
        nextBefore: null,
        userMap: {},
        stats,
      }));
    }) as typeof globalThis.fetch;

    await mount();

    const more = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("Load more"));
    expect(more).toBeTruthy();
    act(() => { more!.click(); });

    const refresh = [...container.querySelectorAll("button")].find((b) => b.textContent === "Refresh");
    expect(refresh).toBeTruthy();
    act(() => { refresh!.click(); });
    await flush();
    expect(container.textContent).toContain("REFRESHED_ROOT");

    page2.resolve(response({
      events: [row(49, "STALE_PAGE_2", "old")],
      nextBefore: null,
      userMap: {},
    }));
    await flush();

    expect(container.textContent).toContain("REFRESHED_ROOT");
    expect(container.textContent).not.toContain("STALE_PAGE_2");
  });
});
