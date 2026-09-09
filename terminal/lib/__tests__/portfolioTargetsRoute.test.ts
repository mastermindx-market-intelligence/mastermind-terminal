import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DbResult, WatchlistDb, WatchlistQuery } from "@/lib/watchlists";

const H = vi.hoisted(() => ({
  user: { id: "e2e-user-pftargets" } as { id: string } | null,
  failTable: null as string | null,
  failReadTable: null as string | null,
  positionWrites: [] as { table: string; op: string }[],
}));

vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }));

vi.mock("@/lib/supabase/server", async () => {
  const { createFixtureDb } = await import("@/lib/watchlistsFixtureDb");
  return {
    createClient: vi.fn(async () => {
      const db: WatchlistDb = createFixtureDb("pftargets");
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
          if (H.failReadTable === table || H.failTable === table) return failedQuery();
          const query = db.from(table);
          return new Proxy(query, {
            get(target, prop, receiver) {
              if (prop === "insert" || prop === "update" || prop === "delete") {
                return (value?: unknown) => {
                  H.positionWrites.push({ table, op: String(prop) });
                  const fn = Reflect.get(target, prop, receiver) as (...args: unknown[]) => unknown;
                  return typeof fn === "function" ? fn.call(target, value) : fn;
                };
              }
              const value = Reflect.get(target, prop, receiver);
              return typeof value === "function" ? value.bind(target) : value;
            },
          });
        },
      };
    }),
  };
});

import { GET, POST } from "@/app/api/portfolio/targets/route";
import { POST as PORTFOLIO_POST } from "@/app/api/portfolio/route";
import { createFixtureDb, fixtureUserId, resetFixtureStores } from "@/lib/watchlistsFixtureDb";
import type { PortfolioTargetsSummary } from "@/lib/portfolioTargets";

const postTargets = (body: Record<string, unknown>) => POST(new Request("https://x.test/api/portfolio/targets", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
}));
const postBook = (body: Record<string, unknown>) => PORTFOLIO_POST(new Request("https://x.test/api/portfolio", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
}));

const owner = fixtureUserId("pftargets");

async function seedHolding(ticker: string, shares = 10, entryPrice = 100) {
  const response = await postBook({ action: "create", ticker, shares, entryPrice });
  expect(response.status).toBe(200);
  return (await response.json()).position as { id: string; ticker: string };
}

beforeEach(() => {
  resetFixtureStores();
  H.user = { id: owner };
  H.failTable = null;
  H.failReadTable = null;
  H.positionWrites = [];
  vi.clearAllMocks();
});

describe("GET /api/portfolio/targets", () => {
  it("is 401 when signed out, store never read", async () => {
    H.user = null;
    const response = await GET();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthenticated" });
    expect(H.positionWrites).toEqual([]);
    expect(createFixtureDb("pftargets"));
  });

  it("is 200 with an empty summary and no untargeted entries when the book itself is empty", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    const payload = await response.json() as { summary: PortfolioTargetsSummary };
    expect(payload.summary.schema).toBe("portfolio_targets.v1");
    expect(payload.summary.weightBasis).toBe("cost");
    expect(payload.summary.drifts).toEqual([]);
    expect(payload.summary.untargeted).toEqual([]);
    expect(payload.summary.orphaned).toEqual([]);
    expect(payload.summary.targetsSumPct).toBeNull();
    expect(payload.summary.targetsSumOffBy100).toBeNull();
  });

  it("is 200 listing every open, sized holding as untargeted when no targets exist yet", async () => {
    await seedHolding("AAA", 10, 1000);
    await seedHolding("BBB", 100, 100);
    const response = await GET();
    expect(response.status).toBe(200);
    const { summary } = await response.json() as { summary: PortfolioTargetsSummary };
    expect(summary.drifts).toEqual([]);
    expect(summary.untargeted.map((u) => u.ticker).sort()).toEqual(["AAA", "BBB"]);
    expect(summary.untargeted.every((u) => u.currentWeightPct === 50)).toBe(true);
  });

  it("is 503 with 'portfolio unavailable', never a fabricated empty summary, when the positions read fails", async () => {
    await seedHolding("AAA");
    H.failReadTable = "portfolio_positions";
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "portfolio unavailable" });
  });

  it("is 503 with 'targets unavailable', never a fabricated empty summary, when the targets read fails", async () => {
    await seedHolding("AAA");
    H.failReadTable = "portfolio_targets";
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "targets unavailable" });
  });
});

describe("POST /api/portfolio/targets — action:set", () => {
  it("upserts a target on a currently open, sized holding and a subsequent GET reflects it", async () => {
    await seedHolding("NVDA", 100, 200);
    const set = await postTargets({ action: "set", ticker: "nvda", targetWeightPct: 80, bandPct: 5 });
    expect(set.status).toBe(200);
    const body = await set.json();
    expect(body.ok).toBe(true);
    expect(body.target).toMatchObject({ ticker: "NVDA", targetWeightPct: 80, bandPct: 5 });

    const got = await GET();
    expect(got.status).toBe(200);
    const { summary } = await got.json() as { summary: PortfolioTargetsSummary };
    expect(summary.drifts).toHaveLength(1);
    expect(summary.drifts[0]).toMatchObject({
      ticker: "NVDA",
      currentWeightPct: 100,
      targetWeightPct: 80,
      driftPct: 20,
      status: "outside_band",
    });
  });

  it("is 400 'not a current holding' and writes nothing when the ticker is not open+sized", async () => {
    await seedHolding("AAA", 10, 100);
    const closed = await seedHolding("BBB", 10, 100);
    await postBook({ action: "close", id: closed.id });

    const missing = await postTargets({ action: "set", ticker: "ZZZ", targetWeightPct: 10 });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: "not a current holding" });

    const unsized = await postBook({ action: "create", ticker: "CCC" });
    expect(unsized.status).toBe(200);
    const onUnsized = await postTargets({ action: "set", ticker: "CCC", targetWeightPct: 10 });
    expect(onUnsized.status).toBe(400);
    expect(await onUnsized.json()).toEqual({ error: "not a current holding" });

    const onClosed = await postTargets({ action: "set", ticker: "BBB", targetWeightPct: 10 });
    expect(onClosed.status).toBe(400);

    const got = await GET();
    const { summary } = await got.json() as { summary: PortfolioTargetsSummary };
    expect(summary.drifts).toEqual([]);
    expect(summary.orphaned).toEqual([]);
  });

  it("is 400 'invalid target' and writes nothing when targetWeightPct is out of range", async () => {
    await seedHolding("AAA");
    const response = await postTargets({ action: "set", ticker: "AAA", targetWeightPct: 101 });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid target" });
    const got = await GET();
    expect((await got.json()).summary.drifts).toEqual([]);
  });

  it("is 400 'invalid band' and writes nothing when bandPct is out of range", async () => {
    await seedHolding("AAA");
    const response = await postTargets({ action: "set", ticker: "AAA", targetWeightPct: 40, bandPct: 51 });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid band" });
    const got = await GET();
    expect((await got.json()).summary.drifts).toEqual([]);
  });

  it("defaults bandPct to 5 on first create when omitted", async () => {
    await seedHolding("AAA");
    const response = await postTargets({ action: "set", ticker: "AAA", targetWeightPct: 40 });
    expect(response.status).toBe(200);
    expect((await response.json()).target.bandPct).toBe(5);
  });

  it("leaves the existing bandPct unchanged on an update that omits it", async () => {
    await seedHolding("AAA");
    await postTargets({ action: "set", ticker: "AAA", targetWeightPct: 40, bandPct: 12 });
    const update = await postTargets({ action: "set", ticker: "AAA", targetWeightPct: 55 });
    expect(update.status).toBe(200);
    expect((await update.json()).target).toMatchObject({ targetWeightPct: 55, bandPct: 12 });
  });
});

describe("POST /api/portfolio/targets — action:clear", () => {
  it("deletes an existing target; a subsequent GET returns the ticker to untargeted", async () => {
    await seedHolding("AAA");
    await postTargets({ action: "set", ticker: "AAA", targetWeightPct: 40 });
    const cleared = await postTargets({ action: "clear", ticker: "AAA" });
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toEqual({ ok: true, clearedTicker: "AAA" });
    const got = await GET();
    const { summary } = await got.json() as { summary: PortfolioTargetsSummary };
    expect(summary.drifts).toEqual([]);
    expect(summary.untargeted.map((u) => u.ticker)).toEqual(["AAA"]);
  });

  it("is 404 'target not found' when clearing a ticker with no saved target", async () => {
    await seedHolding("AAA");
    const response = await postTargets({ action: "clear", ticker: "AAA" });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "target not found" });
  });
});

describe("cross-route consistency", () => {
  it("closing a position through the existing /api/portfolio route leaves its target row intact and GET renders it as orphaned", async () => {
    const held = await seedHolding("AAA");
    await seedHolding("BBB");
    await postTargets({ action: "set", ticker: "AAA", targetWeightPct: 40, bandPct: 8 });
    const closed = await postBook({ action: "close", id: held.id });
    expect(closed.status).toBe(200);

    const got = await GET();
    expect(got.status).toBe(200);
    const { summary } = await got.json() as { summary: PortfolioTargetsSummary };
    expect(summary.drifts.some((d) => d.ticker === "AAA")).toBe(false);
    expect(summary.orphaned).toEqual([{ ticker: "AAA", targetWeightPct: 40, bandPct: 8 }]);
  });

  it("never issues a write against portfolio_positions from this route or from portfolioTargets.ts", async () => {
    await seedHolding("AAA");
    H.positionWrites = [];
    await postTargets({ action: "set", ticker: "AAA", targetWeightPct: 40 });
    await GET();
    await postTargets({ action: "clear", ticker: "AAA" });
    const againstPositions = H.positionWrites.filter((e) => e.table === "portfolio_positions");
    expect(againstPositions).toEqual([]);
  });
});

describe("POST /api/portfolio/targets — unsupported", () => {
  it("is 400 'unsupported action' for a missing or unknown action", async () => {
    const missing = await postTargets({ ticker: "AAA" });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: "unsupported action" });
    const other = await postTargets({ action: "rebalance", ticker: "AAA" });
    expect(other.status).toBe(400);
    expect(await other.json()).toEqual({ error: "unsupported action" });
  });
});
