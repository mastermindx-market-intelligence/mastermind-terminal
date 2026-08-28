import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DbResult, WatchlistDb, WatchlistQuery } from "@/lib/watchlists";

// Same construction as `watchlistRoute.test.ts`: the route runs against the in-memory transport the
// Playwright dev server uses, so every assertion is about RESULTING STATE — what the owner's book
// actually contains afterwards — rather than the shape of the query calls. `H.failTable` injects a
// write failure so the 500 path stays covered.
//
// One store, both tables. The A-D semantic invariants are only meaningful if watchlist rows and
// positions share an account-shaped world, so `createFixtureDb` serves both here exactly as it
// does in the dev server.
const H = vi.hoisted(() => ({
  user: { id: "e2e-user-pfroute" } as { id: string } | null,
  failTable: null as string | null,
  noopPortfolioMutations: false,
}));

vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }));

vi.mock("@/lib/supabase/server", async () => {
  const { createFixtureDb } = await import("@/lib/watchlistsFixtureDb");
  return {
    createClient: vi.fn(async () => {
      const db: WatchlistDb = createFixtureDb(
        "pfroute",
        H.noopPortfolioMutations ? ["positions_mutation_noop"] : [],
      );
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

import { GET, POST } from "@/app/api/portfolio/route";
import { POST as WATCHLIST_POST } from "@/app/api/watchlist/route";
import { createPosition, listPositions, type Position } from "@/lib/portfolio";
import { listWatchlists } from "@/lib/watchlists";
import { createFixtureDb, fixtureUserId, resetFixtureStores } from "@/lib/watchlistsFixtureDb";

const post = (body: Record<string, unknown>) => POST(new Request("https://x.test/api/portfolio", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
}));
const watchlistPost = (body: Record<string, unknown>) => WATCHLIST_POST(new Request("https://x.test/api/watchlist", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
}));

const owner = fixtureUserId("pfroute");
const db = () => createFixtureDb("pfroute");
const book = () => listPositions(db(), owner);
const lists = () => listWatchlists(db(), owner);
const create = async (body: Record<string, unknown>): Promise<Position> => {
  const response = await post({ action: "create", ...body });
  expect(response.status).toBe(200);
  return (await response.json()).position as Position;
};

beforeEach(() => {
  resetFixtureStores();
  H.user = { id: owner };
  H.failTable = null;
  H.noopPortfolioMutations = false;
  vi.clearAllMocks();
});

describe("GET /api/portfolio", () => {
  it("answers the owner's whole book, open and closed, oldest first", async () => {
    const first = await create({ ticker: "NVDA", shares: 10, entryPrice: 100 });
    const second = await create({ ticker: "AAPL" });
    await post({ action: "close", id: second.id });

    const response = await GET();
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.positions.map((p: Position) => [p.ticker, p.status]))
      .toEqual([["NVDA", "open"], ["AAPL", "closed"]]);
    expect(payload.positions[0].id).toBe(first.id);
  });

  it("401s a guest and never reaches the store", async () => {
    H.user = null;
    const response = await GET();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthenticated" });
  });
});

describe("POST /api/portfolio — create", () => {
  it("creates from a ticker alone and normalizes it", async () => {
    const position = await create({ ticker: " nvda " });
    expect(position).toMatchObject({ ticker: "NVDA", shares: null, entryPrice: null, status: "open" });
    expect((await book()).map((p) => p.ticker)).toEqual(["NVDA"]);
  });

  it("stores the optional fields it was given", async () => {
    const position = await create({
      ticker: "AAPL", shares: "12.5", entryPrice: "203.40", entryDate: "2026-01-05", notes: " core ",
    });
    expect(position).toMatchObject({
      ticker: "AAPL", shares: 12.5, entryPrice: 203.4, entryDate: "2026-01-05", notes: "core",
    });
  });

  it("400s a refused field by NAME and writes nothing", async () => {
    for (const [body, error] of [
      [{ ticker: "" }, "invalid ticker"],
      [{ ticker: "NVDA", shares: "3O" }, "invalid shares"],
      [{ ticker: "NVDA", entryPrice: "abc" }, "invalid entry price"],
      [{ ticker: "NVDA", entryDate: "05/01/2026" }, "invalid entry date"],
      [{ ticker: "NVDA", notes: "x".repeat(1001) }, "invalid notes"],
    ] as [Record<string, unknown>, string][]) {
      const response = await post({ action: "create", ...body });
      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe(error);
    }
    expect(await book()).toEqual([]);
  });

  it("500s a store write failure instead of reporting success", async () => {
    H.failTable = "portfolio_positions";
    const response = await post({ action: "create", ticker: "NVDA" });
    expect(response.status).toBe(500);
    expect(await book()).toEqual([]);
  });

  it("coerces an unknown status to open rather than storing it", async () => {
    const position = await create({ ticker: "NVDA", status: "archived" });
    expect(position.status).toBe("open");
  });
});

describe("POST /api/portfolio — update / close / reopen / delete", () => {
  it("closes and reopens without touching any other field", async () => {
    const position = await create({
      ticker: "NVDA", shares: 10, entryPrice: 100, entryDate: "2026-01-05", notes: "core",
    });

    expect((await post({ action: "close", id: position.id })).status).toBe(200);
    expect((await book())[0]).toMatchObject({
      status: "closed", shares: 10, entryPrice: 100, entryDate: "2026-01-05", notes: "core",
    });

    expect((await post({ action: "reopen", id: position.id })).status).toBe(200);
    expect((await book())[0]).toMatchObject({ status: "open", shares: 10, notes: "core" });
  });

  it("patches only the keys the request carried", async () => {
    const position = await create({ ticker: "NVDA", shares: 10, entryPrice: 100, notes: "core" });
    await post({ action: "update", id: position.id, shares: 25 });
    expect((await book())[0]).toMatchObject({ shares: 25, entryPrice: 100, notes: "core" });
  });

  it("clears a field on an explicit empty string", async () => {
    const position = await create({ ticker: "NVDA", shares: 10, entryPrice: 100 });
    await post({ action: "update", id: position.id, entryPrice: "" });
    expect((await book())[0]).toMatchObject({ shares: 10, entryPrice: null });
  });

  it("deletes the named position and leaves the rest", async () => {
    const keep = await create({ ticker: "AAPL" });
    const drop = await create({ ticker: "NVDA" });
    expect((await post({ action: "delete", id: drop.id })).status).toBe(200);
    expect((await book()).map((p) => p.id)).toEqual([keep.id]);
  });

  it("returns an explicit non-2xx invariant error for success-shaped zero-effect mutations", async () => {
    const position = await create({
      ticker: "NVDA", shares: 10, entryPrice: 100, entryDate: "2026-01-05", notes: "core",
    });
    const original = await book();
    H.noopPortfolioMutations = true;

    for (const body of [
      { action: "update", id: position.id, shares: 25 },
      { action: "close", id: position.id },
      { action: "delete", id: position.id },
    ]) {
      const response = await post(body);
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "position mutation not confirmed" });
      expect(await book()).toEqual(original);
    }

    H.noopPortfolioMutations = false;
    expect((await post({ action: "close", id: position.id })).status).toBe(200);
    const closed = await book();
    H.noopPortfolioMutations = true;
    const reopen = await post({ action: "reopen", id: position.id });
    expect(reopen.status).toBe(500);
    expect(await reopen.json()).toEqual({ error: "position mutation not confirmed" });
    expect(await book()).toEqual(closed);
  });

  it("400s a request that names no position, and 404s one that names an unknown position", async () => {
    await create({ ticker: "NVDA" });
    for (const action of ["update", "close", "reopen", "delete"]) {
      const missing = await post({ action });
      expect(missing.status).toBe(400);
      expect((await missing.json()).error).toBe("id required");

      const unknown = await post({ action, id: "does-not-exist" });
      expect(unknown.status).toBe(404);
    }
    // A destructive action that resolved nothing must never fall back to "their first position" —
    // the portfolio-side form of the first-list soloism W1b retired.
    expect((await book()).map((p) => p.ticker)).toEqual(["NVDA"]);
  });

  it("400s an unsupported action", async () => {
    const response = await post({ action: "liquidate", id: "x" });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("unsupported action");
  });

  it("400s a body that is not JSON", async () => {
    const response = await POST(new Request("https://x.test/api/portfolio", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    }));
    expect(response.status).toBe(400);
  });
});

describe("owner scoping — cross-user negatives", () => {
  it("never lets one account read, patch or delete another account's position", async () => {
    // A position that genuinely exists, owned by somebody else, in the same store.
    const stranger = fixtureUserId("pfroute-stranger");
    const theirs = await createPosition(db(), stranger, { ticker: "TSLA", shares: 99 });
    const theirId = theirs.position!.id;
    await create({ ticker: "NVDA", shares: 1 });

    // GET is owner-scoped: their row is not in the response at all.
    const listed = await (await GET()).json();
    expect(listed.positions.map((p: Position) => p.ticker)).toEqual(["NVDA"]);

    for (const action of ["update", "close", "reopen", "delete"]) {
      const response = await post({ action, id: theirId, shares: 1 });
      expect(response.status).toBe(404);
      expect((await response.json()).error).toBe("position not found");
    }

    // …and the stranger's row survives every attempt, unmodified.
    expect((await listPositions(db(), stranger))[0]).toMatchObject({ ticker: "TSLA", shares: 99, status: "open" });
  });

  it("ignores a user_id supplied in the request body", async () => {
    const stranger = fixtureUserId("pfroute-stranger");
    await post({ action: "create", ticker: "NVDA", user_id: stranger });
    expect(await listPositions(db(), stranger)).toEqual([]);
    expect((await book()).map((p) => p.ticker)).toEqual(["NVDA"]);
  });

  it("401s every mutating action for a guest", async () => {
    const position = await create({ ticker: "NVDA" });
    H.user = null;
    for (const body of [
      { action: "create", ticker: "AAPL" },
      { action: "update", id: position.id, shares: 5 },
      { action: "close", id: position.id },
      { action: "delete", id: position.id },
    ]) {
      expect((await post(body)).status).toBe(401);
    }
    H.user = { id: owner };
    expect((await book()).map((p) => [p.ticker, p.status, p.shares]))
      .toEqual([["NVDA", "open", null]]);
  });
});

describe("semantic invariants A-D across the two ROUTES", () => {
  it("A: adding to a watchlist changes no position", async () => {
    await create({ ticker: "NVDA", shares: 10 });
    const before = await book();
    expect((await watchlistPost({ action: "add", symbols: ["AAPL"], section: "Equities" })).status).toBe(200);
    expect(await book()).toEqual(before);
  });

  it("B: adding a position changes no watchlist row", async () => {
    const before = await lists();
    await create({ ticker: "AAPL", shares: 3 });
    expect(await lists()).toEqual(before);
  });

  it("C: removing a watchlist symbol keeps the position", async () => {
    await create({ ticker: "NVDA", shares: 10 });
    expect((await watchlistPost({ action: "remove", symbols: ["NVDA"] })).status).toBe(200);
    expect((await lists())[0].symbols.map((s) => s.symbol)).not.toContain("NVDA");
    expect((await book()).map((p) => p.ticker)).toEqual(["NVDA"]);
  });

  it("D: closing a position keeps watchlist membership", async () => {
    const position = await create({ ticker: "NVDA", shares: 10 });
    expect((await post({ action: "close", id: position.id })).status).toBe(200);
    expect((await lists())[0].symbols.map((s) => s.symbol)).toContain("NVDA");
    expect((await book())[0].status).toBe("closed");
  });

  it("deleting a position leaves the watchlist row, and deleting a list leaves the position", async () => {
    const position = await create({ ticker: "NVDA", shares: 10 });
    await post({ action: "delete", id: position.id });
    expect((await lists())[0].symbols.map((s) => s.symbol)).toContain("NVDA");

    await create({ ticker: "NVDA", shares: 10 });
    const list = (await lists())[0];
    expect((await watchlistPost({ action: "deleteList", listId: list.id })).status).toBe(200);
    expect(await lists()).toEqual([]);
    expect((await book()).map((p) => p.ticker)).toEqual(["NVDA"]);
  });
});
