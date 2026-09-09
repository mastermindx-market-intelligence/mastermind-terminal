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
});
