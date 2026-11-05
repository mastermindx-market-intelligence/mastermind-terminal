import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

const FIXTURES = path.join(process.cwd(), "fixtures", "dislocations");

let mockRateLimitOk = true;
vi.mock("@/lib/rateLimit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rateLimit")>();
  return {
    rateLimit: () =>
      mockRateLimitOk ? { ok: true as const } : { ok: false as const, retryAfter: 60 },
    tooMany: actual.tooMany,
  };
});

let mockCookieGet: (name: string) => { value: string } | undefined = () => undefined;
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => mockCookieGet(name) }),
}));

let mockSession: { user: { id: string } } | null = { user: { id: "u1" } };
let mockWatchlistProbeError: { message: string } | null = null;
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: mockSession?.user ?? null } }),
    },
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        limit: () =>
          Promise.resolve(
            table === "watchlists" && mockWatchlistProbeError
              ? { data: null, error: mockWatchlistProbeError }
              : { data: [{ id: "w0" }], error: null }
          ),
      };
      return chain;
    },
  }),
}));

let mockReadPositions: () => Promise<unknown> = async () => ({
  ok: true,
  positions: [],
});
vi.mock("@/lib/portfolio", () => ({
  readPositions: (..._args: unknown[]) => mockReadPositions(),
}));

let mockWatchlists: () => Promise<unknown> = async () => [];
vi.mock("@/lib/watchlists", () => ({
  listWatchlists: (..._args: unknown[]) => mockWatchlists(),
}));

let mockPaid = false;
vi.mock("@/lib/entitlement", () => ({
  isPaidTier: async () => mockPaid,
}));

vi.mock("@/lib/watchlistsFixtureDb", () => ({
  createFixtureDb: () => ({}),
  fixtureFaults: () => ({}),
  fixtureUserId: () => "fixture-user",
  FIXTURE_FAULT_COOKIE: "faults",
  FIXTURE_STORE_COOKIE: "store",
}));

let liveDir: string;

function assertPrivateNoStore(res: Response) {
  expect(res.headers.get("Cache-Control")).toBe("private, no-store");
}

async function installRadar(name: string) {
  await fs.copyFile(path.join(FIXTURES, name), path.join(liveDir, "entry_radar.json"));
}

async function loadGet() {
  const { GET } = await import("@/app/api/v1/dislocations/route");
  return GET;
}

beforeEach(async () => {
  liveDir = await fs.mkdtemp(path.join(os.tmpdir(), "dislo-route-"));
  process.env.MACRO_LIVE_DIR = liveDir;
  delete process.env.TERMINAL_E2E_FIXTURE;
  mockSession = { user: { id: "u1" } };
  mockPaid = false;
  mockRateLimitOk = true;
  mockCookieGet = () => undefined;
  mockWatchlistProbeError = null;
  mockWatchlists = async () => [];
  mockReadPositions = async () => ({ ok: true, positions: [] });
  const { resetDislocationsSourceCacheForTests } = await import("@/lib/dislocations/source");
  resetDislocationsSourceCacheForTests();
  vi.resetModules();
});

afterEach(async () => {
  delete process.env.MACRO_LIVE_DIR;
  delete process.env.TERMINAL_E2E_FIXTURE;
  if (liveDir) await fs.rm(liveDir, { recursive: true, force: true }).catch(() => undefined);
  const { resetDislocationsSourceCacheForTests } = await import("@/lib/dislocations/source");
  resetDislocationsSourceCacheForTests();
  vi.resetModules();
});

describe("dislocations route", () => {
  it("R1 unauthenticated → 401", async () => {
    mockSession = null;
    const GET = await loadGet();
    const res = await GET(new Request("http://x/api/v1/dislocations"));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.state).toBe("unauthenticated");
    assertPrivateNoStore(res);
  });

  it("R2 bogus view → 400", async () => {
    await installRadar("fresh.json");
    const GET = await loadGet();
    const res = await GET(new Request("http://x/api/v1/dislocations?view=bogus"));
    expect(res.status).toBe(400);
    expect((await res.json()).state).toBe("bad_request");
    assertPrivateNoStore(res);
  });

  it("R2b bad sym → 400", async () => {
    await installRadar("fresh.json");
    const GET = await loadGet();
    const res = await GET(new Request("http://x/api/v1/dislocations?sym=../x"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("bad sym");
    assertPrivateNoStore(res);
  });

  it("R3 market forbidden without paid tier", async () => {
    await installRadar("fresh.json");
    mockPaid = false;
    const GET = await loadGet();
    const res = await GET(new Request("http://x/api/v1/dislocations?view=market"));
    expect(res.status).toBe(403);
    expect((await res.json()).reason).toBe("paid_tier_required");
    assertPrivateNoStore(res);
  });

  it("R3b market ok with paid tier", async () => {
    await installRadar("fresh.json");
    mockPaid = true;
    const GET = await loadGet();
    const res = await GET(new Request("http://x/api/v1/dislocations?view=market"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.state).toBe("ok");
    expect(body.count).toBe(9);
    assertPrivateNoStore(res);
  });

  it("R4 my view filters watchlist + open positions, newest first", async () => {
    await installRadar("fresh.json");
    mockWatchlists = async () => [
      { id: "w1", name: "Default", position: 0, symbols: [{ symbol: "AAPL", position: 0 }] },
    ];
    mockReadPositions = async () => ({
      ok: true,
      positions: [
        { id: "p1", ticker: "NVDA", shares: 1, status: "open" },
        { id: "p2", ticker: "TSLA", shares: 1, status: "closed" },
      ],
    });
    const GET = await loadGet();
    const res = await GET(new Request("http://x/api/v1/dislocations"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.state).toBe("ok");
    expect(body.count).toBe(2);
    expect(body.episodes.map((e: { ticker: string }) => e.ticker)).toEqual(["NVDA", "AAPL"]);
    expect(body.episodes[0].display.stance).toBe("confirmed");
    expect(body.episodes[1].display.stance).toBe("forming");
    expect(body.source.delayed).toBe(true);
    assertPrivateNoStore(res);
  });

  it("R5 my with unknown symbols → ok_empty", async () => {
    await installRadar("fresh.json");
    mockWatchlists = async () => [
      { id: "w1", name: "X", position: 0, symbols: [{ symbol: "ZZZZ", position: 0 }] },
    ];
    const GET = await loadGet();
    const res = await GET(new Request("http://x/api/v1/dislocations"));
    const body = await res.json();
    expect(body.state).toBe("ok_empty");
    expect(body.count).toBe(0);
    expect(body.knowable_at_max).toBeNull();
    assertPrivateNoStore(res);
  });

  it("R6 sym filter lower-case aapl", async () => {
    await installRadar("fresh.json");
    mockPaid = true;
    const GET = await loadGet();
    const res = await GET(new Request("http://x/api/v1/dislocations?view=market&sym=aapl"));
    const body = await res.json();
    expect(body.count).toBe(1);
    expect(body.episodes[0].ticker).toBe("AAPL");
    assertPrivateNoStore(res);
  });

  it("R7 stale_pack → stale with episodes", async () => {
    await installRadar("stale_pack.json");
    mockPaid = true;
    const GET = await loadGet();
    const res = await GET(new Request("http://x/api/v1/dislocations?view=market"));
    const body = await res.json();
    expect(body.state).toBe("stale");
    expect(body.count).toBeGreaterThan(0);
    expect(body.source.pack_fresh).toBe(false);
    expect(body.source.freshness_reason).toBe("pack_old");
    assertPrivateNoStore(res);
  });

  it("R8 old_file → stale file_old", async () => {
    await installRadar("old_file.json");
    mockPaid = true;
    const GET = await loadGet();
    const res = await GET(new Request("http://x/api/v1/dislocations?view=market"));
    const body = await res.json();
    expect(body.state).toBe("stale");
    expect(body.source.freshness_reason).toBe("file_old");
    assertPrivateNoStore(res);
  });

  it("R9 missing file → source_unavailable missing", async () => {
    const GET = await loadGet();
    const res = await GET(new Request("http://x/api/v1/dislocations"));
    const body = await res.json();
    expect(body.state).toBe("source_unavailable");
    expect(body.reason).toBe("missing");
    assertPrivateNoStore(res);
  });

  it("R9b malformed → source_unavailable malformed", async () => {
    await installRadar("malformed.json");
    const GET = await loadGet();
    const res = await GET(new Request("http://x/api/v1/dislocations"));
    const body = await res.json();
    expect(body.state).toBe("source_unavailable");
    expect(body.reason).toBe("malformed");
    assertPrivateNoStore(res);
  });

  it("R9c no episodes key → episodes_not_published", async () => {
    await installRadar("no_episodes_key.json");
    const GET = await loadGet();
    const res = await GET(new Request("http://x/api/v1/dislocations"));
    const body = await res.json();
    expect(body.state).toBe("source_unavailable");
    expect(body.reason).toBe("episodes_not_published");
    expect(body.source.asof).toBeTruthy();
    assertPrivateNoStore(res);
  });

  it("R10 market caps at 200, newest first", async () => {
    const base = JSON.parse(await fs.readFile(path.join(FIXTURES, "fresh.json"), "utf8"));
    const episodes = [];
    for (let i = 0; i < 205; i++) {
      const ts = `2026-10-03T${String(10 + Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00.000Z`;
      episodes.push({
        ...base.episodes[0],
        episode_id: `ep-synth-${i}`,
        ticker: `T${String(i).padStart(3, "0")}`,
        last_observed_at: ts,
        candidate_at: ts,
        first_armed_at: ts,
      });
    }
    base.episodes = episodes;
    await fs.writeFile(path.join(liveDir, "entry_radar.json"), JSON.stringify(base));
    mockPaid = true;
    const GET = await loadGet();
    const res = await GET(new Request("http://x/api/v1/dislocations?view=market"));
    const body = await res.json();
    expect(body.count).toBe(200);
    expect(body.episodes[0].episode_id).toBe("ep-synth-204");
    assertPrivateNoStore(res);
  });

  it("R11 readPositions failure sets join_degraded", async () => {
    await installRadar("fresh.json");
    mockWatchlists = async () => [
      { id: "w1", name: "Default", position: 0, symbols: [{ symbol: "AAPL", position: 0 }] },
    ];
    mockReadPositions = async () => ({ ok: false, error: "down" });
    const GET = await loadGet();
    const res = await GET(new Request("http://x/api/v1/dislocations"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.source.join_degraded).toBe(true);
    expect(body.episodes.some((e: { ticker: string }) => e.ticker === "AAPL")).toBe(true);
    assertPrivateNoStore(res);
  });

  it("D1a good read then malformed file serves stale fallback", async () => {
    await installRadar("fresh.json");
    mockPaid = true;
    const GET = await loadGet();
    const good = await GET(new Request("http://x/api/v1/dislocations?view=market"));
    expect((await good.json()).state).toBe("ok");

    await fs.writeFile(path.join(liveDir, "entry_radar.json"), "{not json", "utf8");
    const st = await fs.stat(path.join(liveDir, "entry_radar.json"));
    const bumped = new Date(st.mtimeMs + 5000);
    await fs.utimes(path.join(liveDir, "entry_radar.json"), bumped, bumped);

    const res = await GET(new Request("http://x/api/v1/dislocations?view=market"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.state).toBe("stale");
    expect(body.source.freshness_reason).toMatch(/^fallback:/);
    expect(body.source.served_from_cache).toBe(true);
    assertPrivateNoStore(res);
  });

  it("D1b good read then unlink serves stale fallback", async () => {
    const radar = path.join(liveDir, "entry_radar.json");
    await installRadar("fresh.json");
    mockPaid = true;
    const GET = await loadGet();
    await GET(new Request("http://x/api/v1/dislocations?view=market"));

    await fs.unlink(radar);

    const res = await GET(new Request("http://x/api/v1/dislocations?view=market"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.state).toBe("stale");
    expect(body.source.freshness_reason).toMatch(/^fallback:/);
    assertPrivateNoStore(res);
  });

  it("D2a watchlist probe error → join_degraded, not ok_empty", async () => {
    await installRadar("fresh.json");
    mockWatchlistProbeError = { message: "probe failed" };
    const GET = await loadGet();
    const res = await GET(new Request("http://x/api/v1/dislocations"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.source.join_degraded).toBe(true);
    expect(body.state).not.toBe("ok_empty");
    assertPrivateNoStore(res);
  });

  it("D2b watchlist reader throws → join_degraded", async () => {
    await installRadar("fresh.json");
    mockWatchlists = async () => {
      throw new Error("watchlists down");
    };
    const GET = await loadGet();
    const res = await GET(new Request("http://x/api/v1/dislocations"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.source.join_degraded).toBe(true);
    assertPrivateNoStore(res);
  });

  it("D2c positions reader throws → join_degraded", async () => {
    await installRadar("fresh.json");
    mockWatchlists = async () => [
      { id: "w1", name: "Default", position: 0, symbols: [{ symbol: "AAPL", position: 0 }] },
    ];
    mockReadPositions = async () => {
      throw new Error("positions down");
    };
    const GET = await loadGet();
    const res = await GET(new Request("http://x/api/v1/dislocations"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.source.join_degraded).toBe(true);
    assertPrivateNoStore(res);
  });

  it("D3a drops null episodes and bad last_observed_at types", async () => {
    const base = JSON.parse(await fs.readFile(path.join(FIXTURES, "fresh.json"), "utf8"));
    base.episodes = [...base.episodes, null, { ...base.episodes[0], episode_id: "bad-ts", last_observed_at: 12345 }];
    await fs.writeFile(path.join(liveDir, "entry_radar.json"), JSON.stringify(base));
    mockPaid = true;
    const GET = await loadGet();
    const res = await GET(new Request("http://x/api/v1/dislocations?view=market"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.source.dropped_rows).toBeGreaterThanOrEqual(1);
    expect(body.episodes.every((e: { episode_id: string }) => e.episode_id !== "bad-ts")).toBe(true);
    assertPrivateNoStore(res);
  });

  it("D3b isPaidTier throwing → handler_error not 500", async () => {
    await installRadar("fresh.json");
    const ent = await import("@/lib/entitlement");
    vi.spyOn(ent, "isPaidTier").mockRejectedValueOnce(new Error("tier probe failed"));
    const GET = await loadGet();
    const res = await GET(new Request("http://x/api/v1/dislocations?view=market"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.state).toBe("source_unavailable");
    expect(body.reason).toBe("handler_error");
    assertPrivateNoStore(res);
  });

  it("D3c handler never returns 500 on unexpected throw during join", async () => {
    await installRadar("fresh.json");
    mockWatchlists = async () => {
      throw new Error("unexpected");
    };
    const GET = await loadGet();
    const res = await GET(new Request("http://x/api/v1/dislocations"));
    expect(res.status).toBe(200);
    assertPrivateNoStore(res);
  });

  it("D5a stale source with zero my-view matches is stale not ok_empty", async () => {
    await installRadar("stale_pack.json");
    mockWatchlists = async () => [
      { id: "w1", name: "X", position: 0, symbols: [{ symbol: "ZZZZ", position: 0 }] },
    ];
    const GET = await loadGet();
    const res = await GET(new Request("http://x/api/v1/dislocations"));
    const body = await res.json();
    expect(body.state).toBe("stale");
    expect(body.state).not.toBe("ok_empty");
    expect(body.count).toBe(0);
    assertPrivateNoStore(res);
  });

  it("D5b rate limit returns 429 with private no-store", async () => {
    mockRateLimitOk = false;
    const GET = await loadGet();
    const res = await GET(new Request("http://x/api/v1/dislocations"));
    expect(res.status).toBe(429);
    assertPrivateNoStore(res);
  });

  it("D5c fixture mode serves fresh.json via mm_e2e_dislo cookie", async () => {
    process.env.TERMINAL_E2E_FIXTURE = "1";
    mockPaid = true;
    mockCookieGet = (name) =>
      name === "mm_e2e_dislo" ? { value: "fresh" } : undefined;
    const GET = await loadGet();
    const res = await GET(new Request("http://x/api/v1/dislocations?view=market"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.episodes.some((e: { episode_id: string }) => e.episode_id === "ep-aapl-armed")).toBe(
      true
    );
    assertPrivateNoStore(res);

    delete process.env.TERMINAL_E2E_FIXTURE;
    vi.resetModules();
    const GET2 = await loadGet();
    mockPaid = true;
    mockCookieGet = (name) =>
      name === "mm_e2e_dislo" ? { value: "fresh" } : undefined;
    await fs.writeFile(path.join(liveDir, "entry_radar.json"), "{}", "utf8");
    const res2 = await GET2(new Request("http://x/api/v1/dislocations?view=market"));
    const body2 = await res2.json();
    expect(body2.state).toBe("source_unavailable");
  });
});
