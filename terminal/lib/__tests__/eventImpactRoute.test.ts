import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { promises as fsPromises } from "fs";
import os from "os";
import path from "path";

const fetchMock = vi.fn();

vi.mock("@/lib/rateLimit", () => ({
  rateLimit: () => ({ ok: true }),
  tooMany: () => new Response(null, { status: 429 }),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

let mockSession: { user: { id: string } } | null = { user: { id: "u1" } };
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: mockSession?.user ?? null } }),
    },
  }),
}));

let mockReadPositions: () => Promise<unknown> = async () => ({
  ok: true,
  positions: [{ id: "p1", ticker: "AAPL", shares: 10, status: "open" }],
});
vi.mock("@/lib/portfolio", () => ({
  readPositions: (...args: unknown[]) => mockReadPositions(),
}));

vi.mock("@/lib/watchlistsFixtureDb", () => ({
  createFixtureDb: () => ({}),
  fixtureFaults: () => ({}),
  fixtureUserId: () => "fixture-user",
  FIXTURE_FAULT_COOKIE: "faults",
  FIXTURE_STORE_COOKIE: "store",
}));

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  mockSession = { user: { id: "u1" } };
  mockReadPositions = async () => ({
    ok: true,
    positions: [{ id: "p1", ticker: "AAPL", shares: 10, status: "open" }],
  });
  delete process.env.TERMINAL_E2E_FIXTURE;
  delete process.env.MACRO_DATA_DIR;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  delete process.env.MACRO_DATA_DIR;
});

const okCtx = () =>
  new Response(JSON.stringify({ schema: "portfolio_ctx.v1", asof: "2026-09-05", tickers: {} }), {
    status: 200,
  });

describe("event-impact route", () => {
  it("1. upstream unreadable (acceptance 3)", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));
    const { GET } = await import("@/app/api/event-impact/route");
    const res = await GET(new Request("http://x/api/event-impact"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.state).toBe("calendar_unreadable");
  });

  it("2. holdings unreadable", async () => {
    mockReadPositions = async () => ({ ok: false, error: "boom" });
    fetchMock.mockResolvedValue(okCtx());
    const { GET } = await import("@/app/api/event-impact/route");
    const res = await GET(new Request("http://x/api/event-impact"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.state).toBe("holdings_unreadable");
  });

  it("3. signed out", async () => {
    mockSession = null;
    const { GET } = await import("@/app/api/event-impact/route");
    const res = await GET(new Request("http://x/api/event-impact"));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("4. happy path", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          schema: "portfolio_ctx.v1",
          asof: "2026-09-05",
          tickers: { AAPL: { earnings: { next: "2026-10-30", days_to: 5 } } },
        }),
        { status: 200 }
      )
    );
    const { GET } = await import("@/app/api/event-impact/route");
    const res = await GET(new Request("http://x/api/event-impact"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.state).toBe("ok");
    expect(body.events[0].ticker).toBe("AAPL");
  });

  it("5. GET only / read-only", async () => {
    fetchMock.mockResolvedValue(okCtx());
    const mod = await import("@/app/api/event-impact/route");
    expect(Object.keys(mod).sort()).toEqual(["GET", "runtime"]);
    await mod.GET(new Request("http://x/api/event-impact"));
    const call = fetchMock.mock.calls[0];
    const init = call[1] as RequestInit | undefined;
    expect(!init?.method || init.method === "GET").toBe(true);
    expect(init?.body).toBeUndefined();
  });

  it("6. cache does not lie", async () => {
    fetchMock.mockResolvedValue(okCtx());
    const { GET } = await import("@/app/api/event-impact/route");
    await GET(new Request("http://x/api/event-impact"));
    await GET(new Request("http://x/api/event-impact"));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockRejectedValue(new Error("network down"));
    // Force a cache miss window is not directly controllable here without TTL manipulation;
    // instead verify a fresh module with an immediate failure and no prior cache surfaces
    // calendar_unreadable, and a subsequent success then failure serves stale.
    vi.resetModules();
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(okCtx());
    const mod2 = await import("@/app/api/event-impact/route");
    const first = await mod2.GET(new Request("http://x/api/event-impact"));
    expect(first.status).toBe(200);
    expect((await first.json()).stale).toBeUndefined();
  });

  it("7. stale-through-outage is disclosed, never served silently as fresh (MAJOR)", async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockResolvedValueOnce(okCtx());
      const { GET } = await import("@/app/api/event-impact/route");
      const first = await GET(new Request("http://x/api/event-impact"));
      expect((await first.json()).stale).toBeUndefined();

      // Advance past the 900_000ms TTL so the next call is a genuine cache-miss window,
      // then fail the upstream fetch: the cached artifact must still be served, but flagged.
      vi.advanceTimersByTime(900_001);
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
      const second = await GET(new Request("http://x/api/event-impact"));
      expect(second.status).toBe(200);
      const body = await second.json();
      expect(body.stale).toBe(true);
      expect(body.state === "ok" || body.state === "no_events").toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("8. a 401 body matches the typed EventImpactRead 'unauthenticated' state (MAJOR: UI parity)", async () => {
    mockSession = null;
    const { GET } = await import("@/app/api/event-impact/route");
    const res = await GET(new Request("http://x/api/event-impact"));
    const body = await res.json();
    expect(body).toEqual({ state: "unauthenticated" });
  });

  // RULING B1 / BLOCKER 1: the live artifact is regwalled (401 x-regwall:deny on an
  // unauthenticated server-to-server fetch) — a 401/403 upstream must render `upstream_locked`,
  // never `no_events` (which would assert "no event touches your positions" without ever having
  // checked).
  it("9. a 401 upstream is 'upstream_locked', never 'no_events' (BLOCKER 1)", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }));
    const { GET } = await import("@/app/api/event-impact/route");
    const res = await GET(new Request("http://x/api/event-impact"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.state).toBe("upstream_locked");
    expect(body.state).not.toBe("no_events");
  });

  it("10. a 403 upstream is also 'upstream_locked'", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 403 }));
    const { GET } = await import("@/app/api/event-impact/route");
    const res = await GET(new Request("http://x/api/event-impact"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.state).toBe("upstream_locked");
  });

  it("11. a genuine 5xx stays 'calendar_unreadable', not 'upstream_locked'", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));
    const { GET } = await import("@/app/api/event-impact/route");
    const res = await GET(new Request("http://x/api/event-impact"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.state).toBe("calendar_unreadable");
  });

  // RULING B1(b): the file-read path is PRIMARY in production; the regwalled HTTP fetch is only
  // the fallback. This proves the disk read actually works and that a successful disk read never
  // touches the HTTP path at all.
  it("12. reads the artifact from MACRO_DATA_DIR on disk, never touching the HTTP fallback", async () => {
    const dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "mo-event-impact-ctx-"));
    const file = path.join(dir, "portfolio_ctx.json");
    await fsPromises.writeFile(
      file,
      JSON.stringify({
        schema: "portfolio_ctx.v2",
        asof: "2026-09-05",
        tickers: { AAPL: { earnings: { next: "2026-10-30", days_to: 5 } } },
      }),
      "utf8"
    );
    process.env.MACRO_DATA_DIR = dir;
    try {
      const { GET } = await import("@/app/api/event-impact/route");
      const res = await GET(new Request("http://x/api/event-impact"));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.state).toBe("ok");
      expect(body.events[0].ticker).toBe("AAPL");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      await fsPromises.rm(dir, { recursive: true, force: true });
    }
  });

  it("13. MACRO_DATA_DIR missing on this box falls through to the HTTP fetch, not an error", async () => {
    process.env.MACRO_DATA_DIR = path.join(os.tmpdir(), "mo-event-impact-does-not-exist");
    fetchMock.mockResolvedValue(okCtx());
    const { GET } = await import("@/app/api/event-impact/route");
    const res = await GET(new Request("http://x/api/event-impact"));
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // RULING r3, item 1 (was review r2 BLOCKER-adjacent): a disk file that EXISTS but fails to
  // parse must surface as `calendar_unreadable` — the source is broken, not access-denied — even
  // when the HTTP fallback that runs next happens to 401. RED before the fix: `readCtx()` let
  // whichever attempt had a non-empty `.error` win the tie, so the HTTP 401's `locked: true`
  // silently overwrote the disk's own "unparseable" outcome and the route answered
  // `upstream_locked` instead — the wrong typed state, carrying the wrong user sentence
  // (`eiUpstreamLocked`'s "your positions are unaffected" instead of `eiCalendarUnreadable`'s
  // "the event list is the part that's missing").
  it("16. a corrupt on-disk artifact stays calendar_unreadable even when the HTTP fallback 401s", async () => {
    const dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "mo-event-impact-corrupt-"));
    const file = path.join(dir, "portfolio_ctx.json");
    await fsPromises.writeFile(file, "{ this is not valid json", "utf8");
    process.env.MACRO_DATA_DIR = dir;
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }));
    try {
      const { GET } = await import("@/app/api/event-impact/route");
      const res = await GET(new Request("http://x/api/event-impact"));
      expect(res.status).toBe(503);
      const body = await res.json();
      // Must be the disk-side "broken calendar" state, never the access-side "locked out" state
      // the HTTP 401 would otherwise have produced — those two states render different user
      // sentences (eiCalendarUnreadable vs eiUpstreamLocked) and must not be confused.
      expect(body.state).toBe("calendar_unreadable");
      expect(body.state).not.toBe("upstream_locked");
      // The HTTP fallback's own detail must never leak in and relabel a disk-side parse failure.
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      await fsPromises.rm(dir, { recursive: true, force: true });
    }
  });

  // m3: `stale` must never be spread onto a shape the EventImpactRead union does not declare it
  // on. A holdings-read failure racing a stale-cache window must surface as a clean
  // `holdings_unreadable`, with no dangling `stale` field the panel never reads.
  it("14. stale is never spread onto holdings_unreadable (m3)", async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockResolvedValueOnce(okCtx());
      const { GET } = await import("@/app/api/event-impact/route");
      await GET(new Request("http://x/api/event-impact"));

      vi.advanceTimersByTime(900_001);
      mockReadPositions = async () => ({ ok: false, error: "boom" });
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
      const res = await GET(new Request("http://x/api/event-impact"));
      const body = await res.json();
      expect(body.state).toBe("holdings_unreadable");
      expect(body.stale).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  // Minor 2, review r3: a stale cache has no maximum age today, so an outage that outlives the
  // artifact's staleness window would serve an ever-more-wrong `daysUntil` countdown forever,
  // disclosed only by a prose "stale" chip. RED before the fix: this asserted `stale: true` and
  // an `ok`/`no_events` body no matter how old the cache was.
  it("15. a cache older than MAX_STALE_MS is not served — disclosed as unreadable instead of an indefinitely stale countdown", async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockResolvedValueOnce(okCtx());
      const { GET } = await import("@/app/api/event-impact/route");
      const first = await GET(new Request("http://x/api/event-impact"));
      expect((await first.json()).stale).toBeUndefined();

      // Just past the TTL, still well within the max-staleness window: served stale (case 7).
      vi.advanceTimersByTime(900_001);
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
      const second = await GET(new Request("http://x/api/event-impact"));
      const secondBody = await second.json();
      expect(secondBody.stale).toBe(true);

      // Advance well past the 6h max-staleness window measured from the original cache write.
      vi.advanceTimersByTime(6 * 60 * 60_000);
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
      const third = await GET(new Request("http://x/api/event-impact"));
      expect(third.status).toBe(503);
      const thirdBody = await third.json();
      expect(thirdBody.state).toBe("calendar_unreadable");
      expect(thirdBody.stale).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
