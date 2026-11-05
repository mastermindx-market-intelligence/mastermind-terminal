import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DbResult, WatchlistDb, WatchlistQuery } from "@/lib/watchlists";

// The route is exercised against the same in-memory transport the Playwright dev server uses, so
// these assertions are about RESULTING STATE (what the owner's lists actually contain afterwards)
// rather than the shape of the query calls. `H.failTable` injects a write failure so the 500 path
// stays covered.
const H = vi.hoisted(() => ({
  user: { id: "e2e-user-route" } as { id: string } | null,
  failTable: null as string | null,
  failReadTable: null as string | null,
  readFailure: "error" as "error" | "null" | "throw",
}));

vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }));

vi.mock("@/lib/supabase/server", async () => {
  const { createFixtureDb } = await import("@/lib/watchlistsFixtureDb");
  return {
    createClient: vi.fn(async () => {
      const db: WatchlistDb = createFixtureDb("route");
      const failing: DbResult = { data: null, error: { message: "database unavailable" } };
      const failedQuery = (): WatchlistQuery => {
        const query = Object.assign(Promise.resolve(failing), {
          select: () => failedQuery(),
          eq: () => failedQuery(),
          in: () => failedQuery(),
          order: () => failedQuery(),
          limit: () => failedQuery(),
          insert: () => failedQuery(),
          update: () => failedQuery(),
          delete: () => failedQuery(),
          maybeSingle: async () => failing,
        });
        return query as unknown as WatchlistQuery;
      };
      return {
        auth: { getUser: vi.fn(async () => ({ data: { user: H.user } })) },
        from: (table: string) => {
          if (H.failReadTable === table) {
            if (H.readFailure === "throw") throw new Error("transport failed");
            if (H.readFailure === "error") return failedQuery();
            const empty = Object.assign(Promise.resolve({ data: null, error: null }), {
              select: () => empty, eq: () => empty, in: () => empty, order: () => empty,
            });
            return empty;
          }
          const query = db.from(table);
          if (H.failTable !== table) return query;
          // Reads still work; only the mutating verbs fail, the way a policy or constraint error
          // surfaces in production.
          return new Proxy(query, {
            get(target, prop, receiver) {
              if (prop === "insert" || prop === "update" || prop === "delete") return () => failedQuery();
              const value = Reflect.get(target, prop, receiver);
              return typeof value === "function" ? value.bind(target) : value;
            },
          });
        },
      };
    }),
  };
});

import { GET, POST } from "@/app/api/watchlist/route";
import { listWatchlists } from "@/lib/watchlists";
import { createFixtureDb, fixtureUserId, resetFixtureStores } from "@/lib/watchlistsFixtureDb";

const post = (body: Record<string, unknown>) => POST(new Request("https://x.test/api/watchlist", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
}));

const owner = fixtureUserId("route");
const state = () => listWatchlists(createFixtureDb("route"), owner);
const symbolsOf = async (name: string) =>
  (await state()).find((list) => list.name === name)?.symbols.map((row) => row.symbol) ?? null;

beforeEach(() => {
  resetFixtureStores();
  H.user = { id: owner };
  H.failTable = null;
  H.failReadTable = null;
  H.readFailure = "error";
  vi.clearAllMocks();
});

describe("GET /api/watchlist — authoritative inventory", () => {
  it.each(["watchlists", "watchlist_symbols"])("returns unavailable when %s fails, never partial or empty success", async (table) => {
    H.failReadTable = table;
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "watchlists unavailable" });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it.each(["null", "throw"] as const)("rejects a %s read result rather than inventing an empty inventory", async (failure) => {
    H.failReadTable = "watchlists";
    H.readFailure = failure;
    expect((await GET()).status).toBe(503);
  });

  it("keeps successful empty ownership separate from unavailable", async () => {
    H.user = { id: "another-subject-with-no-owned-lists" };
    const response = await GET();
    expect(response.status).toBe(200);
    expect((await response.json()).lists).toEqual([]);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
});

describe("POST /api/watchlist — symbol actions", () => {
  it("removes an authenticated batch with normalized, de-duplicated symbols", async () => {
    const response = await post({ action: "remove", symbols: [" nvda ", "AAPL", "NVDA"] });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(await symbolsOf("Default")).toEqual(["BTC-USD", "ETH-USD", "MSFT", "QQQ"]);
  });

  it("moves a symbol batch by updating its section", async () => {
    await post({ action: "add", symbols: ["9988.HK", "002716.SZ"], section: "Equities" });
    const response = await post({
      action: "move",
      symbols: ["9988.hk", "002716.sz"],
      section: " China Bottoms ",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    const moved = (await state())[0].symbols.filter((row) => row.section === "China Bottoms");
    expect(moved.map((row) => row.symbol)).toEqual(["9988.HK", "002716.SZ"]);
  });

  // From master #409 ("Make watchlist sections fluid"): the empty string is a REAL section — the
  // unsectioned run before the first divider — so it must round-trip rather than 400.
  it("moves symbols into the unsectioned root run", async () => {
    const response = await post({ action: "move", symbols: ["AAPL"], section: "" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect((await state())[0].symbols.find((row) => row.symbol === "AAPL")?.section).toBe("");
  });

  it("adds into the unsectioned root run without falling back to the legacy label", async () => {
    await post({ action: "add", symbols: ["NEM"], section: "" });
    expect((await state())[0].symbols.at(-1)).toEqual({ symbol: "NEM", section: "", position: 6 });
    // A MISSING section still takes the legacy "Watchlist" fallback — only an explicit "" is root.
    await post({ action: "add", symbols: ["AEM"] });
    expect((await state())[0].symbols.at(-1)).toEqual({ symbol: "AEM", section: "Watchlist", position: 7 });
  });

  it("keeps the legacy single-symbol add contract", async () => {
    const response = await post({ action: "add", symbol: " nem ", section: "Miners" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, added: ["NEM"] });
    expect((await state())[0].symbols.at(-1)).toEqual({ symbol: "NEM", section: "Miners", position: 6 });
  });

  it("W1b: accepts a BATCHED add, dedupes it, and can carry a section per symbol", async () => {
    const response = await post({
      action: "add",
      symbols: ["NEM", "AEM", "NEM", "AAPL"],   // AAPL is already seeded on Default
      section: "Miners",
      sections: { AEM: "Metals" },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, added: ["NEM", "AEM"] });
    expect((await state())[0].symbols.slice(-2)).toEqual([
      { symbol: "NEM", section: "Miners", position: 6 },
      { symbol: "AEM", section: "Metals", position: 7 },
    ]);

    // Re-sending the same batch is a successful no-op — this is what makes the shell's one-time
    // migration safe to retry.
    const again = await post({ action: "add", symbols: ["NEM", "AEM"], section: "Miners" });
    expect(await again.json()).toEqual({ ok: true, added: [] });
    expect((await state())[0].symbols).toHaveLength(8);
  });

  it("W1b: targets a LIST instead of always writing to the first one", async () => {
    const created = await (await post({ action: "createList", name: "Gold Miners" })).json();
    await post({ action: "add", listId: created.list.id, symbols: ["NEM", "AEM"], section: "Miners" });

    expect(await symbolsOf("Gold Miners")).toEqual(["NEM", "AEM"]);
    expect(await symbolsOf("Default")).toEqual(["BTC-USD", "ETH-USD", "NVDA", "AAPL", "MSFT", "QQQ"]);

    // ...by exact name too, and a remove on one list never reaches its sibling.
    await post({ action: "remove", listName: "Gold Miners", symbols: ["NEM"] });
    expect(await symbolsOf("Gold Miners")).toEqual(["AEM"]);
    expect(await symbolsOf("Default")).toContain("NVDA");

    // A list the caller does not own writes nothing at all.
    const foreign = await post({ action: "remove", listId: "not-mine", symbols: ["NVDA"] });
    expect(foreign.status).toBe(400);
    expect(await foreign.json()).toEqual({ error: "no watchlist" });
    expect(await symbolsOf("Default")).toContain("NVDA");
  });

  it("rejects malformed JSON and invalid batch input before writing", async () => {
    const malformed = await POST(new Request("https://x.test/api/watchlist", {
      method: "POST",
      body: "{not-json",
    }));
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: "invalid JSON" });

    // Rejected for the CONTROL CHARACTER, not for being short — "" is legal (see above).
    const invalidSection = await post({ action: "move", symbols: ["AAPL"], section: "\u0000bad" });
    expect(invalidSection.status).toBe(400);
    expect(await invalidSection.json()).toEqual({ error: "invalid section" });
    expect((await state())[0].symbols.find((row) => row.symbol === "AAPL")?.section).toBe("Equities");
  });

  it("rejects unsupported actions and oversized batches instead of partially mutating", async () => {
    const unsupported = await post({ action: "archive", symbol: "AAPL" });
    expect(unsupported.status).toBe(400);
    expect(await unsupported.json()).toEqual({ error: "unsupported action" });

    const oversized = await post({ action: "remove", symbols: Array.from({ length: 501 }, (_, i) => `SYM${i}`) });
    expect(oversized.status).toBe(400);
    expect(await oversized.json()).toEqual({ error: "symbol required or batch too large" });
    expect(await symbolsOf("Default")).toHaveLength(6);
  });

  it("returns authentication and mutation failures", async () => {
    H.user = null;
    expect((await post({ action: "remove", symbol: "AAPL" })).status).toBe(401);
    expect((await GET()).status).toBe(401);

    H.user = { id: owner };
    H.failTable = "watchlist_symbols";
    const failed = await post({ action: "move", symbol: "AAPL", section: "Core" });
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: "watchlist update failed" });
  });
});

describe("POST /api/watchlist — list CRUD (new in W1b)", () => {
  it("creates a list idempotently and reports it through GET", async () => {
    const first = await post({ action: "createList", name: " Gold Miners " });
    expect(first.status).toBe(200);
    const created = await first.json();
    expect(created.list.name).toBe("Gold Miners");

    const again = await post({ action: "createList", name: "Gold Miners" });
    expect((await again.json()).list.id).toBe(created.list.id);

    const inventory = await (await GET()).json();
    expect(inventory.lists.map((list: { name: string }) => list.name)).toEqual(["Default", "Gold Miners"]);
    expect(inventory.lists[1]).toMatchObject({ id: created.list.id, position: 1, symbols: [] });
  });

  it("renames a list, refuses a clash, and 404s an unowned id", async () => {
    const { list } = await (await post({ action: "createList", name: "Swing" })).json();
    expect((await post({ action: "renameList", listId: list.id, name: "Tactical" })).status).toBe(200);
    expect((await state()).map((row) => row.name)).toEqual(["Default", "Tactical"]);

    expect((await post({ action: "renameList", listId: list.id, name: "Default" })).status).toBe(409);
    expect((await post({ action: "renameList", listId: "not-mine", name: "X" })).status).toBe(404);
    expect((await post({ action: "renameList", listId: list.id, name: " " })).status).toBe(400);
  });

  it("deletes a list with its symbols and refuses an unowned id", async () => {
    const { list } = await (await post({ action: "createList", name: "Swing" })).json();
    await post({ action: "add", listId: list.id, symbols: ["TSLA"], section: "Tactical" });

    expect((await post({ action: "deleteList", listId: "not-mine" })).status).toBe(404);
    expect((await post({ action: "deleteList", listId: list.id })).status).toBe(200);
    expect((await state()).map((row) => row.name)).toEqual(["Default"]);
    expect(await symbolsOf("Default")).not.toContain("TSLA");
  });

  it("requires a usable listId/name for every list action", async () => {
    expect((await post({ action: "renameList", name: "X" })).status).toBe(400);
    expect((await post({ action: "deleteList" })).status).toBe(400);
    expect((await post({ action: "createList", name: "" })).status).toBe(400);
  });
});
