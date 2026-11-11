// @vitest-environment jsdom
//
// only a successful re-read whose sharedWithMe lacks the row means the share
// ended; any non-2xx answer is a failed read, rendered as shrReadFailed with
// the row kept (seat ruling R2, reaffirmed round 3).
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
const OWNER_LIST = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const GRANTEE = "22222222-2222-4222-8222-222222222222";
const NO_LONGER = "This list is no longer shared with you.";
const READ_FAILED = "We could not read your shared lists just now.";
const YOU_SHARED = "You shared this list.";
const ALREADY_SHARED = "This list is already shared with that account.";
const ALREADY_SHARED_ZH = "此清单已共享给该账户。";
const NO_OWN_LISTS = "You have no lists to share yet.";
const EMPTY_LIST = "This list has no symbols yet.";

type SharedGrantRow = {
  id: string;
  resourceId: string;
  resourceName: string;
  granteeUserId: string;
  createdAt: string | null;
  revokedAt: null;
};

function ownerGrant(): SharedGrantRow {
  return {
    id: "grant-owner-1",
    resourceId: OWNER_LIST,
    resourceName: "Copper Names",
    granteeUserId: GRANTEE,
    createdAt: "2026-09-10T00:00:00Z",
    revokedAt: null,
  };
}

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

  it("a 404 on the View-list re-read is a failed read: the read-failed sentence shows and the row keeps its control", async () => {
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
      expect(container.textContent).toContain(READ_FAILED);
    });
    expect(container.textContent).not.toContain(NO_LONGER);
    expect(viewButton().getAttribute("aria-label")).toBe("View list");
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
      expect(container.textContent).toContain(EMPTY_LIST);
    });
    const text = container.textContent ?? "";
    expect(text.split(EMPTY_LIST).length - 1).toBe(1);
    expect(text).not.toContain("0 symbols");
    expect(text).not.toContain("0 个标的");
    expect(text).not.toContain(NO_LONGER);
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
    expect(LEX.shrSharedWithAccount[0]).toBe("Shared with the account ending {n}.");
    expect(LEX.shrSharedWithAccount[1]).toBe("已共享给账户尾号{n}。");
    expect(LEX.shrNoOwnLists[0]).toBe("You have no lists to share yet.");
    expect(LEX.shrNoOwnLists[1]).toBe("你还没有可以共享的清单。");
    const emptyList = (LEX as Record<string, [string, string] | undefined>).shrListEmpty;
    expect(emptyList?.[0]).toBe("This list has no symbols yet.");
    expect(emptyList?.[1]).toBe("这个清单还没有标的。");
    // Every shr* ZH string whose EN ends a sentence ends with 。！？
    for (const key of shrKeys) {
      const [en, zh] = LEX[key];
      if (/[.!?]$/.test(en.trim())) {
        expect(zh, key).toMatch(/[。！？]$/);
      }
    }
    // No ASCII space with a CJK character or CJK punctuation on both sides.
    // Latin-adjoining forms ("账户 ID", "用户 ID") stay. Exact regex:
    // /[\u4e00-\u9fff\u3002\uff01\uff1f] [\u4e00-\u9fff\u3002\uff01\uff1f]/
    const cjkSpaceCjk = /[\u4e00-\u9fff\u3002\uff01\uff1f] [\u4e00-\u9fff\u3002\uff01\uff1f]/;
    for (const key of shrKeys) {
      expect(LEX[key][1], key).not.toMatch(cjkSpaceCjk);
    }
  });

  it("a 201 share keeps You shared this list. on .acs-msg after the reload settles", async () => {
    const grant = ownerGrant();
    let grantsGets = 0;
    fetchSpy.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = String(init?.method || "GET").toUpperCase();
      if (url.includes("/api/grants") && method === "POST") {
        return jsonRes(201, { grant });
      }
      if (url.includes("/api/grants")) {
        grantsGets += 1;
        return jsonRes(200, {
          shared: grantsGets >= 2 ? [grant] : [],
          sharedWithMe: [],
        });
      }
      if (url.includes("/api/watchlist")) {
        return jsonRes(200, {
          lists: [{ id: OWNER_LIST, name: "Copper Names" }],
          sharedWithMe: [],
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(SectionSharing, baseProps("en")));
    });
    await vi.waitFor(() => {
      expect(container.querySelector("#shr-pick-list")).toBeTruthy();
    });
    await fillAndShare(OWNER_LIST, GRANTEE);
    await vi.waitFor(() => {
      expect(grantsGets).toBeGreaterThanOrEqual(2);
    });
    await vi.waitFor(() => {
      const msg = container.querySelector(".acs-msg");
      expect(msg?.textContent).toBe(YOU_SHARED);
    });
    expect(container.textContent).toContain("Copper Names");
  });

  it("a 200 already-shared share keeps the already-shared sentence on .acs-msg after the reload settles", async () => {
    const grant = ownerGrant();
    async function mountShare(lang: "en" | "zh") {
      let grantsGets = 0;
      fetchSpy.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = String(init?.method || "GET").toUpperCase();
        if (url.includes("/api/grants") && method === "POST") {
          return jsonRes(200, {
            grant,
            message: ALREADY_SHARED,
            messageZh: ALREADY_SHARED_ZH,
          });
        }
        if (url.includes("/api/grants")) {
          grantsGets += 1;
          return jsonRes(200, { shared: [grant], sharedWithMe: [] });
        }
        if (url.includes("/api/watchlist")) {
          return jsonRes(200, {
            lists: [{ id: OWNER_LIST, name: "Copper Names" }],
            sharedWithMe: [],
          });
        }
        throw new Error(`unexpected fetch ${url}`);
      });
      await act(async () => {
        root?.unmount();
        root = createRoot(container);
        root.render(React.createElement(SectionSharing, baseProps(lang)));
      });
      await vi.waitFor(() => {
        expect(container.querySelector("#shr-pick-list")).toBeTruthy();
      });
      await fillAndShare(OWNER_LIST, GRANTEE);
      await vi.waitFor(() => {
        expect(grantsGets).toBeGreaterThanOrEqual(2);
      });
      const expected = lang === "zh" ? ALREADY_SHARED_ZH : ALREADY_SHARED;
      await vi.waitFor(() => {
        const msg = container.querySelector(".acs-msg");
        expect(msg?.textContent).toBe(expected);
      });
    }
    await mountShare("en");
    await mountShare("zh");
  });

  it("a grants 200 body without shared is a failed read, not the empty-share sentence", async () => {
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/grants")) {
        return jsonRes(200, {});
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
      expect(container.textContent).toContain(READ_FAILED);
    });
    expect(container.textContent).not.toContain("You have not shared a list with anyone yet.");
  });

  it("a watchlist 200 body without lists is a failed read", async () => {
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/grants")) {
        return jsonRes(200, { shared: [], sharedWithMe: [] });
      }
      if (url.includes("/api/watchlist")) {
        return jsonRes(200, { sharedWithMe: [] });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(SectionSharing, baseProps("en")));
    });
    await vi.waitFor(() => {
      expect(container.textContent).toContain(READ_FAILED);
    });
  });

  it("a true empty own-lists array replaces the share form with the no-lists sentence", async () => {
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/grants")) {
        return jsonRes(200, { shared: [], sharedWithMe: [] });
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
      expect(container.textContent).toContain(NO_OWN_LISTS);
    });
    expect(container.querySelector("#shr-pick-list")).toBeNull();
  });

  it("the owner row composes two sentences with no language-keyed punctuation literal", async () => {
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/grants")) {
        return jsonRes(200, { shared: [ownerGrant()], sharedWithMe: [] });
      }
      if (url.includes("/api/watchlist")) {
        return jsonRes(200, { lists: [{ id: OWNER_LIST, name: "Copper Names" }], sharedWithMe: [] });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(SectionSharing, baseProps("en")));
    });
    await vi.waitFor(() => {
      expect(container.querySelector(".acs-row-desc")).toBeTruthy();
    });
    const enDesc = Array.from(container.querySelectorAll(".acs-row-desc")).find(
      (el) => (el.textContent ?? "").includes("Shared with the account ending"),
    );
    expect(enDesc?.textContent).toBe("You shared this list. Shared with the account ending 2222.");
    await act(async () => {
      root?.unmount();
      root = createRoot(container);
      root.render(React.createElement(SectionSharing, baseProps("zh")));
    });
    await vi.waitFor(() => {
      const zhDesc = Array.from(container.querySelectorAll(".acs-row-desc")).find(
        (el) => (el.textContent ?? "").includes("已共享给账户尾号"),
      );
      expect(zhDesc).toBeTruthy();
    });
    const zhDesc = Array.from(container.querySelectorAll(".acs-row-desc")).find(
      (el) => (el.textContent ?? "").includes("已共享给账户尾号"),
    );
    expect(zhDesc?.textContent).toBe("你已共享此清单。已共享给账户尾号2222。");
    expect(zhDesc?.textContent).toMatch(/^[^ ]*$/);
  });
});

async function fillAndShare(listId: string, account: string) {
  const select = document.querySelector("#shr-pick-list") as HTMLSelectElement | null;
  const input = document.querySelector("#shr-account") as HTMLInputElement | null;
  const btn = Array.from(document.querySelectorAll("button")).find(
    (el) => el.getAttribute("aria-label") === "Share, read only" || el.getAttribute("aria-label") === "共享（仅可查看）",
  ) as HTMLButtonElement | undefined;
  if (!select || !input || !btn) {
    throw new Error("share form controls not found");
  }
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
    setter.call(select, listId);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, account);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    btn.click();
  });
}
