// @vitest-environment jsdom
//
// Review MINOR (PR #548 round 2): View list never re-read. An empty `symbols`
// array was treated as `shrNoLongerShared`, so a still-shared empty watchlist
// showed “This list is no longer shared with you.” Spec §2.5 wants a follow-up
// read: 404 / missing from sharedWithMe means the share ended; a still-present
// row (even with zero symbols) must expand, not claim the share ended.
//
// Mounts the real SectionSharing component (no test double). No
// @testing-library/react in this repo — react-dom/client createRoot + act,
// written as .ts so vitest.config.ts's include glob picks it up.
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import React from "react";
import SectionSharing from "@/components/settings/SectionSharing";
import { LEX } from "@/lib/i18n";
import type { SectionProps } from "@/components/settings/types";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LIST_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NO_LONGER = "This list is no longer shared with you.";

type Received = {
  id: string;
  name: string;
  sharedBy: string;
  symbols: { symbol: string; section: string; position: number }[];
};

function jsonRes(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function makeT(lang: "en" | "zh") {
  return (key: string, fallback?: string) => {
    const e = LEX[key];
    return e ? e[lang === "zh" ? 1 : 0] : (fallback ?? key);
  };
}

function baseProps(lang: "en" | "zh"): SectionProps {
  return {
    t: makeT(lang),
    lang,
    identity: { kind: "guest" },
    email: "a@example.com",
    user: null,
    onClose: () => {},
    onPatchMeta: () => {},
    onRefreshUser: async () => {},
  };
}

function emptyShared(): Received {
  return {
    id: LIST_ID,
    name: "Copper Names",
    sharedBy: "11111111-1111-4111-8111-111111111111",
    symbols: [],
  };
}

function populatedShared(): Received {
  return {
    ...emptyShared(),
    symbols: [
      { symbol: "FCX", section: "Miners", position: 0 },
      { symbol: "SCCO", section: "Miners", position: 1 },
    ],
  };
}

describe("SectionSharing View list re-reads before claiming a share has ended", () => {
  let container: HTMLDivElement;
  let root: Root | undefined;
  let fetchSpy: ReturnType<typeof vi.fn>;
  let watchlistBodies: unknown[];

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    watchlistBodies = [];
    fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/grants")) {
        return jsonRes(200, { shared: [], sharedWithMe: [] });
      }
      if (url.includes("/api/watchlist")) {
        const body = watchlistBodies.length > 1
          ? watchlistBodies.shift()
          : (watchlistBodies[0] ?? { lists: [], sharedWithMe: [] });
        return jsonRes(200, body);
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    (globalThis as unknown as { fetch: unknown }).fetch = fetchSpy;
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = undefined;
    container.remove();
  });

  async function mountAndWaitForView() {
    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(SectionSharing, baseProps("en")));
    });
    await vi.waitFor(() => {
      const btn = Array.from(container.querySelectorAll("button")).find(
        (el) => el.getAttribute("aria-label") === "View list",
      );
      expect(btn).toBeTruthy();
    });
  }

  function viewButton(): HTMLButtonElement {
    const btn = Array.from(container.querySelectorAll("button")).find(
      (el) => el.getAttribute("aria-label") === "View list" || el.getAttribute("aria-label") === "Hide list",
    );
    if (!btn) throw new Error("View list / Hide list button not found");
    return btn as HTMLButtonElement;
  }

  function watchlistGets(): number {
    return fetchSpy.mock.calls.filter((call) => String(call[0]).includes("/api/watchlist")).length;
  }

  it("a still-shared empty list does not claim the share has ended", async () => {
    watchlistBodies = [{ lists: [], sharedWithMe: [emptyShared()] }];
    await mountAndWaitForView();
    const before = watchlistGets();
    await act(async () => {
      viewButton().click();
    });
    await vi.waitFor(() => {
      expect(watchlistGets()).toBeGreaterThan(before);
    });
    expect(container.textContent).not.toContain(NO_LONGER);
    expect(viewButton().getAttribute("aria-label")).toBe("Hide list");
  });

  it("View list re-reads and shows the share-ended sentence when the list is gone", async () => {
    watchlistBodies = [
      { lists: [], sharedWithMe: [populatedShared()] },
      { lists: [], sharedWithMe: [] },
    ];
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/grants")) {
        return jsonRes(200, { shared: [], sharedWithMe: [] });
      }
      if (url.includes("/api/watchlist")) {
        const body = watchlistBodies.shift() ?? { lists: [], sharedWithMe: [] };
        return jsonRes(200, body);
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    await mountAndWaitForView();
    await act(async () => {
      viewButton().click();
    });
    await vi.waitFor(() => {
      expect(container.textContent).toContain(NO_LONGER);
    });
    expect(container.textContent).not.toContain("FCX");
  });

  it("View list re-reads and shows the share-ended sentence on a 404 follow-up", async () => {
    let watchlistCalls = 0;
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/grants")) {
        return jsonRes(200, { shared: [], sharedWithMe: [] });
      }
      if (url.includes("/api/watchlist")) {
        watchlistCalls += 1;
        if (watchlistCalls === 1) {
          return jsonRes(200, { lists: [], sharedWithMe: [populatedShared()] });
        }
        return jsonRes(404, { error: "not_found" });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    await mountAndWaitForView();
    await act(async () => {
      viewButton().click();
    });
    await vi.waitFor(() => {
      expect(container.textContent).toContain(NO_LONGER);
    });
  });

  it("a failed grants read shows the read-failed sentence, not the empty-share sentence", async () => {
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/grants")) {
        return jsonRes(500, { message: LEX.shrReadFailed[0], messageZh: LEX.shrReadFailed[1] });
      }
      if (url.includes("/api/watchlist")) {
        return jsonRes(200, { lists: [], sharedWithMe: [] });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(SectionSharing, baseProps("en")));
    });
    await vi.waitFor(() => {
      expect(container.textContent).toContain(LEX.shrReadFailed[0]);
    });
    expect(container.textContent).not.toContain(LEX.shrMineEmpty[0]);
    expect(container.textContent).not.toContain(LEX.shrTheirsEmpty[0]);
  });

  it("a failed View-list re-read shows the read-failed sentence and keeps the row", async () => {
    const READ_FAILED = LEX.shrReadFailed[0];
    let watchlistCalls = 0;
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/grants")) {
        return jsonRes(200, { shared: [], sharedWithMe: [] });
      }
      if (url.includes("/api/watchlist")) {
        watchlistCalls += 1;
        if (watchlistCalls === 1) {
          return jsonRes(200, { lists: [], sharedWithMe: [populatedShared()] });
        }
        return jsonRes(200, { lists: [], sharedWithMe: null, sharedWithMeState: "failed" });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    await mountAndWaitForView();
    expect(container.textContent).toContain("Copper Names");
    await act(async () => {
      viewButton().click();
    });
    await vi.waitFor(() => {
      expect(container.textContent).toContain(READ_FAILED);
    });
    expect(container.textContent).toContain("Copper Names");
    expect(container.textContent).not.toContain(NO_LONGER);
    expect(viewButton().getAttribute("aria-label")).toBe("View list");
  });

  it("View list on a still-shared empty list shows the empty-list sentence", async () => {
    watchlistBodies = [{ lists: [], sharedWithMe: [emptyShared()] }];
    await mountAndWaitForView();
    await act(async () => {
      viewButton().click();
    });
    await vi.waitFor(() => {
      expect(container.textContent).toContain("This list has no symbols yet.");
    });
    expect(container.textContent).not.toContain(NO_LONGER);
  });

  it("one symbol uses the singular word; two symbols use the plural", async () => {
    const one: Received = {
      ...emptyShared(),
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      name: "One Name",
      symbols: [{ symbol: "NEM", section: "Miners", position: 0 }],
    };
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/grants")) {
        return jsonRes(200, { shared: [], sharedWithMe: [] });
      }
      if (url.includes("/api/watchlist")) {
        return jsonRes(200, { lists: [], sharedWithMe: [one, populatedShared()] });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(SectionSharing, baseProps("en")));
    });
    await vi.waitFor(() => {
      expect(container.textContent).toContain("One Name");
      expect(container.textContent).toContain("Copper Names");
    });
    expect(container.textContent).toContain("1 symbol");
    expect(container.textContent).toContain("2 symbols");
    expect(container.textContent).not.toContain("1 symbols");
  });

  it("ZH shared-row copy addresses the customer as 你, not 您", () => {
    const shrKeys = Object.keys(LEX).filter((k) => k.startsWith("shr"));
    expect(shrKeys.length).toBeGreaterThan(10);
    for (const key of shrKeys) {
      const zh = LEX[key][1];
      expect(zh, key).not.toContain("您");
    }
    expect(LEX.shrYouShared[0]).toBe("You shared this list.");
    expect(LEX.shrYouShared[1]).toBe("你已共享此清单。");
    const emptyList = (LEX as Record<string, [string, string] | undefined>).shrListEmpty;
    expect(emptyList?.[0]).toBe("This list has no symbols yet.");
    expect(emptyList?.[1]).toBe("这个清单还没有标的。");
  });
});
